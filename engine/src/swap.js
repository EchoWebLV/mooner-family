// Buying and selling a launched coin through Jupiter's swap API (swap v1): a quote, the
// swap tx Jupiter builds for it, a check that the wallet is the only signer, the wallet's
// signature, then send and confirm. Jupiter routes the coin's Meteora pool (DBC before
// migration, DAMM v2 after). The web app and the phone app both trade through this file;
// `fetch` is handed in so tests use fakes. No node: imports (Buffer is global: Node, or
// the app's polyfill).

import { VersionedTransaction } from "@solana/web3.js";
import { describeTxError, failedWith } from "./consts.js";
import { explain } from "./flows.js";
import { sendSigned, TxError, txLogs } from "./tx.js";
import { walletSigned } from "./walletcheck.js";

export const JUP = "https://lite-api.jup.ag/swap/v1";
/** Jupiter's aggregator program (v6), the program in every swap tx it builds. */
export const JUP_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
/** Its SlippageToleranceExceeded (the program's IDL, error 6001). */
export const JUP_SLIPPAGE = 6001;
export const WSOL = "So11111111111111111111111111111111111111112";
/** 3%: a trade gets at least 97% of what it was quoted, or it fails. */
export const SLIPPAGE_BPS = 300;
/** The words the website shows when Jupiter has no route (yet) for a coin. */
export const NO_ROUTE = "no route for this trade yet";
export const RAW_PER_TOKEN = 1_000_000n; // Mooner coins have 6 decimals
export const LAMPORTS_PER_SOL = 1_000_000_000n;

const noRoute = () => Object.assign(new Error(NO_ROUTE), { noRoute: true });

async function readJson(r) {
  return r.json().catch(() => null);
}

/** A Jupiter quote for `amount` (BigInt, the input's smallest units). Returns { inAmount,
 *  outAmount, minOut (BigInt), impact (a fraction, Jupiter's own), route: [{ amm, label }],
 *  raw } or throws: an error with `noRoute` when Jupiter has no route for this coin. */
export async function quote({ input, output, amount, slippageBps = SLIPPAGE_BPS, fetch = globalThis.fetch }) {
  const r = await fetch(`${JUP}/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=${slippageBps}`);
  const j = await readJson(r);
  // a mint Jupiter doesn't know (yet) is TOKEN_NOT_TRADABLE, a pool it can't use NO_ROUTES_FOUND (both 400)
  if (!r.ok) throw /NOT_TRADABLE|ROUTE/.test(j?.errorCode ?? "") ? noRoute() : new Error(j?.error ?? `Jupiter said ${r.status}`);
  if (!j?.outAmount || j.outAmount === "0") throw noRoute();
  return {
    inAmount: BigInt(j.inAmount),
    outAmount: BigInt(j.outAmount),
    minOut: BigInt(j.otherAmountThreshold),
    impact: Number(j.priceImpactPct) || 0,
    route: (j.routePlan ?? []).map((h) => ({ amm: h.swapInfo?.ammKey, label: h.swapInfo?.label })),
    raw: j,
  };
}

/** A buy of `lamports` (BigInt) of SOL, or a sell of `raw` (BigInt) of the coin. */
export const buyQuote = (mint, lamports, opts = {}) => quote({ input: WSOL, output: mint, amount: lamports, ...opts });
export const sellQuote = (mint, raw, opts = {}) => quote({ input: mint, output: WSOL, amount: raw, ...opts });

/** The swap tx Jupiter builds for quote `q`, for `wallet` (PublicKey). With `priority`
 *  (micro-lamports per CU) the tx pays exactly that; without, Jupiter picks ("auto").
 *  Returns { tx (VersionedTransaction), lastValidBlockHeight, simulationError (text or
 *  null: Jupiter ran it and it failed), units, priorityLamports }. */
