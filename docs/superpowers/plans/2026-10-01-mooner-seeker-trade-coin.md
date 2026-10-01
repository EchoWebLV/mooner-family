# Mooner on Seeker, piece 2: trade and coin info — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** From the phone's coin screen, buy and sell a launched coin through Jupiter, signed in Seed Vault. The screen also shows the coin's chart, price and market cap, liquidity, 24h volume, top holders and your position. After migration, price and market cap come from the coin's DAMM v2 pool. Every figure is pushed over the live socket.

**Architecture:**
- **Shared trading.** Trading moves from the website into `engine/src/swap.js`, which both apps use. It covers Jupiter quotes, Jupiter's swap tx, a check that the wallet is the only signer, sign-then-send for Seed Vault, and errors in words.
- **The server learns three things:**
  - a `migrated` event when a DBC pool's flag flips;
  - the DAMM v2 pool each migrated coin moved to, found by PDA, decoded and subscribed (`engine/src/damm.js`);
  - a `coin:<mint>` topic with the chart, volume, liquidity and holders (`engine/server/coinstats.js`). These come from GeckoTerminal before migration and Meteora's DAMM v2 Data API after. The server reads them at most once a minute, and only while someone has the coin open and its pool changed.
- **The phone:**
  - `mobile/src/trading.js` binds `swap.js` to the phone's RPC;
  - the store gains `watchCoin`, `preview` and `trade`;
  - the coin screen draws the chart (react-native-svg) and opens Buy and Sell sheets.

**Tech Stack:** Node 22 `node --test`, `@solana/web3.js` 1.99, Jupiter swap API v1 (`https://lite-api.jup.ag/swap/v1`), GeckoTerminal API v2, Meteora DAMM v2 Data API (`https://damm-v2.datapi.meteora.ag`), Expo ~55, React Native 0.83, zustand 5, react-native-svg, expo-haptics.

**Spec:** `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md`. The relevant parts:
- "Server additions" → "Migration and the price after it" (lines 217-220);
- "Trading" (lines 281-296);
- "Coin info" (lines 297-311);
- the piece 2 row of "Pieces" (line 110).

**Before this plan:** piece 1 (`docs/superpowers/plans/2026-10-01-mooner-seeker-core-app.md`) is built on `feat/mooner-wireframe` at 03f1b65. The engine has 274 tests and the phone 120.

---

## Ground rules for every task

- **Branch and commits.** Work on branch `feat/mooner-wireframe` and commit after each task with the command given. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit or print** `.env` files, anything under `engine/.mainnet`, keypair files, `site/`, `launch-test/`, `launch.py` or `.claude/`. Stage files by name, never `git add -A` or `git add .`.
- **Servers.** Never start dev servers, the local engine server, or Metro. The only exceptions are `mobile/scripts/check-bundle.sh` and `mobile/scripts/run-android.sh`, where a step names them.
- **Never deploy. Never send SOL.**
- **Never trade or sign.** Never press Buy or Sell inside a sheet, and never approve anything in Seed Vault. Opening a sheet and reading its quote is fine: a quote signs nothing. Real trades are the user's (Task 8).
- **Copy.** No game words ("players", "lobby", "match").
- **Real data only.** Real screens show only real data. A figure no source has says "Not known yet"; there are no placeholder numbers or mock rows.
- **Live data is pushed** over the socket and chain subscriptions; there are no client polling loops. A one-time read when a screen opens is fine; a timer that re-reads is not. The lock's 1 s countdown clock reads no server.
- **File names.** Never create two files whose names differ only by case. macOS's filesystem is case-insensitive, so writing `Chart.js` overwrites `chart.js`. That's why the chart component is `PriceChart.js`.
- **Golden digests.** `engine/src/selftest.js` (`GOLDEN_JOIN`, `GOLDEN_ER`) must not change. This plan doesn't touch the join.
- **Test commands:**
  - engine: `cd engine && npm test`;
  - phone: `cd mobile && npm test`;
  - web build: `cd web && npm run build` must exit 0. It reads `web/.env`, which exists; don't print it;
  - web type-check: `cd web && npx tsc -p tsconfig.check.json --noEmit` has 55 errors at 03f1b65, and its count must not grow;
  - bundle check: `cd mobile && sh scripts/check-bundle.sh` prints `web3.js copies: 1; files from engine/node_modules: 0`.
- **zustand selectors.** A selector passed to `useStore` returns a stable value: a primitive, or an object already in the state.
- **Edit blocks.** Each "Replace … with …" block occurs exactly once in its file at the moment you apply it. Apply a file's replacements in the order given. Blocks marked "Create" and "Replace all of" are the whole file. Every block was applied in order to a copy of 03f1b65 and checked to give the final file exactly. If a block isn't found (the branch moved past 03f1b65 in that file), stop and report; don't guess the edit.

## Server data shapes (checked against engine/server, 2026-10-01)

BigInts and PublicKeys arrive as strings (`engine/server/http.js` `toJson`). The live protocol is `{ op: "sub" | "unsub", topics }` → `{ topic, type, data }` (`engine/server/hub.js`). When a snapshot read fails, the server sends `{ type: "error", error: "couldn't read this right now" }`. While someone is still on the topic, it tries again up to 3 times, `retryMs` apart (`feed.js` `snapshot`).

- **Launched row** (`launched` topic, `GET /api/launched`): `{ presale, mint, token, launch, pool: { address, quoteReserve, sqrtPrice, migrated, damm } | null }`.
  - **New:** `pool.damm`, the DAMM v2 pool's address, or null.
  - Once `damm` is set, `pool.sqrtPrice` is the DAMM v2 pool's price. It has the same Q64.64 meaning (lamports per raw token), so `priceFromSqrt` and `marketCapSol` read it unchanged.
  - `quoteReserve` and `migrated` stay the DBC pool's.
  - `launch.at` is in ms: the server's clock once the launch tx confirmed.
- **`coin:<mint>`** (new; at most 4 per socket). Its snapshot `data` is:
  `{ mint, venue: "dbc" | "damm", pool, candles: [{ t, o, h, l, c }], candleMs: 60000 | 300000, source: "geckoterminal" | "meteora" | "mooner" | null, volume24hUsd, liquidityUsd, holders, top: [{ owner, amount, label }] | null, supply, at }`.
  - Prices are SOL per whole token. `t` is in ms. `amount` and `supply` are raw-unit strings (6 decimals).
  - `label` is `"Bonding curve"`, `"Pool"`, `"Presale"` or null.
  - Any figure a source didn't give is null.
  - A mint that isn't a Mooner coin gets `{ type: "missing" }`.
- **`wallet:<wallet>`** (unchanged): `{ type: "snapshot", data: { lamports } }`. It's sent on subscribe and again each time the wallet account changes (`feed.js` `watchWallet`, which uses `onAccountChange`). Token accounts are other accounts, so a token transfer alone doesn't fire it.
- **`GET /api/health`:** the `live` object gains `damm` (migrated coins whose DAMM v2 pool is watched) and `coins` (coins someone has open).
- **Today:** on 2026-10-01, `https://app.mooner.family/api/launched` returns `{"launched":[]}`, so the coin screen can't be seen on mainnet until the first launch.

## Outside APIs (read 2026-10-01; tests use replies trimmed from these)

- **Jupiter `GET /swap/v1/quote?inputMint&outputMint&amount&slippageBps`.**
  - Fields read: `inAmount`, `outAmount`, `otherAmountThreshold`, `priceImpactPct` and `routePlan[].swapInfo.{ammKey,label}`.
  - When there's no route, it answers 400 with `errorCode` `TOKEN_NOT_TRADABLE` or `NO_ROUTES_FOUND`.
  - For the trial coin `GS2x…`, it routed its DBC pool `8bnXSQC6…` with the label "Dynamic Bonding Curve" and `priceImpactPct` "0".
- **Jupiter `POST /swap/v1/swap`.**
  - Body: `{ quoteResponse, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, computeUnitPriceMicroLamports }`.
  - Reply: `{ swapTransaction (base64 v0 tx), lastValidBlockHeight, prioritizationFeeLamports, computeUnitLimit, simulationError }`.
- **GeckoTerminal `/networks/solana/pools/<pool>/ohlcv/minute?aggregate=1&limit=300&currency=token`.** Candles come newest first, and a minute can be listed twice. `/pools/<pool>` gives `reserve_in_usd` and `volume_usd.h24`.
- **Meteora `GET /pools/<pool>`** gives `current_price`, `tvl`, `volume["24h"]` and `token_x.holders`. **`GET /pools/<pool>/ohlcv?timeframe=5m&start_time&end_time`** gives at most 6 hours a call. The limit is 10 requests a second (spec line 95).

## File map

**Shared (engine/src, tested under Node):**
- Create `engine/src/swap.js`: Jupiter quotes and swaps, the signer check, sign-then-send, a trade's errors in words, the pool fee and price impact, token balances.
- Create `engine/src/market.js`: GeckoTerminal and Meteora DAMM v2 Data API reads (candles, volume, TVL, holders).
- Create `engine/src/damm.js`: the DAMM v2 program, its pool PDA, its layout, and finding a migrated coin's pool.
- Modify `engine/src/tx.js`: `sendSigned` gets a `preflight` option, off by default.
- Modify `engine/src/views.js`: `tradeOpensAt(row)`.
- Modify `web/src/real/market.ts`: becomes an adapter over `swap.js` and `market.js`.

**Server (engine/server):**
- Modify `feed.js`:
  - it becomes an `EventEmitter` with the `migrated` event;
  - it reads the pools at start;
  - it finds and watches DAMM v2 pools;
  - it records its own candles;
  - it serves `coin:<mint>`.
- Create `coinstats.js`: one coin's stats from the right source, and the top holders and supply from chain.
- Modify `store.js` (a `candles` table), `hub.js` (the `coin:` topic, 4 per socket), `api.js` (`makeReads({ damm })`) and `main.js` (hands `feed.dammOf` to the reads).

**Tests and fixtures (engine/test):**
- Create `swap.test.js`, `market.test.js`, `damm.test.js` and `coinstats.test.js`.
- Create two fixtures from mainnet: `fixtures/dbc-pool-migrated.json` and `fixtures/damm-pool.json`.
- Modify `views.test.js`, `dbc.test.js`, `live.test.js` and `server.test.js`.

**Phone (mobile/):**
- Create `src/trading.js`: `makeMarket({ conn, priority })`.
- Modify `src/store.js` (coin stats, holdings, `watchCoin`, `preview`, `trade`) and `src/app.js` (the RPC connection and the market).
- Create `src/launched/chart.js` (chart math), `src/launched/PriceChart.js` (the chart), `src/launched/trade.js` (what the sheets say) and `src/launched/TradeSheet.js` (the sheets).
- Modify `src/launched/coin.js` (liquidity, volume, holders, position, `atMigration`), `src/launched/CoinRow.js` and `app/coin/[key].js`.
- Create `test/trading.test.mjs`, `test/chart.test.mjs` and `test/trade.test.mjs`. Modify `test/store.test.mjs` and `test/launched.test.mjs`.

---

### Task 1: Shared trade code (`engine/src/swap.js`, `engine/src/market.js`)

The website trades in `web/src/real/market.ts`: a Jupiter quote, Jupiter's swap tx, and the wallet adapter's `sendTransaction`. The phone can't use that as is: Seed Vault signs and does not send, so the phone signs with `signTransaction` and sends the tx itself. This task moves trading into `engine/src/swap.js` for both apps and adds what the phone needs:

- a check, before the wallet sees the tx, that the wallet is its one signer (spec, "Trading"), and again after it signed;
- sending a signed tx with a preflight (`sendSigned(..., { preflight: true })`), so a trade that would fail costs nothing;
- Jupiter's slippage error (program `JUP6Lkb…`, custom 6001) and "no route" in words;
- what a sheet shows: the 1% pool fee on a route through the coin's own pool, and the price impact against the pool's live price.

Market data for the server (Task 4) goes in `engine/src/market.js`: GeckoTerminal candles and 24h volume for a DBC pool, and Meteora's DAMM v2 Data API (candles, TVL, volume, holder count) for a migrated coin. The test replies are trimmed from the real APIs, read on 2026-10-01. `views.js` gains `tradeOpensAt(row)`: Buy and Sell open 4 s after `launch.at`, the 3 s snipe tax (`dbc.js` `CURVE.SNIPE_S`) plus the keeper's 1 s margin.

**Files:**
- Create: `engine/test/swap.test.js`
- Create: `engine/test/market.test.js`
- Modify: `engine/test/views.test.js`
- Create: `engine/src/swap.js`
- Create: `engine/src/market.js`
- Modify: `engine/src/tx.js`
- Modify: `engine/src/views.js`
- Modify: `web/src/real/market.ts`

- [ ] **Step 1: Write the failing tests**

Create `engine/test/swap.test.js`:

```js
// Trading through Jupiter (engine/src/swap.js) against a fake fetch and a fake RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { MEMO } from "../src/consts.js";
import { sendSigned } from "../src/tx.js";
import {
  buildSwap, buyQuote, explainSwap, impactOf, JUP, JUP_PROGRAM, NO_ROUTE, NO_ROUTE_TEXT, onlyWalletSigns, poolFee, quote,
  sellAmount, sellQuote, swap, tokenBalance, WSOL,
} from "../src/swap.js";

const MINT = "GS2xpNeKkon1rQHa7XcwkbZ65yP3rBT2v4uh2KMdQDeC";
const POOL = "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri";
const wallet = Keypair.generate();
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

// Jupiter's answer for 0.01 SOL of the trial coin (mainnet, 2026-10-01), trimmed to the fields swap.js reads
const QUOTE = {
  inputMint: WSOL, inAmount: "10000000", outputMint: MINT, outAmount: "348894380365", otherAmountThreshold: "338427548955",
  swapMode: "ExactIn", slippageBps: 300, platformFee: null, priceImpactPct: "0",
  routePlan: [{ swapInfo: { ammKey: POOL, label: "Dynamic Bonding Curve", inputMint: WSOL, outputMint: MINT, inAmount: "10000000", outAmount: "348894380365" }, percent: 100, bps: null }],
  contextSlot: 452276981, transactionVersion: 0,
};

/** A fetch that answers each call with the next reply, and logs every call. */
function fakeFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const [status, json] = replies.shift();
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}

/** A v0 tx like Jupiter's: the wallet pays; `also` adds a second signer. */
function jupTx(payer = wallet.publicKey, also = null) {
  const ixs = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 })];
  if (also) ixs.push(new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: also, isSigner: true, isWritable: false }], data: Buffer.from("x") }));
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: BLOCKHASH, instructions: ixs }).compileToV0Message());
}
const built = (tx, over = {}) => ({
  swapTransaction: Buffer.from(tx.serialize()).toString("base64"), lastValidBlockHeight: 430317386, prioritizationFeeLamports: 8795,
  computeUnitLimit: 87951, simulationError: null, ...over,
});

/** An RPC that records sends and says each signature landed. */
function fakeConn({ status = { confirmationStatus: "confirmed", err: null } } = {}) {
  const sent = [];
  return {
    sent,
    rpcEndpoint: "https://rpc",
    sendRawTransaction: async (raw, opts) => (sent.push(opts), "SIG"),
    getSignatureStatuses: async () => ({ value: [status] }),
    getBlockHeight: async () => 1,
    confirmTransaction: async (args) => (sent.push(["confirm", args]), { value: { err: null } }),
  };
}

test("quote: the URL Jupiter gets, the amounts as BigInt, the route", async () => {
  const f = fakeFetch([200, QUOTE]);
  const q = await buyQuote(MINT, 10_000_000n, { fetch: f });
  assert.equal(f.calls[0].url, `${JUP}/quote?inputMint=${WSOL}&outputMint=${MINT}&amount=10000000&slippageBps=300`);
  assert.deepEqual([q.inAmount, q.outAmount, q.minOut, q.impact], [10_000_000n, 348_894_380_365n, 338_427_548_955n, 0]);
  assert.deepEqual(q.route, [{ amm: POOL, label: "Dynamic Bonding Curve" }]);
  assert.equal(q.raw, QUOTE);
  const s = fakeFetch([200, { ...QUOTE, inputMint: MINT, outputMint: WSOL }]);
  await sellQuote(MINT, 5n, { fetch: s, slippageBps: 100 });
  assert.equal(s.calls[0].url, `${JUP}/quote?inputMint=${MINT}&outputMint=${WSOL}&amount=5&slippageBps=100`);
});

test("quote: no route is its own error, in the website's words", async () => {
  // Jupiter's replies, mainnet 2026-10-01: an unknown mint, and a pair with no pool
  const notTradable = { error: "The token X is not tradable", errorCode: "TOKEN_NOT_TRADABLE" };
  const noRoutes = { error: "No routes found", errorCode: "NO_ROUTES_FOUND" };
  for (const reply of [[400, notTradable], [400, noRoutes], [200, { ...QUOTE, outAmount: "0" }], [200, {}]]) {
    const e = await quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch(reply) }).catch((x) => x);
    assert.equal(e.message, NO_ROUTE);
    assert.equal(e.noRoute, true);
    assert.equal(explainSwap(e), NO_ROUTE_TEXT);
  }
  const other = await quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch([429, { error: "Rate limit exceeded" }]) }).catch((x) => x);
  assert.equal(other.message, "Rate limit exceeded");
  const bare = await quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch([502, null]) }).catch((x) => x);
  assert.equal(bare.message, "Jupiter said 502");
});

test("buildSwap: the body Jupiter gets, with the phone's priority or Jupiter's auto", async () => {
  const tx = jupTx();
  const f = fakeFetch([200, built(tx)], [200, built(tx)]);
  const q = await quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch([200, QUOTE]) });
  const b = await buildSwap({ quote: q, wallet: wallet.publicKey, priority: 100_000, fetch: f });
  assert.equal(f.calls[0].url, `${JUP}/swap`);
  assert.deepEqual(f.calls[0].body, {
    quoteResponse: QUOTE, userPublicKey: wallet.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, computeUnitPriceMicroLamports: 100_000,
  });
  assert.deepEqual([b.lastValidBlockHeight, b.simulationError, b.units, b.priorityLamports], [430317386, null, 87951, 8795]);
  assert.deepEqual(b.tx.serialize(), tx.serialize());
  await buildSwap({ quote: q, wallet: wallet.publicKey, fetch: f });
  assert.equal(f.calls[1].body.prioritizationFeeLamports, "auto");
  assert.equal("computeUnitPriceMicroLamports" in f.calls[1].body, false);
});

test("onlyWalletSigns: one signer, and it's the wallet", () => {
  assert.equal(onlyWalletSigns(jupTx(), wallet.publicKey), true);
  assert.equal(onlyWalletSigns(jupTx(Keypair.generate().publicKey), wallet.publicKey), false, "someone else pays");
  assert.equal(onlyWalletSigns(jupTx(wallet.publicKey, Keypair.generate().publicKey), wallet.publicKey), false, "a second signer");
});

async function q0() {
  return quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch([200, QUOTE]) });
}

test("swap (phone): checks, the wallet signs, sent with a preflight until it lands", async () => {
  const conn = fakeConn();
  const steps = [];
  let asked = null;
  const signTransaction = async (tx) => ((asked = tx), tx.sign([wallet]), tx);
  const sig = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction, priority: 100_000, fetch: fakeFetch([200, built(jupTx())]), onStep: (s) => steps.push(s) });
  assert.equal(sig, "SIG");
  assert.ok(asked instanceof VersionedTransaction);
  assert.deepEqual(conn.sent, [{ skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" }]);
  assert.deepEqual(steps, ["Checking the trade", "Sign the trade in your wallet", "Sending"]);
});

test("sendSigned skips the preflight unless asked: the keeper's sends are unchanged", async () => {
  const conn = fakeConn();
  const tx = jupTx();
  tx.sign([wallet]);
  assert.equal(await sendSigned(conn, tx), "SIG");
  assert.equal(await sendSigned(conn, tx, { preflight: true }), "SIG");
  assert.deepEqual(conn.sent, [{ skipPreflight: true, maxRetries: 0 }, { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" }]);
});

test("swap stops before the wallet: Jupiter's simulation failed, or another signer", async () => {
  const conn = fakeConn();
  let asked = false;
  const signTransaction = async (tx) => ((asked = true), tx);
  const sim = { errorCode: "TRANSACTION_ERROR", error: "Attempt to debit an account but found no record of a prior credit." };
  const e1 = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction, fetch: fakeFetch([200, built(jupTx(), { simulationError: sim })]) }).catch((x) => x);
  assert.equal(explainSwap(e1), "Your wallet needs a little more SOL to cover rent and the Solana fee.");
  const e2 = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction, fetch: fakeFetch([200, built(jupTx(wallet.publicKey, Keypair.generate().publicKey))]) }).catch((x) => x);
  assert.equal(e2.message, "This trade asks for a signer besides your wallet, so it wasn't sent.");
  assert.equal(asked, false);
  assert.deepEqual(conn.sent, []);
});

test("swap stops after the wallet when its signature doesn't cover the tx", async () => {
  const conn = fakeConn();
  const other = Keypair.generate();
  const unsigned = async (tx) => tx; // handed back without a signature
  const e1 = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction: unsigned, fetch: fakeFetch([200, built(jupTx())]) }).catch((x) => x);
  assert.equal(e1.message, "The wallet's signature didn't check out. Try another wallet.");
  const swapped = async () => {
    const t = jupTx(other.publicKey);
    t.sign([other]);
    return t;
  };
  const e2 = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction: swapped, fetch: fakeFetch([200, built(jupTx())]) }).catch((x) => x);
  assert.equal(e2.message, "The wallet's signature didn't check out. Try another wallet.");
  assert.deepEqual(conn.sent, []);
});

test("swap (website): the wallet sends, confirmed against Jupiter's blockhash and its last block height", async () => {
  const conn = fakeConn();
  const tx = jupTx();
  const sendTransaction = async (t, c) => (assert.equal(c, conn), "WEBSIG");
  const sig = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, sendTransaction, fetch: fakeFetch([200, built(tx)]) });
  assert.equal(sig, "WEBSIG");
  assert.deepEqual(conn.sent, [["confirm", { signature: "WEBSIG", blockhash: BLOCKHASH, lastValidBlockHeight: 430317386 }]]);
});

test("explainSwap: Jupiter's slippage error, from logs or from the tx error; the rest as flows.explain", () => {
  const logs = [`Program ${JUP_PROGRAM} invoke [1]`, `Program ${JUP_PROGRAM} failed: custom program error: 0x1771`];
  const slipped = "The price moved more than 3% before your trade landed, so it didn't go through. Try again.";
  assert.equal(explainSwap(Object.assign(new Error("Simulation failed."), { transactionLogs: logs })), slipped);
  assert.equal(explainSwap(Object.assign(new Error("trade (SIG): ix 3 (x): custom 6001"), { logs })), slipped);
  assert.equal(explainSwap(new Error(`trade (SIG): ix 3 (${JUP_PROGRAM}): custom 6001`)), slipped);
  // another program's 6001 isn't Jupiter's slippage
  const dbc = ["Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN failed: custom program error: 0x1771"];
  assert.equal(explainSwap(Object.assign(new Error("trade (SIG): ix 3 (dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN): custom 6001"), { logs: dbc })), "trade (SIG): ix 3 (dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN): custom 6001");
  assert.equal(explainSwap(new Error("User rejected the request")), "You cancelled it in your wallet.");
});

test("tokenBalance: every account of the mint, summed", async () => {
  const acc = (amount) => ({ account: { data: { parsed: { info: { tokenAmount: { amount, decimals: 6 } } } } } });
  let asked;
  const conn = { getParsedTokenAccountsByOwner: async (owner, filter) => ((asked = [owner, filter]), { value: [acc("1500000"), acc("250000")] }) };
  const mint = new PublicKey(MINT);
  assert.deepEqual(await tokenBalance(conn, wallet.publicKey, mint), { raw: 1_750_000n, decimals: 6, ui: 1.75 });
  assert.deepEqual(asked, [wallet.publicKey, { mint }]);
  const none = { getParsedTokenAccountsByOwner: async () => ({ value: [] }) };
  assert.deepEqual(await tokenBalance(none, wallet.publicKey, mint), { raw: 0n, decimals: 6, ui: 0 });
});

test("poolFee: 1% on the SOL side when the route is the coin's own pool", () => {
  const buy = { inAmount: 1_000_000_000n, outAmount: 5n, route: [{ amm: POOL }] };
  assert.equal(poolFee("buy", buy, [POOL]), 10_000_000n);
  const sell = { inAmount: 5n, outAmount: 990_000_000n, route: [{ amm: POOL }] };
  assert.equal(poolFee("sell", sell, [POOL]), 10_000_000n);
  assert.equal(poolFee("buy", { ...buy, route: [{ amm: POOL }, { amm: "Other" }] }, [POOL]), null);
  assert.equal(poolFee("buy", { ...buy, route: [] }, [POOL]), null);
});

test("impactOf: against the pool's price, the fee left out; Jupiter's when larger or no price", () => {
  // sqrt of 1 lamport per raw token: 1 SOL buys 0.99e9 raw at no impact
  const ONE = (1n << 64n).toString();
  const buy = (out) => ({ inAmount: 1_000_000_000n, outAmount: out, impact: 0 });
  assert.equal(impactOf("buy", buy(990_000_000n), ONE), 0);
  assert.ok(Math.abs(impactOf("buy", buy(891_000_000n), ONE) - 0.1) < 1e-12);
  const sell = { inAmount: 1_000_000_000n, outAmount: 495_000_000n, impact: 0 };
  assert.ok(Math.abs(impactOf("sell", sell, ONE) - 0.5) < 1e-12);
  assert.equal(impactOf("buy", { ...buy(990_000_000n), impact: 0.2 }, ONE), 0.2);
  assert.equal(impactOf("buy", { ...buy(1n), impact: 0.03 }, null), 0.03);
});

test("sellAmount: a share of what's held, all of it at 100%", () => {
  assert.equal(sellAmount(1_000_003n, 25), 250_000n);
  assert.equal(sellAmount(1_000_003n, 50), 500_001n);
  assert.equal(sellAmount(1_000_003n, 100), 1_000_003n);
});
```

