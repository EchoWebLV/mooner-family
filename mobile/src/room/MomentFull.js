// POOL FULL: the room's scene dimmed, the stamp, the coin, the pool and the crowd with a tick
// on each face, then 3-2-1 and GO (a haptic each), timed as in the approved demo. Failed: the
// same scene, the copy and Close, quiet.
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CoinImage } from "../ui/CoinImage";
import { solText } from "../ui/format";
import { Host } from "../ui/Host";
import { Button, T } from "../ui/kit";
import { Move } from "../ui/motion";
import { Scene } from "../ui/Scene";
import { isArmed, play } from "../ui/sound";
import { C, F, R, S } from "../ui/theme";
import { Crowd } from "./Crowd";

/** When 3 shows (ms after POOL FULL), the gap to 2 and to 1, GO, and the launching screen. */
const COUNT_AT = 1500;
const COUNT_GAP_MS = 820;
const GO_AT = COUNT_AT + 3 * COUNT_GAP_MS; // 3960
const COUNTED_AT = GO_AT + 650; // 4610
const HOST_LINE = "Nothing to do. I'll bring your tokens to you.";
/** The moment's own cues stay quiet until the app is touched (a room opened by a link). */
const cue = (name) => {
  if (isArmed()) play(name);
};

/** `who`: the crowd. `onCounted`: GO has shown; the launching screen comes next. */
export function MomentFull({ view, who, wallet, N, onCounted }) {
  const insets = useSafeAreaInsets();
  const [count, setCount] = useState(null); // null, then 3, 2, 1, then 0 for GO
  const counted = useRef(onCounted);
  counted.current = onCounted;

  useEffect(() => {
    cue("stamp");
    cue("poolfull");
    const timers = [3, 2, 1].map((n, i) =>
      setTimeout(() => {
        setCount(n);
        cue("count");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      }, COUNT_AT + i * COUNT_GAP_MS),
    );
    timers.push(
      setTimeout(() => {
        setCount(0);
        cue("go");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }, GO_AT),
      setTimeout(() => counted.current(), COUNTED_AT),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const ticker = view.token?.symbol ?? "";
  return (
    <View style={{ flex: 1 }}>
      <Scene name="room" dim={0.55} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, paddingTop: insets.top + 32, paddingHorizontal: S.gutter, alignItems: "center", gap: 18 }}>
        <Move kind="stamp">
          <View style={{ borderWidth: 2, borderColor: C.up, borderRadius: R.m, paddingHorizontal: 16, paddingVertical: 6 }}>
            <T style={{ fontFamily: F.bold, fontSize: 30, letterSpacing: 3 }} color={C.up}>POOL FULL</T>
          </View>
        </Move>
        <Move kind="pop" delay={350}>
          <CoinImage uri={view.token?.image} size={88} ticker={ticker} />
        </Move>
        <Move kind="rise" delay={500} style={{ alignItems: "center", gap: 4 }}>
          {ticker ? <T v="h2">{`$${ticker}`}</T> : null}
          <T v="num" color={C.text1} style={{ fontSize: 13 }}>
            {`${solText(view.raised)} / ${solText(N.TARGET)} SOL · ${who.length === 1 ? "1 wallet" : `${who.length} wallets`}`}
          </T>
        </Move>
        <Move kind="rise" delay={650} style={{ alignSelf: "stretch" }}>
          <Crowd who={who} me={wallet} ticks />
        </Move>
        <View style={{ height: 96, alignItems: "center", justifyContent: "center" }}>
          {count == null ? null : (
            <Move kind="pop" key={count}>
              <T v="bigNum" color={count === 0 ? C.up : C.text0} style={{ fontSize: 72, lineHeight: 84 }}>
                {count === 0 ? "GO" : String(count)}
              </T>
            </Move>
          )}
        </View>
        {count === 0 ? (
          <Move kind="rise">
            <T v="label" color={C.text0}>Launching on Meteora</T>
          </Move>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: S.gutter, paddingBottom: insets.bottom + 24 }}>
        <Host line={HOST_LINE} sound={false} />
      </View>
    </View>
  );
}

/** The launch didn't go through: the copy, the refund line for a seat that was in, Close. */
export function MomentFailed({ refund, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <Scene name="room" dim={0.6} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: S.gutter, gap: 8 }}>
        <Move kind="rise">
          <T v="title" style={{ textAlign: "center" }}>The launch didn't go through.</T>
        </Move>
        {refund ? (
          <Move kind="rise" delay={90}>
            <T v="body" color={C.text1} style={{ textAlign: "center" }}>Your SOL comes back by itself.</T>
          </Move>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: S.gutter, paddingBottom: insets.bottom + 24 }}>
        <Button kind="quiet" title="Close" onPress={onClose} />
      </View>
    </View>
  );
}
