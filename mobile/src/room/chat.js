// The chat's rules as plain functions (no React Native, so Node tests run them): typing at the
// server's 280 code-point limit, what TalkBack reads for a line, and the floating emojis' one
// queue.
import { FLOAT_GAP_MS, FLOAT_MAX } from "../../../engine/src/cues.js";
import { CHAT_MAX, chatParts, clipChat, codePoints, emojisIn } from "../../../engine/src/emoji.js";

/** The server refuses any control character (engine/server/social.js postChat); a pasted
 *  new line or tab becomes a space. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** The input's text after a change from `prev` to `next`. Past the limit, a change made at the
 *  limit is refused (cutting the end would drop the message's last characters wherever you
 *  typed); a paste that grows past it from under it is cut to the limit. */
export function typedChat(prev, next, max = CHAT_MAX) {
  const t = (next ?? "").replace(CONTROL, " ");
  if (codePoints(t) <= max) return t;
  return codePoints(prev) >= max ? prev : clipChat(t, max);
}

/** A line as TalkBack reads it: each emoji by its name (":lfg:" reads "lfg"). */
export const readableChat = (text) =>
  chatParts(text)
    .map((p) => (p.kind === "emoji" ? ` ${p.name} ` : p.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** At most this many floating emojis in flight at once. */
export const FLOATS_FLYING = 10;
/** At most this many waiting to float; past it the oldest waiting are dropped. */
export const FLOATS_WAITING = 10;

/** `queue` with a line's emojis (up to FLOAT_MAX of them) added at the end, keeping the newest
 *  FLOATS_WAITING: when lines pile up, the oldest waiting emojis are the ones dropped. */
export function queueFloats(queue, text, max = FLOATS_WAITING) {
  const next = [...queue, ...emojisIn(text, FLOAT_MAX)];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** One step of the floats' queue at `nowMs`, `flying` being the floats in flight. `last`: when
 *  the last one started (ms). Floats start one at a time, FLOAT_GAP_MS apart across every line,
 *  and none while FLOATS_FLYING are in flight. Returns { start, queue, last, wait }: `start`
 *  the emoji to float now or null, `wait` the ms until the next step or null when none waits. */
export function floatStep({ queue, last }, nowMs, flying, gap = FLOAT_GAP_MS, cap = FLOATS_FLYING) {
  if (!queue.length) return { start: null, queue, last, wait: null };
  const due = last + gap;
  if (nowMs < due) return { start: null, queue, last, wait: due - nowMs };
  if (flying >= cap) return { start: null, queue, last, wait: gap };
  const [start, ...rest] = queue;
  return { start, queue: rest, last: nowMs, wait: rest.length ? gap : null };
}
