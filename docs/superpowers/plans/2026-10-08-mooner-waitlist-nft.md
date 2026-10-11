# Mooner waitlist: verified signups + free NFT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Joining the waitlist at mooner.family means verifying an email (Privy code), logging in with X, and getting a Privy Solana wallet. Each member gets 1 NFT reserved, or 2 when they were already on the early list.

**Architecture:**
- **Server:** `site/server.mjs` keeps serving the page and gains `POST /api/join`. It checks a Privy access token with `node:crypto`, reads the user's verified email, X account and wallet from Privy's REST API (`site/privy.mjs`), refuses throwaway domains, and writes a `members` row in the same SQLite file. The early `waitlist` table is frozen apart from a new `claimed_by` column.
- **Page:** a small React + Privy bundle (`site/join/join.js`), built with web's Vite into `site/assets/join/`. `main.js` loads it on the first join click, or when X sends the person back.

**Tech Stack:**
- Node 22: `node:http`, `node:sqlite`, `node:crypto`, `node:test`. No new server dependencies.
- The bundle: Vite 8.3.1, React 19.3 and `@privy-io/react-auth` 3.45.0, all borrowed from `web/node_modules`.

Spec: `docs/superpowers/specs/2026-10-08-mooner-waitlist-nft-design.md`.

**Commits:**
- `site/` is untracked. The user's rule is to commit only when they ask.
- Each task ends with a **Checkpoint** (run the tests, show the diff), not a commit.

**Run the tests with:**

```bash
node --disable-warning=ExperimentalWarning --test site/server.test.mjs site/privy.test.mjs
```

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `site/privy.mjs` | create | Privy on the server: `verifyToken`, `accountsOf`, `privyAuth` |
| `site/privy.test.mjs` | create | tests for `privy.mjs` |
| `site/server.mjs` | modify | store (`members`, `claimed_by`, `join`), CSVs, `throwawayCheck`, `/api/join`, 410 on the old endpoint, `join.js` cache rule, env, `--members` |
| `site/server.test.mjs` | rewrite | server tests with a stubbed Privy |
| `site/disposable-domains.txt` | create | the CC0 throwaway-domain list |
| `site/join/join.js` | create | the browser sign-up flow: Privy modal → X → wallet → `/api/join` |
| `site/tools/build-join.mjs` | create | builds `site/join/join.js` into `site/assets/join/` |
| `site/main.js` | modify | the `waitlist()` block: email only, loads the bundle, resumes after X |
| `site/index.html` | modify | label, placeholder, the NFT note line (two forms) |
| `site/README.md` | modify | the new flow, env, exports, build |
| `deploy/railway.sh` | modify | site: build the bundle, ship `privy.mjs` and the domain list |
| `deploy/site.Dockerfile` | modify | comment only: the volume now holds wallets too |
| `.gitignore` | modify | `site/assets/join/` |
| `.claude/launch.json` | modify | `mooner-site` runs under `vault run` so it has the Privy env |

---

### Task 1: `site/privy.mjs`, checking Privy tokens and reading users

**Files:**
- Create: `site/privy.mjs`
- Test: `site/privy.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `site/privy.test.mjs`:

```js
// node --disable-warning=ExperimentalWarning --test site/privy.test.mjs

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { accountsOf, privyAuth, verifyToken } from "./privy.mjs";

const APP = "app-123";
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = publicKey.export({ type: "spki", format: "pem" });
const NOW = 1_800_000_000_000;
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A Privy-shaped access token; `claims` override the good ones. */
function token(claims = {}, { alg = "ES256", key = privateKey } = {}) {
  const good = { iss: "privy.io", aud: APP, sub: "did:privy:abc123", sid: "s1", iat: NOW / 1000 - 60, exp: NOW / 1000 + 3600 };
  const signed = `${enc({ alg, typ: "JWT" })}.${enc({ ...good, ...claims })}`;
  const sig = crypto.sign("sha256", Buffer.from(signed), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${signed}.${sig}`;
}
const check = (t) => verifyToken(t, { appId: APP, key: PEM, now: () => NOW });

test("verifyToken: a good token gives the Privy user id", () => {
  assert.equal(check(token()), "did:privy:abc123");
  assert.equal(check(token({ aud: ["other", APP] })), "did:privy:abc123");
  assert.equal(check(token({ exp: NOW / 1000 - 29 })), "did:privy:abc123"); // 30 s of skew
});

test("verifyToken: refuses expired, another app, another issuer, another key, another alg, odd ids, junk", () => {
  const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  assert.equal(check(token({ exp: NOW / 1000 - 31 })), null);
  assert.equal(check(token({ exp: "never" })), null);
  assert.equal(check(token({ aud: "someone-else" })), null);
  assert.equal(check(token({ iss: "evil.io" })), null);
  assert.equal(check(token({ sub: "../admin" })), null);
  assert.equal(check(token({}, { key: other })), null);
  assert.equal(check(token({}, { alg: "none" })), null);
  const t = token();
  assert.equal(check(`${t.slice(0, t.lastIndexOf(".") + 1)}${"A".repeat(86)}`), null);
  for (const junk of ["", "a.b", "a.b.c", "a.b.c.d", "...", `${enc(null)}.${enc(null)}.AA`, null, 42]) assert.equal(check(junk), null, String(junk));
});

test("accountsOf: the email, the X account and the Privy Solana wallet; anything else is ignored", () => {
  const user = {
    id: "did:privy:abc123",
    linked_accounts: [
      { type: "wallet", chain_type: "ethereum", wallet_client_type: "privy", address: "0xabc" },
      { type: "wallet", chain_type: "solana", wallet_client_type: "phantom", address: "Phan1" },
      { type: "email", address: " Moon@Example.COM ", verified_at: 1 },
      { type: "twitter_oauth", subject: "123456", username: "Moon_Fan", verified_at: 1 },
      { type: "wallet", chain_type: "solana", wallet_client_type: "privy", connector_type: "embedded", address: "So1Privy" },
    ],
  };
  assert.deepEqual(accountsOf(user), { email: "moon@example.com", xId: "123456", xHandle: "moon_fan", wallet: "So1Privy" });
  const none = { email: null, xId: null, xHandle: null, wallet: null };
  assert.deepEqual(accountsOf({ linked_accounts: [] }), none);
  assert.deepEqual(accountsOf(null), none);
  assert.deepEqual(accountsOf({ linked_accounts: [{ type: "twitter_oauth", subject: "9", username: null }] }), { ...none, xId: "9" });
});

test("privyAuth: checks tokens with the PEM (\\n-escaped too) and reads users with Basic auth", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push([url, init.headers]);
    return url.endsWith("did:privy:gone") ? new Response("{}", { status: 404 }) : Response.json({ id: "did:privy:abc123", linked_accounts: [] });
  };
  for (const key of [PEM, PEM.trim().replaceAll("\n", "\\n")]) {
    const auth = privyAuth({ appId: APP, secret: "s3cret", key, fetch, now: () => NOW });
    assert.equal(auth.verify(token()), "did:privy:abc123");
  }
  const auth = privyAuth({ appId: APP, secret: "s3cret", key: PEM, fetch, now: () => NOW });
  assert.deepEqual(await auth.user("did:privy:abc123"), { id: "did:privy:abc123", linked_accounts: [] });
  assert.equal(calls[0][0], "https://api.privy.io/v1/users/did:privy:abc123");
  assert.deepEqual(calls[0][1], { "privy-app-id": APP, authorization: `Basic ${Buffer.from(`${APP}:s3cret`).toString("base64")}` });
  await assert.rejects(auth.user("did:privy:gone"), /HTTP 404/);
  assert.throws(() => privyAuth({ appId: APP, secret: "s", key: "not a key" }));
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --disable-warning=ExperimentalWarning --test site/privy.test.mjs`

Expected: FAIL. The import of `./privy.mjs` errors with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write `site/privy.mjs`**

```js
// Privy on the server: checks a Privy access token and reads a user's verified accounts from
// Privy's REST API. node:crypto and fetch only.
//   tokens: docs.privy.io/authentication/user-authentication/access-tokens
//   users:  docs.privy.io/api-reference/users/get

import crypto from "node:crypto";

const DID = /^did:privy:[A-Za-z0-9]+$/;

/** The Privy user id (`sub`) of a good access token, else null. Good: ES256, signed by `key`,
 *  issued by privy.io for `appId`, and not expired (30 s of skew). */
export function verifyToken(token, { appId, key, now = Date.now }) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const [head, body, sig] = parts;
  let claims;
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (header?.alg !== "ES256" || !claims || typeof claims !== "object") return null;
    const signed = Buffer.from(`${head}.${body}`);
    if (!crypto.verify("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))) return null;
  } catch {
    return null;
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== "privy.io" || !aud.includes(appId)) return null;
  if (typeof claims.exp !== "number" || claims.exp + 30 < now() / 1000) return null;
  return typeof claims.sub === "string" && DID.test(claims.sub) ? claims.sub : null;
}

/** What joining needs from a Privy user (the API's JSON): { email, xId, xHandle, wallet }, each
 *  null when missing. The wallet is the Privy-made Solana one, the one the web app shows. */
export function accountsOf(user) {
  const linked = Array.isArray(user?.linked_accounts) ? user.linked_accounts : [];
  const email = linked.find((a) => a.type === "email" && typeof a.address === "string");
  const x = linked.find((a) => a.type === "twitter_oauth" && typeof a.subject === "string");
  const wallet = linked.find(
    (a) => a.type === "wallet" && a.chain_type === "solana" && a.wallet_client_type === "privy" && typeof a.address === "string",
  );
  return {
    email: email ? email.address.trim().toLowerCase() : null,
    xId: x ? x.subject : null,
    xHandle: x && typeof x.username === "string" ? x.username.toLowerCase() : null,
    wallet: wallet ? wallet.address : null,
  };
}

/** `verify(token)` and `user(id)` for one Privy app. `key` is the verification key's PEM from
 *  Privy's dashboard (Configuration > App settings); its newlines may come escaped as \n, as
 *  they do in some env editors. A key that isn't one throws here, at start. */
export function privyAuth({ appId, secret, key, fetch = globalThis.fetch, now = Date.now, timeoutMs = 8000 }) {
  const publicKey = crypto.createPublicKey(key.replaceAll("\\n", "\n"));
  const authorization = `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`;
  return {
    verify: (token) => verifyToken(token, { appId, key: publicKey, now }),
    async user(id) {
      // `id` comes from verify(), so it's did:privy:<letters and digits>, safe in the path
      const res = await fetch(`https://api.privy.io/v1/users/${id}`, {
        headers: { "privy-app-id": appId, authorization },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`privy users: HTTP ${res.status}`);
      return res.json();
    },
  };
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `node --disable-warning=ExperimentalWarning --test site/privy.test.mjs`

Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Checkpoint.** Show `site/privy.mjs` and the test output to the reviewer. Don't commit.

