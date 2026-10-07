// XP rules (server/xprules.js): what a launch, a migration and the catch-up give, with the
// chain read through fakes; and the three chain reads, against fake accounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { Referrals } from "../server/referrals.js";
import { XpLedger } from "../server/xp.js";
import { XpRules, holds, keeperHooks, launchOf, openSeats, readLaunch } from "../server/xprules.js";
import { P, PRESALE_LEN, PRESALE_VERSION, decodePresale } from "../src/layout.js";
import { tokenShare } from "../src/math.js";
import { POINTS } from "../src/xp.js";

const key = () => Keypair.generate().publicKey;
const b58 = () => key().toBase58();
const T = Date.UTC(2026, 9, 1, 12);
const byWallet = (x, y) => (x.wallet < y.wallet ? -1 : 1);

/** A ledger and referrals on one :memory: store, and XpRules on fakes (`over` replaces them). */
function setup(over = {}) {
  const store = new Store(":memory:");
  const ledger = new XpLedger(store.db);
  const referrals = new Referrals(store.db);
  const changes = [];
  const logs = [];
  const rules = new XpRules({
    ledger,
    referrals,
    readLaunch: async () => assert.fail("no launch read in this test"),
    openSeats: async () => [],
    holds: async () => 0n,
    launches: () => [],
    isMigrated: () => false,
    onChange: (wallets) => changes.push(...wallets),
    now: () => T,
    log: (m) => logs.push(m),
    retryMs: 0,
    ...over,
  });
  return { ledger, referrals, rules, changes, logs };
}

/** A launched presale: the creator with 0.1 SOL in, three others, one seat with nothing in. */
function launched() {
  const [presale, mint, creator, a, b, c, empty] = [b58(), b58(), b58(), b58(), b58(), b58(), b58()];
  const seats = [
    { wallet: creator, commit: 100_000_000n },
    { wallet: a, commit: 200_000_000n },
    { wallet: b, commit: 100_000_000n },
    { wallet: c, commit: 100_000_000n },
    { wallet: empty, commit: 0n },
  ];
  const launch = { creator, mint, total: 1_000_000_007n, raised: 500_000_000n, seats };
  const share = (w) => tokenShare(launch.total, 0n, seats.find((s) => s.wallet === w).commit, launch.raised, false);
  return { presale, mint, creator, a, b, c, empty, launch, share };
}

test("XpRules: a launch gives Dev to the creator, KOL to each other seat with SOL in, Raider for each confirmed referral that came in", async () => {
  const L = launched();
  const w = setup({ readLaunch: async (p) => (assert.equal(p, L.presale), L.launch) });
  const [raider, stranger] = [key(), key()];
  const pk = (s) => new PublicKey(s);
  w.referrals.add(pk(L.presale), pk(L.a), raider, "S1", T, true); // counts
  w.referrals.add(pk(L.presale), pk(L.b), raider, "S2", T, false); // unconfirmed: no
  w.referrals.add(pk(L.presale), pk(L.empty), raider, "S3", T, true); // no SOL in: no
  w.referrals.add(pk(L.presale), stranger, raider, "S4", T, true); // no seat at launch: no
  w.referrals.add(pk(L.presale), pk(L.c), pk(L.c), "S5", T, true); // yourself: no
  await w.rules.launched(L.presale);
  const counts = (wallet) => w.ledger.row(wallet, T).counts;
  assert.equal(counts(L.creator).devLaunch, 1);
  assert.equal(counts(L.creator).kolLaunch, 0, "the creator's own seat isn't KOL");
  for (const k of [L.a, L.b, L.c]) assert.equal(counts(k).kolLaunch, 1);
  assert.equal(counts(L.empty).kolLaunch, 0, "a seat with nothing in isn't KOL");
  assert.equal(counts(raider.toBase58()).raiderJoin, 1, "one confirmed referral that came in");
  assert.equal(counts(L.c).raiderJoin, 0, "never yourself");
  assert.equal(w.ledger.row(raider.toBase58(), T).total, POINTS.raiderJoin.points);
  const kept = [L.creator, L.a, L.b, L.c].map((wallet) => ({ wallet, mint: L.mint, tokens: L.share(wallet) }));
  assert.deepEqual(w.ledger.seatsOf(L.presale), kept.sort(byWallet), "each seat with SOL in keeps its claim's share");
  assert.deepEqual(new Set(w.changes), new Set([L.creator, L.a, L.b, L.c, raider.toBase58()]));
  assert.equal(w.ledger.done(L.presale, "launch"), true);
  w.changes.length = 0;
  await w.rules.launched(L.presale);
  assert.deepEqual(w.changes, [], "a second call gives nothing and reads nothing");
});

