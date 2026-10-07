// The phone's store with a fake socket, API, flows and secure storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMoonerStore, myPresales } from "../src/store.js";

const W = "Wallet1111";
const signer = { publicKey: { toBase58: () => W }, signTransaction: async (t) => t, sendTransaction: async () => "SIG", signMessage: async () => new Uint8Array(64) };

function rig({ flows: over = {}, api: apiOver = {}, market: marketOver = {}, now = 1_000_000, wrapSaved = (base) => base } = {}) {
  const clock = typeof now === "function" ? now : () => now;
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
  const pushRaw = (msg) => [...(subs.get(msg.topic) ?? [])].forEach((fn) => fn(msg));
  const listening = (topic) => (subs.get(topic)?.size ?? 0) > 0;
  const disk = new Map();
  const saved = wrapSaved((name) => ({
    get: async () => (disk.has(name) ? structuredClone(disk.get(name)) : undefined),
    set: async (v) => void disk.set(name, structuredClone(v)),
    clear: async () => void disk.delete(name),
  }));
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
    login: async (body) => ({ wallet: body.wallet, token: "tok", exp: clock() + 1000 }),
    sendChat: async (token, channel, text) => (calls.push(["chat", token, channel, text]), { id: 1 }),
    ...apiOver,
  };
  const market = {
    quote: async (side, mint, amount) => (calls.push(["quote", side, mint, amount]), { side, inAmount: amount, outAmount: 7n, minOut: 7n, route: [] }),
    holding: async (wallet, mint) => (calls.push(["holding", wallet, mint]), { raw: 5_000_000n, decimals: 6, ui: 5 }),
    swap: async (q, s, onStep) => {
      calls.push(["swap", q, s]);
      onStep("Sign the trade in your wallet");
      return "SIG";
    },
    ...marketOver,
  };
  const store = createMoonerStore({ live, api, flows, saved, market, now: clock });
  const goUp = (up) => [...status].forEach((fn) => fn(up));
  return { store, push, pushRaw, listening, disk, calls, info, goUp, status };
}

const tick = () => new Promise((r) => setImmediate(r));

