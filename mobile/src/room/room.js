// What the presale room shows, as plain functions of the server's views (no React Native, so
// Node tests run them). Amounts are BigInt lamports; `nowMs` is the screen's 1 s clock.
import { canGetBack, clock, fillOf, joinAmounts, joinCheck, seatOf, secondsLeft, stageOf } from "../../../engine/src/views.js";
import { solText } from "../ui/format.js";
import { C } from "../ui/theme.js";

/** A presale key as the server's topics take it (base58, 32 to 44 characters). */
export const isKey = (k) => typeof k === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(k);

const PAST = new Set(["launching", "live", "migrated"]);

/** The ring and the line under it: { stage, fill, color, under }. */
export function heroOf(view, launched, N, nowMs) {
  const stage = stageOf(view, launched);
  const fill = fillOf(view, N);
  const color = stage === "expired" ? C.text2 : PAST.has(stage) || fill >= 1 ? C.up : C.er;
  const under =
    stage === "presale" ? `${clock(secondsLeft(view, nowMs))} left`
    : stage === "launching" ? "Launching on Solana"
    : stage === "expired" ? "Closed"
    : "Live";
  return { stage, fill, color, under };
}

/** The room's sticky bottom: { kind: "connect" } | { kind: "seat", seat } | { kind: "join" }
 *  | { kind: "why", why }. With no wallet it offers to connect only when someone could join. */
export function bottomOf(view, wallet, N, nowMs) {
  if (!wallet) {
    const anyone = joinCheck(view, null, N, nowMs);
    return anyone.ok ? { kind: "connect" } : { kind: "why", why: anyone.why };
  }
  const seat = seatOf(view, wallet);
  if (seat) return { kind: "seat", seat };
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

/** Your seat in words: { title, note, back }. note: "claimed" (tokens arrived), "locked"
 *  (in the pool, launching or live), "creator" (stays in until launch) or null; back: whether
 *  "Get my SOL back" applies. */
export function seatPlan(view, launched, seat, wallet, nowMs) {
  const stage = stageOf(view, launched);
  const out = seat.commit === 0n;
  const title = out
    ? `In your seat · ${solText(seat.deposit)} SOL, out of the pool`
    : `You're in · ${solText(seat.commit)} SOL`;
  let note = null;
  if (seat.claimed) note = "claimed";
  else if (!out && PAST.has(stage)) note = "locked";
  else if (seat.creator) note = "creator";
  const back = !seat.claimed && canGetBack(view, wallet, nowMs);
  return { title, note, back };
}

/** The launch moment's phase after the stage moves from `prev` to `stage`: null (none),
 *  "launching", "live" or "done" (closed, or the launch failed). It starts only on a change
 *  seen while the room is open: `prev` null is the first sight and starts nothing. */
export function momentStep(phase, prev, stage) {
  if (phase === "done" || prev == null || prev === stage) return phase;
  const live = stage === "live" || stage === "migrated";
  if (phase) {
    if (stage === "expired") return "done";
    return phase === "launching" && live ? "live" : phase;
  }
  if (prev === "presale" && stage === "launching") return "launching";
  if ((prev === "presale" || prev === "launching") && live) return "live";
  return null;
}

const LINKS = [["twitter", "X"], ["telegram", "Telegram"], ["website", "Website"]];

/** The coin's links that are there, as [{ label, url }]: https only. */
export function linksOf(token) {
  const links = token?.links ?? {};
  return LINKS.filter(([k]) => typeof links[k] === "string" && /^https:\/\/\S+$/i.test(links[k].trim()))
    .map(([k, label]) => ({ label, url: links[k].trim() }));
}

/** "09:05": a chat row's time (ms) on this phone's clock. */
export function hhmm(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}
