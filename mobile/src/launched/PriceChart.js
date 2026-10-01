// The coin screen's price chart: the candles the server pushes on `coin:<mint>`, with the
// pool's live price as the last point.
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { priceFromSqrt } from "../../../engine/src/views.js";
import { Card, T } from "../ui/kit";
import { C } from "../ui/theme";
import { changeText, chartPath, emptyChartText, pctOf, pointsOf, SOURCES, spanText } from "./chart";

const HEIGHT = 160;

/** `stats`: the coin's stats (undefined until the first snapshot); `missing`: the server has
 *  no stats for this coin; `error`: its words when the last read failed; `sqrtPrice`: the
 *  pool's live price, or null when there's none (a migrated coin whose DAMM v2 pool isn't
 *  found yet: its DBC price stopped at migration). */
export function PriceChart({ stats, missing, error, sqrtPrice }) {
  const [width, setWidth] = useState(0);
  // the live point sits at the time this screen heard the price (or the stats) last
  const [heardAt, setHeardAt] = useState(Date.now);
  useEffect(() => setHeardAt(Date.now()), [sqrtPrice, stats]);
  const live = sqrtPrice ? priceFromSqrt(sqrtPrice) : null;
  const pts = useMemo(() => pointsOf(stats?.candles, live, heardAt), [stats, live, heardAt]);
  const path = useMemo(() => (width > 0 ? chartPath(pts, width, HEIGHT) : null), [pts, width]);
  // the change's text and its color come from the same rounding: "0%" is never red
  const pct = path ? pctOf(path.change) : null;
  const change = path ? changeText(path.change) : null;
  const color = pct != null && pct < 0 ? C.down : C.up;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <T v="label">Chart</T>
        {path ? <T v="num" color={color}>{change ? `${change} · ${spanText(pts[0].t, heardAt)}` : spanText(pts[0].t, heardAt)}</T> : null}
      </View>
      <View style={{ height: HEIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {path ? (
          <Svg width={width} height={HEIGHT}>
            <Defs>
              <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.25} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={path.area} fill="url(#chartFill)" />
            <Path d={path.line} stroke={color} strokeWidth={2} strokeLinejoin="round" fill="none" />
          </Svg>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <T v="small" color={C.text2}>{emptyChartText({ missing, stats, error })}</T>
          </View>
        )}
      </View>
      {stats?.source ? <T v="small" color={C.text2}>{`Candles from ${SOURCES[stats.source] ?? stats.source}`}</T> : null}
      {error ? <T v="small" color={C.down}>{error}</T> : null}
    </Card>
  );
}
