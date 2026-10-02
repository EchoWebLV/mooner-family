// The wallet's coins whose presale never opened (the open failed or was cancelled): each
// opens from here without signing its details again.
import { View } from "react-native";
import { CoinImage } from "../ui/CoinImage";
import { Card, PillButton, T } from "../ui/kit";

/** `tokens`: rules.js unopenedOf(...); `onOpen(token)`. */
export function Unopened({ tokens, onOpen }) {
  return (
    <Card style={{ gap: 12 }}>
      <T v="label" accessibilityRole="header">Not opened yet</T>
      {tokens.map((t) => (
        <View key={t.mint} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <CoinImage uri={t.image} size={40} ticker={t.symbol} />
          <View style={{ flex: 1 }}>
            <T numberOfLines={1}>{t.name}</T>
            <T v="small">{`$${t.symbol}`}</T>
          </View>
          <PillButton title="Open" accessibilityLabel={`Open the $${t.symbol} presale`} onPress={() => onOpen(t)} />
        </View>
      ))}
    </Card>
  );
}
