// The streak as a screen shows it (src/xp.js streakDays, streakLine): the web and the phone
// read the row's `streak` the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, streakDays, streakLine } from "../src/xp.js";

const at = (iso) => Date.parse(iso);

test("the streak holds through the next UTC day and is gone the day after; the line says so", () => {
  const s = { days: 3, best: 5, last: "2026-10-01" };
  assert.equal(streakDays(s, at("2026-10-01T23:59:59Z")), 3);
  assert.equal(streakDays(s, at("2026-10-02T23:59:59Z")), 3, "yesterday: still on");
  assert.equal(streakDays(s, at("2026-10-03T00:00:00Z")), 0, "a whole day with none");
  assert.equal(streakLine(s, at("2026-10-02T12:00:00Z")), "3-day streak");
  assert.equal(streakLine(s, at("2026-10-04T00:00:00Z")), "Best streak: 5 days");
  assert.equal(streakLine({ days: 0, best: 1, last: "2026-09-01" }, at("2026-10-04T00:00:00Z")), "Best streak: 1 day");
  assert.equal(streakLine({ days: 0, best: 0, last: null }, 5 * DAY_MS), "No streak yet");
});

test("a row without a streak (an old server, a cut-off row) reads as none", () => {
  assert.equal(streakDays(undefined, 5 * DAY_MS), 0);
  assert.equal(streakDays({ days: 2, best: 2, last: null }, 5 * DAY_MS), 0);
  assert.equal(streakLine(undefined, 5 * DAY_MS), "No streak yet");
  assert.equal(streakLine({ days: 0, best: 0 }, 5 * DAY_MS), "No streak yet");
});
