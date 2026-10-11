// Raider XP from X (server/raiders.js) on a fake Sorsa: posts, the floor, once per coin per
// day, hits, reposts, what a new link earns from kept posts, moving a link, the search's paging
// and query, and nothing spent with no X account linked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { XpLedger } from "../server/xp.js";
import { XLinks } from "../server/xlink.js";
import { Raiders, names, queryOf } from "../server/raiders.js";
import { Sorsa } from "../server/sorsa.js";
import { POINTS, RAIDER_HIT } from "../src/xp.js";

const DAY = 86_400_000;
const T = Date.UTC(2026, 9, 10, 12);
const key = () => Keypair.generate().publicKey.toBase58();
/** A time as Sorsa writes it: "Sat Oct 10 12:39:34 +0000 2026". */
const xDate = (ms) => {
  const [wd, day, mon, year, time] = new Date(ms).toUTCString().replace(",", "").split(" ");
  return `${wd} ${mon} ${day} ${time} +0000 ${year}`;
};
const OLD = xDate(T - 400 * DAY);
const user = (id, over = {}) => ({ id, username: `u${id}`, followers_count: 100, created_at: OLD, ...over });
let n = 0;
const post = (u, text, at = T - 60_000, over = {}) => ({ id: String(++n), full_text: text, created_at: xDate(at), user: u, likes_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0, is_reply: false, ...over });

function rig({ coins, pages = [[]], retweeters = {}, bulk = [], now = () => T, opts = {} } = {}) {
  const store = new Store(":memory:");
  const ledger = new XpLedger(store.db);
  const links = new XLinks(store.db);
  const asked = { search: [], retweeters: [], tweets: [] };
  const sorsa = {
    search: async (q, cursor) => {
      asked.search.push({ q, cursor });
      const i = cursor ? Number(cursor) : 0;
      return { tweets: pages[i] ?? [], next_cursor: i + 1 < pages.length ? String(i + 1) : null };
    },
    retweeters: async (id) => (asked.retweeters.push(id), { users: retweeters[id] ?? [], next_cursor: null }),
    tweets: async (ids) => (asked.tweets.push(ids), { tweets: bulk }),
  };
  const changes = [];
  const logs = [];
  const r = new Raiders({ sorsa, links, ledger, coins: () => coins, onChange: (ws) => changes.push(...ws), now, log: (m) => logs.push(m), opts });
  const link = (wallet, id, over = {}) => links.link(wallet, { id, handle: `u${id}`, name: `u${id}`, followers: 100, since: T - 400 * DAY, ...over }, T);
  const counts = (w) => ledger.row(w, T).counts;
  return { r, ledger, links, asked, changes, logs, link, counts, store };
}

const COIN = { mint: key(), symbol: "MOON", at: T - 2 * DAY };

test("queryOf and names: cashtag or address, no replies, from the day searched to; a symbol that can't be a cashtag goes by address only", () => {
  const odd = { mint: key(), symbol: "1$%" };
  assert.equal(queryOf([COIN, odd], Date.UTC(2026, 9, 8, 3)), `($MOON OR ${COIN.mint} OR ${odd.mint}) -filter:replies since:2026-10-08`);
  assert.equal(names({ full_text: "aping $moon now" }, COIN), true, "any case");
  assert.equal(names({ full_text: "$MOONER is different" }, COIN), false, "a longer cashtag isn't it");
  assert.equal(names({ full_text: `ca ${COIN.mint}` }, COIN), true);
  assert.equal(names({ full_text: "lfg", quoted_status: { full_text: "$MOON" } }, COIN), true, "a quote of a post that names it");
  assert.equal(names({ full_text: "lfg", entities: [{ type: "url", link: `https://mooner.family/coin/${COIN.mint}` }] }, COIN), true);
});

test("Raiders: nothing is searched while no X account is linked", async () => {
  const w = rig({ coins: [COIN] });
  await w.r.tick();
  assert.deepEqual(w.asked, { search: [], retweeters: [], tweets: [] });
});

