// The launch's four steps, from the presale's state and its launched row: never a timer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP_LABELS, launchSteps } from "../src/launchsteps.js";

const seat = (user, commit) => ({ user, commit: String(commit), deposit: String(commit), creator: false });
const states = (r) => r.steps.map((s) => s.state);
const ROW = { presale: "P", mint: "M", launch: { at: 1 } };

test("the four labels", () => {
  assert.deepEqual(STEP_LABELS, ["Pool full", "Meteora pool created", "One buy, one price for everyone", "Sending everyone their tokens"]);
});

test("FULL with no launched row yet: the pool is being made", () => {
  const r = launchSteps({ state: "FULL", seats: [seat("a", 5)] }, undefined);
  assert.deepEqual(states(r), ["done", "now", "todo", "todo"]);
  assert.equal(r.toGo, null);
  assert.equal(r.done, false);
  assert.equal(r.failed, false);
  assert.equal(r.steps[3].label, "Sending everyone their tokens");
});

test("the launched row ticks the pool and the buy together; committed seats left are to go", () => {
  const r = launchSteps({ state: "LAUNCHING", seats: [seat("a", 5), seat("b", 3), seat("c", 0)] }, ROW);
  assert.deepEqual(states(r), ["done", "done", "done", "now"]);
  assert.equal(r.toGo, 2); // c has nothing in the pool
  assert.deepEqual(r.steps.map((s) => s.label), [...STEP_LABELS.slice(0, 3), "Sending everyone their tokens · 2 to go"]);
  assert.equal(r.done, false);
});

test("every seat claimed: all four done", () => {
  const r = launchSteps({ state: "SETTLED", seats: [] }, ROW);
  assert.deepEqual(states(r), ["done", "done", "done", "done"]);
  assert.equal(r.toGo, 0);
  assert.equal(r.done, true);
  assert.equal(r.steps[3].label, "Sending everyone their tokens");
});

test("SETTLED counts as launched before its row comes", () => {
  const r = launchSteps({ state: "SETTLED", seats: [seat("a", 1)] }, undefined);
  assert.deepEqual(states(r), ["done", "done", "done", "now"]);
  assert.equal(r.toGo, 1);
});

test("a closed record with its launch is done", () => {
  const r = launchSteps({ state: "CLOSED", launch: { sig: "S" }, seats: [] }, undefined);
  assert.equal(r.done, true);
  assert.equal(r.failed, false);
});

test("closed after its launch: done, even with seats a client still holds", () => {
  for (const view of [{ state: "CLOSED", launch: { sig: "S" }, seats: [seat("a", 5)] }, { state: "CLOSED", launch: { sig: "S" } }]) {
    const r = launchSteps(view, undefined);
    assert.equal(r.toGo, 0);
    assert.equal(r.done, true);
    assert.equal(r.steps[3].label, "Sending everyone their tokens");
  }
  assert.equal(launchSteps({ state: "CLOSED", seats: [seat("a", 5)] }, ROW).done, true);
});

test("a view with no seats (the list's) never says the tokens went out", () => {
  const r = launchSteps({ state: "SETTLED" }, ROW);
  assert.equal(r.toGo, null);
  assert.deepEqual(states(r), ["done", "done", "done", "now"]);
  assert.equal(r.done, false);
});

test("FAILED, EXPIRED, or CLOSED without a launch: failed, and no step is now", () => {
  for (const state of ["FAILED", "EXPIRED", "CLOSED"]) {
    const r = launchSteps({ state, seats: [] }, undefined);
    assert.deepEqual(states(r), ["done", "todo", "todo", "todo"], state);
    assert.equal(r.failed, true, state);
    assert.equal(r.done, false, state);
  }
});

test("no view yet: only the pool step", () => {
  const r = launchSteps(undefined, undefined);
  assert.deepEqual(states(r), ["done", "now", "todo", "todo"]);
  assert.equal(r.failed, false);
});
