// Account layouts and decoders. Mirrors programs/presale/src/state.rs: change them together.
// Fixed byte offsets, little-endian. u64 fields decode to BigInt, i64 timestamps to Number.

import { PublicKey } from "@solana/web3.js";

// ---- Config ["config"] ----
export const CONFIG_LEN = 130;
export const CONFIG_VERSION = 1;
const C = { BUMP: 1, ADMIN: 2, GATE: 34, BOT: 66, DBC_CONFIG: 98 };

// ---- Presale ["presale", mint] ----
export const PRESALE_LEN = 272;
export const PRESALE_VERSION = 2;
export const P = {
  STATE: 1, BUMP: 2, CREATOR: 3, MINT: 35, FEE_DEST: 67, VALIDATOR: 99, POT: 131,
  OPENED_TS: 163, DEADLINE_TS: 171, FULL_TS: 179, RAISED: 187, SEATS_COMMITTED: 195,
  SEATS_SETTLED: 203, SEATS_REFUNDED: 211, RELEASED: 219, TOTAL_TOKENS: 227,
  CLAIMED_TOKENS: 235, CLAIMS_DONE: 243, FEES_PAID: 251, SETTLED_SUM: 259, SPARE: 267,
};

export const STATE = { OPEN: 0, FULL: 1, LAUNCHING: 2, SETTLED: 3, EXPIRED: 4, FAILED: 5 };
export const STATE_NAME = ["OPEN", "FULL", "LAUNCHING", "SETTLED", "EXPIRED", "FAILED"];

// ---- Seat ["seat", presale, user] ----
export const SEAT_LEN = 120;
export const SEAT_VERSION = 1;
export const S = { BUMP: 1, FLAGS: 2, USER: 3, SESSION_KEY: 35, PRESALE: 67, DEPOSIT: 99, COMMIT: 107, SPARE: 115 };
export const F_SETTLED = 1;
export const F_CLAIMED = 2;
export const F_CREATOR = 4;

const buf = (d) => (Buffer.isBuffer(d) ? d : Buffer.from(d));
const key = (d, o) => new PublicKey(d.subarray(o, o + 32));
const u64 = (d, o) => d.readBigUInt64LE(o);
const i64 = (d, o) => Number(d.readBigInt64LE(o));

function check(d, len, version, what) {
  if (d.length !== len || d[0] !== version) {
    throw new Error(`${what}: expected ${len} bytes version ${version}, got ${d.length} bytes version ${d[0]}`);
  }
}

export function decodeConfig(data) {
  const d = buf(data);
  check(d, CONFIG_LEN, CONFIG_VERSION, "Config");
  return {
    bump: d[C.BUMP],
    admin: key(d, C.ADMIN),
    gate: key(d, C.GATE),
    bot: key(d, C.BOT),
    dbcConfig: key(d, C.DBC_CONFIG),
  };
}

export function decodePresale(data) {
  const d = buf(data);
  check(d, PRESALE_LEN, PRESALE_VERSION, "Presale");
  return {
    state: d[P.STATE],
    bump: d[P.BUMP],
    creator: key(d, P.CREATOR),
    mint: key(d, P.MINT),
    feeDest: key(d, P.FEE_DEST),
    validator: key(d, P.VALIDATOR),
    pot: key(d, P.POT),
    openedTs: i64(d, P.OPENED_TS),
    deadlineTs: i64(d, P.DEADLINE_TS),
    fullTs: i64(d, P.FULL_TS),
    raised: u64(d, P.RAISED),
    seatsCommitted: u64(d, P.SEATS_COMMITTED),
    seatsSettled: u64(d, P.SEATS_SETTLED),
    seatsRefunded: u64(d, P.SEATS_REFUNDED),
    released: u64(d, P.RELEASED),
    totalTokens: u64(d, P.TOTAL_TOKENS),
    claimedTokens: u64(d, P.CLAIMED_TOKENS),
    claimsDone: u64(d, P.CLAIMS_DONE),
    feesPaid: u64(d, P.FEES_PAID),
    settledSum: u64(d, P.SETTLED_SUM),
  };
}

export function decodeSeat(data) {
  const d = buf(data);
  check(d, SEAT_LEN, SEAT_VERSION, "Seat");
  const flags = d[S.FLAGS];
  return {
    bump: d[S.BUMP],
    flags,
    settled: (flags & F_SETTLED) !== 0,
    creator: (flags & F_CREATOR) !== 0,
    user: key(d, S.USER),
    sessionKey: key(d, S.SESSION_KEY),
    presale: key(d, S.PRESALE),
    deposit: u64(d, S.DEPOSIT),
    commit: u64(d, S.COMMIT),
  };
}

/** Token amount of an SPL / Token-2022 account (the base layout: mint 0, owner 32, amount 64). */
export function tokenAmount(data) {
  return buf(data).readBigUInt64LE(64);
}
