// What the Buy and Sell sheets say (src/launched/trade.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUY_CHIPS, parseSol, pctText, secondsTo, solSig, tokensText, tradeLines } from "../src/launched/trade.js";

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
