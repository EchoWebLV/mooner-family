// Sign-in: connect Seed Vault (or any Solana wallet on the phone), or look around first.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { explain } from "../../engine/src/flows.js";
import { browse } from "../src/session";
import { useWalletActions } from "../src/wallet";
import { Logo } from "../src/ui/Logo";
import { Button, T } from "../src/ui/kit";
import { C, F, S } from "../src/ui/theme";

export default function Connect() {
  const insets = useSafeAreaInsets();
  const { connect } = useWalletActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onConnect() {
    setError(null);
    setBusy(true);
    try {
      await connect();
    } catch (e) {
      setError(explain(e));
      setBusy(false);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace("/(tabs)");
  }

  function lookAround() {
    browse();
    router.replace("/(tabs)");
  }

  return (
    <View
      style={{
        flex: 1, backgroundColor: C.bg0, paddingHorizontal: S.gutter,
        paddingTop: insets.top, paddingBottom: insets.bottom + 16,
      }}
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
    </View>
  );
}
