// Pulse's three lanes from the server's feeds: presales filling, coins on the curve, migrated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPIRED_STAYS_MS, expiredSeen, filling, finalStretch, migrated, newPairs, pairStage, settledLane } from "../src/live/lanes.js";

const token = { symbol: "T", name: "T", image: "" };
const P = (presale, state, openedTs, over = {}) => ({ presale, state, openedTs, raised: "0", token, ...over });
const pool = (sol, isMigrated = false) => ({ quoteReserve: String(sol * 1e9), sqrtPrice: "1", migrated: isMigrated });
const R = (presale, at, p, t = token) => ({ presale, mint: `m${presale}`, token: t, launch: { at }, pool: p });
const byKey = (...rows) => Object.fromEntries(rows.map((r) => [r.presale, r]));
const keys = (rows) => rows.map((r) => r.presale);

test("newPairs: open, full and launching presales with a coin, newest first", () => {
  const presales = byKey(
    P("A", "OPEN", 100),
    P("B", "FULL", 300),
    P("C", "OPEN", 50),
    P("D", "LAUNCHING", 400),
    P("E", "OPEN", 500, { token: undefined }),
    P("F", "SETTLED", 600),
  );
  const launched = byKey(R("F", 1, pool(1)));
  assert.deepEqual(keys(newPairs(presales, launched, 0, {})), ["D", "B", "A", "C"]);
});

test("newPairs: a launched presale whose launched row hasn't arrived stays, launching, until the row does", () => {
  const presales = byKey(P("S", "SETTLED", 1), P("C", "CLOSED", 2, { launch: { at: 5 } }), P("X", "CLOSED", 3));
  // no row yet: not in Final Stretch, so New Pairs keeps it (X closed without a launch: expired)
  assert.deepEqual(keys(newPairs(presales, {}, 0, { X: -Infinity })), ["C", "S"]);
  assert.deepEqual(keys(finalStretch({})), []);
  assert.equal(pairStage(presales.S, undefined), "launching");
  assert.equal(pairStage(presales.C, undefined), "launching");
  // the rows arrive: they leave New Pairs for Final Stretch
  const launched = byKey(R("S", 1, pool(1)), R("C", 2, null));
  assert.deepEqual(keys(newPairs(presales, launched, 0, { X: -Infinity })), []);
  assert.deepEqual(keys(finalStretch(launched)), ["S", "C"]);
  assert.equal(pairStage(presales.S, launched.S), "live");
  assert.equal(pairStage(P("O", "OPEN", 1), undefined), "presale");
  assert.equal(pairStage(P("F", "FULL", 1), undefined), "launching");
  assert.equal(pairStage(presales.X, undefined), "expired");
});

test("newPairs: each item carries its presales row as is and its pairStage", () => {
  const presales = byKey(P("O", "OPEN", 1), P("F", "FULL", 2), P("S", "SETTLED", 3), P("X", "EXPIRED", 4));
  const items = newPairs(presales, {}, 0, {});
  assert.deepEqual(
    items.map((r) => [r.presale, r.stage]),
    [["X", "expired"], ["S", "launching"], ["F", "launching"], ["O", "presale"]],
  );
  for (const r of items) assert.equal(r.view, presales[r.presale], "the feed's own object, so a memoized card can skip it");
});

test("newPairs: an expired presale stays 3 s from when Pulse first saw it so", () => {
  assert.equal(EXPIRED_STAYS_MS, 3000);
  const presales = byKey(P("X", "EXPIRED", 1), P("Y", "FAILED", 2));
  const seen = { X: 10_000, Y: 10_000 };
  assert.deepEqual(keys(newPairs(presales, {}, 12_999, seen)), ["Y", "X"]);
  assert.deepEqual(keys(newPairs(presales, {}, 13_000, seen)), []);
  // not seen yet: it has just expired
  assert.deepEqual(keys(newPairs(presales, {}, 50_000, {})), ["Y", "X"]);
});

test("expiredSeen: when each presale was first seen expired; the ones there at the start never show", () => {
  const presales = byKey(P("X", "EXPIRED", 1), P("O", "OPEN", 2));
  const first = expiredSeen({}, presales, {}, -Infinity);
  assert.deepEqual(first, { X: -Infinity });
  assert.deepEqual(keys(newPairs(presales, {}, 5000, first)), ["O"]);
  assert.equal(expiredSeen(first, presales, {}, 5000), first, "nothing new: the same object");
  const second = expiredSeen(first, byKey(P("X", "EXPIRED", 1), P("O", "EXPIRED", 2)), {}, 5000);
  assert.deepEqual(second, { X: -Infinity, O: 5000 });
  assert.deepEqual(expiredSeen(second, byKey(P("O", "EXPIRED", 2)), {}, 6000), { O: 5000 }, "a presale gone from the feed is forgotten");
});

test("finalStretch: coins on the curve, closest to migrating first, then newest", () => {
  const launched = byKey(
    R("A", 1, pool(10)),
    R("B", 2, pool(60)),
    R("C", 3, null),
    R("D", 4, pool(80, true)),
    R("E", 5, pool(10)),
    R("F", 6, pool(5), null),
  );
  assert.deepEqual(keys(finalStretch(launched)), ["B", "E", "A", "C"]);
});

test("migrated: migrated coins, newest launch first", () => {
  const launched = byKey(R("A", 1, pool(80, true)), R("B", 2, pool(80, true)), R("C", 3, pool(10)), R("D", 4, pool(80, true), null));
  assert.deepEqual(keys(migrated(launched)), ["B", "A"]);
});

test("filling: the open presales with a coin, and the SOL in them", () => {
  const presales = byKey(
    P("A", "OPEN", 1, { raised: "200" }),
    P("B", "OPEN", 2, { raised: "300" }),
    P("C", "FULL", 3, { raised: "1000" }),
    P("D", "OPEN", 4, { raised: "50", token: undefined }),
  );
  assert.deepEqual(filling(presales, {}), { count: 2, lamports: 500n });
});

test("settledLane: a momentum end is a lane only on a page boundary, and on the tapped lane while a tap scrolls", () => {
  const W = 392.7272;
  // swipes (no tap target): the page it landed on, within a pixel's rounding
  assert.equal(settledLane(0, W, null), 0);
  assert.equal(settledLane(W + 0.4, W, null), 1);
  assert.equal(settledLane(2 * W - 0.6, W, null), 2);
  // a cancelled animated scroll stops part-way: ignored
  assert.equal(settledLane(0.6 * W, W, null), null);
  assert.equal(settledLane(W + 2, W, 1), null);
  // tapped 2 then 0: the first scroll, cancelled right on page 1, is ignored; page 0 counts
  assert.equal(settledLane(W, W, 0), null);
  assert.equal(settledLane(0, W, 0), 0);
  // no width yet: nothing
  assert.equal(settledLane(0, 0, null), null);
});