---

### Task 2: the store (members, `claimed_by`, `join`) and the CSVs

**Files:**
- Modify: `site/server.mjs`: `openStore` (lines 52-73) and `toCsv` (lines 75-84); add `cell` and `toMembersCsv`
- Test: `site/server.test.mjs` (the full rewrite is in Task 3; this task adds store tests to the current file first)

- [ ] **Step 1: Write the failing store tests**

Append to `site/server.test.mjs`. Add `toMembersCsv` to the import from `./server.mjs` on line 8, and add `import { DatabaseSync } from "node:sqlite";` to the imports.

```js
test("store.join: 1 NFT; 2 when the email or X handle is on the early list, once per person; again is 'already'", () => {
  const s = openStore(":memory:");
  s.add({ contact: "early@example.com", kind: "email" }, 1);
  s.add({ contact: "@earlybird", kind: "x" }, 2);
  s.add({ contact: "both@example.com", kind: "email" }, 3);
  s.add({ contact: "@both_x", kind: "x" }, 4);
  const m = (id, email, xHandle, wallet) => ({ privyId: `did:privy:${id}`, email, xId: `x-${id}`, xHandle, wallet, ref: null });
  assert.deepEqual(s.join(m("new", "new@example.com", "newbie", "W0"), 10), { nfts: 1, early: false, already: false });
  assert.deepEqual(s.join(m("byemail", "early@example.com", "someone", "W1"), 11), { nfts: 2, early: true, already: false });
  assert.deepEqual(s.join(m("byx", "x@example.com", "earlybird", "W2"), 12), { nfts: 2, early: true, already: false });
  assert.deepEqual(s.join(m("both", "both@example.com", "both_x", "W3"), 13), { nfts: 2, early: true, already: false });
  assert.deepEqual(s.join(m("both", "both@example.com", "both_x", "W3"), 14), { nfts: 2, early: true, already: true });
  // the handle went to someone else since: the row is claimed, so 1
  assert.deepEqual(s.join(m("taker", "t@example.com", "earlybird", "W4"), 15), { nfts: 1, early: false, already: false });
  assert.deepEqual(
    s.all().map((r) => [r.contact, r.claimed_by]),
    [["early@example.com", "did:privy:byemail"], ["@earlybird", "did:privy:byx"], ["both@example.com", "did:privy:both"], ["@both_x", "did:privy:both"]],
  );
  assert.deepEqual(s.members().map((r) => [r.wallet, r.nfts]), [["W0", 1], ["W1", 2], ["W2", 2], ["W3", 2], ["W4", 1]]);
  s.close();
});

test("store.join: an email, X account or wallet that's another member's throws, and claims nothing", () => {
  const s = openStore(":memory:");
  s.add({ contact: "late@example.com", kind: "email" }, 1);
  s.join({ privyId: "did:privy:a", email: "a@example.com", xId: "xa", xHandle: "a", wallet: "Wa" }, 2);
  assert.throws(() => s.join({ privyId: "did:privy:b", email: "a@example.com", xId: "xb", xHandle: "b", wallet: "Wb" }, 3), /UNIQUE constraint failed: members\.email/);
  assert.throws(() => s.join({ privyId: "did:privy:c", email: "late@example.com", xId: "xa", xHandle: "c", wallet: "Wc" }, 3), /members\.x_id/);
  assert.throws(() => s.join({ privyId: "did:privy:d", email: "d@example.com", xId: "xd", xHandle: "d", wallet: "Wa" }, 3), /members\.wallet/);
  assert.equal(s.all()[0].claimed_by, null); // c's claim was rolled back
  assert.equal(s.members().length, 1);
  s.close();
});

test("an old database gains claimed_by and keeps its rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-"));
  const file = path.join(dir, "waitlist.db");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE waitlist (contact TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT, created_at INTEGER NOT NULL)");
  old.prepare("INSERT INTO waitlist VALUES (?, ?, ?, ?)").run("a@b.co", "email", null, 5);
  old.close();
  const s = openStore(file);
  assert.deepEqual(s.all().map((r) => ({ ...r })), [{ contact: "a@b.co", kind: "email", ref: null, created_at: 5, claimed_by: null }]);
  s.close();
  openStore(file).close(); // opening again doesn't add the column twice
  fs.rmSync(dir, { recursive: true });
});

test("members CSV: the airdrop list; a cell starting = + - @ is quoted off", () => {
  const csv = toMembersCsv([
    { wallet: "W1", nfts: 2, email: "a@b.co", x_handle: "moon_fan", ref: null, created_at: 0 },
    { wallet: "W2", nfts: 1, email: "=cmd@b.co", x_handle: null, ref: "Luna2004", created_at: 1000 },
  ]);
  assert.equal(
    csv,
    "wallet,nfts,email,x,ref,joined_at\nW1,2,a@b.co,https://x.com/moon_fan,,1970-01-01T00:00:00.000Z\nW2,1,'=cmd@b.co,,Luna2004,1970-01-01T00:00:01.000Z\n",
  );
});
```

