// Chat's rooms and the unread dot, from the store's state. Pure, so Node tests it.
import { tokenOf } from "../me.js";
import { myPresales } from "../store.js";

/** [{ channel, label, image? }]: Everyone (the server's `global` channel), then one room per
 *  presale you're in or were in whose coin is known ($TICKER and its picture), in
 *  myPresales' order. */
export function roomsOf(s) {
  const rooms = [{ channel: "global", label: "Everyone" }];
  for (const key of myPresales(s)) {
    const token = tokenOf({ ...s, key });
    if (token) rooms.push({ channel: key, label: `$${token.symbol}`, image: token.image ?? null });
  }
  return rooms;
}

/** Whether `rows` (a channel's lines, oldest first) has a line pushed live after the line
 *  `seen` (an id). Only lines flagged live count (a reconnect's snapshot keeps the flag on
 *  lines that had it). */
export const unreadOf = (rows, seen) => (rows ?? []).some((r) => r.live && r.id > seen);
