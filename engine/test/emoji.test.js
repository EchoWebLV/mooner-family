// The 12 Mooner chat emojis, `$TICKER` links and the 280 code-point limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_MAX, EMOJI, chatParts, clipChat, codePoints, emojiOnly, emojisIn } from "../src/emoji.js";

test("EMOJI: the 12 names", () => {
  assert.deepEqual([...EMOJI].sort(), ["diamond", "fire", "gg", "gm", "jeet", "lfg", "moon", "ngmi", "pump", "rug", "ser", "wen"]);
});

test("chatParts: a known :name: is an emoji, an unknown one stays text", () => {
  assert.deepEqual(chatParts("gm :lfg: all"), [
    { kind: "text", text: "gm " },
    { kind: "emoji", name: "lfg", text: ":lfg:" },
    { kind: "text", text: " all" },
  ]);
  assert.deepEqual(chatParts(":nope: hi"), [{ kind: "text", text: ":nope: hi" }]);
  assert.deepEqual(chatParts(":LFG:"), [{ kind: "text", text: ":LFG:" }]);
  assert.deepEqual(chatParts(""), []);
  assert.deepEqual(chatParts(undefined), []);
});

test("chatParts: an unknown name doesn't swallow the known one after it", () => {
  assert.deepEqual(chatParts("a :foo:moon: b"), [
    { kind: "text", text: "a :foo" },
    { kind: "emoji", name: "moon", text: ":moon:" },
    { kind: "text", text: " b" },
  ]);
});

test("chatParts: $TICKER links only for coins in the map, next to emojis", () => {
  const tickers = new Map([["MOON", "mint1"]]);
  assert.deepEqual(chatParts("buy $moon :fire:", tickers), [
    { kind: "text", text: "buy " },
    { kind: "ticker", text: "$moon", tokenId: "mint1" },
    { kind: "text", text: " " },
    { kind: "emoji", name: "fire", text: ":fire:" },
  ]);
  assert.deepEqual(chatParts("buy $NOPE", tickers), [{ kind: "text", text: "buy $NOPE" }]);
  assert.deepEqual(chatParts("buy $MOON"), [{ kind: "text", text: "buy $MOON" }]);
});

test("emojiOnly: only emojis and spaces", () => {
  assert.equal(emojiOnly(chatParts(":lfg: :moon:")), true);
  assert.equal(emojiOnly(chatParts(":lfg:")), true);
  assert.equal(emojiOnly(chatParts(":lfg: gm")), false);
  assert.equal(emojiOnly(chatParts("gm")), false);
  assert.equal(emojiOnly(chatParts("")), false);
});

test("emojisIn: the emojis in order, at most `max`", () => {
  assert.deepEqual(emojisIn(":lfg: x :moon::fire: :gg: :gm:", 4), ["lfg", "moon", "fire", "gg"]);
  assert.deepEqual(emojisIn("no emojis :nope:"), []);
});

test("280 code points: an emoji counts once, as the server counts", () => {
  const rockets = "🚀".repeat(280);
  assert.equal(rockets.length, 560); // UTF-16 units, what maxLength counted
  assert.equal(codePoints(rockets), CHAT_MAX);
  assert.equal(clipChat(rockets), rockets);
  assert.equal(clipChat(rockets + "🚀"), rockets);
  assert.equal(clipChat("a".repeat(281)), "a".repeat(280));
  assert.equal(codePoints(null), 0);
});
