// The pure selectors both apps read presales and coins through (engine/src/views.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canGetBack, clock, fillOf, joinAmounts, joinCheck, marketCapSol, priceFromSqrt, roomOf, seatChoices, seatOf,
  secondsLeft, stageOf, SUPPLY, whoIsIn,
} from "../src/views.js";

const N = { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n };
const NOW = 1_790_000_000_000; // ms
const T = NOW / 1000;
const open = (over = {}) => ({ presale: "P", where: "er", state: "OPEN", raised: "200000000", deadlineTs: T + 600, ...over });

test("stageOf: the launched row wins, then the presale's state", () => {
  assert.equal(stageOf(open(), null), "presale");
  assert.equal(stageOf(open({ state: "FULL" }), null), "launching");
  assert.equal(stageOf(open({ state: "LAUNCHING" }), null), "launching");
  assert.equal(stageOf(open({ state: "SETTLED" }), null), "live");
  assert.equal(stageOf(open({ state: "CLOSED", launch: { at: 1 } }), null), "live");
  assert.equal(stageOf(open({ state: "CLOSED", launch: null }), null), "expired");
  assert.equal(stageOf(open({ state: "EXPIRED" }), null), "expired");
  assert.equal(stageOf(open({ state: "FAILED" }), null), "expired");
  assert.equal(stageOf(undefined, { pool: { migrated: false } }), "live");
  assert.equal(stageOf(open(), { pool: { migrated: true } }), "migrated");
  assert.equal(stageOf(undefined, { pool: null }), "live");
  assert.equal(stageOf(undefined, undefined), "expired");
});

test("priceFromSqrt: SOL per whole token, and the market cap of 1B", () => {
  // web/src/lib/curve.ts SQRT_START: the curve's first price, 28 SOL market cap
  const start = 97610994635780032n;
  const p = priceFromSqrt(start);
  assert.ok(Math.abs(p * SUPPLY - 28) < 0.01, `start market cap ${p * SUPPLY}`);
  assert.equal(marketCapSol(start), p * SUPPLY);
  assert.equal(priceFromSqrt("97610994635780032"), p); // strings from the server
});

test("fillOf and roomOf", () => {
  assert.equal(fillOf(open(), N), 0.4);
  assert.equal(fillOf(open({ raised: "900000000" }), N), 1);
  assert.equal(fillOf(open({ raised: undefined }), N), 0);
  assert.equal(roomOf(open(), N), 300_000_000n);
  assert.equal(roomOf(open({ raised: "500000000" }), N), 0n);
  assert.equal(roomOf(open({ raised: "600000000" }), N), 0n); // never negative
});

test("secondsLeft and clock", () => {
  assert.equal(secondsLeft(open(), NOW), 600);
  assert.equal(secondsLeft(open({ deadlineTs: T - 5 }), NOW), 0);
  assert.equal(secondsLeft(open({ deadlineTs: undefined }), NOW), 0);
  assert.equal(clock(0), "0:00");
  assert.equal(clock(65), "1:05");
  assert.equal(clock(3_725), "1:02:05");
});

test("whoIsIn: committed seats, biggest first, from seats or the list's users", () => {
  const view = open({
    seats: [
      { user: "A", deposit: "100000000", commit: "100000000", creator: false },
      { user: "B", deposit: "500000000", commit: "300000000", creator: true },
      { user: "C", deposit: "100000000", commit: "0", creator: false },
    ],
  });
  assert.deepEqual(whoIsIn(view), [
    { user: "B", commit: 300_000_000n, creator: true },
    { user: "A", commit: 100_000_000n, creator: false },
  ]);
  assert.deepEqual(whoIsIn(open({ users: [{ user: "D", commit: "100000000", creator: false }] })), [{ user: "D", commit: 100_000_000n, creator: false }]);
  assert.deepEqual(whoIsIn(open()), []);
});

test("seatOf", () => {
  const view = open({ seats: [{ user: "A", deposit: "100000000", commit: "50000000", creator: false, settled: false, claimed: true, where: "er" }] });
  assert.deepEqual(seatOf(view, "A"), { deposit: 100_000_000n, commit: 50_000_000n, creator: false, settled: false, claimed: true, where: "er" });
  assert.equal(seatOf(view, "Z"), null);
  assert.equal(seatOf(open(), "A"), null);
});

