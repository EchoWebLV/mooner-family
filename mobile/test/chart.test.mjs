// The coin screen's chart math (src/launched/chart.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { changeText, chartPath, emptyChartText, pctOf, pointsOf, spanText } from "../src/launched/chart.js";

const c = (t, close) => ({ t, o: close, h: close, l: close, c: close });

test("pointsOf: the closes, then the live price when it's newer", () => {
  assert.deepEqual(pointsOf([c(0, 1), c(60_000, 2)], 3, 90_000), [{ t: 0, p: 1 }, { t: 60_000, p: 2 }, { t: 90_000, p: 3 }]);
  assert.deepEqual(pointsOf([c(0, 1), c(60_000, 2)], 3, 60_000), [{ t: 0, p: 1 }, { t: 60_000, p: 2 }], "not newer: left out");
  assert.deepEqual(pointsOf([], null, 5), []);
  assert.deepEqual(pointsOf(undefined, 2, 5), [{ t: 5, p: 2 }]);
});

test("pointsOf: only times and prices that are numbers, prices above 0", () => {
  const bad = [
    c(0, 1),
    c(60_000, null), // JSON's NaN
    { t: 120_000, o: 1, h: 1, l: 1 }, // no close
    c(180_000, NaN),
    c(240_000, 0),
    c(300_000, -1),
    c(NaN, 2),
    { c: 2 }, // no time
    { t: null, o: 2, h: 2, l: 2, c: 2 }, // not 1970
    null,
    c(360_000, "2"), // a number in a string is still one
  ];
  assert.deepEqual(pointsOf(bad, null, 400_000), [{ t: 0, p: 1 }, { t: 360_000, p: 2 }]);
  assert.deepEqual(pointsOf([c(0, 1)], NaN, 5), [{ t: 0, p: 1 }], "a live price that isn't a number: left out");
  assert.deepEqual(pointsOf([c(0, 1)], Infinity, 5), [{ t: 0, p: 1 }]);
  assert.deepEqual(pointsOf([c(0, 0), c(60_000, 0)], null, 90_000), [], "all zero: no points");
});

test("pointsOf: oldest first, whatever order the candles came in", () => {
  assert.deepEqual(pointsOf([c(120_000, 3), c(0, 1), c(60_000, 2)], 4, 180_000), [
    { t: 0, p: 1 }, { t: 60_000, p: 2 }, { t: 120_000, p: 3 }, { t: 180_000, p: 4 },
  ]);
});

test("chartPath: time across, price up, padded; a flat price mid-box", () => {
  const p = chartPath([{ t: 0, p: 1 }, { t: 50, p: 3 }, { t: 100, p: 2 }], 200, 100, 10);
  assert.equal(p.line, "M0 90 L100 10 L200 50");
  assert.equal(p.area, "M0 90 L100 10 L200 50 L200 100 L0 100 Z");
  assert.deepEqual([p.lo, p.hi, p.change], [1, 3, 1]);
  assert.equal(chartPath([{ t: 0, p: 2 }, { t: 10, p: 2 }], 100, 40).line, "M0 20 L100 20");
  assert.equal(chartPath([{ t: 0, p: 2 }], 100, 40), null);
});

test("chartPath over messy or newest-first candles: never NaN, x never below 0", () => {
  const messy = [c(120_000, 3), c(60_000, null), c(0, 1), c(180_000, NaN), { t: 240_000 }, c(300_000, 0)];
  const p = chartPath(pointsOf(messy, 2, 360_000), 200, 100);
  assert.ok(p, "the good points still draw");
  for (const d of [p.line, p.area]) {
    assert.ok(!d.includes("NaN") && !d.includes("Infinity"), d);
    for (const [, x] of d.matchAll(/[ML](-?[\d.]+) /g)) assert.ok(Number(x) >= 0, d);
  }
  assert.ok(Number.isFinite(p.change));
  assert.equal(chartPath(pointsOf([c(0, 0), c(60_000, 0)], null, 90_000), 200, 100), null, "all zero: no path");
});

test("pctOf: the percent the header shows, and so its color", () => {
  assert.equal(pctOf(0.1234), 12.3);
  assert.equal(pctOf(-0.04561), -4.56);
  assert.equal(pctOf(0), 0);
  assert.equal(pctOf(-2e-7), 0, "rounds to 0%: neither up nor down");
  assert.equal(pctOf(3.6e-11), 0);
  assert.equal(pctOf(Infinity), null);
  assert.equal(pctOf(NaN), null);
});

test("changeText and spanText", () => {
  assert.equal(changeText(0.1234), "+12.3%");
  assert.equal(changeText(-0.04561), "-4.56%");
  assert.equal(changeText(0), "0%");
  // a candle's close and the pool's own price differ in the last digits: never "+3.6e-9%"
  assert.equal(changeText(3.6e-11), "0%");
  assert.equal(changeText(-2e-7), "0%");
  assert.equal(changeText(Infinity), null);
  assert.equal(changeText(-Infinity), null);
  assert.equal(changeText(NaN), null);
  assert.equal(spanText(0, 40 * 60_000), "Last 40 min");
  assert.equal(spanText(0, 300 * 60_000), "Last 5 h");
  assert.equal(spanText(0, 10_000), "Last 1 min");
});

test("emptyChartText: why there's no line yet", () => {
  assert.equal(emptyChartText({ missing: true }), "No chart for this coin");
  assert.equal(emptyChartText({ stats: { candles: [] } }), "The chart starts with the first trades");
  assert.equal(emptyChartText({ stats: { candles: [] }, error: "couldn't read this right now" }), "The chart starts with the first trades");
  assert.equal(emptyChartText({ error: "couldn't read this right now" }), "No chart right now", "the read failed: not loading");
  assert.equal(emptyChartText({}), "Loading the chart");
});
