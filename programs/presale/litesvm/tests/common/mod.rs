//! Shared harness: ids, PDAs, a builder per instruction, state decoders, the real DBC
//! program from mainnet fixtures, and a fake MagicBlock delegation.
//!
//! The ER isn't in litesvm. An ER instruction runs here as a plain program ix on accounts
//! this program owns (MagicPad precedent). "Delegated" is faked with `fake_delegate`:
//! owner = the delegation program and a non-empty delegation record, which is exactly
//! what the home guard and `snapshot` read on Solana.
#![allow(dead_code)]

use base64::Engine;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

pub mod flow;
pub use flow::Env;

pub const SO_PATH: &str = "../target/deploy/mooner_presale.so";
pub const DBC_SO: &str = "fixtures/dbc.so";
pub const SOL: u64 = 1_000_000_000;

// ---- program numbers (mirror consts.rs, mainnet build) ----
pub const TARGET: u64 = 10_000_000_000;
pub const MIN_SEAT: u64 = 100_000_000;
pub const MAX_SEAT: u64 = 1_000_000_000;
pub const STEP: u64 = 10_000_000;
pub const DURATION: i64 = 3_600;
pub const GRACE: i64 = 900;
pub const TX_FEE: u64 = 10_000;
pub const LAUNCH_TX_FEE: u64 = 100_000;
pub const LAUNCH_COST_CAP: u64 = 50_000_000;

// ---- tags ----
pub const IX_INIT_CONFIG: u8 = 0;
pub const IX_SET_CONFIG: u8 = 1;
pub const IX_OPEN_PRESALE: u8 = 2;
pub const IX_JOIN: u8 = 3;
pub const IX_DELEGATE: u8 = 4;
pub const IX_SETTLE_SEAT: u8 = 5;
pub const IX_RELEASE: u8 = 6;
pub const IX_SETTLE: u8 = 7;
pub const IX_CLAIM: u8 = 8;
pub const IX_FAIL: u8 = 9;
pub const IX_CLOSE_PRESALE: u8 = 10;
pub const IX_SET_COMMIT: u8 = 11;
pub const IX_ROTATE_KEY: u8 = 12;
pub const IX_LEAVE: u8 = 13;
pub const IX_EXPIRE: u8 = 14;
pub const IX_COMMIT_PRESALE: u8 = 15;
pub const IX_COMMIT_SEATS: u8 = 16;

// ---- error codes (error.rs, append only) ----
pub const E_BAD_STATE: u32 = 0;
pub const E_PAST_DEADLINE: u32 = 1;
pub const E_BEFORE_DEADLINE: u32 = 2;
pub const E_BAD_SEAT_SIZE: u32 = 3;
pub const E_OVER_DEPOSIT: u32 = 4;
pub const E_CREATOR_CANNOT_LOWER: u32 = 5;
pub const E_NO_ROOM: u32 = 6;
pub const E_NOT_AUTHORIZED: u32 = 7;
pub const E_GATE_REQUIRED: u32 = 8;
pub const E_NOT_HOME: u32 = 9;
pub const E_NOT_ALL_SETTLED: u32 = 10;
pub const E_ALREADY_SETTLED: u32 = 11;
pub const E_NOT_SETTLED: u32 = 12;
pub const E_BAD_LAUNCH_TX: u32 = 13;
pub const E_WRONG_DBC_CONFIG: u32 = 14;
pub const E_NO_CREATOR_TRANSFER: u32 = 15;
pub const E_COST_CAP: u32 = 16;
pub const E_BAD_ACCOUNT: u32 = 17;
pub const E_TOO_FEW_TOKENS: u32 = 18;
pub const E_SEATS_OPEN: u32 = 19;
pub const E_BEFORE_GRACE: u32 = 20;
pub const E_COMMIT_NOT_ZERO: u32 = 21;
pub const E_WRONG_PRESALE: u32 = 22;
pub const E_NOTHING_RELEASED: u32 = 23;
pub const E_OVERFLOW: u32 = 24;
pub const E_ZERO_KEY: u32 = 25;
pub const E_WRONG_VALIDATOR: u32 = 26;
pub const E_POT_NOT_EMPTY: u32 = 27;
pub const E_ALREADY_EXISTS: u32 = 28;
pub const E_BAD_DATA: u32 = 29;
pub const E_BUY_MISSED_FLOOR: u32 = 30;

