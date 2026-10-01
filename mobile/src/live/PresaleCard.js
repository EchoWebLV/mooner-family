// One open presale in the Live list: its coin, the time left, how full the pool is, who's in.
import { useState } from "react";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { fillOf, whoIsIn } from "../../../engine/src/views.js";
import { CoinImage } from "../ui/CoinImage";
import { Faces } from "../ui/Face";
import { FillBar } from "../ui/FillBar";
import { solText } from "../ui/format";
import { Card, T } from "../ui/kit";
import { Countdown, timeUp } from "./Countdown";

/** `view`: a `presales` list item; `info`: store.info (numbers in info.N). `profiles`
 *  (wallet -> Mooner picture traits) is taken for the faces, which draw only the fallback
 *  for now. A view with no coin (no `token`) draws nothing. Past its deadline the card dims
 *  and stays tappable: the presale's own screen says why it can't be joined. */
export function PresaleCard({ view, info, profiles, onPress }) {
  const [up, setUp] = useState(() => timeUp(view.deadlineTs, Date.now()));
  const token = view.token;
  if (!token) return null;
  const wallets = whoIsIn(view).map((r) => r.user);
  return (
    <View style={up ? { opacity: 0.5 } : null}>
      <Card
        accessibilityLabel={`$${token.symbol}, ${solText(view.raised)} of ${solText(info.N.TARGET)} SOL`}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress?.();
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <CoinImage uri={token.image} size={44} ticker={token.symbol} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T v="h2" numberOfLines={1}>{`$${token.symbol}`}</T>
            <T v="small" numberOfLines={1}>{token.name}</T>
          </View>
          <Countdown deadlineTs={view.deadlineTs} onTimeUp={setUp} />
        </View>
        <View style={{ marginTop: 14, gap: 10 }}>
          <FillBar fill={fillOf(view, info.N)} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <T v="num">{`${solText(view.raised)} / ${solText(info.N.TARGET)} SOL`}</T>
            <Faces wallets={wallets} size={24} />
          </View>
        </View>
      </Card>
    </View>
  );
}
