import { View } from "react-native";
import { C, R } from "./theme";

/** A recessed track with a bar `fill` (0..1) of the way across. */
export function FillBar({ fill, color = C.er, height = 6 }) {
  const f = Math.max(0, Math.min(1, Number(fill) || 0));
  return (
    <View
      style={{
        height, borderRadius: R.pill, backgroundColor: C.well, borderWidth: 1, borderColor: C.wellLine,
        overflow: "hidden",
      }}
    >
      <View style={{ width: `${f * 100}%`, height: "100%", backgroundColor: color }} />
    </View>
  );
}
