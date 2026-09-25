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

// Mooner's DBC config on mainnet (1% floor for the first swap in the pool tx, 50/50 fees)
export const MOONER_DBC_CONFIG = pk("HnKg7Vb2aHPhX8LVy4gMXZ6dACGPHUPFkQeX82FB8LmF");

// Presale numbers. `canary` is `cargo build-sbf --features canary`, for devnet only.
const MAINNET = {
  TARGET: 10_000_000_000n, // 10 SOL, exact fill
  MIN_SEAT: 100_000_000n,
  MAX_SEAT: 1_000_000_000n,
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
];

/** `{InstructionError: [i, {Custom: n}]}` -> "ix i: Name (n)" when ix i is ours
 *  (`programIds[i]` equals `pid`); anything else as JSON. */
export function describeTxError(err, programIds = [], pid = null) {
  const ie = err?.InstructionError;
  if (ie && typeof ie[1] === "object" && "Custom" in ie[1]) {
    const [i, { Custom: n }] = ie;
    const ours = pid && programIds[i]?.equals(pid);
    return ours ? `ix ${i}: ${ERRORS[n] ?? "unknown"} (${n})` : `ix ${i} (${programIds[i]?.toBase58() ?? "?"}): custom ${n}`;
  }
  return JSON.stringify(err);
}
