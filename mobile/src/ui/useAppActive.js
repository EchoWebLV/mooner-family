// Whether the app is the one in front. A screen keeps focus with the phone locked or another
// app up, and its timers freeze there and all fire on return, so sounds and timed moves
// wait for this as well as for focus.
import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** Out of view: "background", or "inactive" (iOS, on the way out or under the app switcher). */
const isActive = (state) => state !== "background" && state !== "inactive";

/** Whether the app is in front, kept up to date. */
export function useAppActive() {
  const [active, setActive] = useState(() => isActive(AppState.currentState));
  useEffect(() => {
    setActive(isActive(AppState.currentState));
    const sub = AppState.addEventListener("change", (state) => setActive(isActive(state)));
    return () => sub.remove();
  }, []);
  return active;
}
