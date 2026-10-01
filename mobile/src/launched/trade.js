// What the Buy and Sell sheets say, as plain functions (no React Native, so Node tests run
// them). Amounts are BigInt: lamports for SOL, raw units for the coin (6 decimals).
import { impactOf, poolFee, sellAmount, SLIPPAGE_BPS } from "../../../engine/src/swap.js";
import { tradeOpensAt } from "../../../engine/src/views.js";
import { compact } from "../ui/format.js";
import { sig3 } from "./coin.js";

/** The Buy sheet's chips: 0.1, 0.5 and 1 SOL (spec, "Launched"). */
export const BUY_CHIPS = [100_000_000n, 500_000_000n, 1_000_000_000n];
/** The Sell sheet's chips: a share of what the wallet holds. */
export const SELL_PCTS = [25, 50, 100];
/** Price impact from which the sheet shows it in red. */
export const HIGH_IMPACT = 0.05;
/** The most a token amount can be on chain (u64). */
const U64_MAX = (1n << 64n) - 1n;

/**
 * What a buy needs in the wallet besides the SOL it spends (lamports). Rent as mainnet's
 * getMinimumBalanceForRentExemption said on 2026-10-01; the accounts as Jupiter's
 * swap-instructions built them for a fresh wallet buying a Mooner coin that day:
 * - the coin's token account: a Token-2022 ATA. Mooner mints carry only mint-side extensions
 *   (metadataPointer, tokenMetadata), so it's 165 bytes + the account type + ImmutableOwner's
 *   header = 170 bytes: 1_513_840. Only a first buy pays it; the check keeps it back always.
 * - the wrapped-SOL account Jupiter opens for the swap (SPL Token, 165 bytes): 1_488_440,
 *   back in the wallet when Jupiter closes it at the end of the same tx. While it's open the
 *   wallet is without it; after the tx the wallet must still hold its own rent-exempt minimum
 *   (0 bytes: 650_240). The larger of the two counts.
 * - the network fee: 5_000 for the one signature, plus 1_400_000 CU (the most a tx can ask,
 *   and what Jupiter set for that wallet) at 100_000 µL per CU (what Seed Vault raises the
 *   priority to): 145_000.
 */
export const BUY_RESERVE = 1_513_840n + 1_488_440n + 145_000n;

/** Typed SOL ("0.25", "1", "0,5") as lamports, or null when it isn't a positive amount
 *  with at most 9 decimals that fits a u64. */
export function parseSol(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [int, frac = ""] = t.split(".");
  if (frac.length > 9) return null;
  const v = BigInt(int || "0") * 1_000_000_000n + BigInt(frac.padEnd(9, "0"));
  return v > 0n && v <= U64_MAX ? v : null;
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

/** When a coin's Buy and Sell open (ms, this phone's clock): views.js tradeOpensAt counted from
 *  the later of the launch's time on the server's clock (`launch.at`) and `seenAt`, this
 *  phone's clock when it first heard of the launch (store launchSeen; undefined for a coin
 *  that came in a snapshot). A phone clock that runs fast then can't open them during the
 *  tax for a launch it saw live. null when the row has no launch. */
export function lockEnds(row, seenAt) {
  const at = row?.launch?.at;
  if (at == null) return null;
  return tradeOpensAt({ launch: { at: seenAt == null ? Number(at) : Math.max(Number(at), seenAt) } });
}

/**
 * Why a sheet's Buy or Sell can't go ahead now: { text, wait } or null. `wait`: it passes by
 * itself (the lock, another action), else something to change. In order: the lock (`secs`
 * left), another action going on (`busy` that isn't this sheet's own trade), a buy of
 * `amount` lamports the wallet's `lamports` can't cover with BUY_RESERVE, a sell with nothing
 * held (`holding`), or a `pct` of it that rounds to nothing.
 */
export function whyNot({ side, secs, amount, lamports, holding, pct, symbol, busy, trading }) {
  if (secs > 0) return { text: `Trading opens in ${secs} s, after the launch's snipe tax.`, wait: true };
  if (busy && !trading) {
    const trade = busy.kind === "buy" || busy.kind === "sell";
    return { text: trade ? "Wait for the last trade to finish." : "Wait for the last one to finish.", wait: true };
  }
  if (side === "buy") {
    if (amount == null || lamports == null || amount + BUY_RESERVE <= BigInt(lamports)) return null;
    return { text: `Your wallet has ${solSig(lamports)} SOL, and a buy needs about ${solSig(BUY_RESERVE)} SOL more for fees and rent.`, wait: false };
  }
  if (!holding) return null;
  if (holding.raw <= 0n) return { text: `You don't hold any $${symbol}.`, wait: false };
  if (sellAmount(holding.raw, pct) === 0n) return { text: `Too little to sell ${pct}%. Try 100%.`, wait: false };
  return null;
}
