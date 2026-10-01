// The phone app's state: what the server pushes (presales, one presale's view and chat,
// launched coins, one coin's stats, Mooner pictures' traits, SOL/USD, the wallet's SOL), the
// wallet's balance of an open coin, and what the user does (sign in, join, get SOL back, chat,
// buy, sell). Screens read it with zustand's useStore and call its actions. Nothing here
// imports React Native, so it runs in Node tests with fakes.

import { createStore } from "zustand/vanilla";
import { explain } from "../../engine/src/flows.js";
import { signIn as walletSignIn } from "../../engine/src/signin.js";
import { explainSwap } from "../../engine/src/swap.js";

const CHAT_KEEP = 200;
const loginName = (w) => `mooner:login:${w}`;
const mineName = (w) => `mooner:mine:${w}`;
const without = (o, k) => {
  const { [k]: _, ...rest } = o;
  return rest;
};
// Secure storage may throw on the spot or reject; neither may fail what the user did.
const keep = (fn) => Promise.resolve().then(fn).catch(() => undefined);

/**
 * live:  { subscribe(topic, fn) -> off, onStatus(fn) -> off }   engine/src/live.js
 * api:   engine/src/apiclient.js makeApi(BASE)
 * flows: engine/src/flows.js makeFlows(...)
 * saved: (name) -> { get(), set(value), clear() }                securekeys.js secureJson
 * market: { quote(side, mint, amount), holding(wallet, mint), swap(q, signer, onStep) }
 *                                                                 trading.js makeMarket
 */
