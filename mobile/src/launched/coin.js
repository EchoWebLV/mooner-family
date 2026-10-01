// What the Launched list and the coin screen say about a launched coin, as plain functions of
// its `launched` row (no React Native, so Node tests run them).
import { GRAD_SOL, marketCapSol, priceFromSqrt, seatOf } from "../../../engine/src/views.js";
import { compact, shortWallet, solText, usd } from "../ui/format.js";
import { hhmm } from "../room/room.js";

/** States that come before a launched row: the server sends the row only once it has read
 *  the new pool, a moment after the launch. */
const LAUNCHING = new Set(["FULL", "LAUNCHING", "SETTLED"]);

/** Raw units per whole token: Mooner coins have 6 decimals (engine/src/views.js DECIMALS). */
const RAW_PER_TOKEN = 1e6;

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
  if (pool.migrated) return { fill: 1, text: "Migrated to Meteora DAMM v2" };
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

/** Whether the price shown is the one at migration: the coin migrated and the server hasn't
 *  found its DAMM v2 pool yet (once it has, `pool.sqrtPrice` is that pool's live price). */
export const atMigration = (pool) => !!pool?.migrated && !pool.damm;

/** Liquidity: before migration the SOL in the DBC pool (its account, live); after it the
 *  DAMM v2 pool's TVL from Meteora (`stats`: the coin's stats, or null). null when unknown. */
export function liquidityText(pool, stats) {
  if (!pool) return null;
  if (!pool.migrated) return `${solText(pool.quoteReserve)} SOL`;
  return stats?.venue === "damm" && stats.liquidityUsd != null ? usd(stats.liquidityUsd) : null;
}

/** 24h volume in dollars, or null when no source has it. */
export const volumeText = (stats) => (stats?.volume24hUsd != null ? usd(stats.volume24hUsd) : null);

/** The holder count: Meteora's, after migration; before it nobody counts them (the coin
 *  screen lists the top holders instead). "1.26K holders", "1 holder", or null. */
export function holdersText(stats) {
  const n = stats?.holders;
  if (n == null) return null;
  return n === 1 ? "1 holder" : `${compact(n)} holders`;
}

/** The top holders as rows: { key (its place and owner: the same owner or amount can be
 *  listed twice), who (the pool, the presale, "You", or a short wallet),
 *  tokens ("1.2M"), share ("12.3%" of the supply, or null when the server couldn't read the
 *  supply) }. `supply`: the coin's supply in raw units as the server read it (stats.supply);
 *  not the 1B of views.js SUPPLY, which a coin's real supply needn't match. null when the
 *  server couldn't read the holders. */
export function holderRows(top, wallet, supply) {
  if (!top) return null;
  const all = Number(supply);
  return top.map((h, i) => {
    const n = Number(h.amount) / RAW_PER_TOKEN;
    return {
      key: `${i}:${h.owner ?? ""}`,
      who: h.label ?? (h.owner && h.owner === wallet ? "You" : shortWallet(h.owner ?? "")),
      tokens: n >= 1000 ? compact(n) : sig3(n),
      share: all > 0 ? `${sig3((Number(h.amount) / all) * 100)}%` : null,
    };
  });
}

/** The wallet's position: { tokens, sol, usd } as text, or null when it holds none or its
 *  balance isn't read yet. Worth is at the pool's price now. */
export function positionOf(holding, sqrtPrice, solUsd) {
  if (!holding || holding.raw <= 0n) return null;
  const n = Number(holding.raw) / 10 ** holding.decimals;
  const sol = sqrtPrice ? n * priceFromSqrt(sqrtPrice) : null;
  return {
    tokens: n >= 1000 ? compact(n) : sig3(n),
    sol: sol == null ? null : `${sig3(sol)} SOL`,
    usd: sol != null && solUsd > 0 ? usd(sol * solUsd) : null,
  };
}
