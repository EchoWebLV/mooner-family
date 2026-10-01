// Trading through Jupiter (engine/src/swap.js) against a fake fetch and a fake RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddressLookupTableAccount, Keypair, PublicKey, SendTransactionError, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { MEMO, TOKEN, TOKEN22 } from "../src/consts.js";
import { ata } from "../src/pdas.js";
import { sendSigned } from "../src/tx.js";
import {
  BEHIND_TEXT, buildSwap, buyQuote, explainSwap, impactOf, JUP, JUP_PROGRAM, NO_ANSWER, NO_ROUTE, NO_ROUTE_TEXT, onlyWalletSigns, poolFee,
  PREFLIGHT_TEXT, quote, sellAmount, sellQuote, swap, tokenBalance, WSOL,
} from "../src/swap.js";

const MINT = "GS2xpNeKkon1rQHa7XcwkbZ65yP3rBT2v4uh2KMdQDeC";
const POOL = "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri";
const wallet = Keypair.generate();
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

// Jupiter's answer for 0.01 SOL of the trial coin (mainnet, 2026-10-01), trimmed to the fields swap.js reads
const QUOTE = {
  inputMint: WSOL, inAmount: "10000000", outputMint: MINT, outAmount: "348894380365", otherAmountThreshold: "338427548955",
  swapMode: "ExactIn", slippageBps: 300, platformFee: null, priceImpactPct: "0",
  routePlan: [{ swapInfo: { ammKey: POOL, label: "Dynamic Bonding Curve", inputMint: WSOL, outputMint: MINT, inAmount: "10000000", outAmount: "348894380365" }, percent: 100, bps: null }],
  contextSlot: 452276981, transactionVersion: 0,
};

/** A fetch that answers each call with the next reply, and logs every call. */
function fakeFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const [status, json] = replies.shift();
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}

/** A v0 tx like Jupiter's: the wallet pays; `also` adds a second signer. */
function jupTx(payer = wallet.publicKey, also = null, blockhash = BLOCKHASH) {
  const ixs = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 })];
  if (also) ixs.push(new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: also, isSigner: true, isWritable: false }], data: Buffer.from("x") }));
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
}

/** A fetch that never answers: it settles only when the call is aborted, as fetch does. */
const hang = (_url, init) =>
  new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))));
/** A fetch whose reply comes at once but whose body never does. */
const hangBody = (_url, init) => Promise.resolve({ ok: true, status: 200, json: () => hang(_url, init) });
const built = (tx, over = {}) => ({
  swapTransaction: Buffer.from(tx.serialize()).toString("base64"), lastValidBlockHeight: 430317386, prioritizationFeeLamports: 8795,
  computeUnitLimit: 87951, simulationError: null, ...over,
});

/** An RPC that records sends and says each signature landed. */
function fakeConn({ status = { confirmationStatus: "confirmed", err: null } } = {}) {
  const sent = [];
  return {
    sent,
    rpcEndpoint: "https://rpc",
    sendRawTransaction: async (raw, opts) => (sent.push(opts), "SIG"),
    getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [status] }),
    getEpochInfo: async () => ({ blockHeight: 1, absoluteSlot: 1 }),
    confirmTransaction: async (args) => (sent.push(["confirm", args]), { value: { err: null } }),
  };
}

test("quote: the URL Jupiter gets, the amounts as BigInt, the route", async () => {
  const f = fakeFetch([200, QUOTE]);
  const q = await buyQuote(MINT, 10_000_000n, { fetch: f });
  assert.equal(f.calls[0].url, `${JUP}/quote?inputMint=${WSOL}&outputMint=${MINT}&amount=10000000&slippageBps=300`);
  assert.deepEqual([q.inAmount, q.outAmount, q.minOut, q.impact], [10_000_000n, 348_894_380_365n, 338_427_548_955n, 0]);
  assert.deepEqual(q.route, [{ amm: POOL, label: "Dynamic Bonding Curve" }]);
  assert.equal(q.raw, QUOTE);
  const s = fakeFetch([200, { ...QUOTE, inputMint: MINT, outputMint: WSOL }]);
  await sellQuote(MINT, 5n, { fetch: s, slippageBps: 100 });
  assert.equal(s.calls[0].url, `${JUP}/quote?inputMint=${MINT}&outputMint=${WSOL}&amount=5&slippageBps=100`);
});