// ---- states and flags ----
pub const OPEN: u8 = 0;
pub const FULL: u8 = 1;
pub const LAUNCHING: u8 = 2;
pub const SETTLED: u8 = 3;
pub const EXPIRED: u8 = 4;
pub const FAILED: u8 = 5;
pub const F_SETTLED: u8 = 1;
pub const F_CLAIMED: u8 = 2;
pub const F_CREATOR: u8 = 4;

pub const CONFIG_LEN: usize = 130;
pub const PRESALE_LEN: usize = 272;
pub const SEAT_LEN: usize = 120;

// ---- ids ----
pub fn program_id() -> Address {
    Address::new_from_array([0x11; 32])
}
pub fn addr(s: &str) -> Address {
    s.parse().unwrap()
}
pub fn system_id() -> Address {
    addr("11111111111111111111111111111111")
}
pub fn compute_budget_id() -> Address {
    addr("ComputeBudget111111111111111111111111111111")
}
pub fn token_id() -> Address {
    addr("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
}
pub fn token22_id() -> Address {
    addr("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
}
pub fn ata_program_id() -> Address {
    addr("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
}
pub fn wsol() -> Address {
    addr("So11111111111111111111111111111111111111112")
}
pub fn dbc_id() -> Address {
    addr("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN")
}
pub fn dbc_config() -> Address {
    addr("HnKg7Vb2aHPhX8LVy4gMXZ6dACGPHUPFkQeX82FB8LmF")
}
pub fn dlp_id() -> Address {
    addr("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh")
}
pub fn bpf_upgradeable_id() -> Address {
    addr("BPFLoaderUpgradeab1e11111111111111111111111")
}
pub fn ix_sysvar_id() -> Address {
    addr("Sysvar1nstructions1111111111111111111111111")
}
pub fn memo_id() -> Address {
    addr("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
}
/// The MagicBlock ER validators the program accepts (consts::ER_VALIDATORS).
pub fn er_validator() -> Address {
    addr("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57")
}
pub fn magic_program_id() -> Address {
    addr("Magic11111111111111111111111111111111111111")
}
pub fn magic_context_id() -> Address {
    addr("MagicContext1111111111111111111111111111111")
}

// ---- PDAs ----
fn pda(seeds: &[&[u8]], program: &Address) -> Address {
    Address::find_program_address(seeds, program).0
}
pub fn config_pda() -> Address {
    pda(&[b"config"], &program_id())
}
pub fn presale_pda(mint: &Address) -> Address {
    pda(&[b"presale", mint.as_ref()], &program_id())
}
pub fn seat_pda(presale: &Address, user: &Address) -> Address {
    pda(&[b"seat", presale.as_ref(), user.as_ref()], &program_id())
}
pub fn record_pda(acc: &Address) -> Address {
    pda(&[b"delegation", acc.as_ref()], &dlp_id())
}
pub fn metadata_pda(acc: &Address) -> Address {
    pda(&[b"delegation-metadata", acc.as_ref()], &dlp_id())
}
pub fn buffer_pda(acc: &Address) -> Address {
    pda(&[b"buffer", acc.as_ref()], &program_id())
}
pub fn program_data_pda() -> Address {
    pda(&[program_id().as_ref()], &bpf_upgradeable_id())
}
pub fn ata(owner: &Address, mint: &Address, token_program: &Address) -> Address {
    pda(&[owner.as_ref(), token_program.as_ref(), mint.as_ref()], &ata_program_id())
}
pub fn vault(mint: &Address) -> Address {
    ata(&presale_pda(mint), mint, &token22_id())
}
pub fn pool_authority() -> Address {
    pda(&[b"pool_authority"], &dbc_id())
}
pub fn event_authority() -> Address {
    pda(&[b"__event_authority"], &dbc_id())
}
/// (pool, base_vault, quote_vault) for a mint on a DBC config.
pub fn pool_addresses(config: &Address, mint: &Address) -> (Address, Address, Address) {
    let w = wsol();
    let (hi, lo) = if mint.as_ref() > w.as_ref() { (mint, &w) } else { (&w, mint) };
    let pool = pda(&[b"pool", config.as_ref(), hi.as_ref(), lo.as_ref()], &dbc_id());
    let base = pda(&[b"token_vault", mint.as_ref(), pool.as_ref()], &dbc_id());
    let quote = pda(&[b"token_vault", w.as_ref(), pool.as_ref()], &dbc_id());
    (pool, base, quote)
}

// ---- svm ----
fn load_account_json(svm: &mut LiteSVM, path: &str) {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let a = &v["account"];
    let data = base64::engine::general_purpose::STANDARD.decode(a["data"][0].as_str().unwrap()).unwrap();
    svm.set_account(
        addr(v["pubkey"].as_str().unwrap()),
        Account {
            lamports: a["lamports"].as_u64().unwrap(),
            data,
            owner: addr(a["owner"].as_str().unwrap()),
            executable: a["executable"].as_bool().unwrap(),
            rent_epoch: 0,
        },
    )
    .unwrap();
}

/// Our program (with `upgrade_authority` written into ProgramData: litesvm writes None),
/// the mainnet DBC program, Mooner's DBC config and the wSOL mint.
pub fn fresh_svm(upgrade_authority: &Address) -> LiteSVM {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(program_id(), SO_PATH)
        .expect("build the program first: cargo build-sbf in programs/presale");
    let pd = program_data_pda();
    let mut acc = svm.get_account(&pd).unwrap();
    // UpgradeableLoaderState::ProgramData: u32 tag 3, u64 slot, Option<Pubkey>
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(upgrade_authority.as_ref());
    svm.set_account(pd, acc).unwrap();
    svm.add_program_from_file(dbc_id(), DBC_SO).expect("run fixtures/fetch.sh first");
    load_account_json(&mut svm, "fixtures/dbc-config.json");
    load_account_json(&mut svm, "fixtures/wsol-mint.json");
    warp_to(&mut svm, 1_800_000_000);
    svm
}

pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    extra_signers: &[&Keypair],
    ixs: &[Instruction],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    svm.expire_blockhash();
    let msg = Message::new(ixs, Some(&payer.pubkey()));
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra_signers);
    let tx = Transaction::new(&signers, msg, svm.latest_blockhash());
    svm.send_transaction(tx)
}

/// Wire size of a legacy tx (litesvm doesn't enforce the 1232-byte packet limit).
pub fn tx_size(payer: &Address, ixs: &[Instruction]) -> usize {
    let msg = Message::new(ixs, Some(payer));
    1 + 64 * msg.header.num_required_signatures as usize + msg.serialize().len()
}

/// The tx failed with our custom error `code`.
pub fn assert_err<T: std::fmt::Debug>(res: Result<T, FailedTransactionMetadata>, code: u32, what: &str) {
    let err = res.expect_err(&format!("{what}: expected failure"));
    let s = format!("{:?}", err.err);
    assert!(s.contains(&format!("Custom({code})")), "{what}: expected Custom({code}), got {s}\n{:#?}", err.meta.logs);
}

/// The tx failed, with any error (for runtime-level rejections like a missing signer).
pub fn assert_fails<T: std::fmt::Debug>(res: Result<T, FailedTransactionMetadata>, what: &str) {
    res.expect_err(&format!("{what}: expected failure"));
}

pub fn ok(res: Result<TransactionMetadata, FailedTransactionMetadata>, what: &str) -> TransactionMetadata {
    match res {
        Ok(m) => m,
        Err(e) => panic!("{what}: {:?}\n{:#?}", e.err, e.meta.logs),
    }
}

pub fn warp_to(svm: &mut LiteSVM, unix_ts: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_ts;
    clock.slot += 1;
    svm.set_sysvar(&clock);
}
pub fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}
pub fn lamports(svm: &LiteSVM, a: &Address) -> u64 {
    svm.get_account(a).map(|x| x.lamports).unwrap_or(0)
}
pub fn exists(svm: &LiteSVM, a: &Address) -> bool {
    svm.get_account(a).is_some_and(|x| x.lamports > 0)
}
pub fn rent(svm: &LiteSVM, len: usize) -> u64 {
    svm.minimum_balance_for_rent_exemption(len)
}
pub fn funded(svm: &mut LiteSVM, sol: u64) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), sol).unwrap();
    k
}
/// (mint, owner, amount) of a token account.
pub fn token_balance(svm: &LiteSVM, a: &Address) -> u64 {
    svm.get_account(a).map(|x| u64_at(&x.data, 64)).unwrap_or(0)
}

