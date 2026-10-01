// Mobile Wallet Adapter for the app: the provider (mainnet, authorization kept in
// expo-secure-store so reconnecting skips the approval screen), the signer, and the
// store's wallet kept in step with the adapter's account.
import { useEffect, useMemo } from "react";
import * as SecureStore from "expo-secure-store";
import { PublicKey } from "@solana/web3.js";
import { MobileWalletProvider, useMobileWallet } from "@wallet-ui/react-native-web3js";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { CHAIN, IDENTITY, RPC } from "./config";
import { secureJson } from "./securekeys";
import { mwaSigner } from "./signer";
import { store } from "./app";

// As the library's own cache does, each account's publicKey comes back a PublicKey (its
// `address` stays a base58 string after a cold start: use publicKey).
const saved = secureJson(SecureStore, `mwa-authorization:${CHAIN}`, (k, v) => (k === "publicKey" ? new PublicKey(v) : v));

// The adapter shows no account until it has read the saved authorization (an async read
// after the provider mounts), and says nothing when there was none. This tells the two
// apart: read = the first read is done; has = an authorization is saved.
const boot = createStore(() => ({ read: false, has: false }));

const cache = {
  async get() {
    const auth = await saved.get().catch(() => undefined); // unreadable: connect again
    boot.setState({ read: true, has: !!auth?.selectedAccount });
    return auth;
  },
  async set(auth) {
    await saved.set(auth);
    boot.setState({ has: !!auth?.selectedAccount });
  },
  async clear() {
    await saved.clear();
    boot.setState({ has: false });
  },
};

export function WalletProvider({ children }) {
  return (
    <MobileWalletProvider cache={cache} chain={CHAIN} endpoint={RPC} commitmentOrConfig="confirmed" identity={IDENTITY}>
      <FollowWallet />
      {children}
    </MobileWalletProvider>
  );
}

/** Keeps store.wallet = the adapter's account. */
function FollowWallet() {
  const w = useMobileWallet();
  const address = w.account?.publicKey?.toBase58() ?? null;
  useEffect(() => {
    store.getState().setWallet(address);
  }, [address]);
  return null;
}

/** The adapter's account; null when none is connected; undefined while the saved
 *  authorization is still being read (so a cold start doesn't look disconnected). */
export function useAccount() {
  const account = useMobileWallet().account;
  const read = useStore(boot, (s) => s.read);
  const has = useStore(boot, (s) => s.has);
  if (account) return account;
  return read && !has ? null : undefined;
}

/** The signer, or null when no wallet is connected. */
export function useSigner() {
  const w = useMobileWallet();
  return useMemo(() => mwaSigner(w), [w.account?.publicKey?.toBase58(), w.signTransactions, w.signMessages]);
}

/** { connect(), disconnect() } over the adapter. */
export function useWalletActions() {
  const w = useMobileWallet();
  return { connect: () => w.connect(), disconnect: () => w.disconnect() };
}
