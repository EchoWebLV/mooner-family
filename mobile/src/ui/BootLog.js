// The loading screen: the logo on a faint grid and a boot log of real checks (boot.js): the
// server's info, a timed RPC call and its slot, and the first presales snapshot. The logo is
// the native splash's image (assets/splash.png, made from assets/mooner.svg) at the splash's
// size and place, centered on the screen, so the hand-over doesn't move it; the grid fades in
// around it and each line rises in below it when the one before it settles. All ok, it holds a moment and fades into the app;
// a failed line turns red and says what broke, with Retry and Open anyway. Cold start only:
// the root shows it once.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import Constants from "expo-constants";
import * as SplashScreen from "expo-splash-screen";
import { useStore } from "zustand";
import { conn, live, store } from "../app";
import { bootLines, bootState, FEED_WAIT_MS, HOLD_MS, shownLines } from "../boot";
import { CheckIcon } from "./icons";
import { Button } from "./kit";
import { Move, useReducedMotion } from "./motion";
import { C, F, S } from "./theme";

const VERSION = Constants.expoConfig?.version ?? "?";
const GRID = 40;
/** app.json's expo-splash-screen imageWidth: the splash image's size in dp, centered on the screen. */
const MARK = 200;
const SPLASH = require("../../assets/splash.png");
const FADE_MS = 300;

/** A timed getEpochInfo through the app's RPC: null while it runs, then { ms, slot } or { error }. */
function useRpcCheck(round) {
  const [rpc, setRpc] = useState(null);
  useEffect(() => {
    let on = true;
    setRpc(null);
    const t0 = Date.now();
    conn.getEpochInfo().then(
      (e) => on && setRpc({ ms: Date.now() - t0, slot: e.absoluteSlot }),
      () => on && setRpc({ error: "not answering" }),
    );
    return () => {
      on = false;
    };
  }, [round]);
  return rpc;
}

/** True once FEED_WAIT_MS has passed in this round. */
function useLate(round) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    const t = setTimeout(() => setLate(true), FEED_WAIT_MS);
    return () => clearTimeout(t);
  }, [round]);
  return late;
}

function Grid({ width, height }) {
  let d = "";
  for (let x = GRID; x < width; x += GRID) d += `M${x} 0V${height}`;
  for (let y = GRID; y < height; y += GRID) d += `M0 ${y}H${width}`;
  return (
    <Move kind="fade" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Path d={d} stroke={C.line} strokeWidth={1} opacity={0.7} />
      </Svg>
    </Move>
  );
}

/** A block cursor that blinks; still under Reduce motion. */
function Cursor() {
  const reduced = useReducedMotion();
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) {
      o.setValue(1);
      return;
    }
    const step = (v) => Animated.timing(o, { toValue: v, duration: 0, delay: 530, useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([step(0), step(1)]));
    loop.start();
    return () => loop.stop();
  }, [o, reduced]);
  return <Animated.View style={{ width: 9, height: 17, marginLeft: 8, backgroundColor: C.up, opacity: o }} />;
}

function Mark({ state }) {
  if (state === "ok") return <CheckIcon color={C.up} size={16} />;
  if (state === "fail") return <Text style={[styles.line, { color: C.down, width: 16, textAlign: "center" }]}>×</Text>;
  return <Text style={[styles.line, { color: C.text2, width: 16, textAlign: "center" }]}>›</Text>;
}

function Line({ line, last }) {
  const color = line.state === "fail" ? C.down : line.state === "wait" ? C.text1 : C.text0;
  return (
    <Move kind="rise" style={styles.row}>
      <Mark state={line.state} />
      <Text style={[styles.line, { color, flexShrink: 1 }]}>{line.text}</Text>
      {last ? <Cursor /> : null}
    </Move>
  );
}

/** The loading screen over the app; `onDone` once it has faded out. */
export function BootLog({ onDone }) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState(null); // the screen this covers, from layout
  const [round, setRound] = useState(0);
  const rpc = useRpcCheck(round);
  const feedLate = useLate(round);
  const s = useStore(store, (x) => x);
  const lines = bootLines({
    version: VERSION, info: s.info, infoError: s.infoError, rpc,
    loaded: s.loaded.presales, feedError: s.feedError.presales, presales: s.presales, feedLate,
  });
  const shown = shownLines(lines);
  const state = bootState(lines);

  // the native splash goes once this has drawn its logo where the splash has it
  useEffect(() => {
    if (size) SplashScreen.hideAsync().catch(() => {});
  }, [size]);

  const fade = useRef(new Animated.Value(1)).current;
  const leaving = useRef(false);
  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    Animated.timing(fade, { toValue: 0, duration: FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone());
  };

  useEffect(() => {
    if (state !== "ok") return;
    const t = setTimeout(leave, HOLD_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const retry = () => {
    if (!s.info) store.getState().loadInfo();
    if (!s.loaded.presales) live.restart();
    setRound((r) => r + 1);
  };

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.screen, { opacity: fade }]}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
    >
      {size ? (
        <>
          <Grid width={size.width} height={size.height} />
          <Image source={SPLASH} accessibilityLabel="Mooner" style={[styles.mark, { top: size.height / 2 - MARK / 2, left: size.width / 2 - MARK / 2 }]} />
          <View
            style={[styles.log, { top: size.height / 2 + MARK / 2 + 8, width: Math.min(360, size.width - 2 * S.gutter), left: Math.max(S.gutter, (size.width - 360) / 2) }]}
            accessibilityLiveRegion="polite"
          >
            {shown.map((l, i) => (
              <Line key={l.id} line={l} last={i === shown.length - 1 && state !== "fail"} />
            ))}
          </View>
        </>
      ) : null}
      {state === "fail" ? (
        <Move kind="rise" style={[styles.actions, { paddingBottom: insets.bottom + 24 }]}>
          <Button title="Retry" onPress={retry} />
          <Button title="Open anyway" kind="quiet" onPress={leave} />
        </Move>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: C.bg0, zIndex: 10 },
  mark: { position: "absolute", width: MARK, height: MARK },
  log: { position: "absolute", gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  line: { fontFamily: F.mono, fontSize: 15 },
  actions: { position: "absolute", left: S.gutter, right: S.gutter, bottom: 0, gap: 10 },
});