export async function buildSwap({ quote: q, wallet, priority = null, fetch = globalThis.fetch }) {
  const body = {
    quoteResponse: q.raw,
    userPublicKey: wallet.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    ...(priority ? { computeUnitPriceMicroLamports: priority } : { prioritizationFeeLamports: "auto" }),
  };
  const r = await fetch(`${JUP}/swap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await readJson(r);
  if (!r.ok || !j?.swapTransaction) throw new Error(j?.error ?? `Jupiter said ${r.status}`);
  return {
    tx: VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64")),
    lastValidBlockHeight: j.lastValidBlockHeight,
    simulationError: j.simulationError ? j.simulationError.error ?? JSON.stringify(j.simulationError) : null,
    units: j.computeUnitLimit,
    priorityLamports: j.prioritizationFeeLamports,
  };
}

/** Whether `wallet` is the one and only signer of `tx` (and so pays its fee). */
export function onlyWalletSigns(tx, wallet) {
  const m = tx.message;
  return m.header.numRequiredSignatures === 1 && m.staticAccountKeys[0].equals(wallet);
}

/**
 * Builds the swap for quote `q`, checks it and has the wallet sign it. Returns the signature
 * once it's confirmed. Two ways to sign:
 *   signTransaction(tx) -> signed tx (the phone: Seed Vault signs only): the signed tx is
 *     checked again (still only the wallet signs, its signature covers the tx) and sent
 *     here, with a preflight, until it lands or its blockhash runs out;
 *   sendTransaction(tx, conn) -> signature (the website's wallet adapter signs and sends).
 * `onStep(text)` names what it waits for.
 */
export async function swap({ quote: q, wallet, conn, signTransaction = null, sendTransaction = null, priority = null, fetch = globalThis.fetch, onStep = (_step) => {} }) {
  onStep("Checking the trade");
  const b = await buildSwap({ quote: q, wallet, priority, fetch });
  if (b.simulationError) throw new Error(b.simulationError);
  if (!onlyWalletSigns(b.tx, wallet)) throw new Error("This trade asks for a signer besides your wallet, so it wasn't sent.");
  onStep("Sign the trade in your wallet");
  if (signTransaction) {
    const signed = await signTransaction(b.tx);
    if (!onlyWalletSigns(signed, wallet) || !walletSigned(signed, wallet)) throw new Error("The wallet's signature didn't check out. Try another wallet.");
    onStep("Sending");
    return sendSigned(conn, signed, { what: "trade", lastValidBlockHeight: b.lastValidBlockHeight, preflight: true });
  }
  const sig = await sendTransaction(b.tx, conn);
  onStep("Sending");
  const r = await conn.confirmTransaction({ signature: sig, blockhash: b.tx.message.recentBlockhash, lastValidBlockHeight: b.lastValidBlockHeight }, "confirmed");
  if (r.value.err) {
    const logs = await txLogs(conn, sig);
    throw new TxError(sig, describeTxError(r.value.err, [], null, logs), logs, "trade");
  }
  return sig;
}

const SLIPPED = "The price moved more than 3% before your trade landed, so it didn't go through. Try again.";
export const NO_ROUTE_TEXT = "No route for this trade yet. Try again in a moment.";

/** A trade's error in plain words: no route, slippage, else what flows.explain says. */
export function explainSwap(e) {
  if (e?.noRoute || e?.message === NO_ROUTE) return NO_ROUTE_TEXT;
  const m = e?.message ?? String(e);
  const logs = e?.transactionLogs ?? (Array.isArray(e?.logs) ? e.logs : []);
  const by = failedWith([...logs, m]);
  if (by?.program === JUP_PROGRAM && by.code === JUP_SLIPPAGE) return SLIPPED;
  if (m.includes(`(${JUP_PROGRAM}): custom ${JUP_SLIPPAGE}`)) return SLIPPED;
  return explain(e);
}

/** The wallet's balance of `mint` (PublicKey): { raw (BigInt), decimals, ui }. Both token
 *  programs: the RPC finds the mint's own. */
export async function tokenBalance(conn, owner, mint) {
  const r = await conn.getParsedTokenAccountsByOwner(owner, { mint });
  let raw = 0n;
  let decimals = 6;
  for (const a of r.value) {
    const amount = a.account.data.parsed?.info?.tokenAmount;
    if (!amount) continue;
    raw += BigInt(amount.amount);
    decimals = amount.decimals;
  }
  return { raw, decimals, ui: Number(raw) / 10 ** decimals };
}

// ---- what a trade sheet shows ----

/** Pool fee Mooner's pools charge: 1% (DBC's floor after the snipe tax, dbc.js
 *  CURVE.FEE_FLOOR; DAMM v2 FixedBps100 after migration, migrationFeeOption 2). */
export const POOL_FEE_BPS = 100;

/** The pool fee of a quote in lamports, when every hop is one of `pools` (base58 pool
 *  addresses: the coin's DBC pool and, once migrated, its DAMM v2 pool); null when the route
 *  goes through other pools (their fees are in the price). Taken on the SOL side: the SOL
 *  going in for a buy, the SOL coming out for a sell (the out is what's left after it). */
export function poolFee(side, q, pools, feeBps = POOL_FEE_BPS) {
  if (!q.route.length || !q.route.every((h) => pools.includes(h.amm))) return null;
  const fee = BigInt(feeBps);
  return side === "buy" ? (q.inAmount * fee) / 10_000n : (q.outAmount * fee) / (10_000n - fee);
}

/** Price impact as a fraction: how much worse than the pool's price right now (its Q64.64
 *  `sqrtPrice`, lamports per raw token) the quote is, the pool fee left out. Jupiter's own
 *  figure when it's larger (it reads 0 for a DBC route) or when the price isn't known. */
export function impactOf(side, q, sqrtPrice, feeBps = POOL_FEE_BPS) {
  if (sqrtPrice == null) return q.impact;
  const s = Number(BigInt(sqrtPrice)) / 2 ** 64;
  const spot = s * s; // lamports per raw token
  const keep = 1 - feeBps / 10_000;
  const fair = side === "buy" ? (Number(q.inAmount) * keep) / spot : Number(q.inAmount) * spot * keep;
  if (!(fair > 0)) return q.impact;
  return Math.max(q.impact, 0, 1 - Number(q.outAmount) / fair);
}

/** The raw amount a sell of `pct` percent (25, 50 or 100) of `raw` (BigInt) is. */
export const sellAmount = (raw, pct) => (pct >= 100 ? raw : (raw * BigInt(pct)) / 100n);