Also change the expected string in the existing test `"CSV export: handles as x.com links, quoting where needed"`. The rows given to `toCsv` there gain `claimed_by`, and the header gains `claimed`:

```js
test("CSV export: the early list, handles as x.com links, quoting where needed, claimed rows marked", () => {
  const csv = toCsv([
    { contact: "a@b.co", kind: "email", ref: "Luna2004", created_at: 0, claimed_by: "did:privy:a" },
    { contact: "@moon_fan", kind: "x", ref: null, created_at: 1000, claimed_by: null },
    { contact: 'we"ird,@b.co', kind: "email", ref: null, created_at: 2000, claimed_by: null },
  ]);
  assert.equal(
    csv,
    'contact,kind,ref,joined_at,claimed\na@b.co,email,Luna2004,1970-01-01T00:00:00.000Z,yes\nhttps://x.com/moon_fan,x,,1970-01-01T00:00:01.000Z,\n"we""ird,@b.co",email,,1970-01-01T00:00:02.000Z,\n',
  );
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --disable-warning=ExperimentalWarning --test site/server.test.mjs`

Expected: FAIL. `toMembersCsv` is not exported (SyntaxError on import).

- [ ] **Step 3: Implement it in `site/server.mjs`**

Replace `openStore` with:

```js
export function openStore(file) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(file)) fs.closeSync(fs.openSync(file, "a", 0o600));
  }
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = DELETE;
CREATE TABLE IF NOT EXISTS waitlist (
  contact    TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  ref        TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  privy_id   TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  x_id       TEXT NOT NULL UNIQUE,
  x_handle   TEXT,
  wallet     TEXT NOT NULL UNIQUE,
  nfts       INTEGER NOT NULL,
  ref        TEXT,
  created_at INTEGER NOT NULL
);`);
  // waitlist is the early list, from before signups were verified; it's frozen except for
  // claimed_by, the member who used the row for their 2 NFTs
  if (!db.prepare("PRAGMA table_info(waitlist)").all().some((c) => c.name === "claimed_by"))
    db.exec("ALTER TABLE waitlist ADD COLUMN claimed_by TEXT");
  const insert = db.prepare("INSERT OR IGNORE INTO waitlist (contact, kind, ref, created_at) VALUES (?, ?, ?, ?)");
  const member = db.prepare("SELECT nfts FROM members WHERE privy_id = ?");
  const claim = db.prepare("UPDATE waitlist SET claimed_by = ? WHERE claimed_by IS NULL AND contact IN (?, ?)");
  const addMember = db.prepare(
    "INSERT INTO members (privy_id, email, x_id, x_handle, wallet, nfts, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  return {
    /** A row on the early list (tests seed with it). true: new. false: it was already there. */
    add: ({ contact, kind, ref }, now = Date.now()) => insert.run(contact, kind, ref ?? null, now).changes > 0,
    /** Puts a verified person on the list and says what they have: { nfts, early, already }. 2 NFTs
     *  when their email or X handle is an unclaimed early row (all such rows become theirs), else 1.
     *  The same Privy user again gets their row back. When the email, X account or wallet is
     *  another member's, it throws node:sqlite's "UNIQUE constraint failed: members.<column>". */
    join({ privyId, email, xId, xHandle, wallet, ref }, now = Date.now()) {
      const had = member.get(privyId);
      if (had) return { nfts: had.nfts, early: had.nfts > 1, already: true };
      db.exec("BEGIN IMMEDIATE");
      try {
        const early = claim.run(privyId, email, xHandle ? `@${xHandle}` : null).changes > 0;
        const nfts = early ? 2 : 1;
        addMember.run(privyId, email, xId, xHandle ?? null, wallet, nfts, ref ?? null, now);
        db.exec("COMMIT");
        return { nfts, early, already: false };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    count: () => db.prepare("SELECT COUNT(*) AS n FROM waitlist").get().n,
    all: () => db.prepare("SELECT contact, kind, ref, created_at, claimed_by FROM waitlist ORDER BY created_at").all(),
    members: () => db.prepare("SELECT wallet, nfts, email, x_handle, ref, created_at FROM members ORDER BY created_at, rowid").all(), // rowid: joins in the same ms keep their order
    close: () => db.close(),
  };
}
```

Replace `toCsv` with these three:

```js
/** A CSV cell: quoted when it has to be, and a leading = + - @ is put behind a ' so a
 *  spreadsheet never reads it as a formula. */
function cell(v) {
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const iso = (ms) => new Date(ms).toISOString();

/** The early list as CSV. Handles come out as x.com links; claimed = a member used the row. */
export function toCsv(rows) {
  const lines = ["contact,kind,ref,joined_at,claimed"];
  for (const r of rows) {
    const contact = r.kind === "x" ? `https://x.com/${r.contact.slice(1)}` : r.contact;
    lines.push([contact, r.kind, r.ref ?? "", iso(r.created_at), r.claimed_by ? "yes" : ""].map(cell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** The members as CSV: the NFT airdrop list. */
export function toMembersCsv(rows) {
  const lines = ["wallet,nfts,email,x,ref,joined_at"];
  for (const r of rows) {
    const x = r.x_handle ? `https://x.com/${r.x_handle}` : "";
    lines.push([r.wallet, String(r.nfts), r.email, x, r.ref ?? "", iso(r.created_at)].map(cell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
```

Note: `'we"ird,@b.co'` doesn't start with `=+-@`, so the old quoting expectation holds.

- [ ] **Step 4: Run them and watch them pass**

Run: `node --disable-warning=ExperimentalWarning --test site/server.test.mjs`

Expected: all pass. The old signup tests still pass because `/api/waitlist` is unchanged until Task 3.

- [ ] **Step 5: Checkpoint.** `site/` is untracked, so git shows no diff. Show the reviewer the new `openStore`, `cell`, `toCsv` and `toMembersCsv`. Don't commit.

---

### Task 3: `POST /api/join`, the closed old endpoint, throwaway domains, env, `--members`

**Files:**
- Modify: `site/server.mjs` (header comment, constants, `normalize` removed, `throwawayCheck` added, `createApp`, `main`)
- Rewrite: `site/server.test.mjs`

- [ ] **Step 1: Rewrite `site/server.test.mjs` with the new HTTP tests**

Keep the four tests added in Task 2 and the updated CSV test exactly as written there. Replace everything else in the file with:

```js
// node --disable-warning=ExperimentalWarning --test site/server.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { ENDPOINT, createApp, openStore, staticFile, throwawayCheck, toCsv, toMembersCsv } from "./server.mjs";

const ROOT = path.dirname(new URL(import.meta.url).pathname);

// Privy, stubbed: the token "tok.<id>" is did:privy:<id>; USERS holds what Privy's API would
// answer for each; did:privy:down is Privy not answering
const acct = {
  email: (address) => ({ type: "email", address, verified_at: 1 }),
  x: (subject, username) => ({ type: "twitter_oauth", subject, username, verified_at: 1 }),
  wallet: (address) => ({ type: "wallet", chain_type: "solana", wallet_client_type: "privy", connector_type: "embedded", address }),
};
const person = (n, o = {}) => [acct.email(o.email ?? `p${n}@example.com`), acct.x(o.xId ?? `x${n}`, o.handle ?? `p${n}`), acct.wallet(o.wallet ?? `W${n}`)];
const USERS = new Map();
const user = (id, linked) => USERS.set(`did:privy:${id}`, { id: `did:privy:${id}`, linked_accounts: linked });
const auth = {
  verify: (t) => (t.startsWith("tok.") ? `did:privy:${t.slice(4)}` : null),
  async user(id) {
    if (id === "did:privy:down") throw new Error("privy users: HTTP 500");
    return USERS.get(id) ?? { id, linked_accounts: [] };
  },
};
const isThrowaway = throwawayCheck("# a test list\nmailinator.com\nTrash.io\n");

let store, server, base, clock;
async function serve(opts) {
  const s = createApp({ store, limit: [5, 60_000], now: () => clock, log: () => {}, ...opts });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return [s, `http://127.0.0.1:${s.address().port}`];
}
before(async () => {
  store = openStore(":memory:");
  clock = 1_000_000;
  [server, base] = await serve({ auth, isThrowaway });
});
after(() => {
  server.close();
  store.close();
});

const fresh = () => (clock += 60_000); // a new rate-limit window
const join = (id, body = {}, headers = {}) =>
  fetch(base + ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", ...(id && { authorization: `Bearer tok.${id}` }), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("throwaway domains: the domain and anything under it; comments and case don't matter", () => {
  assert.equal(isThrowaway("a@mailinator.com"), true);
  assert.equal(isThrowaway("a@x.MAILINATOR.com"), true);
  assert.equal(isThrowaway("a@trash.io"), true);
  assert.equal(isThrowaway("a@gmail.com"), false);
  assert.equal(isThrowaway("a@notmailinator.com"), false);
  assert.equal(isThrowaway("a@com"), false);
});

test("the page is served with its forms pointed at this server", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  const html = await res.text();
  assert.equal(html.split(`data-endpoint="${ENDPOINT}"`).length - 1, 2);
  assert.ok(!html.includes('data-endpoint=""'));
  const css = await fetch(`${base}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  const img = await fetch(`${base}/assets/mooner.svg`);
  assert.equal(img.headers.get("cache-control"), "public, max-age=86400");
});

test("assets are cached for a day, except assets/join/join.js, which keeps its name across builds", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-root-"));
  fs.mkdirSync(path.join(dir, "assets", "join"), { recursive: true });
  for (const f of ["join.js", "chunk-1a2b3c.js"]) fs.writeFileSync(path.join(dir, "assets", "join", f), "export {}\n");
  const [s, b] = await serve({ root: dir, auth });
  assert.equal((await fetch(`${b}/assets/join/join.js`)).headers.get("cache-control"), "no-cache");
  assert.equal((await fetch(`${b}/assets/join/chunk-1a2b3c.js`)).headers.get("cache-control"), "public, max-age=86400");
  s.close();
  fs.rmSync(dir, { recursive: true });
});

test("never serves the database, the server, dotfiles or anything outside the folder", async () => {
  for (const p of ["/.data/waitlist.db", "/server.mjs", "/server.test.mjs", "/privy.mjs", "/privy.test.mjs", "/tools/build-join.mjs", "/%2e%2e/.gitignore", "/..%2f..%2fengine%2fpackage.json", "/assets/../../.gitignore", "/nope.html", "/%E0%A4%A"])
    assert.equal((await fetch(base + p)).status, 404, p);
  assert.equal(staticFile(ROOT, "/../.gitignore"), null);
  assert.equal(staticFile(ROOT, "/.data/waitlist.db"), null);
  assert.equal(staticFile(ROOT, "/index.html"), path.join(ROOT, "index.html"));
});

test("joining: a verified person is in with 1 NFT, their ref kept; again is 'already'", async () => {
  fresh();
  user("new1", person(1));
  let res = await join("new1", { ref: "Luna2004" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, nfts: 1, early: false, already: false, email: "p1@example.com" });
  res = await join("new1", { ref: "Other" });
  assert.deepEqual(await res.json(), { ok: true, nfts: 1, early: false, already: true, email: "p1@example.com" });
  user("new2", person(2));
  await join("new2", { ref: "=HYPERLINK(1)" });
  const rows = store.members().filter((m) => ["W1", "W2"].includes(m.wallet));
  assert.deepEqual(rows.map((m) => [m.wallet, m.nfts, m.email, m.x_handle, m.ref]), [["W1", 1, "p1@example.com", "p1", "Luna2004"], ["W2", 1, "p2@example.com", "p2", null]]);
});

test("joining: early by email or by X handle (any case) gets 2", async () => {
  fresh();
  store.add({ contact: "early3@example.com", kind: "email" });
  store.add({ contact: "@earlybird4", kind: "x" });
  user("byemail", person(3, { email: "early3@example.com" }));
  user("byx", person(4, { handle: "EarlyBird4" }));
  for (const id of ["byemail", "byx"]) {
    const r = await (await join(id)).json();
    assert.deepEqual([r.nfts, r.early, r.already], [2, true, false], id);
  }
});

test("an email, X account or wallet already on another member: 409 saying which", async () => {
  fresh();
  user("owner", person(6));
  assert.equal((await join("owner")).status, 200);
  user("sameemail", person(7, { email: "p6@example.com" }));
  user("samex", person(8, { xId: "x6" }));
  user("samewallet", person(9, { wallet: "W6" }));
  const cases = [
    ["sameemail", "this email already joined with another X account"],
    ["samex", "this X account already joined"],
    ["samewallet", "this wallet already joined"],
  ];
  for (const [id, error] of cases) {
    const res = await join(id);
    assert.equal(res.status, 409, id);
    assert.deepEqual(await res.json(), { error }, id);
  }
});

test("refused with a reason the page can show", async () => {
  fresh();
  user("noemail", [acct.x("x10", "p10"), acct.wallet("W10")]);
  user("nox", [acct.email("p11@example.com"), acct.wallet("W11")]);
  user("nowallet", [acct.email("p12@example.com"), acct.x("x12", "p12")]);
  user("throwaway", person(13, { email: "p13@sub.mailinator.com" }));
  const cases = [
    ["noemail", 400, "verify your email"],
    ["nox", 400, "log in with X"],
    ["nowallet", 400, "your wallet isn't ready, try again"],
    ["throwaway", 400, "use a real email, not a throwaway one"],
    ["down", 502, "couldn't reach sign-in, try again"],
  ];
  for (const [id, status, error] of cases) {
    const res = await join(id);
    assert.equal(res.status, status, id);
    assert.deepEqual(await res.json(), { error }, id);
  }
  fresh();
  const res = await join(null);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "sign in again" });
  assert.equal((await join(null, {}, { authorization: "Bearer junk" })).status, 401);
  assert.equal((await join("new1", "{nope")).status, 400);
  assert.equal((await join("new1", "x".repeat(3000))).status, 413);
  assert.equal((await join("new1", "ref=a", { "content-type": "application/x-www-form-urlencoded" })).status, 415);
  assert.equal((await fetch(base + ENDPOINT)).status, 405);
});

test("rate limit per address, then it opens again", async () => {
  fresh();
  for (let i = 0; i < 5; i++) assert.equal((await join(null)).status, 401);
  const res = await join(null);
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /too many tries/);
  fresh();
  assert.equal((await join(null)).status, 401);
});

test("the old unverified signup is closed: 410", async () => {
  const res = await fetch(`${base}/api/waitlist`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact: "a@b.co" }) });
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), { error: "refresh the page" });
});

test("without Privy's keys, joining is paused: 503", async () => {
  const [s, b] = await serve({ auth: null });
  const res = await fetch(b + ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tok.x" }, body: "{}" });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "signups are paused" });
  s.close();
});

test("the database file is created private", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-"));
  const file = path.join(dir, "sub", "waitlist.db");
  const s = openStore(file);
  assert.equal(s.add({ contact: "a@b.co", kind: "email" }), true);
  s.close();
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  const again = openStore(file);
  assert.equal(again.count(), 1);
  again.close();
  fs.rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --disable-warning=ExperimentalWarning --test site/server.test.mjs`

Expected: FAIL. `throwawayCheck` is not exported, and `ENDPOINT` is still `/api/waitlist`.

- [ ] **Step 3: Implement it in `site/server.mjs`**

Replace the header comment, imports and constants (lines 1-21) with:

```js
// The waitlist site's server: serves this folder and keeps the list in SQLite. No dependencies
// (node:http, node:sqlite, node:crypto), so there's nothing extra to trust.
//
//   node site/server.mjs             serve the site on 127.0.0.1:4410
//   node site/server.mjs --export    print the early list (before signups were verified) as CSV
//   node site/server.mjs --members   print the members, the NFT airdrop list, as CSV
//
// WAITLIST_PORT (or PORT), WAITLIST_HOST, WAITLIST_DB (default site/.data/waitlist.db),
// WAITLIST_TRUST_PROXY=1 behind a proxy that sets X-Forwarded-For. Joining needs PRIVY_APP_ID,
// PRIVY_APP_SECRET and PRIVY_VERIFICATION_KEY (Privy's dashboard, Configuration > App
// settings); without them /api/join answers 503.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { accountsOf, privyAuth } from "./privy.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const ENDPOINT = "/api/join";
const OLD_ENDPOINT = "/api/waitlist"; // the unverified signup, closed 2026-10-08
const MAX_BODY = 2048;
const REF = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const BEARER = /^Bearer ([A-Za-z0-9._-]+)$/;
// a members column that's already someone else's, in the person's words
const TAKEN = {
  email: "this email already joined with another X account",
  x_id: "this X account already joined",
  wallet: "this wallet already joined",
};
```

Delete `normalize` and its doc comment (lines 41-50). Nothing uses it any more.

Add after `fail`:

```js
/** From a list of throwaway email domains (one per line, # comments), a check that's true when
 *  an email's domain, or a domain above it, is on the list. */
export function throwawayCheck(text) {
  const listed = new Set(
    text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")),
  );
  return (email) => {
    const labels = email.slice(email.lastIndexOf("@") + 1).toLowerCase().split(".");
    for (let i = 0; i < labels.length - 1; i++) if (listed.has(labels.slice(i).join("."))) return true;
    return false;
  };
}
```

Replace `createApp` (the doc comment and the function) with:

```js
/** `auth`: privyAuth() from privy.mjs, or null to pause joining. `isThrowaway`: throwawayCheck()'s
 *  check. `limit`: [tries, windowMs] per address on /api/join, refused tries counted too. */
export function createApp({ root = ROOT, store, auth = null, isThrowaway = () => false, trustProxy = false, limit = [20, 600_000], now = Date.now, log = console.log } = {}) {
  const allow = limiter(...limit, now);
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...HEADERS });
    res.end(JSON.stringify(body));
  };

  async function join(req) {
    if (!auth) throw fail(503, "signups are paused");
    const body = await readJson(req);
    const privyId = auth.verify(BEARER.exec(req.headers.authorization ?? "")?.[1] ?? "");
    if (!privyId) throw fail(401, "sign in again");
    let user;
    try {
      user = await auth.user(privyId);
    } catch (e) {
      log(`privy: ${e.message}`);
      throw fail(502, "couldn't reach sign-in, try again");
    }
    const a = accountsOf(user);
    if (!a.email) throw fail(400, "verify your email");
    if (!a.xId) throw fail(400, "log in with X");
    if (!a.wallet) throw fail(400, "your wallet isn't ready, try again");
    if (isThrowaway(a.email)) throw fail(400, "use a real email, not a throwaway one");
    const ref = typeof body.ref === "string" && REF.test(body.ref) ? body.ref : null;
    try {
      return { ok: true, ...store.join({ privyId, ...a, ref }, now()), email: a.email };
    } catch (e) {
      const column = /UNIQUE constraint failed: members\.(\w+)/.exec(e.message)?.[1];
      if (TAKEN[column]) throw fail(409, TAKEN[column]);
      throw e;
    }
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      if (url.pathname === OLD_ENDPOINT) throw fail(410, "refresh the page");
      if (url.pathname === ENDPOINT) {
        if (req.method !== "POST") throw fail(405, "method not allowed");
        if (!allow(clientIp(req, trustProxy))) throw fail(429, "too many tries. wait a few minutes");
        return json(res, 200, await join(req));
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw fail(405, "method not allowed");
      const file = staticFile(root, url.pathname);
      if (!file) throw fail(404, "not found");
      let body = fs.readFileSync(file);
      // served from here, the forms post to this server; a static host keeps them in preview
      if (file === path.join(root, "index.html")) body = body.toString("utf8").replaceAll('data-endpoint=""', `data-endpoint="${ENDPOINT}"`);
      const rel = path.relative(root, file);
      // join.js keeps its name across builds (main.js imports it by name), so it's checked each
      // time; its chunks are hashed
      const cached = rel.startsWith(`assets${path.sep}`) && rel !== path.join("assets", "join", "join.js");
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file).toLowerCase()],
        "cache-control": cached ? "public, max-age=86400" : "no-cache",
        ...HEADERS,
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (e) {
      if (e.status) return json(res, e.status, { error: e.message });
      log(`${req.method} ${req.url}: ${e.stack ?? e}`);
      json(res, 500, { error: "internal error" });
    }
  });
}
```

Replace `main` with:

```js
function main() {
  const file = process.env.WAITLIST_DB ?? path.join(ROOT, ".data", "waitlist.db");
  const store = openStore(file);
  if (process.argv.includes("--members")) {
    const rows = store.members();
    process.stdout.write(toMembersCsv(rows));
    console.error(`${rows.length} members (${file})`);
    return store.close();
  }
  if (process.argv.includes("--export")) {
    process.stdout.write(toCsv(store.all()));
    console.error(`${store.count()} on the early list (${file})`);
    return store.close();
  }
  const { PRIVY_APP_ID: appId, PRIVY_APP_SECRET: secret, PRIVY_VERIFICATION_KEY: key } = process.env;
  const auth = appId && secret && key ? privyAuth({ appId, secret, key }) : null;
  if (!auth) console.warn("no PRIVY_APP_ID, PRIVY_APP_SECRET or PRIVY_VERIFICATION_KEY: /api/join answers 503");
  const isThrowaway = throwawayCheck(fs.readFileSync(path.join(ROOT, "disposable-domains.txt"), "utf8"));
  const port = Number(process.env.WAITLIST_PORT ?? process.env.PORT ?? 4410);
  const host = process.env.WAITLIST_HOST ?? "127.0.0.1";
  const server = createApp({ store, auth, isThrowaway, trustProxy: process.env.WAITLIST_TRUST_PROXY === "1" });
  server.listen(port, host, () =>
    console.log(`mooner waitlist on http://${host}:${port} · ${store.count()} early · ${store.members().length} members · ${file}`),
  );
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      server.close();
      store.close();
      process.exit(0);
    });
}
```

`DatabaseSync` stays imported because `openStore` uses it.

- [ ] **Step 4: Run all the tests and watch them pass**

Run: `node --disable-warning=ExperimentalWarning --test site/server.test.mjs site/privy.test.mjs`

Expected: `# fail 0`. The pass count is the 4 privy tests plus every server test (17).

- [ ] **Step 5: Checkpoint.** Run `grep -n "normalize\|EMAIL\|HANDLE" site/server.mjs`. Expected: no output. Don't commit.

---

### Task 4: the throwaway-domain list

**Files:**
- Create: `site/disposable-domains.txt`

- [ ] **Step 1: Ask the user before downloading.** Downloading a file needs their OK. Ask:

  > "OK to download the CC0 throwaway-domain list, `disposable_email_blocklist.conf` (main branch), from github.com/disposable-email-domains/disposable-email-domains to `site/disposable-domains.txt`?"

  Wait for a yes.

- [ ] **Step 2: Download it with a header line**

```bash
{ echo "# throwaway email domains, CC0: github.com/disposable-email-domains/disposable-email-domains ($(date +%F))"; curl -fsSL https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf; } > site/disposable-domains.txt
```

- [ ] **Step 3: Check it**

Run:

```bash
wc -l site/disposable-domains.txt; grep -c -x "mailinator.com" site/disposable-domains.txt; grep -c -x "gmail.com" site/disposable-domains.txt
```

Expected:
- A line count in the thousands.
- `1` for mailinator.com.
- `0` for gmail.com.

Write down the real line count you saw.

- [ ] **Step 4: Check it against the early list**

The 63 real early emails must not be refused by mistake. Run:

```bash
node --disable-warning=ExperimentalWarning -e '
import("./site/server.mjs").then(({ throwawayCheck }) => {
  const fs = require("node:fs");
  const bad = throwawayCheck(fs.readFileSync("site/disposable-domains.txt", "utf8"));
  const rows = fs.readFileSync("site/.data/waitlist-live.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(",")[0]).filter((c) => c.includes("@") && !c.startsWith("http"));
  const hit = rows.filter(bad);
  console.log(rows.length, "emails,", hit.length, "on the list:", hit.map((e) => e.split("@")[1]).join(" "));
});'
```

Expected: `63 emails, 0 on the list:`. If any domains print, show them to the user. Don't edit the list on your own.

- [ ] **Step 5: Checkpoint.** Report the line count and the result of Step 4.

---

### Task 5: the join bundle (`site/join/join.js`) and its build

**Files:**
- Create: `site/join/join.js`
- Create: `site/tools/build-join.mjs`
- Modify: `.gitignore` (after line 23 `site/.data/`)

- [ ] **Step 1: Write `site/join/join.js`**

```js
// The waitlist's sign-up, built into site/assets/join/ by site/tools/build-join.mjs. Privy
// proves the email (a code) and the X account (X login) and makes a Solana wallet; then
// /api/join puts the person on the list and answers how many NFTs they have reserved.
// main.js loads this on the first join click, or when X sends the person back.
import { PrivyProvider, useLinkAccount, useLogin, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/solana";
import { Buffer } from "buffer";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

globalThis.Buffer ??= Buffer; // as the web app does (web/src/real/polyfills.js)

// the web app's Privy app (web/.env), so app.mooner.family shows the same person and wallet
const APP_ID = import.meta.env.VITE_PRIVY_APP_ID;
const CONFIG = {
  loginMethods: ["email", "twitter"],
  appearance: { theme: "dark", accentColor: "#5468ff", logo: "/assets/mooner.svg", landingHeader: "Join the Mooner waitlist", walletChainType: "solana-only" },
  embeddedWallets: { solana: { createOnLogin: "users-without-wallets" }, ethereum: { createOnLogin: "off" } },
};
// Privy's error codes, in the page's words
const SAY = {
  exited_auth_flow: "sign-in closed. try again?",
  exited_link_flow: "sign-in closed. try again?",
  oauth_user_denied: "X login was cancelled. try again?",
  linked_to_another_user: "that email or X account is already on another Mooner sign-in",
  disallowed_plus_email: "use your email without a +tag",
  too_many_requests: "too many tries. wait a few minutes",
};
const KEY = "mooner-join"; // sessionStorage: the ?r= ref, kept across the trip to X

const shown = (text) => Object.assign(new Error(text), { shown: text });
const keep = (ref) => {
  try {
    if (ref) sessionStorage.setItem(KEY, ref);
    else sessionStorage.removeItem(KEY);
  } catch {}
};
const kept = () => {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const live = {}; // Privy's latest state and calls, refreshed on every render
let wake = () => {}; // the next render wakes whoever waits in until()
let settle = () => {}; // the Privy modal in flight: settle(null) done, settle(code) failed

function Bridge() {
  const privy = usePrivy();
  const { login } = useLogin({ onComplete: () => settle(null), onError: (code) => settle(code) });
  const { linkEmail, linkTwitter } = useLinkAccount({ onSuccess: () => settle(null), onError: (code) => settle(code) });
  const { createWallet } = useCreateWallet();
  Object.assign(live, privy, { login, linkEmail, linkTwitter, createWallet });
  useEffect(() => wake());
  return null;
}

let mounted = false;
function mount() {
  if (mounted) return;
  mounted = true;
  const el = document.createElement("div");
  document.body.append(el);
  createRoot(el).render(createElement(PrivyProvider, { appId: APP_ID, config: CONFIG }, createElement(Bridge)));
}

/** Waits, render by render, until pred() holds; false once `ms` pass. */
async function until(pred, ms = 20_000) {
  const end = Date.now() + ms;
  while (!pred()) {
    const left = end - Date.now();
    if (left <= 0) return false;
    await new Promise((r) => {
      const t = setTimeout(r, left);
      wake = () => {
        clearTimeout(t);
        r();
      };
    });
  }
  return true;
}

/** Opens a Privy modal (or redirect) and waits for its callback. */
function modal(open) {
  return new Promise((resolve, reject) => {
    settle = (code) => {
      settle = () => {};
      if (code) reject(shown(SAY[code] ?? "sign-in didn't finish. try again?"));
      else resolve();
    };
    open();
  });
}

const hasPrivyWallet = (u) => !!u?.linkedAccounts?.some((a) => a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy");

async function run({ email, endpoint, onStep, fromX }) {
  mount();
  if (!(await until(() => live.ready))) throw shown("sign-in didn't load. try again?");
  if (!live.authenticated) {
    onStep("check your email for a code");
    await modal(() => live.login({ loginMethods: ["email"], ...(email && { prefill: { type: "email", value: email } }) }));
    await until(() => live.user);
  }
  if (!live.user?.email) {
    onStep("verify your email");
    await modal(() => live.linkEmail());
    await until(() => live.user?.email);
  }
  if (!live.user?.twitter) {
    if (fromX) {
      // back from X, Privy may still be finishing the link: wait for it, never send them again
      if (!(await until(() => live.user?.twitter, 10_000))) throw shown("X login didn't finish. try again?");
    } else {
      onStep("now log in with X");
      await modal(() => live.linkTwitter()); // usually leaves the page; resume() carries on
      await until(() => live.user?.twitter);
    }
  }
  if (!hasPrivyWallet(live.user)) {
    onStep("making your wallet");
    await live.createWallet();
    await until(() => hasPrivyWallet(live.user));
  }
  onStep("joining");
  const token = await live.getAccessToken();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ ref: kept() }),
  });
  const data = await res.json().catch(() => ({}));
  // the server's own words, except a crash's "internal error"
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { shown: res.status !== 500 && data.error });
  keep(null);
  return data;
}

/** Signs `email` up: Privy's email code, X, a wallet, then /api/join. Resolves with the
 *  server's answer, { ok, nfts, early, already, email }; rejects with `.shown` for the page. */
export function join({ email, ref, endpoint, onStep = () => {} }) {
  keep(ref);
  return run({ email, endpoint, onStep, fromX: false });
}

/** Carries on after X sent the person back to the page. */
export function resume({ endpoint, onStep = () => {} }) {
  return run({ endpoint, onStep, fromX: true });
}
```

- [ ] **Step 2: Write `site/tools/build-join.mjs`**

```js
// Builds site/join/join.js (React + Privy, borrowed from web/node_modules) into site/assets/join/:
// join.js, which main.js imports by name, and its hashed chunks. The Privy app id comes from
// web/.env (VITE_PRIVY_APP_ID, public). deploy/railway.sh site runs this first.
//   node site/tools/build-join.mjs        (needs web/node_modules)
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..");
const web = path.resolve(site, "../web");
const src = path.join(site, "join");
const { build } = await import(pathToFileURL(path.join(web, "node_modules/vite/dist/node/index.js")).href);
// site/ has no node_modules: a bare import from site/join resolves as if web's app made it
const FROM_WEB = path.join(web, "src", "main.tsx");

await build({
  configFile: false,
  root: src,
  envDir: web,
  mode: "production",
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [
    {
      name: "resolve-from-web",
      enforce: "pre",
      resolveId(source, importer, options) {
        if (!importer?.startsWith(src + path.sep) || /^[./\0]/.test(source) || path.isAbsolute(source)) return null;
        return this.resolve(source, FROM_WEB, { ...options, skipSelf: true });
      },
    },
  ],
  build: {
    outDir: path.join(site, "assets", "join"),
    emptyOutDir: true,
    target: "es2022",
    minify: true,
    lib: { entry: path.join(src, "join.js"), formats: ["es"], fileName: () => "join.js" },
  },
});
console.log("built site/assets/join/");
```

- [ ] **Step 3: Gitignore the output**

In `.gitignore`, after `site/.data/`, add:

```
# the waitlist's join bundle, built by site/tools/build-join.mjs (deploy/railway.sh site runs it)
site/assets/join/
```

- [ ] **Step 4: Build it and check the output**

Run:

```bash
node site/tools/build-join.mjs && ls -la site/assets/join | head -20
```

Expected:
- `built site/assets/join/` is printed.
- `site/assets/join/join.js` exists, along with chunk files.

If the build fails on a bare import, read the error. It names the import that didn't resolve. Fix it in the plugin; don't vendor packages.

Then check that the app id was baked in and nothing is left unresolved:

```bash
grep -c "import.meta.env" site/assets/join/join.js; grep -l "$(sed -n 's/^VITE_PRIVY_APP_ID=//p' web/.env)" site/assets/join/*.js | head -3; grep -l "process.env.NODE_ENV" site/assets/join/*.js | head -3
```

Expected:
- `0` for the first grep.
- At least one file listed for the app id.
- No files listed for `process.env.NODE_ENV`.

- [ ] **Step 5: Checkpoint.** Report the bundle's file list and total size (`du -sh site/assets/join`).

---

### Task 6: the page (`index.html`, `main.js`)

**Files:**
- Modify: `site/index.html` (hero form lines 45-52, CTA form lines 181-187)
- Modify: `site/main.js` (the `waitlist()` block, lines 404-459)

- [ ] **Step 1: Update both forms in `site/index.html`**

Make these changes in both forms. The hero form uses `wl-hero` and the CTA form uses `wl-cta`.

- Change `<label class="sr-only" for="wl-hero">Email or X handle</label>` to `<label class="sr-only" for="wl-hero">Email</label>`. Do the same with `wl-cta`.
- Change `placeholder="email or @handle"` to `placeholder="your email"`.
- Change `<p class="wl-msg" role="status" aria-live="polite"></p>` to:

```html
<p class="wl-msg" role="status" aria-live="polite">free Mooner NFT for joining. already on the list? you get 2</p>
```

- [ ] **Step 2: Replace the `waitlist()` block in `site/main.js`**

Replace everything from `/* ---------------- waitlist ---------------- */` through the closing `}` of `function waitlist()` with:

```js
  /* ---------------- waitlist ---------------- */
  // Joining is a sign-up: Privy checks the email (a code) and the X account (X login) and makes a
  // wallet, then /api/join puts the person on the list with their NFTs. That code is large, so
  // assets/join/join.js loads on the first join click, or when X sends the person back here.
  function waitlist() {
    const forms = $$('form.waitlist');
    const q = new URLSearchParams(location.search);
    const ref = q.get('r');
    const endpoint = forms[0]?.dataset.endpoint || window.MOONER_WAITLIST_ENDPOINT || '';
    const NOTE = 'free Mooner NFT for joining. already on the list? you get 2';
    const say = (f, text, err = false) => { const m = $('.wl-msg', f); m.className = err ? 'wl-msg err' : 'wl-msg'; m.textContent = text; };
    const reserved = (n) => `${n} NFT${n === 1 ? '' : 's'} reserved`;
    const done = (r) => forms.forEach((g) => {
      g.classList.add('done');
      if (r.email) $('input', g).value = r.email;
      $('input', g).disabled = true; $('button', g).disabled = true;
      $('button span', g).textContent = "you're in";
      say(g, r.already ? `you're already in. ${reserved(r.nfts)}`
        : r.early ? `you're in. ${reserved(r.nfts)}, thanks for being early` : `you're in. ${reserved(r.nfts)}`);
    });
    async function go(f, start) {
      const button = $('button', f), label = $('button span', f);
      const idle = label.innerHTML; // keeps the " waitlist" part that small phones hide
      button.disabled = true; label.textContent = 'joining…'; f.classList.add('busy');
      try {
        const signup = await import('./assets/join/join.js');
        done(await start(signup, (step) => say(f, step)));
      } catch (err) {
        console.warn('waitlist', err);
        say(f, err.shown || 'that didn’t go through. try again?', true);
        button.disabled = false; label.innerHTML = idle;
      } finally {
        f.classList.remove('busy');
      }
    }
    // typing again clears a refusal: the red ring, and the note comes back
    forms.forEach((f) => $('input', f).addEventListener('input', (e) => {
      if (!e.target.hasAttribute('aria-invalid')) return;
      e.target.removeAttribute('aria-invalid');
      say(f, NOTE);
    }));
    forms.forEach((f) => f.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('input', f), email = input.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        say(f, 'enter your email', true);
        input.setAttribute('aria-invalid', 'true'); input.focus();
        f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); // restart the shake
        return;
      }
      input.removeAttribute('aria-invalid');
      if (!endpoint) return say(f, 'preview: no waitlist endpoint set, nothing was saved');
      go(f, (signup, onStep) => signup.join({ email, ref, endpoint, onStep }));
    }));
    // X sends the person back with Privy's privy_oauth_* params: finish where the sign-up stopped
    if (endpoint && forms[0] && q.has('privy_oauth_state')) go(forms[0], (signup, onStep) => signup.resume({ endpoint, onStep }));
  }
