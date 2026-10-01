// What a wallet did to a tx it signed, and which bytes of a signMessages reply are the
// signature. The phone runs these checks on what Seed Vault hands back.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Keypair, Message, MessageV0, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { signMessage } from "../server/auth.js";
import { unsignedTx } from "../src/client.js";
import { COMPUTE_BUDGET, LIGHTHOUSE, MEMO } from "../src/consts.js";
import { budget, changes, pickSignature, walletSigned } from "../src/walletcheck.js";

const BH = "11111111111111111111111111111111";
const wallet = Keypair.generate();
const memo = (text) => new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(text) });
const price = (microLamports) => ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
const limit = (units) => ComputeBudgetProgram.setComputeUnitLimit({ units });
const v0 = (ixs, { payer = wallet.publicKey, blockhash = BH } = {}) => unsignedTx({ ixs, payer, blockhash });
const legacy = (...ixs) => new Transaction({ feePayer: wallet.publicKey, recentBlockhash: BH }).add(...ixs);

test("budget reads the compute-unit price and limit, v0 and legacy", () => {
  assert.deepEqual(budget(v0([limit(300_000), price(50_000), memo("x")])), { price: 50_000n, limit: 300_000 });
  assert.deepEqual(budget(v0([memo("x")])), { price: null, limit: null });
  assert.deepEqual(budget(legacy(price(100_000), memo("x"))), { price: 100_000n, limit: null });
});

test("a tx the wallet only signed has no changes", () => {
  const after = v0([price(50_000), memo("hi")]);
  after.sign([wallet]);
  assert.deepEqual(changes(v0([price(50_000), memo("hi")]), after), []);
});

test("a legacy tx the wallet only signed has no changes", () => {
  const signed = legacy(price(50_000), memo("er"));
  signed.sign(wallet);
  assert.deepEqual(changes(legacy(price(50_000), memo("er")), Transaction.from(signed.serialize())), []);
});

test("reordered instructions are named", () => {
  assert.deepEqual(changes(v0([memo("a"), memo("b")]), v0([memo("b"), memo("a")])), ["instructions reordered"]);
  // web3.js lists each header group of a v0 tx in the order its instructions first use them, so two accounts move too
  assert.deepEqual(changes(v0([price(50_000), memo("a")]), v0([memo("a"), price(50_000)])), [
    "instructions reordered",
    "account order changed (the new v0 tx lists them as web3.js compiles v0: the fee payer, then signers before others and writable before read-only, each group in the order the instructions first use them)",
  ]);
  assert.deepEqual(changes(legacy(memo("a"), memo("b")), legacy(memo("b"), memo("a"))), ["instructions reordered"]);
});

test("an account made writable or a signer is named, v0 and legacy", () => {
  const k = Keypair.generate().publicKey;
  const ix = (isWritable, isSigner = false) => new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: k, isSigner, isWritable }], data: Buffer.from("k") });
  assert.deepEqual(changes(v0([ix(false)]), v0([ix(true)])), [`account ${k} made writable`]);
  assert.deepEqual(changes(v0([ix(false)]), v0([ix(false, true)])), [`account ${k} made a signer`]); // 1 -> 2 required signatures
  assert.deepEqual(changes(legacy(ix(false)), legacy(ix(true))), [`account ${k} made writable`]);
  assert.deepEqual(changes(legacy(ix(false)), legacy(ix(false, true))), [`account ${k} made a signer`]);
  assert.deepEqual(changes(v0([ix(true, true)]), v0([ix(false)])), [`account ${k} no longer a signer`, `account ${k} made read-only`]);
});

test("a flag change is named next to other changes, not hidden by them", () => {
  const k = Keypair.generate().publicKey;
  const ix = (isWritable, isSigner = false) => new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: k, isSigner, isWritable }], data: Buffer.from("k") });
  assert.deepEqual(changes(v0([price(50_000), ix(false)]), v0([price(100_000), ix(true)])), ["compute-unit price 50000 -> 100000", `account ${k} made writable`]);
  assert.deepEqual(changes(legacy(price(50_000), ix(false)), legacy(price(100_000), ix(false, true))), ["compute-unit price 50000 -> 100000", `account ${k} made a signer`]);
  // Lighthouse write-locks an account the tx already read
  const lh = new TransactionInstruction({ programId: LIGHTHOUSE, keys: [{ pubkey: k, isSigner: false, isWritable: true }], data: Buffer.from([1, 2, 3]) });
  assert.deepEqual(changes(v0([price(50_000), ix(false)]), v0([price(50_000), ix(false), lh])), [`added an instruction for ${LIGHTHOUSE.toBase58()}`, `account ${k} made writable`]);
});

