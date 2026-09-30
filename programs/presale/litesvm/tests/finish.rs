//! Task 9: claim (pro-rata tokens, the ATA paid from the pot), fail, close_presale.
//! Every presale here launches through the real DBC program first.

mod common;
use common::flow::Opened;
use common::*;
use litesvm::types::TransactionMetadata;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// FULL at uneven commits (Env::open_full_uneven), every seat settled, launched.
/// Returns (buyer, commit), creator first.
fn launched(e: &mut Env) -> (Opened, Vec<(Keypair, u64)>) {
    let (o, buyers) = e.open_full_uneven();
    assert!(buyers.len() >= 4, "four seats for the tests below");
    let keys: Vec<Keypair> = buyers.iter().map(|(k, _)| k.insecure_clone()).collect();
    e.settle_all(&o.presale, &keys);
    e.launch(&o);
    assert_eq!(read_presale(&e.svm, &o.presale).state, SETTLED);
    (o, buyers)
}

fn user_ata(o: &Opened, u: &Keypair) -> Address {
    ata(&u.pubkey(), &o.mint.pubkey(), &token22_id())
}

fn seat(o: &Opened, u: &Keypair) -> Address {
    seat_pda(&o.presale, &u.pubkey())
}

/// One claim per user in a single tx from `cranker`.
fn claim(e: &mut Env, cranker: &Keypair, o: &Opened, users: &[&Keypair]) -> TransactionMetadata {
    let ixs: Vec<_> = users.iter().map(|u| ix_claim(&cranker.pubkey(), &o.presale, &u.pubkey(), &o.mint.pubkey())).collect();
    ok(send(&mut e.svm, cranker, &[], &ixs), "claim")
}

fn vault_len(e: &Env, o: &Opened) -> usize {
    e.svm.get_account(&vault(&o.mint.pubkey())).unwrap().data.len()
}

fn mint_supply(e: &Env, o: &Opened) -> u64 {
    u64_at(&e.svm.get_account(&o.mint.pubkey()).unwrap().data, 36)
}

#[test]
fn claims_are_pro_rata_and_the_last_takes_the_remainder() {
    let mut e = Env::new(false);
    let (o, buyers) = launched(&mut e);
    let total = read_presale(&e.svm, &o.presale).total_tokens;
    let bot = e.bot.insecure_clone();
    let n = buyers.len();
    for (i, (u, commit)) in buyers.iter().enumerate() {
        claim(&mut e, &bot, &o, &[u]);
        let got = token_balance(&e.svm, &user_ata(&o, u));
        let floor = (total as u128 * *commit as u128 / TARGET as u128) as u64;
        if i + 1 < n {
            assert_eq!(got, floor, "buyer {i}: commit / TARGET of the tokens");
        } else {
            assert!(got >= floor, "the last claim takes the rounding remainder");
        }
        assert!(!exists(&e.svm, &seat(&o, u)), "seat closed");
    }
    let sum: u64 = buyers.iter().map(|(u, _)| token_balance(&e.svm, &user_ata(&o, u))).sum();
    assert_eq!(sum, total, "every token reaches a buyer");
    assert_eq!(token_balance(&e.svm, &vault(&o.mint.pubkey())), 0);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!((p.claims_done, p.claimed_tokens), (p.seats_committed, total));
}

#[test]
fn a_missing_ata_is_paid_from_the_pot_not_the_bot() {
    let mut e = Env::new(false);
    let (o, buyers) = launched(&mut e);
    let (u, bot) = (&buyers[1].0, e.bot.insecure_clone());
    let len = vault_len(&e, &o);
    let (b0, p0, u0, s0) = (
        lamports(&e.svm, &bot.pubkey()),
        lamports(&e.svm, &o.presale),
        lamports(&e.svm, &u.pubkey()),
        lamports(&e.svm, &seat(&o, u)),
    );
    let meta = claim(&mut e, &bot, &o, &[u]);
    assert_eq!(lamports(&e.svm, &bot.pubkey()), b0 + TX_FEE - meta.fee, "the bot only gets its crank fee");
    assert_eq!(lamports(&e.svm, &o.presale), p0 - rent(&e.svm, len) - TX_FEE, "the pot pays the ATA and the crank");
    assert_eq!(lamports(&e.svm, &user_ata(&o, u)), rent(&e.svm, len));
    assert_eq!(lamports(&e.svm, &u.pubkey()), u0 + s0, "the seat's rent goes back to the user");
}

