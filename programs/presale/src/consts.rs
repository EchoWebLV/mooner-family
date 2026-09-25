//! Numbers, program ids, discriminators and instruction tags.

use solana_program::{pubkey, pubkey::Pubkey};

// ---- presale numbers (spec "Numbers") ----
#[cfg(not(feature = "canary"))]
mod numbers {
    pub const TARGET: u64 = 10_000_000_000; // 10 SOL, exact fill
    pub const MIN_SEAT: u64 = 100_000_000; // 0.1 SOL
    pub const MAX_SEAT: u64 = 1_000_000_000; // 1 SOL
    pub const STEP: u64 = 10_000_000; // 0.01 SOL
    pub const DURATION: i64 = 3_600; // 1 hour
    pub const GRACE: i64 = 900; // FULL -> FAILED if no launch by then
}
// devnet canary build only: same program, amounts a devnet faucet can fund
#[cfg(feature = "canary")]
mod numbers {
    pub const TARGET: u64 = 200_000_000;
    pub const MIN_SEAT: u64 = 10_000_000;
    pub const MAX_SEAT: u64 = 100_000_000;
    pub const STEP: u64 = 1_000_000;
    pub const DURATION: i64 = 120;
    pub const GRACE: i64 = 60;
}
pub use numbers::*;

pub const TX_FEE: u64 = 10_000; // allowance for one crank tx, split across its same-tag ixs
pub const LAUNCH_TX_FEE: u64 = 100_000; // mainnet launch measured 95_000
pub const LAUNCH_COST_CAP: u64 = 50_000_000; // hard ceiling on what the pot reimburses

// ---- seeds ----
pub const CONFIG_SEED: &[u8] = b"config";
pub const PRESALE_SEED: &[u8] = b"presale";
pub const SEAT_SEED: &[u8] = b"seat";
pub const DELEGATION_RECORD_SEED: &[u8] = b"delegation";

// ---- programs ----
pub const SYSTEM: Pubkey = pubkey!("11111111111111111111111111111111");
pub const COMPUTE_BUDGET: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
pub const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN22: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ATA_PROGRAM: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const DBC: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
pub const DELEGATION_PROGRAM: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
pub const BPF_UPGRADEABLE: Pubkey = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

// ---- Meteora DBC anchor discriminators, sha256("global:<name>")[..8] (IDL v0.1.10) ----
pub const SWAP2_DISC: [u8; 8] = [65, 75, 63, 76, 235, 91, 91, 136];
pub const SWAP_DISCS: [[u8; 8]; 3] = [
    [248, 198, 158, 145, 225, 117, 135, 200], // swap
    SWAP2_DISC,
    [183, 93, 153, 40, 24, 230, 194, 151], // swap2_with_transfer_hook
];
pub const INIT_POOL_DISCS: [[u8; 8]; 3] = [
    [140, 85, 215, 176, 102, 54, 104, 79],  // initialize_virtual_pool_with_spl_token
    [169, 118, 51, 78, 145, 110, 220, 155], // initialize_virtual_pool_with_token2022
    [182, 13, 233, 177, 42, 145, 135, 2],   // initialize_virtual_pool_with_token2022_transfer_hook
];
pub const TRANSFER_POOL_CREATOR_DISC: [u8; 8] = [20, 7, 169, 33, 58, 147, 166, 33];

// MagicBlock undelegate callback, sent by the delegation program
pub const UNDELEGATE_CALLBACK: [u8; 8] = [196, 28, 41, 206, 48, 37, 51, 167];

// ---- instruction tags (first data byte) ----
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
