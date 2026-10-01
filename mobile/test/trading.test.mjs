// The phone's trading (src/trading.js) over engine/src/swap.js, with a fake fetch and RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN22 } from "../../engine/src/consts.js";
import { ata } from "../../engine/src/pdas.js";
import { makeMarket } from "../src/trading.js";

const WSOL = "So11111111111111111111111111111111111111112";
const MINT = "GS2xpNeKkon1rQHa7XcwkbZ65yP3rBT2v4uh2KMdQDeC";
const POOL = "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri";
const wallet = Keypair.generate();
// Jupiter's quote for 0.01 SOL of the trial coin (mainnet, 2026-10-01), trimmed
const QUOTE = {
  inputMint: WSOL, inAmount: "10000000", outputMint: MINT, outAmount: "348894380365", otherAmountThreshold: "338427548955",
  swapMode: "ExactIn", slippageBps: 300, priceImpactPct: "0",
  routePlan: [{ swapInfo: { ammKey: POOL, label: "Dynamic Bonding Curve" }, percent: 100 }],
};

function fakeFetch(...replies) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const [status, json] = replies.shift();
    return { ok: status < 400, status, json: async () => json };
  };
  f.calls = calls;
  return f;
}

function jupTx() {
  const ix = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });
  const msg = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", instructions: [ix] }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

test("quote: a buy spends SOL, a sell spends the coin", async () => {
  const fetch = fakeFetch([200, QUOTE], [200, { ...QUOTE, inputMint: MINT, outputMint: WSOL }]);
  const m = makeMarket({ conn: {}, priority: 100_000, fetch });
  const q = await m.quote("buy", MINT, 10_000_000n);
  assert.equal(q.outAmount, 348_894_380_365n);
  await m.quote("sell", MINT, 5n);
  assert.match(fetch.calls[0].url, new RegExp(`inputMint=${WSOL}&outputMint=${MINT}&amount=10000000&`));
  assert.match(fetch.calls[1].url, new RegExp(`inputMint=${MINT}&outputMint=${WSOL}&amount=5&`));
});

test("holding: the wallet's associated token account of the mint over the phone's RPC", async () => {
  let asked;
  // getParsedTokenAccountsByOwner's item: the account's address (the wallet's ATA) and its token program
  const pubkey = ata(wallet.publicKey, new PublicKey(MINT), TOKEN22);
  const conn = {
    getParsedTokenAccountsByOwner: async (owner, filter) => (
      (asked = [owner.toBase58(), filter.mint.toBase58()]),
      { value: [{ pubkey, account: { owner: TOKEN22, data: { parsed: { info: { tokenAmount: { amount: "2500000", decimals: 6 } } } } } }] }
    ),
  };
  const m = makeMarket({ conn, priority: 100_000, fetch: fakeFetch() });
  assert.deepEqual(await m.holding(wallet.publicKey.toBase58(), MINT), { raw: 2_500_000n, decimals: 6, ui: 2.5 });
  assert.deepEqual(asked, [wallet.publicKey.toBase58(), MINT]);
});

test("swap: the phone's priority, the wallet only signs, the app sends with a preflight", async () => {
  const fetch = fakeFetch([200, QUOTE], [200, { swapTransaction: jupTx(), lastValidBlockHeight: 430317386, computeUnitLimit: 87951, prioritizationFeeLamports: 8795, simulationError: null }]);
  const sent = [];
  const conn = {
    rpcEndpoint: "https://rpc",
    sendRawTransaction: async (raw, opts) => (sent.push(opts), "SIG"),
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    getBlockHeight: async () => 1,
  };
  const m = makeMarket({ conn, priority: 100_000, fetch });
  const used = [];
  const signer = {
    publicKey: wallet.publicKey,
    signTransaction: async (tx) => (used.push("sign"), tx.sign([wallet]), tx),
    sendTransaction: async () => (used.push("send"), "NO"),
  };
  const steps = [];
  const q = await m.quote("buy", MINT, 10_000_000n);
  assert.equal(await m.swap(q, signer, (s) => steps.push(s)), "SIG");
  assert.equal(fetch.calls[1].body.computeUnitPriceMicroLamports, 100_000);
  assert.equal(fetch.calls[1].body.userPublicKey, wallet.publicKey.toBase58());
  assert.deepEqual(used, ["sign"]);
  assert.deepEqual(sent, [{ skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" }]);
  assert.deepEqual(steps, ["Checking the trade", "Sign the trade in your wallet", "Sending"]);
});