Create `engine/test/market.test.js`:

```js
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
```

In `engine/test/views.test.js` (append at the end), replace:

```js
  assert.equal(canGetBack(open({ seats: [seat({ commit: "0", creator: true })], state: "FULL" }), "W", NOW), false);
});
```

with:

```js
  assert.equal(canGetBack(open({ seats: [seat({ commit: "0", creator: true })], state: "FULL" }), "W", NOW), false);
});

test("tradeOpensAt: launch time plus the snipe tax (dbc.js's) and the keeper's margin", async () => {
  const { CURVE } = await import("../src/dbc.js");
  const { SNIPE_S, TAX_MARGIN_S, tradeOpensAt } = await import("../src/views.js");
  assert.equal(SNIPE_S, CURVE.SNIPE_S);
  assert.equal(TAX_MARGIN_S, 1);
  assert.equal(tradeOpensAt({ launch: { at: NOW } }), NOW + 4_000);
  assert.equal(tradeOpensAt({ launch: null }), null);
  assert.equal(tradeOpensAt(undefined), null);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd engine && node --test test/swap.test.js test/market.test.js test/views.test.js`
Expected: 10 pass, 3 fail: `swap.test.js` and `market.test.js` stop at `ERR_MODULE_NOT_FOUND` (`src/swap.js`, `src/market.js`); the new views test fails (`SNIPE_S` is undefined)

- [ ] **Step 3: Write the code**

Create `engine/src/swap.js`:

```js
// Buying and selling a launched coin through Jupiter's swap API (swap v1): a quote, the
// swap tx Jupiter builds for it, a check that the wallet is the only signer, the wallet's
// signature, then send and confirm. Jupiter routes the coin's Meteora pool (DBC before
// migration, DAMM v2 after). The web app and the phone app both trade through this file;
// `fetch` is handed in so tests use fakes. No node: imports (Buffer is global: Node, or
// the app's polyfill).

import { VersionedTransaction } from "@solana/web3.js";
import { describeTxError, failedWith } from "./consts.js";
import { explain } from "./flows.js";
import { sendSigned, TxError, txLogs } from "./tx.js";
import { walletSigned } from "./walletcheck.js";

export const JUP = "https://lite-api.jup.ag/swap/v1";
/** Jupiter's aggregator program (v6), the program in every swap tx it builds. */
export const JUP_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
/** Its SlippageToleranceExceeded (the program's IDL, error 6001). */
export const JUP_SLIPPAGE = 6001;
export const WSOL = "So11111111111111111111111111111111111111112";
/** 3%: a trade gets at least 97% of what it was quoted, or it fails. */
export const SLIPPAGE_BPS = 300;
/** The words the website shows when Jupiter has no route (yet) for a coin. */
export const NO_ROUTE = "no route for this trade yet";
export const RAW_PER_TOKEN = 1_000_000n; // Mooner coins have 6 decimals
export const LAMPORTS_PER_SOL = 1_000_000_000n;

const noRoute = () => Object.assign(new Error(NO_ROUTE), { noRoute: true });

async function readJson(r) {
  return r.json().catch(() => null);
}

/** A Jupiter quote for `amount` (BigInt, the input's smallest units). Returns { inAmount,
 *  outAmount, minOut (BigInt), impact (a fraction, Jupiter's own), route: [{ amm, label }],
 *  raw } or throws: an error with `noRoute` when Jupiter has no route for this coin. */
export async function quote({ input, output, amount, slippageBps = SLIPPAGE_BPS, fetch = globalThis.fetch }) {
  const r = await fetch(`${JUP}/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=${slippageBps}`);
  const j = await readJson(r);
  // a mint Jupiter doesn't know (yet) is TOKEN_NOT_TRADABLE, a pool it can't use NO_ROUTES_FOUND (both 400)
  if (!r.ok) throw /NOT_TRADABLE|ROUTE/.test(j?.errorCode ?? "") ? noRoute() : new Error(j?.error ?? `Jupiter said ${r.status}`);
  if (!j?.outAmount || j.outAmount === "0") throw noRoute();
  return {
    inAmount: BigInt(j.inAmount),
    outAmount: BigInt(j.outAmount),
    minOut: BigInt(j.otherAmountThreshold),
    impact: Number(j.priceImpactPct) || 0,
    route: (j.routePlan ?? []).map((h) => ({ amm: h.swapInfo?.ammKey, label: h.swapInfo?.label })),
    raw: j,
  };
}

/** A buy of `lamports` (BigInt) of SOL, or a sell of `raw` (BigInt) of the coin. */
export const buyQuote = (mint, lamports, opts = {}) => quote({ input: WSOL, output: mint, amount: lamports, ...opts });
export const sellQuote = (mint, raw, opts = {}) => quote({ input: mint, output: WSOL, amount: raw, ...opts });

/** The swap tx Jupiter builds for quote `q`, for `wallet` (PublicKey). With `priority`
 *  (micro-lamports per CU) the tx pays exactly that; without, Jupiter picks ("auto").
 *  Returns { tx (VersionedTransaction), lastValidBlockHeight, simulationError (text or
 *  null: Jupiter ran it and it failed), units, priorityLamports }. */
export async function buildSwap({ quote: q, wallet, priority = null, fetch = globalThis.fetch }) {
  const body = {
    quoteResponse: q.raw,
    userPublicKey: wallet.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    ...(priority ? { computeUnitPriceMicroLamports: priority } : { prioritizationFeeLamports: "auto" }),
  };
  const r = await fetch(`${JUP}/swap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await readJson(r);
  if (!r.ok || !j?.swapTransaction) throw new Error(j?.error ?? `Jupiter said ${r.status}`);
  return {
    tx: VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64")),
    lastValidBlockHeight: j.lastValidBlockHeight,
    simulationError: j.simulationError ? j.simulationError.error ?? JSON.stringify(j.simulationError) : null,
    units: j.computeUnitLimit,
    priorityLamports: j.prioritizationFeeLamports,
  };
}

/** Whether `wallet` is the one and only signer of `tx` (and so pays its fee). */
export function onlyWalletSigns(tx, wallet) {
  const m = tx.message;
  return m.header.numRequiredSignatures === 1 && m.staticAccountKeys[0].equals(wallet);
}

/**
 * Builds the swap for quote `q`, checks it and has the wallet sign it. Returns the signature
 * once it's confirmed. Two ways to sign:
 *   signTransaction(tx) -> signed tx (the phone: Seed Vault signs only): the signed tx is
 *     checked again (still only the wallet signs, its signature covers the tx) and sent
 *     here, with a preflight, until it lands or its blockhash runs out;
 *   sendTransaction(tx, conn) -> signature (the website's wallet adapter signs and sends).
 * `onStep(text)` names what it waits for.
 */
export async function swap({ quote: q, wallet, conn, signTransaction = null, sendTransaction = null, priority = null, fetch = globalThis.fetch, onStep = (_step) => {} }) {
  onStep("Checking the trade");
  const b = await buildSwap({ quote: q, wallet, priority, fetch });
  if (b.simulationError) throw new Error(b.simulationError);
  if (!onlyWalletSigns(b.tx, wallet)) throw new Error("This trade asks for a signer besides your wallet, so it wasn't sent.");
  onStep("Sign the trade in your wallet");
  if (signTransaction) {
    const signed = await signTransaction(b.tx);
    if (!onlyWalletSigns(signed, wallet) || !walletSigned(signed, wallet)) throw new Error("The wallet's signature didn't check out. Try another wallet.");
    onStep("Sending");
    return sendSigned(conn, signed, { what: "trade", lastValidBlockHeight: b.lastValidBlockHeight, preflight: true });
  }
  const sig = await sendTransaction(b.tx, conn);
  onStep("Sending");
  const r = await conn.confirmTransaction({ signature: sig, blockhash: b.tx.message.recentBlockhash, lastValidBlockHeight: b.lastValidBlockHeight }, "confirmed");
  if (r.value.err) {
    const logs = await txLogs(conn, sig);
    throw new TxError(sig, describeTxError(r.value.err, [], null, logs), logs, "trade");
  }
  return sig;
}

const SLIPPED = "The price moved more than 3% before your trade landed, so it didn't go through. Try again.";
export const NO_ROUTE_TEXT = "No route for this trade yet. Try again in a moment.";

/** A trade's error in plain words: no route, slippage, else what flows.explain says. */
export function explainSwap(e) {
  if (e?.noRoute || e?.message === NO_ROUTE) return NO_ROUTE_TEXT;
  const m = e?.message ?? String(e);
  const logs = e?.transactionLogs ?? (Array.isArray(e?.logs) ? e.logs : []);
  const by = failedWith([...logs, m]);
  if (by?.program === JUP_PROGRAM && by.code === JUP_SLIPPAGE) return SLIPPED;
  if (m.includes(`(${JUP_PROGRAM}): custom ${JUP_SLIPPAGE}`)) return SLIPPED;
  return explain(e);
}

/** The wallet's balance of `mint` (PublicKey): { raw (BigInt), decimals, ui }. Both token
 *  programs: the RPC finds the mint's own. */
export async function tokenBalance(conn, owner, mint) {
  const r = await conn.getParsedTokenAccountsByOwner(owner, { mint });
  let raw = 0n;
  let decimals = 6;
  for (const a of r.value) {
    const amount = a.account.data.parsed?.info?.tokenAmount;
    if (!amount) continue;
    raw += BigInt(amount.amount);
    decimals = amount.decimals;
  }
  return { raw, decimals, ui: Number(raw) / 10 ** decimals };
}

// ---- what a trade sheet shows ----

/** Pool fee Mooner's pools charge: 1% (DBC's floor after the snipe tax, dbc.js
 *  CURVE.FEE_FLOOR; DAMM v2 FixedBps100 after migration, migrationFeeOption 2). */
export const POOL_FEE_BPS = 100;

/** The pool fee of a quote in lamports, when every hop is one of `pools` (base58 pool
 *  addresses: the coin's DBC pool and, once migrated, its DAMM v2 pool); null when the route
 *  goes through other pools (their fees are in the price). Taken on the SOL side: the SOL
 *  going in for a buy, the SOL coming out for a sell (the out is what's left after it). */
export function poolFee(side, q, pools, feeBps = POOL_FEE_BPS) {
  if (!q.route.length || !q.route.every((h) => pools.includes(h.amm))) return null;
  const fee = BigInt(feeBps);
  return side === "buy" ? (q.inAmount * fee) / 10_000n : (q.outAmount * fee) / (10_000n - fee);
}

/** Price impact as a fraction: how much worse than the pool's price right now (its Q64.64
 *  `sqrtPrice`, lamports per raw token) the quote is, the pool fee left out. Jupiter's own
 *  figure when it's larger (it reads 0 for a DBC route) or when the price isn't known. */
export function impactOf(side, q, sqrtPrice, feeBps = POOL_FEE_BPS) {
  if (sqrtPrice == null) return q.impact;
  const s = Number(BigInt(sqrtPrice)) / 2 ** 64;
  const spot = s * s; // lamports per raw token
  const keep = 1 - feeBps / 10_000;
  const fair = side === "buy" ? (Number(q.inAmount) * keep) / spot : Number(q.inAmount) * spot * keep;
  if (!(fair > 0)) return q.impact;
  return Math.max(q.impact, 0, 1 - Number(q.outAmount) / fair);
}

/** The raw amount a sell of `pct` percent (25, 50 or 100) of `raw` (BigInt) is. */
export const sellAmount = (raw, pct) => (pct >= 100 ? raw : (raw * BigInt(pct)) / 100n);
```

Create `engine/src/market.js`:

```js
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
```

In `engine/src/tx.js`, replace:

```js
 *  unknown (the keeper re-reads the chain before it acts again). */
export async function sendSigned(conn, tx, { ixs, pid, what = "tx", timeoutMs = 60_000, resendMs = 2_000, stuckMs = 300_000, lastValidBlockHeight } = {}) {
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  const t0 = Date.now();
```

with:

```js
 *  unknown (the keeper re-reads the chain before it acts again). */
export async function sendSigned(conn, tx, { ixs, pid, what = "tx", timeoutMs = 60_000, resendMs = 2_000, stuckMs = 300_000, lastValidBlockHeight, preflight = false } = {}) {
  const raw = tx.serialize();
  // `preflight`: the first send is simulated first, so a tx that would fail costs nothing
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: !preflight, maxRetries: 0, ...(preflight && { preflightCommitment: "confirmed" }) });
  const t0 = Date.now();
```

In `engine/src/views.js` (append at the end), replace:

```js
  return view.state === "EXPIRED" || view.state === "FAILED";
}
```

with:

```js
  return view.state === "EXPIRED" || view.state === "FAILED";
}

/** Seconds of DBC's snipe tax after a pool opens (engine/src/dbc.js CURVE.SNIPE_S: about
 *  99% in the launch second, the 1% floor from 3 s on; buys and sells alike). */
export const SNIPE_S = 3;
/** Past the tax, the same margin the keeper waits before it delivers presale tokens. */
export const TAX_MARGIN_S = 1;

/** When a launched coin's Buy and Sell open (ms): its launch time (`launch.at`, the
 *  server's clock once the launch tx confirmed, so after the pool opened) plus the tax and
 *  the margin. null when the row has no launch. */
export const tradeOpensAt = (row) => (row?.launch?.at == null ? null : Number(row.launch.at) + (SNIPE_S + TAX_MARGIN_S) * 1000);
```

- [ ] **Step 4: Run the tests**

Run: `cd engine && node --test test/swap.test.js test/market.test.js test/views.test.js`
Expected: 29 pass, 0 fail

- [ ] **Step 5: The website's type-check baseline**

Count the website's type errors before touching it; the count must be the same after the next step.

Run: `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep -c 'error TS'`
Expected: 55

- [ ] **Step 6: The website trades through it**

Its exports keep their names and signatures (`solUsd`, `candlesOf`, `tradesOf`, `quote`, `swap`, `tokenBalance`, `WSOL`), so `TradePanel.tsx` and the other callers don't change. One change in behavior: a swap's errors now come back in plain words (`explainSwap`).

Replace all of `web/src/real/market.ts` with:

```ts
// Market data and trades for launched coins. Quotes, swaps and token balances are the
// engine's (engine/src/swap.js), the code the phone app trades with; a swap is a
// transaction Jupiter builds and the user's wallet signs and sends. Candles come from
// GeckoTerminal through engine/src/market.js; trades of a pool from GeckoTerminal and SOL/USD
// from Jupiter, here.
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js'
import type { Candle, Trade } from '@/lib/types'
import { geckoCandles } from '../../../engine/src/market.js'
import { explainSwap, quote as jupQuote, swap as jupSwap, tokenBalance as balanceOf, WSOL } from '../../../engine/src/swap.js'

export { WSOL }

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana'
const JUP = 'https://lite-api.jup.ag'

async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init)
  const json = await r.json().catch(() => null)
  if (!r.ok) throw new Error(json?.error ?? json?.errors?.[0]?.title ?? `${new URL(url).host} said ${r.status}`)
  return json
}

/** SOL in USD from Jupiter. */
export async function solUsd(): Promise<number> {
  const j = await getJson(`${JUP}/price/v3?ids=${WSOL}`)
  const v = Number(j?.[WSOL]?.usdPrice)
  if (!(v > 0)) throw new Error('no SOL price')
  return v
}

/** One-minute candles in SOL per token, oldest first, one per minute. */
export const candlesOf = (pool: string, limit = 300): Promise<Candle[]> => geckoCandles(pool, { limit })

/** Recent trades, oldest first. `userId` is the trader's wallet. */
export async function tradesOf(pool: string, mint: string): Promise<{ trades: Trade[]; volumeUsd: number }> {
  const j = await getJson(`${GECKO}/pools/${pool}/trades`)
  const rows: { attributes: Record<string, string> }[] = j?.data ?? []
  let volumeUsd = 0
  const trades = rows.map(({ attributes: a }) => {
    const buy = a.kind === 'buy'
    // a buy spends SOL (from) for the token (to); a sell the other way round
    const sol = Number(buy ? a.from_token_amount : a.to_token_amount)
    const tokens = Number(buy ? a.to_token_amount : a.from_token_amount)
    volumeUsd += Number(a.volume_in_usd) || 0
    return {
      id: a.tx_hash,
      at: Date.parse(a.block_timestamp),
      userId: a.tx_from_address,
      side: buy ? 'buy' : 'sell',
      sol,
      tokens,
      price: tokens > 0 ? sol / tokens : 0,
    } satisfies Trade
  })
  void mint
  return { trades: trades.sort((a, b) => a.at - b.at), volumeUsd }
}

type EngineQuote = Awaited<ReturnType<typeof jupQuote>>

export interface Quote {
  inAmount: string
  outAmount: string
  priceImpactPct: string
  raw: EngineQuote
}

/** A Jupiter quote: `amount` in the input's smallest units. No route throws "no route for
 *  this trade yet". */
export async function quote(inputMint: string, outputMint: string, amount: bigint, slippageBps = 300): Promise<Quote> {
  const q = await jupQuote({ input: inputMint, output: outputMint, amount, slippageBps })
  return { inAmount: String(q.inAmount), outAmount: String(q.outAmount), priceImpactPct: String(q.impact), raw: q }
}

type SendTx = (tx: VersionedTransaction, conn: Connection) => Promise<string>

/** Builds the swap for a quote, checks the wallet is its only signer, has the wallet sign and
 *  send it, and waits for it against Jupiter's blockhash. Errors are in plain words. */
export async function swap(q: Quote, user: PublicKey, conn: Connection, sendTransaction: SendTx): Promise<string> {
  try {
    // engine/src is plain JS: its optional signer params read as null to TypeScript
    return await jupSwap({ quote: q.raw, wallet: user, conn, sendTransaction: sendTransaction as never })
  } catch (e) {
    throw new Error(explainSwap(e))
  }
}

/** The wallet's balance of a mint, in whole tokens (both token programs). */
export async function tokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<{ ui: number; raw: bigint; decimals: number }> {
  return balanceOf(conn, owner, mint)
}
```

- [ ] **Step 7: Full engine suite, web build, type-check**

Run: `cd engine && npm test`
Expected: 293 pass, 0 fail

Run: `cd web && npm run build`
Expected: exit 0

Run: `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep -c 'error TS'`
Expected: 55

- [ ] **Step 8: Commit**

```bash
git add engine/src/swap.js engine/test/swap.test.js engine/src/market.js engine/test/market.test.js engine/src/tx.js engine/src/views.js engine/test/views.test.js web/src/real/market.ts && git commit -m "engine: shared trading (swap.js) and market data (market.js); the web trades through them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The server hears a migration (the `migrated` event)

`decodePoolState` already reads a DBC pool's `migrated` flag, and `feed.js` publishes it on `launched`. Nothing notices when it flips (spec, "Server additions": XP and alerts listen for it, in later pieces). This task:

- tests the flag against a pool that really migrated: mainnet DBC pool `5Dekcwc2czGPBSaZbe7VrBgLF2EpBg2mecYRAeXArEb` (mint `AcgB3riC…`), read with `getAccountInfo` on 2026-10-01;
- makes `Feed` an `EventEmitter` that emits `"migrated"` (with the launched row) once, when a pool it watches flips from `false` to `true`;
- reads every pool once at start (`readPools`, one batched `accountsOf`), so a coin that migrated while the server was down doesn't fire the event when its pool next changes.

**Files:**
- Create: `engine/test/fixtures/dbc-pool-migrated.json`
- Modify: `engine/test/dbc.test.js`
- Modify: `engine/test/live.test.js`
- Modify: `engine/server/feed.js`

- [ ] **Step 1: The migrated pool's fixture and the failing tests**

The fixture is the account's bytes as `getAccountInfo` returned them (base64), copied byte for byte. The decode test passes at once: it pins the flag's offset against real data. The live test fails until the feed changes.

Create `engine/test/fixtures/dbc-pool-migrated.json` (mainnet account `5Dekcwc2…`, 424 bytes):

```json
{"pubkey": "5Dekcwc2czGPBSaZbe7VrBgLF2EpBg2mecYRAeXArEb", "data": "1eAF0WJFd1wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAuJIu05ry1oi1yN2nstpAK0USqFNYlvKEGvW382PAbgb6BP9rEwL8bk3HH00NEiNNtZU8PrJtFv3T0Gr/4VP2qI7czdM+x4J3olY/Lh0Qwtro+b2CMK3kxsi9JZBYhBgjz8R2nv94Lmb57JeupfGx8z51VvX2IIkB8QPS/wgba2WTsaPiSC1K8wXQ7JXPqgp9LHevFpDEES4/rIIjHZhSXB0+sKksvAAADhJlyhMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFWaYrH1VjAFAAAAAAAAAACus/IaAAAAAAABAAEDAAAAAAAAAAAAAAB32nkhAAAAAAAAAAAAAAAANzIQmgAAAABFnL1qAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAABQAAAAAAAAAj/xmWGAAAACA/iEKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="}
```

In `engine/test/dbc.test.js` (append at the end), replace:

```js
  assert.equal(decodePoolState(Buffer.alloc(424)), null);
});
```

with:

