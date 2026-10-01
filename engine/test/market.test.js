// Market data (engine/src/market.js) against replies trimmed from the real APIs on
// 2026-10-01: GeckoTerminal for the trial coin's DBC pool 8bnXSQC6…, Meteora's DAMM v2 Data
// API for pool GwvAt96o….
import { test } from "node:test";
import assert from "node:assert/strict";
import { geckoCandles, geckoStats, mergeCandles, meteoraCandles, meteoraPool } from "../src/market.js";

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function fakeFetch(...replies) {
  const calls = [];
  const f = async (url) => (calls.push(url), replies.shift());
  f.calls = calls;
  return f;
}

const DBC_POOL = "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri";
const DAMM_POOL = "GwvAt96oPP1fd1gMX9bPhERFKkvV5qBBVc7P1MHGPJk3";

test("GeckoTerminal candles: newest-first rows with a minute listed twice become one candle each, oldest first", async () => {
  const fetch = fakeFetch(
    reply({
      data: {
        attributes: {
          ohlcv_list: [
            [1790366100, 2.85546950462739e-8, 2.85546950462739e-8, 2.84588682425083e-8, 2.84588682425083e-8, 0.098648722],
            [1790366100, 2.84588682425083e-8, 2.84588682425083e-8, 2.84588682425083e-8, 2.84588682425083e-8, 0.098648722],
            [1790314080, 2.85546950462739e-8, 2.85546950462739e-8, 2.85546950462739e-8, 2.85546950462739e-8, 0.002970004],
          ],
        },
      },
    }),
  );
  const c = await geckoCandles(DBC_POOL, { fetch });
  assert.equal(fetch.calls[0], `https://api.geckoterminal.com/api/v2/networks/solana/pools/${DBC_POOL}/ohlcv/minute?aggregate=1&limit=300&currency=token`);
  assert.deepEqual(c, [
    { t: 1790314080000, o: 2.85546950462739e-8, h: 2.85546950462739e-8, l: 2.85546950462739e-8, c: 2.85546950462739e-8 },
    { t: 1790366100000, o: 2.85546950462739e-8, h: 2.85546950462739e-8, l: 2.84588682425083e-8, c: 2.84588682425083e-8 },
  ]);
  assert.deepEqual(mergeCandles([]), []);
});

test("GeckoTerminal pool stats: 24h volume and liquidity in USD; a pool it hasn't seen is an error", async () => {
  const fetch = fakeFetch(reply({ data: { attributes: { reserve_in_usd: "4241.201", volume_usd: { m5: "0.0", h24: "0.0" } } } }), reply({ errors: [{ status: "404", title: "Not Found" }] }, 404));
  assert.deepEqual(await geckoStats(DBC_POOL, { fetch }), { volume24hUsd: 0, liquidityUsd: 4241.201 });
  assert.equal(fetch.calls[0], `https://api.geckoterminal.com/api/v2/networks/solana/pools/${DBC_POOL}`);
  await assert.rejects(geckoStats("nope", { fetch }), /Not Found/);
});

test("Meteora DAMM v2 pool: price in SOL, TVL, 24h volume and holders", async () => {
  const fetch = fakeFetch(
    reply({
      address: DAMM_POOL,
      token_x: { address: "AcgB3riCTGBzQ626TRmEm1f6ikeFvxi4mL36piDXV6ug", holders: 1256, decimals: 6 },
      tvl: 9956.598181908688,
      current_price: 1.0107935607993896e-7,
      volume: { "30m": 3140.5055203779816, "24h": 3754478.470515964 },
    }),
  );
  assert.deepEqual(await meteoraPool(DAMM_POOL, { fetch }), { price: 1.0107935607993896e-7, tvlUsd: 9956.598181908688, volume24hUsd: 3754478.470515964, holders: 1256 });
  assert.equal(fetch.calls[0], `https://damm-v2.datapi.meteora.ag/pools/${DAMM_POOL}`);
});

test("Meteora candles: 5-minute candles over the last 6 hours, oldest first", async () => {
  const fetch = fakeFetch(
    reply({
      start_time: 1790833200,
      end_time: 1790854800,
      timeframe: "5m",
      data: [
        { timestamp: 1790833500, open: 1.1247539922975698e-7, high: 1.1247539922975698e-7, low: 1.1164651230572074e-7, close: 1.1164651230572074e-7, volume: 24.57612274829672 },
        { timestamp: 1790833200, open: 1.1226212105988467e-7, high: 1.1226212105988467e-7, low: 1.1226212105988467e-7, close: 1.1226212105988467e-7, volume: 0.09655727322282144 },
      ],
    }),
  );
  const c = await meteoraCandles(DAMM_POOL, { nowMs: 1790854800_000, fetch });
  assert.equal(fetch.calls[0], `https://damm-v2.datapi.meteora.ag/pools/${DAMM_POOL}/ohlcv?timeframe=5m&start_time=1790833200&end_time=1790854800`);
  assert.deepEqual(
    c.map((x) => x.t),
    [1790833200_000, 1790833500_000],
  );
  assert.equal(c[1].l, 1.1164651230572074e-7);
});
