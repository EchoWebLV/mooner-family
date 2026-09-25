//! Task 7: settle_seat, where the SOL moves on Solana. A seat's lamports only ever go to
//! its user, or exactly `commit` to the Presale while FULL.

mod common;
use common::flow::Opened;
use common::*;
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn seat(o: &Opened, u: &Keypair) -> Address {
    seat_pda(&o.presale, &u.pubkey())
}

/// Sends one settle_seat per buyer in a single tx from `cranker`; returns the tx fee.
fn settle(e: &mut Env, cranker: &Keypair, o: &Opened, users: &[&Keypair]) -> u64 {
    let ixs: Vec<_> = users.iter().map(|u| ix_settle_seat(&cranker.pubkey(), &seat(o, u), &u.pubkey(), &o.presale)).collect();
    ok(send(&mut e.svm, cranker, &[], &ixs), "settle_seat").fee
}

fn expire(e: &mut Env, o: &Opened) {
    let deadline = read_presale(&e.svm, &o.presale).deadline_ts;
    warp_to(&mut e.svm, deadline);
    let bot = e.bot.insecure_clone();
    ok(send(&mut e.svm, &bot, &[], &[ix_expire(&o.presale)]), "expire");
}

#[test]
fn a_seat_with_no_commit_is_refunded_and_closed() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, 500_000_000);
    let s = seat(&o, &user);
    let seat_lamports = lamports(&e.svm, &s);
    // works while the presale is still in the ER: it isn't read
    fake_delegate(&mut e.svm, &o.presale);

    let (user0, bot) = (lamports(&e.svm, &user.pubkey()), e.bot.insecure_clone());
    let bot0 = lamports(&e.svm, &bot.pubkey());
    let fee = settle(&mut e, &bot, &o, &[&user]);
    assert!(!exists(&e.svm, &s), "seat closed");
    assert_eq!(lamports(&e.svm, &user.pubkey()), user0 + seat_lamports - TX_FEE, "refund minus the crank fee");
    assert_eq!(lamports(&e.svm, &bot.pubkey()), bot0 + TX_FEE - fee);
}

#[test]
fn self_crank_pays_no_fee() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, 500_000_000);
    let seat_lamports = lamports(&e.svm, &seat(&o, &user));
    let user0 = lamports(&e.svm, &user.pubkey());
    let fee = settle(&mut e, &user, &o, &[&user]);
    assert_eq!(lamports(&e.svm, &user.pubkey()), user0 + seat_lamports - fee);
}

/// Creator 1/1, eight at 1/1, X deposits 1 commits 0.5, Y deposits 0.8 commits 0.5 -> FULL.
fn full_with_excess(e: &mut Env) -> (Opened, Vec<Keypair>, Keypair, Keypair) {
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let mut ones = vec![];
    for _ in 0..8 {
        let u = e.user(2);
        e.join(&u, &o.presale, MAX_SEAT);
        e.commit(&u, &o.presale, MAX_SEAT);
        ones.push(u);
    }
    let (x, y) = (e.user(2), e.user(2));
    e.join(&x, &o.presale, MAX_SEAT);
    e.commit(&x, &o.presale, 500_000_000);
    e.join(&y, &o.presale, 800_000_000);
    e.commit(&y, &o.presale, 500_000_000);
    assert_eq!(read_presale(&e.svm, &o.presale).state, FULL);
    (o, ones, x, y)
}

#[test]
fn full_moves_only_the_commit_in() {
    let mut e = Env::new(false);
    let (o, _, x, y) = full_with_excess(&mut e);
    let bot = e.bot.insecure_clone();
    let (x0, p0, b0) = (lamports(&e.svm, &x.pubkey()), lamports(&e.svm, &o.presale), lamports(&e.svm, &bot.pubkey()));
    let fee = settle(&mut e, &bot, &o, &[&x]);
    assert_eq!(lamports(&e.svm, &x.pubkey()), x0, "X is paid nothing yet, and no fee");
    assert_eq!(lamports(&e.svm, &o.presale), p0 + 500_000_000 - TX_FEE, "the pot pays the crank");
    assert_eq!(lamports(&e.svm, &bot.pubkey()), b0 + TX_FEE - fee);
    let sx = read_seat(&e.svm, &seat(&o, &x));
    assert_eq!(sx.flags & F_SETTLED, F_SETTLED);
    assert_eq!(lamports(&e.svm, &seat(&o, &x)), rent(&e.svm, SEAT_LEN) + 500_000_000, "the 0.5 excess waits in the seat");

    settle(&mut e, &bot, &o, &[&y]);
    assert_eq!(lamports(&e.svm, &seat(&o, &y)), rent(&e.svm, SEAT_LEN) + 300_000_000);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!((p.seats_settled, p.settled_sum, p.fees_paid), (2, 1_000_000_000, 2 * TX_FEE));
}