// ---- fake MagicBlock delegation ----
pub fn fake_delegate(svm: &mut LiteSVM, a: &Address) {
    let mut acc = svm.get_account(a).unwrap();
    acc.owner = dlp_id();
    svm.set_account(*a, acc).unwrap();
    let rec = Account { lamports: rent(svm, 96), data: vec![1; 96], owner: dlp_id(), executable: false, rent_epoch: 0 };
    svm.set_account(record_pda(a), rec).unwrap();
}
pub fn fake_undelegate(svm: &mut LiteSVM, a: &Address) {
    let mut acc = svm.get_account(a).unwrap();
    acc.owner = program_id();
    svm.set_account(*a, acc).unwrap();
    let gone = Account { lamports: 0, data: vec![], owner: system_id(), executable: false, rent_epoch: 0 };
    svm.set_account(record_pda(a), gone).unwrap();
}
/// Only the record, owner unchanged: how a delegated account looks from inside the ER.
pub fn fake_record(svm: &mut LiteSVM, a: &Address) {
    let rec = Account { lamports: rent(svm, 96), data: vec![1; 96], owner: dlp_id(), executable: false, rent_epoch: 0 };
    svm.set_account(record_pda(a), rec).unwrap();
}

// ---- bytes ----
pub fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
pub fn i64_at(d: &[u8], o: usize) -> i64 {
    i64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
pub fn key_at(d: &[u8], o: usize) -> Address {
    Address::new_from_array(d[o..o + 32].try_into().unwrap())
}

// ---- decoders (offsets mirror state.rs) ----
#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub gate: Address,
    pub bot: Address,
    pub dbc_config: Address,
}
pub fn read_config(svm: &LiteSVM) -> Config {
    let d = svm.get_account(&config_pda()).unwrap().data;
    Config { admin: key_at(&d, 2), gate: key_at(&d, 34), bot: key_at(&d, 66), dbc_config: key_at(&d, 98) }
}

