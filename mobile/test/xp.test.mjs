// XP rows as the phone shows them (src/xp/rows.js): merged by wallet, titles on the shared
// curve, the leaderboard's rows, and your rank.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_TOP, LEVEL_XP, POINTS, TITLES, levelOf } from "../../engine/src/xp.js";
import { BOARDS, GENESIS_XP, TITLE_NAMES, boardOf, mainTitleOf, mergeXp, rankOf, tagWords, titlesOf, xpNum, xpText } from "../src/xp/rows.js";

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

test("Genesis adds the shared table's points", () => {
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

// `n` wallets "W000"... with `kol` XP n, n - 1, ..., 1: W000 first
const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => {
  const w = `W${String(i).padStart(3, "0")}`;
  return [w, row(w, { kol: n - i })];
}));

test("a board lists the top BOARD_TOP only", () => {
  const b = boardOf(many(BOARD_TOP + 100), "overall", null);
  assert.equal(b.length, BOARD_TOP);
  assert.equal(b[BOARD_TOP - 1].rank, BOARD_TOP);
  assert.equal(b[BOARD_TOP - 1].wallet, `W${BOARD_TOP - 1}`);
  assert.equal(boardOf(many(3), "kol", null).length, 3);
});

test("rank: unknown until the rows are loaded and yours is there", () => {
  const rows = { A: row("A", { kol: 50 }) };
  assert.deepEqual(rankOf(rows, "overall", "A", false), { kind: "unknown" }, "no xp message yet");
  assert.deepEqual(rankOf(rows, "overall", "B", true), { kind: "unknown" }, "your row isn't here (yet)");
  assert.deepEqual(rankOf(rows, "overall", null, true), { kind: "unknown" }, "no wallet");
  assert.deepEqual(rankOf({}, "kol", "A", true), { kind: "unknown" });
});

test("rank: none with no XP on that board", () => {
  const rows = { A: row("A", { kol: 50 }), B: row("B"), G: row("G", {}, { total: GENESIS_XP }) };
  assert.deepEqual(rankOf(rows, "overall", "B", true), { kind: "none" });
  assert.deepEqual(rankOf(rows, "dev", "A", true), { kind: "none" }, "XP, but none on this title");
  assert.deepEqual(rankOf(rows, "kol", "G", true), { kind: "none" }, "Genesis counts only on Overall");
  assert.equal(rankOf(rows, "overall", "G", true).kind, "ranked");
});

test("rank: rows ahead (more XP, ties by wallet) plus one, of everyone on the board; the entry as the board's", () => {
  const rows = {
    C: row("C", { kol: 300 }),
    A: row("A", { dev: 100, kol: 200 }),
    B: row("B", { raider: 300 }),
    Z: row("Z"),
    G: row("G", {}, { total: GENESIS_XP }),
  };
  assert.deepEqual(rankOf(rows, "overall", "B", true), { kind: "ranked", rank: 2, of: 4, wallet: "B", xp: 300, title: "raider", level: 3 });
  assert.deepEqual(rankOf(rows, "overall", "G", true), { kind: "ranked", rank: 4, of: 4, wallet: "G", xp: GENESIS_XP, title: null, level: null });
  assert.deepEqual(rankOf(rows, "kol", "A", true), { kind: "ranked", rank: 2, of: 2, wallet: "A", xp: 200, title: "kol", level: 2 });
  for (const board of ["overall", ...TITLES]) {
    for (const r of boardOf(rows, board, null)) {
      const { kind, rank, of, ...entry } = rankOf(rows, board, r.wallet, true);
      assert.equal(kind, "ranked");
      assert.equal(rank, r.rank, `${board} ${r.wallet}`);
      assert.deepEqual(entry, { wallet: r.wallet, xp: r.xp, title: r.title, level: r.level });
    }
  }
});

test("rank: from BOARD_TOP rows on the board, `of` is BOARD_TOP+; past it, only that you're outside", () => {
  const full = many(BOARD_TOP);
  assert.deepEqual(rankOf(many(BOARD_TOP - 1), "kol", "W010", true).of, BOARD_TOP - 1, "fewer: all of them are here");
  assert.equal(rankOf(full, "kol", "W010", true).of, `${BOARD_TOP}+`);
  assert.equal(rankOf(full, "kol", "W010", true).rank, 11);
  const last = rankOf(full, "overall", `W${BOARD_TOP - 1}`, true);
  assert.deepEqual([last.kind, last.rank, last.of], ["ranked", BOARD_TOP, `${BOARD_TOP}+`]);
  // a row the board didn't have (read on connect, or a change pushed later) ranks past it
  const more = many(BOARD_TOP + 1);
  assert.deepEqual(rankOf(more, "overall", `W${BOARD_TOP}`, true), { kind: "past", wallet: `W${BOARD_TOP}`, xp: 1, title: "kol", level: 1 });
});

test("rank: a tie at the cut goes by wallet, as the board's last row does", () => {
  const rows = { ...many(BOARD_TOP), W500: row("W500", { kol: 1 }) }; // W499 and W500 both have 1
  assert.equal(rankOf(rows, "overall", "W499", true).rank, BOARD_TOP);
  assert.equal(rankOf(rows, "overall", "W500", true).kind, "past");
  assert.equal(boardOf(rows, "overall", null).at(-1).wallet, "W499");
});

test("rank: once BOARD_TOP rows have XP, a title's board may miss some, so `of` is its count and a plus", () => {
  const rows = { ...many(BOARD_TOP), D: row("D", { dev: 50 }) };
  assert.deepEqual(rankOf(rows, "dev", "D", true), { kind: "ranked", rank: 1, of: "1+", wallet: "D", xp: 50, title: "dev", level: 1 });
  const few = { ...many(3), D: row("D", { dev: 50 }) };
  assert.equal(rankOf(few, "dev", "D", true).of, 1, "fewer rows: every board is whole");
});

test("a tag's words for a screen reader", () => {
  assert.equal(tagWords("kol", 2), "KOL level 2");
  assert.equal(tagWords("diamond", 5), "Diamond Hands level 5");
  assert.equal(tagWords(null, null), "");
});
