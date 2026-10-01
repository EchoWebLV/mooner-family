// One launched coin in the Launched list: its picture and ticker, its market cap and price.
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { CoinImage } from "../ui/CoinImage";
import { Card, Pill, T } from "../ui/kit";
import { C, F } from "../ui/theme";
import { capText, priceText } from "./coin";

/** `row`: a `launched` row; `solUsd`: store.solUsd (0 until known). Until its pool is read
 *  (`pool` null) the right side says so instead of numbers. Once migrated, the numbers are
 *  the ones at migration (the DBC price stops there) and say so. A row with no coin draws
 *  nothing. */
export function CoinRow({ row, solUsd, onPress }) {
  const token = row.token;
  if (!token) return null;
  const sqrt = row.pool?.sqrtPrice;
  const migrated = !!row.pool?.migrated;
  const cap = sqrt ? capText(sqrt, solUsd) : null;
  const label = `$${token.symbol}, ${cap ? `market cap ${cap}${migrated ? " at migration" : ""}` : "pool loading"}`;
  return (
    <Card
      accessibilityLabel={label}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <CoinImage uri={token.image} size={40} ticker={token.symbol} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T v="h2" numberOfLines={1} style={{ flexShrink: 1 }}>{`$${token.symbol}`}</T>
            {migrated ? <Pill text="Migrated" color={C.migrated} /> : null}
          </View>
          <T v="small" numberOfLines={1}>{token.name}</T>
        </View>
        {sqrt ? (
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <T v="num">{cap}</T>
            <T v="small" style={{ fontFamily: F.mono }}>{priceText(sqrt)}</T>
            {migrated ? <T v="small" color={C.text2}>At migration</T> : null}
          </View>
        ) : (
          <T v="small" color={C.text2}>Pool loading</T>
        )}
      </View>
    </Card>
  );
}
