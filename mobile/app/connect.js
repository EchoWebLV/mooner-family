// Sign-in: connect Seed Vault (or any Solana wallet on the phone), or look around first.
// It opens on a cold start (index.js replaces itself with it) or on top of the app (Live's
// header, a presale's "Connect to join"); either way it leaves for where the person was.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { explain } from "../../engine/src/flows.js";
import { browse } from "../src/session";
import { useWalletActions } from "../src/wallet";
import { Logo } from "../src/ui/Logo";
import { Button, T } from "../src/ui/kit";
import { C, F, S } from "../src/ui/theme";

// The wallet's Decline on the approval screen: an MWA protocol error with
// ERROR_AUTHORIZATION_FAILED (-1, @solana-mobile/mobile-wallet-adapter-protocol) and the
// wallet's own wording, which explain() doesn't know.
const AUTHORIZATION_FAILED = -1;
const reason = (e) => (e?.code === AUTHORIZATION_FAILED ? "You cancelled it in your wallet." : explain(e));

/** Back to the screen that opened Connect, or into the tabs when nothing did (cold start). */
function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)");
}

export default function Connect() {
  const { connect } = useWalletActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onConnect() {
    setError(null);
    setBusy(true);
    try {
      await connect();
    } catch (e) {
      setError(reason(e));
      setBusy(false);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    leave();
  }

  function lookAround() {
    browse();
    leave();
  }

  // The native SafeAreaView measures the insets where it sits (below the "Reconnecting…"
  // strip when that shows) and adds them to this padding.
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ flex: 1, backgroundColor: C.bg0, paddingHorizontal: S.gutter, paddingBottom: 16 }}
    >
      <View style={{ flex: 2, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Logo size={160} />
        <T v="title">Mooner</T>
        <T v="small" style={{ textAlign: "center" }}>Presales that fill together and launch on Meteora.</T>
      </View>
      <View style={{ flex: 1, justifyContent: "flex-end", gap: 12 }}>
        {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
        <Button title="Connect Seed Vault" onPress={onConnect} busy={busy} />
        <Pressable
          accessibilityRole="button"
          onPress={lookAround}
          disabled={busy}
          hitSlop={8}
          style={({ pressed }) => [{ alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16 }, pressed && { opacity: 0.6 }]}
        >
          <T v="body" color={C.text1} style={{ fontFamily: F.medium }}>Look around first</T>
        </Pressable>
        <T v="label" style={{ textAlign: "center" }}>Any Solana wallet on this phone works too.</T>
      </View>
    </SafeAreaView>
  );
}
