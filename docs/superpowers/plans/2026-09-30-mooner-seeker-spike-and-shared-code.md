# Mooner on Seeker: device spike and shared code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find out on the user's Seeker what Seed Vault does to Mooner's transactions (spec piece 0). Also move the code the web app and the phone app both need into `engine/src`, so each piece of it exists once.

**Architecture:**
- **Shared engine modules.** Five new or changed modules in `engine/src`, with no `node:` imports, tested under `node --test`:
  - the sign-in text;
  - the API client;
  - the wallet checks;
  - a golden self-test tx;
  - the chain flows.
  
  Task 10 also changes two existing ones: `consts.js` and `tx.js` name a failure only by the program that raised it.
- **The phone app.** A new Expo app in `mobile/` bundles `engine/src` as is through Metro.
  - Metro watches `../engine`. A resolver sends every bare import from an engine file to the app's own `node_modules`, so the bundle has exactly one `@solana/web3.js`.
  - For now its only screen is the spike: a set of buttons, each asking Seed Vault one question and logging the answer.
- **The web app.** `real/api.js` and `real/chain.js` become thin adapters over the shared modules.

**Tech Stack:**
- Engine: Node 22 `node:test`, `@solana/web3.js` 1.99.0, `@noble/curves` 1.9.7, `@noble/hashes` 1.8.0.
- Phone: Expo SDK 55 (expo ~55.0.23, react-native 0.83.10, React 19.2.0), `@wallet-ui/react-native-web3js` 4.3.0 (Mobile Wallet Adapter), `react-native-get-random-values`, `buffer`.
- Web: Vite.
- Android: SDK 36, NDK 27.1.12297006, JDK 17, adb.

**Spec:** `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md`. See the sections "Pieces", "The app", "Seed Vault questions" and "Testing".

**Not in this plan:**
- piece 1's screens;
- expo-router and zustand;
- session keys in `expo-secure-store`;
- Privy;
- the MWA auth-token cache.

Their plan is written after Task 9, because Seed Vault's answers decide how entry txs are sent.

---

## Ground rules

- **Commits.** Commit only when the user says to. Every "Commit" step below waits for that.
  - Several files this plan touches are still untracked and carry earlier uncommitted work: `engine/src/client.js`, `web/src/real/*.js` and `web/src/lib/store.ts`.
  - `git add` on them commits that earlier work too. The user decides.
  - Never commit keys or `.env` files.
- **Dev servers.** Never start a dev server with Bash; use the preview tools.
- **The local engine server.** Never run it: the Railway keeper is live on mainnet.
- **Seed Vault approvals.** The user approves every Seed Vault prompt on the phone.
- **Spending.** The only spends in this plan are Task 8's Send memo txs. Each costs the fee `checks.js` expects: 10,000 lamports (0.00001 SOL). The user approves each one on the phone.
  - Send memo sends at most one memo per network per app process.
  - A declined memo can still land until its blockhash expires. A retap after a decline that doesn't find it sends a new memo, so a decline and a retap can mean two memos.
- **Licenses.** If a tool asks to accept a license, the user accepts it; don't answer the prompt yourself.
- **npm audit in `mobile/`.** Don't run `npm audit fix --force` there.
  - `npm audit` reports moderate advisories in build-only tooling: `stream-json`, and `uuid` under `xcode`.
  - `--force` would move Expo's pinned versions.
- **zsh quirk.** Here `echo =====` fails ("==== not found"), so quote any such string.

## What was checked before this plan was written (2026-09-30)

Every code block below was run in a scratch copy of the repo.

**Engine tests**
- On the current repo, each new test file fails exactly as the "run it to see it fail" steps say.
- Once every task was done, `npm test` in `engine/` printed `# pass 233`, `# fail 0`.
- The totals in Tasks 2–5 (66, 71, 103, 109) are a base of 65 plus each task's test file (1, 5, 32 and 6 tests, which still hold). The base can't be re-checked: no git commit holds the engine as it was before this plan (none has `engine/src/client.js`, which Task 2 modifies), and the test files this plan doesn't create now hold 107 tests.
- The golden digests printed by the command in Task 5 are `f6baff21…5aed55` (join) and `003c526d…ea4254` (ER).

**Web build**
- Once Task 11 was done, `npm run build` in `web/` exited 0, with the new `api.js` and `chain.js` and the cost checks.
- The new files keep every export `store.ts` and `main.tsx` use.

**Phone bundle**
- `expo export` produces a bundle with one `@solana/web3.js` and no file from `engine/node_modules`.
- With the resolver switched off, the bundle has two copies and 95 engine files, and `check-bundle.sh` exits 1.

**Expo and Android project**
- `expo install --check` reports "Dependencies are up to date" once react-native is 0.83.10.
  - With react-native 0.83.6 it asks for 0.83.10.
- `expo prebuild` generates an Android project whose release build type signs with the debug keystore, so it installs over adb.
- Autolinking finds the MWA native module (`@solana-mobile/mobile-wallet-adapter-protocol`), `@react-native-async-storage/async-storage` and `react-native-get-random-values`.

**Toolchain on this Mac**
- Installed: JDK 17.0.20, build-tools 36.0.0, platforms;android-36, and adb from Homebrew's `android-platform-tools`.
- The SDK root is `/opt/homebrew/share/android-commandlinetools`.
- The NDK is **not** installed.

**Not checked yet** (these need the NDK and the phone):
- the Gradle build;
- the install;
- every Seed Vault answer.

## One change from the spec

The spec calls piece 0 "a bare dev build". This plan builds the **release variant** instead.
- The JS is inside the APK, so no Metro server has to run on the Mac while the phone is in use.
- It signs with the debug keystore, so it installs over adb just like a dev build.

## Files

**Engine** (the `engine/src` files are shared: no `node:` imports, so Metro and Vite bundle them as is)

| File | Change | What it does |
|---|---|---|
| `engine/src/client.js` | modify | gains `loginMessage(wallet, time)`, the sign-in text |
| `engine/server/social.js` | modify | re-exports `loginMessage` from `client.js` instead of defining it |
| `engine/src/apiclient.js` | new | `makeApi(base, fetchFn)`: every `/api/*` call; errors carry the server's message |
| `engine/src/walletcheck.js` | new | reports three things about a signed tx: what the wallet changed, whether its signature covers the tx it returned, and which bytes of a `signMessages` reply are the signature |
| `engine/src/selftest.js` | new | a fixed join tx and its sha256, so the phone can prove it builds bytes exactly as Node does |
| `engine/src/flows.js` | new | `makeFlows({ api, subscribe, keys, priority, rpc })`: request mint, open, join, set commit and get back. Also `joinCost` and `openCost`: what an entry tx takes from the wallet besides the SOL it puts in |
| `engine/src/consts.js` | modify | adds `failedWith(logs)`; `describeTxError` takes the logs and calls a code Mooner's only when Mooner raised it |
| `engine/src/tx.js` | modify | exports `txLogs`; `sendSigned` and `simulate` pass the logs to `describeTxError` |
| `engine/server/api.js` | modify | the cosign route passes the simulation's logs to `describeTxError` |
| `engine/package.json`, `engine/package-lock.json` | modify | adds `@noble/curves` and `@noble/hashes` as direct deps (already installed as web3.js deps) |
| `engine/test/{client,apiclient,walletcheck,selftest,flows}.test.js` | new | tests |

**Phone** (`mobile/`, all new)

| File | What it does |
|---|---|
| `package.json`, `package-lock.json`, `app.json` | the Expo app `family.mooner.app` |
| `index.js`, `polyfill.js` | polyfills first (`getRandomValues`, `Buffer`), then the app |
| `metro.config.js` | bundles `../engine` with one copy of each package |
| `scripts/run-android.sh` | release build, then install over USB |
| `scripts/check-bundle.sh` | fails unless the bundle has exactly one web3.js and nothing from `engine/node_modules` |
| `src/checks.js` | one function per Seed Vault question |
| `src/runner.js` | runs the checks one at a time and gives up on one that runs past `TIMEOUT_MS` |
| `src/SpikeScreen.js` | the buttons and the log |
| `assets/icon.png` | a copy of `site/assets/icon-512.png` |
| `.gitignore` | build output, native folders, signing keys, env files |

**Web** (modify)

| File | Change |
|---|---|
| `web/src/real/api.js` | becomes `makeApi("")` |
| `web/src/real/chain.js` | becomes `makeFlows(...)`, with session keys in `localStorage` |
| `web/src/lib/store.ts` | uses `chain.loginMessage`; `findMatch` and `createLaunch` check the whole cost before the wallet signs |
| `web/src/lib/launch.ts` | adds `notEnoughSol`; `validateLaunch` counts the open cost |
| `web/src/components/launch/LaunchScreen.tsx` | reads `openCost()` for the commit check |
| `web/src/components/presale/CommitPanel.tsx` | reads `joinCost()`; a wallet that's short can't join |
| `web/src/components/shell/FindMatchDialog.tsx` | reads `joinCost()`; a wallet that's short can't join |

**Spec** (modify): Task 9 writes Seed Vault's answers into the "Seed Vault questions" section.

**Order:**
- Tasks 1–9 are the spike.
  - Task 1 (tools) and Tasks 2–5 (engine) don't depend on each other.
  - Tasks 6–7 need Tasks 2–5.
  - Task 8 needs Tasks 1, 6 and 7, plus the phone.
- Tasks 10–11 (the shared flows and the web adapters) don't depend on the spike's answers. They can run any time after Task 4.

---

## Task 1: Android build tools

**Files:** none in the repo.

- [ ] **Step 1: Install the NDK and CMake**

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17 sdkmanager "ndk;27.1.12297006" "cmake;3.22.1"
```

`sdkmanager` needs `JAVA_HOME`. Without it, it prints "Unable to locate a Java Runtime". If it shows a license and waits for `y`, stop and ask the user to accept it.

Why these versions: react-native 0.83.10's `node_modules/react-native/gradle/libs.versions.toml` sets:
- `compileSdk = "36"`
- `buildTools = "36.0.0"`
- `minSdk = "24"`
- `ndkVersion = "27.1.12297006"`

CMake 3.22.1 is the Android Gradle Plugin's default.

- [ ] **Step 2: Confirm they're installed**

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17 sdkmanager --list_installed | grep -E "ndk|cmake|build-tools;36|platforms;android-36"
```

Expected: four rows, `build-tools;36.0.0`, `cmake;3.22.1`, `ndk;27.1.12297006` and `platforms;android-36`.

- [ ] **Step 3: The phone (needed from Task 8 on)**

The user:
1. turns on Developer options and USB debugging on the Seeker;
2. plugs it in over USB;
3. accepts the "Allow USB debugging?" prompt on the phone.

Then:

```bash
adb devices
```

Expected: one line that ends in `device`. `unauthorized` means the prompt on the phone hasn't been accepted yet. Tasks 2–7 don't need the phone.

---

## Task 2: The sign-in text moves to `engine/src/client.js`

The server checks this text, the web signs it, and now the phone signs it too. It stays in one place.

**Files:**
- Modify: `engine/src/client.js` (insert after `mintMessageText`, before `/** A seat size the program takes`)
- Modify: `engine/server/social.js` (the imports, and lines 42–43)
- Test: `engine/test/client.test.js`

- [ ] **Step 1: Write the failing test**

Create `engine/test/client.test.js`:

```js
// What a wallet client signs: the texts the server checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/client.js";
import * as social from "../server/social.js";

test("the sign-in text is the one the server checks", () => {
  assert.equal(C.loginMessage("W1", 1700000000), "Mooner: sign in\nwallet: W1\ntime: 1700000000");
  assert.equal(social.loginMessage, C.loginMessage);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd engine && node --test test/client.test.js`
Expected: FAIL with `error: 'C.loginMessage is not a function'` (TypeError).

- [ ] **Step 3: Move `loginMessage`**

In `engine/src/client.js`, insert this directly above the line `/** A seat size the program takes (util.rs valid_seat). Amounts are BigInt lamports. */`:

```js
/** The exact text a wallet signs to sign in (server/social.js checks it). */
export const loginMessage = (wallet, time) => ["Mooner: sign in", `wallet: ${wallet}`, `time: ${time}`].join("\n");

```

In `engine/server/social.js`, add this import after `import { parseKey } from "./api.js";`:

```js
import { loginMessage } from "../src/client.js";
```

Then replace these two lines:

```js
/** The exact text a wallet signs to sign in. */
export const loginMessage = (wallet, time) => ["Mooner: sign in", `wallet: ${wallet}`, `time: ${time}`].join("\n");
```

with:

```js
export { loginMessage };
```

(`social.js` line 108 keeps calling `loginMessage(...)`, which is now the imported one.)

- [ ] **Step 4: Run the tests**

Run: `cd engine && node --test test/client.test.js`
Expected: PASS (`# pass 1`).

Run: `cd engine && npm test`
Expected: `# pass 66`, `# fail 0`.

- [ ] **Step 5: Commit (only after the user says to commit)**

```bash
git add engine/src/client.js engine/server/social.js engine/test/client.test.js
git commit -m "engine: the sign-in text lives in client.js, for web, phone and server"
```

---

## Task 3: The API client moves to `engine/src/apiclient.js`

This is `web/src/real/api.js` with a base URL and an injectable fetch.
- The web passes `""`, so calls go to its own origin.
- The phone passes `https://app.mooner.family`.

**Files:**
- Create: `engine/src/apiclient.js`
- Test: `engine/test/apiclient.test.js`

- [ ] **Step 1: Write the failing test**

Create `engine/test/apiclient.test.js`:

```js
// The API client the web app and the phone app share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, makeApi } from "../src/apiclient.js";

/** A fetch that answers from `replies` ([status, body] each; a string body isn't JSON)
 *  and keeps every call. */
function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const [status, body] = replies.shift();
    return { ok: status >= 200 && status < 300, status, json: async () => (typeof body === "string" ? JSON.parse(body) : body) };
  };
  fn.calls = calls;
  return fn;
}

test("calls go to base + path, with a JSON body", async () => {
  const f = fakeFetch([[200, { token: "t", exp: 9 }]]);
  const api = makeApi("https://app.mooner.family", f);
  assert.deepEqual(await api.login({ wallet: "w", time: 1, signature: "s" }), { token: "t", exp: 9 });
  assert.equal(f.calls[0].url, "https://app.mooner.family/api/login");
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { wallet: "w", time: 1, signature: "s" });
});

test("same origin by default; a GET carries no body", async () => {
  const f = fakeFetch([[200, { presales: [1] }]]);
  assert.deepEqual(await makeApi("", f).presales(), [1]);
  assert.equal(f.calls[0].url, "/api/presales");
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.body, undefined);
});

test("a refusal throws the server's message; a non-JSON error says the status", async () => {
  const f = fakeFetch([[400, { error: "time is off" }], [502, "<html>bad gateway</html>"]]);
  const api = makeApi("", f);
  await assert.rejects(api.login({}), (e) => e instanceof ApiError && e.status === 400 && e.message === "time is off" && e.body.error === "time is off");
  await assert.rejects(api.info(), (e) => e instanceof ApiError && e.status === 502 && e.message === "the server said 502" && e.body === null);
});

test("a 200 that isn't JSON (a proxy's HTML page) throws instead of handing back null", async () => {
  const f = fakeFetch([[200, "<html>hello</html>"]]);
  await assert.rejects(makeApi("", f).presales(), (e) => e instanceof ApiError && e.status === 200 && e.message === "the server's reply wasn't JSON" && e.body === null);
});

test("cosign returns status and body, balance is a number, chat pages with after", async () => {
  const f = fakeFetch([[200, { sig: "x", confirmed: false }], [200, { lamports: "1500" }], [200, { messages: [] }]]);
  const api = makeApi("", f);
  assert.deepEqual(await api.cosign("AAAA"), { status: 200, json: { sig: "x", confirmed: false } });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { tx: "AAAA" });
  assert.equal(await api.balance("w"), 1500);
  assert.deepEqual(await api.chat("global", 7), []);
  assert.equal(f.calls[2].url, "/api/chat/global?after=7");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd engine && node --test test/apiclient.test.js`
Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../engine/src/apiclient.js'`.

- [ ] **Step 3: Write `engine/src/apiclient.js`**

```js
// The Mooner server's API. Errors carry the server's own message. The web app calls its
// own origin (base ""); the phone app calls https://app.mooner.family. No node: imports.

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** The API at `base`. `fetchFn` is for tests; it defaults to the global fetch at call time. */
export function makeApi(base = "", fetchFn = (url, init) => fetch(url, init)) {
  async function call(method, path, body) {
    const r = await fetchFn(base + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body && JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, json?.error ?? `the server said ${r.status}`, json);
    if (json === null) throw new ApiError(r.status, "the server's reply wasn't JSON", null);
    return { status: r.status, json };
  }

  return {
    info: async () => (await call("GET", "/api/info")).json,
    presales: async () => (await call("GET", "/api/presales")).json.presales,
    presale: async (key) => (await call("GET", `/api/presale/${key}`)).json,
    walletTokens: async (wallet) => (await call("GET", `/api/wallet/${wallet}/tokens`)).json.tokens,
    blockhash: async () => (await call("GET", "/api/blockhash")).json,
    mint: async (body) => (await call("POST", "/api/mint", body)).json,
    /** { status, json: { sig, confirmed, kind, user, presale, mint? } } */
    cosign: (tx) => call("POST", "/api/cosign", { tx }),
    launched: async () => (await call("GET", "/api/launched")).json.launched,
    balance: async (wallet) => Number((await call("GET", `/api/wallet/${wallet}/balance`)).json.lamports),
    login: async (body) => (await call("POST", "/api/login", body)).json,
    chat: async (channel, after = 0) => (await call("GET", `/api/chat/${channel}${after ? `?after=${after}` : ""}`)).json.messages,
    sendChat: async (token, channel, text) => (await call("POST", "/api/chat", { token, channel, text })).json,
    profiles: async () => (await call("GET", "/api/profiles")).json.profiles,
    saveProfile: async (token, pfp) => (await call("POST", "/api/profile", { token, pfp })).json,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd engine && node --test test/apiclient.test.js`
Expected: PASS (`# pass 5`).

Run: `cd engine && npm test`
Expected: `# pass 71`, `# fail 0`.

- [ ] **Step 5: Commit (only after the user says to commit)**

```bash
git add engine/src/apiclient.js engine/test/apiclient.test.js
git commit -m "engine: the API client, shared by web and phone"
```

---

## Task 4: Wallet checks (`engine/src/walletcheck.js`)

This module answers three questions about a tx Seed Vault signed:
- What did the wallet change? Seed Vault raises a compute-unit price below 100,000 µLamports, and wallets may add Lighthouse instructions.
- Does the wallet's signature cover the tx it handed back?
- Which bytes of a `signMessages` reply are the signature? The MWA spec leaves the layout open.

**Files:**
- Modify: `engine/package.json`, `engine/package-lock.json`
- Create: `engine/src/walletcheck.js`
- Test: `engine/test/walletcheck.test.js`

- [ ] **Step 1: Make the noble packages direct deps**

They're already installed in `engine/node_modules` as dependencies of web3.js, at exactly these versions. Listing them makes the imports in `walletcheck.js`, `selftest.js` and `flows.js` explicit.

```bash
cd engine && npm install --save-exact @noble/curves@1.9.7 @noble/hashes@1.8.0
```

Expected: `engine/package.json` `dependencies` now has `"@noble/curves": "1.9.7"` and `"@noble/hashes": "1.8.0"`. Check with `grep noble engine/package.json`.

- [ ] **Step 2: Write the failing test**

Create `engine/test/walletcheck.test.js`:

```js
// What a wallet did to a tx it signed, and which bytes of a signMessages reply are the
// signature. The phone runs these checks on what Seed Vault hands back.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Keypair, Message, MessageV0, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { signMessage } from "../server/auth.js";
import { unsignedTx } from "../src/client.js";
import { COMPUTE_BUDGET, LIGHTHOUSE, MEMO } from "../src/consts.js";
import { budget, changes, pickSignature, walletSigned } from "../src/walletcheck.js";

const BH = "11111111111111111111111111111111";
const wallet = Keypair.generate();
const memo = (text) => new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(text) });
const price = (microLamports) => ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
const limit = (units) => ComputeBudgetProgram.setComputeUnitLimit({ units });
const v0 = (ixs, { payer = wallet.publicKey, blockhash = BH } = {}) => unsignedTx({ ixs, payer, blockhash });
const legacy = (...ixs) => new Transaction({ feePayer: wallet.publicKey, recentBlockhash: BH }).add(...ixs);

test("budget reads the compute-unit price and limit, v0 and legacy", () => {
  assert.deepEqual(budget(v0([limit(300_000), price(50_000), memo("x")])), { price: 50_000n, limit: 300_000 });
  assert.deepEqual(budget(v0([memo("x")])), { price: null, limit: null });
  assert.deepEqual(budget(legacy(price(100_000), memo("x"))), { price: 100_000n, limit: null });
});

test("a tx the wallet only signed has no changes", () => {
  const after = v0([price(50_000), memo("hi")]);
  after.sign([wallet]);
  assert.deepEqual(changes(v0([price(50_000), memo("hi")]), after), []);
});

test("a legacy tx the wallet only signed has no changes", () => {
  const signed = legacy(price(50_000), memo("er"));
  signed.sign(wallet);
  assert.deepEqual(changes(legacy(price(50_000), memo("er")), Transaction.from(signed.serialize())), []);
});

test("reordered instructions are named", () => {
  assert.deepEqual(changes(v0([memo("a"), memo("b")]), v0([memo("b"), memo("a")])), ["instructions reordered"]);
  // web3.js lists each header group of a v0 tx in the order its instructions first use them, so two accounts move too
  assert.deepEqual(changes(v0([price(50_000), memo("a")]), v0([memo("a"), price(50_000)])), [
    "instructions reordered",
    "account order changed (the new v0 tx lists them as web3.js compiles v0: the fee payer, then signers before others and writable before read-only, each group in the order the instructions first use them)",
  ]);
  assert.deepEqual(changes(legacy(memo("a"), memo("b")), legacy(memo("b"), memo("a"))), ["instructions reordered"]);
});

test("an account made writable or a signer is named, v0 and legacy", () => {
  const k = Keypair.generate().publicKey;
  const ix = (isWritable, isSigner = false) => new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: k, isSigner, isWritable }], data: Buffer.from("k") });
  assert.deepEqual(changes(v0([ix(false)]), v0([ix(true)])), [`account ${k} made writable`]);
  assert.deepEqual(changes(v0([ix(false)]), v0([ix(false, true)])), [`account ${k} made a signer`]); // 1 -> 2 required signatures
  assert.deepEqual(changes(legacy(ix(false)), legacy(ix(true))), [`account ${k} made writable`]);
  assert.deepEqual(changes(legacy(ix(false)), legacy(ix(false, true))), [`account ${k} made a signer`]);
  assert.deepEqual(changes(v0([ix(true, true)]), v0([ix(false)])), [`account ${k} no longer a signer`, `account ${k} made read-only`]);
});

test("a flag change is named next to other changes, not hidden by them", () => {
  const k = Keypair.generate().publicKey;
  const ix = (isWritable, isSigner = false) => new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: k, isSigner, isWritable }], data: Buffer.from("k") });
  assert.deepEqual(changes(v0([price(50_000), ix(false)]), v0([price(100_000), ix(true)])), ["compute-unit price 50000 -> 100000", `account ${k} made writable`]);
  assert.deepEqual(changes(legacy(price(50_000), ix(false)), legacy(price(100_000), ix(false, true))), ["compute-unit price 50000 -> 100000", `account ${k} made a signer`]);
  // Lighthouse write-locks an account the tx already read
  const lh = new TransactionInstruction({ programId: LIGHTHOUSE, keys: [{ pubkey: k, isSigner: false, isWritable: true }], data: Buffer.from([1, 2, 3]) });
  assert.deepEqual(changes(v0([price(50_000), ix(false)]), v0([price(50_000), ix(false), lh])), [`added an instruction for ${LIGHTHOUSE.toBase58()}`, `account ${k} made writable`]);
});

// the same v0 tx with its static accounts listed as `edit` returns them (rows in header order:
// writable signers, readonly signers, writable, readonly); instructions point at the same keys,
// and at the same table slots after them
const relist = (tx, edit) => {
  const m = tx.message;
  const [rows, n0] = [edit(m.staticAccountKeys.map((key, n) => ({ key, signer: m.isAccountSigner(n), writable: m.isAccountWritable(n) }))), m.staticAccountKeys.length];
  const at = (n) => (n < n0 ? rows.findIndex((r) => r.key.equals(m.staticAccountKeys[n])) : n - n0 + rows.length);
  const count = (signer, writable) => rows.filter((r) => r.signer === signer && r.writable === writable).length;
  return new VersionedTransaction(new MessageV0({
    header: { numRequiredSignatures: count(true, true) + count(true, false), numReadonlySignedAccounts: count(true, false), numReadonlyUnsignedAccounts: count(false, false) },
    staticAccountKeys: rows.map((r) => r.key),
    recentBlockhash: m.recentBlockhash,
    compiledInstructions: m.compiledInstructions.map((ci) => ({ ...ci, programIdIndex: at(ci.programIdIndex), accountKeyIndexes: ci.accountKeyIndexes.map(at) })),
    addressTableLookups: m.addressTableLookups,
  }));
};

test("an account no instruction uses is named when added, and account order alone is caught", () => {
  const k = Keypair.generate().publicKey;
  const withSigner = relist(v0([price(100_000), memo("hi")]), (rows) => [rows[0], { key: k, signer: true, writable: true }, ...rows.slice(1)]);
  assert.deepEqual(changes(v0([price(50_000), memo("hi")]), withSigner), ["compute-unit price 50000 -> 100000", `account ${k} added (signer, writable), no instruction uses it`]);
  assert.deepEqual(changes(withSigner, v0([price(100_000), memo("hi")])), [`account ${k} removed (signer, writable), no instruction used it`]);
  const [k1, k2] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  const two = v0([new TransactionInstruction({ programId: MEMO, keys: [k1, k2].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })), data: Buffer.from("k") })]);
  const swapped = relist(two, (rows) => [...rows.slice(0, -2), ...rows.slice(-2).reverse()]);
  assert.notDeepEqual(swapped.message.staticAccountKeys, two.message.staticAccountKeys);
  assert.deepEqual(changes(two, swapped), ["account order changed"]); // k2 before k1, not the order the instruction uses them
});

// a legacy tx as a wallet hands it back: the message with its accounts listed as `edit` returns
// them (each kept in its header group), as wire bytes parsed with Transaction.from, which is
// what MWA's web3.js wrapper returns for a legacy tx
const relistLegacy = (tx, edit) => {
  const m = tx.compileMessage();
  const rows = edit(m.accountKeys.map((key, n) => ({ key, signer: m.isAccountSigner(n), writable: m.isAccountWritable(n) })));
  const at = (n) => rows.findIndex((r) => r.key.equals(m.accountKeys[n]));
  const moved = new Message({ header: m.header, accountKeys: rows.map((r) => r.key), recentBlockhash: m.recentBlockhash, instructions: m.instructions.map((c) => ({ ...c, programIdIndex: at(c.programIdIndex), accounts: c.accounts.map(at) })) });
  return Transaction.from(Buffer.concat([Buffer.from([m.header.numRequiredSignatures]), Buffer.alloc(64 * m.header.numRequiredSignatures), moved.serialize()]));
};
// each header group sorted by code point, payer first, as an engine without ICU collation lists it
const group = (r) => (r.signer ? 0 : 2) + (r.writable ? 0 : 1);
const byCodePoint = (rows) => [rows[0], ...rows.slice(1).sort((x, y) => group(x) - group(y) || (x.key.toBase58() < y.key.toBase58() ? -1 : 1))];

test("a legacy tx whose accounts came back in another order is named, read from its wire bytes", () => {
  // the golden ER tx's two keys: localeCompare and a code-point compare sort them differently
  const ro = (n) => ({ pubkey: new PublicKey(new Uint8Array(32).fill(n)), isSigner: false, isWritable: false });
  const er = new TransactionInstruction({ programId: MEMO, keys: [ro(9), ro(167)], data: Buffer.from("er") });
  const [before, withPrice] = [legacy(er), legacy(price(100), er)];
  assert.deepEqual(changes(before, withPrice), ["compute-unit price none -> 100"]); // web3.js's own order moves nothing
  assert.deepEqual(changes(before, relistLegacy(before, byCodePoint)), ["account order changed"]);
  assert.deepEqual(changes(before, relistLegacy(withPrice, byCodePoint)), ["compute-unit price none -> 100", "account order changed"]);
  // listed in the order the instruction uses them, a legacy tx still gets the plain line (web3.js sorts legacy by key)
  const use = [wallet.publicKey, MEMO, ro(9).pubkey, ro(167).pubkey].map(String);
  const byUse = (rows) => [...rows].sort((x, y) => use.indexOf(x.key.toBase58()) - use.indexOf(y.key.toBase58()));
  assert.deepEqual(changes(before, relistLegacy(before, byUse)), ["account order changed"]);
});

test("a legacy message read back as a VersionedTransaction (the phone's landed-tx check) is still legacy", () => {
  const lg = legacy(price(50_000), memo("x"));
  const landed = new VersionedTransaction(Message.from(lg.serializeMessage()));
  assert.deepEqual(changes(lg, landed), []);
  assert.deepEqual(changes(v0([price(50_000), memo("x")]), landed), ["tx version changed"]);
});

test("the largest limit and price are read in full (u32 and u64, little-endian)", () => {
  const max = v0([limit(0xffffffff), price(2n ** 64n - 1n), memo("x")]);
  assert.deepEqual(budget(max), { price: 18446744073709551615n, limit: 4294967295 });
  assert.deepEqual(changes(v0([limit(200_000), price(50_000), memo("x")]), max), ["compute-unit price 50000 -> 18446744073709551615", "compute-unit limit 200000 -> 4294967295"]);
});

test("a raised price and an added Lighthouse instruction are both named", () => {
  const lh = new TransactionInstruction({ programId: LIGHTHOUSE, keys: [{ pubkey: wallet.publicKey, isSigner: false, isWritable: false }], data: Buffer.from([1, 2, 3]) });
  assert.deepEqual(changes(v0([price(50_000), memo("hi")]), v0([price(100_000), memo("hi"), lh])), [
    "compute-unit price 50000 -> 100000",
    `added an instruction for ${LIGHTHOUSE.toBase58()}`,
  ]);
});

test("a second price or limit instruction is named with both values, prepended or appended (Solana refuses the tx)", () => {
  const before = v0([limit(200_000), price(50_000), memo("hi")]);
  assert.deepEqual(changes(before, v0([price(100_000), limit(200_000), price(50_000), memo("hi")])), [
    "2 compute-unit price instructions: 100000, 50000 (Solana refuses it: DuplicateInstruction)",
  ]);
  assert.deepEqual(changes(before, v0([limit(200_000), price(50_000), memo("hi"), price(100_000)])), [
    "2 compute-unit price instructions: 50000, 100000 (Solana refuses it: DuplicateInstruction)",
  ]);
  assert.deepEqual(changes(before, v0([limit(200_000), price(50_000), limit(300_000), memo("hi")])), [
    "2 compute-unit limit instructions: 200000, 300000 (Solana refuses it: DuplicateInstruction)",
  ]);
});

test("a second heap frame or loaded-accounts size instruction is named too (Solana refuses those as well)", () => {
  const heap = (bytes) => ComputeBudgetProgram.requestHeapFrame({ bytes });
  const loaded = (bytes) => {
    const data = Buffer.from([4, 0, 0, 0, 0]); // SetLoadedAccountsDataSizeLimit(u32)
    data.writeUInt32LE(bytes, 1);
    return new TransactionInstruction({ programId: COMPUTE_BUDGET, keys: [], data });
  };
  const cb = COMPUTE_BUDGET.toBase58();
  assert.deepEqual(changes(v0([heap(32 * 1024), memo("hi")]), v0([heap(32 * 1024), heap(64 * 1024), memo("hi")])), [
    "2 heap frame instructions: 32768, 65536 (Solana refuses it: DuplicateInstruction)",
    `added an instruction for ${cb}`,
  ]);
  assert.deepEqual(changes(v0([loaded(65_536), memo("hi")]), v0([loaded(65_536), memo("hi"), loaded(131_072)])), [
    "2 loaded-accounts data size limit instructions: 65536, 131072 (Solana refuses it: DuplicateInstruction)",
    `added an instruction for ${cb}`,
  ]);
});

test("only a plain price or limit instruction lines up by kind; any other ComputeBudget one is named", () => {
  const cb = COMPUTE_BUDGET.toBase58();
  const odd = (data, keys = []) => new TransactionInstruction({ programId: COMPUTE_BUDGET, keys, data: Buffer.from(data) });
  const before = v0([price(50_000), memo("hi")]);
  // too short to hold a price: Solana refuses it as invalid data, not as a second price
  assert.deepEqual(changes(before, v0([price(50_000), memo("hi"), odd([3, 1, 2, 3])])), [
    "ComputeBudget instruction Solana can't use, data 03010203 (Solana refuses it: InvalidInstructionData)",
    `added an instruction for ${cb}`,
  ]);
  // Solana reads a price with an account, or with a byte past it, but it isn't the plain one we build
  const k = { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false };
  assert.deepEqual(changes(before, v0([odd(price(100_000).data, [k]), memo("hi")])), ["compute-unit price 50000 -> 100000", `added an instruction for ${cb}`]);
  assert.deepEqual(changes(before, v0([odd([...price(100_000).data, 0]), memo("hi")])), ["compute-unit price 50000 -> 100000", `added an instruction for ${cb}`]);
});

test("tag 0 (the retired RequestUnits), an unknown tag or no data: Solana refuses the tx at the first one it can't use", () => {
  const cb = COMPUTE_BUDGET.toBase58();
  const odd = (data) => new TransactionInstruction({ programId: COMPUTE_BUDGET, keys: [], data: Buffer.from(data) });
  const before = v0([price(50_000), memo("hi")]);
  const added = `added an instruction for ${cb}`;
  assert.deepEqual(changes(before, v0([odd([0, 1, 0, 0, 0, 0, 0, 0, 0]), price(50_000), memo("hi")])), [
    "ComputeBudget instruction Solana can't use, data 000100000000000000 (Solana refuses it: InvalidInstructionData)",
    added,
  ]);
  assert.deepEqual(changes(before, v0([price(50_000), memo("hi"), odd([9, 1, 0, 0, 0])])), [
    "ComputeBudget instruction Solana can't use, data 0901000000 (Solana refuses it: InvalidInstructionData)",
    added,
  ]);
  assert.deepEqual(changes(before, v0([price(50_000), odd([]), memo("hi")])), ["ComputeBudget instruction Solana can't use, data none (Solana refuses it: InvalidInstructionData)", added]);
  // Solana reads them in order: a short price before the second one stops it first
  assert.deepEqual(changes(before, v0([price(50_000), odd([3, 1]), price(9), memo("hi")])), [
    "2 compute-unit price instructions: 50000, 9",
    "ComputeBudget instruction Solana can't use, data 0301 (Solana refuses it: InvalidInstructionData)",
    added,
  ]);
  assert.deepEqual(changes(before, v0([price(50_000), price(9), odd([3, 1]), memo("hi")])), [
    "2 compute-unit price instructions: 50000, 9 (Solana refuses it: DuplicateInstruction)",
    "ComputeBudget instruction Solana can't use, data 0301",
    added,
  ]);
});

test("a legacy tx handed back as v0, or the other way, is named", () => {
  assert.deepEqual(changes(legacy(price(50_000), memo("x")), v0([price(50_000), memo("x")])), ["tx version changed"]);
  assert.deepEqual(changes(v0([price(50_000), memo("x")]), legacy(price(50_000), memo("x"))), ["tx version changed"]);
});

test("a new payer, blockhash and limit, and a dropped instruction, are named", () => {
  const before = v0([price(50_000), memo("a"), memo("b")]);
  const after = v0([limit(200_000), price(50_000), memo("a")], { payer: Keypair.generate().publicKey, blockhash: Keypair.generate().publicKey.toBase58() });
  assert.deepEqual(changes(before, after), [
    "fee payer changed",
    "blockhash changed",
    "compute-unit limit none -> 200000",
    `removed an instruction for ${MEMO.toBase58()}`,
  ]);
});

test("an instruction whose accounts changed is named once, not as removed and added", () => {
  const ix = (pubkey) => new TransactionInstruction({ programId: MEMO, keys: [{ pubkey, isSigner: false, isWritable: false }], data: Buffer.from("k") });
  const [k1, k2] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  assert.deepEqual(changes(v0([price(50_000), ix(k1)]), v0([price(50_000), ix(k2)])), [`changed the accounts of an instruction for ${MEMO.toBase58()}`]);
  assert.deepEqual(changes(legacy(ix(k1), memo("x")), legacy(ix(k2), memo("x"))), [`changed the accounts of an instruction for ${MEMO.toBase58()}`]);
  // the same price with an account attached
  const keyed = new TransactionInstruction({ programId: COMPUTE_BUDGET, keys: [{ pubkey: k1, isSigner: false, isWritable: false }], data: price(50_000).data });
  assert.deepEqual(changes(v0([price(50_000), memo("x")]), v0([keyed, memo("x")])), [`changed the accounts of an instruction for ${COMPUTE_BUDGET.toBase58()}`]);
  const keyedLimit = new TransactionInstruction({ programId: COMPUTE_BUDGET, keys: [{ pubkey: k1, isSigner: false, isWritable: false }], data: limit(200_000).data });
  assert.deepEqual(changes(v0([limit(200_000), memo("x")]), v0([keyedLimit, memo("x")])), [`changed the accounts of an instruction for ${COMPUTE_BUDGET.toBase58()}`]);
  // changed and moved: both are named
  assert.deepEqual(changes(v0([ix(k1), memo("x")]), v0([memo("x"), ix(k2)])), [`changed the accounts of an instruction for ${MEMO.toBase58()}`, "instructions reordered"]);
});

test("a signer added to or removed from an instruction is named (the fee payer's line is its own)", () => {
  const k = Keypair.generate().publicKey;
  const signs = new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: k, isSigner: true, isWritable: false }], data: Buffer.from("k") });
  const changed = `changed the accounts of an instruction for ${MEMO.toBase58()}`;
  assert.deepEqual(changes(v0([memo("k")]), v0([signs])), [changed, `account ${k} added (signer, read-only)`]);
  assert.deepEqual(changes(v0([signs]), v0([memo("k")])), [changed, `account ${k} removed (signer, read-only)`]);
  assert.deepEqual(changes(legacy(memo("k")), legacy(signs)), [changed, `account ${k} added (signer, read-only)`]);
});

// lookup tables: a v0 tx that loads accounts `uses` (writable: w, readonly: r) through `tables`
const key = () => Keypair.generate().publicKey;
const table = (addresses) => new AddressLookupTableAccount({ key: key(), state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses } });
const uses = (w, r, data = "t") =>
  new TransactionInstruction({ programId: MEMO, keys: [...w.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })), ...r.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))], data: Buffer.from(data) });
const v0alt = (ixs, tables) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: BH, instructions: ixs }).compileToV0Message(tables));

test("lookup tables: an account moved into a table and a swap between table accounts are named", () => {
  const [a, b] = [key(), key()];
  const had = table([b]);
  const both = table([a, b]);
  assert.deepEqual(changes(v0alt([uses([a], [b])], [had]), v0alt([uses([a], [b])], [both])), [
    `changed the accounts of an instruction for ${MEMO.toBase58()}`,
    "lookup tables changed",
  ]);
  // the first instruction fixes the tables' index order; the second swaps a for b
  const before = v0alt([uses([], [a, b], "fix"), uses([], [a])], [both]);
  const after = v0alt([uses([], [a, b], "fix"), uses([], [b])], [both]);
  assert.deepEqual(after.message.addressTableLookups, before.message.addressTableLookups);
  assert.deepEqual(changes(before, after), [`changed the accounts of an instruction for ${MEMO.toBase58()}`]);
});

test("lookup tables: the same address loaded from another table is named", () => {
  const a0 = key();
  const [t1, t2] = [table([a0]), table([a0])];
  assert.deepEqual(changes(v0alt([uses([a0], [])], [t1]), v0alt([uses([a0], [])], [t2])), [`changed the accounts of an instruction for ${MEMO.toBase58()}`, "lookup tables changed"]);
});

test("lookup tables: accounts resolve by table and slot, writable slots before readonly ones", () => {
  const [t1, t2] = [table([key(), key(), key()]), table([key(), key()])];
  const [[a1, a2, a3], [b1, b2]] = [t1.state.addresses, t2.state.addresses];
  const ixs = [uses([a1, a2, b1], [a3, b2]), uses([b1], [a3])];
  // the same instructions with the tables in the other order: every account index differs
  assert.deepEqual(changes(v0alt(ixs, [t1, t2]), v0alt(ixs, [t2, t1])), ["lookup tables changed"]);
  // one table's writable slots listed the other way round, the instruction still on a1 then a2
  const before = v0alt([uses([a1, a2], [])], [t1]);
  const m = before.message;
  const [n, l] = [m.staticAccountKeys.length, m.addressTableLookups[0]];
  const swap = (i) => (i === n ? n + 1 : i === n + 1 ? n : i);
  const after = new VersionedTransaction(new MessageV0({
    header: m.header, staticAccountKeys: m.staticAccountKeys, recentBlockhash: m.recentBlockhash,
    compiledInstructions: m.compiledInstructions.map((ci) => ({ ...ci, accountKeyIndexes: ci.accountKeyIndexes.map(swap) })),
    addressTableLookups: [{ ...l, writableIndexes: [...l.writableIndexes].reverse() }],
  }));
  assert.deepEqual(changes(before, after), ["lookup tables changed"]);
});

test("lookup tables: an account made read-only in a table is named by table and slot", () => {
  const t = table([key(), key()]);
  const [a, b] = t.state.addresses;
  assert.deepEqual(changes(v0alt([uses([a], [b])], [t]), v0alt([uses([], [a, b])], [t])), ["lookup tables changed", `account 0 of lookup table ${t.key} made read-only`]);
});

test("the v0 order reason is given only where the new tx lists its static accounts by first use, group by group", () => {
  const why = "account order changed (the new v0 tx lists them as web3.js compiles v0: the fee payer, then signers before others and writable before read-only, each group in the order the instructions first use them)";
  const swapLast = (rows) => [...rows.slice(0, -2), ...rows.slice(-2).reverse()];
  const [w, s, r, u] = [key(), key(), key(), key()];
  // one of each header group: payer, s (read-only signer), w, then Memo and r, each group in first-use order
  const groups = v0([new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: w, isSigner: false, isWritable: true }, { pubkey: s, isSigner: true, isWritable: false }, { pubkey: r, isSigner: false, isWritable: false }], data: Buffer.from("g") })]);
  assert.deepEqual(changes(relist(groups, swapLast), groups), [why]);
  // an account no instruction uses: web3.js wouldn't list it, so no reason
  const tx = v0([uses([], [r, w])]);
  const withUnused = relist(tx, (rows) => [rows[0], { key: u, signer: false, writable: false }, ...rows.slice(1)]);
  assert.deepEqual(changes(relist(tx, swapLast), withUnused), [`account ${u} added (read-only), no instruction uses it`, "account order changed"]);
  // table accounts are left out: a writable table slot after the read-only static ones is still first use
  const alt = v0alt([uses([w], [r])], [table([w])]);
  assert.deepEqual(changes(relist(alt, swapLast), alt), [why]);
});

test("an account listed twice is named (Solana refuses the tx)", () => {
  const k = key();
  const tx = v0([uses([], [k])]);
  const twice = relist(tx, (rows) => [...rows, rows.find((r) => r.key.equals(k))]);
  assert.deepEqual(changes(tx, twice), [`account ${k} listed twice (Solana refuses it: AccountLoadedTwice)`]);
  const thrice = relist(tx, (rows) => [...rows, ...[1, 2].map(() => rows.find((r) => r.key.equals(k)))]);
  assert.deepEqual(changes(tx, thrice), [`account ${k} listed twice (Solana refuses it: AccountLoadedTwice)`]);
  // a table slot listed writable and read-only: named by its first listing, not as made read-only
  const t = table([key()]);
  const before = v0alt([uses(t.state.addresses, [])], [t]);
  const m = before.message;
  const both = new VersionedTransaction(new MessageV0({ ...m, addressTableLookups: [{ ...m.addressTableLookups[0], readonlyIndexes: [0] }] }));
  assert.deepEqual(changes(before, both), ["lookup tables changed", `account 0 of lookup table ${t.key} listed twice (Solana refuses it: AccountLoadedTwice)`]);
});

test("a change no other line names still gets one", () => {
  // an instruction pointing past the accounts the tx lists (Solana refuses that too): 7 and 8 both read as "?"
  const m = v0([uses([], [key()])]).message;
  const past = (at) => new VersionedTransaction(new MessageV0({ ...m, compiledInstructions: [{ ...m.compiledInstructions[0], accountKeyIndexes: [at] }] }));
  assert.deepEqual(changes(past(7), past(8)), ["the message changed in another way"]);
});

test("lookup tables the wallet kept are not named", () => {
  const t = table([key(), key()]);
  const ix = uses([t.state.addresses[0]], [t.state.addresses[1]]);
  const signed = v0alt([price(50_000), ix], [t]);
  signed.sign([wallet]);
  assert.deepEqual(changes(v0alt([price(50_000), ix], [t]), signed), []);
  assert.deepEqual(changes(v0alt([price(50_000), ix], [t]), v0alt([price(100_000), ix], [t])), ["compute-unit price 50000 -> 100000"]);
});

test("walletSigned: the wallet's signature must cover the tx it came back with", () => {
  const tx = v0([price(50_000), memo("hi")]);
  assert.equal(walletSigned(tx, wallet.publicKey), false); // not signed yet
  tx.sign([wallet]);
  assert.equal(walletSigned(tx, wallet.publicKey), true);
  assert.equal(walletSigned(tx, Keypair.generate().publicKey), false); // not a signer
  const changed = v0([price(100_000), memo("hi")]);
  changed.signatures[0] = tx.signatures[0]; // signed one tx, returned another
  assert.equal(walletSigned(changed, wallet.publicKey), false);
});

test("walletSigned reads legacy txs (the ER's) too", () => {
  const tx = legacy(memo("er"));
  assert.equal(walletSigned(tx, wallet.publicKey), false);
  tx.sign(wallet);
  assert.equal(walletSigned(tx, wallet.publicKey), true);
  assert.equal(walletSigned(Transaction.from(tx.serialize()), wallet.publicKey), true);
});

test("pickSignature finds the signature in each layout a wallet may return", () => {
  const text = "Mooner: sign in\nwallet: x\ntime: 1";
  const msg = new Uint8Array(Buffer.from(text, "utf8"));
  const sig = new Uint8Array(signMessage(wallet, text));
  const pk = wallet.publicKey;
  assert.deepEqual(pickSignature(msg, sig, pk), { signature: sig, layout: "signature only" });
  assert.deepEqual(pickSignature(msg, Buffer.concat([msg, sig]), pk), { signature: sig, layout: "message then signature" });
  assert.deepEqual(pickSignature(msg, Buffer.concat([sig, msg]), pk), { signature: sig, layout: "signature then message" });
  assert.equal(pickSignature(msg, sig, Keypair.generate().publicKey), null); // another wallet's key
  assert.equal(pickSignature(msg, new Uint8Array(10), pk), null); // too short
});

test("a forged signature for a small-order key doesn't verify (ZIP-215 would pass it)", () => {
  // a small-order key (the identity point) with R = identity and s = 0 passes ZIP-215 for any message
  const weakKey = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? 1 : 0)));
  const sig = Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 1 : 0));
  assert.equal(ed25519.verify(sig, new Uint8Array([1, 2, 3]), weakKey.toBytes()), true); // noble's default
  assert.equal(pickSignature(new Uint8Array([1, 2, 3]), sig, weakKey), null);
  const tx = v0([memo("hi")], { payer: weakKey });
  tx.signatures[0] = sig;
  assert.equal(walletSigned(tx, weakKey), false);
});

test("pickSignature says so when the bytes next to the signature aren't the message", () => {
  const text = "Mooner: sign in\nwallet: x\ntime: 1";
  const msg = new Uint8Array(Buffer.from(text, "utf8"));
  const sig = new Uint8Array(signMessage(wallet, text));
  const pk = wallet.publicKey;
  const other = new Uint8Array(20).fill(9);
  assert.deepEqual(pickSignature(msg, Buffer.concat([sig, other]), pk), { signature: sig, layout: "signature first, then 20 other bytes" });
  assert.deepEqual(pickSignature(msg, Buffer.concat([other, sig]), pk), { signature: sig, layout: "20 other bytes, then the signature" });
  const sameLength = new Uint8Array(msg.length); // as long as the message, but not it
  assert.deepEqual(pickSignature(msg, Buffer.concat([sameLength, sig]), pk), { signature: sig, layout: `${msg.length} other bytes, then the signature` });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd engine && node --test test/walletcheck.test.js`
Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../engine/src/walletcheck.js'`.

- [ ] **Step 4: Write `engine/src/walletcheck.js`**

```js
// What a wallet did to a tx it signed. Seed Vault raises a compute-unit price below its
// floor, and wallets may add instructions (Lighthouse); these checks name every change in
// plain words and confirm the wallet's signature covers the tx it handed back. Also: which
// bytes of a signMessages reply are the signature (the MWA spec leaves the layout open).
// No node: imports, so the phone and the web bundle this file as is.

import { ed25519 } from "@noble/curves/ed25519";
import { COMPUTE_BUDGET } from "./consts.js";

const PRICE = 3; // ComputeBudget SetComputeUnitPrice: u64 micro-lamports
const LIMIT = 2; // ComputeBudget SetComputeUnitLimit: u32 units

const isLegacy = (tx) => typeof tx.serializeMessage === "function";
const payerOf = (tx) => (isLegacy(tx) ? tx.feePayer ?? tx.signatures[0]?.publicKey : tx.message.staticAccountKeys[0]);
const blockhashOf = (tx) => (isLegacy(tx) ? tx.recentBlockhash : tx.message.recentBlockhash);

/** The bytes a signature covers. */
export const messageBytes = (tx) => (isLegacy(tx) ? tx.serializeMessage() : tx.message.serialize());

// A legacy tx from Transaction.from (what MWA's web3.js wrapper returns for one) keeps the
// message it was parsed from, and compileMessage hands that back from web3.js's _message
// cache: the wallet's own account order and flags, not a rebuild. It leaves the tx as it is.
const messageOf = (tx) => (isLegacy(tx) ? tx.compileMessage() : tx.message);

/** Every account a message loads, by index: its static keys, then each table's writable slots,
 *  then each table's readonly slots. A table account is `alt<table>:<slot>` (the table's
 *  addresses aren't in the tx; base58 has no "l" or ":", so no label is a key).
 *  Duplicates are found by label only: a static key that also sits in a table slot can't be
 *  seen offline, as table contents aren't in the tx (the app never uses tables). */
const keysOf = (m) => [
  ...m.staticAccountKeys.map((k) => k.toBase58()),
  ...m.addressTableLookups.flatMap((l) => l.writableIndexes.map((i) => `alt${l.accountKey.toBase58()}:${i}`)),
  ...m.addressTableLookups.flatMap((l) => l.readonlyIndexes.map((i) => `alt${l.accountKey.toBase58()}:${i}`)),
];
const nameOf = (k) => (k.includes(":") ? `account ${k.split(":")[1]} of lookup table ${k.slice(3, k.indexOf(":"))}` : `account ${k}`);

/** Every instruction as { program, data, keys } with base58 keys or table labels, legacy or v0. */
function ixsOf(tx) {
  if (isLegacy(tx)) return tx.instructions.map((i) => ({ program: i.programId.toBase58(), data: Uint8Array.from(i.data), keys: i.keys.map((k) => k.pubkey.toBase58()) }));
  const [m, keys] = [tx.message, keysOf(tx.message)];
  return m.compiledInstructions.map((ci) => ({
    program: keys[ci.programIdIndex] ?? "?",
    data: Uint8Array.from(ci.data),
    keys: ci.accountKeyIndexes.map((i) => keys[i] ?? "?"),
  }));
}

const BUDGET = COMPUTE_BUDGET.toBase58();
const isBudget = (i, tag) => i.program === BUDGET && i.data[0] === tag;
// the ComputeBudget tags Solana allows once per tx (a second one: DuplicateInstruction)
const ONCE = { 1: "heap frame", [LIMIT]: "compute-unit limit", [PRICE]: "compute-unit price", 4: "loaded-accounts data size limit" };
const u32 = (d, at) => (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16)) + d[at + 3] * 0x1000000;
const u64 = (d, at) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[at + i]);
  return v;
};

/** The value a ComputeBudget instruction with this tag sets, read as Solana reads it (its
 *  accounts and any bytes past the value are ignored); null for any other instruction. */
function budgetValue(i, tag) {
  const size = tag === PRICE ? 8 : 4;
  if (!isBudget(i, tag) || i.data.length < 1 + size) return null;
  return tag === PRICE ? u64(i.data, 1) : u32(i.data, 1);
}
const valuesOf = (ixs, tag) => ixs.map((i) => budgetValue(i, tag)).filter((v) => v !== null);
// Solana can't use tag 0 (the retired RequestUnits), an unknown tag, or too few bytes: InvalidInstructionData
const usable = (i) => i.data[0] in ONCE && budgetValue(i, i.data[0]) !== null;

/** Where Solana refuses the tx: it reads the ComputeBudget instructions in order and stops at
 *  the first it can't use or the second of a tag. The index, or -1. */
function refusedAt(ixs) {
  const seen = new Set();
  for (const [n, i] of ixs.entries()) {
    if (i.program !== BUDGET) continue;
    if (!usable(i) || seen.has(i.data[0])) return n;
    seen.add(i.data[0]);
  }
  return -1;
}

/** The compute-unit price (BigInt micro-lamports) and limit the tx sets; null where it sets none. */
export function budget(tx) {
  const ixs = ixsOf(tx);
  return { price: valuesOf(ixs, PRICE).pop() ?? null, limit: valuesOf(ixs, LIMIT).pop() ?? null };
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ixId = (i) => `${i.program} ${hex(i.data)} ${i.keys.join(",")}`;

// a plain price or limit instruction (no accounts, just the tag and the value, as
// ComputeBudgetProgram builds it) lines up by kind, so a raised price pairs with the old one
const plain = (i, tag) => budgetValue(i, tag) !== null && !i.keys.length && i.data.length === (tag === PRICE ? 9 : 5);
const kindOf = (i) => (plain(i, PRICE) ? "price" : plain(i, LIMIT) ? "limit" : ixId(i));
const isKind = (id) => id === "price" || id === "limit";
const version = (tx) => (isLegacy(tx) ? "legacy" : tx.message.version);
const tablesOf = (tx) =>
  (isLegacy(tx) ? [] : tx.message.addressTableLookups).map((l) => `${l.accountKey.toBase58()} w${l.writableIndexes} r${l.readonlyIndexes}`).join(";");
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Each account the tx loads, by key or table label, in its order: whether it signs and
 *  whether it's writable, as first listed (one listed twice is named below). */
function accountsOf(tx) {
  const [m, out] = [messageOf(tx), new Map()];
  keysOf(m).forEach((k, n) => out.has(k) || out.set(k, { signer: m.isAccountSigner(n), writable: m.isAccountWritable(n) }));
  return out;
}
const usedBy = (tx, ixs) => new Set([payerOf(tx).toBase58(), ...ixs.flatMap((i) => [i.program, ...i.keys])]);

/** Whether the static accounts are listed as web3.js compiles a v0 tx: each header group in
 *  the order the payer, then each instruction's program and accounts, first use them (Rust's
 *  solana-message sorts them by key instead). */
function inFirstUseOrder(tx, ixs, accounts) {
  const used = [...usedBy(tx, ixs)];
  const keys = [...accounts.keys()].filter((k) => !k.includes(":"));
  const group = (k) => (accounts.get(k).signer ? 0 : 2) + (accounts.get(k).writable ? 0 : 1);
  return keys.every((k) => used.includes(k)) && same(keys, [...keys].sort((x, y) => group(x) - group(y) || used.indexOf(x) - used.indexOf(y)));
}
const flags = (f) => `${f.signer ? "signer, " : ""}${f.writable ? "writable" : "read-only"}`;

/** How many of `xs` appear in `ys` in the same order (longest common subsequence). */
function inOrder(xs, ys) {
  let row = new Array(ys.length + 1).fill(0);
  for (const x of xs) {
    const next = [0];
    ys.forEach((y, j) => next.push(x === y ? row[j] + 1 : Math.max(row[j + 1], next[j])));
    row = next;
  }
  return row[ys.length];
}

/** What differs between the tx we built and the one the wallet returned, one line each;
 *  [] only when the message bytes are the same (the wallet only signed). Price and limit
 *  changes are named with their numbers. */
export function changes(before, after) {
  if (version(before) === version(after) && same(messageBytes(before), messageBytes(after))) return [];
  const out = [];
  if (version(before) !== version(after)) out.push("tx version changed");
  if (!payerOf(before).equals(payerOf(after))) out.push("fee payer changed");
  if (blockhashOf(before) !== blockhashOf(after)) out.push("blockhash changed");
  const [ib, ia] = [ixsOf(before), ixsOf(after)];
  const [b, a] = [budget(before), budget(after)];
  // two of one tag: Solana refuses the tx, so the values are listed instead of budget()'s last one
  const twice = Object.keys(ONCE).map((tag) => [+tag, valuesOf(ia, +tag)]).filter(([, v]) => v.length > 1);
  const once = (tag) => !twice.some(([t]) => t === tag);
  if (b.price !== a.price && once(PRICE)) out.push(`compute-unit price ${b.price ?? "none"} -> ${a.price ?? "none"}`);
  if (b.limit !== a.limit && once(LIMIT)) out.push(`compute-unit limit ${b.limit ?? "none"} -> ${a.limit ?? "none"}`);
  // the refusal is named on the line of the instruction Solana stops at
  const stop = refusedAt(ia);
  const second = stop >= 0 && usable(ia[stop]) ? ia[stop].data[0] : null;
  for (const [tag, v] of twice) out.push(`${v.length} ${ONCE[tag]} instructions: ${v.join(", ")}${tag === second ? " (Solana refuses it: DuplicateInstruction)" : ""}`);
  for (const [n, i] of ia.entries()) {
    if (i.program === BUDGET && !usable(i)) out.push(`ComputeBudget instruction Solana can't use, data ${hex(i.data) || "none"}${n === stop ? " (Solana refuses it: InvalidInstructionData)" : ""}`);
  }
  const [kb, ka] = [ib.map(kindOf), ia.map(kindOf)];
  const left = ka.map((_, n) => n); // after's instructions no before one matched yet
  const gone = [];
  for (const [n, k] of kb.entries()) {
    const j = left.findIndex((m) => ka[m] === k);
    if (j >= 0) left.splice(j, 1);
    else gone.push(n);
  }
  // a removed and an added instruction with the same program and data: its accounts changed
  const head = (i) => `${i.program} ${hex(i.data)}`;
  let removed = 0;
  for (const n of gone) {
    const j = left.findIndex((m) => head(ia[m]) === head(ib[n]));
    if (j >= 0) {
      ka[left[j]] = kb[n]; // the same instruction, for the order check
      left.splice(j, 1);
      out.push(`changed the accounts of an instruction for ${ib[n].program}`);
    } else {
      removed++;
      if (!isKind(kb[n])) out.push(`removed an instruction for ${ib[n].program}`);
    }
  }
  for (const m of left) if (!isKind(ka[m])) out.push(`added an instruction for ${ia[m].program}`);
  if (inOrder(kb, ka) < kb.length - removed) out.push("instructions reordered");
  const [tb, ta] = [tablesOf(before), tablesOf(after)];
  if (tb !== ta) out.push(!tb ? "lookup tables added" : !ta ? "lookup tables removed" : "lookup tables changed");
  // the flags of every account both list (a table account by table and slot)
  const [ab, aa] = [accountsOf(before), accountsOf(after)];
  for (const [k, f] of aa) {
    const was = ab.get(k);
    if (was && was.signer !== f.signer) out.push(`${nameOf(k)} ${f.signer ? "made a signer" : "no longer a signer"}`);
    if (was && was.writable !== f.writable) out.push(`${nameOf(k)} made ${f.writable ? "writable" : "read-only"}`);
  }
  // an account only one lists: named when it signs (the fee payer has its own line) or no instruction uses it
  const [ub, ua] = [usedBy(before, ib), usedBy(after, ia)];
  const [pb, pa] = [payerOf(before).toBase58(), payerOf(after).toBase58()];
  for (const [k, f] of aa) if (!ab.has(k) && (!ua.has(k) || (f.signer && k !== pa))) out.push(`${nameOf(k)} added (${flags(f)})${ua.has(k) ? "" : ", no instruction uses it"}`);
  for (const [k, f] of ab) if (!aa.has(k) && (!ub.has(k) || (f.signer && k !== pb))) out.push(`${nameOf(k)} removed (${flags(f)})${ub.has(k) ? "" : ", no instruction used it"}`);
  // the static accounts both list with the same flags, in each one's order. Equal flags put an
  // account in the same header group in both, and the groups come in a fixed order, so this
  // compares order within each group; web3.js sorts a legacy group by key (the payer first),
  // so its own rebuild moves none of them. Table accounts are left to the tables line.
  const kept = (x, y) => [...x].filter(([k, f]) => !k.includes(":") && y.get(k)?.signer === f.signer && y.get(k)?.writable === f.writable).map(([k]) => k);
  const why = version(after) !== "legacy" && inFirstUseOrder(after, ia, aa)
    ? " (the new v0 tx lists them as web3.js compiles v0: the fee payer, then signers before others and writable before read-only, each group in the order the instructions first use them)"
    : "";
  if (!same(kept(ab, aa), kept(aa, ab))) out.push(`account order changed${why}`);
  const listed = keysOf(messageOf(after));
  for (const k of new Set(listed.filter((k, n) => listed.indexOf(k) !== n))) out.push(`${nameOf(k)} listed twice (Solana refuses it: AccountLoadedTwice)`);
  if (!out.length) out.push("the message changed in another way");
  return out;
}

