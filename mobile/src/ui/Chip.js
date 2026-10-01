// An oval amount chip, for picking a seat or a commit.
import { Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { T } from "./kit";
import { C, F, R } from "./theme";

/** Quiet, or with the accent rim on a soft accent when picked (`on`). `label`: what a screen
 *  reader says, when it should say more than `text`. */
export function Chip({ text, label, on, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? text}
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        {
          flex: 1, height: 44, borderRadius: R.pill, borderWidth: 1, alignItems: "center", justifyContent: "center",
          backgroundColor: on ? C.accentSoft : C.bg2, borderColor: on ? C.accent : C.lineStrong,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <T style={{ fontFamily: F.semi, fontSize: 15 }}>{text}</T>
    </Pressable>
  );
}
