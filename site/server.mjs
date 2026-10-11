// The waitlist site's server: serves this folder and keeps the list in SQLite. No dependencies
// (node:http, node:sqlite, node:crypto), so there's nothing extra to trust.
//
//   node site/server.mjs             serve the site on 127.0.0.1:4410
//   node site/server.mjs --export    print the waitlist as CSV, with each row's NFT count
//   node site/server.mjs --members   print the members (the Privy sign-up) as CSV
//   node site/server.mjs --allowlist print the mint allowlist as CSV: the members, then the waitlist
//                                    rows no member claimed (they don't join again, they mint)
//
// WAITLIST_PORT (or PORT), WAITLIST_HOST, WAITLIST_DB (default site/.data/waitlist.db),
// WAITLIST_TRUST_PROXY=1 behind a proxy that sets X-Forwarded-For. Joining is the Privy sign-up
// (/api/join, page code in join/): a verified email and X account and a Privy wallet. Without
// PRIVY_APP_ID, PRIVY_APP_SECRET and PRIVY_VERIFICATION_KEY it answers 503. RESEND_API_KEY sends
// a new member the welcome email from WAITLIST_FROM (default Mooner <hello@mooner.family>);
// without it they still join.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { accountsOf, privyAuth } from "./privy.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const ENDPOINT = "/api/join"; // the page's: the Privy sign-up, email and X both verified
// email only, 2026-10-08 to 10-09: closed, so a page loaded before then is told to reload
const OLD_ENDPOINT = "/api/waitlist";
// the welcome email, plain text, for a member with `nfts` reserved
const WELCOME = {
  subject: "You're on the Mooner waitlist",
  text: (nfts) => `you're on the Mooner waitlist.

${nfts > 1 ? `your ${nfts} free Mooner NFTs are` : "your free Mooner NFT is"} reserved. we'll email you before launch with how to get ${nfts > 1 ? "them" : "it"}.

one signup per email and X account, so there's nothing else to do.

Mooner
https://mooner.family
`,
};
const MAX_BODY = 2048;
const REF = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const BEARER = /^Bearer ([A-Za-z0-9._-]+)$/i;
// a members column that's already someone else's, in the person's words
const TAKEN = {
  email: "this email already joined with another X account",
  x_id: "this X account already joined",
  wallet: "this wallet already joined",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};
const HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const fail = (status, message) => Object.assign(new Error(message), { status });

/** From a list of throwaway email domains (one per line, # comments), a check that's true when
 *  an email's domain, or a domain above it, is on the list. */
export function throwawayCheck(text) {
  const listed = new Set(
    text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")),
  );
  return (email) => {
    const labels = email.slice(email.lastIndexOf("@") + 1).toLowerCase().replace(/\.$/, "").split(".");
    for (let i = 0; i < labels.length - 1; i++) if (listed.has(labels.slice(i).join("."))) return true;
    return false;
  };
}

