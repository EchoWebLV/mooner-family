// The bar above a pushed screen: back on the left, the title centred, an optional slot on
// the right.
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { BackIcon } from "./icons";
import { T } from "./kit";
import { C } from "./theme";

/** The width of each side, so the title stays centred. */
const SIDE = 56;

/** Back where the user came from; with nothing to go back to (a deep link), `fallback`. */
export function goBack(fallback) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** `fallback`: the href back opens when there's nothing to go back to. `right`: an element
 *  for the right side, up to `side` wide. `side`: each side's width, wider when `right` holds
 *  two buttons. */
export function TopBar({ title, right, fallback, side = SIDE }) {
  return (
    <View style={{ height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          goBack(fallback);
        }}
        style={({ pressed }) => [{ width: side, height: 44, justifyContent: "center", paddingLeft: 4 }, pressed && { opacity: 0.6 }]}
      >
        <BackIcon color={C.text0} />
      </Pressable>
      <T v="h2" numberOfLines={1} style={{ flex: 1, textAlign: "center" }}>{title}</T>
      <View style={{ width: side, alignItems: "flex-end" }}>{right ?? null}</View>
    </View>
  );
}
