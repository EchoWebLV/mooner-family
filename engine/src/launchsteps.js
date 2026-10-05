// The launch's four steps on the screen after POOL FULL, from what the chain says (spec §4),
// never from a timer. The phone (mobile/src/room/MomentLaunching.js) and the website
// (web/src/components/presale/LaunchSequence.tsx) both draw these.
import { whoIsIn } from "./views.js";

export const STEP_LABELS = ["Pool full", "Meteora pool created", "One buy, one price for everyone", "Sending everyone their tokens"];

/**
 * `view`: the presale's detail view (with `seats`), or undefined; `row`: its `launched` row,
 * or undefined. Returns { steps: [{ label, state: "done" | "now" | "todo" }], toGo, done,
 * failed }.
 * - The pool and the pot's one buy are one transaction (programs/presale/src/launch.rs), so
 *   both tick when the row, or a launched state, is seen.
 * - toGo: the committed seats still in the room once launched (a claim closes a seat), or
 *   null before launch or when the view has no seats (a list view). Only a known 0 finishes.
 * - failed: the presale ended without a launch; then no step is "now".
 */
export function launchSteps(view, row) {
  const state = view?.state;
  const launched = !!row || state === "SETTLED" || (state === "CLOSED" && !!view?.launch);
  const failed = !launched && (state === "FAILED" || state === "EXPIRED" || state === "CLOSED");
  const toGo = launched && Array.isArray(view?.seats) ? whoIsIn(view).length : null;
  const done = [true, launched, launched, toGo === 0];
  const now = failed ? -1 : done.indexOf(false);
  const steps = STEP_LABELS.map((label, i) => ({
    label: i === 3 && toGo > 0 ? `${label} · ${toGo} to go` : label,
    state: done[i] ? "done" : i === now ? "now" : "todo",
  }));
  return { steps, toGo, done: done.every(Boolean), failed };
}
