// The live socket: a real server with the hub on a free port, a fake chain that records
// subscriptions, and ws clients. Chain notifications go in, pushes come out.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import WebSocket from "ws";
import { DBC, DELEGATION_PROGRAM, MOONER_DBC_CONFIG, WSOL } from "../src/consts.js";
import { DAMM_V2, MIGRATION_CONFIGS, dammPoolAddress } from "../src/damm.js";
import { P, PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, STATE } from "../src/layout.js";
import { poolAddresses, presalePda, seatPda } from "../src/pdas.js";
import { priceFromSqrt } from "../src/views.js";
import { Bot } from "../src/bot.js";
import { makeLive } from "../src/live.js";
import { createServer, toJson } from "../server/http.js";
import { makeReads } from "../server/api.js";
import { makeSocialRoutes } from "../server/social.js";
import { Store } from "../server/store.js";
import { Hub } from "../server/hub.js";
import { Feed, PYTH_SOL_USD, decodeSolUsd } from "../server/feed.js";

const pid = Keypair.generate().publicKey;
const validator = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const SOL_FEED_ID = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");

/** A chain with accounts, reads, and subscriptions a test can fire. */
function fakeChain(name) {
  const accounts = new Map();
  const subs = new Map();
  let next = 0;
  const matches = (filters = [], data) =>
    filters.every((f) =>
      f.dataSize !== undefined ? data.length === f.dataSize : Buffer.from(data.subarray(f.memcmp.offset)).subarray(0, Buffer.from(f.memcmp.bytes, "base64").length).equals(Buffer.from(f.memcmp.bytes, "base64")),
    );
  const chain = {
    name,
    accounts,
    subs,
    reads: 0,
    rpcEndpoint: `https://${name}`,
    put(key, owner, data, lamports = 1_000_000) {
      accounts.set(key.toBase58(), { owner, data, lamports, executable: false });
    },
    async getAccountInfo(k) {
      return accounts.get(k.toBase58()) ?? null;
    },
    async getMultipleAccountsInfo(ks) {
      chain.reads++;
      return ks.map((k) => accounts.get(k.toBase58()) ?? null);
    },
    async getProgramAccounts(program, { filters = [] } = {}) {
      return [...accounts]
        .filter(([, a]) => a.owner.equals(program) && matches(filters.filter((f) => f.dataSize !== undefined), a.data))
        .map(([k, account]) => ({ pubkey: new PublicKey(k), account }));
    },
    async getBalance(k) {
      return accounts.get(k.toBase58())?.lamports ?? 0;
    },
    onProgramAccountChange(program, cb, cfg) {
      subs.set(++next, { kind: "program", program, cb, cfg });
      return next;
    },
    onAccountChange(key, cb, cfg) {
      subs.set(++next, { kind: "account", key, cb, cfg });
      return next;
    },
    async removeProgramAccountChangeListener(id) {
      subs.delete(id);
    },
    async removeAccountChangeListener(id) {
      subs.delete(id);
    },
    /** A write to `key`: stored, and told to every matching subscription. */
    write(key, owner, data, lamports = 1_000_000) {
      chain.put(key, owner, data, lamports);
      const acc = accounts.get(key.toBase58());
      for (const s of subs.values()) {
        if (s.kind === "program" && s.program.equals(owner) && matches(s.cfg?.filters, data)) s.cb({ accountId: key, accountInfo: acc }, { slot: 1 });
        if (s.kind === "account" && s.key.equals(key)) s.cb(acc, { slot: 1 });
      }
    },
    accountSubs: () => [...subs.values()].filter((s) => s.kind === "account").map((s) => s.key.toBase58()),
  };
  return chain;
}

function presaleData(mint, { state = STATE.OPEN, raised = 0n, validator: v = validator } = {}) {
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  d[P.STATE] = state;
  mint.toBuffer().copy(d, P.MINT);
  v.toBuffer().copy(d, P.VALIDATOR);
  d.writeBigUInt64LE(raised, P.RAISED);
  return d;
}

function seatData(presale, user, commit) {
  const d = Buffer.alloc(SEAT_LEN);
  d[0] = SEAT_VERSION;
  user.toBuffer().copy(d, S.USER);
  presale.toBuffer().copy(d, S.PRESALE);
  d.writeBigUInt64LE(commit, S.DEPOSIT);
  d.writeBigUInt64LE(commit, S.COMMIT);
  return d;
}

function pythData(price, expo = -8, at = 1_790_000_000) {
  const d = Buffer.alloc(134);
  d[40] = 1; // verification: Full
  SOL_FEED_ID.copy(d, 41);
  d.writeBigInt64LE(price, 73);
  d.writeInt32LE(expo, 89);
  d.writeBigInt64LE(BigInt(at), 93);
  return d;
}

/** `before({ l1, store })` runs before the feed starts: what was there while the server was
 *  down. `feed`: more Feed options (fetch, statsMs, ...; they win over the ones here). Coin
 *  stats read the chain over the fake l1 too (`statsConn`), so nothing goes out. */
async function startLive({ paceMs = 60, hub: hubOpts = {}, feed: feedOpts = {}, before = () => {} } = {}) {
  const l1 = fakeChain("l1");
  const er = fakeChain("er");
  l1.put(PYTH_SOL_USD, Keypair.generate().publicKey, pythData(12_000_000_000n));
  const store = new Store(":memory:");
  const bot = new Bot({ pid, l1, ers: { [validator.toBase58()]: er }, bot: Keypair.generate(), dbcConfig: MOONER_DBC_CONFIG, canary: true, log: () => {} });
  const reads = makeReads({ pid, l1, bot, store, dbcConfig: MOONER_DBC_CONFIG, damm: (mint) => feed.dammOf(mint) });
  const logs = [];
  const feed = new Feed({ reads, l1, ers: bot.ers, pid, dbcConfig: MOONER_DBC_CONFIG, store, db: store.db, paceMs, poolPaceMs: paceMs, retryMs: 100, fetch: noFetch, statsConn: l1, log: (m) => logs.push(m), ...feedOpts });
  before({ l1, store });
  const routes = makeSocialRoutes({ store, isPresale: () => true, onChat: (r) => feed.chat(r), onProfile: (w, p) => feed.profile(w, p) });
  const server = createServer(routes, { log: () => {} });
  const hub = new Hub(server, { log: () => {}, onFirst: (t) => feed.first(t), onLast: (t) => feed.last(t), onSub: (t, send) => feed.snapshot(t, send), ...hubOpts });
  await feed.start(hub);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `ws://127.0.0.1:${server.address().port}/api/ws`;
  return {
    l1, er, store, feed, hub, logs, url,
    client: () => client(url),
    async close() {
      hub.close();
      await feed.stop();
      await new Promise((r) => server.close(r));
    },
  };
}

