// The keeper bot (spec "Off-chain": one loop, one lane at a time). Everything it sends is
// permissionless except the launch (release is bot-only). Every Solana crank is simulated
// first, so a crank that would fail costs nothing.
//
// Lanes, per presale:
//   in the ER, OPEN past the deadline      -> expire (in the ER)
//   in the ER, FULL or EXPIRED             -> commit_seats + commit_presale (send it home)
//   home, not OPEN, seats still in the ER  -> commit_seats (late joiners)
//   home FULL past full_ts + GRACE         -> fail
//   home FULL                              -> settle_seat every seat, then the launch tx
//   home SETTLED                           -> once the pool's snipe tax is over, claim
//                                             every seat, then close
//   home EXPIRED / FAILED                  -> settle_seat (refund) every seat, then close
// It closes a presale only once no seat of it is left, home or in the ER.

import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  DELEGATION_PROGRAM, ER_VALIDATORS, IX_SYSVAR, LAUNCH_COST_CAP, LAUNCH_TX_FEE, SYSTEM, TOKEN, TOKEN22, TX_FEE, WSOL, numbers,
} from "./consts.js";
import { PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, STATE, STATE_NAME, decodePresale, decodeSeat, tokenAmount } from "./layout.js";
import * as I from "./ix.js";
import * as D from "./dbc.js";
import { ata, configPda, eventAuthority, poolAddresses, poolAuthority, presalePda, seatPda, vaultOf } from "./pdas.js";
import { send, simulate } from "./tx.js";
import { TAX_MARGIN_S } from "./views.js"; // claims wait this long past the snipe tax, by the chain's clock

const BATCH = { settle: 8, claim: 6, commit: 10 };
const RECENT_MS = 30_000; // don't resend an ER commit while the last one is landing
const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const tryDecode = (decode, data) => {
  try {
    return decode(data);
  } catch {
    return null;
  }
};

/** getMultipleAccountsInfo for any number of keys (the RPC takes 100 at a time). */
async function accountsOf(conn, keys) {
  const out = [];
  for (const b of chunks(keys, 100)) out.push(...(await conn.getMultipleAccountsInfo(b)));
  return out;
}

/** The keys of the launch tx's lookup table. The launch tx doesn't fit 1232 bytes
 *  without it. */
export const launchAltKeys = (pid, dbcConfig) =>
  [configPda(pid), dbcConfig, poolAuthority(), eventAuthority(), WSOL, TOKEN22, SYSTEM, IX_SYSVAR];

/**
 * The whole launch tx (spec "Launch tx"): create the pool, the ATAs, release, wrap, the
 * pot's one buy at the floor fee, settle, unwrap, hand the pool's creator role (and its
 * fee share) to fee_dest. The bot is the pool's first creator and pays the tx; `pot` is
 * a fresh key per attempt that only signs the buy and the unwrap. A fixed pot would let
 * anyone park wSOL in its account ahead of time, and settle refuses a pot with wSOL left.
 */
export function launchIxs({ pid, bot, pot, presale, p, dbcConfig, meta, released, minTokens, cuLimit, cuPrice = 0 }) {
  const potWsol = ata(pot, WSOL, TOKEN);
  const ixs = [D.computeLimit(cuLimit)];
  if (cuPrice > 0) ixs.push(D.computePrice(cuPrice));
  ixs.push(
    D.initPool({ config: dbcConfig, creator: bot, mint: p.mint, payer: bot, ...meta }),
    D.createAta({ payer: bot, owner: pot, mint: WSOL, tokenProgram: TOKEN }),
    D.createAta({ payer: bot, owner: presale, mint: p.mint, tokenProgram: TOKEN22 }),
    I.release(pid, { bot, presale, pot, mint: p.mint, dbcConfig }),
    D.syncNative(potWsol),
    D.swap2({ config: dbcConfig, mint: p.mint, payer: pot, input: potWsol, output: vaultOf(presale, p.mint), amountIn: released, minOut: minTokens }),
    I.settle(pid, { presale, pot, mint: p.mint, minTokens, dbcConfig }),
    D.closeAccount({ account: potWsol, dest: bot, owner: pot }),
    D.transferPoolCreator({ config: dbcConfig, mint: p.mint, creator: bot, newCreator: p.feeDest }),
  );
  return ixs;
}