#[derive(Debug, Clone)]
pub struct Presale {
    pub state: u8,
    pub creator: Address,
    pub mint: Address,
    pub fee_dest: Address,
    pub validator: Address,
    pub pot: Address,
    pub opened_ts: i64,
    pub deadline_ts: i64,
    pub full_ts: i64,
    pub raised: u64,
    pub seats_committed: u64,
    pub seats_settled: u64,
    pub seats_refunded: u64,
    pub released: u64,
    pub total_tokens: u64,
    pub claimed_tokens: u64,
    pub claims_done: u64,
    pub fees_paid: u64,
    pub settled_sum: u64,
}
pub fn read_presale(svm: &LiteSVM, a: &Address) -> Presale {
    let d = svm.get_account(a).unwrap().data;
    Presale {
        state: d[1],
        creator: key_at(&d, 3),
        mint: key_at(&d, 35),
        fee_dest: key_at(&d, 67),
        validator: key_at(&d, 99),
        pot: key_at(&d, 131),
        opened_ts: i64_at(&d, 163),
        deadline_ts: i64_at(&d, 171),
        full_ts: i64_at(&d, 179),
        raised: u64_at(&d, 187),
        seats_committed: u64_at(&d, 195),
        seats_settled: u64_at(&d, 203),
        seats_refunded: u64_at(&d, 211),
        released: u64_at(&d, 219),
        total_tokens: u64_at(&d, 227),
        claimed_tokens: u64_at(&d, 235),
        claims_done: u64_at(&d, 243),
        fees_paid: u64_at(&d, 251),
        settled_sum: u64_at(&d, 259),
    }
}

