// The presale room's choices: the ring, the bottom area, the join pick, the seat, the launch moment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bottomOf, cellsOf, claimedOf, heroOf, hhmm, isKey, joinedSince, lockedCommit, momentNews, momentScreen, momentStep, newLines, newLinesOn, pickOf, poolLine, refToNote, seatPlan, shortOf, walletsIn, whoKnown } from "../src/room/room.js";
import { C } from "../src/ui/theme.js";

const N = { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n };
const KEY = "11111111111111111111111111111111";
const ME = "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D";
const NOW = 1_000_000_000; // ms
const open = (over = {}) => ({ presale: KEY, state: "OPEN", where: "er", raised: "200000000", deadlineTs: NOW / 1000 + 600, seats: [], ...over });
const seatRow = (over = {}) => ({ seat: "S", user: ME, deposit: "250000000", commit: "250000000", settled: false, claimed: false, creator: false, where: "er", ...over });

test("isKey: base58, 32 to 44 characters", () => {
  assert.equal(isKey(KEY), true);
  assert.equal(isKey(ME), true);
  assert.equal(isKey("0OIl" + KEY.slice(4)), false);
  assert.equal(isKey("short"), false);
  assert.equal(isKey(undefined), false);
});

test("heroOf: the clock and C.er while open, C.up once full or past it, Closed when expired", () => {
  assert.deepEqual(heroOf(open(), null, N, NOW), { stage: "presale", fill: 0.4, color: C.er, under: "10:00 left" });
  assert.equal(heroOf(open({ raised: "500000000" }), null, N, NOW).color, C.up);
  assert.deepEqual(heroOf(open({ state: "LAUNCHING", raised: "500000000" }), null, N, NOW), { stage: "launching", fill: 1, color: C.up, under: "Launching on Meteora" });
  assert.equal(heroOf(open({ state: "SETTLED" }), null, N, NOW).under, "Live");
  assert.equal(heroOf(open(), { presale: KEY, pool: { migrated: true } }, N, NOW).under, "Live");
  const gone = heroOf(open({ state: "EXPIRED" }), null, N, NOW);
  assert.equal(gone.under, "Closed");
  assert.equal(gone.color, C.text2);
  // still OPEN on the server past its deadline (the keeper hasn't expired it yet)
  assert.equal(heroOf(open({ deadlineTs: NOW / 1000 - 1 }), null, N, NOW).under, "Time's up");
  assert.equal(heroOf(open({ deadlineTs: NOW / 1000 + 1 }), null, N, NOW).under, "0:01 left");
});

test("bottomOf: connect, your seat, join, or why not", () => {
  assert.deepEqual(bottomOf(open(), null, N, NOW), { kind: "connect" });
  assert.deepEqual(bottomOf(open({ state: "EXPIRED" }), null, N, NOW), { kind: "why", why: "This presale isn't taking seats." });
  assert.deepEqual(bottomOf(open(), ME, N, NOW), { kind: "join" });
  const mine = bottomOf(open({ seats: [seatRow()] }), ME, N, NOW);
  assert.equal(mine.kind, "seat");
  assert.equal(mine.seat.commit, 250_000_000n);
  // a seat stays yours after launch, when nobody can join
  assert.equal(bottomOf(open({ state: "SETTLED", seats: [seatRow({ settled: true })] }), ME, N, NOW).kind, "seat");
  assert.deepEqual(bottomOf(open({ raised: "500000000" }), ME, N, NOW), { kind: "why", why: "The pool is full." });
  assert.deepEqual(bottomOf(open({ deadlineTs: NOW / 1000 - 1 }), ME, N, NOW), { kind: "why", why: "Time's up for this presale." });
  // the list item (no seats yet) knows you're in from its users
  assert.deepEqual(bottomOf({ ...open(), seats: undefined, users: [{ user: ME, commit: "1" }] }, ME, N, NOW), { kind: "why", why: "You're already in." });
});

