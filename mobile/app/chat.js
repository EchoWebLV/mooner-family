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

export default function Chat() {
  const wallet = useStore(store, (s) => s.wallet);
  const presales = useStore(store, (s) => s.presales);
  const views = useStore(store, (s) => s.views);
  const launched = useStore(store, (s) => s.launched);
  const mine = useStore(store, (s) => s.mine);
  const globalRows = useStore(store, (s) => s.chats.global);
  const signer = useSigner();
  const insets = useSafeAreaInsets();
  const rooms = useMemo(() => roomsOf({ wallet, presales, views, launched, mine }), [wallet, presales, views, launched, mine]);
  const chips = useMemo(() => rooms.map((r) => ({ key: r.channel, label: r.label, image: r.image })), [rooms]);

  // a room that leaves the list (another wallet, a presale gone) falls back to Everyone
  const [picked, setPicked] = useState("global");
  const channel = rooms.some((r) => r.channel === picked) ? picked : "global";
  useEffect(() => store.getState().watchChat(channel), [channel]);

  const focused = useIsFocused();
  const active = useAppActive();
  const heard = focused && active;
  // Everyone in front: every line in it is seen
  useEffect(() => {
    if (channel === "global" && heard) store.getState().seeChat();
  }, [channel, heard, globalRows]);

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