test("start: listens to the public topics, loads info, follows the socket", async () => {
  const { store, listening, goUp } = rig();
  const stop = store.getState().start();
  for (const t of ["presales", "launched", "profiles", "sol", "chat:global"]) assert.ok(listening(t), t);
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

test("presale: an error push says why until the next snapshot; a new watch starts clean", () => {
  const { store, push, pushRaw } = rig();
  const off = store.getState().watch("K");
  pushRaw({ topic: "presale:K", type: "error", error: "couldn't read this right now" });
  assert.equal(store.getState().viewError.K, "couldn't read this right now");
  assert.equal(store.getState().views.K, undefined, "an error is not a view");
  push("presale:K", "snapshot", { presale: "K", state: "OPEN" });
  assert.equal(store.getState().viewError.K, undefined);
  pushRaw({ topic: "presale:K", type: "error", error: "x" });
  off();
  store.getState().watch("K");
  assert.equal(store.getState().viewError.K, undefined);
});

test("presale: an error push with no words still says something; missing clears it", () => {
  const { store, pushRaw, push } = rig();
  store.getState().watch("K");
  pushRaw({ topic: "presale:K", type: "error" });
  assert.equal(store.getState().viewError.K, "couldn't read this right now");
  push("presale:K", "missing");
  assert.equal(store.getState().missing.K, true);
  assert.equal(store.getState().viewError.K, undefined);
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

test("chat: lines pushed one by one are marked live, the snapshot's aren't", () => {
  const { store, push } = rig();
  store.getState().watch("A");
  push("chat:A", "snapshot", [{ id: 1, text: "gm" }]);
  push("chat:A", "message", { id: 2, text: ":lfg:" });
  const rows = store.getState().chats.A;
  assert.equal(rows[0].live, undefined);
  assert.equal(rows[1].live, true);
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

test("join after a get-back: the new seat's deposit and time, and no old back", async () => {
  let t = 1_000;
  const { store, disk } = rig({ now: () => t });
  await store.getState().setWallet(W);
  await store.getState().join("A", 100_000_000n, signer);
  t = 2_000;
  await store.getState().getBack("A", signer);
  assert.equal(store.getState().mine.A.back, 2_000);
  t = 3_000;
  await store.getState().join("A", 250_000_000n, signer);
  const entry = store.getState().mine.A;
  assert.equal(entry.back, null);
  assert.equal(entry.deposit, "250000000");
  assert.equal(entry.at, 3_000);
  assert.equal(disk.get(`mooner:mine:${W}`).A.back, null);
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

test("selectors: my presales", () => {
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
  assert.deepEqual(myPresales(s).sort(), ["B", "L1"]);
});

// ---- review fixes ----

const OTHER = "Wallet2222";

test("getBack: the refunded seat leaves the room's view and the list's users", async () => {
  const { store, push } = rig();
  await store.getState().setWallet(W);
  store.getState().start();
  store.getState().watch("A");
  push("presale:A", "snapshot", { presale: "A", state: "OPEN", seats: [{ seat: "s1", user: W, commit: "0", creator: false }, { seat: "s2", user: OTHER, commit: "5", creator: true }] });
  push("presales", "snapshot", [{ presale: "A", state: "OPEN", users: [{ user: W, commit: "0" }, { user: OTHER, commit: "5" }] }, { presale: "B", state: "OPEN", users: [{ user: W, commit: "1" }] }]);
  const r = await store.getState().getBack("A", signer);
  assert.equal(r.ok, true);
  const s = store.getState();
  assert.deepEqual(s.views.A.seats.map((x) => x.user), [OTHER]);
  assert.deepEqual(s.presales.A.users.map((x) => x.user), [OTHER]);
  assert.deepEqual(s.presales.B.users.map((x) => x.user), [W], "another presale is left alone");
});

test("getBack with nothing watched changes no view", async () => {
  const { store } = rig();
  await store.getState().setWallet(W);
  const r = await store.getState().getBack("A", signer);
  assert.equal(r.ok, true);
  assert.deepEqual(store.getState().views, {});
});

test("getBack that fails: the error in plain words, the store freed, the seat stays", async () => {
  const { store, push } = rig({ flows: { getBack: async () => { throw new Error("Your seat isn't back yet; try again in a moment."); } } });
  await store.getState().setWallet(W);
  store.getState().watch("A");
  push("presale:A", "snapshot", { presale: "A", state: "OPEN", seats: [{ seat: "s1", user: W, commit: "0" }] });
  const r = await store.getState().getBack("A", signer);
  assert.deepEqual(r, { ok: false, error: "Your seat isn't back yet; try again in a moment." });
  const s = store.getState();
  assert.equal(s.busy, null);
  assert.equal(s.views.A.seats.length, 1);
  assert.equal(s.mine.A, undefined);
});

for (const topic of ["presales", "launched"]) {
  const other = topic === "presales" ? "launched" : "presales";
  const rows = (st) => (topic === "presales" ? st.presales : st.launched);

  test(`${topic}: not loaded until its first snapshot, which may be empty`, () => {
    const { store, push } = rig();
    store.getState().start();
    assert.deepEqual(store.getState().loaded, { presales: false, launched: false });
    assert.deepEqual(rows(store.getState()), {});
    push(topic, "snapshot", []);
    assert.equal(store.getState().loaded[topic], true);
    assert.equal(store.getState().loaded[other], false, "the other feed is untouched");
    assert.deepEqual(rows(store.getState()), {});
  });

  test(`${topic}: an error push says why, the next snapshot clears it`, () => {
    const { store, push, pushRaw } = rig();
    store.getState().start();
    assert.deepEqual(store.getState().feedError, { presales: null, launched: null });
    pushRaw({ topic, type: "error", error: "couldn't read this right now" });
    assert.equal(store.getState().feedError[topic], "couldn't read this right now");
    assert.equal(store.getState().feedError[other], null);
    assert.equal(store.getState().loaded[topic], false, "an error is not a snapshot");
    push(topic, "snapshot", []);
    assert.equal(store.getState().feedError[topic], null);
    assert.equal(store.getState().loaded[topic], true);
  });
}

test("sendChat: when sign-in fails, the user sees its real error and nothing is sent", async () => {
  const { store, calls } = rig();
  await store.getState().setWallet(W);
  const r = await store.getState().sendChat("A", "gm", signer, { signIn: async () => { throw new Error("The wallet's signature didn't check out. Try another wallet."); } });
  assert.deepEqual(r, { ok: false, error: "The wallet's signature didn't check out. Try another wallet." });
  assert.equal(calls.some((c) => c[0] === "chat"), false);
});

test("sendChat sends with the session sign-in returned, even if the store's wallet isn't this signer's", async () => {
  const { store, calls } = rig({ now: 1_790_000_000_000 });
  // no setWallet: signIn can't put the session in the store, so only what it returned is there
  const r = await store.getState().sendChat("A", "gm", signer, { signIn: async () => ({ token: "fresh", exp: 1_790_000_100_000 }) });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls.find((c) => c[0] === "chat"), ["chat", "fresh", "A", "gm"]);
});

test("join: the wallet switching meanwhile doesn't lose the record or touch the other wallet's", async () => {
  let release;
  const { store, disk } = rig({ flows: { joinPresale: () => new Promise((r) => (release = r)) } });
  disk.set(`mooner:mine:${OTHER}`, { Z: { deposit: "1", at: 1 } });
  await store.getState().setWallet(W);
  const joining = store.getState().join("A", 100_000_000n, signer);
  await tick(); // the join is inside joinPresale
  await store.getState().setWallet(OTHER);
  release();
  assert.equal((await joining).ok, true);
  assert.equal(disk.get(`mooner:mine:${W}`).A.deposit, "100000000", "saved for the wallet that joined");
  assert.deepEqual(disk.get(`mooner:mine:${OTHER}`), { Z: { deposit: "1", at: 1 } }, "the other wallet's record is as it was");
  assert.deepEqual(Object.keys(store.getState().mine), ["Z"], "state shows the wallet that's connected now");
});

test("join: a save that throws on the spot doesn't turn a landed join into a failure", async () => {
  const wrapSaved = () => () => ({ get: async () => undefined, set: () => { throw new Error("storage is gone"); }, clear: async () => {} });
  const { store } = rig({ wrapSaved });
  await store.getState().setWallet(W);
  const r = await store.getState().join("A", 100_000_000n, signer);
  assert.equal(r.ok, true);
  assert.equal(store.getState().mine.A.deposit, "100000000", "still shown for this session");
});

test("stop lets go of the socket's state too: socketUp is false again", () => {
  const { store, goUp } = rig();
  const stop = store.getState().start();
  goUp(true);
  assert.equal(store.getState().socketUp, true);
  stop();
  assert.equal(store.getState().socketUp, false);
});

test("start twice shares nothing: the first stop leaves the second running, the last lets go", async () => {
  const loads = [];
  const { store, listening, status } = rig({ flows: { loadInfo: async () => (loads.push(1), { N: {} }) } });
  const stopA = store.getState().start();
  const stopB = store.getState().start();
  await tick();
  assert.equal(loads.length, 1, "a second start loads nothing again");
  assert.equal(status.size, 1, "one status watcher");
  stopA();
  stopA(); // a stop called twice counts once
  assert.ok(listening("presales"), "still running for the second start");
  stopB();
  for (const t of ["presales", "launched", "profiles", "sol", "chat:global"]) assert.equal(listening(t), false, t);
  assert.equal(status.size, 0);
  // and it can start again
  const stopC = store.getState().start();
  assert.ok(listening("presales"));
  stopC();
});

test("signOut: forgets the sign-in and the wallet, keeps what it joined", async () => {
  const { store, disk, listening } = rig();
  disk.set(`mooner:login:${W}`, { token: "old", exp: 2_000_000 });
  disk.set(`mooner:mine:${W}`, { A: { deposit: "100000000", at: 1 } });
  await store.getState().setWallet(W);
  assert.ok(store.getState().session);
  await store.getState().signOut();
  const s = store.getState();
  assert.equal(s.wallet, null);
  assert.equal(s.session, null);
  assert.deepEqual(s.mine, {});
  assert.equal(listening(`wallet:${W}`), false);
  assert.equal(disk.has(`mooner:login:${W}`), false, "the saved sign-in is gone");
  assert.equal(disk.get(`mooner:mine:${W}`).A.deposit, "100000000", "its presales are still saved");
});

// ---- a launched coin: its stats, the wallet's balance of it, buy and sell ----

const MINT = "Mint1111";
const holdingReads = (calls) => calls.filter((c) => c[0] === "holding").length;

test("watchCoin: the coin's stats while a screen shows it; missing and errors say so", () => {
  const { store, push, listening } = rig();
  const offA = store.getState().watchCoin(MINT);
  const offB = store.getState().watchCoin(MINT);
  assert.ok(listening(`coin:${MINT}`));
  push(`coin:${MINT}`, "error", undefined);
  assert.equal(store.getState().coinError[MINT], "couldn't read this right now");
  const stats = { mint: MINT, venue: "dbc", candles: [], volume24hUsd: 812.5 };
  push(`coin:${MINT}`, "snapshot", stats);
  assert.equal(store.getState().coins[MINT], stats);
  assert.equal(store.getState().coinError[MINT], undefined, "a snapshot clears the error");
  push(`coin:${MINT}`, "missing", undefined);
  assert.equal(store.getState().coinMissing[MINT], true);
  offA();
  offA(); // counts once
  assert.ok(listening(`coin:${MINT}`), "the second screen still watches");
  offB();
  assert.equal(listening(`coin:${MINT}`), false);
});

test("the wallet's balance of a coin: read when the screen opens and when the wallet's SOL moves, never on a timer", async () => {
  const { store, push, calls } = rig();
  store.getState().watchCoin(MINT);
  await tick();
  assert.equal(holdingReads(calls), 0, "no wallet, no read");
  await store.getState().setWallet(W);
  await tick();
  assert.deepEqual(calls.filter((c) => c[0] === "holding"), [["holding", W, MINT]], "connecting reads the watched coin");
  assert.deepEqual(store.getState().holdings[MINT], { raw: 5_000_000n, decimals: 6, ui: 5 });
  push(`wallet:${W}`, "snapshot", { lamports: "900000000" });
  await tick();
  assert.equal(holdingReads(calls), 1, "the first SOL figure is no change");
  push(`wallet:${W}`, "snapshot", { lamports: "800000000" });
  await tick();
  assert.equal(holdingReads(calls), 2, "the SOL moved: read again");
  await store.getState().setWallet(null);
  assert.deepEqual(store.getState().holdings, {}, "another wallet's balances go with it");
});

test("a coin screen that stops watching reads no more", async () => {
  const { store, push, calls } = rig();
  await store.getState().setWallet(W);
  push(`wallet:${W}`, "snapshot", { lamports: "900000000" });
  const off = store.getState().watchCoin(MINT);
  await tick();
  assert.equal(holdingReads(calls), 1, "opening reads once");
  off();
  push(`wallet:${W}`, "snapshot", { lamports: "800000000" });
  await tick();
  assert.equal(holdingReads(calls), 1);
});

test("a balance read that lands after a newer one, or after the wallet changed, is dropped", async () => {
  const waits = [];
  const { store, push } = rig({ market: { holding: () => new Promise((resolve) => waits.push(resolve)) } });
  await store.getState().setWallet(W);
  push(`wallet:${W}`, "snapshot", { lamports: "900000000" });
  store.getState().watchCoin(MINT);
  push(`wallet:${W}`, "snapshot", { lamports: "800000000" });
  assert.equal(waits.length, 2);
  waits[1]({ raw: 2n, decimals: 6, ui: 0.000002 });
  await tick();
  waits[0]({ raw: 1n, decimals: 6, ui: 0.000001 });
  await tick();
  assert.equal(store.getState().holdings[MINT].raw, 2n, "the older read lost");
  push(`wallet:${W}`, "snapshot", { lamports: "700000000" });
  await store.getState().setWallet(null);
  waits[2]({ raw: 3n, decimals: 6, ui: 0.000003 });
  await tick();
  assert.deepEqual(store.getState().holdings, {});
});

test("a balance read from before a switch away and back to the same wallet is dropped", async () => {
  const W2 = "Other2222";
  const waits = [];
  const { store } = rig({ market: { holding: (wallet) => new Promise((resolve) => waits.push({ wallet, resolve })) } });
  store.getState().watchCoin(MINT);
  await store.getState().setWallet(W);
  await store.getState().setWallet(W2);
  await store.getState().setWallet(W);
  assert.deepEqual(waits.map((w) => w.wallet), [W, W2, W]);
  waits[0].resolve({ raw: 1n, decimals: 6, ui: 0.000001 });
  waits[1].resolve({ raw: 2n, decimals: 6, ui: 0.000002 });
  await tick();
  assert.equal(store.getState().holdings[MINT], undefined, "W's first read and W2's are both stale");
  waits[2].resolve({ raw: 3n, decimals: 6, ui: 0.000003 });
  await tick();
  assert.equal(store.getState().holdings[MINT].raw, 3n);
});

test("a failed balance read leaves the last one", async () => {
  let fail = false;
  const { store, push } = rig({
    market: {
      holding: async () => {
        if (fail) throw new Error("fetch failed");
        return { raw: 5_000_000n, decimals: 6, ui: 5 };
      },
    },
  });
  await store.getState().setWallet(W);
  push(`wallet:${W}`, "snapshot", { lamports: "900000000" });
  store.getState().watchCoin(MINT);
  await tick();
  const had = store.getState().holdings[MINT];
  assert.deepEqual(had, { raw: 5_000_000n, decimals: 6, ui: 5 });
  fail = true;
  push(`wallet:${W}`, "snapshot", { lamports: "800000000" });
  await tick();
  assert.equal(store.getState().holdings[MINT], had);
});

test("preview: Jupiter's quote, or the no-route words the sheet shows", async () => {
  const noRoute = Object.assign(new Error("no route for this trade yet"), { noRoute: true });
  let fail = null;
  const { store, calls } = rig({ market: { quote: async (side, mint, amount) => { if (fail) throw fail; calls.push(["quote", side, mint, amount]); return { outAmount: 7n }; } } });
  assert.deepEqual(await store.getState().preview("buy", MINT, 100_000_000n), { ok: true, value: { outAmount: 7n } });
  assert.deepEqual(calls, [["quote", "buy", MINT, 100_000_000n]]);
  fail = noRoute;
  assert.deepEqual(await store.getState().preview("buy", MINT, 1n), { ok: false, error: "No route for this trade yet. Try again in a moment.", noRoute: true });
  fail = new Error("Rate limit exceeded");
  assert.deepEqual(await store.getState().preview("sell", MINT, 1n), { ok: false, error: "Rate limit exceeded", noRoute: false });
});

test("trade: a fresh quote, the swap with the screen's signer, then the balance; one at a time", async () => {
  const { store, calls } = rig();
  await store.getState().setWallet(W);
  const steps = [];
  const unsub = store.subscribe((s, was) => s.busy && s.busy !== was.busy && steps.push([s.busy.kind, s.busy.step]));
  const r = await store.getState().trade("sell", MINT, 2_500_000n, signer, { atLeast: 7n });
  unsub();
  assert.deepEqual(r, { ok: true, value: { sig: "SIG", quote: { side: "sell", inAmount: 2_500_000n, outAmount: 7n, minOut: 7n, route: [] } } });
  assert.deepEqual(calls.map((c) => c[0]), ["quote", "swap", "holding"], "no coin screen open: the trade reads the balance after");
  assert.equal(calls[1][2], signer);
  assert.deepEqual(steps, [["sell", null], ["sell", "Getting a price from Jupiter"], ["sell", "Sign the trade in your wallet"]]);
  assert.equal(store.getState().busy, null);
});

test("trade: a balance read that never answers doesn't hold the trade or the next one", async () => {
  const { store, calls } = rig({ market: { holding: () => new Promise(() => {}) } });
  await store.getState().setWallet(W);
  const r = await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: 7n });
  assert.equal(r.ok, true);
  assert.equal(r.value.sig, "SIG");
  assert.equal(store.getState().busy, null);
  assert.equal((await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: 7n })).ok, true, "the next trade isn't told to wait");
  assert.equal(calls.filter((c) => c[0] === "swap").length, 2);
});

test("trade: a failed swap in plain words; a second trade waits for the first", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
  const { store } = rig({
    market: {
      swap: async () => {
        await gate;
        throw new Error(`trade (SIG): ix 3 (${JUP}): custom 6001`);
      },
    },
  });
  const first = store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: 7n });
  await tick();
  assert.deepEqual(await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: 7n }), { ok: false, error: "Wait for the last one to finish." });
  release();
  assert.deepEqual(await first, { ok: false, error: "The price moved more than 3% before your trade landed, so it didn't go through. Try again." });
});

