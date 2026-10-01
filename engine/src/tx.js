// Connections, sending and simulating. Solana txs go out as v0 (optionally with an ALT);
// ER txs go out as legacy, as MagicPad does. Rate limits (429) are retried patiently.

import { Connection, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describeTxError } from "./consts.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function patientFetch(url, opts) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 || i === 30) return res;
    await sleep(400 + 150 * i);
  }
}

export const connect = (url) =>
  new Connection(url, { commitment: "confirmed", fetch: patientFetch, disableRetryOnRateLimit: true });

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

export class TxError extends Error {
  constructor(sig, err, logs, what) {
    super(`${what}${sig ? ` (${sig})` : ""}: ${err}`);
    this.sig = sig;
    this.logs = logs ?? [];
  }
}

/** Sends a signed tx and waits for "confirmed". The raw tx is re-sent while pending
 *  (Solana drops txs under load). Throws TxError, with our error names, if it failed.
 *  With `lastValidBlockHeight` it gives up only once the blockhash has expired, so a tx
 *  it calls dead can't land later; otherwise after `timeoutMs`. `stuckMs` bounds the
 *  wait for an RPC whose block height stops moving; that error says the outcome is
 *  unknown (the keeper re-reads the chain before it acts again). */
export async function sendSigned(conn, tx, { ixs, pid, what = "tx", timeoutMs = 60_000, resendMs = 2_000, stuckMs = 300_000, lastValidBlockHeight, preflight = false } = {}) {
  const raw = tx.serialize();
  // `preflight`: the first send is simulated first, so a tx that would fail costs nothing
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: !preflight, maxRetries: 0, ...(preflight && { preflightCommitment: "confirmed" }) });
  const t0 = Date.now();
  let lastSend = t0;
  const done = async (st) => {
    if (st.err) {
      const logs = await txLogs(conn, sig);
      throw new TxError(sig, describeTxError(st.err, ixs?.map((i) => i.programId), pid, logs), logs, what);
    }
    return sig;
  };
  const landed = (st) => st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized";
  for (;;) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (landed(st)) return done(st);
    if (Date.now() - lastSend > resendMs) {
      lastSend = Date.now();
      if (lastValidBlockHeight != null && (await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) {
        // one last look: it may have landed in the last block before expiry
        const last = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
        if (!last) throw new TxError(sig, "expired: the blockhash ran out and the tx never landed", [], what);
        if (landed(last)) return done(last);
        continue;
      }
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
    if (lastValidBlockHeight == null && Date.now() - t0 > timeoutMs) throw new TxError(sig, "not confirmed in time", [], what);
    if (Date.now() - t0 > stuckMs) throw new TxError(sig, "outcome unknown: the RPC's block height stopped moving", [], what);
    await sleep(conn.rpcEndpoint.includes("magicblock") ? 100 : 400);
  }
}

/** A landed tx's logs ([] if the RPC doesn't have it after a few tries). */
export async function txLogs(conn, sig) {
  for (let i = 0; i < 5; i++) {
    const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
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
