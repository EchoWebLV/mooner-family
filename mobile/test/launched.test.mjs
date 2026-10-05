// What Pulse's market cards and the coin screen say: price, market cap, curve, launch time, your seat.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atMigration, capText, coinScreenState, curveOf, dayTime, holderRows, holdersText, inWith, liquidityText, positionOf, priceText, sig3, stillIn, volumeText,
} from "../src/launched/coin.js";

// Mooner's curve starts here (engine/src/dbc.js CURVE.SQRT_START_PRICE): 28 SOL market cap.
const START = "97610994635780032";

test("sig3: 3 significant digits, never in exponent form", () => {
  assert.equal(sig3(2.81e-8), "0.0000000281");
  assert.equal(sig3(2.8e-8), "0.000000028");
  assert.equal(sig3(9.996e-8), "0.0000001");
  assert.equal(sig3(0.000123456), "0.000123");
  assert.equal(sig3(1.234), "1.23");
  assert.equal(sig3(0.5), "0.5");
  assert.equal(sig3(10), "10");
  assert.equal(sig3(123.4), "123");
  assert.equal(sig3(12345), "12300");
  assert.equal(sig3(0), "0");
});

test("priceText: SOL per whole token at a sqrt price", () => {
  assert.equal(priceText(START), "0.000000028 SOL");
});

test("capText: dollars when SOL/USD is known, else SOL", () => {
  assert.equal(capText(START, 0), "28 SOL");
  assert.equal(capText(START, 150), "$4,200.00");
});

test("curveOf: SOL in the curve of 80, full once migrated", () => {
  assert.deepEqual(curveOf({ quoteReserve: "12345678900", migrated: false }), { fill: 12.3456789 / 80, text: "12.35 of 80 SOL" });
  assert.deepEqual(curveOf({ quoteReserve: "0", migrated: false }), { fill: 0, text: "0.00 of 80 SOL" });
  assert.equal(curveOf({ quoteReserve: "90000000000", migrated: false }).fill, 1);
  assert.deepEqual(curveOf({ quoteReserve: "0", migrated: true }), { fill: 1, text: "Migrated to Meteora DAMM v2" });
});

test("dayTime: d MMM, HH:mm on this phone's clock", () => {
  assert.equal(dayTime(new Date(2026, 9, 1, 9, 5).getTime()), "1 Oct, 09:05");
  assert.equal(dayTime(new Date(2026, 0, 31, 23, 59).getTime()), "31 Jan, 23:59");
});

test("stillIn: a join from this phone not taken back since", () => {
  assert.equal(stillIn(undefined), false);
  assert.equal(stillIn({ deposit: "300000000", at: 5 }), true);
  assert.equal(stillIn({ deposit: "300000000", at: 5, back: 6 }), false);
  assert.equal(stillIn({ deposit: "300000000", at: 7, back: 6 }), true); // joined again after
  assert.equal(stillIn({ back: 6 }), false);
});

test("coinScreenState: the coin once its row has one; waits for a launch on its way", () => {
  const row = { presale: "K", token: { symbol: "M" } };
  assert.equal(coinScreenState({ row, loaded: true, view: undefined }), "coin");
  assert.equal(coinScreenState({ row: undefined, loaded: false, view: undefined }), "wait");
  // the room links here once the presale is SETTLED; the row comes after the pool is read
  for (const state of ["FULL", "LAUNCHING", "SETTLED"]) {
    assert.equal(coinScreenState({ row: undefined, loaded: true, view: { state, launch: null } }), "wait", state);
  }
  assert.equal(coinScreenState({ row: undefined, loaded: true, view: { state: "CLOSED", launch: { at: 1 } } }), "wait");
  assert.equal(coinScreenState({ row: undefined, loaded: true, view: { state: "OPEN", launch: null } }), "missing");
  assert.equal(coinScreenState({ row: undefined, loaded: true, view: { state: "FAILED", launch: null } }), "missing");
  assert.equal(coinScreenState({ row: undefined, loaded: true, view: undefined }), "missing");
});

