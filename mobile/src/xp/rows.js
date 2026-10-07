// XP rows (the server's, engine/server/xp.js: pushed on `profiles` as "xp", and GET
// /api/xp/<wallet>) as the phone shows them. The titles, the level curve, the points and the
// streak's rule are engine/src/xp.js's; nothing here keeps a copy. Pure, so Node tests it.
import { POINTS, TITLES, levelOf, streakLine } from "../../../engine/src/xp.js";

/** What each title is called on screen. */
export const TITLE_NAMES = { dev: "Dev", kol: "KOL", raider: "Raider", diamond: "Diamond Hands" };

/** The leaderboard's tabs: Overall (by total), then one per title (by that title's XP). */
export const BOARDS = [{ key: "overall", name: "Overall" }, ...TITLES.map((t) => ({ key: t, name: TITLE_NAMES[t] }))];

/** What the Seeker Genesis check adds, once. */
export const GENESIS_XP = POINTS.genesis.points;

/** 1150 as "1,150": thousands by hand (Hermes' Intl may be missing). */
export const xpNum = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");

/** "1,150 XP". */
export const xpText = (n) => `${xpNum(n)} XP`;

/** `rows` merged into `prev` (wallet -> row): a row replaces that wallet's older one; no row
 *  goes; anything without a wallet is skipped. `onlyNew`: keep the rows `prev` has (a one-off
 *  read must not undo a push that came while it was on its way). Nothing new: `prev` itself. */
export function mergeXp(prev, rows, onlyNew = false) {
  if (!Array.isArray(rows)) return prev;
  let next = prev;
  for (const r of rows) {
    if (!r || typeof r.wallet !== "string" || (onlyNew && Object.hasOwn(next, r.wallet))) continue;
    if (next === prev) next = { ...prev };
    next[r.wallet] = r;
  }
  return next;
}

/** The four titles in TITLES order: { title, name, xp, level }. */
export function titlesOf(row) {
  return TITLES.map((title) => {
    const xp = row?.titles?.[title] ?? 0;
    return { title, name: TITLE_NAMES[title], xp, level: levelOf(xp) };
  });
}

/** The title with the most XP (a tie goes to the earlier title), or null with none. */
export function mainTitleOf(row) {
  let best = null;
  for (const t of titlesOf(row)) if (t.xp > 0 && (!best || t.xp > best.xp)) best = t;
  return best;
}

/** What Me shows from your row as of `now` (ms), or null while there's no row. */
export function meOf(row, now) {
  if (!row) return null;
  return { total: row.total ?? 0, titles: titlesOf(row), streak: streakLine(row.streak, now), genesis: row.genesis ?? null };
}

/** One board's rows, most XP first, ties by wallet; a wallet with no XP on it isn't listed.
 *  `board`: "overall" or a title. `me`: the connected wallet, or null.
 *  Each: { wallet, rank, xp, title, level, mine }. On Overall the title is the main title
 *  (null with no title XP) and its level; on a title's board, that title and its level. */
export function boardOf(rows, board, me) {
  const xpOf = board === "overall" ? (r) => r.total ?? 0 : (r) => r.titles?.[board] ?? 0;
  return Object.values(rows)
    .filter((r) => xpOf(r) > 0)
    .sort((a, b) => xpOf(b) - xpOf(a) || (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0))
    .map((r, i) => {
      const xp = xpOf(r);
      let title;
      let level;
      if (board === "overall") {
        const main = mainTitleOf(r);
        title = main?.title ?? null;
        level = main?.level ?? null;
      } else {
        title = board;
        level = levelOf(xp);
      }
      return { wallet: r.wallet, rank: i + 1, xp, title, level, mine: r.wallet === me };
    });
}
