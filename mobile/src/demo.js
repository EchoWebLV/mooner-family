// Sample-data mode for screen recordings: EXPO_PUBLIC_DEMO=1, with EXPO_PUBLIC_MOONER_SERVER
// set to engine/scripts/demo-server.js. The wallet still signs each step over Mobile Wallet
// Adapter (a memo tx stands in for each on-chain one), but nothing is sent: the demo server
// records the join, the new coin and its pool, and the trade, and pushes them as the live
// server would. Quotes are Jupiter's real ones, but a coin launched in the demo has its own
// price on the demo server, and its quotes come from there. Builds without the flag use the
// real flows.

import { Buffer } from "buffer";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { presalePda } from "../../engine/src/pdas.js";

export const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
// Nothing is sent, so any 32 bytes do for the blockhash
const BLOCKHASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The memo tx the wallet signs in place of `what`. */
function standIn(wallet, what) {
  const tx = new Transaction({ feePayer: wallet, recentBlockhash: BLOCKHASH });
  tx.add(new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(`Mooner demo: ${what}`) }));
  return tx;
}

function server(base) {
  async function call(method, path, body) {
    const r = await fetch(base + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body && JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error ?? `the demo server said ${r.status}`);
    return j;
  }
  return { get: (path) => call("GET", path), post: (path, body) => call("POST", path, body) };
}

/** `flows` (engine/src/flows.js makeFlows) with join, create and open going to the demo server. */
export function demoFlows(flows, base) {
  const s = server(base);
  return {
    ...flows,
    joinCost: async () => ({ total: 2_400_000n }),
    openCost: async () => ({ total: 9_800_000n }),
    async requestMint({ wallet, signMessage, name, symbol, description, links, image }) {
      await signMessage(new TextEncoder().encode(`Mooner: create $${symbol.trim()} (${name.trim()})`));
      return s.post("/demo/mint", { wallet: wallet.toBase58(), name: name.trim(), symbol: symbol.trim(), description: description.trim(), links, image: Buffer.from(image).toString("base64") });
    },
    async openPresale({ info, wallet, signTransaction, mint, commit }) {
      const presale = presalePda(info.pid, new PublicKey(mint));
      await signTransaction(standIn(wallet, `open the pool for ${mint}`));
      await wait(1_500);
      await s.post("/demo/open", { presale: presale.toBase58(), mint, wallet: wallet.toBase58(), commit: String(commit) });
      return presale;
    },
    async joinPresale({ wallet, signTransaction, view, amount, onStep = () => {} }) {
      onStep("Sign in your wallet to put the SOL in");
      await signTransaction(standIn(wallet, `chip in to ${view.presale}`));
      onStep("Counting you in");
      await wait(1_200);
      await s.post("/demo/join", { presale: view.presale, wallet: wallet.toBase58(), amount: String(amount) });
    },
  };
}

/** `market` (trading.js) with swaps and balances kept by the demo server, and Jupiter's quotes
 *  but for a coin launched in the demo (the demo server's). */
export function demoMarket(market, base) {
  const s = server(base);
  return {
    async quote(side, mint, amount, slippageBps) {
      const q = await s.get(`/demo/quote/${side}/${mint}/${amount}${slippageBps != null ? `?bps=${slippageBps}` : ""}`);
      if (q.fresh === false) return market.quote(side, mint, amount, slippageBps);
      return { ...q, inAmount: BigInt(q.inAmount), outAmount: BigInt(q.outAmount), minOut: BigInt(q.minOut) };
    },
    async holding(wallet, mint) {
      const h = await s.get(`/demo/holding/${wallet}/${mint}`);
      return { raw: BigInt(h.raw), decimals: h.decimals, ui: Number(h.raw) / 10 ** h.decimals };
    },
    async swap(q, signer, onStep = () => {}) {
      onStep("Checking the trade");
      await wait(600);
      onStep("Sign the trade in your wallet");
      const buy = q.raw?.inputMint === "So11111111111111111111111111111111111111112";
      const mint = buy ? q.raw.outputMint : q.raw.inputMint;
      await signer.signTransaction(standIn(signer.publicKey, `${buy ? "buy" : "sell"} ${mint}`));
      onStep("Sending");
      await wait(1_000);
      const r = await s.post("/demo/trade", { wallet: signer.publicKey.toBase58(), mint, side: buy ? "buy" : "sell", inAmount: String(q.inAmount), outAmount: String(q.outAmount) });
      return r.sig;
    },
  };
}
