// Launching: it slides up after the 3-2-1 with `whoosh` (or opens here when the room opened
// late, the room's own whoosh already played). The launching scene zooms out slowly, the coin
// chip, the room's chat over the scene, and the four steps: `step` as each ticks done, `tick`
// as "N to go" goes down.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CoinImage } from "../ui/CoinImage";
import { Host } from "../ui/Host";
import { CheckIcon } from "../ui/icons";
import { Button, Card, T } from "../ui/kit";
import { Move } from "../ui/motion";
import { Scene } from "../ui/Scene";
import { isArmed, play } from "../ui/sound";
import { C, F, R, S } from "../ui/theme";
import { ChatLines } from "./ChatLines";
import { FloatingEmojis } from "./FloatingEmojis";

const SCENE_H = 340;
/** One step ticks at a time: the pool and the one buy land in one transaction, and the buy
 *  ticks right after the pool. */
const STEP_GAP_MS = 350;
const HOST_LINE = "Your tokens come to you. Nothing to sign.";
const CHIP = `${C.bg0}bd`;
/** The moment's own cues stay quiet until the app is touched (a room opened by a link). */
const cue = (name) => {
  if (isArmed()) play(name);
};

/** How many steps from the top are done. */
const doneFromTop = (steps) => {
  const i = steps.findIndex((s) => s.state !== "done");
  return i === -1 ? steps.length : i;
};

/** `steps`: launchSteps(...) for the presale. `late`: the room opened while it was already
 *  launching; the steps done by then show ticked at once. After the 3-2-1, the steps that
 *  landed during it tick in one by one. `again`: this screen showed before (the room is back
 *  in front): the steps done show ticked at once, and no whoosh or host sound. Read once, as
 *  it opens. */
export function MomentLaunching({ view, steps, late, again, onClose }) {
  const insets = useSafeAreaInsets();
  const [first] = useState(() => !late && !again); // straight from the 3-2-1
  const [quietHost] = useState(() => !!again);
  const target = doneFromTop(steps.steps);
  // the steps shown done; then one more every STEP_GAP_MS until they match the chain
  const [shown, setShown] = useState(() => (first ? Math.min(target, 1) : target));
  useEffect(() => {
    if (shown > target) {
      setShown(target);
      return;
    }
    if (shown === target) return;
    const t = setTimeout(() => {
      setShown((n) => n + 1);
      cue("step");
    }, STEP_GAP_MS);
    return () => clearTimeout(t);
  }, [shown, target]);

  useEffect(() => {
    if (first) cue("whoosh");
  }, [first]);

  // `tick` when "N to go" goes down and some are still to go (the last one ticks the step)
  const toGo = useRef(steps.toGo);
  useEffect(() => {
    const was = toGo.current;
    toGo.current = steps.toGo;
    if (was != null && steps.toGo != null && steps.toGo < was && steps.toGo > 0) cue("tick");
  }, [steps.toGo]);

  const ticker = view.token?.symbol ?? "";
  return (
    <Move kind="slideUp" style={{ flex: 1 }}>
      <Scene name="launching" motion="kenBurns" height={SCENE_H}>
        <View style={{ flex: 1, paddingTop: insets.top + 12, paddingHorizontal: S.gutter, paddingBottom: 10, justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View
              style={{
                flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: CHIP,
                borderRadius: R.pill, paddingVertical: 4, paddingLeft: 4, paddingRight: 12,
              }}
            >
              <CoinImage uri={view.token?.image} size={28} ticker={ticker} />
              <T v="num" style={{ fontSize: 14 }}>{ticker ? `$${ticker}` : "Presale"}</T>
            </View>
            <T v="label" color={C.text0}>Launching on Meteora</T>
          </View>
          <ChatLines channel={view.presale} />
        </View>
        <FloatingEmojis channel={view.presale} />
      </Scene>
      <View style={{ flex: 1, paddingHorizontal: S.gutter, paddingTop: 12, gap: 12 }}>
        <Card style={{ gap: 12 }}>
          {steps.steps.map((s, i) => (
            <Move key={i} kind="rise" delay={i * 90}>
              <StepRow label={s.label} state={i < shown ? "done" : i === shown && !steps.failed ? "now" : "todo"} />
            </Move>
          ))}
        </Card>
      </View>
      <View style={{ paddingHorizontal: S.gutter, paddingBottom: insets.bottom + 16, gap: 12 }}>
        <Host line={HOST_LINE} sound={!quietHost && isArmed()} />
        <Button kind="quiet" title="Close" onPress={onClose} />
      </View>
    </Move>
  );
}

/** A step's state as a screen reader says it. */
const STATE_SAID = { done: "done", now: "in progress", todo: "to do" };

/** A step: a tick that pops in when done, a spinner while it's the one going on, else a dot. */
function StepRow({ label, state }) {
  const color = state === "todo" ? C.text2 : C.text0;
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${STATE_SAID[state]}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 24 }}
    >
      <View style={{ width: 20, alignItems: "center" }}>
        {state === "done" ? (
          <Move kind="pop">
            <CheckIcon color={C.up} size={16} />
          </Move>
        ) : state === "now" ? (
          <ActivityIndicator size="small" color={C.text1} />
        ) : (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.lineStrong }} />
        )}
      </View>
      <T v="body" color={color} style={{ flex: 1, fontFamily: state === "now" ? F.medium : F.regular }}>{label}</T>
    </View>
  );
}
