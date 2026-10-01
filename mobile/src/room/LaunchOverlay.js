// The moment the pool fills (spec, "When it fills"): full screen, with haptics, while the coin
// launches and then goes live. It plays only for a change seen while the room is open.
import { useEffect, useRef, useState } from "react";
import { Modal, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { stageOf } from "../../../engine/src/views.js";
import { CoinImage } from "../ui/CoinImage";
import { Button, T } from "../ui/kit";
import { Ring } from "../ui/Ring";
import { C, S } from "../ui/theme";
import { momentStep } from "./room";

/** `ready`: the view is this visit's own (the first snapshot since the room opened has come);
 *  until then nothing counts as a change, so a view kept from an earlier visit can't start it.
 *  `seat`: seatOf(view, wallet) or null. */
export function LaunchOverlay({ view, launched, seat, ready }) {
  const stage = ready && view ? stageOf(view, launched) : null;
  const seen = useRef(null); // the stage last seen
  const [phase, setPhase] = useState(null); // null | "launching" | "live" | "done"
  const timers = useRef([]);

  useEffect(() => {
    if (stage == null) return;
    const prev = seen.current;
    seen.current = stage;
    setPhase((p) => momentStep(p, prev, stage));
  }, [stage]);

  // Once, when it starts: a success buzz, then three heavy knocks 150 ms apart.
  const started = phase === "launching" || phase === "live";
  const played = useRef(false);
  useEffect(() => {
    if (!started || played.current) return;
    played.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    timers.current = [150, 300, 450].map((ms) =>
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), ms),
    );
  }, [started]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!started) return null;
  const ticker = view.token?.symbol ?? "";
  const close = () => setPhase("done");
  const inPool = !!seat && seat.commit > 0n;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: `${C.bg0}f5`, paddingHorizontal: S.gutter, paddingVertical: 48 }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 24 }}>
          <Ring size={220} fill={1} color={C.up}>
            <CoinImage uri={view.token?.image} size={96} ticker={ticker} />
          </Ring>
          {phase === "launching" ? (
            <View style={{ alignItems: "center", gap: 8 }}>
              <T v="title" style={{ textAlign: "center" }}>The pool is full</T>
              <T v="body" color={C.text1} style={{ textAlign: "center" }}>{`Launching $${ticker} on Meteora…`}</T>
            </View>
          ) : (
            <View style={{ alignItems: "center", gap: 8 }}>
              <T v="title" style={{ textAlign: "center" }}>{`$${ticker} is live`}</T>
              {inPool ? (
                <T v="body" color={seat.claimed ? C.gold : C.text1} style={{ textAlign: "center" }}>
                  {seat.claimed ? "Your tokens arrived" : "Your tokens are on the way"}
                </T>
              ) : null}
            </View>
          )}
        </View>
        <View style={{ gap: 12 }}>
          {phase === "live" ? (
            <Button
              title={`See $${ticker}`}
              onPress={() => {
                close();
                router.push(`/coin/${view.presale}`);
              }}
            />
          ) : null}
          <Button kind="quiet" title="Close" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}
