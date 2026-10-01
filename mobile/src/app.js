// The app's one socket, API, flows, RPC connection, market and store (React Native side).
import { Connection } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";
import { makeApi } from "../../engine/src/apiclient.js";
import { makeFlows } from "../../engine/src/flows.js";
import { makeLive } from "../../engine/src/live.js";
import { BASE, PRIORITY, RPC, WS_URL } from "./config";
import { secureJson, secureKeys } from "./securekeys";
import { createMoonerStore } from "./store";
import { makeMarket } from "./trading";

export const live = makeLive({ url: WS_URL });
export const api = makeApi(BASE);
export const flows = makeFlows({ api, subscribe: live.subscribe, keys: secureKeys(SecureStore), priority: PRIORITY });
/** The phone's own RPC (the one the wallet adapter uses): token balances and sending trades. */
export const conn = new Connection(RPC, "confirmed");
export const market = makeMarket({ conn, priority: PRIORITY });
export const store = createMoonerStore({ live, api, flows, market, saved: (name) => secureJson(SecureStore, name) });
