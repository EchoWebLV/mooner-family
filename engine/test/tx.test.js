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
// the slot the fake RPC's "confirmed" block height is read at
const SLOT = 5_000;
/** getSignatureStatuses' answer, as read at `slot`. */
const statusesAt = (slot, ...value) => Promise.resolve({ context: { slot }, value });
const statuses = (...value) => statusesAt(SLOT, ...value);
const LANDED = { confirmationStatus: "confirmed", err: null };

/** A fake RPC. The first send answers `first()`, the nth after it `later(n)`. `status`, `history`
 *  (the look with searchTransactionHistory), `height` (the block height getEpochInfo gives,
 *  at slot SLOT) and `logs` answer each call. `calls` lists what was asked. */
function rpc({ first = async () => "SIG", later = async () => "SIG", status = () => statuses(null), history = status, height = async () => 2_000, logs = async () => null } = {}) {
  const calls = [];
  let sends = 0;
  return {
    calls,
    rpcEndpoint: "https://rpc.test",
    sendRawTransaction: (raw, o) => {
      calls.push(["send", o]);
      const n = sends++;
      return n === 0 ? first() : later(n);
    },
    getSignatureStatuses: ([sig], o) => (calls.push([o?.searchTransactionHistory ? "history" : "status", sig]), o?.searchTransactionHistory ? history() : status()),
    getEpochInfo: (c) => (calls.push(["height", c]), height().then((blockHeight) => ({ epoch: 1, slotIndex: 0, slotsInEpoch: 432_000, absoluteSlot: SLOT, blockHeight }))),
    getTransaction: () => (calls.push(["logs"]), logs()),
  };
}
const unsigned = { serialize: () => Buffer.alloc(1) };
// the blockhash ran out at height 1,000; each call gets 20 ms
const opts = { lastValidBlockHeight: 1_000, resendMs: 0, callMs: 20 };
// and an RPC that tells nothing is given up on after 900 ms (polls are 400 ms apart)
const stuck = { ...opts, stuckMs: 900 };
const asked = (conn, what) => conn.calls.filter(([c]) => c === what);

function signedV0() {
  const kp = Keypair.generate();
  const ix = SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 });
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: BH, instructions: [ix] }).compileToV0Message());
  tx.sign([kp]);
  return tx;
}

// ---- sendSigned: what it can tell, and what it can't ----

test("sendSigned: the tx went out and then nothing answers: outcome unknown at stuckMs, history asked again meanwhile", async () => {
  const conn = rpc({ status: never, history: never });
  const t0 = Date.now();
  const e = await sendSigned(conn, unsigned, stuck).catch((x) => x);
  assert.equal(e.message, "We couldn't tell if it went through. Check your wallet before you try again.");
  assert.equal(e.message, OUTCOME_UNKNOWN);
  assert.equal(e.outcomeUnknown, true);
  assert.equal(e.sig, "SIG");
  assert.ok(e instanceof TxError, "a send result like the others: the server's cosign sorts it with them");
  assert.ok(Date.now() - t0 >= stuck.stuckMs, "not before stuckMs");
  assert.ok(asked(conn, "history").length > 1, "a history read that doesn't answer is asked again: no answer is not an answer");
});

test("sendSigned: a history read from a node behind the block height's slot doesn't make it expired", async () => {
  // behind each time: it can't tell
  const behind = rpc({ status: never, history: () => statusesAt(SLOT - 1, null) });
  const e1 = await sendSigned(behind, unsigned, stuck).catch((x) => x);
  assert.equal(e1.outcomeUnknown, true);
  assert.ok(asked(behind, "history").length > 1);
  assert.deepEqual(asked(behind, "height")[0], ["height", "confirmed"], "the height is the confirmed one");
  // behind once, then caught up: expired
  let n = 0;
  const later = rpc({ status: never, history: () => statusesAt(n++ === 0 ? SLOT - 1 : SLOT, null) });
  const e2 = await sendSigned(later, unsigned, opts).catch((x) => x);
  assert.match(e2.message, /expired: the blockhash ran out and the tx never landed/);
  assert.equal(asked(later, "history").length, 2);
  // one that landed counts whatever slot it was read at
  const landedBehind = rpc({ status: never, history: () => statusesAt(SLOT - 1, LANDED) });
  assert.equal(await sendSigned(landedBehind, unsigned, opts), "SIG");
});

