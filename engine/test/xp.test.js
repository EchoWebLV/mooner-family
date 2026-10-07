// XP (spec "XP ledger"): the shared rules (src/xp.js) and the server's ledger (server/xp.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_TOP, DAY_MS, LEVEL_XP, POINTS, TITLES, levelOf, streakOf, utcDay } from "../src/xp.js";

test("xp rules: four titles, the web's curve, one points table", () => {
  assert.deepEqual(TITLES, ["dev", "kol", "raider", "diamond"]);
  assert.deepEqual(LEVEL_XP, [0, 100, 300, 800, 2000], "the curve web/src/lib/constants.ts had");
  for (const [reason, p] of Object.entries(POINTS)) {
    assert.ok(Number.isInteger(p.points) && p.points > 0, `${reason} is worth whole points`);
    assert.ok(p.title === null ? reason === "genesis" : TITLES.includes(p.title), `${reason} counts for a title`);
  }
  assert.deepEqual(Object.keys(POINTS), ["devLaunch", "devMigrate", "kolLaunch", "kolMigrate", "raiderJoin", "diamondMigrate", "genesis"]);
});

test("xp rules: the board on `profiles` is the top 500", () => {
  assert.equal(BOARD_TOP, 500);
});

test("xp rules: levelOf follows the curve, 1 to 5", () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(99), 1);
  assert.equal(levelOf(100), 2);
  assert.equal(levelOf(299), 2);
  assert.equal(levelOf(300), 3);
  assert.equal(levelOf(800), 4);
  assert.equal(levelOf(1999), 4);
  assert.equal(levelOf(2000), 5);
  assert.equal(levelOf(1e9), 5);
});

test("xp rules: the streak counts UTC days in a row, up to today or yesterday", () => {
  const day = utcDay(Date.UTC(2026, 9, 1, 23, 59)); // 2026-10-01
  assert.equal(utcDay(Date.UTC(2026, 9, 2, 0, 0)), day + 1, "a new UTC day at midnight UTC");
  assert.equal(DAY_MS, 86_400_000);
  assert.deepEqual(streakOf([], day), { days: 0, best: 0, last: null });
  assert.deepEqual(streakOf([day], day), { days: 1, best: 1, last: "2026-10-01" });
  assert.deepEqual(streakOf([day - 2, day - 1, day, day], day), { days: 3, best: 3, last: "2026-10-01" }, "a repeat day counts once");
  assert.deepEqual(streakOf([day - 1, day - 2], day), { days: 2, best: 2, last: "2026-09-30" }, "nothing today yet: yesterday's run still stands");
  assert.deepEqual(streakOf([day - 3, day - 2], day), { days: 0, best: 2, last: "2026-09-29" }, "a whole day with none ends it");
  assert.deepEqual(streakOf([day - 9, day - 8, day - 7, day - 6, day - 1, day], day), { days: 2, best: 4, last: "2026-10-01" });
});
