// Raider XP from X (POINTS raiderPost, raiderRepost, raiderHit in src/xp.js): what linked X
// accounts (xlink.js) post about the coins Mooner launched, read through Sorsa (sorsa.js) the way
// the jackpot keeper reads its shillers.
//
//   posts    a search for a few coins at a time, $TICKER or the coin's address, newest first,
//            down to what the last search saw; replies left out, quotes counted. Every post found
//            is kept for HIT_DAYS (the coin's top posts come from them). A post from a linked
//            account that passes RAIDER_FLOOR gives raiderPost, once per coin per UTC day.
//   hits     the linked accounts' posts of the last HIT_DAYS are read again in one batch; one
//            whose likes, reposts, replies and quotes reach RAIDER_HIT gives raiderHit, once
//            per coin.
//   reposts  every REPOST_MS, who reposted each coin's TOP_POSTS most-engaged posts (anyone's):
//            a linked account there gives raiderRepost, once per coin per UTC day. Not for
//            reposting your own post.
//   linking  the posts already kept from a newly linked account give what they earned right
//            away (linked), with no request.
//
// Likes can't be read: X made them private in 2024 and no API lists them, so a like counts only
// in a hit on your own post. Each ref starts with the X account's id, and an event that one X
// account already earned on one wallet isn't given to another, so moving the link doesn't pay
// twice. Nothing is spent while no X account is linked.

