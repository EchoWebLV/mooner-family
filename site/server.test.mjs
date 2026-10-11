// node --disable-warning=ExperimentalWarning --test site/server.test.mjs

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { ENDPOINT, createApp, openStore, resendMailer, staticFile, throwawayCheck, toAllowlistCsv, toCsv, toMembersCsv } from "./server.mjs";

const ROOT = path.dirname(new URL(import.meta.url).pathname);

// Privy, stubbed: the token "tok.<id>" is did:privy:<id>; USERS holds what Privy's API would
// answer for each; did:privy:down is Privy not answering, did:privy:gone a user Privy no longer has
const acct = {
  email: (address) => ({ type: "email", address, verified_at: 1 }),
  x: (subject, username) => ({ type: "twitter_oauth", subject, username, verified_at: 1 }),
  wallet: (address) => ({ type: "wallet", chain_type: "solana", wallet_client_type: "privy", connector_type: "embedded", address }),
};
const person = (n, o = {}) => [acct.email(o.email ?? `p${n}@example.com`), acct.x(o.xId ?? `x${n}`, o.handle ?? `p${n}`), acct.wallet(o.wallet ?? `W${n}`)];
const USERS = new Map();
const user = (id, linked) => USERS.set(`did:privy:${id}`, { id: `did:privy:${id}`, linked_accounts: linked });
const asked = []; // the ids auth.user was asked for
const auth = {
  verify: (t) => (t.startsWith("tok.") ? `did:privy:${t.slice(4)}` : null),
  async user(id) {
    asked.push(id);
    if (id === "did:privy:down") throw new Error("privy users: HTTP 500");
    if (id === "did:privy:slow") throw new Error("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    if (id === "did:privy:gone") throw Object.assign(new Error("privy users: HTTP 404"), { status: 404 });
    return USERS.get(id) ?? { id, linked_accounts: [] };
  },
};
const isThrowaway = throwawayCheck("# a test list\nmailinator.com\nTrash.io\n");

let store, server, base, clock;
async function serve(opts) {
  const s = createApp({ store, limit: [1000, 60_000], now: () => clock, log: () => {}, ...opts });
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
const join = (id, body = {}, headers = {}, b = base) =>
  fetch(b + ENDPOINT, {
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
  assert.equal(isThrowaway("a@mailinator.com."), true); // a trailing dot is the same domain
  assert.equal(isThrowaway("a@x.mailinator.com."), true);
  assert.equal(isThrowaway("a@gmail.com."), false);
  assert.equal(isThrowaway("a@com."), false);
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
  assert.deepEqual(await res.json(), { ok: true, nfts: 1, early: false, already: false, email: "p1@example.com", emailed: false });
  res = await join("new1", { ref: "Other" });
  assert.deepEqual(await res.json(), { ok: true, nfts: 1, early: false, already: true, email: "p1@example.com", emailed: false });
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
    ["gone", 401, "sign in again"],
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

test("the Bearer scheme is case-insensitive", async () => {
  fresh();
  user("cased", person(22));
  const res = await join(null, {}, { authorization: "bearer tok.cased" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).already, false);
});

test("a member is answered from the stored row, without asking Privy: links changed or domain listed since", async () => {
  fresh();
  user("stay", person(20));
  assert.equal((await join("stay")).status, 200);
  // a joined member whose domain was added to the throwaway list since, early: 2 NFTs
  store.add({ contact: "p21@mailinator.com", kind: "email" });
  store.join({ privyId: "did:privy:late", email: "p21@mailinator.com", xId: "x21", xHandle: "p21", wallet: "W21", ref: null });
  user("stay", [acct.email("changed@example.com"), acct.wallet("W20")]); // X unlinked, email changed
  user("late", person(21, { email: "p21@mailinator.com" }));
  const before = asked.length;
  let res = await join("stay");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, nfts: 1, early: false, already: true, email: "p20@example.com", emailed: false });
  res = await join("late");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, nfts: 2, early: true, already: true, email: "p21@mailinator.com", emailed: false });
  assert.equal(asked.length, before); // Privy wasn't asked
});

