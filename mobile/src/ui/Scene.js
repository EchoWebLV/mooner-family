// A screen's scene: one cozy picture cropped to fill, a veil (darker at the top for the top
// row, bg0 at the bottom) so text over it reads (never a text shadow), and its slow move. A
// picture that won't load leaves bg0 and the screen goes on.
import { useId, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Move } from "./motion";
import { C } from "./theme";

const SCENES = {
  room: require("../../assets/scenes/room.jpg"),
  launching: require("../../assets/scenes/launching.jpg"),
  live: require("../../assets/scenes/live.jpg"),
};
/** Height over width of every scene (720×1080). */
const ASPECT = 1.5;
/** Where each picture's subject sits, from its top (0..1): a short header keeps it in view
 *  (the rocket and planet, the crew at the rocket, the rocket and coins), as the wireframes. */
const FOCUS = { room: 0.3, launching: 0.32, live: 0.24 };

/** The picture's box in a `width`×`height` scene: as wide as the scene or more (cover), and
 *  moved so its `focus` line (FOCUS by default) is at the middle, without showing past its top
 *  or bottom. */
export function coverBox(name, width, height, focus = FOCUS[name]) {
  const w = Math.max(width, height / ASPECT);
  const h = w * ASPECT;
  const top = Math.min(0, Math.max(height - h, height / 2 - focus * h));
  return { position: "absolute", width: w, height: h, left: (width - w) / 2, top };
}

/** `name`: room, launching or live. `height`: fixed, else it fills its parent. `motion`:
 *  "still", "kenBurns" (launching) or "lift" (live). `dim` (0..1) darkens it under a
 *  moment's text. `focus` moves the picture to another line than FOCUS. Children draw on top. */
export function Scene({ name, height, motion = "still", dim = 0, focus, style, children }) {
  const [bad, setBad] = useState(false);
  // An Image takes its file's size unless given one, so it's placed once the scene's is known
  const [size, setSize] = useState(null);
  const picture = bad || !size ? null : (
    <Image source={SCENES[name]} onError={() => setBad(true)} style={coverBox(name, size.width, size.height, focus)} />
  );
  return (
    <View
      style={[{ overflow: "hidden", backgroundColor: C.bg0 }, height != null ? { height } : { flex: 1 }, style]}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
    >
      {motion === "still" ? picture : <Move kind={motion} style={StyleSheet.absoluteFill}>{picture}</Move>}
      {dim > 0 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.bg0, opacity: dim }]} /> : null}
      <Veil />
      {children}
    </View>
  );
}

/** Dark at the top (under the top row), clear through the middle, bg0 at the bottom. */
function Veil() {
  // Its own gradient id: in a browser ids are page-wide, and a hidden screen's would win
  const id = `veil${useId().replace(/\W/g, "")}`;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.bg0} stopOpacity="0.6" />
            <Stop offset="0.22" stopColor={C.bg0} stopOpacity="0" />
            <Stop offset="0.45" stopColor={C.bg0} stopOpacity="0" />
            <Stop offset="1" stopColor={C.bg0} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
