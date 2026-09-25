//! Task 5: the ER ledger. These run on Solana in litesvm on program-owned accounts, which
//! is what the ER sees. The commit-home CPIs need MagicBlock: only their preconditions
//! are asserted here, the success paths are in the devnet canary.

mod common;
use common::*;
use common::flow::Opened;
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn seat(o: &Opened, u: &Keypair) -> Address {
    seat_pda(&o.presale, &u.pubkey())
}

#[test]
fn wallet_and_session_key_can_commit_a_stranger_cannot() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    let session = funded(&mut e.svm, SOL);
    let ix = ix_join(&user.pubkey(), e.gate(), &o.presale, &session.pubkey(), MAX_SEAT);
    ok(send(&mut e.svm, &user, &[], &[ix]), "join");
    let s = seat(&o, &user);

    ok(send(&mut e.svm, &user, &[], &[ix_set_commit(&user.pubkey(), &s, &o.presale, 200_000_000)]), "wallet");
    ok(send(&mut e.svm, &session, &[], &[ix_set_commit(&session.pubkey(), &s, &o.presale, 300_000_000)]), "session key");
    assert_eq!(read_seat(&e.svm, &s).commit, 300_000_000);

    let stranger = e.user(1);
    let ix = ix_set_commit(&stranger.pubkey(), &s, &o.presale, 400_000_000);
    assert_err(send(&mut e.svm, &stranger, &[], &[ix]), E_NOT_AUTHORIZED, "stranger");
}

#[test]
fn sizes_and_deposit_bound_the_commit() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, 500_000_000);
    assert_err(e.try_commit(&user, &o.presale, 105_000_000), E_BAD_SEAT_SIZE, "off grid");
    assert_err(e.try_commit(&user, &o.presale, 90_000_000), E_BAD_SEAT_SIZE, "under 0.1");
    assert_err(e.try_commit(&user, &o.presale, 600_000_000), E_OVER_DEPOSIT, "above the deposit");
    e.commit(&user, &o.presale, 500_000_000);
}

#[test]
fn the_creator_cannot_lower_or_withdraw() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, 500_000_000);
    let c = o.creator.insecure_clone();
    assert_err(e.try_commit(&c, &o.presale, 400_000_000), E_CREATOR_CANNOT_LOWER, "lower");
    assert_err(e.try_commit(&c, &o.presale, 0), E_CREATOR_CANNOT_LOWER, "withdraw");
    e.commit(&c, &o.presale, 800_000_000);
    assert_eq!(read_presale(&e.svm, &o.presale).raised, 800_000_000);
}

#[test]
fn withdraw_and_recommit_move_the_counters() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    e.commit(&user, &o.presale, 700_000_000);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!((p.raised, p.seats_committed), (1_700_000_000, 2));
    e.commit(&user, &o.presale, 0);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!((p.raised, p.seats_committed), (MAX_SEAT, 1));
    e.commit(&user, &o.presale, 400_000_000);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!((p.raised, p.seats_committed), (1_400_000_000, 2));
    // x -> y keeps the count
    e.commit(&user, &o.presale, 900_000_000);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!((p.raised, p.seats_committed), (1_900_000_000, 2));
}

#[test]
fn the_last_commit_is_cut_to_the_room_and_locks_full() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    // 8 more at 1 SOL and one at 0.7 -> 9.7 SOL
    for amount in [MAX_SEAT; 8].into_iter().chain([700_000_000]) {
        let u = e.user(2);
        e.join(&u, &o.presale, MAX_SEAT);
        e.commit(&u, &o.presale, amount);
    }
    assert_eq!(read_presale(&e.svm, &o.presale).raised, 9_700_000_000);
    let last = e.user(2);
    e.join(&last, &o.presale, MAX_SEAT);
    let later = now(&e.svm) + 60;
    warp_to(&mut e.svm, later);
    let t = now(&e.svm);
    e.commit(&last, &o.presale, MAX_SEAT);
    assert_eq!(read_seat(&e.svm, &seat(&o, &last)).commit, 300_000_000, "cut to the 0.3 left");
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!((p.state, p.raised, p.full_ts, p.seats_committed), (FULL, TARGET, t, 11));

    // FULL is locked: no raise, no withdraw, no new seat commits
    assert_err(e.try_commit(&last, &o.presale, 200_000_000), E_BAD_STATE, "withdraw after full");
    let late = e.user(2);
    assert_err(e.try_join(&late, &o.presale, MAX_SEAT), E_BAD_STATE, "join after full");
}

#[test]
fn no_commit_after_the_deadline() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    let deadline = read_presale(&e.svm, &o.presale).deadline_ts;
    warp_to(&mut e.svm, deadline);
    assert_err(e.try_commit(&user, &o.presale, MAX_SEAT), E_PAST_DEADLINE, "commit at the deadline");
}

