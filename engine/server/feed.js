// What the live socket (hub.js) carries, fed by chain subscriptions instead of polls:
//   - our program on Solana and on each ER, and the delegation program's copies of our
//     presales and seats on Solana: any change to a presale or a seat re-reads that
//     presale once (paced) and pushes it to `presale:<key>` and `presales`
//   - each launched token's DBC pool, and its DAMM v2 pool once it migrated: pushed to
//     `launched` as it trades; the flip of the DBC pool's migrated flag is the "migrated"
//     event (feed.on("migrated", row))
//   - one coin's chart, volume, liquidity and holders while someone has it open:
//     `coin:<mint>`, read again at most once a `statsMs`, and only after its pool changed
//   - each watched wallet's SOL: `wallet:<wallet>`
//   - SOL/USD from Pyth's price account: `sol`
//   - chat messages and pictures as the server saves them: `chat:<channel>`, `profiles`
// A socket that joins a topic gets its snapshot first, then the changes.

import { EventEmitter } from "node:events";
import { PublicKey } from "@solana/web3.js";
import { DELEGATION_PROGRAM } from "../src/consts.js";
import { decodeDammPool, findDammPool } from "../src/damm.js";
import { priceFromSqrt } from "../src/views.js";
import { PRESALE_LEN, PRESALE_VERSION, SEAT_LEN, SEAT_VERSION, decodePresale, decodeSeat } from "../src/layout.js";
import { poolAddresses, presalePda, seatPda } from "../src/pdas.js";
import { decodePoolState } from "../src/dbc.js";
import { accountsOf, listItem } from "./api.js";
import { chainReads, coinStats, statsConnection } from "./coinstats.js";
import { allProfiles, chatRows } from "./social.js";

/** Pyth's SOL/USD price account (push oracle, shard 0), the same address on every cluster. */
export const PYTH_SOL_USD = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const SOL_USD_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

/** A Pyth PriceUpdateV2 account: { usd, at } (at in ms), or null if it isn't SOL/USD. */
export function decodeSolUsd(data) {
  const b = Buffer.from(data ?? []);
  if (b.length < 134) return null;
  const o = b[40] === 1 ? 41 : 42; // verification level: Full is 1 byte, Partial 2
  if (b.subarray(o, o + 32).toString("hex") !== SOL_USD_FEED) return null;
  const usd = Number(b.readBigInt64LE(o + 32)) * 10 ** b.readInt32LE(o + 48);
  return { usd, at: Number(b.readBigInt64LE(o + 52)) * 1000 };
}

const version = (v) => ({ memcmp: { offset: 0, bytes: Buffer.from([v]).toString("base64"), encoding: "base64" } });
const tryDecode = (decode, data) => {
  try {
    return decode(data);
  } catch {
    return null;
  }
};

export class Feed extends EventEmitter {
  /**
   * `reads`: api.js makeReads (the feed shares its cache with the HTTP routes). `l1` and
   * `ers` ({ validatorBase58: Connection }) are the chain connections to subscribe on.
   * `db`: the server's SQLite (chat and pictures). `fetch`: for the market APIs
   * (coinstats.js). `statsConn`: the connection coin stats read the chain over (the top
   * holders, the supply); by default one of its own to l1's endpoint, built here once
   * (coinstats.js statsConnection: a 429 fails at once, 10 s a request). `dammTries`: reads
   * of the DAMM v2 pool after a migration, `retryMs` apart; if none finds it, the feed looks
   * again the next time the DBC pool changes (or at the next start).
   */
  constructor({ reads, l1, ers, pid, dbcConfig, store, db, solFeed = PYTH_SOL_USD, paceMs = 1_000, poolPaceMs = 500, retryMs = 3_000, maxWallets = 2_000, statsMs = 60_000, dammTries = 10, fetch = globalThis.fetch, statsConn, now = Date.now, log = console.log }) {
    super({ captureRejections: true });
    Object.assign(this, { reads, l1, ers, pid, dbcConfig, store, db, solFeed, paceMs, poolPaceMs, retryMs, maxWallets, statsMs, dammTries, fetch, now, log });
    this.statsChain = chainReads(statsConn ?? statsConnection(l1.rpcEndpoint), { now, log });
    this.hub = null;
    this.subs = []; // [conn, id, "program" | "account"]
    this.wallets = new Map(); // topic -> listener id
    this.pools = new Map(); // mint -> { row, pool, data, migrated, damm, dammState, dammData, finding, retry, stats }
    this.coins = new Set(); // mints whose `coin:<mint>` has sockets (pools or not, yet)
    this.known = null; // presales in the keeper's last scan
    this.sol = null;
    this.paced = new Map();
    this.seq = 0;
    this.changes = new Map(); // topic -> the number of its last change, while it has sockets or a read out (see fresh)
    this.reading = new Map(); // topic -> snapshot reads out for it
    this.heard = {}; // chain notifications of our accounts, by source (for /api/health)
  }

