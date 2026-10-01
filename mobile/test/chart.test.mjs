// The coin screen's chart math (src/launched/chart.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { changeText, chartPath, pointsOf, spanText } from "../src/launched/chart.js";

const c = (t, close) => ({ t, o: close, h: close, l: close, c: close });

test("pointsOf: the closes, then the live price when it's newer", () => {
  assert.deepEqual(pointsOf([c(0, 1), c(60_000, 2)], 3, 90_000), [{ t: 0, p: 1 }, { t: 60_000, p: 2 }, { t: 90_000, p: 3 }]);
  assert.deepEqual(pointsOf([c(0, 1), c(60_000, 2)], 3, 60_000), [{ t: 0, p: 1 }, { t: 60_000, p: 2 }], "not newer: left out");
  assert.deepEqual(pointsOf([], null, 5), []);
  assert.deepEqual(pointsOf(undefined, 2, 5), [{ t: 5, p: 2 }]);
});

test("chartPath: time across, price up, padded; a flat price mid-box", () => {
  const p = chartPath([{ t: 0, p: 1 }, { t: 50, p: 3 }, { t: 100, p: 2 }], 200, 100, 10);
  assert.equal(p.line, "M0 90 L100 10 L200 50");
  assert.equal(p.area, "M0 90 L100 10 L200 50 L200 100 L0 100 Z");
  assert.deepEqual([p.lo, p.hi, p.change], [1, 3, 1]);
  assert.equal(chartPath([{ t: 0, p: 2 }, { t: 10, p: 2 }], 100, 40).line, "M0 20 L100 20");
  assert.equal(chartPath([{ t: 0, p: 2 }], 100, 40), null);
});

test("changeText and spanText", () => {
  assert.equal(changeText(0.1234), "+12.3%");
  assert.equal(changeText(-0.04561), "-4.56%");
  assert.equal(changeText(0), "0%");
  // a candle's close and the pool's own price differ in the last digits: never "+3.6e-9%"
  assert.equal(changeText(3.6e-11), "0%");
  assert.equal(changeText(-2e-7), "0%");
  assert.equal(spanText(0, 40 * 60_000), "Last 40 min");
  assert.equal(spanText(0, 300 * 60_000), "Last 5 h");
  assert.equal(spanText(0, 10_000), "Last 1 min");
});