```js
  assert.equal(decodePoolState(Buffer.alloc(424)), null);
});

test("a migrated pool decodes: the migrated flag is set (byte 305; mainnet pool 5Dekcwc2…, read 2026-10-01)", () => {
  const acc = JSON.parse(readFileSync(new URL("./fixtures/dbc-pool-migrated.json", import.meta.url), "utf8"));
  assert.equal(acc.pubkey, "5Dekcwc2czGPBSaZbe7VrBgLF2EpBg2mecYRAeXArEb");
  const d = Buffer.from(acc.data, "base64");
  assert.equal(d.length, 424);
  // its base mint, the coin that trades on DAMM v2 pool GwvAt96o… now
  assert.equal(new PublicKey(d.subarray(136, 168)).toBase58(), "AcgB3riCTGBzQ626TRmEm1f6ikeFvxi4mL36piDXV6ug");
  const s = decodePoolState(d);
  assert.equal(s.migrated, true);
  assert.equal(s.quoteReserve, 85_000_000_014n);
  assert.equal(s.sqrtPrice, 373894382314756693n);
});
```

In `engine/test/live.test.js` (a `before` hook in `startLive`, pool helpers, and the new test), 3 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js

async function startLive({ paceMs = 60, hub: hubOpts = {} } = {}) {
  const l1 = fakeChain("l1");
```

   with:

```js

/** `before({ l1, store })` runs before the feed starts: what was there while the server was
 *  down. */
async function startLive({ paceMs = 60, hub: hubOpts = {}, before = () => {} } = {}) {
  const l1 = fakeChain("l1");
```

2. Replace:

```js
  const feed = new Feed({ reads, l1, ers: bot.ers, pid, dbcConfig: MOONER_DBC_CONFIG, store, db: store.db, paceMs, poolPaceMs: paceMs, retryMs: 100, log: (m) => logs.push(m) });
  const routes = makeSocialRoutes({ store, isPresale: () => true, onChat: (r) => feed.chat(r), onProfile: (w, p) => feed.profile(w, p) });
```

   with:

```js
  const feed = new Feed({ reads, l1, ers: bot.ers, pid, dbcConfig: MOONER_DBC_CONFIG, store, db: store.db, paceMs, poolPaceMs: paceMs, retryMs: 100, log: (m) => logs.push(m) });
  before({ l1, store });
  const routes = makeSocialRoutes({ store, isPresale: () => true, onChat: (r) => feed.chat(r), onProfile: (w, p) => feed.profile(w, p) });
```

3. Replace:

```js
    b.close();
    await s.close();
  }
});
```

   with:

```js
    b.close();
    await s.close();
  }
});

// ---- migration ----

const fixtureBytes = (name) => Buffer.from(JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).data, "base64");
/** The trial DBC pool's bytes, with the migrated flag (byte 305) set or not. */
const dbcPool = (migrated) => {
  const b = fixtureBytes("dbc-pool.json");
  b[305] = migrated ? 1 : 0;
  return b;
};
/** A launched coin on the fake chain: its DBC pool written, the launch recorded. */
function launchedCoin(l1, store, { migrated = false } = {}) {
  const { presale, mint } = newPresale(l1, store, { state: STATE.SETTLED });
  const pool = poolAddresses(MOONER_DBC_CONFIG, mint).pool;
  l1.put(pool, DBC, dbcPool(migrated));
  store.addLaunch(presale, mint, { sig: "LAUNCH", released: 9n, cost: 1n, tokens: 5n, units: 7 });
  return { presale, mint, pool };
}

test("migrated: one event when a pool's flag flips; none for a coin that migrated while the server was down", async () => {
  let old;
  const s = await startLive({ before: ({ l1, store }) => (old = launchedCoin(l1, store, { migrated: true })) });
  const coin = launchedCoin(s.l1, s.store);
  const events = [];
  const c = await s.client();
  try {
    s.feed.on("migrated", (row) => events.push(row.mint));
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.feed.launched(coin.presale);
    assert.equal((await c.next(on("launched", "upsert"))).data.pool.migrated, false);

    s.l1.write(coin.pool, DBC, dbcPool(true));
    assert.equal((await c.next(on("launched", "upsert"))).data.pool.migrated, true);
    assert.deepEqual(events, [coin.mint.toBase58()]);
    assert.ok(s.logs.some((l) => l.includes(`(${coin.mint.toBase58()}) migrated to DAMM v2`)), "logged");

    // the pool changes again, still migrated: no second event
    s.l1.write(coin.pool, DBC, dbcPool(true));
    await c.next(on("launched", "upsert"));
    // the coin that migrated before the start: its pool changes, and no event
    s.l1.write(old.pool, DBC, dbcPool(true));
    await c.next((m) => on("launched", "upsert")(m) && m.data.mint === old.mint.toBase58());
    assert.deepEqual(events, [coin.mint.toBase58()]);
  } finally {
    c.close();
    await s.close();
  }
});
```

- [ ] **Step 2: Run them and see the live test fail**

Run: `cd engine && node --test test/dbc.test.js test/live.test.js`
Expected: 16 pass, 1 fail (`s.feed.on is not a function`)

- [ ] **Step 3: The feed emits it**

In `engine/server/feed.js`, 9 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
//     presale once (paced) and pushes it to `presale:<key>` and `presales`
//   - each launched token's DBC pool: pushed to `launched` as it trades
//   - each watched wallet's SOL: `wallet:<wallet>`
```

   with:

```js
//     presale once (paced) and pushes it to `presale:<key>` and `presales`
//   - each launched token's DBC pool: pushed to `launched` as it trades; the flip of its
//     migrated flag is the "migrated" event (feed.on("migrated", row))
//   - each watched wallet's SOL: `wallet:<wallet>`
```

2. Replace:

```js

import { PublicKey } from "@solana/web3.js";
```

   with:

```js

import { EventEmitter } from "node:events";
import { PublicKey } from "@solana/web3.js";
```

3. Replace:

```js
import { decodePoolState } from "../src/dbc.js";
import { listItem } from "./api.js";
import { allProfiles, chatRows } from "./social.js";
```

   with:

```js
import { decodePoolState } from "../src/dbc.js";
import { accountsOf, listItem } from "./api.js";
import { allProfiles, chatRows } from "./social.js";
```

4. Replace:

```js

export class Feed {
  /**
```

   with:

```js

export class Feed extends EventEmitter {
  /**
```

5. Replace:

```js
  constructor({ reads, l1, ers, pid, dbcConfig, store, db, solFeed = PYTH_SOL_USD, paceMs = 1_000, poolPaceMs = 500, retryMs = 3_000, maxWallets = 2_000, log = console.log }) {
    Object.assign(this, { reads, l1, ers, pid, dbcConfig, store, db, solFeed, paceMs, poolPaceMs, retryMs, maxWallets, log });
```

   with:

```js
  constructor({ reads, l1, ers, pid, dbcConfig, store, db, solFeed = PYTH_SOL_USD, paceMs = 1_000, poolPaceMs = 500, retryMs = 3_000, maxWallets = 2_000, log = console.log }) {
    super();
    Object.assign(this, { reads, l1, ers, pid, dbcConfig, store, db, solFeed, paceMs, poolPaceMs, retryMs, maxWallets, log });
```

6. Replace:

```js
    this.wallets = new Map(); // topic -> listener id
    this.pools = new Map(); // mint -> { row, data }
    this.known = null; // presales in the keeper's last scan
```

   with:

```js
    this.wallets = new Map(); // topic -> listener id
    this.pools = new Map(); // mint -> { row, pool, data, migrated }
    this.known = null; // presales in the keeper's last scan
```

7. Replace:

```js
    this.syncPools();

```

   with:

```js
    this.syncPools();
    await this.readPools();

```

8. Replace:

```js
      const pool = poolAddresses(this.dbcConfig, new PublicKey(row.mint)).pool;
      this.pools.set(row.mint, { row, pool, data: null });
      this.sub(this.l1, "account", this.l1.onAccountChange(pool, (acc) => this.onPool(row.mint, acc.data), { commitment: "confirmed" }));
      if (push) this.l1.getAccountInfo(pool).then((a) => a && this.onPool(row.mint, a.data), () => {});
    }
  }
```

   with:

```js
      const pool = poolAddresses(this.dbcConfig, new PublicKey(row.mint)).pool;
      this.pools.set(row.mint, { row, pool, data: null, migrated: null });
      this.sub(this.l1, "account", this.l1.onAccountChange(pool, (acc) => this.onPool(row.mint, acc.data), { commitment: "confirmed" }));
      if (push) this.l1.getAccountInfo(pool).then((a) => a && this.onPool(row.mint, a.data), () => {});
    }
  }

  /** Reads every pool not read yet in one go (at start), so its migrated flag is known before
   *  it can flip: a coin that migrated while the server was down fires no event. */
  async readPools() {
    const list = [...this.pools.values()].filter((p) => p.migrated === null);
    const accs = await accountsOf(this.l1, list.map((p) => p.pool)).catch((e) => (this.log(`live pools: ${e.message}`), []));
    accs.forEach((a, i) => {
      const s = a && decodePoolState(a.data);
      if (!s) return;
      const p = list[i];
      p.data ??= a.data;
      p.migrated ??= s.migrated;
    });
  }
```

9. Replace:

```js
      if (!s) return;
      const pool = { address: p.pool, quoteReserve: s.quoteReserve, sqrtPrice: s.sqrtPrice, migrated: s.migrated };
```

   with:

```js
      if (!s) return;
      const was = p.migrated;
      p.migrated = s.migrated;
      if (s.migrated && was === false) {
        this.log(`$${p.row.token?.symbol} (${mint}) migrated to DAMM v2`);
        this.emit("migrated", p.row);
      }
      const pool = { address: p.pool, quoteReserve: s.quoteReserve, sqrtPrice: s.sqrtPrice, migrated: s.migrated };
```

- [ ] **Step 4: Run the tests**

Run: `cd engine && node --test test/dbc.test.js test/live.test.js`
Expected: 17 pass, 0 fail

Run: `cd engine && npm test`
Expected: 295 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add engine/test/fixtures/dbc-pool-migrated.json engine/test/dbc.test.js engine/test/live.test.js engine/server/feed.js && git commit -m "server: the migrated event when a DBC pool's flag flips; the flag pinned on a migrated mainnet pool

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The price after migration: DAMM v2 (`engine/src/damm.js`)

After migration a coin trades in a Meteora DAMM v2 pool, and its DBC pool's price stops. The server finds that pool, subscribes to it and pushes its price on `launched` in place of the DBC one (spec, "Server additions" and "Coin info").

What is checked, and where:
- DBC migrates into a DAMM v2 pool at a PDA of program `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`: seeds `"pool"`, the migration config, the bytewise-larger mint, the other mint. The configs by `migrationFeeOption` are Meteora DBC SDK's `DAMM_V2_MIGRATION_FEE_ADDRESS`. Mooner's config uses option 2 (`dbc.js` `migrationFeeOption: 2`), so config `Hv8Lmzmn…`. The derivation is tested against mainnet pool `GwvAt96oPP1fd1gMX9bPhERFKkvV5qBBVc7P1MHGPJk3`, which pool `5Dekcwc2…` migrated into. That pool came from option 6, so `findDammPool` tries Mooner's config first and then the others, all in one `getMultipleAccountsInfo`.
- The pool layout offsets (token A 168, token B 200, vaults 232/264, liquidity u128 at 360, sqrt price u128 at 456, activation point 472, status 481) are checked against that pool's bytes. Its `sqrtPrice` through `priceFromSqrt` gives the price Meteora's Data API reported for it.
- `launched` rows gain `pool.damm` (the DAMM v2 pool's address, or null). Once it's set, `pool.sqrtPrice` is that pool's price. `quoteReserve` and `migrated` stay the DBC pool's.
- The pool may land a moment after the flag, so the feed reads again up to `dammTries` (10) times, `retryMs` apart. These are reads after an event, with no loop on a timer. The feed then subscribes to the pool's account.

**Files:**
- Create: `engine/test/fixtures/damm-pool.json`
- Create: `engine/test/damm.test.js`
- Modify: `engine/test/live.test.js`
- Modify: `engine/test/server.test.js`
- Create: `engine/src/damm.js`
- Modify: `engine/server/feed.js`
- Modify: `engine/server/api.js`
- Modify: `engine/server/main.js`

- [ ] **Step 1: The DAMM v2 pool's fixture and the failing tests**

Create `engine/test/fixtures/damm-pool.json` (mainnet account `GwvAt96o…`, 1112 bytes):

```json
{"pubkey": "GwvAt96oPP1fd1gMX9bPhERFKkvV5qBBVc7P1MHGPJk3", "data": "8ZptBBGxbbyAw8kBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABVmmKx9VYwBQAAAAAAAAAAjtzN0z7HgneiVj8uHRDC2uj5vYIwreTGyL0lkFiEGCMGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAbmCdFlEXeBY06GvWwaEOL1PgAfEnRMWOdqbT1N/Y/l8zxd40B2tWuecYod/VNYiN18H/9L5hcd63EG/o78SIx8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsrF0PS/2Z9JfYilD0gMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHJsHRcAAAAAAAAAAAAAAAAAAAAAAAAAAFA7AQABAAAAAAAAAAAAAACbV2lOqRpchLHE/v8AAAAA3O1rzijjkgIAAAAAAAAAAEacvWoAAAAAAQAAAAEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHKUJtpuoeouAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAArdRP9T4XyloGu61zzgMAAAAAAAAAAAAAAAAAAAAAAAAlihdotAAAAAAAAAAAAAAAAAAAAAAAAACnMXmxKAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAA2mNoH3KGvMgGcZ4sK1CiAVckO/yWaLEVILxThD7c2wjBVyiGFnwBADPS1NUJAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}
```

Create `engine/test/damm.test.js`:

```js
// Meteora DAMM v2 (engine/src/damm.js) against the mainnet DAMM v2 pool GwvAt96o…, read on
// 2026-10-01: the pool that DBC pool 5Dekcwc2… (test/dbc.test.js) migrated into.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { DBC, WSOL } from "../src/consts.js";
import { poolAuthority } from "../src/pdas.js";
import { priceFromSqrt } from "../src/views.js";
import { DAMM_V2, dammPoolAddress, dammPoolAuthority, decodeDammPool, findDammPool, MIGRATION_CONFIGS } from "../src/damm.js";

const fixture = (name) => {
  const j = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
  return { pubkey: new PublicKey(j.pubkey), data: Buffer.from(j.data, "base64") };
};
const MINT = new PublicKey("AcgB3riCTGBzQ626TRmEm1f6ikeFvxi4mL36piDXV6ug");

test("a DAMM v2 pool decodes; its price is the one Meteora's Data API gave for it", () => {
  const { pubkey, data } = fixture("damm-pool.json");
  assert.equal(pubkey.toBase58(), "GwvAt96oPP1fd1gMX9bPhERFKkvV5qBBVc7P1MHGPJk3");
  const p = decodeDammPool(data);
  assert.equal(p.tokenA.toBase58(), MINT.toBase58());
  assert.equal(p.tokenB.toBase58(), WSOL.toBase58());
  assert.equal(p.vaultA.toBase58(), "DV9oKp623sJeXNMR8j5BeQpQ7x7Wevh4efKp2CaVucHq");
  assert.equal(p.vaultB.toBase58(), "EwQ9pkifCeYbY78FDLAsEnAgJyZ7AR9BrSQsQu6CpUxv");
  assert.equal(p.liquidity, 77505928465126673851467666076082n);
  assert.equal(p.sqrtPrice, 185460299076988380n);
  assert.equal(p.activationPoint, 1790811206n);
  assert.equal(p.status, 0);
  // GET damm-v2.datapi.meteora.ag/pools/GwvAt96o… current_price, read with this account
  assert.equal(priceFromSqrt(p.sqrtPrice), 1.0107935607993896e-7);
  assert.equal(decodeDammPool(data.subarray(0, 500)), null);
  assert.equal(decodeDammPool(fixture("dbc-pool.json").data), null, "a DBC pool isn't one");
});

test("the pool's address: config, then the larger mint; the two pool authorities own the vaults", () => {
  // that pool's DBC config migrates with option 6 (Customizable)
  assert.equal(dammPoolAddress(MIGRATION_CONFIGS[6], MINT, WSOL).toBase58(), "GwvAt96oPP1fd1gMX9bPhERFKkvV5qBBVc7P1MHGPJk3");
  assert.equal(dammPoolAddress(MIGRATION_CONFIGS[6], WSOL, MINT).toBase58(), "GwvAt96oPP1fd1gMX9bPhERFKkvV5qBBVc7P1MHGPJk3");
  assert.equal(MIGRATION_CONFIGS[2].toBase58(), "Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp", "FixedBps100, Mooner's");
  // the owners of the vaults of both pools, read with getAccountInfo on 2026-10-01
  assert.equal(dammPoolAuthority().toBase58(), "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
  assert.equal(poolAuthority().toBase58(), "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
});

test("findDammPool: Mooner's config first, the others in the same read; only a real pool of the mint counts", async () => {
  const { pubkey, data } = fixture("damm-pool.json");
  const accounts = new Map([[pubkey.toBase58(), { owner: DAMM_V2, data }]]);
  const reads = [];
  const conn = { getMultipleAccountsInfo: async (keys) => (reads.push(keys.map((k) => k.toBase58())), keys.map((k) => accounts.get(k.toBase58()) ?? null)) };
  const found = await findDammPool(conn, MINT);
  assert.equal(found.pool.toBase58(), pubkey.toBase58());
  assert.equal(found.state.sqrtPrice, 185460299076988380n);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].length, 7);
  assert.equal(reads[0][0], dammPoolAddress(MIGRATION_CONFIGS[2], MINT, WSOL).toBase58());

  // the same bytes under another owner, or for another mint, aren't it
  accounts.set(pubkey.toBase58(), { owner: DBC, data });
  assert.equal(await findDammPool(conn, MINT), null);
  assert.equal(await findDammPool({ getMultipleAccountsInfo: async (k) => k.map(() => null) }, MINT), null);
});
```

In `engine/test/live.test.js` (DAMM v2 helpers and three tests), 6 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
import WebSocket from "ws";
import { DBC, DELEGATION_PROGRAM, MOONER_DBC_CONFIG } from "../src/consts.js";
import { P, PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, STATE } from "../src/layout.js";
```

   with:

```js
import WebSocket from "ws";
import { DBC, DELEGATION_PROGRAM, MOONER_DBC_CONFIG, WSOL } from "../src/consts.js";
import { DAMM_V2, MIGRATION_CONFIGS, dammPoolAddress } from "../src/damm.js";
import { P, PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, STATE } from "../src/layout.js";
```

2. Replace:

```js
  const bot = new Bot({ pid, l1, ers: { [validator.toBase58()]: er }, bot: Keypair.generate(), dbcConfig: MOONER_DBC_CONFIG, canary: true, log: () => {} });
  const reads = makeReads({ pid, l1, bot, store, dbcConfig: MOONER_DBC_CONFIG });
  const logs = [];
```

   with:

```js
  const bot = new Bot({ pid, l1, ers: { [validator.toBase58()]: er }, bot: Keypair.generate(), dbcConfig: MOONER_DBC_CONFIG, canary: true, log: () => {} });
  const reads = makeReads({ pid, l1, bot, store, dbcConfig: MOONER_DBC_CONFIG, damm: (mint) => feed.dammOf(mint) });
  const logs = [];
```

3. Replace:

```js

// ---- migration ----

```

   with:

```js

// ---- migration and the DAMM v2 pool ----

```

4. Replace:

```js
};
/** A launched coin on the fake chain: its DBC pool written, the launch recorded. */
```

   with:

```js
};
/** The mainnet DAMM v2 pool's bytes as `mint`'s pool (token A at 168), at sqrt price `sqrt`. */
const dammPool = (mint, sqrt = 185460299076988380n) => {
  const b = fixtureBytes("damm-pool.json");
  mint.toBuffer().copy(b, 168);
  b.writeBigUInt64LE(sqrt & ((1n << 64n) - 1n), 456);
  b.writeBigUInt64LE(sqrt >> 64n, 464);
  return b;
};
/** A launched coin on the fake chain: its DBC pool written, the launch recorded. */
```

5. Replace:

```js
  store.addLaunch(presale, mint, { sig: "LAUNCH", released: 9n, cost: 1n, tokens: 5n, units: 7 });
  return { presale, mint, pool };
}
```

   with:

```js
  store.addLaunch(presale, mint, { sig: "LAUNCH", released: 9n, cost: 1n, tokens: 5n, units: 7 });
  return { presale, mint, pool, damm: dammPoolAddress(MIGRATION_CONFIGS[2], mint, WSOL) };
}
```

6. Replace:

```js
    assert.deepEqual(events, [coin.mint.toBase58()]);
  } finally {
    c.close();
    await s.close();
  }
});
```

   with:

```js
    assert.deepEqual(events, [coin.mint.toBase58()]);
  } finally {
    c.close();
    await s.close();
  }
});

test("a pool that migrates: one migrated event, then the coin's price from its DAMM v2 pool", async () => {
  const s = await startLive();
  const coin = launchedCoin(s.l1, s.store);
  const events = [];
  s.feed.on("migrated", (row) => events.push(row.mint));
  const c = await s.client();
  try {
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.feed.launched(coin.presale);
    const first = (await c.next(on("launched", "upsert"))).data.pool;
    assert.deepEqual([first.migrated, first.damm, first.sqrtPrice], [false, null, "98247117170863603"]);

    // the migration: the DAMM v2 pool lands with the flag
    s.l1.put(coin.damm, DAMM_V2, dammPool(coin.mint));
    s.l1.write(coin.pool, DBC, dbcPool(true));
    const moved = await c.next((m) => on("launched", "upsert")(m) && m.data.pool.damm);
    assert.deepEqual([moved.data.pool.migrated, moved.data.pool.damm, moved.data.pool.sqrtPrice], [true, coin.damm.toBase58(), "185460299076988380"]);
    assert.deepEqual(events, [coin.mint.toBase58()]);
    assert.ok(s.logs.some((l) => l.includes("migrated to DAMM v2")), "logged");

    // it trades on DAMM v2 now: that pool's changes are pushed
    s.l1.write(coin.damm, DAMM_V2, dammPool(coin.mint, 200000000000000000n));
    const traded = await c.next((m) => on("launched", "upsert")(m) && m.data.pool.sqrtPrice === "200000000000000000");
    assert.equal(traded.data.pool.damm, coin.damm.toBase58());
    // the DBC pool again (still migrated): no second event
    s.l1.write(coin.pool, DBC, dbcPool(true));
    await c.next(on("launched", "upsert"));
    assert.deepEqual(events, [coin.mint.toBase58()]);

    // a new socket's snapshot has the DAMM v2 price too
    const d = await s.client();
    d.sub("launched");
    const [row] = (await d.next(on("launched", "snapshot"))).data;
    assert.deepEqual([row.pool.damm, row.pool.sqrtPrice], [coin.damm.toBase58(), "200000000000000000"]);
    d.close();
  } finally {
    c.close();
    await s.close();
  }
});

test("the DAMM v2 pool a moment after the flag: read again until it's there", async () => {
  const s = await startLive();
  const coin = launchedCoin(s.l1, s.store);
  const c = await s.client();
  try {
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.feed.launched(coin.presale);
    await c.next(on("launched", "upsert"));
    s.l1.write(coin.pool, DBC, dbcPool(true));
    const flagged = (await c.next(on("launched", "upsert"))).data.pool;
    assert.deepEqual([flagged.migrated, flagged.damm], [true, null], "migrated, its new pool not there yet");
    await wait(150);
    s.l1.put(coin.damm, DAMM_V2, dammPool(coin.mint));
    const found = await c.next((m) => on("launched", "upsert")(m) && m.data.pool.damm);
    assert.equal(found.data.pool.sqrtPrice, "185460299076988380");
  } finally {
    c.close();
    await s.close();
  }
});

