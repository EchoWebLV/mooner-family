// What the presale room shows, as plain functions of the server's views (no React Native, so
// Node tests run them). Amounts are BigInt lamports; `nowMs` is the screen's 1 s clock.
import { canGetBack, clock, fillOf, joinAmounts, joinCheck, roomOf, seatOf, secondsLeft, stageOf, whoIsIn } from "../../../engine/src/views.js";
import { solText } from "../ui/format.js";
import { C } from "../ui/theme.js";

/** A presale key as the server's topics take it (base58, 32 to 44 characters). */
export const isKey = (k) => typeof k === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(k);

/** The link's `?ref=` for the room to note, or null while there's nothing to note yet.
 *  `account`: wallet.js useAccount(), undefined while the saved wallet is still being read.
 *  Noting waits for that read, or a cold start opened from your own link would note it as a
 *  friend's (the store's wallet is still null) and the friend's ref would be lost. */
export const refToNote = (valid, ref, account) => (valid && ref && account !== undefined ? ref : null);

const PAST = new Set(["launching", "live", "migrated"]);

/** The ring and the line under it: { stage, fill, color, under }. */
export function heroOf(view, launched, N, nowMs) {
  const stage = stageOf(view, launched);
  const fill = fillOf(view, N);
  const color = stage === "expired" ? C.text2 : PAST.has(stage) || fill >= 1 ? C.up : C.er;
  const left = secondsLeft(view, nowMs);
  const under =
    stage === "presale" ? (left > 0 ? `${clock(left)} left` : "Time's up")
    : stage === "launching" ? "Launching on Meteora"
    : stage === "expired" ? "Closed"
    : "Live";
  return { stage, fill, color, under };
}

/** The pool as `n` cells, each a tenth (with n 10) of `target`, filled 0..1 by `raised`
 *  (integer lamports: BigInt, string or integer number). No target (0 or missing): none filled. */
export function cellsOf(raised, target, n = 10) {
  const t = Number(BigInt(target ?? 0));
  const r = Number(BigInt(raised ?? 0));
  const f = t > 0 ? Math.min(1, Math.max(0, r / t)) : 0;
  return Array.from({ length: n }, (_, i) => Math.min(1, Math.max(0, f * n - i)));
}

/** "1 wallet in", "3 wallets in". */
export const walletsIn = (n) => `${n} wallet${n === 1 ? "" : "s"} in`;

/** Whether `view` says who's in: a detail view (its `seats`) or a list item that carries
 *  `users`. A list item without them says nothing, so the room shows no count or "Nobody yet". */
export const whoKnown = (view) => Array.isArray(view?.seats) || Array.isArray(view?.users);

/** Under the pool's cells: "3 wallets in · 1.25 SOL to go", or "… · full". With no target
 *  known (N.TARGET 0 or missing) just "3 wallets in", as cellsOf then shows no cell filled. */
export function poolLine(view, N) {
  const wallets = walletsIn(whoIsIn(view).length);
  if (!(BigInt(N?.TARGET ?? 0) > 0n)) return wallets;
  const left = roomOf(view, N);
  return left > 0n ? `${wallets} · ${solText(left)} SOL to go` : `${wallets} · full`;
}

/** The chat lines that arrived since `lastId` (rows the store marked `live`: pushed one by
 *  one, never a snapshot's), and the newest id now: { lines, lastId }. `lastId` null is the
 *  first read, when nothing is new. */
export function newLines(rows, lastId) {
  const newest = rows.reduce((m, r) => Math.max(m, r.id), lastId ?? -Infinity);
  if (lastId == null) return { lines: [], lastId: newest };
  return { lines: rows.filter((r) => r.live && r.id > lastId), lastId: newest };
}

/** newLines for one channel's rows: { lines, last }, `last` being { channel, lastId } to pass
 *  back next time, or null. Chat ids are one count across every channel, so a last id read on
 *  another channel means nothing here: a new channel, or none yet (`channel` undefined), is a
 *  first read. */
export function newLinesOn(rows, channel, last) {
  if (channel == null) return { lines: [], last: null };
  const r = newLines(rows, last?.channel === channel ? last.lastId : null);
  return { lines: r.lines, last: { channel, lastId: r.lastId } };
}

/** The wallets in `who` (whoIsIn rows) that `before` (a Set of wallets from the last read)
 *  hadn't. `before` null is the first read: nobody is new. */
export function joinedSince(before, who) {
  if (before == null) return [];
  return who.filter((w) => !before.has(w.user)).map((w) => w.user);
}

/** The commit to remember for claimedOf after `view`: this wallet's seat's commit once
 *  commits are fixed (any state but OPEN; set_commit runs only while OPEN), else `had`.
 *  `view`: a detail view (with `seats`). A get-back closes a seat while OPEN, so it never counts. */
export function lockedCommit(view, wallet, had) {
  if (!wallet || !Array.isArray(view?.seats) || view.state === "OPEN") return had;
  const seat = seatOf(view, wallet);
  return seat ? seat.commit : had;
}

/** Whether `wallet`'s tokens arrived. The program never sets F_CLAIMED: claim closes the seat
 *  (finish.rs). Once the pool is full, a seat with SOL in it leaves a launched presale only by
 *  claim (settle_seat refunds a committed seat only when EXPIRED or FAILED). `had`: the
 *  seat's commit (BigInt) last seen after OPEN, or null. */
export function claimedOf(view, wallet, had) {
  if (!wallet || !Array.isArray(view?.seats) || !(had > 0n)) return false;
  const launched = view.state === "SETTLED" || (view.state === "CLOSED" && !!view.launch);
  return launched && !seatOf(view, wallet);
}