test("joinCheck", () => {
  assert.deepEqual(joinCheck(open(), "W", N, NOW), { ok: true });
  assert.deepEqual(joinCheck(open(), null, N, NOW), { ok: true });
  assert.equal(joinCheck(open({ state: "FULL" }), "W", N, NOW).ok, false);
  assert.equal(joinCheck(open({ where: "closed" }), "W", N, NOW).ok, false);
  assert.match(joinCheck(open({ deadlineTs: T - 1 }), "W", N, NOW).why, /Time's up/);
  assert.match(joinCheck(open({ raised: "500000000" }), "W", N, NOW).why, /full/);
  assert.match(joinCheck(open({ seats: [{ user: "W", deposit: "1", commit: "0" }] }), "W", N, NOW).why, /already in/);
  assert.match(joinCheck(open({ users: [{ user: "W", commit: "100000000" }] }), "W", N, NOW).why, /already in/);
  assert.match(joinCheck(open({ stale: true }), "W", N, NOW).why, /Can't see this pool/); // the pre-delegation snapshot
  assert.equal(joinCheck(open({ stale: false }), "W", N, NOW).ok, true);
});

test("seatChoices: the presets that fit the program's seat rules", () => {
  assert.deepEqual(seatChoices(N), [100_000_000n, 250_000_000n, 500_000_000n]);
  assert.deepEqual(seatChoices({ ...N, MAX_SEAT: 250_000_000n }), [100_000_000n, 250_000_000n]);
  assert.deepEqual(seatChoices({ ...N, STEP: 100_000_000n }), [100_000_000n, 500_000_000n]); // 250M is not a multiple of the step
  assert.deepEqual(seatChoices({ MIN_SEAT: "100000000", MAX_SEAT: "500000000", STEP: "10000000" }), [100_000_000n, 250_000_000n, 500_000_000n]);
});

test("joinAmounts: the commit is cut to the room; a seat holds at least MIN_SEAT", () => {
  assert.deepEqual(joinAmounts(open(), N, 250_000_000n), { deposit: 250_000_000n, commit: 250_000_000n });
  assert.deepEqual(joinAmounts(open({ raised: "350000000" }), N, 250_000_000n), { deposit: 150_000_000n, commit: 150_000_000n });
  assert.deepEqual(joinAmounts(open({ raised: "450000000" }), N, 250_000_000n), { deposit: 100_000_000n, commit: 50_000_000n });
});

test("canGetBack", () => {
  const seat = (over = {}) => ({ user: "W", deposit: "100000000", commit: "100000000", creator: false, settled: false, ...over });
  assert.equal(canGetBack(open({ seats: [seat()] }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat({ creator: true })] }), "W", NOW), false);
  assert.equal(canGetBack(open({ seats: [seat({ settled: true })] }), "W", NOW), false);
  assert.equal(canGetBack(open({ seats: [seat()], deadlineTs: T - 1 }), "W", NOW), false);
  assert.equal(canGetBack(open({ seats: [seat()], state: "EXPIRED" }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat()], state: "FAILED" }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat()], state: "FULL" }), "W", NOW), false);
  assert.equal(canGetBack(open({ seats: [] }), "W", NOW), false);
  // a settled seat is refunded once the presale FAILED, not before and not when it only expired
  assert.equal(canGetBack(open({ seats: [seat({ settled: true })], state: "FAILED" }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat({ settled: true })], state: "EXPIRED" }), "W", NOW), false);
  assert.equal(canGetBack(open({ seats: [seat({ settled: true })], state: "SETTLED" }), "W", NOW), false);
  // a seat with nothing in the pool can leave in any state, past the deadline too
  assert.equal(canGetBack(open({ seats: [seat({ commit: "0" })], state: "FULL" }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat({ commit: "0" })], deadlineTs: T - 1 }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat({ commit: "0" })], state: "SETTLED" }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat({ commit: "0", creator: true })], state: "FULL" }), "W", NOW), false);
});

test("tradeOpensAt: launch time plus the snipe tax (dbc.js's) and the keeper's margin", async () => {
  const { CURVE } = await import("../src/dbc.js");
  const { SNIPE_S, TAX_MARGIN_S, tradeOpensAt } = await import("../src/views.js");
  assert.equal(SNIPE_S, CURVE.SNIPE_S);
  assert.equal(TAX_MARGIN_S, 1);
  assert.equal(tradeOpensAt({ launch: { at: NOW } }), NOW + 4_000);
  assert.equal(tradeOpensAt({ launch: null }), null);
  assert.equal(tradeOpensAt(undefined), null);
});
