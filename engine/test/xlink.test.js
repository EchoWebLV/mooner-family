// X sign-in (server/xlink.js): the PKCE start, the callback with a fake X, the link rules (one
// X account per wallet and back), unlinking, and what anyone can read of a link.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { makeSessions } from "../server/social.js";
import { XLinks, X_BACK, makeXRoutes } from "../server/xlink.js";

const T = Date.UTC(2026, 9, 10, 12);
const DAY = 86_400_000;
const CALLBACK = "https://app.mooner.family/api/x/callback";
const wallet = () => Keypair.generate().publicKey.toBase58();
const OLD = new Date(T - 400 * DAY).toISOString();

/** A fake X: the token endpoint wants the code and the verifier that goes with the challenge. */
function fakeX({ user = { id: "42", username: "moonboi", name: "Moon Boi", created_at: OLD, public_metrics: { followers_count: 120 }, profile_image_url: "https://pbs.twimg.com/a.jpg" }, down = false } = {}) {
  const calls = [];
  let challenge = null;
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (down) throw new Error("x down");
    const u = new URL(url);
    if (u.pathname === "/2/oauth2/token") {
      const form = new URLSearchParams(init.body);
      const ok = form.get("code") === "CODE" && crypto.createHash("sha256").update(form.get("code_verifier")).digest("base64url") === challenge
        && form.get("redirect_uri") === CALLBACK && init.headers.authorization === `Basic ${Buffer.from("cid:secret").toString("base64")}`;
      return ok ? Response.json({ access_token: "AT", token_type: "bearer" }) : Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (u.pathname === "/2/users/me") return init.headers.authorization === "Bearer AT" ? Response.json({ data: user }) : new Response("no", { status: 401 });
    if (u.pathname === "/2/oauth2/revoke") return Response.json({ revoked: true });
    return new Response("?", { status: 404 });
  };
  return { fetch, calls, setChallenge: (c) => (challenge = c) };
}

function rig(over = {}) {
  const store = new Store(":memory:");
  const links = new XLinks(store.db);
  const sessions = makeSessions(store.db, () => T);
  const x = fakeX(over.x);
  const linked = [];
  const logs = [];
  const routes = makeXRoutes({
    links, walletOf: sessions.walletOf, clientId: "cid", clientSecret: "secret", callback: CALLBACK,
    onLink: (w, l) => linked.push([w, l]), fetch: x.fetch, now: () => T, log: (m) => logs.push(m), ...over.routes,
  });
  const call = async (method, path, body = {}, ip = "1.1.1.1") => {
    const url = new URL(path, "http://x");
    const r = routes.find((r) => r.method === method && r.path.test(url.pathname));
    try {
      const out = await r.handler({ params: url.pathname.match(r.path).groups ?? {}, body, ip, url });
      return { status: out.status ?? (out.location ? 302 : 200), ...out };
    } catch (e) {
      return { status: e.status, json: { error: e.message } };
    }
  };
  const token = (w) => sessions.issue(w).token;
  /** Start a link for `w` and come back from X with `params` (state filled in). */
  const roundTrip = async (w, params = { code: "CODE" }) => {
    const { json } = await call("POST", "/api/x/start", { token: token(w) });
    const auth = new URL(json.url);
    x.setChallenge(auth.searchParams.get("code_challenge"));
    const q = new URLSearchParams({ state: auth.searchParams.get("state"), ...params });
    return { auth, back: await call("GET", `/api/x/callback?${q}`) };
  };
  return { links, call, token, roundTrip, x, linked, logs };
}

const backParams = (r) => {
  assert.equal(r.status, 302);
  assert.ok(r.location.startsWith(`${X_BACK}?`), r.location);
  return Object.fromEntries(new URL(r.location).searchParams);
};

test("POST /api/x/start: X's authorize page with PKCE (S256), the scopes to read who you are, and our callback", async () => {
  const r = rig();
  const { auth } = await r.roundTrip(wallet());
  assert.equal(auth.origin + auth.pathname, "https://x.com/i/oauth2/authorize");
  const q = auth.searchParams;
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("client_id"), "cid");
  assert.equal(q.get("redirect_uri"), CALLBACK);
  assert.equal(q.get("scope"), "tweet.read users.read");
  assert.ok(!auth.search.includes("+"), "spaces as %20");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.match(q.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(q.get("state").length >= 32);
});