#[test]
fn an_emptied_wallet_cannot_veto_the_launch() {
    // 1 lamport over the commit, then the wallet is emptied: paying that lamport out at
    // settle would fail Solana's rent check and block every launch
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let mut buyers = vec![o.creator.insecure_clone()];
    for i in 0..9 {
        let u = e.user(2);
        e.join(&u, &o.presale, MAX_SEAT);
        if i == 0 {
            let s = seat(&o, &u);
            ok(send(&mut e.svm, &u, &[], &[ix_transfer(&u.pubkey(), &s, 1)]), "a lamport into the seat");
        }
        e.commit(&u, &o.presale, MAX_SEAT);
        buyers.push(u);
    }
    let griefer = buyers[1].insecure_clone();
    let g = griefer.pubkey();
    let sink = Address::new_unique();
    let left = lamports(&e.svm, &g) - 5_000;
    ok(send(&mut e.svm, &griefer, &[], &[ix_transfer(&g, &sink, left)]), "empty the wallet");
    assert!(!exists(&e.svm, &g), "the wallet is gone");

    e.settle_all(&o.presale, &buyers);
    e.launch(&o);
    let s = seat(&o, &griefer);
    let owed = lamports(&e.svm, &s);
    assert_eq!(owed, rent(&e.svm, SEAT_LEN) + 1);
    let bot = e.bot.insecure_clone();
    ok(send(&mut e.svm, &bot, &[], &[ix_claim(&bot.pubkey(), &o.presale, &g, &o.mint.pubkey())]), "claim");
    assert_eq!(lamports(&e.svm, &g), owed, "the rent and the lamport come home at claim (the pot pays the crank)");
}

#[test]
fn same_tag_ixs_split_one_tx_allowance() {
    let mut e = Env::new(false);
    let (o, ones, _, _) = full_with_excess(&mut e);
    let bot = e.bot.insecure_clone();
    let b0 = lamports(&e.svm, &bot.pubkey());
    let fee = settle(&mut e, &bot, &o, &[&ones[0], &ones[1], &ones[2]]);
    let share = TX_FEE / 3;
    assert_eq!(lamports(&e.svm, &bot.pubkey()), b0 + 3 * share - fee);
    assert_eq!(read_presale(&e.svm, &o.presale).fees_paid, 3 * share);
}

#[test]
fn a_seat_settles_once_and_only_to_its_user() {
    let mut e = Env::new(false);
    let (o, ones, _, _) = full_with_excess(&mut e);
    let bot = e.bot.insecure_clone();
    let u = &ones[0];
    let ix = ix_settle_seat(&bot.pubkey(), &seat(&o, u), &bot.pubkey(), &o.presale);
    assert_err(send(&mut e.svm, &bot, &[], &[ix]), E_BAD_ACCOUNT, "refund sent to the cranker");
    settle(&mut e, &bot, &o, &[u]);
    let ix = ix_settle_seat(&bot.pubkey(), &seat(&o, u), &u.pubkey(), &o.presale);
    assert_err(send(&mut e.svm, &bot, &[], &[ix]), E_ALREADY_SETTLED, "second settle");
}

#[test]
fn a_committed_seat_cannot_leave_an_open_presale() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MAX_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    e.commit(&user, &o.presale, 500_000_000);
    let ix = ix_settle_seat(&user.pubkey(), &seat(&o, &user), &user.pubkey(), &o.presale);
    assert_err(send(&mut e.svm, &user, &[], &[ix]), E_BAD_STATE, "settle while OPEN");
}

#[test]
fn expired_refunds_every_deposit_in_full() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, 600_000_000);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    e.commit(&user, &o.presale, 600_000_000);
    expire(&mut e, &o);
    let bot = e.bot.insecure_clone();
    let c = o.creator.insecure_clone();
    let (u0, c0) = (lamports(&e.svm, &user.pubkey()), lamports(&e.svm, &c.pubkey()));
    let (us, cs) = (lamports(&e.svm, &seat(&o, &user)), lamports(&e.svm, &seat(&o, &c)));
    settle(&mut e, &bot, &o, &[&user]);
    settle(&mut e, &bot, &o, &[&c]);
    assert_eq!(lamports(&e.svm, &user.pubkey()), u0 + us - TX_FEE);
    assert_eq!(lamports(&e.svm, &c.pubkey()), c0 + cs - TX_FEE);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!((p.seats_refunded, p.seats_committed), (2, 2));
    assert_eq!(lamports(&e.svm, &o.presale), rent(&e.svm, PRESALE_LEN), "the presale never held any of it");
}