  // ---- lifecycle ----

  /** Starts the chain subscriptions; `hub` is where changes go. */
  async start(hub) {
    this.hub = hub;
    const opts = (filters) => ({ commitment: "confirmed", encoding: "base64", ...(filters && { filters }) });
    const onOurs = (where) => ({ accountId, accountInfo }) => this.onOurAccount(accountId, accountInfo.data, where);
    this.sub(this.l1, "program", this.l1.onProgramAccountChange(this.pid, onOurs("solana"), opts()));
    this.sub(this.l1, "program", this.l1.onProgramAccountChange(DELEGATION_PROGRAM, onOurs("delegated"), opts([{ dataSize: PRESALE_LEN }, version(PRESALE_VERSION)])));
    this.sub(this.l1, "program", this.l1.onProgramAccountChange(DELEGATION_PROGRAM, onOurs("delegated"), opts([{ dataSize: SEAT_LEN }, version(SEAT_VERSION)])));
    for (const [v, er] of Object.entries(this.ers)) this.sub(er, "program", er.onProgramAccountChange(this.pid, onOurs(`er ${v.slice(0, 4)}`), opts()));
    this.syncPools();
    await this.readPools();

    const a = await this.l1.getAccountInfo(this.solFeed).catch(() => null);
    if (decodeSolUsd(a?.data)) {
      this.onSol(a.data);
      this.sub(this.l1, "account", this.l1.onAccountChange(this.solFeed, (acc) => this.onSol(acc.data), { commitment: "confirmed" }));
    } else this.log(`no SOL/USD price account at ${this.solFeed.toBase58()}: the site shows no dollar values`);
    return this;
  }

  async stop() {
    this.stopped = true;
    for (const id of this.wallets.values()) await this.l1.removeAccountChangeListener(id).catch(() => {});
    this.wallets.clear();
    for (const [conn, id, kind] of this.subs.splice(0)) {
      await (kind === "program" ? conn.removeProgramAccountChangeListener(id) : conn.removeAccountChangeListener(id)).catch(() => {});
    }
    for (const p of this.paced.values()) clearTimeout(p.timer);
    for (const p of this.pools.values()) {
      clearTimeout(p.retry);
      clearTimeout(p.stats?.timer);
    }
  }

  sub(conn, kind, id) {
    this.subs.push([conn, id, kind]);
  }

  publish(topic, msg) {
    this.hub?.publish(topic, msg);
  }

  has(topic) {
    return !!this.hub?.has(topic);
  }

  /** `topic`'s state changed (its cache is forgotten and a push is on its way): a snapshot
   *  read already out for it reads again (see fresh). Nobody on it and no read out: nothing
   *  to note. A read out with nobody on the topic still counts: its socket may have left
   *  and come back, and its answer would land after the new sub's newer one. */
  changed(topic) {
    if (this.has(topic) || this.reading.has(topic)) this.changes.set(topic, ++this.seq);
  }