// noble's strict mode (canonical points, no small-order key), near Solana's verify_strict;
// its default, ZIP-215, passes a small-order key with a forged signature
function verify(signature, message, publicKey) {
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

function signatureOf(tx, wallet) {
  if (isLegacy(tx)) return tx.signatures.find((s) => s.publicKey.equals(wallet))?.signature ?? null;
  const n = tx.message.header.numRequiredSignatures;
  const i = tx.message.staticAccountKeys.slice(0, n).findIndex((k) => k.equals(wallet));
  return i >= 0 ? tx.signatures[i] : null;
}

/** Whether `wallet` signed this exact tx: its signature is there and covers the tx's bytes. */
export function walletSigned(tx, wallet) {
  const sig = signatureOf(tx, wallet);
  if (!sig || sig.every((b) => b === 0)) return false;
  return verify(sig, messageBytes(tx), wallet.toBytes());
}

/** A signMessages reply: the signature alone, the message then the signature, or the
 *  signature then the message. Returns { signature, layout } for the 64 bytes that verify
 *  against `wallet`, or null. The layout names the message only where its bytes are there;
 *  other bytes next to the signature are counted ("20 other bytes, then the signature"). */
export function pickSignature(message, payload, wallet) {
  const tries = [];
  if (payload.length === 64) tries.push(["signature only", payload]);
  if (payload.length > 64) {
    const n = payload.length - 64;
    const [head, last] = [payload.subarray(0, n), payload.subarray(n)];
    const [first, tail] = [payload.subarray(0, 64), payload.subarray(64)];
    tries.push([same(head, message) ? "message then signature" : `${n} other bytes, then the signature`, last]);
    tries.push([same(tail, message) ? "signature then message" : `signature first, then ${n} other bytes`, first]);
  }
  for (const [layout, sig] of tries) {
    if (verify(sig, message, wallet.toBytes())) return { signature: Uint8Array.from(sig), layout };
  }
  return null;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd engine && node --test test/walletcheck.test.js`
Expected: PASS (`# pass 32`).

Run: `cd engine && npm test`
Expected: `# pass 103`, `# fail 0`.

- [ ] **Step 6: Commit (only after the user says to commit)**

```bash
git add engine/package.json engine/package-lock.json engine/src/walletcheck.js engine/test/walletcheck.test.js
git commit -m "engine: wallet checks: what a wallet changed, whether its signature covers the tx"
```

---

## Task 5: The golden self-test tx (`engine/src/selftest.js`)

These are two fixed txs, a v0 join and a legacy ER tx, which web3.js builds through different code. Each has fixed keys and a zero blockhash, and is signed by a fixed seed. The ER tx also carries a memo with two keys that web3.js's `localeCompare` sorts one way and plain code-point order sorts the other way. The phone builds both and compares their sha256 with the ones Node computes. A match proves the phone's bundle derives PDAs, orders accounts, encodes and signs exactly as Node does. The bundle is Hermes, the polyfills and one web3.js. The module also has a collation probe: `collationOrder()` sorts `COLLATION_WORDS` the way web3.js sorts keys. The phone logs it next to `COLLATION_ORDER`, Node's order, so a mismatch shows whether the engine compares by code point or by another locale.

**Files:**
- Create: `engine/src/selftest.js`
- Test: `engine/test/selftest.test.js`

- [ ] **Step 1: Write the failing test**

Create `engine/test/selftest.test.js`:

```js
// The golden txs (a v0 join, a legacy ER tx): the phone compares their digests with these.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { checkEntryTx } from "../src/cosigner.js";
import {
  COLLATION_ORDER, COLLATION_WORDS, collationOrder, digest, GOLDEN_ER_DIGEST, GOLDEN_GATE, GOLDEN_JOIN_DIGEST, GOLDEN_PID, GOLDEN_VALIDATOR, goldenErTx, goldenJoinTx,
} from "../src/selftest.js";

test("the golden join tx has the digest the phone checks against", () => {
  const tx = goldenJoinTx();
  assert.equal(digest(tx), GOLDEN_JOIN_DIGEST);
  assert.equal(digest(tx), crypto.createHash("sha256").update(tx.serialize()).digest("hex"));
});

test("the golden ER tx (legacy, as the ER takes) has the digest the phone checks against", () => {
  const tx = goldenErTx();
  assert.equal(tx.constructor.name, "Transaction");
  assert.equal(digest(tx), GOLDEN_ER_DIGEST);
  assert.equal(digest(tx), crypto.createHash("sha256").update(tx.serialize()).digest("hex"));
});

test("the golden ER tx's digest depends on how web3.js orders a legacy tx's accounts", () => {
  // web3.js sorts them with localeCompare; an engine that compares code points instead puts
  // two of the tx's keys the other way round, and the phone's check must catch that
  const icu = digest(goldenErTx());
  const localeCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = function (other) {
    return this < other ? -1 : this > other ? 1 : 0;
  };
  try {
    assert.notEqual(digest(goldenErTx()), icu);
  } finally {
    String.prototype.localeCompare = localeCompare;
  }
});

// the probe with String.prototype.localeCompare swapped for `compare`, put back after
function probeWith(compare) {
  const localeCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = compare;
  try {
    return collationOrder();
  } finally {
    String.prototype.localeCompare = localeCompare;
  }
}
const localeCompare = String.prototype.localeCompare;
const byLocale = (locale, change = {}) => function (other, _en, options) {
  return localeCompare.call(this, other, locale, { ...options, ...change });
};

test("the collation probe sorts its words as Node does, and fires under code point, numeric order or another locale", () => {
  assert.ok(COLLATION_WORDS.every((w) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(w))); // base58, like the keys web3.js sorts
  assert.deepEqual(collationOrder(), COLLATION_ORDER);
  const codePoint = function (other) {
    return this < other ? -1 : this > other ? 1 : 0;
  };
  assert.notDeepEqual(probeWith(codePoint), COLLATION_ORDER, "code point");
  assert.notDeepEqual(probeWith(byLocale("en", { numeric: true })), COLLATION_ORDER, "numeric");
  // every locale selftest.js names beside the words
  const others = ["da", "nb", "cs", "sk", "hu", "hr", "bs", "sr-Latn", "fil", "tl", "ceb", "to", "yo", "ig", "ee", "sq", "ha", "az", "lt", "et", "haw", "ln-u-co-phonetic"];
  for (const locale of others) assert.notDeepEqual(probeWith(byLocale(locale)), COLLATION_ORDER, locale);
});

test("the collation probe stays quiet under en, en-US, en-GB and en without options", () => {
  for (const locale of ["en", "en-US", "en-GB"]) assert.deepEqual(probeWith(byLocale(locale)), COLLATION_ORDER, locale);
  const noOptions = function (other) {
    return localeCompare.call(this, other, "en");
  };
  assert.deepEqual(probeWith(noOptions), COLLATION_ORDER, "no options");
});

test("the golden join tx is a join the gate would sign", () => {
  const r = checkEntryTx(goldenJoinTx(), { pid: GOLDEN_PID, gate: GOLDEN_GATE, validators: [GOLDEN_VALIDATOR] });
  assert.equal(r.kind, "join");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd engine && node --test test/selftest.test.js`
Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../engine/src/selftest.js'`.

- [ ] **Step 3: Write `engine/src/selftest.js`**

```js
// Fixed txs whose bytes must match on every platform: a v0 join tx and a legacy ER tx (web3.js
// builds the two through different code). The phone builds both at start and compares their
// digests, which proves its bundle (Hermes, the polyfills, one web3.js) derives PDAs, orders
// accounts, encodes and signs exactly as Node does. It also logs collationOrder() next to
// COLLATION_ORDER, to see how the engine's localeCompare sorts. No node: imports.

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { joinIxs, unsignedErTx, unsignedTx } from "./client.js";
import { MEMO } from "./consts.js";
import { setCommit } from "./ix.js";
import { presalePda, seatPda } from "./pdas.js";

export const GOLDEN_PID = new PublicKey("6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa");
const fill = (n) => new Uint8Array(32).fill(n);
export const GOLDEN_GATE = new PublicKey(fill(2));
export const GOLDEN_VALIDATOR = new PublicKey(fill(5));

/** sha256 hex of the serialized goldenJoinTx() and goldenErTx(), as Node computes them. */
export const GOLDEN_JOIN_DIGEST = "f6baff2127e47458211b82a23559a370b704d0517bc83afda59c7494965aed55";
export const GOLDEN_ER_DIGEST = "003c526dd79355edfd533b345ef9f449520bd74b9d5fe918f20457c7a6ea4254";

/** A 0.5 SOL join by a fixed wallet, signed by it (the gate's slot stays empty). */
export function goldenJoinTx() {
  const user = Keypair.fromSeed(fill(7));
  const presale = presalePda(GOLDEN_PID, new PublicKey(fill(3)));
  const ixs = joinIxs(GOLDEN_PID, { user: user.publicKey, gate: GOLDEN_GATE, presale, sessionKey: new PublicKey(fill(4)), deposit: 500_000_000n, validator: GOLDEN_VALIDATOR });
  const tx = unsignedTx({ ixs, payer: user.publicKey, blockhash: "11111111111111111111111111111111" });
  tx.sign([user]);
  return tx;
}

/** A 0.5 SOL commit for the golden join's seat, signed and paid by a fixed session key
 *  (Keypair.fromSeed(fill(8)), not the fill(4) key the join registered), and a memo whose
 *  two read-only keys (cGfHiC... and CHTMuH...) sort one way under web3.js's localeCompare
 *  and the other way by code point, so the digest also checks the engine's collation. */
export function goldenErTx() {
  const session = Keypair.fromSeed(fill(8));
  const presale = presalePda(GOLDEN_PID, new PublicKey(fill(3)));
  const seat = seatPda(GOLDEN_PID, presale, Keypair.fromSeed(fill(7)).publicKey);
  const ro = (n) => ({ pubkey: new PublicKey(fill(n)), isSigner: false, isWritable: false });
  const ixs = [
    setCommit(GOLDEN_PID, { signer: session.publicKey, seat, presale, amount: 500_000_000n }),
    new TransactionInstruction({ programId: MEMO, keys: [ro(9), ro(167)], data: Buffer.from("golden") }),
  ];
  const tx = unsignedErTx({ ixs, payer: session.publicKey, blockhash: "11111111111111111111111111111111" });
  tx.sign(session);
  return tx;
}

export const digest = (tx) => bytesToHex(sha256(tx.serialize()));

// how web3.js 1.99.0 sorts a legacy tx's accounts: x.localeCompare(y, 'en', options)
const WEB3_SORT = {
  localeMatcher: 'best fit',
  usage: 'sort',
  sensitivity: 'variant',
  ignorePunctuation: false,
  numeric: false,
  caseFirst: 'lower'
};

/** Base58 words web3.js's sort puts one way and another compare puts another: code point
 *  sorts "A" before "a", numeric order "9" before "12", and locales that treat two letters as
 *  one or move a letter reorder some (da, nb: "aa"; cs, sk: "ch"; hu: "cs"; hr, bs, sr-Latn:
 *  "nj"; fil (and tl), ceb, to: "ng"; yo, ig, ee: "gb"; sq, ha: "sh"; az: "x"; lt: "y"; et: "z";
 *  haw: vowels first; ln-u-co-phonetic: "gb", "ng", "sh"). */
// Measured on Node's ICU 78.2; which ICU the phone's Android ships is unverified.
export const COLLATION_WORDS = ["cz", "Abc", "yz", "chx", "zb", "Aab", "csx", "tb", "Ab", "jz", "aa", "nz", "njx", "ngx", "gz", "gbx", "sz", "shx", "xa", "iz", "ua", "bz", "9x", "12x"];
/** COLLATION_WORDS as Node sorts them with web3.js's options (and with "en" alone). */
export const COLLATION_ORDER = ["12x", "9x", "aa", "Aab", "Ab", "Abc", "bz", "chx", "csx", "cz", "gbx", "gz", "iz", "jz", "ngx", "njx", "nz", "shx", "sz", "tb", "ua", "xa", "yz", "zb"];
/** COLLATION_WORDS sorted as web3.js sorts keys, on this engine. */
export const collationOrder = () => [...COLLATION_WORDS].sort((x, y) => x.localeCompare(y, "en", WEB3_SORT));
```

- [ ] **Step 4: Run the tests**

Run: `cd engine && node --test test/selftest.test.js`
Expected: PASS (`# pass 6`).

Run: `cd engine && npm test`
Expected: `# pass 109`, `# fail 0`.

If `joinIxs`, `setCommit`, `unsignedErTx` or either tx's layout ever changes on purpose, the digests change with it. In that case, print the new ones and update `GOLDEN_JOIN_DIGEST` and `GOLDEN_ER_DIGEST`:

```bash
cd engine && node -e 'import("./src/selftest.js").then(m => console.log(m.digest(m.goldenJoinTx()), m.digest(m.goldenErTx())))'
```

Today it prints `f6baff2127e47458211b82a23559a370b704d0517bc83afda59c7494965aed55 003c526dd79355edfd533b345ef9f449520bd74b9d5fe918f20457c7a6ea4254`.

- [ ] **Step 5: Commit (only after the user says to commit)**

```bash
git add engine/src/selftest.js engine/test/selftest.test.js
git commit -m "engine: golden join and ER txs the phone checks its bundle against"
```

---

## Task 6: The phone project (`mobile/`)

**Files:** create `mobile/package.json`, `mobile/app.json`, `mobile/polyfill.js`, `mobile/metro.config.js`, `mobile/.gitignore`, `mobile/scripts/run-android.sh`, `mobile/scripts/check-bundle.sh` and `mobile/assets/icon.png`.

- [ ] **Step 1: `mobile/package.json`**

Every package that the phone's `engine/src` files import is listed here: `@solana/web3.js`, `@noble/curves` and `@noble/hashes`. `buffer` is for `polyfill.js`, which sets the global `Buffer` those files use. (The phone never loads `dbc.js`, the one engine file that imports `node:crypto`.) Metro resolves engine files' imports from this folder (see `metro.config.js`). `@react-native-async-storage/async-storage` is the MWA library's cache.

```json
{
  "name": "mooner-mobile",
  "version": "0.1.0",
  "private": true,
  "main": "index.js",
  "scripts": {
    "android": "sh scripts/run-android.sh",
    "bundle:check": "sh scripts/check-bundle.sh"
  },
  "dependencies": {
    "@noble/curves": "1.9.7",
    "@noble/hashes": "1.8.0",
    "@react-native-async-storage/async-storage": "^2.2.0",
    "@solana/web3.js": "1.99.0",
    "@wallet-ui/react-native-web3js": "4.3.0",
    "buffer": "6.0.3",
    "expo": "~55.0.23",
    "expo-status-bar": "~55.0.4",
    "react": "19.2.0",
    "react-native": "0.83.10",
    "react-native-get-random-values": "~1.11.0"
  }
}
```

- [ ] **Step 2: `mobile/app.json`**

```json
{
  "expo": {
    "name": "Mooner",
    "slug": "mooner",
    "scheme": "mooner",
    "version": "0.1.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "android": {
      "package": "family.mooner.app"
    }
  }
}
```

- [ ] **Step 3: The icon**

```bash
mkdir -p mobile/assets && cp site/assets/icon-512.png mobile/assets/icon.png
```

- [ ] **Step 4: `mobile/polyfill.js`**

```js
// crypto.getRandomValues (web3.js makes keys with it), then one Buffer for everything: the
// `buffer` package, as the web app uses (engine/src calls Buffer.from).
import "react-native-get-random-values";
import { Buffer } from "buffer";

global.Buffer = Buffer;
```

This uses `react-native-get-random-values`, not `react-native-quick-crypto`. quick-crypto 0.7.17 is deprecated with a security advisory (GHSA-wrf3-fwx3-8jrv), and only `getRandomValues` is needed.

- [ ] **Step 5: `mobile/metro.config.js`**

```js
// The app bundles ../engine/src as is (the chain code the web app and the server use).
// Every package engine/src imports resolves from this app's node_modules, never engine's:
// one @solana/web3.js (two copies break PublicKey checks; the web app dedupes the same
// way) and no need for engine/'s own install. So this package.json lists each package
// engine/src imports.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const engine = path.resolve(__dirname, "../engine");
const fromApp = path.join(__dirname, "index.js");

config.watchFolders = [engine];
config.resolver.resolveRequest = (context, name, platform) => {
  const bare = !name.startsWith(".") && !name.startsWith("/");
  const fromEngine = context.originModulePath.startsWith(engine + path.sep);
  const ctx = fromEngine && bare ? { ...context, originModulePath: fromApp } : context;
  return ctx.resolveRequest(ctx, name, platform);
};

module.exports = config;
```

- [ ] **Step 6: `mobile/.gitignore`**

```
node_modules/
.expo/
dist/
android/
ios/
*.jks
*.keystore
*.p8
*.p12
*.key
*.pem
*.mobileprovision
.env
.env.*
```

- [ ] **Step 7: `mobile/scripts/run-android.sh`**

```sh
#!/bin/sh
# Builds the release app (its JS is inside the APK, so no Metro server runs) and installs
# it on the phone plugged in over USB (adb devices). It signs with the debug keystore.
# The Android SDK and JDK 17 are Homebrew's on this Mac.
set -e
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
cd "$(dirname "$0")/.."
exec npx expo run:android --variant release --no-bundler "$@"
```

- [ ] **Step 8: `mobile/scripts/check-bundle.sh`**

```sh
#!/bin/sh
# Bundles the app for Android and checks it holds exactly one @solana/web3.js and nothing
# from engine/node_modules (see metro.config.js). Module resolution is the same as in the
# release build; minification and the Hermes compile are not (--dev --no-bytecode).
set -e
cd "$(dirname "$0")/.."
rm -rf dist
npx expo export --platform android --dev --no-bytecode --output-dir dist > /dev/null
B=$(ls dist/_expo/static/js/android/*.js)
copies=$(grep -o '"[^"]*@solana/web3\.js/lib/index[^"]*"' "$B" | sort -u | wc -l | tr -d ' ')
stray=$(grep -c 'engine/node_modules' "$B" || true)
echo "web3.js copies: $copies; files from engine/node_modules: $stray"
[ "$copies" = 1 ] && [ "$stray" = 0 ]
```

- [ ] **Step 9: Install**

```bash
cd mobile && npm install
```

Expected: it finishes and creates `mobile/package-lock.json`. It prints the moderate advisories listed in the ground rules; leave them.

- [ ] **Step 10: Check versions and native modules**

```bash
cd mobile && CI=1 npx expo install --check
```

Expected: `Dependencies are up to date`.

```bash
cd mobile && npx expo-modules-autolinking react-native-config --platform android --json | grep -o '"name": *"[^"]*"' | sort -u
```

Expected: the names include `@react-native-async-storage/async-storage`, `@solana-mobile/mobile-wallet-adapter-protocol` and `react-native-get-random-values`.

(No commit yet: the app has no screen until Task 7.)

---

## Task 7: The spike screen

It's one screen with a button per question and a log.
- Every result appears on screen and in `adb logcat`, tagged `[spike]`.
- Only "Send memo" sends a tx, at most once per network until the app is force-stopped. Nothing else sends:
  - Engine uses no wallet, Capabilities only asks Seed Vault what it supports, and Connect only authorizes;
  - Sign in, Entry tx, ER tx and No-fee tx only sign. The entry and ER txs couldn't land even if they were sent: the entry tx lacks the gate's signature, and the ER tx names a seat that doesn't exist. The no-fee memo is fully signed with a live blockhash and stays off chain only because nothing sends it.

**Files:** create `mobile/index.js`, `mobile/src/checks.js`, `mobile/src/runner.js` and `mobile/src/SpikeScreen.js`.

(Keep the file names `checks.js` and `SpikeScreen.js`. The Mac's file system ignores case, so a `spike.js` and a `Spike.js` would be the same file and Metro fails to resolve one of them.)

- [ ] **Step 1: `mobile/index.js`**

```js
// Polyfills first: engine/src and web3.js expect Node's crypto and Buffer.
import "./polyfill";
import { registerRootComponent } from "expo";
import App from "./src/SpikeScreen";

registerRootComponent(App);
```

- [ ] **Step 2: `mobile/src/checks.js`**

```js
// The Seed Vault checks (spec 2026-09-29-mooner-seeker-app-design.md, "Seed Vault
// questions"), one function each. All of them only sign (or, for capabilitiesCheck, only
// ask), except sendCheck, which sends one memo tx (0.00001 SOL in fees) that the user
// approves on the phone, at most once per network until the app is force-stopped. The txs
// that are only signed are never sent; the entry and ER txs couldn't land even if they were:
// the entry tx lacks the gate's signature, the ER tx names a seat that doesn't exist. The
// no-fee memo is fully signed with a live blockhash and stays off chain only because nothing
// sends it.

import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { makeApi } from "../../engine/src/apiclient.js";
import { joinIxs, loginMessage, unsignedErTx, unsignedTx } from "../../engine/src/client.js";
import { MEMO } from "../../engine/src/consts.js";
import { checkEntryTx } from "../../engine/src/cosigner.js";
import * as I from "../../engine/src/ix.js";
import { SEAT_LEN } from "../../engine/src/layout.js";
import { seatPda } from "../../engine/src/pdas.js";
import { collationOrder, COLLATION_ORDER, digest, GOLDEN_ER_DIGEST, GOLDEN_JOIN_DIGEST, goldenErTx, goldenJoinTx }
  from "../../engine/src/selftest.js";
import { connect } from "../../engine/src/tx.js";
import { changes, pickSignature, walletSigned } from "../../engine/src/walletcheck.js";
import { errorText, FORCE_STOP } from "./runner";

export const api = makeApi("https://app.mooner.family");

const PRIORITY = 50_000; // µLamports per compute unit: the price the entry tx is built at
// What a join costs the wallet on top of the deposit and the seat's rent:
// - delegating the seat creates the delegation program's record, 96 bytes, and metadata, 133
//   (its fields plus the seat's seeds "seat", presale, user; delegation-program-api 3.1.0,
//   state/delegation_record.rs and delegation_metadata.rs serialized_size). The SDK's buffer
//   is made with 0 lamports and closed in the same instruction (ephemeral-rollups-sdk 0.16.2,
//   cpi.rs delegate_account_inner and utils.rs create_pda with rent_exempt false): free;
// - the fee: 2 signatures (the wallet's, the gate's) at 5,000 lamports, plus the priority. The
//   tx sets no compute-unit limit, so the runtime gives join and delegate 200,000 CU each and
//   the compute-budget instruction 3,000 (agave compute_budget_instruction_details.rs):
//   403,000 CU at PRIORITY, rounded up. Mainnet's getFeeForMessage for this tx says 30,150;
// - and the wallet must keep a 0-byte account's rent: after a tx an account may be empty or
//   rent-exempt, nothing in between.
const RECORD_LEN = 96;
const METADATA_LEN = 133;
const ENTRY_FEE = 2n * 5_000n + (403_000n * BigInt(PRIORITY) + 999_999n) / 1_000_000n;

const memo = (text, signer) =>
  new TransactionInstruction({
    programId: MEMO,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text, "utf8"),
  });

/** Lamports as SOL, without trailing zeros. */
const sol = (lamports) => (Number(lamports) / 1e9).toFixed(9).replace(/\.?0+$/, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A tx's wire bytes. A wallet may hand back a legacy Transaction, which needs the options
 *  to serialize without the signatures it doesn't have yet. */
const wireBytes = (tx) => ("version" in tx ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false }));

/** What the wallet changed, and whether its signature covers what it returned. */
function report(log, before, after, wallet) {
  const c = changes(before, after);
  log(c.length ? `Seed Vault changed: ${c.join("; ")}` : "Seed Vault changed nothing");
  log(`its signature covers the tx it returned: ${walletSigned(after, wallet) ? "yes" : "NO"}`);
}

/** Whether a golden tx's digest is the one Node computes. */
const golden = (tx, want) => {
  const d = digest(tx);
  return d === want ? "same bytes as Node" : `DIFFERENT (${d})`;
};

/** The device's locale, and what "en" (the locale web3.js sorts with) resolves to here. */
function locales() {
  try {
    return `${Intl.DateTimeFormat().resolvedOptions().locale}; "en" sorting resolves to `
      + `${new Intl.Collator("en").resolvedOptions().locale}`;
  } catch (e) {
    return `unknown (${errorText(e)})`;
  }
}

/** No wallet: the bundle builds both golden txs (v0 and legacy) byte for byte as Node does,
 *  with one web3.js (the Connection wallet-ui made with its own import of web3.js is this
 *  app's too). web3.js orders a legacy tx's accounts with localeCompare, so the engine's text
 *  sorting is checked on its own too, next to the device's locale (a tailored one is the case
 *  that could sort differently). */
export function engineCheck({ log, connection }) {
  const tx = goldenJoinTx();
  log(`golden join tx: ${golden(tx, GOLDEN_JOIN_DIGEST)}`);
  log(`golden ER tx (legacy): ${golden(goldenErTx(), GOLDEN_ER_DIGEST)}`);
  const order = collationOrder();
  const sameOrder = order.join(" ") === COLLATION_ORDER.join(" ");
  log(`text sorting matches Node (web3.js's account order): ${sameOrder ? "yes" : `NO: ${order.join(" ")}`}`);
  if (!sameOrder) log("so legacy txs built on this phone may order their accounts differently from Node's: "
    + "the golden ER tx above is expected to differ too");
  log(`device locale: ${locales()}`);
  log(`one web3.js: ${tx.message.staticAccountKeys[0] instanceof PublicKey ? "yes" : "NO"}`);
  log(`wallet-ui's Connection is the app's web3.js: ${connection instanceof Connection ? "yes" : "NO"}`);
  log(`random keypair: ${Keypair.generate().publicKey.toBase58()}`);
}

/** What Seed Vault says it supports, asked without authorizing. The adapter's
 *  getCapabilities() rewrites the answer (protocol lib handleMobileWalletResponse): on MWA 2.0
 *  it adds both supports_*, on MWA 1.x it makes up features. So the same RPC method is also
 *  asked by its own name, get_capabilities, which comes back untouched (the adapter turns any
 *  property into that method call and rewrites only "getCapabilities"), and the difference
 *  is logged. supported_transaction_versions and max_* are always Seed Vault's own. */
export async function capabilitiesCheck({ w, log }) {
  // One session. Seed Vault's own answer is logged before the adapter's rewrite, which throws
  // on an MWA 2.0 session whose answer has no features (only its 2.0 branch reads
  // features.includes), so a failure there also says the session is MWA 2.0.
  await w.connectAnd(async (wallet) => {
    const raw = await wallet.get_capabilities();
    log(`Seed Vault's answer: ${JSON.stringify(raw)}`);
    log(raw.features
      ? "it has features, an MWA 2.0 field"
      : "it has no features: an MWA 1.x answer, or an MWA 2.0 one that leaves them out");
    log(`v0 txs: ${(raw.supported_transaction_versions ?? []).map(String).includes("0") ? "yes" : "NO"}`);
    let seen;
    try {
      seen = await wallet.getCapabilities();
    } catch (e) {
      return log(`the adapter's getCapabilities() fails on this answer: ${errorText(e)}`);
    }
    const changed = Object.keys(seen).filter((k) => JSON.stringify(seen[k]) !== JSON.stringify(raw[k]));
    log(changed.length
      ? `the adapter's getCapabilities() adds or changes: ${changed.map((k) => `${k} ${JSON.stringify(seen[k])}`).join(", ")}`
      : "the adapter's getCapabilities() changes nothing");
  });
}

/** Mooner sign-in: signMessages, find the signature in the reply, log in on the server. */
export async function signInCheck({ wallet, w, log }) {
  const time = Math.floor(Date.now() / 1000);
  const msg = new Uint8Array(Buffer.from(loginMessage(wallet.toBase58(), time), "utf8"));
  const payload = await w.signMessages(msg);
  log(`signMessages returned ${payload.length} bytes`);
  const got = pickSignature(msg, payload, wallet);
  if (!got) return log("no 64 bytes in the reply verify against the wallet");
  log(`layout: ${got.layout}`);
  const r = await api.login({ wallet: wallet.toBase58(), time, signature: Buffer.from(got.signature).toString("base64") });
  log(`Mooner sign-in: ${r.token ? "ok" : JSON.stringify(r)}`);
}

/** An open presale this wallet has no seat in, with a minute or more left to join; null
 *  when there's none. The list shows only committed wallets, so each one's seats are read
 *  (one that can't be read is skipped). */
async function joinablePresale(wallet) {
  const soon = Date.now() / 1000 + 60;
  for (const p of await api.presales()) {
    // written so a missing deadline is skipped too
    if (p.state !== "OPEN" || !(Number(p.deadlineTs) >= soon)) continue;
    const one = await api.presale(p.presale).catch(() => null);
    if (one && !one.seats.some((s) => s.user === wallet.toBase58())) return p;
  }
  return null;
}

/** Question 1: Seed Vault signs Mooner's entry tx (v0, the gate's key in it), and the gate
 *  would still co-sign what comes back. It joins a real open presale when there is one, so
 *  a pre-sign simulation can pass. Signed only. */
export async function entryCheck({ wallet, w, log, connection }) {
  const info = await api.info();
  log(`uses the server's cluster (${info.cluster}), whatever the Network button says`);
  const pid = new PublicKey(info.program);
  const gate = new PublicKey(info.gate);
  const validators = info.ers.map((e) => new PublicKey(e.validator));
  const deposit = BigInt(info.numbers.MIN_SEAT);
  const open = await joinablePresale(wallet);
  if (open) log(`joins open presale ${open.presale} (ER validator ${open.validator})`);
  else log("no open presale right now, so this join names one that doesn't exist and fails simulation: a refusal here is inconclusive");
  const presale = open ? new PublicKey(open.presale) : Keypair.generate().publicKey;
  const validator = open ? new PublicKey(open.validator) : validators[0];
  const lamports = BigInt(await api.balance(wallet));
  // rents are read on the app's network; mainnet and devnet charge the same per byte
  const rentOf = async (bytes) => BigInt(await connection.getMinimumBalanceForRentExemption(bytes));
  const [seatRent, recordRent, metadataRent, keep] = await Promise.all([SEAT_LEN, RECORD_LEN, METADATA_LEN, 0].map(rentOf));
  const needs = deposit + seatRent + recordRent + metadataRent + ENTRY_FEE + keep;
  log(`wallet holds ${sol(lamports)} SOL; the join needs about ${sol(needs)} SOL: `
    + `the ${sol(deposit)} deposit, ${sol(seatRent)} seat rent, `
    + `${sol(recordRent + metadataRent)} rent for the delegation record and metadata, `
    + `a ${sol(ENTRY_FEE)} fee, and ${sol(keep)} the wallet must keep`);
  if (lamports < needs) log("that's less, so the join may fail simulation: a refusal here is inconclusive");
  const ixs = joinIxs(pid, { user: wallet, gate, presale, sessionKey: Keypair.generate().publicKey, deposit, validator });
  const { blockhash } = await api.blockhash();
  const before = unsignedTx({
    ixs: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), ...ixs],
    payer: wallet,
    blockhash,
  });
  log(`built at a priority of ${PRIORITY} µLamports per compute unit`);
  const after = await w.signTransactions(VersionedTransaction.deserialize(before.serialize()));
  report(log, before, after, wallet);
  try {
    // the server reads the tx from its bytes, so a legacy tx is checked the way it would be there
    const onServer = VersionedTransaction.deserialize(wireBytes(after));
    log(`the gate would co-sign it: yes (${checkEntryTx(onServer, { pid, gate, validators }).kind})`);
  } catch (e) {
    log(`the gate would co-sign it: NO (${e.message})`);
  }
}

/** Question 2: Seed Vault signs an ER tx (legacy, the ER's blockhash; simulating it on
 *  Solana fails). Signed only. */
export async function erCheck({ wallet, w, log }) {
  const info = await api.info();
  log(`uses the server's cluster (${info.cluster}) and its ER, whatever the Network button says`);
  const pid = new PublicKey(info.program);
  const er = info.ers[0];
  log(`ER: ${er.url}`);
  const { blockhash } = await connect(er.url).getLatestBlockhash("confirmed");
  const seat = seatPda(pid, Keypair.generate().publicKey, wallet); // no such seat
  const ixs = [I.rotateKey(pid, { user: wallet, seat, key: Keypair.generate().publicKey })];
  const after = await w.signTransactions(unsignedErTx({ ixs, payer: wallet, blockhash }));
  report(log, unsignedErTx({ ixs, payer: wallet, blockhash }), after, wallet);
}

/** Question 3: what Seed Vault does to a tx with no compute-budget instructions. On devnet
 *  this also answers whether it signs for devnet. Signed only. */
export async function noFeeCheck({ wallet, w, log, connection }) {
  const lamports = await connection.getBalance(wallet, "confirmed");
  log(`wallet holds ${sol(lamports)} SOL on this network`);
  if (lamports === 0) log("an empty wallet can't pay the fee, so simulation fails: "
    + "a refusal here is expected and says nothing about the network");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const build = () => unsignedTx({ ixs: [memo("mooner spike: no fee", wallet)], payer: wallet, blockhash });
  const after = await w.signTransactions(build());
  report(log, build(), after, wallet);
}

// Send memo sends at most once per network until the app is force-stopped. `sends` lives at
// module scope, so it outlives the screen: a network switch, the provider or the whole App
// remounting (Android recreating the activity while Seed Vault is in front). Leaving the app
// and coming back doesn't empty it either (runner.js FORCE_STOP); ending the process, or a JS
// reload, does. A network's entry is set before the tx goes to the wallet. It stays unless
// Seed Vault's answer shows nothing was sent (or no session started): then it's removed, and
// Send memo can be tried again. Any other ending (the adapter's own 90 s timeout, endSession
// failing after a good send, signed but not submitted, no answer yet) leaves it: the memo may
// have landed. The key is the connection's endpoint; each network in SpikeScreen.js has
// exactly one.
const sends = new Map(); // connection.rpcEndpoint -> { connection, wallet, slot, build, sig, waiting }
// The last send Seed Vault refused, per network, keyed as `sends`. A wallet should refuse only
// what it didn't send, but if one sent it anyway, the memo can land: the next Send memo looks
// for it first, and sends nothing if it's there. It can land until its blockhash expires, at
// the lastValidBlockHeight that came with it: 150 blocks on (both public RPCs), and a block
// takes at least a slot, 0.23-0.27 s on both today, so tens of seconds at the least and more
// when slots are skipped or the network is congested. A retap in that time that doesn't find
// it yet sends a second memo. That's accepted: waiting the blockhash out would hold up the
// retry after every decline.
const refused = new Map();
const SEND_MEMO = "mooner spike: send";
const READ_TRIES = 5;
const LOOKUP_LIMIT = 1000; // the most getSignaturesForAddress returns

// Errors that mean nothing was sent:
// - Seed Vault's JSON-RPC errors, which the protocol lib turns into
//   SolanaMobileWalletAdapterProtocolError with the wallet's numeric code (index.native.js
//   281-294; the codes object is at 34-41): all but ERROR_NOT_SUBMITTED (-4: signed, then the
//   submit failed, so it may be out there). A decline is ERROR_NOT_SIGNED (-3);
// - a session that never started (SolanaMobileWalletAdapterModule.kt 116-117, 149, 154, which
//   the lib turns into SolanaMobileWalletAdapterError with that code): no wallet, the user
//   left before it connected, or it didn't connect in time.
const NOT_SENT_CODES = new Set([-1, -2, -3, -5, -100]);
const NO_SESSION = new Set([
  "ERROR_WALLET_NOT_FOUND",
  "Session not established: Local association cancelled by user",
  "Timed out waiting for local association to be ready",
]);
const refusedByWallet = (e) => e?.name === "SolanaMobileWalletAdapterProtocolError" && NOT_SENT_CODES.has(e.code);
const noSession = (e) => e?.name === "SolanaMobileWalletAdapterError" && NO_SESSION.has(e.code);
const OVERTAKEN = "another Send memo on this network went ahead while this one waited: "
  + "this tap sends nothing; tap Send memo again";

/** The one send: a memo at the app's price (limit 50,000 CU, 100,000 µLamports), so the fee
 *  should be 5,000 + 5,000 lamports. Reads back what landed and what it cost. */
export async function sendCheck({ wallet, w, log, connection, retryMs = 2_000 }) {
  const net = connection.rpcEndpoint;
  if (sends.has(net)) return refuse(sends.get(net), log, retryMs);
  const last = refused.get(net);
  if (last) {
    const { hit, unsure, forGood } = await find(last);
    // Another tap (a screen from before a remount has its own) may have moved on during the
    // lookup: its send is under way or latched, or it ended one Seed Vault refused, which this
    // lookup never checked (and whose memo it mustn't take for this one's).
    if (sends.has(net)) return refuse(sends.get(net), log, retryMs);
    if (refused.get(net) !== last) return log(OVERTAKEN);
    if (unsure) {
      log(unsure);
      const next = forGood ? `to send another, ${FORCE_STOP}` : "tap Send memo to look again";
      return log(`so this tap sends nothing: Seed Vault refused the last Send memo on this network, `
        + `and whether that one landed isn't known; ${next}`);
    }
    refused.delete(net);
    if (hit) {
      last.sig = hit.signature;
      sends.set(net, last);
      log(`the send Seed Vault refused landed anyway: ${hit.signature}${failed(hit)}`);
      return readBack(last, log, retryMs);
    }
    // not found (yet: it can still land until its blockhash expires, see `refused`)
    log(`the send Seed Vault refused isn't on chain (no tx of the wallet's since slot ${last.slot} has the memo); `
      + `sending a new one`);
  }
  const { context, value } = await connection.getLatestBlockhashAndContext("confirmed");
  // Another tap may also have moved on while the blockhash came. What this tap found in
  // `refused` is gone by now, so an entry there is a refusal this tap never looked up.
  if (sends.has(net)) return refuse(sends.get(net), log, retryMs);
  if (refused.has(net)) return log(OVERTAKEN);
  const build = () => unsignedTx({
    ixs: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      memo(SEND_MEMO, wallet),
    ],
    payer: wallet,
    blockhash: value.blockhash,
  });
  const tx = build();
  const send = { connection, wallet, slot: context.slot, build, sig: null, waiting: true };
  sends.set(net, send);
  let sig;
  try {
    sig = await w.signAndSendTransactions(tx, context.slot);
  } catch (e) {
    send.waiting = false;
    // (unless a lookup from another screen found it meanwhile: then the answer is wrong)
    if (!send.sig && (refusedByWallet(e) || noSession(e))) {
      sends.delete(net);
      if (refusedByWallet(e)) refused.set(net, send); // no session: the wallet never had it
      throw e;
    }
    if (await unclear(send, errorText(e), log, retryMs)) return;
    throw e;
  }
  send.waiting = false;
  // An answer with no signature (not per spec: the adapter returns signatures[0] of what Seed
  // Vault answered, index.native.mjs 317-331) doesn't say whether the memo went out, so it's
  // treated like an error that may have sent it. A signature a lookup from another screen
  // found meanwhile is kept.
  if (sig) send.sig = sig;
  else if (!send.sig) {
    const why = "Seed Vault's answer has no signature";
    if (await unclear(send, why, log, retryMs)) return;
    throw new Error(why);
  }
  log(`sent: ${send.sig}`);
  // a confirm that throws (the blockhash expired, say) still gets the read-back: the tx may have landed
  try {
    const done = await connection.confirmTransaction(
      { signature: send.sig, blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight },
      "confirmed",
    );
    log(done.value.err ? `failed: ${JSON.stringify(done.value.err)}` : "confirmed");
  } catch (e) {
    log(`confirmation didn't come back (${errorText(e)}); reading it anyway`);
  }
  await readBack(send, log, retryMs);
}

