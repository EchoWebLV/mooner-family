// A chat room's lines and its composer, shared by the room's sheet (ChatSheet) and the Chat
// screen. The composer's state lives in useComposer, which its owner calls outside any Sheet,
// so a typed line survives the sheet closing.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import { CHAT_MAX, codePoints } from "../../../engine/src/emoji.js";
import { useStore } from "zustand";
import { store } from "../app";
import { Face } from "../ui/Face";
import { shortWallet } from "../ui/format";
import { SendIcon } from "../ui/icons";
import { Button, T } from "../ui/kit";
import { play } from "../ui/sound";
import { TitleTag } from "../ui/TitleTag";
import { C, F, R } from "../ui/theme";
import { tagText } from "../xp/look";
import { mainTitleOf } from "../xp/rows";
import { readableChat, typedChat } from "./chat";
import { ChatText } from "./ChatText";
import { EmojiRow } from "./EmojiRow";
import { hhmm } from "./room";

const EMPTY = [];

/** The composer for `channel`: { text, setText, sending, signing, error, send, pick, canSend },
 *  the same object until one of them changes (ChatPane is memo). The first send signs in (one
 *  message in the wallet). A new channel clears the draft and the error; a send that ends
 *  after the switch leaves the new room's alone. */
export function useComposer(channel, signer) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState(null);
  // `sending` is state, so it lags a render: two fast sends would both see false and both
  // ask the wallet to sign in. This one holds from the first tap.
  const inFlight = useRef(false);
  const shown = useRef(channel); // the channel on screen now, for a send still on its way
  useEffect(() => {
    shown.current = channel;
    setText("");
    setError(null);
  }, [channel]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || inFlight.current || !signer) return;
    inFlight.current = true;
    try {
      const s = store.getState().session;
      setSigning(!s || s.exp <= Date.now());
      setSending(true);
      setError(null);
      const r = await store.getState().sendChat(channel, body, signer);
      if (shown.current !== channel) return; // another room now: its draft and error aren't this send's
      if (r.ok) setText((t) => (t.trim() === body ? "" : t)); // keep anything typed meanwhile
      else setError(r.error);
    } finally {
      inFlight.current = false;
      setSending(false);
      setSigning(false);
    }
  }, [channel, signer, text]);

  // an emoji goes on the end, when it fits in the server's 280 code points
  const pick = useCallback(
    (name) => {
      const add = `:${name}:`;
      if (codePoints(text) + codePoints(add) > CHAT_MAX) return;
      setText(text + add);
      play("emoji");
    },
    [text],
  );

  const canSend = !sending && !!text.trim() && !!signer;
  return useMemo(
    () => ({ text, setText, sending, signing, error, send, pick, canSend }),
    [text, sending, signing, error, send, pick, canSend],
  );
}

/** `channel`'s lines, newest at the bottom, live from the store, and the composer under them
 *  (`composer`: useComposer's). It fills its parent. `wallet`: the connected one, or null
 *  (then "Connect to chat", which calls `onConnect`). `faceSize`: each line's face. `tags`:
 *  each sender's title tag, once XP rows know them. */
export const ChatPane = memo(function ChatPane({ channel, wallet, composer, onConnect, faceSize = 24, tags = false }) {
  const rows = useStore(store, (s) => s.chats[channel]) ?? EMPTY;
  const newestFirst = useMemo(() => [...rows].reverse(), [rows]);
  const renderItem = useCallback(
    ({ item }) => <Row row={item} me={item.wallet === wallet} size={faceSize} tags={tags} />,
    [wallet, faceSize, tags],
  );
  const { text, setText, sending, signing, error, send, pick, canSend } = composer;
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        key={channel} // a new room opens at its newest line, not at the last room's scroll
        inverted
        style={{ flex: 1 }}
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
              onChangeText={(t) => setText((prev) => typedChat(prev, t))}
              accessibilityLabel="Message"
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
              accessibilityState={{ disabled: !canSend, busy: sending }}
              disabled={!canSend}
              onPress={send}
              style={({ pressed }) => [
                { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
                !canSend && { opacity: 0.45 },
                pressed && { opacity: 0.85 },
              ]}
            >
              {sending ? <ActivityIndicator size="small" color={C.accentInk} /> : <SendIcon color={C.accentInk} />}
            </Pressable>
          </View>
        ) : (
          <Button kind="quiet" title="Connect to chat" onPress={onConnect} />
        )}
        {signing ? <T v="small" accessibilityLiveRegion="polite">Sign once to chat</T> : null}
        {error ? <T v="small" color={C.down} accessibilityLiveRegion="polite">{error}</T> : null}
      </View>
    </View>
  );
});

const Gap = () => <View style={{ height: 14 }} />;

/** One line, read as one: sender, their top title tag (with `tags`, once the store has their
 *  XP row), time, text. */
function Row({ row, me, size, tags }) {
  const xp = useStore(store, (s) => (tags ? s.xp?.[row.wallet] : undefined));
  const main = mainTitleOf(xp);
  const label = [shortWallet(row.wallet), main && tagText(main.title, main.level), hhmm(row.at), readableChat(row.text)]
    .filter(Boolean)
    .join(", ");
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: "row", gap: 10 }}>
      <Face wallet={row.wallet} size={size} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T v="small" color={me ? C.gold : C.text1} style={{ fontFamily: F.medium }}>{shortWallet(row.wallet)}</T>
          {main ? <TitleTag title={main.title} level={main.level} /> : null}
          <T v="small" color={C.text2}>{hhmm(row.at)}</T>
        </View>
        <ChatText text={row.text} />
      </View>
    </View>
  );
}
