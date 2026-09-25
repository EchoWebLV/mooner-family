// The keeper: the bot's one loop over every live presale (spec "Off-chain"). A full scan
// (getProgramAccounts, which RPCs rate-limit) runs every `scanMs`, beside the ticks, never
// in front of them: a throttled listing can take a minute, and a full presale has a
// deadline. The API hands the keeper each open it confirms (`watch`), so a new presale
// doesn't wait for a scan. A presale whose tick fails waits longer each time (up to a
// minute) while the others go on. Every launch the bot sends is recorded in the store.

import { PublicKey } from "@solana/web3.js";
import { presalePda } from "../src/pdas.js";

export class Keeper {
  constructor({ bot, store, pid, pollMs = 3_000, busyMs = 1_500, scanMs = 10_000, slowMs = 10_000, maxBackoffMs = 60_000, log = console.log }) {
    Object.assign(this, { bot, store, pid, pollMs, busyMs, scanMs, slowMs, maxBackoffMs, log });
    this.info = new Map(); // presale -> { state, did, wait, fails, error, nextAt, at }
    this.known = new Map(); // presale -> PublicKey
    this.running = false;
    this.lastScanAt = null;
    this.scanError = null;
    this.scanning = null; // the scan in flight
    const launch = bot.launch.bind(bot);
    bot.launch = async (presale, p) => {
      const r = await launch(presale, p);
      store.addLaunch(presale, p.mint, r);
      return r;
    };
  }

  start() {
    this.running = true;
    this.done = this.loop();
    return this;
  }

  async stop() {
    this.running = false;
    this.wake?.();
    await this.done;
    await this.scanning;
  }

  /** Ticks `presale` from the next pass on, before any scan finds it. */
  watch(presale) {
    this.known.set(presale.toBase58(), presale);
    this.wake?.();
  }

  sleep(ms) {
    return new Promise((r) => {
      const t = setTimeout(r, ms);
      this.wake = () => {
        clearTimeout(t);
        r();
      };
    });
  }

  /** Mints whose presale exists on chain but our record missed the open (it confirmed
   *  after the co-sign call stopped waiting). */
  syncOpened(keys) {
    const live = new Set(keys.map((k) => k.toBase58()));
    for (const m of this.store.unopenedAll()) {
      const mint = new PublicKey(m);
      const presale = presalePda(this.pid, mint);
      if (live.has(presale.toBase58())) this.store.markOpened(mint, presale);
    }
  }

  /** Starts a scan if one is due and none is running. Its presales join the ticks when it
   *  lands; a failed scan is tried again at the next scan time. */
  scan() {
    if (this.scanning || (this.lastScanAt !== null && Date.now() - this.lastScanAt < this.scanMs)) return this.scanning;
    this.scanning = (async () => {
      try {
        const keys = await this.bot.scan();
        this.scanError = null;
        this.syncOpened(keys);
        for (const k of keys) this.known.set(k.toBase58(), k);
      } catch (e) {
        this.scanError = e.message;
        this.log(`scan failed: ${e.message}`);
      } finally {
        this.lastScanAt = Date.now();
        this.scanning = null;
        this.wake?.();
      }
    })();
    return this.scanning;
  }

  /** One pass: one tick per known presale, with a scan started beside them if one is
   *  due. Returns true if anything was sent. */
  async pass() {
    this.scan();
    let busy = false;
    for (const [k, key] of [...this.known]) {
      if (!this.running) break;
      const s = this.info.get(k) ?? { state: null, did: [], wait: null, fails: 0, error: null, nextAt: 0, at: null };
      this.info.set(k, s);
      if (Date.now() < s.nextAt) continue;
      const t0 = Date.now();
      try {
        const r = await this.bot.tick(key);
        const took = Date.now() - t0;
        if (took >= this.slowMs) this.log(`[${k.slice(0, 6)}] slow tick: ${(took / 1000).toFixed(1)} s (${r.state}${r.wait ? `, ${r.wait}` : ""})`);
        if (r.state !== s.state) this.log(`[${k.slice(0, 6)}] ${r.state}`);
        Object.assign(s, { state: r.state, did: r.did, wait: r.wait ?? null, fails: 0, error: null, nextAt: 0, at: Date.now() });
        if (r.did.length) busy = true;
        if (r.done) {
          this.known.delete(k);
          this.info.delete(k);
        }
      } catch (e) {
        s.fails++;
        Object.assign(s, { error: e.message, nextAt: Date.now() + Math.min(this.maxBackoffMs, 1000 * 2 ** s.fails), at: Date.now() });
        this.log(`[${k.slice(0, 6)}] tick failed (${s.fails} in a row): ${e.message}`);
        if (e.logs?.length) this.log(e.logs.join("\n"));
      }
    }
    return busy;
  }

  async loop() {
    while (this.running) {
      let busy = false;
      try {
        busy = await this.pass();
      } catch (e) {
        this.log(`pass failed: ${e.message}`);
      }
      if (this.running) await this.sleep(busy ? this.busyMs : this.pollMs);
    }
  }

  status() {
    return {
      running: this.running,
      lastScanAt: this.lastScanAt,
      scanning: Boolean(this.scanning),
      scanError: this.scanError,
      presales: [...this.info].map(([presale, s]) => ({ presale, ...s })),
    };
  }
}
