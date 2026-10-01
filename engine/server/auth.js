// Wallet proofs: a creator asks for a token by signing a message with their wallet
// (signMessage), and the server checks the ed25519 signature against the wallet address.

import crypto from "node:crypto";
import { mintMessageText } from "../src/client.js";

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
export const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

export function verifySignature(wallet, message, signature) {
  if (signature.length !== 64) return false;
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, wallet.toBuffer()]), format: "der", type: "spki" });
  return crypto.verify(null, Buffer.from(message, "utf8"), key, signature);
}

/** A wallet's signMessage, for scripts and tests that hold the Keypair. */
export function signMessage(keypair, message) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keypair.secretKey.subarray(0, 32))]);
  return crypto.sign(null, Buffer.from(message, "utf8"), crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
}

/** The exact text a creator signs to ask for a token. The image and the rest of the
 *  details are covered by their hashes. */
export function mintMessage({ wallet, name, symbol, image, details, time }) {
  return mintMessageText({ wallet, name, symbol, imageHash: sha256(image), detailsHash: sha256(JSON.stringify(details)), time });
}
