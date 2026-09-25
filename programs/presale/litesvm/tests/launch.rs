//! Task 8: the launch tx against the real Meteora DBC program (mainnet dump) and config.
//! release + settle only pass inside the exact tx shape: create pool, release, one pot
//! buy at the floor, settle, and the pool's creator fees handed to fee_dest.

mod common;
use common::flow::Opened;
use common::*;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;

// positions in Env::launch_ixs
const INIT: usize = 1;
const RELEASE: usize = 4;
const SYNC: usize = 5;
const SWAP: usize = 6;
const SETTLE: usize = 7;
const TPC: usize = 9;

const PACKET: usize = 1232;
const CLAIM_CREATOR_TRADING_FEE: [u8; 8] = [82, 220, 250, 189, 3, 85, 107, 45];

/// A FULL presale with every seat settled, ready to launch.
fn ready(e: &mut Env) -> Opened {
    let (o, buyers) = e.open_full();
    e.settle_all(&o.presale, &buyers);
    o
}

/// Sends launch-shaped ixs from the bot; the mint co-signs the pool creation.
fn try_launch(e: &mut Env, o: &Opened, ixs: &[Instruction], extra: &[&Keypair]) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let bot = e.bot.insecure_clone();
    let mut signers = vec![&o.mint];
    signers.extend_from_slice(extra);
    send(&mut e.svm, &bot, &signers, ixs)
}

fn pot_wsol(e: &Env) -> Address {
    ata(&e.bot.pubkey(), &wsol(), &token_id())
}

/// The fields of DBC's VirtualPool the tests read (IDL v0.2.0 offsets, after the 8-byte
/// discriminator). The known keys are checked so a layout change fails loudly.
struct Pool {
    creator: Address,
    quote_reserve: u64,
    protocol_quote_fee: u64,
    partner_quote_fee: u64,
    creator_quote_fee: u64,
}

fn read_pool(svm: &LiteSVM, mint: &Address) -> Pool {
    let (pool, base, quote) = pool_addresses(&dbc_config(), mint);
    let d = svm.get_account(&pool).expect("pool").data;
    assert_eq!((key_at(&d, 136), key_at(&d, 168), key_at(&d, 200)), (*mint, base, quote), "VirtualPool layout");
    Pool {
        creator: key_at(&d, 104),
        quote_reserve: u64_at(&d, 240),
        protocol_quote_fee: u64_at(&d, 256),
        partner_quote_fee: u64_at(&d, 272),
        creator_quote_fee: u64_at(&d, 360),
    }
}

#[test]
fn the_launch_tx_buys_at_the_floor_and_settles() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let released = e.expected_release(&o);
    let vault_len = e.launch_sizes(&o)[4];
    let bot = e.bot.pubkey();
    let b0 = lamports(&e.svm, &bot);
    let size = tx_size(&bot, &e.launch_ixs(&o, 1));
    assert!(size <= PACKET, "launch tx is {size} bytes");

    let meta = e.launch(&o);
    println!("launch tx: {size} bytes, {} CU, fee {}", meta.compute_units_consumed, meta.fee);

    let p = read_presale(&e.svm, &o.presale);
    assert_eq!((p.state, p.released, p.pot), (SETTLED, released, bot));
    let tokens = token_balance(&e.svm, &vault(&o.mint.pubkey()));
    assert!(tokens > 0);
    assert_eq!(p.total_tokens, tokens, "settle records what the vault holds");
    assert!(!exists(&e.svm, &pot_wsol(&e)), "pot wSOL closed");

    let pool = read_pool(&e.svm, &o.mint.pubkey());
    assert_eq!(pool.creator, o.fee_dest, "creator trading fees go to fee_dest");
    let fee = released - pool.quote_reserve;
    assert_eq!(fee, released.div_ceil(100), "the pot's buy paid the 1% floor");
    assert_eq!(pool.protocol_quote_fee + pool.partner_quote_fee + pool.creator_quote_fee, fee);
    assert_eq!(pool.partner_quote_fee, pool.creator_quote_fee, "Mooner and fee_dest split the trading fee");

    assert_eq!(lamports(&e.svm, &bot), b0 + LAUNCH_TX_FEE - meta.fee, "the bot is paid back its costs, no more");
    let reserve = p.seats_committed * (rent(&e.svm, vault_len) + TX_FEE);
    assert_eq!(lamports(&e.svm, &o.presale), rent(&e.svm, PRESALE_LEN) + reserve, "the presale keeps only the claim reserve");
}

