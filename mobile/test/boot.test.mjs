// The loading screen's lines: real checks, shown one after another.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootLines, bootState, shownLines } from "../src/boot.js";

const base = { version: "0.1.0", info: null, infoError: null, rpc: null, loaded: false, feedError: null, presales: {}, feedLate: false };
const texts = (lines) => lines.map((l) => `${l.state} ${l.text}`);

test("at the start every line waits and only the first shows", () => {
  const lines = bootLines(base);
  assert.deepEqual(texts(lines), [
    "wait mooner v0.1.0 · connecting",
    "wait rpc · checking",
    "wait solana slot · reading",
    "wait presales · loading",
  ]);
  assert.deepEqual(shownLines(lines).map((l) => l.id), ["server"]);
  assert.equal(bootState(lines), "wait");
});

test("all loaded: the boot log's four lines, counted by state", () => {
  const presales = {
    a: { state: "OPEN" }, b: { state: "OPEN" }, c: { state: "OPEN" },
    d: { state: "FULL" }, e: { state: "SETTLED" }, f: { state: "EXPIRED" },
  };
  const lines = bootLines({ ...base, info: { cluster: "mainnet" }, rpc: { ms: 42, slot: 453713798 }, loaded: true, presales });
  assert.deepEqual(texts(lines), [
    "ok mooner v0.1.0 · mainnet",
    "ok rpc ok 42 ms",
    "ok solana slot 453,713,798",
    "ok 3 presales open · 1 launching",
  ]);
  assert.equal(shownLines(lines).length, 4);
  assert.equal(bootState(lines), "ok");
});

test("one presale reads singular; none reads 0", () => {
  const one = bootLines({ ...base, loaded: true, presales: { a: { state: "OPEN" }, b: { state: "LAUNCHING" } } });
  assert.equal(one[3].text, "1 presale open · 1 launching");
  assert.equal(bootLines({ ...base, loaded: true })[3].text, "0 presales open · 0 launching");
});

test("failures say what broke, and the lines after a failure still show", () => {
  const lines = bootLines({ ...base, infoError: "the server didn't answer in 10 s", rpc: { error: "rpc down" }, feedLate: true });
  assert.deepEqual(texts(lines), [
    "fail server · the server didn't answer in 10 s",
    "fail rpc · rpc down",
    "fail solana slot · no rpc",
    "fail presales · live feed not connected",
  ]);
  assert.equal(shownLines(lines).length, 4);
  assert.equal(bootState(lines), "fail");
});

test("a feed error beats lateness; a snapshot beats both", () => {
  assert.equal(bootLines({ ...base, feedError: "couldn't read presales", feedLate: true })[3].text, "presales · couldn't read presales");
  assert.equal(bootLines({ ...base, loaded: true, feedError: "x", feedLate: true })[3].state, "ok");
});

test("a fail with lines still waiting is a fail", () => {
  assert.equal(bootState(bootLines({ ...base, infoError: "no" })), "fail");
});