#[derive(Debug, Clone)]
pub struct Seat {
    pub flags: u8,
    pub user: Address,
    pub session_key: Address,
    pub presale: Address,
    pub deposit: u64,
    pub commit: u64,
}
pub fn read_seat(svm: &LiteSVM, a: &Address) -> Seat {
    let d = svm.get_account(a).unwrap().data;
    Seat {
        flags: d[2],
        user: key_at(&d, 3),
        session_key: key_at(&d, 35),
        presale: key_at(&d, 67),
        deposit: u64_at(&d, 99),
        commit: u64_at(&d, 107),
    }
}

// ---- our instructions ----
fn ix(tag: u8, data: &[u8], accounts: Vec<AccountMeta>) -> Instruction {
    let mut d = vec![tag];
    d.extend_from_slice(data);
    Instruction { program_id: program_id(), accounts, data: d }
}
fn w(a: Address) -> AccountMeta {
    AccountMeta::new(a, false)
}
fn r(a: Address) -> AccountMeta {
    AccountMeta::new_readonly(a, false)
}
fn ws(a: Address) -> AccountMeta {
    AccountMeta::new(a, true)
}
fn rs(a: Address) -> AccountMeta {
    AccountMeta::new_readonly(a, true)
}
/// A signer meta only when the key really signs (the gate may be absent).
fn maybe_signer(a: Address, signs: bool) -> AccountMeta {
    AccountMeta::new_readonly(a, signs)
}
fn keys(ks: &[&Address]) -> Vec<u8> {
    ks.iter().flat_map(|k| k.as_ref().to_vec()).collect()
}

pub fn ix_init_config(authority: &Address, admin: &Address, gate: &Address, bot: &Address, dbc: &Address) -> Instruction {
    ix(IX_INIT_CONFIG, &keys(&[admin, gate, bot, dbc]), vec![
        ws(*authority), w(config_pda()), r(program_data_pda()), r(system_id()),
    ])
}
pub fn ix_set_config(signer: &Address, admin: &Address, gate: &Address, bot: &Address, dbc: &Address) -> Instruction {
    ix(IX_SET_CONFIG, &keys(&[admin, gate, bot, dbc]), vec![rs(*signer), w(config_pda())])
}

/// `gate` = (key, signs). Pass the real gate key with signs=false to test a missing co-sign.
pub fn ix_open_presale(
    creator: &Address,
    gate: (Address, bool),
    mint: &Address,
    fee_dest: &Address,
    session: &Address,
    deposit: u64,
    commit: u64,
) -> Instruction {
    let presale = presale_pda(mint);
    let mut d = keys(&[fee_dest, session]);
    d.extend_from_slice(&deposit.to_le_bytes());
    d.extend_from_slice(&commit.to_le_bytes());
    ix(IX_OPEN_PRESALE, &d, vec![
        ws(*creator), maybe_signer(gate.0, gate.1), r(config_pda()), rs(*mint),
        w(presale), w(seat_pda(&presale, creator)), r(system_id()),
    ])
}

pub fn ix_join(user: &Address, gate: (Address, bool), presale: &Address, session: &Address, deposit: u64) -> Instruction {
    let mut d = keys(&[session]);
    d.extend_from_slice(&deposit.to_le_bytes());
    ix(IX_JOIN, &d, vec![
        ws(*user), maybe_signer(gate.0, gate.1), r(config_pda()), r(*presale),
        w(seat_pda(presale, user)), r(system_id()),
    ])
}

/// kind 0 = the Presale, 1 = a Seat (pass its presale).
pub fn ix_delegate(payer: &Address, target: &Address, validator: &Address, kind: u8, presale: Option<&Address>) -> Instruction {
    let mut a = vec![
        ws(*payer), w(*target), r(program_id()), w(buffer_pda(target)), w(record_pda(target)),
        w(metadata_pda(target)), r(dlp_id()), r(system_id()), r(*validator),
    ];
    if let Some(p) = presale {
        a.push(r(*p));
    }
    ix(IX_DELEGATE, &[kind], a)
}

