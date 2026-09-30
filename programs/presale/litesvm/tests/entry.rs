//! Tasks 4 and 6: open_presale, join, and the delegate preconditions (litesvm has no
//! delegation program; the CPI itself is covered by the devnet canary).

mod common;
use common::*;
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn open_writes_every_field() {
    let mut e = Env::new(true);
    let t = now(&e.svm);
    let o = e.open(MAX_SEAT, 300_000_000);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!(p.state, OPEN);
    assert_eq!(p.creator, o.creator.pubkey());
    assert_eq!(p.mint, o.mint.pubkey());
    assert_eq!(p.fee_dest, o.fee_dest);
    assert_eq!(p.validator, Address::default());
    assert_eq!(p.pot, Address::default());
    assert_eq!(p.opened_ts, t);
    assert_eq!(p.deadline_ts, t + DURATION);
    assert_eq!(p.full_ts, 0);
    assert_eq!(p.raised, 300_000_000);
    assert_eq!(p.seats_committed, 1);
    assert_eq!(
        (p.seats_settled, p.seats_refunded, p.released, p.total_tokens, p.claimed_tokens, p.claims_done, p.fees_paid, p.settled_sum),
        (0, 0, 0, 0, 0, 0, 0, 0)
    );
    assert_eq!(lamports(&e.svm, &o.presale), rent(&e.svm, PRESALE_LEN));

    let seat = seat_pda(&o.presale, &o.creator.pubkey());
    let s = read_seat(&e.svm, &seat);
    assert_eq!(s.flags, F_CREATOR);
    assert_eq!(s.user, o.creator.pubkey());
    assert_eq!(s.session_key, o.creator.pubkey());
    assert_eq!(s.presale, o.presale);
    assert_eq!((s.deposit, s.commit), (MAX_SEAT, 300_000_000));
    assert_eq!(lamports(&e.svm, &seat), rent(&e.svm, SEAT_LEN) + MAX_SEAT);
}

#[test]
fn the_mint_must_sign() {
    let mut e = Env::new(false);
    let creator = e.user(3);
    let mint = Address::new_unique();
    let mut ix = ix_open_presale(&creator.pubkey(), e.gate(), &mint, &Address::new_unique(), &creator.pubkey(), MAX_SEAT, MIN_SEAT);
    ix.accounts[3].is_signer = false;
    assert_err(send(&mut e.svm, &creator, &[], &[ix]), E_NOT_AUTHORIZED, "open without the mint signing");
}

#[test]
fn the_mint_cannot_be_the_creator() {
    // else the server's mint signature alone would open a presale, with anyone's fee_dest
    let mut e = Env::new(false);
    let creator = e.user(3);
    let c = creator.pubkey();
    let ix = ix_open_presale(&c, e.gate(), &c, &Address::new_unique(), &c, MAX_SEAT, MIN_SEAT);
    assert_err(send(&mut e.svm, &creator, &[], &[ix]), E_NOT_AUTHORIZED, "the creator signs as the mint");
}

#[test]
fn open_rejects_bad_sizes_and_zero_keys() {
    let mut e = Env::new(false);
    let creator = e.user(3);
    for (deposit, commit, what) in [
        (MAX_SEAT, 105_000_000, "0.105 is off the 0.01 grid"),
        (MAX_SEAT, 0, "commit 0"),
        (MAX_SEAT, 90_000_000, "under 0.1"),
        (300_000_000, 400_000_000, "deposit below commit"),
        (MAX_SEAT + STEP, MAX_SEAT, "deposit above the max"),
    ] {
        assert_err(e.try_open(&creator, &Keypair::new(), deposit, commit), E_BAD_SEAT_SIZE, what);
    }
    let mint = Keypair::new();
    let z = Address::default();
    let ix = ix_open_presale(&creator.pubkey(), e.gate(), &mint.pubkey(), &z, &creator.pubkey(), MAX_SEAT, MIN_SEAT);
    assert_err(send(&mut e.svm, &creator, &[&mint], &[ix]), E_ZERO_KEY, "zero fee_dest");
    let ix = ix_open_presale(&creator.pubkey(), e.gate(), &mint.pubkey(), &Address::new_unique(), &z, MAX_SEAT, MIN_SEAT);
    assert_err(send(&mut e.svm, &creator, &[&mint], &[ix]), E_ZERO_KEY, "zero session key");
}

