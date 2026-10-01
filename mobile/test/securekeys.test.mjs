import { test } from "node:test";
import assert from "node:assert/strict";
import { safeName, secureJson, secureKeys } from "../src/securekeys.js";

function fakeStore() {
  const m = new Map();
  return {
    m,
    getItemAsync: async (k) => (m.has(k) ? m.get(k) : null),
    setItemAsync: async (k, v) => void m.set(k, v),
    deleteItemAsync: async (k) => void m.delete(k),
  };
}

test("safeName keeps letters, digits, dot, dash and underscore", () => {
  assert.equal(safeName("mooner:session:Abc123:Xyz"), "mooner_session_Abc123_Xyz");
  assert.equal(safeName("a.b-c_d"), "a.b-c_d");
});

test("secureKeys: what flows.js stores, under a safe name", async () => {
  const s = fakeStore();
  const keys = secureKeys(s);
  assert.equal(await keys.get("mooner:session:P:W"), null);
  await keys.set("mooner:session:P:W", "c2VjcmV0");
  assert.deepEqual([...s.m.keys()], ["mooner_session_P_W"]);
  assert.equal(await keys.get("mooner:session:P:W"), "c2VjcmV0");
});

test("secureJson: get, set, clear, a reviver, and junk reads as missing", async () => {
  const s = fakeStore();
  const j = secureJson(s, "mwa:mainnet", (k, v) => (k === "n" ? v * 2 : v));
  assert.equal(await j.get(), undefined);
  await j.set({ n: 2, x: "y" });
  assert.deepEqual(await j.get(), { n: 4, x: "y" });
  s.m.set("mwa_mainnet", "{not json");
  assert.equal(await j.get(), undefined);
  await j.clear();
  assert.equal(s.m.size, 0);
});
