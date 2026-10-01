import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBootCache } from "../src/bootcache.js";

const AUTH = { authToken: "t", selectedAccount: { address: "W" }, accounts: [] };

/** secureJson's { get, set, clear } over one value; `fail` names the calls that reject */
function fakeSaved(value, fail = []) {
  const s = { value, calls: [] };
  const run = (name, fn) => {
    s.calls.push(name);
    if (fail.includes(name)) return Promise.reject(new Error(`keystore ${name} failed`));
    return Promise.resolve(fn());
  };
  s.get = () => run("get", () => s.value);
  s.set = (v) => run("set", () => void (s.value = v));
  s.clear = () => run("clear", () => void (s.value = undefined));
  return s;
}

test("nothing is read until the saved read resolves", async () => {
  let resolve;
  const saved = { get: () => new Promise((r) => (resolve = r)) };
  const { cache, boot } = makeBootCache(saved);
  assert.deepEqual(boot.getState(), { read: false, has: false });
  const got = cache.get();
  await Promise.resolve();
  assert.deepEqual(boot.getState(), { read: false, has: false });
  resolve(AUTH);
  assert.equal(await got, AUTH);
  assert.deepEqual(boot.getState(), { read: true, has: true });
});

test("an empty read is read, with nothing saved", async () => {
  const { cache, boot } = makeBootCache(fakeSaved(undefined));
  assert.equal(await cache.get(), undefined);
  assert.deepEqual(boot.getState(), { read: true, has: false });
});

test("a saved value without a selected account doesn't count", async () => {
  const { cache, boot } = makeBootCache(fakeSaved({ authToken: "t", accounts: [] }));
  await cache.get();
  assert.deepEqual(boot.getState(), { read: true, has: false });
});

test("a failed read is read, with nothing saved, and doesn't throw", async () => {
  const { cache, boot } = makeBootCache(fakeSaved(AUTH, ["get"]));
  assert.equal(await cache.get(), undefined);
  assert.deepEqual(boot.getState(), { read: true, has: false });
});

test("set, then clear", async () => {
  const saved = fakeSaved(undefined);
  const { cache, boot } = makeBootCache(saved);
  await cache.get();
  await cache.set(AUTH);
  assert.equal(saved.value, AUTH);
  assert.deepEqual(boot.getState(), { read: true, has: true });
  await cache.clear();
  assert.equal(saved.value, undefined);
  assert.deepEqual(boot.getState(), { read: true, has: false });
  assert.deepEqual(saved.calls, ["get", "set", "clear"]);
});

test("a failed set or clear doesn't throw, and the state still follows it", async () => {
  const saved = fakeSaved(undefined, ["set", "clear"]);
  const { cache, boot } = makeBootCache(saved);
  await cache.get();
  await cache.set(AUTH);
  assert.deepEqual(boot.getState(), { read: true, has: true });
  await cache.clear();
  assert.deepEqual(boot.getState(), { read: true, has: false });
  assert.deepEqual(saved.calls, ["get", "set", "clear"]);
});

test("a storage call that throws before it returns a promise is caught too", async () => {
  const boom = () => {
    throw new Error("keystore unavailable");
  };
  const { cache, boot } = makeBootCache({ get: boom, set: boom, clear: boom });
  assert.equal(await cache.get(), undefined);
  await cache.set(AUTH);
  assert.deepEqual(boot.getState(), { read: true, has: true });
  await cache.clear();
  assert.deepEqual(boot.getState(), { read: true, has: false });
});