#[test]
fn one_presale_per_mint() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let other = e.user(3);
    assert_err(e.try_open(&other, &o.mint, MAX_SEAT, MIN_SEAT), E_ALREADY_EXISTS, "second presale on the same mint");
}

#[test]
fn prefunded_presale_address_still_opens() {
    // someone sends SOL to the announced presale address first: open must not break
    let mut e = Env::new(false);
    let creator = e.user(3);
    let mint = Keypair::new();
    let presale = presale_pda(&mint.pubkey());
    let griefer = e.user(1);
    ok(send(&mut e.svm, &griefer, &[], &[ix_transfer(&griefer.pubkey(), &presale, 1_000_000)]), "prefund");
    ok(e.try_open(&creator, &mint, MAX_SEAT, MIN_SEAT), "open on a prefunded address");
    assert_eq!(read_presale(&e.svm, &presale).state, OPEN);
}

#[test]
fn join_escrows_the_deposit() {
    let mut e = Env::new(true);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let user = e.user(2);
    let session = Address::new_unique();
    let ix = ix_join(&user.pubkey(), e.gate(), &o.presale, &session, 370_000_000);
    let gate = e.gate.insecure_clone();
    ok(send(&mut e.svm, &user, &[&gate], &[ix]), "join");
    let seat = seat_pda(&o.presale, &user.pubkey());
    let s = read_seat(&e.svm, &seat);
    assert_eq!((s.flags, s.user, s.session_key, s.presale, s.deposit, s.commit), (0, user.pubkey(), session, o.presale, 370_000_000, 0));
    assert_eq!(lamports(&e.svm, &seat), rent(&e.svm, SEAT_LEN) + 370_000_000);
    // joining adds no commit
    assert_eq!(read_presale(&e.svm, &o.presale).seats_committed, 1);
}

#[test]
fn join_checks_deposit_and_session() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let user = e.user(3);
    assert_err(e.try_join(&user, &o.presale, MIN_SEAT - 1), E_BAD_SEAT_SIZE, "deposit under 0.1");
    assert_err(e.try_join(&user, &o.presale, MAX_SEAT + 1), E_BAD_SEAT_SIZE, "deposit over the max");
    let ix = ix_join(&user.pubkey(), e.gate(), &o.presale, &Address::default(), MAX_SEAT);
    assert_err(send(&mut e.svm, &user, &[], &[ix]), E_ZERO_KEY, "zero session");
    // any lamport amount in range is a valid deposit (only commits are on the grid)
    e.join(&user, &o.presale, 123_456_789);
    assert_err(e.try_join(&user, &o.presale, MAX_SEAT), E_ALREADY_EXISTS, "second seat for the same wallet");
}

#[test]
fn join_fails_after_the_deadline_or_when_not_open() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let user = e.user(2);
    let deadline = read_presale(&e.svm, &o.presale).deadline_ts;
    warp_to(&mut e.svm, deadline);
    assert_err(e.try_join(&user, &o.presale, MAX_SEAT), E_PAST_DEADLINE, "join at the deadline");
    let bot = e.bot.insecure_clone();
    ok(send(&mut e.svm, &bot, &[], &[ix_expire(&o.presale)]), "expire");
    assert_err(e.try_join(&user, &o.presale, MAX_SEAT), E_BAD_STATE, "join an expired presale");
}

#[test]
fn join_reads_a_delegated_presale() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    fake_delegate(&mut e.svm, &o.presale);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    assert!(exists(&e.svm, &seat_pda(&o.presale, &user.pubkey())));
}

#[test]
fn join_rejects_an_account_that_is_not_a_presale() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let user = e.user(2);
    // a seat is program-owned but not a presale
    let seat = seat_pda(&o.presale, &o.creator.pubkey());
    assert_fails(e.try_join(&user, &seat, MAX_SEAT), "join a seat as if it were a presale");
}

// ---- delegate preconditions (Task 6) ----