test("launched: an upsert that first brings a coin's launch notes this phone's clock; a snapshot's rows don't", () => {
  let t = 5_000;
  const { store, push } = rig({ now: () => t });
  store.getState().start();
  push("launched", "snapshot", [{ presale: "A", mint: "MA", launch: { at: 1 } }]);
  push("launched", "upsert", { presale: "A", mint: "MA", launch: { at: 1 }, pool: {} });
  push("launched", "upsert", { presale: "B", mint: "MB", launch: null });
  t = 6_000;
  push("launched", "upsert", { presale: "B", mint: "MB", launch: { at: 5_500 } });
  t = 7_000;
  push("launched", "upsert", { presale: "B", mint: "MB", launch: { at: 5_500 }, pool: {} });
  push("launched", "upsert", { presale: "C", mint: "MC", launch: { at: 6_900 } });
  assert.deepEqual(store.getState().launchSeen, { MB: 6_000, MC: 7_000 }, "A came in the snapshot; B from its first row with a launch; later rows change nothing");
  push("launched", "snapshot", [{ presale: "B", mint: "MB", launch: { at: 5_500 } }]);
  assert.deepEqual(store.getState().launchSeen, { MB: 6_000, MC: 7_000 }, "a snapshot (a reconnect) keeps them");
});

