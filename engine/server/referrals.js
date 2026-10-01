// Who brought whom (spec "Referral"): a join made from a shared link names the wallet that
// shared it, and the server keeps that here for each join it sends (api.js cosignRoute):
// confirmed = 1 when the join confirmed (a 200), 0 when this send went out but didn't confirm
// in time (a 202). A repeat of a tx that already went out gets an early 202 and writes
// nothing: its first send did. One row per seat (presale, joiner). A confirmed row is never
// replaced; an unconfirmed one gives way to the seat's next join, so a 202 that never landed
// can't block the referrer of a later join that did. Points for it (the Raider title) come
// later, from this table, and only for seats still there when the presale launches (piece 6):
// that check also settles an unconfirmed row whose join never landed. Nothing here moves SOL.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS referrals (
  presale   TEXT NOT NULL,
  user      TEXT NOT NULL,
  referrer  TEXT NOT NULL,
  sig       TEXT NOT NULL,
  at        INTEGER NOT NULL,
  confirmed INTEGER NOT NULL,
  PRIMARY KEY (presale, user)
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer);`;

const ADD = `
INSERT INTO referrals (presale, user, referrer, sig, at, confirmed) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (presale, user) DO UPDATE SET
  referrer = excluded.referrer, sig = excluded.sig, at = excluded.at, confirmed = excluded.confirmed
WHERE referrals.confirmed = 0`;

export class Referrals {
  /** `db`: the server's node:sqlite database (store.db). */
  constructor(db) {
    this.db = db;
    db.exec(SCHEMA);
  }

  /** `referrer` brought `user` into `presale` with the join tx `sig` (PublicKeys in), at `at`
   *  (ms). `confirmed`: the join confirmed (a 200); false when it was sent but not confirmed
   *  in time (a 202). A confirmed row stays; an unconfirmed one takes this join's. */
  add(presale, user, referrer, sig, at, confirmed) {
    this.db.prepare(ADD).run(presale.toBase58(), user.toBase58(), referrer.toBase58(), sig, at, confirmed ? 1 : 0);
  }

  /** The seat's row: { referrer (base58), sig, at, confirmed (a boolean) }, or null. */
  referralOf(presale, user) {
    const r = this.db.prepare("SELECT referrer, sig, at, confirmed FROM referrals WHERE presale = ? AND user = ?").get(presale.toBase58(), user.toBase58());
    return r ? { referrer: r.referrer, sig: r.sig, at: r.at, confirmed: r.confirmed === 1 } : null;
  }
}