test("POST /api/x/start: needs a sign-in, and 503 while the server has no X keys", async () => {
  const r = rig();
  assert.equal((await r.call("POST", "/api/x/start", { token: "nope" })).status, 401);
  const off = rig({ routes: { clientId: null } });
  const res = await off.call("POST", "/api/x/start", { token: off.token(wallet()) });
  assert.equal(res.status, 503);
});

test("GET /api/x/callback: links the wallet, revokes X's token, tells the app the handle", async () => {
  const r = rig();
  const w = wallet();
  const { back } = await r.roundTrip(w);
  assert.deepEqual(backParams(back), { handle: "moonboi" });
  assert.deepEqual(r.links.of(w), { wallet: w, id: "42", handle: "moonboi", name: "Moon Boi", avatar: "https://pbs.twimg.com/a.jpg", followers: 120, since: Date.parse(OLD), at: T });
  assert.equal(r.linked.length, 1);
  assert.equal(r.linked[0][0], w);
  await new Promise((ok) => setImmediate(ok));
  assert.ok(r.x.calls.some((c) => c.url.endsWith("/2/oauth2/revoke") && new URLSearchParams(c.init.body).get("token") === "AT"), "the token is revoked");
  assert.deepEqual((await r.call("GET", `/api/x/${w}`)).json, { x: { handle: "moonboi", name: "Moon Boi", avatar: "https://pbs.twimg.com/a.jpg", ok: true } });
});

test("GET /api/x/callback: a state is good once, for ten minutes; a denial, a missing code and X being down each say so", async () => {
  const r = rig();
  const w = wallet();
  const { auth } = await r.roundTrip(w);
  const again = await r.call("GET", `/api/x/callback?state=${auth.searchParams.get("state")}&code=CODE`);
  assert.match(backParams(again).error, /ran out/, "a used state");
  assert.match(backParams(await r.call("GET", "/api/x/callback?state=made-up&code=CODE")).error, /ran out/);
  assert.match(backParams((await r.roundTrip(w, { error: "access_denied" })).back).error, /didn't allow/);
  assert.match(backParams((await r.roundTrip(w, {})).back).error, /nothing back/);
  assert.match(backParams((await r.roundTrip(w, { code: "WRONG" })).back).error, /Couldn't reach X/);

  let t = T;
  const late = rig({ routes: { now: () => t } });
  const { json } = await late.call("POST", "/api/x/start", { token: late.token(w) });
  t += 10 * 60_000 + 1;
  const state = new URL(json.url).searchParams.get("state");
  assert.match(backParams(await late.call("GET", `/api/x/callback?state=${state}&code=CODE`)).error, /ran out/);
  assert.equal(late.links.count(), 0);
});

test("XLinks: one X account per wallet and one wallet per X account; linking again moves it", () => {
  const links = new XLinks(new Store(":memory:").db);
  const [a, b] = [wallet(), wallet()];
  const u = (id, handle) => ({ id, handle, name: handle, followers: 60, since: T - 100 * DAY });
  links.link(a, u("1", "one"), T);
  links.link(b, u("1", "one"), T + 1);
  assert.equal(links.of(a), null, "the X account left a");
  assert.equal(links.walletOfX("1"), b);
  links.link(b, u("2", "two"), T + 2);
  assert.equal(links.walletOfX("1"), null, "b's old X account is unlinked");
  assert.equal(links.of(b).handle, "two");
  assert.equal(links.count(), 1);
});

test("GET /api/x/<wallet>: null with no link; ok is false for an account under the floor; POST /api/x/unlink drops it", async () => {
  const young = new Date(T - 10 * DAY).toISOString();
  const r = rig({ x: { user: { id: "7", username: "fresh", name: "Fresh", created_at: young, public_metrics: { followers_count: 5000 } } } });
  const w = wallet();
  assert.deepEqual((await r.call("GET", `/api/x/${w}`)).json, { x: null });
  await r.roundTrip(w);
  assert.equal((await r.call("GET", `/api/x/${w}`)).json.x.ok, false, "made 10 days ago");
  assert.equal((await r.call("POST", "/api/x/unlink", { token: "bad" })).status, 401);
  assert.deepEqual((await r.call("POST", "/api/x/unlink", { token: r.token(w) })).json, { x: null });
  assert.deepEqual((await r.call("GET", `/api/x/${w}`)).json, { x: null });
  assert.equal((await r.call("GET", `/api/x/${"z".repeat(44)}`)).status, 400);
});
