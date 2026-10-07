// A row of choice chips that scrolls sideways (Chat's rooms, Ranks' boards). The chosen one
// is a white pill. A change plays a tap.
import { Pressable, ScrollView, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { CoinImage } from "./CoinImage";
import { play } from "./sound";
import { C, F, R, S } from "./theme";

/** `items`: [{ key, label, image? }]; `value`: the chosen key; `onPick(key)`. An item with
 *  `image` shows its coin picture (18 pt) before the label. */
export function ChipRow({ items, value, onPick }) {
  return (
    <ScrollView
      horizontal
      accessibilityRole="tablist"
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: S.gutter, paddingVertical: 10, gap: 8 }}
      style={{ flexGrow: 0 }}
    >
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.label}
            hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync().catch(() => {});
              play("tap");
              onPick(it.key);
            }}
            style={({ pressed }) => [
              {
                height: 34, paddingHorizontal: 14, borderRadius: R.pill, flexDirection: "row", alignItems: "center", gap: 6,
                backgroundColor: on ? C.text0 : C.bg2, borderWidth: 1, borderColor: on ? C.text0 : C.lineStrong,
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            {it.image !== undefined ? <CoinImage uri={it.image} size={18} ticker={it.label.replace(/^\$/, "")} /> : null}
            <Text style={{ fontFamily: F.semi, fontSize: 14, color: on ? C.bg0 : C.text1 }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
