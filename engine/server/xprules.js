// XP rules (spec "XP ledger"): which events give which points (POINTS, src/xp.js), from
// what the server already sees: the keeper's launch (main.js onLaunch) and the feed's
// "migrated" event call in, and a catch-up at start covers what happened while the server
// was down. Every point goes through XpLedger.award, which counts an event once, so a call
// that runs twice (a retry, the catch-up after a live event) gives nothing twice.
//
//   launch     Dev (the presale's creator), KOL (each other seat with SOL in), Raider (each
//              confirmed referral whose joiner has a seat with SOL in; never yourself)
//   migration  Dev and KOL again (whoever got them at launch), Diamond Hands (each seat whose
//              wallet still holds its presale share, or whose seat is still open: nothing
//              delivered, nothing sold)
//   co-sign    a confirmed join or open (api.js): that UTC day, for the streak
//
// Seats are read right at launch: a claim closes its seat (finish.rs), and claims start once
// the snipe tax is over, so each seat's share is kept then for the check at migration.
// Keys are base58 strings throughout.

import { PublicKey } from "@solana/web3.js";
import { decodePresale, tokenAmount } from "../src/layout.js";
import { tokenShare } from "../src/math.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `presale` as its launch left it: { creator, mint, total, raised, seats: [{ wallet,
 *  commit }] } (bigints), or null when the presale account is gone. `bot`: the keeper's Bot
 *  (homeSeats); `l1`: a Connection. */
export async function readLaunch(bot, l1, presale) {
  const key = new PublicKey(presale);
  const [seats, acc] = await Promise.all([bot.homeSeats(key), l1.getAccountInfo(key)]);
  if (!acc) return null;
  const p = decodePresale(acc.data);
  return {
    creator: p.creator.toBase58(),
    mint: p.mint.toBase58(),
    total: p.totalTokens,
    raised: p.raised,
    seats: seats.map((s) => ({ wallet: s.user.toBase58(), commit: s.commit })),
  };
}

/** The wallets whose seat in `presale` is still open (not claimed: no tokens delivered). */
export async function openSeats(bot, presale) {
  return (await bot.homeSeats(new PublicKey(presale))).map((s) => s.user.toBase58());
}

/** How much of `mint` `wallet` holds, over all its token accounts for it (a bigint). */
export async function holds(l1, wallet, mint) {
  const r = await l1.getTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(mint) });
  return r.value.reduce((n, a) => n + tokenAmount(a.account.data), 0n);
}

export class XpRules {
  /**
   * `ledger`: an XpLedger. `referrals`: Referrals. `readLaunch(presale)`, `openSeats(presale)`,
   * `holds(wallet, mint)`: the reads above, bound to the server's bot and connection.
   * `launches()`: every launch ({ presale, mint }, store.launches). `isMigrated(mint)`: the
   * feed knows the coin's DBC pool migrated. `onChange(wallets)`: their rows changed.
   */
  constructor({ ledger, referrals, readLaunch, openSeats, holds, launches, isMigrated, onChange = () => {}, now = Date.now, log = console.log, tries = 3, retryMs = 500 }) {
    Object.assign(this, { ledger, referrals, readLaunch, openSeats, holds, launches, isMigrated, onChange, now, log, tries, retryMs });
  }

  /** A confirmed join or open by `wallet` at `at` (ms), from api.js: a streak day. */
  active(wallet, at) {
    if (this.ledger.active(wallet, at)) this.onChange([wallet]);
  }

  /** `presale` just launched (or launched while nobody counted it). */
  async launched(presale) {
    if (this.ledger.done(presale, "launch")) return;
    let l;
    for (let i = 1; ; i++) {
      try {
        l = await this.readLaunch(presale);
        break;
      } catch (e) {
        if (i >= this.tries) return this.log(`xp: couldn't read ${presale} at launch: ${e?.message ?? e}`);
        await sleep(this.retryMs);
      }
    }
    const at = this.now();
    if (!l) {
      this.log(`xp: presale ${presale} is gone, nothing to count at launch`);
      return this.ledger.markDone(presale, "launch", at);
    }
    const changed = new Set();
    const give = (wallet, reason, ref) => this.ledger.award(wallet, reason, ref, at) && changed.add(wallet);
    const paid = l.seats.filter((s) => s.commit > 0n);
    give(l.creator, "devLaunch", presale);
    for (const s of paid) if (s.wallet !== l.creator) give(s.wallet, "kolLaunch", presale);
    const seated = new Set(paid.map((s) => s.wallet));
    for (const r of this.referrals.confirmedIn(presale)) {
      if (seated.has(r.user) && r.referrer !== r.user) give(r.referrer, "raiderJoin", `${presale}:${r.user}`);
    }
    this.ledger.keepSeats(presale, l.mint, paid.map((s) => ({ wallet: s.wallet, tokens: tokenShare(l.total, 0n, s.commit, l.raised, false) })));
    this.ledger.markDone(presale, "launch", at);
    if (changed.size) this.onChange([...changed]);
  }

  /** `presale`'s coin migrated. */
  async migrated(presale) {
    if (this.ledger.done(presale, "migrate")) return;
    await this.launched(presale);
    if (!this.ledger.done(presale, "launch")) return; // its seats are still unread: the next start
    const at = this.now();
    const changed = new Set();
    const give = (wallet, reason) => this.ledger.award(wallet, reason, presale, at) && changed.add(wallet);
    for (const w of this.ledger.walletsWith("devLaunch", presale)) give(w, "devMigrate");
    for (const w of this.ledger.walletsWith("kolLaunch", presale)) give(w, "kolMigrate");
    const seats = this.ledger.seatsOf(presale).filter((s) => s.tokens > 0n);
    try {
      const open = new Set(seats.length ? await this.openSeats(presale) : []);
      for (const s of seats) {
        if (open.has(s.wallet) || (await this.holds(s.wallet, s.mint)) >= s.tokens) give(s.wallet, "diamondMigrate");
      }
      this.ledger.markDone(presale, "migrate", at);
    } catch (e) {
      this.log(`xp: couldn't read holdings for ${presale} at migration: ${e?.message ?? e}`);
    }
    if (changed.size) this.onChange([...changed]);
  }

  /** At start, after the feed read its pools: each launch not counted, and each migration. */
  async catchUp() {
    for (const l of this.launches()) {
      try {
        await this.launched(l.presale);
        if (!this.ledger.done(l.presale, "migrate") && this.isMigrated(l.mint)) await this.migrated(l.presale);
      } catch (e) {
        this.log(`xp: catch-up ${l.presale}: ${e?.message ?? e}`);
      }
    }
  }
}