test("quote: no route is its own error, in the website's words", async () => {
  // Jupiter's replies, mainnet 2026-10-01: an unknown mint, and a pair with no pool
  const notTradable = { error: "The token X is not tradable", errorCode: "TOKEN_NOT_TRADABLE" };
  const noRoutes = { error: "No routes found", errorCode: "NO_ROUTES_FOUND" };
  for (const reply of [[400, notTradable], [400, noRoutes], [200, { ...QUOTE, outAmount: "0" }], [200, {}]]) {
    const e = await quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch(reply) }).catch((x) => x);
    assert.equal(e.message, NO_ROUTE);
    assert.equal(e.noRoute, true);
    assert.equal(explainSwap(e), NO_ROUTE_TEXT);
  }
  const other = await quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch([429, { error: "Rate limit exceeded" }]) }).catch((x) => x);
  assert.equal(other.message, "Rate limit exceeded");
  const bare = await quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch([502, null]) }).catch((x) => x);
  assert.equal(bare.message, "Jupiter said 502");
});

test("a Jupiter call that doesn't answer is given up after 10 s, the body's read included, in words", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const p = quote({ input: WSOL, output: MINT, amount: 1n, fetch: hang }).catch((x) => x).finally(() => (settled = true));
  t.mock.timers.tick(9_999);
  await Promise.resolve();
  assert.equal(settled, false, "still waiting just before the deadline");
  t.mock.timers.tick(1);
  const e = await p;
  assert.equal(e.message, NO_ANSWER);
  assert.equal(e.timedOut, true);
  assert.equal(explainSwap(e), "Jupiter didn't answer. Try again.");
  // the reply came but its body didn't: a swap build
  const q = await quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch([200, QUOTE]) });
  const b = buildSwap({ quote: q, wallet: wallet.publicKey, fetch: hangBody }).catch((x) => x);
  await Promise.resolve(); // the body is asked for once the reply is in
  t.mock.timers.tick(10_000);
  assert.equal((await b).message, NO_ANSWER);
});

test("buildSwap: the body Jupiter gets, with the phone's priority or Jupiter's auto", async () => {
  const tx = jupTx();
  const f = fakeFetch([200, built(tx)], [200, built(tx)]);
  const q = await quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch([200, QUOTE]) });
  const b = await buildSwap({ quote: q, wallet: wallet.publicKey, priority: 100_000, fetch: f });
  assert.equal(f.calls[0].url, `${JUP}/swap`);
  assert.deepEqual(f.calls[0].body, {
    quoteResponse: QUOTE, userPublicKey: wallet.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, computeUnitPriceMicroLamports: 100_000,
  });
  assert.deepEqual([b.lastValidBlockHeight, b.simulationError, b.units, b.priorityLamports], [430317386, null, 87951, 8795]);
  assert.deepEqual(b.tx.serialize(), tx.serialize());
  await buildSwap({ quote: q, wallet: wallet.publicKey, fetch: f });
  assert.equal(f.calls[1].body.prioritizationFeeLamports, "auto");
  assert.equal("computeUnitPriceMicroLamports" in f.calls[1].body, false);
});

test("onlyWalletSigns: one signer, and it's the wallet", () => {
  assert.equal(onlyWalletSigns(jupTx(), wallet.publicKey), true);
  assert.equal(onlyWalletSigns(jupTx(Keypair.generate().publicKey), wallet.publicKey), false, "someone else pays");
  assert.equal(onlyWalletSigns(jupTx(wallet.publicKey, Keypair.generate().publicKey), wallet.publicKey), false, "a second signer");
});

test("onlyWalletSigns with a lookup table, as Jupiter's txs use: a signer can't hide in the table", () => {
  const other = Keypair.generate().publicKey;
  const looked = Array.from({ length: 4 }, () => Keypair.generate().publicKey);
  const alt = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: [...looked, other] },
  });
  const programId = Keypair.generate().publicKey;
  const v0 = (payer, keys) =>
    new VersionedTransaction(
      new TransactionMessage({ payerKey: payer, recentBlockhash: BLOCKHASH, instructions: [new TransactionInstruction({ programId, keys, data: Buffer.from([1]) })] }).compileToV0Message([alt]),
    );
  const plain = [...looked, other].map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }));
  const tx = v0(wallet.publicKey, plain);
  assert.equal(tx.message.addressTableLookups.length, 1, "the other accounts come from the table");
  assert.equal(onlyWalletSigns(tx, wallet.publicKey), true);
  assert.equal(onlyWalletSigns(VersionedTransaction.deserialize(tx.serialize()), wallet.publicKey), true, "as Jupiter hands it over, in bytes");
  // a signer is always a static key, even one the table holds
  const signs = v0(wallet.publicKey, [{ pubkey: other, isSigner: true, isWritable: false }, ...plain.slice(0, 4)]);
  assert.equal(signs.message.header.numRequiredSignatures, 2);
  assert.equal(onlyWalletSigns(signs, wallet.publicKey), false);
  assert.equal(onlyWalletSigns(v0(other, [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }]), wallet.publicKey), false, "another pays, the wallet co-signs");
});

