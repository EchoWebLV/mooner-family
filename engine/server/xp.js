// The XP ledger (spec "XP ledger"): every point a wallet earned, one row per event, kept
// beside the referrals in the server's SQLite file. `UNIQUE (wallet, reason, ref)` is what
// keeps an event from counting twice (a restart, a catch-up, a repeat), so callers just
// award and let the table say whether it was new. What each event is worth is POINTS
// (src/xp.js); the rules that award them are xprules.js. Nothing here reads the chain.

import { POINTS, TITLES, streakOf, utcDay } from "../src/xp.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS xp (
  wallet TEXT NOT NULL,
  title  TEXT,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref    TEXT NOT NULL,
  at     INTEGER NOT NULL,
  UNIQUE (wallet, reason, ref)
);
CREATE INDEX IF NOT EXISTS xp_wallet ON xp (wallet);
CREATE TABLE IF NOT EXISTS activity (
  wallet TEXT NOT NULL,
  day    INTEGER NOT NULL,
  PRIMARY KEY (wallet, day)
);
CREATE TABLE IF NOT EXISTS genesis (
  mint   TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS genesis_wallet ON genesis (wallet);
CREATE TABLE IF NOT EXISTS xp_seats (
  presale TEXT NOT NULL,
  mint    TEXT NOT NULL,
  wallet  TEXT NOT NULL,
  tokens  TEXT NOT NULL,
  PRIMARY KEY (presale, wallet)
);
CREATE TABLE IF NOT EXISTS xp_events (
  presale TEXT NOT NULL,
  event   TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (presale, event)
);`;

const COUNTED = Object.keys(POINTS).filter((r) => POINTS[r].title !== null);

export class XpLedger {
  /** `db`: the server's node:sqlite database (store.db). */
  constructor(db) {
    this.db = db;
    db.exec(SCHEMA);
  }

  /** `reason` (a POINTS key) for `wallet` (base58), once per `ref` (a presale, or a
   *  presale and a joiner), at `at` (ms). True when it counted, false when it already had. */
  award(wallet, reason, ref, at) {
    const p = POINTS[reason];
    if (!p) throw new Error(`no points for ${reason}`);
    const sql = "INSERT INTO xp (wallet, title, points, reason, ref, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (wallet, reason, ref) DO NOTHING";
    return Number(this.db.prepare(sql).run(wallet, p.title, p.points, reason, ref, at).changes) === 1;
  }

  /** The wallets that got `reason` for `ref`, by wallet. */
  walletsWith(reason, ref) {
    return this.db.prepare("SELECT wallet FROM xp WHERE reason = ? AND ref = ? ORDER BY wallet").all(reason, ref).map((r) => r.wallet);
  }

  /** A confirmed join or open by `wallet` at `at` (ms): its UTC day counts for the streak.
   *  True when the day is new for this wallet. */
  active(wallet, at) {
    const sql = "INSERT INTO activity (wallet, day) VALUES (?, ?) ON CONFLICT (wallet, day) DO NOTHING";
    return Number(this.db.prepare(sql).run(wallet, utcDay(at)).changes) === 1;
  }

  /** The seats of `presale` (base58) at launch, with the coin `mint`: [{ wallet, tokens
   *  (a bigint, the presale's share) }]. The first keep for a seat stays. */
  keepSeats(presale, mint, seats) {
    const st = this.db.prepare("INSERT INTO xp_seats (presale, mint, wallet, tokens) VALUES (?, ?, ?, ?) ON CONFLICT (presale, wallet) DO NOTHING");
    for (const s of seats) st.run(presale, mint, s.wallet, s.tokens.toString());
  }

  /** The seats kept for `presale`: [{ wallet, mint, tokens (a bigint) }], by wallet. */
  seatsOf(presale) {
    const rows = this.db.prepare("SELECT wallet, mint, tokens FROM xp_seats WHERE presale = ? ORDER BY wallet").all(presale);
    return rows.map((r) => ({ wallet: r.wallet, mint: r.mint, tokens: BigInt(r.tokens) }));
  }

  /** `event` ("launch" or "migrate") was fully counted for `presale`. */
  done(presale, event) {
    return !!this.db.prepare("SELECT 1 FROM xp_events WHERE presale = ? AND event = ?").get(presale, event);
  }

  markDone(presale, event, at) {
    this.db.prepare("INSERT INTO xp_events (presale, event, at) VALUES (?, ?, ?) ON CONFLICT (presale, event) DO NOTHING").run(presale, event, at);
  }

  /** The wallet's Genesis claim, { mint, at }, or null. */
  genesisOf(wallet) {
    const r = this.db.prepare("SELECT mint, at FROM genesis WHERE wallet = ? ORDER BY at LIMIT 1").get(wallet);
    return r ? { mint: r.mint, at: r.at } : null;
  }

  /** `wallet` holds the Genesis mint `mint`. The perk goes once per wallet and once per
   *  mint: { mint, at, fresh } (the wallet's claim; fresh when this call made it), or
   *  { taken: <the wallet that has this mint's claim> }. */
  claimGenesis(mint, wallet, at) {
    const mine = this.genesisOf(wallet);
    if (mine) return { ...mine, fresh: false };
    const owner = this.db.prepare("SELECT wallet FROM genesis WHERE mint = ?").get(mint);
    if (owner) return { taken: owner.wallet };
    this.db.prepare("INSERT INTO genesis (mint, wallet, at) VALUES (?, ?, ?)").run(mint, wallet, at);
    this.award(wallet, "genesis", mint, at);
    return { mint, at, fresh: true };
  }

  /** The wallet's XP row (see the plan's "Server data shapes") as of `now` (ms). */
  row(wallet, now) {
    const titles = Object.fromEntries(TITLES.map((t) => [t, 0]));
    const counts = Object.fromEntries(COUNTED.map((r) => [r, 0]));
    let total = 0;
    const sums = this.db.prepare("SELECT reason, title, SUM(points) AS points, COUNT(*) AS n FROM xp WHERE wallet = ? GROUP BY reason, title").all(wallet);
    for (const r of sums) {
      total += r.points;
      if (r.title in titles) titles[r.title] += r.points;
      if (r.reason in counts) counts[r.reason] += r.n;
    }
    const days = this.db.prepare("SELECT day FROM activity WHERE wallet = ?").all(wallet).map((r) => r.day);
    return { wallet, total, titles, counts, streak: streakOf(days, utcDay(now)), genesis: this.genesisOf(wallet) };
  }

  /** The rows of `wallets`, each wallet once, in the order given. */
  rows(wallets, now) {
    return [...new Set(wallets)].map((w) => this.row(w, now));
  }

  /** The top `limit` wallets by total (ties by wallet), wallets with only streak days
   *  included at 0: their rows. */
  board(limit, now) {
    const sql = `SELECT wallet, SUM(points) AS total FROM (SELECT wallet, points FROM xp UNION ALL SELECT wallet, 0 FROM activity)
      GROUP BY wallet ORDER BY total DESC, wallet ASC LIMIT ?`;
    return this.db.prepare(sql).all(limit).map((r) => this.row(r.wallet, now));
  }
}