test("launched: an upsert before the feed's snapshot doesn't note the clock (an old coin's pool change can come first)", () => {
  let t = 100_000;
  const { store, push } = rig({ now: () => t });
  store.getState().start();
  push("launched", "upsert", { presale: "A", mint: "MA", launch: { at: 99_000 }, pool: {} });
  assert.deepEqual(store.getState().launchSeen, {});
  push("launched", "snapshot", [{ presale: "A", mint: "MA", launch: { at: 99_000 } }]);
  push("launched", "upsert", { presale: "A", mint: "MA", launch: { at: 99_000 }, pool: {} });
  assert.deepEqual(store.getState().launchSeen, {}, "the snapshot had its launch already");
});

test("launched: only a launch within 34 s of this phone's clock (the tax, its margin and 30 s) is noted", () => {
  let t = 1_000_000;
  const { store, push } = rig({ now: () => t });
  store.getState().start();
  push("launched", "snapshot", []);
  push("launched", "upsert", { presale: "A", mint: "MA", launch: { at: t - 34_000 } });
  push("launched", "upsert", { presale: "B", mint: "MB", launch: { at: t - 34_001 } });
  push("launched", "upsert", { presale: "C", mint: "MC", launch: { at: t - 3 * 3600_000 } });
  push("launched", "upsert", { presale: "D", mint: "MD", launch: { at: t + 34_000 } });
  push("launched", "upsert", { presale: "E", mint: "ME", launch: { at: t + 34_001 } });
  assert.deepEqual(store.getState().launchSeen, { MA: 1_000_000, MD: 1_000_000 });
});

