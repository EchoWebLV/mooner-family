// The coin screen's stats (server/coinstats.js): which source each figure comes from before
// and after migration, the server's own candles when an API has none, and the top holders
// read from chain; the store's own candles.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { poolAuthority } from "../src/pdas.js";
import { dammPoolAuthority } from "../src/damm.js";
import { Store } from "../server/store.js";
import { CHART_MS, TOP_REST_MS, chainReads, coinStats, statsConnection, supplyOf, topHolders } from "../server/coinstats.js";

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
/** A fetch that answers by URL prefix: { prefix: body | Error }. */
function routes(map) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    for (const [prefix, body] of Object.entries(map)) if (url.startsWith(prefix)) return body instanceof Error ? reply({ error: body.message }, 500) : reply(body);
    return reply({ errors: [{ title: "Not Found" }] }, 404);
  };
  f.calls = calls;
  return f;
}

const MINT = Keypair.generate().publicKey;
const PRESALE = Keypair.generate().publicKey;
const DBC_POOL = Keypair.generate().publicKey;
const DAMM_POOL = Keypair.generate().publicKey;
const GECKO = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${DBC_POOL.toBase58()}`;
const METEORA = `https://damm-v2.datapi.meteora.ag/pools/${DAMM_POOL.toBase58()}`;
const NOW = 1_790_854_800_000;

/** A token account's bytes: mint 0, owner 32, amount 64. */
function tokenAccount(owner, amount) {
  const d = Buffer.alloc(165);
  MINT.toBuffer().copy(d, 0);
  owner.toBuffer().copy(d, 32);
  d.writeBigUInt64LE(amount, 64);
  return { data: d };
}

/** A chain whose largest accounts of MINT are held by `owners` ([PublicKey, amount]). */
function chain(owners, { fail = false } = {}) {
  const accs = new Map();
  const largest = owners.map(([owner, amount]) => {
    const address = Keypair.generate().publicKey;
    accs.set(address.toBase58(), tokenAccount(owner, amount));
    return { address, amount: String(amount), decimals: 6 };
  });
  return {
    async getTokenLargestAccounts(mint) {
      if (fail) throw new Error("429 Too Many Requests");
      assert.equal(mint.toBase58(), MINT.toBase58());
      return { value: [...largest, { address: Keypair.generate().publicKey, amount: "0", decimals: 6 }] };
    },
    async getMultipleAccountsInfo(keys) {
      return keys.map((k) => accs.get(k.toBase58()) ?? null);
    },
    async getTokenSupply(mint) {
      if (fail) throw new Error("429 Too Many Requests");
      assert.equal(mint.toBase58(), MINT.toBase58());
      return { value: { amount: "1000000000000000", decimals: 6 } };
    },
  };
}

const whale = Keypair.generate().publicKey;
const holders = [
  [poolAuthority(), 700_000_000_000_000n],
  [PRESALE, 100_000_000_000_000n],
  [whale, 5_000_000_000_000n],
];

test("top holders: biggest first, with the curve, pool and presale named; empty ones left out", async () => {
  const labels = { [poolAuthority().toBase58()]: "Bonding curve", [PRESALE.toBase58()]: "Presale" };
  assert.deepEqual(await topHolders(chain(holders), MINT.toBase58(), labels), [
    { owner: poolAuthority().toBase58(), amount: "700000000000000", label: "Bonding curve" },
    { owner: PRESALE.toBase58(), amount: "100000000000000", label: "Presale" },
    { owner: whale.toBase58(), amount: "5000000000000", label: null },
  ]);
  assert.equal(await topHolders(chain(holders, { fail: true }), MINT.toBase58()), null, "an RPC that won't say: null");
  assert.equal(await supplyOf(chain([]), MINT.toBase58()), "1000000000000000");
  assert.equal(await supplyOf(chain([], { fail: true }), MINT.toBase58()), null);
});

test("before migration: GeckoTerminal's candles and volume for the DBC pool", async () => {
  const fetch = routes({
    [`${GECKO}/ohlcv`]: { data: { attributes: { ohlcv_list: [[1790854740, 2e-8, 3e-8, 2e-8, 3e-8, 1]] } } },
    [GECKO]: { data: { attributes: { reserve_in_usd: "4241.201", volume_usd: { h24: "812.5" } } } },
  });
  const p = { row: { mint: MINT.toBase58(), presale: PRESALE.toBase58() }, pool: DBC_POOL, damm: null };
  const s = await coinStats({ conn: chain(holders), p, store: new Store(":memory:"), fetch, nowMs: NOW });
  assert.deepEqual(
    { ...s, top: s.top.map((h) => h.label) },
    {
      mint: MINT.toBase58(), venue: "dbc", pool: DBC_POOL.toBase58(),
      candles: [{ t: 1790854740_000, o: 2e-8, h: 3e-8, l: 2e-8, c: 3e-8 }], candleMs: 60_000, source: "geckoterminal",
      volume24hUsd: 812.5, liquidityUsd: null, holders: null, top: ["Bonding curve", "Presale", null], supply: "1000000000000000", at: NOW,
    },
  );
  assert.equal(fetch.calls.length, 2);
});

