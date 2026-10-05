// The last 3 chat lines over the bottom of a scene, each on a dark veil; a new one rises in.
// With `onPress` a tap opens the chat (a button, "Open the chat"); without it the lines are
// plain text TalkBack reads.
import { Pressable, View } from "react-native";
import { useStore } from "zustand";
import { store } from "../app";
import { Face } from "../ui/Face";
import { Move } from "../ui/motion";
import { C } from "../ui/theme";
import { ChatText } from "./ChatText";

const EMPTY = [];
const SHOWN = 3;
/** bg0 at 74%, the mockup's chat veil. */
const VEIL = `${C.bg0}bd`;
const BOX = { gap: 4, alignItems: "flex-start" };

export function ChatLines({ channel, onPress }) {
  const rows = useStore(store, (s) => s.chats[channel]) ?? EMPTY;
  const last = rows.slice(-SHOWN);
  if (!last.length) return null;
  const lines = last.map((r) => (
    <Move key={r.id} kind="rise">
      <View
        style={{
          flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 300,
          backgroundColor: VEIL, borderRadius: 14, paddingVertical: 3, paddingLeft: 3, paddingRight: 9,
        }}
      >
        <Face wallet={r.wallet} size={20} />
        <ChatText text={r.text} v="small" color={C.text0} numberOfLines={1} size={16} big={22} style={{ flexShrink: 1 }} />
      </View>
    </Move>
  ));
  if (!onPress) return <View style={BOX}>{lines}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Open the chat" onPress={onPress} style={BOX}>
      {lines}
    </Pressable>
  );
}