async function q0() {
  return quote({ input: WSOL, output: MINT, amount: 1n, fetch: fakeFetch([200, QUOTE]) });
}

test("swap (phone): checks, the wallet signs, sent with a preflight until it lands", async () => {
  const conn = fakeConn();
  const steps = [];
  let asked = null;
  const signTransaction = async (tx) => ((asked = tx), tx.sign([wallet]), tx);
  const sig = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction, priority: 100_000, fetch: fakeFetch([200, built(jupTx())]), onStep: (s) => steps.push(s) });
  assert.equal(sig, "SIG");
  assert.ok(asked instanceof VersionedTransaction);
  assert.deepEqual(conn.sent, [{ skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" }]);
  assert.deepEqual(steps, ["Checking the trade", "Sign the trade in your wallet", "Sending"]);
});

const tick = () => new Promise((r) => setImmediate(r));
const never = () => new Promise(() => {});

test("swap (phone): an RPC that never answers a block height ends the trade as outcome unknown after 120 s, not the keeper's 300 s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  // the trade went out; no status and no block height ever come back
  const conn = { ...fakeConn({ status: null }), getEpochInfo: never };
  const signTransaction = async (tx) => (tx.sign([wallet]), tx);
  let end = null;
  swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction, fetch: fakeFetch([200, built(jupTx())]) }).then(() => (end = "resolved"), (e) => (end = e));
  for (let i = 0; i < 2_000 && !end; i++) {
    for (let j = 0; j < 5; j++) await tick();
    t.mock.timers.tick(250);
  }
  const at = Date.now();
  t.mock.timers.reset();
  assert.equal(end?.outcomeUnknown, true, `ended with ${end?.message ?? end}`);
  assert.equal(end.sig, "SIG");
  // the bound is checked between calls: the height read under way (10 s at most) may run past it
  assert.ok(at > 120_000 && at <= 120_000 + 10_000 + 1_000, `ended at ${at / 1000} s`);
});

test("sendSigned skips the preflight unless asked: the keeper's sends are unchanged", async () => {
  const conn = fakeConn();
  const tx = jupTx();
  tx.sign([wallet]);
  assert.equal(await sendSigned(conn, tx), "SIG");
  assert.equal(await sendSigned(conn, tx, { preflight: true }), "SIG");
  assert.deepEqual(conn.sent, [{ skipPreflight: true, maxRetries: 0 }, { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" }]);
});

test("swap stops before the wallet: Jupiter's simulation failed, or another signer", async () => {
  const conn = fakeConn();
  let asked = false;
  const signTransaction = async (tx) => ((asked = true), tx);
  const sim = { errorCode: "TRANSACTION_ERROR", error: "Attempt to debit an account but found no record of a prior credit." };
  const e1 = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction, fetch: fakeFetch([200, built(jupTx(), { simulationError: sim })]) }).catch((x) => x);
  assert.equal(explainSwap(e1), "Your wallet needs a little more SOL to cover rent and the Solana fee.");
  const e2 = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction, fetch: fakeFetch([200, built(jupTx(wallet.publicKey, Keypair.generate().publicKey))]) }).catch((x) => x);
  assert.equal(e2.message, "This trade asks for a signer besides your wallet, so it wasn't sent.");
  assert.equal(asked, false);
  assert.deepEqual(conn.sent, []);
});

test("swap stops before the wallet when Jupiter's last valid block height isn't a whole number: the send couldn't tell when it ran out", async () => {
  for (const lastValidBlockHeight of ["430317386", null, undefined, 4.5, 2 ** 53]) {
    const conn = fakeConn();
    let asked = false;
    const signTransaction = async (tx) => ((asked = true), tx.sign([wallet]), tx);
    const e = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction, fetch: fakeFetch([200, built(jupTx(), { lastValidBlockHeight })]) }).catch((x) => x);
    assert.equal(e.message, NO_ROUTE, `${lastValidBlockHeight}`);
    assert.equal(explainSwap(e), NO_ROUTE_TEXT);
    assert.equal(asked, false, "nothing was signed");
    assert.deepEqual(conn.sent, []);
  }
});