test("a pool GeckoTerminal hasn't seen: the server's own candles; no volume", async () => {
  const store = new Store(":memory:");
  store.addPrice(MINT.toBase58(), 2e-8, NOW - 90_000);
  store.addPrice(MINT.toBase58(), 4e-8, NOW - 80_000);
  store.addPrice(MINT.toBase58(), 3e-8, NOW - 70_000);
  store.addPrice(MINT.toBase58(), 5e-8, NOW - 10_000);
  store.addPrice(MINT.toBase58(), 9e-8, NOW - 400 * 60_000); // older than the chart
  const p = { row: { mint: MINT.toBase58(), presale: PRESALE.toBase58() }, pool: DBC_POOL, damm: null };
  const s = await coinStats({ conn: chain([], { fail: true }), p, store, fetch: routes({}), nowMs: NOW });
  // NOW is on a minute: the first three prices share the minute before the last one's
  assert.deepEqual(s.candles, [
    { t: NOW - 120_000, o: 2e-8, h: 4e-8, l: 2e-8, c: 3e-8 },
    { t: NOW - 60_000, o: 5e-8, h: 5e-8, l: 5e-8, c: 5e-8 },
  ]);
  assert.deepEqual([s.source, s.candleMs, s.volume24hUsd, s.top, s.supply], ["mooner", 60_000, null, null, null]);
  const empty = await coinStats({ conn: chain([]), p: { ...p, row: { ...p.row, mint: Keypair.generate().publicKey.toBase58() } }, store, fetch: routes({}), nowMs: NOW });
  assert.deepEqual([empty.candles, empty.source, empty.top], [[], null, null]);
});

test("after migration: Meteora's candles, TVL, volume and holder count for the DAMM v2 pool", async () => {
  const fetch = routes({
    [`${METEORA}/ohlcv`]: { start_time: 1, end_time: 2, timeframe: "5m", data: [{ timestamp: 1790854500, open: 1e-7, high: 1e-7, low: 1e-7, close: 1e-7, volume: 3 }] },
    [METEORA]: { address: DAMM_POOL.toBase58(), tvl: 9956.5, current_price: 1e-7, volume: { "24h": 3754478.47 }, token_x: { holders: 1256 } },
  });
  const p = { row: { mint: MINT.toBase58(), presale: PRESALE.toBase58() }, pool: DBC_POOL, damm: DAMM_POOL };
  const s = await coinStats({ conn: chain([[dammPoolAuthority(), 400_000_000_000_000n], [whale, 1n]]), p, store: new Store(":memory:"), fetch, nowMs: NOW });
  assert.deepEqual([s.venue, s.pool, s.source, s.candleMs, s.volume24hUsd, s.liquidityUsd, s.holders], ["damm", DAMM_POOL.toBase58(), "meteora", 300_000, 3754478.47, 9956.5, 1256]);
  assert.deepEqual(s.candles, [{ t: 1790854500_000, o: 1e-7, h: 1e-7, l: 1e-7, c: 1e-7 }]);
  assert.deepEqual(s.top.map((h) => h.label), ["Pool", null]);
  assert.ok(fetch.calls.every((u) => u.startsWith(METEORA)), "no GeckoTerminal call after migration");
});

