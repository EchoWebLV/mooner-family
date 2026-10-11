// Privy on the server: checks a Privy access token and reads a user's verified accounts from
// Privy's REST API. node:crypto and fetch only.
//   tokens: docs.privy.io/authentication/user-authentication/access-tokens
//   users:  docs.privy.io/api-reference/users/get

import crypto from "node:crypto";

const DID = /^did:privy:[A-Za-z0-9]+$/;

/** The Privy user id (`sub`) of a good access token, else null. Good: ES256, signed by `key`,
 *  issued by privy.io for `appId`, and not expired (30 s of skew). */
export function verifyToken(token, { appId, key, now = Date.now }) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const [head, body, sig] = parts;
  let claims;
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (header?.alg !== "ES256" || !claims || typeof claims !== "object") return null;
    const signed = Buffer.from(`${head}.${body}`);
    if (!crypto.verify("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))) return null;
  } catch {
    return null;
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== "privy.io" || !aud.includes(appId)) return null;
  if (typeof claims.exp !== "number" || claims.exp + 30 < now() / 1000) return null;
  return typeof claims.sub === "string" && DID.test(claims.sub) ? claims.sub : null;
}

/** What joining needs from a Privy user (the API's JSON): { email, xId, xHandle, wallet }, each
 *  null when missing. The wallet is the user's Privy-made Solana one:
 *  an embedded wallet (wallet_client_type "privy" or "privy-v2", connector_type "embedded") on
 *  Solana; of several, the lowest wallet_index (the main one, 0), one with no index last. */
export function accountsOf(user) {
  const linked = Array.isArray(user?.linked_accounts) ? user.linked_accounts : [];
  const email = linked.find((a) => a.type === "email" && typeof a.address === "string");
  const x = linked.find((a) => a.type === "twitter_oauth" && typeof a.subject === "string");
  const index = (a) => (Number.isInteger(a.wallet_index) ? a.wallet_index : Infinity);
  const wallet = linked
    .filter(
      (a) =>
        a.type === "wallet" &&
        a.chain_type === "solana" &&
        (a.wallet_client_type === "privy" || a.wallet_client_type === "privy-v2") &&
        a.connector_type === "embedded" &&
        typeof a.address === "string",
    )
    .reduce((best, a) => (best && index(best) <= index(a) ? best : a), null);
  return {
    email: email ? email.address.trim().toLowerCase() : null,
    xId: x ? x.subject : null,
    xHandle: x && typeof x.username === "string" ? x.username.toLowerCase() : null,
    wallet: wallet ? wallet.address : null,
  };
}

/** `verify(token)` and `user(id)` for one Privy app. `key` is the verification key's PEM from
 *  Privy's dashboard (Configuration > App settings), or several PEMs one after another: Privy
 *  lists more than one signing key (auth.privy.io/api/v1/apps/<id>/jwks.json), and a token
 *  signed by any of them is good. Newlines may come escaped as \n, as they do in some env
 *  editors. A missing appId or secret, or a key that isn't an EC P-256 one (Privy signs with
 *  ES256), throws here, at start. */
export function privyAuth({ appId, secret, key, fetch = globalThis.fetch, now = Date.now, timeoutMs = 8000 }) {
  const filled = (v) => typeof v === "string" && v !== "";
  if (!filled(appId) || !filled(secret)) throw new Error("privy: appId and secret are needed");
  const pem = key.replaceAll("\\n", "\n");
  const keys = (pem.match(/-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g) ?? [pem]).map((k) => crypto.createPublicKey(k));
  if (keys.some((k) => k.asymmetricKeyType !== "ec" || k.asymmetricKeyDetails?.namedCurve !== "prime256v1")) {
    throw new Error("privy: the verification key must be an EC P-256 key");
  }
  const authorization = `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`;
  return {
    verify(token) {
      for (const key of keys) {
        const id = verifyToken(token, { appId, key, now });
        if (id) return id;
      }
      return null;
    },
    async user(id) {
      // the id goes into the URL path, with the app secret attached: only did:privy:<letters and digits>
      if (typeof id !== "string" || !DID.test(id)) throw new Error("privy users: bad id");
      const res = await fetch(`https://api.privy.io/v1/users/${id}`, {
        headers: { "privy-app-id": appId, authorization },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw Object.assign(new Error(`privy users: HTTP ${res.status}`), { status: res.status });
      }
      return res.json();
    },
  };
}
