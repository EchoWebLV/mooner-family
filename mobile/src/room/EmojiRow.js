// The 12 Mooner emojis in a row above the chat input; a tap adds `:name:`.
import { Image, Pressable, ScrollView } from "react-native";
import { EMOJI } from "../../../engine/src/emoji.js";
import { EMOJI_FILES } from "../ui/emojis";

/** `onPick(name)`: a tap on an emoji. It scrolls sideways; taps work with the keyboard up. */
export function EmojiRow({ onPick, disabled }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 2 }}>
      {EMOJI.map((name) => (
        <Pressable
          key={name}
          accessibilityRole="button"
          accessibilityLabel={`:${name}:`}
          disabled={disabled}
          onPress={() => onPick(name)}
          style={({ pressed }) => [
            { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
            disabled && { opacity: 0.45 },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Image source={EMOJI_FILES[name]} style={{ width: 30, height: 30 }} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