test("at start: a coin that migrated while the server was down gets its DAMM v2 pool, and no event", async () => {
  let coin;
  const s = await startLive({
    before: ({ l1, store }) => {
      coin = launchedCoin(l1, store, { migrated: true });
      l1.put(coin.damm, DAMM_V2, dammPool(coin.mint));
    },
  });
  const events = [];
  s.feed.on("migrated", (row) => events.push(row));
  const c = await s.client();
  try {
    await wait(50);
    c.sub("launched");
    const [row] = (await c.next(on("launched", "snapshot"))).data;
    assert.deepEqual([row.pool.migrated, row.pool.damm, row.pool.sqrtPrice], [true, coin.damm.toBase58(), "185460299076988380"]);
    assert.ok(s.l1.accountSubs().includes(coin.damm.toBase58()), "subscribed to the DAMM v2 pool");
    assert.deepEqual(events, []);
    assert.deepEqual(s.feed.status().damm, 1);
  } finally {
    c.close();
    await s.close();
  }
});
```

In `engine/test/server.test.js` (a launched row now carries `damm`), replace:

```js
    const one = (await s.call("GET", "/api/launched")).json.launched[0];
    assert.deepEqual(one.pool, { address: pool.toBase58(), quoteReserve: "197354828", sqrtPrice: "98247117170863603", migrated: false });
  } finally {
```

with:

```js
    const one = (await s.call("GET", "/api/launched")).json.launched[0];
    assert.deepEqual(one.pool, { address: pool.toBase58(), quoteReserve: "197354828", sqrtPrice: "98247117170863603", migrated: false, damm: null });
  } finally {
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd engine && node --test test/damm.test.js test/live.test.js test/server.test.js`
Expected: 20 pass, 3 fail: `damm.test.js` and `live.test.js` stop at `ERR_MODULE_NOT_FOUND` (`src/damm.js`); the server test's launched row has no `damm`

- [ ] **Step 3: Write `engine/src/damm.js`**

Create `engine/src/damm.js`:

```js
// Meteora DAMM v2 (cp-amm): where a coin trades once its DBC pool has migrated. DBC
// creates the DAMM v2 pool at a PDA of the migration config its own config names
// (migrationFeeOption; Mooner's is 2, FixedBps100: a 1% pool fee) and the two mints. The
// layout offsets were checked against mainnet pool GwvAt96o… (1112 bytes); its sqrt price
// gives exactly the price Meteora's Data API reports for it. No node: imports.

import { PublicKey } from "@solana/web3.js";
import { WSOL } from "./consts.js";

export const DAMM_V2 = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
export const DAMM_POOL_DISC = Buffer.from("f19a6d0411b16dbc", "hex");
export const DAMM_POOL_LEN = 1112;

/** The DAMM v2 configs DBC migrates into, by migrationFeeOption (Meteora's DBC SDK,
 *  DAMM_V2_MIGRATION_FEE_ADDRESS): 0 FixedBps25, 1 FixedBps30, 2 FixedBps100, 3 FixedBps200,
 *  4 FixedBps400, 5 FixedBps600, 6 Customizable. */
export const MIGRATION_CONFIGS = [
  "7F6dnUcRuyM2TwR8myT1dYypFXpPSxqwKNSFNkxyNESd",
  "2nHK1kju6XjphBLbNxpM5XRGFj7p9U8vvNzyZiha1z6k",
  "Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp",
  "2c4cYd4reUYVRAB9kUUkrq55VPyy2FNQ3FDL4o12JXmq",
  "AkmQWebAwFvWk55wBoCr5D62C6VVDTzi84NJuD9H7cFD",
  "DbCRBj8McvPYHJG1ukj8RE15h2dCNUdTAESG49XpQ44u",
  "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck",
].map((k) => new PublicKey(k));
/** Mooner's DBC config migrates with option 2 (dbc.js moonerConfigParams). */
export const MOONER_MIGRATION_OPTION = 2;

/** The pool's authority (owner of its two vaults). */
export const dammPoolAuthority = () => PublicKey.findProgramAddressSync([Buffer.from("pool_authority")], DAMM_V2)[0];

/** The DAMM v2 pool of mints `a` and `b` on migration config `config`: seeds "pool",
 *  config, then the bytewise-larger mint, then the other. */
export function dammPoolAddress(config, a, b) {
  const [hi, lo] = Buffer.compare(a.toBuffer(), b.toBuffer()) > 0 ? [a, b] : [b, a];
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), config.toBuffer(), hi.toBuffer(), lo.toBuffer()], DAMM_V2)[0];
}

const u128 = (b, at) => b.readBigUInt64LE(at) | (b.readBigUInt64LE(at + 8) << 64n);
const key = (b, at) => new PublicKey(b.subarray(at, at + 32));

/** The parts of a DAMM v2 Pool the app shows, or null if `data` isn't one. */
export function decodeDammPool(data) {
  if (!data || data.length < DAMM_POOL_LEN || !Buffer.from(data.subarray(0, 8)).equals(DAMM_POOL_DISC)) return null;
  const b = Buffer.from(data);
  return {
    tokenA: key(b, 168),
    tokenB: key(b, 200),
    vaultA: key(b, 232),
    vaultB: key(b, 264),
    liquidity: u128(b, 360),
    sqrtPrice: u128(b, 456),
    activationPoint: b.readBigUInt64LE(472),
    status: b[481],
  };
}

/** Where `mint` trades on DAMM v2 after its DBC pool migrated: { pool, state } or null
 *  (not migrated yet, or not found). Looks at Mooner's migration config first, then the
 *  others, all in one read; a candidate counts only if DAMM v2 owns it and it pairs `mint`
 *  (token A) with wSOL (token B). */
export async function findDammPool(conn, mint, { first = MOONER_MIGRATION_OPTION } = {}) {
  const configs = [MIGRATION_CONFIGS[first], ...MIGRATION_CONFIGS.filter((_, i) => i !== first)];
  const pools = configs.map((c) => dammPoolAddress(c, mint, WSOL));
  const accs = await conn.getMultipleAccountsInfo(pools);
  for (const [i, a] of accs.entries()) {
    if (!a?.owner?.equals(DAMM_V2)) continue;
    const state = decodeDammPool(a.data);
    if (state?.tokenA.equals(mint) && state.tokenB.equals(WSOL)) return { pool: pools[i], state };
  }
  return null;
}
```

- [ ] **Step 4: The feed finds and watches the pool; the API serves its price**

`main.js` hands the feed's `dammOf` to `makeReads`. The arrow function reads `feed` when it's called, after `feed` is assigned two lines below.

In `engine/server/feed.js`, 9 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
//     presale once (paced) and pushes it to `presale:<key>` and `presales`
//   - each launched token's DBC pool: pushed to `launched` as it trades; the flip of its
//     migrated flag is the "migrated" event (feed.on("migrated", row))
//   - each watched wallet's SOL: `wallet:<wallet>`
```

   with:

```js
//     presale once (paced) and pushes it to `presale:<key>` and `presales`
//   - each launched token's DBC pool, and its DAMM v2 pool once it migrated: pushed to
//     `launched` as it trades; the flip of the DBC pool's migrated flag is the "migrated"
//     event (feed.on("migrated", row))
//   - each watched wallet's SOL: `wallet:<wallet>`
```

2. Replace:

```js
import { DELEGATION_PROGRAM } from "../src/consts.js";
import { PRESALE_LEN, PRESALE_VERSION, SEAT_LEN, SEAT_VERSION, decodePresale, decodeSeat } from "../src/layout.js";
```

   with:

```js
import { DELEGATION_PROGRAM } from "../src/consts.js";
import { decodeDammPool, findDammPool } from "../src/damm.js";
import { PRESALE_LEN, PRESALE_VERSION, SEAT_LEN, SEAT_VERSION, decodePresale, decodeSeat } from "../src/layout.js";
```

3. Replace:

```js
   * `ers` ({ validatorBase58: Connection }) are the chain connections to subscribe on.
   * `db`: the server's SQLite (chat and pictures).
   */
  constructor({ reads, l1, ers, pid, dbcConfig, store, db, solFeed = PYTH_SOL_USD, paceMs = 1_000, poolPaceMs = 500, retryMs = 3_000, maxWallets = 2_000, log = console.log }) {
    super();
    Object.assign(this, { reads, l1, ers, pid, dbcConfig, store, db, solFeed, paceMs, poolPaceMs, retryMs, maxWallets, log });
    this.hub = null;
    this.subs = []; // [conn, id, "program" | "account"]
    this.wallets = new Map(); // topic -> listener id
    this.pools = new Map(); // mint -> { row, pool, data, migrated }
    this.known = null; // presales in the keeper's last scan
```

   with:

```js
   * `ers` ({ validatorBase58: Connection }) are the chain connections to subscribe on.
   * `db`: the server's SQLite (chat and pictures). `dammTries`: reads of the DAMM v2 pool
   * after a migration, `retryMs` apart, before the feed gives up on it until the next
   * restart.
   */
  constructor({ reads, l1, ers, pid, dbcConfig, store, db, solFeed = PYTH_SOL_USD, paceMs = 1_000, poolPaceMs = 500, retryMs = 3_000, maxWallets = 2_000, dammTries = 10, log = console.log }) {
    super();
    Object.assign(this, { reads, l1, ers, pid, dbcConfig, store, db, solFeed, paceMs, poolPaceMs, retryMs, maxWallets, dammTries, log });
    this.hub = null;
    this.subs = []; // [conn, id, "program" | "account"]
    this.wallets = new Map(); // topic -> listener id
    this.pools = new Map(); // mint -> { row, pool, data, migrated, damm, dammState, retry }
    this.known = null; // presales in the keeper's last scan
```

4. Replace:

```js
    for (const p of this.paced.values()) clearTimeout(p.timer);
  }
```

   with:

```js
    for (const p of this.paced.values()) clearTimeout(p.timer);
    for (const p of this.pools.values()) clearTimeout(p.retry);
  }
```

5. Replace:

```js
      const pool = poolAddresses(this.dbcConfig, new PublicKey(row.mint)).pool;
      this.pools.set(row.mint, { row, pool, data: null, migrated: null });
      this.sub(this.l1, "account", this.l1.onAccountChange(pool, (acc) => this.onPool(row.mint, acc.data), { commitment: "confirmed" }));
```

   with:

```js
      const pool = poolAddresses(this.dbcConfig, new PublicKey(row.mint)).pool;
      this.pools.set(row.mint, { row, pool, data: null, migrated: null, damm: null, dammState: null });
      this.sub(this.l1, "account", this.l1.onAccountChange(pool, (acc) => this.onPool(row.mint, acc.data), { commitment: "confirmed" }));
```

6. Replace:

```js

  /** Reads every pool not read yet in one go (at start), so its migrated flag is known before
   *  it can flip: a coin that migrated while the server was down fires no event. */
  async readPools() {
```

   with:

```js

  /** Reads every pool not read yet in one go (at start): its migrated flag is known before it
   *  can flip, and a coin that migrated while the server was down gets its DAMM v2 pool. */
  async readPools() {
```

7. Replace:

```js
      p.migrated ??= s.migrated;
    });
  }
```

   with:

```js
      p.migrated ??= s.migrated;
      if (s.migrated) this.findDamm(p.row.mint);
    });
  }

  /** Where a migrated coin trades now, for api.js listLaunched: { pool, sqrtPrice } or null. */
  dammOf(mint) {
    const p = this.pools.get(mint);
    return p?.damm ? { pool: p.damm.toBase58(), sqrtPrice: p.dammState.sqrtPrice } : null;
  }
```

8. Replace:

```js
      }
      const pool = { address: p.pool, quoteReserve: s.quoteReserve, sqrtPrice: s.sqrtPrice, migrated: s.migrated };
      this.publish("launched", { type: "upsert", data: { ...p.row, pool } });
    });
```

   with:

```js
      }
      if (s.migrated && !p.damm) this.findDamm(mint);
      this.pushPool(p);
    });
  }

  /** The `launched` row of pool record `p`: the DBC pool's figures, and once the DAMM v2 pool
   *  is known its price (the coin trades there now) and address. */
  poolRow(p) {
    const s = decodePoolState(p.data);
    if (!s) return null;
    const sqrtPrice = p.dammState?.sqrtPrice ?? s.sqrtPrice;
    return { ...p.row, pool: { address: p.pool, quoteReserve: s.quoteReserve, sqrtPrice, migrated: s.migrated, damm: p.damm?.toBase58() ?? null } };
  }

  pushPool(p) {
    const row = this.poolRow(p);
    if (!row) return;
    this.publish("launched", { type: "upsert", data: row });
  }

  /** Finds the DAMM v2 pool `mint` migrated into and subscribes to it. The pool may land a
   *  moment after the flag, so it's read again `retryMs` apart, `dammTries` times. */
  async findDamm(mint, tries = this.dammTries) {
    const p = this.pools.get(mint);
    if (!p || p.damm || p.finding) return;
    p.finding = true;
    let found = null;
    try {
      found = await findDammPool(this.l1, new PublicKey(mint));
    } catch (e) {
      this.log(`live damm ${mint}: ${e.message}`);
    }
    p.finding = false;
    if (!found) {
      if (tries > 1) (p.retry = setTimeout(() => this.findDamm(mint, tries - 1), this.retryMs)).unref?.();
      else this.log(`no DAMM v2 pool found for ${mint}: its price stays the one at migration`);
      return;
    }
    p.damm = found.pool;
    p.dammState = found.state;
    this.reads.forgetLaunched();
    this.sub(this.l1, "account", this.l1.onAccountChange(found.pool, (acc) => this.onDamm(mint, acc.data), { commitment: "confirmed" }));
    this.pushPool(p);
  }

  onDamm(mint, data) {
    const p = this.pools.get(mint);
    if (!p) return;
    p.dammData = data;
    this.reads.forgetLaunched();
    this.pace(`damm:${mint}`, this.poolPaceMs, async () => {
      const s = decodeDammPool(p.dammData);
      if (!s) return;
      p.dammState = s;
      this.pushPool(p);
    });
```

9. Replace:

```js
  status() {
    return { sockets: this.hub?.sockets ?? 0, heard: { ...this.heard }, wallets: this.wallets.size, pools: this.pools.size, sol: this.sol };
  }
```

   with:

```js
  status() {
    const damm = [...this.pools.values()].filter((p) => p.damm).length;
    return { sockets: this.hub?.sockets ?? 0, heard: { ...this.heard }, wallets: this.wallets.size, pools: this.pools.size, damm, sol: this.sol };
  }
```

In `engine/server/api.js`, 3 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
 */
export function makeReads({ pid, l1, bot, store, dbcConfig, now = Date.now }) {
  /** A delegated account is our presale only if it sits at our PDA for its mint. */
```

   with:

```js
 */
export function makeReads({ pid, l1, bot, store, dbcConfig, damm = () => null, now = Date.now }) {
  /** A delegated account is our presale only if it sits at our PDA for its mint. */
```

2. Replace:

```js

  /** Launched tokens with their pools, newest first. A pool that can't be read is null. */
  const listLaunched = () =>
```

   with:

```js

  /** Launched tokens with their pools, newest first. A pool that can't be read is null. Once a
   *  coin migrated and the feed found its DAMM v2 pool (`damm(mint)`: { pool, sqrtPrice }),
   *  the price is that pool's and `damm` its address. */
  const listLaunched = () =>
```

3. Replace:

```js
        const s = decodePoolState(accs[i]?.data);
        return { ...r, pool: s && { address: pools[i], quoteReserve: s.quoteReserve, sqrtPrice: s.sqrtPrice, migrated: s.migrated } };
      });
```

   with:

```js
        const s = decodePoolState(accs[i]?.data);
        const d = s?.migrated ? damm(r.mint) : null;
        return { ...r, pool: s && { address: pools[i], quoteReserve: s.quoteReserve, sqrtPrice: d?.sqrtPrice ?? s.sqrtPrice, migrated: s.migrated, damm: d?.pool ?? null } };
      });
```

In `engine/server/main.js`, replace:

```js

const reads = makeReads({ pid: cfg.pid, l1: ctx.l1, bot: ctx.bot, store: ctx.store, dbcConfig: cfg.dbcConfig });
const feed = new Feed({ reads, l1: ctx.l1, ers: ctx.bot.ers, pid: cfg.pid, dbcConfig: cfg.dbcConfig, store: ctx.store, db: ctx.store.db, log: (m) => log(`live ${m}`) });
```

with:

```js

// a migrated coin's price and DAMM v2 pool come from the feed, which watches that pool
const reads = makeReads({ pid: cfg.pid, l1: ctx.l1, bot: ctx.bot, store: ctx.store, dbcConfig: cfg.dbcConfig, damm: (mint) => feed.dammOf(mint) });
const feed = new Feed({ reads, l1: ctx.l1, ers: ctx.bot.ers, pid: cfg.pid, dbcConfig: cfg.dbcConfig, store: ctx.store, db: ctx.store.db, log: (m) => log(`live ${m}`) });
```

- [ ] **Step 5: Run the tests**

Run: `cd engine && node --test test/damm.test.js test/live.test.js test/server.test.js`
Expected: 36 pass, 0 fail

Run: `cd engine && node --check server/main.js`
Expected: exit 0 (main.js has no test; this checks it parses)

Run: `cd engine && npm test`
Expected: 301 pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add engine/test/fixtures/damm-pool.json engine/src/damm.js engine/test/damm.test.js engine/test/live.test.js engine/test/server.test.js engine/server/feed.js engine/server/api.js engine/server/main.js && git commit -m "server: a migrated coin's DAMM v2 pool, found by PDA and watched; its price on launched

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Coin stats over the socket (`coin:<mint>`)

The coin screen's chart, 24h volume, liquidity (after migration), holder count and top holders come over a new topic, `coin:<mint>` (spec, "Coin info"):

- Before migration: GeckoTerminal candles and volume for the DBC pool, as the website reads them.
- After migration: Meteora's DAMM v2 Data API for candles (5-minute), TVL, volume and holder count.
- Always: the top holders from chain (`getTokenLargestAccounts`, then each account's owner). The bonding curve (DBC pool authority `FhVo3mqL…`), the DAMM v2 pool authority (`HLnpSz9h…`) and the presale are named. Also the supply (`getTokenSupply`), so shares are of the coin's real supply.
- When GeckoTerminal has no candles for a pool (a pool too new for it), the chart is the server's own one-minute candles. The feed records them from the pool changes it already hears (`store.addPrice`, a `candles` table).
- A source that fails leaves its figures null. The phone says "Not known yet" for those and never makes up a number.

The rule for reads is the user's: push, never poll. The server reads a coin's stats when the first socket joins the topic. It reads them again only after the coin's pool changed, at most once a `statsMs` (60 s), and only while someone is on the topic. A coin nobody has open is never read. The hub allows at most 4 `coin:` topics per socket.

**Files:**
- Create: `engine/test/coinstats.test.js`
- Modify: `engine/test/live.test.js`
- Create: `engine/server/coinstats.js`
- Modify: `engine/server/store.js`
- Modify: `engine/server/hub.js`
- Modify: `engine/server/feed.js`

- [ ] **Step 1: Write the failing tests**

Create `engine/test/coinstats.test.js`:

```js
// The coin screen's stats (server/coinstats.js): which source each figure comes from before
// and after migration, the server's own candles when an API has none, and the top holders
// read from chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { poolAuthority } from "../src/pdas.js";
import { dammPoolAuthority } from "../src/damm.js";
import { Store } from "../server/store.js";
import { coinStats, supplyOf, topHolders } from "../server/coinstats.js";

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
```

In `engine/test/live.test.js` (feed options in `startLive`, and the `coin:` test), 5 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js

/** `before({ l1, store })` runs before the feed starts: what was there while the server was
 *  down. */
async function startLive({ paceMs = 60, hub: hubOpts = {}, before = () => {} } = {}) {
  const l1 = fakeChain("l1");
```

   with:

```js

/** `feed`: more Feed options (fetch, statsMs). `before({ l1, store })` runs before the feed
 *  starts: what was there while the server was down. */
async function startLive({ paceMs = 60, hub: hubOpts = {}, feed: feedOpts = {}, before = () => {} } = {}) {
  const l1 = fakeChain("l1");
```

2. Replace:

```js
  const logs = [];
  const feed = new Feed({ reads, l1, ers: bot.ers, pid, dbcConfig: MOONER_DBC_CONFIG, store, db: store.db, paceMs, poolPaceMs: paceMs, retryMs: 100, log: (m) => logs.push(m) });
  before({ l1, store });
```

   with:

```js
  const logs = [];
  const feed = new Feed({ reads, l1, ers: bot.ers, pid, dbcConfig: MOONER_DBC_CONFIG, store, db: store.db, paceMs, poolPaceMs: paceMs, retryMs: 100, fetch: noFetch, log: (m) => logs.push(m), ...feedOpts });
  before({ l1, store });
```

3. Replace:

```js
const on = (topic, type) => (m) => m.topic === topic && (!type || m.type === type);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
```

   with:

```js
const on = (topic, type) => (m) => m.topic === topic && (!type || m.type === type);
/** No market API in tests unless one is handed in: every call is a 404. */
const noFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
```

4. Replace:

```js

// ---- migration and the DAMM v2 pool ----

```

   with:

```js

// ---- migration, the DAMM v2 pool, coin stats ----

```

5. Replace:

```js
    assert.deepEqual(s.feed.status().damm, 1);
  } finally {
    c.close();
    await s.close();
  }
});
```

   with:

```js
    assert.deepEqual(s.feed.status().damm, 1);
  } finally {
    c.close();
    await s.close();
  }
});

test("coin:<mint>: stats when it's opened, again only after its pool changed and a statsMs passed", async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes("/ohlcv/")) return { ok: true, status: 200, json: async () => ({ data: { attributes: { ohlcv_list: [[1790854740, 2e-8, 3e-8, 2e-8, 3e-8, 1]] } } }) };
    return { ok: true, status: 200, json: async () => ({ data: { attributes: { reserve_in_usd: "10", volume_usd: { h24: String(calls.length) } } } }) };
  };
  const s = await startLive({ feed: { fetch, statsMs: 300 } });
  const coin = launchedCoin(s.l1, s.store);
  s.feed.launched(coin.presale);
  const c = await s.client();
  const topic = `coin:${coin.mint.toBase58()}`;
  try {
    await wait(50);
    c.sub(topic);
    const snap = (await c.next(on(topic, "snapshot"))).data;
    assert.deepEqual([snap.venue, snap.pool, snap.source, snap.candles.length, snap.volume24hUsd, snap.top], ["dbc", coin.pool.toBase58(), "geckoterminal", 1, 2, null]);
    assert.equal(calls.length, 2);

    // nothing changed: nothing is read again
    await wait(400);
    assert.equal(calls.length, 2, "no reads while the pool is still");

    // the pool trades: read again now (the last read is older than statsMs) and pushed
    s.l1.write(coin.pool, DBC, dbcPool(false));
    assert.equal((await c.next(on(topic, "snapshot"))).data.volume24hUsd, 4);
    // and again right away: once more, statsMs after the last read, not before
    s.l1.write(coin.pool, DBC, dbcPool(false));
    await wait(150);
    s.l1.write(coin.pool, DBC, dbcPool(false));
    assert.equal(calls.length, 4, "not before statsMs");
    assert.equal((await c.next(on(topic, "snapshot"))).data.volume24hUsd, 6);
    await wait(400);
    assert.equal(calls.length, 6, "one read for both changes");

    // nobody on it: a change reads nothing
    c.unsub(topic);
    await wait(50);
    s.l1.write(coin.pool, DBC, dbcPool(false));
    await wait(400);
    assert.equal(calls.length, 6);
    assert.equal(s.feed.status().coins, 0);

    // a mint that isn't a Mooner coin: missing, and no API call
    const other = `coin:${Keypair.generate().publicKey.toBase58()}`;
    c.sub(other);
    assert.equal((await c.next(on(other))).type, "missing");
    assert.equal(calls.length, 6);

    // at most 4 coins per socket
    const e = await s.client();
    e.sub(...Array.from({ length: 5 }, () => `coin:${Keypair.generate().publicKey.toBase58()}`));
    assert.match((await e.next((m) => m.error)).error, /at most 4 coins/);
    e.close();
  } finally {
    c.close();
    await s.close();
  }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd engine && node --test test/coinstats.test.js test/live.test.js`
