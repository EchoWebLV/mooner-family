// The phone's store with a fake socket, API, flows and secure storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMoonerStore, launchedList, liveList, myPresales } from "../src/store.js";

const W = "Wallet1111";
const signer = { publicKey: { toBase58: () => W }, signTransaction: async (t) => t, sendTransaction: async () => "SIG", signMessage: async () => new Uint8Array(64) };

function rig({ flows: over = {}, api: apiOver = {}, now = 1_000_000 } = {}) {
  const subs = new Map(); // topic -> Set<fn>
  const status = new Set();
  const live = {
    subscribe(topic, fn) {
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic).add(fn);
      return () => subs.get(topic).delete(fn);
    },
    onStatus(fn) {
      status.add(fn);
      fn(false);
      return () => status.delete(fn);
    },
  };
  const push = (topic, type, data) => [...(subs.get(topic) ?? [])].forEach((fn) => fn({ topic, type, data }));
  const listening = (topic) => (subs.get(topic)?.size ?? 0) > 0;
  const disk = new Map();
  const saved = (name) => ({
    get: async () => (disk.has(name) ? structuredClone(disk.get(name)) : undefined),
    set: async (v) => void disk.set(name, structuredClone(v)),
    clear: async () => void disk.delete(name),
  });
  const calls = [];
  const info = { N: { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n } };
  const flows = {
    loadInfo: async () => info,
    joinPresale: async (a) => {
      calls.push(["join", a]);
      a.onStep("Sign in your wallet to put the SOL in");
    },
    getBack: async (a) => {
      calls.push(["back", a]);
      a.onStep("Checking your seat");
    },
    joinCost: async () => ({ total: 90_300n }),
    ...over,
  };
  const api = {
    presale: async (key) => ({ presale: key, state: "OPEN", seats: [] }),
    login: async (body) => ({ wallet: body.wallet, token: "tok", exp: now + 1000 }),
    sendChat: async (token, channel, text) => (calls.push(["chat", token, channel, text]), { id: 1 }),
    ...apiOver,
  };
  const store = createMoonerStore({ live, api, flows, saved, now: () => now });
  const goUp = (up) => [...status].forEach((fn) => fn(up));
  return { store, push, listening, disk, calls, info, goUp };
}

const tick = () => new Promise((r) => setImmediate(r));

test("start: listens to the public topics, loads info, follows the socket", async () => {
  const { store, listening, goUp } = rig();
  const stop = store.getState().start();
  for (const t of ["presales", "launched", "profiles", "sol"]) assert.ok(listening(t), t);
  await tick();
  assert.ok(store.getState().info);
  goUp(true);
  assert.equal(store.getState().socketUp, true);
  stop();
  assert.equal(listening("presales"), false);
});

test("info that failed loads again when the socket comes up", async () => {
  let fail = true;
  const { store, goUp } = rig({ flows: { loadInfo: async () => { if (fail) throw new Error("the server took too long"); return { N: {} }; } } });
  store.getState().start();
  await tick();
  assert.equal(store.getState().info, null);
  assert.match(store.getState().infoError, /took too long/);
  fail = false;
  goUp(true);
  await tick();
  assert.deepEqual(store.getState().info, { N: {} });
  assert.equal(store.getState().infoError, null);
});

test("presales: snapshot, upsert, remove", () => {
  const { store, push } = rig();
  store.getState().start();
  push("presales", "snapshot", [{ presale: "A", raised: "1" }, { presale: "B", raised: "2" }]);
  push("presales", "upsert", { presale: "A", raised: "5" });
  push("presales", "remove", { presale: "B" });
  assert.deepEqual(store.getState().presales, { A: { presale: "A", raised: "5" } });
});