/** Seed Vault's answer (`why`) doesn't say whether the memo went out: looks for it. True
 *  when it's there (and read back); otherwise says the latch stays, and why nothing's known. */
async function unclear(send, why, log, retryMs) {
  const { hit, unsure } = await find(send);
  if (hit) {
    landed(send, hit, log);
    log(`the adapter then reported: ${why}`);
    await readBack(send, log, retryMs);
    return true;
  }
  log(`the memo may have landed (${why}), so Send memo won't send again on this network `
    + `until the app is force-stopped and opened again`);
  log(unsure ?? notThere(send));
  return false;
}

/** A tap while this network has a send: says why nothing is sent, and looks for a send that
 *  has no answer yet. `waiting`: its check is still waiting for Seed Vault (a screen from
 *  before a remount has it); a decline then clears it. */
async function refuse(send, log, retryMs) {
  if (send.sig) return log(`already sent ${send.sig} on this network; to send another, ${FORCE_STOP}`);
  if (send.waiting) log(`an earlier Send memo on this network is still waiting for Seed Vault: this tap sends nothing; `
    + `if its prompt is declined, Send memo works again; if it never answers, ${FORCE_STOP}`);
  else log(`an earlier Send memo on this network may have landed: this tap sends nothing; to send another, ${FORCE_STOP}`);
  const { hit, unsure } = await find(send);
  if (!hit) return log(unsure ?? notThere(send));
  landed(send, hit, log);
  await readBack(send, log, retryMs);
}

/** Looks for the memo among the wallet's txs from the send's slot on (read only): { hit }
 *  when it's there, {} when it isn't, { unsure: why } when that can't be told, with
 *  `forGood` when looking again can't tell either. */
async function find(send) {
  let recent;
  try {
    recent = await send.connection.getSignaturesForAddress(send.wallet, { limit: LOOKUP_LIMIT }, "confirmed");
  } catch (e) {
    return { unsure: `looking for it failed (${errorText(e)}); look up ${send.wallet.toBase58()} on an explorer` };
  }
  const hit = recent.find((t) => t.slot >= send.slot && (t.memo ?? "").includes(SEND_MEMO));
  if (hit) return { hit };
  // Newest first. A list shorter than the limit is all the RPC has for the wallet (a wallet
  // first funded after the send has no tx older than it), and a full one that reaches back
  // past the send's slot holds every tx since. A full one that doesn't reach back never will:
  // new txs only push it further up. An empty one proves nothing: a public RPC can answer []
  // for an address with txs (both do for the Memo program's).
  const explorer = `look up ${send.wallet.toBase58()} on an explorer`;
  if (recent.length === 0) return { unsure: `the search is incomplete: the RPC returned no txs for the wallet; ${explorer}` };
  if (recent.length === LOOKUP_LIMIT && recent.every((t) => t.slot >= send.slot)) {
    return {
      unsure: `the search is incomplete: all ${LOOKUP_LIMIT} txs the RPC returned are from slot ${send.slot} on, `
        + `and none has the memo; ${explorer}`,
      forGood: true,
    };
  }
  return {};
}
const notThere = (send) => `no tx of the wallet's since slot ${send.slot} has the memo: `
  + `if its Seed Vault prompt is still open, approve or decline it; tap Send memo later to look again`;
const failed = (hit) => (hit.err ? ` (failed: ${JSON.stringify(hit.err)})` : "");
function landed(send, hit, log) {
  send.sig = hit.signature;
  log(`it landed: ${hit.signature}${failed(hit)}`);
}

/** Reads the memo back, a few times: a public RPC can lag behind its own "confirmed". */
async function readBack(send, log, retryMs) {
  let got = null;
  for (let i = 1; i <= READ_TRIES && !got; i++) {
    if (i > 1) await sleep(retryMs);
    got = await send.connection.getTransaction(send.sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch((e) => {
      log(`read-back ${i}/${READ_TRIES} failed: ${errorText(e)}`);
      return undefined;
    });
    if (got === null) log(`read-back ${i}/${READ_TRIES}: not there yet`);
  }
  if (!got) return log(`couldn't read it back; look it up on an explorer: ${send.sig}`);
  if (got.version !== 0) log(`landed as version ${got.version}`);
  const c = changes(send.build(), new VersionedTransaction(got.transaction.message));
  log(c.length ? `what landed differs: ${c.join("; ")}` : "what landed is what the app built");
  log(got.meta ? `fee paid: ${got.meta.fee} lamports (expected 10000)` : "the reply has no fee (meta is null); look it up on an explorer");
}
```

- [ ] **Step 3: `mobile/src/runner.js`**

It runs the screen's checks one at a time. React Native's fetch never times out, so a check that runs past `TIMEOUT_MS` is given up on, and until a timed-out check that uses the wallet ends, no other check that uses the wallet starts.

```js
// Runs the screen's checks one at a time. React Native's fetch never times out, so a check
// that runs past TIMEOUT_MS is given up on and the screen comes back. A check that uses the
// wallet may still be running then (its Seed Vault prompt open, or not opened yet, or its RPC
// calls after the wallet not answered); until it ends, this runner starts no other check that
// uses the wallet, so the screen doesn't queue a second Seed Vault session behind it. That is
// all it guards: it can't see a check the adapter ended by its own 90 s timeout, or one from
// before Android recreated the screen. That Send memo sends at most once is sendCheck's own
// latch (`sends` in checks.js), not this.
// Plain JS (no React Native), so it runs in Node too.

export const TIMEOUT_MS = 120_000;

/** An error's message, after its code when it has one. The wallet adapter's codes say what
 *  happened ("Timed out waiting for response", "Failed to end session"); the message under
 *  them is often only a Java class name (React Native's PromiseImpl.kt falls back to it). */
export function errorText(e) {
  const text = e?.message ?? String(e);
  const code = e?.code;
  if (code === undefined || code === null || code === text) return text;
  return typeof code === "number" ? `${text} (code ${code})` : `${code}: ${text}`;
}
/** What clears what a check left behind (sendCheck's latch, the adapter's session lock):
 *  leaving the app and coming back doesn't, since React Native keeps the JS runtime when the
 *  activity goes (ReactDelegate.kt onHostDestroy, 164-175: the surface stops, the host only
 *  changes lifecycle state, ReactHostImpl.kt 313-322 and 890-894). Ending the process does. */
export const FORCE_STOP = "force-stop the app (swipe it away in Recents, or Settings → Force stop) and open it again";
const WHAT_NOW = `if its Seed Vault prompt is open, approve or decline it; `
  + `if none is (it hasn't opened yet, or was already answered), wait for it to finish, or ${FORCE_STOP}`;

/** Waits for `promise` up to `ms`: { ok: true } or { ok: false, error } once it settles,
 *  null if it's still running then. */
function waitUpTo(promise, ms) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const settled = promise.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
  return Promise.race([settled, late]).finally(() => clearTimeout(timer));
}

/** `show(line)` puts a line on the screen; `setBusy(bool)` dims the buttons. */
export function makeRunner({ show, setBusy, timeoutMs = TIMEOUT_MS }) {
  let busy = false;
  let stranded = null; // the label of a timed-out check that uses the wallet and hasn't ended

  /** Runs `check(log)` unless a check is running (then the tap does nothing). `usesWallet`:
   *  it opens a Seed Vault session or changes the saved authorization, so it waits for a
   *  timed-out one to end. The check's lines go through `log`, marked with its label (which
   *  names its network) once it's late. */
  async function run(label, check, { usesWallet }) {
    if (busy) return;
    if (usesWallet && stranded) return show(`blocked: ${stranded} timed out and is still running; ${WHAT_NOW}`);
    busy = true;
    setBusy(true);
    show(`--- ${label}`);
    let late = false;
    const log = (line) => show(late ? `[late: ${label}] ${line}` : line);
    const work = Promise.resolve().then(() => check(log)); // a check that throws at once fails like any other
    const r = await waitUpTo(work, timeoutMs);
    if (!r) {
      late = true;
      show(`error: timed out after ${timeoutMs / 1000} s`);
      if (usesWallet) {
        stranded = label;
        show(`${label} is still running, and checks that use the wallet wait for it: ${WHAT_NOW}`);
      }
      work
        .then(() => "ok", (e) => `error: ${errorText(e)}`)
        .then((how) => {
          if (usesWallet) stranded = null;
          show(`${label} finished late: ${how}`);
        });
    } else if (!r.ok) show(`error: ${errorText(r.error)}`);
    busy = false;
    setBusy(false);
  }

  return { run, show, isBusy: () => busy };
}
```

- [ ] **Step 4: `mobile/src/SpikeScreen.js`**

```js
// Piece 0: one bare screen that asks Seed Vault the spec's questions. Each result is shown
// and logged: adb logcat -s ReactNativeJS | grep "\[spike\]"
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PublicKey } from "@solana/web3.js";
import { MobileWalletProvider, useMobileWallet } from "@wallet-ui/react-native-web3js";
import { capabilitiesCheck, engineCheck, entryCheck, erCheck, noFeeCheck, sendCheck, signInCheck } from "./checks";
import { makeRunner } from "./runner";

const NETS = {
  mainnet: { chain: "solana:mainnet", endpoint: "https://api.mainnet-beta.solana.com" },
  devnet: { chain: "solana:devnet", endpoint: "https://api.devnet.solana.com" },
};
const IDENTITY = { name: "Mooner", uri: "https://mooner.family", icon: "assets/icon-180.png" };

/** Where one network's wallet authorization is kept. The library's default is one key for
 *  every network, so after a switch Connect would send the other network's auth_token and
 *  the screen would show its account. */
function authCache(net) {
  const key = `mwa-authorization:${net}`;
  return {
    async get() {
      const saved = await AsyncStorage.getItem(key);
      if (!saved) return undefined;
      try {
        // as the library's own cache does: each account's publicKey comes back a PublicKey
        return JSON.parse(saved, (k, v) => (k === "publicKey" ? new PublicKey(v) : v));
      } catch {
        return undefined;
      }
    },
    set: (auth) => AsyncStorage.setItem(key, JSON.stringify(auth)),
    clear: () => AsyncStorage.removeItem(key),
  };
}
const CACHES = { mainnet: authCache("mainnet"), devnet: authCache("devnet") };

// The log, the busy flag and the runner live here, above the wallet provider: switching
// network remounts the provider (its own connection and authorization) and keeps the log,
// and a timed-out check keeps the wallet blocked on both networks. Nothing switches or
// clears while a check runs.
export default function App() {
  const [net, setNet] = useState("mainnet");
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [runner] = useState(() =>
    makeRunner({
      show: (line) => {
        console.log(`[spike] ${line}`);
        setLines((l) => [...l, line]);
      },
      setBusy,
    }),
  );
  const whenIdle = (fn) => () => !runner.isBusy() && fn();
  return (
    <MobileWalletProvider
      key={net}
      cache={CACHES[net]}
      chain={NETS[net].chain}
      endpoint={NETS[net].endpoint}
      commitmentOrConfig="confirmed"
      identity={IDENTITY}
    >
      <Spike
        net={net}
        lines={lines}
        runner={runner}
        busy={busy}
        toggleNet={whenIdle(() => setNet(net === "mainnet" ? "devnet" : "mainnet"))}
        clear={whenIdle(() => setLines([]))}
      />
    </MobileWalletProvider>
  );
}

