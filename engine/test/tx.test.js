// When the RPC stops answering: sendSigned (engine/src/tx.js) after the tx went out, or may
// have, and the fetch with a deadline that the phone's Connections use (timedFetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import {
  Connection, Keypair, PublicKey, SendTransactionError, SystemProgram, Transaction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { explain, joinCost, makeFlows } from "../src/flows.js";
import { FETCH_MS } from "../src/market.js";
import { explainSwap, PREFLIGHT_TEXT } from "../src/swap.js";
import { connect, fetchWithin, OUTCOME_UNKNOWN, sendSigned, timedFetch, TxError } from "../src/tx.js";

const BH = "11111111111111111111111111111111";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => setImmediate(r));
const never = () => new Promise(() => {});
const timeout = () => Promise.reject(Object.assign(new Error("rpc.test didn't answer in 10 s"), { timedOut: true }));
const statuses = (...value) => Promise.resolve({ value });
const LANDED = { confirmationStatus: "confirmed", err: null };

/** A fake RPC. The first send answers `first()`; later sends answer. `status`, `history`
 *  (the look with searchTransactionHistory), `height` and `logs` answer each call. `calls`
 *  lists what was asked. */
function rpc({ first = async () => "SIG", status = () => statuses(null), history = status, height = async () => 2_000, logs = async () => null } = {}) {
  const calls = [];
  let sends = 0;
  return {
    calls,
    rpcEndpoint: "https://rpc.test",
    sendRawTransaction: (raw, o) => (calls.push(["send", o]), sends++ === 0 ? first() : Promise.resolve("SIG")),
    getSignatureStatuses: ([sig], o) => (calls.push([o?.searchTransactionHistory ? "history" : "status", sig]), o?.searchTransactionHistory ? history() : status()),
    getBlockHeight: () => (calls.push(["height"]), height()),
    getTransaction: () => (calls.push(["logs"]), logs()),
  };
}
const unsigned = { serialize: () => Buffer.alloc(1) };
// the blockhash ran out at height 1,000; each call gets 20 ms
const opts = { lastValidBlockHeight: 1_000, resendMs: 0, callMs: 20 };
const asked = (conn, what) => conn.calls.filter(([c]) => c === what);

function signedV0() {
  const kp = Keypair.generate();
  const ix = SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 });
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: BH, instructions: [ix] }).compileToV0Message());
  tx.sign([kp]);
  return tx;
}

// ---- sendSigned: what it can tell, and what it can't ----

test("sendSigned: the tx went out and then nothing answers: outcome unknown once the blockhash runs out", async () => {
  const conn = rpc({ status: never, history: never });
  const e = await sendSigned(conn, unsigned, opts).catch((x) => x);
  assert.equal(e.message, "We couldn't tell if it went through. Check your wallet before you try again.");
  assert.equal(e.message, OUTCOME_UNKNOWN);
  assert.equal(e.outcomeUnknown, true);
  assert.equal(e.sig, "SIG");
  assert.ok(e instanceof TxError, "a send result like the others: the server's cosign sorts it with them");
  assert.equal(asked(conn, "history").length, 1, "it asked history once the blockhash ran out; no answer is not an answer");
});

test("sendSigned: the tx went out and then every call times out: outcome unknown, not expired", async () => {
  const conn = rpc({ status: timeout, history: timeout });
  const e = await sendSigned(conn, unsigned, opts).catch((x) => x);
  assert.equal(e.outcomeUnknown, true);
  assert.equal(e.sig, "SIG");
  assert.equal(e.message, OUTCOME_UNKNOWN);
});

test("sendSigned: not even the block height answers: outcome unknown at stuckMs", async () => {
  for (const off of [never, timeout]) {
    const conn = rpc({ status: off, history: off, height: off });
    const e = await sendSigned(conn, unsigned, { ...opts, stuckMs: 150 }).catch((x) => x);
    assert.equal(e.outcomeUnknown, true);
    assert.equal(asked(conn, "history").length, 0, "the blockhash was never seen to run out");
    assert.ok(asked(conn, "send").length > 1, "it kept sending meanwhile");
  }
});

test("sendSigned: a tx that landed is found after calls that timed out", async () => {
  let n = 0;
  const conn = rpc({ status: () => (n++ < 3 ? timeout() : statuses(LANDED)), height: () => (n < 2 ? timeout() : Promise.resolve(10)) });
  assert.equal(await sendSigned(conn, unsigned, opts), "SIG");
  // the polls never answer, but history does once the blockhash ran out: it landed at the end
  const late = rpc({ status: never, history: () => statuses({ confirmationStatus: "finalized", err: null }) });
  assert.equal(await sendSigned(late, unsigned, opts), "SIG");
});

