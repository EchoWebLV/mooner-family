// What Me lists: the presales the wallet is in or was in, each with its coin and where the
// wallet stands. Plain functions of the store's state (no React Native, so Node tests run them).
import { seatOf } from "../../engine/src/views.js";
import { myPresales } from "./store.js";
import { solText } from "./ui/format.js";

// The list holds every presale that still exists and is live for each; it drops one once it
// closes. EXPIRED/FAILED seats are refunded by the keeper by itself (engine/src/bot.js
// atHome), so they read Closed.
const IN_PLAY = new Set(["OPEN", "FULL", "LAUNCHING", "SETTLED"]);

/** Where the wallet stands in presale `key`, and where a tap goes: { kind, text, to }. In this
 *  order: the coin launched; its SOL came back (got back from this phone); the presale is in
 *  play and the wallet is in it; else closed. */
export function statusOf({ key, wallet, presales, views, launched, mine }) {
  if (launched[key]) return { kind: "launched", text: "Launched", to: `/coin/${key}` };
  const to = `/presale/${key}`;
  const closed = { kind: "closed", text: "Closed", to };
  if (mine[key]?.back) return { kind: "back", text: "SOL back", to };
  const item = presales[key];
  if (!item || !IN_PLAY.has(item.state)) return closed;
  // While OPEN the list names who's in. Past OPEN (or when the server couldn't read the seats):
  // the seat in the room's view, else this phone's join. A view outlives its room, so it gives
  // the amount, never the state.
  const seat = views[key] ? seatOf(views[key], wallet) : null;
  const amount = item.users ? item.users.find((u) => u.user === wallet)?.commit : (seat?.deposit ?? mine[key]?.deposit);
  return amount != null ? { kind: "in", text: `In · ${solText(amount)} SOL`, to } : closed;
}

/** Presale `key`'s coin from whichever feed has it; null while none does. */
export const tokenOf = ({ key, presales, views, launched }) =>
  presales[key]?.token ?? views[key]?.token ?? launched[key]?.token ?? null;

/** Me's rows, [{ key, token, status }]: one per presale the wallet is in or was in. */
export const rowsOf = (s) => myPresales(s).map((key) => ({ key, token: tokenOf({ ...s, key }), status: statusOf({ ...s, key }) }));

/** The Me tab: your face and SOL ("2.41 SOL", mono) once the wallet and its balance are both
 *  known; else the Me icon and "Me". */
export function meTab(wallet, lamports) {
  if (!wallet || lamports == null) return { face: null, label: "Me", mono: false };
  return { face: wallet, label: `${solText(lamports)} SOL`, mono: true };
}
