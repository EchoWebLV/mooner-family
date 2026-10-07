// The Mooner server's API. Errors carry the server's own message. The web app calls its
// own origin (base ""); the phone app calls https://app.mooner.family. No node: imports,
// no web3 (the deadline helper is here, not tx.js's).
import { FETCH_MS } from "./market.js";

/** The server's refusal (`status`, its `body`), or `status: 0` with `timedOut` when it
 *  didn't answer in time. */
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** `work(signal)` given `ms`: past that, the request is aborted and this rejects with an
 *  ApiError that has `timedOut`. A timer and an AbortController, since React Native has no
 *  AbortSignal.timeout; the race stops the wait even for a fetch that ignores the signal. */
function deadline(ms, work) {
  const ctl = new AbortController();
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new ApiError(0, `the server didn't answer in ${ms / 1000} s`, null);
      e.timedOut = true;
      reject(e);
      ctl.abort();
    }, ms);
  });
  return Promise.race([work(ctl.signal), late]).finally(() => clearTimeout(timer));
}

/** The API at `base`. `fetchFn` is for tests; it defaults to the global fetch at call time.
 *  Each call, its body included, gets `ms` (10 s), and cosign `cosignMs` (90 s: the server
 *  sends the tx and waits up to 60 s for it, plus its rate-limit waits). */
export function makeApi(base = "", fetchFn = (url, init) => fetch(url, init), { ms = FETCH_MS, cosignMs = 90_000 } = {}) {
  function call(method, path, body, within = ms) {
    return deadline(within, async (signal) => {
      const r = await fetchFn(base + path, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body && JSON.stringify(body),
        signal,
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new ApiError(r.status, json?.error ?? `the server said ${r.status}`, json);
      if (json === null) throw new ApiError(r.status, "the server's reply wasn't JSON", null);
      return { status: r.status, json };
    });
  }

  return {
    info: async () => (await call("GET", "/api/info")).json,
    presales: async () => (await call("GET", "/api/presales")).json.presales,
    presale: async (key) => (await call("GET", `/api/presale/${key}`)).json,
    walletTokens: async (wallet) => (await call("GET", `/api/wallet/${wallet}/tokens`)).json.tokens,
    blockhash: async () => (await call("GET", "/api/blockhash")).json,
    mint: async (body) => (await call("POST", "/api/mint", body)).json,
    /** { status, json: { sig, confirmed, kind, user, presale, mint? } }. A timeout here may
     *  still have been sent: flows.js reads it as outcome unknown. `ref`: the wallet whose
     *  share link brought this join (refs.js), sent beside the tx, never in it. */
    cosign: (tx, { ref = /** @type {string | null} */ (null) } = {}) => call("POST", "/api/cosign", ref ? { tx, ref } : { tx }, cosignMs),
    launched: async () => (await call("GET", "/api/launched")).json.launched,
    balance: async (wallet) => Number((await call("GET", `/api/wallet/${wallet}/balance`)).json.lamports),
    login: async (body) => (await call("POST", "/api/login", body)).json,
    chat: async (channel, after = 0) => (await call("GET", `/api/chat/${channel}${after ? `?after=${after}` : ""}`)).json.messages,
    sendChat: async (token, channel, text) => (await call("POST", "/api/chat", { token, channel, text })).json,
    profiles: async () => (await call("GET", "/api/profiles")).json.profiles,
    saveProfile: async (token, pfp) => (await call("POST", "/api/profile", { token, pfp })).json,
    // XP and the Seeker Genesis check (server/xproutes.js)
    xp: async (wallet) => (await call("GET", `/api/xp/${wallet}`)).json,
    genesis: async (token) => (await call("POST", "/api/genesis", { token })).json,
  };
}