test("trade: a fresh price below the minimum the sheet showed goes back to the sheet unsigned", async () => {
  const { store, calls } = rig();
  await store.getState().setWallet(W);
  const r = await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: 8n });
  assert.deepEqual(r, {
    ok: false,
    moved: true,
    value: { quote: { side: "buy", inAmount: 100_000_000n, outAmount: 7n, minOut: 7n, route: [] } },
    error: "The price moved. Check the new numbers and press again.",
  });
  assert.deepEqual(calls.map((c) => c[0]), ["quote"], "no swap: nothing to sign");
  assert.equal(store.getState().busy, null);
});

// A market whose quotes come from `answer(slippageBps)`; it notes the slippage each quote asked for.
function quoting(answer) {
  const asked = [];
  return {
    asked,
    market: {
      quote: async (side, mint, amount, slippageBps) => {
        asked.push(slippageBps);
        return { side, inAmount: amount, route: [], ...answer(slippageBps) };
      },
    },
  };
}

test("trade: a fresh quote whose own minimum reaches the one the sheet showed is swapped as it is", async () => {
  const { asked, market } = quoting(() => ({ outAmount: 1_000n, minOut: 970n }));
  const { store, calls } = rig({ market });
  await store.getState().setWallet(W);
  const r = await store.getState().trade("sell", MINT, 2_500_000n, signer, { atLeast: 970n });
  assert.equal(r.ok, true);
  assert.equal(r.value.sig, "SIG");
  assert.deepEqual(asked, [undefined], "one quote, at the default slippage");
  assert.deepEqual(calls.map((c) => c[0]), ["swap", "holding"]);
  assert.equal(calls[0][1].minOut, 970n, "the swap enforces the minimum the sheet showed");
});

test("trade: a fresh price above the shown minimum but with a looser minimum is quoted again tighter and that one is swapped", async () => {
  const { asked, market } = quoting((bps) => (bps == null ? { outAmount: 1_000n, minOut: 970n } : { outAmount: 1_000n, minOut: 1_000n - (1_000n * BigInt(bps)) / 10_000n }));
  const { store, calls } = rig({ market });
  await store.getState().setWallet(W);
  const r = await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: 990n });
  assert.equal(r.ok, true);
  assert.deepEqual(asked, [undefined, 100], "(1000 - 990) / 1000 = 100 bps");
  assert.deepEqual(calls.map((c) => c[0]), ["swap", "holding"]);
  const swapped = calls[0][1];
  assert.equal(swapped.minOut, 990n);
  assert.ok(swapped.minOut >= 990n, "the tx can't give less than the sheet showed");
});

test("trade: the slippage left over is floored, so the tight quote's minimum can't fall below the shown one", async () => {
  const { asked, market } = quoting((bps) => (bps == null ? { outAmount: 999n, minOut: 900n } : { outAmount: 999n, minOut: 999n - (999n * BigInt(bps)) / 10_000n }));
  const { store } = rig({ market });
  await store.getState().setWallet(W);
  const r = await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: 990n });
  assert.equal(r.ok, true);
  assert.deepEqual(asked, [undefined, 90], "(999 - 990) * 10000 / 999 = 90.09…, floored to 90");
});

test("trade: under 0.5% left between the fresh price and the shown minimum goes back to the sheet, not quoted again", async () => {
  const { asked, market } = quoting(() => ({ outAmount: 1_000n, minOut: 970n }));
  const { store, calls } = rig({ market });
  await store.getState().setWallet(W);
  const r = await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: 996n });
  assert.deepEqual(r, {
    ok: false,
    moved: true,
    value: { quote: { side: "buy", inAmount: 100_000_000n, route: [], outAmount: 1_000n, minOut: 970n } },
    error: "The price moved. Check the new numbers and press again.",
  });
  assert.deepEqual(asked, [undefined], "40 bps: too tight to quote again");
  assert.deepEqual(calls.map((c) => c[0]), [], "no swap: nothing to sign");
  assert.equal(store.getState().busy, null);
});

