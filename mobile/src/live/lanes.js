// Pulse's three lanes (spec §1), as plain functions of the server's `presales` and `launched`
// feeds (each keyed by presale), so Node tests run them.
import { stageOf } from "../../../engine/src/views.js";
import { curveOf } from "../launched/coin.js";

/** How long an expired presale stays in New Pairs (ms), as on the web. */
export const EXPIRED_STAYS_MS = 3_000;

/** `seen` (presale -> when Pulse first saw it expired, ms) after this read: new expired
 *  presales get `nowMs`, presales gone from the feed are dropped. Pass -Infinity as `nowMs`
 *  for the first read, so presales already expired then never show. Returns `seen` itself
 *  when nothing changed. */
export function expiredSeen(seen, presales, launched, nowMs) {
  const next = { ...seen };
  let changed = false;
  for (const v of Object.values(presales)) {
    if (next[v.presale] == null && stageOf(v, launched[v.presale]) === "expired") {
      next[v.presale] = nowMs;
      changed = true;
    }
  }
  for (const k of Object.keys(next)) {
    if (!presales[k]) {
      delete next[k];
      changed = true;
    }
  }
  return changed ? next : seen;
}

/** The stage a presale shows at in New Pairs: stageOf's, but a launched presale (SETTLED, or
 *  CLOSED with its launch) whose `launched` row hasn't arrived yet is "launching", not
 *  "live": Final Stretch, built from the launched feed, doesn't have it yet. */
export function pairStage(view, row) {
  const stage = stageOf(view, row);
  return stage === "live" && !row ? "launching" : stage;
}

/** New Pairs: presales with a coin that are filling or launching (pairStage: a launched one
 *  stays until its `launched` row arrives, so its card never vanishes in between), and
 *  expired ones for EXPIRED_STAYS_MS after `seen` says they expired (one not in `seen` yet
 *  has just expired). Newest opened first. Each item is { presale, view, stage }: `view` the
 *  presales row itself (the same object while the feed doesn't change it), `stage` its
 *  pairStage, so a card needs nothing from the launched feed. */
export function newPairs(presales, launched, nowMs, seen) {
  const items = [];
  for (const v of Object.values(presales)) {
    if (!v.token) continue;
    const stage = pairStage(v, launched[v.presale]);
    const shows =
      stage === "presale" || stage === "launching" || (stage === "expired" && nowMs - (seen[v.presale] ?? nowMs) < EXPIRED_STAYS_MS);
    if (shows) items.push({ presale: v.presale, view: v, stage });
  }
  return items.sort(
    (a, b) =>
      Number(b.view.openedTs ?? 0) - Number(a.view.openedTs ?? 0) || (a.presale < b.presale ? -1 : a.presale > b.presale ? 1 : 0),
  );
}

const curveFill = (r) => (r.pool ? curveOf(r.pool).fill : -1);
const newest = (a, b) => Number(b.launch?.at ?? 0) - Number(a.launch?.at ?? 0);

/** Final Stretch: launched coins on the curve, closest to migrating first, then the newest.
 *  A coin whose pool isn't read yet goes last. */
export function finalStretch(launched) {
  return Object.values(launched)
    .filter((r) => r.token && !r.pool?.migrated)
    .sort((a, b) => curveFill(b) - curveFill(a) || newest(a, b));
}

/** Migrated: coins whose curve filled and moved to Meteora DAMM v2, newest launch first (the
 *  rows carry no migration time). */
export function migrated(launched) {
  return Object.values(launched)
    .filter((r) => r.token && r.pool?.migrated)
    .sort(newest);
}

/** The header's "X SOL filling N pools": open presales with a coin, and their SOL (BigInt). */
export function filling(presales, launched) {
  let count = 0;
  let lamports = 0n;
  for (const v of Object.values(presales)) {
    if (!v.token || stageOf(v, launched[v.presale]) !== "presale") continue;
    count++;
    lamports += BigInt(v.raised ?? 0);
  }
  return { count, lamports };
}

/** The lane the pager settled on from a momentum end at offset `x` (pages `pageW` wide), or
 *  null to ignore it. On Android a cancelled animated scroll (a second tab tap, a drag, a
 *  scrollTo) still sends a momentum end, wherever it stopped: one off a page boundary, or
 *  on a page other than `target` (the lane a tab tap is scrolling to, null with none), is
 *  ignored, so it neither plays a tap nor moves the underline. */
export function settledLane(x, pageW, target) {
  if (!(pageW > 0)) return null;
  const i = Math.round(x / pageW);
  if (Math.abs(x - i * pageW) > 1) return null;
  if (target != null && i !== target) return null;
  return i;
}
