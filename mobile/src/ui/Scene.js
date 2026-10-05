// A screen's scene: one cozy picture cropped to fill, a veil (darker at the top for the top
// row, bg0 at the bottom) so text over it reads (never a text shadow), and its slow move. A
// picture that won't load leaves bg0 and the screen goes on.
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Move } from "./motion";
import { C } from "./theme";

const SCENES = {
  room: require("../../assets/scenes/room.jpg"),
  launching: require("../../assets/scenes/launching.jpg"),
  live: require("../../assets/scenes/live.jpg"),
};

/** `name`: room, launching or live. `height`: fixed, else it fills its parent. `motion`:
 *  "still", "kenBurns" (launching) or "lift" (live). `dim` (0..1) darkens it under a
 *  moment's text. Children draw on top. */
export function Scene({ name, height, motion = "still", dim = 0, style, children }) {
  const [bad, setBad] = useState(false);
  const picture = bad ? null : (
    <Image source={SCENES[name]} resizeMode="cover" onError={() => setBad(true)} style={StyleSheet.absoluteFill} />
  );
  return (
    <View style={[{ overflow: "hidden", backgroundColor: C.bg0 }, height != null ? { height } : { flex: 1 }, style]}>
      {motion === "still" ? picture : <Move kind={motion} style={StyleSheet.absoluteFill}>{picture}</Move>}
      {dim > 0 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.bg0, opacity: dim }]} /> : null}
      <Veil />
      {children}
    </View>
  );
}

/** Dark at the top (under the top row), clear through the middle, bg0 at the bottom. */
function Veil() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.bg0} stopOpacity="0.6" />
            <Stop offset="0.22" stopColor={C.bg0} stopOpacity="0" />
            <Stop offset="0.45" stopColor={C.bg0} stopOpacity="0" />
            <Stop offset="1" stopColor={C.bg0} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill="url(#veil)" />
      </Svg>
    </View>
  );
}