export function openStore(file) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(file)) fs.closeSync(fs.openSync(file, "a", 0o600));
  }
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = DELETE;
PRAGMA busy_timeout = 2000;
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
  // claimed_by: the member (Privy id) who joined with this row's email or handle.
  // nfts: 1 for an email-only signup (2026-10-08 to 10-09); null for a row from before, which gets 2
  const columns = db.prepare("PRAGMA table_info(waitlist)").all().map((c) => c.name);
  if (!columns.includes("claimed_by")) db.exec("ALTER TABLE waitlist ADD COLUMN claimed_by TEXT");
  if (!columns.includes("nfts")) db.exec("ALTER TABLE waitlist ADD COLUMN nfts INTEGER");
  const insert = db.prepare("INSERT OR IGNORE INTO waitlist (contact, kind, ref, nfts, created_at) VALUES (?, ?, ?, ?, ?)");
  const findMember = db.prepare("SELECT nfts, email FROM members WHERE privy_id = ?");
  const earlyRows = db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE claimed_by IS NULL AND nfts IS NULL AND contact IN (?, ?)");
  const claim = db.prepare("UPDATE waitlist SET claimed_by = ? WHERE claimed_by IS NULL AND contact IN (?, ?)");
  const addMember = db.prepare(
    "INSERT INTO members (privy_id, email, x_id, x_handle, wallet, nfts, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  return {
    /** A row on the waitlist; no `nfts` is a row from before the free NFT (tests seed with it).
     *  true: new. false: it was already there. */
    add: ({ contact, kind, ref, nfts }, now = Date.now()) => insert.run(contact, kind, ref ?? null, nfts ?? null, now).changes > 0,
    /** Puts a verified person on the list and says what they have: { nfts, early, already }. 2 NFTs
     *  when their email or X handle is an unclaimed row from before the free NFT (`nfts` null), else
     *  1. Every unclaimed row with their email or handle becomes theirs, an email-only one too.
     *  The same Privy user again gets their row back. When the email, X account or wallet is
     *  another member's, it throws node:sqlite's "UNIQUE constraint failed: members.<column>". */
    join({ privyId, email, xId, xHandle, wallet, ref }, now = Date.now()) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const had = findMember.get(privyId);
        if (had) {
          db.exec("COMMIT");
          return { nfts: had.nfts, early: had.nfts > 1, already: true };
        }
        const handle = xHandle ? `@${xHandle}` : null;
        const early = earlyRows.get(email, handle).n > 0;
        claim.run(privyId, email, handle);
        const nfts = early ? 2 : 1;
        addMember.run(privyId, email, xId, xHandle ?? null, wallet, nfts, ref ?? null, now);
        db.exec("COMMIT");
        return { nfts, early, already: false };
      } catch (e) {
        // SQLite may have ended the transaction itself (disk full, I/O error): keep the real error
        try {
          db.exec("ROLLBACK");
        } catch {}
        throw e;
      }
    },
    /** A member's { nfts, email } as stored, or undefined. */
    member: (privyId) => findMember.get(privyId),
    count: () => db.prepare("SELECT COUNT(*) AS n FROM waitlist").get().n,
    memberCount: () => db.prepare("SELECT COUNT(*) AS n FROM members").get().n,
    all: () => db.prepare("SELECT contact, kind, ref, nfts, created_at, claimed_by FROM waitlist ORDER BY created_at").all(),
    // rowid: joins in the same ms keep their order
    members: () => db.prepare("SELECT wallet, nfts, email, x_handle, ref, created_at FROM members ORDER BY created_at, rowid").all(),
    /** The waitlist rows no member claimed: people already signed up, who get their NFTs without
     *  joining again. */
    unclaimed: () =>
      db.prepare("SELECT contact, kind, ref, nfts, created_at FROM waitlist WHERE claimed_by IS NULL ORDER BY created_at, rowid").all(),
    close: () => db.close(),
  };
}

/** A CSV cell: quoted when it has to be, and a leading = + - @ tab or CR is put behind a ' so a
 *  spreadsheet never reads it as a formula. */
