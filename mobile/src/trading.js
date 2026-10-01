// Trading for the phone: Jupiter quotes and swaps (engine/src/swap.js, the website's code)
// and the wallet's balance of a coin, over the phone's own RPC. Seed Vault signs without
// sending, so a swap is signTransaction and our own send (swap.js sends it with a preflight
// and confirms it against Jupiter's blockhash).

import { PublicKey } from "@solana/web3.js";
import { buyQuote, sellQuote, swap, tokenBalance } from "../../engine/src/swap.js";

/** `conn`: a Connection to the phone's RPC; `priority`: µLamports per CU (Seed Vault raises
 *  anything lower to 100k, config.js PRIORITY). Mints and wallets are base58. */
export function makeMarket({ conn, priority, fetch = globalThis.fetch }) {
  return {
    /** A Jupiter quote: a buy of `amount` lamports, or a sell of `amount` raw tokens (BigInt). */
    quote: (side, mint, amount) => (side === "buy" ? buyQuote(mint, amount, { fetch }) : sellQuote(mint, amount, { fetch })),
    /** The wallet's balance of the coin in its associated token account, the one a swap sells
     *  from: { raw (BigInt), decimals, ui }. */
    holding: (wallet, mint) => tokenBalance(conn, new PublicKey(wallet), new PublicKey(mint)),
    /** Builds, checks, has the wallet sign, sends and confirms the swap for quote `q`. */
    swap: (q, signer, onStep) => swap({ quote: q, wallet: signer.publicKey, conn, signTransaction: signer.signTransaction, priority, fetch, onStep }),
  };
}
