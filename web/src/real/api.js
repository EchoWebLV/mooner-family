// The Mooner server's API, same origin (engine/src/apiclient.js; the phone app uses it too).
import { makeApi } from "../../../engine/src/apiclient.js";

export { ApiError } from "../../../engine/src/apiclient.js";
export const api = makeApi("");
