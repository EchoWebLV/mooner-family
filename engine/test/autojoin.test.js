// Auto-join's pick (src/autojoin.js) and the alert kinds (src/alertkinds.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOJOIN_MIN_LEFT_S, autoChoices, hasRoomFor, pickFullest, startOf } from "../src/autojoin.js";
import { DEFAULT_KINDS, GROUPS, KIND_LABEL, SWITCHES, cleanKinds } from "../src/alertkinds.js";

// mainnet's numbers, as /api/info sends them
const N = { TARGET: "500000000", MIN_SEAT: "100000000", MAX_SEAT: "500000000", STEP: "10000000" };
const NOW = 1_000_000_000_000;
const SOL = 1_000_000_000n;
const open = (presale, raised, leftS = 600, extra = {}) => ({
  presale, state: "OPEN", where: "er", raised: String(raised), deadlineTs: NOW / 1000 + leftS, token: { symbol: presale }, users: [], ...extra,
});

test("autoChoices: the seats that can ever fit beside the creator's", () => {
  assert.deepEqual(autoChoices(N), [100_000_000n, 250_000_000n]);
  assert.deepEqual(autoChoices({ ...N, TARGET: "10000000000", MAX_SEAT: "1000000000" }), [100_000_000n, 250_000_000n, 500_000_000n]);
});

test("hasRoomFor: open, time left, not in it yet, and room for the whole amount", () => {
  const a = 250_000_000n;
  assert.equal(hasRoomFor(open("A", SOL / 10n), N, a, "me", NOW), true); // 0.4 left
  assert.equal(hasRoomFor(open("A", 300_000_000n), N, a, "me", NOW), false); // 0.2 left
  assert.equal(hasRoomFor(open("A", 250_000_000n), N, "250000000", "me", NOW), true); // exactly
  assert.equal(hasRoomFor(open("A", SOL / 10n, AUTOJOIN_MIN_LEFT_S - 1), N, a, "me", NOW), false);
  assert.equal(hasRoomFor(open("A", SOL / 10n, 600, { stale: true }), N, a, "me", NOW), false);
  assert.equal(hasRoomFor(open("A", SOL / 10n, 600, { state: "FULL" }), N, a, "me", NOW), false);
  assert.equal(hasRoomFor(open("A", SOL / 10n, 600, { users: [{ user: "me", commit: "100000000" }] }), N, a, "me", NOW), false);
  assert.equal(hasRoomFor(open("A", SOL / 10n, 600, { seats: [{ user: "me", commit: "0", deposit: "100000000" }] }), N, a, "me", NOW), false);
});

test("pickFullest: least room first, then the nearest end; none when nothing fits", () => {
  const views = [open("EMPTY", 100_000_000n), open("FULLER", 200_000_000n, 900), open("SAME", 200_000_000n, 300), open("NOROOM", 450_000_000n)];
  assert.equal(pickFullest(views, N, 100_000_000n, "me", NOW).presale, "SAME");
  assert.equal(pickFullest(views, N, 250_000_000n, "me", NOW).presale, "SAME");
  assert.equal(pickFullest(views, N, 350_000_000n, "me", NOW).presale, "EMPTY");
  assert.equal(pickFullest(views, N, 500_000_000n, "me", NOW), null);
  assert.equal(pickFullest([open("NOCOIN", 0n, 600, { token: null })], N, 100_000_000n, "me", NOW), null);
  assert.equal(pickFullest([], N, 100_000_000n, "me", NOW), null);
});

test("startOf: a ?join= that names one of the seats, else null", () => {
  assert.equal(startOf("250000000", N), 250_000_000n);
  assert.equal(startOf("123", N), null);
  assert.equal(startOf("-1", N), null);
  assert.equal(startOf("1e9", N), null);
  assert.equal(startOf(undefined, N), null);
  assert.equal(startOf("9".repeat(17), N), null);
});

test("alert kinds: every switch is in one group and has words; cleanKinds keeps known switches", () => {
  assert.deepEqual(GROUPS.flatMap((g) => g.kinds).sort(), [...SWITCHES].sort());
  for (const k of SWITCHES) assert.ok(KIND_LABEL[k], k);
  assert.deepEqual(DEFAULT_KINDS, SWITCHES);
  assert.deepEqual(cleanKinds(["mcap", "filled", "nope", "room", "mcap"]), ["filled", "mcap"]);
  assert.deepEqual(cleanKinds([]), []);
  assert.equal(cleanKinds("filled"), null);
});
