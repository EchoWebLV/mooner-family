// The picture header's pieces: round glass buttons over a scene, a glass pill, and the
// scene header itself (a Scene with the status bar's room, a 56 pt row with the title, and
// room under it for the screen's own things).
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { BackIcon } from "./icons";
import { T } from "./kit";
import { Scene } from "./Scene";
import { goBack } from "./TopBar";
import { C, F, R, S } from "./theme";

const GLASS = "#07080b8c";
const GLASS_RIM = "#ffffff24";

/** A 38 pt round glass button: `children` is its 20 pt icon, `label` what a screen reader
 *  says. `dot` puts a small green dot on it (something new). A haptic tick, no sound. */
export function Glass({ label, onPress, children, dot = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dot ? `${label}, new` : label}
      hitSlop={6}
      onPress={(e) => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      style={({ pressed }) => [
        {
          width: 38, height: 38, borderRadius: 19, backgroundColor: GLASS, borderWidth: 1, borderColor: GLASS_RIM,
          alignItems: "center", justifyContent: "center",
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      {children}
      {dot ? (
        <View
          style={{
            position: "absolute", top: 6, right: 7, width: 10, height: 10, borderRadius: 5,
            backgroundColor: C.up, borderWidth: 2, borderColor: C.bg1,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/** Back where the user came from (`fallback` when there's nothing to go back to). */
export function BackGlass({ fallback = "/(tabs)" }) {
  return (
    <Glass label="Back" onPress={() => goBack(fallback)}>
      <BackIcon color={C.text0} size={20} />
    </Glass>
  );
}

/** A small glass pill with mono text ("1 / 4"). */
export function GlassPill({ text, label }) {
  return (
    <View
      accessible
      accessibilityLabel={label ?? text}
      style={{
        height: 30, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: GLASS, borderWidth: 1, borderColor: GLASS_RIM,
        alignItems: "center", justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: F.mono, fontSize: 13, color: C.text0 }}>{text}</Text>
    </View>
  );
}

/** A screen's picture header: the Scene `name` at `height` (the status bar's room included),
 *  a 56 pt row with `left`, the title and `right` (an element, a fragment or a keyed array,
 *  10 pt apart), then `children` in the room left under the row. Only at the top of a screen:
 *  the SafeAreaView pads by the root's insets wherever it sits. */
export function SceneHeader({ name, height, title, left, right, motion = "still", children }) {
  return (
    <Scene name={name} height={height} motion={motion}>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View style={{ height: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: S.gutter }}>
          {left ?? null}
          <T v="title" numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header" style={{ flex: 1 }}>{title}</T>
          {right ? <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>{right}</View> : null}
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaView>
    </Scene>
  );
}