#[test]
fn a_buy_after_the_pool_tx_misses_the_floor() {
    // why the pot's buy must share the pool's tx: a later buy pays the scheduler's fee
    let mut e = Env::new(false);
    let (u, mint) = (e.user(5), Keypair::new());
    let (cfg, m, up) = (dbc_config(), mint.pubkey(), u.pubkey());
    ok(send(&mut e.svm, &u, &[&mint], &[dbc_init_pool(&cfg, &up, &m, &up)]), "pool alone");
    let (w, t) = (ata(&up, &wsol(), &token_id()), ata(&up, &m, &token22_id()));
    let ixs = [
        ix_create_ata(&up, &up, &wsol(), &token_id()),
        ix_create_ata(&up, &up, &m, &token22_id()),
        ix_transfer(&up, &w, SOL),
        ix_sync_native(&w),
        dbc_swap2(&cfg, &m, &up, &w, &t, SOL, 1),
    ];
    ok(send(&mut e.svm, &u, &[], &ixs), "the next buy");
    let fee = SOL - read_pool(&e.svm, &m).quote_reserve;
    println!("next-tx buy fee: {fee} of {SOL} ({:.2}%)", fee as f64 * 100.0 / SOL as f64);
    // Mooner's config starts its fee scheduler at 99%
    assert!(fee > SOL * 9 / 10, "a later buy pays far more than the 1% floor");
}

#[test]
fn release_needs_the_pool_created_in_the_same_tx() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let mut ixs = e.launch_ixs(&o, 1);
    let init = ixs.remove(INIT);
    ok(try_launch(&mut e, &o, &[init], &[]), "pool made earlier");
    let bot = e.bot.insecure_clone();
    assert_err(send(&mut e.svm, &bot, &[], &ixs), E_BAD_LAUNCH_TX, "launch on a pool from an earlier tx");
}

#[test]
fn release_refuses_a_pool_on_another_dbc_config() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let other = Address::new_unique();
    let acc = e.svm.get_account(&dbc_config()).unwrap();
    e.svm.set_account(other, acc).unwrap();
    let mut ixs = e.launch_ixs(&o, 1);
    let bot = e.bot.pubkey();
    ixs[INIT] = dbc_init_pool(&other, &bot, &o.mint.pubkey(), &bot);
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_WRONG_DBC_CONFIG, "pool on a config Mooner doesn't own");
}

#[test]
fn release_needs_a_settle_later_in_the_tx() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let mut ixs = e.launch_ixs(&o, 1);
    ixs.remove(SETTLE);
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_BAD_LAUNCH_TX, "release without settle");
}

#[test]
fn only_the_bot_releases() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let stranger = e.user(1);
    let mut ixs = e.launch_ixs(&o, 1);
    ixs[RELEASE] = ix_release(&stranger.pubkey(), &o.presale, &e.bot.pubkey(), &o.mint.pubkey(), &dbc_config());
    assert_err(try_launch(&mut e, &o, &ixs, &[&stranger]), E_NOT_AUTHORIZED, "release by a stranger");
}

#[test]
fn release_waits_for_every_seat() {
    let mut e = Env::new(false);
    let (o, buyers) = e.open_full();
    e.settle_all(&o.presale, &buyers[..9]);
    let ixs = e.launch_ixs(&o, 1);
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_NOT_ALL_SETTLED, "one seat still in the ER");
}

#[test]
fn release_needs_the_presale_home() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let ixs = e.launch_ixs(&o, 1);
    fake_record(&mut e.svm, &o.presale);
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_NOT_HOME, "presale with a delegation record");
}

#[test]
fn the_pool_creator_fees_must_go_to_fee_dest() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let mut ixs = e.launch_ixs(&o, 1);
    ixs.remove(TPC);
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_NO_CREATOR_TRANSFER, "no transfer_pool_creator");

    let mut ixs = e.launch_ixs(&o, 1);
    let bot = e.bot.pubkey();
    ixs[TPC] = dbc_transfer_pool_creator(&dbc_config(), &o.mint.pubkey(), &bot, &Address::new_unique());
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_NO_CREATOR_TRANSFER, "creator fees to someone else");
}

#[test]
fn a_snipe_in_the_launch_tx_is_refused() {
    // a sniper's buy before the pot's would take the 1% floor
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let sniper = e.user(3);
    let (sp, m, cfg) = (sniper.pubkey(), o.mint.pubkey(), dbc_config());
    let s_wsol = ata(&sp, &wsol(), &token_id());
    let fund = [ix_create_ata(&sp, &sp, &wsol(), &token_id()), ix_transfer(&sp, &s_wsol, SOL), ix_sync_native(&s_wsol)];
    ok(send(&mut e.svm, &sniper, &[], &fund), "sniper wSOL");
    let mut ixs = e.launch_ixs(&o, 1);
    let snipe = [ix_create_ata(&sp, &sp, &m, &token22_id()), dbc_swap2(&cfg, &m, &sp, &s_wsol, &ata(&sp, &m, &token22_id()), SOL / 2, 1)];
    ixs.splice(INIT + 1..INIT + 1, snipe);
    assert_err(try_launch(&mut e, &o, &ixs, &[&sniper]), E_BAD_LAUNCH_TX, "a second buy in the launch tx");
}

