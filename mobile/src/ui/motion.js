// Plays moves.js with core Animated on the native driver (opacity and transform only).
// `Move` runs its move once, when it mounts or its `kind` changes; give it a new `key` to
// run it again for new content. Reduce motion turns every entrance into a fade. A change to
// Reduce motion never replays a move: it applies to moves that start after it (a finished
// move ends in the same place either way).
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { moveFor } from "./moves";

let reducedNow = false;
const listeners = new Set();
let watching = false;

function setReduced(v) {
  reducedNow = !!v;
  listeners.forEach((l) => l(reducedNow));
}

function startWatching() {
  if (watching) return;
  watching = true;
  AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => {});
  AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
}

/** Whether Android's Reduce motion is on, kept up to date. */
export function useReducedMotion() {
  const [reduced, setLocal] = useState(reducedNow);
  useEffect(() => {
    startWatching();
    listeners.add(setLocal);
    setLocal(reducedNow);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);
  return reduced;
}

/** Its children, moving in once: `kind` is fade, rise, pop, stamp, slideUp, kenBurns or lift
 *  (moves.js); `delay` in ms. */
export function Move({ kind = "rise", delay = 0, style, children, pointerEvents }) {
  const reduced = useReducedMotion();
  const m = moveFor(kind, reduced);
  const tRef = useRef(null);
  if (!tRef.current) tRef.current = new Animated.Value(m.ms === 0 ? 1 : 0);
  const t = tRef.current;

  useEffect(() => {
    if (m.ms === 0) {
      t.setValue(1);
      return;
    }
    t.setValue(0);
    const run = Animated.timing(t, {
      toValue: 1,
      duration: m.ms,
      delay,
      easing: Easing.bezier(...m.ease),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, kind, delay]);

  const range = (a, b, clamp) =>
    t.interpolate({ inputRange: [0, 1], outputRange: [a, b], extrapolate: clamp ? "clamp" : "extend" });
  const moving = {
    opacity: range(m.from.opacity, m.to.opacity, true),
    transform: [{ translateY: range(m.from.y, m.to.y, false) }, { scale: range(m.from.scale, m.to.scale, false) }],
  };
  return (
    <Animated.View pointerEvents={pointerEvents} style={[style, moving]}>
      {children}
    </Animated.View>
  );
}

const faded = new Set();

/** Fades in the first time `id` shows while the app runs, and never again: Pulse's cards
 *  fade in once, not each time a list re-renders or the lane is swiped back to. */
export function FadeOnce({ id, style, children }) {
  const [fresh] = useState(() => !faded.has(id));
  useEffect(() => {
    faded.add(id);
  }, [id]);
  if (!fresh) return <View style={style}>{children}</View>;
  return (
    <Move kind="fade" style={style}>
      {children}
    </Move>
  );
}
