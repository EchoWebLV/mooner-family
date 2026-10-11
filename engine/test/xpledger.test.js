// The XP ledger (server/xp.js): each event counts once, the streak's days, the Genesis
// claim, the seats kept at launch, and the rows and the board the clients read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { XpLedger } from "../server/xp.js";
import { DAY_MS, POINTS } from "../src/xp.js";

const wallet = () => Keypair.generate().publicKey.toBase58();
const T = Date.UTC(2026, 9, 1, 12); // 2026-10-01 12:00 UTC
const ZERO_TITLES = { dev: 0, kol: 0, raider: 0, diamond: 0 };
const ZERO_COUNTS = { devLaunch: 0, devMigrate: 0, kolLaunch: 0, kolMigrate: 0, raiderJoin: 0, raiderPost: 0, raiderRepost: 0, raiderHit: 0, diamondMigrate: 0 };

test("XpLedger: an event counts once per ref, and the rows stay on a second open of the file", () => {
  const store = new Store(":memory:");
  const xp = new XpLedger(store.db);
  const [a, p1, p2] = [wallet(), wallet(), wallet()];
  assert.equal(xp.award(a, "devLaunch", p1, T), true);
  assert.equal(xp.award(a, "devLaunch", p1, T + 1), false, "the same launch again: nothing");
  assert.equal(xp.award(a, "devLaunch", p2, T), true, "another presale counts");
  assert.equal(xp.award(a, "kolLaunch", p1, T), true, "another reason on the same presale counts");
  assert.throws(() => xp.award(a, "shill", p1, T), /no points for shill/);
  assert.deepEqual(xp.walletsWith("devLaunch", p1), [a], "who got an event for a ref");
  assert.deepEqual(xp.walletsWith("devMigrate", p1), []);
  const row = new XpLedger(store.db).row(a, T);
  assert.equal(row.total, 2 * POINTS.devLaunch.points + POINTS.kolLaunch.points);
  assert.deepEqual(row.titles, { ...ZERO_TITLES, dev: 2 * POINTS.devLaunch.points, kol: POINTS.kolLaunch.points });
  assert.deepEqual(row.counts, { ...ZERO_COUNTS, devLaunch: 2, kolLaunch: 1 });
  store.close();
});

test("XpLedger: a wallet with nothing gets zeros", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const a = wallet();
  assert.deepEqual(xp.row(a, T), { wallet: a, total: 0, titles: ZERO_TITLES, counts: ZERO_COUNTS, streak: { days: 0, best: 0, last: null }, genesis: null });
});

test("XpLedger: one streak day per UTC day with a confirmed join or open, and no points for it", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const a = wallet();
  assert.equal(xp.active(a, T - 2 * DAY_MS), true);
  assert.equal(xp.active(a, T - DAY_MS), true);
  assert.equal(xp.active(a, T), true);
  assert.equal(xp.active(a, T + 60_000), false, "a second one the same day: no new day");
  assert.deepEqual(xp.row(a, T).streak, { days: 3, best: 3, last: "2026-10-01" });
  assert.deepEqual(xp.row(a, T + 2 * DAY_MS).streak, { days: 0, best: 3, last: "2026-10-01" }, "a whole UTC day with none ends it");
  assert.equal(xp.row(a, T).total, 0);
});

test("XpLedger: the Genesis perk once per wallet and once per mint", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const [a, b, m1, m2] = [wallet(), wallet(), wallet(), wallet()];
  assert.deepEqual(xp.claimGenesis(m1, a, T), { mint: m1, at: T, fresh: true });
  assert.deepEqual(xp.claimGenesis(m1, a, T + 5), { mint: m1, at: T, fresh: false }, "asking again: the same answer");
  assert.deepEqual(xp.claimGenesis(m2, a, T + 5), { mint: m1, at: T, fresh: false }, "a second mint gives this wallet nothing more");
  assert.deepEqual(xp.claimGenesis(m1, b, T + 9), { taken: a }, "another wallet with the same mint: taken");
  assert.equal(xp.genesisOf(b), null);
  const row = xp.row(a, T);
  assert.deepEqual(row.genesis, { mint: m1, at: T });
  assert.equal(row.total, POINTS.genesis.points, "the bonus counts in the total");
  assert.deepEqual(row.titles, ZERO_TITLES, "and in no title");
  assert.deepEqual(row.counts, ZERO_COUNTS, "and in no count");
});

test("XpLedger: seats kept at launch are read back at migration; the first keep stays", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const [p, mint, a, b] = [wallet(), wallet(), wallet(), wallet()];
  assert.deepEqual(xp.seatsOf(p), []);
  xp.keepSeats(p, mint, [{ wallet: a, tokens: 1_000_000n }, { wallet: b, tokens: 18_446_744_073_709_551_615n }]);
  xp.keepSeats(p, mint, [{ wallet: a, tokens: 5n }]);
  const want = [{ wallet: a, mint, tokens: 1_000_000n }, { wallet: b, mint, tokens: 18_446_744_073_709_551_615n }];
  assert.deepEqual(xp.seatsOf(p), want.sort((x, y) => (x.wallet < y.wallet ? -1 : 1)), "u64 shares come back whole");
});