#[test]
fn a_seat_only_commits_to_its_own_presale() {
    let mut e = Env::new(false);
    let a = e.open(MAX_SEAT, MAX_SEAT);
    let b = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    e.join(&user, &a.presale, MAX_SEAT);
    let ix = ix_set_commit(&user.pubkey(), &seat(&a, &user), &b.presale, MAX_SEAT);
    assert_err(send(&mut e.svm, &user, &[], &[ix]), E_WRONG_PRESALE, "seat of A against B");
}

#[test]
fn only_the_wallet_rotates_the_session_key() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    let old = funded(&mut e.svm, SOL);
    let ix = ix_join(&user.pubkey(), e.gate(), &o.presale, &old.pubkey(), MAX_SEAT);
    ok(send(&mut e.svm, &user, &[], &[ix]), "join");
    let s = seat(&o, &user);
    let new = funded(&mut e.svm, SOL);

    let ix = ix_rotate_key(&old.pubkey(), &s, &new.pubkey());
    assert_err(send(&mut e.svm, &old, &[], &[ix]), E_NOT_AUTHORIZED, "the session key rotating itself");
    let ix = ix_rotate_key(&user.pubkey(), &s, &Address::default());
    assert_err(send(&mut e.svm, &user, &[], &[ix]), E_ZERO_KEY, "zero key");
    ok(send(&mut e.svm, &user, &[], &[ix_rotate_key(&user.pubkey(), &s, &new.pubkey())]), "rotate");

    let ix = ix_set_commit(&old.pubkey(), &s, &o.presale, MAX_SEAT);
    assert_err(send(&mut e.svm, &old, &[], &[ix]), E_NOT_AUTHORIZED, "old key");
    ok(send(&mut e.svm, &new, &[], &[ix_set_commit(&new.pubkey(), &s, &o.presale, MAX_SEAT)]), "new key");
}

#[test]
fn expire_only_after_the_deadline_and_once() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let bot = e.bot.insecure_clone();
    assert_err(send(&mut e.svm, &bot, &[], &[ix_expire(&o.presale)]), E_BEFORE_DEADLINE, "early");
    let deadline = read_presale(&e.svm, &o.presale).deadline_ts;
    warp_to(&mut e.svm, deadline);
    ok(send(&mut e.svm, &bot, &[], &[ix_expire(&o.presale)]), "expire");
    assert_eq!(read_presale(&e.svm, &o.presale).state, EXPIRED);
    assert_err(send(&mut e.svm, &bot, &[], &[ix_expire(&o.presale)]), E_BAD_STATE, "twice");
}

#[test]
fn a_full_presale_never_expires() {
    let mut e = Env::new(false);
    let (o, _) = e.open_full();
    let deadline = read_presale(&e.svm, &o.presale).deadline_ts;
    warp_to(&mut e.svm, deadline + 1);
    let bot = e.bot.insecure_clone();
    assert_err(send(&mut e.svm, &bot, &[], &[ix_expire(&o.presale)]), E_BAD_STATE, "expire a full presale");
}

#[test]
fn leave_needs_a_zero_commit() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    e.commit(&user, &o.presale, 500_000_000);
    let ix = ix_leave(&user.pubkey(), &seat(&o, &user));
    assert_err(send(&mut e.svm, &user, &[], &[ix]), E_COMMIT_NOT_ZERO, "leave with a commit");
    let c = o.creator.insecure_clone();
    let ix = ix_leave(&c.pubkey(), &seat(&o, &c));
    assert_err(send(&mut e.svm, &c, &[], &[ix]), E_COMMIT_NOT_ZERO, "creator leaves");
    let stranger = e.user(1);
    let ix = ix_leave(&stranger.pubkey(), &seat(&o, &user));
    assert_err(send(&mut e.svm, &stranger, &[], &[ix]), E_NOT_AUTHORIZED, "stranger sends a seat home");
}

#[test]
fn commit_home_waits_for_the_presale_to_close() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    let bot = e.bot.insecure_clone();
    assert_err(send(&mut e.svm, &bot, &[], &[ix_commit_presale(&bot.pubkey(), &o.presale)]), E_BAD_STATE, "commit_presale while open");
    let seats = [seat(&o, &user)];
    assert_err(send(&mut e.svm, &bot, &[], &[ix_commit_seats(&bot.pubkey(), &o.presale, &seats)]), E_BAD_STATE, "commit_seats while open");
    assert_err(send(&mut e.svm, &bot, &[], &[ix_commit_seats(&bot.pubkey(), &o.presale, &[])]), E_BAD_DATA, "no seats");

    // once closed, a seat of another presale is refused
    let other = e.open(MAX_SEAT, MAX_SEAT);
    let deadline = read_presale(&e.svm, &o.presale).deadline_ts;
    warp_to(&mut e.svm, deadline);
    ok(send(&mut e.svm, &bot, &[], &[ix_expire(&o.presale)]), "expire");
    let foreign = [seat(&other, &other.creator)];
    assert_err(send(&mut e.svm, &bot, &[], &[ix_commit_seats(&bot.pubkey(), &o.presale, &foreign)]), E_WRONG_PRESALE, "foreign seat");
}
