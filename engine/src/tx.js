// Connections, sending and simulating. Solana txs go out as v0 (optionally with an ALT);
// ER txs go out as legacy, as MagicPad does. Rate limits (429) are retried patiently.

import { Connection, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describeTxError } from "./consts.js";
import { FETCH_MS } from "./market.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `fetch(url, init)` that gives up after `ms` (FETCH_MS: 10 s), for a web3.js Connection's
 *  `fetch`: React Native's fetch on Android never gives up by itself, and web3.js has no
 *  deadline of its own. Resolves with the real Response. In React Native fetch resolves once
 *  it has read the whole body, so the deadline covers the body; in a browser (and in Node)
 *  fetch resolves at the headers, so there it doesn't cover the body. Past the deadline the
 *  request is aborted and this rejects with an Error with `timedOut` set, even if `base`
 *  never ends.
 *  It always rejects with an Error: web3.js calls back only for `err instanceof Error` and
 *  leaves the request hanging otherwise. A timer, not AbortSignal.timeout: RN doesn't have it. */
export function fetchWithin(ms = FETCH_MS, base = (url, init) => globalThis.fetch(url, init)) {
  return async (url, init = {}) => {
    const ac = new AbortController();
    let t;
    const late = new Promise((_, no) => (t = setTimeout(() => (ac.abort(), no(new Error("aborted"))), ms)));
    try {
      return await Promise.race([base(url, { ...init, signal: ac.signal }), late]);
    } catch (e) {
      if (ac.signal.aborted) throw Object.assign(new Error(`${new URL(url).host} didn't answer in ${ms / 1000} s`), { timedOut: true });
      throw e instanceof Error ? e : new Error(e?.message ?? String(e));
    } finally {
      clearTimeout(t);
    }
  };
}

/** The global fetch with a 10 s deadline: the phone's Connections use it. */
export const timedFetch = fetchWithin();

/** Waits out rate limits (429): each try is `base`'s. */
const patient = (base) => async (url, opts) => {
  for (let i = 0; ; i++) {
    const res = await base(url, opts);
    if (res.status !== 429 || i === 30) return res;
    await sleep(400 + 150 * i);
  }
};

/** A Connection that waits out rate limits. `fetch` makes each request: the global fetch by
 *  default (the server's: Node's gives up after 300 s by itself), or timedFetch (the apps'). */
export const connect = (url, { fetch: base = (u, o) => fetch(u, o) } = {}) =>
  new Connection(url, { commitment: "confirmed", fetch: patient(base), disableRetryOnRateLimit: true });

/** A signed tx. `alts`: AddressLookupTableAccount[] (v0 only). */
export async function build(conn, { ixs, payer, signers = [], alts = [], legacy = false, blockhash }) {
  const bh = blockhash ?? (await conn.getLatestBlockhash("confirmed")).blockhash;
  return sign({ ixs, payer, signers, alts, legacy, blockhash: bh });
}

function sign({ ixs, payer, signers, alts, legacy, blockhash: bh }) {
  const all = [payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey))];
  if (legacy) {
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: bh }).add(...ixs);
    tx.sign(...all);
    return tx;
  }
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: bh, instructions: ixs })
    .compileToV0Message(alts);
  const tx = new VersionedTransaction(msg);
  tx.sign(all);
  return tx;
}

export const wireSize = (tx) => tx.serialize().length;

/** A send's result: `sig`, `logs`, `what` (which send it was: "trade", "launch", …) and
 *  `reason` (the message without "what (sig): " in front). */
export class TxError extends Error {
  constructor(sig, err, logs, what) {
    super(`${what}${sig ? ` (${sig})` : ""}: ${err}`);
    this.sig = sig;
    this.logs = logs ?? [];
    this.what = what;
    this.reason = err;
  }
}

/** What a send says when it can't tell whether the tx landed: it may have, so the app must
 *  not offer to send it again as if it hadn't. */
export const OUTCOME_UNKNOWN = "We couldn't tell if it went through. Check your wallet before you try again.";