#[test]
fn an_existing_ata_costs_the_pot_only_the_crank() {
    let mut e = Env::new(false);
    let (o, buyers) = launched(&mut e);
    let (u, bot) = (&buyers[2].0, e.bot.insecure_clone());
    let up = u.pubkey();
    ok(send(&mut e.svm, u, &[], &[ix_create_ata(&up, &up, &o.mint.pubkey(), &token22_id())]), "user makes its ATA");
    let p0 = lamports(&e.svm, &o.presale);
    claim(&mut e, &bot, &o, &[u]);
    assert_eq!(lamports(&e.svm, &o.presale), p0 - TX_FEE);
    assert!(token_balance(&e.svm, &user_ata(&o, u)) > 0);
}

#[test]
fn a_prefunded_ata_address_still_claims() {
    // someone sends SOL to a buyer's ATA address first: the claim must not break
    let mut e = Env::new(false);
    let (o, buyers) = launched(&mut e);
    let (bot, griefer) = (e.bot.insecure_clone(), e.user(3));
    let len = vault_len(&e, &o);
    let r = rent(&e.svm, len);
    // the smallest prefund a system account allows, and one above the ATA's rent
    for (u, prefund) in [(&buyers[1].0, rent(&e.svm, 0)), (&buyers[2].0, SOL)] {
        let ua = user_ata(&o, u);
        ok(send(&mut e.svm, &griefer, &[], &[ix_transfer(&griefer.pubkey(), &ua, prefund)]), "prefund");
        let p0 = lamports(&e.svm, &o.presale);
        claim(&mut e, &bot, &o, &[u]);
        assert!(token_balance(&e.svm, &ua) > 0);
        assert_eq!(lamports(&e.svm, &ua), r.max(prefund), "the ATA holds rent, or the prefund if bigger");
        assert_eq!(lamports(&e.svm, &o.presale), p0 - r.saturating_sub(prefund) - TX_FEE, "the pot pays only the shortfall");
    }
}

#[test]
fn an_ata_that_requires_memos_still_claims() {
    // Token-2022 MemoTransfer on the buyer's ATA: the claim's own memo lets the tokens in,
    // so one buyer can't hold up close_presale
    let mut e = Env::new(false);
    let (o, buyers) = launched(&mut e);
    let (m, u) = (o.mint.pubkey(), buyers[3].0.insecure_clone());
    let (up, ua) = (u.pubkey(), user_ata(&o, &u));
    let mut realloc = vec![29u8]; // Reallocate for MemoTransfer (extension type 8)
    realloc.extend_from_slice(&8u16.to_le_bytes());
    let ixs = [
        ix_create_ata(&up, &up, &m, &token22_id()),
        Instruction {
            program_id: token22_id(),
            accounts: vec![AccountMeta::new(ua, false), AccountMeta::new(up, true), AccountMeta::new_readonly(system_id(), false), AccountMeta::new_readonly(up, true)],
            data: realloc,
        },
        Instruction { program_id: token22_id(), accounts: vec![AccountMeta::new(ua, false), AccountMeta::new_readonly(up, true)], data: vec![30, 0] },
    ];
    ok(send(&mut e.svm, &u, &[], &ixs), "require memos on the ATA");
    let bot = e.bot.insecure_clone();
    let everyone: Vec<&Keypair> = buyers.iter().map(|(k, _)| k).collect();
    for chunk in everyone.chunks(5) {
        claim(&mut e, &bot, &o, chunk);
    }
    assert!(token_balance(&e.svm, &ua) > 0, "the memo-only ATA got its tokens");
    ok(send(&mut e.svm, &bot, &[], &[ix_close_presale(&o.presale, &o.creator.pubkey(), &m)]), "close");
    assert!(!exists(&e.svm, &o.presale));
}

#[test]
fn self_claim_pays_no_fee() {
    let mut e = Env::new(false);
    let (o, buyers) = launched(&mut e);
    let u = &buyers[3].0;
    let len = vault_len(&e, &o);
    let (p0, u0, s0) = (lamports(&e.svm, &o.presale), lamports(&e.svm, &u.pubkey()), lamports(&e.svm, &seat(&o, u)));
    let meta = claim(&mut e, u, &o, &[u]);
    assert_eq!(lamports(&e.svm, &o.presale), p0 - rent(&e.svm, len), "no crank fee, the ATA still from the pot");
    assert_eq!(lamports(&e.svm, &u.pubkey()), u0 + s0 - meta.fee);
}