test("bottomOf: tokens arrived once the seat is gone and claimed", () => {
  const live = open({ state: "SETTLED" });
  assert.deepEqual(bottomOf(live, ME, N, NOW, true), { kind: "claimed" });
  assert.deepEqual(bottomOf(live, ME, N, NOW, false), { kind: "why", why: "This presale isn't taking seats." });
  // the seat is still there: still the seat
  const kept = bottomOf(open({ state: "SETTLED", seats: [seatRow({ settled: true })] }), ME, N, NOW, true);
  assert.equal(kept.kind, "seat");
  assert.equal(kept.seat.commit, 250_000_000n);
  // no wallet: as before
  assert.deepEqual(bottomOf(live, null, N, NOW, true), { kind: "why", why: "This presale isn't taking seats." });
});

test("lockedCommit, claimedOf: full, launched, then the seat is gone (claim closes it)", () => {
  const settled = open({ state: "SETTLED", seats: [seatRow({ settled: true })] });
  let had = null;
  for (const view of [open({ seats: [seatRow()] }), open({ state: "FULL", seats: [seatRow()] }), settled, open({ state: "SETTLED" })]) {
    had = lockedCommit(view, ME, had);
  }
  assert.equal(had, 250_000_000n);
  assert.equal(claimedOf(open({ state: "SETTLED" }), ME, had), true);
  assert.equal(claimedOf(settled, ME, had), false, "not claimed yet");
  const closed = (launch) => ({ presale: KEY, where: "closed", state: "CLOSED", token: null, launch, seats: [] });
  assert.equal(claimedOf(closed({ sig: "S" }), ME, had), true);
  // the presale's own state decides, not the stage (a launched row makes FULL "live")
  assert.equal(claimedOf(open({ state: "FULL" }), ME, had), false);
  assert.equal(claimedOf(open({ state: "LAUNCHING" }), ME, had), false);
  // nothing is remembered while OPEN, from another wallet's seat, or with no wallet
  assert.equal(lockedCommit(open({ seats: [seatRow()] }), ME, null), null);
  assert.equal(lockedCommit(open({ state: "FULL", seats: [seatRow({ user: KEY })] }), ME, null), null);
  assert.equal(lockedCommit(open({ state: "FULL", seats: [seatRow()] }), null, null), null);
  assert.equal(claimedOf(open({ state: "SETTLED" }), null, had), false);
});

test("claimedOf: a get-back while OPEN, then the pool fills and launches: not claimed", () => {
  let had = null;
  for (const view of [open({ seats: [seatRow()] }), open({ state: "FULL" }), open({ state: "SETTLED" })]) had = lockedCommit(view, ME, had);
  assert.equal(had, null);
  assert.equal(claimedOf(open({ state: "SETTLED" }), ME, had), false);
});

test("claimedOf: FAILED, EXPIRED or CLOSED without a launch: refunded, not claimed", () => {
  const had = lockedCommit(open({ state: "FULL", seats: [seatRow()] }), ME, null);
  assert.equal(had, 250_000_000n);
  assert.equal(claimedOf(open({ state: "FAILED" }), ME, had), false);
  assert.equal(claimedOf(open({ state: "EXPIRED" }), ME, had), false);
  assert.equal(claimedOf({ presale: KEY, where: "closed", state: "CLOSED", token: null, launch: null, seats: [] }, ME, had), false);
});

test("claimedOf: a seat out of the pool (commit 0) at launch is refunded, not claimed", () => {
  const had = lockedCommit(open({ state: "FULL", seats: [seatRow({ commit: "0" })] }), ME, null);
  assert.equal(had, 0n);
  assert.equal(claimedOf(open({ state: "SETTLED" }), ME, had), false);
});

test("claimedOf, lockedCommit: a list item (no seats) says nothing", () => {
  const item = { ...open({ state: "SETTLED" }), seats: undefined, users: [] };
  assert.equal(claimedOf(item, ME, 5n), false);
  assert.equal(lockedCommit({ ...item, state: "FULL" }, ME, 5n), 5n);
  assert.equal(claimedOf(undefined, ME, 5n), false);
  assert.equal(lockedCommit(undefined, ME, 5n), 5n);
});

