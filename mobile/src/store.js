// The phone app's state: what the server pushes (presales, one presale's view and chat,
// launched coins, one coin's stats, Mooner pictures' traits, SOL/USD, the wallet's SOL), the
// wallet's balance of an open coin, and what the user does (sign in, join, get SOL back, chat,
// buy, sell, create a coin and open its presale). Screens read it with zustand's useStore and
// call its actions. Nothing here imports React Native, so it runs in Node tests with fakes.

import { createStore } from "zustand/vanilla";
import { explain } from "../../engine/src/flows.js";
import { refFor, withRef, withoutRef } from "../../engine/src/refs.js";
import { signIn as walletSignIn } from "../../engine/src/signin.js";
import { explainSwap } from "../../engine/src/swap.js";
import { SNIPE_S, TAX_MARGIN_S } from "../../engine/src/views.js";
import {
  ALREADY_OPEN,
  OPEN_PENDING,
  RETRY_UNCHECKED,
  checkBeforeRetry,
  commitProblem,
  createError,
  isOpening,
  keptCommitProblem,
  openFailure,
  openLanded,
  shortOfOpen,
} from "./create/rules.js";

const CHAT_KEEP = 200;
/** What a trade says when its fresh price no longer reaches the minimum the sheet showed. */
export const PRICE_MOVED = "The price moved. Check the new numbers and press again.";
/** Under this much slippage (0.5%) between a fresh price and the sheet's minimum, a trade
 *  goes back to the sheet instead of quoting again that tight. */
export const MIN_REQUOTE_BPS = 50;
/** What a trade says when the sheet gave it no minimum to hold the swap to. */
export const NO_MINIMUM = "Get a price first, then press again.";
/** How near this phone's clock a launch must be for its first upsert to count as seen live:
 *  the snipe tax, its margin and 30 s. An older coin's row (a pool change) isn't news. */
