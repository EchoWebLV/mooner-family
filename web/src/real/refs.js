// Share-link refs in this browser (engine/src/refs.js): a presale page opened with
// `?ref=<wallet>` keeps it until a join there lands, and the join sends it with the co-sign.
// localStorage may throw (private mode); then nothing is kept and joins send no ref.
import { refFor as pick, withRef, withoutRef } from "../../../engine/src/refs.js";

export { shareLink } from "../../../engine/src/refs.js";

const NAME = "mooner:refs";

function read() {
  try {
    return JSON.parse(localStorage.getItem(NAME) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function write(refs) {
  try {
    localStorage.setItem(NAME, JSON.stringify(refs));
  } catch {
    // private mode: the ref isn't kept
  }
}

/** Keeps `ref` for presale `key` (junk and repeats change nothing). `me`: the connected
 *  wallet, or undefined while signed out; its own link never replaces a friend's ref. */
export function noteRef(key, ref, me) {
  const had = read();
  const next = withRef(had, key, ref, Date.now(), me);
  if (next !== had) write(next);
}

/** The ref to send with `wallet`'s join of presale `key`, or null. */
export const refFor = (key, wallet) => pick(read(), key, wallet);

/** A join of presale `key` landed: its ref went with it. */
export function dropRef(key) {
  const had = read();
  const next = withoutRef(had, key);
  if (next !== had) write(next);
}
