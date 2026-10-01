import { test } from "node:test";
import assert from "node:assert/strict";
import { compact, shortWallet, solText, usd } from "../src/ui/format.js";

test("solText: lamports as SOL, trimmed", () => {
  assert.equal(solText(500_000_000n), "0.5");
  assert.equal(solText("250000000"), "0.25");
  assert.equal(solText(123_456_789n, 3), "0.123");
  assert.equal(solText(0), "0");
});
test("usd", () => {
  assert.equal(usd(1234.5), "$1,234.50");
  assert.equal(usd(12_345_678), "$12.3M");
  assert.equal(usd(0.0123), "$0.0123");
});
test("compact", () => {
  assert.equal(compact(950), "950");
  assert.equal(compact(12_300), "12.3K");
  assert.equal(compact(4_560_000), "4.56M");
  assert.equal(compact(1_000_000_000), "1B");
});
test("shortWallet", () => {
  assert.equal(shortWallet("HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D"), "HgZ9…5u8D");
});
test("compact: rounding carries into the next unit", () => {
  assert.equal(compact(999_999), "1M");
  assert.equal(compact(999_499), "999K");
  assert.equal(compact(999.6), "1K");
  assert.equal(compact(999_999_999), "1B");
  assert.equal(compact(-999_999), "-1M");
  assert.equal(usd(999_999), "$1M");
});
test("usd: a minus sign goes before the dollar sign", () => {
  assert.equal(usd(-5), "-$5.00");
  assert.equal(usd(-1234.5), "-$1,234.50");
  assert.equal(usd(-12_345_678), "-$12.3M");
  assert.equal(usd(-0.0123), "-$0.0123");
});
test("usd: tiny values never print in exponent form", () => {
  assert.equal(usd(0), "$0");
  assert.equal(usd(0.000001), "$0.000001");
  assert.equal(usd(0.0000012), "$0.0000012");
  assert.equal(usd(0.0000001), "<$0.000001");
  assert.equal(usd(1e-12), "<$0.000001");
  assert.equal(usd(-0.0000001), ">-$0.000001");
  assert.doesNotMatch(usd(1.23e-9), /e/);
});
test("usd: thousands separators are added by hand", () => {
  assert.equal(usd(999.5), "$999.50");
  assert.equal(usd(1000), "$1,000.00");
  assert.equal(usd(9999.5), "$9,999.50");
  assert.equal(usd(1234.567), "$1,234.57");
});