function Spike({ net, lines, runner, busy, toggleNet, clear }) {
  const w = useMobileWallet();
  const scroll = useRef(null);
  const wallet = w.account?.publicKey ?? null;

  // needsWallet: it needs a connected account. usesWallet: it opens a Seed Vault session or
  // changes the saved authorization. `log` is the runner's for this one run.
  const tap = (name, check, { needsWallet = true, usesWallet = true } = {}) => () =>
    runner.run(`${name} (${net})`, (log) => {
      if (needsWallet && !wallet) throw new Error("connect first");
      return check({ wallet, w, log, connection: w.connection });
    }, { usesWallet });

  const buttons = [
    ["Engine", tap("engine", engineCheck, { needsWallet: false, usesWallet: false })],
    ["Capabilities", tap("capabilities", capabilitiesCheck, { needsWallet: false })],
    ["Connect", tap("connect", async ({ log }) => log(`wallet: ${(await w.connect()).publicKey.toBase58()}`), { needsWallet: false })],
    ["Sign in", tap("sign in", signInCheck)],
    ["Entry tx", tap("entry tx", entryCheck)],
    ["ER tx", tap("ER tx", erCheck)],
    ["No-fee tx", tap("no-fee tx", noFeeCheck)],
    ["Send memo", tap("send memo", sendCheck)],
    // Clears this network's saved authorization on the phone; Seed Vault isn't asked. It waits
    // for a timed-out check: that check's authorize could save the authorization again after.
    ["Disconnect", tap("disconnect", async ({ log }) => (await w.disconnect(), log("disconnected")), { needsWallet: false })],
    [`Network: ${net}`, toggleNet],
    ["Clear", clear],
  ];

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <Text style={s.title}>Mooner spike {wallet ? `· ${wallet.toBase58().slice(0, 6)}…` : "· not connected"}</Text>
      <View style={s.grid}>
        {buttons.map(([label, onPress]) => (
          <Pressable key={label} onPress={onPress} style={[s.button, busy && s.dim]}>
            <Text style={s.buttonText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {/* follows the newest line; the bottom padding keeps it clear of the navigation bar */}
      <ScrollView ref={scroll} style={s.log} contentContainerStyle={s.logEnd} onContentSizeChange={() => scroll.current?.scrollToEnd()}>
        {lines.map((l, i) => (
          <Text key={i} style={s.line} selectable>
            {l}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", paddingTop: 48, paddingHorizontal: 16 },
  title: { color: "#fff", fontSize: 18, fontWeight: "600", marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  button: { backgroundColor: "#222", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  dim: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 15 },
  log: { flex: 1 },
  logEnd: { paddingBottom: 48 },
  line: { color: "#9f9", fontFamily: "monospace", fontSize: 12, marginBottom: 4 },
});
```

The MWA identity's `icon` is relative to `uri`. https://mooner.family/assets/icon-180.png answered HTTP 200 on 2026-09-30.

- [ ] **Step 5: Bundle it and check it has one web3.js**

```bash
cd mobile && npm run bundle:check
```

Expected: the last line is `web3.js copies: 1; files from engine/node_modules: 0`, with exit code 0. Expo also prints a line saying that disabling bytecode is discouraged; that's expected here, because the check greps plain JS.

- [ ] **Step 6: Prove the check can fail**

Switch the resolver off, bundle again, then switch it back:

```bash
cd mobile && sed -i '' 's/const ctx = fromEngine \&\& bare/const ctx = false \&\& bare/' metro.config.js && (sh scripts/check-bundle.sh; echo "exit=$?"); sed -i '' 's/const ctx = false \&\& bare/const ctx = fromEngine \&\& bare/' metro.config.js && grep -c "fromEngine && bare" metro.config.js
```

Expected:
- `web3.js copies: 2` and a non-zero count of engine files (95 on 2026-09-30);
- then `exit=1`;
- then `1`, which confirms the resolver line is restored.

This step needs `engine/node_modules` to be installed. The real check in Step 5 doesn't.

- [ ] **Step 7: Commit (only after the user says to commit)**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/index.js mobile/polyfill.js mobile/metro.config.js mobile/.gitignore mobile/scripts mobile/src mobile/assets/icon.png
git commit -m "mobile: Expo app with the Seed Vault spike screen"
```

---

## Task 8: Run the checks on the Seeker

The user is at the phone for this task. Claude builds, installs and reads the logs; the user taps the buttons and approves each Seed Vault prompt.

**Files:** none. `mobile/android/` is generated here and is gitignored.

- [ ] **Step 1: The phone is there**

```bash
adb devices
```

Expected: one line that ends in `device` (see Task 1, Step 3).

- [ ] **Step 2: Build and install**

```bash
cd mobile && npm run android
```

If `mobile/android/` doesn't exist, this first generates it with Expo prebuild. An existing one is used as it is, so delete it after changing `app.json`. Then Gradle builds the release APK, and it's installed and opened on the phone. The first build downloads Gradle and its dependencies.

Expected: `BUILD SUCCESSFUL`, and the app opens on the Seeker showing "Mooner spike · not connected". The install keeps the app's data, so if an earlier install saved a mainnet authorization, the title shows the start of that address instead. If more than one device is attached, pass `-- --device <name>`.

- [ ] **Step 3: Collect the logs**

Run this in the background (Bash `run_in_background`) and leave it running:

```bash
adb logcat -c && adb logcat -s ReactNativeJS > /private/tmp/claude-501/-Users-yordanlasonov-Documents-GitHub-mooner/d5033305-22e1-4ff8-911a-49e663975b3d/scratchpad/spike.log
```

Read the results with `grep "\[spike\]" <that file>`. If the session's scratchpad path is different, use the current one.

- [ ] **Step 4: The checks, in this order**

The user taps each button. The network starts on mainnet. For each check, write down every `[spike]` line. Each check's lines follow `--- <name> (<network>)`. Below, `<force-stop>` stands for runner.js's `FORCE_STOP`: `force-stop the app (swipe it away in Recents, or Settings → Force stop) and open it again`.

| # | Button | What the user approves | Good result | What a bad result means |
|---|---|---|---|---|
| 1 | Engine | nothing | `golden join tx: same bytes as Node`, `golden ER tx (legacy): same bytes as Node`, `text sorting matches Node (web3.js's account order): yes`, `one web3.js: yes`, `wallet-ui's Connection is the app's web3.js: yes`; record the device locale line too | `golden join tx: DIFFERENT (<digest>)`: the bundle encodes differently; stop and debug the polyfills and the bundle before anything else. `one web3.js: NO` or `wallet-ui's Connection is the app's web3.js: NO`: two copies of web3.js at run time; stop and fix that first. Sorting NO: see "Engine" below |
| 2 | Capabilities | nothing: it asks without authorizing | `Seed Vault's answer: <JSON>`, then `v0 txs: yes` | `v0 txs: NO`: Seed Vault doesn't list v0 txs, and the entry tx is v0; record it for question 1 |
| 3 | Connect | Seed Vault's connect screen | `wallet: <address>` | `error: <message> (code -1)`: see "Wallet errors" below |
| 4 | Sign in | a message signature | `signMessages returned <n> bytes`, `layout: <layout>`, `Mooner sign-in: ok` | `no 64 bytes in the reply verify against the wallet`: record n; `pickSignature` needs a new layout |
| 5 | Entry tx | a tx signature (never sent) | `joins open presale <presale> (ER validator <validator>)`, `Seed Vault changed: <changes>` or `Seed Vault changed nothing`, `its signature covers the tx it returned: yes`, `the gate would co-sign it: yes (join)` | `the gate would co-sign it: NO (<reason>)` or `its signature covers the tx it returned: NO`: entry txs switch to wallet-sends (spec, question 1). A refusal is conclusive only if the preconditions held; see "Entry tx" below |
| 6 | ER tx | a tx signature (never sent), or a refusal | a signed result plus `its signature covers the tx it returned: yes` | a refusal or error: ER txs get signed by the session key only (spec, question 2) |
| 7 | No-fee tx | a tx signature (never sent) | `wallet holds <n> SOL on this network`, then whatever it says: whether it added a compute-unit price | a price added: the phone always sets 100,000 (spec, question 3). A refusal after `wallet holds 0 SOL on this network`: inconclusive; fund the wallet and rerun |
| 8 | Network → devnet, then Connect, then No-fee tx | connect and a signature on devnet | `wallet holds <n> SOL on this network` with n above 0, then a signed result | a refusal with n above 0: Seed Vault doesn't sign for devnet, so the phone flows are proven on mainnet (spec, "Testing"). A refusal after `wallet holds 0 SOL on this network`: inconclusive; fund and rerun |
| 9 | Network → mainnet, then Send memo (Connect first only if the title says "not connected") | **a real mainnet send, fee 0.00001 SOL**; the user approves it | `sent: <sig>`, `confirmed`, `what landed is what the app built` or the differences, `fee paid: <n> lamports (expected 10000)` | a fee other than 10,000: Seed Vault changed the price or limit on a send; record the numbers. Other lines: see "Send memo" below |

Sign-in (4) calls `POST /api/login` on app.mooner.family with the user's own wallet, the same as signing in on the web.

**Engine (row 1)**
- `text sorting matches Node (web3.js's account order): NO: <order>` is followed by `so legacy txs built on this phone may order their accounts differently from Node's: the golden ER tx above is expected to differ too`. Record both lines.
- With sorting yes, `golden ER tx (legacy): DIFFERENT (<digest>)` means the bundle encodes legacy txs differently: stop and debug as for the join tx.
- Record `device locale: <locale>; "en" sorting resolves to <locale>` (or `device locale: unknown (<error>)`) either way. A tailored locale is the case that could sort differently.

**Capabilities (row 2)**
- The check asks by the MWA method's own name, `get_capabilities`, so `Seed Vault's answer: <JSON>` is Seed Vault's own. Record that line whole.
- The next line is `it has features, an MWA 2.0 field` or `it has no features: an MWA 1.x answer, or an MWA 2.0 one that leaves them out`.
- The last line compares it with the adapter's `getCapabilities()`, which rewrites the answer: `the adapter's getCapabilities() adds or changes: <fields>`, `the adapter's getCapabilities() changes nothing`, or `the adapter's getCapabilities() fails on this answer: <error>`. What Seed Vault supports is in its own answer, not the adapter's.
- An error line instead: record it and its code.

**Wallet errors**
- A Seed Vault refusal or protocol error logs `error: <message> (code <n>)`. Record n. The codes are the MWA protocol library's:
  - -3 (`ERROR_NOT_SIGNED`): declined, not signed;
  - -4 (`ERROR_NOT_SUBMITTED`): signed, then the submit failed; the tx may be out there;
  - -1 (`ERROR_AUTHORIZATION_FAILED`): authorization failed.
- An adapter error with a text code logs `error: <code>: <message>`.
- Connect `error: <message> (code -1)`: treat it as a stale saved auth_token. The adapter's own retry without the token never fires: it checks the error before the protocol library converts it. Tap Disconnect, which clears this network's saved authorization on the phone (Seed Vault isn't asked), then Connect, which authorizes afresh. Whether Seed Vault answers a stale token with -1 is unverified; record it if seen.

**Entry tx (row 5)**
- Entry tx and ER tx use the server's cluster and say so first: `uses the server's cluster (<cluster>), whatever the Network button says` (ER tx: `uses the server's cluster (<cluster>) and its ER, whatever the Network button says`).
- A refusal is conclusive only if both of these held at the tap:
  - a joinable presale was live: OPEN, at least 60 s to its deadline, and no seat for this wallet. The log then shows `joins open presale <presale> (ER validator <validator>)`;
  - the wallet held at least the "needs about" figure in `wallet holds <x> SOL; the join needs about <y> SOL: the <d> deposit, <s> seat rent, <r> rent for the delegation record and metadata, a <f> fee, and <k> the wallet must keep`. At mainnet rents with the 0.1 SOL deposit (the server's `MIN_SEAT`), y was 0.10440403 SOL on 2026-09-30. The figure is for the tx as the app builds it; if Seed Vault adds instructions, the fee is higher.
- A refusal after either of these lines is inconclusive, since the join fails simulation for its own reasons: `no open presale right now, so this join names one that doesn't exist and fails simulation: a refusal here is inconclusive` or `that's less, so the join may fail simulation: a refusal here is inconclusive`. Rerun when both preconditions hold. A refusal with neither line means Seed Vault won't sign Mooner's v0 entry tx.
- A signature counts even after either line: `checkEntryTx`, behind the gate line, runs on the phone and reads no chain state.
- On 2026-09-30, `GET /api/presales` returned `{"presales":[]}`.

**Devnet (row 8)**
- Each network has its own connection and saved authorization. On devnet the title says "not connected" until Connect is tapped there, unless a devnet authorization was saved earlier. Switching back to mainnet shows mainnet's account again.
- Fund the wallet on devnet before tapping No-fee tx. Its address is the one Connect logs on devnet.
- Network and Clear do nothing while a check runs.

**Send memo (row 9)**
- It sends at most once per network per app process. The latch is set before the tx goes to Seed Vault. It's cleared only when Seed Vault's answer shows nothing was sent (error code -1, -2, -3, -5 or -100, or no session started), or by a force-stop.
- `already sent <sig> on this network; to send another, <force-stop>`: this network's one send is done.
- `the memo may have landed (<error>), so Send memo won't send again on this network until the app is force-stopped and opened again`: Seed Vault's answer doesn't say whether the memo went out, for example an error with code -4, or `Seed Vault's answer has no signature`. The latch holds and the app looks for the memo.
- A tap while this network's send is unresolved sends nothing. It logs `an earlier Send memo on this network is still waiting for Seed Vault: this tap sends nothing; if its prompt is declined, Send memo works again; if it never answers, <force-stop>` or `an earlier Send memo on this network may have landed: this tap sends nothing; to send another, <force-stop>`, then looks for the memo.
- The lookup searches the wallet's txs from the send's slot on. It logs one of:
  - `it landed: <sig>`, with ` (failed: <error>)` if it failed on chain: record it as the one send. If `the adapter then reported: <error>` follows, that isn't a failure: the memo landed;
  - `no tx of the wallet's since slot <slot> has the memo: if its Seed Vault prompt is still open, approve or decline it; tap Send memo later to look again`;
  - `looking for it failed (<error>); look up <wallet> on an explorer`;
  - `the search is incomplete: the RPC returned no txs for the wallet; look up <wallet> on an explorer`;
  - `the search is incomplete: all 1000 txs the RPC returned are from slot <slot> on, and none has the memo; look up <wallet> on an explorer`.
- After Seed Vault refuses a send (one of those codes), the next Send memo on that network looks for the refused memo first:
  - `the send Seed Vault refused landed anyway: <sig>`, with ` (failed: <error>)` if it failed: record it as the one send, and as a Seed Vault finding (it refused, and the memo went out anyway);
  - `the send Seed Vault refused isn't on chain (no tx of the wallet's since slot <slot> has the memo); sending a new one`;
  - after a failed lookup or an empty list: `so this tap sends nothing: Seed Vault refused the last Send memo on this network, and whether that one landed isn't known; tap Send memo to look again`;
  - after a full list of 1000: `so this tap sends nothing: Seed Vault refused the last Send memo on this network, and whether that one landed isn't known; to send another, <force-stop>`.
- After a decline, wait before tapping Send memo again. A refused tx can still land until its blockhash expires, 150 blocks on. A retap before then that doesn't find it sends a second memo.
- `another Send memo on this network went ahead while this one waited: this tap sends nothing; tap Send memo again`: tap it again.
- Confirm and read-back lines: `failed: <error>`, `confirmation didn't come back (<error>); reading it anyway`, `read-back <i>/5: not there yet`, `read-back <i>/5 failed: <error>`, `landed as version <version>`, `what landed differs: <changes>`. If it ends with `couldn't read it back; look it up on an explorer: <sig>` or `the reply has no fee (meta is null); look it up on an explorer`, read the fee from an explorer.

**Timeouts and blocked checks**
- A check still running after the runner's `TIMEOUT_MS` logs `error: timed out after <n> s`, and the buttons come back.
- For a check that uses the wallet, the next line is `<label> is still running, and checks that use the wallet wait for it: if its Seed Vault prompt is open, approve or decline it; if none is (it hasn't opened yet, or was already answered), wait for it to finish, or <force-stop>`. `<label>` is `<name> (<network>)`.
- Until it ends, every button that uses the wallet (all but Engine, Network and Clear) only logs `blocked: <label> timed out and is still running; <advice>`, with the same advice.
- Its later lines appear as `[late: <label>] <line>`, then `<label> finished late: ok` or `<label> finished late: error: <error>`. A timed-out Send memo can still send once approved: record its late `sent: <sig>`, `confirmed` and `fee paid: <n> lamports (expected 10000)` lines as that one send.

**Force-stop**
- `<force-stop>` means exactly that. Leaving the app and coming back keeps the JS runtime, so it clears neither the Send memo latch nor the adapter's session lock. Ending the process does.
- If Send memo still logs `already sent <sig> on this network; to send another, <force-stop>` after the app was swiped away in Recents, use Settings → Force stop. Whether swiping ends the process on the Seeker is unverified.

- [ ] **Step 5: Screenshot proof**

```bash
adb exec-out screencap -p > /private/tmp/claude-501/-Users-yordanlasonov-Documents-GitHub-mooner/d5033305-22e1-4ff8-911a-49e663975b3d/scratchpad/spike.png
```

Show it to the user, then stop the background logcat.

---

## Task 9: Record Seed Vault's answers

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md` (the "Seed Vault questions" section)
- Memory: a new `mooner-seed-vault-answers.md`, plus its line in `MEMORY.md`

- [ ] **Step 1: Write the answers into the spec**

Directly below the questions table in "## Seed Vault questions (piece 0 settles them)", add a section titled `**Answers (Seeker, <date of Task 8>):**`. In it, fill in this table from the Task 8 log, copying the log lines exactly:

```markdown
| Question | What Seed Vault did (log lines) | Decision |
|---|---|---|
| The phone builds txs as Node does (Engine: golden join and ER txs, text sorting, device locale, one web3.js) | … | … |
| What Seed Vault reports it supports (Capabilities: its own answer; v0 txs yes / NO) | … | (feeds the entry-tx row) |
| Signs the entry tx; gate still co-signs | … | keep server-sends / switch to wallet-sends |
| Signs an ER tx | … | wallet may sign ER txs / session key only |
| Adds a fee to a tx with none | … | phone priority: 100,000 µLamports on every tx |
| Signs for devnet | … | phone flows tested on devnet / on mainnet |
| signMessages reply layout | … | (pickSignature already handles it) |
| Fee on the real send | … lamports (expected 10,000) | … |
| What landed on the real send (and any declined send that landed anyway) | … | … |
| Error codes Seed Vault answered with (declines; Connect) | … (code N) | … |
```

How each decision follows from the log:
- **Entry tx.** If the gate would co-sign ("yes") and the signature covers the returned tx ("yes"), keep server-sends. Otherwise the piece 1 plan switches entry txs to wallet-sends.
- **ER tx.** If Seed Vault refused or errored on the ER tx, the wallet never signs ER txs; only the session key does. `flows.js` already tries the session key first.
- **Priority.** The spec already sets the phone's priority to 100,000. Keep it unless Send memo's fee says otherwise.

- [ ] **Step 2: Save to memory**

Write `mooner-seed-vault-answers.md` in the memory folder. Use the frontmatter `name`/`description`/`metadata.type: project` and put in:
- the same answers;
- the date;
- **Why:** these answers shape piece 1;
- **How to apply:** the decisions above.

Link it to `[[mooner-seeker-mobile]]` and `[[mooner-clockin-hackathon]]`, and add its one-line pointer to `MEMORY.md`. Also update `mooner-seeker-mobile.md` if an answer contradicts it. Right now that file says Seed Vault signs only and bumps the priority to 100k µL.

- [ ] **Step 3: Commit the spec (only after the user says to commit)**

```bash
git add docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md
git commit -m "spec: Seed Vault answers from the Seeker spike"
```

---

## Task 10: The shared chain flows (`engine/src/flows.js`)

`engine/src/flows.js` holds everything the site does on chain, so the phone app runs the same code. Task 11 turns `web/src/real/chain.js` into a thin wrapper over it. `makeFlows` takes:
- `api`: `makeApi(...)`;
- `subscribe`: the app's live socket;
- `keys`: its session-key store, which is async and may throw;
- `priority`: µLamports per CU on entry txs. The default is `PRIORITY`, 50,000. The web passes none; the phone is to pass 100,000 (the spec);
- `rpc`: Solana for `getBack`, as a URL or a `Connection`. The default is the public RPC of the server's cluster (`PUBLIC_RPCS[info.cluster]`).

What else the code does:
- **Session keys.** They go through `keys.get`/`keys.set` in try/catch, and each key is kept in memory too. A store that fails costs a wallet signature (a `rotate_key`) only after the app restarts. Keys decode with `Buffer.from(s, "base64")`, which also reads the `btoa` format the site stored (tested).
- **No Node imports.** sha256 comes from `@noble/hashes`, and `Buffer` is the global one (Node's, or the app's polyfill). Text a wallet signs is a plain `Uint8Array`: a `Buffer` serializes differently as JSON.
- **Costs.** `joinCost` and `openCost` return what a join or an open takes from the wallet besides the SOL it puts in: rents, the fee, and the rent of a 0-byte account, which the wallet must keep. A join pays for the seat, its delegation record (96 bytes) and its delegation metadata. An open pays for the presale and the seat, with a record and metadata for each. Metadata size comes from the account's seeds (`metadataLen`): 100 bytes for the presale, 133 for a seat. They are plain exports, not part of `makeFlows`. With no arguments they read rents from mainnet's public RPC and price the fee at 50,000. Each rent is read once per RPC and size; a failed read isn't kept.
- **Fees.** `joinFee` counts 2 signatures and 403,000 CU; `openFee` counts 3 signatures and 603,000 CU. Both add `WALLET_CU`: 400,000 CU for the two Lighthouse ixs a wallet may add (Solflare adds two).
- **Timeouts.** `loadInfo`, each rent read and each of `getBack`'s reads (Solana, the ER, the server) give up after 10 s. `loadInfo` and the rent cache don't keep a failed or timed-out answer.
- **Error names.** A code gets Mooner's error name only when the first `Program <id> failed` log line names Mooner's program. That is `failedWith` in `consts.js`: a program Mooner calls fails first, so the first such line is the innermost failure. `named` (`getBack`'s preflight) and `describeTxError` (failed txs, and the ER's refusals in `erRefuses`) both work this way. `explain` turns those names, a cancel in the wallet and a wallet short of SOL into plain lines; a bare `custom program error` stays as it is.

`flows.js` also needs `failedWith`, the `logs` argument of `describeTxError` (both in `consts.js`) and `txLogs` (`tx.js`). Step 3 adds them.

**Files:**
- Create: `engine/src/flows.js`
- Test: `engine/test/flows.test.js`
- Modify: `engine/src/consts.js`, `engine/src/tx.js`, `engine/server/api.js`

- [ ] **Step 1: Write the failing test**

Create `engine/test/flows.test.js`:

```js
// The chain flows the web app and the phone app share, against fakes: amounts, errors,
// session keys, waiting on the live socket, the mint request, the entry txs as the gate
// sees them, the ledger in a fake ER and getting the SOL back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SendTransactionError, Transaction, VersionedTransaction } from "@solana/web3.js";
import { mintMessage, signMessage, verifySignature } from "../server/auth.js";
import { checkEntryTx } from "../src/cosigner.js";
import { validSeat } from "../src/client.js";
import { DELEGATION_PROGRAM, describeTxError, IX, numbers } from "../src/consts.js";
import { explain, joinCost, joinFee, makeFlows, openCost, openFee, PUBLIC_RPC, sessionKeyName, sol, toLamports } from "../src/flows.js";
import { P, PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, STATE } from "../src/layout.js";
import { presalePda, seatPda } from "../src/pdas.js";
import { budget } from "../src/walletcheck.js";

const BH = "11111111111111111111111111111111";
const VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";
const SOL = 1_000_000_000n;
const tick = () => new Promise((r) => setImmediate(r));
async function until(cond) {
  for (let i = 0; i < 500 && !cond(); i++) await tick();
  assert.ok(cond(), "it never happened");
}

function memoryKeys() {
  const map = new Map();
  return { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => void map.set(k, v) };
}
const stored = (kp) => Buffer.from(kp.secretKey).toString("base64");

function fakeSocket() {
  const topics = new Map();
  const sock = {
    opened: 0, // subscriptions ever opened
    subscribe(topic, fn) {
      sock.opened++;
      topics.set(topic, (topics.get(topic) ?? new Set()).add(fn));
      return () => topics.get(topic).delete(fn);
    },
    push: (topic, msg) => [...(topics.get(topic) ?? [])].forEach((fn) => fn(msg)),
    count: (topic) => topics.get(topic)?.size ?? 0,
  };
  return sock;
}

function seatBytes({ user, presale, sessionKey, deposit = 0n, commit = 0n }) {
  const d = Buffer.alloc(SEAT_LEN);
  d[0] = SEAT_VERSION;
  user.toBuffer().copy(d, S.USER);
  sessionKey.toBuffer().copy(d, S.SESSION_KEY);
  presale.toBuffer().copy(d, S.PRESALE);
  d.writeBigUInt64LE(deposit, S.DEPOSIT);
  d.writeBigUInt64LE(commit, S.COMMIT);
  return d;
}

/** A Presale in `state` with its deadline (unix seconds; default an hour from now). The
 *  rest is zero: getBack reads only these. */
function presaleBytes(state, deadline = Math.floor(Date.now() / 1000) + 3_600) {
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  d[P.STATE] = state;
  d.writeBigInt64LE(BigInt(deadline), P.DEADLINE_TS);
  return d;
}

/** A fake ER (or Solana, with another url): accounts, every tx sent (decoded), what a
 *  simulation answers, and rotate_key applied to the seat as the program does. */
function fakeConn(pid, url = "https://devnet.magicblock.app") {
  const accounts = new Map();
  const c = {
    rpcEndpoint: url,
    sent: [],
    simErr: null,
    simLogs: null, // what a simulation logs
    txLogs: [], // what getTransaction logs
    sims: 0,
    reads: 0,
    confirmed: [],
    put: (key, owner, data) => accounts.set(key.toBase58(), { owner, data, lamports: 1, executable: false }),
    drop: (key) => accounts.delete(key.toBase58()),
    getSlot: async () => 1,
    getAccountInfo: async (k) => (c.reads++, accounts.get(k.toBase58()) ?? null),
    getLatestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    async sendRawTransaction(raw) {
      const tx = Transaction.from(raw);
      c.sent.push(tx);
      for (const ix of tx.instructions) {
        if (ix.programId.equals(pid) && ix.data[0] === IX.ROTATE_KEY) ix.data.subarray(1, 33).copy(accounts.get(ix.keys[1].pubkey.toBase58()).data, S.SESSION_KEY);
      }
      return `sig${c.sent.length}`;
    },
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    simulateTransaction: async () => (c.sims++, { value: { err: c.simErr, logs: c.simLogs } }),
    getTransaction: async () => ({ meta: { logMessages: c.txLogs } }),
    confirmTransaction: async (x) => (c.confirmed.push(x), { value: { err: null } }),
  };
  return c;
}

/** `conn`'s simulations fail with Mooner's code `n` at ix 0, as the logs say. */
function refuse(conn, pid, n) {
  conn.simErr = { InstructionError: [0, { Custom: n }] };
  conn.simLogs = [`Program ${pid} invoke [1]`, `Program ${pid} failed: custom program error: 0x${n.toString(16)}`];
}

/** loadInfo()'s shape, with mainnet numbers and one ER (a fakeConn). */
function fakeInfo() {
  const pid = Keypair.generate().publicKey;
  const er = fakeConn(pid);
  return { pid, gate: Keypair.generate().publicKey, N: numbers(false), er, ers: [{ validator: new PublicKey(VALIDATOR), url: er.rpcEndpoint, conn: er }] };
}

/** A wallet that signs for real and keeps what it was asked; `reject(tx)` says no. */
function fakeWallet() {
  const kp = Keypair.generate();
  const w = {
    publicKey: kp.publicKey,
    asked: [],
    sent: [],
    reject: () => false,
    async signTransaction(tx) {
      w.asked.push(tx);
      if (w.reject(tx)) throw new Error("User rejected the request");
      if (tx instanceof Transaction) tx.partialSign(kp);
      else tx.sign([kp]);
      return tx;
    },
    async sendTransaction(tx, conn, opts) {
      w.sent.push({ tx, conn, opts });
      return "settle-sig";
    },
  };
  return w;
}

/** Mooner's instruction tags in a tx (legacy or v0). */
function tags(tx, pid) {
  if (tx instanceof Transaction) return tx.instructions.filter((i) => i.programId.equals(pid)).map((i) => i.data[0]);
  const keys = tx.message.staticAccountKeys;
  return tx.message.compiledInstructions.filter((ci) => keys[ci.programIdIndex].equals(pid)).map((ci) => ci.data[0]);
}

/** The session key an entry tx (open or join) gives the seat. */
function entryKey(tx, pid) {
  const keys = tx.message.staticAccountKeys;
  const ci = tx.message.compiledInstructions.find((c) => keys[c.programIdIndex].equals(pid) && [IX.JOIN, IX.OPEN_PRESALE].includes(c.data[0]));
  const at = ci.data[0] === IX.JOIN ? 1 : 33; // join: tag, key, deposit; open: tag, feeDest, key, ...
  return new PublicKey(ci.data.slice(at, at + 32));
}

/** The server: co-signs what the gate would sign, and then the seat is in the ER with
 *  the key in the tx (as delegation leaves it). */
function fakeApi(info, { confirmed = true, presale = async () => null } = {}) {
  const api = {
    cosigned: [],
    blockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    async cosign(b64) {
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      api.cosigned.push(tx);
      const e = checkEntryTx(tx, { pid: info.pid, gate: info.gate, validators: [info.ers[0].validator] });
      info.er.put(seatPda(info.pid, e.presale, e.user), info.pid, seatBytes({ user: e.user, presale: e.presale, sessionKey: entryKey(tx, info.pid) }));
      return { status: 200, json: { confirmed } };
    },
    presale,
  };
  return api;
}

const flows = (over = {}) => makeFlows({ api: {}, subscribe: () => () => {}, keys: memoryKeys(), ...over });

test("amounts and errors read plainly", () => {
  assert.equal(sol(1_500_000_000n), "1.5");
  assert.equal(sol(0n), "0");
  assert.equal(toLamports("0.1"), 100_000_000n);
  assert.equal(explain(new Error("custom program error: NoRoom")), "The pool is already full.");
  assert.equal(explain(new Error("User rejected the request")), "You cancelled it in your wallet.");
  assert.equal(explain(new Error("something else")), "something else");
});

test("joinCost: what a join takes from the wallet besides the deposit, as mobile's check counts it plus what a wallet may add; rents read once", async () => {
  const asked = [];
  const rent = (n) => (128 + n) * 5_080; // mainnet's and devnet's rent (CANARY.md)
  const conn = { rpcEndpoint: "https://rent.test", getMinimumBalanceForRentExemption: async (n) => (asked.push(n), rent(n)) };
  const c = await joinCost({ rpc: conn });
  assert.equal(SEAT_LEN, 120);
  assert.deepEqual(c, {
    seat: BigInt(rent(SEAT_LEN)), // 1,259,840
    delegation: BigInt(rent(96) + rent(133)), // the delegation record and metadata
    fee: 50_150n, // 30,150 for the tx as built (mainnet's getFeeForMessage), and 20,000 for two Lighthouse ixs
    keep: BigInt(rent(0)), // what the wallet keeps: 650,240
    total: 4_424_030n,
  });
  assert.deepEqual([...asked].sort((a, b) => a - b), [0, 96, 120, 133]);
  await joinCost({ rpc: conn });
  assert.equal(asked.length, 4, "rent is read once");
  assert.equal((await joinCost({ rpc: conn, priority: 100_000 })).fee, 90_300n);
  assert.equal((await joinCost({ rpc: conn, priority: 1 })).fee, 10_001n, "rounded up");
  // a read that fails isn't kept
  let n = 0;
  const flaky = { rpcEndpoint: "https://flaky.test", getMinimumBalanceForRentExemption: async () => { if (n++ === 0) throw new Error("429 Too Many Requests"); return 1; } };
  await assert.rejects(joinCost({ rpc: flaky }), /429/);
  assert.equal((await joinCost({ rpc: flaky })).total, 4n + 50_150n);
});

test("openCost: what an open takes from the wallet besides the commit; rents read once and shared, a failed read isn't kept", async () => {
  const asked = [];
  const rent = (n) => (128 + n) * 5_080;
  const conn = { rpcEndpoint: "https://rent-open.test", getMinimumBalanceForRentExemption: async (n) => (asked.push(n), rent(n)) };
  const c = await openCost({ rpc: conn });
  assert.equal(PRESALE_LEN, 272);
  assert.deepEqual(c, {
    presale: BigInt(rent(PRESALE_LEN)), // 2,032,000
    seat: BigInt(rent(SEAT_LEN)), // the creator's seat
    // a record each for the presale and the seat, and metadata sized by their seeds: 100 bytes
    // for ["presale", mint], 133 for ["seat", presale, user] (canary open D9eueWee… paid both)
    delegation: 2n * BigInt(rent(96)) + BigInt(rent(100) + rent(133)),
    fee: 65_150n, // 45,150 for the tx as built, and 20,000 for two Lighthouse ixs
    keep: BigInt(rent(0)),
    total: 8_767_190n,
  });
  assert.notEqual(c.total, 8_934_830n, "not the presale's metadata at the seat's size");
  assert.deepEqual([...asked].sort((a, b) => a - b), [0, 96, 100, 120, 133, 272]);
  await openCost({ rpc: conn });
  await joinCost({ rpc: conn });
  assert.equal(asked.length, 6, "rent is read once, for joinCost too");
  assert.equal((await openCost({ rpc: conn, priority: 100_000 })).fee, 115_300n);
  let n = 0;
  const flaky = { rpcEndpoint: "https://flaky-open.test", getMinimumBalanceForRentExemption: async () => { if (n++ === 0) throw new Error("429 Too Many Requests"); return 1; } };
  await assert.rejects(openCost({ rpc: flaky }), /429/);
  assert.equal((await openCost({ rpc: flaky })).total, 1n + 1n + 4n + 65_150n + 1n);
  // a URL reads through its own Connection, and shares what a Connection to it read
  const pub = { rpcEndpoint: PUBLIC_RPC, getMinimumBalanceForRentExemption: async (b) => rent(b) };
  await openCost({ rpc: pub });
  assert.equal((await openCost()).total, c.total, "the public RPC's rents: no second read");
});

test("joinCost and openCost: a rent read that never answers gives up after 10 s and isn't kept, so the next try reads again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stalled = true;
  let reads = 0;
  const conn = { rpcEndpoint: "https://stall.test", getMinimumBalanceForRentExemption: async () => (reads++, stalled ? new Promise(() => {}) : 1) };
  for (const cost of [joinCost, openCost]) {
    stalled = true;
    let done = false;
    const p = cost({ rpc: conn }).then(() => "resolved", (e) => e.message).finally(() => (done = true));
    for (let i = 0; i < 20; i++) await tick();
    t.mock.timers.tick(9_999);
    for (let i = 0; i < 20; i++) await tick();
    assert.equal(done, false, "not before 10 s");
    t.mock.timers.tick(1);
    await until(() => done);
    assert.equal(await p, "Solana didn't answer; try again");
    const before = reads;
    stalled = false;
    assert.ok((await cost({ rpc: conn })).total > 0n);
    assert.ok(reads > before, "a fresh read, not the stalled one");
  }
  assert.equal(reads, 4 + 4 + 2 + 2, "join: 4 stalled, then 4 afresh; open: its 2 other sizes, stalled, then afresh");
});

// Solana's fee for a tx that sets no CU limit: 5,000 lamports a signature, and the price on
// the default limit, 200,000 CU a program ix and 3,000 a builtin one (agave's
// compute_budget_instruction_details.rs), rounded up
function feeOf(tx, priority, addedCu) {
  const builtins = [ComputeBudgetProgram.programId.toBase58(), SYSTEM];
  const keys = tx.message.staticAccountKeys.map(String);
  const cu = tx.message.compiledInstructions.reduce((n, ci) => n + (builtins.includes(keys[ci.programIdIndex]) ? 3_000n : 200_000n), addedCu);
  return BigInt(tx.message.header.numRequiredSignatures) * 5_000n + (cu * priority + 999_999n) / 1_000_000n;
}

test("joinFee and openFee: the signatures and compute units of the txs the flows build, and the Lighthouse ixs a wallet may add", async () => {
  const info = fakeInfo();
  const api = fakeApi(info);
  const w = fakeWallet();
  const f = flows({ api });
  await f.openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: Keypair.generate().publicKey.toBase58(), commit: 100_000_000n });
  await f.joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view: joinable(info).view, amount: 100_000_000n });
  const [open, join] = api.cosigned;
  assert.deepEqual([open, join].map((tx) => tx.message.header.numRequiredSignatures), [3, 2], "the wallet, the gate and (open) the mint sign");
  assert.deepEqual([open, join].map((tx) => tx.message.compiledInstructions.length), [4, 3], "the price, and 3 or 2 of Mooner's");
  // each Lighthouse ix a wallet adds raises the limit by 200,000 CU and signs nothing;
  // Solflare adds two (entry.test.js)
  const lighthouse = 2n * 200_000n;
  for (const p of [50_000, 100_000, 1, 1_000_000]) {
    assert.equal(openFee(p), feeOf(open, BigInt(p), lighthouse), `open at ${p}`);
    assert.equal(joinFee(p), feeOf(join, BigInt(p), lighthouse), `join at ${p}`);
  }
  assert.equal(openFee(), 65_150n);
  assert.equal(joinFee(), 50_150n);
});

test("sol: whole numbers keep their zeros at any number of digits", () => {
  assert.equal(sol(100n * SOL, 0), "100");
  assert.equal(sol(10n * SOL, 0), "10");
  assert.equal(sol(0n, 0), "0");
  assert.equal(sol(100n * SOL), "100");
  assert.equal(sol(SOL), "1");
  assert.equal(sol(100_000_000n), "0.1");
  assert.equal(sol(1_234_567_890n, 4), "1.2346");
  assert.equal(sol(10_100_000_000n), "10.1");
});

test("makeFlows refuses a missing or wrong key store", () => {
  assert.throws(() => makeFlows({ api: {}, subscribe: () => () => {} }), /keys/);
  assert.throws(() => makeFlows({ api: {}, subscribe: () => () => {}, keys: { get: async () => null } }), /keys/);
});

test("session keys: none yet, the web app's stored format reads back, a broken store isn't fatal", async () => {
  const keys = memoryKeys();
  const f = flows({ keys });
  assert.equal(await f.sessionKey("P", "W"), null);
  const kp = Keypair.generate();
  keys.map.set(sessionKeyName("P", "W"), btoa(String.fromCharCode(...kp.secretKey))); // what chain.js wrote
  assert.ok((await f.sessionKey("P", "W")).publicKey.equals(kp.publicKey));
  const fail = async () => {
    throw new Error("no storage");
  };
  assert.equal(await flows({ keys: { get: fail, set: fail } }).sessionKey("P", "W"), null);
});

test("loadInfo: one request for callers at once, and a failure isn't kept", async () => {
  let calls = 0;
  let fail = true;
  const raw = { program: Keypair.generate().publicKey.toBase58(), gate: Keypair.generate().publicKey.toBase58(), numbers: { TARGET: "10", SLOTS: 3 }, ers: [{ validator: VALIDATOR, url: "https://er.test" }] };
  const f = flows({
    api: {
      info: async () => {
        calls++;
        await tick();
        if (fail) throw new Error("down");
        return raw;
      },
    },
  });
  await Promise.all([assert.rejects(f.loadInfo(), /down/), assert.rejects(f.loadInfo(), /down/)]);
  assert.equal(calls, 1);
  fail = false;
  const [a, b] = await Promise.all([f.loadInfo(), f.loadInfo()]);
  assert.equal(calls, 2);
  assert.equal(a, b);
  assert.ok(a.pid.equals(new PublicKey(raw.program)));
  assert.deepEqual(a.N, { TARGET: 10n, SLOTS: 3 });
  assert.equal(a.ers[0].conn.rpcEndpoint, "https://er.test");
  await f.loadInfo();
  assert.equal(calls, 2);
});

test("loadInfo: a server that never answers gives up after 10 s and isn't kept, so the next call asks again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let stalled = true;
  const raw = { program: Keypair.generate().publicKey.toBase58(), gate: Keypair.generate().publicKey.toBase58(), numbers: { SLOTS: 3 }, ers: [] };
  const f = flows({ api: { info: async () => (calls++, stalled ? new Promise(() => {}) : raw) } });
  let done = 0;
  const [a, b] = [f.loadInfo(), f.loadInfo()].map((p) => p.then(() => "resolved", (e) => e.message).finally(() => done++));
  for (let i = 0; i < 20; i++) await tick();
  t.mock.timers.tick(9_999);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(done, 0, "not before 10 s");
  t.mock.timers.tick(1);
  await until(() => done === 2);
  assert.equal(await a, "the server didn't answer; try again");
  assert.equal(await b, "the server didn't answer; try again");
  assert.equal(calls, 1);
  stalled = false;
  assert.equal((await f.loadInfo()).N.SLOTS, 3);
  assert.equal(calls, 2, "a fresh request, not the stalled one");
});

test("waitFor: a pushed snapshot, or the first read, or a plain timeout", async () => {
  const sock = fakeSocket();
  const presale = Keypair.generate().publicKey;
  const f = flows({ api: { presale: async () => ({ where: "open", seats: [] }) }, subscribe: sock.subscribe });
  const topic = `presale:${presale}`;
  const p = f.waitFor(presale, (v) => v.seats.length === 1);
  sock.push(topic, { type: "snapshot", data: { seats: [1] } });
  assert.deepEqual(await p, { seats: [1] });
  assert.equal(sock.count(topic), 0); // it stops listening
  assert.deepEqual(await f.waitFor(presale, (v) => v.where === "open"), { where: "open", seats: [] });
  assert.equal(sock.count(topic), 0);
  await assert.rejects(f.waitFor(presale, () => false, { timeoutMs: 10, what: "your seat" }), /your seat didn't show up yet/);
  assert.equal(sock.count(topic), 0);
});

test("waitFor: only a snapshot that matches ends it", async () => {
  const sock = fakeSocket();
  const presale = Keypair.generate().publicKey;
  const topic = `presale:${presale}`;
  const f = flows({ api: { presale: async () => ({ n: 0 }) }, subscribe: sock.subscribe });
  let over = false;
  const p = f.waitFor(presale, (v) => v.n === 2, { timeoutMs: 1_000 }).then((v) => ((over = true), v));
  await tick();
  sock.push(topic, { type: "missing", data: { n: 2 } });
  sock.push(topic, { type: "upsert", data: { n: 2 } });
  sock.push(topic, { type: "snapshot", data: { n: 1 } });
  await tick();
  assert.equal(over, false);
  sock.push(topic, { type: "snapshot", data: { n: 2 } });
  assert.deepEqual(await p, { n: 2 });
  assert.equal(sock.count(topic), 0);
});

test("waitFor: a socket that hands over a snapshot inside subscribe()", async () => {
  const presale = Keypair.generate().publicKey;
  let live = 0;
  const syncSocket = (data) => (topic, fn) => {
    live++;
    fn({ topic, type: "snapshot", data });
    return () => live--;
  };
  const f = flows({ api: { presale: async () => ({ n: 0 }) }, subscribe: syncSocket({ n: 1 }) });
  assert.deepEqual(await f.waitFor(presale, (v) => v.n === 1, { timeoutMs: 1_000 }), { n: 1 });
  assert.equal(live, 0, "it stopped listening");
  // one that doesn't match yet: the first read can still end it
  const g = flows({ api: { presale: async () => ({ n: 2 }) }, subscribe: syncSocket({ n: 1 }) });
  assert.deepEqual(await g.waitFor(presale, (v) => v.n === 2, { timeoutMs: 1_000 }), { n: 2 });
  assert.equal(live, 0);
});

test("waitFor: a view `done` can't read fails the wait at once", async () => {
  const sock = fakeSocket();
  const presale = Keypair.generate().publicKey;
  const f = flows({ api: { presale: async () => null }, subscribe: sock.subscribe });
  const t0 = Date.now();
  await assert.rejects(f.waitFor(presale, (v) => v.where === "er", { timeoutMs: 2_000 }), TypeError);
  assert.ok(Date.now() - t0 < 1_000, "not the timeout");
  assert.equal(sock.count(`presale:${presale}`), 0);
  // and a pushed one
  const g = flows({ api: { presale: () => new Promise(() => {}) }, subscribe: sock.subscribe });
  const p = g.waitFor(presale, (v) => v.where === "er", { timeoutMs: 2_000 });
  sock.push(`presale:${presale}`, { type: "snapshot", data: null });
  await assert.rejects(p, TypeError);
  assert.equal(sock.count(`presale:${presale}`), 0);
});

test("waitFor: a first read that comes after the timeout changes nothing", async () => {
  const sock = fakeSocket();
  const presale = Keypair.generate().publicKey;
  let answer;
  const f = flows({ api: { presale: () => new Promise((r) => (answer = r)) }, subscribe: sock.subscribe });
  let asked = 0;
  await assert.rejects(f.waitFor(presale, (v) => (asked++, v.ok), { timeoutMs: 5 }), /didn't show up yet/);
  answer({ ok: true });
  await tick();
  assert.equal(asked, 0);
  assert.equal(sock.count(`presale:${presale}`), 0);
});

test("requestMint: trimmed details, signed as the server checks them", async () => {
  let sent;
  const f = flows({ api: { mint: async (body) => ((sent = body), { mint: "M" }) } });
  const wallet = Keypair.generate();
  const image = new Uint8Array([1, 2, 3]);
  let asked;
  const signMessageFn = async (bytes) => {
    asked = bytes;
    return new Uint8Array(signMessage(wallet, Buffer.from(bytes).toString("utf8")));
  };
  const r = await f.requestMint({
    wallet: wallet.publicKey, signMessage: signMessageFn, name: " Moon ", symbol: " MOON ", description: " hi ",
    links: { twitter: " x ", telegram: "", website: "" }, image,
  });
  assert.deepEqual(r, { mint: "M" });
  assert.equal(Object.getPrototypeOf(asked), Uint8Array.prototype); // not a Buffer
  assert.deepEqual({ ...sent, time: 0, signature: "" }, {
    wallet: wallet.publicKey.toBase58(), name: "Moon", symbol: "MOON", description: "hi",
    links: { twitter: "x" }, image: Buffer.from(image).toString("base64"), time: 0, signature: "",
  });
  const text = mintMessage({ wallet: wallet.publicKey, name: "Moon", symbol: "MOON", image, details: ["hi", "x", "", ""], time: sent.time });
  assert.ok(verifySignature(wallet.publicKey, text, Buffer.from(sent.signature, "base64")));
});

test("openPresale: the wallet pays, the app's CU price, the saved session key is the one in the tx, the gate would sign it", async () => {
  const keys = memoryKeys();
  const wallet = Keypair.generate().publicKey;
  let cosigned;
  const api = {
    blockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    cosign: async (tx) => {
      cosigned = VersionedTransaction.deserialize(Buffer.from(tx, "base64"));
      return { status: 200, json: { confirmed: true } };
    },
  };
  const f = flows({ api, keys, priority: 100_000 });
  const info = fakeInfo();
  const mint = Keypair.generate().publicKey;
  const presale = await f.openPresale({ info, wallet, signTransaction: async (tx) => tx, mint: mint.toBase58(), commit: 400_000_000n });
  assert.ok(presale.equals(presalePda(info.pid, mint)));
  assert.ok(cosigned.message.staticAccountKeys[0].equals(wallet));
  assert.equal(budget(cosigned).price, 100_000n);
  const keysOf = cosigned.message.staticAccountKeys;
  const open = cosigned.message.compiledInstructions.find((ci) => keysOf[ci.programIdIndex].equals(info.pid) && ci.data[0] === IX.OPEN_PRESALE);
  const sk = await f.sessionKey(presale.toBase58(), wallet.toBase58());
  assert.ok(new PublicKey(open.data.slice(33, 65)).equals(sk.publicKey)); // data: tag, feeDest, sessionKey, deposit, commit
  // 0.4 SOL, the largest creator commit: the co-signer's cap agrees
  assert.equal(checkEntryTx(cosigned, { pid: info.pid, gate: info.gate, validators: [info.ers[0].validator], N: info.N }).kind, "open");
});

test("openPresale: 50,000 micro-lamports per CU when the app sets no price", async () => {
  const info = fakeInfo();
  const api = fakeApi(info);
  const w = fakeWallet();
  await flows({ api }).openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: Keypair.generate().publicKey.toBase58(), commit: 100_000_000n });
  assert.equal(budget(api.cosigned[0]).price, 50_000n);
});

test("openPresale: a tx the server sent but hasn't confirmed waits for the presale to show", async () => {
  const info = fakeInfo();
  const sock = fakeSocket();
  const api = fakeApi(info, { confirmed: false, presale: async () => ({ where: "closed" }) });
  const w = fakeWallet();
  const mint = Keypair.generate().publicKey;
  const topic = `presale:${presalePda(info.pid, mint)}`;
  let over = false;
  const p = flows({ api, subscribe: sock.subscribe })
    .openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: mint.toBase58(), commit: 100_000_000n })
    .then((r) => ((over = true), r));
  await until(() => sock.count(topic) === 1);
  await tick();
  assert.equal(over, false, "a closed view doesn't end it");
  sock.push(topic, { type: "snapshot", data: { where: "er" } });
  assert.ok((await p).equals(presalePda(info.pid, mint)));
});

test("openPresale: the creator can't take the whole pool; caught before the wallet is asked", async () => {
  const info = fakeInfo();
  const api = fakeApi(info);
  const w = fakeWallet();
  const cap = info.N.TARGET - info.N.MIN_SEAT;
  const over = cap + info.N.STEP;
  assert.ok(validSeat(over, info.N), "a seat size the program takes from a joiner");
  const open = (commit) => flows({ api }).openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: Keypair.generate().publicKey.toBase58(), commit });
  await assert.rejects(open(over), new RegExp(`the creator can put in at most ${sol(cap).replace(".", "\\.")} SOL, so others can join`));
  await assert.rejects(open(info.N.TARGET), /at most/);
  assert.equal(w.asked.length, 0, "the wallet wasn't asked");
  assert.equal(api.cosigned.length, 0, "nothing reached the server");
  await open(cap);
  assert.equal(api.cosigned.length, 1, "the cap itself is fine");
});

test("a seat size the program would refuse is caught before the wallet is asked", async () => {
  let asked = false;
  const signTransaction = async () => {
    asked = true;
  };
  const view = { presale: Keypair.generate().publicKey.toBase58(), validator: VALIDATOR };
  await assert.rejects(flows().joinPresale({ info: fakeInfo(), wallet: Keypair.generate().publicKey, signTransaction, view, amount: 50_000_000n }), /pick 0.1 to 0.5 SOL/);
  assert.equal(asked, false);
});

/** A presale a wallet can join: its view before the join. */
function joinable(info) {
  const presale = presalePda(info.pid, Keypair.generate().publicKey);
  return { presale, view: { presale: presale.toBase58(), validator: VALIDATOR, raised: "0", seats: [] } };
}

test("joinPresale: the gate would sign it, the stored key is the one in the tx, and it signs the commit with no popup", async () => {
  const info = fakeInfo();
  const keys = memoryKeys();
  const api = fakeApi(info);
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const f = flows({ api, keys });
  await f.joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  const [tx] = api.cosigned;
  assert.equal(checkEntryTx(tx, { pid: info.pid, gate: info.gate, validators: [info.ers[0].validator] }).kind, "join");
  const sk = await f.sessionKey(presale.toBase58(), w.publicKey.toBase58());
  assert.ok(entryKey(tx, info.pid).equals(sk.publicKey));
  assert.equal(w.asked.length, 1, "the wallet signed the entry tx only");
  const [commit] = info.er.sent;
  assert.deepEqual(tags(commit, info.pid), [IX.SET_COMMIT]);
  assert.ok(commit.feePayer.equals(sk.publicKey));
  assert.ok(commit.instructions[0].keys[0].pubkey.equals(sk.publicKey));
  assert.ok(commit.verifySignatures());
  assert.equal(commit.instructions[0].data.readBigUInt64LE(1), 200_000_000n);
});

test("joinPresale: a key already stored for the seat is the one it uses, and a cancelled join keeps it", async () => {
  const info = fakeInfo();
  const keys = memoryKeys();
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const name = sessionKeyName(presale.toBase58(), w.publicKey.toBase58());
  const old = Keypair.generate();
  keys.map.set(name, stored(old));
  w.reject = () => true;
  await assert.rejects(flows({ api: fakeApi(info), keys }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n }), /rejected/);
  assert.equal(keys.map.get(name), stored(old), "a cancelled join doesn't replace the key");
  // a retry after an unknown outcome: the tx carries the same key
  w.reject = () => false;
  const api = fakeApi(info);
  await flows({ api, keys }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  assert.ok(entryKey(api.cosigned[0], info.pid).equals(old.publicKey));
  assert.equal(keys.map.get(name), stored(old));
});

test("joinPresale: a key store that can't save still commits with no rotate_key popup", async () => {
  const info = fakeInfo();
  const w = fakeWallet();
  const { view } = joinable(info);
  const keys = {
    get: async () => null,
    set: async () => {
      throw new Error("QuotaExceededError");
    },
  };
  await flows({ api: fakeApi(info), keys }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  assert.equal(w.asked.length, 1, "the entry tx only");
  assert.deepEqual(info.er.sent.map((tx) => tags(tx, info.pid)), [[IX.SET_COMMIT]]);
});

/** A seat already in the ER with `key`, and a flows whose store holds `mine`. */
function seated({ key, mine, commit = 0n }) {
  const info = fakeInfo();
  const keys = memoryKeys();
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const seat = seatPda(info.pid, presale, w.publicKey);
  info.er.put(seat, info.pid, seatBytes({ user: w.publicKey, presale, sessionKey: key.publicKey, deposit: 500_000_000n, commit }));
  const name = sessionKeyName(presale.toBase58(), w.publicKey.toBase58());
  if (mine) keys.map.set(name, stored(mine));
  return { info, keys, w, presale, seat, name, view: { ...view, seats: [{ user: w.publicKey.toBase58(), where: "er", commit: commit.toString() }] } };
}

test("setCommit: a stored key the seat doesn't have costs one rotate_key, and the new key is stored and signs", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  await f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount: 300_000_000n });
  assert.equal(s.w.asked.length, 1);
  const [rotate, commit] = s.info.er.sent;
  assert.deepEqual(tags(rotate, s.info.pid), [IX.ROTATE_KEY]);
  const fresh = new PublicKey(rotate.instructions[0].data.subarray(1, 33));
  assert.ok((await f.sessionKey(s.presale.toBase58(), s.w.publicKey.toBase58())).publicKey.equals(fresh));
  assert.ok(commit.feePayer.equals(fresh));
  assert.deepEqual(tags(commit, s.info.pid), [IX.SET_COMMIT]);
});

test("setCommit: a rotate_key the wallet cancels isn't asked again", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  s.w.reject = () => true;
  await assert.rejects(flows({ keys: s.keys }).setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount: 300_000_000n, retries: 3 }), /rejected/);
  assert.equal(s.w.asked.length, 1);
  assert.equal(s.info.er.sent.length, 0);
});

test("setCommit: two at once on a seat that needs a new key ask the wallet once, and the stored key is the seat's", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  const go = (amount) => f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount });
  await Promise.all([go(300_000_000n), go(400_000_000n)]);
  assert.equal(s.w.asked.length, 1);
  const seatKey = new PublicKey((await s.info.er.getAccountInfo(s.seat)).data.subarray(S.SESSION_KEY, S.SESSION_KEY + 32));
  assert.ok((await f.sessionKey(s.presale.toBase58(), s.w.publicKey.toBase58())).publicKey.equals(seatKey));
  assert.ok(s.info.er.sent.filter((tx) => tags(tx, s.info.pid)[0] === IX.SET_COMMIT).every((tx) => tx.feePayer.equals(seatKey)));
});

