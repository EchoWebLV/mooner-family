// Mooner sign-in, for the web app and the phone app: the wallet signs the login message and
// the server returns a session token (7 days) for chat and the Mooner picture. Any wallet
// reply layout walletcheck.js knows works (the signature alone, or with the message).

import { loginMessage } from "./client.js";
import { pickSignature } from "./walletcheck.js";

/** `wallet`: a PublicKey. `signMessage(bytes)`: the wallet's. Returns { token, exp } (exp in ms). */
export async function signIn({ api, wallet, signMessage, now = () => Date.now() }) {
  const address = wallet.toBase58();
  const time = Math.floor(now() / 1000);
  const message = new TextEncoder().encode(loginMessage(address, time));
  const reply = await signMessage(message);
  const got = pickSignature(message, Uint8Array.from(reply), wallet);
  if (!got) throw new Error("The wallet's signature didn't check out. Try again.");
  const r = await api.login({ wallet: address, time, signature: Buffer.from(got.signature).toString("base64") });
  return { token: r.token, exp: r.exp };
}