#[test]
fn claims_in_one_tx_split_the_allowance() {
    let mut e = Env::new(false);
    let (o, buyers) = launched(&mut e);
    let bot = e.bot.insecure_clone();
    let b0 = lamports(&e.svm, &bot.pubkey());
    let meta = claim(&mut e, &bot, &o, &[&buyers[1].0, &buyers[2].0]);
    assert_eq!(lamports(&e.svm, &bot.pubkey()), b0 + 2 * (TX_FEE / 2) - meta.fee);
}

#[test]
fn a_seat_claims_once_and_only_for_its_user() {
    let mut e = Env::new(false);
    let (o, buyers) = launched(&mut e);
    let (u, bot, stranger) = (&buyers[1].0, e.bot.insecure_clone(), Keypair::new());
    let mut ix = ix_claim(&bot.pubkey(), &o.presale, &u.pubkey(), &o.mint.pubkey());
    ix.accounts[3] = AccountMeta::new(stranger.pubkey(), false);
    ix.accounts[5] = AccountMeta::new(user_ata(&o, &stranger), false);
    assert_err(send(&mut e.svm, &bot, &[], &[ix]), E_BAD_ACCOUNT, "tokens redirected to a stranger");

    claim(&mut e, &bot, &o, &[u]);
    let ix = ix_claim(&bot.pubkey(), &o.presale, &u.pubkey(), &o.mint.pubkey());
    assert_err(send(&mut e.svm, &bot, &[], &[ix]), E_NOT_HOME, "second claim: the seat is gone");
}

#[test]
fn no_claim_before_the_launch() {
    let mut e = Env::new(false);
    let (o, buyers) = e.open_full();
    e.settle_all(&o.presale, &buyers);
    let bot = e.bot.insecure_clone();
    let ix = ix_claim(&bot.pubkey(), &o.presale, &buyers[1].pubkey(), &o.mint.pubkey());
    assert_err(send(&mut e.svm, &bot, &[], &[ix]), E_BAD_STATE, "claim while FULL");
}

#[test]
fn close_after_every_claim_burns_strays_and_pays_the_creator() {
    let mut e = Env::new(false);
    let (o, buyers) = launched(&mut e);
    let (bot, m, c) = (e.bot.insecure_clone(), o.mint.pubkey(), o.creator.pubkey());
    let close = ix_close_presale(&o.presale, &c, &m);
    assert_err(send(&mut e.svm, &bot, &[], &[close.clone()]), E_SEATS_OPEN, "close with claims left");

    for (u, _) in &buyers {
        claim(&mut e, &bot, &o, &[u]);
    }
    // a buyer sends some tokens back into the vault
    let (u, v) = (&buyers[1].0, vault(&m));
    let decimals = e.svm.get_account(&m).unwrap().data[44];
    let mut data = vec![12u8];
    data.extend_from_slice(&1000u64.to_le_bytes());
    data.push(decimals);
    let back = Instruction {
        program_id: token22_id(),
        accounts: vec![
            AccountMeta::new(user_ata(&o, u), false),
            AccountMeta::new_readonly(m, false),
            AccountMeta::new(v, false),
            AccountMeta::new_readonly(u.pubkey(), true),
        ],
        data,
    };
    ok(send(&mut e.svm, u, &[], &[back]), "tokens back to the vault");

    let wrong = ix_close_presale(&o.presale, &Address::new_unique(), &m);
    assert_err(send(&mut e.svm, &bot, &[], &[wrong]), E_BAD_ACCOUNT, "close paying someone else");

    let (supply, c0) = (mint_supply(&e, &o), lamports(&e.svm, &c));
    let owed = lamports(&e.svm, &o.presale) + lamports(&e.svm, &v);
    ok(send(&mut e.svm, &bot, &[], &[close]), "close");
    assert_eq!(mint_supply(&e, &o), supply - 1000, "stray tokens burned");
    assert!(!exists(&e.svm, &v) && !exists(&e.svm, &o.presale));
    assert_eq!(lamports(&e.svm, &c), c0 + owed, "the rest of the pot and the vault rent go to the creator");
}