/** getBack's world: the seat (in the ER with SOL in the pool, unless `home`, where it came
 *  back with none after a leave), the presale (OPEN in the ER), the socket, Solana (`rpc`)
 *  and the server's reads, which show `reads` in turn (the last one stays). */
function refundable({ home = false } = {}) {
  const key = Keypair.generate();
  const s = seated({ key, mine: key, commit: 300_000_000n });
  const sock = fakeSocket();
  const rpc = fakeConn(s.info.pid, "https://solana.test");
  const seatData = (commit) => seatBytes({ user: s.w.publicKey, presale: s.presale, sessionKey: key.publicKey, deposit: 500_000_000n, commit });
  /** The seat home on Solana with `commit` in the pool. */
  const landHome = (commit = 0n) => rpc.put(s.seat, s.info.pid, seatData(commit));
  /** The presale in `state`: home on Solana, or delegated (the ER has the live copy). */
  const presaleIs = (state, { home: there = false, deadline } = {}) => {
    rpc.put(s.presale, there ? s.info.pid : DELEGATION_PROGRAM, presaleBytes(there ? state : STATE.OPEN, deadline));
    if (there) s.info.er.drop(s.presale);
    else s.info.er.put(s.presale, s.info.pid, presaleBytes(state, deadline));
  };
  presaleIs(STATE.OPEN);
  rpc.put(s.seat, DELEGATION_PROGRAM, seatData(0n));
  if (home) {
    landHome();
    s.info.er.drop(s.seat);
    s.view.seats[0] = { ...s.view.seats[0], where: "home", commit: "0" };
  }
  const reads = [];
  const api = { blockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 7 }), presale: async () => (reads.length > 1 ? reads.shift() : (reads[0] ?? null)) };
  const f = flows({ api, keys: s.keys, subscribe: sock.subscribe, rpc });
  const steps = [];
  const seen = []; // reads of Solana and the ER done by each step
  const onStep = (t) => (steps.push(t), seen.push(rpc.reads + s.info.er.reads));
  const run = (view = s.view) => f.getBack({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, sendTransaction: s.w.sendTransaction, view, onStep });
  // a seat that's home left the pool first, unless `commit` says otherwise
  const withSeat = (where, commit = where === "home" ? "0" : "300000000") => ({ ...s.view, seats: [{ ...s.view.seats[0], where, commit }] });
  return { ...s, key, sock, rpc, run, steps, seen, reads, landHome, presaleIs, topic: `presale:${s.presale}`, withSeat, without: { ...s.view, seats: [] } };
}

const settled = (r) => r.w.sent.map(({ tx }) => tags(tx, r.info.pid));

test("getBack: a seat already home is only settled, on the app's Solana connection", async () => {
  const r = refundable({ home: true });
  await r.run();
  assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]]);
  assert.equal(r.w.sent[0].conn, r.rpc);
  assert.equal(r.w.sent[0].opts?.skipPreflight, false, "a settle the program would refuse fails before it's sent");
  // the wallet cranks its own seat and gets the SOL: no fee (settle_seat.rs)
  const { message } = r.w.sent[0].tx;
  const [ix] = message.compiledInstructions;
  const [cranker, seat, , user, presale] = ix.accountKeyIndexes.map((i) => message.staticAccountKeys[i]);
  assert.ok(cranker.equals(r.w.publicKey) && user.equals(r.w.publicKey));
  assert.ok(seat.equals(r.seat) && presale.equals(r.presale), "the wallet's own seat, in this presale");
  assert.deepEqual(r.rpc.confirmed.map((c) => [c.signature, c.lastValidBlockHeight]), [["settle-sig", 7]]);
  assert.equal(r.info.er.sent.length, 0);
  assert.equal(r.w.asked.length, 0);
});

test("getBack: the session key takes the seat out of the ER with no popup when the ER would take it", async () => {
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  await g.run();
  const [leave] = g.info.er.sent;
  assert.deepEqual(tags(leave, g.info.pid), [IX.SET_COMMIT, IX.LEAVE]);
  assert.ok(leave.feePayer.equals(g.key.publicKey));
  assert.equal(g.w.asked.length, 0);
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
  assert.deepEqual(g.steps, ["Checking your seat", "Taking your SOL out", "Bringing it back to Solana", "Sending it to your wallet"]);
  assert.equal(g.seen[0], 0, "the first step shows before anything is read");
});

test("getBack: Mooner's own refusal is the error, with no popup", async () => {
  const r = refundable();
  refuse(r.info.er, r.info.pid, 5); // CreatorCannotLower
  r.w.reject = () => true; // a popup ends the run at once: no waiting on what it sent
  await assert.rejects(r.run(), /CreatorCannotLower/);
  assert.equal(r.w.asked.length, 0);
  assert.equal(r.info.er.sent.length, 0);
  assert.equal(r.w.sent.length, 0);
});

test("getBack: a code another program raised in the ER isn't Mooner's refusal: the wallet signs", async () => {
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  g.info.er.simErr = { InstructionError: [0, { Custom: 0 }] };
  g.info.er.simLogs = [`Program ${g.info.pid} invoke [1]`, `Program ${SYSTEM} invoke [2]`, `Program ${SYSTEM} failed: custom program error: 0x0`, `Program ${g.info.pid} failed: custom program error: 0x0`];
  await g.run();
  assert.equal(g.w.asked.length, 1, "the wallet signed the leave");
  assert.ok(g.info.er.sent[0].feePayer.equals(g.w.publicKey));
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: any other refusal falls back to the wallet", async () => {
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  g.info.er.simErr = "InsufficientFundsForFee";
  await g.run();
  assert.equal(g.w.asked.length, 1);
  const [leave] = g.info.er.sent;
  assert.deepEqual(tags(leave, g.info.pid), [IX.SET_COMMIT, IX.LEAVE]);
  assert.ok(leave.feePayer.equals(g.w.publicKey));
  assert.ok(g.steps.includes("Sign in your wallet to take your SOL out"));
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: a view that misses the seat on its way home isn't taken for a refund", async () => {
  const g = refundable();
  g.reads.push(g.without);
  const p = g.run();
  await until(() => g.sock.count(g.topic) === 1 && g.rpc.reads > 0);
  await tick();
  assert.equal(g.w.sent.length, 0, "still waiting");
  g.sock.push(g.topic, { type: "snapshot", data: g.withSeat("home") });
  await p;
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: a seat Solana no longer has was refunded already: no settle_seat", async () => {
  const g = refundable();
  g.reads.push(g.without);
  // the keeper refunds it (the account closes) just after the leave
  const send = g.info.er.sendRawTransaction;
  g.info.er.sendRawTransaction = async (raw) => (g.rpc.drop(g.seat), send(raw));
  await g.run();
  assert.deepEqual(g.info.er.sent.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
  assert.equal(g.w.sent.length, 0);
});

test("getBack: a view without the seat to begin with asks Solana before it gives up", async () => {
  // gone: nothing to do
  const a = refundable();
  a.rpc.drop(a.seat);
  await a.run(a.without);
  assert.equal(a.w.sent.length + a.w.asked.length + a.info.er.sent.length, 0);
  assert.equal(a.rpc.reads, 1, "one read: a view without the seat has nothing to catch up on");
  // still there, on its way home: it waits for it, then settles
  const g = refundable();
  g.reads.push(g.without);
  g.info.er.drop(g.seat);
  const p = g.run(g.without);
  await until(() => g.sock.count(g.topic) === 1);
  g.sock.push(g.topic, { type: "snapshot", data: g.withSeat("home") });
  await p;
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
  assert.deepEqual(g.steps, ["Checking your seat", "Bringing it back to Solana", "Sending it to your wallet"], "nothing to take out of the ER");
});

// ---- keys kept in memory, and rotations ----

/** Another device's rotate_key: a new key on the seat in the ER. Returns it. */
async function rotateElsewhere(er, seat) {
  const kp = Keypair.generate();
  kp.publicKey.toBuffer().copy((await er.getAccountInfo(seat)).data, S.SESSION_KEY);
  return kp;
}
const seatKeyOf = async (er, seat) => new PublicKey((await er.getAccountInfo(seat)).data.subarray(S.SESSION_KEY, S.SESSION_KEY + 32));
const isCommit = (pid) => (tx) => tags(tx, pid)[0] === IX.SET_COMMIT;

/** A wallet that joined with `keys` as its store; `commit(amount)` sets its commit after. */
async function joined(keys, more = {}) {
  const info = fakeInfo();
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const api = fakeApi(info);
  const f = flows({ api, keys, ...more });
  await f.joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  const after = { ...view, raised: "200000000", seats: [{ user: w.publicKey.toBase58(), where: "er", commit: "200000000" }] };
  const commit = (amount, extra = {}) => f.setCommit({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view: after, amount, ...extra });
  return { info, w, presale, seat: seatPda(info.pid, presale, w.publicKey), api, f, view: after, commit, name: sessionKeyName(presale.toBase58(), w.publicKey.toBase58()) };
}

test("a key store that can't save: the key kept in memory signs later commits and the leave, with no popup", async () => {
  const sock = fakeSocket();
  const rpc = fakeConn(Keypair.generate().publicKey, "https://solana.test");
  const keys = {
    get: async () => null,
    set: async () => {
      throw new Error("QuotaExceededError");
    },
  };
  const j = await joined(keys, { subscribe: sock.subscribe, rpc });
  await j.commit(300_000_000n);
  await j.commit(100_000_000n);
  rpc.put(j.seat, DELEGATION_PROGRAM, Buffer.alloc(SEAT_LEN));
  j.api.presale = async () => ({ ...j.view, seats: [{ ...j.view.seats[0], where: "home", commit: "0" }] });
  await j.f.getBack({ info: j.info, wallet: j.w.publicKey, signTransaction: j.w.signTransaction, sendTransaction: j.w.sendTransaction, view: j.view });
  assert.equal(j.w.asked.length, 1, "the entry tx only");
  assert.deepEqual(j.info.er.sent.map((tx) => tags(tx, j.info.pid)), [[IX.SET_COMMIT], [IX.SET_COMMIT], [IX.SET_COMMIT], [IX.LEAVE]]);
  assert.equal(j.w.sent.length, 1, "settle_seat");
});

test("a key store that keeps nothing: the key kept in memory signs, with no popup", async () => {
  const j = await joined({ get: async () => null, set: async () => {} });
  await j.commit(300_000_000n);
  assert.equal(j.w.asked.length, 1);
  assert.ok(j.info.er.sent.every((tx) => tx.feePayer.equals(entryKey(j.api.cosigned[0], j.info.pid))));
});

test("joinPresale: its own key signs the first commit, even if another tab stored another key meanwhile", async () => {
  const keys = memoryKeys();
  const info = fakeInfo();
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const api = fakeApi(info);
  const cosign = api.cosign;
  api.cosign = async (b64) => {
    const r = await cosign(b64);
    keys.map.set(sessionKeyName(presale.toBase58(), w.publicKey.toBase58()), stored(Keypair.generate()));
    return r;
  };
  await flows({ api, keys }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  assert.equal(w.asked.length, 1, "no rotate_key");
  assert.ok(info.er.sent[0].feePayer.equals(entryKey(api.cosigned[0], info.pid)));
});

test("a key store that reads but can't save: after one rotate_key the new key signs, not the stored old one", async () => {
  const old = Keypair.generate();
  const j = await joined({
    get: async () => stored(old),
    set: async () => {
      throw new Error("QuotaExceededError");
    },
  });
  assert.ok(entryKey(j.api.cosigned[0], j.info.pid).equals(old.publicKey), "the stored key is reused");
  await rotateElsewhere(j.info.er, j.seat);
  await j.commit(300_000_000n);
  assert.equal(j.w.asked.length, 2, "one rotate_key");
  await j.commit(400_000_000n);
  await j.commit(100_000_000n);
  assert.equal(j.w.asked.length, 2, "and no more");
  const key = await seatKeyOf(j.info.er, j.seat);
  assert.ok(j.info.er.sent.filter(isCommit(j.info.pid)).slice(1).every((tx) => tx.feePayer.equals(key)));
});

test("a key store that works again is read again: a key another tab saved there signs", async () => {
  const keys = memoryKeys();
  const set = keys.set;
  let failing = true;
  keys.set = async (k, v) => {
    if (failing) throw new Error("QuotaExceededError");
    return set(k, v);
  };
  const j = await joined(keys);
  failing = false;
  await rotateElsewhere(j.info.er, j.seat);
  await j.commit(300_000_000n); // one rotate_key, saved this time
  assert.equal(j.w.asked.length, 2);
  const other = await rotateElsewhere(j.info.er, j.seat); // another tab's, saved in the store
  keys.map.set(j.name, stored(other));
  await j.commit(400_000_000n);
  assert.equal(j.w.asked.length, 2, "no popup");
  assert.ok(j.info.er.sent.at(-1).feePayer.equals(other.publicKey));
});

test("openPresale: a key already stored for the presale is the one in the tx", async () => {
  const info = fakeInfo();
  const keys = memoryKeys();
  const api = fakeApi(info);
  const w = fakeWallet();
  const mint = Keypair.generate().publicKey;
  const old = Keypair.generate();
  keys.map.set(sessionKeyName(presalePda(info.pid, mint).toBase58(), w.publicKey.toBase58()), stored(old));
  await flows({ api, keys }).openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: mint.toBase58(), commit: 100_000_000n });
  assert.ok(entryKey(api.cosigned[0], info.pid).equals(old.publicKey));
});

test("setCommit: a later rotate_key isn't blocked by an earlier one", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  const go = (amount) => f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount });
  await go(300_000_000n);
  await rotateElsewhere(s.info.er, s.seat);
  await go(400_000_000n);
  assert.equal(s.w.asked.length, 2);
  assert.ok(s.info.er.sent.at(-1).feePayer.equals(await seatKeyOf(s.info.er, s.seat)));
});

test("setCommit: the new key is kept before rotate_key goes out, so a lost answer costs no second popup", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  const go = (amount, retries) => f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount, retries });
  // the rotate_key lands, but the status read right after the send fails
  const statuses = s.info.er.getSignatureStatuses;
  s.info.er.getSignatureStatuses = async () => {
    s.info.er.getSignatureStatuses = statuses;
    throw new Error("fetch failed");
  };
  await assert.rejects(go(300_000_000n, 0), /fetch failed/);
  assert.deepEqual(s.info.er.sent.map((tx) => tags(tx, s.info.pid)), [[IX.ROTATE_KEY]]);
  await go(300_000_000n);
  assert.equal(s.w.asked.length, 1, "no second rotate_key");
  assert.ok(s.info.er.sent.at(-1).feePayer.equals(await seatKeyOf(s.info.er, s.seat)));
});

test("setCommit: one that read the seat just before another's rotate_key landed doesn't rotate again", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  const go = (amount) => f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount });
  // A's wallet signs only when we say so
  let sign;
  const signed = new Promise((r) => (sign = r));
  const walletSign = s.w.signTransaction;
  let prompts = 0;
  s.w.signTransaction = async (tx) => (prompts++, await signed, walletSign(tx));
  const a = go(300_000_000n);
  await until(() => prompts === 1);
  // B reads the seat now (the old key), and the answer comes after A is done
  const read = s.info.er.getAccountInfo;
  let answer;
  const later = new Promise((r) => (answer = r));
  s.info.er.getAccountInfo = async (k) => {
    s.info.er.getAccountInfo = read;
    const now = await read(k);
    const copy = now && { ...now, data: Buffer.from(now.data) };
    await later;
    return copy;
  };
  const b = go(400_000_000n);
  await until(() => s.info.er.getAccountInfo === read);
  sign();
  await a;
  answer();
  await b;
  assert.equal(prompts, 1, "one rotate_key");
  const key = await seatKeyOf(s.info.er, s.seat);
  assert.ok(s.info.er.sent.filter(isCommit(s.info.pid)).every((tx) => tx.feePayer.equals(key)));
});

// ---- waitFor edges ----

test("waitFor: a socket that hands over a snapshot inside subscribe() that `done` can't read", async () => {
  const presale = Keypair.generate().publicKey;
  let live = 0;
  const sub = (topic, fn) => {
    live++;
    fn({ topic, type: "snapshot", data: null });
    return () => live--;
  };
  const f = flows({ api: { presale: async () => null }, subscribe: sub });
  const t0 = Date.now();
  await assert.rejects(f.waitFor(presale, (v) => v.where === "er", { timeoutMs: 2_000 }), TypeError);
  assert.ok(Date.now() - t0 < 1_000, "not the timeout");
  assert.equal(live, 0, "it stopped listening");
});

test("waitFor and getBack's reads: their timers are cleared however they end", async () => {
  const [set, clear] = [globalThis.setTimeout, globalThis.clearTimeout];
  const timers = new Set();
  globalThis.setTimeout = (fn, ms, ...a) => {
    const t = set(fn, ms, ...a);
    if (ms === 7_777 || ms === 10_000) timers.add(t);
    return t;
  };
  globalThis.clearTimeout = (t) => (timers.delete(t), clear(t));
  try {
    const sock = fakeSocket();
    const presale = Keypair.generate().publicKey;
    const f = flows({ api: { presale: async () => ({ n: 0 }) }, subscribe: sock.subscribe });
    const p = f.waitFor(presale, (v) => v.n === 1, { timeoutMs: 7_777 });
    sock.push(`presale:${presale}`, { type: "snapshot", data: { n: 1 } });
    await p;
    await assert.rejects(f.waitFor(presale, (v) => v.x.y, { timeoutMs: 7_777 }), TypeError);
    await refundable({ home: true }).run(); // one Solana read, with a 10 s limit
    const c = refundable({ home: true }); // and the presale read, for SOL in the pool
    c.landHome(300_000_000n);
    c.presaleIs(STATE.EXPIRED, { home: true });
    await c.run();
    assert.equal(c.w.sent.length, 1);
  } finally {
    globalThis.setTimeout = set;
    globalThis.clearTimeout = clear;
  }
  assert.equal(timers.size, 0, "no timer left");
});

test("waitFor: a `done` that fails without an error still fails the wait", async () => {
  const f = flows({ api: { presale: async () => ({ n: 0 }) } });
  const out = await f.waitFor(Keypair.generate().publicKey, () => Promise.reject(), { timeoutMs: 1_000 }).then(() => "resolved", () => "rejected");
  assert.equal(out, "rejected");
});

// ---- getBack: what Solana says, and reads that fail ----

test("getBack: a seat home on Solana is settled though the view doesn't list it yet", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.reads.push(g.withSeat("er"));
  const p = g.run();
  await until(() => g.sock.count(g.topic) === 1 && g.info.er.sent.length === 1);
  // it lands home, and the feed's last push comes before the server's listing has it
  g.landHome();
  g.sock.push(g.topic, { type: "snapshot", data: g.without });
  await until(() => g.w.sent.length === 1);
  await p;
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: Solana says the seat is home: settled at once, whatever the view says", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.landHome();
  const p = g.run(); // the view says "er"
  await until(() => g.w.sent.length === 1);
  await p;
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
  assert.equal(g.info.er.sent.length, 0);
  assert.equal(g.sock.count(g.topic), 0, "no wait");
});

test("getBack: a Solana read that fails isn't taken for a refund, and the timeout says Solana didn't answer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.info.er.drop(g.seat); // it left the ER already
  g.rpc.getAccountInfo = async () => (g.rpc.reads++, Promise.reject(new Error("429 Too Many Requests")));
  g.reads.push(g.without);
  let out = "pending";
  const p = g.run(g.without).then(() => (out = "resolved"), (e) => (out = e.message));
  await until(() => g.sock.count(g.topic) === 1 && g.rpc.reads >= 2);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(out, "pending");
  t.mock.timers.tick(120_000);
  await p;
  assert.match(out, /couldn't reach Solana to check your seat/);
  assert.equal(g.w.sent.length, 0);
  // Solana answers but the seat never shows: the plain timeout
  const h = refundable();
  h.info.er.drop(h.seat);
  h.reads.push(h.without);
  const q = h.run(h.without).then(() => "resolved", (e) => e.message);
  await until(() => h.sock.count(h.topic) === 1 && h.rpc.reads >= 2);
  t.mock.timers.tick(120_000);
  assert.match(await q, /your seat on Solana didn't show up yet/);
});

test("getBack: Solana doesn't answer and the view says home: settled at once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = refundable({ home: true });
  r.rpc.getAccountInfo = async () => (r.rpc.reads++, Promise.reject(new Error("fetch failed")));
  const p = r.run();
  await until(() => r.w.sent.length + r.sock.opened + r.info.er.reads > 0);
  assert.equal(r.sock.opened + r.info.er.reads, 0, "no ER read, no wait");
  await p;
  assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]]);
});

test("getBack: a view that has the seat again after Solana didn't answer times out plainly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.info.er.drop(g.seat);
  g.rpc.getAccountInfo = async () => (g.rpc.reads++, Promise.reject(new Error("429 Too Many Requests")));
  g.reads.push(g.without);
  const p = g.run(g.without).then(() => "resolved", (e) => e.message);
  await until(() => g.sock.count(g.topic) === 1 && g.rpc.reads >= 2);
  g.sock.push(g.topic, { type: "snapshot", data: g.withSeat("er") });
  await tick();
  t.mock.timers.tick(120_000);
  assert.match(await p, /your seat on Solana didn't show up yet/);
});

test("getBack: a Solana read that hangs counts as no answer, and an ER that hangs is an error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.rpc.getAccountInfo = () => (g.rpc.reads++, new Promise(() => {}));
  g.info.er.getAccountInfo = () => (g.info.er.reads++, new Promise(() => {}));
  const p = g.run().then(() => "resolved", (e) => e.message);
  await until(() => g.rpc.reads === 1);
  t.mock.timers.tick(10_000);
  await until(() => g.info.er.reads === 1);
  t.mock.timers.tick(10_000);
  assert.match(await p, /the presale's ER didn't answer; try again/);
  assert.equal(g.w.sent.length + g.info.er.sent.length, 0);
});

test("getBack: Solana is the app's rpc, else the public RPC of the server's cluster", async (t) => {
  let owner, data;
  t.mock.method(Connection.prototype, "getAccountInfo", async () => ({ owner, data, lamports: 1, executable: false }));
  t.mock.method(Connection.prototype, "confirmTransaction", async () => ({ value: { err: null } }));
  const settleOn = async (cluster, rpc) => {
    const s = seated({ key: Keypair.generate() });
    owner = s.info.pid;
    data = seatBytes({ user: s.w.publicKey, presale: s.presale, sessionKey: Keypair.generate().publicKey });
    const f = flows({ api: { blockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 7 }) }, keys: s.keys, ...(rpc && { rpc }) });
    const view = { ...s.view, seats: [{ ...s.view.seats[0], where: "home" }] };
    await f.getBack({ info: { ...s.info, cluster }, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, sendTransaction: s.w.sendTransaction, view });
    const { conn } = s.w.sent[0];
    assert.ok(conn instanceof Connection);
    return conn.rpcEndpoint;
  };
  assert.equal(await settleOn("devnet"), "https://api.devnet.solana.com");
  assert.equal(await settleOn("mainnet"), "https://api.mainnet-beta.solana.com");
  assert.equal(await settleOn("devnet", "https://rpc.example.test"), "https://rpc.example.test");
  await assert.rejects(settleOn("localnet"), /no public Solana RPC/);
});

// ---- getBack: SOL still in the pool (settle_seat.rs: what it pays out, and when) ----

const FILLED = "The pool filled: your SOL is in and turns into tokens at launch.";
const BY_ITSELF = "It comes back to your wallet by itself.";
const nothingSent = (r) => r.w.sent.length + r.w.asked.length + r.info.er.sent.length + r.info.er.sims;
const failure = (p) => p.then(() => "resolved", (e) => e.message);

/** A seat that came home with SOL in the pool (the keeper's commit_seats), the presale in
 *  `state`, home on Solana unless `delegated`. */
function committedHome(state, { delegated = false } = {}) {
  const r = refundable({ home: true });
  r.landHome(300_000_000n);
  r.view.seats[0].commit = "300000000";
  r.presaleIs(state, { home: !delegated });
  return r;
}

test("getBack: SOL in a pool that filled: it says so, and nothing is sent", async () => {
  for (const state of [STATE.FULL, STATE.LAUNCHING, STATE.SETTLED]) {
    const r = committedHome(state);
    assert.equal(await failure(r.run()), FILLED, `state ${state}`);
    assert.equal(nothingSent(r), 0);
  }
});

test("getBack: SOL in an EXPIRED or FAILED presale that's home: settle_seat pays it out", async () => {
  for (const state of [STATE.EXPIRED, STATE.FAILED]) {
    const r = committedHome(state);
    await r.run();
    assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]], `state ${state}`);
  }
});

test("getBack: SOL in an expired presale still in the ER: it comes back by itself, nothing sent", async () => {
  for (const state of [STATE.EXPIRED, STATE.FAILED]) {
    const r = committedHome(state, { delegated: true });
    assert.equal(await failure(r.run()), BY_ITSELF);
    assert.equal(nothingSent(r), 0);
  }
});

test("getBack: SOL in a home seat of an OPEN presale: nothing sent, the seat isn't delegated again", async () => {
  // the program has no such seat: a committed one comes home only once the presale isn't OPEN
  const r = committedHome(STATE.OPEN, { delegated: true });
  assert.match(await failure(r.run()), /try again in a moment/);
  assert.equal(nothingSent(r), 0);
});

test("getBack: a home seat with nothing in the pool is settled, and the presale isn't read", async () => {
  const r = refundable({ home: true });
  r.presaleIs(STATE.FULL, { home: true });
  await r.run();
  assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]]);
  assert.equal(r.rpc.reads, 1, "the seat only");
});

test("getBack: a presale that couldn't be read: nothing sent", async () => {
  const r = committedHome(STATE.EXPIRED);
  r.rpc.drop(r.presale);
  assert.match(await failure(r.run()), /try again/);
  assert.equal(nothingSent(r), 0);
});

test("getBack: a seat still in the ER of a pool that filled: it says so, and nothing goes to the ER", async () => {
  const r = refundable();
  r.reads.push(r.withSeat("home"));
  r.presaleIs(STATE.FULL);
  assert.equal(await failure(r.run()), FILLED);
  assert.equal(nothingSent(r), 0);
  // expired: the keeper sends the seat home and refunds it
  const x = refundable();
  x.reads.push(x.withSeat("home"));
  x.presaleIs(STATE.EXPIRED, { home: true });
  assert.equal(await failure(x.run()), BY_ITSELF);
  assert.equal(nothingSent(x), 0);
});

test("getBack: the ER refuses set_commit 0 past the deadline: it comes back by itself", async () => {
  const r = refundable();
  refuse(r.info.er, r.info.pid, 1); // PastDeadline
  r.w.reject = () => true; // no popup: one would end the run at once
  assert.equal(await failure(r.run()), BY_ITSELF);
  assert.equal(r.w.sent.length + r.w.asked.length + r.info.er.sent.length, 0);
});

test("getBack: a pool that fills between the check and the leave: it says so", async () => {
  const r = refundable();
  r.info.er.simulateTransaction = async () => (r.presaleIs(STATE.FULL), { value: { err: { InstructionError: [0, { Custom: 0 }] }, logs: [`Program ${r.info.pid} failed: custom program error: 0x0`] } }); // BadState
  r.w.reject = () => true; // no popup: one would end the run at once
  assert.equal(await failure(r.run()), FILLED);
  assert.equal(r.w.sent.length + r.w.asked.length + r.info.er.sent.length, 0);
});

test("getBack: a seat that comes home with SOL in a pool that filled: it says so, nothing sent", async () => {
  // the view says it's home
  const a = refundable();
  a.info.er.drop(a.seat); // on its way home (commit_seats)
  a.presaleIs(STATE.FULL, { home: true });
  a.reads.push(a.withSeat("home", "300000000"));
  assert.equal(await failure(a.run()), FILLED);
  assert.equal(nothingSent(a), 0);
  // Solana says it's home
  const b = refundable();
  b.info.er.drop(b.seat);
  b.presaleIs(STATE.FULL, { home: true });
  b.reads.push(b.without);
  const p = failure(b.run());
  await until(() => b.sock.count(b.topic) === 1);
  b.landHome(300_000_000n);
  b.sock.push(b.topic, { type: "snapshot", data: b.without });
  assert.equal(await p, FILLED);
  assert.equal(nothingSent(b), 0);
  // expired and home: settle_seat refunds it
  const c = refundable();
  c.info.er.drop(c.seat);
  c.presaleIs(STATE.EXPIRED, { home: true });
  c.reads.push(c.withSeat("home", "300000000"));
  await c.run();
  assert.deepEqual(settled(c), [[IX.SETTLE_SEAT]]);
});

test("getBack: a refund that fails on chain is an error that names the program's error", async () => {
  const r = refundable({ home: true });
  r.rpc.confirmTransaction = async (x) => (r.rpc.confirmed.push(x), { value: { err: { InstructionError: [0, { Custom: 6 }] } } });
  r.rpc.txLogs = [`Program ${r.info.pid} invoke [1]`, `Program ${r.info.pid} failed: custom program error: 0x6`];
  const e = await r.run().then(() => null, (e) => e);
  assert.equal(e?.message, "the refund failed: ix 0: NoRoom (6)");
  assert.equal(explain(e), "The pool is already full.");
  // the same code with no logs isn't known to be Mooner's: no name
  const n = refundable({ home: true });
  n.rpc.confirmTransaction = async () => ({ value: { err: { InstructionError: [0, { Custom: 6 }] } } });
  assert.equal((await n.run().then(() => null, (e) => e))?.message, `the refund failed: ix 0 (${n.info.pid}): custom 6`);
});

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM = "11111111111111111111111111111111";

test("explain: names only: a bare `custom program error: 0x..` could be any program's, so it stays as it is", () => {
  // a Jupiter trade's Token and System errors: Mooner's OverDeposit, BadState and NoRoom by number
  const cases = [
    `Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 3: custom program error: 0x4. \nLogs: \n["Program ${TOKEN} invoke [2]","Program log: Error: owner does not match","Program ${TOKEN} failed: custom program error: 0x4"]. \nCatch the \`SendTransactionError\` and call \`getLogs()\` on it for full details.`,
    `Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 1: custom program error: 0x0. \nLogs: \n["Program ${SYSTEM} invoke [2]","Allocate: account Address { address: X, base: None } already in use","Program ${SYSTEM} failed: custom program error: 0x0"].`,
    `Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x6. \nLogs: \n["Program log: Error: account or token already in use"].`,
  ];
  for (const m of cases) assert.equal(explain(new Error(m)), m);
  assert.equal(explain(new Error("the refund failed: ix 0: NoRoom (6)")), "The pool is already full.", "a name still reads plainly");
});

/** Logs of ix `i` (Mooner's) failing with `hex`, raised by `by` (Mooner itself, or a
 *  program it calls: that one's failure is logged first). */
const failLogs = (pid, by, hex) => [
  `Program ${pid} invoke [1]`,
  ...(String(by) === String(pid) ? [] : [`Program ${by} invoke [2]`, `Program ${by} failed: custom program error: ${hex}`]),
  `Program ${pid} failed: custom program error: ${hex}`,
];

test("describeTxError: a code is Mooner's only when the logs say Mooner raised it", () => {
  const pid = Keypair.generate().publicKey;
  const progs = [ComputeBudgetProgram.programId, pid, DELEGATION_PROGRAM]; // a join as the web sends it
  const custom = (i, n) => ({ InstructionError: [i, { Custom: n }] });
  // join's create_account with too little SOL: System's 1, not PastDeadline
  const short = describeTxError(custom(1, 1), progs, pid, failLogs(pid, SYSTEM, "0x1"));
  assert.equal(short, `ix 1 (${SYSTEM}): insufficient lamports (custom 1)`);
  assert.equal(explain(new Error(`the tx fails: ${short}`)), SHORT_OF_SOL);
  // System's 0 (already in use) isn't BadState
  const inUse = describeTxError(custom(1, 0), progs, pid, failLogs(pid, SYSTEM, "0x0"));
  assert.equal(inUse, `ix 1 (${SYSTEM}): custom 0`);
  assert.equal(explain(new Error(inUse)), inUse);
  // Mooner's own
  assert.equal(describeTxError(custom(1, 1), progs, pid, failLogs(pid, pid, "0x1")), "ix 1: PastDeadline (1)");
  assert.equal(describeTxError(custom(1, 22), progs, pid, failLogs(pid, pid, "0x16")), "ix 1: WrongPresale (22)");
  // no logs: whose code it is isn't known, so it gets no name
  assert.equal(describeTxError(custom(1, 1), progs, pid), `ix 1 (${pid}): custom 1`);
  assert.equal(describeTxError(custom(1, 1), progs, pid, null), `ix 1 (${pid}): custom 1`);
  // logs of another code don't name this one
  assert.equal(describeTxError(custom(1, 6), progs, pid, failLogs(pid, pid, "0x1")), `ix 1 (${pid}): custom 6`);
  // the delegation program's codes aren't Mooner's (its names aren't checked: none given)
  const dl = describeTxError(custom(2, 1), progs, pid, [`Program ${DELEGATION_PROGRAM} invoke [1]`, `Program ${DELEGATION_PROGRAM} failed: custom program error: 0x1`]);
  assert.equal(dl, `ix 2 (${DELEGATION_PROGRAM}): custom 1`);
  assert.equal(explain(new Error(dl)), dl);
  // ...and System's short SOL inside a delegation is still short SOL
  const dls = describeTxError(custom(2, 1), progs, pid, [`Program ${DELEGATION_PROGRAM} invoke [1]`, `Program ${SYSTEM} invoke [2]`, "Transfer: insufficient lamports 5, need 9", `Program ${SYSTEM} failed: custom program error: 0x1`, `Program ${DELEGATION_PROGRAM} failed: custom program error: 0x1`]);
  assert.equal(dls, `ix 2 (${SYSTEM}): insufficient lamports (custom 1)`);
  // open: [compute budget, open_presale, delegate(presale), delegate(seat)], the same way
  const open = [ComputeBudgetProgram.programId, pid, DELEGATION_PROGRAM, DELEGATION_PROGRAM];
  assert.equal(describeTxError(custom(1, 1), open, pid, failLogs(pid, SYSTEM, "0x1")), `ix 1 (${SYSTEM}): insufficient lamports (custom 1)`);
  assert.equal(describeTxError(custom(1, 0), open, pid, failLogs(pid, SYSTEM, "0x0")), `ix 1 (${SYSTEM}): custom 0`);
  assert.equal(describeTxError(custom(3, 1), open, pid, [`Program ${DELEGATION_PROGRAM} invoke [1]`, `Program ${SYSTEM} invoke [2]`, `Program ${SYSTEM} failed: custom program error: 0x1`, `Program ${DELEGATION_PROGRAM} failed: custom program error: 0x1`]), `ix 3 (${SYSTEM}): insufficient lamports (custom 1)`);
  // a System ix of its own: nothing it calls, so its code is its own
  assert.equal(describeTxError(custom(0, 1), [new PublicKey(SYSTEM)], pid), `ix 0 (${SYSTEM}): insufficient lamports (custom 1)`);
  // the runtime's own errors in its own words (solana-transaction-error lib.rs)
  assert.equal(describeTxError("InsufficientFundsForFee"), "Insufficient funds for fee");
  assert.equal(describeTxError("AccountNotFound"), "Attempt to debit an account but found no record of a prior credit.");
  assert.equal(describeTxError({ InsufficientFundsForRent: { account_index: 2 } }), "Transaction results in an account (2) with insufficient funds for rent");
  for (const e of ["InsufficientFundsForFee", "AccountNotFound", { InsufficientFundsForRent: { account_index: 0 } }]) assert.equal(explain(new Error(`the tx fails: ${describeTxError(e)}`)), SHORT_OF_SOL);
  assert.equal(describeTxError("BlockhashNotFound"), '"BlockhashNotFound"');
});

