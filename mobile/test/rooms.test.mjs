// Chat's rooms (src/chat/rooms.js): Everyone, then each of your presales whose coin is known;
// and the dot for a global line that came live since Everyone was last shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomsOf, unreadOf } from "../src/chat/rooms.js";

const ME = "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D";
const K1 = "11111111111111111111111111111111";
const K2 = "So11111111111111111111111111111111111111112";
const token = (symbol, image = `https://x.test/${symbol}.png`) => ({ symbol, image });
const state = (over = {}) => ({ wallet: ME, presales: {}, views: {}, launched: {}, mine: {}, ...over });

test("rooms: Everyone first, then your presales with a known coin, in your list's order", () => {
  const s = state({
    mine: { [K1]: { deposit: "1", at: 1 }, [K2]: { deposit: "1", at: 2 } },
    presales: { [K1]: { presale: K1, users: [{ user: ME }], token: token("MOON") } },
  });
  assert.deepEqual(roomsOf(s), [
    { channel: "global", label: "Everyone" },
    { channel: K1, label: "$MOON", image: "https://x.test/MOON.png" },
  ], "K2's coin isn't known: no room for it yet");
});

test("rooms: no wallet, Everyone only; a coin without a picture keeps its chip", () => {
  assert.deepEqual(roomsOf(state({ wallet: null, mine: { [K1]: { deposit: "1", at: 1 } } })), [{ channel: "global", label: "Everyone" }]);
  const s = state({ mine: { [K1]: { deposit: "1", at: 1 } }, launched: { [K1]: { presale: K1, token: token("PIC", null) } } });
  assert.deepEqual(roomsOf(s)[1], { channel: K1, label: "$PIC", image: null });
});

test("unread: a live line newer than the one last seen", () => {
  assert.equal(unreadOf(undefined, 0), false);
  assert.equal(unreadOf([{ id: 3 }, { id: 4 }], 0), false, "the snapshot's lines aren't news");
  assert.equal(unreadOf([{ id: 3 }, { id: 5, live: true }], 4), true);
  assert.equal(unreadOf([{ id: 3 }, { id: 5, live: true }], 5), false);
});