test("candles the chart can't draw are dropped: a time or price that isn't a finite number above 0", async () => {
  const p = { row: { mint: MINT.toBase58(), presale: PRESALE.toBase58() }, pool: DBC_POOL, damm: null };
  const gecko = routes({
    [`${GECKO}/ohlcv`]: {
      data: {
        attributes: {
          ohlcv_list: [
            [1790854740, 2e-8, 3e-8, 2e-8, 3e-8, 1],
            [1790854680, 0, 1e-8, 1e-8, 1e-8, 1],
            [1790854620, null, 1e-8, 1e-8, 1e-8, 1],
            [1790854560, 1e-8, "1e-8", 1e-8, 1e-8, 1],
            [1790854500, 1e-8, 1e-8, -1e-8, 1e-8, 1],
            [1790854440, 1e-8, 1e-8, 1e-8, NaN, 1],
            [1790854380, 1e-8, Infinity, 1e-8, 1e-8, 1],
            [null, 1e-8, 1e-8, 1e-8, 1e-8, 1],
          ],
        },
      },
    },
    [GECKO]: { data: { attributes: { volume_usd: { h24: "1" } } } },
  });
  const s = await coinStats({ conn: chain(holders), p, store: new Store(":memory:"), fetch: gecko, nowMs: NOW });
  assert.deepEqual([s.candles, s.source], [[{ t: 1790854740_000, o: 2e-8, h: 3e-8, l: 2e-8, c: 3e-8 }], "geckoterminal"]);

  // none left from Meteora: the server's own candles; a price that isn't one isn't recorded
  const store = new Store(":memory:");
  store.addPrice(MINT.toBase58(), 5e-8, NOW - 10_000);
  for (const bad of [0, -1e-8, NaN, Infinity, null]) store.addPrice(MINT.toBase58(), bad, NOW - 5_000);
  const meteora = routes({
    [`${METEORA}/ohlcv`]: { data: [{ timestamp: 1790854500, open: 0, high: 0, low: 0, close: 0 }] },
    [METEORA]: { tvl: 1, volume: { "24h": 2 }, token_x: { holders: 3 } },
  });
  const m = await coinStats({ conn: chain(holders), p: { ...p, damm: DAMM_POOL }, store, fetch: meteora, nowMs: NOW });
  assert.deepEqual([m.candles, m.source, m.candleMs], [[{ t: NOW - 60_000, o: 5e-8, h: 5e-8, l: 5e-8, c: 5e-8 }], "mooner", 60_000]);
  assert.deepEqual([m.volume24hUsd, m.liquidityUsd, m.holders], [2, 1, 3], "the pool's figures stand");
});

test("GeckoTerminal candles older than the chart are dropped; none left: the server's own candles", async () => {
  const p = { row: { mint: MINT.toBase58(), presale: PRESALE.toBase58() }, pool: DBC_POOL, damm: null };
  const sec = (ms) => ms / 1000;
  const old = [sec(NOW - CHART_MS - 60_000), 1e-8, 1e-8, 1e-8, 1e-8, 1]; // a minute before the chart starts
  const edge = [sec(NOW - CHART_MS), 2e-8, 2e-8, 2e-8, 2e-8, 1]; // the chart's first minute
  const store = new Store(":memory:");
  store.addPrice(MINT.toBase58(), 5e-8, NOW - 10_000);
  const own = [{ t: NOW - 60_000, o: 5e-8, h: 5e-8, l: 5e-8, c: 5e-8 }];

  // GeckoTerminal's `limit` counts candles with trades: a quiet pool's 300 go back further
  const some = routes({ [`${GECKO}/ohlcv`]: { data: { attributes: { ohlcv_list: [edge, old] } } }, [GECKO]: { data: { attributes: { volume_usd: { h24: "1" } } } } });
  const s = await coinStats({ conn: chain(holders), p, store, fetch: some, nowMs: NOW });
  assert.deepEqual([s.candles, s.source], [[{ t: NOW - CHART_MS, o: 2e-8, h: 2e-8, l: 2e-8, c: 2e-8 }], "geckoterminal"]);

  const allOld = routes({ [`${GECKO}/ohlcv`]: { data: { attributes: { ohlcv_list: [old] } } }, [GECKO]: { data: { attributes: { volume_usd: { h24: "1" } } } } });
  const o = await coinStats({ conn: chain(holders), p, store, fetch: allOld, nowMs: NOW });
  assert.deepEqual([o.candles, o.source, o.candleMs, o.volume24hUsd], [own, "mooner", 60_000, 1]);
});

test("the server's own candles can't be read: no chart, and every other figure stands", async () => {
  const store = new Store(":memory:");
  store.candles = () => {
    throw new Error("database is not open");
  };
  const p = { row: { mint: MINT.toBase58(), presale: PRESALE.toBase58() }, pool: DBC_POOL, damm: null };
  const fetch = routes({ [GECKO]: { data: { attributes: { volume_usd: { h24: "7" } } } } });
  const s = await coinStats({ conn: chain(holders), p, store, fetch, nowMs: NOW });
  assert.deepEqual([s.candles, s.source, s.volume24hUsd, s.supply, s.top.length], [[], null, 7, "1000000000000000", 3]);
});

