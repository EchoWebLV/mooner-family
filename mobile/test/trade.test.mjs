// What the Buy and Sell sheets say (src/launched/trade.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUY_CHIPS, BUY_RESERVE, lockEnds, parseSol, pctText, secondsTo, solSig, tokensText, tradeLines, whyNot } from "../src/launched/trade.js";

const POOL = "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri";
// sqrt of 1 lamport per raw token (0.001 SOL per whole token)
const ONE = (1n << 64n).toString();

test("parseSol: typed SOL as lamports; nothing that isn't a positive amount", () => {
  assert.equal(parseSol("0.25"), 250_000_000n);
  assert.equal(parseSol("1"), 1_000_000_000n);
  assert.equal(parseSol(" 0,5 "), 500_000_000n);
  assert.equal(parseSol(".1"), 100_000_000n);
  assert.equal(parseSol("0.000000001"), 1n);
  for (const bad of ["", ".", "0", "0.0", "-1", "1e3", "abc", "0.0000000001", "1.2.3", null]) assert.equal(parseSol(bad), null, String(bad));
  assert.deepEqual(BUY_CHIPS.map(String), ["100000000", "500000000", "1000000000"]);
});

test("parseSol: nothing above what a u64 holds", () => {
  assert.equal(parseSol("18446744073.709551615"), 18_446_744_073_709_551_615n);
  assert.equal(parseSol("18446744073.709551616"), null);
  assert.equal(parseSol("99999999999"), null);
  assert.equal(parseSol("9".repeat(40)), null);
});

test("amounts: SOL to 3 significant digits, tokens compact", () => {
  assert.equal(solSig(9_880_000n), "0.00988");
  assert.equal(solSig(1_500_000_000n), "1.5");
  assert.equal(tokensText(348_894_380_365n), "349K");
  assert.equal(tokensText(1_250_000_000_000n), "1.25M");
  assert.equal(tokensText(500_000n), "0.5");
  assert.equal(pctText(0.0042), "0.42%");
  assert.equal(pctText(0.123), "12.3%");
  assert.equal(pctText(0), "0%");
  assert.equal(pctText(0.00001), "<0.01%");
});

test("tradeLines: a buy on the coin's own pool shows the 1% pool fee", () => {
  const q = { inAmount: 1_000_000_000n, outAmount: 891_000_000n, minOut: 864_270_000n, impact: 0, route: [{ amm: POOL }] };
  assert.deepEqual(tradeLines("buy", q, { pools: [POOL], sqrtPrice: ONE, symbol: "MOON" }), {
    get: "891 $MOON", minimum: "864 $MOON", impact: "10%", high: true, fee: "1% to the pool · 0.01 SOL", slippage: "3%",
  });
});

test("tradeLines: a sell through other pools says the fees are in the price", () => {
  const q = { inAmount: 1_000_000n, outAmount: 990_000n, minOut: 960_300n, impact: 0.0042, route: [{ amm: POOL }, { amm: "Other" }] };
  assert.deepEqual(tradeLines("sell", q, { pools: [POOL], sqrtPrice: null, symbol: "MOON" }), {
    get: "0.00099 SOL", minimum: "0.00096 SOL", impact: "0.42%", high: false, fee: "In the price (Jupiter's route)", slippage: "3%",
  });
});

test("secondsTo: the lock's countdown", () => {
  assert.equal(secondsTo(10_000, 6_500), 4);
  assert.equal(secondsTo(10_000, 9_999), 1);
  assert.equal(secondsTo(10_000, 10_000), 0);
  assert.equal(secondsTo(null, 5), 0);
});

test("lockEnds: the later of the server's launch time and when this phone heard of it, plus the tax", () => {
  const row = { launch: { at: 1_000_000 } };
  assert.equal(lockEnds(row, undefined), 1_004_000, "a row from a snapshot: the server's time");
  assert.equal(lockEnds(row, 1_000_700), 1_004_700, "heard of it later on this phone's clock (fast, or late): from then");
  assert.equal(lockEnds(row, 999_000), 1_004_000, "a slow phone clock: the server's time");
  assert.equal(lockEnds({ launch: null }, 5), null);
  assert.equal(lockEnds(undefined, 5), null);
});

const SELL = { side: "sell", secs: 0, amount: 250n, lamports: 1_000_000_000, holding: { raw: 1_000n }, pct: 25, symbol: "MOON", busy: null, trading: false };
const BUY = { ...SELL, side: "buy", amount: 100_000_000n, holding: undefined };

test("whyNot: the lock first, then another action going on", () => {
  assert.deepEqual(whyNot({ ...BUY, secs: 3 }), { text: "Trading opens in 3 s, after the launch's snipe tax.", wait: true });
  assert.deepEqual(whyNot({ ...BUY, busy: { kind: "sell", key: "M" } }), { text: "Wait for the last trade to finish.", wait: true });
  assert.deepEqual(whyNot({ ...SELL, busy: { kind: "join", key: "P" } }), { text: "Wait for the last one to finish.", wait: true });
  assert.equal(whyNot({ ...BUY, busy: { kind: "buy", key: "M" }, trading: true }), null, "this sheet's own trade isn't a reason");
  assert.equal(whyNot(BUY), null);
  assert.equal(whyNot(SELL), null);
});

test("whyNot: a buy keeps SOL back for the fee and the token accounts' rent", () => {
  assert.equal(BUY_RESERVE, 3_147_280n);
  const has = (lamports) => whyNot({ ...BUY, lamports });
  assert.equal(has(Number(100_000_000n + BUY_RESERVE)), null, "exactly enough");
  assert.deepEqual(has(Number(100_000_000n + BUY_RESERVE) - 1), {
    text: "Your wallet has 0.103 SOL, and a buy needs about 0.00315 SOL more for fees and rent.", wait: false,
  });
  assert.equal(whyNot({ ...BUY, lamports: null }), null, "the SOL isn't read yet");
  assert.equal(whyNot({ ...BUY, amount: null, lamports: 0 }), null, "no amount yet");
});

test("whyNot: a sell needs coins, and enough of them for the share picked", () => {
  assert.equal(whyNot({ ...SELL, holding: undefined }), null, "the balance isn't read yet");
  assert.deepEqual(whyNot({ ...SELL, holding: { raw: 0n } }), { text: "You don't hold any $MOON.", wait: false });
  assert.deepEqual(whyNot({ ...SELL, holding: { raw: 3n }, pct: 25 }), { text: "Too little to sell 25%. Try 100%.", wait: false });
  assert.deepEqual(whyNot({ ...SELL, holding: { raw: 1n }, pct: 50 }), { text: "Too little to sell 50%. Try 100%.", wait: false });
  assert.equal(whyNot({ ...SELL, holding: { raw: 3n }, pct: 100 }), null);
});
