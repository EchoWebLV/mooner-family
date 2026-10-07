// XP rows (the server's, engine/server/xp.js: pushed on `profiles` as "xp", and GET
// /api/xp/<wallet>) as the phone shows them. The titles, the level curve, the points and the
// streak's rule are engine/src/xp.js's; nothing here keeps a copy. Pure, so Node tests it.
import { BOARD_TOP, POINTS, TITLES, levelOf } from "../../../engine/src/xp.js";

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

/** A board's XP of a row: "overall" or a title. */
const xpGetter = (board) => (board === "overall" ? (r) => r.total ?? 0 : (r) => r.titles?.[board] ?? 0);

/** A row on `board` with its XP there: { wallet, xp, title, level }. On Overall the title is
 *  the main title (null with no title XP) and its level; on a title's board, that title and
 *  its level. */
function entryOf(r, board, xp) {
  if (board !== "overall") return { wallet: r.wallet, xp, title: board, level: levelOf(xp) };
  const main = mainTitleOf(r);
  return { wallet: r.wallet, xp, title: main?.title ?? null, level: main?.level ?? null };
}

/** One board's top BOARD_TOP rows, most XP first, ties by wallet; a wallet with no XP on it
 *  isn't listed. `board`: "overall" or a title. `me`: the connected wallet, or null.
 *  Each: { wallet, rank, xp, title, level, mine } (entryOf). */
export function boardOf(rows, board, me) {
  const xpOf = xpGetter(board);
  return Object.values(rows)
    .filter((r) => xpOf(r) > 0)
    .sort((a, b) => xpOf(b) - xpOf(a) || (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0))
    .slice(0, BOARD_TOP)
    .map((r, i) => ({ ...entryOf(r, board, xpOf(r)), rank: i + 1, mine: r.wallet === me }));
}

/** Where `wallet` stands on `board` in `rows` (the store's `xp`), once `loaded` (its first
 *  "xp" message). Points only grow, so a wallet missing from `rows` has no more total than
 *  the server's board's last: on Overall a rank up to BOARD_TOP is exact (but for a tie at
 *  the cut), one past it is only a floor, and fewer than BOARD_TOP rows with XP are all there
 *  are. A title's board comes from the same rows (top by total), so once more than BOARD_TOP
 *  wallets have XP it can miss some (spec: Ranks). The rank is the rows ahead (more XP, ties
 *  by wallet) plus one, counted without a sort.
 *   { kind: "unknown" }                    not loaded, no wallet, or no row of yours yet
 *   { kind: "none" }                       no XP on this board
 *   { kind: "past", ...entry }             behind the top BOARD_TOP
 *   { kind: "ranked", rank, of, ...entry } `of`: how many are on the board, or "500+"
 *  `entry`: entryOf's { wallet, xp, title, level }. */
export function rankOf(rows, board, wallet, loaded) {
  const mine = wallet ? rows[wallet] : undefined;
  if (!loaded || !mine) return { kind: "unknown" };
  const xpOf = xpGetter(board);
  const xp = xpOf(mine);
  if (xp <= 0) return { kind: "none" };
  let ahead = 0;
  let on = 0;
  for (const r of Object.values(rows)) {
    const x = xpOf(r);
    if (x <= 0) continue;
    on++;
    if (x > xp || (x === xp && r.wallet < wallet)) ahead++;
  }
  const entry = entryOf(mine, board, xp);
  if (ahead >= BOARD_TOP) return { kind: "past", ...entry };
  return { kind: "ranked", rank: ahead + 1, of: on < BOARD_TOP ? on : `${BOARD_TOP}+`, ...entry };
}
