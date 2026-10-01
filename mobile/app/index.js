// Where the app opens: the tabs with a wallet (or after "Look around first"), else the
// connect screen. It waits for the saved wallet authorization to be read first.
import { View } from "react-native";
import { Redirect } from "expo-router";
import { browsing } from "../src/session";
import { useAccount } from "../src/wallet";
import { C } from "../src/ui/theme";

export default function Index() {
  const account = useAccount();
  if (account || browsing) return <Redirect href="/(tabs)" />;
  if (account === undefined) return <View style={{ flex: 1, backgroundColor: C.bg0 }} />;
  return <Redirect href="/connect" />;
}
