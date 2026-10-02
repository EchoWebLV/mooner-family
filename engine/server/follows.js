// Who follows whom, kept in the server's SQLite beside the chat. Following is public, as on
// a Mooner's card: anyone's lists ride the socket's `follows:<wallet>` topic (feed.js).
//
//   POST /api/follow     { token, wallet }  -> { wallet, following, followers }  (yours)
//   POST /api/unfollow   { token, wallet }  -> the same
//
// `token` is a Mooner sign-in (social.js /api/login). alerts.js reads followersOf to tell a
// wallet's followers when it joins or opens a presale.

import { HttpError, Limiter, limit } from "./http.js";
import { parseKey } from "./api.js";
import { makeSessions } from "./social.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS follows (
  follower TEXT NOT NULL,
  followee TEXT NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (follower, followee)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee, at);`;

/** How many wallets one wallet can follow; the lists show this many at most. */
export const MAX_FOLLOWING = 1_000;

export const FOLLOW_LIMITS = {
  followPerIp: [120, 600_000],
  followPerWallet: [60, 600_000],
};

const ready = new WeakSet();
function schema(db) {
  if (ready.has(db)) return;
  db.exec(SCHEMA);
  ready.add(db);
}

/** A wallet's lists, newest first: { wallet, following, followers }. */
export function followsOf(db, wallet) {
  schema(db);
  const col = (sql, k) => db.prepare(sql).all(wallet, MAX_FOLLOWING).map((r) => r[k]);
  return {
    wallet,
    following: col("SELECT followee FROM follows WHERE follower = ? ORDER BY at DESC, followee LIMIT ?", "followee"),
    followers: col("SELECT follower FROM follows WHERE followee = ? ORDER BY at DESC, follower LIMIT ?", "follower"),
  };
}

/** Every wallet that follows `wallet`. */
export function followersOf(db, wallet) {
  schema(db);
  return db.prepare("SELECT follower FROM follows WHERE followee = ?").all(wallet).map((r) => r.follower);
}

/** The routes. `onFollow(wallet)` hears each wallet whose lists changed (both sides of a
 *  follow), so the live feed can push them. */
export function makeFollowRoutes({ store, onFollow = () => {}, limits = FOLLOW_LIMITS, now = Date.now }) {
  const db = store.db;
  schema(db);
  const { walletOf } = makeSessions(db, now);
  const L = Object.fromEntries(Object.entries(limits).map(([k, [max, ms]]) => [k, new Limiter(max, ms, now)]));

  const change = (on) => async ({ body, ip }) => {
    limit(L.followPerIp, ip, "follows");
    const follower = walletOf(body.token);
    const followee = parseKey(body.wallet, "wallet").toBase58();
    if (followee === follower) throw new HttpError(400, "you can't follow yourself");
    limit(L.followPerWallet, follower, "follows, slow down");
    if (on) {
      const had = db.prepare("SELECT 1 FROM follows WHERE follower = ? AND followee = ?").get(follower, followee);
      const n = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower = ?").get(follower).n;
      if (!had && n >= MAX_FOLLOWING) throw new HttpError(400, `you can follow at most ${MAX_FOLLOWING} wallets`);
      db.prepare("INSERT OR IGNORE INTO follows (follower, followee, at) VALUES (?, ?, ?)").run(follower, followee, now());
    } else {
      db.prepare("DELETE FROM follows WHERE follower = ? AND followee = ?").run(follower, followee);
    }
    for (const w of [follower, followee]) {
      try {
        onFollow(w);
      } catch {
        // the lists are saved; a push that failed reaches them at their next snapshot
      }
    }
    return { json: followsOf(db, follower) };
  };

  return [
    { method: "POST", path: /^\/api\/follow$/, body: 1_024, handler: change(true) },
    { method: "POST", path: /^\/api\/unfollow$/, body: 1_024, handler: change(false) },
  ];
}