// the same v0 tx with its static accounts listed as `edit` returns them (rows in header order:
// writable signers, readonly signers, writable, readonly); instructions point at the same keys,
// and at the same table slots after them
const relist = (tx, edit) => {
  const m = tx.message;
  const [rows, n0] = [edit(m.staticAccountKeys.map((key, n) => ({ key, signer: m.isAccountSigner(n), writable: m.isAccountWritable(n) }))), m.staticAccountKeys.length];
  const at = (n) => (n < n0 ? rows.findIndex((r) => r.key.equals(m.staticAccountKeys[n])) : n - n0 + rows.length);
  const count = (signer, writable) => rows.filter((r) => r.signer === signer && r.writable === writable).length;
  return new VersionedTransaction(new MessageV0({
    header: { numRequiredSignatures: count(true, true) + count(true, false), numReadonlySignedAccounts: count(true, false), numReadonlyUnsignedAccounts: count(false, false) },
    staticAccountKeys: rows.map((r) => r.key),
    recentBlockhash: m.recentBlockhash,
    compiledInstructions: m.compiledInstructions.map((ci) => ({ ...ci, programIdIndex: at(ci.programIdIndex), accountKeyIndexes: ci.accountKeyIndexes.map(at) })),
    addressTableLookups: m.addressTableLookups,
  }));
};

test("an account no instruction uses is named when added, and account order alone is caught", () => {
  const k = Keypair.generate().publicKey;
  const withSigner = relist(v0([price(100_000), memo("hi")]), (rows) => [rows[0], { key: k, signer: true, writable: true }, ...rows.slice(1)]);
  assert.deepEqual(changes(v0([price(50_000), memo("hi")]), withSigner), ["compute-unit price 50000 -> 100000", `account ${k} added (signer, writable), no instruction uses it`]);
  assert.deepEqual(changes(withSigner, v0([price(100_000), memo("hi")])), [`account ${k} removed (signer, writable), no instruction used it`]);
  const [k1, k2] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  const two = v0([new TransactionInstruction({ programId: MEMO, keys: [k1, k2].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })), data: Buffer.from("k") })]);
  const swapped = relist(two, (rows) => [...rows.slice(0, -2), ...rows.slice(-2).reverse()]);
  assert.notDeepEqual(swapped.message.staticAccountKeys, two.message.staticAccountKeys);
  assert.deepEqual(changes(two, swapped), ["account order changed"]); // k2 before k1, not the order the instruction uses them
});

// a legacy tx as a wallet hands it back: the message with its accounts listed as `edit` returns
// them (each kept in its header group), as wire bytes parsed with Transaction.from, which is
// what MWA's web3.js wrapper returns for a legacy tx
const relistLegacy = (tx, edit) => {
  const m = tx.compileMessage();
  const rows = edit(m.accountKeys.map((key, n) => ({ key, signer: m.isAccountSigner(n), writable: m.isAccountWritable(n) })));
  const at = (n) => rows.findIndex((r) => r.key.equals(m.accountKeys[n]));
  const moved = new Message({ header: m.header, accountKeys: rows.map((r) => r.key), recentBlockhash: m.recentBlockhash, instructions: m.instructions.map((c) => ({ ...c, programIdIndex: at(c.programIdIndex), accounts: c.accounts.map(at) })) });
  return Transaction.from(Buffer.concat([Buffer.from([m.header.numRequiredSignatures]), Buffer.alloc(64 * m.header.numRequiredSignatures), moved.serialize()]));
};
// each header group sorted by code point, payer first, as an engine without ICU collation lists it
const group = (r) => (r.signer ? 0 : 2) + (r.writable ? 0 : 1);
const byCodePoint = (rows) => [rows[0], ...rows.slice(1).sort((x, y) => group(x) - group(y) || (x.key.toBase58() < y.key.toBase58() ? -1 : 1))];