const SHORT_OF_SOL = "Your wallet needs a little more SOL to cover rent and the Solana fee.";

test("explain: the runtime's words for a wallet short of SOL read as such; Token's insufficient funds doesn't", () => {
  for (const m of [
    "Transaction simulation failed: Insufficient funds for fee",
    "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.",
    "Transaction simulation failed: Transaction results in an account (0) with insufficient funds for rent",
    "Transfer: insufficient lamports 47558004, need 60000000",
  ]) assert.equal(explain(new Error(m)), SHORT_OF_SOL, m);
  // Token's own "insufficient funds" (a Jupiter trade's): tokens, not the wallet's SOL
  const token = new SendTransactionError({
    action: "simulate",
    signature: "",
    transactionMessage: "Transaction simulation failed: Error processing Instruction 3: custom program error: 0x1",
    logs: [`Program ${TOKEN} invoke [2]`, "Program log: Instruction: TransferChecked", "Program log: Error: insufficient funds", `Program ${TOKEN} failed: custom program error: 0x1`],
  });
  assert.match(token.message, /insufficient funds/);
  assert.equal(explain(token), token.message);
  assert.equal(explain(new Error("Error: insufficient funds")), "Error: insufficient funds");
});

/** A failed preflight as web3.js throws it: instruction 0 (Mooner's) failed with `hex`
 *  after `inner`, the logs of what it called. */
const refusedBy = (pid, hex, inner = []) =>
  new SendTransactionError({
    action: "simulate",
    signature: "",
    transactionMessage: `Transaction simulation failed: Error processing Instruction 0: custom program error: ${hex}`,
    logs: [`Program ${pid} invoke [1]`, ...inner, `Program ${pid} consumed 9000 of 200000 compute units`, `Program ${pid} failed: custom program error: ${hex}`],
  });

test("getBack: a settle the preflight refuses: Mooner's own code reads as its error, another program's doesn't", async () => {
  const refused = async (error) => {
    const r = refundable({ home: true });
    r.w.sendTransaction = async () => {
      throw error(r.info.pid.toBase58());
    };
    const e = await r.run().then(() => null, (e) => e);
    assert.ok(e, "it failed");
    assert.equal(r.rpc.confirmed.length, 0);
    return e;
  };
  assert.equal(explain(await refused((pid) => refusedBy(pid, "0xb"))), FILLED); // AlreadySettled
  assert.match(explain(await refused((pid) => refusedBy(pid, "0x9"))), /on its way back to Solana/); // NotHome
  assert.match((await refused((pid) => refusedBy(pid, "0x16"))).message, / \(WrongPresale\)$/, "22, not 1");
  // logs kept on the error only, as tx.js does
  const bare = (pid) => Object.assign(new Error("Transaction simulation failed: Error processing Instruction 0: custom program error: 0xb"), { logs: [`Program ${pid} failed: custom program error: 0xb`] });
  assert.equal(explain(await refused(bare)), FILLED);
  // a wallet that throws its own error, the logs only in its message
  const inMessage = (pid) => new Error(`Simulation failed. Logs: ["Program ${pid} invoke [1]","Program ${pid} failed: custom program error: 0xb"]`);
  const m = await refused(inMessage);
  assert.equal(m.logs, undefined);
  assert.match(m.message, / \(AlreadySettled\)$/);
  assert.equal(explain(m), FILLED);
  // the innermost failure is what raised the code: Token or System, called by Mooner
  const token = await refused((pid) => refusedBy(pid, "0x4", [`Program ${TOKEN} invoke [2]`, "Program log: Error: owner does not match", `Program ${TOKEN} failed: custom program error: 0x4`]));
  assert.equal(explain(token), token.message);
  const system = await refused((pid) => refusedBy(pid, "0x0", [`Program ${SYSTEM} invoke [2]`, "Allocate: account already in use", `Program ${SYSTEM} failed: custom program error: 0x0`]));
  assert.equal(explain(system), system.message);
});

// ---- getBack: which read counts ----

test("getBack: Solana saying the seat is away beats a view that says home", async () => {
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  await g.run(g.withSeat("home"));
  assert.deepEqual(g.info.er.sent.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: one 'gone' while the view lists the seat is asked again after the server's 2 s cache", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // both say gone: nothing to do
  const a = refundable();
  a.rpc.drop(a.seat);
  let out = "pending";
  const p = a.run().then(() => (out = "resolved"), (e) => (out = e.message));
  await until(() => a.rpc.reads === 1);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(out, "pending", "it waits before the second read");
  t.mock.timers.tick(2_000);
  await p;
  assert.equal(out, "resolved");
  assert.equal(a.rpc.reads, 3, "the seat twice, then the presale: the view isn't final and the seat had SOL in the pool");
  assert.equal(nothingSent(a), 0);
  // an RPC that's behind says gone once; the second read has the seat
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  const read = g.rpc.getAccountInfo;
  g.rpc.getAccountInfo = async () => ((g.rpc.getAccountInfo = read), g.rpc.reads++, null);
  const q = g.run();
  await until(() => g.rpc.reads === 1);
  for (let i = 0; i < 20; i++) await tick(); // the first read's answer reaches getBack
  t.mock.timers.tick(2_000);
  await q;
  assert.deepEqual(g.info.er.sent.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: an older Solana read that fails after a newer one answered doesn't make the timeout 'couldn't reach Solana'", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.info.er.drop(g.seat); // it left the ER already
  g.reads.push(g.without);
  const read = g.rpc.getAccountInfo;
  let fail;
  const late = new Promise((_, no) => (fail = no));
  let n = 0;
  g.rpc.getAccountInfo = (k) => (++n === 2 ? (g.rpc.reads++, late) : read(k)); // the wait's first read hangs
  const p = failure(g.run(g.without));
  await until(() => g.sock.count(g.topic) === 1 && n === 2);
  g.sock.push(g.topic, { type: "snapshot", data: g.without });
  await until(() => n === 3);
  for (let i = 0; i < 20; i++) await tick(); // the newer read answers: away
  fail(new Error("429 Too Many Requests"));
  for (let i = 0; i < 20; i++) await tick();
  t.mock.timers.tick(120_000);
  assert.match(await p, /your seat on Solana didn't show up yet/);
});

// ---- getBack: a seat that's gone, the deadline, and reads that fail ----

const CLAIMED = "Your seat was claimed at launch: the tokens are in your wallet.";
const AT_LAUNCH = "Your seat was settled at launch: its tokens or SOL are in your wallet.";
const UNREACHABLE = "couldn't reach Solana to check your seat; try again";
/** Solana's reads of `key` fail. */
const downOn = (r, key) => {
  const get = r.rpc.getAccountInfo;
  r.rpc.getAccountInfo = (k, c) => (k.equals(key) ? (r.rpc.reads++, Promise.reject(new Error("503 Service Unavailable"))) : get(k, c));
};

test("getBack: gone from a presale that launched: a seat with SOL in the pool was claimed, an empty one got its SOL back", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  /** getBack with Solana saying gone, past the 2 s second read. */
  const gone = async (r, view) => {
    r.rpc.drop(r.seat);
    const p = failure(r.run(view));
    await until(() => r.rpc.reads === 1);
    for (let i = 0; i < 20; i++) await tick();
    t.mock.timers.tick(2_000);
    return p;
  };
  // the view still lists it, with SOL in the pool
  const a = refundable();
  assert.equal(await gone(a, { ...a.view, state: "SETTLED" }), CLAIMED);
  assert.equal(nothingSent(a), 0);
  assert.equal(a.rpc.reads, 2);
  // an empty seat the keeper settled: that's a refund
  const b = refundable({ home: true });
  assert.equal(await gone(b, { ...b.view, state: "SETTLED" }), "resolved");
  // not launched: gone is a refund, whatever the seat had
  const c = refundable();
  assert.equal(await gone(c, { ...c.view, state: "EXPIRED" }), "resolved");
  // the view doesn't list it (or it's closed, which lists no seats): what it had isn't known
  const d = refundable();
  assert.equal(await gone(d, { ...d.without, state: "SETTLED" }), AT_LAUNCH);
  const e = refundable();
  assert.equal(await gone(e, { ...e.without, state: "CLOSED", launch: { sig: "launch-sig" } }), AT_LAUNCH);
  // closed without a launch: it expired or failed, and every seat was refunded
  const f = refundable();
  assert.equal(await gone(f, { ...f.without, state: "CLOSED", launch: null }), "resolved");
  assert.equal(nothingSent(d) + nothingSent(e) + nothingSent(f), 0);
});

test("getBack: gone with SOL in the pool while the view isn't final: Solana's presale says whether it launched", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const SETTLED_ANY = "Your seat was settled: its SOL or tokens are in your wallet.";
  /** getBack from a stale `state` view that lists the seat with SOL in the pool; Solana
   *  says gone twice. */
  const gone = async (r, state = "FULL") => {
    r.rpc.drop(r.seat);
    const p = failure(r.run({ ...r.view, state }));
    await until(() => r.rpc.reads === 1);
    for (let i = 0; i < 20; i++) await tick();
    t.mock.timers.tick(2_000);
    return p;
  };
  // it launched: the keeper claimed the seat, and paid tokens
  const a = refundable();
  a.presaleIs(STATE.SETTLED, { home: true });
  assert.equal(await gone(a), CLAIMED);
  assert.equal(a.rpc.reads, 3, "the seat twice, then the presale");
  // in the ER still (only a presale that's home launches), or home and not launched: the
  // seat had nothing in the pool by then, and got it all back
  for (const [state, home] of [[STATE.OPEN, false], [STATE.FULL, true], [STATE.EXPIRED, true], [STATE.FAILED, true]]) {
    const r = refundable();
    r.presaleIs(state, { home });
    assert.equal(await gone(r), "resolved", `presale ${state}, home ${home}`);
  }
  // closed: the server's fresh view says if it launched first
  const c = refundable();
  c.rpc.drop(c.presale);
  c.reads.push({ ...c.without, state: "CLOSED", launch: { sig: "launch-sig" } });
  assert.equal(await gone(c, "LAUNCHING"), CLAIMED);
  const d = refundable();
  d.rpc.drop(d.presale);
  d.reads.push({ ...d.without, state: "CLOSED", launch: null });
  assert.equal(await gone(d), "resolved");
  // closed, and someone sent SOL to its address since: System's now, still closed
  const s = refundable();
  s.rpc.put(s.presale, new PublicKey(SYSTEM), Buffer.alloc(0));
  s.reads.push({ ...s.without, state: "CLOSED", launch: { sig: "launch-sig" } });
  assert.equal(await gone(s), CLAIMED);
  // not known: it says what's sure, and not that the SOL is back
  const e = refundable();
  downOn(e, e.presale);
  assert.equal(await gone(e), SETTLED_ANY);
  const f = refundable();
  f.rpc.drop(f.presale); // closed, and the server's view doesn't answer
  assert.equal(await gone(f, "OPEN"), SETTLED_ANY);
  // closed, and the server still has it FULL: not known either, whatever `launch` says
  const m = refundable();
  m.rpc.drop(m.presale);
  m.reads.push({ ...m.without, state: "FULL" });
  assert.equal(await gone(m), SETTLED_ANY);
  // closed, and the server never answers: it stops waiting after 10 s
  const n = refundable();
  n.rpc.drop(n.presale);
  n.reads.push(new Promise(() => {}));
  let out;
  gone(n).then((o) => (out = o));
  await until(() => n.rpc.reads === 3);
  for (let i = 0; i < 20; i++) await tick();
  t.mock.timers.tick(9_999);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(out, undefined, "still waiting at 9.999 s");
  t.mock.timers.tick(1);
  await until(() => out !== undefined);
  assert.equal(out, SETTLED_ANY);
  assert.equal([a, c, d, e, f, m, n].reduce((k, r) => k + nothingSent(r), 0), 0);
  // a final view decides by itself
  for (const state of ["EXPIRED", "FAILED"]) {
    const g = refundable();
    downOn(g, g.presale);
    assert.equal(await gone(g, state), "resolved", state);
    assert.equal(g.rpc.reads, 2, "no presale read");
  }
});

test("getBack: gone on its way home from a presale that launched: claimed if it had SOL in the pool, not once the leave took it out", async () => {
  /** The seat left the ER already; Solana says away, then gone; the view then is `after`. */
  const onItsWay = (r, after) => {
    r.info.er.drop(r.seat);
    r.reads.push(after);
    const read = r.info.er.getAccountInfo;
    r.info.er.getAccountInfo = async (k) => (k.equals(r.seat) && r.rpc.drop(r.seat), read(k));
    return failure(r.run());
  };
  const a = refundable();
  assert.equal(await onItsWay(a, { ...a.without, state: "CLOSED", launch: { sig: "launch-sig" } }), CLAIMED);
  const b = refundable();
  assert.equal(await onItsWay(b, { ...b.without, state: "CLOSED", launch: null }), "resolved", "expired, closed: refunded");
  const c = refundable();
  c.view.seats[0].commit = "0";
  assert.equal(await onItsWay(c, { ...c.without, state: "SETTLED" }), "resolved", "nothing in the pool");
  assert.equal(nothingSent(a) + nothingSent(b) + nothingSent(c), 0);
  // the leave took the SOL out; then the keeper settled the empty seat
  const g = refundable();
  g.reads.push({ ...g.without, state: "SETTLED" });
  const send = g.info.er.sendRawTransaction;
  g.info.er.sendRawTransaction = async (raw) => (g.rpc.drop(g.seat), send(raw));
  assert.equal(await failure(g.run()), "resolved");
  assert.deepEqual(g.info.er.sent.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
});

test("getBack: gone, and then Solana doesn't answer the second read: it says so, and nothing is sent", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = refundable({ home: true });
  let n = 0;
  const get = r.rpc.getAccountInfo;
  r.rpc.getAccountInfo = (k, c) => (k.equals(r.seat) && ++n > 1 ? (r.rpc.reads++, Promise.reject(new Error("503 Service Unavailable"))) : k.equals(r.seat) ? (r.rpc.reads++, Promise.resolve(null)) : get(k, c));
  const p = failure(r.run());
  await until(() => n === 1);
  for (let i = 0; i < 20; i++) await tick();
  t.mock.timers.tick(2_000);
  assert.equal(await p, UNREACHABLE);
  assert.equal(nothingSent(r), 0);
});

test("getBack: SOL in an OPEN pool past its deadline: it comes back by itself, with no popup and nothing sent", async (t) => {
  // no session key on this device: the leave would ask the wallet, and the ER would refuse it
  const r = refundable();
  r.reads.push(r.withSeat("home"));
  r.keys.map.clear();
  r.presaleIs(STATE.OPEN, { deadline: Math.floor(Date.now() / 1000) - 60 });
  assert.equal(await failure(r.run()), BY_ITSELF);
  assert.equal(nothingSent(r), 0);
  assert.deepEqual(r.steps, ["Checking your seat"]);
  // set_commit refuses from the deadline's second on (t >= deadline_ts, ledger.rs)
  t.mock.timers.enable({ apis: ["Date"], now: 1_900_000_000_000 });
  const d = refundable();
  d.reads.push(d.withSeat("home"));
  d.presaleIs(STATE.OPEN, { deadline: 1_900_000_000 });
  assert.equal(await failure(d.run()), BY_ITSELF);
  assert.equal(nothingSent(d), 0);
  const e = refundable();
  e.reads.push(e.withSeat("home"));
  e.presaleIs(STATE.OPEN, { deadline: 1_900_000_001 });
  await e.run();
  assert.deepEqual(e.info.er.sent.map((tx) => tags(tx, e.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]], "a second before it");
  // nothing in the pool: leave doesn't care about the deadline
  const z = refundable();
  z.reads.push(z.withSeat("home"));
  z.info.er.put(z.seat, z.info.pid, seatBytes({ user: z.w.publicKey, presale: z.presale, sessionKey: z.key.publicKey, deposit: 500_000_000n }));
  z.presaleIs(STATE.OPEN, { deadline: 1_899_999_000 });
  await z.run();
  assert.deepEqual(z.info.er.sent.map((tx) => tags(tx, z.info.pid)), [[IX.LEAVE]]);
});

test("getBack: Solana can't read the presale while the seat is in the ER: the ER's copy, the one set_commit checks, decides", async () => {
  const r = refundable();
  r.reads.push(r.withSeat("home"));
  downOn(r, r.presale);
  await r.run();
  assert.deepEqual(r.info.er.sent.map((tx) => tags(tx, r.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
  assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]]);
  const f = refundable();
  f.presaleIs(STATE.FULL);
  downOn(f, f.presale);
  assert.equal(await failure(f.run()), FILLED);
  assert.equal(nothingSent(f), 0);
  // an ER copy that isn't Mooner's doesn't count
  const x = refundable();
  x.reads.push(x.withSeat("home"));
  x.info.er.put(x.presale, DELEGATION_PROGRAM, presaleBytes(STATE.OPEN));
  downOn(x, x.presale);
  assert.match(await failure(x.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(x), 0);
  // a home seat is settled on Solana: an ER copy (stale by then) doesn't count
  const h = committedHome(STATE.EXPIRED);
  h.info.er.put(h.presale, h.info.pid, presaleBytes(STATE.OPEN));
  downOn(h, h.presale);
  assert.match(await failure(h.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(h), 0);
});

test("getBack: the ER's copy of the presale counts only if it's Mooner's and Solana still has the presale", async () => {
  // Solana has it delegated; the ER's copy isn't owned by Mooner
  const a = refundable();
  a.reads.push(a.withSeat("home"));
  a.info.er.put(a.presale, DELEGATION_PROGRAM, presaleBytes(STATE.OPEN));
  assert.match(await failure(a.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(a), 0);
  // Solana has no presale: it closed, whatever the ER still holds
  const b = refundable();
  b.reads.push(b.withSeat("home"));
  b.rpc.drop(b.presale);
  assert.match(await failure(b.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(b), 0);
  // the ER's read fails
  const c = refundable();
  c.reads.push(c.withSeat("home"));
  const read = c.info.er.getAccountInfo;
  c.info.er.getAccountInfo = async (k) => (k.equals(c.presale) ? Promise.reject(new Error("503 Service Unavailable")) : read(k));
  assert.match(await failure(c.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(c), 0);
});

test("getBack: Solana can't read the seat, the view has it home with SOL in a pool that filled: it says so, nothing sent", async () => {
  const r = committedHome(STATE.FULL);
  downOn(r, r.seat);
  assert.equal(await failure(r.run()), FILLED);
  assert.equal(nothingSent(r), 0);
});

// ---- the key store and the rotation lock ----

/** `k`, with writes that finish when `write()` says so. */
function slowKeys(k = memoryKeys()) {
  const set = k.set;
  let open;
  const gate = new Promise((r) => (open = r));
  k.writes = 0;
  k.write = () => open();
  k.set = async (name, v) => (k.writes++, await gate, set(name, v));
  return k;
}

test("a new key is written to the store before any tx that carries it is signed", async () => {
  // rotate_key
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const keys = slowKeys(s.keys);
  const go = flows({ keys }).setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount: 300_000_000n });
  await until(() => keys.writes === 1);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(s.w.asked.length, 0, "rotate_key waits for the write");
  keys.write();
  await go;
  assert.equal(s.w.asked.length, 1);
  // join
  const info = fakeInfo();
  const w = fakeWallet();
  const { view } = joinable(info);
  const j = slowKeys();
  const join = flows({ api: fakeApi(info), keys: j }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  await until(() => j.writes === 1);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(w.asked.length, 0, "the join waits for the write");
  j.write();
  await join;
  assert.equal(w.asked.length, 1);
});

test("setCommit: inside the rotation lock the key read under the lock counts, not the caller's stale one", async () => {
  const f0 = Keypair.generate();
  const s = seated({ key: f0, mine: f0 });
  await flows({ keys: s.keys }).setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount: 300_000_000n, key: Keypair.generate() });
  assert.equal(s.w.asked.length, 0, "no rotate_key");
  assert.deepEqual(s.info.er.sent.map((tx) => tags(tx, s.info.pid)), [[IX.SET_COMMIT]]);
  assert.ok(s.info.er.sent[0].feePayer.equals(f0.publicKey));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd engine && node --test test/flows.test.js`
Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../engine/src/flows.js'`.

- [ ] **Step 3: Name a failure by the program that raised it**

A code in a failed tx is Mooner's only when the logs say Mooner raised it. The ix being Mooner's isn't enough: a program it calls (System, Token, delegation) fails with codes of its own.

In `engine/src/consts.js`, replace `describeTxError` and its doc comment with:

```js
/** Who raised a failure: { program, code } from the first `Program <id> failed: custom
 *  program error: 0x..` line in `logs` (a program Mooner calls fails before Mooner does,
 *  so the first is the innermost), or null. */
export function failedWith(logs) {
  const m = /Program (\w+) failed: custom program error: 0x([0-9a-f]+)/i.exec((logs ?? []).join("\n"));
  return m ? { program: m[1], code: parseInt(m[2], 16) } : null;
}

// the runtime's own words for these (solana-transaction-error lib.rs)
const RUNTIME = { AccountNotFound: "Attempt to debit an account but found no record of a prior credit.", InsufficientFundsForFee: "Insufficient funds for fee" };

/** `{InstructionError: [i, {Custom: n}]}` -> "ix i: Name (n)" only when `logs` say Mooner
 *  (`pid`) raised n: ix i being Mooner's isn't enough, a program it calls (System, Token,
 *  delegation) fails with codes of its own. Else "ix i (<who raised it>): custom n", with
 *  System's 1 as what it is. The runtime's errors in its words; anything else as JSON. */
export function describeTxError(err, programIds = [], pid = null, logs = []) {
  const ie = err?.InstructionError;
  if (ie && typeof ie[1] === "object" && "Custom" in ie[1]) {
    const [i, { Custom: n }] = ie;
    const f = failedWith(logs);
    if (pid && f?.program === pid.toBase58() && f.code === n) return `ix ${i}: ${ERRORS[n] ?? "unknown"} (${n})`;
    const by = f?.code === n ? f.program : (programIds[i]?.toBase58() ?? "?");
    // System's ResultWithNegativeLamports: "Transfer: insufficient lamports X, need Y"
    return `ix ${i} (${by}): ${by === SYSTEM.toBase58() && n === 1 ? "insufficient lamports (custom 1)" : `custom ${n}`}`;
  }
  if (Object.hasOwn(RUNTIME, err)) return RUNTIME[err];
  const rent = err?.InsufficientFundsForRent;
  if (rent) return `Transaction results in an account (${rent.account_index}) with insufficient funds for rent`;
  return JSON.stringify(err);
}
```

In `engine/src/tx.js`, pass the logs to `describeTxError` in `sendSigned`:

```js
  const done = async (st) => {
    if (st.err) {
      const logs = await txLogs(conn, sig);
      throw new TxError(sig, describeTxError(st.err, ixs?.map((i) => i.programId), pid, logs), logs, what);
    }
    return sig;
  };
```

Export `txLogs`, which `getBack` uses for a refund that failed on chain:

```js
/** A landed tx's logs ([] if the RPC doesn't have it after a few tries). */
export async function txLogs(conn, sig) {
  for (let i = 0; i < 5; i++) {
    const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    if (t) return t.meta?.logMessages ?? [];
    await sleep(500);
  }
  return [];
}
```

In `simulate`, `errText` passes the logs too:

```js
    errText: v.err ? describeTxError(v.err, ixs.map((i) => i.programId), pid, v.logs) : null,
```

In `engine/server/api.js`, the cosign route passes the simulation's logs:

```js
    const sim = await l1.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" });
    if (sim.value.err) {
      throw new HttpError(400, `the tx fails: ${describeTxError(sim.value.err, programs, pid, sim.value.logs)}`, { logs: sim.value.logs ?? [] });
    }
```

- [ ] **Step 4: Write `engine/src/flows.js`**

```js
// Everything a Mooner app does on chain, shared by the web app and the phone app. Entry
// txs (open, join) are signed by the wallet and sent by the server, which co-signs them.
// Joining commits the whole deposit in the presale's MagicBlock ER (set_commit, signed by
// a session key kept on this device: free, no popup). Getting it back is one step for the
// user: set_commit 0 + leave in the ER, then settle_seat on Solana, which the wallet signs
// and sends. Each app hands in its API client, its live socket and a key store. No node:
// imports (Buffer is global: Node, or the app's polyfill).

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { DELEGATION_PROGRAM, describeTxError, ERRORS, failedWith } from "./consts.js";
import * as I from "./ix.js";
import { decodePresale, decodeSeat, PRESALE_LEN, SEAT_LEN, STATE } from "./layout.js";
import { presalePda, seatPda } from "./pdas.js";
import { connect, send, sendSigned, txLogs } from "./tx.js";
import { cutToRoom, joinIxs, mintMessageText, openIxs, unsignedTx, validSeat } from "./client.js";

/** Solana's public RPC for each cluster the server runs on (/api/info `cluster`). */
export const PUBLIC_RPCS = { mainnet: "https://api.mainnet-beta.solana.com", devnet: "https://api.devnet.solana.com" };
export const PUBLIC_RPC = PUBLIC_RPCS.mainnet;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** `p`, or an error once `ms` pass. */
function timed(p, ms, what) {
  let t;
  const late = new Promise((_, no) => (t = setTimeout(() => no(new Error(`${what} didn't answer; try again`)), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

export const LAMPORTS = 1_000_000_000n;
export const sol = (lamports, digits = 2) => {
  const v = Number(BigInt(lamports)) / 1e9;
  return v.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};
export const toLamports = (s) => BigInt(Math.round(Number(s) * 1e9));

/** µLamports per compute unit the entry txs pay. */
export const PRIORITY = 50_000;
// What a join takes besides the deposit, as mobile/src/checks.js counts it (the sources are
// there): the seat's rent; the delegation record's (96 bytes) and metadata's (133); the fee,
// 2 signatures and 403,000 CU at the priority, rounded up (mainnet says 30,150); and a 0-byte
// account's rent, which the wallet must keep. An open is counted the same way: the presale's
// rent too, a record and metadata (sized by its seeds, below) for each of the two accounts it
// delegates, and 3 signatures (the wallet's, the gate's, the mint's) on 603,000 CU (the price
// ix's 3,000, 200,000 a Mooner ix). On top of the fee: a wallet may add Lighthouse ixs (the
// gate lets them through, cosigner.js), and as the txs set no CU limit, each one raises the
// default limit by 200,000 CU (it signs nothing). Solflare adds two (entry.test.js), so two
// are counted.
const RECORD_LEN = 96;
// Delegation metadata: discriminator 8, last commit id 8, undelegation requester 1, rent
// payer 32, then the account's seeds as delegate() passes them (no bump, entry.rs), a Vec of
// Vecs: 4, and 4 + each seed's length (magicblock-delegation-program-api 3.1.0,
// delegation_metadata.rs serialized_size). Canary open D9eueWee… paid rent for 100 and 133.
const metadataLen = (...seeds) => 8 + 8 + 1 + 32 + 4 + seeds.reduce((n, len) => n + 4 + len, 0);
const PRESALE_METADATA_LEN = metadataLen("presale".length, 32); // ["presale", mint]: 100
const SEAT_METADATA_LEN = metadataLen("seat".length, 32, 32); // ["seat", presale, user]: 133
const WALLET_CU = 2n * 200_000n;
const entryFee = (signatures, cu, priority) => signatures * 5_000n + ((cu + WALLET_CU) * BigInt(priority) + 999_999n) / 1_000_000n;
export const joinFee = (priority = PRIORITY) => entryFee(2n, 403_000n, priority);
export const openFee = (priority = PRIORITY) => entryFee(3n, 603_000n, priority);
const rents = new Map(); // "<rpc> <bytes>" -> lamports; a read that fails or hangs isn't kept

/** Rent for `bytes` as `rpc` (a URL or a Connection) says, read once. A read gets 10 s: web3.js
 *  can't abort its fetch, and a hung read kept here would hang every later cost. */
function rentOn(rpc) {
  const conn = typeof rpc === "string" ? new Connection(rpc, "confirmed") : rpc;
  return (bytes) => {
    const k = `${conn.rpcEndpoint} ${bytes}`;
    const read = () => timed(conn.getMinimumBalanceForRentExemption(bytes), 10_000, "Solana");
    if (!rents.has(k)) rents.set(k, read().then(BigInt, (e) => (rents.delete(k), Promise.reject(e))));
    return rents.get(k);
  };
}

/** What a join takes from the wallet besides the deposit, in lamports: { seat, delegation,
 *  fee, keep, total }. Rents come from `rpc` (a URL or a Connection). */
export async function joinCost({ rpc = PUBLIC_RPC, priority = PRIORITY } = {}) {
  const [seat, record, metadata, keep] = await Promise.all([SEAT_LEN, RECORD_LEN, SEAT_METADATA_LEN, 0].map(rentOn(rpc)));
  const fee = joinFee(priority);
  return { seat, delegation: record + metadata, fee, keep, total: seat + record + metadata + fee + keep };
}

/** What an open takes from the wallet besides the creator's commit, in lamports: { presale,
 *  seat, delegation, fee, keep, total }. Rents come from `rpc` (a URL or a Connection). */
export async function openCost({ rpc = PUBLIC_RPC, priority = PRIORITY } = {}) {
  const lens = [PRESALE_LEN, SEAT_LEN, RECORD_LEN, PRESALE_METADATA_LEN, SEAT_METADATA_LEN, 0];
  const [presale, seat, record, presaleMeta, seatMeta, keep] = await Promise.all(lens.map(rentOn(rpc)));
  const delegation = 2n * record + presaleMeta + seatMeta;
  const fee = openFee(priority);
  return { presale, seat, delegation, fee, keep, total: presale + seat + delegation + fee + keep };
}

/** Where a seat's session key is kept: one per presale and wallet. */
export const sessionKeyName = (presale, wallet) => `mooner:session:${presale}:${wallet}`;

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const sha256hex = (bytes) => bytesToHex(sha256(bytes));
/** UTF-8 bytes as a plain Uint8Array: what wallets expect (a Buffer serializes differently as JSON). */
const utf8 = (text) => Uint8Array.from(Buffer.from(text, "utf8"));

/** What getBack says when the SOL can't come back from here (it sends nothing then). */
const FILLED = "The pool filled: your SOL is in and turns into tokens at launch.";
const BY_ITSELF = "It comes back to your wallet by itself.";
const CLAIMED = "Your seat was claimed at launch: the tokens are in your wallet.";
const AT_LAUNCH = "Your seat was settled at launch: its tokens or SOL are in your wallet.";
const SETTLED_ANY = "Your seat was settled: its SOL or tokens are in your wallet.";
const UNREACHABLE = "couldn't reach Solana to check your seat; try again";

/** An error as one readable line, with the program's error names. */
const PLAIN = {
  NoRoom: "The pool is already full.",
  PastDeadline: "Time's up for this presale.",
  BadState: "This presale isn't open any more.",
  CreatorCannotLower: "The creator can't lower or take back their SOL.",
  OverDeposit: "That's more than you put in.",
  BadSeatSize: "That amount isn't allowed.",
  NotAuthorized: "This wallet can't change that seat.",
  CommitNotZero: "Take your SOL out of the pool first.",
  GateRequired: "The server didn't sign this.",
  NotHome: "Your seat is still on its way back to Solana; try again in a moment.",
  AlreadySettled: FILLED,
};

/** Names only: a bare `custom program error: 0x6` could be any program's (a Jupiter
 *  trade's too); `named` gives Mooner's own codes their names. */
export function explain(e) {
  const m = e?.message ?? String(e);
  if (/User rejected|rejected the request|declined|cancel/i.test(m)) return "You cancelled it in your wallet.";
  // the runtime's words and System's (Token's bare "insufficient funds" is about tokens)
  if (/insufficient funds for (fee|rent)|no record of a prior credit|insufficient lamports/i.test(m)) return "Your wallet needs a little more SOL to cover rent and the Solana fee.";
  const name = Object.keys(PLAIN).find((k) => m.includes(k));
  return name ? PLAIN[name] : m;
}

/** A failed preflight of a Mooner tx, with the program's error name if the code is its
 *  own. The code alone doesn't say whose it is: the first `Program <id> failed` line in
 *  the logs does (a program Mooner calls fails before Mooner does). */
function named(e, pid) {
  const by = failedWith([...(e?.logs ?? []), e?.message]);
  const name = by?.program === pid.toBase58() && ERRORS[by.code];
  return name ? new Error(`${e.message} (${name})`) : e;
}

/** Why SOL in the pool can't come back from here, or null if it can. `now`: the presale
 *  as getBack reads it, { home, p } (null: the read failed). A seat still in the ER takes
 *  it out with set_commit 0, OPEN and before the deadline only (ledger.rs); a home seat
 *  gets it with settle_seat, which pays it out only from a presale that's home, EXPIRED
 *  or FAILED (settle_seat.rs). */
function held(now, inEr) {
  if (!now) return "Couldn't read the presale; try again in a moment.";
  const { home, p } = now;
  if (p.state === STATE.FULL || p.state === STATE.LAUNCHING || p.state === STATE.SETTLED) return FILLED;
  // a committed seat comes home only once the presale isn't OPEN (commit_seats): this is
  // a read that raced a change, and a new delegation would only lock the seat away again
  if (p.state === STATE.OPEN && !inEr) return "Your seat isn't back yet; try again in a moment.";
  // set_commit takes nothing out from the deadline on (ledger.rs): the keeper expires it
  if (p.state === STATE.OPEN) return p.deadlineTs <= Math.floor(Date.now() / 1000) ? BY_ITSELF : null;
  return home && !inEr ? null : BY_ITSELF; // EXPIRED or FAILED: the keeper sends seats home and refunds them
}

export const erFor = (info, validator) => info.ers.find((e) => e.validator.equals(new PublicKey(validator)));

/** The ER that answers fastest from here; a new presale lives there. */
export async function nearestEr(info) {
  const timed = info.ers.map(async (e) => {
    const t0 = performance.now();
    await e.conn.getSlot();
    return { e, ms: performance.now() - t0 };
  });
  const ok = (await Promise.allSettled(timed)).filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) throw new Error("no MagicBlock ER answered; try again");
  return ok.sort((a, b) => a.ms - b.ms)[0].e;
}

/** The seat as the ER holds it right now (null if it isn't there). */
async function erSeat(er, seat, pid) {
  const a = await er.conn.getAccountInfo(seat);
  return a?.owner.equals(pid) ? decodeSeat(a.data) : null;
}

/** A tx the wallet itself signs, sent to the ER (free). */
async function walletErTx({ info, er, wallet, signTransaction, ixs, what }) {
  const { blockhash } = await er.conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: wallet, recentBlockhash: blockhash }).add(...ixs);
  const signed = await signTransaction(tx);
  return sendSigned(er.conn, signed, { ixs, pid: info.pid, what, timeoutMs: 30_000 });
}

/** Whether the ER would refuse `ixs` from `signer`: null if not, else { ours, text },
 *  where `ours` means Mooner's program said no (another signer can't change that). */
async function erRefuses(conn, ixs, signer, pid) {
  try {
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(...ixs);
    const r = (await conn.simulateTransaction(tx, [signer])).value;
    if (!r.err) return null;
    const text = describeTxError(r.err, ixs.map((i) => i.programId), pid, r.logs);
    return { ours: /^ix \d+: (?!unknown)/.test(text), text };
  } catch (e) {
    return { ours: false, text: e?.message ?? String(e) };
  }
}

/**
 * The flows for one app. `api`: makeApi(); `subscribe(topic, fn)` -> off: the live socket;
 * `keys`: { get(name), set(name, value) } (async, may throw: keys are kept in memory too,
 * so a store that fails costs a wallet signature only once the app restarts); `priority`:
 * micro-lamports per CU on entry txs; `rpc`: Solana, as a URL or a Connection (default: the
 * public RPC of the server's cluster): getBack reads the seat there, and the wallet sends
 * settle_seat on it.
 */
export function makeFlows({ api, subscribe, keys, priority = PRIORITY, rpc = null }) {
  if (typeof keys?.get !== "function" || typeof keys?.set !== "function") throw new Error("makeFlows needs keys: { get(name), set(name, value) }");

  // ---- server info ----

  let infoP = null;
  /** /api/info with keys as PublicKeys, numbers as BigInt and a Connection per ER. A request
   *  that fails, or hangs for 10 s, isn't kept, so the next call asks again. */
  function loadInfo() {
    infoP ??= timed(api.info(), 10_000, "the server").then((i) => ({
      ...i,
      pid: new PublicKey(i.program),
      gate: new PublicKey(i.gate),
      N: Object.fromEntries(Object.entries(i.numbers).map(([k, v]) => [k, typeof v === "string" ? BigInt(v) : v])),
      ers: i.ers.map((e) => ({ validator: new PublicKey(e.validator), url: e.url, conn: connect(e.url) })),
    })).catch((e) => {
      infoP = null;
      throw e;
    });
    return infoP;
  }

  // ---- session keys: one per presale and wallet, on this device ----

  const made = new Map(); // name -> Keypair: every key saved here, for a store that fails
  const unsaved = new Set(); // names whose last save failed: the store may hold an older key

  async function sessionKey(presale, wallet) {
    const name = sessionKeyName(presale, wallet);
    if (!unsaved.has(name)) {
      try {
        const s = await keys.get(name);
        if (s) return Keypair.fromSecretKey(Buffer.from(s, "base64"));
      } catch {
        // no storage: the one kept in memory, if any
      }
    }
    return made.get(name) ?? null;
  }

  async function saveSessionKey(presale, wallet, kp) {
    const name = sessionKeyName(presale, wallet);
    made.set(name, kp);
    try {
      await keys.set(name, b64(kp.secretKey));
      unsaved.delete(name);
    } catch {
      // no storage: it lasts as long as the app; after that the wallet signs a rotate_key
      unsaved.add(name);
    }
    return kp;
  }

  /** The key this device has for the seat, or a new one, saved before any tx carries it: a
   *  retry after an unknown outcome must send the key the landed tx may already hold. */
  const keyFor = async (presale, wallet) => (await sessionKey(presale, wallet)) ?? (await saveSessionKey(presale, wallet, Keypair.generate()));

  /** Signs an entry tx with the wallet and hands it to the server, which co-signs and sends
   *  it. Returns the server's reply once it's confirmed (or sent, if slow). */
  async function signAndCosign(signTransaction, payer, ixs) {
    const { blockhash } = await api.blockhash();
    const tx = unsignedTx({ ixs: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }), ...ixs], payer, blockhash });
    const signed = await signTransaction(tx);
    const r = await api.cosign(b64(signed.serialize()));
    return r.json;
  }

  /** Waits until `done(view)` holds for the presale, as the server pushes it. It reads
   *  once too: the change may already be there. `done` may be async; a throw ends the wait
   *  with that error. */
  function waitFor(presale, done, { timeoutMs = 90_000, what = "the change" } = {}) {
    const key = presale.toString();
    return new Promise((resolve, reject) => {
      let over = false;
      let off = null;
      let timer = null;
      const end = (settle) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        settle();
        try {
          off?.();
        } catch {}
      };
      const check = async (v) => {
        try {
          if (!over && (await done(v))) end(() => resolve(v));
        } catch (e) {
          end(() => reject(e));
        }
      };
      // a socket may hand over a snapshot inside subscribe(): off isn't set yet then
      off = subscribe(`presale:${key}`, (m) => m.type === "snapshot" && check(m.data));
      if (over) return off();
      timer = setTimeout(() => end(() => reject(new Error(`${what} didn't show up yet; refresh in a moment`))), timeoutMs);
      api.presale(key).then(check, () => {});
    });
  }

  // ---- open ----

  /** Asks the server for a token (the wallet signs the details). The server trims text the
   *  same way, so the signature covers what it stores. */
  async function requestMint({ wallet, signMessage, name, symbol, description, links, image }) {
    const t = {
      name: name.trim(),
      symbol: symbol.trim(),
      description: description.trim(),
      links: { twitter: links.twitter.trim(), telegram: links.telegram.trim(), website: links.website.trim() },
    };
    const time = Math.floor(Date.now() / 1000);
    const details = [t.description, t.links.twitter, t.links.telegram, t.links.website];
    const text = mintMessageText({
      wallet, name: t.name, symbol: t.symbol, time,
      imageHash: sha256hex(image),
      detailsHash: sha256hex(utf8(JSON.stringify(details))),
    });
    const signature = await signMessage(utf8(text));
    const links2 = Object.fromEntries(Object.entries(t.links).filter(([, v]) => v));
    return api.mint({ wallet: wallet.toBase58(), ...t, links: links2, image: b64(image), time, signature: b64(signature) });
  }

  /** open_presale + delegations, with the creator's commit (which is also their deposit). */
  async function openPresale({ info, wallet, signTransaction, mint, commit }) {
    if (!validSeat(commit, info.N)) throw new Error(`pick ${sol(info.N.MIN_SEAT)} to ${sol(info.N.MAX_SEAT)} SOL`);
    // the co-signer refuses a creator deposit over this (cosigner.js): at least one other seat fits
    const cap = info.N.TARGET - info.N.MIN_SEAT;
    if (commit > cap) throw new Error(`the creator can put in at most ${sol(cap)} SOL, so others can join`);
    const mintKey = new PublicKey(mint);
    const presale = presalePda(info.pid, mintKey);
    const er = await nearestEr(info);
    const sk = await keyFor(presale.toBase58(), wallet.toBase58());
    const ixs = openIxs(info.pid, {
      creator: wallet, gate: info.gate, mint: mintKey, feeDest: wallet, sessionKey: sk.publicKey,
      deposit: commit, commit, validator: er.validator,
    });
    const r = await signAndCosign(signTransaction, wallet, ixs);
    if (!r.confirmed) await waitFor(presale, (v) => v.where !== "closed", { what: "the presale" });
    return presale;
  }

  // ---- join and the ledger ----

  /** join + delegate(seat), then commit the whole deposit in the ER. */
  async function joinPresale({ info, wallet, signTransaction, view, amount, onStep = (_what) => {} }) {
    if (!validSeat(amount, info.N)) throw new Error(`pick ${sol(info.N.MIN_SEAT)} to ${sol(info.N.MAX_SEAT)} SOL`);
    const presale = new PublicKey(view.presale);
    const sk = await keyFor(view.presale, wallet.toBase58());
    onStep("Sign in your wallet to put the SOL in");
    const ixs = joinIxs(info.pid, { user: wallet, gate: info.gate, presale, sessionKey: sk.publicKey, deposit: amount, validator: new PublicKey(view.validator) });
    const r = await signAndCosign(signTransaction, wallet, ixs);
    if (!r.confirmed) await waitFor(presale, (v) => v.seats?.some((s) => s.user === wallet.toBase58()), { what: "your seat" });
    onStep("Counting you in");
    return setCommit({ info, wallet, signTransaction, view, amount, retries: 8, key: sk });
  }

  const rotating = new Map(); // name -> the rotate_key under way: two at once share it

  /** A session key the seat accepts: `key` (one the caller knows), else the stored one, or
   *  a new one the wallet sets (rotate_key in the ER, one signature). */
  async function usableKey({ info, wallet, signTransaction, er, presale, seat, key }) {
    const [p, w] = [presale.toBase58(), wallet.toBase58()];
    const name = sessionKeyName(p, w);
    const takes = (s, sk) => sk && (!s || s.sessionKey.equals(sk.publicKey)); // not in the ER yet: set_commit retries
    const s = await erSeat(er, seat, info.pid);
    const sk = key ?? (await sessionKey(p, w));
    if (takes(s, sk)) return sk;
    if (!rotating.has(name)) {
      const rotate = async () => {
        // read again inside the lock: a rotation that ended since the read above set it already
        const mine = await sessionKey(p, w);
        if (takes(await erSeat(er, seat, info.pid), mine)) return mine;
        // kept first: once the wallet sends it, the seat may hold it whatever we hear back
        const fresh = await saveSessionKey(p, w, Keypair.generate());
        const ixs = [I.rotateKey(info.pid, { user: wallet, seat, key: fresh.publicKey })];
        await walletErTx({ info, er, wallet, signTransaction, ixs, what: "rotate_key" });
        return fresh;
      };
      rotating.set(name, rotate().finally(() => rotating.delete(name)));
    }
    return rotating.get(name);
  }

  /** set_commit in the ER: `amount` 0 takes it all back. The program cuts a raise to the
   *  room left; the result shows in the next read. `key`: the seat's session key, if the
   *  caller knows it (a join does). */
  async function setCommit({ info, wallet, signTransaction, view, amount, retries = 2, key = null }) {
    if (amount !== 0n && !validSeat(amount, info.N)) throw new Error(`pick ${sol(info.N.MIN_SEAT)} to ${sol(info.N.MAX_SEAT)} SOL, or 0`);
    const presale = new PublicKey(view.presale);
    const seat = seatPda(info.pid, presale, wallet);
    const er = erFor(info, view.validator);
    if (!er) throw new Error("this presale's ER isn't one the server knows");
    const mine = view.seats?.find((s) => s.user === wallet.toBase58());
    if (mine && amount !== 0n) {
      const others = BigInt(view.raised) - BigInt(mine.commit);
      if (cutToRoom(amount, BigInt(mine.commit), others, info.N.TARGET) === null) throw new Error("the pool is full");
    }
    for (let i = 0; ; i++) {
      try {
        key = await usableKey({ info, wallet, signTransaction, er, presale, seat, key });
        return await send(er.conn, { ixs: [I.setCommit(info.pid, { signer: key.publicKey, seat, presale, amount })], payer: key, legacy: true, pid: info.pid, what: "set_commit", timeoutMs: 30_000 });
      } catch (e) {
        // a seat delegated moments ago may not be in the ER yet
        if (i >= retries || /NotAuthorized|BadState|PastDeadline|OverDeposit|NoRoom|CreatorCannotLower|BadSeatSize|rejected/i.test(e.message)) throw e;
        await sleep(1_500);
      }
    }
  }

  /** Takes the seat out of the pool and out of the ER in one ER tx (free): set_commit 0, if
   *  anything is committed, then leave. The session key signs it, so there's no popup; if
   *  this device has no key for the seat, or the ER wants a payer with SOL, the wallet signs. */
  async function leaveEr({ info, er, wallet, signTransaction, presale, seat, s, onStep }) {
    const ixs = (signer) => [
      ...(s.commit > 0n ? [I.setCommit(info.pid, { signer, seat, presale, amount: 0n })] : []),
      I.leave(info.pid, { payer: signer, seat }),
    ];
    const sk = await sessionKey(presale.toBase58(), wallet.toBase58());
    if (sk && s.sessionKey.equals(sk.publicKey)) {
      const no = await erRefuses(er.conn, ixs(sk.publicKey), sk, info.pid);
      if (!no) return send(er.conn, { ixs: ixs(sk.publicKey), payer: sk, legacy: true, pid: info.pid, what: "leave", timeoutMs: 30_000 });
      if (no.ours) throw new Error(no.text);
    }
    onStep("Sign in your wallet to take your SOL out");
    return walletErTx({ info, er, wallet, signTransaction, ixs: ixs(wallet), what: "leave" });
  }

  /** Solana for this server: the app's `rpc`, else the public RPC of its cluster. */
  function solanaFor(info) {
    const r = rpc ?? PUBLIC_RPCS[info.cluster];
    if (!r) throw new Error(`no public Solana RPC for the server's cluster (${info.cluster})`);
    return typeof r === "string" ? new Connection(r, "confirmed") : r;
  }

  /** Get my SOL back: the one button. The seat leaves the pool and the ER, and once it's
   *  home on Solana, settle_seat pays the whole deposit plus the seat's rent to the wallet
   *  with no Mooner fee (the wallet pays the Solana fee). Returns once it's confirmed. SOL
   *  still in the pool comes back only from an OPEN presale (before its deadline) or a
   *  home one that's EXPIRED or FAILED; otherwise it throws a plain line and sends nothing.
   *  A seat Solana no longer has was settled already: it returns, unless the presale
   *  launched and the seat may have had SOL in the pool, or that isn't known (then it says so). */
  async function getBack({ info, wallet, signTransaction, sendTransaction, view, onStep = (_what) => {} }) {
    onStep("Checking your seat");
    const presale = new PublicKey(view.presale);
    const seat = seatPda(info.pid, presale, wallet);
    const conn = solanaFor(info);
    const mine = (v) => v?.seats?.find((s) => s.user === wallet.toBase58());
    // Where Solana has the seat: "gone" (settled, refunded or claimed), "home" (owned
    // by the program again: what settle_seat checks; `s` is the seat), "away" (delegated),
    // or "unknown" (the read failed). A view can miss a seat on its way home, so only Solana
    // says it's gone.
    const onSolana = () =>
      timed(conn.getAccountInfo(seat, "confirmed"), 10_000, "Solana").then(
        (a) => (a === null ? { at: "gone" } : a.owner.equals(info.pid) ? { at: "home", s: decodeSeat(a.data) } : { at: "away" }),
        () => ({ at: "unknown" }),
      );
    // The presale now: Solana's copy once it's home, else the ER's (the live one). None on
    // Solana: it closed. If Solana doesn't answer (a = undefined), a seat in the ER goes by
    // the ER's copy: it's the one set_commit checks.
    const presaleNow = async (inEr) => {
      try {
        const a = await timed(conn.getAccountInfo(presale, "confirmed"), 10_000, "Solana").catch((e) => {
          if (inEr) return undefined;
          throw e;
        });
        if (a?.owner.equals(info.pid)) return { home: true, p: decodePresale(a.data) };
        const er = a === null ? null : erFor(info, view.validator);
        const e = er && (await timed(er.conn.getAccountInfo(presale), 10_000, "the presale's ER"));
        return e?.owner.equals(info.pid) ? { home: false, p: decodePresale(e.data) } : null;
      } catch {
        return null;
      }
    };
    const mayTake = async (inEr) => {
      const no = held(await presaleNow(inEr), inEr);
      if (no) throw new Error(no);
    };
    const had = mine(view); // the seat as the view getBack was handed lists it
    const hadCommit = had ? BigInt(had.commit ?? 0) : null; // null: not known
    // Whether the presale launched, as Solana has it (null: not known): SETTLED there, not
    // while it's in the ER (only a presale that's home launches), and once it's closed (none
    // there, or System's if someone sent SOL to it since), as the server's view says if it
    // answers.
    const launchedOnSolana = async () => {
      const a = await timed(conn.getAccountInfo(presale, "confirmed"), 10_000, "Solana").catch(() => undefined);
      if (a === undefined) return null;
      if (a?.owner.equals(info.pid)) return decodePresale(a.data).state === STATE.SETTLED;
      if (a?.owner.equals(DELEGATION_PROGRAM)) return false;
      const v = await timed(api.presale(presale.toBase58()), 10_000, "the server").catch(() => null);
      return v?.state === "CLOSED" ? Boolean(v.launch) : null;
    };
    // Solana no longer has the seat: settled, which is a refund, unless the presale launched
    // and the seat had SOL in the pool: then the keeper claimed it, and paid tokens. A view
    // that isn't final yet (OPEN, FULL, LAUNCHING) may be behind: Solana decides then.
    const gone = async (commit) => {
      if (commit === 0n) return;
      const final = { SETTLED: true, EXPIRED: false, FAILED: false, CLOSED: Boolean(view.launch) }[view.state];
      const launched = final ?? (commit === null ? false : await launchedOnSolana());
      if (launched === false) return;
      throw new Error(launched === null ? SETTLED_ANY : commit === null ? AT_LAUNCH : CLAIMED);
    };
    let now = await onSolana();
    // one "gone" while the view lists the seat may be an RPC that's behind: ask again once
    // the server's view (cached 2 s, api.js) has caught up, and believe it if both agree
    if (now.at === "gone" && had) {
      await sleep(2_000);
      now = await onSolana();
      if (now.at === "unknown") throw new Error(UNREACHABLE);
    }
    if (now.at === "gone") return await gone(hadCommit);
    let commit; // what the home seat has in the pool
    // the view decides only when Solana didn't answer
    if (now.at === "home" || (now.at === "unknown" && mine(view)?.where === "home")) {
      commit = now.s?.commit ?? BigInt(mine(view).commit ?? 0);
    } else {
      const er = erFor(info, view.validator);
      if (!er) throw new Error("this presale's ER isn't one the server knows");
      const s = await timed(erSeat(er, seat, info.pid), 10_000, "the presale's ER");
      // not in the ER any more: it left already and is on its way home
      if (s) {
        if (s.commit > 0n) await mayTake(true);
        onStep("Taking your SOL out");
        await leaveEr({ info, er, wallet, signTransaction, presale, seat, s, onStep }).catch(async (e) => {
          // past the deadline the keeper expires the presale and refunds the seat; one that
          // filled since the check keeps the SOL
          if (/PastDeadline/.test(e.message)) throw new Error(BY_ITSELF);
          if (/BadState/.test(e.message)) await mayTake(true);
          throw e;
        });
      }
      onStep("Bringing it back to Solana");
      let found = null; // what Solana said when it ended the wait
      let unanswered = false; // Solana's newest read failed
      // reads are numbered: an older one that ends late doesn't change `unanswered`
      let asked = 0;
      let heard = 0;
      const landed = async (v) => {
        const n = ++asked;
        const got = mine(v) ? null : await onSolana();
        if (n > heard) {
          heard = n;
          unanswered = got?.at === "unknown";
        }
        if (!got) return mine(v).where === "home";
        if (got.at === "gone" || got.at === "home") found = got;
        return found !== null;
      };
      view = await waitFor(presale, landed, { what: "your seat on Solana", timeoutMs: 120_000 }).catch((e) => {
        throw unanswered ? new Error(UNREACHABLE) : e;
      });
      const listed = mine(view)?.where === "home";
      // the keeper settled it already; after the leave above it had nothing in the pool
      if (!listed && found.at === "gone") return await gone(s ? 0n : hadCommit);
      commit = listed ? BigInt(mine(view).commit ?? 0) : found.s.commit;
    }
    // settle_seat would take SOL in the pool into a FULL presale: not a refund
    if (commit > 0n) await mayTake(false);
    onStep("Sending it to your wallet");
    const { blockhash, lastValidBlockHeight } = await api.blockhash();
    const ixs = [I.settleSeat(info.pid, { cranker: wallet, seat, user: wallet, presale })];
    const tx = unsignedTx({ ixs, payer: wallet, blockhash });
    const sig = await sendTransaction(tx, conn, { skipPreflight: false }).catch((e) => {
      throw named(e, info.pid);
    });
    const done = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (done.value.err) throw new Error(`the refund failed: ${describeTxError(done.value.err, ixs.map((i) => i.programId), info.pid, await txLogs(conn, sig))}`);
    // confirmed: the seat is closed. A seat with nothing committed closes without touching
    // the presale, so no push follows; the caller drops it from what it shows.
  }

  return { loadInfo, sessionKey, waitFor, requestMint, openPresale, joinPresale, setCommit, getBack };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd engine && node --test test/flows.test.js`
Expected: PASS (`# pass 82`).

