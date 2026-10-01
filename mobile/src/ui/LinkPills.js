// A coin's X, Telegram and website, the ones it has, as pills that open them.
import { Linking, Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Pill } from "./kit";
import { linksOf } from "./links";
import { C } from "./theme";

/** `token`: a presale view's or launched row's `token`. Nothing when it has no links. */
export function LinkPills({ token }) {
  const links = linksOf(token);
  if (links.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {links.map((l) => (
        <Pressable
          key={l.label}
          accessibilityRole="link"
          accessibilityLabel={l.label}
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            Linking.openURL(l.url).catch(() => {});
          }}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Pill text={l.label} color={C.text0} />
        </Pressable>
      ))}
    </View>
  );
}
