// What the Buy and Sell sheets say, as plain functions (no React Native, so Node tests run
// them). Amounts are BigInt: lamports for SOL, raw units for the coin (6 decimals).
import { impactOf, poolFee, SLIPPAGE_BPS } from "../../../engine/src/swap.js";
import { compact } from "../ui/format.js";
import { sig3 } from "./coin.js";

/** The Buy sheet's chips: 0.1, 0.5 and 1 SOL (spec, "Launched"). */
export const BUY_CHIPS = [100_000_000n, 500_000_000n, 1_000_000_000n];
/** The Sell sheet's chips: a share of what the wallet holds. */
export const SELL_PCTS = [25, 50, 100];
/** Price impact from which the sheet shows it in red. */
export const HIGH_IMPACT = 0.05;

/** Typed SOL ("0.25", "1", "0,5") as lamports, or null when it isn't a positive amount
 *  with at most 9 decimals. */
export function parseSol(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [int, frac = ""] = t.split(".");
  if (frac.length > 9) return null;
  const v = BigInt(int || "0") * 1_000_000_000n + BigInt(frac.padEnd(9, "0"));
  return v > 0n ? v : null;
}

/** Lamports as SOL with 3 significant digits: "0.00988", "1.5". */
export const solSig = (lamports) => sig3(Number(BigInt(lamports)) / 1e9);

/** Raw coin units as whole tokens: "34.9K", "1.25M", "0.5". */
export function tokensText(raw) {
  const n = Number(BigInt(raw)) / 1e6;
  return n >= 1000 ? compact(n) : sig3(n);
}

/** "0.42%", "12.3%": a fraction as a percent, 3 significant digits; under 0.01% reads "<0.01%". */
export function pctText(f) {
  if (f > 0 && f < 0.0001) return "<0.01%";
  return `${sig3(f * 100)}%`;
}

/**
 * The lines a sheet shows for quote `q` (swap.js quote): { get, minimum, impact, high, fee,
 * slippage }. `pools`: the coin's pool addresses (its DBC pool, and its DAMM v2 pool once
 * known): a route only through them shows the 1% pool fee, any other route says its fees
 * are in the price. `sqrtPrice`: the pool's live price, for the impact (null when it isn't
 * live: then the impact is Jupiter's own).
 */
export function tradeLines(side, q, { pools, sqrtPrice, symbol }) {
  const coin = (raw) => `${tokensText(raw)} $${symbol}`;
  const sol = (lamports) => `${solSig(lamports)} SOL`;
  const impact = impactOf(side, q, sqrtPrice);
  const fee = poolFee(side, q, pools);
  return {
    get: side === "buy" ? coin(q.outAmount) : sol(q.outAmount),
    minimum: side === "buy" ? coin(q.minOut) : sol(q.minOut),
    impact: pctText(impact),
    high: impact >= HIGH_IMPACT,
    fee: fee == null ? "In the price (Jupiter's route)" : `1% to the pool · ${sol(fee)}`,
    slippage: `${SLIPPAGE_BPS / 100}%`,
  };
}

/** Whole seconds until `at` (ms), at least 1, for the lock's countdown; 0 once it's there. */
export const secondsTo = (at, nowMs) => (at == null || nowMs >= at ? 0 : Math.ceil((at - nowMs) / 1000));