/** The room's sticky bottom: { kind: "connect" } | { kind: "seat", seat } | { kind: "claimed" }
 *  | { kind: "join" } | { kind: "why", why }. With no wallet it offers to connect only when
 *  someone could join. `claimed`: claimedOf(...), for when the seat is gone. */
export function bottomOf(view, wallet, N, nowMs, claimed) {
  if (!wallet) {
    const anyone = joinCheck(view, null, N, nowMs);
    return anyone.ok ? { kind: "connect" } : { kind: "why", why: anyone.why };
  }
  const seat = seatOf(view, wallet);
  if (seat) return { kind: "seat", seat };
  if (claimed) return { kind: "claimed" };
  const check = joinCheck(view, wallet, N, nowMs);
  return check.ok ? { kind: "join" } : { kind: "why", why: check.why };
}

/** A chip's join: { deposit, commit, note }. When less than the chip fits, `note` says how
 *  much does, and that the rest of the seat comes back after launch when the seat holds more
 *  than goes in (it holds at least MIN_SEAT). */
export function pickOf(view, N, chip) {
  const { deposit, commit } = joinAmounts(view, N, chip);
  let note = null;
  if (commit > 0n && commit < chip) {
    note = deposit > commit
      ? `Only ${solText(commit)} SOL fits; the rest comes back to you after launch.`
      : `Only ${solText(commit)} SOL fits.`;
  }
  return { deposit, commit, note };
}

/** What the wallet lacks for a join, as one line, or null. `extra`: joinCost() (BigInt, or
 *  null while it's read); `lamports`: the wallet's SOL (a number, or null while it's read).
 *  Unknown amounts block nothing: the wallet and the program have the last word. */
export function shortOf(deposit, extra, lamports) {
  if (extra == null || lamports == null) return null;
  const have = BigInt(Math.floor(Number(lamports)));
  const need = deposit + extra;
  if (need <= have) return null;
  return `You need ${solText(need, 3)} SOL for this (the seat plus about ${solText(extra, 4)} SOL in fees and rent). You have ${solText(have, 3)}.`;
}

/** Your seat in words: { title, note, back }. note: "locked" (in the pool, launching or
 *  live), "creator" (stays in until launch) or null; back: whether "Get my SOL back" applies. */
export function seatPlan(view, launched, seat, wallet, nowMs) {
  const stage = stageOf(view, launched);
  const out = seat.commit === 0n;
  const title = out
    ? `In your seat · ${solText(seat.deposit)} SOL, out of the pool`
    : `Your seat · ${solText(seat.commit)} SOL`;
  let note = null;
  if (!out && PAST.has(stage)) note = "locked";
  else if (seat.creator) note = "creator";
  const back = canGetBack(view, wallet, nowMs);
  return { title, note, back };
}

/** The launch moment's phase after the stage moves from `prev` to `stage`: null (none),
 *  "launching", "live", "failed" (the launch didn't go through: it says so until closed) or
 *  "done" (closed). It starts on a change seen while the room is open, or on first sight
 *  (`prev` null) of a presale already launching: the room opened late, onto the launching
 *  screen. A first sight of one already live or expired starts nothing. */
export function momentStep(phase, prev, stage) {
  if (phase === "done" || prev === stage) return phase;
  if (prev == null) return phase == null && stage === "launching" ? "launching" : phase;
  const live = stage === "live" || stage === "migrated";
  if (phase) {
    if (stage === "expired") return phase === "launching" ? "failed" : phase;
    return phase === "launching" && live ? "live" : phase;
  }
  if (prev === "presale" && stage === "launching") return "launching";
  if ((prev === "presale" || prev === "launching") && live) return "live";
  return null;
}

/** The launch screen to show: null (none), "full" (POOL FULL and the 3-2-1), "launching",
 *  "live" or "failed". `phase`: momentStep's. `late`: the moment started on first sight
 *  (no POOL FULL then). `counted`: the 3-2-1 has finished. `stepsDone`: launchSteps' done,
 *  every committed seat served. `claimed`: this wallet's tokens arrived (claimedOf). The
 *  3-2-1 always plays to the end; the steps behind it don't wait for it. */
export function momentScreen({ phase, late, counted, stepsDone, claimed }) {
  if (phase == null || phase === "done") return null;
  if (phase === "failed") return "failed";
  if (!late && !counted) return "full";
  return claimed || stepsDone ? "live" : "launching";
}

/** The lines a screen reader hears as launch screen `screen` (momentScreen's) shows, in the
 *  screens' own words, less those in `said` (a Set of lines already heard): a screen shown
 *  again says nothing, and tokens arriving on the live screen say just that. Launching says
 *  nothing here: its steps read themselves. `ticker`: the coin's symbol or ""; `claimed`:
 *  this wallet's tokens arrived; `refund`: a failed launch gives this wallet's SOL back. */
export function momentNews(screen, { ticker, claimed, refund } = {}, said) {
  const lines =
    screen === "full" ? ["Pool full.", "Launching on Meteora."]
    : screen === "live" ? [ticker ? `$${ticker} is live on Meteora.` : "Live on Meteora.", claimed && "Your tokens arrived."]
    : screen === "failed" ? ["The launch didn't go through.", refund && "Your SOL comes back by itself."]
    : [];
  return lines.filter((l) => l && !said.has(l));
}

/** "09:05": a chat row's time (ms) on this phone's clock. */
export function hhmm(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}