```

- [ ] **Step 3: Check the syntax**

Run: `node --check site/main.js && node --disable-warning=ExperimentalWarning --test site/server.test.mjs site/privy.test.mjs`

Expected: no syntax error, and `# fail 0`. The served-page test still counts two `data-endpoint` forms.

- [ ] **Step 4: Checkpoint.** Show the reviewer the `waitlist()` diff and both form diffs.

---

### Task 7: deploy script, README, local run config

**Files:**
- Modify: `deploy/railway.sh` (the `site)` case)
- Modify: `site/README.md`
- Modify: `.claude/launch.json` (the `mooner-site` entry)
- Modify: `deploy/site.Dockerfile` (line 5, comment), `.gitignore` (line 22, comment)

- [ ] **Step 1: `deploy/railway.sh`.** In the `site)` case, replace the two lines `mkdir -p "$STAGE/site"` and the `cp "$ROOT/site/index.html" …` line with:

```sh
    # the join bundle (site/assets/join/) is build output: made fresh, then shipped with assets/
    node "$ROOT/site/tools/build-join.mjs"
    mkdir -p "$STAGE/site"
    cp "$ROOT/site/index.html" "$ROOT/site/styles.css" "$ROOT/site/main.js" "$ROOT/site/mooji.js" "$ROOT/site/server.mjs" "$ROOT/site/privy.mjs" "$ROOT/site/disposable-domains.txt" "$STAGE/site/"
```

