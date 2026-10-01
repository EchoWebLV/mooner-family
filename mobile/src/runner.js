// Runs the screen's checks one at a time. React Native's fetch never times out, so a check
// that runs past TIMEOUT_MS is given up on and the screen comes back. A check that uses the
// wallet may still be running then (its Seed Vault prompt open, or not opened yet, or its RPC
// calls after the wallet not answered); until it ends, this runner starts no other check that
// uses the wallet, so the screen doesn't queue a second Seed Vault session behind it. That is
// all it guards: it can't see a check the adapter ended by its own 90 s timeout, or one from
// before Android recreated the screen. That Send memo sends at most once is sendCheck's own
// latch (`sends` in checks.js), not this.
// Plain JS (no React Native), so it runs in Node too.

export const TIMEOUT_MS = 120_000;

/** An error's message, after its code when it has one. The wallet adapter's codes say what
 *  happened ("Timed out waiting for response", "Failed to end session"); the message under
 *  them is often only a Java class name (React Native's PromiseImpl.kt falls back to it). */
export function errorText(e) {
  const text = e?.message ?? String(e);
  const code = e?.code;
  if (code === undefined || code === null || code === text) return text;
  return typeof code === "number" ? `${text} (code ${code})` : `${code}: ${text}`;
}
/** What clears what a check left behind (sendCheck's latch, the adapter's session lock):
 *  leaving the app and coming back doesn't, since React Native keeps the JS runtime when the
 *  activity goes (ReactDelegate.kt onHostDestroy, 164-175: the surface stops, the host only
 *  changes lifecycle state, ReactHostImpl.kt 313-322 and 890-894). Ending the process does. */
export const FORCE_STOP = "force-stop the app (swipe it away in Recents, or Settings → Force stop) and open it again";
const WHAT_NOW = `if its Seed Vault prompt is open, approve or decline it; `
  + `if none is (it hasn't opened yet, or was already answered), wait for it to finish, or ${FORCE_STOP}`;

/** Waits for `promise` up to `ms`: { ok: true } or { ok: false, error } once it settles,
 *  null if it's still running then. */
function waitUpTo(promise, ms) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const settled = promise.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
  return Promise.race([settled, late]).finally(() => clearTimeout(timer));
}

/** `show(line)` puts a line on the screen; `setBusy(bool)` dims the buttons. */
export function makeRunner({ show, setBusy, timeoutMs = TIMEOUT_MS }) {
  let busy = false;
  let stranded = null; // the label of a timed-out check that uses the wallet and hasn't ended

  /** Runs `check(log)` unless a check is running (then the tap does nothing). `usesWallet`:
   *  it opens a Seed Vault session or changes the saved authorization, so it waits for a
   *  timed-out one to end. The check's lines go through `log`, marked with its label (which
   *  names its network) once it's late. */
  async function run(label, check, { usesWallet }) {
    if (busy) return;
    if (usesWallet && stranded) return show(`blocked: ${stranded} timed out and is still running; ${WHAT_NOW}`);
    busy = true;
    setBusy(true);
    show(`--- ${label}`);
    let late = false;
    const log = (line) => show(late ? `[late: ${label}] ${line}` : line);
    const work = Promise.resolve().then(() => check(log)); // a check that throws at once fails like any other
    const r = await waitUpTo(work, timeoutMs);
    if (!r) {
      late = true;
      show(`error: timed out after ${timeoutMs / 1000} s`);
      if (usesWallet) {
        stranded = label;
        show(`${label} is still running, and checks that use the wallet wait for it: ${WHAT_NOW}`);
      }
      work
        .then(() => "ok", (e) => `error: ${errorText(e)}`)
        .then((how) => {
          if (usesWallet) stranded = null;
          show(`${label} finished late: ${how}`);
        });
    } else if (!r.ok) show(`error: ${errorText(r.error)}`);
    busy = false;
    setBusy(false);
  }

  return { run, show, isBusy: () => busy };
}