pub fn ix_settle_seat(cranker: &Address, seat: &Address, user: &Address, presale: &Address) -> Instruction {
    ix(IX_SETTLE_SEAT, &[], vec![
        ws(*cranker), w(*seat), r(record_pda(seat)), w(*user), w(*presale), r(record_pda(presale)), r(ix_sysvar_id()),
    ])
}

pub fn ix_release(bot: &Address, presale: &Address, pot: &Address, mint: &Address, dbc: &Address) -> Instruction {
    let (pool, base, quote) = pool_addresses(dbc, mint);
    ix(IX_RELEASE, &[], vec![
        ws(*bot), r(config_pda()), w(*presale), r(record_pda(presale)), r(*pot),
        w(ata(pot, &wsol(), &token_id())), r(*mint), r(pool), r(base), r(quote), r(vault(mint)), r(ix_sysvar_id()),
    ])
}

pub fn ix_settle(presale: &Address, pot: &Address, mint: &Address, min_tokens: u64) -> Instruction {
    let (pool, _, _) = pool_addresses(&dbc_config(), mint);
    ix(IX_SETTLE, &min_tokens.to_le_bytes(), vec![
        w(*presale), r(config_pda()), r(vault(mint)), r(ata(pot, &wsol(), &token_id())), r(ix_sysvar_id()), r(pool),
    ])
}

pub fn ix_claim(cranker: &Address, presale: &Address, user: &Address, mint: &Address) -> Instruction {
    ix(IX_CLAIM, &[], vec![
        ws(*cranker), w(*presale), w(seat_pda(presale, user)), w(*user), w(vault(mint)),
        w(ata(user, mint, &token22_id())), r(*mint), r(token22_id()), r(ata_program_id()), r(system_id()), r(ix_sysvar_id()),
        r(memo_id()),
    ])
}

pub fn ix_fail(presale: &Address) -> Instruction {
    ix(IX_FAIL, &[], vec![w(*presale), r(record_pda(presale))])
}

pub fn ix_close_presale(presale: &Address, creator: &Address, mint: &Address) -> Instruction {
    ix(IX_CLOSE_PRESALE, &[], vec![
        w(*presale), r(record_pda(presale)), w(*creator), w(vault(mint)), w(*mint), r(token22_id()),
    ])
}

pub fn ix_set_commit(signer: &Address, seat: &Address, presale: &Address, amount: u64) -> Instruction {
    ix(IX_SET_COMMIT, &amount.to_le_bytes(), vec![rs(*signer), w(*seat), w(*presale)])
}

pub fn ix_rotate_key(user: &Address, seat: &Address, key: &Address) -> Instruction {
    ix(IX_ROTATE_KEY, key.as_ref(), vec![rs(*user), w(*seat)])
}

pub fn ix_leave(payer: &Address, seat: &Address) -> Instruction {
    ix(IX_LEAVE, &[], vec![ws(*payer), w(*seat), r(magic_program_id()), w(magic_context_id())])
}

pub fn ix_expire(presale: &Address) -> Instruction {
    ix(IX_EXPIRE, &[], vec![w(*presale)])
}

pub fn ix_commit_presale(payer: &Address, presale: &Address) -> Instruction {
    ix(IX_COMMIT_PRESALE, &[], vec![ws(*payer), w(*presale), r(magic_program_id()), w(magic_context_id())])
}

pub fn ix_commit_seats(payer: &Address, presale: &Address, seats: &[Address]) -> Instruction {
    let mut a = vec![ws(*payer), r(*presale), r(magic_program_id()), w(magic_context_id())];
    a.extend(seats.iter().map(|s| w(*s)));
    ix(IX_COMMIT_SEATS, &[], a)
}