test("trade: a tight quote that still comes up short goes back to the sheet with that quote, unsigned", async () => {
  const { asked, market } = quoting((bps) => (bps == null ? { outAmount: 1_000n, minOut: 970n } : { outAmount: 995n, minOut: 985n }));
  const { store, calls } = rig({ market });
  await store.getState().setWallet(W);
  const r = await store.getState().trade("sell", MINT, 2_500_000n, signer, { atLeast: 990n });
  assert.equal(r.ok, false);
  assert.equal(r.moved, true);
  assert.equal(r.error, "The price moved. Check the new numbers and press again.");
  assert.deepEqual(r.value.quote, { side: "sell", inAmount: 2_500_000n, route: [], outAmount: 995n, minOut: 985n }, "the sheet shows the tight quote");
  assert.deepEqual(asked, [undefined, 100]);
  assert.deepEqual(calls.map((c) => c[0]), [], "no swap: nothing to sign");
  assert.equal(store.getState().busy, null);
});

test("trade: with no minimum from the sheet, nothing is quoted or signed", async () => {
  const { store, calls } = rig();
  await store.getState().setWallet(W);
  const refused = { ok: false, error: "Get a price first, then press again." };
  assert.deepEqual(await store.getState().trade("buy", MINT, 100_000_000n, signer), refused);
  assert.deepEqual(await store.getState().trade("sell", MINT, 2_500_000n, signer, {}), refused);
  assert.deepEqual(await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: null }), refused);
  assert.deepEqual(await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast: 7 }), refused, "a minimum that isn't a BigInt isn't one");
  assert.deepEqual(calls, [], "no quote, no swap");
  assert.equal(store.getState().busy, null);
});

test("trade: a fresh quote with no minimum of its own is never signed, however far above the shown one it is", async () => {
  for (const atLeast of [998n, 900n]) {
    const { asked, market } = quoting(() => ({ outAmount: 1_000n }));
    const { store, calls } = rig({ market });
    await store.getState().setWallet(W);
    const r = await store.getState().trade("buy", MINT, 100_000_000n, signer, { atLeast });
    assert.equal(r.ok, false);
    assert.equal(r.moved, true);
    assert.deepEqual(calls.map((c) => c[0]), [], `${atLeast}: no swap`);
    assert.deepEqual(asked, atLeast === 998n ? [undefined] : [undefined, 1_000], `${atLeast}: quoted again only with 0.5% or more to spare`);
  }
});

// ---- share links ----

const KEY = "K".repeat(44);
const SHARER = "S".repeat(44);
const ME = "M".repeat(44);
const me = { ...signer, publicKey: { toBase58: () => ME } };

test("noteRef: a link's ref goes with the next join there, once", async () => {
  const { store, calls, disk } = rig();
  await store.getState().noteRef(KEY, SHARER);
  assert.deepEqual(disk.get("mooner:refs"), { [KEY]: { ref: SHARER, at: 1_000_000 } }, "kept on the phone");
  assert.equal((await store.getState().join(KEY, 100_000_000n, me)).ok, true);
  assert.equal(calls.find((c) => c[0] === "join")[1].ref, SHARER);
  assert.deepEqual(disk.get("mooner:refs"), {}, "dropped once the join landed");
  await store.getState().join(KEY, 100_000_000n, me);
  assert.equal("ref" in calls.filter((c) => c[0] === "join")[1][1], false, "the next join sends none");
});

test("noteRef: never your own wallet, another presale's, or junk", async () => {
  const { store, calls } = rig();
  await store.getState().noteRef(KEY, ME);
  await store.getState().noteRef("P".repeat(44), SHARER);
  await store.getState().noteRef(KEY, "not a wallet");
  await store.getState().join(KEY, 100_000_000n, me);
  assert.equal("ref" in calls.find((c) => c[0] === "join")[1], false);
});

test("noteRef: a join that fails keeps the ref for the next try", async () => {
  let fail = true;
  const { store, calls, disk } = rig({
    flows: {
      joinPresale: async (a) => {
        calls.push(["join", a]);
        if (fail) throw new Error("User rejected the request");
      },
    },
  });
  await store.getState().noteRef(KEY, SHARER);
  assert.equal((await store.getState().join(KEY, 100_000_000n, me)).ok, false);
  assert.equal(disk.get("mooner:refs")[KEY].ref, SHARER);
  fail = false;
  await store.getState().join(KEY, 100_000_000n, me);
  assert.deepEqual(calls.map((c) => c[1].ref), [SHARER, SHARER]);
});

test("noteRef: a ref saved before the app restarted still goes with the join", async () => {
  const wrapSaved = (base) => (name) => {
    const s = base(name);
    if (name === "mooner:refs") s.get = async () => ({ [KEY]: { ref: SHARER, at: 1 } });
    return s;
  };
  const { store, calls } = rig({ wrapSaved });
  await store.getState().join(KEY, 100_000_000n, me);
  assert.equal(calls.find((c) => c[0] === "join")[1].ref, SHARER);
});

test("noteRef: storage that throws still keeps the ref for this session", async () => {
  const wrapSaved = () => () => ({ get: () => { throw new Error("storage is gone"); }, set: () => { throw new Error("storage is gone"); }, clear: async () => {} });
  const { store, calls } = rig({ wrapSaved });
  await store.getState().noteRef(KEY, SHARER);
  assert.equal((await store.getState().join(KEY, 100_000_000n, me)).ok, true);
  assert.equal(calls.find((c) => c[0] === "join")[1].ref, SHARER);
});