#[test]
fn failed_refunds_settled_and_unsettled_seats() {
    let mut e = Env::new(false);
    let (o, buyers) = e.open_full();
    let bot = e.bot.insecure_clone();
    let settled: Vec<&Keypair> = buyers[..7].iter().collect();
    settle(&mut e, &bot, &o, &settled);
    let p = read_presale(&e.svm, &o.presale);
    let share = TX_FEE / 7;
    assert_eq!((p.settled_sum, p.fees_paid), (7 * MAX_SEAT, 7 * share));

    // no launch within GRACE
    let bot2 = e.bot.insecure_clone();
    assert_err(send(&mut e.svm, &bot2, &[], &[ix_fail(&o.presale)]), E_BEFORE_GRACE, "fail too early");
    warp_to(&mut e.svm, p.full_ts + GRACE);
    ok(send(&mut e.svm, &bot2, &[], &[ix_fail(&o.presale)]), "fail");
    assert_eq!(read_presale(&e.svm, &o.presale).state, FAILED);

    // a settled seat gets its commit back less its share of the settle fees
    let u = &buyers[0];
    let (u0, s0) = (lamports(&e.svm, &u.pubkey()), lamports(&e.svm, &seat(&o, u)));
    settle(&mut e, &bot, &o, &[u]);
    let owed = MAX_SEAT - (7 * share * MAX_SEAT).div_ceil(7 * MAX_SEAT);
    assert_eq!(lamports(&e.svm, &u.pubkey()), u0 + s0 + owed - TX_FEE);

    // an unsettled seat never left its escrow
    let v = &buyers[9];
    let (v0, t0) = (lamports(&e.svm, &v.pubkey()), lamports(&e.svm, &seat(&o, v)));
    settle(&mut e, &bot, &o, &[v]);
    assert_eq!(lamports(&e.svm, &v.pubkey()), v0 + t0 - TX_FEE);

    // everyone else, then the presale holds only its rent and rounding dust
    let rest: Vec<&Keypair> = buyers[1..9].iter().collect();
    settle(&mut e, &bot, &o, &rest);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!(p.seats_refunded, 10);
    let left = lamports(&e.svm, &o.presale) - rent(&e.svm, PRESALE_LEN);
    assert!(left < 10, "dust {left}");
}

#[test]
fn the_home_guard_blocks_delegated_accounts() {
    let mut e = Env::new(false);
    let (o, ones, _, _) = full_with_excess(&mut e);
    let bot = e.bot.insecure_clone();
    let (a, b) = (&ones[0], &ones[1]);

    // inside the ER a delegated seat looks program-owned, but its record exists on Solana
    fake_record(&mut e.svm, &seat(&o, a));
    let ix = ix_settle_seat(&bot.pubkey(), &seat(&o, a), &a.pubkey(), &o.presale);
    assert_err(send(&mut e.svm, &bot, &[], &[ix]), E_NOT_HOME, "seat with a delegation record");

    // the same for the presale
    fake_record(&mut e.svm, &o.presale);
    let ix = ix_settle_seat(&bot.pubkey(), &seat(&o, b), &b.pubkey(), &o.presale);
    assert_err(send(&mut e.svm, &bot, &[], &[ix.clone()]), E_NOT_HOME, "presale with a delegation record");

    // a presale owned by the delegation program (still on Solana under DLP)
    fake_delegate(&mut e.svm, &o.presale);
    assert_err(send(&mut e.svm, &bot, &[], &[ix.clone()]), E_NOT_HOME, "delegated presale");
    fake_undelegate(&mut e.svm, &o.presale);
    ok(send(&mut e.svm, &bot, &[], &[ix]), "home again");

    // a delegated seat
    let c = &ones[2];
    fake_delegate(&mut e.svm, &seat(&o, c));
    let ix = ix_settle_seat(&bot.pubkey(), &seat(&o, c), &c.pubkey(), &o.presale);
    assert_err(send(&mut e.svm, &bot, &[], &[ix]), E_NOT_HOME, "delegated seat");
}

#[test]
fn a_fake_record_address_is_refused() {
    let mut e = Env::new(false);
    let (o, ones, _, _) = full_with_excess(&mut e);
    let bot = e.bot.insecure_clone();
    let u = &ones[0];
    let mut ix = ix_settle_seat(&bot.pubkey(), &seat(&o, u), &u.pubkey(), &o.presale);
    ix.accounts[2].pubkey = Address::new_unique(); // an empty account that isn't the record
    assert_err(send(&mut e.svm, &bot, &[], &[ix]), E_BAD_ACCOUNT, "fake seat record");
}
