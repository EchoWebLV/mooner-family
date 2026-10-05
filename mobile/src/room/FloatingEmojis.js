// Emojis from chat lines that arrive float up over a scene (spec §3): up to FLOAT_MAX from a
// line, FLOAT_GAP_MS apart. Quiet (the `emoji` cue is your own pick). With Reduce motion
// they fade in and out where they start.
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { FLOAT_GAP_MS, FLOAT_MAX } from "../../../engine/src/cues.js";
import { emojisIn } from "../../../engine/src/emoji.js";
import { EMOJI_FILES } from "../ui/emojis";
import { useReducedMotion } from "../ui/motion";
import { useNewLines } from "./useNewLines";

const FLOAT_MS = 2200;
const RISE = 160;
const SIZE = 40;

/** Fills its parent; touches pass through. `channel`: the presale's chat. `on`: false while
 *  the scene is covered (a sheet, the launch moment), so nothing floats unseen. */
export function FloatingEmojis({ channel, on = true }) {
  const reduced = useReducedMotion();
  const [floats, setFloats] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Set());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const onLine = useCallback(
    (row) => {
      if (!on) return;
      emojisIn(row.text, FLOAT_MAX).forEach((name, i) => {
        const t = setTimeout(() => {
          timers.current.delete(t);
          const id = nextId.current++;
          setFloats((f) => [...f, { id, name, x: 0.15 + Math.random() * 0.7 }]);
        }, i * FLOAT_GAP_MS);
        timers.current.add(t);
      });
    },
    [on],
  );
  useNewLines(channel, onLine);
  const done = useCallback((id) => setFloats((f) => f.filter((x) => x.id !== id)), []);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {floats.map((f) => (
        <Float key={f.id} id={f.id} name={f.name} x={f.x} rise={reduced ? 0 : RISE} onDone={done} />
      ))}
    </View>
  );
}

function Float({ id, name, x, rise, onDone }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.timing(t, { toValue: 1, duration: FLOAT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
    run.start(({ finished }) => {
      if (finished) onDone(id);
    });
    return () => run.stop();
  }, [t, id, onDone]);
  return (
    <Animated.Image
      source={EMOJI_FILES[name]}
      style={{
        position: "absolute", bottom: 12, left: `${x * 100}%`, marginLeft: -SIZE / 2, width: SIZE, height: SIZE,
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) }],
      }}
    />
  );
}