import { RAIDER_HIT, raiderOk, utcDay } from "../src/xp.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS x_posts (
  id      TEXT NOT NULL,
  mint    TEXT NOT NULL,
  x_id    TEXT NOT NULL,
  at      INTEGER NOT NULL,
  score   INTEGER NOT NULL,
  reposts INTEGER NOT NULL,
  hit     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, mint)
);
CREATE INDEX IF NOT EXISTS x_posts_mint ON x_posts (mint, at);
CREATE INDEX IF NOT EXISTS x_posts_author ON x_posts (x_id, at);
CREATE TABLE IF NOT EXISTS x_coins (
  mint TEXT PRIMARY KEY,
  seen INTEGER NOT NULL
);`;

const DAY = 86_400_000;
export const RAIDERS = {
  tickMs: 30 * 60_000, // a search round
  windowDays: 14, // coins launched this long ago or less are searched
  group: 4, // coins in one search
  groupsPerTick: 3, // searches in one round, the groups taken in turn
  pages: 5, // pages one search reads at most (20 posts each)
  hitDays: 3, // posts kept, and read again for hits, this long
  repostMs: 6 * 3_600_000,
  topPosts: 2,
};

const CASHTAG = /^[A-Za-z][A-Za-z0-9_]{0,14}$/;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const timeOf = (s) => Date.parse(s);
const counts = (t) => ({
  score: (t.likes_count ?? 0) + (t.retweet_count ?? 0) + (t.reply_count ?? 0) + (t.quote_count ?? 0),
  reposts: t.retweet_count ?? 0,
});
const userOk = (u, now) => !!u && raiderOk(Number(u.followers_count ?? 0), timeOf(u.created_at), now);

/** The X search for `coins` ([{ mint, symbol }]): each one's cashtag (when its symbol can be
 *  one) or its address, no replies, from the UTC day of `since` (ms) on. */
export function queryOf(coins, since) {
  const terms = coins.flatMap((c) => (CASHTAG.test(c.symbol ?? "") ? [`$${c.symbol}`, c.mint] : [c.mint]));
  return `(${terms.join(" OR ")}) -filter:replies since:${new Date(since).toISOString().slice(0, 10)}`;
}

/** Whether the post `t` names `coin`: its cashtag or its address in the text, the quoted post's
 *  text, or a link. */
export function names(t, coin) {
  const links = Array.isArray(t.entities) ? t.entities.map((e) => e?.link ?? "") : [];
  const text = [t.full_text ?? "", t.quoted_status?.full_text ?? "", ...links].join(" ");
  if (text.includes(coin.mint)) return true;
  return CASHTAG.test(coin.symbol ?? "") && new RegExp(`\\$${escape(coin.symbol)}(?![A-Za-z0-9_])`, "i").test(text);
}

export class Raiders {
  /**
   * `sorsa`: a Sorsa. `links`: XLinks. `ledger`: XpLedger (in the same db). `coins()`: the
   * launched coins, [{ mint, symbol, at (launch ms) }]. `onChange(wallets)`: their rows changed.
   */
  constructor({ sorsa, links, ledger, coins, onChange = () => {}, now = Date.now, log = console.log, opts = {} }) {
    Object.assign(this, { sorsa, links, ledger, coins, onChange, now, log, o: { ...RAIDERS, ...opts } });
    this.db = ledger.db;
    this.db.exec(SCHEMA);
    this.turn = 0; // the next group to search
    this.repostsAt = 0;
    this.timer = null;
    this.running = null;
  }

  /** Searches every tickMs, the first a minute after start. */
  start() {
    const run = () => {
      if (this.running) return;
      this.running = this.tick().catch((e) => this.log(`raiders: ${e?.message ?? e}`)).finally(() => (this.running = null));
    };
    this.first = setTimeout(run, 60_000);
    this.timer = setInterval(run, this.o.tickMs);
    return this;
  }

  async stop() {
    clearTimeout(this.first);
    clearInterval(this.timer);
    await this.running;
  }

  /** `reason` for `wallet` under `ref` (which starts with the X account's id), unless another
   *  wallet already has it under that ref. True when it counted. */
  give(wallet, reason, ref, at, changed) {
    if (this.ledger.walletsWith(reason, ref).some((w) => w !== wallet)) return false;
    const fresh = this.ledger.award(wallet, reason, ref, at);
    if (fresh) changed.add(wallet);
    return fresh;
  }

  /** One round: a few searches, the hits, and the reposts when they're due. */
  async tick() {
    if (!this.links.count()) return;
    const now = this.now();
    const coins = this.coins().filter((c) => c.at >= now - this.o.windowDays * DAY);
    this.db.prepare("DELETE FROM x_posts WHERE at < ?").run(now - this.o.hitDays * DAY);
    if (!coins.length) return;
    const changed = new Set();
    const step = async (what, fn) => {
      try {
        await fn();
      } catch (e) {
        this.log(`raiders: ${what}: ${e?.message ?? e}`);
      }
    };
    await step("posts", () => this.searchSome(coins, now, changed));
    await step("hits", () => this.hits(now, changed));
    if (now - this.repostsAt >= this.o.repostMs) {
      this.repostsAt = now;
      await step("reposts", () => this.reposts(coins, now, changed));
    }
    if (changed.size) this.onChange([...changed]);
  }

  /** groupsPerTick searches, the coins `group` at a time, taken in turn. */
  async searchSome(coins, now, changed) {
    const sorted = [...coins].sort((a, b) => a.at - b.at || (a.mint < b.mint ? -1 : 1));
    const groups = [];
    for (let i = 0; i < sorted.length; i += this.o.group) groups.push(sorted.slice(i, i + this.o.group));
    for (let k = 0; k < Math.min(this.o.groupsPerTick, groups.length); k++) {
      await this.search(groups[this.turn++ % groups.length], now, changed);
    }
  }

  /** One search for `group`, newest first, down to the oldest point any of them was seen to. */
  async search(group, now, changed) {
    const seenOf = (c) => this.db.prepare("SELECT seen FROM x_coins WHERE mint = ?").get(c.mint)?.seen ?? c.at;
    const stopAt = Math.min(...group.map(seenOf));
    const q = queryOf(group, stopAt);
    let cursor = null;
    let newest = 0;
    for (let page = 0; page < this.o.pages; page++) {
      const { tweets = [], next_cursor: next } = await this.sorsa.search(q, cursor);
      let older = false;
      for (const t of tweets) {
        const at = timeOf(t.created_at);
        if (!Number.isFinite(at)) continue;
        newest = Math.max(newest, at);
        if (at <= stopAt) older = true; // reached what an earlier search saw
        this.found(t, at, group, now, changed);
      }
      if (!tweets.length || older || !next) break;
      cursor = next;
    }
    const seen = this.db.prepare("INSERT INTO x_coins (mint, seen) VALUES (?, ?) ON CONFLICT (mint) DO UPDATE SET seen = MAX(seen, excluded.seen)");
    for (const c of group) seen.run(c.mint, Math.max(newest, seenOf(c)));
  }

  /** A post the search found: kept for each coin of `group` it names, and what it earns. */
  found(t, at, group, now, changed) {
    if (t.is_reply || t.in_reply_to_tweet_id || t.retweeted_status || !t.user?.id) return;
    const xid = String(t.user.id);
    const { score, reposts } = counts(t);
    const wallet = this.links.walletOfX(xid);
    const ok = wallet && userOk(t.user, now);
    const keep = this.db.prepare(`INSERT INTO x_posts (id, mint, x_id, at, score, reposts) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id, mint) DO UPDATE SET score = excluded.score, reposts = excluded.reposts`);
    for (const c of group) {
      if (at < c.at || !names(t, c)) continue;
      keep.run(String(t.id), c.mint, xid, at, score, reposts);
      if (!ok) continue;
      this.give(wallet, "raiderPost", `${xid}:${c.mint}:${utcDay(at)}`, now, changed);
      if (score >= RAIDER_HIT) this.hit(wallet, xid, String(t.id), c.mint, now, changed);
    }
  }

  hit(wallet, xid, id, mint, now, changed) {
    this.give(wallet, "raiderHit", `${xid}:${mint}`, now, changed);
    this.db.prepare("UPDATE x_posts SET hit = 1 WHERE id = ? AND mint = ?").run(id, mint);
  }

  /** The linked accounts' kept posts with no hit yet, read again (up to 100, newest first). */
  async hits(now, changed) {
    const rows = this.db.prepare("SELECT id, mint, x_id FROM x_posts WHERE hit = 0 ORDER BY at DESC").all().filter((r) => this.links.walletOfX(r.x_id));
    const ids = [...new Set(rows.map((r) => r.id))].slice(0, 100);
    if (!ids.length) return;
    const { tweets = [] } = await this.sorsa.tweets(ids);
    for (const t of tweets) {
      const xid = String(t.user?.id ?? "");
      const wallet = this.links.walletOfX(xid);
      const { score, reposts } = counts(t);
      this.db.prepare("UPDATE x_posts SET score = ?, reposts = ? WHERE id = ?").run(score, reposts, String(t.id));
      if (!wallet || score < RAIDER_HIT || !userOk(t.user, now)) continue;
      for (const r of rows) if (r.id === String(t.id) && r.x_id === xid) this.hit(wallet, xid, r.id, r.mint, now, changed);
    }
  }

  /** Who reposted each coin's top posts: one page (newest first) for each. */
  async reposts(coins, now, changed) {
    const top = this.db.prepare("SELECT id, x_id FROM x_posts WHERE mint = ? AND reposts > 0 ORDER BY score DESC, at DESC LIMIT ?");
    for (const c of coins) {
      for (const p of top.all(c.mint, this.o.topPosts)) {
        const { users = [] } = await this.sorsa.retweeters(p.id);
        for (const u of users) {
          const xid = String(u?.id ?? "");
          const wallet = this.links.walletOfX(xid);
          if (!wallet || xid === p.x_id || !userOk(u, now)) continue;
          this.give(wallet, "raiderRepost", `${xid}:${c.mint}:${utcDay(now)}`, now, changed);
        }
      }
    }
  }

  /** `wallet` just linked `link` (XLinks.of): its kept posts give what they earned, judged by
   *  the account as X showed it at sign-in. */
  linked(wallet, link) {
    const now = this.now();
    if (!link || !raiderOk(link.followers, link.since, now)) return;
    const changed = new Set();
    this.ledger.atomic(() => {
      for (const r of this.db.prepare("SELECT id, mint, at, score FROM x_posts WHERE x_id = ?").all(link.id)) {
        this.give(wallet, "raiderPost", `${link.id}:${r.mint}:${utcDay(r.at)}`, now, changed);
        if (r.score >= RAIDER_HIT) this.hit(wallet, link.id, r.id, r.mint, now, changed);
      }
    });
    if (changed.size) this.onChange([...changed]);
  }
}
