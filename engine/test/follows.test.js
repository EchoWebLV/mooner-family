// Follows (server/follows.js) and the shared sign-in (social.js makeSessions), over an
// in-memory Store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { makeSessions, makeSocialRoutes } from "../server/social.js";
import { followersOf, followsOf, makeFollowRoutes } from "../server/follows.js";

const wallet = () => Keypair.generate().publicKey.toBase58();
const handler = (routes, path) => routes.find((r) => r.path.test(path)).handler;

function rig({ now = () => 1_000_000 } = {}) {
  const store = new Store(":memory:");
  const heard = [];
  const routes = makeFollowRoutes({ store, onFollow: (w) => heard.push(w), now });
  const sessions = makeSessions(store.db, now);
  const follow = (token, w, ip = "1.1.1.1") => handler(routes, "/api/follow")({ body: { token, wallet: w }, ip });
  const unfollow = (token, w, ip = "1.1.1.1") => handler(routes, "/api/unfollow")({ body: { token, wallet: w }, ip });
  return { store, heard, sessions, follow, unfollow };
}

test("sessions: one secret per db, shared by every part of the server; a forged or old token is 401", () => {
  let t = 1_000;
  const store = new Store(":memory:");
  const a = makeSessions(store.db, () => t);
  makeSocialRoutes({ store, isPresale: () => false, now: () => t }); // the social routes' own copy
  const b = makeSessions(store.db, () => t);
  const W = wallet();
  const { token } = a.issue(W);
  assert.equal(b.walletOf(token), W);
  assert.equal(b.deviceCheck("device:x", a.deviceSign("device:x")), true);
  assert.equal(b.deviceCheck("device:y", a.deviceSign("device:x")), false);
  assert.equal(b.deviceCheck("device:x", undefined), false);
  assert.throws(() => b.walletOf(token.slice(0, -2) + "xx"), { status: 401 });
  assert.throws(() => b.walletOf(undefined), { status: 401, message: "sign in first" });
  t += 8 * 24 * 3_600_000;
  assert.throws(() => b.walletOf(token), { status: 401, message: "your sign-in ran out, sign in again" });
});

test("sessions: a phone's key and a sign-in are MACs under different keys; a MAC the right length in characters but not in bytes is a no, not a throw", () => {
  const s = makeSessions(new Store(":memory:").db, () => 1_000);
  const { token } = s.issue(wallet());
  const [w, exp, mac] = token.split(".");
  assert.equal(s.deviceCheck(`${w}.${exp}`, mac), false, "a sign-in's MAC is not a phone's key");
  assert.throws(() => s.walletOf(`${w}.${exp}.${s.deviceSign(`${w}.${exp}`)}`), { status: 401 }, "nor is a phone's key a sign-in");
  // "é" is 1 character and 2 bytes: same length as the real MAC in characters, one byte longer
  const key = s.deviceSign("device:x");
  assert.equal(s.deviceCheck("device:x", `é${key.slice(1)}`), false);
  assert.throws(() => s.walletOf(`${w}.${exp}.é${mac.slice(1)}`), { status: 401 });
});

test("follow and unfollow: both lists, newest first; both wallets are pushed", async () => {
  let t = 1_000;
  const { sessions, follow, unfollow, heard, store } = rig({ now: () => t });
  const [me, a, b] = [wallet(), wallet(), wallet()];
  const token = sessions.issue(me).token;
  assert.deepEqual((await follow(token, a)).json, { wallet: me, following: [a], followers: [] });
  t += 1;
  assert.deepEqual((await follow(token, b)).json.following, [b, a]);
  assert.deepEqual((await follow(token, b)).json.following, [b, a]); // again: no change
  assert.deepEqual(followsOf(store.db, a), { wallet: a, following: [], followers: [me] });
  assert.deepEqual(followersOf(store.db, b), [me]);
  assert.deepEqual(heard.slice(0, 4), [me, a, me, b]);
  assert.deepEqual((await unfollow(token, a)).json.following, [b]);
  assert.deepEqual(followersOf(store.db, a), []);
});

test("refused: no sign-in, yourself, not an address, over the limits", async () => {
  const { sessions, follow } = rig();
  const me = wallet();
  const token = sessions.issue(me).token;
  await assert.rejects(follow("nope", wallet()), { status: 401 });
  await assert.rejects(follow(token, me), { status: 400, message: "you can't follow yourself" });
  await assert.rejects(follow(token, "not a key"), { status: 400, message: "wallet is not a Solana address" });
  // 60 a wallet each 10 minutes; the refusals above were before the wallet's count
  for (let i = 0; i < 60; i++) await follow(token, wallet());
  await assert.rejects(follow(token, wallet()), { status: 429 });
});

test("at most MAX_FOLLOWING wallets", async () => {
  const store = new Store(":memory:");
  const routes = makeFollowRoutes({ store, limits: { followPerIp: [1e9, 1], followPerWallet: [1e9, 1] } });
  const me = wallet();
  const token = makeSessions(store.db).issue(me).token;
  const insert = store.db.prepare("INSERT INTO follows (follower, followee, at) VALUES (?, ?, ?)");
  const first = wallet();
  insert.run(me, first, 0);
  for (let i = 1; i < 1_000; i++) insert.run(me, `w${i}`, i);
  const follow = (w) => handler(routes, "/api/follow")({ body: { token, wallet: w }, ip: "x" });
  await assert.rejects(follow(wallet()), { status: 400, message: "you can follow at most 1000 wallets" });
  assert.equal((await follow(first)).json.following.length, 1_000); // one already followed is fine
});
