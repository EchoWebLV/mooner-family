// Program ids, presale numbers, instruction tags and error codes.
// Mirrors programs/presale/src/consts.rs and error.rs: change them together.

import { PublicKey } from "@solana/web3.js";

const pk = (s) => new PublicKey(s);

export const SYSTEM = pk("11111111111111111111111111111111");
export const COMPUTE_BUDGET = pk("ComputeBudget111111111111111111111111111111");
export const TOKEN = pk("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN22 = pk("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM = pk("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const WSOL = pk("So11111111111111111111111111111111111111112");
export const DBC = pk("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
export const DELEGATION_PROGRAM = pk("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
export const MAGIC_PROGRAM = pk("Magic11111111111111111111111111111111111111");
export const MAGIC_CONTEXT = pk("MagicContext1111111111111111111111111111111");
export const BPF_UPGRADEABLE = pk("BPFLoaderUpgradeab1e11111111111111111111111");
export const IX_SYSVAR = pk("Sysvar1nstructions1111111111111111111111111");
export const MEMO = pk("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
// Lighthouse: the assertions Phantom and Solflare add to mainnet txs they sign (the tx
// fails if an account isn't what the wallet expected)
export const LIGHTHOUSE = pk("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");

// MagicBlock ER validators a Presale may be delegated to (the program pins the same list)
export const ER_VALIDATORS = [
  pk("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"), // as
  pk("MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e"), // eu
  pk("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd"), // us
];

// Mooner's DBC config on mainnet (dbc.js moonerConfigParams: the 3 s snipe tax, 1% floor
// for the first swap in the pool tx, 50/50 fees). scripts/mainnet.js creates it from
// engine/.mainnet/dbc-config-keypair.json. It replaced HnKg7Vb2… (a 60 s linear fee).
export const MOONER_DBC_CONFIG = pk("j7j5CfUSa9DGZCzKKxKBbCYvySiM14Hbr8V6uKbA6Be");
// the config's fee claimer and leftover receiver: Mooner's share of the trading fees
export const MOONER_FEE_CLAIMER = pk("4aieXRznxvzASx5EqiVZGNdv9vq77gcKmPUL6sruyuLq");

// Presale numbers. `canary` is `cargo build-sbf --features canary`, for devnet only.
const MAINNET = {
  TARGET: 500_000_000n, // 0.5 SOL, exact fill; 0.5 for testing since 2026-09-30, was 10 SOL
  MIN_SEAT: 100_000_000n,
  MAX_SEAT: 500_000_000n, // was 1 SOL; the creator's deposit is capped at TARGET - MIN_SEAT
  // (cosigner.js, flows.js openPresale) so at least one other seat always fits
  STEP: 10_000_000n,
  DURATION: 3_600, // seconds
  GRACE: 900,
};
const CANARY = {
  TARGET: 200_000_000n,
  MIN_SEAT: 10_000_000n,
  MAX_SEAT: 100_000_000n,
  STEP: 1_000_000n,
  DURATION: 120,
  GRACE: 60,
};
export const numbers = (canary) => (canary ? CANARY : MAINNET);

export const TX_FEE = 10_000n; // one crank tx, split across its same-tag ixs
export const LAUNCH_TX_FEE = 100_000n;
export const LAUNCH_COST_CAP = 50_000_000n;

export const IX = {
  INIT_CONFIG: 0,
  SET_CONFIG: 1,
  OPEN_PRESALE: 2,
  JOIN: 3,
  DELEGATE: 4,
  SETTLE_SEAT: 5,
  RELEASE: 6,
  SETTLE: 7,
  CLAIM: 8,
  FAIL: 9,
  CLOSE_PRESALE: 10,
  SET_COMMIT: 11,
  ROTATE_KEY: 12,
  LEAVE: 13,
  EXPIRE: 14,
  COMMIT_PRESALE: 15,
  COMMIT_SEATS: 16,
};

// error.rs, by code
export const ERRORS = [
  "BadState", "PastDeadline", "BeforeDeadline", "BadSeatSize", "OverDeposit",
  "CreatorCannotLower", "NoRoom", "NotAuthorized", "GateRequired", "NotHome",
  "NotAllSettled", "AlreadySettled", "NotSettled", "BadLaunchTx", "WrongDbcConfig",
  "NoCreatorTransfer", "CostCap", "BadAccount", "TooFewTokens", "SeatsOpen",
  "BeforeGrace", "CommitNotZero", "WrongPresale", "NothingReleased", "Overflow",
  "ZeroKey", "WrongValidator", "PotNotEmpty", "AlreadyExists", "BadData",
  "BuyMissedFloor",
];

/** Who raised a failure: { program, code } from the first `Program <id> failed: custom
 *  program error: 0x..` line in `logs` (a program Mooner calls fails before Mooner does,
 *  so the first is the innermost), or null. */
export function failedWith(logs) {
  const m = /Program (\w+) failed: custom program error: 0x([0-9a-f]+)/i.exec((logs ?? []).join("\n"));
  return m ? { program: m[1], code: parseInt(m[2], 16) } : null;
}

// the runtime's own words for these (solana-transaction-error lib.rs)
const RUNTIME = { AccountNotFound: "Attempt to debit an account but found no record of a prior credit.", InsufficientFundsForFee: "Insufficient funds for fee" };

/** `{InstructionError: [i, {Custom: n}]}` -> "ix i: Name (n)" only when `logs` say Mooner
 *  (`pid`) raised n: ix i being Mooner's isn't enough, a program it calls (System, Token,
 *  delegation) fails with codes of its own. Else "ix i (<who raised it>): custom n", with
 *  System's 1 as what it is. The runtime's errors in its words; anything else as JSON. */
export function describeTxError(err, programIds = [], pid = null, logs = []) {
  const ie = err?.InstructionError;
  if (ie && typeof ie[1] === "object" && "Custom" in ie[1]) {
    const [i, { Custom: n }] = ie;
    const f = failedWith(logs);
    if (pid && f?.program === pid.toBase58() && f.code === n) return `ix ${i}: ${ERRORS[n] ?? "unknown"} (${n})`;
    const by = f?.code === n ? f.program : (programIds[i]?.toBase58() ?? "?");
    // System's ResultWithNegativeLamports: "Transfer: insufficient lamports X, need Y"
    return `ix ${i} (${by}): ${by === SYSTEM.toBase58() && n === 1 ? "insufficient lamports (custom 1)" : `custom ${n}`}`;
  }
  if (Object.hasOwn(RUNTIME, err)) return RUNTIME[err];
  const rent = err?.InsufficientFundsForRent;
  if (rent) return `Transaction results in an account (${rent.account_index}) with insufficient funds for rent`;
  return JSON.stringify(err);
}