#[test]
fn close_after_expiry_waits_for_every_refund() {
    let mut e = Env::new(false);
    let o = e.open(MAX_SEAT, 200_000_000);
    let user = e.user(2);
    e.join(&user, &o.presale, MAX_SEAT);
    e.commit(&user, &o.presale, 200_000_000);
    let deadline = read_presale(&e.svm, &o.presale).deadline_ts;
    warp_to(&mut e.svm, deadline);
    let (bot, c, m) = (e.bot.insecure_clone(), o.creator.insecure_clone(), o.mint.pubkey());
    ok(send(&mut e.svm, &bot, &[], &[ix_expire(&o.presale)]), "expire");

    let close = ix_close_presale(&o.presale, &c.pubkey(), &m);
    let refund = |u: &Keypair| ix_settle_seat(&bot.pubkey(), &seat(&o, u), &u.pubkey(), &o.presale);
    ok(send(&mut e.svm, &bot, &[], &[refund(&c)]), "refund the creator");
    assert_err(send(&mut e.svm, &bot, &[], &[close.clone()]), E_SEATS_OPEN, "close with a deposit still held");
    ok(send(&mut e.svm, &bot, &[], &[refund(&user)]), "refund the user");

    let (c0, owed) = (lamports(&e.svm, &c.pubkey()), lamports(&e.svm, &o.presale));
    ok(send(&mut e.svm, &bot, &[], &[close]), "close");
    assert!(!exists(&e.svm, &o.presale));
    assert_eq!(lamports(&e.svm, &c.pubkey()), c0 + owed);
}

#[test]
fn fail_then_refund_everyone_then_close() {
    let mut e = Env::new(false);
    let (o, buyers) = e.open_full();
    let bot = e.bot.insecure_clone();
    let (m, c) = (o.mint.pubkey(), o.creator.pubkey());
    // all but three settled before the launch failed (7 of 10 in a 10 SOL pool)
    let some: Vec<Keypair> = buyers[..buyers.len() - 3].iter().map(|k| k.insecure_clone()).collect();
    e.settle_all(&o.presale, &some);
    let full_ts = read_presale(&e.svm, &o.presale).full_ts;
    warp_to(&mut e.svm, full_ts + GRACE);
    ok(send(&mut e.svm, &bot, &[], &[ix_fail(&o.presale)]), "fail");

    // a failed presale never launches
    let ixs = e.launch_ixs(&o, 1);
    assert_err(send(&mut e.svm, &bot, &[&o.mint], &ixs), E_BAD_STATE, "launch after FAILED");

    e.settle_all(&o.presale, &buyers);
    let p = read_presale(&e.svm, &o.presale);
    assert_eq!(p.seats_refunded, p.seats_committed);
    let (c0, owed) = (lamports(&e.svm, &c), lamports(&e.svm, &o.presale));
    ok(send(&mut e.svm, &bot, &[], &[ix_close_presale(&o.presale, &c, &m)]), "close");
    assert!(!exists(&e.svm, &o.presale));
    assert_eq!(lamports(&e.svm, &c), c0 + owed);
}

#[test]
fn fail_only_a_full_presale_at_home() {
    let mut e = Env::new(false);
    let bot = e.bot.insecure_clone();
    let open = e.open(MAX_SEAT, MIN_SEAT);
    assert_err(send(&mut e.svm, &bot, &[], &[ix_fail(&open.presale)]), E_BAD_STATE, "fail an OPEN presale");
    let close = ix_close_presale(&open.presale, &open.creator.pubkey(), &open.mint.pubkey());
    assert_err(send(&mut e.svm, &bot, &[], &[close]), E_BAD_STATE, "close an OPEN presale");

    let (o, _) = launched(&mut e);
    let later = now(&e.svm) + GRACE;
    warp_to(&mut e.svm, later);
    assert_err(send(&mut e.svm, &bot, &[], &[ix_fail(&o.presale)]), E_BAD_STATE, "fail a SETTLED presale");

    let (f, _) = e.open_full();
    let full_ts = read_presale(&e.svm, &f.presale).full_ts;
    warp_to(&mut e.svm, full_ts + GRACE);
    fake_record(&mut e.svm, &f.presale);
    assert_err(send(&mut e.svm, &bot, &[], &[ix_fail(&f.presale)]), E_NOT_HOME, "fail while delegated");
}
