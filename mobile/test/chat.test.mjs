// The chat's pure rules: typing at the 280 limit, what TalkBack reads, and the floating
// emojis' one queue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_MAX } from "../../engine/src/emoji.js";
import { FLOAT_GAP_MS, FLOAT_MAX } from "../../engine/src/cues.js";
import { FLOATS_FLYING, FLOATS_WAITING, floatStep, queueFloats, readableChat, typedChat } from "../src/room/chat.js";

const at = (n) => "a".repeat(n);

test("typedChat: under the limit the text is kept, control characters become spaces", () => {
  assert.equal(typedChat("", "gm"), "gm");
  assert.equal(typedChat("gm", "gm\nall\tday"), "gm all day");
  assert.equal(typedChat(at(CHAT_MAX - 1), at(CHAT_MAX)), at(CHAT_MAX), "up to the limit");
});

test("typedChat: typing anywhere in a full message changes nothing (its end isn't cut off)", () => {
  const full = "x" + at(CHAT_MAX - 2) + "z";
  assert.equal([...full].length, CHAT_MAX);
  const typedMid = "x" + at(10) + "b" + at(CHAT_MAX - 12) + "z";
  assert.equal(typedChat(full, typedMid), full, "the change is refused: the last z stays");
  assert.equal(typedChat(full, full + "!"), full);
  assert.equal(typedChat(full, full.slice(0, -1)), full.slice(0, -1), "deleting still works");
});

test("typedChat: a paste that grows past the limit from under it is cut to the limit", () => {
  assert.equal(typedChat("gm ", "gm " + at(400)), "gm " + at(CHAT_MAX - 3));
  assert.equal([...typedChat("", "🌙".repeat(300))].length, CHAT_MAX, "code points, as the server counts");
});

test("readableChat: emojis read as their names, the rest as typed", () => {
  assert.equal(readableChat(":lfg:"), "lfg");
  assert.equal(readableChat("gm:lfg::moon: all"), "gm lfg moon all");
  assert.equal(readableChat(":nope: hi"), ":nope: hi", "unknown names stay text");
  assert.equal(readableChat("plain"), "plain");
  assert.equal(readableChat(undefined), "");
});

test("queueFloats: up to FLOAT_MAX from a line join one queue; past FLOATS_WAITING the oldest waiting go", () => {
  assert.deepEqual(queueFloats([], "gm :lfg: :moon:"), ["lfg", "moon"]);
  assert.deepEqual(queueFloats(["gg"], ":fire:"), ["gg", "fire"]);
  assert.equal(queueFloats([], ":gm:".repeat(9)).length, FLOAT_MAX);
  assert.deepEqual(queueFloats([], "no emojis"), []);
  let q = [];
  for (let i = 0; i < 50; i++) q = queueFloats(q, i === 49 ? ":rug::wen:" : ":lfg::moon::gm::gg:");
  assert.equal(q.length, FLOATS_WAITING);
  assert.deepEqual(q.slice(-2), ["rug", "wen"], "the newest are kept");
});

test("floatStep: one float at a time, FLOAT_GAP_MS apart across every line", () => {
  let s = { queue: ["lfg", "moon", "gm"], last: -Infinity };
  let r = floatStep(s, 1000, 0);
  assert.deepEqual(r, { start: "lfg", queue: ["moon", "gm"], last: 1000, wait: FLOAT_GAP_MS });
  r = floatStep(r, 1000, 1);
  assert.deepEqual(r, { start: null, queue: ["moon", "gm"], last: 1000, wait: FLOAT_GAP_MS }, "two lines at once don't start together");
  r = floatStep(r, 1000 + FLOAT_GAP_MS - 60, 1);
  assert.equal(r.start, null);
  assert.equal(r.wait, 60);
  r = floatStep(r, 1000 + FLOAT_GAP_MS, 1);
  assert.equal(r.start, "moon");
  r = floatStep(r, 1000 + 2 * FLOAT_GAP_MS, 2);
  assert.deepEqual(r, { start: "gm", queue: [], last: 1000 + 2 * FLOAT_GAP_MS, wait: null }, "nothing left: no next step");
  assert.deepEqual(floatStep({ queue: [], last: 5 }, 9999, 0), { start: null, queue: [], last: 5, wait: null });
});

test("floatStep: with FLOATS_FLYING in flight nothing starts; the head waits a gap", () => {
  const r = floatStep({ queue: ["lfg"], last: 0 }, 10_000, FLOATS_FLYING);
  assert.deepEqual(r, { start: null, queue: ["lfg"], last: 0, wait: FLOAT_GAP_MS });
  assert.equal(floatStep(r, 10_000 + FLOAT_GAP_MS, FLOATS_FLYING - 1).start, "lfg");
});
