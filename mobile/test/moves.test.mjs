// The phone's moves as numbers: entrances, the scenes' slow moves, Reduce motion, typing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVES, TYPE_MS, moveFor, typedText } from "../src/ui/moves.js";

test("entrances: each end has opacity, y and scale", () => {
  assert.deepEqual(moveFor("rise"), { ms: 450, ease: [0, 0, 0.58, 1], from: { opacity: 0, y: 16, scale: 1 }, to: { opacity: 1, y: 0, scale: 1 } });
  const pop = moveFor("pop");
  assert.deepEqual(pop.ease, [0.3, 1.6, 0.5, 1]);
  assert.deepEqual(pop.from, { opacity: 0, y: 0, scale: 0.3 });
  const stamp = moveFor("stamp");
  assert.equal(stamp.from.scale, 2.4);
  assert.equal(stamp.ms, 500);
  assert.equal(moveFor("fade").ms, 250);
  assert.equal(moveFor("slideUp").from.y, 40);
});

test("the scenes: a slow zoom out, and a lift into place", () => {
  const kb = moveFor("kenBurns");
  assert.equal(kb.ms, 9000);
  assert.equal(kb.from.scale, 1.14);
  assert.equal(kb.to.scale, 1.02);
  const lift = moveFor("lift");
  assert.deepEqual(lift.from, { opacity: 1, y: 90, scale: 1.12 });
  assert.equal(lift.ms, 1500);
});

test("Reduce motion: entrances fade, scenes hold still at their end", () => {
  assert.deepEqual(moveFor("pop", true), moveFor("fade"));
  assert.deepEqual(moveFor("stamp", true), moveFor("fade"));
  const kb = moveFor("kenBurns", true);
  assert.equal(kb.ms, 0);
  assert.deepEqual(kb.from, kb.to);
  assert.equal(kb.to.scale, 1.02);
  assert.equal(moveFor("lift", true).ms, 0);
});

test("only the seven moves; a bump isn't one", () => {
  assert.throws(() => moveFor("bump"), /unknown move: bump/);
  assert.equal(Object.keys(MOVES).length, 7);
});

test("typedText: one code point every 18 ms", () => {
  assert.equal(TYPE_MS, 18);
  assert.equal(typedText("gm 🚀", 0), "");
  assert.equal(typedText("gm 🚀", 17), "");
  assert.equal(typedText("gm 🚀", 18), "g");
  assert.equal(typedText("gm 🚀", 54), "gm ");
  assert.equal(typedText("gm 🚀", 72), "gm 🚀");
  assert.equal(typedText("gm 🚀", 10_000), "gm 🚀");
  assert.equal(typedText(null, 100), "");
});
