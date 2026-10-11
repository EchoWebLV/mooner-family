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
  const [head, , sig] = t.split(".");
  assert.equal(check(`${head}.${enc({ iss: "privy.io", aud: APP, sub: "did:privy:evil", exp: NOW / 1000 + 3600 })}.${sig}`), null); // good header and signature, swapped body
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

test("accountsOf: the Privy Solana wallet is the embedded one, privy-v2 too, the lowest wallet_index (none last)", () => {
  const w = (address, extra = {}) => ({ type: "wallet", chain_type: "solana", wallet_client_type: "privy", connector_type: "embedded", address, ...extra });
  const walletOf = (...linked_accounts) => accountsOf({ linked_accounts }).wallet;
  assert.equal(walletOf(w("V2", { wallet_client_type: "privy-v2" })), "V2");
  assert.equal(walletOf(w("One", { wallet_index: 1 }), w("Zero", { wallet_index: 0 })), "Zero");
  assert.equal(walletOf(w("None"), w("Two", { wallet_index: 2 })), "Two");
  assert.equal(walletOf(w("None")), "None");
  assert.equal(walletOf(w("Loose", { connector_type: undefined })), null); // a Privy wallet that isn't the embedded one
  assert.equal(walletOf(w("Ext", { connector_type: "injected" })), null);
});

test("privyAuth: checks tokens with the PEM (\\n-escaped too) and reads users with Basic auth", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    calls.push([url, init.headers]);
    if (url.endsWith("did:privy:gone")) return new Response(new ReadableStream({ cancel: () => (cancelled = true) }), { status: 404 });
    return Response.json({ id: "did:privy:abc123", linked_accounts: [] });
  };
  let cancelled = false;
  for (const key of [PEM, PEM.trim().replaceAll("\n", "\\n")]) {
    const auth = privyAuth({ appId: APP, secret: "s3cret", key, fetch, now: () => NOW });
    assert.equal(auth.verify(token()), "did:privy:abc123");
  }
  const auth = privyAuth({ appId: APP, secret: "s3cret", key: PEM, fetch, now: () => NOW });
  assert.deepEqual(await auth.user("did:privy:abc123"), { id: "did:privy:abc123", linked_accounts: [] });
  assert.equal(calls[0][0], "https://api.privy.io/v1/users/did:privy:abc123");
  assert.deepEqual(calls[0][1], { "privy-app-id": APP, authorization: `Basic ${Buffer.from(`${APP}:s3cret`).toString("base64")}` });
  await assert.rejects(auth.user("did:privy:gone"), (e) => /HTTP 404/.test(e.message) && e.status === 404);
  assert.equal(cancelled, true); // a refused answer's body is let go
  for (const id of ["../../v1/apps/a?x=", "did:privy:a/b", "did:privy:", "abc", "", null, 42]) await assert.rejects(auth.user(id), /bad id/, String(id));
  assert.equal(calls.length, 2); // the bad ids never reached fetch
});

test("privyAuth: takes several keys, one after another, and a token signed by any of them", () => {
  const second = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const both = `${PEM.trim()}\n${second.publicKey.export({ type: "spki", format: "pem" }).trim()}`;
  for (const key of [both, both.replaceAll("\n", "\\n")]) {
    const auth = privyAuth({ appId: APP, secret: "s", key, now: () => NOW });
    assert.equal(auth.verify(token()), "did:privy:abc123");
    assert.equal(auth.verify(token({}, { key: second.privateKey })), "did:privy:abc123");
    assert.equal(auth.verify(token({}, { key: crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey })), null);
  }
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => privyAuth({ appId: APP, secret: "s", key: `${PEM}${rsa}` }), /P-256/);
});

test("privyAuth: refuses to start without an app id, a secret or an EC P-256 key", () => {
  const start = (o) => privyAuth({ appId: APP, secret: "s", key: PEM, ...o });
  assert.ok(start({}));
  assert.ok(start({ key: privateKey.export({ type: "pkcs8", format: "pem" }) })); // a private PEM gives its public key
  for (const o of [{ appId: "" }, { appId: undefined }, { secret: "" }, { secret: null }, { key: "not a key" }]) assert.throws(() => start(o), String(Object.values(o)));
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => start({ key: rsa }), /P-256/);
  const p384 = crypto.generateKeyPairSync("ec", { namedCurve: "P-384" }).publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => start({ key: p384 }), /P-256/);
});
