// One open presale in the Live list: its coin, the time left, how full the pool is, who's in.
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { clock, fillOf, secondsLeft, whoIsIn } from "../../../engine/src/views.js";
import { CoinImage } from "../ui/CoinImage";
import { Faces } from "../ui/Face";
import { FillBar } from "../ui/FillBar";
import { solText } from "../ui/format";
import { Card, T } from "../ui/kit";
import { C } from "../ui/theme";

/** Under this many seconds left, the clock turns C.warn. */
const WARN_UNDER = 5 * 60;

/** `view`: a `presales` list item; `info`: store.info (numbers in info.N); `now`: ms.
 *  `profiles` (wallet -> Mooner picture traits) is taken for the faces, which draw only the
 *  fallback for now. A view with no coin (no `token`) draws nothing. */
export function PresaleCard({ view, info, profiles, now, onPress }) {
  const token = view.token;
  if (!token) return null;
  const left = secondsLeft(view, now);
  const wallets = whoIsIn(view).map((r) => r.user);
  return (
    <Card
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
        <T v="num" color={left < WARN_UNDER ? C.warn : C.text0}>{clock(left)}</T>
      </View>
      <View style={{ marginTop: 14, gap: 10 }}>
        <FillBar fill={fillOf(view, info.N)} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <T v="num">{`${solText(view.raised)} / ${solText(info.N.TARGET)} SOL`}</T>
          <Faces wallets={wallets} size={24} />
        </View>
      </View>
    </Card>
  );
}
