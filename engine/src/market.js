// Market data for launched coins from public APIs: GeckoTerminal (a DBC pool's candles and
// 24h volume, as the website reads them) and Meteora's DAMM v2 Data API (a migrated
// coin's candles, TVL, 24h volume and holder count). Prices are in SOL per whole token.
// The server calls these (feed.js, at most once a minute per coin someone has open); the
// website reads candles through web/src/real/market.ts. `fetch` is handed in. No node:
// imports.

export const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana";
export const METEORA = "https://damm-v2.datapi.meteora.ag";

async function getJson(fetch, url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error ?? j?.errors?.[0]?.title ?? `${new URL(url).host} said ${r.status}`);
  return j;
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Candles oldest first with strictly rising times: a time listed twice (GeckoTerminal
 *  does that) becomes one candle. Each is { t (ms), o, h, l, c }. */
export function mergeCandles(rows) {
  const out = [];
  for (const c of [...rows].sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1];
    if (last && last.t === c.t) out[out.length - 1] = { t: c.t, o: last.o, h: Math.max(last.h, c.h), l: Math.min(last.l, c.l), c: c.c };
    else out.push(c);
  }
  return out;
}

/** One-minute candles of a pool from GeckoTerminal, in SOL per token. */
export async function geckoCandles(pool, { limit = 300, fetch = globalThis.fetch } = {}) {
  const j = await getJson(fetch, `${GECKO}/pools/${pool}/ohlcv/minute?aggregate=1&limit=${limit}&currency=token`);
  const list = j?.data?.attributes?.ohlcv_list ?? [];
  return mergeCandles(list.map(([ts, o, h, l, c]) => ({ t: ts * 1000, o, h, l, c })));
}

/** A pool's 24h volume and liquidity in USD from GeckoTerminal (null where it has none). */
export async function geckoStats(pool, { fetch = globalThis.fetch } = {}) {
  const a = (await getJson(fetch, `${GECKO}/pools/${pool}`))?.data?.attributes ?? {};
  return { volume24hUsd: num(a.volume_usd?.h24), liquidityUsd: num(a.reserve_in_usd) };
}

/** A DAMM v2 pool from Meteora's Data API: { price (SOL per token), tvlUsd, volume24hUsd,
 *  holders } (null where it has none). */
export async function meteoraPool(pool, { fetch = globalThis.fetch } = {}) {
  const j = await getJson(fetch, `${METEORA}/pools/${pool}`);
  return { price: num(j?.current_price), tvlUsd: num(j?.tvl), volume24hUsd: num(j?.volume?.["24h"]), holders: num(j?.token_x?.holders) };
}

/** METEORA serves 5-minute candles for at most 6 hours a call. */
export const METEORA_CANDLE_MS = 5 * 60_000;
export const METEORA_SPAN_MS = 6 * 3_600_000;

/** Five-minute candles of a DAMM v2 pool over the last 6 hours, in SOL per token. */
export async function meteoraCandles(pool, { nowMs = Date.now(), fetch = globalThis.fetch } = {}) {
  const end = Math.floor(nowMs / 1000);
  const start = end - METEORA_SPAN_MS / 1000;
  const j = await getJson(fetch, `${METEORA}/pools/${pool}/ohlcv?timeframe=5m&start_time=${start}&end_time=${end}`);
  return mergeCandles((j?.data ?? []).map((r) => ({ t: r.timestamp * 1000, o: r.open, h: r.high, l: r.low, c: r.close })));
}
