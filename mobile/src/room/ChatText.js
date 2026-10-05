// A chat line's text with the Mooner emojis drawn inline (engine/src/emoji.js chatParts). A
// line of only emojis draws them larger, in a row of their own. TalkBack reads each emoji by
// its name (chat.js readableChat).
import { Image, View, useWindowDimensions } from "react-native";
import { chatParts, emojiOnly } from "../../../engine/src/emoji.js";
import { EMOJI_FILES } from "../ui/emojis";
import { T } from "../ui/kit";
import { readableChat } from "./chat";

const GAP = 4;

/** `v`, `color`, `numberOfLines`, `style`: the text's. `size`: an emoji in a line with text;
 *  `big`: an emoji in a line of only emojis. With `numberOfLines` set, a line of only emojis
 *  keeps to one row: it never wraps, and draws no more emojis than the screen's width holds. */
export function ChatText({ text, v = "body", color, numberOfLines, style, size = 18, big = 36 }) {
  const { width } = useWindowDimensions();
  const parts = chatParts(text);
  const hasEmoji = parts.some((p) => p.kind === "emoji");
  const label = hasEmoji ? readableChat(text) : undefined;
  if (emojiOnly(parts)) {
    let emojis = parts.filter((p) => p.kind === "emoji");
    if (numberOfLines) emojis = emojis.slice(0, Math.ceil(width / (big + GAP)));
    return (
      <View
        accessible
        accessibilityLabel={label}
        style={[
          { flexDirection: "row", flexWrap: numberOfLines ? "nowrap" : "wrap", gap: GAP },
          numberOfLines ? { overflow: "hidden" } : null,
          style,
        ]}
      >
        {emojis.map((p, i) => (
          <Image key={i} source={EMOJI_FILES[p.name]} style={{ width: big, height: big }} />
        ))}
      </View>
    );
  }
  // An inline emoji sits on the baseline and rises its full height (Fabric), so the line
  // height is set past it: lines with and without emojis are the same height.
  return (
    <T v={v} color={color} numberOfLines={numberOfLines} accessibilityLabel={label} style={[{ lineHeight: size + 4 }, style]}>
      {parts.map((p, i) =>
        p.kind === "emoji" ? (
          <Image key={i} source={EMOJI_FILES[p.name]} style={{ width: size, height: size }} />
        ) : (
          p.text
        ),
      )}
    </T>
  );
}
