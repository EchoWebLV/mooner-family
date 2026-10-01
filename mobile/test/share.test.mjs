// The room's share text: plain words, the stage, what's in so far, and the link with the
// sharer's wallet as ref. None for a presale still OPEN past its deadline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shareOf } from "../src/room/share.js";

const KEY = "11111111111111111111111111111111";
const ME = "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D";
const CREATOR = "C".repeat(44);
const N = { TARGET: 500_000_000n };
const BASE = "https://app.mooner.family";
const LINK = `${BASE}/presale/${KEY}?ref=${ME}`;
const NOW = 1_790_000_000_000; // ms
const open = (over = {}) => ({ presale: KEY, state: "OPEN", creator: CREATOR, raised: "120000000", token: { symbol: "MOON" }, users: [], deadlineTs: NOW / 1000 + 600, ...over });
const share = (view, wallet = ME, launched = undefined, now = NOW) => shareOf({ view, launched, wallet, N, base: BASE, now });

test("an open presale: the coin, what's in so far, and the link with my wallet as ref", () => {
  assert.deepEqual(share(open()), {
    title: "$MOON on Mooner",
    message: `The $MOON presale is open on Mooner.\n0.12 of 0.5 SOL in so far.\n${LINK}`,
  });
});

test("who shares: the creator, someone in it (detail or list view), nobody signed in", () => {
  assert.equal(share(open(), CREATOR).message.split("\n")[0], "My $MOON presale is open on Mooner.");
  assert.equal(share(open({ users: [{ user: ME }] })).message.split("\n")[0], "I'm in the $MOON presale on Mooner.");
  assert.equal(share(open({ seats: [{ user: ME, deposit: "100000000", commit: "100000000" }] })).message.split("\n")[0], "I'm in the $MOON presale on Mooner.");
  assert.equal(share(open(), null).message, `The $MOON presale is open on Mooner.\n0.12 of 0.5 SOL in so far.\n${BASE}/presale/${KEY}`, "no wallet: no ref");
});

test("no token details yet: plain words, still the link", () => {
  assert.deepEqual(share(open({ token: null })), {
    title: "A presale on Mooner",
    message: `This presale is open on Mooner.\n0.12 of 0.5 SOL in so far.\n${LINK}`,
  });
});

test("after the presale: launching, live, migrated, closed", () => {
  assert.equal(share(open({ state: "LAUNCHING" })).message, `$MOON is launching on Mooner.\n${LINK}`);
  assert.equal(share(open({ state: "CLOSED" }), ME, { pool: { migrated: false } }).message, `$MOON is live on Mooner.\n${LINK}`);
  assert.equal(share(open({ state: "CLOSED" }), ME, { pool: { migrated: true } }).message, `$MOON is live on Mooner.\n${LINK}`);
  assert.equal(share(open({ state: "EXPIRED" })).message, `The $MOON presale on Mooner has closed.\n${LINK}`);
});

test("no game words in any of it", () => {
  const views = [open(), open({ token: null }), open({ state: "LAUNCHING" }), open({ state: "EXPIRED" }), open({ users: [{ user: ME }] })];
  for (const v of views) for (const w of [ME, CREATOR, null]) {
    const { title, message } = share(v, w);
    assert.doesNotMatch(`${title}\n${message}`, /player|lobby|match|game|level|quest/i);
  }
});

test("past deadline gets no Share: an OPEN presale whose time is up has nothing to join yet", () => {
  assert.equal(share(open({ deadlineTs: NOW / 1000 - 1 })), null);
  assert.equal(share(open(), ME, undefined, NOW + 600_000), null, "the deadline itself");
  assert.equal(share(open({ deadlineTs: undefined })), null, "no deadline known");
  assert.equal(share(open({ state: "LAUNCHING", deadlineTs: NOW / 1000 - 1 })).message, `$MOON is launching on Mooner.\n${LINK}`, "after OPEN the deadline doesn't matter");
});
