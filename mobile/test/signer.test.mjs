import { test } from "node:test";
import assert from "node:assert/strict";
import { mwaSigner } from "../src/signer.js";

test("no account, no signer", () => {
  assert.equal(mwaSigner({ account: undefined }), null);
});

test("signs through signTransactions and signMessages; sends what the wallet signed", async () => {
  const pk = { toBase58: () => "W" };
  const calls = [];
  const signed = { serialize: () => Uint8Array.of(1, 2, 3) };
  const w = {
    account: { publicKey: pk },
    signTransactions: async (tx) => (calls.push(["signTransactions", tx]), signed),
    signMessages: async (bytes) => (calls.push(["signMessages", bytes]), Uint8Array.of(9)),
  };
  const s = mwaSigner(w);
  assert.equal(s.publicKey, pk);
  assert.equal(await s.signTransaction("tx1"), signed);
  assert.deepEqual(await s.signMessage(Uint8Array.of(7)), Uint8Array.of(9));
  const sent = [];
  const conn = { sendRawTransaction: async (bytes, opts) => (sent.push([bytes, opts]), "SIG") };
  assert.equal(await s.sendTransaction("tx2", conn, { skipPreflight: false }), "SIG");
  assert.deepEqual(sent, [[Uint8Array.of(1, 2, 3), { skipPreflight: false }]]);
  assert.deepEqual(calls.map((c) => c[0]), ["signTransactions", "signMessages", "signTransactions"]);
});