test("pickOf: the whole chip while it fits; a note when less fits", () => {
  assert.deepEqual(pickOf(open(), N, 100_000_000n), { deposit: 100_000_000n, commit: 100_000_000n, note: null });
  // 0.3 SOL of room: a 0.5 chip puts in 0.3 and the seat holds 0.3
  assert.deepEqual(pickOf(open(), N, 500_000_000n), { deposit: 300_000_000n, commit: 300_000_000n, note: "Only 0.3 SOL fits." });
  // 0.05 SOL of room: the seat still holds 0.1, so 0.05 comes back after launch
  assert.deepEqual(pickOf(open({ raised: "450000000" }), N, 250_000_000n), {
    deposit: 100_000_000n, commit: 50_000_000n, note: "Only 0.05 SOL fits; the rest comes back to you after launch.",
  });
  assert.equal(pickOf(open({ raised: "500000000" }), N, 100_000_000n).note, null); // full: the why says so
});

test("shortOf: the seat plus fees and rent against the wallet", () => {
  assert.equal(shortOf(100_000_000n, 3_000_000n, 200_000_000), null);
  assert.equal(shortOf(100_000_000n, null, 1), null); // cost not read yet
  assert.equal(shortOf(100_000_000n, 3_000_000n, null), null); // wallet not read yet
  assert.equal(
    shortOf(250_000_000n, 3_456_789n, 200_000_000),
    "You need 0.253 SOL for this (the seat plus about 0.0035 SOL in fees and rent). You have 0.2.",
  );
});

test("seatPlan: in, out of the pool, creator, locked", () => {
  const plan = (view, seat) => seatPlan(view, null, seat, ME, NOW);
  const seat = (over) => ({ deposit: 250_000_000n, commit: 250_000_000n, creator: false, settled: false, ...over });
  assert.deepEqual(plan(open({ seats: [seatRow()] }), seat()), { title: "Your seat · 0.25 SOL", note: null, back: true });
  assert.deepEqual(plan(open({ seats: [seatRow({ commit: "0" })] }), seat({ commit: 0n })), {
    title: "In your seat · 0.25 SOL, out of the pool", note: null, back: true,
  });
  assert.deepEqual(plan(open({ seats: [seatRow({ creator: true })] }), seat({ creator: true })), { title: "Your seat · 0.25 SOL", note: "creator", back: false });
  const launching = open({ state: "LAUNCHING", seats: [seatRow()] });
  assert.deepEqual(plan(launching, seat()), { title: "Your seat · 0.25 SOL", note: "locked", back: false });
  assert.equal(plan(open({ state: "LAUNCHING", seats: [seatRow({ creator: true })] }), seat({ creator: true })).note, "locked");
  // launched, not claimed yet (a claim closes the seat, and the room says so without it)
  const live = open({ state: "SETTLED", seats: [seatRow({ settled: true })] });
  assert.deepEqual(plan(live, seat({ settled: true })), { title: "Your seat · 0.25 SOL", note: "locked", back: false });
  // expired before filling: the seat's SOL can come back
  assert.equal(plan(open({ state: "EXPIRED", seats: [seatRow()] }), seat()).back, true);
});

test("momentStep: plays for a change seen live, or a room opened while launching", () => {
  // first sight: a presale already launching opens on the launching screen; one already live
  // (or expired) starts nothing
  assert.equal(momentStep(null, null, "launching"), "launching");
  assert.equal(momentStep(null, null, "live"), null);
  assert.equal(momentStep(null, null, "expired"), null);
  assert.equal(momentStep(null, null, "presale"), null);
  // presale -> launching -> live
  assert.equal(momentStep(null, "presale", "launching"), "launching");
  assert.equal(momentStep("launching", "launching", "live"), "live");
  // straight to live, or from launching seen at the start
  assert.equal(momentStep(null, "presale", "live"), "live");
  assert.equal(momentStep(null, "launching", "migrated"), "live");
  // no change, or one that isn't a launch
  assert.equal(momentStep(null, "presale", "presale"), null);
  assert.equal(momentStep(null, "presale", "expired"), null);
  assert.equal(momentStep(null, "live", "migrated"), null);
  // a failed launch says so until closed; closed stays closed
  assert.equal(momentStep("launching", "launching", "expired"), "failed");
  assert.equal(momentStep("failed", "expired", "expired"), "failed");
  assert.equal(momentStep("done", "launching", "live"), "done");
  assert.equal(momentStep("live", "live", "migrated"), "live");
});

