import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519";
import { mwaSigner } from "../src/signer.js";

// a wallet key pair; `publicKey` has the two methods the signer and walletcheck.js use
const sk = ed25519.utils.randomPrivateKey();
const pub = ed25519.getPublicKey(sk);
const pk = { toBase58: () => "W", toBytes: () => pub };

/** a fake useMobileWallet(): signMessages answers with `reply(bytes)`; every call is logged */
function wallet(calls, reply, signed) {
  return {
    account: { publicKey: pk },
    signTransactions: async (tx) => (calls.push(["signTransactions", tx]), signed),
    signMessages: async (bytes) => (calls.push(["signMessages", bytes]), reply(bytes)),
  };
}

test("no account, no signer", () => {
  assert.equal(mwaSigner({ account: undefined }), null);
});

test("signs through signTransactions and signMessages; sends what the wallet signed", async () => {
  const calls = [];
  const signed = { serialize: () => Uint8Array.of(1, 2, 3) };
  const s = mwaSigner(wallet(calls, (bytes) => ed25519.sign(bytes, sk), signed));
  assert.equal(s.publicKey, pk);
  assert.equal(await s.signTransaction("tx1"), signed);
  const msg = Uint8Array.of(7);
  assert.deepEqual(await s.signMessage(msg), ed25519.sign(msg, sk));
  const sent = [];
  const conn = { sendRawTransaction: async (bytes, opts) => (sent.push([bytes, opts]), "SIG") };
  assert.equal(await s.sendTransaction("tx2", conn, { skipPreflight: false }), "SIG");
  assert.deepEqual(sent, [[Uint8Array.of(1, 2, 3), { skipPreflight: false }]]);
  assert.deepEqual(calls.map((c) => c[0]), ["signTransactions", "signMessages", "signTransactions"]);
});

test("signMessage returns the bare 64-byte signature when the wallet appends the message", async () => {
  const msg = new TextEncoder().encode("Mooner: sign in");
  const sig = ed25519.sign(msg, sk);
  const s = mwaSigner(wallet([], (bytes) => Uint8Array.from([...ed25519.sign(bytes, sk), ...bytes])));
  const got = await s.signMessage(msg);
  assert.equal(got.length, 64);
  assert.deepEqual(got, sig);
});

test("signMessage throws when the signature doesn't verify", async () => {
  const msg = Uint8Array.of(1, 2, 3);
  const bad = ed25519.sign(Uint8Array.of(9, 9, 9), sk); // a real signature, over another message
  const s = mwaSigner(wallet([], () => bad));
  await assert.rejects(s.signMessage(msg), { message: "The wallet's signature didn't check out. Try another wallet." });
});