test("XpRules: seats that can't be read at launch are tried again, then left to the next start; a presale that's gone counts as read", async () => {
  const L = launched();
  let n = 0;
  const down = setup({ readLaunch: async () => (n++, assert.fail("rpc down")), tries: 3 });
  await down.rules.launched(L.presale);
  assert.equal(n, 3, "three tries");
  assert.match(down.logs.join("\n"), /couldn't read .* at launch: rpc down/);
  assert.equal(down.ledger.done(L.presale, "launch"), false, "the next start tries again");
  assert.deepEqual(down.ledger.board(10, T), []);

  let m = 0;
  const blip = setup({ readLaunch: async () => (m++ === 0 ? assert.fail("blip") : L.launch) });
  await blip.rules.launched(L.presale);
  assert.equal(blip.ledger.row(L.creator, T).counts.devLaunch, 1, "the second try counts");

  const gone = setup({ readLaunch: async () => null });
  await gone.rules.launched(L.presale);
  assert.equal(gone.ledger.done(L.presale, "launch"), true, "nothing left to read: not tried again");
  assert.match(gone.logs.join("\n"), /is gone/);
});

test("XpRules: a migration gives Dev and KOL again, and Diamond Hands to each seat still holding its share or not delivered yet", async () => {
  const L = launched();
  const held = { [L.creator]: L.share(L.creator), [L.a]: L.share(L.a) + 5n, [L.b]: L.share(L.b) - 1n, [L.c]: 0n };
  const w = setup({
    readLaunch: async () => L.launch,
    openSeats: async (p) => (assert.equal(p, L.presale), [L.c]),
    holds: async (wallet, mint) => (assert.equal(mint, L.mint), held[wallet]),
  });
  await w.rules.launched(L.presale);
  w.changes.length = 0;
  await w.rules.migrated(L.presale);
  const counts = (wallet) => w.ledger.row(wallet, T).counts;
  assert.equal(counts(L.creator).devMigrate, 1);
  assert.equal(counts(L.creator).diamondMigrate, 1, "exactly the share is enough");
  assert.equal(counts(L.creator).kolMigrate, 0);
  assert.deepEqual([L.a, L.b, L.c].map((k) => counts(k).kolMigrate), [1, 1, 1]);
  assert.equal(counts(L.a).diamondMigrate, 1, "more than the share");
  assert.equal(counts(L.b).diamondMigrate, 0, "sold some");
  assert.equal(counts(L.c).diamondMigrate, 1, "its seat is still open: nothing delivered, nothing sold");
  assert.equal(counts(L.empty).diamondMigrate, 0);
  assert.equal(w.ledger.row(L.creator, T).total, POINTS.devLaunch.points + POINTS.devMigrate.points + POINTS.diamondMigrate.points);
  assert.deepEqual(new Set(w.changes), new Set([L.creator, L.a, L.b, L.c]));
  assert.equal(w.ledger.done(L.presale, "migrate"), true);
  w.changes.length = 0;
  await w.rules.migrated(L.presale);
  assert.deepEqual(w.changes, [], "a second call gives nothing");
});

test("XpRules: holdings that can't be read leave Diamond Hands to the next start; a launch not counted yet is counted first", async () => {
  const L = launched();
  const w = setup({ readLaunch: async () => L.launch, holds: async () => assert.fail("rpc down") });
  await w.rules.migrated(L.presale);
  assert.equal(w.ledger.row(L.creator, T).counts.devLaunch, 1, "the launch counted first");
  assert.equal(w.ledger.row(L.creator, T).counts.devMigrate, 1, "Dev and KOL need no read");
  assert.equal(w.ledger.row(L.creator, T).counts.diamondMigrate, 0);
  assert.match(w.logs.join("\n"), /couldn't read holdings .*: rpc down/);
  assert.equal(w.ledger.done(L.presale, "migrate"), false);
  w.rules.holds = async (wallet) => L.share(wallet);
  await w.rules.migrated(L.presale);
  assert.deepEqual([L.creator, L.a, L.b, L.c].map((k) => w.ledger.row(k, T).counts.diamondMigrate), [1, 1, 1, 1]);
  assert.equal(w.ledger.row(L.creator, T).counts.devMigrate, 1, "still once");
  assert.equal(w.ledger.done(L.presale, "migrate"), true);
});

test("XpRules: the catch-up counts each launch not counted, and each migration the feed knows of", async () => {
  const [A, B, C] = [launched(), launched(), launched()];
  const all = { [A.presale]: A, [B.presale]: B, [C.presale]: C };
  const w = setup({
    readLaunch: async (p) => all[p].launch,
    holds: async (wallet) => A.share(wallet),
    launches: () => [A, B, C].map((x) => ({ presale: x.presale, mint: x.mint })),
    isMigrated: (mint) => (mint === C.mint ? assert.fail("boom") : mint === A.mint),
  });
  await w.rules.catchUp();
  assert.equal(w.ledger.row(A.creator, T).counts.devMigrate, 1, "A migrated while the server was down");
  assert.equal(w.ledger.row(A.a, T).counts.diamondMigrate, 1);
  assert.equal(w.ledger.row(B.creator, T).counts.devLaunch, 1, "B launched");
  assert.equal(w.ledger.done(B.presale, "migrate"), false, "B hasn't migrated");
  assert.equal(w.ledger.row(C.creator, T).counts.devLaunch, 1, "C's launch counted before its error");
  assert.match(w.logs.join("\n"), /catch-up .*: boom/);
});

test("XpRules: a confirmed join or open is a streak day; a new day is a change", () => {
  const w = setup();
  const a = b58();
  w.rules.active(a, T);
  w.rules.active(a, T + 60_000);
  assert.deepEqual(w.changes, [a], "the same UTC day again changes nothing");
  assert.deepEqual(w.ledger.row(a, T).streak, { days: 1, best: 1, last: "2026-10-01" });
});

test("the reads: the presale as launch left it, the seats still open, a wallet's tokens", async () => {
  const [presale, mint, creator, a] = [key(), key(), key(), key()];
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  creator.toBuffer().copy(d, P.CREATOR);
  mint.toBuffer().copy(d, P.MINT);
  d.writeBigUInt64LE(500_000_000n, P.RAISED);
  d.writeBigUInt64LE(1_000_000_007n, P.TOTAL_TOKENS);
  const bot = { homeSeats: async (k) => (assert.ok(k.equals(presale)), [{ user: a, commit: 300_000_000n }, { user: creator, commit: 200_000_000n }]) };
  const account = (amount) => {
    const data = Buffer.alloc(165);
    data.writeBigUInt64LE(amount, 64);
    return { pubkey: key(), account: { data } };
  };
  const l1 = {
    getAccountInfo: async (k) => (k.equals(presale) ? { data: d } : null),
    getTokenAccountsByOwner: async (owner, filter) => (assert.ok(owner.equals(a) && filter.mint.equals(mint)), { value: [account(7n), account(5n)] }),
  };
  const [p, m, c, w] = [presale, mint, creator, a].map((k) => k.toBase58());
  assert.deepEqual(await readLaunch(bot, l1, p), { creator: c, mint: m, total: 1_000_000_007n, raised: 500_000_000n, seats: [{ wallet: w, commit: 300_000_000n }, { wallet: c, commit: 200_000_000n }] });
  assert.equal(await readLaunch(bot, { getAccountInfo: async () => null }, p), null, "a presale account that's gone");
  assert.deepEqual(await openSeats(bot, p), [w, c]);
  assert.equal(await holds(l1, w, m), 12n, "every token account of the wallet for that mint");
});

test("XpRules: the seats the keeper reads before its claims count the launch, though the read after the launch lands late and finds them claimed", async () => {
  const L = launched();
  const raider = b58();
  const claimed = { ...L.launch, seats: L.launch.seats.filter((s) => s.wallet === L.c) }; // a, b and the creator claimed: their seats closed
  let reads = 0;
  const w = setup({ readLaunch: async () => (reads++, claimed) });
  w.referrals.add(new PublicKey(L.presale), new PublicKey(L.a), new PublicKey(raider), "S1", T, true);
  const reading = w.rules.launched(L.presale); // onLaunch: the read goes out
  w.rules.seatsRead(L.presale, L.launch); // the keeper's tick, right before its claims
  await reading;
  assert.equal(reads, 1);
  const counts = (wallet) => w.ledger.row(wallet, T).counts;
  assert.equal(counts(L.creator).devLaunch, 1);
  assert.deepEqual([L.a, L.b, L.c].map((k) => counts(k).kolLaunch), [1, 1, 1], "every seat with SOL in, claimed later or not");
  assert.equal(counts(raider).raiderJoin, 1);
  assert.deepEqual(w.ledger.seatsOf(L.presale).map((s) => s.wallet), [L.creator, L.a, L.b, L.c].sort(), "each seat kept for Diamond Hands");
  assert.equal(w.ledger.done(L.presale, "launch"), true);
  assert.deepEqual(w.changes.sort(), [L.creator, L.a, L.b, L.c, raider].sort(), "each wallet pushed once");

  // the other way round: the read counted it first, the keeper's seats add nothing
  const M = launched();
  const v = setup({ readLaunch: async () => M.launch });
  await v.rules.launched(M.presale);
  v.changes.length = 0;
  v.rules.seatsRead(M.presale, { ...M.launch, seats: [] });
  assert.deepEqual(v.changes, []);
  assert.equal(v.ledger.seatsOf(M.presale).length, 4);
  // and once the keeper's seats counted it, the read isn't sent at all
  const N = launched();
  const u = setup();
  u.rules.seatsRead(N.presale, N.launch);
  await u.rules.launched(N.presale); // setup's readLaunch fails the test if it's called
  assert.equal(u.ledger.row(N.creator, T).counts.devLaunch, 1);
});

test("XpRules: a launch is counted in one write: a failure part way leaves nothing of it, and the next try counts it all", async () => {
  const L = launched();
  const w = setup({ readLaunch: async () => L.launch });
  w.ledger.markDone = () => {
    throw new Error("disk full");
  };
  await assert.rejects(w.rules.launched(L.presale), /disk full/);
  assert.deepEqual(w.ledger.board(10, T), [], "no points");
  assert.deepEqual(w.ledger.seatsOf(L.presale), [], "no seats kept");
  assert.deepEqual(w.changes, [], "nothing pushed");
  assert.throws(() => w.rules.seatsRead(L.presale, L.launch), /disk full/);
  assert.deepEqual(w.ledger.board(10, T), []);
  delete w.ledger.markDone;
  await w.rules.launched(L.presale);
  assert.equal(w.ledger.board(10, T).length, 4);
  assert.equal(w.ledger.done(L.presale, "launch"), true);
});

test("XpRules: a holdings read at migration is tried again, as the launch read is, before it waits for the next start", async () => {
  const L = launched();
  let fails = 2;
  const w = setup({ readLaunch: async () => L.launch, holds: async (wallet) => (fails-- > 0 ? assert.fail("blip") : L.share(wallet)) });
  await w.rules.migrated(L.presale);
  assert.deepEqual([L.creator, L.a, L.b, L.c].map((k) => w.ledger.row(k, T).counts.diamondMigrate), [1, 1, 1, 1]);
  assert.equal(w.ledger.done(L.presale, "migrate"), true);
  assert.deepEqual(w.logs, []);

  let n = 0;
  const down = setup({ readLaunch: async () => L.launch, openSeats: async () => (n++, assert.fail("rpc down")), tries: 3 });
  await down.rules.migrated(L.presale);
  assert.equal(n, 3, "three tries");
  assert.match(down.logs.join("\n"), /couldn't read holdings .*: rpc down/);
  assert.equal(down.ledger.done(L.presale, "migrate"), false, "the next start tries again");
  assert.equal(down.ledger.row(L.creator, T).counts.devMigrate, 1, "Dev and KOL need no read");
});

test("launchOf: the presale and its seats as the keeper reads them, in the rules' shape", () => {
  const [presale, mint, creator, a] = [key(), key(), key(), key()];
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  creator.toBuffer().copy(d, P.CREATOR);
  mint.toBuffer().copy(d, P.MINT);
  d.writeBigUInt64LE(500_000_000n, P.RAISED);
  d.writeBigUInt64LE(1_000_000_007n, P.TOTAL_TOKENS);
  const seats = [{ key: presale, user: a, commit: 300_000_000n, settled: true }];
  assert.deepEqual(launchOf(decodePresale(d), seats), { creator: creator.toBase58(), mint: mint.toBase58(), total: 1_000_000_007n, raised: 500_000_000n, seats: [{ wallet: a.toBase58(), commit: 300_000_000n }] });
});

test("keeperHooks: the feed and XP each hear a launch on their own; neither stops the other, and nothing reaches the keeper", async () => {
  const P1 = key();
  const k = P1.toBase58();
  const run = async (feedLaunched, rulesLaunched) => {
    const heard = [];
    const logs = [];
    const feed = { launched: (p) => (heard.push(`feed ${p.toBase58()}`), feedLaunched()) };
    const rules = { launched: (p) => (heard.push(`xp ${p}`), rulesLaunched()) };
    keeperHooks({ feed, rules, log: (m) => logs.push(m) }).onLaunch(P1);
    await new Promise((r) => setImmediate(r));
    return { heard, logs };
  };
  const both = [`feed ${k}`, `xp ${k}`];
  const a = await run(() => assert.fail("feed down"), async () => {});
  assert.deepEqual(a.heard, both, "the feed threw: XP still counts the launch");
  assert.match(a.logs.join("\n"), /feed down/);
  const b = await run(() => {}, () => assert.fail("xp broke"));
  assert.deepEqual(b.heard, both);
  assert.match(b.logs.join("\n"), /xp broke/);
  const c = await run(() => {}, async () => assert.fail("rpc down"));
  assert.match(c.logs.join("\n"), new RegExp(`xp: launched ${k}: rpc down`), "a read that fails is logged, not left unhandled");

  // the keeper's seats go to the rules in the rules' shape; a throw is logged
  const got = [];
  const logs = [];
  const rules = { seatsRead: (p, l) => (got.push([p, l]), assert.fail("db locked")) };
  const presale = decodePresale(Object.assign(Buffer.alloc(PRESALE_LEN), { 0: PRESALE_VERSION }));
  const seats = [{ user: key(), commit: 5n, settled: true }];
  keeperHooks({ feed: {}, rules, log: (m) => logs.push(m) }).onSeats(P1, presale, seats);
  assert.deepEqual(got, [[k, launchOf(presale, seats)]]);
  assert.match(logs.join("\n"), /db locked/);
});
