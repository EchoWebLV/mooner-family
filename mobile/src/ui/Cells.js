// The pool as 10 cells (room.js cellsOf), all in C.up once it's full.
import { View } from "react-native";
import { cellsOf } from "../room/room";
import { C } from "./theme";

/** `raised`, `target`: lamports. `color`: the cells' fill until the pool is full. */
export function Cells({ raised, target, color = C.er, height = 8 }) {
  const cells = cellsOf(raised, target);
  const fill = cells.every((f) => f === 1) ? C.up : color;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", gap: 3 }}>
      {cells.map((f, i) => (
        <View
          key={i}
          style={{
            flex: 1, height, borderRadius: 2, backgroundColor: C.well, borderWidth: 1, borderColor: C.wellLine,
            overflow: "hidden",
          }}
        >
          <View style={{ width: `${f * 100}%`, height: "100%", backgroundColor: fill }} />
        </View>
      ))}
    </View>
  );
}
