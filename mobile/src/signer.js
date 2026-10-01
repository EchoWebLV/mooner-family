// One signer for every screen (spec, "One signer, two wallets"): Mobile Wallet Adapter now,
// Privy later. Screens and flows.js see only
//   { publicKey, signTransaction(tx), sendTransaction(tx, conn, opts), signMessage(bytes) }
// Seed Vault signs without sending (spike, 2026-10-01), so a send is sign + our own RPC send,
// as the web does.

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
    signMessage: (bytes) => w.signMessages(bytes),
  };
}
