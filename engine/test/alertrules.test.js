// When an alert is due and what it says (server/alertrules.js), over wire-form views.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KIND_LABEL } from "../src/alertkinds.js";
import { ALERT_NUMBERS, FRESH_MS, MILESTONES, alertText, insOf, launchFresh, mcapUsd, milestonesPassed, presaleEvents, shortWallet, usdShort } from "../server/alertrules.js";

const NOW = 1_800_000_000_000;
const S = NOW / 1000;
const C = "Creator111111111111111111111111111111111111";
const A = "Alice1111111111111111111111111111111111111";
const B = "Bobby1111111111111111111111111111111111111";
const seat = (user, commit, creator = false) => ({ user, commit: String(commit), deposit: String(commit), creator });
const view = (over = {}) => ({
  presale: "P1", where: "er", state: "OPEN", creator: C, openedTs: S - 60, deadlineTs: S + 3000, fullTs: 0, raised: "0",
  token: { symbol: "MOON", creator: C }, launch: null, seats: [seat(C, 100_000_000n, true)], ...over,
});
const kinds = (r) => r.events.map((e) => `${e.kind}:${e.user ?? (e.to ?? []).join("+")}`);

test("a fresh open: the creator opened it; who's in is the baseline", () => {
  const r = presaleEvents(null, view(), NOW);
  assert.deepEqual(r.ins, [C]);
  assert.deepEqual(kinds(r), [`opened:${C}`]);
  assert.equal(r.events[0].ticker, "$MOON");
  // exactly FRESH_MS old still counts as fresh
  assert.deepEqual(kinds(presaleEvents(null, view({ openedTs: S - FRESH_MS / 1000 }), NOW)), [`opened:${C}`]);
});

test("a presale first seen long after it opened: nothing, what's in it is the baseline", () => {
  const r = presaleEvents(null, view({ openedTs: S - FRESH_MS / 1000 - 1, seats: [seat(C, 1n, true), seat(A, 1n)] }), NOW);
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.ins.sort(), [A, C].sort());
  // first seen already FULL, opened within the half hour: it's not a fresh open (no opened, no joins), only the fill
  const late = presaleEvents(null, view({ state: "FULL", fullTs: S - 5, seats: [seat(C, 1n, true), seat(A, 1n)] }), NOW);
  assert.deepEqual(kinds(late), [`filled:${[C, A].join("+")}`]);
});

test("joins: a wallet whose seat gets SOL in; a seat with nothing in isn't a join yet", () => {
  const prev = { ins: [C] };
  const zero = presaleEvents(prev, view({ seats: [seat(C, 1n, true), seat(A, 0n)] }), NOW);
  assert.deepEqual(zero.events, []);
  const r = presaleEvents(prev, view({ seats: [seat(C, 1n, true), seat(A, 250_000_000n)] }), NOW);
  assert.deepEqual(kinds(r), [`join:${A}`]);
  assert.deepEqual(r.events[0], { kind: "join", presale: "P1", user: A, commit: "250000000", creator: C, ticker: "$MOON" });
  // seen again: nothing new
  assert.deepEqual(presaleEvents({ ins: r.ins }, view({ seats: [seat(C, 1n, true), seat(A, 250_000_000n)] }), NOW).events, []);
});

test("a stale view changes nothing and keeps the last who's in", () => {
  const r = presaleEvents({ ins: [C, A] }, view({ stale: true, seats: [] }), NOW);
  assert.deepEqual(r, { ins: [C, A], events: [] });
});

test("filled: once the pool is full, to everyone in; not once launched, not when old", () => {
  const prev = { ins: [C, A] };
  const full = view({ state: "FULL", fullTs: S - 5, seats: [seat(C, 1n, true), seat(A, 1n), seat(B, 1n)] });
  const r = presaleEvents(prev, full, NOW);
  assert.deepEqual(kinds(r), [`join:${B}`, `filled:${[C, A, B].join("+")}`]);
  assert.deepEqual(presaleEvents(prev, { ...full, fullTs: S - FRESH_MS / 1000 - 1 }, NOW).events.map((e) => e.kind), ["join"]);
  // a launch already recorded: launched, not filled
  assert.deepEqual(presaleEvents(prev, { ...full, launch: { sig: "x", at: NOW - 3_000 } }, NOW).events.map((e) => e.kind), ["join", "launched"]);
});

test("launched, then each seat's tokens arriving as its seat closes; the closed record ends it", () => {
  const launch = { sig: "x", at: NOW - 3_000 };
  const settled = view({ state: "SETTLED", launch, seats: [seat(C, 1n, true), seat(A, 1n), seat(B, 1n)] });
  const r1 = presaleEvents({ ins: [C, A, B] }, settled, NOW);
  assert.deepEqual(kinds(r1), [`launched:${[C, A, B].join("+")}`]);
  // a read that skipped from OPEN to the launch still tells who joined on the way
  const skipped = presaleEvents({ ins: [C] }, settled, NOW);
  assert.deepEqual(kinds(skipped), [`join:${A}`, `join:${B}`, `launched:${[C, A, B].join("+")}`]);
  const r2 = presaleEvents({ ins: r1.ins }, { ...settled, seats: [seat(C, 1n, true), seat(B, 1n)] }, NOW);
  assert.deepEqual(kinds(r2), [`launched:${[C, A, B].join("+")}`, `arrived:${A}`]);
  const closed = { presale: "P1", where: "closed", state: "CLOSED", token: { symbol: "MOON", creator: C }, launch, seats: [] };
  const r3 = presaleEvents({ ins: r2.ins }, closed, NOW);
  assert.deepEqual(kinds(r3), [`launched:${[C, B].join("+")}`, `arrived:${C}`, `arrived:${B}`]);
  // an old launch is not news: no launched and no arrived
  assert.deepEqual(presaleEvents({ ins: [C] }, { ...closed, launch: { at: NOW - FRESH_MS - 1 } }, NOW).events, []);
});

