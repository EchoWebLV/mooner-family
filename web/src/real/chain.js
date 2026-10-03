// Everything the site does on chain: engine/src/flows.js (the phone app runs the same
// code), wired to this browser: the same-origin API, the live socket, and session keys in
// localStorage (if that throws, as in private mode, flows.js keeps them in memory until the
// page reloads; after that the wallet signs a rotate_key). Solana (the refund, the costs, the
// trades, Privy) is the server's /api/rpc: Solana's public mainnet RPC answers 403 to a
// browser (any request with an Origin header).

import { makeFlows } from "../../../engine/src/flows.js";
import { api } from "./api.js";
import { subscribe } from "./live.js";

export { erFor, explain, LAMPORTS, nearestEr, PUBLIC_RPC, sol, toLamports } from "../../../engine/src/flows.js";
export { loginMessage } from "../../../engine/src/client.js";

/** Solana for this site: the server's RPC through POST /api/rpc (engine/server/rpcproxy.js). */
export const SOLANA_RPC = `${location.origin}/api/rpc`;

const keys = {
  get: async (name) => localStorage.getItem(name),
  set: async (name, value) => localStorage.setItem(name, value),
};

// joinCost and openCost read rents from SOLANA_RPC, as getBack does
export const { loadInfo, sessionKey, waitFor, requestMint, openPresale, joinPresale, setCommit, getBack, joinCost, openCost } = makeFlows({ api, subscribe, keys, rpc: SOLANA_RPC });
