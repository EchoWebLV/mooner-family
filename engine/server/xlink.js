// X login: OAuth 2.0 with PKCE (X's confidential-client flow) links a wallet to its X account,
// for Raider XP (raiders.js). Mooner keeps the account's id, handle, name, picture, follower
// count and age; X's token is revoked as soon as they're read, so nothing reads or posts as the
// user later. One X account goes with one wallet, and one wallet with one X account: linking
// again moves the link.
//
//   POST /api/x/start     { token } -> { url }: X's page to sign in and allow it (the app opens it)
//   GET  /api/x/callback  X sends the browser back here -> the app: <back>?handle=… or ?error=…
//   GET  /api/x/<wallet>  -> { x: { handle, name, avatar, ok } | null }  (ok: passes RAIDER_FLOOR)
//   POST /api/x/unlink    { token } -> { x: null }
//
// `token` is a Mooner sign-in (social.js /api/login, makeSessions).

import crypto from "node:crypto";
import { HttpError, Limiter, limit } from "./http.js";
import { parseKey } from "./api.js";
import { raiderOk } from "../src/xp.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS x_links (
  wallet    TEXT PRIMARY KEY,
  x_id      TEXT NOT NULL UNIQUE,
  handle    TEXT NOT NULL,
  name      TEXT NOT NULL,
  avatar    TEXT,
  followers INTEGER NOT NULL,
  since     INTEGER,
  at        INTEGER NOT NULL
);`;

const KEY = "(?<key>[1-9A-HJ-NP-Za-km-z]{32,44})";
const AUTHORIZE = "https://x.com/i/oauth2/authorize";
const API = "https://api.x.com";
const SCOPES = "tweet.read users.read";
const STATE_MS = 10 * 60_000;
const MAX_PENDING = 5_000;
/** Where the callback sends the browser: the phone app's link (app.json "scheme"). */
export const X_BACK = "mooner://x-link";

export const X_LIMITS = {
  startPerIp: [20, 600_000],
  callbackPerIp: [40, 600_000],
  unlinkPerWallet: [10, 600_000],
};

const b64url = (buf) => buf.toString("base64url");

/** The wallet <-> X account links, in the server's db. */
export class XLinks {
  constructor(db) {
    this.db = db;
    db.exec(SCHEMA);
  }

  /** `wallet` is now `u`'s ({ id, handle, name, avatar, followers, since (ms) }), at `at` (ms).
   *  REPLACE drops the rows it clashes with: this wallet's old link and this X account's. */
  link(wallet, u, at) {
    this.db
      .prepare("INSERT OR REPLACE INTO x_links (wallet, x_id, handle, name, avatar, followers, since, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(wallet, u.id, u.handle, u.name, u.avatar ?? null, u.followers, u.since ?? null, at);
  }

  unlink(wallet) {
    this.db.prepare("DELETE FROM x_links WHERE wallet = ?").run(wallet);
  }

  /** The wallet's link, { wallet, id, handle, name, avatar, followers, since, at }, or null. */
  of(wallet) {
    const r = this.db.prepare("SELECT * FROM x_links WHERE wallet = ?").get(wallet);
    return r ? rowOf(r) : null;
  }

  /** The wallet the X account `id` is linked to, or null. */
  walletOfX(id) {
    return this.db.prepare("SELECT wallet FROM x_links WHERE x_id = ?").get(String(id))?.wallet ?? null;
  }

  count() {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM x_links").get().n);
  }

  /** What anyone may see of the wallet's link: { handle, name, avatar, ok }, or null. */
  shown(wallet, now) {
    const l = this.of(wallet);
    return l && { handle: l.handle, name: l.name, avatar: l.avatar, ok: raiderOk(l.followers, l.since, now) };
  }
}

const rowOf = (r) => ({ wallet: r.wallet, id: r.x_id, handle: r.handle, name: r.name, avatar: r.avatar, followers: r.followers, since: r.since, at: r.at });

/** X's words for what went wrong, short. */
async function said(r) {
  const text = await r.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    return String(j.error_description ?? j.error ?? j.detail ?? j.title ?? text).slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

/**
 * `links`: XLinks. `walletOf(token)`: the wallet of a Mooner sign-in, or a 401. `clientId`,
 * `clientSecret`: the X app's OAuth 2.0 keys; `callback`: this server's /api/x/callback as the
 * X app lists it. Without them, starting a link answers 503. `onLink(wallet, link)`: a wallet
 * just linked (raiders.js gives what its posts already earned).
 */
export function makeXRoutes({ links, walletOf, clientId, clientSecret, callback, back = X_BACK, onLink = () => {}, fetch = globalThis.fetch, limits = X_LIMITS, now = Date.now, log = console.log }) {
  const L = Object.fromEntries(Object.entries({ ...X_LIMITS, ...limits }).map(([k, [max, ms]]) => [k, new Limiter(max, ms, now)]));
  const pending = new Map(); // state -> { wallet, verifier, at }, oldest first
  const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

  function sweep() {
    for (const [k, p] of pending) {
      if (now() - p.at <= STATE_MS && pending.size < MAX_PENDING) break;
      pending.delete(k);
    }
  }

  async function start({ body, ip }) {
    limit(L.startPerIp, ip, "X sign-ins");
    if (body === null || typeof body !== "object") throw new HttpError(400, "the body must be a JSON object");
    const wallet = walletOf(body.token);
    if (!clientId || !clientSecret || !callback) throw new HttpError(503, "X sign-in isn't set up on this server yet");
    sweep();
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    pending.set(state, { wallet, verifier, at: now() });
    const q = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: callback, scope: SCOPES, state,
      code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
    });
    return { json: { url: `${AUTHORIZE}?${q.toString().replace(/\+/g, "%20")}` } };
  }

  async function exchange(code, verifier) {
    const r = await fetch(`${API}/2/oauth2/token`, {
      method: "POST",
      headers: { authorization: basic, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callback, code_verifier: verifier, client_id: clientId }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`token: HTTP ${r.status} ${await said(r)}`);
    const tok = await r.json();
    if (!tok.access_token) throw new Error("token: no access_token");
    return tok.access_token;
  }

  async function me(access) {
    const r = await fetch(`${API}/2/users/me?user.fields=created_at,public_metrics,profile_image_url`, {
      headers: { authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`users/me: HTTP ${r.status} ${await said(r)}`);
    const d = (await r.json())?.data;
    if (!d?.id || !d?.username) throw new Error("users/me: no id or username");
    const since = Date.parse(d.created_at);
    return {
      id: String(d.id), handle: String(d.username).slice(0, 40), name: String(d.name ?? d.username).slice(0, 80),
      avatar: d.profile_image_url ?? null, followers: Number(d.public_metrics?.followers_count ?? 0), since: Number.isFinite(since) ? since : null,
    };
  }

  function revoke(access) {
    fetch(`${API}/2/oauth2/revoke`, {
      method: "POST",
      headers: { authorization: basic, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: access, token_type_hint: "access_token", client_id: clientId }).toString(),
      signal: AbortSignal.timeout(15_000),
    }).catch((e) => log(`x: revoke: ${e?.message ?? e}`));
  }

  async function finish({ url, ip }) {
    const go = (params) => ({ location: `${back}?${new URLSearchParams(params).toString().replace(/\+/g, "%20")}` }); // %20: any parser reads it
    if (!L.callbackPerIp.take(ip)) return go({ error: "Too many tries. Wait a few minutes and try again." });
    const q = url.searchParams;
    const state = q.get("state") ?? "";
    const p = pending.get(state);
    pending.delete(state);
    if (!p || now() - p.at > STATE_MS) return go({ error: "That sign-in ran out. Tap Link X again." });
    if (q.get("error")) return go({ error: q.get("error") === "access_denied" ? "You didn't allow it on X." : "X said no. Try again." });
    if (!q.get("code")) return go({ error: "X sent nothing back. Try again." });
    let u;
    try {
      const access = await exchange(q.get("code"), p.verifier);
      try {
        u = await me(access);
      } finally {
        revoke(access);
      }
    } catch (e) {
      log(`x: link for ${p.wallet}: ${e?.message ?? e}`);
      return go({ error: "Couldn't reach X. Try again." });
    }
    links.link(p.wallet, u, now());
    try {
      onLink(p.wallet, links.of(p.wallet));
    } catch (e) {
      log(`x: after linking ${p.wallet}: ${e?.message ?? e}`);
    }
    return go({ handle: u.handle });
  }

  function unlink({ body }) {
    if (body === null || typeof body !== "object") throw new HttpError(400, "the body must be a JSON object");
    const wallet = walletOf(body.token);
    limit(L.unlinkPerWallet, wallet, "unlinks");
    links.unlink(wallet);
    return { json: { x: null } };
  }

  return [
    { method: "POST", path: /^\/api\/x\/start$/, body: 1_024, handler: start },
    { method: "GET", path: /^\/api\/x\/callback$/, handler: finish },
    { method: "POST", path: /^\/api\/x\/unlink$/, body: 1_024, handler: unlink },
    { method: "GET", path: new RegExp(`^/api/x/${KEY}$`), handler: async ({ params }) => ({ json: { x: links.shown(parseKey(params.key, "wallet").toBase58(), now()) } }) },
  ];
}
