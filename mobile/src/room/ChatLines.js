// The last 3 chat lines over the bottom of a scene, each on a dark veil; a new one rises in.
// A tap opens the chat.
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

export function ChatLines({ channel, onPress }) {
  const rows = useStore(store, (s) => s.chats[channel]) ?? EMPTY;
  const last = rows.slice(-SHOWN);
  if (!last.length) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the chat"
      disabled={!onPress}
      onPress={onPress}
      style={{ gap: 4, alignItems: "flex-start" }}
    >
      {last.map((r) => (
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
      ))}
    </Pressable>
  );
}
