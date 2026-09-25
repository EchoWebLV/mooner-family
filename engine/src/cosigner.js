// The gate co-signer (spec "Entry gate"). The server signs only entry txs of one exact
// shape, so its key can't be used for anything else:
//   open:  [compute budget]* open_presale + delegate(presale) + delegate(creator seat)
//   join:  [compute budget]* join + delegate(seat)
// Opening and delegating in one tx means nobody can crank a commit-0 seat home (and take
// its fee) before it reaches the ER. The server also holds each presale's mint key and
// signs with it for opens, so the CA is known before the presale exists. A mint key signs
// only for the wallet it was issued to, and only in the mint slot of open_presale.

import { VersionedTransaction } from "@solana/web3.js";
import { COMPUTE_BUDGET, IX } from "./consts.js";
import { presalePda, seatPda } from "./pdas.js";

export class Refused extends Error {}

const refuse = (why) => {
  throw new Refused(why);
};

/** Checks an unsigned-by-us entry tx. `validators`: the ER validators the bot has
 *  endpoints for (`bot.validators`); a presale on any other would stall. Returns
 *  { kind: "open"|"join", user, presale, mint, validator }. Throws Refused. */
export function checkEntryTx(tx, { pid, gate, allow = null, validators }) {
  if (!validators?.length) throw new Error("checkEntryTx needs the bot's ER validators");
  const msg = tx.message;
  if (msg.addressTableLookups?.length) refuse("lookup tables are not allowed in entry txs");
  const keys = msg.staticAccountKeys;
  const gi = keys.findIndex((k) => k.equals(gate));
  if (gi < 0) refuse("the gate key is not in the tx");
  if (gi === 0) refuse("the gate can't pay fees");
  if (!msg.isAccountSigner(gi) || msg.isAccountWritable(gi)) refuse("the gate must be a read-only signer");
  const payer = keys[0];

  const ours = [];
  for (const ci of msg.compiledInstructions) {
    const prog = keys[ci.programIdIndex];
    if (prog.equals(COMPUTE_BUDGET)) continue;
    if (!prog.equals(pid)) refuse(`program ${prog.toBase58()} is not allowed`);
    const data = Buffer.from(ci.data);
    const accs = ci.accountKeyIndexes.map((i) => keys[i]);
    ours.push({ tag: data[0], data, accs });
  }
  // the gate key may appear only as the gate account of the entry instruction
  for (const ci of msg.compiledInstructions) {
    ci.accountKeyIndexes.forEach((i, n) => {
      if (i !== gi) return;
      const tag = ci.data[0];
      const isEntry = keys[ci.programIdIndex].equals(pid) && (tag === IX.OPEN_PRESALE || tag === IX.JOIN);
      if (!isEntry || n !== 1) refuse("the gate key is used outside the gate slot");
    });
  }

  const entries = ours.filter((o) => o.tag === IX.OPEN_PRESALE || o.tag === IX.JOIN);
  const delegates = ours.filter((o) => o.tag === IX.DELEGATE);
  if (entries.length !== 1 || entries.length + delegates.length !== ours.length) refuse("one open or join, plus its delegates, only");
  const entry = entries[0];
  const user = entry.accs[0];
  if (!user.equals(payer)) refuse("the user pays the fees");
  if (allow && !allow.has(user.toBase58())) refuse("wallet not on the beta list");

  const ds = delegates.map((d, order) => {
    if (d.data.length !== 2 || d.accs.length < 9) refuse("bad delegate");
    return { order, kind: d.data[1], payer: d.accs[0], target: d.accs[1], validator: d.accs[8], presale: d.accs[9] };
  });
  if (ds.some((d) => !d.payer.equals(user))) refuse("the user pays the delegation");

  let presale, mint, validator;
  if (entry.tag === IX.OPEN_PRESALE) {
    if (entry.data.length !== 1 + 80) refuse("bad open data");
    mint = entry.accs[3];
    presale = presalePda(pid, mint);
    const seat = seatPda(pid, presale, user);
    const p = ds.filter((d) => d.kind === 0 && d.target.equals(presale));
    const s = ds.filter((d) => d.kind === 1 && d.target.equals(seat) && d.presale?.equals(presale));
    if (ds.length !== 2 || p.length !== 1 || s.length !== 1) refuse("open must delegate the presale and the creator seat in the same tx");
    if (!p[0].validator.equals(s[0].validator)) refuse("presale and seat on different validators");
    if (mint.equals(user)) refuse("the mint can't be the creator");
    // the mint key signs the whole tx: it may appear only in open's mint slot
    const mi = keys.findIndex((k) => k.equals(mint));
    for (const ci of msg.compiledInstructions) {
      ci.accountKeyIndexes.forEach((i, n) => {
        if (i === mi && !(keys[ci.programIdIndex].equals(pid) && ci.data[0] === IX.OPEN_PRESALE && n === 3)) refuse("the mint key is used outside the mint slot");
      });
    }
    validator = p[0].validator;
    // delegate(seat) reads the validator that delegate(presale) writes
    if (p[0].order > s[0].order) refuse("delegate the presale before the seat");
  } else {
    if (entry.data.length !== 1 + 40) refuse("bad join data");
    presale = entry.accs[3];
    const seat = seatPda(pid, presale, user);
    if (ds.length !== 1 || ds[0].kind !== 1 || !ds[0].target.equals(seat) || !ds[0].presale?.equals(presale)) {
      refuse("join must delegate the new seat in the same tx");
    }
    validator = ds[0].validator;
  }
  if (!validators.some((v) => v.equals(validator))) refuse("unknown ER validator");
  return { kind: entry.tag === IX.OPEN_PRESALE ? "open" : "join", user, presale, mint, validator };
}

/**
 * Checks and co-signs a serialized entry tx (base64). For an open, `mintSigner(mint,
 * user)` must return the server's mint Keypair for that CA, and only if it was issued to
 * `user`. Returns the tx, base64.
 */
export function cosign(b64, { pid, gateKey, allow, validators, mintSigner }) {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  const info = checkEntryTx(tx, { pid, gate: gateKey.publicKey, allow, validators });
  const signers = [gateKey];
  if (info.kind === "open") {
    const mk = mintSigner?.(info.mint, info.user);
    if (!mk || !mk.publicKey.equals(info.mint)) refuse("not a mint this server issued");
    signers.push(mk);
  }
  tx.sign(signers);
  return { tx: Buffer.from(tx.serialize()).toString("base64"), ...info };
}