test("a legacy tx whose accounts came back in another order is named, read from its wire bytes", () => {
  // the golden ER tx's two keys: localeCompare and a code-point compare sort them differently
  const ro = (n) => ({ pubkey: new PublicKey(new Uint8Array(32).fill(n)), isSigner: false, isWritable: false });
  const er = new TransactionInstruction({ programId: MEMO, keys: [ro(9), ro(167)], data: Buffer.from("er") });
  const [before, withPrice] = [legacy(er), legacy(price(100), er)];
  assert.deepEqual(changes(before, withPrice), ["compute-unit price none -> 100"]); // web3.js's own order moves nothing
  assert.deepEqual(changes(before, relistLegacy(before, byCodePoint)), ["account order changed"]);
  assert.deepEqual(changes(before, relistLegacy(withPrice, byCodePoint)), ["compute-unit price none -> 100", "account order changed"]);
  // listed in the order the instruction uses them, a legacy tx still gets the plain line (web3.js sorts legacy by key)
  const use = [wallet.publicKey, MEMO, ro(9).pubkey, ro(167).pubkey].map(String);
  const byUse = (rows) => [...rows].sort((x, y) => use.indexOf(x.key.toBase58()) - use.indexOf(y.key.toBase58()));
  assert.deepEqual(changes(before, relistLegacy(before, byUse)), ["account order changed"]);
});

test("a legacy message read back as a VersionedTransaction (the phone's landed-tx check) is still legacy", () => {
  const lg = legacy(price(50_000), memo("x"));
  const landed = new VersionedTransaction(Message.from(lg.serializeMessage()));
  assert.deepEqual(changes(lg, landed), []);
  assert.deepEqual(changes(v0([price(50_000), memo("x")]), landed), ["tx version changed"]);
});

test("the largest limit and price are read in full (u32 and u64, little-endian)", () => {
  const max = v0([limit(0xffffffff), price(2n ** 64n - 1n), memo("x")]);
  assert.deepEqual(budget(max), { price: 18446744073709551615n, limit: 4294967295 });
  assert.deepEqual(changes(v0([limit(200_000), price(50_000), memo("x")]), max), ["compute-unit price 50000 -> 18446744073709551615", "compute-unit limit 200000 -> 4294967295"]);
});

test("a raised price and an added Lighthouse instruction are both named", () => {
  const lh = new TransactionInstruction({ programId: LIGHTHOUSE, keys: [{ pubkey: wallet.publicKey, isSigner: false, isWritable: false }], data: Buffer.from([1, 2, 3]) });
  assert.deepEqual(changes(v0([price(50_000), memo("hi")]), v0([price(100_000), memo("hi"), lh])), [
    "compute-unit price 50000 -> 100000",
    `added an instruction for ${LIGHTHOUSE.toBase58()}`,
  ]);
});

test("a second price or limit instruction is named with both values, prepended or appended (Solana refuses the tx)", () => {
  const before = v0([limit(200_000), price(50_000), memo("hi")]);
  assert.deepEqual(changes(before, v0([price(100_000), limit(200_000), price(50_000), memo("hi")])), [
    "2 compute-unit price instructions: 100000, 50000 (Solana refuses it: DuplicateInstruction)",
  ]);
  assert.deepEqual(changes(before, v0([limit(200_000), price(50_000), memo("hi"), price(100_000)])), [
    "2 compute-unit price instructions: 50000, 100000 (Solana refuses it: DuplicateInstruction)",
  ]);
  assert.deepEqual(changes(before, v0([limit(200_000), price(50_000), limit(300_000), memo("hi")])), [
    "2 compute-unit limit instructions: 200000, 300000 (Solana refuses it: DuplicateInstruction)",
  ]);
});

test("a second heap frame or loaded-accounts size instruction is named too (Solana refuses those as well)", () => {
  const heap = (bytes) => ComputeBudgetProgram.requestHeapFrame({ bytes });
  const loaded = (bytes) => {
    const data = Buffer.from([4, 0, 0, 0, 0]); // SetLoadedAccountsDataSizeLimit(u32)
    data.writeUInt32LE(bytes, 1);
    return new TransactionInstruction({ programId: COMPUTE_BUDGET, keys: [], data });
  };
  const cb = COMPUTE_BUDGET.toBase58();
  assert.deepEqual(changes(v0([heap(32 * 1024), memo("hi")]), v0([heap(32 * 1024), heap(64 * 1024), memo("hi")])), [
    "2 heap frame instructions: 32768, 65536 (Solana refuses it: DuplicateInstruction)",
    `added an instruction for ${cb}`,
  ]);
  assert.deepEqual(changes(v0([loaded(65_536), memo("hi")]), v0([loaded(65_536), memo("hi"), loaded(131_072)])), [
    "2 loaded-accounts data size limit instructions: 65536, 131072 (Solana refuses it: DuplicateInstruction)",
    `added an instruction for ${cb}`,
  ]);
});

