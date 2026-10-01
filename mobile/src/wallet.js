// Mobile Wallet Adapter for the app: the provider (mainnet, authorization kept in
// expo-secure-store so reconnecting skips the approval screen), the signer, and the
// store's wallet kept in step with the adapter's account.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as SecureStore from "expo-secure-store";
import { PublicKey } from "@solana/web3.js";
import { MobileWalletProvider, useMobileWallet } from "@wallet-ui/react-native-web3js";
import { useStore } from "zustand";
import { makeBootCache } from "./bootcache";
import { CHAIN, IDENTITY, RPC } from "./config";
import { secureJson } from "./securekeys";
import { mwaSigner } from "./signer";
import { store } from "./app";

// As the library's own cache does, each account's publicKey comes back a PublicKey (its
// `address` stays a base58 string after a cold start: use publicKey).
const saved = secureJson(SecureStore, `mwa-authorization:${CHAIN}`, (k, v) => (k === "publicKey" ? new PublicKey(v) : v));

// The adapter shows no account until it has read the saved authorization (an async read
// after the provider mounts), and says nothing when there was none. `boot` tells the two
// apart (bootcache.js); a keystore error never fails a connect, a signature or a disconnect.
const { cache, boot } = makeBootCache(saved);

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

/** The signer, or null when no wallet is connected. The same object for as long as the
 *  account stays the same, and it always calls the adapter's newest signTransactions and
 *  signMessages (they change whenever the saved authorization does, e.g. a new auth token
 *  between two signatures of one flow). */
export function useSigner() {
  const w = useMobileWallet();
  const latest = useRef(w);
  useLayoutEffect(() => {
    latest.current = w;
  });
  const key = w.account?.publicKey?.toBase58() ?? null;
  return useMemo(
    () =>
      mwaSigner({
        account: w.account,
        signTransactions: (...a) => latest.current.signTransactions(...a),
        signMessages: (...a) => latest.current.signMessages(...a),
      }),
    [key], // only the account: the calls go through `latest`
  );
}

/** { connect(), disconnect() } over the adapter. */
export function useWalletActions() {
  const w = useMobileWallet();
  return { connect: () => w.connect(), disconnect: () => w.disconnect() };
}
