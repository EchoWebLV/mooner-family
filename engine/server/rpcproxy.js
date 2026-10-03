// POST /api/rpc: Solana JSON-RPC for the web and the phone, over the server's own RPC
// (MOONER_APP_RPC, else MOONER_RPC). Solana's public mainnet RPC answers 403 to any request
// that carries an Origin header, so a browser can't use it; this way the apps share the
// server's RPC and its key stays here. One call per request, only the methods the apps use
// (nothing that scans the chain), a limit per IP and one for everyone together (the keeper
// may share this RPC and its plan), answers up to 1 MiB, and no other site's pages (no CORS).
// The RPC's answer goes back byte for byte: a parse and re-serialize would round u64s such as
// rentEpoch.

import { HttpError, Limiter, limit } from "./http.js";

/** What the web and the phone call over it: web3.js in flows.js (getBack's reads, rent),
 *  tx.js (send, statuses, block height, logs), swap.js (token balance) and the phone's
 *  signer; Privy's Solana calls (blockhash, genesis hash, fee, balance, simulate). */
export const RPC_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getSignatureStatuses",
  "getTokenAccountsByOwner",
  "getTransaction",
  "sendTransaction",
  "simulateTransaction",
]);

export const DEFAULT_RPC_LIMITS = {
  rpcPerIp: [600, 60_000],
  rpcTotal: [1_200, 60_000], // the calls that reach the RPC, from everyone
};
/** An answer the apps get is a few KB; a bigger one is cut off (it would sit in memory). */
export const MAX_ANSWER = 1 << 20;
const NO_ANSWER = "Solana didn't answer; try again";
const BUSY = "Solana is busy; try again in a moment";

/** `url`: the RPC. `timeoutMs` bounds each call, its answer included. */
export function makeRpcRoutes({ url, limits = {}, timeoutMs = 20_000, maxAnswer = MAX_ANSWER, fetch = globalThis.fetch, log = console.log, now = Date.now }) {
  const L = { ...DEFAULT_RPC_LIMITS, ...limits };
  const perIp = new Limiter(...L.rpcPerIp, now);
  const total = new Limiter(...L.rpcTotal, now);
  const redact = redactor(url);
  // the RPC's 429s and the calls over rpcTotal, in the log at most once a minute
  const counts = { busy: 0, full: 0 };
  let noted = -Infinity;
  const note = (kind) => {
    counts[kind]++;
    if (now() - noted < 60_000) return;
    log(`rpc: calls over the limit for everyone: ${counts.full}, "busy" answers from the RPC: ${counts.busy} (since the last note)`);
    counts.busy = counts.full = 0;
    noted = now();
  };
  let first = true;

  async function rpc({ body, ip }) {
    // the per-IP limit is only as good as the IP behind a proxy (MOONER_TRUST_PROXY)
    if (first) {
      first = false;
      log(`rpc: first call, from ${ip}`);
    }
    limit(perIp, ip, "RPC calls");
    if (Array.isArray(body)) throw new HttpError(400, "one call per request (no batches)");
    if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") throw new HttpError(400, "not a JSON-RPC 2.0 call");
    if (!(body.id == null || typeof body.id === "string" || typeof body.id === "number")) throw new HttpError(400, "the id must be a number or a string");
    if (!RPC_METHODS.has(body.method)) throw new HttpError(403, `${body.method} isn't served here`);
    if (!total.take("all")) {
      note("full");
      throw new HttpError(429, BUSY);
    }
    const call = { jsonrpc: "2.0", id: body.id ?? null, method: body.method, ...(body.params !== undefined && { params: body.params }) };
    // the RPC's own words go to the log with its URL and key taken out
    const failed = (why) => Object.assign(new HttpError(502, NO_ANSWER), { cause: new Error(redact(`${body.method}: ${why}`)) });
    let r, answer;
    try {
      r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(call), signal: AbortSignal.timeout(timeoutMs) });
      answer = await readUpTo(r.body, r.status === 200 ? maxAnswer : 300);
    } catch (e) {
      throw failed(e?.name === "TimeoutError" ? `no answer in ${timeoutMs} ms` : `no answer (${e?.cause?.code ?? e?.cause?.message ?? e?.message ?? e})`);
    }
    if (r.status === 429) {
      note("busy");
      throw new HttpError(429, BUSY);
    }
    if (r.status !== 200) throw failed(`the RPC answered ${r.status}: ${answer.text.replace(/\s+/g, " ")}`);
    if (answer.over) throw failed(`the answer is over ${maxAnswer} bytes`);
    try {
      JSON.parse(answer.text);
    } catch {
      throw failed("the RPC's answer isn't JSON");
    }
    return { raw: answer.text };
  }

  return [{ method: "POST", path: /^\/api\/rpc$/, body: 8_192, cors: false, handler: rpc }];
}

/** The body's text up to `max` bytes; `over`: there was more, and it wasn't read. */
async function readUpTo(body, max) {
  const parts = [];
  let size = 0;
  for await (const c of body ?? []) {
    parts.push(c);
    size += c.length;
    if (size > max) return { text: Buffer.concat(parts).subarray(0, max).toString("utf8"), over: true }; // leaving the loop cancels the rest
  }
  return { text: Buffer.concat(parts).toString("utf8"), over: false };
}

/** Takes the RPC's URL out of a text, and each long part of it (a key in its path or query). */
function redactor(url) {
  const u = new URL(url);
  const secrets = [url, u.href, ...u.pathname.split("/"), ...u.searchParams.values(), u.username, u.password].filter((s) => s.length >= 12);
  return (text) => secrets.reduce((t, s) => t.split(s).join("…"), text);
}