test("only a plain price or limit instruction lines up by kind; any other ComputeBudget one is named", () => {
  const cb = COMPUTE_BUDGET.toBase58();
  const odd = (data, keys = []) => new TransactionInstruction({ programId: COMPUTE_BUDGET, keys, data: Buffer.from(data) });
  const before = v0([price(50_000), memo("hi")]);
  // too short to hold a price: Solana refuses it as invalid data, not as a second price
  assert.deepEqual(changes(before, v0([price(50_000), memo("hi"), odd([3, 1, 2, 3])])), [
    "ComputeBudget instruction Solana can't use, data 03010203 (Solana refuses it: InvalidInstructionData)",
    `added an instruction for ${cb}`,
  ]);
  // Solana reads a price with an account, or with a byte past it, but it isn't the plain one we build
  const k = { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false };
  assert.deepEqual(changes(before, v0([odd(price(100_000).data, [k]), memo("hi")])), ["compute-unit price 50000 -> 100000", `added an instruction for ${cb}`]);
  assert.deepEqual(changes(before, v0([odd([...price(100_000).data, 0]), memo("hi")])), ["compute-unit price 50000 -> 100000", `added an instruction for ${cb}`]);
});

test("tag 0 (the retired RequestUnits), an unknown tag or no data: Solana refuses the tx at the first one it can't use", () => {
  const cb = COMPUTE_BUDGET.toBase58();
  const odd = (data) => new TransactionInstruction({ programId: COMPUTE_BUDGET, keys: [], data: Buffer.from(data) });
  const before = v0([price(50_000), memo("hi")]);
  const added = `added an instruction for ${cb}`;
  assert.deepEqual(changes(before, v0([odd([0, 1, 0, 0, 0, 0, 0, 0, 0]), price(50_000), memo("hi")])), [
    "ComputeBudget instruction Solana can't use, data 000100000000000000 (Solana refuses it: InvalidInstructionData)",
    added,
  ]);
  assert.deepEqual(changes(before, v0([price(50_000), memo("hi"), odd([9, 1, 0, 0, 0])])), [
    "ComputeBudget instruction Solana can't use, data 0901000000 (Solana refuses it: InvalidInstructionData)",
    added,
  ]);
  assert.deepEqual(changes(before, v0([price(50_000), odd([]), memo("hi")])), ["ComputeBudget instruction Solana can't use, data none (Solana refuses it: InvalidInstructionData)", added]);
  // Solana reads them in order: a short price before the second one stops it first
  assert.deepEqual(changes(before, v0([price(50_000), odd([3, 1]), price(9), memo("hi")])), [
    "2 compute-unit price instructions: 50000, 9",
    "ComputeBudget instruction Solana can't use, data 0301 (Solana refuses it: InvalidInstructionData)",
    added,
  ]);
  assert.deepEqual(changes(before, v0([price(50_000), price(9), odd([3, 1]), memo("hi")])), [
    "2 compute-unit price instructions: 50000, 9 (Solana refuses it: DuplicateInstruction)",
    "ComputeBudget instruction Solana can't use, data 0301",
    added,
  ]);
});

test("a legacy tx handed back as v0, or the other way, is named", () => {
  assert.deepEqual(changes(legacy(price(50_000), memo("x")), v0([price(50_000), memo("x")])), ["tx version changed"]);
  assert.deepEqual(changes(v0([price(50_000), memo("x")]), legacy(price(50_000), memo("x"))), ["tx version changed"]);
});

test("a new payer, blockhash and limit, and a dropped instruction, are named", () => {
  const before = v0([price(50_000), memo("a"), memo("b")]);
  const after = v0([limit(200_000), price(50_000), memo("a")], { payer: Keypair.generate().publicKey, blockhash: Keypair.generate().publicKey.toBase58() });
  assert.deepEqual(changes(before, after), [
    "fee payer changed",
    "blockhash changed",
    "compute-unit limit none -> 200000",
    `removed an instruction for ${MEMO.toBase58()}`,
  ]);
});

