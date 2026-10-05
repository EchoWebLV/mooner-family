// The launch, full screen, while the room is in front: POOL FULL and its 3-2-1, launching
// with its steps, live with your tokens, or failed. Real state picks the screen (room.js
// momentStep and momentScreen, engine launchsteps.js); the 3-2-1 never holds a step back.
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, View } from "react-native";
import { launchSteps } from "../../../engine/src/launchsteps.js";
import { stageOf } from "../../../engine/src/views.js";
import { C } from "../ui/theme";
import { MomentFailed, MomentFull } from "./MomentFull";
import { MomentLaunching } from "./MomentLaunching";
import { MomentLive } from "./MomentLive";
import { momentScreen, momentStep } from "./room";

/** The moment's phase (momentStep), whether it started on first sight (`late`: the room
 *  opened while the pool was full or launching), and `close`. `ready`: the view is this
 *  visit's own (the first snapshot since the room opened has come); until then nothing
 *  counts, so a view kept from an earlier visit can't start it. */
export function useMoment({ view, launched, ready }) {
  const stage = ready && view ? stageOf(view, launched) : null;
  const seen = useRef(null); // the stage last seen
  const [m, setM] = useState({ phase: null, late: false });
  useEffect(() => {
    if (stage == null) return;
    const prev = seen.current;
    seen.current = stage;
    setM((was) => {
      const phase = momentStep(was.phase, prev, stage);
      if (phase === was.phase) return was;
      return { phase, late: was.phase == null ? prev == null : was.late };
    });
  }, [stage]);
  const close = useCallback(() => setM((was) => ({ ...was, phase: "done" })), []);
  return { phase: m.phase, late: m.late, close };
}

/**
 * `moment`: useMoment's. `view`: the room's view; `detail`: its detail view (with seats) or
 * undefined; `launched`: the launched row or undefined; `who`: whoIsIn(view). `seat`:
 * seatOf(view, wallet) or null; `commit`: the seat's commit last seen after OPEN (room.js
 * lockedCommit) or null; `claimed`: claimedOf(...). `focused`: the room is the screen in
 * front. `N`: info.N. `onShare`: shares the coin, or null when there's nothing to share.
 */
export function LaunchMoment({ moment, view, detail, launched, who, seat, commit, claimed, focused, wallet, N, onShare }) {
  const { phase, late, close } = moment;
  const [counted, setCounted] = useState(false);
  const onCounted = useCallback(() => setCounted(true), []);

  // The crowd that launched it: who was in when the moment started. Claims close seats, so
  // whoIsIn shrinks to nothing while the tokens go out.
  const [crowd, setCrowd] = useState(null);
  const started = phase != null && phase !== "done";
  if (started && crowd == null && who.length) setCrowd(who);

  // Whether this wallet had a seat while it launched: a failed launch refunds every seat, so
  // the seat may be gone by the time the failure shows.
  const hadSeat = useRef(false);
  useEffect(() => {
    if ((phase === "launching" || phase === "live") && seat) hadSeat.current = true;
  }, [phase, seat]);

  const steps = launchSteps(detail ?? view, launched);
  const screen = momentScreen({ phase, late, counted, stepsDone: steps.done, claimed });
  if (!screen || !focused) return null;
  const shown = crowd ?? who;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: C.bg0 }}>
        {screen === "full" ? (
          <MomentFull view={view} who={shown} wallet={wallet} N={N} onCounted={onCounted} />
        ) : screen === "failed" ? (
          <MomentFailed refund={hadSeat.current || !!seat} onClose={close} />
        ) : screen === "launching" ? (
          <MomentLaunching view={view} steps={steps} late={late} onClose={close} />
        ) : (
          <MomentLive
            view={view}
            launched={launched}
            who={shown}
            wallet={wallet}
            claimed={claimed}
            commit={commit ?? seat?.commit ?? null}
            onShare={onShare}
            onClose={close}
          />
        )}
      </View>
    </Modal>
  );
}
