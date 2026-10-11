#!/usr/bin/env node
// A demo server for screen recordings: the live server's feeds (REST and the /api/ws socket,
// same shapes as server/api.js and server/feed.js) filled with real Solana memes from
// DexScreener, shown as Mooner pools: some filling, some live on their curve, some migrated.
// Their names, pictures and prices are real (DexScreener), and so are their charts
// (GeckoTerminal, by their real pool); the pools, seats, wallets, chat and XP are made up.
// Nothing is signed or sent: everything else (/api/rpc, /pfp.html, ...) goes to the live
// server as is, so a join or a trade in the web demo is a real one.
//
// The phone app's demo build (mobile/src/demo.js, EXPO_PUBLIC_DEMO=1) sends its joins, new
// coins and pools, and trades here instead (/demo/join, /demo/mint, /demo/open, /demo/trade):
// they are kept with each wallet's SOL and coins, and pushed as the live server would. Sign-in,
// chat, the Genesis check and Link X are answered here too, for any wallet.
//
//   node scripts/demo-server.js                         serves on :8790
//   curl -X POST localhost:8790/demo/launch/WALTER      fills that pool, launches it
//   curl -X POST localhost:8790/demo/reset              every pool back as it started
//
// The web app: MOONER_API=http://127.0.0.1:8790 npx vite (web/). The phone app:
// EXPO_PUBLIC_MOONER_SERVER=http://127.0.0.1:8790 npx expo start --web (mobile/), or the demo
// build on an emulator with EXPO_PUBLIC_MOONER_SERVER=http://10.0.2.2:8790.

import http from "node:http";
import crypto from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { WebSocketServer } from "ws";
import { geckoCandles, geckoStats } from "../src/market.js";
import { presalePda } from "../src/pdas.js";

const PORT = Number(process.env.DEMO_PORT ?? 8790);
const UPSTREAM = process.env.DEMO_UPSTREAM ?? "https://app.mooner.family";
const SOL = 1_000_000_000;
const TARGET = 10 * SOL; // the real pool size the designs use (memory: 10 SOL, seats 0.1 to 1)
const VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";
const MIN = 60_000;
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

/** The coins, by mint, and what each one is in the demo. `sol`: SOL in a filling pool, or in
 *  a live coin's curve (of 80). `age`: minutes since it opened, or since it launched. */
const COINS = [
  { mint: "9ziUEJYHRCtD4Chn2svkGeS5ahdhNeoTiqzeRpMWpump", role: "filling", sol: 8.4, age: 41, cue: true }, // WALTER: filled by /demo/launch only
  { mint: "BqDXLs6YSikUJ9t3WKtNUNismTVgTjNJVBpdgXuspump", role: "filling", sol: 6.1, age: 23 }, // CHAVA
  { mint: "2T6Wg3urxPQHaoGh4gqNHyYL6FAfyWA5BaH6Lo37pump", role: "filling", sol: 3.3, age: 12 }, // MINER
  { mint: "8A9Eh2jcu84igP9H8g448FxMuKd8JF5iVmrP7ARVpump", role: "filling", sol: 1.2, age: 4 }, // BOTS
  { mint: "BQAeeSowpwEx8Km8GcporcbuLKq4a7EQceH3F2qZpump", role: "live", sol: 71.4, age: 540 }, // qOMPUTE
  { mint: "HMYd9tosnUXuNHmq7pXmoePRVBLBBjA3JBfydq6upump", role: "live", sol: 52.8, age: 190 }, // SI276
  { mint: "CB4f3tTUckrtSJxfyCvsURLYhedkdkKPCm1mewbVpump", role: "live", sol: 33.6, age: 95 }, // Samur•ai
  { mint: "48HimqX34gdcKQeMJdqgW4etPyDo3xCcdHNXMDnCpump", role: "live", sol: 18.2, age: 38 }, // HI
  { mint: "8DXqVUopcdviLvujTcpwEqkKzB43Arp6E1axzsEE5Btq", role: "migrated", age: 2_900 }, // moin
  { mint: "DdcLYo8T6gniuLjYPsAHqASC1ViTaMyPwKEVWFqYpump", role: "migrated", age: 1_100 }, // MogCat
];

// ---- made-up but steady: the same wallets, pictures and keys at every start ----

