// Everything the site does on chain: engine/src/flows.js (the phone app runs the same
// code), wired to this browser: the same-origin API, the live socket, and session keys in
// localStorage (if that throws, as in private mode, flows.js keeps them in memory until the
// page reloads; after that the wallet signs a rotate_key). Solana for the refund is the
// public RPC of the server's cluster (flows.js PUBLIC_RPCS).

import { makeFlows } from "../../../engine/src/flows.js";
import { api } from "./api.js";
import { subscribe } from "./live.js";

export { erFor, explain, LAMPORTS, nearestEr, PUBLIC_RPC, sol, toLamports } from "../../../engine/src/flows.js";
export { loginMessage } from "../../../engine/src/client.js";

const keys = {
  get: async (name) => localStorage.getItem(name),
  set: async (name, value) => localStorage.setItem(name, value),
};

export const { loadInfo, sessionKey, waitFor, requestMint, openPresale, joinPresale, setCommit, getBack } = makeFlows({ api, subscribe, keys });
