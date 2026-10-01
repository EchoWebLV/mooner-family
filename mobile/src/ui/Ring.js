import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { C } from "./theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

/** A progress ring: an arc from 12 o'clock, clockwise, `fill` (0..1) of the way round. It
 *  animates to a new fill over 600 ms. `children` sit centred inside. */
export function Ring({ size = 240, stroke = 14, fill = 0, color = C.er, children }) {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  // One Animated.Value for the life of the ring, holding the fill (0..1).
  const animRef = useRef(null);
  if (animRef.current === null) animRef.current = new Animated.Value(clamp01(fill));
  const anim = animRef.current;
  useEffect(() => {
    const run = Animated.timing(anim, { toValue: clamp01(fill), duration: 600, useNativeDriver: false });
    run.start();
    return () => run.stop(); // a newer fill, or the ring unmounting, ends the running animation
  }, [fill, anim]);
  const offset = useMemo(() => anim.interpolate({ inputRange: [0, 1], outputRange: [circ, 0] }), [anim, circ]);
  // At exactly 0 a round cap on a zero-length dash can draw a dot, so the arc fades in over the first 0.1%.
  const opacity = useMemo(() => anim.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, 1, 1] }), [anim]);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${c}, ${c}`}>
          <Circle cx={c} cy={c} r={r} stroke={C.wellLine} strokeWidth={stroke} fill="none" />
          <AnimatedCircle
            cx={c} cy={c} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
            strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset} strokeOpacity={opacity}
          />
        </G>
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>{children}</View>
    </View>
  );
}