/** Wire size of a launch tx carrying `meta` ({ name, symbol, uri }): only the metadata
 *  and the number of keys change it, so throwaway keys stand in for the real ones. */
export function launchTxSize({ pid, dbcConfig, alt, meta }) {
  const bot = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const p = { mint, feeDest: Keypair.generate().publicKey };
  const ixs = launchIxs({ pid, bot, pot: Keypair.generate().publicKey, presale: presalePda(pid, mint), p, dbcConfig, meta, released: 1n, minTokens: 1n, cuLimit: 1, cuPrice: 1 });
  const msg = new TransactionMessage({ payerKey: bot, recentBlockhash: PublicKey.default.toBase58(), instructions: ixs }).compileToV0Message([alt]);
  return new VersionedTransaction(msg).serialize().length;
}

export class Bot {
  /**
   * @param o.pid        our program id
   * @param o.l1         Solana Connection
   * @param o.ers        { [validatorBase58]: Connection } ER endpoints. The gate must
   *                     co-sign only these validators (`bot.validators`).
   * @param o.bot        Keypair: config.bot, pays the launch tx, the DBC pool's first creator
   * @param o.dbcConfig  the DBC config in our Config
   * @param o.canary     canary build numbers (devnet)
   * @param o.mintSigner (mint, creator) => Keypair | undefined  (the server's mint keys)
   * @param o.tokenMeta  async (mint) => { name, symbol, uri }
   * @param o.alts       AddressLookupTableAccount[] for the launch tx (see launchAltKeys)
   * @param o.priorityMicroLamports  launch priority price, capped by LAUNCH_TX_FEE
   * @param o.onSeats    (presale, p, seats) => void, optional: a settled presale's seats as
   *                     read right before they're claimed (a claim closes its seat). Nothing
   *                     it throws or rejects holds up a claim (seatsRead).
   */
  constructor(o) {
    Object.assign(this, { ers: {}, alts: [], priorityMicroLamports: 0, log: console.log, batch: BATCH }, o);
    this.n = numbers(o.canary);
    this.recent = new Map();
    this.rents = new Map();
    this.warned = new Set();
  }

  /** The ER validators this bot has endpoints for and the program accepts: the only ones
   *  the gate may co-sign. */
  get validators() {
    return Object.keys(this.ers)
      .map((k) => new PublicKey(k))
      .filter((v) => ER_VALIDATORS.some((e) => e.equals(v)));
  }

  hasEr(validator) {
    return Boolean(this.ers[validator.toBase58()]);
  }

  now() {
    return Math.floor(Date.now() / 1000);
  }

  er(validator) {
    const c = this.ers[validator.toBase58()];
    if (!c) throw new Error(`no ER endpoint for validator ${validator.toBase58()}`);
    return c;
  }

  async rent(len) {
    if (!this.rents.has(len)) this.rents.set(len, BigInt(await this.l1.getMinimumBalanceForRentExemption(len)));
    return this.rents.get(len);
  }

  say(presale, msg) {
    this.log(`[${presale.toBase58().slice(0, 6)}] ${msg}`);
  }

  // ---- reads ----