test("an instruction whose accounts changed is named once, not as removed and added", () => {
  const ix = (pubkey) => new TransactionInstruction({ programId: MEMO, keys: [{ pubkey, isSigner: false, isWritable: false }], data: Buffer.from("k") });
  const [k1, k2] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  assert.deepEqual(changes(v0([price(50_000), ix(k1)]), v0([price(50_000), ix(k2)])), [`changed the accounts of an instruction for ${MEMO.toBase58()}`]);
  assert.deepEqual(changes(legacy(ix(k1), memo("x")), legacy(ix(k2), memo("x"))), [`changed the accounts of an instruction for ${MEMO.toBase58()}`]);
  // the same price with an account attached
  const keyed = new TransactionInstruction({ programId: COMPUTE_BUDGET, keys: [{ pubkey: k1, isSigner: false, isWritable: false }], data: price(50_000).data });
  assert.deepEqual(changes(v0([price(50_000), memo("x")]), v0([keyed, memo("x")])), [`changed the accounts of an instruction for ${COMPUTE_BUDGET.toBase58()}`]);
  const keyedLimit = new TransactionInstruction({ programId: COMPUTE_BUDGET, keys: [{ pubkey: k1, isSigner: false, isWritable: false }], data: limit(200_000).data });
  assert.deepEqual(changes(v0([limit(200_000), memo("x")]), v0([keyedLimit, memo("x")])), [`changed the accounts of an instruction for ${COMPUTE_BUDGET.toBase58()}`]);
  // changed and moved: both are named
  assert.deepEqual(changes(v0([ix(k1), memo("x")]), v0([memo("x"), ix(k2)])), [`changed the accounts of an instruction for ${MEMO.toBase58()}`, "instructions reordered"]);
});

test("a signer added to or removed from an instruction is named (the fee payer's line is its own)", () => {
  const k = Keypair.generate().publicKey;
  const signs = new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: k, isSigner: true, isWritable: false }], data: Buffer.from("k") });
  const changed = `changed the accounts of an instruction for ${MEMO.toBase58()}`;
  assert.deepEqual(changes(v0([memo("k")]), v0([signs])), [changed, `account ${k} added (signer, read-only)`]);
  assert.deepEqual(changes(v0([signs]), v0([memo("k")])), [changed, `account ${k} removed (signer, read-only)`]);
  assert.deepEqual(changes(legacy(memo("k")), legacy(signs)), [changed, `account ${k} added (signer, read-only)`]);
});

// lookup tables: a v0 tx that loads accounts `uses` (writable: w, readonly: r) through `tables`
const key = () => Keypair.generate().publicKey;
const table = (addresses) => new AddressLookupTableAccount({ key: key(), state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses } });
const uses = (w, r, data = "t") =>
  new TransactionInstruction({ programId: MEMO, keys: [...w.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })), ...r.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))], data: Buffer.from(data) });
const v0alt = (ixs, tables) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: BH, instructions: ixs }).compileToV0Message(tables));

test("lookup tables: an account moved into a table and a swap between table accounts are named", () => {
  const [a, b] = [key(), key()];
  const had = table([b]);
  const both = table([a, b]);
  assert.deepEqual(changes(v0alt([uses([a], [b])], [had]), v0alt([uses([a], [b])], [both])), [
    `changed the accounts of an instruction for ${MEMO.toBase58()}`,
    "lookup tables changed",
  ]);
  // the first instruction fixes the tables' index order; the second swaps a for b
  const before = v0alt([uses([], [a, b], "fix"), uses([], [a])], [both]);
  const after = v0alt([uses([], [a, b], "fix"), uses([], [b])], [both]);
  assert.deepEqual(after.message.addressTableLookups, before.message.addressTableLookups);
  assert.deepEqual(changes(before, after), [`changed the accounts of an instruction for ${MEMO.toBase58()}`]);
});

test("lookup tables: the same address loaded from another table is named", () => {
  const a0 = key();
  const [t1, t2] = [table([a0]), table([a0])];
  assert.deepEqual(changes(v0alt([uses([a0], [])], [t1]), v0alt([uses([a0], [])], [t2])), [`changed the accounts of an instruction for ${MEMO.toBase58()}`, "lookup tables changed"]);
});