/** A ws client that keeps what it got; `next(pred)` waits for a matching message. */
async function client(url) {
  const ws = new WebSocket(url);
  const got = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    got.push(m);
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m));
  });
  await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
  return {
    ws,
    got,
    send: (m) => ws.send(JSON.stringify(m)),
    sub: (...topics) => ws.send(JSON.stringify({ op: "sub", topics })),
    unsub: (...topics) => ws.send(JSON.stringify({ op: "unsub", topics })),
    next(pred, ms = 2_000) {
      const had = got.find(pred);
      if (had) {
        got.splice(got.indexOf(had), 1);
        return Promise.resolve(had);
      }
      return new Promise((resolve, reject) => {
        const w = { pred: (m) => pred(m) && (got.splice(got.indexOf(m), 1), true), resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error(`no message in ${ms} ms; got ${JSON.stringify(got).slice(0, 400)}`)), ms).unref();
      });
    },
    close: () => ws.close(),
  };
}

const on = (topic, type) => (m) => m.topic === topic && (!type || m.type === type);
/** No market API in tests unless one is handed in: every call is a 404. */
const noFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function newPresale(l1, store, { owner = pid, ...p } = {}) {
  const mint = Keypair.generate();
  const creator = Keypair.generate().publicKey;
  store.addMint({ mint, creator, name: "Moon Dog", symbol: "MDOG", description: "", links: {}, image: "https://ipfs.io/ipfs/x", uri: "https://ipfs.io/ipfs/y" });
  const presale = presalePda(pid, mint.publicKey);
  l1.put(presale, owner, presaleData(mint.publicKey, p));
  store.markOpened(mint.publicKey, presale);
  return { mint: mint.publicKey, presale };
}

test("SOL/USD from a Pyth account", () => {
  assert.deepEqual(decodeSolUsd(pythData(12_345_000_000n, -8, 1_790_000_000)), { usd: 123.45, at: 1_790_000_000_000 });
  const other = pythData(1n);
  other[41] ^= 1;
  assert.equal(decodeSolUsd(other), null, "another feed");
  assert.equal(decodeSolUsd(Buffer.alloc(10)), null);
});

test("the socket: topics, snapshots, bad requests", async () => {
  const s = await startLive();
  const c = await s.client();
  try {
    c.sub("sol", "presales", "chat:global", "nope", "wallet:not-a-key");
    assert.deepEqual((await c.next(on("sol"))).data, { usd: 120, at: 1_790_000_000_000 });
    assert.deepEqual((await c.next(on("presales"))).data, []);
    assert.deepEqual((await c.next(on("chat:global"))).data, []);
    assert.match((await c.next((m) => m.error?.includes("nope"))).error, /unknown topic/);
    assert.match((await c.next((m) => m.error?.includes("wallet:not"))).error, /unknown topic/);
    c.send({ op: "dance", topics: ["sol"] });
    assert.match((await c.next((m) => m.error)).error, /op/);
    c.ws.send("{");
    assert.equal((await c.next((m) => m.error)).error, "not JSON");

    s.l1.write(PYTH_SOL_USD, Keypair.generate().publicKey, pythData(12_100_000_000n));
    assert.equal((await c.next(on("sol"))).data.usd, 121);
    c.unsub("sol");
    await wait(50);
    s.l1.write(PYTH_SOL_USD, Keypair.generate().publicKey, pythData(12_200_000_000n));
    await wait(50);
    assert.equal(c.got.filter(on("sol")).length, 0, "nothing after unsub");
    assert.equal(s.hub.has("sol"), false);
  } finally {
    c.close();
    await s.close();
  }
});

test("a presale change on Solana or an ER is pushed, paced, to its topic and the list", async () => {
  const s = await startLive();
  const { presale } = newPresale(s.l1, s.store);
  const k = presale.toBase58();
  const c = await s.client();
  try {
    c.sub("presales", `presale:${k}`);
    const list = await c.next(on("presales", "snapshot"));
    assert.deepEqual(list.data.map((v) => [v.presale, v.state]), [[k, "OPEN"]]);
    const snap = await c.next(on(`presale:${k}`, "snapshot"));
    assert.deepEqual([snap.data.where, snap.data.seats], ["home", []]);

    // a seat at home: the presale is read again, with the seat's wallet as a face
    const a = Keypair.generate().publicKey;
    s.l1.write(seatPda(pid, presale, a), pid, seatData(presale, a, 30_000_000n));
    const one = await c.next(on(`presale:${k}`, "snapshot"));
    assert.deepEqual(one.data.seats.map((x) => [x.user, x.commit]), [[a.toBase58(), "30000000"]]);
    const up = await c.next(on("presales", "upsert"));
    assert.deepEqual([up.data.presale, up.data.seats, up.data.users.map((u) => u.user)], [k, undefined, [a.toBase58()]]);

    // delegated: the Solana copy is the delegation program's, the live one is the ER's
    s.l1.write(presale, DELEGATION_PROGRAM, presaleData(new PublicKey(snap.data.mint), { raised: 1n }));
    await c.next((m) => m.topic === `presale:${k}` && m.data?.where === "er");
    s.er.put(presale, pid, presaleData(new PublicKey(snap.data.mint), { raised: 1n }));
    await wait(100);
    c.got.length = 0;
    s.er.write(presale, pid, presaleData(new PublicKey(snap.data.mint), { raised: 77n }));
    const er = await c.next(on(`presale:${k}`, "snapshot"));
    assert.deepEqual([er.data.where, er.data.raised], ["er", "77"]);

    // a burst of changes: one read now, one after the pace, not one each
    await wait(100);
    c.got.length = 0;
    for (let i = 0; i < 10; i++) s.er.write(presale, pid, presaleData(new PublicKey(snap.data.mint), { raised: BigInt(100 + i) }));
    await wait(250);
    const pushes = c.got.filter(on(`presale:${k}`, "snapshot"));
    assert.equal(pushes.length, 2, `${pushes.length} pushes`);
    assert.equal(pushes.at(-1).data.raised, "109", "the last one has the latest state");
  } finally {
    c.close();
    await s.close();
  }
});

