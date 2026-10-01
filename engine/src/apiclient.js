// The Mooner server's API. Errors carry the server's own message. The web app calls its
// own origin (base ""); the phone app calls https://app.mooner.family. No node: imports.

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** The API at `base`. `fetchFn` is for tests; it defaults to the global fetch at call time. */
export function makeApi(base = "", fetchFn = (url, init) => fetch(url, init)) {
  async function call(method, path, body) {
    const r = await fetchFn(base + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body && JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, json?.error ?? `the server said ${r.status}`, json);
    if (json === null) throw new ApiError(r.status, "the server's reply wasn't JSON", null);
    return { status: r.status, json };
  }

  return {
    info: async () => (await call("GET", "/api/info")).json,
    presales: async () => (await call("GET", "/api/presales")).json.presales,
    presale: async (key) => (await call("GET", `/api/presale/${key}`)).json,
    walletTokens: async (wallet) => (await call("GET", `/api/wallet/${wallet}/tokens`)).json.tokens,
    blockhash: async () => (await call("GET", "/api/blockhash")).json,
    mint: async (body) => (await call("POST", "/api/mint", body)).json,
    /** { status, json: { sig, confirmed, kind, user, presale, mint? } } */
    cosign: (tx) => call("POST", "/api/cosign", { tx }),
    launched: async () => (await call("GET", "/api/launched")).json.launched,
    balance: async (wallet) => Number((await call("GET", `/api/wallet/${wallet}/balance`)).json.lamports),
    login: async (body) => (await call("POST", "/api/login", body)).json,
    chat: async (channel, after = 0) => (await call("GET", `/api/chat/${channel}${after ? `?after=${after}` : ""}`)).json.messages,
    sendChat: async (token, channel, text) => (await call("POST", "/api/chat", { token, channel, text })).json,
    profiles: async () => (await call("GET", "/api/profiles")).json.profiles,
    saveProfile: async (token, pfp) => (await call("POST", "/api/profile", { token, pfp })).json,
  };
}
