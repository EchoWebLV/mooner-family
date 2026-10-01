// The app's one socket, API, flows and store (React Native side).
import * as SecureStore from "expo-secure-store";
import { makeApi } from "../../engine/src/apiclient.js";
import { makeFlows } from "../../engine/src/flows.js";
import { makeLive } from "../../engine/src/live.js";
import { BASE, PRIORITY, WS_URL } from "./config";
import { secureJson, secureKeys } from "./securekeys";
import { createMoonerStore } from "./store";

export const live = makeLive({ url: WS_URL });
export const api = makeApi(BASE);
export const flows = makeFlows({ api, subscribe: live.subscribe, keys: secureKeys(SecureStore), priority: PRIORITY });
export const store = createMoonerStore({ live, api, flows, saved: (name) => secureJson(SecureStore, name) });