Expected: 12 pass, 2 fail: `coinstats.test.js` stops at `ERR_MODULE_NOT_FOUND` (`server/coinstats.js`); the `coin:` test fails (the hub rejects the topic)

- [ ] **Step 3: Write `engine/server/coinstats.js`**

Create `engine/server/coinstats.js`:

```js
// What the coin screen shows besides the live price (feed.js pushes these on `coin:<mint>`):
// the chart, 24h volume, liquidity, holders and the top holders. Before migration the coin
// trades on its DBC pool: candles and volume from GeckoTerminal, as the website reads them.
// After it, on its DAMM v2 pool: candles, TVL, volume and the holder count from Meteora's
// Data API. Where an API has nothing (a pool too new for GeckoTerminal, say), the chart is
// the server's own candles, built from the pool changes it hears (store.addPrice). The top
// holders and the coin's supply (for their shares) are read from chain. A source that fails
// leaves its figures null; the rest stand.

import { PublicKey } from "@solana/web3.js";
import { poolAuthority } from "../src/pdas.js";
import { dammPoolAuthority } from "../src/damm.js";
import { geckoCandles, geckoStats, meteoraCandles, meteoraPool } from "../src/market.js";

/** The chart covers this much time (300 one-minute candles, GeckoTerminal's limit). */
export const CHART_MS = 300 * 60_000;
/** How many top holders the coin screen lists. */
export const TOP_HOLDERS = 10;

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
 * (base58, where the coin trades now), candles, candleMs, source, volume24hUsd, liquidityUsd,
 * holders, top, supply, at }.
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
    if (c?.length) [candles, candleMs, source] = [c, 300_000, "meteora"];
    if (s) [volume24hUsd, liquidityUsd, holders] = [s.volume24hUsd, s.tvlUsd, s.holders];
  } else {
    const [c, s] = await Promise.all([geckoCandles(pool, { fetch }).catch(none), geckoStats(pool, { fetch }).catch(none)]);
    if (c?.length) [candles, source] = [c, "geckoterminal"];
    if (s) volume24hUsd = s.volume24hUsd;
  }
  if (!candles) {
    candles = store.candles(mint, nowMs - CHART_MS);
    [candleMs, source] = [60_000, candles.length ? "mooner" : null];
  }
  return { mint, venue, pool, candles, candleMs, source, volume24hUsd, liquidityUsd, holders, top: await top, supply: await supply, at: nowMs };
}
```

- [ ] **Step 4: Own candles, the topic, the feed**

In `engine/server/store.js`, 2 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
  at       INTEGER NOT NULL
);`;
```

   with:

```js
  at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS candles (
  mint TEXT NOT NULL,
  t    INTEGER NOT NULL,
  o    REAL NOT NULL,
  h    REAL NOT NULL,
  l    REAL NOT NULL,
  c    REAL NOT NULL,
  PRIMARY KEY (mint, t)
);`;
```

2. Replace:

```js

  /** The token opened as `presale`, for a presale that has closed since. */
```

   with:

```js

  /** A launched coin's price (SOL per token) seen at `at` (ms): it goes into that minute's
   *  candle, which opens at its first price and closes at its last. */
  addPrice(mint, price, at = Date.now()) {
    const t = Math.floor(at / 60_000) * 60_000;
    this.db
      .prepare("INSERT INTO candles (mint, t, o, h, l, c) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (mint, t) DO UPDATE SET h = max(h, excluded.h), l = min(l, excluded.l), c = excluded.c")
      .run(mint, t, price, price, price, price);
  }

  /** The coin's one-minute candles from `since` (ms) on, oldest first: { t, o, h, l, c }. */
  candles(mint, since = 0) {
    return this.db.prepare("SELECT t, o, h, l, c FROM candles WHERE mint = ? AND t >= ? ORDER BY t").all(mint, since).map((r) => ({ ...r }));
  }

  /** The token opened as `presale`, for a presale that has closed since. */
```

In `engine/server/hub.js`, 4 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
// Topics: presales, launched, profiles, sol, chat:global, chat:<presale>, presale:<presale>,
// wallet:<wallet>.

```

   with:

```js
// Topics: presales, launched, profiles, sol, chat:global, chat:<presale>, presale:<presale>,
// wallet:<wallet>, coin:<mint>.

```

2. Replace:

```js

export const TOPIC = /^(presales|launched|profiles|sol|chat:global|(chat|presale|wallet):[1-9A-HJ-NP-Za-km-z]{32,44})$/;

```

   with:

```js

export const TOPIC = /^(presales|launched|profiles|sol|chat:global|(chat|presale|wallet|coin):[1-9A-HJ-NP-Za-km-z]{32,44})$/;

```

3. Replace:

```js
  walletsPerSocket: 4,
  messages: [120, 60_000], // per socket
```

   with:

```js
  walletsPerSocket: 4,
  coinsPerSocket: 4,
  messages: [120, 60_000], // per socket
```

4. Replace:

```js
    }
    ws.subs.add(topic);
```

   with:

```js
    }
    if (topic.startsWith("coin:") && [...ws.subs].filter((t) => t.startsWith("coin:")).length >= this.L.coinsPerSocket) {
      return this.send(ws, { error: `at most ${this.L.coinsPerSocket} coins` });
    }
    ws.subs.add(topic);
```

In `engine/server/feed.js`, 13 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
//     event (feed.on("migrated", row))
//   - each watched wallet's SOL: `wallet:<wallet>`
```

   with:

```js
//     event (feed.on("migrated", row))
//   - one coin's chart, volume, liquidity and holders while someone has it open:
//     `coin:<mint>`, read again at most once a `statsMs`, and only after its pool changed
//   - each watched wallet's SOL: `wallet:<wallet>`
```

2. Replace:

```js
import { decodeDammPool, findDammPool } from "../src/damm.js";
import { PRESALE_LEN, PRESALE_VERSION, SEAT_LEN, SEAT_VERSION, decodePresale, decodeSeat } from "../src/layout.js";
```

   with:

```js
import { decodeDammPool, findDammPool } from "../src/damm.js";
import { priceFromSqrt } from "../src/views.js";
import { PRESALE_LEN, PRESALE_VERSION, SEAT_LEN, SEAT_VERSION, decodePresale, decodeSeat } from "../src/layout.js";
```

3. Replace:

```js
import { accountsOf, listItem } from "./api.js";
import { allProfiles, chatRows } from "./social.js";
```

   with:

```js
import { accountsOf, listItem } from "./api.js";
import { coinStats } from "./coinstats.js";
import { allProfiles, chatRows } from "./social.js";
```

4. Replace:

```js
   * `ers` ({ validatorBase58: Connection }) are the chain connections to subscribe on.
   * `db`: the server's SQLite (chat and pictures). `dammTries`: reads of the DAMM v2 pool
   * after a migration, `retryMs` apart, before the feed gives up on it until the next
   * restart.
   */
  constructor({ reads, l1, ers, pid, dbcConfig, store, db, solFeed = PYTH_SOL_USD, paceMs = 1_000, poolPaceMs = 500, retryMs = 3_000, maxWallets = 2_000, dammTries = 10, log = console.log }) {
    super();
    Object.assign(this, { reads, l1, ers, pid, dbcConfig, store, db, solFeed, paceMs, poolPaceMs, retryMs, maxWallets, dammTries, log });
    this.hub = null;
```

   with:

```js
   * `ers` ({ validatorBase58: Connection }) are the chain connections to subscribe on.
   * `db`: the server's SQLite (chat and pictures). `fetch`: for the market APIs
   * (coinstats.js). `dammTries`: reads of the DAMM v2 pool after a migration, `retryMs`
   * apart, before the feed gives up on it until the next restart.
   */
  constructor({ reads, l1, ers, pid, dbcConfig, store, db, solFeed = PYTH_SOL_USD, paceMs = 1_000, poolPaceMs = 500, retryMs = 3_000, maxWallets = 2_000, statsMs = 60_000, dammTries = 10, fetch = globalThis.fetch, now = Date.now, log = console.log }) {
    super();
    Object.assign(this, { reads, l1, ers, pid, dbcConfig, store, db, solFeed, paceMs, poolPaceMs, retryMs, maxWallets, statsMs, dammTries, fetch, now, log });
    this.hub = null;
```

5. Replace:

```js
    this.pools = new Map(); // mint -> { row, pool, data, migrated, damm, dammState, retry }
    this.known = null; // presales in the keeper's last scan
```

   with:

```js
    this.pools = new Map(); // mint -> { row, pool, data, migrated, damm, dammState, retry }
    this.coins = new Map(); // mint -> { stats, at, timer, reading } while `coin:<mint>` has sockets
    this.known = null; // presales in the keeper's last scan
```

6. Replace:

```js
    for (const p of this.pools.values()) clearTimeout(p.retry);
  }
```

   with:

```js
    for (const p of this.pools.values()) clearTimeout(p.retry);
    for (const c of this.coins.values()) clearTimeout(c.timer);
  }
```

7. Replace:

```js
      if (s.migrated && !p.damm) this.findDamm(mint);
      this.pushPool(p);
```

   with:

```js
      if (s.migrated && !p.damm) this.findDamm(mint);
      if (!s.migrated) this.store.addPrice(mint, priceFromSqrt(s.sqrtPrice), this.now());
      this.pushPool(p);
```

8. Replace:

```js
    this.publish("launched", { type: "upsert", data: row });
  }
```

   with:

```js
    this.publish("launched", { type: "upsert", data: row });
    this.statsSoon(p.row.mint);
  }
```

9. Replace:

```js
    this.sub(this.l1, "account", this.l1.onAccountChange(found.pool, (acc) => this.onDamm(mint, acc.data), { commitment: "confirmed" }));
    this.pushPool(p);
```

   with:

```js
    this.sub(this.l1, "account", this.l1.onAccountChange(found.pool, (acc) => this.onDamm(mint, acc.data), { commitment: "confirmed" }));
    this.store.addPrice(mint, priceFromSqrt(found.state.sqrtPrice), this.now());
    this.pushPool(p);
```

10. Replace:

```js
      p.dammState = s;
      this.pushPool(p);
    });
  }
```

   with:

```js
      p.dammState = s;
      this.store.addPrice(mint, priceFromSqrt(s.sqrtPrice), this.now());
      this.pushPool(p);
    });
  }

  // ---- one coin's stats (coin:<mint>) ----

  /** The coin's stats, read at most once a `statsMs` (callers in between share them). */
  async stats(mint) {
    const c = this.coins.get(mint) ?? { stats: null, at: 0, timer: null, reading: null };
    if (c.stats && this.now() - c.at < this.statsMs) return c.stats;
    if (c.reading) return c.reading;
    const p = this.pools.get(mint);
    c.reading = coinStats({ conn: this.l1, p, store: this.store, fetch: this.fetch, nowMs: this.now() }).finally(() => (c.reading = null));
    c.stats = await c.reading;
    c.at = this.now();
    return c.stats;
  }

  /** The coin's pool changed: if someone has it open, its stats are read again and pushed,
   *  now if the last read is `statsMs` old, else once when it will be. A coin whose pool
   *  doesn't change isn't read again. */
  statsSoon(mint) {
    const c = this.coins.get(mint);
    if (!c || c.timer) return;
    const wait = Math.max(0, c.at + this.statsMs - this.now());
    c.timer = setTimeout(async () => {
      c.timer = null;
      if (this.coins.get(mint) !== c) return;
      try {
        const data = await this.stats(mint);
        if (this.coins.get(mint) === c) this.publish(`coin:${mint}`, { type: "snapshot", data });
      } catch (e) {
        this.log(`live coin:${mint}: ${e.message}`);
      }
    }, wait);
    c.timer.unref?.();
  }
```

11. Replace:

```js
    const damm = [...this.pools.values()].filter((p) => p.damm).length;
    return { sockets: this.hub?.sockets ?? 0, heard: { ...this.heard }, wallets: this.wallets.size, pools: this.pools.size, damm, sol: this.sol };
  }
```

   with:

```js
    const damm = [...this.pools.values()].filter((p) => p.damm).length;
    return { sockets: this.hub?.sockets ?? 0, heard: { ...this.heard }, wallets: this.wallets.size, pools: this.pools.size, damm, coins: this.coins.size, sol: this.sol };
  }
```

12. Replace:

```js
    if (topic.startsWith("wallet:")) this.watchWallet(topic);
  }

  last(topic) {
    const id = this.wallets.get(topic);
```

   with:

```js
    if (topic.startsWith("wallet:")) this.watchWallet(topic);
    if (topic.startsWith("coin:")) this.coins.set(topic.slice("coin:".length), { stats: null, at: 0, timer: null, reading: null });
  }

  last(topic) {
    if (topic.startsWith("coin:")) {
      const mint = topic.slice("coin:".length);
      clearTimeout(this.coins.get(mint)?.timer);
      this.coins.delete(mint);
      return;
    }
    const id = this.wallets.get(topic);
```

13. Replace:

```js
      if (kind === "wallet") return send({ type: "snapshot", data: { lamports: await this.reads.balance(new PublicKey(arg)) } });
      if (kind === "presale") {
```

   with:

```js
      if (kind === "wallet") return send({ type: "snapshot", data: { lamports: await this.reads.balance(new PublicKey(arg)) } });
      if (kind === "coin") return this.pools.has(arg) ? send({ type: "snapshot", data: await this.stats(arg) }) : send({ type: "missing" });
      if (kind === "presale") {
```

- [ ] **Step 5: Run the tests**

The `coin:` test waits on real timers (`statsMs: 300` in the test). Run `test/live.test.js` three times; it must pass each time.

Run: `cd engine && node --test test/coinstats.test.js test/live.test.js`
Expected: 17 pass, 0 fail

Run: `cd engine && node --test test/live.test.js && node --test test/live.test.js && node --test test/live.test.js`
Expected: exit 0 each time

Run: `cd engine && npm test`
Expected: 306 pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add engine/server/coinstats.js engine/test/coinstats.test.js engine/server/store.js engine/server/hub.js engine/server/feed.js engine/test/live.test.js && git commit -m "server: coin:<mint> pushes a coin's chart, volume, liquidity and holders while it's open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The phone's trading and coin state (`mobile/src/trading.js`, store)

The store gains a coin's stats, the wallet's balance of an open coin, and two actions:

- `watchCoin(mint)`: subscribes to `coin:<mint>` and reads the wallet's balance of the coin once. It returns `off()`.
- `preview(side, mint, amount)`: a quote for the sheet, which signs nothing.
- `trade(side, mint, amount, signer)`: a fresh quote at the press (the price may have moved since the sheet's), then Jupiter's tx, the signer check, Seed Vault's signature, a send with preflight, and confirmation. It runs through `run()`, so `busy.step` names what it waits for.

The balance is read when a coin screen opens, after a trade here, and on each `wallet:` push after the first. The server pushes `wallet:` when the wallet's SOL changes, and every trade moves SOL. There is no timer. A token transfer-in that moves no SOL doesn't refresh it: the screen shows it on the next open.

`mobile/src/trading.js` binds `swap.js` to the phone's RPC (`config.js` `RPC`, the endpoint the wallet adapter uses: `wallet.js` `endpoint={RPC}`) and `PRIORITY` (100,000 µLamports per CU; Seed Vault raises anything lower to that).

**Files:**
- Create: `mobile/test/trading.test.mjs`
- Modify: `mobile/test/store.test.mjs`
- Create: `mobile/src/trading.js`
- Modify: `mobile/src/store.js`
- Modify: `mobile/src/app.js`

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/trading.test.mjs`:

```js
// The phone's trading (src/trading.js) over engine/src/swap.js, with a fake fetch and RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { makeMarket } from "../src/trading.js";

const WSOL = "So11111111111111111111111111111111111111112";
const MINT = "GS2xpNeKkon1rQHa7XcwkbZ65yP3rBT2v4uh2KMdQDeC";
const POOL = "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri";
const wallet = Keypair.generate();
// Jupiter's quote for 0.01 SOL of the trial coin (mainnet, 2026-10-01), trimmed
const QUOTE = {
  inputMint: WSOL, inAmount: "10000000", outputMint: MINT, outAmount: "348894380365", otherAmountThreshold: "338427548955",
  swapMode: "ExactIn", slippageBps: 300, priceImpactPct: "0",
  routePlan: [{ swapInfo: { ammKey: POOL, label: "Dynamic Bonding Curve" }, percent: 100 }],
};

function fakeFetch(...replies) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const [status, json] = replies.shift();
    return { ok: status < 400, status, json: async () => json };
  };
  f.calls = calls;
  return f;
}

function jupTx() {
  const ix = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });
  const msg = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", instructions: [ix] }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

test("quote: a buy spends SOL, a sell spends the coin", async () => {
  const fetch = fakeFetch([200, QUOTE], [200, { ...QUOTE, inputMint: MINT, outputMint: WSOL }]);
  const m = makeMarket({ conn: {}, priority: 100_000, fetch });
  const q = await m.quote("buy", MINT, 10_000_000n);
  assert.equal(q.outAmount, 348_894_380_365n);
  await m.quote("sell", MINT, 5n);
  assert.match(fetch.calls[0].url, new RegExp(`inputMint=${WSOL}&outputMint=${MINT}&amount=10000000&`));
  assert.match(fetch.calls[1].url, new RegExp(`inputMint=${MINT}&outputMint=${WSOL}&amount=5&`));
});

test("holding: the wallet's accounts of the mint over the phone's RPC", async () => {
  let asked;
  const conn = {
    getParsedTokenAccountsByOwner: async (owner, filter) => (
      (asked = [owner.toBase58(), filter.mint.toBase58()]),
      { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: "2500000", decimals: 6 } } } } } }] }
    ),
  };
  const m = makeMarket({ conn, priority: 100_000, fetch: fakeFetch() });
  assert.deepEqual(await m.holding(wallet.publicKey.toBase58(), MINT), { raw: 2_500_000n, decimals: 6, ui: 2.5 });
  assert.deepEqual(asked, [wallet.publicKey.toBase58(), MINT]);
});

test("swap: the phone's priority, the wallet only signs, the app sends with a preflight", async () => {
  const fetch = fakeFetch([200, QUOTE], [200, { swapTransaction: jupTx(), lastValidBlockHeight: 430317386, computeUnitLimit: 87951, prioritizationFeeLamports: 8795, simulationError: null }]);
  const sent = [];
  const conn = {
    rpcEndpoint: "https://rpc",
    sendRawTransaction: async (raw, opts) => (sent.push(opts), "SIG"),
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    getBlockHeight: async () => 1,
  };
  const m = makeMarket({ conn, priority: 100_000, fetch });
  const used = [];
  const signer = {
    publicKey: wallet.publicKey,
    signTransaction: async (tx) => (used.push("sign"), tx.sign([wallet]), tx),
    sendTransaction: async () => (used.push("send"), "NO"),
  };
  const steps = [];
  const q = await m.quote("buy", MINT, 10_000_000n);
  assert.equal(await m.swap(q, signer, (s) => steps.push(s)), "SIG");
  assert.equal(fetch.calls[1].body.computeUnitPriceMicroLamports, 100_000);
  assert.equal(fetch.calls[1].body.userPublicKey, wallet.publicKey.toBase58());
  assert.deepEqual(used, ["sign"]);
  assert.deepEqual(sent, [{ skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" }]);
  assert.deepEqual(steps, ["Checking the trade", "Sign the trade in your wallet", "Sending"]);
});
```

In `mobile/test/store.test.mjs`, 3 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js

function rig({ flows: over = {}, api: apiOver = {}, now = 1_000_000, wrapSaved = (base) => base } = {}) {
  const clock = typeof now === "function" ? now : () => now;
```

   with:

```js

function rig({ flows: over = {}, api: apiOver = {}, market: marketOver = {}, now = 1_000_000, wrapSaved = (base) => base } = {}) {
  const clock = typeof now === "function" ? now : () => now;
```

2. Replace:

```js
  };
  const store = createMoonerStore({ live, api, flows, saved, now: clock });
  const goUp = (up) => [...status].forEach((fn) => fn(up));
```

   with:

```js
  };
  const market = {
    quote: async (side, mint, amount) => (calls.push(["quote", side, mint, amount]), { side, inAmount: amount, outAmount: 7n, route: [] }),
    holding: async (wallet, mint) => (calls.push(["holding", wallet, mint]), { raw: 5_000_000n, decimals: 6, ui: 5 }),
    swap: async (q, s, onStep) => {
      calls.push(["swap", q, s]);
      onStep("Sign the trade in your wallet");
      return "SIG";
    },
    ...marketOver,
  };
  const store = createMoonerStore({ live, api, flows, saved, market, now: clock });
  const goUp = (up) => [...status].forEach((fn) => fn(up));
```

3. Replace:

```js
  assert.equal(disk.get(`mooner:mine:${W}`).A.deposit, "100000000", "its presales are still saved");
});
```

   with:

```js
  assert.equal(disk.get(`mooner:mine:${W}`).A.deposit, "100000000", "its presales are still saved");
});

// ---- a launched coin: its stats, the wallet's balance of it, buy and sell ----

const MINT = "Mint1111";
const holdingReads = (calls) => calls.filter((c) => c[0] === "holding").length;

test("watchCoin: the coin's stats while a screen shows it; missing and errors say so", () => {
  const { store, push, listening } = rig();
  const offA = store.getState().watchCoin(MINT);
  const offB = store.getState().watchCoin(MINT);
  assert.ok(listening(`coin:${MINT}`));
  push(`coin:${MINT}`, "error", undefined);
  assert.equal(store.getState().coinError[MINT], "couldn't read this right now");
  const stats = { mint: MINT, venue: "dbc", candles: [], volume24hUsd: 812.5 };
  push(`coin:${MINT}`, "snapshot", stats);
  assert.equal(store.getState().coins[MINT], stats);
  assert.equal(store.getState().coinError[MINT], undefined, "a snapshot clears the error");
  push(`coin:${MINT}`, "missing", undefined);
  assert.equal(store.getState().coinMissing[MINT], true);
  offA();
  offA(); // counts once
  assert.ok(listening(`coin:${MINT}`), "the second screen still watches");
  offB();
  assert.equal(listening(`coin:${MINT}`), false);
});

test("the wallet's balance of a coin: read when the screen opens and when the wallet's SOL moves, never on a timer", async () => {
  const { store, push, calls } = rig();
  store.getState().watchCoin(MINT);
  await tick();
  assert.equal(holdingReads(calls), 0, "no wallet, no read");
  await store.getState().setWallet(W);
  await tick();
  assert.deepEqual(calls.filter((c) => c[0] === "holding"), [["holding", W, MINT]], "connecting reads the watched coin");
  assert.deepEqual(store.getState().holdings[MINT], { raw: 5_000_000n, decimals: 6, ui: 5 });
  push(`wallet:${W}`, "snapshot", { lamports: "900000000" });
  await tick();
  assert.equal(holdingReads(calls), 1, "the first SOL figure is no change");
  push(`wallet:${W}`, "snapshot", { lamports: "800000000" });
  await tick();
  assert.equal(holdingReads(calls), 2, "the SOL moved: read again");
  await store.getState().setWallet(null);
  assert.deepEqual(store.getState().holdings, {}, "another wallet's balances go with it");
});