test("accounts that aren't ours are ignored; a closed presale leaves the list", async () => {
  const s = await startLive();
  const { presale, mint } = newPresale(s.l1, s.store);
  const k = presale.toBase58();
  const c = await s.client();
  try {
    c.sub("presales", `presale:${k}`);
    await c.next(on("presales", "snapshot"));
    await c.next(on(`presale:${k}`, "snapshot"));
    // a delegated account of the right size at some other address
    const stranger = Keypair.generate().publicKey;
    s.l1.write(stranger, DELEGATION_PROGRAM, presaleData(mint));
    // a seat whose address isn't its PDA
    s.l1.write(Keypair.generate().publicKey, DELEGATION_PROGRAM, seatData(presale, Keypair.generate().publicKey, 5n));
    await wait(150);
    assert.deepEqual(c.got, [], "nothing pushed");

    // closed: the account is gone; the keeper's scan no longer lists it
    s.feed.scanned([presale]);
    s.l1.accounts.delete(k);
    s.feed.scanned([]);
    const gone = await c.next(on(`presale:${k}`, "snapshot"));
    assert.equal(gone.data.where, "closed");
    assert.deepEqual((await c.next(on("presales", "remove"))).data, { presale: k });

    const unknown = Keypair.generate().publicKey.toBase58();
    c.sub(`presale:${unknown}`);
    assert.equal((await c.next(on(`presale:${unknown}`))).type, "missing");

    // the chain doesn't answer: an error, then the snapshot once it does
    const read = s.l1.getMultipleAccountsInfo;
    let down = 1;
    s.l1.getMultipleAccountsInfo = async (ks) => {
      if (down-- > 0) throw new Error("429");
      return read(ks);
    };
    const other = newPresale(s.l1, s.store).presale.toBase58();
    c.sub(`presale:${other}`);
    assert.equal((await c.next(on(`presale:${other}`))).type, "error");
    assert.equal((await c.next(on(`presale:${other}`), 3_000)).type, "snapshot");
  } finally {
    c.close();
    await s.close();
  }
});

test("wallet balances: watched while someone is on the topic", async () => {
  const s = await startLive();
  const w = Keypair.generate().publicKey;
  s.l1.put(w, new PublicKey("11111111111111111111111111111111"), Buffer.alloc(0), 5_000);
  const [c, d] = [await s.client(), await s.client()];
  try {
    c.sub(`wallet:${w.toBase58()}`);
    d.sub(`wallet:${w.toBase58()}`);
    assert.deepEqual((await c.next(on(`wallet:${w.toBase58()}`))).data, { lamports: 5_000 });
    await d.next(on(`wallet:${w.toBase58()}`));
    assert.deepEqual(s.l1.accountSubs().filter((x) => x === w.toBase58()).length, 1, "one chain subscription for both");
    s.l1.write(w, new PublicKey("11111111111111111111111111111111"), Buffer.alloc(0), 9_000);
    assert.deepEqual((await c.next(on(`wallet:${w.toBase58()}`))).data, { lamports: 9_000 });
    c.close();
    await wait(50);
    assert.ok(s.l1.accountSubs().includes(w.toBase58()), "d still watches");
    d.unsub(`wallet:${w.toBase58()}`);
    await wait(50);
    assert.ok(!s.l1.accountSubs().includes(w.toBase58()), "nobody left: unsubscribed on the chain too");

    // at most 4 wallets per socket
    const e = await s.client();
    const keys = Array.from({ length: 5 }, () => `wallet:${Keypair.generate().publicKey.toBase58()}`);
    e.sub(...keys);
    assert.match((await e.next((m) => m.error)).error, /at most 4 wallets/);
    e.close();
  } finally {
    d.close();
    await s.close();
  }
});

test("launched tokens: each pool's trades are pushed", async () => {
  const s = await startLive();
  const { presale, mint } = newPresale(s.l1, s.store, { state: STATE.SETTLED });
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/dbc-pool.json", import.meta.url), "utf8"));
  const pool = poolAddresses(MOONER_DBC_CONFIG, mint).pool;
  const c = await s.client();
  try {
    c.sub("launched");
    assert.deepEqual((await c.next(on("launched", "snapshot"))).data, []);
    s.l1.put(pool, DBC, Buffer.from(fixture.data, "base64"));
    s.store.addLaunch(presale, mint, { sig: "LAUNCH", released: 9n, cost: 1n, tokens: 5n, units: 7 });
    s.feed.launched(presale);
    const first = await c.next(on("launched", "upsert"));
    assert.deepEqual([first.data.mint, first.data.token.symbol, first.data.pool.quoteReserve], [mint.toBase58(), "MDOG", "197354828"]);

    const traded = Buffer.from(fixture.data, "base64");
    traded.writeBigUInt64LE(300_000_000n, 240);
    s.l1.write(pool, DBC, traded);
    assert.equal((await c.next(on("launched", "upsert"))).data.pool.quoteReserve, "300000000");
  } finally {
    c.close();
    await s.close();
  }
});

test("chat and pictures are pushed as they're saved", async () => {
  const s = await startLive();
  const c = await s.client();
  try {
    const row = s.store.db.prepare("INSERT INTO chat (channel, wallet, text, at) VALUES ('global', 'W', 'gm', 1)").run();
    c.sub("chat:global", "profiles");
    assert.deepEqual((await c.next(on("chat:global", "snapshot"))).data.map((m) => m.text), ["gm"]);
    assert.deepEqual((await c.next(on("profiles", "snapshot"))).data, {});
    s.feed.chat({ id: Number(row.lastInsertRowid) + 1, channel: "global", wallet: "W", text: "wagmi", at: 2 });
    assert.equal((await c.next(on("chat:global", "message"))).data.text, "wagmi");
    s.feed.profile("W", { skin: "a" });
    assert.deepEqual((await c.next(on("profiles", "upsert"))).data, { wallet: "W", pfp: { skin: "a" } });
    s.feed.chat({ id: 99, channel: Keypair.generate().publicKey.toBase58(), wallet: "W", text: "elsewhere", at: 3 });
    await wait(50);
    assert.equal(c.got.filter((m) => m.data?.text === "elsewhere").length, 0, "another channel's message isn't sent here");
  } finally {
    c.close();
    await s.close();
  }
});

test("limits: sockets per address, and a socket that sends too much", async () => {
  const s = await startLive({ hub: { limits: { socketsPerIp: 2, messages: [3, 60_000] } } });
  const [a, b] = [await s.client(), await s.client()];
  try {
    await assert.rejects(s.client(), /429/);
    for (let i = 0; i < 4; i++) a.sub("sol");
    assert.match((await a.next((m) => m.error)).error, /too many messages/);
    a.close();
    await wait(50);
    const again = await s.client();
    again.close();
  } finally {
    b.close();
    await s.close();
  }
});