function cell(v) {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const iso = (ms) => new Date(ms).toISOString();

/** The waitlist as CSV. Handles come out as x.com links; nfts: 2 for a row from before the free
 *  NFT, else 1; claimed = a Privy member used the row. */
export function toCsv(rows) {
  const lines = ["contact,kind,ref,nfts,joined_at,claimed"];
  for (const r of rows) {
    const contact = r.kind === "x" ? `https://x.com/${r.contact.slice(1)}` : r.contact;
    lines.push([contact, r.kind, r.ref ?? "", String(r.nfts ?? 2), iso(r.created_at), r.claimed_by ? "yes" : ""].map(cell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

const MEMBERS_HEAD = "wallet,nfts,email,x,ref,joined_at";
const memberLine = (r) =>
  [r.wallet, String(r.nfts), r.email, r.x_handle ? `https://x.com/${r.x_handle}` : "", r.ref ?? "", iso(r.created_at)].map(cell).join(",");

/** The members as CSV. */
export function toMembersCsv(rows) {
  return `${[MEMBERS_HEAD, ...rows.map(memberLine)].join("\n")}\n`;
}

/** The mint allowlist as CSV: who mints how many free NFTs (no airdrop: each person comes back
 *  to mint). The members' columns: every member, then every waitlist row no member claimed
 *  (`unclaimed()`), with no wallet (they sign in at mint with that email or X), its email or
 *  x.com link, and its count (2 for a row from before the free NFT, else 1). */
export function toAllowlistCsv(members, unclaimed) {
  const oldLine = (r) =>
    memberLine({
      wallet: "",
      nfts: r.nfts ?? 2,
      email: r.kind === "x" ? "" : r.contact,
      x_handle: r.kind === "x" ? r.contact.slice(1) : null,
      ref: r.ref,
      created_at: r.created_at,
    });
  return `${[MEMBERS_HEAD, ...members.map(memberLine), ...unclaimed.map(oldLine)].join("\n")}\n`;
}

/** The file for `pathname` under `root`, or null. Known file types only, and never a
 *  dotfile or anything outside `root` (the database lives in .data/). */
export function staticFile(root, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.endsWith("/")) rel += "index.html";
  if (rel.includes("\0") || rel.split("/").some((seg) => seg.startsWith("."))) return null;
  if (!TYPES[path.extname(rel).toLowerCase()]) return null;
  const file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
  if (!file.startsWith(root + path.sep)) return null;
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? file : null;
}

/** At most `max` hits per `windowMs` for each key. */
function limiter(max, windowMs, now) {
  const hits = new Map();
  return (key) => {
    const t = now();
    if (hits.size > 10_000) for (const [k, hs] of hits) if (t - hs.at(-1) >= windowMs) hits.delete(k);
    const recent = (hits.get(key) ?? []).filter((h) => t - h < windowMs);
    const ok = recent.length < max;
    if (ok) recent.push(t);
    hits.set(key, recent);
    return ok;
  };
}

/** Behind a proxy it's the last X-Forwarded-For entry, the one our proxy added. */
function clientIp(req, trustProxy) {
  const fwd = trustProxy && req.headers["x-forwarded-for"];
  return fwd ? fwd.split(",").at(-1).trim() : (req.socket.remoteAddress ?? "?");
}

async function readJson(req) {
  // JSON only: a cross-site page can't send it without a CORS preflight, and none is allowed.
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw fail(415, "send JSON");
  const parts = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw fail(413, "that's too long");
    parts.push(c);
  }
  try {
    const v = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  throw fail(400, "the body is not a JSON object");
}

/** `mail(to, nfts)`: sends the welcome email to one address through Resend
 *  (resend.com/docs/api-reference/emails/send-email). */
export function resendMailer({ key, from, fetch = globalThis.fetch, timeoutMs = 8000 }) {
  return async (to, nfts = 1) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: WELCOME.subject, text: WELCOME.text(nfts) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`resend: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  };
}

/** `mail(email, nfts)`: sends the welcome email (resendMailer), or null to send none. `auth`:
 *  privyAuth() from privy.mjs, or null to pause /api/join. `isThrowaway`: throwawayCheck()'s check.
 *  `limit`: [tries, windowMs] per address, refused tries counted too. */
export function createApp({ root = ROOT, store, mail = null, auth = null, isThrowaway = () => false, trustProxy = false, limit = [20, 600_000], now = Date.now, log = console.log } = {}) {
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
    // a member is answered from their stored row: Privy's links or the throwaway list may have changed since
    const had = store.member(privyId);
    if (had) return { ok: true, nfts: had.nfts, early: had.nfts > 1, already: true, email: had.email, emailed: false };
    let user;
    try {
      user = await auth.user(privyId);
    } catch (e) {
      log(`privy: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ""}`);
      if (e.status === 404) throw fail(401, "sign in again");
      throw fail(502, "couldn't reach sign-in, try again");
    }
    const a = accountsOf(user);
    if (!a.email) throw fail(400, "verify your email");
    if (!a.xId) throw fail(400, "log in with X");
    if (!a.wallet) throw fail(400, "your wallet isn't ready, try again");
    if (isThrowaway(a.email)) throw fail(400, "use a real email, not a throwaway one");
    const ref = typeof body.ref === "string" && REF.test(body.ref) ? body.ref : null;
    let joined;
    try {
      joined = store.join({ privyId, ...a, ref }, now());
    } catch (e) {
      const column = /UNIQUE constraint failed: members\.(\w+)/.exec(e.message)?.[1];
      if (TAKEN[column]) throw fail(409, TAKEN[column]);
      throw e;
    }
    // a new member gets the welcome email; a failed send is logged and the join stands
    let emailed = false;
    if (mail && !joined.already) {
      try {
        await mail(a.email, joined.nfts);
        emailed = true;
      } catch (e) {
        log(`welcome email: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ""}`);
      }
    }
    return { ok: true, ...joined, email: a.email, emailed };
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      if (url.pathname === OLD_ENDPOINT) throw fail(410, "joining needs your email and X now. reload the page");
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

function main() {
  const file = process.env.WAITLIST_DB ?? path.join(ROOT, ".data", "waitlist.db");
  const store = openStore(file);
  if (process.argv.includes("--allowlist")) {
    const members = store.members();
    const unclaimed = store.unclaimed();
    process.stdout.write(toAllowlistCsv(members, unclaimed));
    const nfts = [...members, ...unclaimed].reduce((n, r) => n + (r.nfts ?? 2), 0);
    console.error(`${members.length} members + ${unclaimed.length} from the waitlist, ${nfts} NFTs (${file})`);
    return store.close();
  }
  if (process.argv.includes("--members")) {
    const rows = store.members();
    process.stdout.write(toMembersCsv(rows));
    console.error(`${rows.length} members (${file})`);
    return store.close();
  }
  if (process.argv.includes("--export")) {
    process.stdout.write(toCsv(store.all()));
    console.error(`${store.count()} on the waitlist (${file})`);
    return store.close();
  }
  const { PRIVY_APP_ID: appId, PRIVY_APP_SECRET: secret, PRIVY_VERIFICATION_KEY: key } = process.env;
  const auth = appId && secret && key ? privyAuth({ appId, secret, key }) : null;
  const { RESEND_API_KEY: mailKey, WAITLIST_FROM: from = "Mooner <hello@mooner.family>" } = process.env;
  const mail = mailKey ? resendMailer({ key: mailKey, from }) : null;
  if (!auth) console.warn("no PRIVY_APP_ID, PRIVY_APP_SECRET or PRIVY_VERIFICATION_KEY: joining answers 503");
  if (!mail) console.warn("no RESEND_API_KEY: members join, no welcome email is sent");
  const isThrowaway = throwawayCheck(fs.readFileSync(path.join(ROOT, "disposable-domains.txt"), "utf8"));
  const port = Number(process.env.WAITLIST_PORT ?? process.env.PORT ?? 4410);
  const host = process.env.WAITLIST_HOST ?? "127.0.0.1";
  const server = createApp({ store, mail, auth, isThrowaway, trustProxy: process.env.WAITLIST_TRUST_PROXY === "1" });
  server.listen(port, host, () =>
    console.log(`mooner waitlist on http://${host}:${port} · ${store.memberCount()} members, ${store.count()} on the old list · ${mail ? `mail from ${from}` : "no mail"} · ${file}`),
  );
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      server.close();
      store.close();
      process.exit(0);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
