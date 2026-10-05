// Emojis from chat lines that arrive float up over a scene (spec §3): up to FLOAT_MAX from a
// line, all lines' emojis in one queue (chat.js floatStep), so they start one at a time
// FLOAT_GAP_MS apart, at most FLOATS_FLYING in flight and FLOATS_WAITING waiting (the oldest
// waiting are dropped). Each start plays the `emoji` cue, at most one every
// CHAT_SOUND_GAP_MS. With Reduce motion they fade in and out where they start.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { CHAT_SOUND_GAP_MS, chatGate } from "../../../engine/src/cues.js";
import { EMOJI_FILES } from "../ui/emojis";
import { useReducedMotion } from "../ui/motion";
import { play } from "../ui/sound";
import { floatStep, queueFloats } from "./chat";
import { useNewLines } from "./useNewLines";

const FLOAT_MS = 2200;
const RISE = 160;
const SIZE = 40;

/** Fills its parent; touches pass through. `channel`: the presale's chat. `on`: false while
 *  the scene is covered (a sheet, the launch moment), so nothing floats unseen: lines then are
 *  skipped and the waiting emojis dropped. */
export function FloatingEmojis({ channel, on = true }) {
  const reduced = useReducedMotion();
  const [floats, setFloats] = useState([]);
  const nextId = useRef(0);
  const q = useRef({ queue: [], last: -Infinity });
  const timer = useRef(null);
  const flying = useRef(0);
  const [gate] = useState(() => chatGate(CHAT_SOUND_GAP_MS)); // the emoji cue's own gate

  const step = useCallback(() => {
    timer.current = null;
    const now = Date.now();
    const r = floatStep(q.current, now, flying.current);
    q.current = { queue: r.queue, last: r.last };
    if (r.start) {
      flying.current += 1;
      const id = nextId.current++;
      const name = r.start;
      setFloats((f) => [...f, { id, name, x: 0.15 + Math.random() * 0.7 }]);
      if (gate(now)) play("emoji");
    }
    if (r.wait != null) timer.current = setTimeout(step, r.wait);
  }, [gate]);

  // `on` turning false (or a new channel, or leaving) drops what waits, so nothing starts
  // under a sheet; floats already in flight finish.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      timer.current = null;
      q.current = { queue: [], last: q.current.last };
    },
    [on, channel],
  );

  const onLine = useCallback(
    (row) => {
      if (!on) return;
      q.current = { ...q.current, queue: queueFloats(q.current.queue, row.text) };
      if (!timer.current) step();
    },
    [on, step],
  );
  useNewLines(channel, onLine);
  const done = useCallback((id) => {
    flying.current -= 1;
    setFloats((f) => f.filter((x) => x.id !== id));
  }, []);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {floats.map((f) => (
        <Float key={f.id} id={f.id} name={f.name} x={f.x} rise={reduced ? 0 : RISE} onDone={done} />
      ))}
    </View>
  );
}

/** Memo: a float that starts or ends re-renders only itself. */
const Float = memo(function Float({ id, name, x, rise, onDone }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(t, { toValue: 1, duration: FLOAT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
    run.start(({ finished }) => {
      if (finished) onDone(id);
    });
    return () => run.stop();
  }, [t, id, onDone]);
  const style = useMemo(
    () => ({
      position: "absolute", bottom: 12, left: `${x * 100}%`, marginLeft: -SIZE / 2, width: SIZE, height: SIZE,
      opacity: t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
      transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) }],
    }),
    [t, x, rise],
  );
  return <Animated.Image source={EMOJI_FILES[name]} style={style} />;
});