export function createMoonerStore({ live, api, flows, saved, market, now = () => Date.now() }) {
  let walletOff = null;
  let running = null; // { users, offs } while any start() is on
  const watching = new Map(); // mint -> how many screens watch the coin
  const reads = new Map(); // mint -> the latest balance read's number: an older one landing late is dropped
  const store = createStore(() => ({
    socketUp: false,
    info: null, // flows.loadInfo(): numbers as BigInt in info.N
    infoError: null,
    presales: {}, // key -> list view
    loaded: { presales: false, launched: false }, // true from a feed's first snapshot: {} before that is "not here yet", after it "none"
    feedError: { presales: null, launched: null }, // the server's words when it couldn't read a feed; the next snapshot clears it
    views: {}, // key -> detail view (seats), while a screen watches it
    missing: {}, // key -> true: the server has no such presale
    viewError: {}, // key -> the server's words when it couldn't read that presale; its next snapshot clears it
    launched: {}, // presale key -> launched row
    profiles: {}, // wallet -> Mooner picture traits
    solUsd: 0,
    wallet: null, // base58
    lamports: null,
    session: null, // { token, exp }: Mooner sign-in, for chat
    mine: {}, // presale key -> { deposit, at, back? }: joined from this phone
    chats: {}, // channel -> rows, oldest first
    coins: {}, // mint -> the coin's stats (chart, volume, liquidity, holders): pushed while a screen watches it; the last ones stay after
    coinMissing: {}, // mint -> true: the server has no such coin
    coinError: {}, // mint -> the server's words when it couldn't read the stats; the next snapshot clears it
    // mint -> { raw (BigInt), decimals, ui }: the connected wallet's balance of a coin, read when a
    // screen opens it, on SOL moves while one is open, and after a trade here (watched or not);
    // the last read stays after the screen closes; a wallet change empties it
    holdings: {},
    busy: null, // { key, kind: "join" | "back" | "buy" | "sell", step }
  }));
  const get = store.getState;
  const set = store.setState;
  const patch = (field, fn) => set((s) => ({ [field]: fn(s[field]) }));

  // ---- what the server pushes ----

  // A feed's first snapshot (even an empty one) is what makes it loaded; one that couldn't be
  // read says so until its next snapshot.
  const feedSnapshot = (feed, rows) =>
    set((s) => ({ [feed]: rows, loaded: { ...s.loaded, [feed]: true }, feedError: { ...s.feedError, [feed]: null } }));
  const feedFailed = (feed, error) => patch("feedError", (e) => ({ ...e, [feed]: error || "couldn't read this right now" }));

  function onPresales(m) {
    if (m.type === "snapshot") feedSnapshot("presales", Object.fromEntries(m.data.map((v) => [v.presale, v])));
    else if (m.type === "upsert") patch("presales", (p) => ({ ...p, [m.data.presale]: m.data }));
    else if (m.type === "remove") patch("presales", (p) => without(p, m.data.presale));
    else if (m.type === "error") feedFailed("presales", m.error);
  }

  function onLaunched(m) {
    if (m.type === "snapshot") feedSnapshot("launched", Object.fromEntries(m.data.map((r) => [r.presale, r])));
    else if (m.type === "upsert") patch("launched", (l) => ({ ...l, [m.data.presale]: m.data }));
    else if (m.type === "error") feedFailed("launched", m.error);
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
    if (m.type === "snapshot") set((s) => ({ views: { ...s.views, [key]: m.data }, missing: without(s.missing, key), viewError: without(s.viewError, key) }));
    else if (m.type === "missing") set((s) => ({ missing: { ...s.missing, [key]: true }, viewError: without(s.viewError, key) }));
    else if (m.type === "error") patch("viewError", (x) => ({ ...x, [key]: m.error || "couldn't read this right now" }));
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

  const onCoin = (mint) => (m) => {
    if (m.type === "snapshot") set((s) => ({ coins: { ...s.coins, [mint]: m.data }, coinMissing: without(s.coinMissing, mint), coinError: without(s.coinError, mint) }));
    else if (m.type === "missing") set((s) => ({ coinMissing: { ...s.coinMissing, [mint]: true }, coinError: without(s.coinError, mint) }));
    else if (m.type === "error") patch("coinError", (x) => ({ ...x, [mint]: m.error || "couldn't read this right now" }));
  };

  async function loadInfo() {
    try {
      set({ info: await flows.loadInfo(), infoError: null });
    } catch (e) {
      set({ infoError: explain(e) });
    }
  }

  /** The public topics, for the whole app. Returns stop(). A second start() while one is on
   *  subscribes nothing more: the topics are let go when every start has stopped, and the
   *  socket then reads as down. Each stop counts once. */
  function start() {
    if (!running) {
      running = {
        users: 0,
        offs: [
          live.onStatus((up) => {
            set({ socketUp: up });
            if (up && !get().info) loadInfo();
          }),
          live.subscribe("presales", onPresales),
          live.subscribe("launched", onLaunched),
          live.subscribe("profiles", onProfiles),
          live.subscribe("sol", onSol),
        ],
      };
      loadInfo();
    }
    const mine = running;
    mine.users++;
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--mine.users > 0) return;
      mine.offs.forEach((off) => off());
      if (running === mine) running = null;
      set({ socketUp: false });
    };
  }

  /** One presale's view and chat while a screen shows it. Returns off(). */
  function watch(key) {
    patch("viewError", (x) => without(x, key));
    const offs = [live.subscribe(`presale:${key}`, onPresale(key)), live.subscribe(`chat:${key}`, onChat(key))];
    return () => offs.forEach((off) => off());
  }

  /** One launched coin's stats and the wallet's balance of it while a screen shows it.
   *  Returns off(); each off counts once. */
  function watchCoin(mint) {
    patch("coinError", (x) => without(x, mint));
    watching.set(mint, (watching.get(mint) ?? 0) + 1);
    const off = live.subscribe(`coin:${mint}`, onCoin(mint));
    readHolding(mint);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      off();
      const n = watching.get(mint) - 1;
      if (n > 0) watching.set(mint, n);
      else watching.delete(mint);
    };
  }

  /** Reads the connected wallet's balance of `mint` once: when a coin screen opens, when the
   *  wallet's SOL changes (the server pushes it: a trade moved it), after a trade here. A
   *  failed read leaves the last one. */
  async function readHolding(mint) {
    const wallet = get().wallet;
    if (!wallet) return;
    const n = (reads.get(mint) ?? 0) + 1;
    reads.set(mint, n);
    try {
      const b = await market.holding(wallet, mint);
      if (get().wallet === wallet && reads.get(mint) === n) patch("holdings", (h) => ({ ...h, [mint]: b }));
    } catch {
      // the screen keeps what it had; the next push or trade reads again
    }
  }

  // ---- the wallet ----

  /** The connected wallet (base58), or null: its SOL, its saved sign-in and presales. */
  async function setWallet(wallet) {
    if (wallet === get().wallet) return;
    walletOff?.();
    walletOff = null;
    set({ wallet, lamports: null, session: null, mine: {}, holdings: {} });
    if (!wallet) return;
    walletOff = live.subscribe(`wallet:${wallet}`, (m) => {
      if (m.type !== "snapshot" || m.data?.lamports == null) return;
      const was = get().lamports;
      set({ lamports: Number(m.data.lamports) });
      // the wallet's SOL moved: a trade (here or elsewhere) may have moved its coins too. A
      // snapshot re-sent with the same SOL (a reconnect subscribes again) reads too, on
      // purpose: the coins may have moved while the socket was down
      if (was != null) for (const mint of watching.keys()) readHolding(mint);
    });
    for (const mint of watching.keys()) readHolding(mint);
    const [session, mine] = await Promise.all([
      keep(() => saved(loginName(wallet)).get()),
      keep(() => saved(mineName(wallet)).get()),
    ]);
    if (get().wallet !== wallet) return; // switched meanwhile
    set({ session: session && session.exp > now() ? session : null, mine: mine ?? {} });
  }

  /** Mooner sign-in (one wallet signature), kept 7 days on this phone. Returns { ok: true,
   *  session } or { ok: false, error }. */
  async function signIn(signer, { signIn: sign = walletSignIn } = {}) {
    const wallet = signer.publicKey.toBase58();
    try {
      const session = await sign({ api, wallet: signer.publicKey, signMessage: signer.signMessage, now });
      await keep(() => saved(loginName(wallet)).set(session));
      if (get().wallet === wallet) set({ session });
      return { ok: true, session };
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  /** Forgets the sign-in and the wallet on this phone (the screen also disconnects MWA). */
  async function signOut() {
    const w = get().wallet;
    if (w) await keep(() => saved(loginName(w)).clear());
    await setWallet(null);
  }

  /** Notes `entry` for presale `key` under the wallet that did it. It's saved for that wallet
   *  even if another is connected by now (built on its own saved record then); the state shows
   *  it only while that wallet is the connected one. */
  async function remember(wallet, key, entry) {
    let mine;
    if (get().wallet === wallet) {
      mine = { ...get().mine, [key]: { ...get().mine[key], ...entry } };
      set({ mine });
    } else {
      const had = (await keep(() => saved(mineName(wallet)).get())) ?? {};
      mine = { ...had, [key]: { ...had[key], ...entry } };
    }
    await keep(() => saved(mineName(wallet)).set(mine));
  }

  /** After a refund no push follows (flows.getBack): the wallet's seat leaves the presale's
   *  detail view and the list item's users, so nothing offers to get it back again. */
  function dropSeat(key, wallet) {
    set((s) => {
      const v = s.views[key];
      const p = s.presales[key];
      const next = {};
      if (v?.seats) next.views = { ...s.views, [key]: { ...v, seats: v.seats.filter((x) => x.user !== wallet) } };
      if (p?.users) next.presales = { ...s.presales, [key]: { ...p, users: p.users.filter((x) => x.user !== wallet) } };
      return next.views || next.presales ? next : s;
    });
  }

  // ---- actions ----

  /** Runs one action at a time; `busy.step` is what it waits for. `why` words an error. */
  async function run(key, kind, fn, why = explain) {
    if (get().busy) return { ok: false, error: "Wait for the last one to finish." };
    set({ busy: { key, kind, step: null } });
    try {
      return { ok: true, value: await fn((step) => set({ busy: { key, kind, step } })) };
    } catch (e) {
      return { ok: false, error: why(e) };
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
      // a join after a get-back is a new seat: the old `back` mustn't outlive it
      await remember(signer.publicKey.toBase58(), key, { deposit: String(amount), at: now(), back: null });
    });
  }

  /** Get my SOL back from presale `key`. */
  function getBack(key, signer) {
    return run(key, "back", async (onStep) => {
      const info = get().info ?? (await flows.loadInfo());
      const view = await api.presale(key);
      await flows.getBack({ info, wallet: signer.publicKey, signTransaction: signer.signTransaction, sendTransaction: signer.sendTransaction, view, onStep });
      const wallet = signer.publicKey.toBase58();
      dropSeat(key, wallet);
      await remember(wallet, key, { back: now() });
    });
  }

  /** What a trade would get, for the sheet before anything is signed: { ok: true, value:
   *  quote } or { ok: false, error, noRoute }. `side` "buy" spends `amount` lamports, "sell"
   *  `amount` raw tokens (BigInt). */
  async function preview(side, mint, amount) {
    try {
      return { ok: true, value: await market.quote(side, mint, amount) };
    } catch (e) {
      return { ok: false, error: explainSwap(e), noRoute: !!e?.noRoute };
    }
  }

  /** Buys or sells coin `mint` at a fresh quote (the price may have moved since the sheet's).
   *  Returns { ok, value: { sig, quote } } or { ok: false, error } once the swap is confirmed;
   *  the balance read it starts lands in `holdings` on its own. */
  function trade(side, mint, amount, signer) {
    return run(
      mint,
      side,
      async (onStep) => {
        onStep("Getting a price from Jupiter");
        const q = await market.quote(side, mint, amount);
        const sig = await market.swap(q, signer, onStep);
        readHolding(mint); // catches its own errors; a hung read mustn't hold the lock
        return { sig, quote: q };
      },
      explainSwap,
    );
  }

  /** What a join takes from the wallet besides the deposit (BigInt lamports). */
  const joinCost = async () => (await flows.joinCost()).total;

  /** Posts to presale `key`'s chat, signing in first if needed. `opts.signIn` is for tests. */
  async function sendChat(key, text, signer, opts) {
    let session = get().session;
    if (!session || session.exp <= now()) {
      const r = await signIn(signer, opts);
      if (!r.ok) return r;
      session = r.session;
    }
    try {
      await api.sendChat(session.token, key, text.trim());
      return { ok: true };
    } catch (e) {
      if (e.status === 401) {
        const wallet = signer.publicKey.toBase58();
        if (get().wallet === wallet) set({ session: null });
        await keep(() => saved(loginName(wallet)).clear());
      }
      return { ok: false, error: explain(e) };
    }
  }

  set({ start, watch, watchCoin, setWallet, signIn, signOut, join, getBack, joinCost, sendChat, preview, trade });
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