test("momentScreen: pool full until the 3-2-1 is done, then launching until your tokens arrive or every seat is served", () => {
  const at = (o) => momentScreen({ late: false, counted: false, stepsDone: false, claimed: false, ...o });
  assert.equal(at({ phase: null }), null);
  assert.equal(at({ phase: "done" }), null);
  // seen filling: POOL FULL and the 3-2-1 first, whatever the chain does meanwhile
  assert.equal(at({ phase: "launching" }), "full");
  assert.equal(at({ phase: "live", claimed: true }), "full");
  // after the 3-2-1
  assert.equal(at({ phase: "launching", counted: true }), "launching");
  assert.equal(at({ phase: "live", counted: true }), "launching", "the pool is up, tokens still on the way");
  assert.equal(at({ phase: "live", counted: true, claimed: true }), "live");
  assert.equal(at({ phase: "live", counted: true, stepsDone: true }), "live", "not in it: live once every seat is served");
  // opened late: straight onto launching, then live
  assert.equal(at({ phase: "launching", late: true }), "launching");
  assert.equal(at({ phase: "live", late: true, claimed: true }), "live");
  // a failed launch says so at once, mid-countdown too
  assert.equal(at({ phase: "failed" }), "failed");
  assert.equal(at({ phase: "failed", counted: true }), "failed");
});

test("momentNews: what a screen reader hears as a launch screen shows, each line once", () => {
  const none = new Set();
  assert.deepEqual(momentNews(null, {}, none), []);
  assert.deepEqual(momentNews("launching", { ticker: "MOON" }, none), [], "its steps say themselves");
  assert.deepEqual(momentNews("full", { ticker: "MOON" }, none), ["Pool full.", "Launching on Meteora."]);
  assert.deepEqual(momentNews("live", { ticker: "MOON", claimed: false }, none), ["$MOON is live on Meteora."]);
  assert.deepEqual(momentNews("live", { ticker: "MOON", claimed: true }, none), ["$MOON is live on Meteora.", "Your tokens arrived."]);
  assert.deepEqual(momentNews("live", { ticker: "", claimed: false }, none), ["Live on Meteora."], "no ticker known");
  assert.deepEqual(momentNews("failed", { refund: false }, none), ["The launch didn't go through."]);
  assert.deepEqual(momentNews("failed", { refund: true }, none), ["The launch didn't go through.", "Your SOL comes back by itself."]);
  // said already: a screen shown again says nothing; tokens arriving later say just that
  assert.deepEqual(momentNews("full", {}, new Set(["Pool full.", "Launching on Meteora."])), []);
  assert.deepEqual(momentNews("live", { ticker: "MOON", claimed: true }, new Set(["$MOON is live on Meteora."])), ["Your tokens arrived."]);
});

test("hhmm: two digits each", () => {
  const d = new Date(2026, 9, 1, 9, 5, 0);
  assert.equal(hhmm(d.getTime()), "09:05");
});

test("refToNote: a link's ref waits for the saved wallet's read, so a cold start can't take your own link for a friend's", () => {
  const FRIEND = "S".repeat(44);
  assert.equal(refToNote(true, FRIEND, undefined), null, "the saved wallet is still being read");
  assert.equal(refToNote(true, FRIEND, null), FRIEND, "read: no wallet");
  assert.equal(refToNote(true, FRIEND, { publicKey: ME }), FRIEND, "read: a wallet");
  assert.equal(refToNote(false, FRIEND, null), null, "not a presale key");
  assert.equal(refToNote(true, undefined, null), null, "no ref in the link");
});

