// The app's one socket, API, flows, RPC connection, market and store (React Native side).
import { Connection } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";
import { makeApi } from "../../engine/src/apiclient.js";
import { makeFlows } from "../../engine/src/flows.js";
import { makeLive } from "../../engine/src/live.js";
import { timedFetch } from "../../engine/src/tx.js";
import { BASE, PRIORITY, RPC, WS_URL } from "./config";
import { secureJson, secureKeys } from "./securekeys";
import { DEMO, demoFlows, demoMarket } from "./demo";
import { createMoonerStore } from "./store";
import { makeMarket } from "./trading";

export const live = makeLive({ url: WS_URL });
export const api = makeApi(BASE);
/** The phone's own RPC (the one the wallet adapter uses): token balances, sending trades, and
 *  the refund and the costs in flows. Each request gives up after 10 s (timedFetch): RN's
 *  fetch never does by itself. */
export const conn = new Connection(RPC, { commitment: "confirmed", fetch: timedFetch });
const realFlows = makeFlows({ api, subscribe: live.subscribe, keys: secureKeys(SecureStore), priority: PRIORITY, rpc: conn });
const realMarket = makeMarket({ conn, priority: PRIORITY });
// Sample-data recordings (demo.js): join, create and trade go to the demo server
export const flows = DEMO ? demoFlows(realFlows, BASE) : realFlows;
export const market = DEMO ? demoMarket(realMarket, BASE) : realMarket;
export const store = createMoonerStore({ live, api, flows, market, saved: (name) => secureJson(SecureStore, name) });
