//! Task 3: the Config (only the upgrade authority creates it, only the admin changes it)
//! and the entry gate (the server co-signs opens and joins when armed).

mod common;
use common::*;
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn upgrade_authority_creates_the_config() {
    let e = Env::new(true);
    let c = read_config(&e.svm);
    assert_eq!(c.admin, e.admin.pubkey());
    assert_eq!(c.gate, e.gate.pubkey());
    assert_eq!(c.bot, e.bot.pubkey());
    assert_eq!(c.dbc_config, dbc_config());
}

#[test]
fn nobody_else_can_create_it() {
    let auth = Keypair::new();
    let mut svm = fresh_svm(&auth.pubkey());
    let stranger = funded(&mut svm, SOL);
    let k = Address::new_unique();
    let ix = ix_init_config(&stranger.pubkey(), &k, &k, &k, &k);
    assert_err(send(&mut svm, &stranger, &[], &[ix]), E_NOT_AUTHORIZED, "init by a stranger");
}

#[test]
fn it_is_created_once() {
    let mut e = Env::new(false);
    let k = Address::new_unique();
    let ix = ix_init_config(&e.auth.pubkey(), &k, &k, &k, &k);
    assert_err(send(&mut e.svm, &e.auth, &[], &[ix]), E_ALREADY_EXISTS, "second init");
}

#[test]
fn zero_admin_bot_or_dbc_config_is_rejected() {
    let auth = Keypair::new();
    let mut svm = fresh_svm(&auth.pubkey());
    svm.airdrop(&auth.pubkey(), SOL).unwrap();
    let (k, z) = (Address::new_unique(), Address::default());
    for (admin, bot, dbc, what) in [(z, k, k, "admin"), (k, z, k, "bot"), (k, k, z, "dbc_config")] {
        let ix = ix_init_config(&auth.pubkey(), &admin, &z, &bot, &dbc);
        assert_err(send(&mut svm, &auth, &[], &[ix]), E_ZERO_KEY, what);
    }
}

#[test]
fn admin_rotates_keys_and_nobody_else_can() {
    let mut e = Env::new(true);
    let (a2, g2, b2, d2) = (Keypair::new(), Address::new_unique(), Address::new_unique(), Address::new_unique());
    let stranger = funded(&mut e.svm, SOL);
    let ix = ix_set_config(&stranger.pubkey(), &stranger.pubkey(), &g2, &b2, &d2);
    assert_err(send(&mut e.svm, &stranger, &[], &[ix]), E_NOT_AUTHORIZED, "set_config by a stranger");

    let admin = e.admin.insecure_clone();
    let ix = ix_set_config(&admin.pubkey(), &a2.pubkey(), &g2, &b2, &d2);
    ok(send(&mut e.svm, &admin, &[], &[ix]), "set_config by admin");
    assert_eq!(read_config(&e.svm), Config { admin: a2.pubkey(), gate: g2, bot: b2, dbc_config: d2 });

    // the old admin is out
    let ix = ix_set_config(&admin.pubkey(), &admin.pubkey(), &g2, &b2, &d2);
    assert_err(send(&mut e.svm, &admin, &[], &[ix]), E_NOT_AUTHORIZED, "old admin");
}

#[test]
fn armed_gate_must_cosign_open() {
    let mut e = Env::new(true);
    let creator = e.user(3);
    let mint = Keypair::new();
    let fee_dest = Address::new_unique();
    // gate account present but not signing
    let ix = ix_open_presale(&creator.pubkey(), (e.gate.pubkey(), false), &mint.pubkey(), &fee_dest, &creator.pubkey(), MAX_SEAT, MIN_SEAT);
    assert_err(send(&mut e.svm, &creator, &[&mint], &[ix]), E_GATE_REQUIRED, "open without the gate");
    // a forged gate signs
    let forged = Keypair::new();
    let ix = ix_open_presale(&creator.pubkey(), (forged.pubkey(), true), &mint.pubkey(), &fee_dest, &creator.pubkey(), MAX_SEAT, MIN_SEAT);
    assert_err(send(&mut e.svm, &creator, &[&mint, &forged], &[ix]), E_GATE_REQUIRED, "open with a forged gate");
    // the real gate signs
    ok(e.try_open(&creator, &mint, MAX_SEAT, MIN_SEAT), "open with the gate");
}

#[test]
fn armed_gate_must_cosign_join() {
    let mut e = Env::new(true);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let user = e.user(2);
    let ix = ix_join(&user.pubkey(), (e.gate.pubkey(), false), &o.presale, &user.pubkey(), MAX_SEAT);
    assert_err(send(&mut e.svm, &user, &[], &[ix]), E_GATE_REQUIRED, "join without the gate");
    e.join(&user, &o.presale, MAX_SEAT);
}

#[test]
fn zero_gate_is_an_open_door() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, MIN_SEAT);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    assert_eq!(read_seat(&e.svm, &seat_pda(&o.presale, &user.pubkey())).deposit, MAX_SEAT);
}