test("own candles: the store prepares its candle statements once, not on every price", () => {
  const store = new Store(":memory:");
  const prepare = store.db.prepare;
  let n = 0;
  store.db.prepare = function (...a) {
    n++;
    return prepare.apply(this, a);
  };
  for (let i = 0; i < 3; i++) store.addPrice(MINT.toBase58(), (i + 1) * 1e-8, NOW + i * 60_000);
  assert.equal(store.candles(MINT.toBase58()).length, 3);
  assert.equal(store.candles(MINT.toBase58(), NOW + 60_000).length, 2);
  assert.equal(n, 0, "no statement prepared per call");
});

test("own candles older than a day are pruned when the store opens", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mooner-candles-"));
  try {
    const file = path.join(dir, "server.db");
    const mint = MINT.toBase58();
    const now = Date.now();
    const a = new Store(file);
    a.addPrice(mint, 1e-8, now - 25 * 3_600_000); // more than a day old
    a.addPrice(mint, 2e-8, now - 23 * 3_600_000); // less
    a.addPrice(mint, 3e-8, now - 60_000);
    assert.equal(a.candles(mint).length, 3, "kept while it's open");
    a.close();
    const b = new Store(file);
    assert.deepEqual(b.candles(mint).map((k) => k.o), [2e-8, 3e-8]);
    b.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

/** An RPC at http://rpc.test, through statsConnection, that answers getTokenLargestAccounts
 *  with HTTP `status` (as api.mainnet-beta.solana.com answered it 429 on 2026-10-01) and
 *  getTokenSupply with the supply. `calls`: requests by method. */
function rpcSaying(status) {
  const calls = {};
  const base = async (url, init) => {
    const body = JSON.parse(init.body);
    calls[body.method] = (calls[body.method] ?? 0) + 1;
    if (body.method === "getTokenLargestAccounts") {
      const error = { code: status, message: status === 429 ? "Too many requests for a specific RPC call" : "Forbidden" };
      return new Response(JSON.stringify({ jsonrpc: "2.0", error, id: body.id }), { status, statusText: status === 429 ? "Too Many Requests" : "Forbidden" });
    }
    const value = { amount: "1000000000000000", decimals: 6, uiAmount: 1e9, uiAmountString: "1000000000" };
    return new Response(JSON.stringify({ jsonrpc: "2.0", result: { context: { slot: 1 }, value }, id: body.id }), { status: 200 });
  };
  return { conn: statsConnection("http://rpc.test", base), calls };
}

test("top holders over an RPC that rate-limits them: a 429 is one call and null at once, then not asked for 10 minutes; a 403, never again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = NOW;
  const logs = [];
  const p = { row: { mint: MINT.toBase58(), presale: PRESALE.toBase58() }, pool: DBC_POOL, damm: null };
  /** One coinStats read over `chain`; it must settle in under 1 s of fake time. */
  async function read(chain) {
    let s;
    coinStats({ chain, p, store: new Store(":memory:"), fetch: routes({}), nowMs: clock }).then((x) => (s = x));
    for (let ms = 0; ; ms += 50) {
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      if (s) return s;
      assert.ok(ms < 1_000, "settled in under 1 s of fake time");
      t.mock.timers.tick(50);
    }
  }

  const limited = rpcSaying(429);
  const chain = chainReads(limited.conn, { now: () => clock, log: (m) => logs.push(m) });
  const s = await read(chain);
  assert.deepEqual([s.top, s.supply, limited.calls.getTokenLargestAccounts], [null, "1000000000000000", 1], "one call, no retries");
  clock += TOP_REST_MS - 1;
  assert.equal((await read(chain)).top, null);
  assert.equal(limited.calls.getTokenLargestAccounts, 1, "not asked within 10 min");
  clock += 1;
  await read(chain);
  assert.equal(limited.calls.getTokenLargestAccounts, 2, "asked again after 10 min");
  assert.equal(TOP_REST_MS, 10 * 60_000);
  assert.equal(logs.length, 2, "logged once each time a rest starts");
  assert.match(logs[0], /429/);

  const forbidden = rpcSaying(403);
  const never = chainReads(forbidden.conn, { now: () => clock, log: (m) => logs.push(m) });
  for (const later of [0, TOP_REST_MS, 30 * 86_400_000]) {
    clock += later;
    assert.equal((await read(never)).top, null);
  }
  assert.equal(forbidden.calls.getTokenLargestAccounts, 1, "a 403 is never asked again");
  assert.equal(forbidden.calls.getTokenSupply, 3, "the supply is still read");
  assert.equal(logs.length, 3);
  assert.match(logs[2], /403/);
});
