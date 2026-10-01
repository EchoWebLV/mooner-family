// A presale's time left, ticking on its own clock so only this text re-renders each second.
import { useEffect } from "react";
import { useIsFocused } from "expo-router";
import { clock, secondsLeft } from "../../../engine/src/views.js";
import { T } from "../ui/kit";
import { useNow } from "../ui/useNow";
import { C } from "../ui/theme";

/** Under this many seconds left, the clock turns C.warn. */
const WARN_UNDER = 5 * 60;

/** True when presale `deadlineTs` (seconds) has no time left at `nowMs` (views.secondsLeft). */
export const timeUp = (deadlineTs, nowMs) => secondsLeft({ deadlineTs }, nowMs) === 0;

/** "m:ss" to `deadlineTs`, C.warn under 5 minutes; "Time's up" in C.text2 after. It stops
 *  ticking while its screen isn't focused. `onTimeUp(up)` hears each change of whether
 *  time is up (setState works). */
export function Countdown({ deadlineTs, onTimeUp }) {
  const now = useNow(1000, useIsFocused());
  const left = secondsLeft({ deadlineTs }, now);
  const up = left === 0;
  useEffect(() => {
    onTimeUp?.(up);
  }, [up]); // changes of `up` only, whatever function the parent passed this render
  if (up) return <T v="num" color={C.text2}>Time's up</T>;
  return <T v="num" color={left < WARN_UNDER ? C.warn : C.text0}>{clock(left)}</T>;
}