test("a coin screen that stops watching reads no more", async () => {
  const { store, push, calls } = rig();
  await store.getState().setWallet(W);
  push(`wallet:${W}`, "snapshot", { lamports: "900000000" });
  const off = store.getState().watchCoin(MINT);
  await tick();
  assert.equal(holdingReads(calls), 1, "opening reads once");
  off();
  push(`wallet:${W}`, "snapshot", { lamports: "800000000" });
  await tick();
  assert.equal(holdingReads(calls), 1);
});

test("a balance read that lands after a newer one, or after the wallet changed, is dropped", async () => {
  const waits = [];
  const { store, push } = rig({ market: { holding: () => new Promise((resolve) => waits.push(resolve)) } });
  await store.getState().setWallet(W);
  push(`wallet:${W}`, "snapshot", { lamports: "900000000" });
  store.getState().watchCoin(MINT);
  push(`wallet:${W}`, "snapshot", { lamports: "800000000" });
  assert.equal(waits.length, 2);
  waits[1]({ raw: 2n, decimals: 6, ui: 0.000002 });
  await tick();
  waits[0]({ raw: 1n, decimals: 6, ui: 0.000001 });
  await tick();
  assert.equal(store.getState().holdings[MINT].raw, 2n, "the older read lost");
  push(`wallet:${W}`, "snapshot", { lamports: "700000000" });
  await store.getState().setWallet(null);
  waits[2]({ raw: 3n, decimals: 6, ui: 0.000003 });
  await tick();
  assert.deepEqual(store.getState().holdings, {});
});

test("preview: Jupiter's quote, or the no-route words the sheet shows", async () => {
  const noRoute = Object.assign(new Error("no route for this trade yet"), { noRoute: true });
  let fail = null;
  const { store, calls } = rig({ market: { quote: async (side, mint, amount) => { if (fail) throw fail; calls.push(["quote", side, mint, amount]); return { outAmount: 7n }; } } });
  assert.deepEqual(await store.getState().preview("buy", MINT, 100_000_000n), { ok: true, value: { outAmount: 7n } });
  assert.deepEqual(calls, [["quote", "buy", MINT, 100_000_000n]]);
  fail = noRoute;
  assert.deepEqual(await store.getState().preview("buy", MINT, 1n), { ok: false, error: "No route for this trade yet. Try again in a moment.", noRoute: true });
  fail = new Error("Rate limit exceeded");
  assert.deepEqual(await store.getState().preview("sell", MINT, 1n), { ok: false, error: "Rate limit exceeded", noRoute: false });
});

test("trade: a fresh quote, the swap with the screen's signer, then the balance; one at a time", async () => {
  const { store, calls } = rig();
  await store.getState().setWallet(W);
  const steps = [];
  const unsub = store.subscribe((s, was) => s.busy && s.busy !== was.busy && steps.push([s.busy.kind, s.busy.step]));
  const r = await store.getState().trade("sell", MINT, 2_500_000n, signer);
  unsub();
  assert.deepEqual(r, { ok: true, value: { sig: "SIG", quote: { side: "sell", inAmount: 2_500_000n, outAmount: 7n, route: [] } } });
  assert.deepEqual(calls.map((c) => c[0]), ["quote", "swap", "holding"], "no coin screen open: the trade reads the balance after");
  assert.equal(calls[1][2], signer);
  assert.deepEqual(steps, [["sell", null], ["sell", "Getting a price from Jupiter"], ["sell", "Sign the trade in your wallet"]]);
  assert.equal(store.getState().busy, null);
});

test("trade: a failed swap in plain words; a second trade waits for the first", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
  const { store } = rig({
    market: {
      swap: async () => {
        await gate;
        throw new Error(`trade (SIG): ix 3 (${JUP}): custom 6001`);
      },
    },
  });
  const first = store.getState().trade("buy", MINT, 100_000_000n, signer);
  await tick();
  assert.deepEqual(await store.getState().trade("buy", MINT, 100_000_000n, signer), { ok: false, error: "Wait for the last one to finish." });
  release();
  assert.deepEqual(await first, { ok: false, error: "The price moved more than 3% before your trade landed, so it didn't go through. Try again." });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd mobile && npm test`
Expected: 120 pass, 8 fail: `trading.test.mjs` stops at `ERR_MODULE_NOT_FOUND` (`src/trading.js`); the 7 new store tests fail (`watchCoin`, `preview`, `trade` don't exist)

- [ ] **Step 3: Write the code**

Create `mobile/src/trading.js`:

```js
// Trading for the phone: Jupiter quotes and swaps (engine/src/swap.js, the website's code)
// and the wallet's balance of a coin, over the phone's own RPC. Seed Vault signs without
// sending, so a swap is signTransaction and our own send (swap.js sends it with a preflight
// and confirms it against Jupiter's blockhash).

import { PublicKey } from "@solana/web3.js";
import { buyQuote, sellQuote, swap, tokenBalance } from "../../engine/src/swap.js";

/** `conn`: a Connection to the phone's RPC; `priority`: µLamports per CU (Seed Vault raises
 *  anything lower to 100k, config.js PRIORITY). Mints and wallets are base58. */
export function makeMarket({ conn, priority, fetch = globalThis.fetch }) {
  return {
    /** A Jupiter quote: a buy of `amount` lamports, or a sell of `amount` raw tokens (BigInt). */
    quote: (side, mint, amount) => (side === "buy" ? buyQuote(mint, amount, { fetch }) : sellQuote(mint, amount, { fetch })),
    /** The wallet's balance of the coin: { raw (BigInt), decimals, ui }. */
    holding: (wallet, mint) => tokenBalance(conn, new PublicKey(wallet), new PublicKey(mint)),
    /** Builds, checks, has the wallet sign, sends and confirms the swap for quote `q`. */
    swap: (q, signer, onStep) => swap({ quote: q, wallet: signer.publicKey, conn, signTransaction: signer.signTransaction, priority, fetch, onStep }),
  };
}
```

In `mobile/src/store.js`, 11 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
// The phone app's state: what the server pushes (presales, one presale's view and chat,
// launched coins, Mooner pictures' traits, SOL/USD, the wallet's SOL) and what the user does
// (sign in, join, get SOL back, chat). Screens read it with zustand's useStore and call its
// actions. Nothing here imports React Native, so it runs in Node tests with fakes.

```

   with:

```js
// The phone app's state: what the server pushes (presales, one presale's view and chat,
// launched coins, one coin's stats, Mooner pictures' traits, SOL/USD, the wallet's SOL), the
// wallet's balance of an open coin, and what the user does (sign in, join, get SOL back, chat,
// buy, sell). Screens read it with zustand's useStore and call its actions. Nothing here
// imports React Native, so it runs in Node tests with fakes.

```

2. Replace:

```js
import { signIn as walletSignIn } from "../../engine/src/signin.js";

```

   with:

```js
import { signIn as walletSignIn } from "../../engine/src/signin.js";
import { explainSwap } from "../../engine/src/swap.js";

```

3. Replace:

```js
 * saved: (name) -> { get(), set(value), clear() }                securekeys.js secureJson
 */
export function createMoonerStore({ live, api, flows, saved, now = () => Date.now() }) {
  let walletOff = null;
  let running = null; // { users, offs } while any start() is on
  const store = createStore(() => ({
```

   with:

```js
 * saved: (name) -> { get(), set(value), clear() }                securekeys.js secureJson
 * market: { quote(side, mint, amount), holding(wallet, mint), swap(q, signer, onStep) }
 *                                                                 trading.js makeMarket
 */
export function createMoonerStore({ live, api, flows, saved, market, now = () => Date.now() }) {
  let walletOff = null;
  let running = null; // { users, offs } while any start() is on
  const watching = new Map(); // mint -> how many screens watch the coin
  const reads = new Map(); // mint -> the latest balance read's number: an older one landing late is dropped
  const store = createStore(() => ({
```

4. Replace:

```js
    chats: {}, // channel -> rows, oldest first
    busy: null, // { key, kind: "join" | "back", step }
  }));
```

   with:

```js
    chats: {}, // channel -> rows, oldest first
    coins: {}, // mint -> the coin's stats (chart, volume, liquidity, holders), while a screen watches it
    coinMissing: {}, // mint -> true: the server has no such coin
    coinError: {}, // mint -> the server's words when it couldn't read the stats; the next snapshot clears it
    holdings: {}, // mint -> { raw (BigInt), decimals, ui }: the connected wallet's balance of a watched coin
    busy: null, // { key, kind: "join" | "back" | "buy" | "sell", step }
  }));
```

5. Replace:

```js

  async function loadInfo() {
```

   with:

```js

  const onCoin = (mint) => (m) => {
    if (m.type === "snapshot") set((s) => ({ coins: { ...s.coins, [mint]: m.data }, coinMissing: without(s.coinMissing, mint), coinError: without(s.coinError, mint) }));
    else if (m.type === "missing") set((s) => ({ coinMissing: { ...s.coinMissing, [mint]: true }, coinError: without(s.coinError, mint) }));
    else if (m.type === "error") patch("coinError", (x) => ({ ...x, [mint]: m.error || "couldn't read this right now" }));
  };

  async function loadInfo() {
```

6. Replace:

```js

  // ---- the wallet ----
```

   with:

```js

  /** One launched coin's stats and the wallet's balance of it while a screen shows it.
   *  Returns off(); each off counts once. */
  function watchCoin(mint) {
    patch("coinError", (x) => without(x, mint));
    watching.set(mint, (watching.get(mint) ?? 0) + 1);
    const off = live.subscribe(`coin:${mint}`, onCoin(mint));
    readHolding(mint);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      off();
      const n = watching.get(mint) - 1;
      if (n > 0) watching.set(mint, n);
      else watching.delete(mint);
    };
  }

  /** Reads the connected wallet's balance of `mint` once: when a coin screen opens, when the
   *  wallet's SOL changes (the server pushes it: a trade moved it), after a trade here. A
   *  failed read leaves the last one. */
  async function readHolding(mint) {
    const wallet = get().wallet;
    if (!wallet) return;
    const n = (reads.get(mint) ?? 0) + 1;
    reads.set(mint, n);
    try {
      const b = await market.holding(wallet, mint);
      if (get().wallet === wallet && reads.get(mint) === n) patch("holdings", (h) => ({ ...h, [mint]: b }));
    } catch {
      // the screen keeps what it had; the next push or trade reads again
    }
  }

  // ---- the wallet ----
```

7. Replace:

```js
    walletOff = null;
    set({ wallet, lamports: null, session: null, mine: {} });
    if (!wallet) return;
    walletOff = live.subscribe(`wallet:${wallet}`, (m) => {
      if (m.type === "snapshot" && m.data?.lamports != null) set({ lamports: Number(m.data.lamports) });
    });
    const [session, mine] = await Promise.all([
```

   with:

```js
    walletOff = null;
    set({ wallet, lamports: null, session: null, mine: {}, holdings: {} });
    if (!wallet) return;
    walletOff = live.subscribe(`wallet:${wallet}`, (m) => {
      if (m.type !== "snapshot" || m.data?.lamports == null) return;
      const was = get().lamports;
      set({ lamports: Number(m.data.lamports) });
      // the wallet's SOL moved: a trade (here or elsewhere) may have moved its coins too
      if (was != null) for (const mint of watching.keys()) readHolding(mint);
    });
    for (const mint of watching.keys()) readHolding(mint);
    const [session, mine] = await Promise.all([
```

8. Replace:

```js

  /** Runs one action at a time; `busy.step` is what it waits for. */
  async function run(key, kind, fn) {
    if (get().busy) return { ok: false, error: "Wait for the last one to finish." };
```

   with:

```js

  /** Runs one action at a time; `busy.step` is what it waits for. `why` words an error. */
  async function run(key, kind, fn, why = explain) {
    if (get().busy) return { ok: false, error: "Wait for the last one to finish." };
```

9. Replace:

```js
    } catch (e) {
      return { ok: false, error: explain(e) };
    } finally {
```

   with:

```js
    } catch (e) {
      return { ok: false, error: why(e) };
    } finally {
```

10. Replace:

```js

  /** What a join takes from the wallet besides the deposit (BigInt lamports). */
```

   with:

```js

  /** What a trade would get, for the sheet before anything is signed: { ok: true, value:
   *  quote } or { ok: false, error, noRoute }. `side` "buy" spends `amount` lamports, "sell"
   *  `amount` raw tokens (BigInt). */
  async function preview(side, mint, amount) {
    try {
      return { ok: true, value: await market.quote(side, mint, amount) };
    } catch (e) {
      return { ok: false, error: explainSwap(e), noRoute: !!e?.noRoute };
    }
  }

  /** Buys or sells coin `mint` at a fresh quote (the price may have moved since the sheet's).
   *  Returns { ok, value: { sig, quote } } or { ok: false, error }. */
  function trade(side, mint, amount, signer) {
    return run(
      mint,
      side,
      async (onStep) => {
        onStep("Getting a price from Jupiter");
        const q = await market.quote(side, mint, amount);
        const sig = await market.swap(q, signer, onStep);
        await readHolding(mint);
        return { sig, quote: q };
      },
      explainSwap,
    );
  }

  /** What a join takes from the wallet besides the deposit (BigInt lamports). */
```

11. Replace:

```js

  set({ start, watch, setWallet, signIn, signOut, join, getBack, joinCost, sendChat });
  return store;
```

   with:

```js

  set({ start, watch, watchCoin, setWallet, signIn, signOut, join, getBack, joinCost, sendChat, preview, trade });
  return store;
```

Replace all of `mobile/src/app.js` with:

```js
// The app's one socket, API, flows, RPC connection, market and store (React Native side).
import { Connection } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";
import { makeApi } from "../../engine/src/apiclient.js";
import { makeFlows } from "../../engine/src/flows.js";
import { makeLive } from "../../engine/src/live.js";
import { BASE, PRIORITY, RPC, WS_URL } from "./config";
import { secureJson, secureKeys } from "./securekeys";
import { createMoonerStore } from "./store";
import { makeMarket } from "./trading";

export const live = makeLive({ url: WS_URL });
export const api = makeApi(BASE);
export const flows = makeFlows({ api, subscribe: live.subscribe, keys: secureKeys(SecureStore), priority: PRIORITY });
/** The phone's own RPC (the one the wallet adapter uses): token balances and sending trades. */
export const conn = new Connection(RPC, "confirmed");
export const market = makeMarket({ conn, priority: PRIORITY });
export const store = createMoonerStore({ live, api, flows, market, saved: (name) => secureJson(SecureStore, name) });
```

- [ ] **Step 4: Run the tests and the bundle check**

Run: `cd mobile && npm test`
Expected: 130 pass, 0 fail

Run: `cd mobile && sh scripts/check-bundle.sh`
Expected: `web3.js copies: 1; files from engine/node_modules: 0`

- [ ] **Step 5: Commit**

```bash
git add mobile/src/trading.js mobile/test/trading.test.mjs mobile/src/store.js mobile/test/store.test.mjs mobile/src/app.js && git commit -m "mobile: trading through swap.js, a coin's stats and the wallet's balance of it in the store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The coin screen: chart, stats, holders, your position

The coin screen shows what `coin:<mint>` pushes:

- A line chart of the candles' closes, with the pool's live price as the last point, and the change over the span. It's drawn with react-native-svg and labeled with the candles' source.
- Liquidity: the DBC pool's SOL before migration, Meteora's TVL after.
- 24h volume.
- The holder count, which only Meteora has, after migration.
- The top holders, each with a share of the supply the server read.
- Your position: your balance and what it's worth at the pool's price now.

The curve says "Migrated to Meteora DAMM v2" once the coin migrated (spec, "Coin info"). "At migration" now shows only while the server hasn't found the DAMM v2 pool (`pool.migrated && !pool.damm`); after that the price is that pool's live one. A figure no source has says "Not known yet".

The pure parts (`chart.js`, `coin.js`) are tested in Node. The component is `PriceChart.js`, not `Chart.js`: macOS's filesystem is case-insensitive, and `Chart.js` would overwrite `chart.js`.

**Files:**
- Create: `mobile/test/chart.test.mjs`
- Modify: `mobile/test/launched.test.mjs`
- Create: `mobile/src/launched/chart.js`
- Modify: `mobile/src/launched/coin.js`
- Create: `mobile/src/launched/PriceChart.js`
- Modify: `mobile/src/launched/CoinRow.js`
- Modify: `mobile/app/coin/[key].js`

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/chart.test.mjs`:

```js
// The coin screen's chart math (src/launched/chart.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { changeText, chartPath, pointsOf, spanText } from "../src/launched/chart.js";

const c = (t, close) => ({ t, o: close, h: close, l: close, c: close });

test("pointsOf: the closes, then the live price when it's newer", () => {
  assert.deepEqual(pointsOf([c(0, 1), c(60_000, 2)], 3, 90_000), [{ t: 0, p: 1 }, { t: 60_000, p: 2 }, { t: 90_000, p: 3 }]);
  assert.deepEqual(pointsOf([c(0, 1), c(60_000, 2)], 3, 60_000), [{ t: 0, p: 1 }, { t: 60_000, p: 2 }], "not newer: left out");
  assert.deepEqual(pointsOf([], null, 5), []);
  assert.deepEqual(pointsOf(undefined, 2, 5), [{ t: 5, p: 2 }]);
});

test("chartPath: time across, price up, padded; a flat price mid-box", () => {
  const p = chartPath([{ t: 0, p: 1 }, { t: 50, p: 3 }, { t: 100, p: 2 }], 200, 100, 10);
  assert.equal(p.line, "M0 90 L100 10 L200 50");
  assert.equal(p.area, "M0 90 L100 10 L200 50 L200 100 L0 100 Z");
  assert.deepEqual([p.lo, p.hi, p.change], [1, 3, 1]);
  assert.equal(chartPath([{ t: 0, p: 2 }, { t: 10, p: 2 }], 100, 40).line, "M0 20 L100 20");
  assert.equal(chartPath([{ t: 0, p: 2 }], 100, 40), null);
});

test("changeText and spanText", () => {
  assert.equal(changeText(0.1234), "+12.3%");
  assert.equal(changeText(-0.04561), "-4.56%");
  assert.equal(changeText(0), "0%");
  assert.equal(spanText(0, 40 * 60_000), "Last 40 min");
  assert.equal(spanText(0, 300 * 60_000), "Last 5 h");
  assert.equal(spanText(0, 10_000), "Last 1 min");
});
```

In `mobile/test/launched.test.mjs`, 3 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
import assert from "node:assert/strict";
import { capText, coinScreenState, curveOf, dayTime, inWith, priceText, sig3, stillIn } from "../src/launched/coin.js";

```

   with:

```js
import assert from "node:assert/strict";
import {
  atMigration, capText, coinScreenState, curveOf, dayTime, holderRows, holdersText, inWith, liquidityText, positionOf, priceText, sig3, stillIn, volumeText,
} from "../src/launched/coin.js";

```

2. Replace:

```js
  assert.equal(curveOf({ quoteReserve: "90000000000", migrated: false }).fill, 1);
  assert.deepEqual(curveOf({ quoteReserve: "0", migrated: true }), { fill: 1, text: "Migrated to DAMM v2" });
});
```

   with:

```js
  assert.equal(curveOf({ quoteReserve: "90000000000", migrated: false }).fill, 1);
  assert.deepEqual(curveOf({ quoteReserve: "0", migrated: true }), { fill: 1, text: "Migrated to Meteora DAMM v2" });
});
```

3. Replace:

```js
  assert.equal(inWith(seat("300000000"), null, undefined), null);
});
```

   with:

```js
  assert.equal(inWith(seat("300000000"), null, undefined), null);
});

test("atMigration: only while a migrated coin's DAMM v2 pool isn't found yet", () => {
  assert.equal(atMigration({ migrated: false, damm: null }), false);
  assert.equal(atMigration({ migrated: true, damm: null }), true);
  assert.equal(atMigration({ migrated: true, damm: "Damm1111" }), false);
  assert.equal(atMigration(null), false);
});

test("liquidity, volume, holders: from the pool before migration, Meteora after; null when unknown", () => {
  const dbc = { quoteReserve: "12345678900", migrated: false, damm: null };
  assert.equal(liquidityText(dbc, null), "12.35 SOL");
  const damm = { quoteReserve: "0", migrated: true, damm: "Damm1111" };
  assert.equal(liquidityText(damm, { venue: "damm", liquidityUsd: 9956.5 }), "$9,956.50");
  assert.equal(liquidityText(damm, { venue: "dbc", liquidityUsd: null }), null, "stats from before the DAMM v2 pool was found");
  assert.equal(liquidityText(null, null), null);
  assert.equal(volumeText({ volume24hUsd: 3754478.47 }), "$3.75M");
  assert.equal(volumeText({ volume24hUsd: null }), null);
  assert.equal(holdersText({ holders: 1256 }), "1.26K");
  assert.equal(holdersText({ holders: null }), null);
  assert.equal(volumeText(undefined), null);
});

test("holderRows: the pool and presale by name, you as You, a share of the supply the server read", () => {
  const top = [
    { owner: "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM", amount: "700000000000000", label: "Bonding curve" },
    { owner: "Wallet1111", amount: "12345000000", label: null },
    { owner: "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D", amount: "5000000000000", label: null },
  ];
  assert.deepEqual(holderRows(top, "Wallet1111", "1000000000000000").map(({ who, tokens, share }) => [who, tokens, share]), [
    ["Bonding curve", "700M", "70%"],
    ["You", "12.3K", "0.00123%"],
    ["HgZ9…5u8D", "5M", "0.5%"],
  ]);
  // the trial coin's supply on chain (getTokenSupply, 2026-10-01): not 1B
  assert.equal(holderRows(top, "W", "1196140480631743")[0].share, "58.5%");
  assert.deepEqual(holderRows(top, "W", null).map((r) => r.share), [null, null, null], "no supply read: no shares, tokens only");
  assert.equal(holderRows(null, "W", "1"), null);
  assert.deepEqual(holderRows([], "W", "1"), []);
});

