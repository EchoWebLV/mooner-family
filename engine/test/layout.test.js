import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import {
  CONFIG_LEN, P, PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, decodePresale, decodeSeat,
} from "../src/layout.js";

// field sizes in state.rs order; each offset must follow the previous field
const PRESALE_FIELDS = [
  ["STATE", 1], ["BUMP", 1], ["CREATOR", 32], ["MINT", 32], ["FEE_DEST", 32], ["VALIDATOR", 32], ["POT", 32],
  ["OPENED_TS", 8], ["DEADLINE_TS", 8], ["FULL_TS", 8], ["RAISED", 8], ["SEATS_COMMITTED", 8],
  ["SEATS_SETTLED", 8], ["SEATS_REFUNDED", 8], ["RELEASED", 8], ["TOTAL_TOKENS", 8], ["CLAIMED_TOKENS", 8],
  ["CLAIMS_DONE", 8], ["FEES_PAID", 8], ["SETTLED_SUM", 8], ["SPARE", 5],
];
const SEAT_FIELDS = [
  ["BUMP", 1], ["FLAGS", 1], ["USER", 32], ["SESSION_KEY", 32], ["PRESALE", 32], ["DEPOSIT", 8], ["COMMIT", 8], ["SPARE", 5],
];

function packed(offsets, fields, len) {
  let o = 1; // byte 0 is the version
  for (const [name, size] of fields) {
    assert.equal(offsets[name], o, `${name} offset`);
    o += size;
  }
  assert.equal(o, len, "fields fill the account exactly");
}

test("presale offsets are packed and fill 272 bytes", () => packed(P, PRESALE_FIELDS, PRESALE_LEN));
test("seat offsets are packed and fill 120 bytes", () => packed(S, SEAT_FIELDS, SEAT_LEN));
test("config is 130 bytes: version, bump, 4 keys", () => assert.equal(CONFIG_LEN, 2 + 4 * 32));

test("decodePresale reads every field", () => {
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  d[P.STATE] = 3;
  d[P.BUMP] = 254;
  const creator = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  creator.toBuffer().copy(d, P.CREATOR);
  mint.toBuffer().copy(d, P.MINT);
  d.writeBigInt64LE(1_800_000_000n, P.DEADLINE_TS);
  d.writeBigUInt64LE(10_000_000_000n, P.RAISED);
  d.writeBigUInt64LE(123_456_789_012n, P.TOTAL_TOKENS);
  d.writeBigUInt64LE(7n, P.SETTLED_SUM);
  const p = decodePresale(d);
  assert.equal(p.state, 3);
  assert.equal(p.bump, 254);
  assert.ok(p.creator.equals(creator));
  assert.ok(p.mint.equals(mint));
  assert.equal(p.deadlineTs, 1_800_000_000);
  assert.equal(p.raised, 10_000_000_000n);
  assert.equal(p.totalTokens, 123_456_789_012n);
  assert.equal(p.settledSum, 7n);
});

test("decodeSeat reads flags and amounts", () => {
  const d = Buffer.alloc(SEAT_LEN);
  d[0] = SEAT_VERSION;
  d[S.FLAGS] = 1 | 4;
  d.writeBigUInt64LE(1_000_000_000n, S.DEPOSIT);
  d.writeBigUInt64LE(550_000_000n, S.COMMIT);
  const s = decodeSeat(d);
  assert.equal(s.settled, true);
  assert.equal(s.creator, true);
  assert.equal(s.deposit, 1_000_000_000n);
  assert.equal(s.commit, 550_000_000n);
});

test("decoders refuse the wrong length or version", () => {
  assert.throws(() => decodePresale(Buffer.alloc(PRESALE_LEN)), /version/);
  assert.throws(() => decodeSeat(Buffer.alloc(SEAT_LEN - 1)), /120 bytes/);
});
