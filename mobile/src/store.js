// The phone app's state: what the server pushes (presales, one presale's view and chat,
// launched coins, Mooner pictures' traits, SOL/USD, the wallet's SOL) and what the user does
// (sign in, join, get SOL back, chat). Screens read it with zustand's useStore and call its
// actions. Nothing here imports React Native, so it runs in Node tests with fakes.

import { createStore } from "zustand/vanilla";
import { explain } from "../../engine/src/flows.js";
import { signIn as walletSignIn } from "../../engine/src/signin.js";

const CHAT_KEEP = 200;
const loginName = (w) => `mooner:login:${w}`;
const mineName = (w) => `mooner:mine:${w}`;
const without = (o, k) => {
  const { [k]: _, ...rest } = o;
  return rest;
};

/**
 * live:  { subscribe(topic, fn) -> off, onStatus(fn) -> off }   engine/src/live.js
 * api:   engine/src/apiclient.js makeApi(BASE)
 * flows: engine/src/flows.js makeFlows(...)
 * saved: (name) -> { get(), set(value), clear() }                securekeys.js secureJson
 */
export function createMoonerStore({ live, api, flows, saved, now = () => Date.now() }) {
  let walletOff = null;
  const store = createStore(() => ({
    socketUp: false,
    info: null, // flows.loadInfo(): numbers as BigInt in info.N
    infoError: null,
    presales: {}, // key -> list view
    views: {}, // key -> detail view (seats), while a screen watches it
    missing: {}, // key -> true: the server has no such presale
    launched: {}, // presale key -> launched row
    profiles: {}, // wallet -> Mooner picture traits
    solUsd: 0,
    wallet: null, // base58
    lamports: null,
    session: null, // { token, exp }: Mooner sign-in, for chat
    mine: {}, // presale key -> { deposit, at, back? }: joined from this phone
    chats: {}, // channel -> rows, oldest first
    busy: null, // { key, kind: "join" | "back", step }
  }));
  const get = store.getState;
  const set = store.setState;
  const patch = (field, fn) => set((s) => ({ [field]: fn(s[field]) }));

  // ---- what the server pushes ----

  function onPresales(m) {
    if (m.type === "snapshot") set({ presales: Object.fromEntries(m.data.map((v) => [v.presale, v])) });
    else if (m.type === "upsert") patch("presales", (p) => ({ ...p, [m.data.presale]: m.data }));
    else if (m.type === "remove") patch("presales", (p) => without(p, m.data.presale));
  }

  function onLaunched(m) {
    if (m.type === "snapshot") set({ launched: Object.fromEntries(m.data.map((r) => [r.presale, r])) });
    else if (m.type === "upsert") patch("launched", (l) => ({ ...l, [m.data.presale]: m.data }));
  }

  function onProfiles(m) {
    if (m.type === "snapshot") set({ profiles: m.data ?? {} });
    else if (m.type === "upsert") patch("profiles", (p) => ({ ...p, [m.data.wallet]: m.data.pfp }));
  }

  function onSol(m) {
    const usd = m.data?.usd;
    if (m.type === "snapshot" && usd > 0) set({ solUsd: usd });
  }

  const onPresale = (key) => (m) => {
    if (m.type === "snapshot") set((s) => ({ views: { ...s.views, [key]: m.data }, missing: without(s.missing, key) }));
    else if (m.type === "missing") patch("missing", (x) => ({ ...x, [key]: true }));
  };

  const onChat = (channel) => (m) => {
    const had = get().chats[channel] ?? [];
    let rows;
    if (m.type === "snapshot") {
      const last = m.data.length ? m.data[m.data.length - 1].id : 0;
      rows = [...m.data, ...had.filter((r) => r.id > last)];
    } else if (m.type === "message") {
      if (had.some((r) => r.id === m.data.id)) return;
      rows = [...had, m.data].sort((a, b) => a.id - b.id);
    } else return;
    patch("chats", (c) => ({ ...c, [channel]: rows.slice(-CHAT_KEEP) }));
  };

  async function loadInfo() {
    try {
      set({ info: await flows.loadInfo(), infoError: null });
    } catch (e) {
      set({ infoError: explain(e) });
    }
  }

  /** The public topics, for the whole app. Returns stop(). */
  function start() {
    const offs = [
      live.onStatus((up) => {
        set({ socketUp: up });
        if (up && !get().info) loadInfo();
      }),
      live.subscribe("presales", onPresales),
      live.subscribe("launched", onLaunched),
      live.subscribe("profiles", onProfiles),
      live.subscribe("sol", onSol),
    ];
    loadInfo();
    return () => offs.forEach((off) => off());
  }

  /** One presale's view and chat while a screen shows it. Returns off(). */
  function watch(key) {
    const offs = [live.subscribe(`presale:${key}`, onPresale(key)), live.subscribe(`chat:${key}`, onChat(key))];
    return () => offs.forEach((off) => off());
  }

  // ---- the wallet ----

  /** The connected wallet (base58), or null: its SOL, its saved sign-in and presales. */
  async function setWallet(wallet) {
    if (wallet === get().wallet) return;
    walletOff?.();
    walletOff = null;
    set({ wallet, lamports: null, session: null, mine: {} });
    if (!wallet) return;
    walletOff = live.subscribe(`wallet:${wallet}`, (m) => {
      if (m.type === "snapshot" && m.data?.lamports != null) set({ lamports: Number(m.data.lamports) });
    });
    const [session, mine] = await Promise.all([
      saved(loginName(wallet)).get().catch(() => undefined),
      saved(mineName(wallet)).get().catch(() => undefined),
    ]);
    if (get().wallet !== wallet) return; // switched meanwhile
    set({ session: session && session.exp > now() ? session : null, mine: mine ?? {} });
  }

  /** Mooner sign-in (one wallet signature), kept 7 days on this phone. */
  async function signIn(signer, { signIn: sign = walletSignIn } = {}) {
    const wallet = signer.publicKey.toBase58();
    try {
      const session = await sign({ api, wallet: signer.publicKey, signMessage: signer.signMessage, now });
      await saved(loginName(wallet)).set(session).catch(() => {});
      if (get().wallet === wallet) set({ session });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /** Forgets the sign-in and the wallet on this phone (the screen also disconnects MWA). */
  async function signOut() {
    const w = get().wallet;
    if (w) await saved(loginName(w)).clear().catch(() => {});
    await setWallet(null);
  }

  async function remember(wallet, key, entry) {
    if (get().wallet !== wallet) return;
    const mine = { ...get().mine, [key]: { ...get().mine[key], ...entry } };
    set({ mine });
    await saved(mineName(wallet)).set(mine).catch(() => {});
  }

  // ---- actions ----

  /** Runs one action at a time; `busy.step` is what it waits for. */
  async function run(key, kind, fn) {
    if (get().busy) return { ok: false, error: "Wait for the last one to finish." };
    set({ busy: { key, kind, step: null } });
    try {
      return { ok: true, value: await fn((step) => set({ busy: { key, kind, step } })) };
    } catch (e) {
      return { ok: false, error: explain(e) };
    } finally {
      set({ busy: null });
    }
  }

  /** Join presale `key` with `amount` (BigInt lamports, a valid seat). */
  function join(key, amount, signer) {
    return run(key, "join", async (onStep) => {
      const info = get().info ?? (await flows.loadInfo());
      const view = await api.presale(key);
      await flows.joinPresale({ info, wallet: signer.publicKey, signTransaction: signer.signTransaction, view, amount, onStep });
      await remember(signer.publicKey.toBase58(), key, { deposit: String(amount), at: now() });
    });
  }

  /** Get my SOL back from presale `key`. */
  function getBack(key, signer) {
    return run(key, "back", async (onStep) => {
      const info = get().info ?? (await flows.loadInfo());
      const view = await api.presale(key);
      await flows.getBack({ info, wallet: signer.publicKey, signTransaction: signer.signTransaction, sendTransaction: signer.sendTransaction, view, onStep });
      await remember(signer.publicKey.toBase58(), key, { back: now() });
    });
  }

  /** What a join takes from the wallet besides the deposit (BigInt lamports). */
  const joinCost = async () => (await flows.joinCost()).total;

  /** Posts to presale `key`'s chat, signing in first if needed. `opts.signIn` is for tests. */
  async function sendChat(key, text, signer, opts) {
    let session = get().session;
    if (!session || session.exp <= now()) {
      const r = await signIn(signer, opts);
      if (!r.ok) return r;
      session = get().session;
    }
    try {
      await api.sendChat(session.token, key, text.trim());
      return { ok: true };
    } catch (e) {
      if (e.status === 401) {
        set({ session: null });
        await saved(loginName(signer.publicKey.toBase58())).clear().catch(() => {});
      }
      return { ok: false, error: explain(e) };
    }
  }

  set({ start, watch, setWallet, signIn, signOut, join, getBack, joinCost, sendChat });
  return store;
}

// ---- selectors: call inside useMemo with stable slices, never inside useStore ----

const raisedOf = (v) => BigInt(v.raised ?? 0);

/** Open presales, fullest first (they fill soonest), then the nearest deadline. */
export function liveList(s) {
  return Object.values(s.presales)
    .filter((v) => v.state === "OPEN")
    .sort((a, b) => {
      const d = raisedOf(b) - raisedOf(a);
      return d !== 0n ? (d > 0n ? 1 : -1) : Number(a.deadlineTs ?? 0) - Number(b.deadlineTs ?? 0);
    });
}

/** Launched coins, newest first. */
export function launchedList(s) {
  return Object.values(s.launched).sort((a, b) => (b.launch?.at ?? 0) - (a.launch?.at ?? 0));
}

/** Presale keys this wallet is in or was in: the open list's users, watched seats, and the
 *  ones joined from this phone. */
export function myPresales(s) {
  if (!s.wallet) return [];
  const keys = new Set(Object.keys(s.mine));
  for (const v of Object.values(s.presales)) if (v.users?.some((u) => u.user === s.wallet)) keys.add(v.presale);
  for (const v of Object.values(s.views)) if (v.seats?.some((x) => x.user === s.wallet)) keys.add(v.presale);
  return [...keys];
}