test("lookup tables: accounts resolve by table and slot, writable slots before readonly ones", () => {
  const [t1, t2] = [table([key(), key(), key()]), table([key(), key()])];
  const [[a1, a2, a3], [b1, b2]] = [t1.state.addresses, t2.state.addresses];
  const ixs = [uses([a1, a2, b1], [a3, b2]), uses([b1], [a3])];
  // the same instructions with the tables in the other order: every account index differs
  assert.deepEqual(changes(v0alt(ixs, [t1, t2]), v0alt(ixs, [t2, t1])), ["lookup tables changed"]);
  // one table's writable slots listed the other way round, the instruction still on a1 then a2
  const before = v0alt([uses([a1, a2], [])], [t1]);
  const m = before.message;
  const [n, l] = [m.staticAccountKeys.length, m.addressTableLookups[0]];
  const swap = (i) => (i === n ? n + 1 : i === n + 1 ? n : i);
  const after = new VersionedTransaction(new MessageV0({
    header: m.header, staticAccountKeys: m.staticAccountKeys, recentBlockhash: m.recentBlockhash,
    compiledInstructions: m.compiledInstructions.map((ci) => ({ ...ci, accountKeyIndexes: ci.accountKeyIndexes.map(swap) })),
    addressTableLookups: [{ ...l, writableIndexes: [...l.writableIndexes].reverse() }],
  }));
  assert.deepEqual(changes(before, after), ["lookup tables changed"]);
});

test("lookup tables: an account made read-only in a table is named by table and slot", () => {
  const t = table([key(), key()]);
  const [a, b] = t.state.addresses;
  assert.deepEqual(changes(v0alt([uses([a], [b])], [t]), v0alt([uses([], [a, b])], [t])), ["lookup tables changed", `account 0 of lookup table ${t.key} made read-only`]);
});

test("the v0 order reason is given only where the new tx lists its static accounts by first use, group by group", () => {
  const why = "account order changed (the new v0 tx lists them as web3.js compiles v0: the fee payer, then signers before others and writable before read-only, each group in the order the instructions first use them)";
  const swapLast = (rows) => [...rows.slice(0, -2), ...rows.slice(-2).reverse()];
  const [w, s, r, u] = [key(), key(), key(), key()];
  // one of each header group: payer, s (read-only signer), w, then Memo and r, each group in first-use order
  const groups = v0([new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: w, isSigner: false, isWritable: true }, { pubkey: s, isSigner: true, isWritable: false }, { pubkey: r, isSigner: false, isWritable: false }], data: Buffer.from("g") })]);
  assert.deepEqual(changes(relist(groups, swapLast), groups), [why]);
  // an account no instruction uses: web3.js wouldn't list it, so no reason
  const tx = v0([uses([], [r, w])]);
  const withUnused = relist(tx, (rows) => [rows[0], { key: u, signer: false, writable: false }, ...rows.slice(1)]);
  assert.deepEqual(changes(relist(tx, swapLast), withUnused), [`account ${u} added (read-only), no instruction uses it`, "account order changed"]);
  // table accounts are left out: a writable table slot after the read-only static ones is still first use
  const alt = v0alt([uses([w], [r])], [table([w])]);
  assert.deepEqual(changes(relist(alt, swapLast), alt), [why]);
});

test("an account listed twice is named (Solana refuses the tx)", () => {
  const k = key();
  const tx = v0([uses([], [k])]);
  const twice = relist(tx, (rows) => [...rows, rows.find((r) => r.key.equals(k))]);
  assert.deepEqual(changes(tx, twice), [`account ${k} listed twice (Solana refuses it: AccountLoadedTwice)`]);
  const thrice = relist(tx, (rows) => [...rows, ...[1, 2].map(() => rows.find((r) => r.key.equals(k)))]);
  assert.deepEqual(changes(tx, thrice), [`account ${k} listed twice (Solana refuses it: AccountLoadedTwice)`]);
  // a table slot listed writable and read-only: named by its first listing, not as made read-only
  const t = table([key()]);
  const before = v0alt([uses(t.state.addresses, [])], [t]);
  const m = before.message;
  const both = new VersionedTransaction(new MessageV0({ ...m, addressTableLookups: [{ ...m.addressTableLookups[0], readonlyIndexes: [0] }] }));
  assert.deepEqual(changes(before, both), ["lookup tables changed", `account 0 of lookup table ${t.key} listed twice (Solana refuses it: AccountLoadedTwice)`]);
});