/// Writes the pinned validator the way a successful kind-0 delegate would.
fn pin_validator(e: &mut Env, presale: &Address, v: &Address) {
    let mut acc = e.svm.get_account(presale).unwrap();
    acc.data[99..131].copy_from_slice(v.as_ref());
    e.svm.set_account(*presale, acc).unwrap();
}

#[test]
fn only_the_creator_delegates_an_open_presale() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let stranger = e.user(1);
    let v = e.validator;
    let ix = ix_delegate(&stranger.pubkey(), &o.presale, &v, 0, None);
    assert_err(send(&mut e.svm, &stranger, &[], &[ix]), E_NOT_AUTHORIZED, "kind 0 by a stranger");
    let ix = ix_delegate(&o.creator.pubkey(), &o.presale, &Address::default(), 0, None);
    assert_err(send(&mut e.svm, &o.creator, &[], &[ix]), E_WRONG_VALIDATOR, "kind 0 with a zero validator");
    // a validator that isn't MagicBlock's could keep the escrow in its ER forever
    let ix = ix_delegate(&o.creator.pubkey(), &o.presale, &Address::new_unique(), 0, None);
    assert_err(send(&mut e.svm, &o.creator, &[], &[ix]), E_WRONG_VALIDATOR, "kind 0 with an unknown validator");
    // a listed one gets past every check to the delegation CPI (no delegation program here)
    let ix = ix_delegate(&o.creator.pubkey(), &o.presale, &v, 0, None);
    let err = send(&mut e.svm, &o.creator, &[], &[ix]).expect_err("litesvm has no delegation program");
    assert!(!format!("{:?}", err.err).contains("Custom("), "a listed validator passes: {:?}", err.err);

    let deadline = read_presale(&e.svm, &o.presale).deadline_ts;
    warp_to(&mut e.svm, deadline);
    let bot = e.bot.insecure_clone();
    ok(send(&mut e.svm, &bot, &[], &[ix_expire(&o.presale)]), "expire");
    let ix = ix_delegate(&o.creator.pubkey(), &o.presale, &v, 0, None);
    assert_err(send(&mut e.svm, &o.creator, &[], &[ix]), E_BAD_STATE, "kind 0 on an expired presale");
}

#[test]
fn a_seat_follows_its_presale_validator() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    let seat = seat_pda(&o.presale, &user.pubkey());
    let v = e.validator;

    let ix = ix_delegate(&user.pubkey(), &seat, &v, 1, Some(&o.presale));
    assert_err(send(&mut e.svm, &user, &[], &[ix]), E_WRONG_VALIDATOR, "presale has no validator yet");

    pin_validator(&mut e, &o.presale, &v);
    let other = Address::new_unique();
    let ix = ix_delegate(&user.pubkey(), &seat, &other, 1, Some(&o.presale));
    assert_err(send(&mut e.svm, &user, &[], &[ix]), E_WRONG_VALIDATOR, "validator mismatch");

    let stranger = e.user(1);
    let ix = ix_delegate(&stranger.pubkey(), &seat, &v, 1, Some(&o.presale));
    assert_err(send(&mut e.svm, &stranger, &[], &[ix]), E_NOT_AUTHORIZED, "kind 1 by a stranger");

    let o2 = e.open(MAX_SEAT, MIN_SEAT);
    let ix = ix_delegate(&user.pubkey(), &seat, &v, 1, Some(&o2.presale));
    assert_err(send(&mut e.svm, &user, &[], &[ix]), E_WRONG_PRESALE, "kind 1 with another presale");
}

#[test]
fn delegate_rejects_unknown_kind_and_wrong_programs() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let v = e.validator;
    let mut ix = ix_delegate(&o.creator.pubkey(), &o.presale, &v, 0, None);
    ix.data[1] = 7;
    assert_err(send(&mut e.svm, &o.creator, &[], &[ix]), E_BAD_DATA, "unknown kind");
    let mut ix = ix_delegate(&o.creator.pubkey(), &o.presale, &v, 0, None);
    ix.accounts[6].pubkey = Address::new_unique();
    assert_err(send(&mut e.svm, &o.creator, &[], &[ix]), E_BAD_ACCOUNT, "fake delegation program");
}
