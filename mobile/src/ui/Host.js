// The Mooner host: its picture and a light bubble that pops in and types its line, 18 ms a
// character (moves.js). A new line pops and types again, and plays `host` once.
import { useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import { T } from "./kit";
import { Move, useReducedMotion } from "./motion";
import { TYPE_MS, typedText } from "./moves";
import { play } from "./sound";
import { C, F } from "./theme";

const HOST = require("../../assets/host.png");

/** `line`: what the host says (nothing draws without one). `sound`: false keeps it quiet,
 *  for a screen whose own cues are playing. */
export function Host({ line, sound = true }) {
  const full = line ?? "";
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? full : "");
  const said = useRef(null);

  useEffect(() => {
    if (sound && full && said.current !== full) {
      said.current = full;
      play("host");
    }
    if (reduced) {
      setShown(full);
      return;
    }
    const start = Date.now();
    setShown("");
    const t = setInterval(() => {
      const next = typedText(full, Date.now() - start);
      setShown(next);
      if (next === full) clearInterval(t);
    }, TYPE_MS);
    return () => clearInterval(t);
  }, [full, reduced, sound]);

  if (!full) return null;
  const text = { fontFamily: F.bold, fontSize: 13, lineHeight: 17 };
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
      <Image source={HOST} resizeMode="contain" style={{ width: 40, height: 48 }} />
      <Move kind="pop" key={full} style={{ flex: 1, transformOrigin: "left bottom" }}>
        <View
          accessible
          accessibilityLabel={full}
          style={{
            backgroundColor: C.text0, paddingHorizontal: 13, paddingVertical: 9,
            borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 4,
          }}
        >
          {/* the whole line, unseen, holds the bubble's size while it types */}
          <T color={C.bg0} style={[text, { opacity: 0 }]}>{full}</T>
          <T color={C.bg0} style={[text, { position: "absolute", left: 13, right: 13, top: 9 }]}>{shown}</T>
        </View>
      </Move>
    </View>
  );
}