test("a change no other line names still gets one", () => {
  // an instruction pointing past the accounts the tx lists (Solana refuses that too): 7 and 8 both read as "?"
  const m = v0([uses([], [key()])]).message;
  const past = (at) => new VersionedTransaction(new MessageV0({ ...m, compiledInstructions: [{ ...m.compiledInstructions[0], accountKeyIndexes: [at] }] }));
  assert.deepEqual(changes(past(7), past(8)), ["the message changed in another way"]);
});

test("lookup tables the wallet kept are not named", () => {
  const t = table([key(), key()]);
  const ix = uses([t.state.addresses[0]], [t.state.addresses[1]]);
  const signed = v0alt([price(50_000), ix], [t]);
  signed.sign([wallet]);
  assert.deepEqual(changes(v0alt([price(50_000), ix], [t]), signed), []);
  assert.deepEqual(changes(v0alt([price(50_000), ix], [t]), v0alt([price(100_000), ix], [t])), ["compute-unit price 50000 -> 100000"]);
});

test("walletSigned: the wallet's signature must cover the tx it came back with", () => {
  const tx = v0([price(50_000), memo("hi")]);
  assert.equal(walletSigned(tx, wallet.publicKey), false); // not signed yet
  tx.sign([wallet]);
  assert.equal(walletSigned(tx, wallet.publicKey), true);
  assert.equal(walletSigned(tx, Keypair.generate().publicKey), false); // not a signer
  const changed = v0([price(100_000), memo("hi")]);
  changed.signatures[0] = tx.signatures[0]; // signed one tx, returned another
  assert.equal(walletSigned(changed, wallet.publicKey), false);
});

test("walletSigned reads legacy txs (the ER's) too", () => {
  const tx = legacy(memo("er"));
  assert.equal(walletSigned(tx, wallet.publicKey), false);
  tx.sign(wallet);
  assert.equal(walletSigned(tx, wallet.publicKey), true);
  assert.equal(walletSigned(Transaction.from(tx.serialize()), wallet.publicKey), true);
});

test("pickSignature finds the signature in each layout a wallet may return", () => {
  const text = "Mooner: sign in\nwallet: x\ntime: 1";
  const msg = new Uint8Array(Buffer.from(text, "utf8"));
  const sig = new Uint8Array(signMessage(wallet, text));
  const pk = wallet.publicKey;
  assert.deepEqual(pickSignature(msg, sig, pk), { signature: sig, layout: "signature only" });
  assert.deepEqual(pickSignature(msg, Buffer.concat([msg, sig]), pk), { signature: sig, layout: "message then signature" });
  assert.deepEqual(pickSignature(msg, Buffer.concat([sig, msg]), pk), { signature: sig, layout: "signature then message" });
  assert.equal(pickSignature(msg, sig, Keypair.generate().publicKey), null); // another wallet's key
  assert.equal(pickSignature(msg, new Uint8Array(10), pk), null); // too short
});

test("a forged signature for a small-order key doesn't verify (ZIP-215 would pass it)", () => {
  // a small-order key (the identity point) with R = identity and s = 0 passes ZIP-215 for any message
  const weakKey = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? 1 : 0)));
  const sig = Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 1 : 0));
  assert.equal(ed25519.verify(sig, new Uint8Array([1, 2, 3]), weakKey.toBytes()), true); // noble's default
  assert.equal(pickSignature(new Uint8Array([1, 2, 3]), sig, weakKey), null);
  const tx = v0([memo("hi")], { payer: weakKey });
  tx.signatures[0] = sig;
  assert.equal(walletSigned(tx, weakKey), false);
});

test("pickSignature says so when the bytes next to the signature aren't the message", () => {
  const text = "Mooner: sign in\nwallet: x\ntime: 1";
  const msg = new Uint8Array(Buffer.from(text, "utf8"));
  const sig = new Uint8Array(signMessage(wallet, text));
  const pk = wallet.publicKey;
  const other = new Uint8Array(20).fill(9);
  assert.deepEqual(pickSignature(msg, Buffer.concat([sig, other]), pk), { signature: sig, layout: "signature first, then 20 other bytes" });
  assert.deepEqual(pickSignature(msg, Buffer.concat([other, sig]), pk), { signature: sig, layout: "20 other bytes, then the signature" });
  const sameLength = new Uint8Array(msg.length); // as long as the message, but not it
  assert.deepEqual(pickSignature(msg, Buffer.concat([sameLength, sig]), pk), { signature: sig, layout: `${msg.length} other bytes, then the signature` });
});