Run: `cd engine && npm test`
Expected: `# pass 233`, `# fail 0`.

- [ ] **Step 6: Commit (only after the user says to commit)**

```bash
git add engine/src/flows.js engine/test/flows.test.js engine/src/consts.js engine/src/tx.js engine/server/api.js
git commit -m "engine: chain flows shared by web and phone"
```

---

## Task 11: The web app uses the shared code

**Files:**
- Modify (replace the whole file): `web/src/real/api.js`
- Modify (replace the whole file): `web/src/real/chain.js`
- Modify: `web/src/lib/store.ts` (the sign-in text; the cost checks in `findMatch` and `createLaunch`)
- Modify: `web/src/lib/launch.ts`, `web/src/components/launch/LaunchScreen.tsx`, `web/src/components/presale/CommitPanel.tsx`, `web/src/components/shell/FindMatchDialog.tsx` (the cost checks)

- [ ] **Step 1: Replace `web/src/real/api.js`**

```js
// The Mooner server's API, same origin (engine/src/apiclient.js; the phone app uses it too).
import { makeApi } from "../../../engine/src/apiclient.js";

export { ApiError } from "../../../engine/src/apiclient.js";
export const api = makeApi("");
```

- [ ] **Step 2: Replace `web/src/real/chain.js`**

```js
// Everything the site does on chain: engine/src/flows.js (the phone app runs the same
// code), wired to this browser: the same-origin API, the live socket, and session keys in
// localStorage (if that throws, as in private mode, flows.js keeps them in memory until the
// page reloads; after that the wallet signs a rotate_key). Solana for the refund is the
// public RPC of the server's cluster (flows.js PUBLIC_RPCS).

import { makeFlows } from "../../../engine/src/flows.js";
import { api } from "./api.js";
import { subscribe } from "./live.js";

export { erFor, explain, LAMPORTS, nearestEr, PUBLIC_RPC, sol, toLamports } from "../../../engine/src/flows.js";
export { loginMessage } from "../../../engine/src/client.js";

const keys = {
  get: async (name) => localStorage.getItem(name),
  set: async (name, value) => localStorage.setItem(name, value),
};

export const { loadInfo, sessionKey, waitFor, requestMint, openPresale, joinPresale, setCommit, getBack } = makeFlows({ api, subscribe, keys });
```

It exports `LAMPORTS`, `PUBLIC_RPC`, `erFor`, `explain`, `getBack`, `joinPresale`, `loadInfo`, `loginMessage`, `nearestEr`, `openPresale`, `requestMint`, `sessionKey`, `setCommit`, `sol`, `toLamports` and `waitFor`. `main.tsx` uses `PUBLIC_RPC`. `store.ts` uses `PUBLIC_RPC`, `explain`, `getBack`, `joinPresale`, `loadInfo`, `openPresale`, `requestMint` and, from Step 3, `loginMessage`. It passes no `priority` or `rpc`: entry txs pay 50,000 µLamports per CU, and `getBack` uses the public RPC of the server's cluster.

- [ ] **Step 3: `store.ts` signs the shared text**

In `signIn` in `web/src/lib/store.ts`, replace:

```ts
          const text = ['Mooner: sign in', `wallet: ${wallet}`, `time: ${time}`].join('\n')
```

with:

```ts
          const text = chain.loginMessage(wallet, time)
```

(`store.ts` already has `import * as chain from '@/real/chain.js'` on line 9.)

- [ ] **Step 4: Check the whole cost before the wallet signs**

A join or an open takes more than the SOL it puts in: rent, the Solana fee, and what a wallet must keep. The site counts it with `joinCost` and `openCost` from `flows.js` (Task 10). While the cost is unknown (its read failed or hasn't answered), only the SOL put in is checked.

In `web/src/lib/launch.ts`, add `notEnoughSol`, and give `validateLaunch` the open cost:

```ts
/** "Not enough SOL" for an entry tx: the SOL it puts in (`deposit`) and what else it takes from
 *  the wallet (`extra`, flows.js joinCost or openCost), null while that isn't known. */
export function notEnoughSol(what: 'the join' | 'opening the presale', deposit: Lamports, extra: number | null): string {
  const up = (l: number) => Math.ceil(l / 1e5) * 1e5 // to 4 decimals, rounded up
  const yours = what === 'the join' ? 'your seat' : 'your commit'
  return extra === null
    ? `Not enough SOL: ${what} needs more than ${fmtSol(deposit)} SOL`
    : `Not enough SOL: ${what} needs about ${fmtSol(up(deposit + extra), 4)} SOL, ${fmtSol(deposit)} for ${yours} plus ${fmtSol(up(extra), 4)} for rent, the Solana fee and what a wallet must keep`
}

/** `openExtra`: what opening takes besides the commit (flows.js openCost), null while unknown. */
export function validateLaunch(w: World, form: LaunchForm, openExtra: number | null = null): LaunchErrors {
  const errors: LaunchErrors = {}
  const name = form.name.trim()
  if (name.length < 2) errors.name = 'At least 2 characters'
  else if (name.length > NAME_MAX) errors.name = `At most ${NAME_MAX} characters`

  const ticker = normalizeTicker(form.ticker)
  if (ticker.length < TICKER_MIN || ticker.length > TICKER_MAX) errors.ticker = `${TICKER_MIN}–${TICKER_MAX} letters or digits`
  else if (Object.values(w.tokens).some((t) => t.stage !== 'expired' && t.ticker === ticker)) errors.ticker = `$${ticker} is taken`

  if (form.description.trim().length > DESCRIPTION_MAX) errors.description = `At most ${DESCRIPTION_MAX} characters`

  for (const key of LINK_KINDS) {
    const value = form.links[key] ?? ''
    if (value.trim() && !linkHref(key, value)) errors[key] = LINK_ERRORS[key]
  }

  if (!(PRESALE_TIMER_MINUTES as readonly number[]).includes(form.minutes)) {
    errors.minutes = `Pick ${PRESALE_TIMER_MINUTES.join(', ')} minutes`
  }

  if (form.commit < MIN_COMMIT || form.commit > MAX_CREATOR_COMMIT || form.commit % COMMIT_STEP !== 0) {
    errors.commit = `${fmtSol(MIN_COMMIT)}–${fmtSol(MAX_CREATOR_COMMIT)} SOL`
  } else if (form.commit + (openExtra ?? 0) > w.walletLamports) errors.commit = notEnoughSol('opening the presale', form.commit, openExtra)
  return errors
}
```

In `web/src/components/launch/LaunchScreen.tsx`, import `openCost` from `'../../../../engine/src/flows.js'` and pass it to `validateLaunch`, which puts the line on the commit field:

```tsx
  // Opening also pays two accounts' rent and their delegation's and the Solana fee, and the
  // wallet keeps a little (flows.js openCost): checked before anything is signed
  const [openExtra, setOpenExtra] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    openCost().then((c) => live && setOpenExtra(Number(c.total)), () => {})
    return () => {
      live = false
    }
  }, [])
  const errors = validateLaunch(world, current, openExtra)
```

In `web/src/components/presale/CommitPanel.tsx`, import `notEnoughSol` from `'@/lib/launch'` and `joinCost` from `'../../../../engine/src/flows.js'`, then count the join. `short` disables the button and shows `shortText`:

```tsx
  // The join also pays the seat's rent, the delegation's and the Solana fee, and the wallet
  // keeps a little: counted as the phone app's check counts it (flows.js joinCost).
  const [extra, setExtra] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    joinCost().then((c) => live && setExtra(Number(c.total)), () => {})
    return () => {
      live = false
    }
  }, [])
  const need = deposit + (extra ?? 0)
  const short = need > world.walletLamports
  const shortText = notEnoughSol('the join', deposit, extra)
```

In `web/src/components/shell/FindMatchDialog.tsx`, the same two imports, then the same count. `short` disables the button and shows `notEnoughSol('the join', amount, extra)`:

```tsx
  // The join also pays rent and the Solana fee, and the wallet keeps a little (flows.js
  // joinCost, as CommitPanel counts it); while that's unknown, just the amount.
  const [extra, setExtra] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    joinCost().then((c) => live && setExtra(Number(c.total)), () => {})
    return () => {
      live = false
    }
  }, [])
  const short = connected && amount + (extra ?? 0) > wallet
```

In `web/src/lib/store.ts`, add `notEnoughSol` to the `./launch` import, and import `joinCost` and `openCost` from `'../../../engine/src/flows.js'`. `findMatch` checks before it picks a presale:

```ts
        // the same join tx JoinForm sends: the deposit, and what the join takes besides it
        const extra = await joinCost().then((c) => Number(c.total), () => null)
        if (value + (extra ?? 0) > get().world.walletLamports) return fail(notEnoughSol('the join', value, extra))
```

`createLaunch` checks before the wallet signs anything:

```ts
        // before the wallet signs anything and the server pins the metadata: the commit, and
        // what opening takes besides it
        const extra = await openCost().then((c) => Number(c.total), () => null)
        if (value + (extra ?? 0) > get().world.walletLamports) return fail(notEnoughSol('opening the presale', value, extra))
```

- [ ] **Step 5: The sign-in text exists once**

```bash
grep -rn "Mooner: sign in" engine/src engine/server web/src
```

Expected: exactly one line, in `engine/src/client.js`.

- [ ] **Step 6: Build the web app**

```bash
cd web && npm run build
```

Expected: both Vite builds (the app, then `/sim`) finish with no errors. This needs `VITE_PRIVY_APP_ID` in `web/.env`, which is already there. `flows.js` imports `@noble/hashes`: `web/package.json` has 1.8.0, and `vite.config.js` dedupes it with web3.js and `buffer`.

- [ ] **Step 7: Check it in the browser pane against the live API**

Start the `mooner-app-3000` preview from `.claude/launch.json`. It runs Vite on port 3000 and forwards `/api` to https://app.mooner.family.
- Check the console for errors (`read_console_messages`).
- Check that the Live list shows the server's real presales. They come over the live socket, and the page loads only if `main.tsx` and `store.ts` can import the new `chain.js`.
- Open one presale page and check that it loads.
- Open `/launch`. `LaunchScreen` calls `openCost()` as it mounts, which reads rents from https://api.mainnet-beta.solana.com. Check those requests in `read_network_requests`.

Don't join or open anything: those are mainnet spends. Screenshot the Live page as proof, then stop the preview.

- [ ] **Step 8: Engine tests still pass**

```bash
cd engine && npm test
```

Expected: `# pass 233`, `# fail 0`.

- [ ] **Step 9: Commit (only after the user says to commit)**

```bash
git add web/src/real/api.js web/src/real/chain.js web/src/lib/store.ts web/src/lib/launch.ts web/src/components/launch/LaunchScreen.tsx web/src/components/presale/CommitPanel.tsx web/src/components/shell/FindMatchDialog.tsx
git commit -m "web: use the shared API client, flows, sign-in text and entry costs"
```

Deploying the web change (`sh deploy/railway.sh app`) is the user's call and the user runs it.

---

## After this plan

The piece 1 plan (the core app's screens) is written once Task 9 has the answers. It builds on:
- `makeFlows` with an `expo-secure-store` key store;
- `makeApi("https://app.mooner.family")`;
- the MWA signer from `useMobileWallet()`, with `signTransactions`, `signAndSendTransactions` and `signMessages`;
- the entry-tx sending decided in Task 9.