#[test]
fn the_buy_spends_exactly_the_released_sol() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let released = e.expected_release(&o);
    let (bot, m, cfg, pw) = (e.bot.pubkey(), o.mint.pubkey(), dbc_config(), pot_wsol(&e));

    let mut ixs = e.launch_ixs(&o, 1);
    ixs[SWAP] = dbc_swap2(&cfg, &m, &bot, &pw, &vault(&m), released - 1, 1);
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_POT_NOT_EMPTY, "a lamport held back");

    // the bot tops up the pot and buys a lamport more: still not the released amount
    let mut ixs = e.launch_ixs(&o, 1);
    ixs[SWAP] = dbc_swap2(&cfg, &m, &bot, &pw, &vault(&m), released + 1, 1);
    ixs.insert(SYNC, ix_transfer(&bot, &pw, 1));
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_BAD_LAUNCH_TX, "a lamport added");
}

#[test]
fn the_buy_lands_in_the_presale_vault() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let released = e.expected_release(&o);
    let (bot, m, cfg) = (e.bot.pubkey(), o.mint.pubkey(), dbc_config());
    let mut ixs = e.launch_ixs(&o, 1);
    ixs[SWAP] = dbc_swap2(&cfg, &m, &bot, &pot_wsol(&e), &ata(&bot, &m, &token22_id()), released, 1);
    ixs.insert(INIT + 1, ix_create_ata(&bot, &bot, &m, &token22_id()));
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_BAD_LAUNCH_TX, "the pot's tokens sent to the bot");
}

#[test]
fn the_pot_buy_carries_no_referral() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let bot = e.bot.pubkey();
    let referrer = Address::new_unique();
    let mut ixs = e.launch_ixs(&o, 1);
    ixs[SWAP].accounts[12] = AccountMeta::new(ata(&referrer, &wsol(), &token_id()), false);
    ixs.insert(INIT + 1, ix_create_ata(&bot, &referrer, &wsol(), &token_id()));
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_BAD_LAUNCH_TX, "a referral skims the pot's buy");
}

#[test]
fn no_other_program_or_dbc_call_in_the_launch_tx() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let mut ixs = e.launch_ixs(&o, 1);
    ixs.insert(RELEASE + 1, ix_memo("hi"));
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_BAD_LAUNCH_TX, "a program outside the allowlist");

    let mut ixs = e.launch_ixs(&o, 1);
    ixs.push(Instruction { program_id: dbc_id(), accounts: vec![], data: CLAIM_CREATOR_TRADING_FEE.to_vec() });
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_BAD_LAUNCH_TX, "a DBC call outside the allowlist");
}

#[test]
fn settle_holds_the_min_tokens() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    let mut ixs = e.launch_ixs(&o, 1);
    ixs[SETTLE] = ix_settle(&o.presale, &e.bot.pubkey(), &o.mint.pubkey(), u64::MAX);
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_TOO_FEW_TOKENS, "fewer tokens than asked");
}

#[test]
#[allow(deprecated)]
fn the_pot_pays_at_most_the_cost_cap() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    // rent x4 pushes pool + vault rent past the cap
    let r: solana_rent::Rent = e.svm.get_sysvar();
    e.svm.set_sysvar(&solana_rent::Rent { lamports_per_byte_year: 4 * r.lamports_per_byte_year, ..r });
    let cost = LAUNCH_TX_FEE + e.launch_sizes(&o).iter().map(|l| rent(&e.svm, *l)).sum::<u64>();
    assert!(cost > LAUNCH_COST_CAP, "premise: cost {cost}");
    let ixs = e.launch_ixs(&o, 1);
    assert_err(try_launch(&mut e, &o, &ixs, &[]), E_COST_CAP, "launch costs over the cap");
}

#[test]
fn a_launched_presale_cannot_launch_again() {
    let mut e = Env::new(false);
    let o = ready(&mut e);
    e.launch(&o);
    let (bot, b) = (e.bot.insecure_clone(), e.bot.pubkey());
    let again = [ix_release(&b, &o.presale, &b, &o.mint.pubkey(), &dbc_config()), ix_settle(&o.presale, &b, &o.mint.pubkey(), 1)];
    assert_err(send(&mut e.svm, &bot, &[], &again), E_BAD_STATE, "second release");
    assert_err(send(&mut e.svm, &bot, &[], &again[1..]), E_BAD_STATE, "second settle");
}
