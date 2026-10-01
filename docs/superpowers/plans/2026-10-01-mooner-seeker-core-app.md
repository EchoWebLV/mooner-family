# Mooner on Seeker, piece 1: the core app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the spike build in `mobile/` into the real Mooner phone app: connect Seed Vault, Live presales, the presale room (join, who's in, chat, get my SOL back, the launch), Launched coins, and Me — all on live server data and the same chain code the website uses.

**Architecture:** Logic that both apps need moves into `engine/src` as plain JS with `node --test` tests (`live.js` socket client, `signin.js`, `views.js` selectors); the web keeps thin adapters over them. The phone gets an expo-router app whose state lives in one zustand store (`mobile/src/store.js`, React-Native-free and tested in Node with fakes) wired to `makeFlows` from `engine/src/flows.js`. Screens only read the store and call its actions; the signer hides Mobile Wallet Adapter.

**Tech Stack:** Expo ~55, React Native 0.83, React 19.2, expo-router, zustand 5, expo-secure-store, expo-haptics, react-native-svg, react-native-webview, expo-file-system, expo-font + Geist, `@wallet-ui/react-native-web3js` 4.3.0, `@solana/web3.js` 1.99, Node 22 `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md` (sections "The app", "Screens", "Security", "Testing"; piece 1 row of "Pieces").

---

## Ground rules for every task

- Branch `feat/mooner-wireframe`. Commit after each task with the message given; end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit or print: `.env` files, anything under `engine/.mainnet`, keypair files, `site/`, `launch-test/`, `launch.py`, `.claude/`. Stage files by name, never `git add -A` or `git add .`.
- Never start dev servers or the local engine server. Never deploy. Never send SOL.
- Copy: no game words ("players", "lobby", "match"). Say "Who's in", "Auto-join".
- Real screens show only real data. No mock rows, no fake numbers.
- Live data comes over the socket; no polling loops. (A 1 s clock for a countdown is fine: it reads no server.)
- The golden digests in `engine/src/selftest.js` (GOLDEN_JOIN f6baff21…, GOLDEN_ER 003c526d…) must not change.
- Engine tests: `cd engine && npm test`. All must pass (235 before this plan).
- Web build: `cd web && npm run build` must exit 0 (it needs `web/.env`, which exists; don't print it).
- Phone JS tests: `cd mobile && npm test` (added in Task 5).
- Phone build + install (Seeker on USB): `cd mobile && sh scripts/run-android.sh`. Screenshots: `adb exec-out screencap -p > <scratchpad>/<name>.png`. The Seeker screen is 1200×2670.
- In zustand 5, a selector passed to `useStore` must return a stable value (a primitive or an object already in the state). Build derived lists with `useMemo` from stable slices, never inside the selector, or React loops.

## Server data shapes (checked against engine/server, 2026-10-01)

BigInts and PublicKeys arrive as strings (`engine/server/http.js` `toJson`).

- Presale view (`presales` list items, `presale:<key>` snapshots, `GET /api/presale/:key`): `{ presale, where: "er" | "home" | "closed", state: "OPEN" | "FULL" | "LAUNCHING" | "SETTLED" | "CLOSED" | "EXPIRED" | "FAILED", creator, mint, raised, deadlineTs, openedTs, fullTs, …, token, launch }`. The list adds `users: [{ user, commit, creator }]` while OPEN; the detail adds `seats: [{ seat, user, deposit, commit, settled, claimed, creator, where }]`.
- `token`: `{ mint, creator, name, symbol, description, links: { twitter, telegram, website }, image, uri, createdAt }` or null. `image` is an https URL.
- `launch`: `{ sig, released, cost, tokens, units, at }` (at in ms) or null.
- Launched row: `{ presale, mint, token, launch, pool: { address, quoteReserve, sqrtPrice, migrated } | null }`.
- `/api/info` `numbers`: `{ TARGET: "500000000", MIN_SEAT: "100000000", MAX_SEAT: "500000000", STEP: "10000000", DURATION: 3600, GRACE: 900 }`; `flows.loadInfo()` turns the strings into BigInt in `info.N`.
- Today (2026-10-01) mainnet has no open presale and no launched coin (`/api/presales` and `/api/launched` are empty), so Live and Launched first show their empty states.

## File map

**Shared (engine/src, tested under Node):**
- Create `engine/src/live.js` — the live socket client, `makeLive({ url, WebSocket, … })`.
- Create `engine/src/signin.js` — Mooner sign-in: sign the login message, `POST /api/login`.
- Create `engine/src/views.js` — pure selectors over server views: stage, price, market cap, fill, room, time left, who's in, my seat, join check, seat choices, get-back check, clock text.
- Create `engine/test/liveclient.test.js`, `engine/test/signin.test.js`, `engine/test/views.test.js`.
- Modify `web/src/real/live.js` — becomes an adapter over `makeLive`.
- Modify `web/src/lib/store.ts` — `stageOf` and sign-in come from the engine.
- Modify `web/src/lib/curve.ts` — `priceFromSqrt` re-exported from the engine.

**Phone (mobile/):**
- Modify `mobile/package.json` (deps, `test` script), `mobile/app.json` (plugins), `mobile/index.js` (polyfills, then expo-router).
- Create `mobile/src/config.js` — server URLs, priority, chain, identity.
- Create `mobile/src/securekeys.js` — expo-secure-store adapters (session keys, JSON values).
- Create `mobile/src/signer.js` — the Signer over Mobile Wallet Adapter.
- Create `mobile/src/store.js` — the app's state and actions.
- Create `mobile/src/app.js` — the live wiring: one socket, one API, one flows, one store.
- Create `mobile/src/ui/theme.js`, `mobile/src/ui/kit.js` (Button, Card, Pill, Banner, Steps, Sheet), `mobile/src/ui/Ring.js`, `mobile/src/ui/FillBar.js`, `mobile/src/ui/Face.js`, `mobile/src/ui/CoinImage.js`, `mobile/src/ui/useNow.js`, `mobile/src/ui/format.js`.
- Create `mobile/src/wallet.js` — `WalletProvider` + `useSigner()` + `useConnect()`.
- Create `mobile/app/_layout.js`, `mobile/app/index.js`, `mobile/app/connect.js`, `mobile/app/(tabs)/_layout.js`, `mobile/app/(tabs)/index.js` (Live), `mobile/app/(tabs)/launched.js`, `mobile/app/(tabs)/me.js`, `mobile/app/presale/[key].js`, `mobile/app/coin/[key].js`, `mobile/app/spike.js`.
- Create `mobile/src/room/JoinSheet.js`, `mobile/src/room/ChatSheet.js`, `mobile/src/room/LaunchOverlay.js`, `mobile/src/room/YourSeat.js`.
- Create `mobile/src/pfp/PfpRenderer.js`, `mobile/src/pfp/cache.js` (Task 13).
- Create `mobile/test/*.test.mjs` for config-free logic (securekeys, signer, store, format).

**Web (Task 13 only):** Create `web/pfp.html`, `web/src/pfp-page.ts`; modify `web/vite.config.js` (second input).

---

### Task 1: Shared live socket client (`engine/src/live.js`)

The web's `web/src/real/live.js` (81 lines) holds the socket logic with module globals and `location.href`. Move it into a factory both apps use.

**Files:**
- Create: `engine/src/live.js`
- Create: `engine/test/liveclient.test.js`
- Modify: `web/src/real/live.js` (whole file)

- [ ] **Step 1: Write the failing tests** — `engine/test/liveclient.test.js`:

```js
// The live socket client (engine/src/live.js) against a fake WebSocket and fake timers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLive } from "../src/live.js";

function rig({ url = "wss://x/api/ws" } = {}) {
  const made = [];
  class FakeSocket {
    constructor(u) {
      this.url = u;
      this.sent = [];
      this.closed = false;
      made.push(this);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.onclose?.();
    }
    up() {
      this.onopen?.();
    }
    push(msg) {
      this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
    }
  }
  const timers = [];
  const warned = [];
  const live = makeLive({
    url,
    WebSocket: FakeSocket,
    later: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    cancel: (t) => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
    },
    random: () => 0,
    warn: (line) => warned.push(line),
  });
  const fire = () => timers.shift().fn();
  return { live, made, timers, warned, fire };
}

test("subscribes once the socket opens, and hands each message to its topic's listeners", () => {
  const { live, made } = rig();
  const got = [];
  live.subscribe("presales", (m) => got.push(m));
  assert.equal(made.length, 1);
  assert.equal(made[0].url, "wss://x/api/ws");
  assert.deepEqual(made[0].sent, []); // nothing before open
  made[0].up();
  assert.deepEqual(made[0].sent, [{ op: "sub", topics: ["presales"] }]);
  made[0].push({ topic: "presales", type: "snapshot", data: [] });
  made[0].push({ topic: "launched", type: "snapshot", data: [] });
  assert.deepEqual(got, [{ topic: "presales", type: "snapshot", data: [] }]);
});

test("two listeners share a topic; the last one out unsubscribes", () => {
  const { live, made } = rig();
  const offA = live.subscribe("sol", () => {});
  const offB = live.subscribe("sol", () => {});
  made[0].up();
  assert.deepEqual(made[0].sent, [{ op: "sub", topics: ["sol"] }]);
  offA();
  assert.equal(made[0].sent.length, 1);
  offB();
  assert.deepEqual(made[0].sent[1], { op: "unsub", topics: ["sol"] });
});

test("a topic subscribed while open is sent at once", () => {
  const { live, made } = rig();
  live.subscribe("a", () => {});
  made[0].up();
  live.subscribe("b", () => {});
  assert.deepEqual(made[0].sent, [{ op: "sub", topics: ["a"] }, { op: "sub", topics: ["b"] }]);
});

test("topics go 32 to a message", () => {
  const { live, made } = rig();
  for (let i = 0; i < 40; i++) live.subscribe(`t${i}`, () => {});
  made[0].up();
  assert.deepEqual(made[0].sent.map((m) => m.topics.length), [32, 8]);
});

test("reconnects with a growing wait and subscribes again", () => {
  const { live, made, timers, fire } = rig();
  live.subscribe("presales", () => {});
  made[0].up();
  made[0].close();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 500);
  fire();
  assert.equal(made.length, 2);
  made[1].close(); // fails before opening
  assert.equal(timers[0].ms, 1_000);
  fire();
  made[2].up();
  assert.deepEqual(made[2].sent, [{ op: "sub", topics: ["presales"] }]);
});

test("the wait stops growing at 15 s", () => {
  const { live, made, timers, fire } = rig();
  live.subscribe("x", () => {});
  for (let i = 0; i < 10; i++) {
    made[made.length - 1].close();
    if (i < 9) fire();
  }
  assert.equal(timers[0].ms, 15_000);
});

test("no reconnect when nobody listens", () => {
  const { live, made, timers } = rig();
  const off = live.subscribe("x", () => {});
  made[0].up();
  off();
  made[0].close();
  assert.equal(timers.length, 0);
});

test("onStatus tells now and on every change", () => {
  const { live, made } = rig();
  const seen = [];
  live.subscribe("x", () => {});
  live.onStatus((up) => seen.push(up));
  made[0].up();
  made[0].close();
  assert.deepEqual(seen, [false, true, false]);
});

test("junk is ignored and a refusal is logged", () => {
  const { live, made, warned } = rig();
  const got = [];
  live.subscribe("x", (m) => got.push(m));
  made[0].up();
  made[0].push("not json");
  made[0].push({ error: "at most 64 topics" });
  assert.deepEqual(got, []);
  assert.deepEqual(warned, ["live: at most 64 topics"]);
});

test("a listener may unsubscribe while a message is handed out", () => {
  const { live, made } = rig();
  const got = [];
  const off = live.subscribe("x", () => off());
  live.subscribe("x", (m) => got.push(m.type));
  made[0].up();
  made[0].push({ topic: "x", type: "snapshot" });
  assert.deepEqual(got, ["snapshot"]);
});

test("restart drops the old socket and opens a fresh one at once", () => {
  const { live, made, timers } = rig();
  const seen = [];
  live.subscribe("x", () => {});
  made[0].up();
  live.onStatus((up) => seen.push(up));
  live.restart();
  assert.equal(made[0].closed, true);
  assert.equal(made.length, 2);
  assert.equal(timers.length, 0);
  assert.deepEqual(seen, [true, false]);
  made[0].push({ topic: "x", type: "snapshot" }); // the old socket is no longer heard
  made[1].up();
  assert.deepEqual(made[1].sent, [{ op: "sub", topics: ["x"] }]);
});

test("restart with nobody listening opens nothing", () => {
  const { live, made } = rig();
  live.restart();
  assert.equal(made.length, 0);
});

test("url may be a function, read on each connect", () => {
  let n = 0;
  const { live, made, fire } = rig({ url: () => `wss://x/${++n}` });
  live.subscribe("x", () => {});
  made[0].close();
  fire();
  assert.deepEqual(made.map((s) => s.url), ["wss://x/1", "wss://x/2"]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd engine && node --test test/liveclient.test.js`
Expected: FAIL, `Cannot find module '.../engine/src/live.js'`.

- [ ] **Step 3: Write `engine/src/live.js`**

```js
// The server's live socket (/api/ws), for the web app and the phone app alike. Screens
// subscribe to topics; the server sends each topic's snapshot, then every change. It
// reconnects on its own, and a reconnect subscribes again, so each topic gets a fresh
// snapshot. No node: imports.
//   client -> { op: "sub" | "unsub", topics }
//   server -> { topic, type: "snapshot" | "upsert" | "remove" | "message" | "missing" | "error", data }
//             or { error } when it refuses a subscription

const CHUNK = 32; // topics per message (the server takes at most 64 per socket)

/** One socket for the whole app. `url`: its address, or a function giving it (read on each
 *  connect). The rest is for tests and for runtimes without a global WebSocket. */
export function makeLive({
  url,
  WebSocket: Socket = globalThis.WebSocket,
  later = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
  random = Math.random,
  warn = (line) => console.warn(line),
}) {
  const listeners = new Map(); // topic -> Set<fn>
  const watchers = new Set(); // fn(open)
  let ws = null;
  let open = false;
  let tries = 0;
  let timer = null;

  const address = () => (typeof url === "function" ? url() : url);

  function tell(op, topics) {
    if (!open) return; // sent on (re)connect
    for (let i = 0; i < topics.length; i += CHUNK) ws.send(JSON.stringify({ op, topics: topics.slice(i, i + CHUNK) }));
  }

  function status(up) {
    open = up;
    for (const fn of [...watchers]) fn(up);
  }

  function connect() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (ws) return;
    const sock = new Socket(address());
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      tries = 0;
      status(true);
      tell("sub", [...listeners.keys()]);
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!m?.topic) {
        if (m?.error) warn(`live: ${m.error}`);
        return;
      }
      for (const fn of [...(listeners.get(m.topic) ?? [])]) fn(m);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (open) status(false);
      if (listeners.size) timer = later(connect, Math.min(15_000, 500 * 2 ** tries++) + random() * 500);
    };
    sock.onerror = () => sock.close();
  }

  /** `fn(msg)` hears `topic` until the returned function is called. */
  function subscribe(topic, fn) {
    let set = listeners.get(topic);
    if (!set) {
      listeners.set(topic, (set = new Set()));
      tell("sub", [topic]);
    }
    set.add(fn);
    connect();
    return () => {
      set.delete(fn);
      if (set.size || listeners.get(topic) !== set) return;
      listeners.delete(topic);
      tell("unsub", [topic]);
    };
  }

  /** `fn(open)` now and whenever the socket goes up or down. */
  function onStatus(fn) {
    watchers.add(fn);
    fn(open);
    return () => watchers.delete(fn);
  }

  /** Drops the socket and opens a fresh one now. The phone calls it when the app comes
   *  back to the front: Android may have cut the socket without a close event. */
  function restart() {
    const old = ws;
    ws = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try {
        old.close();
      } catch {
        // already closed
      }
    }
    if (open) status(false);
    tries = 0;
    if (listeners.size) connect();
  }

  return { subscribe, onStatus, restart };
}
```

Note for the fake: `restart` nulls `onclose` before `close()`, so the fake's `close()` calls nothing.

- [ ] **Step 4: Run the tests**

Run: `cd engine && node --test test/liveclient.test.js`
Expected: all 13 pass.

- [ ] **Step 5: Make the web use it** — replace all of `web/src/real/live.js` with:

```js
// The server's live socket (/api/ws, same origin): one per tab, engine/src/live.js (the
// phone app runs the same client).
//   server -> { topic, type: "snapshot" | "upsert" | "remove" | "message" | "missing" | "error", data }

