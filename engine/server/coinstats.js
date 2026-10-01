// What the coin screen shows besides the live price (feed.js pushes these on `coin:<mint>`):
// the chart, 24h volume, liquidity, holders and the top holders. Before migration the coin
// trades on its DBC pool: candles and volume from GeckoTerminal, as the website reads them.
// After it, on its DAMM v2 pool: candles, TVL, volume and the holder count from Meteora's
// Data API. Where an API has nothing (a pool too new for GeckoTerminal, say), the chart is
// the server's own candles, built from the pool changes it hears (store.addPrice). The top
// holders and the coin's supply (for their shares) are read from chain. A source that fails
// leaves its figures null; the rest stand. Every outside call goes through market.js
// (getWithin: 10 s at most).

import { PublicKey } from "@solana/web3.js";
import { poolAuthority } from "../src/pdas.js";
import { dammPoolAuthority } from "../src/damm.js";
import { geckoCandles, geckoStats, meteoraCandles, meteoraPool } from "../src/market.js";

/** The chart covers this much time (300 one-minute candles, GeckoTerminal's limit). */
export const CHART_MS = 300 * 60_000;
/** How many top holders the coin screen lists. */
export const TOP_HOLDERS = 10;

/** A candle the chart can draw: its time and four prices are finite numbers above 0. */
const drawable = (k) => [k.t, k.o, k.h, k.l, k.c].every((v) => Number.isFinite(v) && v > 0);

/** The owner of an SPL / Token-2022 token account (the base layout: mint 0, owner 32,
 *  amount 64; engine/src/layout.js tokenAmount). */
const ownerOf = (data) => new PublicKey(Buffer.from(data).subarray(32, 64)).toBase58();

/**
 * The coin's biggest holders from chain: [{ owner, amount (raw, string), label }], biggest
 * first, or null when the RPC wouldn't say. `labels`: owner (base58) -> what it is (the
 * bonding curve, the DAMM pool, the presale); everyone else's label is null.
 */
export async function topHolders(conn, mint, labels = {}) {
  try {
    const big = (await conn.getTokenLargestAccounts(new PublicKey(mint), "confirmed")).value.filter((a) => a.amount !== "0").slice(0, TOP_HOLDERS);
    if (!big.length) return [];
    const accs = await conn.getMultipleAccountsInfo(big.map((a) => new PublicKey(a.address)));
    return big.map((a, i) => {
      const owner = accs[i] ? ownerOf(accs[i].data) : null;
      return { owner, amount: a.amount, label: (owner && labels[owner]) ?? null };
    });
  } catch {
    return null;
  }
}

/** The coin's supply in raw units (a string), or null when the RPC wouldn't say. */
export async function supplyOf(conn, mint) {
  try {
    return (await conn.getTokenSupply(new PublicKey(mint), "confirmed")).value.amount;
  } catch {
    return null;
  }
}

/**
 * One coin's stats. `p`: the feed's pool record { row (the launched row: mint, presale),
 * pool (the DBC pool, PublicKey), damm (the DAMM v2 pool once found, PublicKey or null) }.
 * `store`: the server's Store (own candles). Returns { mint, venue ("dbc" | "damm"), pool
 * (base58, where the coin trades now), candles (oldest first, each one drawable), candleMs,
 * source, volume24hUsd, liquidityUsd, holders, top, supply, at }. Never rejects for a
 * source that fails: topHolders and supplyOf catch their own, the API reads are caught here.
 */
export async function coinStats({ conn, p, store, fetch = globalThis.fetch, nowMs = Date.now() }) {
  const mint = p.row.mint;
  const venue = p.damm ? "damm" : "dbc";
  const pool = (p.damm ?? p.pool).toBase58();
  const none = () => null;
  const labels = { [poolAuthority().toBase58()]: "Bonding curve", [dammPoolAuthority().toBase58()]: "Pool", [p.row.presale]: "Presale" };
  const top = topHolders(conn, mint, labels);
  const supply = supplyOf(conn, mint);

  let candles = null;
  let candleMs = 60_000;
  let source = null;
  let volume24hUsd = null;
  let liquidityUsd = null;
  let holders = null;
  if (venue === "damm") {
    const [c, s] = await Promise.all([meteoraCandles(pool, { nowMs, fetch }).catch(none), meteoraPool(pool, { fetch }).catch(none)]);
    const good = c?.filter(drawable);
    if (good?.length) [candles, candleMs, source] = [good, 300_000, "meteora"];
    if (s) [volume24hUsd, liquidityUsd, holders] = [s.volume24hUsd, s.tvlUsd, s.holders];
  } else {
    const [c, s] = await Promise.all([geckoCandles(pool, { fetch }).catch(none), geckoStats(pool, { fetch }).catch(none)]);
    const good = c?.filter(drawable);
    if (good?.length) [candles, source] = [good, "geckoterminal"];
    if (s) volume24hUsd = s.volume24hUsd;
  }
  if (!candles) {
    let own = [];
    try {
      own = store.candles(mint, nowMs - CHART_MS).filter(drawable);
    } catch {
      // the server's own record can't be read: no chart this time, the other figures stand
    }
    [candles, candleMs, source] = [own, 60_000, own.length ? "mooner" : null];
  }
  return { mint, venue, pool, candles, candleMs, source, volume24hUsd, liquidityUsd, holders, top: await top, supply: await supply, at: nowMs };
}