  /** `read()`, and again while `topic` changed during it, up to `reads` reads in all; the
   *  last read is what it returns. A change during a read may have pushed its newer state
   *  already, and this older answer, sent after it, would set every listener on the topic
   *  back (live.js hands a snapshot to all of them). The topic's number goes once its last
   *  read is in and nobody is on it. */
  async fresh(topic, read, reads = 3) {
    this.reading.set(topic, (this.reading.get(topic) ?? 0) + 1);
    try {
      for (let n = 1; ; n++) {
        const was = this.changes.get(topic);
        const got = await read();
        if (n >= reads || this.changes.get(topic) === was) return got;
      }
    } finally {
      const left = this.reading.get(topic) - 1;
      if (left) this.reading.set(topic, left);
      else {
        this.reading.delete(topic);
        if (!this.has(topic)) this.changes.delete(topic);
      }
    }
  }

  /** The launched list's cache is stale: forgotten, and a `launched` snapshot read out now reads again. */
  forgetLaunched() {
    this.reads.forgetLaunched();
    this.changed("launched");
  }

  /** An async listener that rejected (captureRejections sends it here): logged, not a crash. */
  [Symbol.for("nodejs.rejection")](err, ev) {
    this.log(`${ev} listener: ${err?.message ?? err}`);
  }

  // ---- presales ----

  /** A change to one of our accounts (or a delegated copy of one). */
  onOurAccount(key, data, where) {
    this.heard[where] = (this.heard[where] ?? 0) + 1;
    if (data.length === PRESALE_LEN) {
      if (where === "delegated") {
        const p = tryDecode(decodePresale, data);
        if (!p || !presalePda(this.pid, p.mint).equals(key)) return;
      }
      return this.touch(key);
    }
    if (data.length === SEAT_LEN) {
      const s = tryDecode(decodeSeat, data);
      if (!s || !seatPda(this.pid, s.presale, s.user).equals(key)) return;
      return this.touch(s.presale);
    }
  }

  /** Something about `presale` changed: read it again (at most once a `paceMs`) and push it. */
  touch(presale) {
    const k = presale.toBase58();
    this.reads.forget(presale);
    this.changed(`presale:${k}`);
    this.changed("presales");
    this.pace(`presale:${k}`, this.paceMs, () => this.pushPresale(presale));
  }

  async pushPresale(presale) {
    const k = presale.toBase58();
    this.reads.forget(presale);
    if (!this.has(`presale:${k}`) && !this.has("presales")) return;
    let v;
    try {
      v = await this.reads.presale(presale);
    } catch (e) {
      if (e.status !== 404) throw e;
      this.publish(`presale:${k}`, { type: "missing" });
      this.publish("presales", { type: "remove", data: { presale: k } });
      return;
    }
    this.publish(`presale:${k}`, { type: "snapshot", data: v });
    if (v.where === "closed") this.publish("presales", { type: "remove", data: { presale: k } });
    else this.publish("presales", { type: "upsert", data: listItem(v) });
  }

  /** The keeper's scan: presales it didn't see before are new, ones it no longer sees closed. */
  scanned(keys) {
    const now = new Map(keys.map((k) => [k.toBase58(), k]));
    if (this.known) {
      for (const [k, key] of now) if (!this.known.has(k)) this.touch(key);
      for (const [k, key] of this.known) if (!now.has(k)) this.touch(key);
    }
    this.known = now;
  }

  // ---- launched tokens ----

  /** The keeper recorded a launch: its presale changed and there's a pool to watch. */
  launched(presale) {
    this.touch(presale);
    this.forgetLaunched();
    this.syncPools(true);
  }

  /** Watches the pool of every launch not watched yet; `push`: send each one's row now. */
  syncPools(push = false) {
    for (const row of this.store.launches()) {
      if (this.pools.has(row.mint)) continue;
      const pool = poolAddresses(this.dbcConfig, new PublicKey(row.mint)).pool;
      this.pools.set(row.mint, { row, pool, data: null, migrated: null, damm: null, dammState: null });
      this.sub(this.l1, "account", this.l1.onAccountChange(pool, (acc) => this.onPool(row.mint, acc.data), { commitment: "confirmed" }));
      if (push) this.l1.getAccountInfo(pool).then((a) => a && this.onPool(row.mint, a.data), () => {});
    }
  }