test("an expired presale's seats leaving are refunds, not arrivals", () => {
  assert.deepEqual(presaleEvents({ ins: [C, A] }, view({ state: "EXPIRED", seats: [] }), NOW).events, []);
});

test("market cap: dollars from the pool's price and SOL/USD; milestones once each", () => {
  // sqrtPrice for 1e-7 SOL per token (raw: 1e-7 * 1e9 / 1e6 = 1e-4 lamports per raw unit)
  const sqrtPrice = String(BigInt(Math.round(Math.sqrt(1e-4) * 2 ** 64)));
  const usd = mcapUsd({ pool: { sqrtPrice } }, 150);
  assert.ok(Math.abs(usd - 15_000) < 1, String(usd)); // 1e-7 * 1e9 = 100 SOL = $15,000
  assert.equal(mcapUsd({ pool: null }, 150), null);
  assert.equal(mcapUsd({ pool: { sqrtPrice } }, 0), null);
  assert.deepEqual(milestonesPassed([], 1_200_000), [100_000, 500_000, 1_000_000]);
  assert.deepEqual(milestonesPassed([100_000, 500_000], 1_200_000), [1_000_000]);
  assert.deepEqual(milestonesPassed([], 99_999), []);
  assert.deepEqual(milestonesPassed([], 100_000), [100_000]); // exactly on a line counts as passed
  assert.deepEqual(MILESTONES, [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000]);
  assert.deepEqual(ALERT_NUMBERS, { milestones: MILESTONES, freshMs: 30 * 60_000, quietMax: 20, groupMs: 10_000, maxAlerts: 100, maxDevices: 5 });
  assert.equal(FRESH_MS, ALERT_NUMBERS.freshMs);
  assert.equal(launchFresh({ launch: { at: NOW - 1 } }, NOW), true);
  assert.equal(launchFresh({ launch: { at: NOW - FRESH_MS - 1 } }, NOW), false);
});

test("the words", () => {
  assert.equal(shortWallet(A), "Alic…1111");
  assert.deepEqual([usdShort(100_000), usdShort(1_000_000), usdShort(1_234_567), usdShort(999_999), usdShort(10_000_000)], ["$100K", "$1M", "$1.23M", "$1M", "$10M"]);
  const e = { presale: "P1", ticker: "$MOON" };
  assert.deepEqual(alertText("filled", e), { title: "$MOON filled", body: "The pool is full. It launches in a moment.", url: "/presale/P1" });
  assert.deepEqual(alertText("launched", e), { title: "$MOON launched", body: "It's live on Solana. Your tokens are on the way.", url: "/coin/P1" });
  assert.deepEqual(alertText("arrived", e), { title: "Your $MOON arrived", body: "Your tokens are in your wallet.", url: "/coin/P1" });
  assert.deepEqual(alertText("joined", { ...e, user: A, commit: "250000000" }), { title: "Alic…1111 joined $MOON", body: "0.25 SOL in your presale.", url: "/presale/P1" });
  assert.equal(alertText("follow", { ...e, users: [A], opened: null }).title, "Alic…1111 joined $MOON");
  assert.equal(alertText("follow", { ...e, users: [A], opened: A }).title, "Alic…1111 opened $MOON");
  assert.equal(alertText("follow", { ...e, users: [A, B], opened: null }).title, "2 people you follow are in $MOON");
  assert.deepEqual(alertText("follow", { ...e, users: [A, B, C], opened: C }), { title: "3 people you follow are in $MOON", body: "Tap to see who's in.", url: "/presale/P1" });
  assert.deepEqual(alertText("mcap", { ...e, usd: 1_000_000, now: 1_234_567 }), { title: "$MOON passed $1M market cap", body: "It's at $1.23M now.", url: "/coin/P1" });
  assert.deepEqual(alertText("room", { ...e, amount: "250000000" }), { title: "$MOON has room", body: "There's room for your 0.25 SOL. Tap to join.", url: "/presale/P1?join=250000000" });
  assert.deepEqual(insOf(view({ seats: [seat(A, 0n), seat(C, 1n, true)] })), [C]);
  assert.throws(() => alertText("nope", e), /no words for nope/);
  // the market-cap switch's label (src/alertkinds.js) lists exactly these lines
  const lines = MILESTONES.map(usdShort);
  assert.equal(KIND_LABEL.mcap, `A coin passes ${lines.slice(0, -1).join(", ")} or ${lines.at(-1)}`);
});