test("sendSigned: one history read that fails, then one with no status: expired", async () => {
  let n = 0;
  const conn = rpc({ status: never, history: () => (n++ === 0 ? timeout() : statuses(null)) });
  const e = await sendSigned(conn, unsigned, opts).catch((x) => x);
  assert.match(e.message, /expired: the blockhash ran out and the tx never landed/);
  assert.equal(e.outcomeUnknown, undefined);
  assert.equal(asked(conn, "history").length, 2);
});

test("sendSigned: the tx went out and then every call times out: outcome unknown, not expired", async () => {
  const conn = rpc({ status: timeout, history: timeout });
  const e = await sendSigned(conn, unsigned, stuck).catch((x) => x);
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
  // the first send had the preflight, and so does the resend: no send had answered yet
  assert.deepEqual(asked(conn, "send").map(([, o]) => o.skipPreflight).slice(0, 2), [false, false]);

  // a legacy tx (the ER's) the same way; and a network error is no answer either
  const kp = Keypair.generate();
  const legacy = new Transaction({ feePayer: kp.publicKey, recentBlockhash: BH }).add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
  legacy.sign(kp);
  const lost = rpc({ first: () => Promise.reject(new TypeError("Network request failed")), status: never, history: never });
  const e = await sendSigned(lost, legacy, stuck).catch((x) => x);
  assert.equal(e.outcomeUnknown, true);
  assert.equal(e.sig, bs58.encode(legacy.signature));
});

test("sendSigned: with a preflight, resends keep it until a send returns a signature, then skip it; a resend's refusal is swallowed", async () => {
  const tx = signedV0();
  const PRE = { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" };
  // a preflight of a tx that's in already: the RPC refuses it, which says nothing either way
  const already = new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "Transaction simulation failed: This transaction has already been processed", logs: [] });
  // the first send times out; resends: a refusal, a timeout, then a signature
  const answers = [null, () => Promise.reject(already), timeout, async () => "SIG"];
  let polls = 0;
  const conn = rpc({ first: never, later: (n) => (answers[n] ?? (async () => "SIG"))(), status: () => statuses(polls++ < 6 ? null : LANDED), height: async () => 10 });
  assert.equal(await sendSigned(conn, tx, { ...opts, preflight: true }), bs58.encode(tx.signatures[0]));
  const sent = asked(conn, "send").map(([, o]) => o);
  assert.ok(sent.length >= 5, `${sent.length} sends`);
  assert.deepEqual(sent.slice(0, 4), [PRE, PRE, PRE, PRE], "the first send and every resend until one answered");
  assert.deepEqual(new Set(sent.slice(4).map((o) => JSON.stringify(o))), new Set([JSON.stringify({ skipPreflight: true, maxRetries: 0 })]), "after that the preflight is skipped");
  // without a preflight nothing changes: every send skips it
  const plain = rpc({ first: never, status: () => statuses(polls++ < 9 ? null : LANDED), height: async () => 10 });
  await sendSigned(plain, tx, opts);
  assert.ok(asked(plain, "send").every(([, o]) => o.skipPreflight === true && !("preflightCommitment" in o)));
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
  const e = await sendSigned(rpc({ status: never, history: never }), unsigned, { ...stuck, what: "trade" }).catch((x) => x);
  assert.equal(e.what, "trade", "which send it was stays on the error, for logs");
  assert.equal(e.sig, "SIG");
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