test("Raiders: a linked account's post gives raiderPost once per coin per UTC day; replies, reposts, strangers and accounts under the floor give nothing", async () => {
  const [a, b, c] = [key(), key(), key()];
  const pages = [[
    post(user("1"), "buying $MOON"),
    post(user("1"), "more $MOON", T - 120_000), // same day: nothing more
    post(user("1"), "$MOON day one", T - DAY), // the day before: counts
    post(user("1"), "$MOON reply", T - 1000, { is_reply: true }),
    post(user("2", { followers_count: 10 }), "$MOON"), // under the floor
    post(user("3", { created_at: xDate(T - 30 * DAY) }), "$MOON"), // too new
    post(user("4"), "$MOON"), // not linked
    post(user("1"), "$MOON before launch", COIN.at - 1000),
  ]];
  const w = rig({ coins: [COIN], pages });
  w.link(a, "1");
  w.link(b, "2");
  w.link(c, "3");
  await w.r.tick();
  assert.equal(w.counts(a).raiderPost, 2);
  assert.equal(w.ledger.row(a, T).titles.raider, 2 * POINTS.raiderPost.points);
  assert.equal(w.counts(b).raiderPost, 0);
  assert.equal(w.counts(c).raiderPost, 0);
  assert.deepEqual(w.changes, [a]);
  assert.equal(w.asked.search.length, 1);
  assert.equal(w.store.db.prepare("SELECT COUNT(*) AS n FROM x_posts").get().n, 6, "every post that names it is kept, a reply and one before launch aren't");
});

test("Raiders: a search pages down to where the last one stopped, and the next one stops there", async () => {
  const a = key();
  const p0 = [post(user("1"), "$MOON", T - 60_000)];
  const p1 = [post(user("1"), "$MOON", T - 2 * 3_600_000)];
  const w = rig({ coins: [COIN], pages: [p0, p1] });
  w.link(a, "1");
  await w.r.tick();
  assert.deepEqual(w.asked.search.map((s) => s.cursor), [null, "1"], "both pages: nothing older than the launch yet");
  assert.match(w.asked.search[0].q, /since:2026-10-08/);
  assert.equal(w.store.db.prepare("SELECT seen FROM x_coins WHERE mint = ?").get(COIN.mint).seen, Date.parse(p0[0].created_at));
  w.asked.search.length = 0;
  await w.r.tick();
  assert.deepEqual(w.asked.search.map((s) => s.cursor), [null], "page 0 reaches what was seen: it stops");
  assert.match(w.asked.search[0].q, /since:2026-10-10/);
});

test("Raiders: a post that reaches RAIDER_HIT gives raiderHit once per coin, on sight or when read again", async () => {
  const [a, b] = [key(), key()];
  const big = post(user("1"), "$MOON", T - 60_000, { likes_count: RAIDER_HIT });
  const later = post(user("2"), "$MOON", T - 60_000, { likes_count: 1 });
  const w = rig({ coins: [COIN], pages: [[big, later]], bulk: [{ ...later, likes_count: 15, retweet_count: 5 }] });
  w.link(a, "1");
  w.link(b, "2");
  await w.r.tick();
  assert.equal(w.counts(a).raiderHit, 1, "on sight");
  assert.deepEqual(w.asked.tweets, [[later.id]], "only the linked posts with no hit are read again");
  assert.equal(w.counts(b).raiderHit, 1, "15 likes + 5 reposts");
  w.asked.tweets.length = 0;
  await w.r.tick();
  assert.deepEqual(w.asked.tweets, [], "nothing left to read again");
  assert.equal(w.counts(a).raiderHit + w.counts(b).raiderHit, 2);
});

