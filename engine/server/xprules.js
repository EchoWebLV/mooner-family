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
// Seats are counted before any claim: a claim closes its seat (finish.rs), so the keeper hands
// over the seats it reads right before its claims (keeperHooks onSeats -> seatsRead), and the
// read the launch starts (onLaunch -> launched) stays as the fallback. Whichever comes first
// counts the launch and keeps each seat's share for the check at migration; the other adds
// nothing. Keys are base58 strings throughout.

import { PublicKey } from "@solana/web3.js";
import { decodePresale, tokenAmount } from "../src/layout.js";
import { tokenShare } from "../src/math.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A launch as the rules count it, { creator, mint, total, raised, seats: [{ wallet, commit
 *  }] } (bigints), from a decoded presale `p` and its seats as Bot.homeSeats reads them. */
export function launchOf(p, seats) {
  return {
    creator: p.creator.toBase58(),
    mint: p.mint.toBase58(),
    total: p.totalTokens,
    raised: p.raised,
    seats: seats.map((s) => ({ wallet: s.user.toBase58(), commit: s.commit })),
  };
}

/** `presale` as its launch left it (launchOf), or null when the presale account is gone.
 *  `bot`: the keeper's Bot (homeSeats); `l1`: a Connection. */
export async function readLaunch(bot, l1, presale) {
  const key = new PublicKey(presale);
  const [seats, acc] = await Promise.all([bot.homeSeats(key), l1.getAccountInfo(key)]);
  if (!acc) return null;
  return launchOf(decodePresale(acc.data), seats);
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

  /** `read()`, tried `tries` times `retryMs` apart: { value }, or null once the last try
   *  failed (`failed(e)` is told). */
  async retried(read, failed) {
    for (let i = 1; ; i++) {
      try {
        return { value: await read() };
      } catch (e) {
        if (i >= this.tries) {
          failed(e);
          return null;
        }
        await sleep(this.retryMs);
      }
    }
  }

  /** `presale` just launched (or launched while nobody counted it): its seats are read, and
   *  the launch counted from them (count). */
  async launched(presale) {
    if (this.ledger.done(presale, "launch")) return;
    const got = await this.retried(() => this.readLaunch(presale), (e) => this.log(`xp: couldn't read ${presale} at launch: ${e?.message ?? e}`));
    if (!got) return;
    if (got.value) return this.count(presale, got.value);
    this.log(`xp: presale ${presale} is gone, nothing to count at launch`);
    this.ledger.markDone(presale, "launch", this.now());
  }

  /** The keeper read `presale`'s seats right before it claims them (`l`: launchOf): the
   *  launch counts from them, unless it already counted. */
  seatsRead(presale, l) {
    this.count(presale, l);
  }

  /** Counts `presale`'s launch from `l` (launchOf) in one write: Dev, KOL, Raider, each seat's
   *  share kept, and the launch marked done. Nothing when it's done already. */
  count(presale, l) {
    if (this.ledger.done(presale, "launch")) return;
    const at = this.now();
    const changed = new Set();
    const give = (wallet, reason, ref) => this.ledger.award(wallet, reason, ref, at) && changed.add(wallet);
    this.ledger.atomic(() => {
      const paid = l.seats.filter((s) => s.commit > 0n);
      give(l.creator, "devLaunch", presale);
      for (const s of paid) if (s.wallet !== l.creator) give(s.wallet, "kolLaunch", presale);
      const seated = new Set(paid.map((s) => s.wallet));
      for (const r of this.referrals.confirmedIn(presale)) {
        if (seated.has(r.user) && r.referrer !== r.user) give(r.referrer, "raiderJoin", `${presale}:${r.user}`);
      }
      this.ledger.keepSeats(presale, l.mint, paid.map((s) => ({ wallet: s.wallet, tokens: tokenShare(l.total, 0n, s.commit, l.raised, false) })));
      this.ledger.markDone(presale, "launch", at);
    });
    if (changed.size) this.onChange([...changed]);
  }

  /** `presale`'s coin migrated. */
  async migrated(presale) {
    if (this.ledger.done(presale, "migrate")) return;
    await this.launched(presale);
    if (!this.ledger.done(presale, "launch")) return; // its seats are still unread: the next start
    const seats = this.ledger.seatsOf(presale).filter((s) => s.tokens > 0n);
    const diamonds = async () => {
      const open = new Set(seats.length ? await this.openSeats(presale) : []);
      const out = [];
      for (const s of seats) if (open.has(s.wallet) || (await this.holds(s.wallet, s.mint)) >= s.tokens) out.push(s.wallet);
      return out;
    };
    const got = await this.retried(diamonds, (e) => this.log(`xp: couldn't read holdings for ${presale} at migration: ${e?.message ?? e}`));
    const at = this.now();
    const changed = new Set();
    const give = (wallet, reason) => this.ledger.award(wallet, reason, presale, at) && changed.add(wallet);
    this.ledger.atomic(() => {
      for (const w of this.ledger.walletsWith("devLaunch", presale)) give(w, "devMigrate");
      for (const w of this.ledger.walletsWith("kolLaunch", presale)) give(w, "kolMigrate");
      if (!got) return; // Diamond Hands waits for the next start
      for (const w of got.value) give(w, "diamondMigrate");
      this.ledger.markDone(presale, "migrate", at);
    });
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

/** The keeper's hooks on a server that counts XP (main.js). `onLaunch(presale)`: the feed and
 *  the rules each hear it on their own, so neither can stop the other, and nothing either
 *  throws reaches the keeper. `onSeats(presale, p, seats)`: the seats the keeper read right
 *  before its claims count the launch (XpRules.seatsRead). Problems are logged. */
export function keeperHooks({ feed, rules, log }) {
  const msg = (e) => e?.message ?? e;
  return {
    onLaunch(presale) {
      const k = presale.toBase58();
      try {
        feed.launched(presale);
      } catch (e) {
        log(`live: launched ${k}: ${msg(e)}`);
      }
      try {
        Promise.resolve(rules.launched(k)).catch((e) => log(`xp: launched ${k}: ${msg(e)}`));
      } catch (e) {
        log(`xp: launched ${k}: ${msg(e)}`);
      }
    },
    onSeats(presale, p, seats) {
      try {
        rules.seatsRead(presale.toBase58(), launchOf(p, seats));
      } catch (e) {
        log(`xp: seats of ${presale.toBase58()}: ${msg(e)}`);
      }
    },
  };
}
