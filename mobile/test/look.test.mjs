// The look's pure parts (src/xp/look.js): Roman levels, the tag's words and colour, the bar to
// the next level, the podium's rings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVEL_XP, TITLES } from "../../engine/src/xp.js";
import { C } from "../src/ui/theme.js";
import { PODIUM, TAG_NAMES, TITLE_COLORS, nextLevelOf, roman, tagText } from "../src/xp/look.js";

test("levels in Roman numerals, I to V", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(roman), ["I", "II", "III", "IV", "V"]);
  assert.equal(roman(LEVEL_XP.length), "V", "the top level has a numeral");
});

test("a tag reads the short title and its level, in the title's colour", () => {
  assert.deepEqual(Object.keys(TAG_NAMES), TITLES);
  assert.deepEqual(Object.keys(TITLE_COLORS), TITLES);
  assert.equal(tagText("kol", 2), "KOL II");
  assert.equal(tagText("diamond", 5), "Diamond V");
  assert.deepEqual(TITLE_COLORS, { dev: C.up, kol: C.accent, raider: C.down, diamond: C.migrated });
});

test("the bar to the next level: XP over the next level's start; at the top, Max", () => {
  assert.deepEqual(nextLevelOf(0), { level: 1, to: 100, left: 100, max: false, fill: 0 });
  assert.deepEqual(nextLevelOf(1240), { level: 4, to: 2000, left: 760, max: false, fill: 0.62 });
  assert.deepEqual(nextLevelOf(300), { level: 3, to: 800, left: 500, max: false, fill: 0.375 });
  assert.deepEqual(nextLevelOf(2000), { level: 5, to: null, left: 0, max: true, fill: 1 });
  assert.deepEqual(nextLevelOf(9999), { level: 5, to: null, left: 0, max: true, fill: 1 });
});

test("the podium: gold, silver, bronze", () => {
  assert.equal(PODIUM[1], C.gold);
  assert.equal(PODIUM[2], "#c9ced8");
  assert.equal(PODIUM[3], "#d08b5b");
});