test("Raiders: reposting a coin's top posts gives raiderRepost once per coin per day; not your own post, not under the floor; every repostMs", async () => {
  const [a, b, c] = [key(), key(), key()];
  const top = post(user("9"), "$MOON", T - 60_000, { retweet_count: 50, likes_count: 100 });
  const mine = post(user("1"), "$MOON", T - 60_000, { retweet_count: 3 });
  const none = post(user("8"), "$MOON", T - 60_000); // no reposts: never asked
  let t = T;
  const w = rig({
    coins: [COIN], pages: [[top, mine, none]], now: () => t,
    retweeters: { [top.id]: [user("1"), user("2", { followers_count: 3 }), user("77")], [mine.id]: [user("1"), user("3")] },
  });
  w.link(a, "1");
  w.link(b, "2");
  w.link(c, "3");
  await w.r.tick();
  assert.deepEqual(w.asked.retweeters.sort(), [top.id, mine.id].sort());
  assert.equal(w.counts(a).raiderRepost, 1, "a reposted the top post; its own repost of its post doesn't count");
  assert.equal(w.counts(b).raiderRepost, 0, "under the floor");
  assert.equal(w.counts(c).raiderRepost, 1);
  w.asked.retweeters.length = 0;
  t += 3_600_000;
  await w.r.tick();
  assert.deepEqual(w.asked.retweeters, [], "not again before repostMs");
  t = T + 6 * 3_600_000;
  await w.r.tick();
  assert.equal(w.asked.retweeters.length, 2);
  assert.equal(w.counts(a).raiderRepost, 1, "same UTC day: once");
});

test("Raiders: a new link earns from the posts already kept, at once and with no request; moving the link doesn't pay twice", async () => {
  const [a, b] = [key(), key()];
  const p = post(user("5"), "$MOON", T - 60_000, { likes_count: 40 });
  const w = rig({ coins: [COIN], pages: [[p]] });
  w.link(key(), "6"); // someone is linked, so the search runs
  await w.r.tick();
  assert.equal(w.counts(a).raiderPost, 0);
  const before = structuredClone(w.asked);
  w.link(a, "5");
  w.r.linked(a, w.links.of(a));
  assert.deepEqual(w.asked, before);
  assert.equal(w.counts(a).raiderPost, 1);
  assert.equal(w.counts(a).raiderHit, 1);
  assert.deepEqual(w.changes, [a]);
  w.link(b, "5");
  w.r.linked(b, w.links.of(b));
  assert.equal(w.counts(b).raiderPost + w.counts(b).raiderHit, 0, "already earned by this X account");

  const young = rig({ coins: [COIN], pages: [[p]] });
  young.link(key(), "6");
  await young.r.tick();
  young.link(a, "5", { followers: 10 });
  young.r.linked(a, young.links.of(a));
  assert.equal(young.counts(a).raiderPost, 0, "under the floor at sign-in");
});

test("Raiders: coins older than the window aren't searched; a failed step is logged and the rest still runs", async () => {
  const a = key();
  const stale = { mint: key(), symbol: "OLD", at: T - 30 * DAY };
  const w = rig({ coins: [stale] });
  w.link(a, "1");
  await w.r.tick();
  assert.equal(w.asked.search.length, 0);

  const broken = rig({ coins: [COIN], bulk: [] });
  broken.link(a, "1");
  broken.r.sorsa.search = async () => {
    throw new Error("sorsa down");
  };
  await broken.r.tick();
  assert.ok(broken.logs.some((m) => /posts: sorsa down/.test(m)));
});

test("Sorsa: the ApiKey header, the bodies, and a daily budget that resets at UTC midnight", async () => {
  const sent = [];
  let t = T;
  const s = new Sorsa({
    key: "K", perDay: 2, now: () => t,
    fetch: async (url, init) => (sent.push({ url, init }), Response.json({ tweets: [], next_cursor: null })),
  });
  await s.search("$MOON", "c1");
  await s.tweets([1, "2"]);
  await assert.rejects(s.retweeters("9"), /spent/);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, "https://api.sorsa.io/v3/search-tweets");
  assert.equal(sent[0].init.headers.ApiKey, "K");
  assert.deepEqual(JSON.parse(sent[0].init.body), { query: "$MOON", order: "latest", next_cursor: "c1" });
  assert.deepEqual(JSON.parse(sent[1].init.body), { tweet_links: ["1", "2"] });
  t = Date.UTC(2026, 9, 11, 0, 0, 1);
  await s.retweeters("9");
  assert.deepEqual(JSON.parse(sent[2].init.body), { tweet_link: "9" });
});