test("swap stops after the wallet when its signature doesn't cover the tx", async () => {
  const conn = fakeConn();
  const other = Keypair.generate();
  const unsigned = async (tx) => tx; // handed back without a signature
  const e1 = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction: unsigned, fetch: fakeFetch([200, built(jupTx())]) }).catch((x) => x);
  assert.equal(e1.message, "The wallet's signature didn't check out. Try another wallet.");
  const swapped = async () => {
    const t = jupTx(other.publicKey);
    t.sign([other]);
    return t;
  };
  const e2 = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction: swapped, fetch: fakeFetch([200, built(jupTx())]) }).catch((x) => x);
  assert.equal(e2.message, "The wallet's signature didn't check out. Try another wallet.");
  assert.deepEqual(conn.sent, []);
});

test("swap stops after the wallet when it signed with another blockhash: the trade could outlive Jupiter's", async () => {
  const conn = fakeConn();
  const rehashed = async () => {
    const t = jupTx(wallet.publicKey, null, Keypair.generate().publicKey.toBase58());
    t.sign([wallet]); // a good signature, only the wallet signs: just the blockhash differs
    return t;
  };
  const e = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, signTransaction: rehashed, fetch: fakeFetch([200, built(jupTx())]) }).catch((x) => x);
  assert.equal(e.message, "Your wallet changed the trade's blockhash, so it wasn't sent. Try again.");
  assert.deepEqual(conn.sent, []);
});

test("swap (website): the wallet sends, confirmed against Jupiter's blockhash and its last block height", async () => {
  const conn = fakeConn();
  const tx = jupTx();
  const sendTransaction = async (t, c) => (assert.equal(c, conn), "WEBSIG");
  const sig = await swap({ quote: await q0(), wallet: wallet.publicKey, conn, sendTransaction, fetch: fakeFetch([200, built(tx)]) });
  assert.equal(sig, "WEBSIG");
  assert.deepEqual(conn.sent, [["confirm", { signature: "WEBSIG", blockhash: BLOCKHASH, lastValidBlockHeight: 430317386 }]]);
});

test("explainSwap: Jupiter's slippage error, from logs or from the tx error; the rest as flows.explain", () => {
  const logs = [`Program ${JUP_PROGRAM} invoke [1]`, `Program ${JUP_PROGRAM} failed: custom program error: 0x1771`];
  const slipped = "The price moved more than 3% before your trade landed, so it didn't go through. Try again.";
  assert.equal(explainSwap(Object.assign(new Error("Simulation failed."), { transactionLogs: logs })), slipped);
  assert.equal(explainSwap(Object.assign(new Error("trade (SIG): ix 3 (x): custom 6001"), { logs })), slipped);
  assert.equal(explainSwap(new Error(`trade (SIG): ix 3 (${JUP_PROGRAM}): custom 6001`)), slipped);
  // another program's 6001 isn't Jupiter's slippage
  const dbc = ["Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN failed: custom program error: 0x1771"];
  assert.equal(explainSwap(Object.assign(new Error("trade (SIG): ix 3 (dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN): custom 6001"), { logs: dbc })), "trade (SIG): ix 3 (dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN): custom 6001");
  assert.equal(explainSwap(new Error("User rejected the request")), "You cancelled it in your wallet.");
});

test("explainSwap: a refused preflight in a sentence, not web3.js's page of text", () => {
  const refused = (transactionMessage, logs = []) => new SendTransactionError({ action: "simulate", signature: "", transactionMessage, logs });
  assert.equal(explainSwap(refused("Transaction simulation failed: Blockhash not found")), BEHIND_TEXT);
  assert.equal(BEHIND_TEXT, "The network was a step behind. Try again.");
  // web3.js's own words for a failed simulation, as the RPC returned them
  const other = refused("Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1", ["Program log: Error: insufficient funds"]);
  assert.match(other.message, /^Simulation failed\. \nMessage: Transaction simulation failed/);
  assert.equal(explainSwap(other), PREFLIGHT_TEXT);
  assert.equal(PREFLIGHT_TEXT, "This trade would fail right now, so it wasn't sent. Try again.");
  // a wallet adapter that passes the message on keeps only the text
  assert.equal(explainSwap(new Error(other.message)), PREFLIGHT_TEXT);
  // what the preflight says that has words already keeps them
  assert.equal(explainSwap(refused("Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.")), "Your wallet needs a little more SOL to cover rent and the Solana fee.");
  const slipped = refused("Transaction simulation failed: Error processing Instruction 3: custom program error: 0x1771", [`Program ${JUP_PROGRAM} failed: custom program error: 0x1771`]);
  assert.equal(explainSwap(slipped), "The price moved more than 3% before your trade landed, so it didn't go through. Try again.");
});

