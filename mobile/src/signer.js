// One signer for every screen (spec, "One signer, two wallets"): Mobile Wallet Adapter now,
// Privy later. Screens and flows.js see only
//   { publicKey, signTransaction(tx), sendTransaction(tx, conn, opts), signMessage(bytes) }
// Seed Vault signs without sending (spike, 2026-10-01), so a send is sign + our own RPC send,
// as the web does.

import { pickSignature } from "../../engine/src/walletcheck.js";

/** `w`: useMobileWallet() from @wallet-ui/react-native-web3js. null until it's connected. */
export function mwaSigner(w) {
  const publicKey = w.account?.publicKey;
  if (!publicKey) return null;
  return {
    publicKey,
    signTransaction: (tx) => w.signTransactions(tx),
    async sendTransaction(tx, conn, opts) {
      const signed = await w.signTransactions(tx);
      return conn.sendRawTransaction(signed.serialize(), opts);
    },
    // The MWA spec leaves a signMessages reply's layout open (some wallets append the message
    // to the signature). The server checks a bare 64-byte signature, so hand back only that.
    async signMessage(bytes) {
      const reply = await w.signMessages(bytes);
      const got = pickSignature(bytes, Uint8Array.from(reply), publicKey);
      if (!got) throw new Error("The wallet's signature didn't check out. Try another wallet.");
      return got.signature;
    },
  };
}