Also update the header line ` site ships site/ as it is here (it isn't committed).` to:

```sh
# edit in progress in this checkout never goes out. site ships site/ as it is here (it isn't committed),
# with its join bundle built first.
```

Keep the line before it intact.

Then fix two comments that name what the database holds:
- `deploy/site.Dockerfile` line 5: `# /data is the volume: waitlist.db (emails and X handles). 8080: mooner.family's target port.` becomes `# /data is the volume: waitlist.db (emails, X accounts, wallets). 8080: mooner.family's target port.`
- `.gitignore` line 22: `# waitlist signups (site/server.mjs): emails and X handles` becomes `# waitlist signups (site/server.mjs): emails, X accounts, wallets`

- [ ] **Step 2: Dry-run the deploy**

Run: `sh deploy/railway.sh site --dry`

Expected:
- The build line prints first.
- The staged file list includes `site/privy.mjs`, `site/disposable-domains.txt`, `site/assets/join/join.js` and the chunks, `Dockerfile` and `railway.json`.
- There's no `.data`, no `.env` and no `*.test.mjs`.
- No "refusing" line.

- [ ] **Step 3: `site/README.md`.** Make these replacements:
- **"What the endpoint accepts":** replace the whole section with:

```markdown
## Joining

Joining is a sign-up. `site/join/join.js` runs it in the browser:

1. Privy mails a code to the email, and the person types it.
2. The person logs in with X. That's a redirect to X and back. Coming back, `main.js` sees
   `privy_oauth_state` and finishes.
3. Privy makes a Solana wallet.
4. The page calls `POST /api/join` with `Authorization: Bearer <Privy access token>` and
   `{ ref }`.

The server checks the token (`privy.mjs`, ES256 against `PRIVY_VERIFICATION_KEY`). It reads the
user's verified email, X account and Privy Solana wallet from Privy's API. It refuses throwaway
domains (`disposable-domains.txt`, CC0, from
github.com/disposable-email-domains/disposable-email-domains). Then it adds a `members` row.

- A person whose email or X handle is on the early list (the `waitlist` table, from before
  signups were verified) gets 2 NFTs. Everyone else gets 1.
- The same person again gets `already: true`.
- It answers `{ ok, nfts, early, already, email }`, or `{ error }`:
  - 400: email, X or wallet missing, or a throwaway domain
  - 401: bad token
  - 409: the email, X account or wallet is another member's
  - 413, 415: the request is too big or isn't JSON
  - 429: there are 20 tries per address per 10 minutes
  - 502: Privy didn't answer
  - 503: no Privy env
- `POST /api/waitlist`, the old unverified signup, answers 410.

The bundle is built from `web/node_modules` with web's Vite. `deploy/railway.sh site` runs the
build. `site/assets/join/` is gitignored.

```bash
node site/tools/build-join.mjs
```
```

