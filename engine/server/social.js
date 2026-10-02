// The social layer: sign-in with a wallet, the chat (a global channel and one per
// presale) and each wallet's Mooner picture. Kept in the server's SQLite file beside the
// mint records; nothing here touches the chain or moves SOL.
//
//   POST /api/login                  { wallet, time, signature }  -> { token, exp }
//   GET  /api/chat/:channel          the last messages ("global" or a presale), ?after=<id>
//   POST /api/chat                   { token, channel, text }
//   GET  /api/profiles               every wallet's Mooner picture
//   POST /api/profile                { token, pfp }

import crypto from "node:crypto";
import { verifySignature } from "./auth.js";
import { HttpError, Limiter, limit } from "./http.js";
import { parseKey } from "./api.js";
import { loginMessage } from "../src/client.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  wallet  TEXT NOT NULL,
  text    TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_channel ON chat (channel, id);
CREATE TABLE IF NOT EXISTS profiles (
  wallet     TEXT PRIMARY KEY,
  pfp        TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS secrets (
  name  TEXT PRIMARY KEY,
  value BLOB NOT NULL
);`;

export const MAX_CHAT = 280;
const PAGE = 100;
const TIME_SKEW_S = 300;
const SESSION_MS = 7 * 24 * 3_600_000;
const PFP_SLOTS = ["skin", "eyes", "head", "face", "outfit", "neck", "aura", "bg", "mouth"];
const CHANNEL = /^(global|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export { loginMessage };

export const SOCIAL_LIMITS = {
  loginPerIp: [20, 600_000],
  chatPerWallet: [5, 10_000],
  chatPerIp: [30, 60_000],
  profilePerWallet: [20, 600_000],
};

const bad = (msg) => {
  throw new HttpError(400, msg);
};

/** The last messages of a channel, oldest first; with `after`, the ones after that id. */
export function chatRows(db, channel, after = 0) {
  return after > 0
    ? db.prepare("SELECT id, channel, wallet, text, at FROM chat WHERE channel = ? AND id > ? ORDER BY id LIMIT ?").all(channel, after, PAGE)
    : db.prepare("SELECT * FROM (SELECT id, channel, wallet, text, at FROM chat WHERE channel = ? ORDER BY id DESC LIMIT ?) ORDER BY id").all(channel, PAGE);
}

/** Every wallet's Mooner picture, by wallet. */
export function allProfiles(db) {
  const all = db.prepare("SELECT wallet, pfp FROM profiles ORDER BY updated_at DESC LIMIT 5000").all();
  return Object.fromEntries(all.map((r) => [r.wallet, JSON.parse(r.pfp)]));
}

/** Mooner sign-ins, over the server's db: { issue(wallet) -> { token, exp }, walletOf(token)
 *  -> wallet (401 if it's forged or old), deviceSign(text) -> mac, deviceCheck(text, mac) ->
 *  boolean }. The secret lives in the db, so a sign-in survives restarts and lasts its week,
 *  and every part of the server that calls this shares it (follows.js, alerts.js). A phone's
 *  `key` (alerts.js) is a MAC under its own key, derived from the secret with a fixed label,
 *  so a sign-in's MAC is never a phone's key, nor the other way round. */
export function makeSessions(db, now = Date.now) {
  db.exec("CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value BLOB NOT NULL)");
  let secret = db.prepare("SELECT value FROM secrets WHERE name = 'session'").get()?.value;
  if (!secret) {
    secret = crypto.randomBytes(32);
    db.prepare("INSERT INTO secrets (name, value) VALUES ('session', ?)").run(secret);
  }
  const deviceKey = crypto.createHmac("sha256", secret).update("mooner:device-key").digest();
  const macWith = (key, s) => crypto.createHmac("sha256", key).update(s).digest("base64url");
  // Byte lengths, not string lengths: a MAC with a multibyte character can have the right
  // length in characters, and timingSafeEqual throws (a 500) on buffers of different lengths.
  const same = (mac, want) => {
    if (typeof mac !== "string") return false;
    const a = Buffer.from(mac);
    const b = Buffer.from(want);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  function issue(wallet) {
    const exp = now() + SESSION_MS;
    const body = `${wallet}.${exp}`;
    return { token: `${body}.${macWith(secret, body)}`, exp };
  }

  function walletOf(token) {
    if (typeof token !== "string") throw new HttpError(401, "sign in first");
    const [wallet, exp, mac] = token.split(".");
    if (!same(mac, macWith(secret, `${wallet}.${exp}`)) || !(Number(exp) > now())) throw new HttpError(401, "your sign-in ran out, sign in again");
    return wallet;
  }

  const deviceSign = (s) => macWith(deviceKey, s);
  const deviceCheck = (s, mac) => same(mac, deviceSign(s));

  return { issue, walletOf, deviceSign, deviceCheck };
}

/** `store` is the server's Store (its db is shared); `isPresale(key)` says whether a chat
 *  channel names a presale this server knows. `onChat(row)` and `onProfile(wallet, pfp)`
 *  hear each message and picture as it's saved (the live feed pushes them). */
export function makeSocialRoutes({ store, isPresale, onChat = () => {}, onProfile = () => {}, limits = SOCIAL_LIMITS, now = Date.now }) {
  const db = store.db;
  db.exec(SCHEMA);
  const L = Object.fromEntries(Object.entries(limits).map(([k, [max, ms]]) => [k, new Limiter(max, ms, now)]));
  const usedSigs = new Map();
  const { issue, walletOf } = makeSessions(db, now);

  async function login({ body, ip }) {
    limit(L.loginPerIp, ip, "sign-ins");
    const wallet = parseKey(body.wallet, "wallet");
    const time = body.time;
    if (!Number.isInteger(time) || Math.abs(now() / 1000 - time) > TIME_SKEW_S) bad("time must be now, in unix seconds");
    const signature = typeof body.signature === "string" ? Buffer.from(body.signature, "base64") : Buffer.alloc(0);
    if (!verifySignature(wallet, loginMessage(wallet.toBase58(), time), signature)) {
      throw new HttpError(401, "the signature doesn't match this wallet");
    }
    const key = signature.toString("base64");
    for (const [s, t] of usedSigs) if (now() - t > 2 * TIME_SKEW_S * 1000) usedSigs.delete(s);
    if (usedSigs.has(key)) throw new HttpError(409, "this sign-in was already used");
    usedSigs.set(key, now());
    return { json: { wallet: wallet.toBase58(), ...issue(wallet.toBase58()) } };
  }

  function channelOf(v) {
    if (typeof v !== "string" || !CHANNEL.test(v)) bad("channel must be global or a presale");
    if (v !== "global" && !isPresale(v)) throw new HttpError(404, "no such presale");
    return v;
  }

  async function readChat({ params, url }) {
    const channel = channelOf(params.channel);
    const after = Number(url.searchParams.get("after") ?? 0);
    return { json: { messages: chatRows(db, channel, Number.isSafeInteger(after) ? after : 0) } };
  }

  async function postChat({ body, ip }) {
    limit(L.chatPerIp, ip, "messages");
    const wallet = walletOf(body.token);
    const channel = channelOf(body.channel);
    if (typeof body.text !== "string") bad("text must be text");
    const text = body.text.trim();
    if (!text) bad("type a message first");
    if ([...text].length > MAX_CHAT) bad(`at most ${MAX_CHAT} characters`);
    if (/[\u0000-\u001f\u007f]/.test(text)) bad("no control characters");
    limit(L.chatPerWallet, wallet, "messages, slow down");
    const at = now();
    const { lastInsertRowid } = db.prepare("INSERT INTO chat (channel, wallet, text, at) VALUES (?, ?, ?, ?)").run(channel, wallet, text, at);
    const row = { id: Number(lastInsertRowid), channel, wallet, text, at };
    onChat(row);
    return { status: 201, json: row };
  }

  async function readProfiles() {
    return { json: { profiles: allProfiles(db) } };
  }

  async function saveProfile({ body }) {
    const wallet = walletOf(body.token);
    limit(L.profilePerWallet, wallet, "picture changes");
    const p = body.pfp;
    if (!p || typeof p !== "object" || Array.isArray(p)) bad("pfp must be an object");
    const pfp = {};
    for (const slot of PFP_SLOTS) {
      // Mouth was added after the original eight-slot profile format.
      if (slot === "mouth" && !Object.hasOwn(p, slot)) continue;
      if (typeof p[slot] !== "string" || !/^[a-z0-9-]{1,32}$/.test(p[slot])) bad(`pfp.${slot} must be a trait id`);
      pfp[slot] = p[slot];
    }
    db.prepare("INSERT INTO profiles (wallet, pfp, updated_at) VALUES (?, ?, ?) ON CONFLICT (wallet) DO UPDATE SET pfp = excluded.pfp, updated_at = excluded.updated_at")
      .run(wallet, JSON.stringify(pfp), now());
    onProfile(wallet, pfp);
    return { json: { wallet, pfp } };
  }

  return [
    { method: "POST", path: /^\/api\/login$/, body: 4_096, handler: login },
    { method: "GET", path: /^\/api\/chat\/(?<channel>[A-Za-z0-9]{1,44})$/, handler: readChat },
    { method: "POST", path: /^\/api\/chat$/, body: 4_096, handler: postChat },
    { method: "GET", path: /^\/api\/profiles$/, handler: readProfiles },
    { method: "POST", path: /^\/api\/profile$/, body: 4_096, handler: saveProfile },
  ];
}
