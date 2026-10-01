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
