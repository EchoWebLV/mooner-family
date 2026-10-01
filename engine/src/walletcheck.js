// What a wallet did to a tx it signed. Seed Vault raises a compute-unit price below its
// floor, and wallets may add instructions (Lighthouse); these checks name every change in
// plain words and confirm the wallet's signature covers the tx it handed back. Also: which
// bytes of a signMessages reply are the signature (the MWA spec leaves the layout open).
// No node: imports, so the phone and the web bundle this file as is.

import { ed25519 } from "@noble/curves/ed25519";
import { COMPUTE_BUDGET } from "./consts.js";

const PRICE = 3; // ComputeBudget SetComputeUnitPrice: u64 micro-lamports
const LIMIT = 2; // ComputeBudget SetComputeUnitLimit: u32 units

const isLegacy = (tx) => typeof tx.serializeMessage === "function";
const payerOf = (tx) => (isLegacy(tx) ? tx.feePayer ?? tx.signatures[0]?.publicKey : tx.message.staticAccountKeys[0]);
const blockhashOf = (tx) => (isLegacy(tx) ? tx.recentBlockhash : tx.message.recentBlockhash);

/** The bytes a signature covers. */
export const messageBytes = (tx) => (isLegacy(tx) ? tx.serializeMessage() : tx.message.serialize());

// A legacy tx from Transaction.from (what MWA's web3.js wrapper returns for one) keeps the
// message it was parsed from, and compileMessage hands that back from web3.js's _message
// cache: the wallet's own account order and flags, not a rebuild. It leaves the tx as it is.
const messageOf = (tx) => (isLegacy(tx) ? tx.compileMessage() : tx.message);

/** Every account a message loads, by index: its static keys, then each table's writable slots,
 *  then each table's readonly slots. A table account is `alt<table>:<slot>` (the table's
 *  addresses aren't in the tx; base58 has no "l" or ":", so no label is a key).
 *  Duplicates are found by label only: a static key that also sits in a table slot can't be
 *  seen offline, as table contents aren't in the tx (the app never uses tables). */
const keysOf = (m) => [
  ...m.staticAccountKeys.map((k) => k.toBase58()),
  ...m.addressTableLookups.flatMap((l) => l.writableIndexes.map((i) => `alt${l.accountKey.toBase58()}:${i}`)),
  ...m.addressTableLookups.flatMap((l) => l.readonlyIndexes.map((i) => `alt${l.accountKey.toBase58()}:${i}`)),
];
const nameOf = (k) => (k.includes(":") ? `account ${k.split(":")[1]} of lookup table ${k.slice(3, k.indexOf(":"))}` : `account ${k}`);

/** Every instruction as { program, data, keys } with base58 keys or table labels, legacy or v0. */
function ixsOf(tx) {
  if (isLegacy(tx)) return tx.instructions.map((i) => ({ program: i.programId.toBase58(), data: Uint8Array.from(i.data), keys: i.keys.map((k) => k.pubkey.toBase58()) }));
  const [m, keys] = [tx.message, keysOf(tx.message)];
  return m.compiledInstructions.map((ci) => ({
    program: keys[ci.programIdIndex] ?? "?",
    data: Uint8Array.from(ci.data),
    keys: ci.accountKeyIndexes.map((i) => keys[i] ?? "?"),
  }));
}

const BUDGET = COMPUTE_BUDGET.toBase58();
const isBudget = (i, tag) => i.program === BUDGET && i.data[0] === tag;
// the ComputeBudget tags Solana allows once per tx (a second one: DuplicateInstruction)
const ONCE = { 1: "heap frame", [LIMIT]: "compute-unit limit", [PRICE]: "compute-unit price", 4: "loaded-accounts data size limit" };
const u32 = (d, at) => (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16)) + d[at + 3] * 0x1000000;
const u64 = (d, at) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[at + i]);
  return v;
};