test("launched, profiles, sol", () => {
  const { store, push } = rig();
  store.getState().start();
  push("launched", "snapshot", [{ presale: "A", launch: { at: 1 } }]);
  push("launched", "upsert", { presale: "B", launch: { at: 2 } });
  push("profiles", "snapshot", { X: { skin: 1 } });
  push("profiles", "upsert", { wallet: "Y", pfp: { skin: 2 } });
  push("sol", "snapshot", { usd: 150, at: 1 });
  push("sol", "snapshot", { usd: 0 });
  const s = store.getState();
  assert.deepEqual(Object.keys(s.launched), ["A", "B"]);
  assert.deepEqual(s.profiles, { X: { skin: 1 }, Y: { skin: 2 } });
  assert.equal(s.solUsd, 150);
});

test("watch: a presale's view and its chat, until let go", () => {
  const { store, push, listening } = rig();
  const off = store.getState().watch("A");
  push("presale:A", "snapshot", { presale: "A", state: "OPEN" });
  push("chat:A", "snapshot", [{ id: 1, text: "a" }, { id: 2, text: "b" }]);
  push("chat:A", "message", { id: 3, text: "c" });
  push("chat:A", "message", { id: 3, text: "c" }); // a repeat is dropped
  assert.equal(store.getState().views.A.state, "OPEN");
  assert.deepEqual(store.getState().chats.A.map((r) => r.id), [1, 2, 3]);
  push("presale:A", "missing");
  assert.equal(store.getState().missing.A, true);
  off();
  assert.equal(listening("presale:A"), false);
  assert.equal(listening("chat:A"), false);
});

test("chat keeps the last 200", () => {
  const { store, push } = rig();
  store.getState().watch("A");
  push("chat:A", "snapshot", Array.from({ length: 199 }, (_, i) => ({ id: i + 1 })));
  push("chat:A", "message", { id: 200 });
  push("chat:A", "message", { id: 201 });
  const ids = store.getState().chats.A.map((r) => r.id);
  assert.equal(ids.length, 200);
  assert.equal(ids[0], 2);
  assert.equal(ids[199], 201);
});

test("setWallet: its SOL, its saved sign-in and presales; switching away lets go", async () => {
  const { store, push, listening, disk } = rig();
  disk.set(`mooner:login:${W}`, { token: "old", exp: 2_000_000 });
  disk.set(`mooner:mine:${W}`, { A: { deposit: "100000000", at: 1 } });
  await store.getState().setWallet(W);
  push(`wallet:${W}`, "snapshot", { lamports: 123 });
  let s = store.getState();
  assert.equal(s.wallet, W);
  assert.equal(s.lamports, 123);
  assert.deepEqual(s.session, { token: "old", exp: 2_000_000 });
  assert.deepEqual(Object.keys(s.mine), ["A"]);
  await store.getState().setWallet(null);
  s = store.getState();
  assert.equal(listening(`wallet:${W}`), false);
  assert.equal(s.wallet, null);
  assert.equal(s.session, null);
  assert.deepEqual(s.mine, {});
});

test("an expired saved sign-in isn't used", async () => {
  const { store, disk } = rig({ now: 5_000_000 });
  disk.set(`mooner:login:${W}`, { token: "old", exp: 2_000_000 });
  await store.getState().setWallet(W);
  assert.equal(store.getState().session, null);
});

test("join: a fresh view, the flow with steps, then remembered", async () => {
  const { store, calls, disk, info } = rig();
  await store.getState().setWallet(W);
  const steps = [];
  const unsub = store.subscribe((s, prev) => s.busy?.step && s.busy.step !== prev.busy?.step && steps.push(s.busy.step));
  const r = await store.getState().join("A", 100_000_000n, signer);
  unsub();
  assert.deepEqual(r, { ok: true, value: undefined });
  const [, a] = calls.find((c) => c[0] === "join");
  assert.equal(a.info, info);
  assert.equal(a.view.presale, "A");
  assert.equal(a.amount, 100_000_000n);
  assert.equal(a.wallet, signer.publicKey);
  assert.equal(a.signTransaction, signer.signTransaction);
  assert.deepEqual(steps, ["Sign in your wallet to put the SOL in"]);
  assert.equal(store.getState().busy, null);
  assert.equal(store.getState().mine.A.deposit, "100000000");
  assert.equal(disk.get(`mooner:mine:${W}`).A.deposit, "100000000");
});