  /** Reads every pool not read yet in one go (at start): its migrated flag is known before it
   *  can flip, and a coin that migrated while the server was down gets its DAMM v2 pool. */
  async readPools() {
    const list = [...this.pools.values()].filter((p) => p.migrated === null);
    const accs = await accountsOf(this.l1, list.map((p) => p.pool)).catch((e) => (this.log(`live pools: ${e.message}`), []));
    accs.forEach((a, i) => {
      const s = a && decodePoolState(a.data);
      if (!s) return;
      const p = list[i];
      p.data ??= a.data;
      p.migrated ??= s.migrated;
      if (s.migrated) this.lookDamm(p.row.mint);
    });
  }

  /** Where a migrated coin trades now, for api.js listLaunched: { pool, sqrtPrice } or null. */
  dammOf(mint) {
    const p = this.pools.get(mint);
    return p?.damm ? { pool: p.damm.toBase58(), sqrtPrice: p.dammState.sqrtPrice } : null;
  }

  onPool(mint, data) {
    const p = this.pools.get(mint);
    if (!p) return;
    p.data = data;
    this.forgetLaunched();
    this.pace(`pool:${mint}`, this.poolPaceMs, async () => {
      const s = decodePoolState(p.data);
      if (!s) return;
      const was = p.migrated;
      p.migrated = s.migrated;
      if (s.migrated && !p.damm) this.lookDamm(mint);
      if (!s.migrated) this.notePrice(mint, s.sqrtPrice);
      const row = this.pushPool(p);
      if (s.migrated && was === false) {
        this.log(`$${p.row.token?.symbol} (${mint}) migrated to DAMM v2`);
        try {
          this.emit("migrated", row);
        } catch (e) {
          this.log(`migrated listener: ${e?.message ?? e}`);
        }
      }
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

  /** Pushes `p`'s row to `launched`; returns it (null if the DBC pool doesn't decode). */
  pushPool(p) {
    const row = this.poolRow(p);
    if (!row) return null;
    this.publish("launched", { type: "upsert", data: row });
    this.statsSoon(p.row.mint);
    return row;
  }

  /** Records the coin's price at `sqrtPrice` in the server's own candles (store.addPrice).
   *  A store that can't take it is logged; what follows (the pool's push) still runs. */
  notePrice(mint, sqrtPrice) {
    try {
      this.store.addPrice(mint, priceFromSqrt(sqrtPrice), this.now());
    } catch (e) {
      this.log(`live candle ${mint}: ${e?.message ?? e}`);
    }
  }

  /** Starts findDamm without awaiting it: what it throws is logged, never left as an
   *  unhandled rejection (which would end the server). */
  lookDamm(mint, tries) {
    this.findDamm(mint, tries).catch((e) => this.log(`live damm ${mint}: ${e?.message ?? e}`));
  }

  /** Finds the DAMM v2 pool `mint` migrated into and subscribes to it. The pool may land a
   *  moment after the flag, so it's read again `retryMs` apart, `dammTries` times; a new
   *  lookup replaces a retry still waiting. Start it with lookDamm. */
  async findDamm(mint, tries = this.dammTries) {
    const p = this.pools.get(mint);
    if (!p || p.damm || p.finding) return;
    clearTimeout(p.retry);
    p.finding = true;
    let found = null;
    try {
      found = await findDammPool(this.l1, new PublicKey(mint));
    } catch (e) {
      this.log(`live damm ${mint}: ${e.message}`);
    }
    p.finding = false;
    if (this.stopped) return;
    if (!found) {
      if (tries > 1) (p.retry = setTimeout(() => this.lookDamm(mint, tries - 1), this.retryMs)).unref?.();
      else this.log(`no DAMM v2 pool found for ${mint}: its price stays the one at migration`);
      return;
    }
    p.damm = found.pool;
    p.dammState = found.state;
    this.forgetLaunched();
    this.sub(this.l1, "account", this.l1.onAccountChange(found.pool, (acc) => this.onDamm(mint, acc.data), { commitment: "confirmed" }));
    this.notePrice(mint, found.state.sqrtPrice);
    this.pushPool(p);
  }

  onDamm(mint, data) {
    const p = this.pools.get(mint);
    if (!p) return;
    p.dammData = data;
    this.forgetLaunched();
    this.pace(`damm:${mint}`, this.poolPaceMs, async () => {
      const s = decodeDammPool(p.dammData);
      if (!s) return;
      p.dammState = s;
      this.notePrice(mint, s.sqrtPrice);
      this.pushPool(p);
    });
  }

  // ---- one coin's stats (coin:<mint>) ----
  //
  // A coin's last read lives on its pool record (`p.stats`: { data, at, reading, dirty,
  // timer }), so it outlives the topic: a socket that leaves and comes back within statsMs
  // costs no read. Per coin, whatever the sockets do: at most one read a statsMs (`at` is
  // when the last one settled), never two out at once, and none while nobody has it open.
  // `dirty`: the pool changed since the last read started.

  /** The stats record on pool record `p`. */
  statsOf(p) {
    return (p.stats ??= { data: null, at: -Infinity, reading: null, dirty: false, timer: null });
  }

  /** A socket opened the coin: the read that's out, if one is; else the last read if it's
   *  younger than statsMs (if the pool changed since, a read is set for statsMs after it);
   *  else a read now. */
  async stats(mint) {
    const p = this.pools.get(mint);
    const s = this.statsOf(p);
    if (s.reading) return s.reading;
    if (this.now() - s.at < this.statsMs) {
      if (s.dirty) this.statsSoon(mint);
      if (s.data) return s.data;
      throw new Error("the last read failed; the next is due statsMs after it");
    }
    return this.readStats(mint, p);
  }

  /** Reads the coin's stats now and keeps them: the only place a read starts. A change
   *  that arrives while it's out (or a read that fails) leaves `dirty` set, and a read is
   *  set for statsMs after this one settles. */
  readStats(mint, p) {
    const s = this.statsOf(p);
    s.dirty = false;
    s.reading = coinStats({ chain: this.statsChain, p, store: this.store, fetch: this.fetch, nowMs: this.now() })
      .then(
        (data) => (s.data = data),
        (e) => {
          s.dirty = true;
          throw e;
        },
      )
      .finally(() => {
        s.reading = null;
        s.at = this.now();
        if (s.dirty) this.statsSoon(mint);
      });
    return s.reading;
  }

  /** The coin's pool changed: if someone has it open, its stats are read again and pushed,
   *  statsMs after the last read (now if that's past). A change while a read is out waits
   *  for it to settle, then statsMs. Nobody on the coin: `dirty` waits for the next socket
   *  (stats). Nothing is read after stop. */
  statsSoon(mint) {
    const p = this.pools.get(mint);
    if (!p || this.stopped) return;
    const s = this.statsOf(p);
    s.dirty = true;
    if (s.reading || s.timer || !this.coins.has(mint)) return;
    const armedAt = s.at;
    s.timer = setTimeout(() => {
      s.timer = null;
      if (this.stopped || !this.coins.has(mint)) return;
      if (s.reading || s.at !== armedAt) {
        // a socket's read started since this was set: read again statsMs after that one,
        // once it settled (readStats sets it then; here if it already has)
        s.dirty = true;
        if (!s.reading) this.statsSoon(mint);
        return;
      }
      this.readStats(mint, p).then(
        (data) => !this.stopped && this.coins.has(mint) && this.publish(`coin:${mint}`, { type: "snapshot", data }),
        (e) => this.log(`live coin:${mint}: ${e?.message ?? e}`),
      );
    }, Math.max(0, s.at + this.statsMs - this.now()));
    s.timer.unref?.();
  }

  // ---- SOL ----

  onSol(data) {
    const s = decodeSolUsd(data);
    if (!s || s.usd === this.sol?.usd) return;
    this.sol = s;
    this.publish("sol", { type: "snapshot", data: s });
  }

  watchWallet(topic) {
    if (this.wallets.size >= this.maxWallets) return this.log(`${this.maxWallets} wallets watched: ${topic} gets no live balance`);
    const wallet = new PublicKey(topic.slice("wallet:".length));
    const id = this.l1.onAccountChange(
      wallet,
      (acc) => {
        this.reads.forgetBalance(wallet);
        this.changed(topic);
        this.publish(topic, { type: "snapshot", data: { lamports: acc.lamports } });
      },
      { commitment: "confirmed" },
    );
    this.wallets.set(topic, id);
  }

  // ---- chat and pictures (the social routes call these) ----

  chat(row) {
    this.publish(`chat:${row.channel}`, { type: "message", data: row });
  }

  profile(wallet, pfp) {
    this.publish("profiles", { type: "upsert", data: { wallet, pfp } });
  }

  /** What the feed is watching and what it heard, for /api/health. */
  status() {
    const damm = [...this.pools.values()].filter((p) => p.damm).length;
    const coins = [...this.coins].filter((m) => this.pools.has(m)).length; // open coins that are ours
    return { sockets: this.hub?.sockets ?? 0, heard: { ...this.heard }, wallets: this.wallets.size, pools: this.pools.size, damm, coins, sol: this.sol };
  }

  // ---- the hub's hooks ----

  first(topic) {
    if (topic.startsWith("wallet:")) this.watchWallet(topic);
    // a mint that isn't a pool yet too: when its pool comes, pushPool reads and pushes it
    if (topic.startsWith("coin:")) this.coins.add(topic.slice("coin:".length));
  }

  last(topic) {
    if (!this.reading.has(topic)) this.changes.delete(topic); // else the last read out drops it (fresh)
    if (topic.startsWith("coin:")) {
      const mint = topic.slice("coin:".length);
      this.coins.delete(mint);
      // its stats stay on the pool record; a change still unread stays `dirty`
      const s = this.pools.get(mint)?.stats;
      if (s?.timer) {
        clearTimeout(s.timer);
        s.timer = null;
      }
      return;
    }
    const id = this.wallets.get(topic);
    if (id === undefined) return;
    this.wallets.delete(topic);
    this.l1.removeAccountChangeListener(id).catch(() => {});
  }

  /** A socket joined `topic`, or subscribed again to a topic it has (a second listener on
   *  it): its snapshot, to it alone. A read that a change overtook is read again (fresh). A
   *  failed read is tried again a few times while someone is still on the topic. */
  async snapshot(topic, send, tries = 3) {
    try {
      const [kind, arg] = topic.split(":");
      if (topic === "presales") return send({ type: "snapshot", data: await this.fresh(topic, () => this.reads.listPresales()) });
      if (topic === "launched") return send({ type: "snapshot", data: await this.fresh(topic, () => this.reads.listLaunched()) });
      if (topic === "profiles") return send({ type: "snapshot", data: allProfiles(this.db) });
      if (topic === "sol") return this.sol && send({ type: "snapshot", data: this.sol });
      if (kind === "chat") return send({ type: "snapshot", data: chatRows(this.db, arg) });
      if (kind === "wallet") return send({ type: "snapshot", data: { lamports: await this.fresh(topic, () => this.reads.balance(new PublicKey(arg))) } });
      if (kind === "coin") return this.pools.has(arg) ? send({ type: "snapshot", data: await this.stats(arg) }) : send({ type: "missing" });
      if (kind === "presale") {
        const key = new PublicKey(arg);
        const read = () =>
          this.reads.presale(key).then(
            (data) => ({ type: "snapshot", data }),
            (e) => {
              if (e.status === 404) return { type: "missing" };
              throw e;
            },
          );
        return send(await this.fresh(topic, read));
      }
    } catch (e) {
      this.log(`live ${topic}: ${e.message}`);
      send({ type: "error", error: "couldn't read this right now" });
      if (tries > 1) setTimeout(() => this.has(topic) && this.snapshot(topic, send, tries - 1), this.retryMs).unref?.();
    }
  }

  // ---- pacing ----

  /** Runs `fn` now, and once more `ms` after it if it was asked for again meanwhile. */
  pace(key, ms, fn) {
    const had = this.paced.get(key);
    if (had) {
      had.again = true;
      return;
    }
    const slot = { again: false, timer: null };
    this.paced.set(key, slot);
    const run = async () => {
      slot.again = false;
      try {
        await fn();
      } catch (e) {
        this.log(`live ${key}: ${e.message}`);
      }
      slot.timer = setTimeout(() => (slot.again ? run() : this.paced.delete(key)), ms);
      slot.timer.unref?.();
    };
    run();
  }
}