test("a Privy failure is logged with its message and cause code; a deleted user is told to sign in again", async () => {
  const logs = [];
  const [s, b] = await serve({ auth, log: (m) => logs.push(m) });
  const post = (id) => fetch(b + ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tok.${id}` }, body: "{}" });
  fresh();
  assert.equal((await post("gone")).status, 401);
  assert.equal((await post("slow")).status, 502);
  assert.deepEqual(logs, ["privy: privy users: HTTP 404", "privy: fetch failed (UND_ERR_CONNECT_TIMEOUT)"]);
  s.close();
});

test("rate limit per address, then it opens again", async () => {
  const [s, b] = await serve({ auth, isThrowaway, limit: [5, 60_000] });
  const hit = () => fetch(b + ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  fresh();
  for (let i = 0; i < 5; i++) assert.equal((await hit()).status, 401);
  const res = await hit();
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /too many tries/);
  fresh();
  assert.equal((await hit()).status, 401);
  s.close();
});

test("the email-only route is closed: 410 telling the page to reload, nothing saved", async () => {
  const s0 = store.count();
  for (const method of ["POST", "GET"]) {
    const res = await fetch(`${base}/api/waitlist`, { method, headers: { "content-type": "application/json" }, ...(method === "POST" && { body: '{"email":"a@example.com"}' }) });
    assert.equal(res.status, 410);
    assert.deepEqual(await res.json(), { error: "joining needs your email and X now. reload the page" });
  }
  assert.equal(store.count(), s0);
});

test("a new member gets the welcome email with their NFT count; again, none", async () => {
  const sent = [];
  const s = openStore(":memory:");
  s.add({ contact: "early30@example.com", kind: "email" });
  const [srv, b] = await serve({ store: s, auth, isThrowaway, mail: async (to, nfts) => sent.push([to, nfts]) });
  fresh();
  user("mail30", person(30, { email: "early30@example.com" }));
  user("mail31", person(31));
  assert.deepEqual(await (await join("mail30", {}, {}, b)).json(), { ok: true, nfts: 2, early: true, already: false, email: "early30@example.com", emailed: true });
  assert.deepEqual(await (await join("mail31", {}, {}, b)).json(), { ok: true, nfts: 1, early: false, already: false, email: "p31@example.com", emailed: true });
  assert.equal((await (await join("mail31", {}, {}, b)).json()).emailed, false);
  assert.deepEqual(sent, [["early30@example.com", 2], ["p31@example.com", 1]]);
  srv.close();
  s.close();
});

test("a failed welcome email is logged and the join stands; with no mailer none is sent", async () => {
  const logs = [];
  const s = openStore(":memory:");
  const down = Object.assign(new Error("resend: HTTP 403 domain not verified"), { cause: { code: "X" } });
  const [srv, b] = await serve({ store: s, auth, log: (l) => logs.push(l), mail: async () => { throw down; } });
  fresh();
  user("mail32", person(32));
  assert.deepEqual(await (await join("mail32", {}, {}, b)).json(), { ok: true, nfts: 1, early: false, already: false, email: "p32@example.com", emailed: false });
  assert.deepEqual(logs, ["welcome email: resend: HTTP 403 domain not verified (X)"]);
  srv.close();
  const [quiet, q] = await serve({ store: s, auth });
  user("mail33", person(33));
  assert.equal((await (await join("mail33", {}, {}, q)).json()).emailed, false);
  assert.equal(s.memberCount(), 2);
  quiet.close();
  s.close();
});

test("resendMailer: posts the welcome email to Resend with the key; a refusal throws with Resend's answer", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push([url, init]);
    return calls.length === 1 ? Response.json({ id: "e1" }) : new Response('{"message":"domain not verified"}', { status: 403 });
  };
  const mail = resendMailer({ key: "re_test", from: "Mooner <hello@mooner.family>", fetch });
  await mail("a@b.co");
  const [url, init] = calls[0];
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { authorization: "Bearer re_test", "content-type": "application/json" });
  assert.ok(init.signal instanceof AbortSignal);
  const body = JSON.parse(init.body);
  assert.deepEqual([body.from, body.to], ["Mooner <hello@mooner.family>", ["a@b.co"]]);
  assert.match(body.subject, /Mooner waitlist/);
  assert.match(body.text, /your free Mooner NFT is reserved\. .* how to get it\./);
  assert.match(body.text, /one signup per email and X account/);
  await assert.rejects(mail("a@b.co", 2), /HTTP 403 \{"message":"domain not verified"\}/);
  assert.match(JSON.parse(calls[1][1].body).text, /your 2 free Mooner NFTs are reserved\. .* how to get them\./);
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

test("CSV export: the waitlist, handles as x.com links, 2 NFTs for a row from before the free NFT, quoting where needed, claimed rows marked", () => {
  const csv = toCsv([
    { contact: "a@b.co", kind: "email", ref: "Luna2004", nfts: null, created_at: 0, claimed_by: "did:privy:a" },
    { contact: "@moon_fan", kind: "x", ref: null, nfts: null, created_at: 1000, claimed_by: null },
    { contact: 'we"ird,@b.co', kind: "email", ref: null, nfts: 1, created_at: 2000, claimed_by: null },
  ]);
  assert.equal(
    csv,
    'contact,kind,ref,nfts,joined_at,claimed\na@b.co,email,Luna2004,2,1970-01-01T00:00:00.000Z,yes\nhttps://x.com/moon_fan,x,,2,1970-01-01T00:00:01.000Z,\n"we""ird,@b.co",email,,1,1970-01-01T00:00:02.000Z,\n',
  );
});

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
  assert.equal(s.memberCount(), 5);
  assert.deepEqual({ ...s.member("did:privy:byemail") }, { nfts: 2, email: "early@example.com" });
  assert.equal(s.member("did:privy:nobody"), undefined);
  s.close();
});

test("store.join: an email-only signup (nfts 1) is claimed but isn't early: 1 NFT", () => {
  const s = openStore(":memory:");
  s.add({ contact: "late@example.com", kind: "email", nfts: 1 }, 1);
  assert.deepEqual(s.join({ privyId: "did:privy:a", email: "late@example.com", xId: "xa", xHandle: "a", wallet: "Wa" }, 2), { nfts: 1, early: false, already: false });
  assert.equal(s.all()[0].claimed_by, "did:privy:a");
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

test("store.join: again for a 1-NFT member is 'already' with 1", () => {
  const s = openStore(":memory:");
  const m = { privyId: "did:privy:a", email: "a@example.com", xId: "xa", xHandle: "a", wallet: "Wa" };
  assert.deepEqual(s.join(m, 1), { nfts: 1, early: false, already: false });
  assert.deepEqual(s.join(m, 2), { nfts: 1, early: false, already: true });
  assert.equal(s.members().length, 1);
  s.close();
});

test("store.join: no X handle is 1 NFT, stored as null, and claims nothing", () => {
  const s = openStore(":memory:");
  s.add({ contact: "@null", kind: "x" }, 1);
  s.add({ contact: "someone@example.com", kind: "email" }, 2);
  assert.deepEqual(s.join({ privyId: "did:privy:a", email: "a@example.com", xId: "xa", xHandle: null, wallet: "Wa" }, 3), { nfts: 1, early: false, already: false });
  assert.deepEqual(s.members().map((r) => [r.wallet, r.nfts, r.x_handle]), [["Wa", 1, null]]);
  assert.deepEqual(s.all().map((r) => r.claimed_by), [null, null]);
  s.close();
});

test("an old database gains claimed_by and nfts and keeps its rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-"));
  const file = path.join(dir, "waitlist.db");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE waitlist (contact TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT, created_at INTEGER NOT NULL)");
  old.prepare("INSERT INTO waitlist VALUES (?, ?, ?, ?)").run("a@b.co", "email", null, 5);
  old.close();
  const s = openStore(file);
  assert.deepEqual(s.all().map((r) => ({ ...r })), [{ contact: "a@b.co", kind: "email", ref: null, nfts: null, created_at: 5, claimed_by: null }]);
  s.close();
  const again = openStore(file); // opening again doesn't add the column twice
  assert.deepEqual(again.join({ privyId: "did:privy:a", email: "a@b.co", xId: "xa", xHandle: null, wallet: "Wa" }, 6), { nfts: 2, early: true, already: false });
  assert.equal(again.all()[0].claimed_by, "did:privy:a");
  again.close();
  fs.rmSync(dir, { recursive: true });
});

test("CSV cells starting = + - @ tab or CR are put behind a ' (CR also quoted)", () => {
  const rows = ["=a", "+a", "-a", "@a", "\ta", "\ra"].map((email, i) => ({ wallet: `W${i}`, nfts: 1, email, x_handle: null, ref: null, created_at: 0 }));
  const lines = toMembersCsv(rows).split("\n");
  assert.deepEqual(
    lines.slice(1, 6).map((l) => l.split(",")[2]),
    ["'=a", "'+a", "'-a", "'@a", "'\ta"],
  );
  assert.ok(toMembersCsv(rows).includes(`W5,1,"'\ra",`));
});

test("members CSV: a cell starting = + - @ is quoted off", () => {
  const csv = toMembersCsv([
    { wallet: "W1", nfts: 2, email: "a@b.co", x_handle: "moon_fan", ref: null, created_at: 0 },
    { wallet: "W2", nfts: 1, email: "=cmd@b.co", x_handle: null, ref: "Luna2004", created_at: 1000 },
  ]);
  assert.equal(
    csv,
    "wallet,nfts,email,x,ref,joined_at\nW1,2,a@b.co,https://x.com/moon_fan,,1970-01-01T00:00:00.000Z\nW2,1,'=cmd@b.co,,Luna2004,1970-01-01T00:00:01.000Z\n",
  );
});

test("a join waits for a reader of the database (--members on the live file) instead of failing 'database is locked'", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-"));
  const file = path.join(dir, "waitlist.db");
  const s = openStore(file);
  const reader = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "-e",
      `const db = new (require("node:sqlite").DatabaseSync)(process.argv[1]);
db.exec("BEGIN"); db.prepare("SELECT COUNT(*) FROM members").get();
console.log("reading");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
db.exec("COMMIT");`,
      file,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const exited = new Promise((r) => reader.on("close", r));
  try {
    await new Promise((r) => reader.stdout.once("data", r));
    assert.deepEqual(s.join({ privyId: "did:privy:a", email: "a@example.com", xId: "xa", xHandle: "a", wallet: "Wa" }, 1), { nfts: 1, early: false, already: false });
  } finally {
    await exited;
    s.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test("--members prints the members as CSV on stdout and the count on stderr", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-"));
  try {
    const file = path.join(dir, "waitlist.db");
    const s = openStore(file);
    s.join({ privyId: "did:privy:a", email: "a@example.com", xId: "xa", xHandle: "moon_fan", wallet: "WalletA", ref: null }, 0);
    s.close();
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "server.mjs"), "--members"], {
      env: { ...process.env, WAITLIST_DB: file },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.startsWith("wallet,nfts,email,x,ref,joined_at\n"), run.stdout);
    assert.ok(run.stdout.includes("WalletA,1,a@example.com,https://x.com/moon_fan,,1970-01-01T00:00:00.000Z"), run.stdout);
    assert.match(run.stderr, /1 members/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("allowlist CSV: the members, then the unclaimed waitlist rows with no wallet, 2 each from before the free NFT", () => {
  const csv = toAllowlistCsv(
    [{ wallet: "W1", nfts: 2, email: "a@b.co", x_handle: "moon_fan", ref: null, created_at: 0 }],
    [
      { contact: "old@b.co", kind: "email", ref: "Luna2004", nfts: null, created_at: 1000 },
      { contact: "@early", kind: "x", ref: null, nfts: null, created_at: 2000 },
      { contact: "=mail@b.co", kind: "email", ref: null, nfts: 1, created_at: 3000 },
    ],
  );
  assert.equal(
    csv,
    "wallet,nfts,email,x,ref,joined_at\n" +
      "W1,2,a@b.co,https://x.com/moon_fan,,1970-01-01T00:00:00.000Z\n" +
      ",2,old@b.co,,Luna2004,1970-01-01T00:00:01.000Z\n" +
      ",2,,https://x.com/early,,1970-01-01T00:00:02.000Z\n" +
      ",1,'=mail@b.co,,,1970-01-01T00:00:03.000Z\n",
  );
});

test("--allowlist lists every member and every waitlist row no member claimed, and counts the NFTs on stderr", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-"));
  try {
    const file = path.join(dir, "waitlist.db");
    const s = openStore(file);
    s.add({ contact: "a@example.com", kind: "email" }, 0); // claimed below: only the member's row is listed
    s.add({ contact: "@early", kind: "x" }, 1);
    s.add({ contact: "late@example.com", kind: "email", nfts: 1 }, 2);
    s.join({ privyId: "did:privy:a", email: "a@example.com", xId: "xa", xHandle: "moon_fan", wallet: "WalletA" }, 3);
    assert.deepEqual(s.unclaimed().map((r) => r.contact), ["@early", "late@example.com"]);
    s.close();
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "server.mjs"), "--allowlist"], {
      env: { ...process.env, WAITLIST_DB: file },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.stdout,
      "wallet,nfts,email,x,ref,joined_at\n" +
        "WalletA,2,a@example.com,https://x.com/moon_fan,,1970-01-01T00:00:00.003Z\n" +
        ",2,,https://x.com/early,,1970-01-01T00:00:00.001Z\n" +
        ",1,late@example.com,,,1970-01-01T00:00:00.002Z\n",
    );
    assert.match(run.stderr, /1 members \+ 2 from the waitlist, 5 NFTs/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