test("XpLedger: what was done for a presale", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const p = wallet();
  assert.equal(xp.done(p, "launch"), false);
  xp.markDone(p, "launch", T);
  xp.markDone(p, "launch", T + 1);
  assert.equal(xp.done(p, "launch"), true);
  assert.equal(xp.done(p, "migrate"), false);
});

test("XpLedger: the board, by total then wallet, streak-only wallets included", () => {
  assert.ok(POINTS.devLaunch.points > POINTS.kolLaunch.points, "this test's order assumes it");
  const xp = new XpLedger(new Store(":memory:").db);
  const [a, b, c, d, p] = [wallet(), wallet(), wallet(), wallet(), wallet()];
  xp.award(a, "kolLaunch", p, T);
  xp.award(b, "devLaunch", p, T);
  xp.award(c, "kolLaunch", p, T);
  xp.active(d, T);
  const [lo, hi] = [a, c].sort();
  assert.deepEqual(xp.board(500, T).map((r) => r.wallet), [b, lo, hi, d]);
  assert.deepEqual(xp.board(500, T)[0], xp.row(b, T));
  assert.deepEqual(xp.board(2, T).map((r) => r.wallet), [b, lo]);
  assert.deepEqual(xp.rows([d, b, d], T), [xp.row(d, T), xp.row(b, T)], "rows: each wallet once, in the order asked");
});

test("XpLedger: the board is read once and kept until a write changes something, the UTC day turns or 5 s pass", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const [a, b, c, p] = [wallet(), wallet(), wallet(), wallet()];
  xp.award(a, "kolLaunch", p, T);
  xp.active(a, T - DAY_MS);
  let reads = 0;
  const row = xp.row.bind(xp);
  xp.row = (...args) => (reads++, row(...args));
  const first = xp.board(500, T);
  assert.deepEqual(xp.board(500, T + 4_999), first);
  assert.equal(reads, 1, "two subscriptions in a row: the rows are read once");
  xp.award(a, "kolLaunch", p, T);
  xp.active(a, T - DAY_MS);
  xp.board(500, T);
  assert.equal(reads, 1, "an event or a day it already had changes nothing");
  xp.award(b, "devLaunch", p, T);
  assert.deepEqual(xp.board(500, T).map((r) => r.wallet), [b, a], "a new award is on the board at once");
  assert.equal(reads, 3);
  xp.active(c, T);
  assert.equal(xp.board(500, T).length, 3, "a new streak day too");
  assert.equal(reads, 6);
  xp.claimGenesis(wallet(), c, T);
  assert.equal(xp.board(500, T)[0].wallet, c, "and a Genesis claim");
  assert.equal(reads, 9);
  xp.board(2, T);
  assert.equal(reads, 11, "another limit is another board");
  xp.board(500, T);
  xp.board(500, T + 5_000);
  assert.equal(reads, 17, "5 s on, it's read again");
  const late = Date.UTC(2026, 9, 1, 23, 59, 59);
  xp.board(500, late);
  assert.equal(reads, 20);
  assert.equal(xp.board(500, late + 2_000).find((r) => r.wallet === c).streak.days, 1, "a new UTC day is read again: the streaks moved");
  assert.equal(reads, 23);
});

test("XpLedger: a Genesis claim and its points are one write: a failure between them leaves neither", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const [a, m] = [wallet(), wallet()];
  xp.award = () => {
    throw new Error("disk full");
  };
  assert.throws(() => xp.claimGenesis(m, a, T), /disk full/);
  assert.equal(xp.genesisOf(a), null, "no claim without its points");
  delete xp.award;
  assert.deepEqual(xp.claimGenesis(m, a, T + 1), { mint: m, at: T + 1, fresh: true }, "the next try makes it");
  assert.equal(xp.row(a, T).total, POINTS.genesis.points);
});

test("XpLedger: a wallet's points are read by the UNIQUE (wallet, reason, ref) index, the only one on xp", () => {
  const db = new Store(":memory:").db;
  new XpLedger(db);
  assert.deepEqual(db.prepare("PRAGMA index_list(xp)").all().map((r) => r.origin), ["u"], "UNIQUE's own index; no other");
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT reason, title, SUM(points) AS points, COUNT(*) AS n FROM xp WHERE wallet = ? GROUP BY reason, title").all().map((r) => r.detail);
  assert.match(plan.join(" | "), /SEARCH xp USING INDEX sqlite_autoindex_xp_1 \(wallet=\?\)/);
});
