// The one connect action, for the Connect screen and Me: opens the wallet, says why when it
// didn't connect, and buzzes when it did.
import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { explain } from "../../engine/src/flows.js";
import { useWalletActions } from "./wallet";

// The wallet's Decline on the approval screen: an MWA protocol error with
// ERROR_AUTHORIZATION_FAILED (-1, @solana-mobile/mobile-wallet-adapter-protocol) and the
// wallet's own wording, which explain() doesn't know.
const AUTHORIZATION_FAILED = -1;
const reason = (e) => (e?.code === AUTHORIZATION_FAILED ? "You cancelled it in your wallet." : explain(e));

/** { connect, busy, error }. connect() opens the wallet; once it's approved, onDone() runs if
 *  the screen is still there (the person may have left it while the wallet was open). busy
 *  stays on after an approval: the screen is about to leave or turn into the connected one. */
export function useConnect({ onDone } = {}) {
  const { connect: open } = useWalletActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function connect() {
    setError(null);
    setBusy(true);
    try {
      await open();
    } catch (e) {
      if (!mounted.current) return;
      setError(reason(e));
      setBusy(false);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (mounted.current) onDone?.();
  }

  return { connect, busy, error };
}