import { makeLive } from "../../../engine/src/live.js";

function address() {
  const u = new URL("/api/ws", location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

/** subscribe(topic, fn) -> off; onStatus(fn) -> off */
export const { subscribe, onStatus } = makeLive({ url: address });
```

- [ ] **Step 6: Full engine suite and web build**

Run: `cd engine && npm test` → all pass (235 + 13).
Run: `cd web && npm run build` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add engine/src/live.js engine/test/liveclient.test.js web/src/real/live.js
git commit -m "engine: shared live socket client (makeLive); web live.js adapts it"
```

---

### Task 2: Shared Mooner sign-in (`engine/src/signin.js`)

**Files:**
- Create: `engine/src/signin.js`
- Create: `engine/test/signin.test.js`
- Modify: `web/src/lib/store.ts` (the `signIn` action, around lines 840-855)

- [ ] **Step 1: Failing tests** — `engine/test/signin.test.js`:

```js
// Mooner sign-in (engine/src/signin.js): the wallet signs the login message, the server
// checks it. The server's own verifier (server/auth.js) checks what we send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { signIn } from "../src/signin.js";
import { loginMessage } from "../src/client.js";
import { signMessage, verifySignature } from "../server/auth.js";

const kp = Keypair.generate();
const NOW = 1_790_000_000_123;

function fakeApi() {
  const calls = [];
  return { calls, login: async (body) => (calls.push(body), { wallet: body.wallet, token: "tok", exp: NOW + 7 * 86_400_000 }) };
}

test("a wallet that returns the signature alone signs in", async () => {
  const api = fakeApi();
  const r = await signIn({ api, wallet: kp.publicKey, signMessage: async (bytes) => new Uint8Array(signMessage(kp, Buffer.from(bytes).toString("utf8"))), now: () => NOW });
  assert.deepEqual(r, { token: "tok", exp: NOW + 7 * 86_400_000 });
  const [body] = api.calls;
  assert.equal(body.wallet, kp.publicKey.toBase58());
  assert.equal(body.time, Math.floor(NOW / 1000));
  assert.ok(verifySignature(kp.publicKey, loginMessage(body.wallet, body.time), Buffer.from(body.signature, "base64")));
});

test("a wallet that returns the message and then the signature signs in", async () => {
  const api = fakeApi();
  const signMsg = async (bytes) => {
    const sig = signMessage(kp, Buffer.from(bytes).toString("utf8"));
    return new Uint8Array([...bytes, ...sig]);
  };
  await signIn({ api, wallet: kp.publicKey, signMessage: signMsg, now: () => NOW });
  const [body] = api.calls;
  assert.equal(Buffer.from(body.signature, "base64").length, 64);
  assert.ok(verifySignature(kp.publicKey, loginMessage(body.wallet, body.time), Buffer.from(body.signature, "base64")));
});

test("a signature that doesn't check out never reaches the server", async () => {
  const api = fakeApi();
  const other = Keypair.generate();
  await assert.rejects(
    signIn({ api, wallet: kp.publicKey, signMessage: async (bytes) => new Uint8Array(signMessage(other, Buffer.from(bytes).toString("utf8"))), now: () => NOW }),
    /signature didn't check out/,
  );
  assert.equal(api.calls.length, 0);
});

test("the server's refusal comes through", async () => {
  const api = { login: async () => { throw new Error("the signature doesn't match this wallet"); } };
  await assert.rejects(
    signIn({ api, wallet: kp.publicKey, signMessage: async (bytes) => new Uint8Array(signMessage(kp, Buffer.from(bytes).toString("utf8"))), now: () => NOW }),
    /doesn't match/,
  );
});
```

- [ ] **Step 2: Run** `cd engine && node --test test/signin.test.js` → FAIL, module not found.

- [ ] **Step 3: Write `engine/src/signin.js`**

```js
// Mooner sign-in, for the web app and the phone app: the wallet signs the login message and
// the server returns a session token (7 days) for chat and the Mooner picture. Any wallet
// reply layout walletcheck.js knows works (the signature alone, or with the message).

import { loginMessage } from "./client.js";
import { pickSignature } from "./walletcheck.js";

/** `wallet`: a PublicKey. `signMessage(bytes)`: the wallet's. Returns { token, exp } (exp in ms). */
export async function signIn({ api, wallet, signMessage, now = () => Date.now() }) {
  const address = wallet.toBase58();
  const time = Math.floor(now() / 1000);
  const message = new TextEncoder().encode(loginMessage(address, time));
  const reply = await signMessage(message);
  const got = pickSignature(message, Uint8Array.from(reply), wallet);
  if (!got) throw new Error("The wallet's signature didn't check out. Try again.");
  const r = await api.login({ wallet: address, time, signature: Buffer.from(got.signature).toString("base64") });
  return { token: r.token, exp: r.exp };
}
```

- [ ] **Step 4: Run** `cd engine && node --test test/signin.test.js` → 4 pass.

- [ ] **Step 5: The web uses it.** In `web/src/lib/store.ts`, inside `async signIn(pfp)`, replace these lines:

```ts
          const time = Math.floor(Date.now() / 1000)
          const text = chain.loginMessage(wallet, time)
          const sig = await w.signMessage(new TextEncoder().encode(text))
          const r = await api.login({ wallet, time, signature: btoa(String.fromCharCode(...sig)) })
          login = { token: r.token, exp: r.exp }
```

with:

```ts
          const signMessage = w.signMessage
          login = await engineSignIn({ api, wallet: w.publicKey, signMessage: (bytes: Uint8Array) => signMessage(bytes) })
```

and add at the top with the other imports:

```ts
import { signIn as engineSignIn } from '../../../engine/src/signin.js'
```

(`w.signMessage` is already checked non-null above these lines; the local const keeps TypeScript's narrowing inside the arrow.) If `chain.loginMessage` has no other use in `store.ts` after this, leave `chain.js`'s export alone (other code may import it).

- [ ] **Step 6: Run** `cd engine && npm test` (all pass) and `cd web && npm run build` (exit 0).

- [ ] **Step 7: Commit**

```bash
git add engine/src/signin.js engine/test/signin.test.js web/src/lib/store.ts
git commit -m "engine: shared Mooner sign-in (signIn); the web signs in through it"
```

---

### Task 3: Shared view selectors (`engine/src/views.js`)

**Files:**
- Create: `engine/src/views.js`
- Create: `engine/test/views.test.js`
- Modify: `web/src/lib/store.ts` (`stageOf`, lines ~207-222), `web/src/lib/curve.ts` (`priceFromSqrt`)

- [ ] **Step 1: Failing tests** — `engine/test/views.test.js`:

```js
// The pure selectors both apps read presales and coins through (engine/src/views.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canGetBack, clock, fillOf, joinAmounts, joinCheck, marketCapSol, priceFromSqrt, roomOf, seatChoices, seatOf,
  secondsLeft, stageOf, SUPPLY, whoIsIn,
} from "../src/views.js";

const N = { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n };
const NOW = 1_790_000_000_000; // ms
const T = NOW / 1000;
const open = (over = {}) => ({ presale: "P", where: "er", state: "OPEN", raised: "200000000", deadlineTs: T + 600, ...over });

test("stageOf: the launched row wins, then the presale's state", () => {
  assert.equal(stageOf(open(), null), "presale");
  assert.equal(stageOf(open({ state: "FULL" }), null), "launching");
  assert.equal(stageOf(open({ state: "LAUNCHING" }), null), "launching");
  assert.equal(stageOf(open({ state: "SETTLED" }), null), "live");
  assert.equal(stageOf(open({ state: "CLOSED", launch: { at: 1 } }), null), "live");
  assert.equal(stageOf(open({ state: "CLOSED", launch: null }), null), "expired");
  assert.equal(stageOf(open({ state: "EXPIRED" }), null), "expired");
  assert.equal(stageOf(open({ state: "FAILED" }), null), "expired");
  assert.equal(stageOf(undefined, { pool: { migrated: false } }), "live");
  assert.equal(stageOf(open(), { pool: { migrated: true } }), "migrated");
  assert.equal(stageOf(undefined, { pool: null }), "live");
  assert.equal(stageOf(undefined, undefined), "expired");
});

test("priceFromSqrt: SOL per whole token, and the market cap of 1B", () => {
  // web/src/lib/curve.ts SQRT_START: the curve's first price, 28 SOL market cap
  const start = 97610994635780032n;
  const p = priceFromSqrt(start);
  assert.ok(Math.abs(p * SUPPLY - 28) < 0.01, `start market cap ${p * SUPPLY}`);
  assert.equal(marketCapSol(start), p * SUPPLY);
  assert.equal(priceFromSqrt("97610994635780032"), p); // strings from the server
});

test("fillOf and roomOf", () => {
  assert.equal(fillOf(open(), N), 0.4);
  assert.equal(fillOf(open({ raised: "900000000" }), N), 1);
  assert.equal(fillOf(open({ raised: undefined }), N), 0);
  assert.equal(roomOf(open(), N), 300_000_000n);
  assert.equal(roomOf(open({ raised: "500000000" }), N), 0n);
});

test("secondsLeft and clock", () => {
  assert.equal(secondsLeft(open(), NOW), 600);
  assert.equal(secondsLeft(open({ deadlineTs: T - 5 }), NOW), 0);
  assert.equal(secondsLeft(open({ deadlineTs: undefined }), NOW), 0);
  assert.equal(clock(0), "0:00");
  assert.equal(clock(65), "1:05");
  assert.equal(clock(3_725), "1:02:05");
});

test("whoIsIn: committed seats, biggest first, from seats or the list's users", () => {
  const view = open({
    seats: [
      { user: "A", deposit: "100000000", commit: "100000000", creator: false },
      { user: "B", deposit: "500000000", commit: "300000000", creator: true },
      { user: "C", deposit: "100000000", commit: "0", creator: false },
    ],
  });
  assert.deepEqual(whoIsIn(view), [
    { user: "B", commit: 300_000_000n, creator: true },
    { user: "A", commit: 100_000_000n, creator: false },
  ]);
  assert.deepEqual(whoIsIn(open({ users: [{ user: "D", commit: "100000000", creator: false }] })), [{ user: "D", commit: 100_000_000n, creator: false }]);
  assert.deepEqual(whoIsIn(open()), []);
});

test("seatOf", () => {
  const view = open({ seats: [{ user: "A", deposit: "100000000", commit: "50000000", creator: false, settled: false, claimed: true, where: "er" }] });
  assert.deepEqual(seatOf(view, "A"), { deposit: 100_000_000n, commit: 50_000_000n, creator: false, settled: false, claimed: true, where: "er" });
  assert.equal(seatOf(view, "Z"), null);
  assert.equal(seatOf(open(), "A"), null);
});

test("joinCheck", () => {
  assert.deepEqual(joinCheck(open(), "W", N, NOW), { ok: true });
  assert.deepEqual(joinCheck(open(), null, N, NOW), { ok: true });
  assert.equal(joinCheck(open({ state: "FULL" }), "W", N, NOW).ok, false);
  assert.equal(joinCheck(open({ where: "closed" }), "W", N, NOW).ok, false);
  assert.match(joinCheck(open({ deadlineTs: T - 1 }), "W", N, NOW).why, /Time's up/);
  assert.match(joinCheck(open({ raised: "500000000" }), "W", N, NOW).why, /full/);
  assert.match(joinCheck(open({ seats: [{ user: "W", deposit: "1", commit: "0" }] }), "W", N, NOW).why, /already in/);
  assert.match(joinCheck(open({ users: [{ user: "W", commit: "100000000" }] }), "W", N, NOW).why, /already in/);
});

test("seatChoices: the presets that fit the program's seat rules", () => {
  assert.deepEqual(seatChoices(N), [100_000_000n, 250_000_000n, 500_000_000n]);
  assert.deepEqual(seatChoices({ ...N, MAX_SEAT: 250_000_000n }), [100_000_000n, 250_000_000n]);
  assert.deepEqual(seatChoices({ MIN_SEAT: "100000000", MAX_SEAT: "500000000", STEP: "10000000" }), [100_000_000n, 250_000_000n, 500_000_000n]);
});

test("joinAmounts: the commit is cut to the room; a seat holds at least MIN_SEAT", () => {
  assert.deepEqual(joinAmounts(open(), N, 250_000_000n), { deposit: 250_000_000n, commit: 250_000_000n });
  assert.deepEqual(joinAmounts(open({ raised: "350000000" }), N, 250_000_000n), { deposit: 150_000_000n, commit: 150_000_000n });
  assert.deepEqual(joinAmounts(open({ raised: "450000000" }), N, 250_000_000n), { deposit: 100_000_000n, commit: 50_000_000n });
});

test("canGetBack", () => {
  const seat = (over = {}) => ({ user: "W", deposit: "100000000", commit: "100000000", creator: false, settled: false, ...over });
  assert.equal(canGetBack(open({ seats: [seat()] }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat({ creator: true })] }), "W", NOW), false);
  assert.equal(canGetBack(open({ seats: [seat({ settled: true })] }), "W", NOW), false);
  assert.equal(canGetBack(open({ seats: [seat()], deadlineTs: T - 1 }), "W", NOW), false);
  assert.equal(canGetBack(open({ seats: [seat()], state: "EXPIRED" }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat()], state: "FAILED" }), "W", NOW), true);
  assert.equal(canGetBack(open({ seats: [seat()], state: "FULL" }), "W", NOW), false);
  assert.equal(canGetBack(open({ seats: [] }), "W", NOW), false);
});
```

- [ ] **Step 2: Run** `cd engine && node --test test/views.test.js` → FAIL, module not found.

- [ ] **Step 3: Write `engine/src/views.js`**

```js
// What a screen shows about a presale or a coin, read from the server's views (GET
// /api/presale/:key, the `presales`, `presale:<key>` and `launched` pushes). Pure: no
// network and no clock of its own (callers pass `nowMs`). The web app and the phone app
// both read presales through these. Amounts are BigInt lamports; the server sends strings.

/** Every Mooner coin's supply in whole tokens (engine/src/dbc.js: 1B, 6 decimals). */
export const SUPPLY = 1_000_000_000;
const DECIMALS = 6;

const big = (v) => BigInt(v ?? 0);
const no = (why) => ({ ok: false, why });

/** "presale" | "launching" | "live" | "migrated" | "expired", from a presale's view and its
 *  launched row; either may be missing. */
export function stageOf(view, launched) {
  if (launched) return launched.pool?.migrated ? "migrated" : "live";
  switch (view?.state) {
    case "OPEN":
      return "presale";
    case "FULL":
    case "LAUNCHING":
      return "launching";
    case "SETTLED":
      return "live";
    case "CLOSED":
      return view.launch ? "live" : "expired";
    default:
      return "expired";
  }
}

/** SOL per whole token at a pool's Q64.64 sqrt price (of lamports per raw token). */
export function priceFromSqrt(sqrtPrice) {
  const s = Number(BigInt(sqrtPrice)) / 2 ** 64;
  return (s * s * 10 ** DECIMALS) / 1e9;
}

/** Market cap in SOL at a sqrt price. */
export const marketCapSol = (sqrtPrice) => priceFromSqrt(sqrtPrice) * SUPPLY;

/** How full the pool is, 0 to 1. `N`: /api/info `numbers` (BigInt or strings). */
export function fillOf(view, N) {
  const target = big(N.TARGET);
  if (target <= 0n) return 0;
  return Math.min(1, Math.max(0, Number(big(view.raised)) / Number(target)));
}

/** Lamports still to fill. */
export function roomOf(view, N) {
  const r = big(N.TARGET) - big(view.raised);
  return r > 0n ? r : 0n;
}

/** Whole seconds to the deadline; 0 once past or with no deadline. */
export function secondsLeft(view, nowMs) {
  const d = Number(view.deadlineTs ?? 0);
  return d > 0 ? Math.max(0, Math.floor(d - nowMs / 1000)) : 0;
}

/** "m:ss", or "h:mm:ss" from an hour. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const two = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** Who's in: [{ user, commit, creator }], biggest commit first. From the seats when the view
 *  has them (a detail view), else the list's users. A seat with nothing in the pool isn't in. */
export function whoIsIn(view) {
  const rows = (view.seats ?? view.users ?? []).map((r) => ({ user: r.user, commit: big(r.commit), creator: !!r.creator }));
  return rows.filter((r) => r.commit > 0n).sort((a, b) => (b.commit > a.commit ? 1 : b.commit < a.commit ? -1 : 0));
}

/** `wallet`'s seat in a detail view, or null. */
export function seatOf(view, wallet) {
  const s = view.seats?.find((x) => x.user === wallet);
  if (!s) return null;
  return { deposit: big(s.deposit), commit: big(s.commit), creator: !!s.creator, settled: !!s.settled, claimed: !!s.claimed, where: s.where };
}

/** Whether `wallet` (or anyone, with null) can join now: { ok: true } or { ok: false, why }. */
export function joinCheck(view, wallet, N, nowMs) {
  if (view.state !== "OPEN" || view.where === "closed") return no("This presale isn't taking seats.");
  if (secondsLeft(view, nowMs) <= 0) return no("Time's up for this presale.");
  if (wallet && (seatOf(view, wallet) || (view.users ?? []).some((u) => u.user === wallet))) return no("You're already in.");
  if (roomOf(view, N) <= 0n) return no("The pool is full.");
  return { ok: true };
}

/** Seat sizes the join sheet offers. */
export const SEAT_PRESETS = [100_000_000n, 250_000_000n, 500_000_000n];

/** The presets the program takes (util.rs valid_seat: MIN_SEAT..MAX_SEAT, a multiple of STEP). */
export function seatChoices(N) {
  const [min, max, step] = [big(N.MIN_SEAT), big(N.MAX_SEAT), big(N.STEP)];
  return SEAT_PRESETS.filter((a) => a >= min && a <= max && (step === 0n || a % step === 0n));
}

/** A pick of `amount`: what the seat holds and what goes in the pool. The program commits
 *  what fits (set_commit cuts to the room) and a seat holds at least MIN_SEAT; the rest of
 *  the deposit comes back with the seat. */
export function joinAmounts(view, N, amount) {
  const room = roomOf(view, N);
  const commit = amount < room ? amount : room;
  const min = big(N.MIN_SEAT);
  return { deposit: commit > min ? commit : min, commit };
}

/** Whether "Get my SOL back" applies: a seat that isn't the creator's and isn't settled, in a
 *  presale that's open (before its deadline), expired or failed. flows.getBack has the last
 *  word and says why when it can't. */
export function canGetBack(view, wallet, nowMs) {
  const s = seatOf(view, wallet);
  if (!s || s.creator || s.settled) return false;
  if (view.state === "OPEN") return secondsLeft(view, nowMs) > 0;
  return view.state === "EXPIRED" || view.state === "FAILED";
}
```

- [ ] **Step 4: Run** `cd engine && node --test test/views.test.js` → all pass.

- [ ] **Step 5: The web uses `stageOf` and `priceFromSqrt` from here.**
  - In `web/src/lib/store.ts`: delete the local `function stageOf(...) { ... }` (lines ~207-222) and add `import { stageOf as viewStage } from '../../../engine/src/views.js'`; then add, where the local function was:
    ```ts
    const stageOf = (v: PresaleView | undefined, l: LaunchedRow | undefined): Stage => viewStage(v, l) as Stage
    ```
  - In `web/src/lib/curve.ts`: delete the local `priceFromSqrt` function and its doc comment; add near the top `export { priceFromSqrt } from '../../../engine/src/views.js'` and `import { priceFromSqrt } from '../../../engine/src/views.js'` only if this file itself still calls it (check with grep; it doesn't today).
  - `LAMPORTS_PER_SOL` may become unused in `curve.ts`; remove it from the import if the build or `tsc` complains.

- [ ] **Step 6: Run** `cd engine && npm test` (all pass), `cd web && npm run build` (exit 0), and `cd web && npx tsc -p tsconfig.check.json --noEmit` if that config exists and passed before this task (run it on a clean `git stash` first to know its baseline; report the baseline and after).

- [ ] **Step 7: Commit**

```bash
git add engine/src/views.js engine/test/views.test.js web/src/lib/store.ts web/src/lib/curve.ts
git commit -m "engine: shared presale and coin selectors (views.js); web stage and price use them"
```

---

### Task 4: Phone project: expo-router, packages, entry

**Files:**
- Modify: `mobile/package.json`, `mobile/app.json`, `mobile/index.js`
- Create: `mobile/app/_layout.js` (temporary), `mobile/app/index.js` (temporary), `mobile/app/spike.js`

- [ ] **Step 1: Install packages** (versions picked by Expo for SDK 55; zustand pinned as the web's):

```bash
cd mobile
npx expo install expo-router expo-linking expo-constants react-native-screens react-native-safe-area-context expo-secure-store expo-haptics react-native-svg react-native-webview expo-file-system expo-font @expo-google-fonts/geist @expo-google-fonts/geist-mono expo-clipboard expo-system-ui
npm install zustand@5.0.15
```

Do not run `npm audit fix --force`. If `npx expo install` asks to accept anything, stop and report.

- [ ] **Step 2: Entry.** Replace `mobile/index.js` with:

```js
// Polyfills first (engine/src and web3.js expect crypto.getRandomValues and Buffer), then
// expo-router, which loads the screens under app/.
import "./polyfill";
import "expo-router/entry";
```

- [ ] **Step 3: `mobile/app.json`** becomes:

```json
{
  "expo": {
    "name": "Mooner",
    "slug": "mooner",
    "scheme": "mooner",
    "version": "0.1.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "dark",
    "backgroundColor": "#07080b",
    "android": {
      "package": "family.mooner.app",
      "edgeToEdgeEnabled": true
    },
    "plugins": ["expo-router", "expo-secure-store", "expo-font"],
    "experiments": { "typedRoutes": false }
  }
}
```

- [ ] **Step 4: `mobile/package.json`**: keep `"main": "index.js"`; add to `"scripts"`:

```json
"test": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \"test/*.test.mjs\""
```

- [ ] **Step 5: Keep the spike reachable.** Create `mobile/app/spike.js`:

```js
// The piece-0 device checks, kept for debugging on the phone: open mooner://spike.
export { default } from "../src/SpikeScreen";
```

- [ ] **Step 6: A bare shell to prove the router boots.** `mobile/app/_layout.js`:

```js
import { Stack } from "expo-router";

export default function Root() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#07080b" } }} />;
}
```

`mobile/app/index.js`:

```js
import { Text, View } from "react-native";

export default function Home() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#07080b" }}>
      <Text style={{ color: "#f3f4f6", fontSize: 18 }}>Mooner</Text>
    </View>
  );
}
```

(Tasks 8-12 replace both.)

- [ ] **Step 7: Regenerate the native project** (android/ is generated and git-ignored; the new native modules and config plugins need it):

```bash
cd mobile && npx expo prebuild --platform android --clean
```

- [ ] **Step 8: Bundle check and device build**

```bash
cd mobile && sh scripts/check-bundle.sh
```
Expected: `web3.js copies: 1; files from engine/node_modules: 0`.

```bash
cd mobile && sh scripts/run-android.sh
```
Expected: BUILD SUCCESSFUL, installed, the app opens to "Mooner" centered on near-black. Screenshot it. Then `adb shell am start -a android.intent.action.VIEW -d mooner://spike` opens the spike screen; screenshot.

- [ ] **Step 9: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/index.js mobile/app/_layout.js mobile/app/index.js mobile/app/spike.js
git commit -m "mobile: expo-router app shell, packages for the core app; spike at mooner://spike"
```

---

### Task 5: Phone config, secure storage, signer (tested in Node)

**Files:**
- Create: `mobile/src/config.js`, `mobile/src/securekeys.js`, `mobile/src/signer.js`
- Create: `mobile/test/securekeys.test.mjs`, `mobile/test/signer.test.mjs`

- [ ] **Step 1: `mobile/src/config.js`**

```js
// Where the phone app talks to. Mooner runs on mainnet (Seed Vault won't sign devnet txs:
// spec, Answers 2026-10-01).
export const BASE = "https://app.mooner.family";
export const WS_URL = "wss://app.mooner.family/api/ws";
/** µLamports per CU the phone builds txs at: Seed Vault raises anything lower to this. */
export const PRIORITY = 100_000;
/** The wallet's network for Mobile Wallet Adapter, and Solana's public RPC for it. */
export const CHAIN = "solana:mainnet";
export const RPC = "https://api.mainnet-beta.solana.com";
/** How the app shows itself in the wallet's approval screen. */
export const IDENTITY = { name: "Mooner", uri: "https://mooner.family", icon: "favicon.ico" };
```

Note: `IDENTITY.icon` is relative to `uri` (MWA rule). Check `curl -sI https://mooner.family/favicon.ico` returns 200; if not, use the path that `curl -s https://mooner.family | grep -o 'rel="icon"[^>]*'` names, and report which.

- [ ] **Step 2: Failing tests** — `mobile/test/securekeys.test.mjs`:

```js
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
```

`mobile/test/signer.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mwaSigner } from "../src/signer.js";

test("no account, no signer", () => {
  assert.equal(mwaSigner({ account: undefined }), null);
});

test("signs through signTransactions and signMessages; sends what the wallet signed", async () => {
  const pk = { toBase58: () => "W" };
  const calls = [];
  const signed = { serialize: () => Uint8Array.of(1, 2, 3) };
  const w = {
    account: { publicKey: pk },
    signTransactions: async (tx) => (calls.push(["signTransactions", tx]), signed),
    signMessages: async (bytes) => (calls.push(["signMessages", bytes]), Uint8Array.of(9)),
  };
  const s = mwaSigner(w);
  assert.equal(s.publicKey, pk);
  assert.equal(await s.signTransaction("tx1"), signed);
  assert.deepEqual(await s.signMessage(Uint8Array.of(7)), Uint8Array.of(9));
  const sent = [];
  const conn = { sendRawTransaction: async (bytes, opts) => (sent.push([bytes, opts]), "SIG") };
  assert.equal(await s.sendTransaction("tx2", conn, { skipPreflight: false }), "SIG");
  assert.deepEqual(sent, [[Uint8Array.of(1, 2, 3), { skipPreflight: false }]]);
  assert.deepEqual(calls.map((c) => c[0]), ["signTransactions", "signMessages", "signTransactions"]);
});
```

- [ ] **Step 3: Run** `cd mobile && npm test` → FAIL (modules missing).

- [ ] **Step 4: `mobile/src/securekeys.js`**

```js
// The phone's secrets, in Android Keystore through expo-secure-store (spec, Security): the
// seats' session keys (flows.js `keys`), the wallet's authorization and the Mooner sign-in.
// `store` is the expo-secure-store module, passed in so this file runs in Node tests.

/** A key expo-secure-store accepts (letters, digits, ".", "-", "_"); anything else becomes
 *  "_". Mooner's names are base58 keys joined by ":", so two names never meet. */
export const safeName = (name) => name.replace(/[^A-Za-z0-9._-]/g, "_");

/** flows.js `keys`: { get(name), set(name, value) }. */
export function secureKeys(store) {
  return {
    get: async (name) => (await store.getItemAsync(safeName(name))) ?? null,
    set: (name, value) => store.setItemAsync(safeName(name), value),
  };
}

/** One JSON value under `name`: { get, set, clear }, the shape the wallet library takes for
 *  its authorization cache. `revive` is JSON.parse's reviver. A value that doesn't parse
 *  reads as missing. */
export function secureJson(store, name, revive) {
  const key = safeName(name);
  return {
    async get() {
      const s = await store.getItemAsync(key);
      if (!s) return undefined;
      try {
        return JSON.parse(s, revive);
      } catch {
        return undefined;
      }
    },
    set: (value) => store.setItemAsync(key, JSON.stringify(value)),
    clear: () => store.deleteItemAsync(key),
  };
}
```

- [ ] **Step 5: `mobile/src/signer.js`**

```js
// One signer for every screen (spec, "One signer, two wallets"): Mobile Wallet Adapter now,
// Privy later. Screens and flows.js see only
//   { publicKey, signTransaction(tx), sendTransaction(tx, conn, opts), signMessage(bytes) }
// Seed Vault signs without sending (spike, 2026-10-01), so a send is sign + our own RPC send,
// as the web does.

/** `w`: useMobileWallet() from @wallet-ui/react-native-web3js. null until it's connected. */
export function mwaSigner(w) {
  const publicKey = w.account?.publicKey;
  if (!publicKey) return null;
  return {
    publicKey,
    signTransaction: (tx) => w.signTransactions(tx),
    async sendTransaction(tx, conn, opts) {
      const signed = await w.signTransactions(tx);
      return conn.sendRawTransaction(signed.serialize(), opts);
    },
    signMessage: (bytes) => w.signMessages(bytes),
  };
}
```

- [ ] **Step 6: Run** `cd mobile && npm test` → 5 pass.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/config.js mobile/src/securekeys.js mobile/src/signer.js mobile/test/securekeys.test.mjs mobile/test/signer.test.mjs
git commit -m "mobile: config, secure storage adapters, Mobile Wallet Adapter signer"
```

---

### Task 6: The app's store (`mobile/src/store.js`)

**Files:**
- Create: `mobile/src/store.js`
- Create: `mobile/test/store.test.mjs`

- [ ] **Step 1: Failing tests** — `mobile/test/store.test.mjs`:

```js
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
  const unsub = store.subscribe((s) => s.busy?.step && steps.push(s.busy.step));
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
```

- [ ] **Step 2: Run** `cd mobile && npm test` → store tests FAIL (module missing).

- [ ] **Step 3: Write `mobile/src/store.js`**

```js
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
```

Note on the sendChat test: it calls `sendChat("A", "  gm  ", signer, { signIn })` so the stub replaces the engine's sign-in; this is why `signIn` takes `{ signIn }` options.

- [ ] **Step 4: Run** `cd mobile && npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/store.js mobile/test/store.test.mjs
git commit -m "mobile: the app store (live pushes, wallet, join, get back, chat) with Node tests"
```

---

### Task 7: Look and feel (theme, fonts, UI kit)

The phone matches the website: near-black surfaces, hairline rims, one blue for actions, mint up, coral down, cyan for presale pools, gold for "you". Fonts Geist and Geist Mono (numbers).

**Files:**
- Create: `mobile/src/ui/theme.js`, `mobile/src/ui/format.js`, `mobile/src/ui/useNow.js`, `mobile/src/ui/kit.js`, `mobile/src/ui/Ring.js`, `mobile/src/ui/FillBar.js`, `mobile/src/ui/Face.js`, `mobile/src/ui/CoinImage.js`
- Create: `mobile/test/format.test.mjs`
- Copy: `assets/mooner.svg` → `mobile/assets/mooner.svg` (the logo is final; use the file, never redraw)

- [ ] **Step 1: `mobile/src/ui/theme.js`** (values from `web/src/globals.css` `:root`):

```js
// The website's tokens (web/src/globals.css), for the phone.
export const C = {
  bg0: "#07080b", bg1: "#0d0e12", bg2: "#14161b", bg3: "#1b1e25",
  line: "#1b1d24", lineStrong: "#2a2d37",
  text0: "#f3f4f6", text1: "#9a9eab", text2: "#636775",
  well: "#040507", wellLine: "#23262f",
  up: "#2ee6a0", down: "#ff4d6d", warn: "#ff8a3d",
  accent: "#5468ff", accentInk: "#ffffff",
  gold: "#ffb23e", goldInk: "#1c1203",
  er: "#3bd4ff", migrated: "#9d8cff",
};
export const F = {
  regular: "Geist_400Regular", medium: "Geist_500Medium", semi: "Geist_600SemiBold", bold: "Geist_700Bold",
  mono: "GeistMono_500Medium",
};
export const R = { s: 6, m: 10, l: 16, pill: 999 };
export const S = { gutter: 16 };
```

Check the exact font export names: `node -e "console.log(Object.keys(require('@expo-google-fonts/geist')).filter(k=>/^Geist_/.test(k)))"` (run in `mobile/`) and the same for `@expo-google-fonts/geist-mono`; use the names it prints.

- [ ] **Step 2: Failing tests** — `mobile/test/format.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { compact, shortWallet, solText, usd } from "../src/ui/format.js";

test("solText: lamports as SOL, trimmed", () => {
  assert.equal(solText(500_000_000n), "0.5");
  assert.equal(solText("250000000"), "0.25");
  assert.equal(solText(123_456_789n, 3), "0.123");
  assert.equal(solText(0), "0");
});
test("usd", () => {
  assert.equal(usd(1234.5), "$1,234.50");
  assert.equal(usd(12_345_678), "$12.3M");
  assert.equal(usd(0.0123), "$0.0123");
});
test("compact", () => {
  assert.equal(compact(950), "950");
  assert.equal(compact(12_300), "12.3K");
  assert.equal(compact(4_560_000), "4.56M");
  assert.equal(compact(1_000_000_000), "1B");
});
test("shortWallet", () => {
  assert.equal(shortWallet("HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D"), "HgZ9…5u8D");
});
```

- [ ] **Step 3: `mobile/src/ui/format.js`**

```js
// Numbers as the screens show them.
import { sol } from "../../../engine/src/flows.js";

/** Lamports (BigInt, number or string) as SOL text: 0.5, 0.25. */
export const solText = (lamports, digits = 2) => sol(BigInt(lamports ?? 0), digits);

/** 950, 12.3K, 4.56M, 1B: three significant digits at most. */
export function compact(n) {
  const units = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, u] of units) if (Math.abs(n) >= v) return `${Number((n / v).toPrecision(3))}${u}`;
  return String(Number(n.toPrecision(3)));
}

/** Dollars: cents under 10k, compact above, 3 significant digits under $1. */
export function usd(n) {
  if (Math.abs(n) >= 10_000) return `$${compact(n)}`;
  if (Math.abs(n) >= 1) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${Number(n.toPrecision(3))}`;
}

/** HgZ9…5u8D */
export const shortWallet = (w) => (w && w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w ?? "");
```

Run `cd mobile && npm test` → format tests pass. (If `toLocaleString` in Node prints differently, the test shows it; Hermes on the phone has Intl.)

- [ ] **Step 4: `mobile/src/ui/useNow.js`** — a clock for countdowns (reads no server):

```js
import { useEffect, useState } from "react";

/** Date.now(), updated every `ms` while the screen is mounted. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
```

- [ ] **Step 5: `mobile/src/ui/kit.js`** — exact components and props:
  - `Screen({ children, scroll = false, padded = true })`: SafeAreaView (react-native-safe-area-context, edges top) on `C.bg0`; `scroll` wraps children in a ScrollView with `paddingBottom: 32`; padded = horizontal 16.
  - `T({ v = "body", color, style, children, ...rest })`: Text with variants: `title` 28/semi, `h2` 20/semi, `body` 15/regular, `small` 13/regular text1, `label` 12/medium uppercase letterSpacing 0.6 text2, `num` 15/mono, `bigNum` 34/mono. Default color text0.
  - `Button({ title, onPress, kind = "primary" | "quiet" | "danger" | "gold", disabled, busy, icon })`: oval (radius pill), height 52, full width; primary = accent bg + white text; quiet = bg2 + rim lineStrong; danger = transparent + down rim/text; gold = gold bg + goldInk. Pressed: opacity 0.85 and scale 0.98. `busy` shows ActivityIndicator instead of the title and ignores presses. Calls `Haptics.selectionAsync()` on press.
  - `Card({ children, onPress, style })`: bg1, radius 16, 1px rim `C.line`, padding 14; pressable when `onPress`.
  - `Pill({ text, color = C.text1 })`: small rounded tag, 1px rim of `color` at 40% alpha, text color.
  - `Banner({ text, color = C.warn })`: a thin strip at the top (height 28) with the text centered; used for "Reconnecting…".
  - `Steps({ step })`: when `step` is non-null, a row with a small ActivityIndicator and `step…` in text1. Null renders nothing.
  - `Sheet({ open, onClose, children, title })`: React Native `Modal` (transparent, animationType "slide", statusBarTranslucent, navigationBarTranslucent) with a dimmed backdrop (tap closes) and a bottom panel bg1, top radius 24, a grabber bar, title (h2), and children; respects the bottom safe-area inset; wraps content in `KeyboardAvoidingView` (behavior "height" on Android).
  - `Empty({ title, body })`: centered muted text block for empty lists.

- [ ] **Step 6: `mobile/src/ui/Ring.js`** — `Ring({ size = 240, stroke = 14, fill /* 0..1 */, color = C.er, children })`: react-native-svg; a track circle in `C.wellLine` and an arc from 12 o'clock clockwise, `strokeLinecap="round"`, length `fill`; the arc animates to a new fill over 600 ms (Animated with `useNativeDriver: false` on `strokeDashoffset` via `Animated.createAnimatedComponent(Circle)`). Children are centered over it (absolute fill).

- [ ] **Step 7: `mobile/src/ui/FillBar.js`** — `FillBar({ fill, color = C.er, height = 6 })`: a well (bg `C.well`, rim `C.wellLine`, radius pill) with an inner bar of width `fill*100%`.

- [ ] **Step 8: `mobile/src/ui/Face.js`** — `Face({ wallet, size = 32, ring })`: a circle. In this task: the fallback only — background color from a hash of the wallet (`hsl(h, 55%, 45%)` with `h = (sum of char codes * 37) % 360`), the wallet's first two characters centered (mono, size*0.38). `ring` (a color) draws a 2px border. Task 13 adds the rendered picture. Also export `Faces({ wallets, size = 28, max = 6 })`: overlapping row (each shifted -size*0.3), and "+N" bubble when more than `max`.

- [ ] **Step 9: `mobile/src/ui/CoinImage.js`** — `CoinImage({ uri, size = 44, ticker })`: React Native `Image` with radius `size*0.28`, bg `C.bg3`; when there's no uri or it errors (onError), shows the ticker's first letter centered.

- [ ] **Step 10: Copy the logo** `cp assets/mooner.svg mobile/assets/mooner.svg`. Show it with `react-native-svg`'s `SvgXml` using the file's text: add `mobile/src/ui/Logo.js` that imports the SVG text through a JS module generated once: create `mobile/src/ui/logo-svg.js` containing `export default \`<the file's exact contents>\`;` (copy byte for byte; do not edit the drawing) and `Logo({ size })` renders `<SvgXml xml={svg} width={size} height={size} />`.

- [ ] **Step 11: Run** `cd mobile && npm test` (all pass) and `sh scripts/check-bundle.sh` (1 copy, 0 stray).

- [ ] **Step 12: Commit**

```bash
git add mobile/src/ui mobile/test/format.test.mjs mobile/assets/mooner.svg
git commit -m "mobile: theme, fonts, UI kit (ring, fill bar, faces, sheets, steps)"
```

---

### Task 8: Wiring, wallet, the connect screen

**Files:**
- Create: `mobile/src/app.js`, `mobile/src/wallet.js`, `mobile/app/connect.js`
- Modify: `mobile/app/_layout.js`, `mobile/app/index.js`

- [ ] **Step 1: `mobile/src/app.js`** — one of each for the whole app:

```js
// The app's one socket, API, flows and store (React Native side).
import * as SecureStore from "expo-secure-store";
import { makeApi } from "../../engine/src/apiclient.js";
import { makeFlows } from "../../engine/src/flows.js";
import { makeLive } from "../../engine/src/live.js";
import { BASE, PRIORITY, WS_URL } from "./config";
import { secureJson, secureKeys } from "./securekeys";
import { createMoonerStore } from "./store";

export const live = makeLive({ url: WS_URL });
export const api = makeApi(BASE);
export const flows = makeFlows({ api, subscribe: live.subscribe, keys: secureKeys(SecureStore), priority: PRIORITY });
export const store = createMoonerStore({ live, api, flows, saved: (name) => secureJson(SecureStore, name) });
```

- [ ] **Step 2: `mobile/src/wallet.js`**

```js
// Mobile Wallet Adapter for the app: the provider (mainnet, authorization kept in
// expo-secure-store so reconnecting skips the approval screen), the signer, and the
// store's wallet kept in step with the adapter's account.
import { useEffect, useMemo } from "react";
import * as SecureStore from "expo-secure-store";
import { PublicKey } from "@solana/web3.js";
import { MobileWalletProvider, useMobileWallet } from "@wallet-ui/react-native-web3js";
import { CHAIN, IDENTITY, RPC } from "./config";
import { secureJson } from "./securekeys";
import { mwaSigner } from "./signer";
import { store } from "./app";

const cache = secureJson(SecureStore, `mwa-authorization:${CHAIN}`, (k, v) => (k === "publicKey" ? new PublicKey(v) : v));

export function WalletProvider({ children }) {
  return (
    <MobileWalletProvider cache={cache} chain={CHAIN} endpoint={RPC} commitmentOrConfig="confirmed" identity={IDENTITY}>
      <FollowWallet />
      {children}
    </MobileWalletProvider>
  );
}

/** Keeps store.wallet = the adapter's account. */
function FollowWallet() {
  const w = useMobileWallet();
  const address = w.account?.publicKey?.toBase58() ?? null;
  useEffect(() => {
    store.getState().setWallet(address);
  }, [address]);
  return null;
}

/** The signer, or null when no wallet is connected. */
export function useSigner() {
  const w = useMobileWallet();
  return useMemo(() => mwaSigner(w), [w.account?.publicKey?.toBase58(), w.signTransactions, w.signMessages]);
}

/** { connect(), disconnect() } over the adapter. */
export function useWalletActions() {
  const w = useMobileWallet();
  return { connect: () => w.connect(), disconnect: () => w.disconnect() };
}
```

- [ ] **Step 3: `mobile/app/_layout.js`** (replace the temporary one):
  - Loads fonts with `useFonts` from `expo-font` (the Geist weights in `theme.js` plus Geist Mono 500); while loading, renders a `View` with `C.bg0` (no spinner flash).
  - `expo-system-ui` `SystemUI.setBackgroundColorAsync(C.bg0)` once; `StatusBar style="light"` from expo-status-bar.
  - Wraps in `SafeAreaProvider` then `WalletProvider`.
  - Starts the store once: `useEffect(() => store.getState().start(), [])` (its return value is the stop function).
  - Restarts the socket when the app comes back after a real absence: note `Date.now()` when AppState goes to `background`; on `active`, call `live.restart()` only if it was away 20 s or more. (Every wallet signature opens Seed Vault on top, which Android reports as background; a short trip to the wallet must not drop and re-snapshot every topic.)
  - `<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg0 }, animation: "slide_from_right" }} />` with `presale/[key]` and `coin/[key]` as normal stack screens.
  - Above the Stack: a `Banner` "Reconnecting…" when `useStore(store, s => s.socketUp)` is false for more than 2 s (a timeout started when it goes false, cleared when true; so a normal first connect shows nothing).

- [ ] **Step 4: `mobile/app/index.js`** (replace): reads the adapter's account (`useMobileWallet().account`) and whether the user chose "Look around first" this run (a module-level flag in `mobile/src/session.js`: `export let browsing = false; export const browse = () => { browsing = true; };`). Account or browsing → `<Redirect href="/(tabs)" />`; otherwise `<Redirect href="/connect" />`.

- [ ] **Step 5: `mobile/app/connect.js`** — the sign-in screen (spec "Sign-in"):
  - Full screen on `C.bg0`. Top two thirds: the Mooner logo (`Logo size={160}`), "Mooner" (title), and one line under it: "Presales that fill together and launch on Meteora." (small, text1, centered).
  - Bottom: primary `Button` "Connect Seed Vault" → `connect()`; `busy` while it runs; on success `router.replace("/(tabs)")` and `Haptics.notificationAsync(Success)`; on error show the `explain(e)` text (from `engine/src/flows.js`) in `C.down` above the button. If the user cancels, show "You cancelled it in your wallet." (that's what explain returns).
  - Under it a quiet text button "Look around first" → `browse(); router.replace("/(tabs)")`.
  - Footnote (label style, centered): "Any Solana wallet on this phone works too." — MWA lists every installed wallet when there is more than one.
  - "Continue with X or email" is not in this piece (it needs the Privy app client; the user is asked for it later).

- [ ] **Step 6: Device check.** Build and install (`sh scripts/run-android.sh`). Screenshot the connect screen. Ask the user (through the controller) to tap "Connect Seed Vault" and approve; screenshot after. Then force-stop (`adb shell am force-stop family.mooner.app`) and reopen (`adb shell monkey -p family.mooner.app 1`): it must open past the connect screen without a new approval (auth kept in secure-store). If the reopen asks again, find why (the cache's `get` after a cold start) before moving on.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/app.js mobile/src/wallet.js mobile/src/session.js mobile/app/_layout.js mobile/app/index.js mobile/app/connect.js
git commit -m "mobile: app wiring, Seed Vault connect, auth kept in secure storage"
```

---

### Task 9: Tabs and Live

**Files:**
- Create: `mobile/app/(tabs)/_layout.js`, `mobile/app/(tabs)/index.js`
- Create: `mobile/src/live/PresaleCard.js`

- [ ] **Step 1: `mobile/app/(tabs)/_layout.js`** — expo-router `Tabs`, `headerShown: false`, tab bar bg `C.bg1`, top border `C.line`, active tint `C.text0`, inactive `C.text2`, labels Geist 500 12. Three tabs in this piece: `index` "Live", `launched` "Launched", `me` "Me". Icons: draw simple ones with react-native-svg in `mobile/src/ui/icons.js` — Live: a filled circle with a ring (a "live dot"), Launched: an up-right arrow, Me: a person outline — 22 px, stroke = tint. (Create and Alerts tabs come in pieces 4 and 5.)

- [ ] **Step 2: `mobile/src/live/PresaleCard.js`** — `PresaleCard({ view, info, profiles, now, onPress })`. Layout (a `Card`):
  - Row 1: `CoinImage` (44) of `view.token?.image`, then `$${view.token.symbol}` (h2) over `view.token.name` (small); right side: time left `clock(secondsLeft(view, now))` in `num` style, colored `C.warn` under 5 minutes.
  - Row 2: `FillBar` with `fillOf(view, info.N)`, then a row: "`solText(view.raised)` / `solText(info.N.TARGET)` SOL" (num) on the left and `Faces` of `whoIsIn(view).map(r => r.user)` on the right.
  - A view without `token` (a presale the server issued no coin for) is skipped by the list, not rendered.
  - Press → `onPress()`; haptic selection.

- [ ] **Step 3: `mobile/app/(tabs)/index.js`** — Live:
  - Header: "Live" (title) and, right, the user's SOL (`solText(lamports)` SOL) when connected, else a small "Connect" quiet button → `/connect`.
  - Data: `presales = useStore(store, s => s.presales)`, `info = useStore(store, s => s.info)`, `profiles`, `now = useNow(1000)`; `list = useMemo(() => liveList({ presales }).filter(v => v.token), [presales])`.
  - `FlatList` of `PresaleCard`, gap 12, padding 16; tap → `router.push(\`/presale/${v.presale}\`)`.
  - Before `info` arrives: a centered ActivityIndicator. If `infoError`: show its text (small, `C.down`) under the spinner; no retry button — the store loads info again on its own when the socket comes back up.
  - Empty list (info loaded, no open presales): `Empty` "No presales right now" / "New ones show up here the moment they open."
  - Auto-join is not in this piece (it needs push to wait for room; piece 5).

- [ ] **Step 4: Device check** — install; screenshot Live. The list must match `curl -s https://app.mooner.family/api/presales` (today it may be empty: then the empty state shows). Report what the API returned next to the screenshot.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/_layout.js" "mobile/app/(tabs)/index.js" mobile/src/live/PresaleCard.js mobile/src/ui/icons.js
git commit -m "mobile: tabs and the Live list of open presales"
```

---

### Task 10: The presale room

**Files:**
- Create: `mobile/app/presale/[key].js`
- Create: `mobile/src/room/JoinSheet.js`, `mobile/src/room/YourSeat.js`, `mobile/src/room/ChatSheet.js`, `mobile/src/room/LaunchOverlay.js`

Data in the room: `key = useLocalSearchParams().key`; `useEffect(() => store.getState().watch(key), [key])`; `view = useStore(store, s => s.views[key] ?? s.presales[key])`; `missing = useStore(store, s => !!s.missing[key])`; `info`, `wallet`, `lamports`, `busy`, `launched = useStore(store, s => s.launched[key])`; `now = useNow(1000)`; `signer = useSigner()`.

- [ ] **Step 1: The room screen** `mobile/app/presale/[key].js`:
  - Top bar: back chevron (router.back), `$TICKER` centered, and a chat button (speech-bubble icon with the message count from `chats[key]?.length`) on the right.
  - No view yet: centered spinner. `missing`: `Empty` "This presale isn't here" / "It may have closed." with a quiet "Back" button.
  - Hero (centered): `Ring size 260` with `fillOf(view, info.N)`; inside: `solText(view.raised)` (bigNum) over "of `solText(info.N.TARGET)` SOL" (small), and under the ring the countdown "`clock(secondsLeft)` left" (or the stage text: launching → "Launching on Solana", live → "Live", expired → "Closed"). Ring color: `C.er` while open, `C.up` when full/launching/live.
  - Around/under the ring: "Who's in" label and `Faces` of `whoIsIn(view)` (max 8). Tap a face → a small sheet with the face (64), the short wallet, their commit in SOL, and "Creator" pill when `creator`. (Follow comes in piece 5.)
  - Coin block: `CoinImage` 56, name, `$TICKER`, description (3 lines max, "More" expands), links (X / Telegram / Website) as pills that open with `Linking.openURL` (only the ones present).
  - Bottom sticky area (above the safe-area inset), chosen by state:
    - not connected → primary "Connect to join" → `/connect`.
    - `seatOf(view, wallet)` exists → `<YourSeat …/>`.
    - `joinCheck(view, wallet, info.N, now).ok` → primary "Join" (opens `JoinSheet`).
    - otherwise → the `why` text, muted, centered.
  - Haptics: `notificationAsync(Success)` when a join or get-back resolves ok; `Error` when it fails.

- [ ] **Step 2: `JoinSheet({ open, onClose, view, info, lamports, signer })`**:
  - Title "Join $TICKER". Chips (oval, quiet; selected = accent rim + accent-soft bg) for `seatChoices(info.N)` labelled "0.1", "0.25", "0.5" SOL. Default selected: the smallest. A chip whose `joinAmounts` commit would be less than the chip (the room is smaller) still works; under the chips, when `commit < chip`: "Only `solText(commit)` SOL fits; the rest comes back to you after launch."
  - Line: "Same price as everyone, creator included." (small, with a check icon in `C.up`).
  - Line: "Changed your mind? Get it all back with one tap until the pool fills."
  - Cost: on open, `store.getState().joinCost()` → `extra`. Show "Wallet `solText(lamports)` SOL" and, when `deposit + extra > lamports`, in `C.down`: "You need `solText(deposit + extra, 3)` SOL for this (the seat plus about `solText(extra, 4)` SOL in fees and rent). You have `solText(lamports, 3)`." and the button is disabled.
  - Primary button "Join · `solText(deposit)` SOL" → `store.getState().join(view.presale, deposit, signer)`; while busy: `Steps` with `busy.step` above the button and the button `busy`. The first step says "Sign in your wallet to put the SOL in": that's when Seed Vault opens.
  - Ok → close the sheet; the room now shows `YourSeat` (from the live view). Error → the error text in `C.down` inside the sheet; the sheet stays open.

- [ ] **Step 3: `YourSeat({ view, seat, now, signer })`**:
  - "You're in · `solText(seat.commit)` SOL" (h2) — or, when `seat.commit === 0n`, "In your seat · `solText(seat.deposit)` SOL, out of the pool".
  - Creator: a lock line "As the creator, your SOL stays in until launch. If the pool doesn't fill in time, it comes back by itself." No button.
  - Else, when `canGetBack(view, wallet, now)`: quiet button "Get my `solText(seat.deposit)` SOL back" → `store.getState().getBack(view.presale, signer)`, with `Steps` while busy (steps: "Checking your seat", "Taking your SOL out", "Sign in your wallet to take your SOL out", "Bringing it back to Solana", "Sending it to your wallet"). Ok → toast-like line "`solText(seat.deposit)` SOL is back in your wallet" (C.up) for 4 s.
  - Stage launching/live: "Locked in. Your tokens come to your wallet right after launch." When `seat.claimed`: "Your tokens arrived" with a gold check, and a primary "See $TICKER" → `/coin/${key}`.

- [ ] **Step 4: `ChatSheet({ open, onClose, channel, wallet, signer })`**:
  - `Sheet` 80% height. Rows from `useStore(store, s => s.chats[channel])` (fallback empty array outside the selector): `Face` 24, short wallet (gold when it's you), time `hh:mm`, text. Newest at the bottom; inverted FlatList.
  - Input row: TextInput (bg well, rim wellLine, max 280 chars, placeholder "Say something"), Send button (accent circle with an arrow). Not connected → the input is replaced with "Connect to chat" quiet button. On send: `store.getState().sendChat(channel, text, signer)`; the first send of a session triggers one Seed Vault message signature ("Sign once to chat" shown under the input while it waits); clears the input on ok; error text under the input.

- [ ] **Step 5: `LaunchOverlay({ view, launched, seat })`** — the full-screen moment (spec "When it fills"):
  - Watches the stage. When it changes from "presale" to "launching" while the screen is open: a full-screen overlay (bg0 at 96%) with the ring at 100% in `C.up`, "The pool is full" (title), "Launching $TICKER on Meteora…" (body); `Haptics.notificationAsync(Success)` then three `impactAsync(Heavy)` 150 ms apart.
  - When it then reaches "live": "$TICKER is live" and, if the user has a seat, "Your tokens are on the way" → becomes "Your tokens arrived" when `seat.claimed`. A primary "See $TICKER" → `/coin/${key}`, and a quiet "Close".
  - It only plays for a change seen live, never on first load of an already-launched presale.

- [ ] **Step 6: Device check** — install; open a presale from Live (if none is open, report that and check the "missing"/empty paths: `adb shell am start -a android.intent.action.VIEW -d "mooner:///presale/11111111111111111111111111111111"` shows "This presale isn't here"). With an open presale: screenshot the room; open the Join sheet and screenshot it (don't join unless the user says so; joining spends real SOL); open chat and screenshot.

- [ ] **Step 7: Commit**

```bash
git add "mobile/app/presale/[key].js" mobile/src/room
git commit -m "mobile: the presale room (ring, who's in, join sheet, your seat, chat, launch)"
```

---

### Task 11: Launched and the coin screen

**Files:**
- Create: `mobile/app/(tabs)/launched.js`, `mobile/app/coin/[key].js`, `mobile/src/launched/CoinRow.js`

- [ ] **Step 1: `CoinRow({ row, solUsd, onPress })`**: `CoinImage` 40, `$SYMBOL` / name; right: market cap "`usd(marketCapSol(sqrt) * solUsd)`" when `solUsd > 0`, else "`compact(marketCapSol(sqrt))` SOL"; under it the price in SOL per token (`priceFromSqrt`, 3 significant digits, e.g. "0.0000000281 SOL" → use `toPrecision(3)`). `row.pool === null` (pool not known): "Pool loading" muted. A `Pill` "Migrated" in `C.migrated` when `row.pool?.migrated`.

- [ ] **Step 2: `mobile/app/(tabs)/launched.js`**: title "Launched"; `launched` from the store, `list = useMemo(() => launchedList({ launched }), [launched])`; FlatList of CoinRow → `/coin/${row.presale}`. Empty: "Nothing launched yet" / "Coins land here the moment their presale fills."

- [ ] **Step 3: `mobile/app/coin/[key].js`** (piece 2 adds trading and charts; this is the info screen):
  - Back bar; big `CoinImage` 72, name, `$SYMBOL`.
  - Stats grid (2 columns, Cards): Market cap (USD or SOL as above), Price (SOL), Curve "`(quoteReserve / 1e9).toFixed(2)` of 80 SOL" with a `FillBar` (`C.up`; `C.migrated` and "Migrated to DAMM v2" when migrated), Launched "`new Date(row.launch.at)` as d MMM, HH:mm".
  - Mint: short mint + "Copy" (expo-clipboard; haptic + "Copied" for 2 s).
  - Links pills as in the room. Description.
  - If the user has a seat in this presale (`mine[key]`): a Card "You were in with `solText(mine.deposit)` SOL".
  - No row for the key: spinner until the `launched` snapshot is in; after it, "This coin isn't listed" `Empty`.

- [ ] **Step 4: Device check** — install; screenshot Launched (today `/api/launched` may be empty: the empty state). Report the API's answer next to it.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/launched.js" "mobile/app/coin/[key].js" mobile/src/launched
git commit -m "mobile: Launched list and the coin info screen"
```

---

### Task 12: Me

**Files:**
- Create: `mobile/app/(tabs)/me.js`

- [ ] **Step 1: The screen**:
  - Not connected: Logo, "Connect your wallet to see your presales" and the primary "Connect Seed Vault" (same as the connect screen's action).
  - Connected: `Face` 96 centered with a gold ring; short wallet (mono) with "Copy"; SOL balance "`solText(lamports, 3)` SOL" (bigNum) and, when `solUsd > 0`, "≈ `usd(lamports / 1e9 * solUsd)`" (small).
  - "Your presales" (label) then rows from `useMemo(() => myPresales({ wallet, presales, views, mine }), [...])`: each row shows `CoinImage`, `$SYMBOL` (from `presales[k]?.token ?? views[k]?.token ?? launched[k]?.token`), and a status `Pill`: "In · X SOL" (open and in the list's users / seat), "Launched" (`launched[k]`), "SOL back" (`mine[k].back`), "Closed" otherwise; tap → `/presale/${k}` (or `/coin/${k}` when launched). Keys with no token known yet are listed with a muted short key.
  - Empty: "You're not in any presale yet" / "Join one from Live."
  - Bottom: quiet "Disconnect" → `store.getState().signOut()` then `disconnect()` (MWA), then `router.replace("/connect")`.
  - Titles, XP, badges and the leaderboard are piece 6; nothing for them here (no placeholders).

- [ ] **Step 2: Device check** — install; screenshot Me connected (the user's phone wallet shows its real SOL; compare with `curl -s https://app.mooner.family/api/wallet/<wallet>/balance`).

- [ ] **Step 3: Commit**

```bash
git add "mobile/app/(tabs)/me.js"
git commit -m "mobile: Me (wallet, SOL, your presales, disconnect)"
```

---

### Task 13: Mooner pictures on the phone

The web draws pictures with three.js (`web/src/lib/pfp/render/index.ts` `renderPfp(pfp, px)` → PNG Blob). The phone runs that same renderer in a hidden WebView loading a small page from the app server, and caches the PNGs.

**Files:**
- Create: `web/pfp.html`, `web/src/pfp-page.ts`
- Modify: `web/vite.config.js` (`build.rollupOptions.input`)
- Create: `mobile/src/pfp/cache.js`, `mobile/src/pfp/PfpRenderer.js`, `mobile/test/pfpcache.test.mjs`
- Modify: `mobile/src/ui/Face.js`, `mobile/app/_layout.js`

- [ ] **Step 1: The page.** `web/pfp.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mooner pictures</title>
  </head>
  <body style="margin:0;background:#07080b">
    <script type="module" src="/src/pfp-page.ts"></script>
  </body>
</html>
```

`web/src/pfp-page.ts`:

```ts
// Draws Mooner pictures for the phone app, which loads this page in a hidden WebView:
// the app posts { id, wallet, pfp | null, px }, the page answers { id, png } (a data URL)
// or { id, error }. A wallet with no saved picture gets its default (handlePfp).
import { renderPfp } from './lib/pfp/render'
import { handlePfp, sanitizePfp } from './lib/pfp/traits'

type Ask = { id: string; wallet: string; pfp: unknown; px: number }
type RNWindow = Window & { ReactNativeWebView?: { postMessage(s: string): void } }

const reply = (msg: object) => (window as RNWindow).ReactNativeWebView?.postMessage(JSON.stringify(msg))

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

async function draw(ask: Ask) {
  try {
    const pfp = ask.pfp ? sanitizePfp(ask.pfp) : handlePfp(ask.wallet)
    reply({ id: ask.id, png: await toDataUrl(await renderPfp(pfp, ask.px)) })
  } catch (e) {
    reply({ id: ask.id, error: e instanceof Error ? e.message : String(e) })
  }
}

function onMessage(e: MessageEvent) {
  let ask: Ask
  try {
    ask = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
  } catch {
    return
  }
  if (ask?.id && ask.wallet && [128, 256, 512].includes(ask.px)) draw(ask)
}

// react-native-webview delivers postMessage on window and on document, depending on platform
window.addEventListener('message', onMessage)
document.addEventListener('message', onMessage as EventListener)
reply({ ready: true })
```

Check `handlePfp` and `sanitizePfp` are exported from `web/src/lib/pfp/traits.ts` (they are: lines 240 and 276) and that `handlePfp` takes the id the web passes for a wallet: in `web/src/lib/store.ts` `person(id)` calls `handlePfp(id)` with the wallet; use the same.

`web/vite.config.js`: in `config.build` add `rollupOptions: { input: { main: fileURLToPath(new URL("./index.html", import.meta.url)), pfp: fileURLToPath(new URL("./pfp.html", import.meta.url)) } }`.

Run `cd web && npm run build` → exit 0 and `ls web/dist/pfp.html` exists. The server serves it as a file (`engine/server/http.js` `webFile`), at `https://app.mooner.family/pfp.html` after the next app deploy — **the deploy is the user's** (`sh deploy/railway.sh app`). Until then the phone shows the fallback faces.

- [ ] **Step 2: `mobile/src/pfp/cache.js`** (Node-testable): `pfpKey(wallet, pfp, px)` → a short stable name: `"pfp-" + sha256hex(JSON.stringify([wallet, pfp ?? null, px])).slice(0, 24) + ".png"` using `@noble/hashes/sha256` and `bytesToHex` from `@noble/hashes/utils`. A test checks: same input → same name; a changed trait → a different name; key order of `pfp` is normalised (sort keys before stringify).

- [ ] **Step 3: `mobile/src/pfp/PfpRenderer.js`**: a provider mounted once in `_layout.js`:
  - Renders an off-screen `WebView` (`style={{ width: 1, height: 1, position: "absolute", opacity: 0 }}`, `source={{ uri: "https://app.mooner.family/pfp.html" }}`, `javaScriptEnabled`, `onMessage`).
  - Keeps a queue; `request(wallet, pfp, px)` returns a Promise of a `file://` URI: if `FileSystem.cacheDirectory + pfpKey(...)` exists, resolve it at once; else post `{ id, wallet, pfp, px }` once the page said `{ ready: true }`, write the returned data URL's base64 to that file (`FileSystem.writeAsStringAsync(path, b64, { encoding: "base64" })`), resolve the path. Errors and a page that never says ready (load error, 404 before the deploy) reject; requests then stay on the fallback without retrying in a loop (one try per app run per key).
  - Exposes `usePfp(wallet, size)` → uri | null: reads `profiles[wallet]` from the store, picks px 128 for size ≤ 64, 256 above; requests once per (wallet, pfp, px).

- [ ] **Step 4: `Face`** uses `usePfp(wallet, size)`: the image when it's there, else the fallback circle from Task 7.

- [ ] **Step 5: Device check** — before the deploy, faces show the fallback (screenshot). After the user deploys, reopen and screenshot real faces. If WebGL fails in the WebView, the page answers `{ error }`; report the message from `adb logcat -s ReactNativeJS`.

- [ ] **Step 6: Commit**

```bash
git add web/pfp.html web/src/pfp-page.ts web/vite.config.js mobile/src/pfp mobile/test/pfpcache.test.mjs mobile/src/ui/Face.js mobile/app/_layout.js
git commit -m "Mooner pictures on the phone: the web renderer in a hidden WebView, cached PNGs"
```

---

### Task 14: Device pass and the real join

- [ ] **Step 1:** `cd engine && npm test`, `cd mobile && npm test`, `cd web && npm run build`, `cd mobile && sh scripts/check-bundle.sh` — all green; report counts.
- [ ] **Step 2:** Release build on the Seeker; screenshots of: connect, Live, a room, the join sheet, chat, Launched, a coin, Me. Send them to the user.
- [ ] **Step 3 (needs the user):** with an open mainnet presale and a little over 0.1 SOL in the phone wallet, the user joins with 0.1 SOL from the phone. Check on chain: the join's `meta.fee` ≤ 90,300 lamports (`getTransaction` on the signature from the server's cosign reply, logged with `adb logcat -s ReactNativeJS`), the seat shows in `curl -s https://app.mooner.family/api/presale/<key>`, and the web shows the same seat. Then "Get my 0.1 SOL back" from the phone: the ER txs Seed Vault signed are accepted (first real proof), the SOL lands in the wallet.
- [ ] **Step 4:** Final whole-piece code review (superpowers:code-reviewer) over the piece's commits; fix Critical and Important findings; commit fixes.
- [ ] **Step 5:** Update the spec's piece table status line for piece 1 (built, date, what was proven on the device) and commit.

---

## Self-review notes

- Spec coverage (piece 1): sign-in → Task 8 (Seed Vault; X/email needs Privy client, flagged); Live → Task 9 (Auto-join deferred to piece 5, it needs push; flagged in the task); room: join, who's in, chat, get back, creator lock, launch sequence, tokens arrived → Task 10; Launched → Task 11 (chart and trading are piece 2); Me → Task 12 (XP, titles, leaderboard are piece 6); faces → Tasks 7 and 13; shared code → Tasks 1-3; secure storage → Tasks 5 and 8; live data, reconnect banner → Tasks 1 and 8.
- The pay-with-SKR choice in the join sheet is piece 7; chips 0.1/0.25/0.5 follow MAX_SEAT 0.5 SOL (the spec's "1" chip is above today's MAX_SEAT, so `seatChoices` drops it).
- Names used across tasks: `makeLive().{subscribe,onStatus,restart}`, `signIn({api,wallet,signMessage,now})`, views.js exports, `createMoonerStore` actions `start, watch, setWallet, signIn, signOut, join, getBack, joinCost, sendChat`, selectors `liveList, launchedList, myPresales`, `mwaSigner`, `secureKeys`, `secureJson`, `safeName`, `solText, compact, usd, shortWallet`.