test("a topic the socket has, subscribed again: its state again, and the topic still counts once", async () => {
  const s = await startLive({ hub: { limits: { topicsPerSocket: 2 } } });
  const { presale } = newPresale(s.l1, s.store);
  const k = presale.toBase58();
  const unknown = `presale:${Keypair.generate().publicKey.toBase58()}`;
  const c = await s.client();
  try {
    c.sub(`presale:${k}`, unknown);
    assert.equal((await c.next(on(`presale:${k}`))).type, "snapshot");
    assert.equal((await c.next(on(unknown))).type, "missing");

    // at the limit: the topics it has are answered again, each with its whole state
    c.sub(`presale:${k}`, unknown);
    const again = await c.next(on(`presale:${k}`));
    assert.deepEqual([again.type, again.data.presale, again.data.seats], ["snapshot", k, []]);
    assert.equal((await c.next(on(unknown))).type, "missing");
    assert.deepEqual(c.got.filter((m) => m.error), [], "no limit error for a topic it has");
    c.sub("sol");
    assert.match((await c.next((m) => m.error)).error, /at most 2 topics/, "a new one is still refused");

    // each topic counted once: one unsub leaves it, and frees one place
    c.unsub(unknown);
    await wait(50);
    assert.equal(s.hub.has(unknown), false);
    c.sub("sol");
    assert.equal((await c.next(on("sol"))).type, "snapshot");
    assert.deepEqual(c.got.filter((m) => m.error), []);
  } finally {
    c.close();
    await s.close();
  }
});

test("live.js on the real hub: a second listener on a presale, after the first got its snapshot, gets one too", async () => {
  const s = await startLive();
  const { presale } = newPresale(s.l1, s.store);
  const topic = `presale:${presale.toBase58()}`;
  const live = makeLive({ url: s.url, WebSocket, warn: () => {} });
  const [a, b] = [[], []];
  const offs = [];
  const until = async (ok) => {
    for (let i = 0; i < 100 && !ok(); i++) await wait(20);
  };
  try {
    offs.push(live.subscribe(topic, (m) => a.push(m)));
    await until(() => a.length);
    assert.deepEqual(a.map((m) => m.type), ["snapshot"]);
    offs.push(live.subscribe(topic, (m) => b.push(m)));
    await until(() => b.length);
    assert.deepEqual(b.map((m) => [m.type, m.data?.presale]), [["snapshot", presale.toBase58()]], "the second listener's snapshot");
    assert.deepEqual(a.map((m) => m.type), ["snapshot", "snapshot"], "the first hears it too");
  } finally {
    offs.forEach((off) => off());
    await s.close();
  }
});

test("a wallet or a coin the socket has, subscribed again at its limit: its state again, no error, no second chain subscription", async () => {
  const s = await startLive({ hub: { limits: { walletsPerSocket: 1, coinsPerSocket: 1 } } });
  const w = Keypair.generate().publicKey;
  s.l1.put(w, new PublicKey("11111111111111111111111111111111"), Buffer.alloc(0), 5_000);
  const wallet = `wallet:${w.toBase58()}`;
  const coin = `coin:${Keypair.generate().publicKey.toBase58()}`;
  const c = await s.client();
  try {
    c.sub(wallet, coin);
    assert.deepEqual((await c.next(on(wallet))).data, { lamports: 5_000 });
    assert.equal((await c.next(on(coin))).type, "missing");
    c.sub(wallet, coin);
    assert.deepEqual((await c.next(on(wallet))).data, { lamports: 5_000 });
    assert.equal((await c.next(on(coin))).type, "missing");
    assert.deepEqual(c.got.filter((m) => m.error), []);
    assert.equal(s.l1.accountSubs().filter((x) => x === w.toBase58()).length, 1, "one chain subscription");
    c.unsub(wallet);
    await wait(50);
    assert.ok(!s.l1.accountSubs().includes(w.toBase58()), "one unsub lets it go");
  } finally {
    c.close();
    await s.close();
  }
});

test("one message that names a topic 64 times gets one snapshot, held or new", async () => {
  const s = await startLive();
  const c = await s.client();
  const count = (topic) => c.got.filter(on(topic, "snapshot")).length;
  try {
    c.sub("profiles");
    await c.next(on("profiles", "snapshot"));
    c.sub(...Array(64).fill("profiles")); // held
    c.sub(...Array(64).fill("chat:global")); // new
    await c.next(on("chat:global", "snapshot"));
    await wait(100);
    assert.deepEqual([count("profiles"), count("chat:global")], [1, 0], "one each (the chat one already taken)");
    assert.deepEqual(c.got.filter((m) => m.error), []);
  } finally {
    c.close();
    await s.close();
  }
});

test("repeat subscriptions past the socket's budget are refused like any limit, with no snapshot; a new topic still goes through", async () => {
  const s = await startLive({ hub: { limits: { repeatsPerSocket: [2, 60_000] } } });
  const c = await s.client();
  try {
    c.sub("profiles"); // a first sub: not a repeat
    await c.next(on("profiles", "snapshot"));
    for (let i = 0; i < 3; i++) c.sub("profiles");
    assert.equal((await c.next((m) => m.error)).error, "too many repeat subscriptions, slow down");
    await wait(100);
    assert.equal(c.got.filter(on("profiles", "snapshot")).length, 2, "the first two repeats answered, the third not");
    c.sub("chat:global");
    assert.equal((await c.next(on("chat:global"))).type, "snapshot");
    assert.deepEqual(c.got.filter((m) => m.error), []);
  } finally {
    c.close();
    await s.close();
  }
});

/** Holds the next call of `reads[name]`: it reads now, and its answer waits until the
 *  returned function is called. Later calls aren't held. */
function holdNext(reads, name) {
  const read = reads[name];
  let go;
  const gate = new Promise((r) => (go = r));
  let armed = true;
  reads[name] = (...args) => {
    const p = read(...args);
    if (!armed) return p;
    armed = false;
    return p.then(async (v) => (await gate, v));
  };
  return go;
}

/** Two live.js listeners on `topic` over the real hub; the second one's snapshot read
 *  (`s.feed.reads[read]`) is held while `change()` happens and its push reaches both, then
 *  let go. Returns what each listener heard, as `pick(msg)` of every message. */
async function lateSnapshot(s, topic, read, change, pick) {
  const live = makeLive({ url: s.url, WebSocket, warn: () => {} });
  const [a, b] = [[], []];
  const offs = [];
  const heard = (list) => list.map(pick);
  const until = async (ok) => {
    for (let i = 0; i < 100 && !ok(); i++) await wait(20);
  };
  try {
    offs.push(live.subscribe(topic, (m) => a.push(m)));
    await until(() => a.length);
    const go = holdNext(s.feed.reads, read);
    offs.push(live.subscribe(topic, (m) => b.push(m))); // its read sees the old state, and is held
    await wait(50);
    const before = a.length;
    change();
    await until(() => a.length > before); // the change's push reached both
    go();
    await until(() => b.length >= 2);
    await wait(100);
    return [heard(a), heard(b)];
  } finally {
    offs.forEach((off) => off());
  }
}

test("presale:<key>: a second listener's snapshot read that ends after a newer push is read again, so no listener goes back to the older state", async () => {
  const s = await startLive();
  const { presale, mint } = newPresale(s.l1, s.store);
  try {
    const [a, b] = await lateSnapshot(s, `presale:${presale.toBase58()}`, "presale", () => s.l1.write(presale, pid, presaleData(mint, { raised: 5n })), (m) => m.data.raised);
    assert.deepEqual(a, ["0", "5", "5"], "the first listener: 0, then only 5");
    assert.deepEqual(b, ["5", "5"]);
  } finally {
    await s.close();
  }
});