- **The env table:** add three rows:

```markdown
| `PRIVY_APP_ID` | none | the web app's Privy app (`VITE_PRIVY_APP_ID` in `web/.env`) |
| `PRIVY_APP_SECRET` | none | Privy dashboard, Configuration > App settings |
| `PRIVY_VERIFICATION_KEY` | none | same page; the PEM, newlines may be escaped as `\n` |
```

- **"The list":** replace it with:

```markdown
## The lists

```bash
node --disable-warning=ExperimentalWarning site/server.mjs --members > members.csv
node --disable-warning=ExperimentalWarning site/server.mjs --export > early.csv
```

`--members` is the NFT airdrop list: `wallet,nfts,email,x,ref,joined_at`. `--export` is the
early list: `contact,kind,ref,joined_at,claimed`. `claimed` is `yes` once a member has used
the row. On Railway, run them with `railway ssh --service web -- node --disable-warning=ExperimentalWarning /app/site/server.mjs --members`.
```

- **"Test":** change the command to `node --disable-warning=ExperimentalWarning --test site/server.test.mjs site/privy.test.mjs`.
- **"Run":** add a line under the command: "Joining needs the three `PRIVY_*` variables. Locally, put them in the vault and run `vault run -- node --disable-warning=ExperimentalWarning site/server.mjs`."

