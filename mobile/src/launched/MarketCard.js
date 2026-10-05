// One launched coin in Pulse's Final Stretch or Migrated lane: its coin, market cap and price,
// and its curve to migration, or Migrated.
import { memo } from "react";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { CoinImage } from "../ui/CoinImage";
import { FillBar } from "../ui/FillBar";
import { Card, Pill, T } from "../ui/kit";
import { C, F } from "../ui/theme";
import { atMigration, capText, curveOf, priceText } from "./coin";

/** `row`: a `launched` row; `solUsd`: store.solUsd (0 until known). Until its pool is read
 *  (`pool` null) it says "Pool loading" instead of numbers. Once migrated, the numbers are
 *  the ones at migration until the server has found the coin's DAMM v2 pool (coin.js
 *  atMigration), and the card says so. A row with no coin draws nothing. `onPress(presale)`
 *  gets the row's key, so one stable function serves every card: the card is memoized and
 *  skips a render when none of its props changed (the store replaces only the rows a push
 *  changes). */
export const MarketCard = memo(function MarketCard({ row, solUsd, onPress }) {
  const token = row.token;
  if (!token) return null;
  const pool = row.pool;
  const sqrt = pool?.sqrtPrice;
  const old = atMigration(pool);
  const cap = sqrt ? capText(sqrt, solUsd) : null;
  const curve = pool && !pool.migrated ? curveOf(pool) : null;
  const label =
    `$${token.symbol}, ${cap ? `market cap ${cap}${old ? " at migration" : ""}` : "pool loading"}` +
    (curve ? `, ${curve.text}` : pool?.migrated ? ", migrated" : "");
  return (
    <Card
      accessibilityLabel={label}
      style={{ padding: 12 }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.(row.presale);
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <CoinImage uri={token.image} size={40} ticker={token.symbol} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <T v="body" numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.semi }}>{token.name}</T>
            {cap ? <T v="num" style={{ fontSize: 14 }}>{cap}</T> : <T v="small" color={C.text2}>Pool loading</T>}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <T v="small" numberOfLines={1} style={{ fontFamily: F.mono, flexShrink: 1 }}>{`$${token.symbol}`}</T>
            {sqrt ? <T v="small" style={{ fontFamily: F.mono }}>{priceText(sqrt)}</T> : null}
          </View>
        </View>
      </View>
      {pool?.migrated ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <Pill text="Migrated · DAMM v2" color={C.migrated} />
          {old ? <T v="small" color={C.text2}>At migration</T> : null}
        </View>
      ) : curve ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <FillBar fill={curve.fill} color={C.migrated} />
          </View>
          <T v="small" color={C.migrated} style={{ fontFamily: F.mono }}>{curve.text}</T>
        </View>
      ) : null}
    </Card>
  );
});