test("wallet:<w>: a second listener's balance read that ends after a newer push is read again, so no listener goes back to the older balance", async () => {
  const s = await startLive();
  const w = Keypair.generate().publicKey;
  const system = new PublicKey("11111111111111111111111111111111");
  s.l1.put(w, system, Buffer.alloc(0), 5_000);
  try {
    const [a, b] = await lateSnapshot(s, `wallet:${w.toBase58()}`, "balance", () => s.l1.write(w, system, Buffer.alloc(0), 9_000), (m) => m.data.lamports);
    assert.deepEqual(a, [5_000, 9_000, 9_000], "the first listener: 5000, then only 9000");
    assert.deepEqual(b, [9_000, 9_000]);
  } finally {
    await s.close();
  }
});

test("presales: a second listener's list read that ends after a newer upsert is read again, so no listener goes back to the older list", async () => {
  const s = await startLive();
  const { presale, mint } = newPresale(s.l1, s.store);
  const said = (m) => (m.type === "snapshot" ? `list ${m.data[0].raised}` : `${m.type} ${m.data.raised}`);
  try {
    const [a, b] = await lateSnapshot(s, "presales", "listPresales", () => s.l1.write(presale, pid, presaleData(mint, { raised: 5n })), said);
    assert.deepEqual(a, ["list 0", "upsert 5", "list 5"], "the first listener: 0, then only 5");
    assert.deepEqual(b, ["upsert 5", "list 5"]);
  } finally {
    await s.close();
  }
});

test("launched: a second listener's list read that ends after a newer upsert is read again, so no listener goes back to the older pool", async () => {
  let coin;
  const s = await startLive({ before: ({ l1, store }) => (coin = launchedCoin(l1, store)) });
  const traded = dbcPool(false);
  traded.writeBigUInt64LE(300_000_000n, 240);
  const said = (m) => (m.type === "snapshot" ? `list ${m.data[0].pool.quoteReserve}` : `${m.type} ${m.data.pool.quoteReserve}`);
  try {
    const [a, b] = await lateSnapshot(s, "launched", "listLaunched", () => s.l1.write(coin.pool, DBC, traded), said);
    assert.deepEqual(a, ["list 197354828", "upsert 300000000", "list 300000000"], "the first listener: the old reserve, then only the new one");
    assert.deepEqual(b, ["upsert 300000000", "list 300000000"]);
  } finally {
    await s.close();
  }
});

test("a presale that changes during every snapshot read: three reads, then the last one is sent", async () => {
  const store = new Store(":memory:");
  const key = Keypair.generate().publicKey;
  const topic = `presale:${key.toBase58()}`;
  let reads = 0;
  const feed = new Feed({
    reads: {
      forget() {},
      async presale() {
        reads++;
        feed.touch(key); // a change on chain while it reads
        return { presale: key.toBase58(), raised: String(reads) };
      },
    },
    l1: { rpcEndpoint: "http://127.0.0.1:8899" },
    ers: {},
    pid,
    dbcConfig: MOONER_DBC_CONFIG,
    store,
    db: store.db,
    log: () => {},
  });
  feed.hub = { has: (t) => t === topic, publish() {} };
  feed.pushPresale = async () => {}; // the change's own push isn't what this is about
  const sent = [];
  try {
    await feed.snapshot(topic, (m) => sent.push(m));
    assert.equal(reads, 3);
    assert.deepEqual(sent, [{ type: "snapshot", data: { presale: key.toBase58(), raised: "3" } }]);
  } finally {
    await feed.stop();
  }
});

// ---- migration, the DAMM v2 pool, coin stats ----

