// What Me lists: the presales the wallet is in or was in, each with its coin and where the
// wallet stands. Plain functions of the store's state (no React Native, so Node tests run them).
import { seatOf } from "../../engine/src/views.js";
import { myPresales } from "./store.js";
import { solText } from "./ui/format.js";

/** Where the wallet stands in presale `key`, and where a tap goes: { kind, text, to }. In this
 *  order: the coin launched; its SOL came back (got back from this phone); it's in (its seat
 *  in the watched view, else its row in the open list's users); else closed. */
export function statusOf({ key, wallet, presales, views, launched, mine }) {
  if (launched[key]) return { kind: "launched", text: "Launched", to: `/coin/${key}` };
  const to = `/presale/${key}`;
  if (mine[key]?.back) return { kind: "back", text: "SOL back", to };
  const seat = views[key] ? seatOf(views[key], wallet) : null;
  const user = presales[key]?.users?.find((u) => u.user === wallet);
  if (seat || user) return { kind: "in", text: `In · ${solText(seat ? seat.deposit : user.commit)} SOL`, to };
  return { kind: "closed", text: "Closed", to };
}

/** Presale `key`'s coin from whichever feed has it; null while none does. */
export const tokenOf = ({ key, presales, views, launched }) =>
  presales[key]?.token ?? views[key]?.token ?? launched[key]?.token ?? null;

/** Me's rows, [{ key, token, status }]: one per presale the wallet is in or was in. */
export const rowsOf = (s) => myPresales(s).map((key) => ({ key, token: tokenOf({ ...s, key }), status: statusOf({ ...s, key }) }));