const seed = (s) => crypto.createHash("sha256").update(`mooner-demo:${s}`).digest();
const keyOf = (s) => Keypair.fromSeed(seed(s)).publicKey.toBase58();
function rng(s) {
  let a = seed(s).readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sigOf = (s) => Array.from(crypto.createHash("sha512").update(`sig:${s}`).digest().subarray(0, 64), (b) => B58[b % 58]).join("").slice(0, 87);

const WALLETS = Array.from({ length: 90 }, (_, i) => keyOf(`wallet:${i}`));
const TRAITS = {
  skin: ["moon", "lilac", "mint", "peach", "sky", "lemon", "coral", "rose", "lime", "cocoa", "teal", "clay", "ink", "holo", "jelly", "gold", "chrome"],
  eyes: ["star", "ice", "wink", "sleepy", "wide", "happy", "angry", "money", "spiral", "pink", "heart", "cosmic", "laser"],
  mouth: ["tongue", "smile", "grin", "smirk", "open", "bubblegum", "fangs"],
  head: ["none", "none", "beanie", "party", "cap", "headphones", "horns", "halo", "crown"],
  face: ["none", "none", "shades", "retro", "hearts", "monocle", "visor"],
  outfit: ["none", "tee", "turtleneck", "hoodie", "tux"],
  neck: ["none", "scarf", "bowtie", "chain", "bandana"],
  aura: ["none", "none", "glow", "sparkles", "ring"],
  bg: ["midnight", "space", "dusk", "ocean", "sunset", "forest", "ember", "candy", "aurora", "neon", "galaxy"],
};
const PROFILES = Object.fromEntries(
  WALLETS.map((w) => {
    const r = rng(`pfp:${w}`);
    return [w, Object.fromEntries(Object.entries(TRAITS).map(([slot, list]) => [slot, pick(r, list)]))];
  }),
);

const DAY = new Date().toISOString().slice(0, 10);
/** The board: most wallets have some XP, a few a lot. */
const XP = WALLETS.slice(0, 72).map((wallet, i) => {
  const r = rng(`xp:${wallet}`);
  const big = Math.max(0.15, 1 - i / 72);
  const titles = {
    dev: Math.round(r() * 3 * big) * 100 * (r() < 0.35 ? 1 : 0),
    kol: Math.round(r() * 30 * big) * 25,
    raider: Math.round(r() * 50 * big) * 25,
    diamond: Math.round(r() * 8 * big) * 100 * (r() < 0.6 ? 1 : 0),
  };
  const total = Object.values(titles).reduce((a, b) => a + b, 0);
  const counts = {
    devLaunch: Math.floor(titles.dev / 300), devMigrate: Math.floor(titles.dev / 300),
    kolLaunch: Math.floor(titles.kol / 75), kolMigrate: Math.floor(titles.kol / 75),
    raiderJoin: titles.raider / 25, diamondMigrate: titles.diamond / 100,
  };
  const days = Math.floor(r() * 9 * big);
  return { wallet, total, titles, counts, streak: { days, best: days + Math.floor(r() * 4), last: days ? DAY : null }, genesis: null };
});
const freshXp = (w) => ({ wallet: w, total: 0, titles: { dev: 0, kol: 0, raider: 0, diamond: 0 }, counts: {}, streak: { days: 0, best: 0, last: null }, genesis: null });
const xpOf = (w) => XP.find((x) => x.wallet === w) ?? freshXp(w);

// ---- the coins, from DexScreener ----

/** Each coin's best SOL pool on DexScreener: { name, symbol, image, pair, priceSol, liqUsd,
 *  links }, and SOL/USD from the same answer. */
async function readCoins() {
  const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${COINS.map((c) => c.mint).join(",")}`);
  if (!r.ok) throw new Error(`DexScreener said ${r.status}`);
  const pairs = (await r.json()).filter((p) => p.quoteToken?.symbol === "SOL");
  const out = {};
  let solUsd = null;
  for (const c of COINS) {
    const best = pairs.filter((p) => p.baseToken.address === c.mint).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!best) throw new Error(`no SOL pool on DexScreener for ${c.mint}`);
    const info = best.info ?? {};
    const social = (t) => info.socials?.find((s) => s.type === t)?.url ?? "";
    out[c.mint] = {
      name: best.baseToken.name,
      symbol: best.baseToken.symbol,
      image: info.imageUrl ?? "",
      pair: best.pairAddress,
      priceSol: Number(best.priceNative),
      liqUsd: best.liquidity?.usd ?? null,
      links: { twitter: social("twitter"), telegram: social("telegram"), website: info.websites?.[0]?.url ?? "" },
    };
    solUsd ??= Number(best.priceUsd) / Number(best.priceNative);
  }
  return { coins: out, solUsd };
}

/** The pool's Q64.64 sqrt price (of lamports per raw token, 6 decimals) at `priceSol` per
 *  whole token: views.js priceFromSqrt, the other way. */
const sqrtOf = (priceSol) => BigInt(Math.round(Math.sqrt((priceSol * 1e9) / 1e6) * 2 ** 32)) * 2n ** 32n;

// ---- the world ----

const world = { presales: new Map(), seats: new Map(), launched: new Map(), chat: new Map(), sol: null, dex: null, users: new Map(), made: new Map() };
let chatId = 1;

function tokenOf(c, presale, openedAt) {
  const d = world.dex[c.mint];
  return {
    mint: c.mint, creator: c.creator, name: d.name, symbol: d.symbol, description: "", links: d.links,
    image: d.image, uri: d.image, createdAt: openedAt - 2_000, presale, openedAt,
  };
}

/** Seats adding up to `sol`, 0.1 to 1 SOL in 0.01 steps, from wallets in `r`'s order. */
function seatsFor(key, sol, r, creator) {
  const seats = [];
  let left = Math.round(sol * 100);
  const used = new Set([creator]);
  seats.push({ user: creator, commit: Math.min(left, 50 + Math.floor(r() * 50)) });
  left -= seats[0].commit;
  while (left >= 10) {
    let user;
    do user = pick(r, WALLETS);
    while (used.has(user));
    used.add(user);
    const commit = Math.min(left, 10 + Math.floor(r() * 90));
    seats.push({ user, commit });
    left -= commit;
  }
  return seats.map((s, i) => ({
    seat: keyOf(`seat:${key}:${i}`), user: s.user, deposit: String(s.commit * 10_000_000), commit: String(s.commit * 10_000_000),
    settled: false, claimed: false, creator: s.user === creator, where: "er",
  }));
}

const sum = (seats) => seats.reduce((a, s) => a + Number(s.commit), 0);
const faces = (seats) => seats.map((s) => ({ user: s.user, commit: s.commit, creator: s.creator })).sort((a, b) => Number(b.commit) - Number(a.commit));

function presaleView(key) {
  const p = world.presales.get(key);
  const seats = world.seats.get(key);
  return { ...p, raised: String(sum(seats)), seatsCommitted: String(seats.length) };
}
const listItem = (key) => {
  const v = presaleView(key);
  return v.state === "OPEN" ? { ...v, users: faces(world.seats.get(key)) } : v;
};
// A claim closes a seat, so a claimed one leaves the detail's seats (the launch's "N to go")
const detail = (key) => ({ ...presaleView(key), seats: world.seats.get(key).filter((s) => !s.claimed) });

function launchedRow(c, at, sol, migrated) {
  const d = world.dex[c.mint];
  return {
    presale: c.presale, mint: c.mint, token: tokenOf(c, c.presale, at - 30 * MIN),
    launch: { sig: sigOf(c.mint), released: String(Math.round(TARGET * 0.97)), cost: "10305720", tokens: "16884433180163", units: 238_218, at },
    pool: { address: d.pair, quoteReserve: String(Math.round((migrated ? 80 : sol) * SOL)), sqrtPrice: String(sqrtOf(d.priceSol)), migrated, damm: migrated ? d.pair : null },
  };
}

function build() {
  world.presales.clear();
  world.seats.clear();
  world.launched.clear();
  const now = Date.now();
  for (const c of COINS) {
    c.presale = keyOf(`presale:${c.mint}`);
    c.creator = pick(rng(`creator:${c.mint}`), WALLETS);
    if (c.role === "filling") {
      const opened = now - c.age * MIN;
      const r = rng(`seats:${c.mint}`);
      world.presales.set(c.presale, {
        presale: c.presale, where: "er", state: "OPEN", creator: c.creator, mint: c.mint, validator: VALIDATOR,
        feeDest: keyOf(`fee:${c.mint}`), pot: keyOf(`pot:${c.mint}`), bump: 254,
        openedTs: String(Math.floor(opened / 1000)), deadlineTs: String(Math.floor(opened / 1000) + 3600), fullTs: "0",
        raised: "0", seatsCommitted: "0", seatsSettled: "0", seatsRefunded: "0", released: "0", totalTokens: "0",
        claimedTokens: "0", claimsDone: "0", feesPaid: "0", settledSum: "0",
        token: tokenOf(c, c.presale, opened), launch: null,
      });
      world.seats.set(c.presale, seatsFor(c.presale, c.sol, r, c.creator));
    } else {
      world.launched.set(c.presale, launchedRow(c, now - c.age * MIN, c.sol, c.role === "migrated"));
    }
  }
  if (!world.chat.size) seedChat(now);
}

// ---- chat ----

// Plain text: the website draws no Mooner emojis (a `:gg:` would show as typed)
const LINES = [
  "gm", "$SYM pool is over half full already", "chipped in 0.5, see you up there", "wen $SYM launch",
  "this one feels different", "lfg", "who else is in $SYM", "$SYM chart looking clean", "ser the curve is almost done",
  "holding $SYM to migration", "new one filling, small pool, good crowd", "gg $SYM",
  "everyone gets the same price, no snipers", "1 SOL max per wallet is so good", "got my seat in $SYM", "ngl $SYM art is fire",
];
/** A pool's own room only talks about getting in. */
const POOL_LINES = [
  "gm", "who else is in $SYM", "chipped in 0.5, see you up there", "wen $SYM launch", "this one feels different", "lfg",
  "got my seat in $SYM", "ngl $SYM art is fire", "everyone gets the same price, no snipers", "almost full, tell your friends",
];
function line(r, symbols, lines = LINES) {
  const t = pick(r, lines);
  return t.replaceAll("$SYM", `$${pick(r, symbols)}`);
}
function chatRow(channel, wallet, text, at) {
  const row = { id: chatId++, channel, wallet, text, at };
  const rows = world.chat.get(channel) ?? [];
  rows.push(row);
  world.chat.set(channel, rows.slice(-50));
  return row;
}
function seedChat(now) {
  const r = rng("chat");
  const symbols = COINS.map((c) => world.dex[c.mint].symbol);
  for (let i = 0; i < 24; i++) chatRow("global", pick(r, WALLETS.slice(0, 40)), line(r, symbols), now - (24 - i) * 2.5 * MIN);
  for (const c of COINS.filter((x) => x.role === "filling")) {
    const sym = world.dex[c.mint].symbol;
    for (let i = 0; i < 8; i++) chatRow(c.presale, pick(r, world.seats.get(c.presale)).user, line(r, [sym], POOL_LINES), now - (8 - i) * 3 * MIN);
  }
}

// ---- coin stats (coin:<mint>), from GeckoTerminal by the coin's real pool ----

const stats = new Map(); // mint -> { at, data }
async function statsOf(mint) {
  if (fresh.has(mint)) return freshStats(mint);
  const kept = stats.get(mint);
  if (kept && Date.now() - kept.at < MIN) return kept.data;
  const c = COINS.find((x) => x.mint === mint);
  const d = world.dex[mint];
  const [candles, s] = await Promise.all([geckoCandles(d.pair, { limit: 300 }).catch(() => kept?.data.candles ?? []), geckoStats(d.pair).catch(() => ({ volume24hUsd: null }))]);
  const data = {
    mint, venue: c.role === "migrated" ? "damm" : "dbc", pool: d.pair, candles, candleMs: MIN, source: candles.length ? "geckoterminal" : null,
    volume24hUsd: s.volume24hUsd, liquidityUsd: d.liqUsd, ...holdersOf(c), supply: "1000000000000000", at: Date.now(),
  };
  stats.set(mint, { at: Date.now(), data });
  return data;
}

/** Made-up holders: the curve (or the pool) first, then demo wallets, in raw units (6 decimals). */
function holdersOf(c) {
  const r = rng(`holders:${c.mint}`);
  const pool = c.role === "migrated" ? 0.21 : 0.62 - (c.sol ?? 0) / 200;
  let left = 0.25;
  const top = [{ owner: keyOf(`curve:${c.mint}`), amount: String(Math.round(pool * 1e15)), label: c.role === "migrated" ? "Pool" : "Bonding curve" }];
  for (let i = 0; i < 9; i++) {
    const share = left * (0.18 + r() * 0.1);
    left -= share;
    top.push({ owner: WALLETS[Math.floor(r() * WALLETS.length)], amount: String(Math.round(share * 1e15)), label: null });
  }
  return { holders: 180 + Math.floor(r() * 1400), top };
}

// ---- a coin launched in the demo: its own price from the launch on ----

// A real coin's chart is its whole real history, which a coin that just launched doesn't
// have: from /demo/launch on, the coin's price is its own, from the launch price (the SOL in
// over the tokens out), a 4 s candle at a time, and trades here move it. Its quotes come from
// here too (GET /demo/quote), so the chart, the market cap, a holding and a quote agree. The
// steps are seeded (one that runs up with a few dips), so every take draws the same chart.
const STEP = 4_000;
const SUPPLY = 10n ** 15n;
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const fresh = new Map(); // mint -> { r, at, p0, q0, level, next, bump, candles, volSol }

function startFresh(mint, at, p0, q0) {
  fresh.set(mint, { r: rng(`fresh:${mint}:17`), at, p0, q0, level: Math.log(p0), next: null, bump: 0, candles: [{ t: at, o: p0, h: p0, l: p0, c: p0 }], volSol: q0 });
}

/** The next step's move in log price: a rise on average, fading over the first ten minutes,
 *  with noise. */
function stepOf(f) {
  const drift = 0.006 * Math.max(0.15, 1 - (f.candles.length - 1) / 150);
  const g = Math.sqrt(-2 * Math.log(1 - f.r())) * Math.cos(2 * Math.PI * f.r());
  return drift + 0.013 * g;
}

/** The coin's price now (SOL per token), its candles brought up to now first (each one at its
 *  close, the first the launch itself); between two the price is on its way to the next close. */
function freshPrice(mint) {
  const f = fresh.get(mint);
  const now = Date.now();
  let t = f.candles.at(-1).t;
  for (; t + STEP <= now; t += STEP) {
    const o = Math.exp(f.level);
    f.level += (f.next ?? stepOf(f)) + f.bump;
    f.next = null;
    f.bump = 0;
    const c = Math.exp(f.level);
    const wick = () => 1 + f.r() * 0.008;
    f.candles.push({ t: t + STEP, o, h: Math.max(o, c) * wick(), l: Math.min(o, c) / wick(), c });
    f.volSol += 0.05 + f.r() * 0.35;
  }
  f.next ??= stepOf(f);
  return Math.exp(f.level + f.next * ((now - t) / STEP) + f.bump);
}
/** SOL in its curve: a constant-product pool's quote side grows with the root of the price. */
const freshQuote = (f, p) => f.q0 * Math.sqrt(p / f.p0);

function freshStats(mint) {
  const f = fresh.get(mint);
  freshPrice(mint);
  const c = COINS.find((x) => x.mint === mint);
  const seats = world.seats.get(c.presale);
  const tokens = BigInt(world.launched.get(c.presale).launch.tokens);
  const all = BigInt(sum(seats));
  const top = [...seats]
    .map((s) => ({ owner: s.user, amount: String(world.users.get(s.user)?.coins.get(mint) ?? (tokens * BigInt(s.commit)) / all), label: null }))
    .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)))
    .slice(0, 9);
  return {
    mint, venue: "dbc", pool: world.dex[mint].pair, candles: f.candles.slice(-300), candleMs: STEP, source: "meteora",
    volume24hUsd: f.volSol * world.sol, liquidityUsd: null, holders: seats.length + Math.floor(f.candles.length / 4),
    top: [{ owner: keyOf(`curve:${mint}`), amount: String(SUPPLY - tokens), label: "Bonding curve" }, ...top], supply: String(SUPPLY), at: Date.now(),
  };
}

/** A quote for the fresh coin `mint` in swap.js quote's shape (BigInts as strings): 1% fee,
 *  and the pool's own price impact. */
/** How long a quote's price holds while the wallet keeps asking (the sheet's quote, then the
 *  trade's fresh one): the chart moves every moment, and a trade would always say the price
 *  moved. */
const HOLD = 6_000;
function freshQuoteOf(side, mint, amount, bps) {
  const f = fresh.get(mint);
  const now = Date.now();
  if (!f.held || now - f.held.at > HOLD) f.held = { p: freshPrice(mint) };
  f.held.at = now;
  const p = f.held.p;
  const q = freshQuote(f, p);
  let out, impact;
  if (side === "buy") {
    const x = Number(amount) / SOL;
    impact = x / (q + x);
    out = BigInt(Math.floor(((x * 0.99) / p) * (1 - impact) * 1e6));
  } else {
    const sol = (Number(amount) / 1e6) * p;
    impact = sol / (q + sol);
    out = BigInt(Math.floor(sol * 0.99 * (1 - impact) * SOL));
  }
  const minOut = (out * BigInt(10_000 - bps)) / 10_000n;
  const [inputMint, outputMint] = side === "buy" ? [WSOL_MINT, mint] : [mint, WSOL_MINT];
  return {
    inAmount: String(amount), outAmount: String(out), minOut: String(minOut), impact,
    route: [{ amm: world.dex[mint].pair, label: "Meteora DBC" }],
    raw: { inputMint, outputMint, inAmount: String(amount), outAmount: String(out), otherAmountThreshold: String(minOut), priceImpactPct: String(impact) },
  };
}
/** A trade of `sol` SOL in (a buy) or out (a sell) moves the price as a constant-product pool's. */
function freshTrade(mint, sol, buy) {
  const f = fresh.get(mint);
  const q = freshQuote(f, freshPrice(mint));
  f.bump += (buy ? 2 : -2) * Math.log(1 + sol / q);
  f.volSol += sol;
  f.held = null;
}

/** Fresh coins' prices and stats, pushed as they move. */
function freshTick() {
  for (const [mint, f] of fresh) {
    const c = COINS.find((x) => x.mint === mint);
    const row = world.launched.get(c.presale);
    if (!row) continue;
    const p = freshPrice(mint);
    const next = { ...row, pool: { ...row.pool, sqrtPrice: String(sqrtOf(p)), quoteReserve: String(Math.round(freshQuote(f, p) * SOL)) } };
    world.launched.set(c.presale, next);
    publish("launched", { type: "upsert", data: next });
    publish(`coin:${mint}`, { type: "snapshot", data: freshStats(mint) });
  }
}

// ---- the socket ----

const subs = new Map(); // topic -> Set<ws>
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
function publish(topic, msg) {
  for (const ws of subs.get(topic) ?? []) send(ws, { topic, ...msg });
}

async function snapshot(topic, say) {
  const [kind, arg] = topic.split(":");
  if (topic === "presales") return say({ type: "snapshot", data: [...world.presales.keys()].map(listItem) });
  if (topic === "launched") return say({ type: "snapshot", data: [...world.launched.values()] });
  if (topic === "profiles") {
    say({ type: "snapshot", data: PROFILES });
    return say({ type: "xp", data: [...XP, ...[...world.users.values()].map((u) => u.xp)] });
  }
  if (topic === "sol") return say({ type: "snapshot", data: { usd: world.sol, at: Date.now() } });
  if (kind === "chat") return say({ type: "snapshot", data: world.chat.get(arg) ?? [] });
  if (kind === "wallet") return say({ type: "snapshot", data: { lamports: userOf(arg).lamports } });
  if (kind === "presale") return world.presales.has(arg) ? say({ type: "snapshot", data: detail(arg) }) : say({ type: "missing" });
  if (kind === "coin") {
    if (!world.dex[arg] || ![...world.launched.values()].some((r) => r.mint === arg)) return say({ type: "missing" });
    return say({ type: "snapshot", data: await statsOf(arg) });
  }
}

function attach(ws) {
  ws.subs = new Set();
  ws.alive = true;
  ws.on("pong", () => (ws.alive = true));
  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return send(ws, { error: "send JSON" });
    }
    for (const topic of Array.isArray(m?.topics) ? m.topics : []) {
      if (m.op === "unsub") {
        ws.subs.delete(topic);
        subs.get(topic)?.delete(ws);
        continue;
      }
      ws.subs.add(topic);
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic).add(ws);
      snapshot(topic, (msg) => send(ws, { topic, ...msg })).catch((e) => send(ws, { topic, type: "error", error: e.message }));
    }
  });
  ws.on("close", () => {
    for (const t of ws.subs) subs.get(t)?.delete(ws);
  });
}

// ---- what moves ----

const changed = (key) => {
  publish(`presale:${key}`, { type: "snapshot", data: detail(key) });
  publish("presales", { type: "upsert", data: listItem(key) });
};

/** One more seat in an open pool: a wallet not in it yet, 0.1 to `max` SOL, never past 10. */
function chipIn(key, max = 0.6, fill = false) {
  const seats = world.seats.get(key);
  const room = Math.round((TARGET - sum(seats)) / 10_000_000);
  if (room < 10) return 0;
  const r = Math.random;
  const inIt = new Set(seats.map((s) => s.user));
  const free = WALLETS.filter((w) => !inIt.has(w));
  let commit = Math.min(room, 10 + Math.floor(r() * (max * 100 - 10)));
  // filling to the top: never leave less than a seat's minimum
  if (fill && room - commit < 10) commit = room <= 100 ? room : room - 10;
  seats.push({ seat: keyOf(`seat:${key}:${seats.length}:${Date.now()}`), user: pick(r, free), deposit: String(commit * 10_000_000), commit: String(commit * 10_000_000), settled: false, claimed: false, creator: false, where: "er" });
  changed(key);
  return room - commit;
}

/** The pools fill slowly by themselves, at most 1.5 SOL past where they started and never
 *  past 9 (a launch is /demo/launch's; a `cue` pool waits for it). */
function tick() {
  const coin = (p) => COINS.find((c) => c.presale === p.presale);
  const cap = (p) => (p.capSol ?? Math.min(9, coin(p).sol + 1.5)) * SOL;
  const open = [...world.presales.values()].filter((p) => p.state === "OPEN" && !p.cue && !coin(p)?.cue && sum(world.seats.get(p.presale)) < cap(p));
  if (open.length) chipIn(pick(Math.random, open).presale, 0.4);
}

function talk() {
  const r = Math.random;
  const symbols = COINS.map((c) => world.dex[c.mint].symbol);
  const row = chatRow("global", pick(r, WALLETS.slice(0, 50)), line(r, symbols), Date.now());
  publish("chat:global", { type: "message", data: row });
}

/** Prices and SOL/USD from DexScreener again; live coins' curves creep up. */
async function refresh() {
  try {
    const { coins, solUsd } = await readCoins();
    world.dex = coins;
    world.sol = solUsd;
    publish("sol", { type: "snapshot", data: { usd: solUsd, at: Date.now() } });
    for (const [key, row] of world.launched) {
      if (fresh.has(row.mint)) continue;
      const c = COINS.find((x) => x.mint === row.mint);
      const q = row.pool.migrated ? Number(row.pool.quoteReserve) : Math.min(79.5 * SOL, Number(row.pool.quoteReserve) + Math.random() * 0.3 * SOL);
      const next = { ...row, pool: { ...row.pool, sqrtPrice: String(sqrtOf(coins[c.mint].priceSol)), quoteReserve: String(Math.round(q)) } };
      world.launched.set(key, next);
      publish("launched", { type: "upsert", data: next });
    }
  } catch (e) {
    log(`refresh: ${e.message}`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `symbol`'s pool fills over a few seconds, goes FULL, LAUNCHING, then lives on its curve. */
async function launch(symbol) {
  const c = COINS.find((x) => x.role === "filling" && world.dex[x.mint].symbol.toLowerCase() === symbol.toLowerCase());
  const p = c && world.presales.get(c.presale);
  if (!p || p.state !== "OPEN") throw new Error(`no open pool for ${symbol}`);
  p.cue = true;
  const sym0 = world.dex[c.mint].symbol;
  const hype = ["almost full", "lfg", `get in $${sym0}`, "last seats", "here we go"];
  let said = 0;
  while (chipIn(c.presale, 0.9, true) >= 10) {
    await wait(900 + Math.random() * 700);
    // the room talks while it fills
    if (said < hype.length && Math.random() < 0.6) {
      const row = chatRow(c.presale, pick(Math.random, world.seats.get(c.presale)).user, hype[said++], Date.now());
      publish(`chat:${c.presale}`, { type: "message", data: row });
    }
  }
  const at = Date.now();
  Object.assign(p, { state: "FULL", fullTs: String(Math.floor(at / 1000)) });
  changed(c.presale);
  await wait(2_500);
  p.state = "LAUNCHING";
  changed(c.presale);
  await wait(2_500);
  const row = launchedRow(c, Date.now(), 10.4, false);
  // the launch price: the SOL that went in over the tokens that came out
  const p0 = Number(row.launch.released) / SOL / (Number(row.launch.tokens) / 1e6);
  startFresh(c.mint, Date.now(), p0, 10.4);
  row.pool.sqrtPrice = String(sqrtOf(p0));
  Object.assign(p, { state: "SETTLED", launch: row.launch, released: row.launch.released, totalTokens: row.launch.tokens });
  changed(c.presale);
  world.launched.set(c.presale, row);
  publish("launched", { type: "upsert", data: row });
  const sym = world.dex[c.mint].symbol;
  publish("chat:global", { type: "message", data: chatRow("global", c.creator, `$${sym} just launched on Meteora`, Date.now()) });
  log(`${sym} launched`);
  // The keeper sends everyone their tokens: a few seats claim at a time till none are left
  const seats = world.seats.get(c.presale);
  for (let i = 0; i < seats.length; ) {
    await wait(350 + Math.random() * 300);
    for (const s of seats.slice(i, (i += 2 + Math.floor(Math.random() * 3)))) {
      Object.assign(s, { settled: true, claimed: true });
      if (world.users.has(s.user)) delivered(s.user, c.mint, (BigInt(row.launch.tokens) * BigInt(s.commit)) / BigInt(sum(seats)));
    }
    p.seatsSettled = String(Math.min(i, seats.length));
    changed(c.presale);
  }
}

// ---- the phone demo's own wallets (mobile/src/demo.js): their SOL, coins and XP ----

const START_SOL = 6.2 * SOL;
const JOIN_COST = 2_400_000; // what demo.js says a join takes besides the seat
const OPEN_COST = 9_800_000; // and an open
const TRADE_FEE = 105_000;
const X_HANDLE = "moondog";

/** A wallet the phone demo uses: { lamports, coins: mint -> raw, x, xp }. */
function userOf(wallet) {
  if (!world.users.has(wallet)) world.users.set(wallet, { lamports: START_SOL, coins: new Map(), x: null, xp: freshXp(wallet) });
  return world.users.get(wallet);
}
const sessionWallet = (token) => {
  const w = typeof token === "string" && token.startsWith("demo.") ? token.slice(5) : null;
  if (!w) throw Object.assign(new Error("sign in first"), { status: 401 });
  return w;
};
/** The wallet's SOL went to `lamports`: pushed, so the app reads its coins again too. */
function moved(wallet) {
  publish(`wallet:${wallet}`, { type: "snapshot", data: { lamports: userOf(wallet).lamports } });
}
function earn(wallet, event, title, points) {
  const x = userOf(wallet).xp;
  x.counts = { ...x.counts, [event]: (x.counts[event] ?? 0) + 1 };
  if (title) x.titles = { ...x.titles, [title]: x.titles[title] + points };
  x.total += points;
  userOf(wallet).xp = { ...x };
  publish("profiles", { type: "xp", data: [userOf(wallet).xp] });
}
/** The keeper's claim gave `wallet` `raw` tokens of `mint`; KOL XP for a launch it put SOL in. */
function delivered(wallet, mint, raw) {
  const u = userOf(wallet);
  u.coins.set(mint, (u.coins.get(mint) ?? 0n) + raw);
  moved(wallet);
  earn(wallet, "kolLaunch", "kol", 25);
}

const SNIFF = [[[0x89, 0x50, 0x4e, 0x47], "image/png"], [[0xff, 0xd8, 0xff], "image/jpeg"], [[0x47, 0x49, 0x46], "image/gif"], [[0x52, 0x49, 0x46, 0x46], "image/webp"]];

const POSTS = {
  "/api/login": ({ wallet }) => {
    new PublicKey(wallet);
    return { token: `demo.${wallet}`, exp: Date.now() + 7 * 24 * 3_600_000 };
  },
  "/api/chat": ({ token, channel, text }) => {
    const row = chatRow(channel, sessionWallet(token), String(text).slice(0, 280), Date.now());
    publish(`chat:${channel}`, { type: "message", data: row });
    return { message: row };
  },
  "/api/genesis": ({ token }) => {
    const wallet = sessionWallet(token);
    const u = userOf(wallet);
    const fresh = !u.xp.genesis;
    if (fresh) {
      u.xp = { ...u.xp, genesis: { mint: keyOf(`genesis:${wallet}`), at: Date.now() } };
      earn(wallet, "genesis", null, 250);
    }
    return { wallet, genesis: u.xp.genesis, fresh, xp: u.xp };
  },
  // Link X: no X page, the wallet is linked at once and the app's own back link handed over
  "/api/x/start": ({ token }) => {
    userOf(sessionWallet(token)).x = { handle: X_HANDLE, name: X_HANDLE, avatar: null, ok: true };
    return { url: `mooner://x-link?handle=${X_HANDLE}` };
  },
  "/api/x/unlink": ({ token }) => {
    userOf(sessionWallet(token)).x = null;
    return { x: null };
  },
  "/demo/mint": ({ wallet, name, symbol, description, links, image }, req) => {
    const bytes = Buffer.from(image, "base64");
    const type = SNIFF.find(([magic]) => magic.every((b, i) => bytes[i] === b))?.[1] ?? "image/png";
    const mint = keyOf(`mint:${wallet}:${symbol}:${Date.now()}`);
    const presale = presalePda(new PublicKey(info.program), new PublicKey(mint)).toBase58();
    const url = `http://${req.headers.host}/demo/img/${mint}`;
    const token = { mint, creator: wallet, name, symbol, description, links, image: url, uri: url, createdAt: Date.now(), presale: null, openedAt: null };
    world.made.set(mint, { token, picture: { bytes, type } });
    log(`${wallet.slice(0, 4)} made $${symbol}`);
    return { mint, presale, name, symbol, image: url, uri: url };
  },
  "/demo/open": ({ presale, mint, wallet, commit }) => {
    const made = world.made.get(mint);
    if (!made) throw new Error("no such coin");
    const now = Date.now();
    made.token = { ...made.token, presale, openedAt: now };
    world.presales.set(presale, {
      presale, where: "er", state: "OPEN", creator: wallet, mint, validator: VALIDATOR,
      feeDest: keyOf(`fee:${mint}`), pot: keyOf(`pot:${mint}`), bump: 254,
      openedTs: String(Math.floor(now / 1000)), deadlineTs: String(Math.floor(now / 1000) + 3600), fullTs: "0",
      raised: "0", seatsCommitted: "0", seatsSettled: "0", seatsRefunded: "0", released: "0", totalTokens: "0",
      claimedTokens: "0", claimsDone: "0", feesPaid: "0", settledSum: "0",
      token: made.token, launch: null, capSol: 3.4,
    });
    world.seats.set(presale, [{ seat: keyOf(`seat:${presale}:0`), user: wallet, deposit: String(commit), commit: String(commit), settled: false, claimed: false, creator: true, where: "er" }]);
    const u = userOf(wallet);
    u.lamports -= Number(commit) + OPEN_COST;
    moved(wallet);
    changed(presale);
    log(`${wallet.slice(0, 4)} opened $${made.token.symbol}`);
    return { ok: true };
  },
  "/demo/join": ({ presale, wallet, amount }) => {
    const seats = world.seats.get(presale);
    if (!seats || world.presales.get(presale).state !== "OPEN") throw new Error("that pool isn't open");
    if (seats.some((s) => s.user === wallet)) throw new Error("this wallet is in already");
    seats.push({ seat: keyOf(`seat:${presale}:${wallet}`), user: wallet, deposit: String(amount), commit: String(amount), settled: false, claimed: false, creator: false, where: "er" });
    const u = userOf(wallet);
    u.lamports -= Number(amount) + JOIN_COST;
    moved(wallet);
    changed(presale);
    log(`${wallet.slice(0, 4)} chipped in ${Number(amount) / SOL} SOL`);
    return { ok: true };
  },
  "/demo/trade": ({ wallet, mint, side, inAmount, outAmount }) => {
    const u = userOf(wallet);
    const have = u.coins.get(mint) ?? 0n;
    if (side === "buy") {
      u.lamports -= Number(inAmount) + TRADE_FEE;
      u.coins.set(mint, have + BigInt(outAmount));
    } else {
      if (BigInt(inAmount) > have) throw new Error("not that many coins");
      u.coins.set(mint, have - BigInt(inAmount));
      u.lamports += Number(outAmount) - TRADE_FEE;
    }
    if (fresh.has(mint)) freshTrade(mint, Number(side === "buy" ? inAmount : outAmount) / SOL, side === "buy");
    moved(wallet);
    log(`${wallet.slice(0, 4)} ${side} ${mint.slice(0, 4)}`);
    return { sig: sigOf(`${wallet}:${mint}:${Date.now()}`) };
  },
};