test("noteRef: two links noted at once both stay", async () => {
  const { store, disk } = rig();
  const OTHER = "P".repeat(44);
  await Promise.all([store.getState().noteRef(KEY, SHARER), store.getState().noteRef(OTHER, SHARER)]);
  assert.deepEqual(Object.keys(disk.get("mooner:refs")).sort(), [KEY, OTHER].sort());
});

test("noteRef: your own link never replaces a friend's ref", async () => {
  const { store, calls, disk } = rig();
  await store.getState().setWallet(ME);
  await store.getState().noteRef(KEY, SHARER);
  await store.getState().noteRef(KEY, ME);
  assert.deepEqual(disk.get("mooner:refs"), { [KEY]: { ref: SHARER, at: 1_000_000 } }, "the friend's ref stays");
  await store.getState().join(KEY, 100_000_000n, me);
  assert.equal(calls.find((c) => c[0] === "join")[1].ref, SHARER);
});

test("noteRef: a wallet that arrives while the saved refs are read counts as yours (a cold start)", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const wrapSaved = (base) => (name) => {
    const s = base(name);
    if (name === "mooner:refs") s.get = async () => (await gate, { [KEY]: { ref: SHARER, at: 1 } });
    return s;
  };
  const { store, calls, disk } = rig({ wrapSaved });
  const noting = store.getState().noteRef(KEY, ME); // the room, opened from your own link
  await store.getState().setWallet(ME); // the saved wallet, read meanwhile
  release();
  await noting;
  assert.equal(disk.has("mooner:refs"), false, "your own link changed nothing");
  await store.getState().join(KEY, 100_000_000n, me);
  assert.equal(calls.find((c) => c[0] === "join")[1].ref, SHARER, "the friend's ref goes with the join");
});

test("global chat: kept for the app's run; seeChat marks its newest line seen", () => {
  const { store, push } = rig();
  const stop = store.getState().start();
  push("chat:global", "snapshot", [{ id: 4, text: "gm" }]);
  push("chat:global", "message", { id: 9, text: "wagmi" });
  assert.deepEqual(store.getState().chats.global.map((r) => r.id), [4, 9]);
  assert.equal(store.getState().chatSeen, 0);
  store.getState().seeChat();
  assert.equal(store.getState().chatSeen, 9);
  push("chat:global", "message", { id: 12, text: "lfg" });
  assert.equal(store.getState().chatSeen, 9, "only seeChat moves it");
  store.getState().seeChat();
  store.getState().seeChat();
  assert.equal(store.getState().chatSeen, 12);
  stop();
});

test("watchChat: a presale room's chat while Chat shows it; global needs none", () => {
  const { store, push, listening } = rig();
  const off = store.getState().watchChat("K");
  assert.ok(listening("chat:K"));
  push("chat:K", "message", { id: 1, text: "hi" });
  assert.deepEqual(store.getState().chats.K.map((r) => r.id), [1]);
  const room = store.getState().watch("K"); // the room open too: each lets go of its own
  off();
  assert.ok(listening("chat:K"), "the room still listens");
  room();
  assert.equal(listening("chat:K"), false);
  const none = store.getState().watchChat("global");
  assert.equal(listening("chat:global"), false, "start() owns global");
  none();
});

// ---- XP ----

const xpRow = (wallet, total, more = {}) => ({
  wallet,
  total,
  titles: { dev: total, kol: 0, raider: 0, diamond: 0 },
  streak: { days: 0, best: 0, last: null },
  genesis: null,
  ...more,
});
const apiError = (status, message) => Object.assign(new Error(message), { status });

test("xp: pushed rows merge by wallet, none goes, junk is skipped; loaded from the first message", () => {
  const { store, push } = rig();
  store.getState().start();
  assert.equal(store.getState().xpLoaded, false);
  push("profiles", "xp", [xpRow("A", 100), xpRow("B", 50)]);
  push("profiles", "xp", [xpRow("A", 300), { total: 1 }, null]);
  const s = store.getState();
  assert.equal(s.xpLoaded, true);
  assert.deepEqual(Object.keys(s.xp).sort(), ["A", "B"]);
  assert.equal(s.xp.A.total, 300);
  assert.equal(s.xp.B.total, 50, "a row not in the message stays");
  push("profiles", "xp", []);
  assert.equal(store.getState().xp, s.xp, "no rows: the same object");
  push("profiles", "snapshot", { X: { skin: 1 } });
  assert.equal(store.getState().xp, s.xp, "the pictures' snapshot leaves the rows alone");
});

test("xp: your own row is read once when the wallet comes; after that rows come only as pushes", async () => {
  const reads = [];
  const { store, push } = rig({ api: { xp: async (w) => (reads.push(w), xpRow(w, 25)) } });
  store.getState().start();
  await store.getState().setWallet(W);
  await tick();
  assert.deepEqual(reads, [W]);
  assert.equal(store.getState().xp[W].total, 25);
  push("profiles", "xp", [xpRow(W, 125)]);
  push("profiles", "xp", [xpRow("B", 5)]);
  await tick();
  assert.deepEqual(reads, [W], "pushes never read again");
  assert.equal(store.getState().xp[W].total, 125);
  await store.getState().setWallet(null);
  assert.deepEqual(reads, [W], "no wallet: nothing to read");
});

