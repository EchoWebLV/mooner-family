// Me's rows: each of the wallet's presales with its coin and where the wallet stands, read
// from the server's shapes (lamports as strings).
import { test } from "node:test";
import assert from "node:assert/strict";
import { meTab, rowsOf, statusOf, tokenOf } from "../src/me.js";

const ME = "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const KEY = "11111111111111111111111111111111";
const KEY2 = "So11111111111111111111111111111111111111112";

const token = (symbol) => ({
  mint: "Mint111", creator: OTHER, name: symbol, symbol, description: "",
  links: { twitter: null, telegram: null, website: null }, image: `https://x.test/${symbol}.png`, uri: "ipfs://x", createdAt: 1,
});
const listItem = (users, over = {}) => ({ presale: KEY, where: "er", state: "OPEN", creator: OTHER, raised: "200000000", users, token: token("LIST"), launch: null, ...over });
const listUser = (user, commit) => ({ user, commit, creator: false });
const detail = (seats, over = {}) => ({ presale: KEY, where: "er", state: "OPEN", creator: OTHER, raised: "200000000", seats, token: token("VIEW"), launch: null, ...over });
const seat = (user, deposit, commit = deposit) => ({ seat: "Seat111", user, deposit, commit, settled: false, claimed: false, creator: false, where: "er" });
const launchedRow = { presale: KEY, mint: "Mint111", token: token("MOON"), launch: { sig: "Sig", released: "0", cost: "0", tokens: "0", units: "0", at: 1 }, pool: null };

const state = (over = {}) => ({ wallet: ME, presales: {}, views: {}, launched: {}, mine: {}, ...over });
const status = (over) => statusOf({ key: KEY, ...state(over) });

test("statusOf: a launched coin reads Launched and opens the coin, whatever else is known", () => {
  assert.deepEqual(
    status({
      launched: { [KEY]: launchedRow },
      mine: { [KEY]: { deposit: "250000000", at: 1, back: 2 } },
      views: { [KEY]: detail([seat(ME, "250000000")], { state: "SETTLED" }) },
    }),
    { kind: "launched", text: "Launched", to: `/coin/${KEY}` },
  );
});

test("statusOf: SOL got back from this phone reads SOL back, before any seat still listed", () => {
  assert.deepEqual(
    status({
      mine: { [KEY]: { deposit: "250000000", at: 1, back: 2 } },
      presales: { [KEY]: listItem([listUser(ME, "250000000")]) },
    }),
    { kind: "back", text: "SOL back", to: `/presale/${KEY}` },
  );
});

test("statusOf: past OPEN (no users in the list), the seat in the room's view gives the amount", () => {
  assert.deepEqual(
    status({
      presales: { [KEY]: listItem(undefined, { state: "FULL" }) },
      views: { [KEY]: detail([seat(OTHER, "500000000"), seat(ME, "250000000")], { state: "FULL" }) },
    }),
    { kind: "in", text: "In · 0.25 SOL", to: `/presale/${KEY}` },
  );
});

test("statusOf: FULL or LAUNCHING with no view (after a restart), this phone's join gives the amount", () => {
  for (const state of ["FULL", "LAUNCHING"]) {
    assert.deepEqual(
      status({ presales: { [KEY]: listItem(undefined, { state }) }, mine: { [KEY]: { deposit: "250000000", at: 1 } } }),
      { kind: "in", text: "In · 0.25 SOL", to: `/presale/${KEY}` },
    );
  }
});

test("statusOf: OPEN without users (the server couldn't read the seats), this phone's join gives the amount", () => {
  assert.equal(
    status({ presales: { [KEY]: listItem(undefined) }, mine: { [KEY]: { deposit: "100000000", at: 1 } } }).text,
    "In · 0.1 SOL",
  );
});

test("statusOf: a row in the open list's users reads In with its commit", () => {
  assert.deepEqual(
    status({ presales: { [KEY]: listItem([listUser(OTHER, "300000000"), listUser(ME, "100000000")]) } }),
    { kind: "in", text: "In · 0.1 SOL", to: `/presale/${KEY}` },
  );
});

