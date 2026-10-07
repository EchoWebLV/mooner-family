// XP rows as the phone shows them (src/xp/rows.js): merged by wallet, titles on the shared
// curve, the streak line, and the leaderboard's rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, LEVEL_XP, POINTS, TITLES, levelOf } from "../../engine/src/xp.js";
import { BOARDS, GENESIS_XP, TITLE_NAMES, boardOf, mainTitleOf, meOf, mergeXp, titlesOf, xpNum, xpText } from "../src/xp/rows.js";

const row = (wallet, titles = {}, more = {}) => {
  const t = { dev: 0, kol: 0, raider: 0, diamond: 0, ...titles };
  return { wallet, total: Object.values(t).reduce((a, b) => a + b, 0), titles: t, streak: { days: 0, best: 0, last: null }, genesis: null, ...more };
};

test("rows merge by wallet: a newer row replaces, none goes, junk is skipped", () => {
  const a = row("A", { dev: 100 });
  const b = row("B", { kol: 25 });
  const one = mergeXp({}, [a, b]);
  assert.deepEqual(Object.keys(one).sort(), ["A", "B"]);
  const a2 = row("A", { dev: 300 });
  const two = mergeXp(one, [a2, null, { total: 5 }, { wallet: 7 }]);
  assert.equal(two.A, a2);
  assert.equal(one.A, a, "the old object is never changed");
  assert.equal(two.B, b, "a row not in the message stays");
  assert.equal(Object.keys(two).length, 2);
  assert.equal(mergeXp(two, "nope"), two, "not a list: nothing changes");
  assert.equal(mergeXp(two, []), two, "no rows: the same object, so screens don't redraw");
});

test("onlyNew: a one-off read never replaces a row a push brought", () => {
  const pushed = row("A", { dev: 300 });
  const read = row("A", { dev: 100 });
  const s = mergeXp({ A: pushed }, [read], true);
  assert.equal(s.A, pushed);
  assert.equal(mergeXp({}, [read], true).A, read, "no row yet: the read's goes in");
});

test("titles in TITLES order, with their names, XP and level on the shared curve", () => {
  const r = row("A", { dev: LEVEL_XP[2], kol: LEVEL_XP[1] - 1, raider: 0, diamond: LEVEL_XP[4] });
  const t = titlesOf(r);
  assert.deepEqual(t.map((x) => x.title), TITLES);
  assert.deepEqual(t.map((x) => x.name), ["Dev", "KOL", "Raider", "Diamond Hands"]);
  assert.deepEqual(t.map((x) => x.level), [3, 1, 1, 5]);
  assert.deepEqual(t.map((x) => x.level), t.map((x) => levelOf(x.xp)));
  assert.deepEqual(Object.keys(TITLE_NAMES), TITLES);
  assert.deepEqual(titlesOf({ wallet: "B" }).map((x) => x.xp), [0, 0, 0, 0], "a row cut short reads as zeros");
});

test("the main title is the one with the most XP; ties go to the earlier title; none with no XP", () => {
  assert.equal(mainTitleOf(row("A", { kol: 50, raider: 75 })).title, "raider");
  assert.equal(mainTitleOf(row("A", { dev: 100, diamond: 100 })).title, "dev");
  assert.equal(mainTitleOf(row("A")), null);
  assert.equal(mainTitleOf(undefined), null);
});

test("Me: the total, the four titles, the streak line as of now, and Genesis", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const r = row("A", { dev: 100 }, { total: 100 + GENESIS_XP, streak: { days: 3, best: 5, last: "2026-10-01" }, genesis: { mint: "M", at: 1 } });
  const me = meOf(r, now);
  assert.equal(me.total, 100 + GENESIS_XP);
  assert.equal(me.titles.length, 4);
  assert.equal(me.streak, "3-day streak");
  assert.deepEqual(me.genesis, { mint: "M", at: 1 });
  assert.equal(meOf(r, now + 2 * DAY_MS).streak, "Best streak: 5 days");
  assert.equal(meOf(row("B"), now).streak, "No streak yet");
  assert.equal(meOf(row("B"), now).genesis, null);
  assert.equal(meOf(undefined, now), null, "no row yet: nothing to show (a spinner)");
  assert.equal(GENESIS_XP, POINTS.genesis.points);
});

test("XP reads with thousands grouped", () => {
  assert.equal(xpText(0), "0 XP");
  assert.equal(xpText(950), "950 XP");
  assert.equal(xpText(1150), "1,150 XP");
  assert.equal(xpText(1234567), "1,234,567 XP");
  assert.equal(xpNum(1234567), "1,234,567");
  assert.equal(xpNum(950), "950");
});

test("the boards: Overall, then one per title in TITLES order", () => {
  assert.deepEqual(BOARDS.map((b) => b.key), ["overall", ...TITLES]);
  assert.deepEqual(BOARDS.map((b) => b.name), ["Overall", "Dev", "KOL", "Raider", "Diamond Hands"]);
});

test("Overall: by total, ties by wallet; the tag is the main title and its level; yours is marked", () => {
  const rows = {
    C: row("C", { kol: 300 }),
    A: row("A", { dev: 100, kol: 200 }),
    B: row("B", { raider: 300 }),
    Z: row("Z"),
    G: row("G", {}, { total: GENESIS_XP, genesis: { mint: "M", at: 1 } }),
  };
  const b = boardOf(rows, "overall", "B");
  assert.deepEqual(b.map((r) => r.wallet), ["A", "B", "C", "G"], "300 x3 by wallet, then Genesis only; no XP: not on the board");
  assert.deepEqual(b.map((r) => r.rank), [1, 2, 3, 4]);
  assert.deepEqual(b.map((r) => r.xp), [300, 300, 300, GENESIS_XP]);
  assert.deepEqual([b[0].title, b[0].level], ["kol", 2]);
  assert.deepEqual([b[1].title, b[1].level], ["raider", 3]);
  assert.deepEqual([b[3].title, b[3].level], [null, null], "no title XP: no title tag");
  assert.deepEqual(b.map((r) => r.mine), [false, true, false, false]);
});

test("a title's board: by that title's XP, ties by wallet, that title and its level as the tag", () => {
  const rows = { A: row("A", { kol: 25 }), B: row("B", { kol: 300, dev: 800 }), C: row("C", { dev: 900 }), D: row("D", { kol: 25 }) };
  const b = boardOf(rows, "kol", null);
  assert.deepEqual(b.map((r) => [r.wallet, r.xp, r.title, r.level]), [["B", 300, "kol", 3], ["A", 25, "kol", 1], ["D", 25, "kol", 1]]);
  assert.ok(b.every((r) => r.mine === false), "no wallet connected: nothing is yours");
  assert.deepEqual(boardOf({}, "dev", "A"), []);
});