// ---- other programs ----
pub fn ix_compute_limit(units: u32) -> Instruction {
    let mut d = vec![2u8];
    d.extend_from_slice(&units.to_le_bytes());
    Instruction { program_id: compute_budget_id(), accounts: vec![], data: d }
}
pub fn ix_create_ata(payer: &Address, owner: &Address, mint: &Address, token_program: &Address) -> Instruction {
    Instruction {
        program_id: ata_program_id(),
        accounts: vec![
            ws(*payer), w(ata(owner, mint, token_program)), r(*owner), r(*mint), r(system_id()), r(*token_program),
        ],
        data: vec![1], // CreateIdempotent
    }
}
pub fn ix_sync_native(account: &Address) -> Instruction {
    Instruction { program_id: token_id(), accounts: vec![w(*account)], data: vec![17] }
}
pub fn ix_close_account(account: &Address, dest: &Address, owner: &Address) -> Instruction {
    Instruction { program_id: token_id(), accounts: vec![w(*account), w(*dest), rs(*owner)], data: vec![9] }
}
pub fn ix_memo(text: &str) -> Instruction {
    Instruction { program_id: memo_id(), accounts: vec![], data: text.as_bytes().to_vec() }
}
pub fn ix_transfer(from: &Address, to: &Address, lamports: u64) -> Instruction {
    let mut d = 2u32.to_le_bytes().to_vec();
    d.extend_from_slice(&lamports.to_le_bytes());
    Instruction { program_id: system_id(), accounts: vec![ws(*from), w(*to)], data: d }
}

// ---- DBC (IDL v0.1.10) ----
pub const DBC_INIT_POOL_T22: [u8; 8] = [169, 118, 51, 78, 145, 110, 220, 155];
pub const DBC_SWAP: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];
pub const DBC_SWAP2: [u8; 8] = [65, 75, 63, 76, 235, 91, 91, 136];
pub const DBC_TPC: [u8; 8] = [20, 7, 169, 33, 58, 147, 166, 33];

fn borsh_str(d: &mut Vec<u8>, s: &str) {
    d.extend_from_slice(&(s.len() as u32).to_le_bytes());
    d.extend_from_slice(s.as_bytes());
}

pub fn dbc_init_pool(config: &Address, creator: &Address, mint: &Address, payer: &Address) -> Instruction {
    let (pool, base, quote) = pool_addresses(config, mint);
    let mut d = DBC_INIT_POOL_T22.to_vec();
    borsh_str(&mut d, "Mooner Test");
    borsh_str(&mut d, "MOONT");
    borsh_str(&mut d, "https://example.com/m.json");
    Instruction {
        program_id: dbc_id(),
        accounts: vec![
            r(*config), r(pool_authority()), rs(*creator), ws(*mint), r(wsol()), w(pool), w(base), w(quote),
            ws(*payer), r(token_id()), r(token22_id()), r(system_id()), r(event_authority()), r(dbc_id()),
        ],
        data: d,
    }
}

/// swap2 exact-in (mode 0), wSOL -> token, referral none, the ix sysvar appended so the
/// first swap in the pool-creating tx gets the floor fee.
pub fn dbc_swap2(config: &Address, mint: &Address, payer: &Address, input: &Address, output: &Address, amount_in: u64, min_out: u64) -> Instruction {
    let (pool, base, quote) = pool_addresses(config, mint);
    let mut d = DBC_SWAP2.to_vec();
    d.extend_from_slice(&amount_in.to_le_bytes());
    d.extend_from_slice(&min_out.to_le_bytes());
    d.push(0);
    Instruction {
        program_id: dbc_id(),
        accounts: vec![
            r(pool_authority()), r(*config), w(pool), w(*input), w(*output), w(base), w(quote), r(*mint), r(wsol()),
            rs(*payer), r(token22_id()), r(token_id()), r(dbc_id()), r(event_authority()), r(dbc_id()), r(ix_sysvar_id()),
        ],
        data: d,
    }
}

pub fn dbc_transfer_pool_creator(config: &Address, mint: &Address, creator: &Address, new_creator: &Address) -> Instruction {
    let (pool, _, _) = pool_addresses(config, mint);
    Instruction {
        program_id: dbc_id(),
        accounts: vec![w(pool), r(*config), rs(*creator), r(*new_creator), r(event_authority()), r(dbc_id())],
        data: DBC_TPC.to_vec(),
    }
}
