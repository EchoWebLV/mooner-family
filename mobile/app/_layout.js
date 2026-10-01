// The root: fonts, the dark system background, the wallet, the store's live topics, the
// hidden page that draws Mooner pictures and the "Reconnecting…" strip above every screen.
import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useFonts } from "expo-font";
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { Geist_700Bold } from "@expo-google-fonts/geist/700Bold";
import { GeistMono_500Medium } from "@expo-google-fonts/geist-mono/500Medium";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { live, store } from "../src/app";
import { WalletProvider } from "../src/wallet";
import { PfpRenderer } from "../src/pfp/PfpRenderer";
import { Banner } from "../src/ui/kit";
import { C } from "../src/ui/theme";

/** Away this long or more, the socket is opened afresh on return: Android may have cut it
 *  without a close event. A trip to the wallet (Seed Vault opens on top and Android calls
 *  that background) is shorter and keeps the socket and every topic. */
const RESTART_AFTER_MS = 20_000;
/** Down this long before the strip shows, so a normal first connect shows nothing. */
const BANNER_AFTER_MS = 2_000;

export default function Root() {
  // the names theme.js F uses
  const [fontsLoaded, fontError] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, GeistMono_500Medium });

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(C.bg0).catch(() => {});
  }, []);

  useEffect(() => store.getState().start(), []);

  useEffect(() => {
    let away = null; // when the app went to the background
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        if (away === null) away = Date.now();
      } else if (state === "active") {
        if (away !== null && Date.now() - away >= RESTART_AFTER_MS) live.restart();
        away = null;
      }
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: C.bg0 }} />;

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: C.bg0 }}>
      <PfpRenderer />
      <WalletProvider>
        <StatusBar style="light" />
        <Reconnecting />
        <View style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg0 }, animation: "slide_from_right" }} />
        </View>
      </WalletProvider>
    </SafeAreaProvider>
  );
}

/** "Reconnecting…" once the socket has been down for BANNER_AFTER_MS. It sits below the
 *  status bar and pushes the screens down (their safe area then has no top inset). */
function Reconnecting() {
  const up = useStore(store, (s) => s.socketUp);
  const [show, setShow] = useState(false);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (up) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), BANNER_AFTER_MS);
    return () => clearTimeout(t);
  }, [up]);
  if (!show) return null;
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: C.bg0 }}>
      <Banner text="Reconnecting…" />
    </View>
  );
}