test("inWith: the watched seat decides while it's there, else the join from this phone", () => {
  const W = "Wallet1111";
  const seat = (commit) => ({ seats: [{ user: W, deposit: "300000000", commit, settled: true }] });
  const joined = { deposit: "250000000", at: 5 };
  assert.equal(inWith(seat("300000000"), W, undefined), 300_000_000n);
  assert.equal(inWith(seat("0"), W, joined), null, "out of the pool");
  // a claim closes the seat: the view has none, the phone's note decides
  assert.equal(inWith({ seats: [] }, W, joined), 250_000_000n);
  assert.equal(inWith({ seats: [] }, W, { ...joined, back: 6 }), null);
  assert.equal(inWith(undefined, W, joined), 250_000_000n);
  assert.equal(inWith(undefined, W, undefined), null);
  assert.equal(inWith(seat("300000000"), null, undefined), null);
});

test("atMigration: only while a migrated coin's DAMM v2 pool isn't found yet", () => {
  assert.equal(atMigration({ migrated: false, damm: null }), false);
  assert.equal(atMigration({ migrated: true, damm: null }), true);
  assert.equal(atMigration({ migrated: true, damm: "Damm1111" }), false);
  assert.equal(atMigration(null), false);
});

test("liquidity, volume, holders: from the pool before migration, Meteora after; null when unknown", () => {
  const dbc = { quoteReserve: "12345678900", migrated: false, damm: null };
  assert.equal(liquidityText(dbc, null), "12.35 SOL");
  const damm = { quoteReserve: "0", migrated: true, damm: "Damm1111" };
  assert.equal(liquidityText(damm, { venue: "damm", liquidityUsd: 9956.5 }), "$9,956.50");
  assert.equal(liquidityText(damm, { venue: "dbc", liquidityUsd: null }), null, "stats from before the DAMM v2 pool was found");
  assert.equal(liquidityText(null, null), null);
  assert.equal(volumeText({ volume24hUsd: 3754478.47 }), "$3.75M");
  assert.equal(volumeText({ volume24hUsd: null }), null);
  assert.equal(holdersText({ holders: 1256 }), "1.26K holders");
  assert.equal(holdersText({ holders: 1 }), "1 holder");
  assert.equal(holdersText({ holders: 0 }), "0 holders");
  assert.equal(holdersText({ holders: null }), null);
  assert.equal(volumeText(undefined), null);
});

test("holderRows: the pool and presale by name, you as You, a share of the supply the server read", () => {
  const top = [
    { owner: "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM", amount: "700000000000000", label: "Bonding curve" },
    { owner: "Wallet1111", amount: "12345000000", label: null },
    { owner: "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D", amount: "5000000000000", label: null },
  ];
  assert.deepEqual(holderRows(top, "Wallet1111", "1000000000000000").map(({ who, tokens, share }) => [who, tokens, share]), [
    ["Bonding curve", "700M", "70%"],
    ["You", "12.3K", "0.00123%"],
    ["HgZ9…5u8D", "5M", "0.5%"],
  ]);
  // the trial coin's supply on chain (getTokenSupply, 2026-10-01): not 1B
  assert.equal(holderRows(top, "W", "1196140480631743")[0].share, "58.5%");
  assert.deepEqual(holderRows(top, "W", null).map((r) => r.share), [null, null, null], "no supply read: no shares, tokens only");
  assert.equal(holderRows(null, "W", "1"), null);
  assert.deepEqual(holderRows([], "W", "1"), []);
});

test("holderRows: each row's key is its own, even for the same owner or amount twice", () => {
  const twice = [
    { owner: "Wallet1111", amount: "5000000", label: null },
    { owner: "Wallet1111", amount: "5000000", label: null },
    { amount: "5000000", label: "Pool" },
    { amount: "5000000", label: "Pool" },
  ];
  const keys = holderRows(twice, "W", "100000000").map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, keys.join(", "));
});

test("positionOf: what the wallet holds and its worth at the pool's price", () => {
  // 28 SOL market cap: 2.8e-8 SOL per token
  assert.deepEqual(positionOf({ raw: 1_000_000_000_000n, decimals: 6, ui: 1e6 }, START, 150), { tokens: "1M", sol: "0.028 SOL", usd: "$4.20" });
  assert.deepEqual(positionOf({ raw: 500_000n, decimals: 6, ui: 0.5 }, null, 150), { tokens: "0.5", sol: null, usd: null });
  assert.equal(positionOf({ raw: 0n, decimals: 6, ui: 0 }, START, 150), null);
  assert.equal(positionOf(undefined, START, 150), null);
});
