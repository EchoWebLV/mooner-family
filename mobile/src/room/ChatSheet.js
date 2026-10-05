// The room's chat: slides up from the bottom, newest at the bottom, live from the socket.
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { CHAT_MAX, clipChat, codePoints } from "../../../engine/src/emoji.js";
import { useStore } from "zustand";
import { store } from "../app";
import { Face } from "../ui/Face";
import { shortWallet } from "../ui/format";
import { SendIcon } from "../ui/icons";
import { Button, Sheet, T } from "../ui/kit";
import { play } from "../ui/sound";
import { C, F, R } from "../ui/theme";
import { ChatText } from "./ChatText";
import { EmojiRow } from "./EmojiRow";
import { hhmm } from "./room";

const EMPTY = [];
/** The server refuses any control character (engine/server/social.js postChat); a pasted
 *  new line or tab becomes a space. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** `channel`: the presale key; `wallet`: the connected wallet (base58) or null. Memo: the
 *  room re-renders every second for its clock, the chat needn't. */
export const ChatSheet = memo(function ChatSheet({ open, onClose, channel, wallet, signer }) {
  const { height } = useWindowDimensions();
  const rows = useStore(store, (s) => s.chats[channel]) ?? EMPTY;
  const newestFirst = useMemo(() => [...rows].reverse(), [rows]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState(null);
  // `sending` is state, so it lags a render: two fast sends would both see false and both
  // ask the wallet to sign in. This one holds from the first tap.
  const inFlight = useRef(false);
  const renderItem = useCallback(({ item }) => <Row row={item} me={item.wallet === wallet} />, [wallet]);

  async function send() {
    const body = text.trim();
    if (!body || inFlight.current || !signer) return;
    inFlight.current = true;
    try {
      const s = store.getState().session;
      setSigning(!s || s.exp <= Date.now()); // the first send signs in: one message in the wallet
      setSending(true);
      setError(null);
      const r = await store.getState().sendChat(channel, body, signer);
      if (r.ok) setText((t) => (t.trim() === body ? "" : t)); // keep anything typed meanwhile
      else setError(r.error);
    } finally {
      inFlight.current = false;
      setSending(false);
      setSigning(false);
    }
  }

  // an emoji goes on the end, when it fits in the server's 280 code points
  function pick(name) {
    const add = `:${name}:`;
    if (codePoints(text) + codePoints(add) > CHAT_MAX) return;
    setText(text + add);
    play("emoji");
  }

  return (
    <Sheet open={open} onClose={onClose} title="Chat">
      <View style={{ height: Math.round(height * 0.8) - 110, flexShrink: 1, minHeight: 160 }}>
        <FlatList
          inverted
          data={newestFirst}
          keyExtractor={(r) => String(r.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 8 }}
          ItemSeparatorComponent={Gap}
          ListEmptyComponent={
            <View style={{ paddingVertical: 32 }}>
              <T v="small" color={C.text2} style={{ textAlign: "center" }}>No messages yet.</T>
            </View>
          }
          keyboardShouldPersistTaps="handled"
        />
        <View style={{ paddingTop: 10, gap: 6 }}>
          {wallet ? <EmojiRow onPick={pick} disabled={sending} /> : null}
          {wallet ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TextInput
                value={text}
                onChangeText={(t) => setText(clipChat(t.replace(CONTROL, " ")))}
                placeholder="Say something"
                placeholderTextColor={C.text2}
                returnKeyType="send"
                onSubmitEditing={send}
                style={{
                  flex: 1, height: 44, paddingHorizontal: 16, borderRadius: R.pill, backgroundColor: C.well,
                  borderWidth: 1, borderColor: C.wellLine, color: C.text0, fontFamily: F.regular, fontSize: 15,
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                disabled={sending || !text.trim() || !signer}
                onPress={send}
                style={({ pressed }) => [
                  { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
                  (sending || !text.trim() || !signer) && { opacity: 0.45 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                {sending ? <ActivityIndicator size="small" color={C.accentInk} /> : <SendIcon color={C.accentInk} />}
              </Pressable>
            </View>
          ) : (
            <Button
              kind="quiet"
              title="Connect to chat"
              onPress={() => {
                onClose();
                router.push("/connect");
              }}
            />
          )}
          {signing ? <T v="small">Sign once to chat</T> : null}
          {error ? <T v="small" color={C.down}>{error}</T> : null}
        </View>
      </View>
    </Sheet>
  );
});

const Gap = () => <View style={{ height: 14 }} />;

function Row({ row, me }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Face wallet={row.wallet} size={24} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T v="small" color={me ? C.gold : C.text1} style={{ fontFamily: F.medium }}>{shortWallet(row.wallet)}</T>
          <T v="small" color={C.text2}>{hhmm(row.at)}</T>
        </View>
        <ChatText text={row.text} />
      </View>
    </View>
  );
}