test("cellsOf: ten cells, each a tenth of the pool, filled by the SOL in", () => {
  assert.deepEqual(cellsOf(250n, 1000n), [1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(cellsOf("1000", "1000"), Array(10).fill(1));
  assert.deepEqual(cellsOf(2000n, 1000n), Array(10).fill(1));
  assert.deepEqual(cellsOf(5n, 0n), Array(10).fill(0));
  assert.deepEqual(cellsOf(undefined, undefined), Array(10).fill(0));
});

test("poolLine: the wallets in, and the SOL to go or full", () => {
  const N = { TARGET: "1000000000" };
  const users = (n) => Array.from({ length: n }, (_, i) => ({ user: `w${i}`, commit: "100000000" }));
  assert.equal(poolLine({ raised: "250000000", users: users(1) }, N), "1 wallet in · 0.75 SOL to go");
  assert.equal(poolLine({ raised: "1000000000", users: users(10) }, N), "10 wallets in · full");
  assert.equal(poolLine({ raised: "0", users: [] }, N), "0 wallets in · 1 SOL to go");
});

test("poolLine: with no target known (0 or missing) it never says full, as cellsOf shows none filled", () => {
  const users = [{ user: "w0", commit: "100000000" }];
  assert.equal(poolLine({ raised: "100000000", users }, { TARGET: "0" }), "1 wallet in");
  assert.equal(poolLine({ raised: "100000000", users }, {}), "1 wallet in");
  assert.equal(poolLine({ raised: "0", users: [] }, null), "0 wallets in");
});

test("newLines: only lines pushed live since the last read; the first read is never new", () => {
  const rows = [{ id: 1, text: "gm" }, { id: 2, text: ":lfg:", live: true }];
  assert.deepEqual(newLines(rows, null), { lines: [], lastId: 2 }, "the first read: nothing is new");
  const more = [...rows, { id: 3, text: ":moon:", live: true }, { id: 4, text: "from a snapshot" }];
  assert.deepEqual(newLines(more, 2), { lines: [more[2]], lastId: 4 }, "a snapshot's rows never count");
  assert.deepEqual(newLines(more, 4), { lines: [], lastId: 4 });
  assert.deepEqual(newLines([], null), { lines: [], lastId: -Infinity });
  assert.equal(newLines([{ id: 1, text: ":gm:", live: true }], -Infinity).lines.length, 1, "the chat was empty when the screen opened");
});

test("newLinesOn: a new channel (or none yet) is a first read: its live rows never replay", () => {
  const a = [{ id: 5, text: ":lfg:", live: true }];
  let r = newLinesOn(a, "A", null);
  assert.deepEqual(r, { lines: [], last: { channel: "A", lastId: 5 } });
  const b = [{ id: 2, text: ":moon:", live: true }, { id: 3, text: ":gm:", live: true }];
  r = newLinesOn(b, "B", r.last);
  assert.deepEqual(r, { lines: [], last: { channel: "B", lastId: 3 } }, "B's ids are below A's: none is new");
  const b2 = [...b, { id: 9, text: ":gg:", live: true }];
  assert.deepEqual(newLinesOn(b2, "B", r.last), { lines: [b2[2]], last: { channel: "B", lastId: 9 } });
  r = newLinesOn([], undefined, null);
  assert.deepEqual(r, { lines: [], last: null }, "no channel yet: nothing kept");
  assert.deepEqual(newLinesOn(a, "A", r.last).lines, [], "the channel's first rows after none are a first read");
  assert.deepEqual(newLinesOn(a, "A", { channel: "B", lastId: 1 }).lines, [], "a lower last id from another channel never counts");
});

test("walletsIn: the count of wallets in, one or many", () => {
  assert.equal(walletsIn(0), "0 wallets in");
  assert.equal(walletsIn(1), "1 wallet in");
  assert.equal(walletsIn(12), "12 wallets in");
});

test("whoKnown: who's in is known from a detail view's seats or a list item's users, not from a list item without them", () => {
  assert.equal(whoKnown({ seats: [] }), true);
  assert.equal(whoKnown({ users: [] }), true);
  assert.equal(whoKnown({ raised: "0" }), false);
  assert.equal(whoKnown(undefined), false);
});

test("joinedSince: the wallets new since the last read; nobody on the first", () => {
  const who = [{ user: "a" }, { user: "b" }, { user: "c" }];
  assert.deepEqual(joinedSince(null, who), []);
  assert.deepEqual(joinedSince(new Set(["a"]), who), ["b", "c"]);
  assert.deepEqual(joinedSince(new Set(["a", "b", "c", "d"]), who), [], "a wallet that left joins nothing");
});