  /** Every presale of this program, home or delegated. */
  async scan() {
    const home = await this.l1.getProgramAccounts(this.pid, { dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: PRESALE_LEN }] });
    const away = await this.l1.getProgramAccounts(DELEGATION_PROGRAM, {
      filters: [{ dataSize: PRESALE_LEN }, { memcmp: { offset: 0, bytes: Buffer.from([PRESALE_VERSION]).toString("base64"), encoding: "base64" } }],
    });
    // a delegated account's data is ours only if it sits at our PDA for its mint (anyone
    // can delegate an account of this size; one that doesn't decode is skipped)
    const ours = away.filter(({ pubkey, account }) => {
      const p = tryDecode(decodePresale, account.data);
      return p && presalePda(this.pid, p.mint).equals(pubkey);
    });
    return [...home, ...ours].map((a) => a.pubkey);
  }

  /** Keys that a listing says are delegated seats of `presale` (not read again). */
  async listDelegatedSeats(presale) {
    const accs = await this.l1.getProgramAccounts(DELEGATION_PROGRAM, {
      filters: [
        { dataSize: SEAT_LEN },
        { memcmp: { offset: 0, bytes: Buffer.from([SEAT_VERSION]).toString("base64"), encoding: "base64" } },
        { memcmp: { offset: S.PRESALE, bytes: presale.toBase58() } },
      ],
    });
    return accs
      .filter(({ pubkey, account }) => {
        const s = tryDecode(decodeSeat, account.data);
        return s && seatPda(this.pid, presale, s.user).equals(pubkey);
      })
      .map((a) => a.pubkey);
  }

  /** Keys that a listing says are home seats of `presale` (not read again). */
  async listHomeSeats(presale) {
    const accs = await this.l1.getProgramAccounts(this.pid, {
      dataSlice: { offset: 0, length: 0 },
      filters: [{ dataSize: SEAT_LEN }, { memcmp: { offset: S.PRESALE, bytes: presale.toBase58() } }],
    });
    return accs.map((a) => a.pubkey);
  }

  /** Seats of `presale` still delegated (owned by the delegation program on Solana). A
   *  getProgramAccounts answer can lag, so each one is read again. */
  async delegatedSeats(presale) {
    const keys = await this.listDelegatedSeats(presale);
    const now = await accountsOf(this.l1, keys);
    return keys.filter((_, i) => now[i]?.owner.equals(DELEGATION_PROGRAM));
  }

  /** Home seats of `presale`, decoded, with `key`. Read again after the listing, which
   *  can lag (a seat that already closed would block the close forever). */
  async homeSeats(presale) {
    const keys = await this.listHomeSeats(presale);
    const now = await accountsOf(this.l1, keys);
    return keys.flatMap((key, i) => {
      const a = now[i];
      return a?.owner.equals(this.pid) && a.data.length === SEAT_LEN ? [{ key, ...decodeSeat(a.data) }] : [];
    });
  }

  /** How many seats of `presale` still exist, home or delegated. A seat only moves
   *  delegated -> home -> closed, so the delegated listing goes first: a seat that moves
   *  while the two listings run is still in one of them. Then every listed key is read
   *  once, at one moment, and counted wherever it is. */
  async seatsLeft(presale) {
    const listed = [...(await this.listDelegatedSeats(presale)), ...(await this.listHomeSeats(presale))];
    const keys = [...new Map(listed.map((k) => [k.toBase58(), k])).values()];
    const now = await accountsOf(this.l1, keys);
    return now.filter((a) => a && (a.owner.equals(DELEGATION_PROGRAM) || (a.owner.equals(this.pid) && a.data.length === SEAT_LEN))).length;
  }

  // ---- sends ----

  /** Simulate, then send on Solana. Returns what it sent (`what`, with the count it really
   *  sent), or null if the sim failed. One bad ix fails a whole batch, so a failed batch is
   *  tried again with only the ixs that pass alone. */
  async crank(ixs, what, presale, signers = []) {
    const sim1 = (xs) => simulate(this.l1, { ixs: xs, payer: this.bot.publicKey, pid: this.pid });
    let sim = await sim1(ixs);
    if (sim.err && ixs.length > 1) {
      const ok = [];
      for (const ix of ixs) if (!(await sim1([ix])).err) ok.push(ix);
      this.say(presale, `${what}: ${ixs.length - ok.length} of ${ixs.length} fail alone (batch: ${sim.errText})`);
      if (!ok.length) return null;
      ixs = ok;
      what = what.replace(/x\d+$/, `x${ok.length}`);
      sim = await sim1(ixs);
    }
    if (sim.err) {
      this.say(presale, `${what}: skipped, simulation says ${sim.errText}`);
      return null;
    }
    const sig = await send(this.l1, { ixs, payer: this.bot, signers, pid: this.pid, what });
    this.say(presale, `${what}: ${sig}`);
    return what;
  }

  async sendEr(validator, ixs, what, presale) {
    const sig = await send(this.er(validator), { ixs, payer: this.bot, legacy: true, pid: this.pid, what, timeoutMs: 30_000 });
    this.say(presale, `${what} (ER): ${sig}`);
    return sig;
  }

  isRecent(key) {
    const t = this.recent.get(key);
    return t && Date.now() - t < RECENT_MS;
  }

  // ---- one step for one presale ----

  /** Advances `presale` by one lane. Returns { state, did, done }. */
  async tick(presale) {
    const acc = await this.l1.getAccountInfo(presale);
    if (!acc) return { state: "CLOSED", did: [], done: true };
    if (acc.owner.equals(DELEGATION_PROGRAM)) return this.inEr(presale, decodePresale(acc.data));
    if (!acc.owner.equals(this.pid)) throw new Error(`${presale.toBase58()} is not a presale of this program`);
    return this.atHome(presale, decodePresale(acc.data));
  }

  async inEr(presale, snap) {
    if (!this.hasEr(snap.validator)) return { state: "IN_ER", did: [], wait: `no ER endpoint for ${snap.validator.toBase58()}` };
    const er = this.er(snap.validator);
    const ea = await er.getAccountInfo(presale);
    if (!ea) throw new Error(`presale ${presale.toBase58()} is delegated but the ER doesn't have it`);
    const p = decodePresale(ea.data);
    const state = STATE_NAME[p.state];
    if (p.state === STATE.OPEN) {
      if (this.now() < p.deadlineTs) return { state, did: [], wait: p.deadlineTs - this.now() };
      await this.sendEr(snap.validator, [I.expire(this.pid, { presale })], "expire", presale);
      return { state, did: ["expire"] };
    }
    if (this.isRecent(`home:${presale}`)) return { state, did: [], wait: "commit landing" };
    const did = await this.commitSeatsHome(presale, snap.validator);
    await this.sendEr(snap.validator, [I.commitPresale(this.pid, { payer: this.bot.publicKey, presale })], "commit_presale", presale);
    this.recent.set(`home:${presale}`, Date.now());
    return { state, did: [...did, "commit_presale"] };
  }

  /** The seats among `keys` that the ER holds as delegated seats of `presale`. A
   *  getProgramAccounts answer can lag (devnet listed a seat that had already gone home
   *  and closed), and one stale seat fails the whole commit_seats batch. */
  async liveInEr(validator, presale, keys) {
    const accs = await accountsOf(this.er(validator), keys);
    return keys.filter((k, i) => {
      const a = accs[i];
      return a?.owner.equals(this.pid) && a.data.length === SEAT_LEN && a.data[0] === SEAT_VERSION && decodeSeat(a.data).presale.equals(presale);
    });
  }

  async commitSeatsHome(presale, validator) {
    if (this.isRecent(`seats:${presale}`)) return [];
    const seats = await this.liveInEr(validator, presale, await this.delegatedSeats(presale));
    for (const b of chunks(seats, this.batch.commit)) {
      await this.sendEr(validator, [I.commitSeats(this.pid, { payer: this.bot.publicKey, presale, seats: b })], `commit_seats x${b.length}`, presale);
    }
    if (seats.length) this.recent.set(`seats:${presale}`, Date.now());
    return seats.length ? [`commit_seats x${seats.length}`] : [];
  }

  async atHome(presale, p) {
    const state = STATE_NAME[p.state];
    const did = [];
    const pid = this.pid;
    const me = this.bot.publicKey;

    // seats that joined after the ER locked the presale are still in the ER. A full
    // presale does this only when committed seats are missing: the listing can take long
    // on a busy RPC, and the launch has a deadline.
    if (p.state !== STATE.OPEN && p.state !== STATE.FULL) did.push(...(await this.seatsStillInEr(presale, p)));

    switch (p.state) {
      case STATE.OPEN: {
        // never delegated (local runs without an ER)
        if (this.now() < p.deadlineTs) return { state, did, wait: p.deadlineTs - this.now() };
        if (await this.crank([I.expire(pid, { presale })], "expire", presale)) did.push("expire");
        return { state, did };
      }
      case STATE.FULL: {
        if (this.now() >= p.fullTs + this.n.GRACE) {
          if (await this.crank([I.fail(pid, { presale })], "fail", presale)) did.push("fail");
          return { state, did };
        }
        // the presale's own counters say when every seat is settled: then the launch
        // goes out with no listing in front of it
        let now = p;
        if (now.seatsSettled < now.seatsCommitted) {
          const open = (await this.homeSeats(presale)).filter((s) => !s.settled);
          if (open.length) {
            did.push(...(await this.settleSeats(presale, open)));
            now = decodePresale((await this.l1.getAccountInfo(presale)).data);
            if (now.seatsSettled < now.seatsCommitted) return { state, did, wait: "settles landing" };
          } else {
            did.push(...(await this.seatsStillInEr(presale, p))); // committed seats that didn't come home
            return { state, did, wait: `${now.seatsCommitted - now.seatsSettled} committed seat(s) not home` };
          }
        }
        if (now.state !== STATE.FULL || this.now() >= now.fullTs + this.n.GRACE) return { state, did }; // the next tick fails it
        await this.launch(presale, now);
        did.push("launch");
        return { state, did };
      }
      case STATE.SETTLED: {
        // DBC charges the snipe tax on sells too (its fee scheduler ignores the direction),
        // so presale tokens are delivered only after it: nobody from the presale can sell
        // into it. The web app has no claim of its own; claim is permissionless on chain.
        const left = await this.snipeTaxLeft(p.mint);
        if (left > 0) return { state, did, wait: left };
        const seats = await this.homeSeats(presale);
        this.seatsRead(presale, p, seats);
        const claimable = seats.filter((s) => s.settled && s.commit > 0n);
        const empty = seats.filter((s) => s.commit === 0n);
        for (const b of chunks(claimable, this.batch.claim)) {
          const ixs = b.map((s) => I.claim(pid, { cranker: me, presale, user: s.user, mint: p.mint }));
          const sent = await this.crank(ixs, `claim x${b.length}`, presale);
          if (sent) did.push(sent);
        }
        if (empty.length) did.push(...(await this.settleSeats(presale, empty)));
        const now = decodePresale((await this.l1.getAccountInfo(presale)).data);
        if (now.claimsDone === now.seatsCommitted) return this.closeWhenEmpty(presale, p, state, did);
        return { state, did };
      }
      case STATE.EXPIRED:
      case STATE.FAILED: {
        const seats = await this.homeSeats(presale);
        if (seats.length) did.push(...(await this.settleSeats(presale, seats)));
        const now = decodePresale((await this.l1.getAccountInfo(presale)).data);
        if (now.seatsRefunded === now.seatsCommitted) return this.closeWhenEmpty(presale, p, state, did);
        return { state, did };
      }
      default:
        return { state, did };
    }
  }

  /** Hands `seats` to `onSeats`, if there is one; what it throws or rejects is logged and
   *  goes no further. */
  seatsRead(presale, p, seats) {
    if (!this.onSeats) return;
    const failed = (e) => this.say(presale, `onSeats: ${e?.message ?? e}`);
    try {
      this.onSeats(presale, p, seats)?.catch?.(failed);
    } catch (e) {
      failed(e);
    }
  }

  /** Seconds until the claims may go: the pool's snipe tax plus TAX_MARGIN_S, by the
   *  chain's clock (the one the pool's fee reads). 0 when this config has no pool for
   *  `mint`, i.e. it launched on another DBC config. */
  async snipeTaxLeft(mint) {
    const { pool } = poolAddresses(this.dbcConfig, mint);
    const [pa, clock] = await this.l1.getMultipleAccountsInfo([pool, SYSVAR_CLOCK_PUBKEY]);
    const s = pa && D.decodePoolState(pa.data);
    if (!s || !clock) return 0;
    const chainNow = clock.data.readBigInt64LE(32); // Clock.unix_timestamp
    return Math.max(0, Number(s.activationPoint - chainNow) + D.CURVE.SNIPE_S + TAX_MARGIN_S);
  }

  /** Brings home the seats of `presale` still in the ER. Without an endpoint for its
   *  validator only this step waits; the lanes still run. */
  async seatsStillInEr(presale, p) {
    if (p.validator.equals(PublicKey.default)) return [];
    if (this.hasEr(p.validator)) return this.commitSeatsHome(presale, p.validator);
    if (!this.warned.has(`${presale}`)) {
      this.warned.add(`${presale}`);
      this.say(presale, `no ER endpoint for ${p.validator.toBase58()}: late seats stay in the ER`);
    }
    return [];
  }

  /** Closes `presale` once no seat of it is left anywhere (a late seat still holds its
   *  deposit, and nothing lists a seat once its presale is gone). */
  async closeWhenEmpty(presale, p, state, did) {
    const left = await this.seatsLeft(presale);
    if (left) return { state, did, wait: `${left} seat(s) left before the close` };
    if (await this.crank([I.closePresale(this.pid, { presale, creator: p.creator, mint: p.mint })], "close_presale", presale)) did.push("close");
    return { state, did };
  }

  async settleSeats(presale, seats) {
    const did = [];
    for (const b of chunks(seats, this.batch.settle)) {
      const ixs = b.map((s) => I.settleSeat(this.pid, { cranker: this.bot.publicKey, seat: s.key, user: s.user, presale }));
      const sent = await this.crank(ixs, `settle_seat x${b.length}`, presale);
      if (sent) did.push(sent);
    }
    return did;
  }

  // ---- the launch ----

  /** What release will move to the pot, computed the way the program does (from the
   *  ledger, not the balance), with the account sizes from a dry run of the pool
   *  creation. Returns { released, cost, reserve, sizes }. */
  async planRelease(presale, p, meta) {
    const bot = this.bot.publicKey;
    const { pool, base, quote } = poolAddresses(this.dbcConfig, p.mint);
    const vault = vaultOf(presale, p.mint);
    const dry = await simulate(this.l1, {
      ixs: [
        D.initPool({ config: this.dbcConfig, creator: bot, mint: p.mint, payer: bot, ...meta }),
        D.createAta({ payer: bot, owner: presale, mint: p.mint, tokenProgram: TOKEN22 }),
      ],
      payer: bot,
      accounts: [p.mint, pool, base, quote, vault],
    });
    if (dry.err) throw new Error(`pool dry run failed: ${dry.errText}\n${dry.logs.join("\n")}`);
    const sizes = dry.accounts.map((a) => a.data.length);
    const rents = await Promise.all(sizes.map((l) => this.rent(l)));
    const cost = rents.reduce((a, b) => a + b, LAUNCH_TX_FEE);
    if (cost > LAUNCH_COST_CAP) throw new Error(`launch cost ${cost} over the cap`);
    const reserve = p.seatsCommitted * ((await this.rent(sizes[4])) + TX_FEE);
    const released = p.settledSum - p.feesPaid - cost - reserve;
    if (released <= 0n) throw new Error("nothing to release");
    const lamports = BigInt((await this.l1.getAccountInfo(presale)).lamports);
    if (lamports < (await this.rent(PRESALE_LEN)) + reserve + cost + released) throw new Error("the presale holds less than its ledger");
    return { released, cost, reserve, sizes };
  }

  async launch(presale, p) {
    const need = launchAltKeys(this.pid, this.dbcConfig);
    if (!need.every((k) => this.alts.some((t) => t.state.addresses.some((a) => a.equals(k))))) throw new Error("the launch needs its lookup table (launchAltKeys)");
    const mintKey = this.mintSigner?.(p.mint, p.creator);
    if (!mintKey?.publicKey.equals(p.mint)) throw new Error(`no mint key for ${p.mint.toBase58()}`);
    const meta = await this.tokenMeta(p.mint);
    const { released, cost } = await this.planRelease(presale, p, meta);
    const pot = Keypair.generate();
    const base = { pid: this.pid, bot: this.bot.publicKey, pot: pot.publicKey, presale, p, dbcConfig: this.dbcConfig, meta, released };
    const vault = vaultOf(presale, p.mint);

    const sim = await simulate(this.l1, {
      ixs: launchIxs({ ...base, minTokens: 1n, cuLimit: 1_400_000 }),
      payer: this.bot.publicKey,
      alts: this.alts,
      accounts: [vault],
      pid: this.pid,
    });
    if (sim.err) throw new Error(`launch simulation failed: ${sim.errText}\n${sim.logs.join("\n")}`);
    const tokens = tokenAmount(sim.accounts[0].data);
    const cuLimit = Math.min(1_400_000, Math.ceil(sim.units * 1.2));
    // three signatures (bot, mint, pot) come out of LAUNCH_TX_FEE; the rest may go to priority
    const budget = LAUNCH_TX_FEE - 15_000n;
    const maxPrice = Number((budget * 1_000_000n) / BigInt(cuLimit));
    const cuPrice = Math.min(this.priorityMicroLamports, maxPrice);

    const ixs = launchIxs({ ...base, minTokens: tokens, cuLimit, cuPrice });
    const sig = await send(this.l1, { ixs, payer: this.bot, signers: [mintKey, pot], alts: this.alts, pid: this.pid, what: "launch" });
    this.say(presale, `launch: ${sig} (released ${released}, cost ${cost}, ${tokens} tokens, ${sim.units} CU)`);
    return { sig, released, cost, tokens, units: sim.units };
  }
}
