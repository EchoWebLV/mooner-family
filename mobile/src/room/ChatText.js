// A chat line's text with the Mooner emojis drawn inline (engine/src/emoji.js chatParts). A
// line of only emojis draws them larger, in a row of their own.
import { Image, View } from "react-native";
import { chatParts, emojiOnly } from "../../../engine/src/emoji.js";
import { EMOJI_FILES } from "../ui/emojis";
import { T } from "../ui/kit";

/** `v`, `color`, `numberOfLines`, `style`: the text's. `size`: an emoji in a line with text;
 *  `big`: an emoji in a line of only emojis. */
export function ChatText({ text, v = "body", color, numberOfLines, style, size = 18, big = 36 }) {
  const parts = chatParts(text);
  if (emojiOnly(parts)) {
    return (
      <View accessible accessibilityLabel={text} style={[{ flexDirection: "row", flexWrap: "wrap", gap: 4 }, style]}>
        {parts.filter((p) => p.kind === "emoji").map((p, i) => (
          <Image key={i} source={EMOJI_FILES[p.name]} style={{ width: big, height: big }} />
        ))}
      </View>
    );
  }
  return (
    <T v={v} color={color} numberOfLines={numberOfLines} style={style}>
      {parts.map((p, i) =>
        p.kind === "emoji" ? (
          <Image key={i} source={EMOJI_FILES[p.name]} accessibilityLabel={p.text} style={{ width: size, height: size }} />
        ) : (
          p.text
        ),
      )}
    </T>
  );
}