test("positionOf: what the wallet holds and its worth at the pool's price", () => {
  // 28 SOL market cap: 2.8e-8 SOL per token
  const START = "97610994635780032";
  assert.deepEqual(positionOf({ raw: 1_000_000_000_000n, decimals: 6, ui: 1e6 }, START, 150), { tokens: "1M", sol: "0.028 SOL", usd: "$4.20" });
  assert.deepEqual(positionOf({ raw: 500_000n, decimals: 6, ui: 0.5 }, null, 150), { tokens: "0.5", sol: null, usd: null });
  assert.equal(positionOf({ raw: 0n, decimals: 6, ui: 0 }, START, 150), null);
  assert.equal(positionOf(undefined, START, 150), null);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd mobile && npm test`
Expected: 122 pass, 2 fail: `chart.test.mjs` stops at `ERR_MODULE_NOT_FOUND` (`src/launched/chart.js`); `launched.test.mjs` can't import `atMigration` and the other new exports

- [ ] **Step 3: The pure parts**

Create `mobile/src/launched/chart.js`:

```js
// The coin screen's chart as plain numbers (no React Native, so Node tests run it): a line
// through the candles' closes, the pool's live price last, scaled into a box.

/** Points { t (ms), p (SOL per token) } oldest first: each candle's close, then the live
 *  price `live` at `nowMs` when there is one and it's newer than the last candle. */
export function pointsOf(candles, live, nowMs) {
  const pts = (candles ?? []).map((c) => ({ t: c.t, p: c.c }));
  if (live > 0 && (!pts.length || nowMs > pts[pts.length - 1].t)) pts.push({ t: nowMs, p: live });
  return pts;
}

const r1 = (n) => Math.round(n * 10) / 10;

/** SVG paths through `pts` in a `w`×`h` box, `pad` px in from the top and bottom: { line,
 *  area, lo, hi, change } (change: last / first - 1), or null with fewer than 2 points. x
 *  follows time, y the price; a price that never moved draws mid-box. */
export function chartPath(pts, w, h, pad = 4) {
  if (pts.length < 2) return null;
  const t0 = pts[0].t;
  const span = pts[pts.length - 1].t - t0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const { p } of pts) {
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  }
  const x = (t) => (span > 0 ? ((t - t0) / span) * w : w);
  const y = (p) => (hi === lo ? h / 2 : pad + (1 - (p - lo) / (hi - lo)) * (h - 2 * pad));
  const line = pts.map((q, i) => `${i ? "L" : "M"}${r1(x(q.t))} ${r1(y(q.p))}`).join(" ");
  return { line, area: `${line} L${r1(w)} ${h} L0 ${h} Z`, lo, hi, change: pts[pts.length - 1].p / pts[0].p - 1 };
}

/** "+12.3%", "-4.56%", "0%": a change as a signed percent, 3 significant digits. */
export function changeText(change) {
  const pct = Number((change * 100).toPrecision(3));
  if (pct === 0) return "0%";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** "Last 5 h", "Last 40 min": how much time the chart covers, from its first point to now. */
export function spanText(fromMs, nowMs) {
  const min = Math.max(1, Math.round((nowMs - fromMs) / 60_000));
  return min < 120 ? `Last ${min} min` : `Last ${Math.round(min / 60)} h`;
}

/** Where the candles come from, for the line under the chart. */
export const SOURCES = { geckoterminal: "GeckoTerminal", meteora: "Meteora", mooner: "Mooner's server" };
```

In `mobile/src/launched/coin.js`, 4 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
import { GRAD_SOL, marketCapSol, priceFromSqrt, seatOf } from "../../../engine/src/views.js";
import { compact, usd } from "../ui/format.js";
import { hhmm } from "../room/room.js";
```

   with:

```js
import { GRAD_SOL, marketCapSol, priceFromSqrt, seatOf } from "../../../engine/src/views.js";
import { compact, shortWallet, solText, usd } from "../ui/format.js";
import { hhmm } from "../room/room.js";
```

2. Replace:

```js
const LAUNCHING = new Set(["FULL", "LAUNCHING", "SETTLED"]);

```

   with:

```js
const LAUNCHING = new Set(["FULL", "LAUNCHING", "SETTLED"]);

/** Raw units per whole token: Mooner coins have 6 decimals (engine/src/views.js DECIMALS). */
const RAW_PER_TOKEN = 1e6;

```

3. Replace:

```js
export function curveOf(pool) {
  if (pool.migrated) return { fill: 1, text: "Migrated to DAMM v2" };
  const sol = Number(BigInt(pool.quoteReserve)) / 1e9;
```

   with:

```js
export function curveOf(pool) {
  if (pool.migrated) return { fill: 1, text: "Migrated to Meteora DAMM v2" };
  const sol = Number(BigInt(pool.quoteReserve)) / 1e9;
```

4. Replace:

```js
  return "missing";
}
```

   with:

```js
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
 *  screen lists the top holders instead). */
export const holdersText = (stats) => (stats?.holders != null ? compact(stats.holders) : null);

/** The top holders as rows: { key, who (the pool, the presale, "You", or a short wallet),
 *  tokens ("1.2M"), share ("12.3%" of the supply, or null when the server couldn't read the
 *  supply) }. `supply`: the coin's supply in raw units as the server read it (stats.supply);
 *  not the 1B of views.js SUPPLY, which a coin's real supply needn't match. null when the
 *  server couldn't read the holders. */
export function holderRows(top, wallet, supply) {
  if (!top) return null;
  const all = Number(supply);
  return top.map((h) => {
    const n = Number(h.amount) / RAW_PER_TOKEN;
    return {
      key: h.owner ?? h.amount,
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
```

- [ ] **Step 4: Run the tests**

Run: `cd mobile && npm test`
Expected: 137 pass, 0 fail

- [ ] **Step 5: The screens**

Two lines in `CoinRow.js` change: "At migration" follows `atMigration`. The coin screen is replaced whole.

Create `mobile/src/launched/PriceChart.js`:

```js
// The coin screen's price chart: the candles the server pushes on `coin:<mint>`, with the
// pool's live price as the last point.
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { priceFromSqrt } from "../../../engine/src/views.js";
import { Card, T } from "../ui/kit";
import { C } from "../ui/theme";
import { changeText, chartPath, pointsOf, SOURCES, spanText } from "./chart";

const HEIGHT = 160;

/** `stats`: the coin's stats (undefined until the first snapshot); `missing`: the server has
 *  no stats for this coin; `error`: its words when the last read failed; `sqrtPrice`: the
 *  pool's live price. */
export function PriceChart({ stats, missing, error, sqrtPrice }) {
  const [width, setWidth] = useState(0);
  // the live point sits at the time this screen heard the price (or the stats) last
  const [heardAt, setHeardAt] = useState(Date.now);
  useEffect(() => setHeardAt(Date.now()), [sqrtPrice, stats]);
  const live = sqrtPrice ? priceFromSqrt(sqrtPrice) : null;
  const pts = useMemo(() => pointsOf(stats?.candles, live, heardAt), [stats, live, heardAt]);
  const path = useMemo(() => (width > 0 ? chartPath(pts, width, HEIGHT) : null), [pts, width]);
  const color = !path || path.change >= 0 ? C.up : C.down;
  const empty = missing ? "No chart for this coin" : stats ? "The chart starts with the first trades" : "Loading the chart";
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <T v="label">Chart</T>
        {path ? <T v="num" color={color}>{`${changeText(path.change)} · ${spanText(pts[0].t, heardAt)}`}</T> : null}
      </View>
      <View style={{ height: HEIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {path ? (
          <Svg width={width} height={HEIGHT}>
            <Defs>
              <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.25} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={path.area} fill="url(#chartFill)" />
            <Path d={path.line} stroke={color} strokeWidth={2} strokeLinejoin="round" fill="none" />
          </Svg>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <T v="small" color={C.text2}>{empty}</T>
          </View>
        )}
      </View>
      {stats?.source ? <T v="small" color={C.text2}>{`Candles from ${SOURCES[stats.source] ?? stats.source}`}</T> : null}
      {error ? <T v="small" color={C.down}>{error}</T> : null}
    </Card>
  );
}
```

In `mobile/src/launched/CoinRow.js`, 3 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
import { C, F } from "../ui/theme";
import { capText, priceText } from "./coin";

/** `row`: a `launched` row; `solUsd`: store.solUsd (0 until known). Until its pool is read
 *  (`pool` null) the right side says so instead of numbers. Once migrated, the numbers are
 *  the ones at migration (the DBC price stops there) and say so. A row with no coin draws
 *  nothing. */
export function CoinRow({ row, solUsd, onPress }) {
```

   with:

```js
import { C, F } from "../ui/theme";
import { atMigration, capText, priceText } from "./coin";

/** `row`: a `launched` row; `solUsd`: store.solUsd (0 until known). Until its pool is read
 *  (`pool` null) the right side says so instead of numbers. Once migrated, the numbers are
 *  the ones at migration (the DBC price stops there) and say so until the server has found
 *  the coin's DAMM v2 pool (`pool.damm`); from then on they're that pool's live price. A row
 *  with no coin draws nothing. */
export function CoinRow({ row, solUsd, onPress }) {
```

2. Replace:

```js
  const migrated = !!row.pool?.migrated;
  const cap = sqrt ? capText(sqrt, solUsd) : null;
  const label = `$${token.symbol}, ${cap ? `market cap ${cap}${migrated ? " at migration" : ""}` : "pool loading"}`;
  return (
```

   with:

```js
  const migrated = !!row.pool?.migrated;
  const old = atMigration(row.pool);
  const cap = sqrt ? capText(sqrt, solUsd) : null;
  const label = `$${token.symbol}, ${cap ? `market cap ${cap}${old ? " at migration" : ""}` : "pool loading"}`;
  return (
```

3. Replace:

```js
            <T v="small" style={{ fontFamily: F.mono }}>{priceText(sqrt)}</T>
            {migrated ? <T v="small" color={C.text2}>At migration</T> : null}
          </View>
```

   with:

```js
            <T v="small" style={{ fontFamily: F.mono }}>{priceText(sqrt)}</T>
            {old ? <T v="small" color={C.text2}>At migration</T> : null}
          </View>
```

Replace all of `mobile/app/coin/[key].js` with:

```js
// A launched coin: its chart, market cap, price, liquidity, volume, curve, holders and launch
// time, your position, its mint to copy, its links, and the seat this phone joined with.
// `key` is the coin's presale.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../../src/app";
import { PriceChart } from "../../src/launched/PriceChart";
import {
  atMigration, capText, coinScreenState, curveOf, dayTime, holderRows, holdersText, inWith, liquidityText, positionOf, priceText, volumeText,
} from "../../src/launched/coin";
import { CoinImage } from "../../src/ui/CoinImage";
import { FillBar } from "../../src/ui/FillBar";
import { shortWallet, solText } from "../../src/ui/format";
import { Card, Empty, PillButton, Screen, T } from "../../src/ui/kit";
import { LinkPills } from "../../src/ui/LinkPills";
import { TopBar } from "../../src/ui/TopBar";
import { C, S } from "../../src/ui/theme";

/** How long "Copied" shows after a copy. */
const COPIED_MS = 2_000;
/** Where back goes when the coin was opened from a link: the Launched tab. */
const LAUNCHED = "/(tabs)/launched";

export default function Coin() {
  const params = useLocalSearchParams();
  const key = Array.isArray(params.key) ? params.key[0] : params.key;
  const row = useStore(store, (s) => s.launched[key]);
  const view = useStore(store, (s) => s.views[key] ?? s.presales[key]);
  const detail = useStore(store, (s) => s.views[key]);
  const wallet = useStore(store, (s) => s.wallet);
  const mine = useStore(store, (s) => s.mine[key]);
  const solUsd = useStore(store, (s) => s.solUsd);
  const loaded = useStore(store, (s) => s.loaded.launched);
  const feedError = useStore(store, (s) => s.feedError.launched);
  const mint = row?.mint;
  const stats = useStore(store, (s) => (mint ? s.coins[mint] : undefined));
  const statsMissing = useStore(store, (s) => (mint ? !!s.coinMissing[mint] : false));
  const statsError = useStore(store, (s) => (mint ? s.coinError[mint] : undefined));
  const holding = useStore(store, (s) => (mint ? s.holdings[mint] : undefined));
  const shows = coinScreenState({ row, loaded, view });
  const token = row?.token;
  const youWereIn = inWith(detail, wallet, mine);
  const position = positionOf(holding, row?.pool?.sqrtPrice, solUsd);

  // the coin's stats and this wallet's balance of it, while this screen is open
  useEffect(() => (mint ? store.getState().watchCoin(mint) : undefined), [mint]);

  return (
    <Screen padded={false}>
      <TopBar title={token ? `$${token.symbol}` : ""} fallback={LAUNCHED} />
      {shows === "coin" ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: S.gutter, paddingBottom: 32, gap: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <CoinImage uri={token.image} size={72} ticker={token.symbol} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <T v="h2" numberOfLines={2}>{token.name}</T>
              <T v="num" color={C.text1}>{`$${token.symbol}`}</T>
            </View>
          </View>
          <PriceChart stats={stats} missing={statsMissing} error={statsError} sqrtPrice={row.pool?.sqrtPrice} />
          {position ? (
            <Card style={{ gap: 6 }}>
              <T v="label">{`Your $${token.symbol}`}</T>
              <T v="num">{position.tokens}</T>
              {position.sol ? <T v="small">{position.usd ? `${position.sol} · ${position.usd}` : position.sol}</T> : null}
            </Card>
          ) : null}
          <Stats row={row} stats={stats} statsDone={!!stats || statsMissing || !!statsError} solUsd={solUsd} />
          <Holders stats={stats} wallet={wallet} />
          <MintRow mint={row.mint} />
          <LinkPills token={token} />
          {token.description ? <T color={C.text1}>{token.description}</T> : null}
          {youWereIn != null ? (
            <Card>
              <T>{`You were in with ${solText(youWereIn)} SOL`}</T>
            </Card>
          ) : null}
        </ScrollView>
      ) : shows === "missing" ? (
        <Empty title="This coin isn't listed" />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {feedError ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{feedError}</T> : null}
        </View>
      )}
    </Screen>
  );
}

/** Market cap, price, liquidity, 24h volume, curve and launch time, two to a row. Until the
 *  pool is read the pool's figures say "Pool loading"; until the stats came (or the server
 *  said it has none), theirs say "Loading". A migrated coin's price is the one at
 *  migration (and says so) until the server has found its DAMM v2 pool; from then on it's
 *  that pool's live price. A figure no source has says "Not known yet". */
function Stats({ row, stats, statsDone, solUsd }) {
  const pool = row.pool;
  const sqrt = pool?.sqrtPrice;
  const curve = pool ? curveOf(pool) : null;
  const liquidity = liquidityText(pool, stats);
  const volume = volumeText(stats);
  const atMigrationNote = atMigration(pool) ? <T v="small" color={C.text2}>At migration</T> : null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Stat label="Market cap">
          {sqrt ? (
            <>
              <T v="num">{capText(sqrt, solUsd)}</T>
              {atMigrationNote}
            </>
          ) : (
            <PoolLoading />
          )}
        </Stat>
        <Stat label="Price">
          {sqrt ? (
            <>
              <T v="num">{priceText(sqrt)}</T>
              {atMigrationNote}
            </>
          ) : (
            <PoolLoading />
          )}
        </Stat>
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Stat label="Liquidity">{!pool ? <PoolLoading /> : liquidity == null && !statsDone ? <Loading /> : <Figure text={liquidity} />}</Stat>
        <Stat label="24h volume">{statsDone ? <Figure text={volume} /> : <Loading />}</Stat>
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Stat label="Curve">
          {curve ? (
            <>
              {pool.migrated ? <T v="small" color={C.migrated}>{curve.text}</T> : <T v="num">{curve.text}</T>}
              <FillBar fill={curve.fill} color={pool.migrated ? C.migrated : C.up} />
            </>
          ) : (
            <PoolLoading />
          )}
        </Stat>
        <Stat label="Launched">{row.launch ? <T v="num">{dayTime(row.launch.at)}</T> : null}</Stat>
      </View>
    </View>
  );
}

/** One figure in the grid: a small label over its value. */
function Stat({ label, children }) {
  return (
    <Card style={{ flex: 1, gap: 8 }}>
      <T v="label">{label}</T>
      {children}
    </Card>
  );
}

const PoolLoading = () => <T v="small" color={C.text2}>Pool loading</T>;
const Loading = () => <T v="small" color={C.text2}>Loading</T>;

/** A figure, or "Not known yet" when no source has it. */
const Figure = ({ text }) => (text != null ? <T v="num">{text}</T> : <T v="small" color={C.text2}>Not known yet</T>);

/** The top holders read from chain (the curve, the pool and the presale by name), each with
 *  their tokens and, when the server read the supply, their share; and the holder count once
 *  Meteora has one. Nothing while they're read; a line when the server couldn't read them. */
function Holders({ stats, wallet }) {
  if (!stats) return null;
  const rows = holderRows(stats.top, wallet, stats.supply);
  const count = holdersText(stats);
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <T v="label">Top holders</T>
        {count ? <T v="small">{`${count} holders`}</T> : null}
      </View>
      {rows == null ? (
        <T v="small" color={C.text2}>Couldn't read the holders right now</T>
      ) : rows.length === 0 ? (
        <T v="small" color={C.text2}>No holders yet</T>
      ) : (
        rows.map((h) => (
          <View key={h.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <T numberOfLines={1} style={{ flexShrink: 1 }} color={h.who === "You" ? C.accent : C.text0}>{h.who}</T>
            <T v="num">{h.share ? `${h.tokens} · ${h.share}` : h.tokens}</T>
          </View>
        ))
      )}
    </Card>
  );
}

/** The mint, short, and "Copy": then "Copied" for COPIED_MS, or an error buzz if the copy
 *  didn't take. */
function MintRow({ mint }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const copy = () => {
    Clipboard.setStringAsync(mint).then(
      () => {
        if (!alive.current) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
    );
  };

  return (
    <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ gap: 4 }}>
        <T v="label">Mint</T>
        <T v="num">{shortWallet(mint)}</T>
      </View>
      <PillButton
        title={copied ? "Copied" : "Copy"}
        accessibilityLabel={copied ? "Copied" : "Copy the mint"}
        color={copied ? C.up : C.text0}
        live
        onPress={copy}
      />
    </Card>
  );
}
```

- [ ] **Step 6: Bundle check**

Run: `cd mobile && sh scripts/check-bundle.sh`
Expected: `web3.js copies: 1; files from engine/node_modules: 0`

- [ ] **Step 7: Commit**

```bash
git add mobile/src/launched/chart.js mobile/test/chart.test.mjs mobile/src/launched/coin.js mobile/test/launched.test.mjs mobile/src/launched/PriceChart.js mobile/src/launched/CoinRow.js 'mobile/app/coin/[key].js' && git commit -m "mobile: the coin screen's chart, liquidity, volume, holders and your position

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Buy and Sell sheets

Sticky Buy and Sell buttons sit under the coin screen. Without a wallet the bar shows "Connect to trade". Each button opens a sheet (spec, "Trading"):

- **Buy:** chips for 0.1, 0.5 and 1 SOL, or a typed amount.
- **Sell:** 25%, 50% or 100% of what the wallet holds.
- **Both:** "You get about", the minimum after 3% slippage, the price impact (red from 5%), and the fee. The fee is "1% to the pool" with its SOL when Jupiter's route is the coin's own pool. On any other route it says the fee is in the price.

The quote comes once the amount sits still for 400 ms: one quote per amount picked, never on a timer. With no route, the sheet says so and shows "Try again". The Buy and Sell buttons stay locked with a countdown until `tradeOpensAt(row)`. A 1 s clock re-renders the countdown and reads no server.

A trade takes a fresh quote and signs once in Seed Vault. When it lands, the sheet closes, a line says what happened, and the position updates.

**Files:**
- Create: `mobile/test/trade.test.mjs`
- Create: `mobile/src/launched/trade.js`
- Create: `mobile/src/launched/TradeSheet.js`
- Modify: `mobile/app/coin/[key].js`

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/trade.test.mjs`:

```js
// What the Buy and Sell sheets say (src/launched/trade.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUY_CHIPS, parseSol, pctText, secondsTo, solSig, tokensText, tradeLines } from "../src/launched/trade.js";

const POOL = "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri";
// sqrt of 1 lamport per raw token (0.001 SOL per whole token)
const ONE = (1n << 64n).toString();

test("parseSol: typed SOL as lamports; nothing that isn't a positive amount", () => {
  assert.equal(parseSol("0.25"), 250_000_000n);
  assert.equal(parseSol("1"), 1_000_000_000n);
  assert.equal(parseSol(" 0,5 "), 500_000_000n);
  assert.equal(parseSol(".1"), 100_000_000n);
  assert.equal(parseSol("0.000000001"), 1n);
  for (const bad of ["", ".", "0", "0.0", "-1", "1e3", "abc", "0.0000000001", "1.2.3", null]) assert.equal(parseSol(bad), null, String(bad));
  assert.deepEqual(BUY_CHIPS.map(String), ["100000000", "500000000", "1000000000"]);
});

test("amounts: SOL to 3 significant digits, tokens compact", () => {
  assert.equal(solSig(9_880_000n), "0.00988");
  assert.equal(solSig(1_500_000_000n), "1.5");
  assert.equal(tokensText(348_894_380_365n), "349K");
  assert.equal(tokensText(1_250_000_000_000n), "1.25M");
  assert.equal(tokensText(500_000n), "0.5");
  assert.equal(pctText(0.0042), "0.42%");
  assert.equal(pctText(0.123), "12.3%");
  assert.equal(pctText(0), "0%");
  assert.equal(pctText(0.00001), "<0.01%");
});

test("tradeLines: a buy on the coin's own pool shows the 1% pool fee", () => {
  const q = { inAmount: 1_000_000_000n, outAmount: 891_000_000n, minOut: 864_270_000n, impact: 0, route: [{ amm: POOL }] };
  assert.deepEqual(tradeLines("buy", q, { pools: [POOL], sqrtPrice: ONE, symbol: "MOON" }), {
    get: "891 $MOON", minimum: "864 $MOON", impact: "10%", high: true, fee: "1% to the pool · 0.01 SOL", slippage: "3%",
  });
});

test("tradeLines: a sell through other pools says the fees are in the price", () => {
  const q = { inAmount: 1_000_000n, outAmount: 990_000n, minOut: 960_300n, impact: 0.0042, route: [{ amm: POOL }, { amm: "Other" }] };
  assert.deepEqual(tradeLines("sell", q, { pools: [POOL], sqrtPrice: null, symbol: "MOON" }), {
    get: "0.00099 SOL", minimum: "0.00096 SOL", impact: "0.42%", high: false, fee: "In the price (Jupiter's route)", slippage: "3%",
  });
});

test("secondsTo: the lock's countdown", () => {
  assert.equal(secondsTo(10_000, 6_500), 4);
  assert.equal(secondsTo(10_000, 9_999), 1);
  assert.equal(secondsTo(10_000, 10_000), 0);
  assert.equal(secondsTo(null, 5), 0);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd mobile && npm test`
Expected: 137 pass, 1 fail: `trade.test.mjs` stops at `ERR_MODULE_NOT_FOUND` (`src/launched/trade.js`)

- [ ] **Step 3: What the sheets say**

Create `mobile/src/launched/trade.js`:

```js
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
 * are in the price. `sqrtPrice`: the pool's live price, for the impact.
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
```

- [ ] **Step 4: Run the tests**

Run: `cd mobile && npm test`
Expected: 142 pass, 0 fail

- [ ] **Step 5: The sheets and the bar**

Create `mobile/src/launched/TradeSheet.js`:

```js
// The Buy and Sell sheets: pick an amount, see what you get, the price impact, the fee and
// the slippage, then sign once in the wallet. Jupiter routes the trade through the coin's
// Meteora pool.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { sellAmount } from "../../../engine/src/swap.js";
import { store } from "../app";
import { Button, PillButton, Sheet, Steps, T } from "../ui/kit";
import { C, F, R } from "../ui/theme";
import { useNow } from "../ui/useNow";
import { BUY_CHIPS, parseSol, secondsTo, SELL_PCTS, solSig, tokensText, tradeLines } from "./trade";

/** How long the amount must sit still before the sheet asks Jupiter for a price. */
const QUOTE_AFTER_MS = 400;

/** One sheet per side, both kept mounted (as the join sheet is), so a trade that fails after
 *  its sheet was closed still says why when it opens again. `side`: "buy" | "sell"; `row`:
 *  the launched row; `holding`: the wallet's balance of the
 *  coin ({ raw, decimals, ui } or undefined while it's read); `lamports`: the wallet's SOL;
 *  `opensAt`: when trading opens (ms, views.js tradeOpensAt); `onDone(text)`: a trade landed. */
export function TradeSheet({ open, side, onClose, onDone, row, holding, lamports, signer, opensAt }) {
  const busy = useStore(store, (s) => s.busy);
  const [chip, setChip] = useState(side === "buy" ? BUY_CHIPS[0] : SELL_PCTS[0]);
  const [typed, setTyped] = useState("");
  const [priced, setPriced] = useState(null); // { amount, ok, value | error, noRoute }
  const [error, setError] = useState(null);
  const asked = useRef(0);
  const mint = row.mint;
  const symbol = row.token?.symbol ?? "";
  const buying = side === "buy";

  const amount = useMemo(() => {
    if (buying) return typed ? parseSol(typed) : chip;
    return holding?.raw > 0n ? sellAmount(holding.raw, chip) : null;
  }, [buying, typed, chip, holding]);

  // A price once the amount sits still: one ask per amount the user picks, never on a timer.
  const ask = (a) => {
    const n = ++asked.current;
    setPriced(null);
    if (a == null) return;
    store.getState().preview(side, mint, a).then((r) => n === asked.current && setPriced({ amount: a, ...r }));
  };
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => ask(amount), QUOTE_AFTER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, amount]);

  // Locked until the snipe tax is over: a 1 s clock re-renders the countdown meanwhile (it
  // reads no server); the seconds come from the clock now, so an unrelated render can't
  // leave a stale count behind.
  const locked = opensAt != null && Date.now() < opensAt;
  useNow(1000, open && locked);
  const secs = locked ? secondsTo(opensAt, Date.now()) : 0;
  const trading = busy?.key === mint && busy.kind === side;
  const q = priced?.ok && priced.amount === amount ? priced.value : null;
  const pools = [row.pool?.address, row.pool?.damm].filter(Boolean);
  const lines = q ? tradeLines(side, q, { pools, sqrtPrice: row.pool?.sqrtPrice ?? null, symbol }) : null;
  const short = buying && amount != null && lamports != null && amount > BigInt(lamports) ? `Your wallet has ${solSig(lamports)} SOL.` : null;
  const none = !buying && holding && holding.raw <= 0n ? `You don't hold any $${symbol}.` : null;
  const why = secs > 0 ? `Trading opens in ${secs} s, after the launch's snipe tax.` : short ?? none;

  const close = () => {
    setError(null);
    if (!trading) {
      setTyped("");
      setChip(buying ? BUY_CHIPS[0] : SELL_PCTS[0]);
    }
    onClose();
  };

  async function go() {
    if (store.getState().busy || amount == null || !signer) return;
    setError(null);
    const r = await store.getState().trade(side, mint, amount, signer);
    Haptics.notificationAsync(r.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
    if (!r.ok) return setError(r.error);
    const got = r.value.quote.outAmount;
    onDone?.(buying ? `Bought about ${tokensText(got)} $${symbol}` : `Sold for about ${solSig(got)} SOL`);
    close();
  }

  const title = buying ? (amount != null ? `Buy · ${solSig(amount)} SOL` : "Buy") : `Sell ${chip}%`;
  return (
    <Sheet open={open} onClose={close} title={`${buying ? "Buy" : "Sell"} $${symbol}`}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {(buying ? BUY_CHIPS : SELL_PCTS).map((c) => (
            <Chip
              key={String(c)}
              text={buying ? `${solSig(c)} SOL` : `${c}%`}
              on={c === chip && !typed}
              disabled={trading}
              onPress={() => {
                setTyped("");
                setChip(c);
              }}
            />
          ))}
        </View>
        {buying ? (
          <TextInput
            value={typed}
            onChangeText={setTyped}
            editable={!trading}
            keyboardType="decimal-pad"
            placeholder="Or type SOL"
            placeholderTextColor={C.text2}
            accessibilityLabel="SOL to spend"
            style={{
              height: 44, paddingHorizontal: 16, borderRadius: R.pill, backgroundColor: C.well,
              borderWidth: 1, borderColor: C.wellLine, color: C.text0, fontFamily: F.mono, fontSize: 15,
            }}
          />
        ) : (
          <Line label="You hold" value={holding ? `${tokensText(holding.raw)} $${symbol}` : "Reading…"} />
        )}
        {typed && amount == null ? <T v="small" color={C.down}>Type an amount of SOL, like 0.25.</T> : null}
        <View style={{ gap: 8 }}>
          <Line label="You get about" value={lines?.get ?? (priced?.ok === false ? "–" : "…")} />
          <Line label="At least (slippage)" value={lines ? `${lines.minimum} · ${lines.slippage}` : "…"} />
          <Line label="Price impact" value={lines?.impact ?? "…"} color={lines?.high ? C.down : undefined} />
          <Line label="Fee" value={lines?.fee ?? "…"} />
          <T v="small" color={C.text2}>
            {buying ? "Plus Solana's network fee, and on a first buy the rent of your token account for this coin." : "Plus Solana's network fee."}
          </T>
        </View>
        {priced?.ok === false && priced.amount === amount ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <T v="small" color={C.down} style={{ flex: 1 }}>{priced.error}</T>
            <PillButton title="Try again" onPress={() => ask(amount)} />
          </View>
        ) : null}
        {why ? <T v="small" color={secs > 0 ? C.warn : C.down}>{why}</T> : null}
        {error ? <T v="small" color={C.down}>{error}</T> : null}
        {trading ? <Steps step={busy.step} /> : null}
        <Button
          title={title}
          kind={buying ? "primary" : "quiet"}
          onPress={go}
          busy={trading}
          disabled={amount == null || !signer || !q || !!why || (!!busy && !trading)}
        />
      </View>
    </Sheet>
  );
}

/** A label on the left, its value on the right. */
function Line({ label, value, color }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <T v="small">{label}</T>
      <T v="num" color={color} style={{ flexShrink: 1, textAlign: "right" }}>{value}</T>
    </View>
  );
}

/** An oval amount chip, as in the join sheet. */
function Chip({ text, on, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        {
          flex: 1, height: 44, borderRadius: R.pill, borderWidth: 1, alignItems: "center", justifyContent: "center",
          backgroundColor: on ? C.accentSoft : C.bg2, borderColor: on ? C.accent : C.lineStrong,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <T style={{ fontFamily: F.semi, fontSize: 15 }}>{text}</T>
    </Pressable>
  );
}
```

In `mobile/app/coin/[key].js`, 5 replacements, in order (each block below occurs once in the file at that point):

1. Replace:

```js
// A launched coin: its chart, market cap, price, liquidity, volume, curve, holders and launch
// time, your position, its mint to copy, its links, and the seat this phone joined with.
// `key` is the coin's presale.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../../src/app";
```

   with:

```js
// A launched coin: its chart, market cap, price, liquidity, volume, curve, holders and launch
// time, your position, its mint to copy, its links, the seat this phone joined with, and
// sticky Buy and Sell buttons. `key` is the coin's presale.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { tradeOpensAt } from "../../../engine/src/views.js";
import { store } from "../../src/app";
```

2. Replace:

```js
} from "../../src/launched/coin";
import { CoinImage } from "../../src/ui/CoinImage";
import { FillBar } from "../../src/ui/FillBar";
import { shortWallet, solText } from "../../src/ui/format";
import { Card, Empty, PillButton, Screen, T } from "../../src/ui/kit";
import { LinkPills } from "../../src/ui/LinkPills";
import { TopBar } from "../../src/ui/TopBar";
import { C, S } from "../../src/ui/theme";

```

   with:

```js
} from "../../src/launched/coin";
import { TradeSheet } from "../../src/launched/TradeSheet";
import { CoinImage } from "../../src/ui/CoinImage";
import { FillBar } from "../../src/ui/FillBar";
import { shortWallet, solText } from "../../src/ui/format";
import { Button, Card, Empty, PillButton, Screen, T } from "../../src/ui/kit";
import { LinkPills } from "../../src/ui/LinkPills";
import { TopBar } from "../../src/ui/TopBar";
import { C, S } from "../../src/ui/theme";
import { useSigner } from "../../src/wallet";

```

3. Replace:

```js
  const holding = useStore(store, (s) => (mint ? s.holdings[mint] : undefined));
  const shows = coinScreenState({ row, loaded, view });
```

   with:

```js
  const holding = useStore(store, (s) => (mint ? s.holdings[mint] : undefined));
  const lamports = useStore(store, (s) => s.lamports);
  const signer = useSigner();
  const [sheet, setSheet] = useState(null); // "buy" | "sell" | null
  const [done, setDone] = useState(null); // what the last trade here did
  const shows = coinScreenState({ row, loaded, view });
```

4. Replace:

```js
          <PriceChart stats={stats} missing={statsMissing} error={statsError} sqrtPrice={row.pool?.sqrtPrice} />
          {position ? (
```

   with:

```js
          <PriceChart stats={stats} missing={statsMissing} error={statsError} sqrtPrice={row.pool?.sqrtPrice} />
          {done ? (
            <Card>
              <T color={C.up}>{done}</T>
            </Card>
          ) : null}
          {position ? (
```

5. Replace:

```js
      )}
    </Screen>
  );
```

   with:

```js
      )}
      {shows === "coin" ? (
        <TradeBar
          row={row}
          signer={signer}
          sheet={sheet}
          setSheet={setSheet}
          onDone={setDone}
          holding={holding}
          lamports={lamports}
        />
      ) : null}
    </Screen>
  );
}