test("tokenBalance: the wallet's associated token account only, the one a swap sells from", async () => {
  const mint = new PublicKey(MINT);
  // getParsedTokenAccountsByOwner's items: the account's address and its token program (owner)
  const acc = (pubkey, program, amount) => ({ pubkey, account: { owner: program, data: { parsed: { info: { tokenAmount: { amount, decimals: 6 } } } } } });
  const conn = (...value) => ({ getParsedTokenAccountsByOwner: async (owner, filter) => ((conn.asked = [owner, filter]), { value }) });
  const extra = Keypair.generate().publicKey; // another account of the mint the wallet owns
  const c22 = conn(acc(extra, TOKEN22, "250000"), acc(ata(wallet.publicKey, mint, TOKEN22), TOKEN22, "1500000"));
  assert.deepEqual(await tokenBalance(c22, wallet.publicKey, mint), { raw: 1_500_000n, decimals: 6, ui: 1.5 });
  assert.deepEqual(conn.asked, [wallet.publicKey, { mint }]);
  assert.deepEqual(await tokenBalance(conn(acc(ata(wallet.publicKey, mint, TOKEN), TOKEN, "700000")), wallet.publicKey, mint), { raw: 700_000n, decimals: 6, ui: 0.7 }, "a classic SPL mint");
  assert.deepEqual(await tokenBalance(conn(acc(extra, TOKEN22, "250000")), wallet.publicKey, mint), { raw: 0n, decimals: 6, ui: 0 }, "no ATA: nothing a swap can sell");
  assert.deepEqual(await tokenBalance(conn(), wallet.publicKey, mint), { raw: 0n, decimals: 6, ui: 0 });
});

test("poolFee: 1% on the SOL side when the route is the coin's own pool", () => {
  const buy = { inAmount: 1_000_000_000n, outAmount: 5n, route: [{ amm: POOL }] };
  assert.equal(poolFee("buy", buy, [POOL]), 10_000_000n);
  const sell = { inAmount: 5n, outAmount: 990_000_000n, route: [{ amm: POOL }] };
  assert.equal(poolFee("sell", sell, [POOL]), 10_000_000n);
  assert.equal(poolFee("buy", { ...buy, route: [{ amm: POOL }, { amm: "Other" }] }, [POOL]), null);
  assert.equal(poolFee("buy", { ...buy, route: [] }, [POOL]), null);
});

test("impactOf: against the pool's price, the fee left out; Jupiter's when larger or no price", () => {
  // sqrt of 1 lamport per raw token: 1 SOL buys 0.99e9 raw at no impact
  const ONE = (1n << 64n).toString();
  const buy = (out) => ({ inAmount: 1_000_000_000n, outAmount: out, impact: 0 });
  assert.equal(impactOf("buy", buy(990_000_000n), ONE), 0);
  assert.ok(Math.abs(impactOf("buy", buy(891_000_000n), ONE) - 0.1) < 1e-12);
  const sell = { inAmount: 1_000_000_000n, outAmount: 495_000_000n, impact: 0 };
  assert.ok(Math.abs(impactOf("sell", sell, ONE) - 0.5) < 1e-12);
  assert.equal(impactOf("buy", { ...buy(990_000_000n), impact: 0.2 }, ONE), 0.2);
  assert.equal(impactOf("buy", { ...buy(1n), impact: 0.03 }, null), 0.03);
});

test("sellAmount: a share of what's held, all of it at 100%", () => {
  assert.equal(sellAmount(1_000_003n, 25), 250_000n);
  assert.equal(sellAmount(1_000_003n, 50), 500_001n);
  assert.equal(sellAmount(1_000_003n, 100), 1_000_003n);
  for (const bad of [0, -25, 101, 33.3, NaN, "50", null]) assert.throws(() => sellAmount(1_000_003n, bad), RangeError, String(bad));
});
