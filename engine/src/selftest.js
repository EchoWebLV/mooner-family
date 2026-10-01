// Fixed txs whose bytes must match on every platform: a v0 join tx and a legacy ER tx (web3.js
// builds the two through different code). The phone builds both at start and compares their
// digests, which proves its bundle (Hermes, the polyfills, one web3.js) derives PDAs, orders
// accounts, encodes and signs exactly as Node does. It also logs collationOrder() next to
// COLLATION_ORDER, to see how the engine's localeCompare sorts. No node: imports.

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { joinIxs, unsignedErTx, unsignedTx } from "./client.js";
import { MEMO } from "./consts.js";
import { setCommit } from "./ix.js";
import { presalePda, seatPda } from "./pdas.js";

export const GOLDEN_PID = new PublicKey("6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa");
const fill = (n) => new Uint8Array(32).fill(n);
export const GOLDEN_GATE = new PublicKey(fill(2));
export const GOLDEN_VALIDATOR = new PublicKey(fill(5));

/** sha256 hex of the serialized goldenJoinTx() and goldenErTx(), as Node computes them. */
export const GOLDEN_JOIN_DIGEST = "f6baff2127e47458211b82a23559a370b704d0517bc83afda59c7494965aed55";
export const GOLDEN_ER_DIGEST = "003c526dd79355edfd533b345ef9f449520bd74b9d5fe918f20457c7a6ea4254";

/** A 0.5 SOL join by a fixed wallet, signed by it (the gate's slot stays empty). */
export function goldenJoinTx() {
  const user = Keypair.fromSeed(fill(7));
  const presale = presalePda(GOLDEN_PID, new PublicKey(fill(3)));
  const ixs = joinIxs(GOLDEN_PID, { user: user.publicKey, gate: GOLDEN_GATE, presale, sessionKey: new PublicKey(fill(4)), deposit: 500_000_000n, validator: GOLDEN_VALIDATOR });
  const tx = unsignedTx({ ixs, payer: user.publicKey, blockhash: "11111111111111111111111111111111" });
  tx.sign([user]);
  return tx;
}

/** A 0.5 SOL commit for the golden join's seat, signed and paid by a fixed session key
 *  (Keypair.fromSeed(fill(8)), not the fill(4) key the join registered), and a memo whose
 *  two read-only keys (cGfHiC... and CHTMuH...) sort one way under web3.js's localeCompare
 *  and the other way by code point, so the digest also checks the engine's collation. */
export function goldenErTx() {
  const session = Keypair.fromSeed(fill(8));
  const presale = presalePda(GOLDEN_PID, new PublicKey(fill(3)));
  const seat = seatPda(GOLDEN_PID, presale, Keypair.fromSeed(fill(7)).publicKey);
  const ro = (n) => ({ pubkey: new PublicKey(fill(n)), isSigner: false, isWritable: false });
  const ixs = [
    setCommit(GOLDEN_PID, { signer: session.publicKey, seat, presale, amount: 500_000_000n }),
    new TransactionInstruction({ programId: MEMO, keys: [ro(9), ro(167)], data: Buffer.from("golden") }),
  ];
  const tx = unsignedErTx({ ixs, payer: session.publicKey, blockhash: "11111111111111111111111111111111" });
  tx.sign(session);
  return tx;
}

export const digest = (tx) => bytesToHex(sha256(tx.serialize()));

// how web3.js 1.99.0 sorts a legacy tx's accounts: x.localeCompare(y, 'en', options)
const WEB3_SORT = {
  localeMatcher: 'best fit',
  usage: 'sort',
  sensitivity: 'variant',
  ignorePunctuation: false,
  numeric: false,
  caseFirst: 'lower'
};

/** Base58 words web3.js's sort puts one way and another compare puts another: code point
 *  sorts "A" before "a", numeric order "9" before "12", and locales that treat two letters as
 *  one or move a letter reorder some (da, nb: "aa"; cs, sk: "ch"; hu: "cs"; hr, bs, sr-Latn:
 *  "nj"; fil (and tl), ceb, to: "ng"; yo, ig, ee: "gb"; sq, ha: "sh"; az: "x"; lt: "y"; et: "z";
 *  haw: vowels first; ln-u-co-phonetic: "gb", "ng", "sh"). */
// Measured on Node's ICU 78.2; which ICU the phone's Android ships is unverified.
export const COLLATION_WORDS = ["cz", "Abc", "yz", "chx", "zb", "Aab", "csx", "tb", "Ab", "jz", "aa", "nz", "njx", "ngx", "gz", "gbx", "sz", "shx", "xa", "iz", "ua", "bz", "9x", "12x"];
/** COLLATION_WORDS as Node sorts them with web3.js's options (and with "en" alone). */
export const COLLATION_ORDER = ["12x", "9x", "aa", "Aab", "Ab", "Abc", "bz", "chx", "csx", "cz", "gbx", "gz", "iz", "jz", "ngx", "njx", "nz", "shx", "sz", "tb", "ua", "xa", "yz", "zb"];
/** COLLATION_WORDS sorted as web3.js sorts keys, on this engine. */
export const collationOrder = () => [...COLLATION_WORDS].sort((x, y) => x.localeCompare(y, "en", WEB3_SORT));