test("statusOf: while OPEN the list's users decide, over a seat kept in a view", () => {
  assert.equal(
    status({
      views: { [KEY]: detail([seat(ME, "100000000", "50000000")]) },
      presales: { [KEY]: listItem([listUser(ME, "50000000")]) },
    }).text,
    "In · 0.05 SOL",
  );
  assert.equal(
    status({ views: { [KEY]: detail([seat(ME, "250000000")]) }, presales: { [KEY]: listItem([listUser(OTHER, "250000000")]) } }).text,
    "Closed",
  );
});

test("statusOf: in a stale view without a seat but still in the list, it's In", () => {
  assert.equal(
    status({ views: { [KEY]: detail([]) }, presales: { [KEY]: listItem([listUser(ME, "250000000")]) } }).text,
    "In · 0.25 SOL",
  );
});

test("statusOf: EXPIRED or FAILED read Closed, even with the wallet's seat in a view (the keeper refunds it)", () => {
  for (const state of ["EXPIRED", "FAILED"]) {
    assert.deepEqual(
      status({
        presales: { [KEY]: listItem(undefined, { state }) },
        views: { [KEY]: detail([seat(ME, "250000000")], { state: "OPEN" }) },
        mine: { [KEY]: { deposit: "250000000", at: 1 } },
      }),
      { kind: "closed", text: "Closed", to: `/presale/${KEY}` },
    );
  }
});

test("statusOf: gone from the list, it's Closed, even with the wallet's seat in a view", () => {
  assert.equal(status({ views: { [KEY]: detail([seat(ME, "250000000")], { state: "FULL" }) } }).text, "Closed");
});

test("statusOf: other wallets' seats, or nothing known, read Closed and open the presale", () => {
  const closed = { kind: "closed", text: "Closed", to: `/presale/${KEY}` };
  assert.deepEqual(
    status({ views: { [KEY]: detail([seat(OTHER, "250000000")]) }, presales: { [KEY]: listItem([listUser(OTHER, "250000000")]) } }),
    closed,
  );
  assert.deepEqual(
    status({ presales: { [KEY]: listItem(undefined, { state: "FULL" }) }, views: { [KEY]: detail([seat(OTHER, "250000000")]) } }),
    closed,
  );
  assert.deepEqual(status({ mine: { [KEY]: { deposit: "250000000", at: 1 } } }), closed);
  assert.deepEqual(status({ presales: { [KEY]: listItem(undefined, { state: "EXPIRED" }) } }), closed);
});

test("tokenOf: the list's coin, else the view's, else the launched row's; null when none has it", () => {
  const s = state({
    presales: { [KEY]: listItem([]) },
    views: { [KEY]: detail([]) },
    launched: { [KEY]: launchedRow },
  });
  assert.equal(tokenOf({ ...s, key: KEY }).symbol, "LIST");
  assert.equal(tokenOf({ ...s, key: KEY, presales: {} }).symbol, "VIEW");
  assert.equal(tokenOf({ ...s, key: KEY, presales: {}, views: {} }).symbol, "MOON");
  assert.equal(tokenOf({ ...s, key: KEY, presales: { [KEY]: listItem([], { token: null }) }, views: {} }).symbol, "MOON");
  assert.equal(tokenOf({ ...state(), key: KEY }), null);
});

test("rowsOf: every presale the wallet is in or was in, with its coin and status", () => {
  const rows = rowsOf(
    state({
      mine: { [KEY2]: { deposit: "100000000", at: 1, back: 2 } },
      presales: { [KEY]: listItem([listUser(ME, "250000000")]) },
    }),
  );
  assert.deepEqual(rows, [
    { key: KEY2, token: null, status: { kind: "back", text: "SOL back", to: `/presale/${KEY2}` } },
    { key: KEY, token: token("LIST"), status: { kind: "in", text: "In · 0.25 SOL", to: `/presale/${KEY}` } },
  ]);
});

test("rowsOf: nothing without a wallet", () => {
  assert.deepEqual(rowsOf(state({ wallet: null, mine: { [KEY]: { deposit: "1", at: 1 } } })), []);
});

test("meTab: your face and SOL once both are known, else the Me icon and Me", () => {
  assert.deepEqual(meTab(ME, 2410000000), { face: ME, label: "2.41 SOL", mono: true });
  assert.deepEqual(meTab(ME, 0), { face: ME, label: "0 SOL", mono: true });
  assert.deepEqual(meTab(ME, null), { face: null, label: "Me", mono: false }, "balance not in yet");
  assert.deepEqual(meTab(null, 5), { face: null, label: "Me", mono: false }, "no wallet");
});
