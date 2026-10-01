// What the coin screen shows besides the live price (feed.js pushes these on `coin:<mint>`):
// the chart, 24h volume, liquidity, holders and the top holders. Before migration the coin
// trades on its DBC pool: candles and volume from GeckoTerminal, as the website reads them.
// After it, on its DAMM v2 pool: candles, TVL, volume and the holder count from Meteora's
// Data API. Where an API has nothing (a pool too new for GeckoTerminal, say), the chart is
// the server's own candles, built from the pool changes it hears (store.addPrice). The top
// holders and the coin's supply (for their shares) are read from chain. A source that fails
// leaves its figures null; the rest stand.
// How long a read can take: the API calls and the chain reads all start at once. Each API
// call is one request through market.js getWithin: 10 s at most, its body included. The
// chain reads go over the Feed's own connection (statsConnection): no waiting out rate
// limits, and 10 s a request, its body included. The supply is one request; the top holders
// are two in a row (the largest accounts, then their owners), so 20 s at the very worst,
// and so is the whole read. An RPC that answers the largest accounts 429 isn't asked again
// for 10 min, or ever after a 403 (chainReads).

import { Connection, PublicKey } from "@solana/web3.js";
import { poolAuthority } from "../src/pdas.js";
import { dammPoolAuthority } from "../src/damm.js";
import { FETCH_MS, drawable, geckoCandles, geckoStats, meteoraCandles, meteoraPool } from "../src/market.js";
import { fetchWithin } from "../src/tx.js";

/** The chart covers this much time: 300 minutes. GeckoTerminal is asked for 300 one-minute
 *  candles, but its `limit` counts candles with trades, not minutes, so a quiet pool's go
 *  back further: the older ones are dropped. */
export const CHART_MS = 300 * 60_000;
/** How many top holders the coin screen lists. */
export const TOP_HOLDERS = 10;

/** How long getTokenLargestAccounts is left alone after the RPC answered it 429. */
export const TOP_REST_MS = 10 * 60_000;

/** The owner of an SPL / Token-2022 token account (the base layout: mint 0, owner 32,
 *  amount 64; engine/src/layout.js tokenAmount). */
const ownerOf = (data) => new PublicKey(Buffer.from(data).subarray(32, 64)).toBase58();

/** The coin's biggest token accounts with tokens in them, biggest first (throws what the
 *  RPC throws). */
async function largest(conn, mint) {
  return (await conn.getTokenLargestAccounts(new PublicKey(mint), "confirmed")).value.filter((a) => a.amount !== "0").slice(0, TOP_HOLDERS);
}

/** Those accounts as holders: each one's owner, read from chain, and its label. */
async function withOwners(conn, big, labels) {
  if (!big.length) return [];
  const accs = await conn.getMultipleAccountsInfo(big.map((a) => new PublicKey(a.address)));
  return big.map((a, i) => {
    const owner = accs[i] ? ownerOf(accs[i].data) : null;
    return { owner, amount: a.amount, label: (owner && labels[owner]) ?? null };
  });
}

/**
 * The coin's biggest holders from chain: [{ owner, amount (raw, string), label }], biggest
 * first, or null when the RPC wouldn't say. `labels`: owner (base58) -> what it is (the
 * bonding curve, the DAMM pool, the presale); everyone else's label is null.
 */
export async function topHolders(conn, mint, labels = {}) {
  try {
    return await withOwners(conn, await largest(conn, mint), labels);
  } catch {
    return null;
  }
}

/** `base` (the global fetch by default), resolving only once the whole body is in: Node's
 *  fetch resolves at the headers, so a deadline around it alone wouldn't cover an RPC that
 *  sends its headers and then stalls the body. */
const whole = (base = (url, init) => globalThis.fetch(url, init)) => async (url, init) => {
  const r = await base(url, init);
  return new Response(await r.arrayBuffer(), { status: r.status, statusText: r.statusText, headers: r.headers });
};

/** The connection coin stats read the chain over (the Feed builds one): a rate limit (429)
 *  fails at once, where tx.js connect would wait it out for up to 31 tries (about 77 s on
 *  mainnet-beta), and each request, its body included, gets FETCH_MS (10 s). `base`: the
 *  fetch under it. */
export const statsConnection = (endpoint, base) =>
  new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: fetchWithin(FETCH_MS, whole(base)) });

/** The status an RPC error carries: the HTTP status web3.js puts first in its message
 *  ("429 Too Many Requests: …"), or a JSON-RPC error's code; else null. */
const rpcStatus = (e) => (typeof e?.code === "number" ? e.code : Number(/^(\d{3}) /.exec(e?.message ?? "")?.[1]) || null);

/**
 * The chain reads coinStats makes, over `conn` (statsConnection): { conn, top(mint, labels),
 * supply(mint) }, null where the RPC wouldn't say. After the RPC answers
 * getTokenLargestAccounts 429 it isn't asked again for TOP_REST_MS (10 min), and after a
 * 403 not again while this runs; meanwhile `top` is null. Each rest is logged when it
 * starts.
 */
export function chainReads(conn, { now = Date.now, log = console.log } = {}) {
  let restUntil = -Infinity;
  return {
    conn,
    async top(mint, labels = {}) {
      if (now() < restUntil) return null;
      let big;
      try {
        big = await largest(conn, mint);
      } catch (e) {
        const status = rpcStatus(e);
        if (status === 403) {
          restUntil = Infinity;
          log("top holders: the RPC refuses getTokenLargestAccounts (403); it isn't asked again until the server restarts");
        } else if (status === 429) {
          restUntil = now() + TOP_REST_MS;
          log(`top holders: the RPC rate-limits getTokenLargestAccounts (429); it isn't asked again for ${TOP_REST_MS / 60_000} min`);
        }
        return null;
      }
      try {
        return await withOwners(conn, big, labels);
      } catch {
        return null;
      }
    },
    supply: (mint) => supplyOf(conn, mint),
  };
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
 * `chain`: chainReads (the Feed's, built once); without one, plain reads over `conn`.
 * `store`: the server's Store (own candles). Returns { mint, venue ("dbc" | "damm"), pool
 * (base58, where the coin trades now), candles (oldest first, each one drawable), candleMs,
 * source, volume24hUsd, liquidityUsd, holders, top, supply, at }. Never rejects for a
 * source that fails: the chain reads catch their own, the API reads are caught here.
 */
export async function coinStats({ conn, chain = chainReads(conn, { log: () => {} }), p, store, fetch = globalThis.fetch, nowMs = Date.now() }) {
  const mint = p.row.mint;
  const venue = p.damm ? "damm" : "dbc";
  const pool = (p.damm ?? p.pool).toBase58();
  const none = () => null;
  const labels = { [poolAuthority().toBase58()]: "Bonding curve", [dammPoolAuthority().toBase58()]: "Pool", [p.row.presale]: "Presale" };
  const top = chain.top(mint, labels);
  const supply = chain.supply(mint);

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
    const good = c?.filter((k) => drawable(k) && k.t >= nowMs - CHART_MS);
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