- [ ] **Step 4: `.claude/launch.json`.** Change the `mooner-site` entry so the server gets the vault's env:

```json
    {
      "name": "mooner-site",
      "runtimeExecutable": "vault",
      "runtimeArgs": [
        "run",
        "--",
        "node",
        "--disable-warning=ExperimentalWarning",
        "/Users/yordanlasonov/Documents/GitHub/mooner/site/server.mjs"
      ],
      "port": 4410
    },
```

- [ ] **Step 5: Checkpoint.** Show the reviewer the dry-run file list and the README diff.

---

### Task 8: the user's setup (blocked on the user)

These are steps only the user can do. Ask for them in one message and wait.

- [ ] **Step 1: Send the user this list**
  - **Privy dashboard, Configuration > App settings > Domains, Allowed origins:**
    - Add `https://mooner.family` and `https://www.mooner.family`.
    - Add `http://localhost:4410` for the local test. Remove it after Task 9.
  - **Login methods:** confirm Email and Twitter (X) are on. The web app already uses both.
  - **Optional:** turn on "block + emails" if Privy offers it (Privy's error code `disallowed_plus_email` exists). It stops one inbox from joining many times.
  - **Into the vault** (each value goes in through stdin):

```bash
vault set PRIVY_APP_SECRET
```

```bash
vault set PRIVY_VERIFICATION_KEY
```

```bash
sed -n 's/^VITE_PRIVY_APP_ID=//p' web/.env | vault set PRIVY_APP_ID
```

- [ ] **Step 2: Confirm the names exist** (names only, never values)

Run: `vault ls | tr ' ' '\n' | grep -x -E "PRIVY_APP_ID|PRIVY_APP_SECRET|PRIVY_VERIFICATION_KEY"`

Expected: all three names.

---

### Task 9: local check in the browser

- [ ] **Step 1: Start the site**

Run `preview_start` with `{ name: "mooner-site" }`. Then check `preview_logs` for the log line: `mooner waitlist on http://127.0.0.1:4410 · 97 early · 0 members`.
- The local count is whatever `site/.data/waitlist.db` holds. It is not prod's 97.
- There must be no `no PRIVY_APP_ID…` warning.

- [ ] **Step 2: The bundle only loads on a click**
  - On load, `read_network_requests` with `urlPattern: "assets/join"` must list nothing.
  - `read_page` must show both forms, with the placeholder "your email" and the NFT note line.

- [ ] **Step 3: Click join**
  - Type `test@example.com` into the hero field and click join.
  - Expected: `assets/join/join.js` and its chunks load, and Privy's modal opens.
  - Take a screenshot to show the email filled in.
  - Close the modal. The note line must read "sign-in closed. try again?" and the button must be back.
  - `read_console_messages` with `onlyErrors: true` must show no errors from the page. Privy's own iframe warnings are fine; list them.

- [ ] **Step 4: Bad input**
  - Type `nope` and click join.
  - Expected: "enter your email" and the red ring.
  - Typing again brings the note back.

- [ ] **Step 5: Phone width**
  - `resize_window` with `preset: "mobile"`, then take a screenshot. The note line must fit under the form without covering the button.
  - Reset with `preset: "desktop"`.

- [ ] **Step 6: Hand the full run to the user**
  - The full run is a real email code and a real X login, with the user's own accounts.
  - Signing in to X for the user isn't allowed, so ask them to do it at `http://localhost:4410`.
  - Then show them the result:

```bash
node --disable-warning=ExperimentalWarning site/server.mjs --members
```

---

### Task 10: ship it (ask first)

- [ ] **Step 1: Ask the user.** Ask: "Set the 3 Privy variables on Railway's web service from the vault and deploy the site to mooner.family?" Wait for a yes.

- [ ] **Step 2: Set the Railway variables.** Run `railway variables --help` first and confirm the `--set` flag. Then run:

```bash
railway variables --service web --set "PRIVY_APP_ID=$(vault get PRIVY_APP_ID)" --set "PRIVY_APP_SECRET=$(vault get PRIVY_APP_SECRET)" --set "PRIVY_VERIFICATION_KEY=$(vault get PRIVY_VERIFICATION_KEY)"
```

Never echo the values.

- [ ] **Step 3: Deploy**

Run: `sh deploy/railway.sh site`

Then wait for Railway's healthcheck. Use `railway logs --service web` and look for the new start line, which shows `97 early · 0 members`.

- [ ] **Step 4: Smoke-test prod**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://mooner.family/api/waitlist -H "content-type: application/json" -d '{}'
curl -s -X POST https://mooner.family/api/join -H "content-type: application/json" -d '{}'
curl -s -o /dev/null -w "%{http_code} %header{cache-control}\n" https://mooner.family/assets/join/join.js
```

Expected:
- `410` from the old endpoint.
- `{"error":"sign in again"}` from `/api/join`. If it says `"signups are paused"`, the env didn't land.
- `200 no-cache` for `join.js`.

- [ ] **Step 5: The user's prod run.** Ask the user to join on mooner.family with their own email + X. Their `yordan.lasonov@gmail.com` is on the early list, so expect "2 NFTs reserved".

- [ ] **Step 6: Clean up.** Remind the user to remove `http://localhost:4410` from Privy's allowed origins. Update memory `mooner-waitlist-site.md`:
  - Joining is verified (Privy email + X + wallet) since 2026-10-08.
  - Members get 1 NFT, or 2 when early.
  - `--members` is the airdrop list.
  - `/api/waitlist` answers 410.
