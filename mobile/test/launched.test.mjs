// What the Launched list and the coin screen say: price, market cap, curve, launch time, your seat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capText, curveOf, dayTime, priceText, sig3, stillIn } from "../src/launched/coin.js";

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
  assert.deepEqual(curveOf({ quoteReserve: "0", migrated: true }), { fill: 1, text: "Migrated to DAMM v2" });
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