async function bodyOf(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw Object.assign(new Error("send JSON"), { status: 400 });
  }
}

// ---- http ----

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};

/** DEMO_RPC: an RPC URL that /api/rpc goes to instead of the live server's (for when that
 *  one is down), e.g. DEMO_RPC=$(vault get ALCHEMY_RPC_URL). */
const RPC = process.env.DEMO_RPC;

async function proxy(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  delete headers["accept-encoding"];
  const rpc = RPC && new URL(req.url, "http://x").pathname === "/api/rpc";
  try {
    const r = await fetch(rpc ? RPC : `${UPSTREAM}${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: "manual" });
    const out = {};
    r.headers.forEach((v, k) => !["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k) && (out[k] = v));
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    json(res, 502, { error: `demo proxy: ${e.message}` });
  }
}

let info = null;
async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST" });
    return res.end();
  }
  if (req.method === "POST" && p.startsWith("/demo/launch/")) {
    launch(decodeURIComponent(p.slice("/demo/launch/".length))).catch((e) => log(`launch: ${e.message}`));
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/demo/reset") {
    world.users.clear();
    world.made.clear();
    world.chat.clear();
    fresh.clear();
    build();
    publish("presales", { type: "snapshot", data: [...world.presales.keys()].map(listItem) });
    publish("launched", { type: "snapshot", data: [...world.launched.values()] });
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST") {
    const handler = POSTS[p];
    if (handler) return json(res, 200, await handler(await bodyOf(req), req));
  }
  if (req.method === "GET") {
    if (p === "/api/info") return json(res, 200, info);
    let w = p.match(/^\/api\/wallet\/(\w+)\/tokens$/);
    if (w) return json(res, 200, { tokens: [] });
    w = p.match(/^\/api\/wallet\/(\w+)\/balance$/);
    if (w) return json(res, 200, { lamports: String(userOf(w[1]).lamports) });
    w = p.match(/^\/api\/x\/(\w+)$/);
    if (w) return json(res, 200, { x: userOf(w[1]).x });
    w = p.match(/^\/api\/chat\/(\w+)$/);
    if (w) return json(res, 200, { messages: (world.chat.get(w[1]) ?? []).filter((r) => r.id > Number(url.searchParams.get("after") ?? 0)) });
    w = p.match(/^\/demo\/holding\/(\w+)\/(\w+)$/);
    if (w) return json(res, 200, { raw: String(userOf(w[1]).coins.get(w[2]) ?? 0n), decimals: 6 });
    // a fresh coin's quote; any other coin's is Jupiter's ({ fresh: false })
    w = p.match(/^\/demo\/quote\/(buy|sell)\/(\w+)\/(\d+)$/);
    if (w) return json(res, 200, fresh.has(w[2]) ? freshQuoteOf(w[1], w[2], BigInt(w[3]), Number(url.searchParams.get("bps") ?? 300)) : { fresh: false });
    w = p.match(/^\/demo\/img\/(\w+)$/);
    if (w && world.made.has(w[1])) {
      const { bytes, type } = world.made.get(w[1]).picture;
      res.writeHead(200, { "content-type": type, "cache-control": "max-age=86400" });
      return res.end(bytes);
    }
    if (p === "/api/presales") return json(res, 200, { presales: [...world.presales.keys()].map(listItem) });
    if (p === "/api/launched") return json(res, 200, { launched: [...world.launched.values()] });
    if (p === "/api/profiles") return json(res, 200, { profiles: PROFILES });
    let m = p.match(/^\/api\/presale\/(\w+)$/);
    if (m) return world.presales.has(m[1]) ? json(res, 200, detail(m[1])) : json(res, 404, { error: "no such presale" });
    m = p.match(/^\/api\/xp\/(\w+)$/);
    if (m) return json(res, 200, world.users.has(m[1]) ? world.users.get(m[1]).xp : xpOf(m[1]));
    m = p.match(/^\/api\/token\/(\w+)$/);
    const c = m && COINS.find((x) => x.mint === m[1]);
    if (c) return json(res, 200, tokenOf(c, c.presale, Date.now() - c.age * MIN));
    if (m && world.made.has(m[1])) return json(res, 200, world.made.get(m[1]).token);
  }
  return proxy(req, res);
}

// ---- start ----

const up = await (await fetch(`${UPSTREAM}/api/info`)).json();
info = { ...up, numbers: { ...up.numbers, TARGET: String(TARGET), MIN_SEAT: String(0.1 * SOL), MAX_SEAT: String(1 * SOL), STEP: String(0.01 * SOL) } };
await refresh();
build();
log(`${COINS.length} coins: ${COINS.map((c) => `${world.dex[c.mint].symbol} (${c.role})`).join(", ")}`);

const server = http.createServer((req, res) => route(req, res).catch((e) => json(res, e.status ?? 500, { error: e.message })));
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, sock, head) => {
  if (new URL(req.url, "http://x").pathname !== "/api/ws") return sock.destroy();
  wss.handleUpgrade(req, sock, head, attach);
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) ws.terminate();
    ws.alive = false;
    ws.ping();
  }
}, 30_000);
setInterval(tick, 6_000);
setInterval(talk, 7_000);
setInterval(refresh, 20_000);
setInterval(freshTick, 2_000);
server.listen(PORT, "127.0.0.1", () => log(`demo server on http://127.0.0.1:${PORT} (the rest goes to ${UPSTREAM})`));