const fixtureBytes = (name) => Buffer.from(JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).data, "base64");
/** The trial DBC pool's bytes, with the migrated flag (byte 305) set or not. */
const dbcPool = (migrated) => {
  const b = fixtureBytes("dbc-pool.json");
  b[305] = migrated ? 1 : 0;
  return b;
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
function launchedCoin(l1, store, { migrated = false } = {}) {
  const { presale, mint } = newPresale(l1, store, { state: STATE.SETTLED });
  const pool = poolAddresses(MOONER_DBC_CONFIG, mint).pool;
  l1.put(pool, DBC, dbcPool(migrated));
  store.addLaunch(presale, mint, { sig: "LAUNCH", released: 9n, cost: 1n, tokens: 5n, units: 7 });
  return { presale, mint, pool, damm: dammPoolAddress(MIGRATION_CONFIGS[2], mint, WSOL) };
}

test("migrated: one event when a pool's flag flips; none for a coin that migrated while the server was down", async () => {
  let old;
  const s = await startLive({ before: ({ l1, store }) => (old = launchedCoin(l1, store, { migrated: true })) });
  const events = [];
  const c = await s.client();
  try {
    const coin = launchedCoin(s.l1, s.store);
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
    // the DBC pool again (still migrated): its fresh row, at the DAMM v2 price, and no second event
    s.l1.write(coin.pool, DBC, dbcPool(true));
    await c.next((m) => on("launched", "upsert")(m) && m.data.pool.damm && m.data.pool.sqrtPrice === "200000000000000000");
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

test("coin:<mint>: stats when it's opened, again only after its pool changed and a statsMs passed", async () => {
  const calls = [];
  // the minute before the read, by the clock the feed reads (Date.now: no `now` is handed
  // in), so the candle is always inside the chart's CHART_MS
  const minuteAgo = () => Math.floor(Date.now() / 60_000) * 60 - 60;
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes("/ohlcv/")) return { ok: true, status: 200, json: async () => ({ data: { attributes: { ohlcv_list: [[minuteAgo(), 2e-8, 3e-8, 2e-8, 3e-8, 1]] } } }) };
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
    assert.equal(s.feed.status().coins, 0, "a mint that isn't a coin isn't counted");

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

test("coin:<mint>: nothing is read after stop", async () => {
  const calls = [];
  const fetch = async (url) => (calls.push(url), { ok: false, status: 404, json: async () => ({}) });
  const s = await startLive({ feed: { fetch, statsMs: 0 } });
  const coin = launchedCoin(s.l1, s.store);
  s.feed.launched(coin.presale);
  await wait(50);
  await s.close();
  // a pool change that was still being pushed at stop, for a coin someone had open
  s.feed.first(`coin:${coin.mint.toBase58()}`);
  s.feed.statsSoon(coin.mint.toBase58());
  await wait(50);
  assert.deepEqual(calls, []);
});

// ---- coin stats: the feed's cache and timers, on a fake clock ----

/**
 * A Feed with no server for one launched coin. `join()` and `leave()` do what the hub does
 * when a socket subscribes to `coin:<mint>` or leaves it; `join()` gives what that socket was
 * sent. `published`: every push the feed made, to anyone. Each market read of the coin is
 * counted (`market.reads`) and its 24h volume is its number; `market.hold()` keeps reads out
 * until the function it returns is called. `change()` is a pool change. Timers are mocked:
 * `advance(ms, clockMs = ms)` runs them `ms` on and moves the feed's clock `clockMs`.
 */
function statsFeed(t, { statsMs = 1_000, rpc: rpcOver = {} } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 1_790_854_800_000;
  const market = {
    reads: 0,
    gate: null,
    hold() {
      let go;
      market.gate = new Promise((r) => (go = r));
      return () => ((market.gate = null), go());
    },
  };
  const fetch = async (url) => {
    const candles = url.includes("/ohlcv/");
    if (candles) market.reads++;
    const n = market.reads;
    await market.gate;
    return { ok: true, status: 200, json: async () => (candles ? { data: { attributes: { ohlcv_list: [] } } } : { data: { attributes: { volume_usd: { h24: String(n) } } } }) };
  };
  const rpc = {
    async getTokenLargestAccounts() {
      throw new Error("not here");
    },
    async getTokenSupply() {
      throw new Error("not here");
    },
    ...rpcOver,
  };
  const store = new Store(":memory:");
  const logs = [];
  const feed = new Feed({ reads: {}, l1: rpc, statsConn: rpc, ers: {}, pid, dbcConfig: MOONER_DBC_CONFIG, store, db: store.db, fetch, statsMs, now: () => clock, log: (m) => logs.push(m) });
  const mint = Keypair.generate().publicKey.toBase58();
  feed.pools.set(mint, { row: { mint, presale: Keypair.generate().publicKey.toBase58() }, pool: Keypair.generate().publicKey, damm: null });
  const topic = `coin:${mint}`;
  let subs = 0;
  const published = [];
  feed.hub = { publish: (to, m) => published.push({ topic: to, ...m }), has: (to) => to === topic && subs > 0, sockets: 0 };
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  return {
    feed, mint, market, published, logs, flush,
    join() {
      if (subs++ === 0) feed.first(topic);
      const sent = [];
      return feed.snapshot(topic, (m) => sent.push(m)).then(() => sent);
    },
    leave() {
      if (--subs === 0) feed.last(topic);
    },
    change: () => feed.statsSoon(mint),
    async advance(ms, clockMs = ms) {
      clock += clockMs;
      t.mock.timers.tick(ms);
      await flush();
    },
    volumes: () => published.map((m) => m.data.volume24hUsd),
  };
}

test("coin stats: open, leave and open again within statsMs is one read; the second socket gets the cached snapshot", async (t) => {
  const f = statsFeed(t);
  const [a] = await f.join();
  f.leave();
  await f.advance(999);
  const [b] = await f.join();
  f.leave();
  assert.equal(f.market.reads, 1);
  assert.deepEqual([a.type, b.type, b.data.volume24hUsd], ["snapshot", "snapshot", 1]);
  assert.deepEqual(b.data, a.data);
});

test("coin stats: open, leave and open again while the first read is out: one read in flight, both sockets get it", async (t) => {
  const f = statsFeed(t);
  const go = f.market.hold();
  const a = f.join();
  await f.flush();
  f.leave();
  const b = f.join();
  await f.flush();
  assert.equal(f.market.reads, 1, "one read in flight");
  go();
  const [[x], [y]] = await Promise.all([a, b]);
  assert.deepEqual([x.data.volume24hUsd, y.data.volume24hUsd, f.market.reads], [1, 1, 1]);
});

test("coin stats: a pool change while a read is out is read again after it settles, statsMs after it, and pushed", async (t) => {
  const f = statsFeed(t);
  const go = f.market.hold();
  const a = f.join();
  await f.flush();
  f.change(); // the pool trades while the first read is out
  await f.advance(50);
  go();
  await a;
  await f.flush();
  assert.deepEqual([f.market.reads, f.published.length], [1, 0], "the change isn't answered with the read that started before it");
  await f.advance(999);
  assert.equal(f.market.reads, 1, "not before statsMs after the first read");
  await f.advance(1);
  assert.equal(f.market.reads, 2);
  assert.deepEqual(f.volumes(), [2], "the push carries the new read");
});

test("coin stats: a timer that fires a hair before statsMs by the clock still reads", async (t) => {
  const f = statsFeed(t);
  await f.join();
  f.change();
  await f.advance(1_000, 999);
  assert.equal(f.market.reads, 2);
  assert.deepEqual(f.volumes(), [2]);
});

test("coin stats: a socket's read that settles before a change's timer runs: the timer waits statsMs after that read", async (t) => {
  const f = statsFeed(t);
  await f.join(); // read 1
  f.change(); // a read set for statsMs after read 1
  await f.advance(0, 1_000); // the clock gets there before the timer runs
  await f.join(); // a second socket: the cache is statsMs old, so it reads
  assert.equal(f.market.reads, 2);
  await f.advance(1_000, 0); // the timer runs
  assert.equal(f.market.reads, 2, "not a second read at the same time");
  await f.advance(999);
  assert.equal(f.market.reads, 2, "not before statsMs after read 2");
  await f.advance(1);
  assert.deepEqual([f.market.reads, f.volumes()], [3, [3]], "then read and pushed to everyone on it");
});

test("coin stats: a change, then a second socket's read still out when the change's timer runs: one read out; the next statsMs after it settles, pushed", async (t) => {
  const f = statsFeed(t);
  await f.join(); // read 1
  f.change(); // a read set for statsMs after read 1
  await f.advance(0, 1_000); // due by the clock, the timer not run yet
  const go = f.market.hold();
  const b = f.join(); // a second socket: the cache is statsMs old, so it reads (held)
  await f.flush();
  assert.equal(f.market.reads, 2);
  await f.advance(1_000, 0); // the change's timer runs while read 2 is out
  assert.equal(f.market.reads, 2, "not a second read out at once");
  go();
  const [x] = await b;
  await f.flush();
  assert.deepEqual([x.data.volume24hUsd, f.published.length], [2, 0], "read 2 went to the socket that asked");
  await f.advance(999);
  assert.equal(f.market.reads, 2, "not before statsMs after read 2");
  await f.advance(1);
  assert.deepEqual([f.market.reads, f.volumes()], [3, [3]], "then read and pushed to everyone on it");
});

test("coin stats: the topic empties while a read is out: nothing is pushed, and the read is kept for the next socket", async (t) => {
  const f = statsFeed(t);
  await f.join();
  await f.advance(1_000);
  const go = f.market.hold();
  f.change();
  await f.advance(1);
  assert.equal(f.market.reads, 2, "the change's read is out");
  f.leave();
  go();
  await f.flush();
  assert.deepEqual(f.published, [], "no push to a topic nobody is on");
  const [b] = await f.join();
  assert.deepEqual([b.data.volume24hUsd, f.market.reads], [2, 2], "the read that was out, kept");
});

test("coin stats: a read still out at stop pushes nothing", async (t) => {
  const f = statsFeed(t);
  await f.join();
  await f.advance(1_000);
  const go = f.market.hold();
  f.change();
  await f.advance(1);
  assert.equal(f.market.reads, 2);
  await f.feed.stop();
  go();
  await f.flush();
  assert.deepEqual(f.published, []);
});

/** The timers set and not yet run or cleared, from now until `restore()`: wraps the
 *  (mocked) setTimeout and clearTimeout the feed calls. */
function timersOut() {
  const out = new Set();
  const { setTimeout: set, clearTimeout: clear } = globalThis;
  globalThis.setTimeout = (fn, ms, ...args) => {
    const h = set((...a) => (out.delete(h), fn(...a)), ms, ...args);
    out.add(h);
    return h;
  };
  globalThis.clearTimeout = (h) => (out.delete(h), clear(h));
  return { out, restore: () => Object.assign(globalThis, { setTimeout: set, clearTimeout: clear }) };
}

test("coin stats: the last socket leaving, and stop, clear the read a change set: no timer is left", async (t) => {
  const f = statsFeed(t);
  const timers = timersOut();
  try {
    await f.join();
    f.change();
    assert.equal(timers.out.size, 1, "the change's read is set");
    f.leave();
    assert.equal(timers.out.size, 0, "last() clears it");
    await f.join(); // within statsMs, the change still unread: set again
    assert.equal(timers.out.size, 1);
    await f.feed.stop();
    assert.equal(timers.out.size, 0, "stop() clears it");
  } finally {
    timers.restore();
  }
});

test("coin stats: a read that fails: the socket gets an error, and the read statsMs after it is pushed", async (t) => {
  const f = statsFeed(t);
  const p = f.feed.pools.get(f.mint);
  const pool = p.pool;
  let bad = true;
  p.pool = {
    toBase58() {
      if (bad) throw new Error("no pool");
      return pool.toBase58();
    },
  };
  const [e] = await f.join();
  assert.equal(e.type, "error");
  assert.equal(f.market.reads, 0, "it failed before asking the market");
  bad = false;
  await f.advance(999);
  assert.deepEqual(f.published, [], "not before statsMs after the failed read");
  await f.advance(1);
  assert.deepEqual([f.market.reads, f.volumes()], [1, [1]], "then read and pushed");
});

test("coin stats: a change nobody is on reads nothing; the next socket gets the cache at once and a read at statsMs", async (t) => {
  const f = statsFeed(t);
  await f.join();
  f.leave();
  await f.advance(100);
  f.change();
  await f.advance(400);
  assert.equal(f.market.reads, 1, "nobody on it: not read");
  const [b] = await f.join();
  assert.deepEqual([b.data.volume24hUsd, f.market.reads], [1, 1], "the cache, at once");
  await f.advance(499);
  assert.equal(f.market.reads, 1, "not before statsMs after the last read");
  await f.advance(1);
  assert.deepEqual([f.market.reads, f.volumes()], [2, [2]], "then read and pushed");

  // the pool still since, the cache older than statsMs: the next socket gets a read
  f.leave();
  await f.advance(2_000);
  const [c] = await f.join();
  assert.deepEqual([c.data.volume24hUsd, f.market.reads], [3, 3]);
});

test("coin stats: the feed reads holders over one connection of its own, so a 429's rest holds across reads", async (t) => {
  let asked = 0;
  const f = statsFeed(t, {
    rpc: {
      async getTokenLargestAccounts() {
        asked++;
        throw new Error('429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":429,"message":"Too many requests for a specific RPC call"}}');
      },
    },
  });
  await f.join();
  f.change();
  await f.advance(1_000);
  assert.deepEqual([f.market.reads, asked], [2, 1], "two reads, one ask");
  assert.equal(f.published[0].data.top, null);
  assert.equal(f.logs.filter((l) => l.includes("429")).length, 1, "logged once");

  // not handed one: built once from l1's endpoint, never l1 itself
  const l1 = { rpcEndpoint: "http://127.0.0.1:8899" };
  const store = new Store(":memory:");
  const feed = new Feed({ reads: {}, l1, ers: {}, pid, dbcConfig: MOONER_DBC_CONFIG, store, db: store.db, log: () => {} });
  assert.ok(feed.statsChain.conn instanceof Connection);
  assert.equal(feed.statsChain.conn.rpcEndpoint, l1.rpcEndpoint);
});

test("own candles: the feed records the DBC pool's price, then the DAMM v2 pool's once the coin moved", async () => {
  const T = 1_790_854_800_000; // on a minute: every price below lands in its candle
  const s = await startLive({ feed: { now: () => T + 30_000 } });
  const coin = launchedCoin(s.l1, s.store);
  const mint = coin.mint.toBase58();
  const [dbc, found, traded] = [98247117170863603n, 185460299076988380n, 200000000000000000n].map(priceFromSqrt);
  const c = await s.client();
  try {
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.feed.launched(coin.presale);
    await c.next(on("launched", "upsert"));
    assert.deepEqual(s.store.candles(mint), [{ t: T, o: dbc, h: dbc, l: dbc, c: dbc }], "the DBC pool's price");

    s.l1.put(coin.damm, DAMM_V2, dammPool(coin.mint));
    s.l1.write(coin.pool, DBC, dbcPool(true));
    await c.next((m) => on("launched", "upsert")(m) && m.data.pool.damm);
    assert.deepEqual(s.store.candles(mint), [{ t: T, o: dbc, h: found, l: dbc, c: found }], "the DAMM v2 pool's price when it's found");

    s.l1.write(coin.damm, DAMM_V2, dammPool(coin.mint, 200000000000000000n));
    await c.next((m) => on("launched", "upsert")(m) && m.data.pool.sqrtPrice === "200000000000000000");
    assert.deepEqual(s.store.candles(mint), [{ t: T, o: dbc, h: traded, l: dbc, c: traded }], "and as it trades there");
  } finally {
    c.close();
    await s.close();
  }
});

test("own candles: a price the store can't take is logged, and the pool's row still goes out", async () => {
  const s = await startLive();
  const coin = launchedCoin(s.l1, s.store);
  s.store.addPrice = () => {
    throw new Error("database is not open");
  };
  const c = await s.client();
  try {
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.feed.launched(coin.presale);
    assert.equal((await c.next(on("launched", "upsert"))).data.mint, coin.mint.toBase58());
    assert.ok(s.logs.includes(`live candle ${coin.mint.toBase58()}: database is not open`), "logged");
  } finally {
    c.close();
    await s.close();
  }
});

/** Counts the feed's DAMM v2 lookups of `coin` (a read whose first key is its pool), and
 *  lets a test hold them: `hold(promise)` makes each one wait for it first. */
function countLooks(l1, coin) {
  const read = l1.getMultipleAccountsInfo;
  const looks = { n: 0, gate: null, hold: (p) => (looks.gate = p) };
  l1.getMultipleAccountsInfo = async (ks) => {
    if (ks[0]?.equals(coin.damm)) {
      looks.n++;
      await looks.gate;
    }
    return read(ks);
  };
  return looks;
}

test("no DAMM v2 pool after dammTries looks: given up once, nothing watched; the DBC pool's next change looks again", async () => {
  const s = await startLive({ feed: { dammTries: 2 } });
  const coin = launchedCoin(s.l1, s.store);
  const looks = countLooks(s.l1, coin);
  const gaveUp = `no DAMM v2 pool found for ${coin.mint.toBase58()}: its price stays the one at migration`;
  const c = await s.client();
  try {
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.feed.launched(coin.presale);
    await c.next(on("launched", "upsert"));
    s.l1.write(coin.pool, DBC, dbcPool(true));
    assert.equal((await c.next(on("launched", "upsert"))).data.pool.damm, null);
    assert.equal(looks.n, 1);
    // another lookup while the first one's retry waits takes its place: one chain, not two
    s.feed.lookDamm(coin.mint.toBase58());
    for (let i = 0; i < 50 && !s.logs.includes(gaveUp); i++) await wait(20);
    await wait(150); // longer than retryMs: nothing more comes
    assert.equal(looks.n, 3, "the first look, then dammTries for the lookup that replaced it");
    assert.equal(s.logs.filter((l) => l === gaveUp).length, 1, "given up once");
    assert.ok(!s.l1.accountSubs().includes(coin.damm.toBase58()), "nothing watched");
    assert.equal(s.feed.status().damm, 0);

    // the pool is there later: the DBC pool's next change looks again and finds it
    s.l1.put(coin.damm, DAMM_V2, dammPool(coin.mint));
    s.l1.write(coin.pool, DBC, dbcPool(true));
    const found = await c.next((m) => on("launched", "upsert")(m) && m.data.pool.damm);
    assert.equal(found.data.pool.sqrtPrice, "185460299076988380");
    assert.ok(s.l1.accountSubs().includes(coin.damm.toBase58()), "watched now");
  } finally {
    c.close();
    await s.close();
  }
});

test("a throw in the DAMM v2 lookup after the read is logged, not an unhandled rejection; the feed keeps going", async () => {
  const s = await startLive();
  const coin = launchedCoin(s.l1, s.store);
  const subscribe = s.l1.onAccountChange;
  s.l1.onAccountChange = (key, cb, cfg) => {
    if (key.equals(coin.damm)) throw new Error("socket closed");
    return subscribe(key, cb, cfg);
  };
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  const c = await s.client();
  try {
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.feed.launched(coin.presale);
    await c.next(on("launched", "upsert"));
    s.l1.put(coin.damm, DAMM_V2, dammPool(coin.mint));
    s.l1.write(coin.pool, DBC, dbcPool(true));
    assert.equal((await c.next(on("launched", "upsert"))).data.pool.migrated, true);
    await wait(20);
    assert.ok(s.logs.includes(`live damm ${coin.mint.toBase58()}: socket closed`), "logged");
    assert.deepEqual(unhandled, []);
    // still going: the DBC pool's next change is pushed
    s.l1.write(coin.pool, DBC, dbcPool(true));
    assert.equal((await c.next(on("launched", "upsert"))).data.mint, coin.mint.toBase58());
  } finally {
    process.off("unhandledRejection", onUnhandled);
    c.close();
    await s.close();
  }
});

test("a DAMM v2 lookup still running at stop subscribes to nothing after it", async () => {
  const s = await startLive();
  const coin = launchedCoin(s.l1, s.store);
  s.l1.put(coin.damm, DAMM_V2, dammPool(coin.mint));
  const looks = countLooks(s.l1, coin);
  let release;
  looks.hold(new Promise((r) => (release = r)));
  s.feed.launched(coin.presale);
  s.l1.write(coin.pool, DBC, dbcPool(true));
  for (let i = 0; i < 50 && looks.n === 0; i++) await wait(20);
  assert.equal(looks.n, 1, "the lookup is running");
  await s.close();
  release();
  await wait(20);
  assert.ok(!s.l1.accountSubs().includes(coin.damm.toBase58()), "nothing subscribed after stop");
  assert.equal(s.feed.status().damm, 0);
});

test("migrated: a coin launched before the start, not migrated yet, fires when its pool flips", async () => {
  let pre;
  const s = await startLive({ before: ({ l1, store }) => (pre = launchedCoin(l1, store)) });
  const c = await s.client();
  const events = [];
  try {
    s.feed.on("migrated", (row) => events.push(row.mint));
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.l1.write(pre.pool, DBC, dbcPool(true));
    await c.next((m) => on("launched", "upsert")(m) && m.data.mint === pre.mint.toBase58());
    assert.deepEqual(events, [pre.mint.toBase58()]);
  } finally {
    c.close();
    await s.close();
  }
});

test("migrated: the event carries the upsert's row; a listener that throws is logged, and the upsert still goes out", async () => {
  const s = await startLive();
  const c = await s.client();
  const rows = [];
  try {
    const coin = launchedCoin(s.l1, s.store);
    s.feed.on("migrated", (row) => rows.push(row));
    s.feed.on("migrated", () => {
      throw new Error("boom");
    });
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.feed.launched(coin.presale);
    await c.next(on("launched", "upsert"));

    s.l1.write(coin.pool, DBC, dbcPool(true));
    const up = await c.next(on("launched", "upsert"));
    assert.equal(up.data.pool.migrated, true);
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(toJson(rows[0])), up.data);
    assert.ok(s.logs.includes("migrated listener: boom"), "logged");
  } finally {
    c.close();
    await s.close();
  }
});

test("migrated: an async listener that rejects is logged, not a crash", async () => {
  const s = await startLive();
  const c = await s.client();
  try {
    const coin = launchedCoin(s.l1, s.store);
    s.feed.on("migrated", async () => {
      throw new Error("later");
    });
    c.sub("launched");
    await c.next(on("launched", "snapshot"));
    s.feed.launched(coin.presale);
    await c.next(on("launched", "upsert"));

    s.l1.write(coin.pool, DBC, dbcPool(true));
    assert.equal((await c.next(on("launched", "upsert"))).data.pool.migrated, true);
    await wait(20); // the rejection reaches the feed a tick after the emit
    assert.ok(s.logs.includes("migrated listener: later"), "logged");
  } finally {
    c.close();
    await s.close();
  }
});