test("sendSigned: the first send goes unanswered: it may have gone out, so its signature is polled", async () => {
  const tx = signedV0();
  const id = bs58.encode(tx.signatures[0]);
  let polls = 0;
  const conn = rpc({ first: never, status: () => statuses(polls++ < 2 ? null : LANDED), height: async () => 10 });
  assert.equal(await sendSigned(conn, tx, { ...opts, preflight: true }), id);
  assert.deepEqual(asked(conn, "status").map(([, s]) => s), [id, id, id]);
  // the first send had the preflight; a resend can't (the first one may be in already)
  assert.deepEqual(asked(conn, "send").map(([, o]) => o.skipPreflight), [false, true]);

  // a legacy tx (the ER's) the same way; and a network error is no answer either
  const kp = Keypair.generate();
  const legacy = new Transaction({ feePayer: kp.publicKey, recentBlockhash: BH }).add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
  legacy.sign(kp);
  const lost = rpc({ first: () => Promise.reject(new TypeError("Network request failed")), status: never, history: never });
  const e = await sendSigned(lost, legacy, opts).catch((x) => x);
  assert.equal(e.outcomeUnknown, true);
  assert.equal(e.sig, bs58.encode(legacy.signature));
});

test("sendSigned: what is known still ends it as before", async () => {
  // a preflight the RPC refused: nothing went out, nothing is polled
  const refusal = new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1", logs: [] });
  const refused = rpc({ first: () => Promise.reject(refusal) });
  const e1 = await sendSigned(refused, signedV0(), { ...opts, preflight: true }).catch((x) => x);
  assert.equal(e1, refusal);
  assert.equal(e1.outcomeUnknown, undefined);
  assert.equal(explainSwap(e1), PREFLIGHT_TEXT);
  assert.deepEqual(refused.calls.map(([c]) => c), ["send"]);
  // an HTTP 4xx is a refusal too (web3.js's words for it)
  const limited = rpc({ first: () => Promise.reject(new Error('429 Too Many Requests: {"error":"rate limited"}')) });
  await assert.rejects(sendSigned(limited, signedV0(), opts), /^Error: 429 Too Many Requests/);
  assert.deepEqual(limited.calls.map(([c]) => c), ["send"]);

  // known absent: the blockhash ran out and history answered "no such tx", after polls that timed out
  const gone = rpc({ status: timeout, history: () => statuses(null) });
  const e2 = await sendSigned(gone, unsigned, opts).catch((x) => x);
  assert.match(e2.message, /expired: the blockhash ran out and the tx never landed/);
  assert.equal(e2.outcomeUnknown, undefined);

  // a confirmed error, after a poll that timed out; logs that never come don't hold it up
  let n = 0;
  const failed = rpc({ status: () => (n++ ? statuses({ confirmationStatus: "confirmed", err: { InstructionError: [0, { Custom: 1 }] } }) : timeout()), height: async () => 10, logs: never });
  const e3 = await sendSigned(failed, unsigned, { ...opts, what: "trade" }).catch((x) => x);
  assert.ok(e3 instanceof TxError);
  assert.match(e3.message, /^trade \(SIG\): ix 0/);
  assert.equal(e3.outcomeUnknown, undefined);
  assert.deepEqual(e3.logs, []);
});

test("explain and explainSwap pass the outcome-unknown text through unchanged", async () => {
  const e = await sendSigned(rpc({ status: never, history: never }), unsigned, { ...opts, what: "trade" }).catch((x) => x);
  assert.equal(explain(e), OUTCOME_UNKNOWN);
  assert.equal(explainSwap(e), OUTCOME_UNKNOWN);
  // the text alone is kept as well, whatever else the error carries
  const odd = Object.assign(new Error(OUTCOME_UNKNOWN), { outcomeUnknown: true, transactionMessage: "x", logs: ["Program log: Blockhash not found"] });
  assert.equal(explainSwap(odd), OUTCOME_UNKNOWN);
});

// ---- a fetch with a deadline ----