const SEEN_LIVE_MS = (SNIPE_S + TAX_MARGIN_S + 30) * 1000;
const loginName = (w) => `mooner:login:${w}`;
const mineName = (w) => `mooner:mine:${w}`;
/** An open whose outcome wasn't known, saved per wallet until it's settled (openCoin). */
const openingName = (w) => `mooner:opening:${w}`;
/** Share-link refs, { presale: { ref, at } } (engine/src/refs.js), one record per phone. */
const REFS = "mooner:refs";
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
    // mint -> this phone's clock when a `launched` upsert first brought the coin's launch (seen
    // live). The Buy and Sell lock ends 4 s after the later of this and launch.at (the
    // server's clock), so a phone clock that runs fast can't open them early. Only upserts
    // after the feed's snapshot count, and only for a launch within SEEN_LIVE_MS of this
    // phone's clock: the server joins a socket to the feed before its snapshot, and an old
    // coin's pool changes are upserts too. A coin first seen in a snapshot has none.
    launchSeen: {},
    profiles: {}, // wallet -> Mooner picture traits
    solUsd: 0,
    wallet: null, // base58
    lamports: null,
    session: null, // { token, exp }: Mooner sign-in, for chat
    mine: {}, // presale key -> { deposit, at, back? }: joined from this phone
    // the connected wallet's open whose outcome wasn't known: { mint, presale, symbol, name,
    // description, links, image, commit, at } (create/rules.js restoredOpen); `at`: its last
    // save (openCoin); null: none; undefined: not read yet
    opening: undefined,
    chats: {}, // channel -> rows, oldest first
    coins: {}, // mint -> the coin's stats (chart, volume, liquidity, holders): pushed while a screen watches it; the last ones stay after
    coinMissing: {}, // mint -> true: the server has no such coin
    coinError: {}, // mint -> the server's words when it couldn't read the stats; the next snapshot clears it
    // mint -> { raw (BigInt), decimals, ui }: the connected wallet's balance of a coin, read when a
    // screen opens it, on SOL moves while one is open, and after a trade here (watched or not);
    // the last read stays after the screen closes; a wallet change empties it
    holdings: {},
    busy: null, // { key, kind: "join" | "back" | "buy" | "sell" | "create", step }
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
    else if (m.type === "upsert")
      set((s) => {
        const r = m.data;
        const launched = { ...s.launched, [r.presale]: r };
        if (!s.loaded.launched || r.launch == null || s.launched[r.presale]?.launch != null || !r.mint || s.launchSeen[r.mint] != null) return { launched };
        const at = now();
        return Math.abs(at - Number(r.launch.at)) <= SEEN_LIVE_MS ? { launched, launchSeen: { ...s.launchSeen, [r.mint]: at } } : { launched };
      });
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
    set({ wallet, lamports: null, session: null, mine: {}, holdings: {}, opening: undefined });
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
    const [session, mine, opening] = await Promise.all([
      keep(() => saved(loginName(wallet)).get()),
      keep(() => saved(mineName(wallet)).get()),
      openingOf(wallet),
    ]);
    if (get().wallet !== wallet) return; // switched meanwhile
    // the copy in memory again: a save made during these reads is newer than openingOf's answer
    set({ session: session && session.exp > now() ? session : null, mine: mine ?? {}, opening: openings.has(wallet) ? openings.get(wallet) : opening });
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

  // ---- share links ----

  let refs = {}; // the saved refs once read, and every change since
  let refsRead = null; // the one read of the saved refs, shared by whoever asks first
  const loadRefs = () => (refsRead ??= keep(() => saved(REFS).get()).then((v) => void (refs = v ?? {})));

  /** Applies `change` to the refs and saves them. Reads and writes `refs` with no await in
   *  between, so two at once can't lose one. */
  async function changeRefs(change) {
    await loadRefs();
    const next = change(refs);
    if (next === refs) return;
    refs = next;
    await keep(() => saved(REFS).set(next));
  }

  /** A presale opened from a link that carries `?ref=<wallet>`: kept until a join there lands,
   *  and `join` sends it (never the joiner's own wallet). The newest link wins, except the
   *  connected wallet's own, which never replaces a friend's; junk is ignored. The wallet is
   *  read after the saved refs, so one set meanwhile counts; the room notes only once the
   *  saved wallet is read (room.js refToNote). With no wallet connected, the viewer's own
   *  link can't be told apart from a friend's. */
  const noteRef = (key, ref) => changeRefs((r) => withRef(r, key, ref, now(), get().wallet));

  /** The join landed: its ref went with it. */
  const dropRef = (key) => changeRefs((r) => withoutRef(r, key));

  /** Join presale `key` with `amount` (BigInt lamports, a valid seat). */
  function join(key, amount, signer) {
    return run(key, "join", async (onStep) => {
      const info = get().info ?? (await flows.loadInfo());
      const view = await api.presale(key);
      await loadRefs();
      const ref = refFor(refs, key, signer.publicKey.toBase58()); // a share link's, if one is kept
      await flows.joinPresale({ info, wallet: signer.publicKey, signTransaction: signer.signTransaction, view, amount, onStep, ...(ref && { ref }) });
      // a join after a get-back is a new seat: the old `back` mustn't outlive it
      await remember(signer.publicKey.toBase58(), key, { deposit: String(amount), at: now(), back: null });
      await dropRef(key); // the join landed: its ref went with it
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
   *  the balance read it starts lands in `holdings` on its own. `opts.atLeast` (BigInt): the
   *  minimum the sheet showed ("At least"), required: without one (a BigInt) nothing is
   *  quoted or signed and it says NO_MINIMUM. The swap enforces it: what gets signed is a
   *  quote whose own minOut (the tx's otherAmountThreshold) is at least that. A fresh quote
   *  whose minOut is looser is quoted again with the slippage left between its price and
   *  `atLeast`, floored. When the fresh price is below `atLeast`, under MIN_REQUOTE_BPS
   *  above it, or the tighter quote still falls short, nothing is signed:
   *  { ok: false, moved: true, value: { quote }, error: PRICE_MOVED }, so the sheet can show
   *  the new numbers. */
  async function trade(side, mint, amount, signer, { atLeast = null } = {}) {
    if (typeof atLeast !== "bigint") return { ok: false, error: NO_MINIMUM };
    const r = await run(
      mint,
      side,
      async (onStep) => {
        onStep("Getting a price from Jupiter");
        let q = await market.quote(side, mint, amount);
        if (q.outAmount < atLeast) return { moved: true, quote: q };
        if (!(q.minOut >= atLeast)) {
          const bps = Number(((q.outAmount - atLeast) * 10_000n) / q.outAmount);
          if (bps < MIN_REQUOTE_BPS) return { moved: true, quote: q };
          q = await market.quote(side, mint, amount, bps);
          if (!(q.minOut >= atLeast)) return { moved: true, quote: q };
        }
        const sig = await market.swap(q, signer, onStep);
        readHolding(mint); // catches its own errors; a hung read mustn't hold the lock
        return { sig, quote: q };
      },
      explainSwap,
    );
    return r.ok && r.value.moved ? { ok: false, moved: true, value: { quote: r.value.quote }, error: PRICE_MOVED } : r;
  }

  /** What a join takes from the wallet besides the deposit (BigInt lamports). */
  const joinCost = async () => (await flows.joinCost()).total;

  /** What an open takes from the wallet besides the commit (BigInt lamports). */
  const openCost = async () => (await flows.openCost()).total;

  /** Asks the server for a new coin: the wallet signs its details, then the server pins the
   *  picture and details to IPFS and issues the coin to this wallet. `coin`: create/rules.js
   *  mintFields(draft) plus `image` (the picture's bytes). Returns { ok: true, value: { mint,
   *  presale, name, symbol, image, uri } } or { ok: false, error }. */
  function mintCoin(coin, signer) {
    return run(
      "create",
      "create",
      async (onStep) => {
        onStep("Sign the coin details in your wallet");
        const signMessage = async (bytes) => {
          const signature = await signer.signMessage(bytes);
          onStep("Saving the picture and details to IPFS");
          return signature;
        };
        return flows.requestMint({ wallet: signer.publicKey, signMessage, ...coin });
      },
      createError,
    );
  }

  // wallet -> its saved open, or null once cleared: what this run of the app last wrote,
  // read before the disk. Secure storage can refuse a save (keep swallows it); this copy then
  // keeps the coin locked while the app runs. Every write goes through noteOpening, so it is
  // never older than the disk, which can be after a refused save or clear.
  const openings = new Map();

  /** Saves `record` as `wallet`'s open whose outcome wasn't known, or clears it (null): in
   *  memory first, then on disk. Saved for that wallet even if another is connected by now;
   *  the state shows it only while that wallet is the connected one (as remember does). */
  async function noteOpening(wallet, record) {
    openings.set(wallet, record);
    if (get().wallet === wallet) set({ opening: record });
    await keep(() => (record ? saved(openingName(wallet)).set(record) : saved(openingName(wallet)).clear()));
  }

  /** Clears `wallet`'s saved open if it is the coin of presale `key` (the screen's fresh
   *  start, Start over, and openCoin's own clears). A saved open for another coin stays. */
  async function forgetOpening(wallet, key) {
    if ((await openingOf(wallet))?.presale === key) await noteOpening(wallet, null);
  }

  /** `wallet`'s saved open, or null: this run's copy first, else the disk's if it is a whole
   *  record (create/rules.js isOpening). */
  async function openingOf(wallet) {
    if (openings.has(wallet)) return openings.get(wallet);
    const r = await keep(() => saved(openingName(wallet)).get());
    return isOpening(r) ? r : null;
  }

  /** Opens the presale for `coin` with the creator's `commit` (BigInt lamports), which is also
   *  their seat, then remembers the seat as this wallet's. `coin`: { mint, presale, symbol,
   *  name, description, links, image }, the server's coin with its presale's key
   *  (create/rules.js presaleKeyOf). Returns { ok: true, value: the presale's key (base58) }
   *  or { ok: false, error }, and on a retry also `read: { verdict, at }`: the read before it
   *  (create/rules.js checkBeforeRetry) and when it was asked, for the screen's canStartOver.
   *  - The coin is saved for the wallet (`opening`), with `at`, before the wallet is asked,
   *    so the screen keeps it, after a restart too, watches its presale and retries only it.
   *    No prompt, nothing saved. While it is saved, another mint gets OPEN_PENDING.
   *  - It is saved again, with a new `at`, once the wallet has signed and when an unknown
   *    outcome is reported: `at` is the coin's last save, which Start over waits on.
   *  - Once the wallet has signed, a failure that may have sent the open comes back as
   *    OUTCOME_UNKNOWN (create/rules.js openFailure), never a plain failure; the coin stays
   *    saved, and no seat is remembered.
   *  - A retry reads its presale first, before any other check: the server knowing it in
   *    any state means that open landed (ALREADY_OPEN, nothing signed; a presale that closed
   *    leaves no account, so the program would open the same coin again). Only the server's
   *    own 404 lets it go on, with the saved commit; anything else is RETRY_UNCHECKED.
   *  - A success and ALREADY_OPEN clear the saved coin, and so does a first try's plain
   *    failure. A retry's plain failure keeps it as it was before that try, even after the
   *    sign: the server never sent this try's tx, or sent it and it failed for certain. */
  async function openCoin(coin, commit, signer) {
    let pid = null; // the presale program's key (base58), for createError
    let read = null; // a retry's read: { verdict, at }
    const r = await run(
      "create",
      "create",
      async (onStep) => {
        const wallet = signer.publicKey.toBase58();
        const info = get().info ?? (await flows.loadInfo());
        pid = info.pid.toBase58();
        const had = await openingOf(wallet);
        if (had && had.mint !== coin.mint) throw new Error(OPEN_PENDING);
        let amount = commit;
        if (had) {
          // the read first: a landed open must never be signed again, whatever else is wrong
          onStep("Checking whether the presale is open");
          const at = now();
          const verdict = await checkBeforeRetry(() => api.presale(coin.presale));
          read = { verdict, at };
          if (verdict === "open") {
            await forgetOpening(wallet, coin.presale);
            throw new Error(ALREADY_OPEN);
          }
          if (verdict !== "retry") throw new Error(RETRY_UNCHECKED);
          amount = BigInt(had.commit); // fixed for its mint, whatever the screen hands in
          const kept = keptCommitProblem(amount, info.N);
          if (kept) throw new Error(kept);
          const lamports = get().wallet === wallet ? get().lamports : null;
          const short = shortOfOpen(amount, await openCost().catch(() => null), lamports);
          if (short) throw new Error(short);
        } else {
          const problem = commitProblem(commit, info.N);
          if (problem) throw new Error(problem);
        }
        const { mint, presale: key, symbol, name, description, links, image } = coin;
        const record = { mint, presale: key, symbol, name, description, links, image, commit: String(amount) };
        let sent = false; // the wallet signed: from here on the open may go out
        const signTransaction = async (tx) => {
          if (openLanded(key, get())) throw new Error(ALREADY_OPEN); // the feed has it: don't ask
          await noteOpening(wallet, { ...record, at: now() }); // saved before the wallet is asked
          onStep("Sign to open the presale with your SOL");
          const signed = await signer.signTransaction(tx);
          // saved again: Seed Vault changes the tx as it signs, maybe its blockhash too, so a
          // prompt held a long time must not count against Start over's wait
          await noteOpening(wallet, { ...record, at: now() });
          sent = true;
          onStep("Opening the presale");
          return signed;
        };
        let presale;
        try {
          presale = (await flows.openPresale({ info, wallet: signer.publicKey, signTransaction, mint, commit: amount })).toBase58();
        } catch (e) {
          const out = openFailure(e, sent);
          if (out?.outcomeUnknown) {
            // it may have landed: the coin stays saved, as of when that was reported
            await noteOpening(wallet, { ...record, at: now() });
            throw out;
          }
          if (createError(out, pid) === ALREADY_OPEN) await forgetOpening(wallet, key);
          // a retry's plain failure: as it was. Safe after the sign too: the server never sent
          // this try's tx, or sent it and it failed for certain, so it can't land
          else if (had) await noteOpening(wallet, had);
          else await forgetOpening(wallet, key); // a first try's: nothing of it can land
          throw out;
        }
        await forgetOpening(wallet, key);
        await remember(wallet, presale, { deposit: String(amount), at: now(), back: null });
        return presale;
      },
      (e) => createError(e, pid),
    );
    return read ? { ...r, read } : r;
  }

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

  set({ start, watch, watchCoin, setWallet, signIn, signOut, join, getBack, joinCost, sendChat, noteRef, preview, trade, openCost, mintCoin, openCoin, forgetOpening });
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
