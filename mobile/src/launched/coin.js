// What the Launched list and the coin screen say about a launched coin, as plain functions of
// its `launched` row (no React Native, so Node tests run them).
import { GRAD_SOL, marketCapSol, priceFromSqrt, seatOf } from "../../../engine/src/views.js";
import { compact, usd } from "../ui/format.js";
import { hhmm } from "../room/room.js";

/** States that come before a launched row: the server sends the row only once it has read
 *  the new pool, a moment after the launch. */
const LAUNCHING = new Set(["FULL", "LAUNCHING", "SETTLED"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 3 significant digits, never in exponent form: 0.0000000281, 1.23, 0.5, 123. */
export function sig3(n) {
  const r = Number(n.toPrecision(3));
  if (r === 0 || !Number.isFinite(r)) return String(r);
  const digits = Math.min(100, Math.max(0, 2 - Math.floor(Math.log10(Math.abs(r)))));
  const fixed = r.toFixed(digits);
  return digits > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
}

/** SOL per whole token at a pool's sqrt price: "0.0000000281 SOL". */
export const priceText = (sqrtPrice) => `${sig3(priceFromSqrt(sqrtPrice))} SOL`;

/** The market cap in dollars when SOL/USD is known, else in SOL ("28 SOL"). */
export function capText(sqrtPrice, solUsd) {
  const cap = marketCapSol(sqrtPrice);
  return solUsd > 0 ? usd(cap * solUsd) : `${compact(cap)} SOL`;
}

/** The bonding curve: { fill (0..1), text }. A migrated pool reads full. */
export function curveOf(pool) {
  if (pool.migrated) return { fill: 1, text: "Migrated to DAMM v2" };
  const sol = Number(BigInt(pool.quoteReserve)) / 1e9;
  return { fill: Math.min(1, sol / GRAD_SOL), text: `${sol.toFixed(2)} of ${GRAD_SOL} SOL` };
}

/** "1 Oct, 09:05": a time (ms) on this phone's clock. */
export function dayTime(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hhmm(ms)}`;
}

/** Whether a join noted on this phone (store `mine[key]`: { deposit, at, back? }) still holds
 *  its seat: joined, and not taken back since. */
export const stillIn = (entry) => !!entry?.deposit && !(entry.back >= (entry.at ?? 0));

/** What this wallet was in the pool with (its seat's deposit, BigInt lamports), or null when
 *  it wasn't. Its seat in the watched view (`views[key]`) decides while the seat is there: one
 *  with nothing committed was out of the pool. A claim closes the seat, so with no seat in
 *  the view, or no view, the join noted on this phone (store `mine[key]`) decides. */
export function inWith(detail, wallet, mine) {
  const seat = detail && wallet ? seatOf(detail, wallet) : null;
  if (seat) return seat.commit > 0n ? seat.deposit : null;
  return stillIn(mine) ? BigInt(mine.deposit) : null;
}

/** What the coin screen shows: "coin" once its launched row has the coin; "wait" (a spinner)
 *  while the Launched feed hasn't loaded, or while the presale's view (`views[key]` or the
 *  list's, either may be missing) says it launched or is launching but its row hasn't come
 *  yet; else "missing". */
export function coinScreenState({ row, loaded, view }) {
  if (row?.token) return "coin";
  if (!loaded) return "wait";
  if (view && (view.launch != null || LAUNCHING.has(view.state))) return "wait";
  return "missing";
}
