// The Mooner host: its picture and a light bubble that pops in and types its line, 18 ms a
// character (moves.js). A new line pops and types again, and plays `host` once. Only a new
// line types: a change to Reduce motion or `sound` never retypes the line on screen.
import { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
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
  // read when a line starts, so a change to either doesn't start it again
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    if (soundRef.current && full && said.current !== full) {
      said.current = full;
      play("host");
    }
    if (reducedRef.current) {
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
  }, [full]);

  if (!full) return null;
  // for the render before a new line's effect resets `shown`, the old line's text never shows
  const typed = full.startsWith(shown) ? shown : "";
  const text = { fontFamily: F.bold, fontSize: 13, lineHeight: 17 };
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
      <Image source={HOST} resizeMode="contain" style={{ width: 40, height: 48 }} />
      <Move kind="pop" key={full} style={{ flex: 1, transformOrigin: "left bottom" }}>
        <View
          accessible
          accessibilityLabel={full}
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: C.text0, paddingHorizontal: 13, paddingVertical: 9,
            borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 4,
          }}
        >
          {/* the whole line is laid out from the start, its untyped rest unseen, so the
              bubble keeps its size and no word jumps to the next line as it types */}
          <T color={C.bg0} maxFontSizeMultiplier={1.3} style={text}>
            {typed}
            <Text style={{ color: "transparent" }}>{full.slice(typed.length)}</Text>
          </T>
        </View>
      </Move>
    </View>
  );
}