test("an action that fails says why, in plain words, and frees the store", async () => {
  const { store } = rig({ flows: { joinPresale: async () => { throw new Error("User rejected the request"); } } });
  await store.getState().setWallet(W);
  const r = await store.getState().join("A", 100_000_000n, signer);
  assert.deepEqual(r, { ok: false, error: "You cancelled it in your wallet." });
  assert.equal(store.getState().busy, null);
});

test("one action at a time", async () => {
  let release;
  const { store } = rig({ flows: { joinPresale: () => new Promise((r) => (release = r)) } });
  await store.getState().setWallet(W);
  const first = store.getState().join("A", 100_000_000n, signer);
  const second = await store.getState().getBack("A", signer);
  assert.equal(second.ok, false);
  await tick(); // let the join reach joinPresale
  release();
  assert.equal((await first).ok, true);
});

test("getBack: the flow with both wallet functions, then marked as back", async () => {
  const { store, calls } = rig();
  await store.getState().setWallet(W);
  await store.getState().join("A", 100_000_000n, signer);
  const r = await store.getState().getBack("A", signer);
  assert.equal(r.ok, true);
  const [, a] = calls.find((c) => c[0] === "back");
  assert.equal(a.sendTransaction, signer.sendTransaction);
  assert.equal(a.view.presale, "A");
  assert.equal(store.getState().mine.A.back, 1_000_000);
});

test("joinCost: the flow's total", async () => {
  const { store } = rig();
  assert.equal(await store.getState().joinCost(), 90_300n);
});

test("sendChat signs in first when there's no session, then sends", async () => {
  const { store, calls } = rig({ now: 1_790_000_000_000 });
  await store.getState().setWallet(W);
  // a signer whose signature checks out is engine/test/signin.test.js's job; here signIn is stubbed
  store.setState({ session: null });
  const signed = [];
  const r = await store.getState().sendChat("A", "  gm  ", signer, { signIn: async () => (signed.push(1), { token: "fresh", exp: 1_790_000_100_000 }) });
  assert.equal(r.ok, true);
  assert.deepEqual(signed, [1]);
  assert.deepEqual(calls.find((c) => c[0] === "chat"), ["chat", "fresh", "A", "gm"]);
});

test("sendChat: a 401 forgets the session", async () => {
  const err = Object.assign(new Error("your sign-in ran out, sign in again"), { status: 401 });
  const { store } = rig({ api: { sendChat: async () => { throw err; } } });
  await store.getState().setWallet(W);
  store.setState({ session: { token: "t", exp: 9e15 } });
  const r = await store.getState().sendChat("A", "gm", signer);
  assert.equal(r.ok, false);
  assert.equal(store.getState().session, null);
});

test("selectors: Live fullest first, Launched newest first, my presales", () => {
  const s = {
    wallet: W,
    presales: {
      A: { presale: "A", state: "OPEN", raised: "100", deadlineTs: 9, users: [] },
      B: { presale: "B", state: "OPEN", raised: "300", deadlineTs: 9, users: [{ user: W, commit: "1" }] },
      C: { presale: "C", state: "FULL", raised: "500", deadlineTs: 9, users: [] },
    },
    launched: { L1: { presale: "L1", launch: { at: 1 } }, L2: { presale: "L2", launch: { at: 2 } } },
    views: {},
    mine: { L1: { deposit: "1", at: 1 } },
  };
  assert.deepEqual(liveList(s).map((v) => v.presale), ["B", "A"]);
  assert.deepEqual(launchedList(s).map((r) => r.presale), ["L2", "L1"]);
  assert.deepEqual(myPresales(s).sort(), ["B", "L1"]);
});