test("fetchWithin: past the deadline the request is aborted and it rejects with an Error", async () => {
  let signal = null;
  const hangs = (url, init) => ((signal = init.signal), never()); // and it doesn't stop on abort either
  const t0 = Date.now();
  const e = await fetchWithin(30, hangs)("https://rpc.test/", { method: "POST", body: "{}" }).catch((x) => x);
  assert.ok(e instanceof Error, "web3.js answers only an Error; anything else would hang the request");
  assert.equal(e.timedOut, true);
  assert.equal(e.message, "rpc.test didn't answer in 0.03 s");
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - t0 < 1_000);
  // a fetch that rejects on abort with something that isn't an Error
  const odd = (url, init) => new Promise((_, no) => init.signal.addEventListener("abort", () => no("aborted")));
  const e2 = await fetchWithin(30, odd)("https://rpc.test/", {}).catch((x) => x);
  assert.ok(e2 instanceof Error);
  assert.equal(e2.timedOut, true);
  // a failure before the deadline that isn't an Error becomes one
  const e3 = await fetchWithin(30, () => Promise.reject({ message: "Network request failed" }))("https://rpc.test/", {}).catch((x) => x);
  assert.ok(e3 instanceof Error);
  assert.equal(e3.message, "Network request failed");
  const failure = new TypeError("fetch failed");
  assert.equal(await fetchWithin(30, () => Promise.reject(failure))("https://rpc.test/", {}).catch((x) => x), failure, "an Error is passed on as it is");
});

test("fetchWithin: the real Response comes back, and the timer is cleared", async () => {
  const res = new Response('{"jsonrpc":"2.0","result":1,"id":"1"}', { status: 200 });
  let got = null;
  const ok = async (url, init) => ((got = { url, init }), res);
  const init = { method: "POST", body: "{}", headers: { "content-type": "application/json" } };
  assert.equal(await fetchWithin(30, ok)("https://rpc.test/", init), res);
  assert.equal(got.url, "https://rpc.test/");
  assert.deepEqual({ ...got.init, signal: undefined }, { ...init, signal: undefined });
  await sleep(60);
  assert.equal(got.init.signal.aborted, false, "no abort after the answer: the timer was cleared");
});

test("timedFetch: the global fetch with a 10 s deadline", async (t) => {
  assert.equal(FETCH_MS, 10_000);
  const res = new Response("{}");
  let signal = null;
  t.mock.method(globalThis, "fetch", async (url, init) => ((signal = init.signal), res));
  assert.equal(await timedFetch("https://rpc.test/", {}), res);
  assert.equal(signal.aborted, false);
});

test("a web3.js Connection over fetchWithin ends a request that never answers", async () => {
  const conn = new Connection("https://rpc.test", { commitment: "confirmed", fetch: fetchWithin(30, never) });
  await assert.rejects(conn.getSlot(), /rpc\.test didn't answer in 0\.03 s/);
});

test("connect: waits out a 429 over the fetch it's given, which has the deadline", async () => {
  let calls = 0;
  const base = async (url, init) => {
    calls++;
    const { id } = JSON.parse(init.body);
    return calls === 1 ? new Response("slow down", { status: 429 }) : new Response(JSON.stringify({ jsonrpc: "2.0", result: 42, id }));
  };
  assert.equal(await connect("https://rpc.test", { fetch: base }).getSlot(), 42);
  assert.equal(calls, 2);
  await assert.rejects(connect("https://rpc.test", { fetch: fetchWithin(30, never) }).getSlot(), /didn't answer/);
});

// ---- the phone's own Connections inside flows.js ----

test("flows: the ERs' Connections and Solana's (rents, getBack) give up after 10 s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  t.mock.method(globalThis, "fetch", (url, init) => (signals.push(init.signal), never()));
  const raw = { program: Keypair.generate().publicKey.toBase58(), gate: Keypair.generate().publicKey.toBase58(), cluster: "mainnet", numbers: {}, ers: [{ validator: PublicKey.default.toBase58(), url: "https://er.test" }] };
  const f = makeFlows({ api: { info: async () => raw }, subscribe: () => () => {}, keys: { get: async () => null, set: async () => {} } });
  const er = (await f.loadInfo()).ers[0].conn;
  const slot = er.getSlot().then(() => "answered", (e) => e);
  const rent = joinCost({ rpc: "https://rent-deadline.test" }).then(() => "answered", (e) => e);
  for (let i = 0; i < 20; i++) await tick();
  assert.ok(signals.length >= 2, "both asked");
  t.mock.timers.tick(FETCH_MS);
  const e = await slot;
  assert.equal(e.timedOut, true, "the ER's request was given up");
  await rent;
  assert.ok(signals.every((s) => s.aborted), "every request was aborted, not just left");
});