/** The send's outcome isn't known: a TxError (so callers sort it with the other send
 *  results) with `outcomeUnknown` set and OUTCOME_UNKNOWN as its message. `sig` and `what`
 *  stay on it for logs. */
export function outcomeUnknown(sig, what = "tx") {
  const e = new TxError(sig, "outcome unknown", [], what);
  e.message = OUTCOME_UNKNOWN;
  e.outcomeUnknown = true;
  return e;
}

/** `p`, or an Error with `timedOut` once `ms` pass (the call itself is left to end). */
function within(p, ms) {
  let t;
  const late = new Promise((_, no) => (t = setTimeout(() => no(Object.assign(new Error(`the RPC didn't answer in ${ms / 1000} s`), { timedOut: true })), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

/** Whether the RPC answered a send by refusing it, so nothing went out: a JSON-RPC error
 *  (web3.js SendTransactionError: a failed preflight, a bad signature) or an HTTP 4xx
 *  (web3.js's "<status> <text>: <body>"). No answer, a network error or a 5xx isn't one. */
const refusedSend = (e) => typeof e?.transactionMessage === "string" || /^4\d\d /.test(e?.message ?? "");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** The tx's id (its first signature) in base58, or null when it isn't signed. */
export function sigOf(tx) {
  const s = tx.signatures?.[0];
  const bytes = s && "signature" in s ? s.signature : s; // legacy: { publicKey, signature }; v0: the bytes
  if (!bytes?.some((b) => b !== 0)) return null;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  for (let i = 0; bytes[i] === 0; i++) out = "1" + out;
  return out;
}

/** Sends a signed tx and waits for "confirmed". The raw tx is re-sent while pending
 *  (Solana drops txs under load), never signed again. Throws TxError, with our error names,
 *  if it failed. With `lastValidBlockHeight` it gives up only once the blockhash has
 *  expired, so a tx it calls dead can't land later; otherwise after `timeoutMs`. Each RPC
 *  call gets `callMs`. `stuckMs` (300 s; swap.js's trades pass 120 s) bounds the whole wait.
 *
 *  Once the first send went out, or may have (it timed out, or failed without the RPC
 *  refusing it), a call that times out or fails says nothing about the tx: it's transient,
 *  and the loop goes on. What the loop can observe decides how it ends:
 *  - known absent: getEpochInfo("confirmed") answered a block height above
 *    `lastValidBlockHeight` (the blockhash can't land anything any more) and the slot it
 *    was read at; then a history search for the signature, answered at that slot or later,
 *    had no status. TxError "expired": a retry can't make it twice. A history search that
 *    fails, or comes from a node behind that slot (it may not have seen the tx yet), is
 *    asked again at the next resend.
 *  - unknown: no such pair of answers within `stuckMs`. The tx may have landed: an error
 *    with `outcomeUnknown`, `sig`, `what` and OUTCOME_UNKNOWN (the keeper re-reads the
 *    chain before it acts again).
 *  - definite as well: a status "confirmed" or "finalized" (its error, if any, is thrown),
 *    and a first send the RPC refused (refusedSend: thrown as it is; nothing went out).
 *  Without `lastValidBlockHeight` (ER txs, which cost nothing; the server's cosign) it
 *  ends with "not confirmed in time" after `timeoutMs`, as before. */
export async function sendSigned(conn, tx, { ixs, pid, what = "tx", timeoutMs = 60_000, resendMs = 2_000, stuckMs = 300_000, callMs = FETCH_MS, lastValidBlockHeight, preflight = false } = {}) {
  const raw = tx.serialize();
  const ask = (p) => within(p, callMs);
  // `preflight`: a send is simulated first, so a tx that would fail costs nothing. Until a
  // send has returned the signature, each resend is simulated too (the first may never have
  // reached the RPC). After that the tx is in, and a simulation could refuse it for having
  // run already; a resend's refusal is ignored either way.
  let answered = false;
  const sendOpts = () => (preflight && !answered ? { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" } : { skipPreflight: true, maxRetries: 0 });
  let sig;
  try {
    sig = await ask(conn.sendRawTransaction(raw, sendOpts()));
    answered = true;
  } catch (e) {
    sig = refusedSend(e) ? null : sigOf(tx); // not refused: it may be out, under its own signature
    if (!sig) throw e;
  }
  const t0 = Date.now();
  let lastSend = t0;
  const done = async (st) => {
    if (st.err) {
      const logs = await txLogs(conn, sig, callMs);
      throw new TxError(sig, describeTxError(st.err, ixs?.map((i) => i.programId), pid, logs), logs, what);
    }
    return sig;
  };
  const landed = (st) => st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized";
  for (;;) {
    const st = await ask(conn.getSignatureStatuses([sig])).then((r) => r.value[0]).catch(() => undefined);
    if (landed(st)) return done(st);
    if (Date.now() - lastSend > resendMs) {
      lastSend = Date.now();
      // the "confirmed" block height, and the slot it was read at
      const epoch = lastValidBlockHeight == null ? null : await ask(conn.getEpochInfo("confirmed")).catch(() => null);
      if (epoch?.blockHeight != null && epoch.blockHeight > lastValidBlockHeight) {
        // one last look: it may have landed in the last block before expiry
        const last = await ask(conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).catch(() => null);
        // no status counts only from a node that has seen that slot: one behind may not have the tx yet
        if (last?.value && !last.value[0] && last.context?.slot >= epoch.absoluteSlot) throw new TxError(sig, "expired: the blockhash ran out and the tx never landed", [], what);
        if (landed(last?.value?.[0])) return done(last.value[0]);
        // no answer, a node behind, or a status short of "confirmed": look again next time (stuckMs bounds it)
      } else {
        // a resend's refusal ("already processed", a failed simulation) says nothing either way
        await ask(conn.sendRawTransaction(raw, sendOpts())).then(() => (answered = true), () => {});
      }
    }
    if (lastValidBlockHeight == null && Date.now() - t0 > timeoutMs) throw new TxError(sig, "not confirmed in time", [], what);
    if (Date.now() - t0 > stuckMs) throw outcomeUnknown(sig, what);
    await sleep(conn.rpcEndpoint.includes("magicblock") ? 100 : 400);
  }
}

/** A landed tx's logs ([] if the RPC doesn't have them after a few tries, each within `ms`). */
export async function txLogs(conn, sig, ms = FETCH_MS) {
  for (let i = 0; i < 5; i++) {
    const t = await within(conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }), ms).catch(() => null);
    if (t) return t.meta?.logMessages ?? [];
    await sleep(500);
  }
  return [];
}

/** Build, sign, send, confirm. Solana txs wait out their blockhash (see sendSigned);
 *  ER txs (`legacy`) use the wall-clock timeout. */
export async function send(conn, opts) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = sign({ signers: [], alts: [], legacy: false, ...opts, blockhash });
  return sendSigned(conn, tx, { ...opts, lastValidBlockHeight: opts.legacy ? undefined : lastValidBlockHeight });
}

/** Simulates without signatures. `accounts`: PublicKeys whose post-state to return
 *  (base64). Returns { err, errText, logs, units, accounts }. */
export async function simulate(conn, { ixs, payer, alts = [], accounts = [], pid }) {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs })
    .compileToV0Message(alts);
  const tx = new VersionedTransaction(msg);
  const res = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: accounts.length ? { encoding: "base64", addresses: accounts.map((a) => a.toBase58()) } : undefined,
  });
  const v = res.value;
  return {
    err: v.err,
    errText: v.err ? describeTxError(v.err, ixs.map((i) => i.programId), pid, v.logs) : null,
    logs: v.logs ?? [],
    units: v.unitsConsumed ?? 0,
    accounts: (v.accounts ?? []).map((a) => (a ? { ...a, data: Buffer.from(a.data[0], "base64") } : null)),
  };
}