test("xp: a push that lands while your row's read is on its way isn't undone by the read", async () => {
  let answer;
  const { store, push } = rig({ api: { xp: () => new Promise((r) => (answer = r)) } });
  store.getState().start();
  await store.getState().setWallet(W);
  push("profiles", "xp", [xpRow(W, 300)]);
  answer(xpRow(W, 100));
  await tick();
  assert.equal(store.getState().xp[W].total, 300);
});

test("xp: a failed read says so for that wallet only; a push still fills the row", async () => {
  const fail = [];
  const { store, push } = rig({ api: { xp: (w) => new Promise((_, no) => fail.push([w, no])) } });
  store.getState().start();
  await store.getState().setWallet(W);
  fail[0][1](apiError(429, "too many requests, try again later"));
  await tick();
  assert.equal(store.getState().xpFailed, true);
  push("profiles", "xp", [xpRow(W, 40)]);
  assert.equal(store.getState().xp[W].total, 40);
  await store.getState().setWallet("Other");
  assert.equal(store.getState().xpFailed, false, "a wallet change starts over");
  await store.getState().setWallet(W);
  await store.getState().setWallet("Other");
  fail[2][1](apiError(503, "down")); // W's second read fails after the switch
  await tick();
  assert.equal(store.getState().xpFailed, false, "an old wallet's failure isn't the new one's");
});

test("checkGenesis signs in when the sign-in ran out, posts the token, and the answer's row goes in", async () => {
  const posted = [];
  const row = xpRow(W, 250, { genesis: { mint: "M", at: 7 } });
  const { store } = rig({
    now: 1_790_000_000_000,
    api: {
      xp: async (w) => xpRow(w, 0),
      genesis: async (token) => (posted.push(token), { wallet: W, genesis: row.genesis, fresh: posted.length === 1, xp: row }),
    },
  });
  await store.getState().setWallet(W);
  await tick();
  store.setState({ session: { token: "old", exp: 1_790_000_000_000 } }); // runs out right now
  const signed = [];
  const r = await store.getState().checkGenesis(signer, { signIn: async () => (signed.push(1), { token: "fresh", exp: 1_790_000_100_000 }) });
  assert.deepEqual(r, { ok: true, fresh: true, genesis: { mint: "M", at: 7 } });
  assert.deepEqual(signed, [1]);
  assert.deepEqual(posted, ["fresh"]);
  assert.equal(store.getState().xp[W], row, "the answer's row replaces the one read before");
  const again = await store.getState().checkGenesis(signer, { signIn: async () => assert.fail("still signed in") });
  assert.deepEqual(again, { ok: true, fresh: false, genesis: { mint: "M", at: 7 } });
  assert.deepEqual(posted, ["fresh", "fresh"]);
});

test("checkGenesis: a sign-in that fails stops there", async () => {
  const { store } = rig({ api: { genesis: async () => assert.fail("no token to post") } });
  await store.getState().setWallet(W);
  const r = await store.getState().checkGenesis(signer, { signIn: async () => { throw new Error("User rejected the request."); } });
  assert.deepEqual(r, { ok: false, error: "You cancelled it in your wallet." });
});

test("checkGenesis: the server's words as they are; the sign-in stays", async () => {
  const cases = [
    [404, "no Seeker Genesis Token in this wallet"],
    [409, "this Seeker's Genesis Token was already used by Abcd…wxyz"],
    [503, "couldn't read this wallet's tokens, try again"],
    [429, "too many Genesis checks from this wallet, try again later"],
  ];
  for (const [status, error] of cases) {
    const { store } = rig({ api: { xp: async (w) => xpRow(w, 0), genesis: async () => { throw apiError(status, error); } } });
    await store.getState().setWallet(W);
    await tick();
    store.setState({ session: { token: "t", exp: 9e15 } });
    const before = store.getState().xp;
    assert.deepEqual(await store.getState().checkGenesis(signer), { ok: false, error }, String(status));
    assert.deepEqual(store.getState().session, { token: "t", exp: 9e15 }, `${status} keeps the sign-in`);
    assert.equal(store.getState().xp, before, `${status} changes no row`);
  }
});

test("checkGenesis: a 401 forgets the sign-in here and on disk; the next press signs in again", async () => {
  let first = true;
  const { store, disk } = rig({
    now: 1_790_000_000_000,
    api: {
      genesis: async () => {
        if (first) {
          first = false;
          throw apiError(401, "your sign-in ran out, sign in again");
        }
        return { wallet: W, genesis: { mint: "M", at: 1 }, fresh: false, xp: xpRow(W, 250) };
      },
    },
  });
  await store.getState().setWallet(W);
  await store.getState().signIn(signer, { signIn: async () => ({ token: "old", exp: 1_790_000_100_000 }) });
  assert.ok(disk.has(`mooner:login:${W}`));
  const r = await store.getState().checkGenesis(signer);
  assert.deepEqual(r, { ok: false, error: "your sign-in ran out, sign in again" });
  assert.equal(store.getState().session, null);
  assert.equal(disk.has(`mooner:login:${W}`), false);
  const signed = [];
  const again = await store.getState().checkGenesis(signer, { signIn: async () => (signed.push(1), { token: "new", exp: 1_790_000_100_000 }) });
  assert.equal(again.ok, true);
  assert.deepEqual(signed, [1]);
});

test("profilesLoaded: from the pictures' first snapshot", () => {
  const { store, push } = rig();
  store.getState().start();
  assert.equal(store.getState().profilesLoaded, false);
  push("profiles", "upsert", { wallet: "Y", pfp: { skin: 2 } });
  assert.equal(store.getState().profilesLoaded, false, "an upsert isn't the snapshot");
  push("profiles", "snapshot", {});
  assert.equal(store.getState().profilesLoaded, true);
});
