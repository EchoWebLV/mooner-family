// The room's chat: slides up from the bottom, newest at the bottom, live from the socket.
import { memo, useCallback } from "react";
import { View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Sheet } from "../ui/kit";
import { ChatPane, useComposer } from "./ChatPane";

/** `channel`: the presale key; `wallet`: the connected wallet (base58) or null. Memo: the
 *  room re-renders every second for its clock, the chat needn't. */
export const ChatSheet = memo(function ChatSheet({ open, onClose, channel, wallet, signer }) {
  const { height } = useWindowDimensions();
  const composer = useComposer(channel, signer);
  const connect = useCallback(() => {
    onClose();
    router.push("/connect");
  }, [onClose]);
  return (
    <Sheet open={open} onClose={onClose} title="Chat">
      <View style={{ height: Math.round(height * 0.8) - 110, flexShrink: 1, minHeight: 160 }}>
        <ChatPane channel={channel} wallet={wallet} composer={composer} onConnect={connect} />
      </View>
    </Sheet>
  );
});
