// Chat: Everyone (the server's global channel) and a room for each of your presales whose
// coin is known. Showing Everyone clears Pulse's unread dot. `chat` plays for a new line, at
// most one every 400 ms, while this screen is in front.
import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { chatGate } from "../../engine/src/cues.js";
import { store } from "../src/app";
import { roomsOf } from "../src/chat/rooms";
import { ChatPane, useComposer } from "../src/room/ChatPane";
import { useNewLines } from "../src/room/useNewLines";
import { ChipRow } from "../src/ui/ChipRow";
import { BackGlass, SceneHeader } from "../src/ui/Glass";
import { play } from "../src/ui/sound";
import { C, S } from "../src/ui/theme";
import { useAppActive } from "../src/ui/useAppActive";
import { useSigner } from "../src/wallet";

/** The rooms as a string: the screen re-renders when the list changes, not for every
 *  presale, launch or view update under it. */
const roomsKey = (s) =>
  JSON.stringify(roomsOf({ wallet: s.wallet, presales: s.presales, views: s.views, launched: s.launched, mine: s.mine }));

export default function Chat() {
  const wallet = useStore(store, (s) => s.wallet);
  const key = useStore(store, roomsKey);
  const signer = useSigner();
  const insets = useSafeAreaInsets();
  const rooms = useMemo(() => JSON.parse(key), [key]);
  const chips = useMemo(() => rooms.map((r) => ({ key: r.channel, label: r.label, image: r.image })), [rooms]);

  // a room that leaves the list (another wallet, a presale gone) falls back to Everyone, and
  // the pick goes with it: the room coming back doesn't open with no tap
  const [picked, setPicked] = useState("global");
  const listed = rooms.some((r) => r.channel === picked);
  const channel = listed ? picked : "global";
  useEffect(() => {
    if (!listed) setPicked("global");
  }, [listed]);
  useEffect(() => store.getState().watchChat(channel), [channel]);

  const focused = useIsFocused();
  const active = useAppActive();
  const heard = focused && active;
  // Everyone in front: every line in it is seen, those there now and each one as it comes
  // (watched here, so a line doesn't re-render the screen for it)
  useEffect(() => {
    if (channel !== "global" || !heard) return;
    const { seeChat } = store.getState();
    seeChat();
    return store.subscribe((s, prev) => {
      if (s.chats.global !== prev.chats.global) seeChat();
    });
  }, [channel, heard]);

  const [chatSound] = useState(() => chatGate());
  const onLine = useCallback(() => {
    if (heard && chatSound(Date.now())) play("chat");
  }, [heard, chatSound]);
  useNewLines(channel, onLine);

  const composer = useComposer(channel, signer);
  const connect = useCallback(() => router.push("/connect"), []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <SceneHeader name="room" height={150} title="Chat" left={<BackGlass />} />
      <ChipRow items={chips} value={channel} onPick={setPicked} />
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: S.gutter, paddingBottom: insets.bottom + 12 }}>
          <ChatPane channel={channel} wallet={wallet} composer={composer} onConnect={connect} faceSize={32} tags />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