/** The sticky Buy and Sell buttons and their sheets; "Connect to trade" without a wallet. */
function TradeBar({ row, signer, sheet, setSheet, onDone, holding, lamports }) {
  const insets = useSafeAreaInsets();
  const opensAt = tradeOpensAt(row);
  const sheets = { row, holding, lamports, signer, opensAt, onDone, onClose: () => setSheet(null) };
  return (
    <View
      style={{
        flexDirection: "row", gap: 12, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg0,
        paddingHorizontal: S.gutter, paddingTop: 12, paddingBottom: insets.bottom + 12,
      }}
    >
      {signer ? (
        <>
          <View style={{ flex: 1 }}>
            <Button title="Buy" onPress={() => setSheet("buy")} disabled={!row.pool} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Sell" kind="quiet" onPress={() => setSheet("sell")} disabled={!row.pool} />
          </View>
          <TradeSheet side="buy" open={sheet === "buy"} {...sheets} />
          <TradeSheet side="sell" open={sheet === "sell"} {...sheets} />
        </>
      ) : (
        <Button title="Connect to trade" onPress={() => router.push("/connect")} />
      )}
    </View>
  );
```

- [ ] **Step 6: Bundle check**

Run: `cd mobile && sh scripts/check-bundle.sh`
Expected: `web3.js copies: 1; files from engine/node_modules: 0`

- [ ] **Step 7: Commit**

```bash
git add mobile/src/launched/trade.js mobile/test/trade.test.mjs mobile/src/launched/TradeSheet.js 'mobile/app/coin/[key].js' && git commit -m "mobile: Buy and Sell sheets on the coin screen, locked through the snipe tax

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Device pass and hand-off

What this task proves, what only the user does, and what waits for the first mainnet launch. The agent never deploys, never presses Buy or Sell inside a sheet, and never approves anything in Seed Vault. The reads below (`curl` to the app's API and to the public RPC) send nothing and sign nothing.

- [ ] **Step 1: Every suite, the web build, the type-check and the bundle check**

Run: `cd engine && npm test`
Expected: 306 pass, 0 fail

Run: `cd mobile && npm test`
Expected: 142 pass, 0 fail

Run: `cd web && npm run build`
Expected: exit 0

Run: `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep -c 'error TS'`
Expected: 55

Run: `cd mobile && sh scripts/check-bundle.sh`
Expected: `web3.js copies: 1; files from engine/node_modules: 0`

- [ ] **Step 2 (the user deploys): the server's new parts are live**

The phone's coin screen needs the server from Tasks 2-4. Ask the user to deploy it. The agent doesn't run this:

```bash
sh deploy/railway.sh app
```

After the user says it's deployed:

Run: `curl -s https://app.mooner.family/api/health`
Expected: the `live` object has `damm` and `coins` (both numbers)

Run: `curl -s https://app.mooner.family/api/launched`
Expected: a JSON object with `launched`. On 2026-10-01 it was `{"launched":[]}`. While it's empty, no coin screen can be seen on mainnet. Steps 3-5 wait for the first launch, so tell the user that and stop here until a coin is listed.

- [ ] **Step 3: The coin screen on the Seeker**

Run: `cd mobile && sh scripts/run-android.sh`

On the phone, take a screenshot of each of these and send them to the user:
- **Launched:** the coin in the list.
- **The coin screen:**
  - the chart, with its source line;
  - price and market cap;
  - liquidity, 24h volume and holders;
  - your position (with a wallet connected).
- **The Buy sheet** with the 0.1 SOL chip picked. Wait for "You get about", the minimum, the impact and the fee to fill in.
- **The Sell sheet** with 25% picked. This only works if the wallet holds the coin; otherwise screenshot the sheet's "You don't hold any $…" line.

Close each sheet with Android's back gesture or a tap on the dimmed backdrop. **Never press the Buy or Sell button inside a sheet**: that asks Seed Vault to sign a real trade.

Write down for the user what each screenshot shows:
- **Did Jupiter route the coin?** "No route for this trade yet. Try again in a moment." means no. This answers the spec's open question about a new DBC pool (spec line 288).
- **Which source the chart names?** "Candles from GeckoTerminal" means it indexed the pool. "Candles from Mooner's server" means GeckoTerminal didn't have it yet, so the server's own candles are shown.
- **Which figures say "Not known yet" or "Couldn't read…"?** This shows which sources failed or which public RPC calls were rate-limited.

- [ ] **Step 4: The coin's supply against the 1B the market cap assumes**

The market cap is price × 1B × SOL/USD (spec lines 88 and 267; `marketCapSol` in `engine/src/views.js`). The trial coin `GS2x…` had a supply of 1,196,140,480.63 on 2026-10-01, which is not 1B. Read the first launched coin's supply from the public RPC (`<mint>` is the row's `mint` from Step 2):

Run: `curl -s https://api.mainnet-beta.solana.com -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getTokenSupply","params":["<mint>"]}'`
Expected: `result.value.uiAmount`. Tell the user the number.
- If it is 1,000,000,000, the market cap is right.
- If it isn't, every market cap the phone and the website show is off by that ratio. Report it to the user; don't change the formula in this plan.

The holder shares on the coin screen already use the real supply (`stats.supply`, Task 4).

- [ ] **Step 5 (the user trades): the first real Buy and Sell**

Ask the user to make one small trade each way on the phone:
1. Buy with the 0.1 SOL chip and approve in Seed Vault.
2. After it lands, Sell 100% and approve.

The agent watches the screen and doesn't touch the sheet. Then check each trade on chain, using the wallet address from the Me screen:

Run: `curl -s https://api.mainnet-beta.solana.com -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["<wallet>",{"limit":5}]}'`
Expected: the two newest signatures are the Sell and the Buy

Run (for each of the two): `curl -s https://api.mainnet-beta.solana.com -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":["<signature>",{"encoding":"json","maxSupportedTransactionVersion":0}]}'`
Expected:
- `result.meta.err` is null;
- `result.transaction.message.accountKeys[0]` (the fee payer) is the wallet;
- the wallet is the tx's only signer (`header.numRequiredSignatures` is 1);
- the instructions include Jupiter's program `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`.

On the phone, check:
- after each trade the sheet closed and the result line said what happened;
- "Your position" changed without leaving the screen: after the Buy it shows the coins, after the Sell none.

Also tell the user:
- whether Seed Vault's approval screen showed anything unexpected for a Jupiter v0 tx with address lookup tables. Seed Vault adds a Lighthouse instruction; whether that still fits a Jupiter tx was untested before this step;
- what fee the tx paid (`result.meta.fee`).

If Seed Vault refuses or the tx fails, collect the phone's log and bring it to the user before changing code:

```bash
adb logcat -d -s ReactNativeJS | tail -50
```

- [ ] **Step 6: Whole-piece code review**

Run superpowers:code-reviewer over the commits of Tasks 1-7. Fix the Critical and Important findings, rerun Step 1, and commit the fixes. Stage files by name.

- [ ] **Step 7: The spec's piece status**

In `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md`, under the "Pieces" table, add a status line for piece 2. It says:
- built, with the date;
- what the device proved (Steps 3-5);
- what is still open: routing on the first launch if no coin was listed, GeckoTerminal indexing, and the supply against 1B.

```bash
git add docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md && git commit -m "spec: piece 2 status after the device pass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage (piece 2, spec line 110):**

*Server additions → "Migration and the price after it" (lines 217-220):*
- The migrated event → Task 2.
- The flag tested against a migrated mainnet DBC pool → Task 2 (`5Dekcwc2…` fixture).
- The DAMM v2 pool found, subscribed and decoded, and tested against a mainnet account → Task 3 (`GwvAt96o…` fixture; the PDA derivation reproduces that address).

*Trading (lines 281-296):*
- Jupiter through `market.ts` moved into shared code → Task 1 (`swap.js`; `market.ts` becomes an adapter with the same exports, so the website's behavior is unchanged except that errors are in words).
- The wallet as the only signer, checked before the wallet sees the tx → Task 1 (`onlyWalletSigns`), used in Task 5.
- The balance updating over `wallet:` → Task 5.
- No route → Task 1 (`NO_ROUTE_TEXT`) and Task 7 ("Try again").
- The snipe-tax lock with a countdown → Task 1 (`tradeOpensAt`) and Task 7.

*Coin info (lines 297-311):*
- Price and market cap from the DBC pool, then the DAMM v2 pool → Task 3. The phone's existing `priceFromSqrt` / `marketCapSol` read `pool.sqrtPrice` unchanged.
- Progress, then "Migrated to Meteora DAMM v2" → Task 6 (`coin.js` already had the text; `atMigration` hides "At migration" once the DAMM v2 price is live).
- The chart, liquidity, holders and 24h volume from the right source before and after → Task 4 (server) and Task 6 (screen).
- Your position → Tasks 5 and 6.
- Meteora calls only from the server, at most once a minute, only while someone has the coin open → Task 4 (`statsMs`, `onFirst` / `onLast`, reads only after a pool change).
- GeckoTerminal's risk → Task 4: the server's own candles.

*The coin screen's sheets (lines 191-193):*
- Chips 0.1 / 0.5 / 1, a typed amount, and 25 / 50 / 100% → Task 7.
- What you get, the price impact, the fee and the 3% slippage → Task 7.
- Haptics when it lands → Task 7 (`TradeSheet.js`).

**Not in this plan:**
- The small chart on each Launched row (spec line 190). Candles are read per open coin (at most 4 `coin:` topics per socket). A chart on every row needs a different feed: one candle series for every launched coin, pushed on `launched`. It's left for a later plan.
- "Share" on the coin screen (spec line 192) belongs with piece 3's share links.

**Names used across tasks** (check these match when executing):
- `swap.js`:
  - constants: `JUP`, `JUP_PROGRAM`, `JUP_SLIPPAGE`, `WSOL`, `SLIPPAGE_BPS`, `NO_ROUTE`, `NO_ROUTE_TEXT`, `POOL_FEE_BPS`;
  - functions: `quote`, `buyQuote`, `sellQuote`, `buildSwap`, `onlyWalletSigns`, `swap`, `explainSwap`, `tokenBalance`, `poolFee`, `impactOf`, `sellAmount`.
- `market.js`: `geckoCandles`, `geckoStats`, `meteoraCandles`, `meteoraPool`.
- `damm.js`: `DAMM_V2`, `MIGRATION_CONFIGS`, `dammPoolAddress`, `dammPoolAuthority`, `findDammPool`.
- `views.js`: `SNIPE_S`, `TAX_MARGIN_S`, `tradeOpensAt`.
- `tx.js`: `sendSigned(..., { preflight })`.
- `coinstats.js`: `coinStats`, `topHolders`, `supplyOf`, `CHART_MS`, `TOP_HOLDERS`.
- `feed.js`:
  - events and topics: `"migrated"`, `coin:<mint>`;
  - methods: `dammOf`, `readPools`, `status().damm` / `.coins`;
  - options: `statsMs`, `dammTries`.
- `store.js` (server): `addPrice`, `candles`.
- Phone:
  - `makeMarket({ conn, priority })`;
  - store actions `watchCoin`, `preview`, `trade`;
  - the components `PriceChart` and `TradeSheet`.

**File names:** the chart component is `PriceChart.js` because `Chart.js` and `chart.js` are one file on macOS. No other file name in this plan differs from another only by case.

**Live data:** every new figure is pushed:
- `launched` carries the DAMM v2 price;
- `coin:<mint>` carries the stats, re-read only after a pool change;
- `wallet:` triggers the holding read.

The only timers are:
- the feed's bounded re-reads after an event (a DAMM v2 pool that lands after the flag: at most `dammTries`);
- the snapshot retry (3 tries);
- the sheet's 400 ms pause before quoting a changed amount;
- the lock's 1 s countdown clock, which reads no server.

None of them re-reads data on a timer.

**Unknowns, and how the plan handles each:**
- **Whether Jupiter routes a fresh DBC pool, and how soon.** The no-route text and "Try again" (Task 7); checked in Task 8 Step 3.
- **Whether GeckoTerminal indexes a fresh pool.** The server's own candles (Task 4); the chart names its source.
- **Public RPC rate limits** on `getTokenLargestAccounts` / `getTokenSupply`. Whether the deployed server has a private `MOONER_RPC` is not known from the repo. A failed read leaves `top` / `supply` null, and the screen says "Couldn't read the holders right now" or "Not known yet".
- **The coin's real supply against 1B.** Checked in Task 8 Step 4. Holder shares use the real supply; the market cap keeps the spec's 1B.
- **Seed Vault signing a Jupiter v0 tx with lookup tables, plus its Lighthouse instruction.** Untested until the user's first trade (Task 8 Step 5). `onlyWalletSigns` runs again on what Seed Vault returns.
- **A slippage failure surfacing as a DBC program error** instead of Jupiter's 6001. `explainSwap` names Jupiter's code. Any other program error goes through `flows.explain`'s existing words.
- **The phone's clock against the server's `launch.at`.** The lock could open early or late by the skew. The snipe tax still applies on chain, and the 1 s margin covers small skew.
- **The deployed DBC config's migration fee option.** `j7j5…` (`consts.js` `MOONER_DBC_CONFIG`) wasn't read from chain for its `migrationFeeOption`; the code that made it passes 2 (`dbc.js` `moonerConfigParams`). `findDammPool` tries all seven migration configs in one read, so it finds the pool whichever option the config has. The 1% fee shown on a DAMM v2 route would be wrong if the option isn't 2. The first migrated coin's pool address shows which config it used.
- **The DAMM v2 pool's fee mode (`collect_fee_mode`)** isn't read. The pool fee shown after migration is the same 1% (`migrationFeeOption: 2`) and is shown only when Jupiter's route is that pool.
- **First-buy rent for the coin's Token-2022 account.** The exact amount isn't computed. The Buy sheet says a first buy also pays the rent of the coin's token account, without a number.
- **The `wallet:` topic fires only on SOL changes.** A token transfer-in with no SOL movement shows on the next open of the screen.
- **A migration during server downtime fires no event.** `readPools` at start records the flag, and `findDammPool` still finds the pool. Tested in Task 3.
- **The website's chart after migration** still reads the DBC pool's GeckoTerminal candles. The spec says the website is unchanged, so it stays out of this plan.
- **The `coin:` live test waits on real timers.** Task 4 runs it three times.
- **No launched coin on mainnet yet** (2026-10-01). The device steps wait for the first launch.

**Spec points that are wrong or risky:**
- **Lines 88 and 267:** "Supply is 1B per coin". The trial coin's supply was 1,196,140,480.63, so a market cap of price × 1B may be wrong. Task 8 Step 4 checks the first real coin.
- **Lines 285 and 316:** "The wallet signs and sends the swap."
  - Seed Vault's own answer (line 341) lists only `solana:signTransactions` as a feature, though it also reports `supports_sign_and_send_transactions: true`.
  - Line 344 shows it rewrites the compute-unit price and adds an instruction.
  - The plan has the phone sign with `signTransaction` and send itself, with a preflight (`sendSigned(..., { preflight: true })`). That works whether or not sign-and-send does.
- **Line 192:** "share" on the coin screen has no piece. It reads as piece 3.
