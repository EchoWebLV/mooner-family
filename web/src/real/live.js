// The server's live socket (/api/ws, same origin): one per tab, engine/src/live.js (the
// phone app runs the same client).
//   server -> { topic, type: "snapshot" | "upsert" | "remove" | "message" | "missing" | "error", data }

import { makeLive } from "../../../engine/src/live.js";

function address() {
  const u = new URL("/api/ws", location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

/** subscribe(topic, fn) -> off; onStatus(fn) -> off */
export const { subscribe, onStatus } = makeLive({ url: address });
