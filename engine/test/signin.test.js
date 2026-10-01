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