/** The value a ComputeBudget instruction with this tag sets, read as Solana reads it (its
 *  accounts and any bytes past the value are ignored); null for any other instruction. */
function budgetValue(i, tag) {
  const size = tag === PRICE ? 8 : 4;
  if (!isBudget(i, tag) || i.data.length < 1 + size) return null;
  return tag === PRICE ? u64(i.data, 1) : u32(i.data, 1);
}
const valuesOf = (ixs, tag) => ixs.map((i) => budgetValue(i, tag)).filter((v) => v !== null);
// Solana can't use tag 0 (the retired RequestUnits), an unknown tag, or too few bytes: InvalidInstructionData
const usable = (i) => i.data[0] in ONCE && budgetValue(i, i.data[0]) !== null;

/** Where Solana refuses the tx: it reads the ComputeBudget instructions in order and stops at
 *  the first it can't use or the second of a tag. The index, or -1. */
function refusedAt(ixs) {
  const seen = new Set();
  for (const [n, i] of ixs.entries()) {
    if (i.program !== BUDGET) continue;
    if (!usable(i) || seen.has(i.data[0])) return n;
    seen.add(i.data[0]);
  }
  return -1;
}

/** The compute-unit price (BigInt micro-lamports) and limit the tx sets; null where it sets none. */
export function budget(tx) {
  const ixs = ixsOf(tx);
  return { price: valuesOf(ixs, PRICE).pop() ?? null, limit: valuesOf(ixs, LIMIT).pop() ?? null };
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ixId = (i) => `${i.program} ${hex(i.data)} ${i.keys.join(",")}`;

// a plain price or limit instruction (no accounts, just the tag and the value, as
// ComputeBudgetProgram builds it) lines up by kind, so a raised price pairs with the old one
const plain = (i, tag) => budgetValue(i, tag) !== null && !i.keys.length && i.data.length === (tag === PRICE ? 9 : 5);
const kindOf = (i) => (plain(i, PRICE) ? "price" : plain(i, LIMIT) ? "limit" : ixId(i));
const isKind = (id) => id === "price" || id === "limit";
const version = (tx) => (isLegacy(tx) ? "legacy" : tx.message.version);
const tablesOf = (tx) =>
  (isLegacy(tx) ? [] : tx.message.addressTableLookups).map((l) => `${l.accountKey.toBase58()} w${l.writableIndexes} r${l.readonlyIndexes}`).join(";");
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Each account the tx loads, by key or table label, in its order: whether it signs and
 *  whether it's writable, as first listed (one listed twice is named below). */
function accountsOf(tx) {
  const [m, out] = [messageOf(tx), new Map()];
  keysOf(m).forEach((k, n) => out.has(k) || out.set(k, { signer: m.isAccountSigner(n), writable: m.isAccountWritable(n) }));
  return out;
}
const usedBy = (tx, ixs) => new Set([payerOf(tx).toBase58(), ...ixs.flatMap((i) => [i.program, ...i.keys])]);

/** Whether the static accounts are listed as web3.js compiles a v0 tx: each header group in
 *  the order the payer, then each instruction's program and accounts, first use them (Rust's
 *  solana-message sorts them by key instead). */
function inFirstUseOrder(tx, ixs, accounts) {
  const used = [...usedBy(tx, ixs)];
  const keys = [...accounts.keys()].filter((k) => !k.includes(":"));
  const group = (k) => (accounts.get(k).signer ? 0 : 2) + (accounts.get(k).writable ? 0 : 1);
  return keys.every((k) => used.includes(k)) && same(keys, [...keys].sort((x, y) => group(x) - group(y) || used.indexOf(x) - used.indexOf(y)));
}
const flags = (f) => `${f.signer ? "signer, " : ""}${f.writable ? "writable" : "read-only"}`;

/** How many of `xs` appear in `ys` in the same order (longest common subsequence). */
function inOrder(xs, ys) {
  let row = new Array(ys.length + 1).fill(0);
  for (const x of xs) {
    const next = [0];
    ys.forEach((y, j) => next.push(x === y ? row[j] + 1 : Math.max(row[j + 1], next[j])));
    row = next;
  }
  return row[ys.length];
}

/** What differs between the tx we built and the one the wallet returned, one line each;
 *  [] only when the message bytes are the same (the wallet only signed). Price and limit
 *  changes are named with their numbers. */
export function changes(before, after) {
  if (version(before) === version(after) && same(messageBytes(before), messageBytes(after))) return [];
  const out = [];
  if (version(before) !== version(after)) out.push("tx version changed");
  if (!payerOf(before).equals(payerOf(after))) out.push("fee payer changed");
  if (blockhashOf(before) !== blockhashOf(after)) out.push("blockhash changed");
  const [ib, ia] = [ixsOf(before), ixsOf(after)];
  const [b, a] = [budget(before), budget(after)];
  // two of one tag: Solana refuses the tx, so the values are listed instead of budget()'s last one
  const twice = Object.keys(ONCE).map((tag) => [+tag, valuesOf(ia, +tag)]).filter(([, v]) => v.length > 1);
  const once = (tag) => !twice.some(([t]) => t === tag);
  if (b.price !== a.price && once(PRICE)) out.push(`compute-unit price ${b.price ?? "none"} -> ${a.price ?? "none"}`);
  if (b.limit !== a.limit && once(LIMIT)) out.push(`compute-unit limit ${b.limit ?? "none"} -> ${a.limit ?? "none"}`);
  // the refusal is named on the line of the instruction Solana stops at
  const stop = refusedAt(ia);
  const second = stop >= 0 && usable(ia[stop]) ? ia[stop].data[0] : null;
  for (const [tag, v] of twice) out.push(`${v.length} ${ONCE[tag]} instructions: ${v.join(", ")}${tag === second ? " (Solana refuses it: DuplicateInstruction)" : ""}`);
  for (const [n, i] of ia.entries()) {
    if (i.program === BUDGET && !usable(i)) out.push(`ComputeBudget instruction Solana can't use, data ${hex(i.data) || "none"}${n === stop ? " (Solana refuses it: InvalidInstructionData)" : ""}`);
  }
  const [kb, ka] = [ib.map(kindOf), ia.map(kindOf)];
  const left = ka.map((_, n) => n); // after's instructions no before one matched yet
  const gone = [];
  for (const [n, k] of kb.entries()) {
    const j = left.findIndex((m) => ka[m] === k);
    if (j >= 0) left.splice(j, 1);
    else gone.push(n);
  }
  // a removed and an added instruction with the same program and data: its accounts changed
  const head = (i) => `${i.program} ${hex(i.data)}`;
  let removed = 0;
  for (const n of gone) {
    const j = left.findIndex((m) => head(ia[m]) === head(ib[n]));
    if (j >= 0) {
      ka[left[j]] = kb[n]; // the same instruction, for the order check
      left.splice(j, 1);
      out.push(`changed the accounts of an instruction for ${ib[n].program}`);
    } else {
      removed++;
      if (!isKind(kb[n])) out.push(`removed an instruction for ${ib[n].program}`);
    }
  }
  for (const m of left) if (!isKind(ka[m])) out.push(`added an instruction for ${ia[m].program}`);
  if (inOrder(kb, ka) < kb.length - removed) out.push("instructions reordered");
  const [tb, ta] = [tablesOf(before), tablesOf(after)];
  if (tb !== ta) out.push(!tb ? "lookup tables added" : !ta ? "lookup tables removed" : "lookup tables changed");
  // the flags of every account both list (a table account by table and slot)
  const [ab, aa] = [accountsOf(before), accountsOf(after)];
  for (const [k, f] of aa) {
    const was = ab.get(k);
    if (was && was.signer !== f.signer) out.push(`${nameOf(k)} ${f.signer ? "made a signer" : "no longer a signer"}`);
    if (was && was.writable !== f.writable) out.push(`${nameOf(k)} made ${f.writable ? "writable" : "read-only"}`);
  }
  // an account only one lists: named when it signs (the fee payer has its own line) or no instruction uses it
  const [ub, ua] = [usedBy(before, ib), usedBy(after, ia)];
  const [pb, pa] = [payerOf(before).toBase58(), payerOf(after).toBase58()];
  for (const [k, f] of aa) if (!ab.has(k) && (!ua.has(k) || (f.signer && k !== pa))) out.push(`${nameOf(k)} added (${flags(f)})${ua.has(k) ? "" : ", no instruction uses it"}`);
  for (const [k, f] of ab) if (!aa.has(k) && (!ub.has(k) || (f.signer && k !== pb))) out.push(`${nameOf(k)} removed (${flags(f)})${ub.has(k) ? "" : ", no instruction used it"}`);
  // the static accounts both list with the same flags, in each one's order. Equal flags put an
  // account in the same header group in both, and the groups come in a fixed order, so this
  // compares order within each group; web3.js sorts a legacy group by key (the payer first),
  // so its own rebuild moves none of them. Table accounts are left to the tables line.
  const kept = (x, y) => [...x].filter(([k, f]) => !k.includes(":") && y.get(k)?.signer === f.signer && y.get(k)?.writable === f.writable).map(([k]) => k);
  const why = version(after) !== "legacy" && inFirstUseOrder(after, ia, aa)
    ? " (the new v0 tx lists them as web3.js compiles v0: the fee payer, then signers before others and writable before read-only, each group in the order the instructions first use them)"
    : "";
  if (!same(kept(ab, aa), kept(aa, ab))) out.push(`account order changed${why}`);
  const listed = keysOf(messageOf(after));
  for (const k of new Set(listed.filter((k, n) => listed.indexOf(k) !== n))) out.push(`${nameOf(k)} listed twice (Solana refuses it: AccountLoadedTwice)`);
  if (!out.length) out.push("the message changed in another way");
  return out;
}

// noble's strict mode (canonical points, no small-order key), near Solana's verify_strict;
// its default, ZIP-215, passes a small-order key with a forged signature
function verify(signature, message, publicKey) {
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

function signatureOf(tx, wallet) {
  if (isLegacy(tx)) return tx.signatures.find((s) => s.publicKey.equals(wallet))?.signature ?? null;
  const n = tx.message.header.numRequiredSignatures;
  const i = tx.message.staticAccountKeys.slice(0, n).findIndex((k) => k.equals(wallet));
  return i >= 0 ? tx.signatures[i] : null;
}

/** Whether `wallet` signed this exact tx: its signature is there and covers the tx's bytes. */
export function walletSigned(tx, wallet) {
  const sig = signatureOf(tx, wallet);
  if (!sig || sig.every((b) => b === 0)) return false;
  return verify(sig, messageBytes(tx), wallet.toBytes());
}

/** A signMessages reply: the signature alone, the message then the signature, or the
 *  signature then the message. Returns { signature, layout } for the 64 bytes that verify
 *  against `wallet`, or null. The layout names the message only where its bytes are there;
 *  other bytes next to the signature are counted ("20 other bytes, then the signature"). */
export function pickSignature(message, payload, wallet) {
  const tries = [];
  if (payload.length === 64) tries.push(["signature only", payload]);
  if (payload.length > 64) {
    const n = payload.length - 64;
    const [head, last] = [payload.subarray(0, n), payload.subarray(n)];
    const [first, tail] = [payload.subarray(0, 64), payload.subarray(64)];
    tries.push([same(head, message) ? "message then signature" : `${n} other bytes, then the signature`, last]);
    tries.push([same(tail, message) ? "signature then message" : `signature first, then ${n} other bytes`, first]);
  }
  for (const [layout, sig] of tries) {
    if (verify(sig, message, wallet.toBytes())) return { signature: Uint8Array.from(sig), layout };
  }
  return null;
}
