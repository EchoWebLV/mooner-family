// Entry txs: their shape, their size, and what the gate co-signer accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AddressLookupTableAccount, Keypair, PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import * as I from "../src/ix.js";
import { cosign, Refused } from "../src/cosigner.js";
import { presalePda, seatPda } from "../src/pdas.js";
import { build } from "../src/tx.js";
import { MOONER_DBC_CONFIG } from "../src/consts.js";
import { launchAltKeys, launchIxs } from "../src/bot.js";

const pid = Keypair.generate().publicKey;
const gateKey = Keypair.generate();
const gate = gateKey.publicKey;
const validator = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const BH = "11111111111111111111111111111111";
const fakeConn = { getLatestBlockhash: async () => ({ blockhash: BH }) };
const b64 = (tx) => Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

async function unsigned(payer, ixs, extra = []) {
  // the client signs its part; the gate (and the mint, for an open) sign on the server
  const { TransactionMessage } = await import("@solana/web3.js");
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: BH, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer, ...extra]);
  return tx;
}

function openIxs(creator, mint, { order = "ok", drop = null } = {}) {
  const presale = presalePda(pid, mint);
  const seat = seatPda(pid, presale, creator);
  const open = I.openPresale(pid, {
    creator, gate, mint, feeDest: Keypair.generate().publicKey, sessionKey: Keypair.generate().publicKey,
    deposit: 1_000_000_000n, commit: 500_000_000n,
  });
  const dp = I.delegate(pid, { payer: creator, target: presale, validator, kind: 0 });
  const ds = I.delegate(pid, { payer: creator, target: seat, validator, kind: 1, presale });
  const ixs = order === "ok" ? [open, dp, ds] : [open, ds, dp];
  return drop ? ixs.filter((_, i) => i !== drop) : ixs;
}

function joinIxs(user, presale) {
  return [
    I.join(pid, { user, gate, presale, sessionKey: Keypair.generate().publicKey, deposit: 1_000_000_000n }),
    I.delegate(pid, { payer: user, target: seatPda(pid, presale, user), validator, kind: 1, presale }),
  ];
}

test("open + delegate presale + delegate seat fits one tx and gets co-signed", async () => {
  const creator = Keypair.generate();
  const mint = Keypair.generate();
  const tx = await unsigned(creator, openIxs(creator.publicKey, mint.publicKey));
  const mintSigner = (m, u) => (m.equals(mint.publicKey) && u.equals(creator.publicKey) ? mint : undefined);
  const out = cosign(b64(tx), { pid, gateKey, validators: [validator], mintSigner });
  assert.equal(out.kind, "open");
  const signed = VersionedTransaction.deserialize(Buffer.from(out.tx, "base64"));
  assert.ok(signed.signatures.every((s) => s.some((b) => b !== 0)), "creator, gate and mint all signed");
  assert.ok(signed.serialize().length <= 1232, `open tx is ${signed.serialize().length} bytes`);
});

test("join + delegate seat fits one tx and gets co-signed", async () => {
  const user = Keypair.generate();
  const presale = presalePda(pid, Keypair.generate().publicKey);
  const tx = await unsigned(user, joinIxs(user.publicKey, presale));
  const out = cosign(b64(tx), { pid, gateKey, allow: new Set([user.publicKey.toBase58()]), validators: [validator] });
  assert.equal(out.kind, "join");
  assert.ok(out.presale.equals(presale));
});

test("the co-signer refuses anything else", async () => {
  const user = Keypair.generate();
  const presale = presalePda(pid, Keypair.generate().publicKey);
  const creator = Keypair.generate();
  const mint = Keypair.generate();
  const mintSigner = () => mint;
  const refused = async (what, ixs, opts = {}) => {
    const payer = opts.payer ?? user;
    const tx = await unsigned(payer, ixs);
    assert.throws(() => cosign(b64(tx), { pid, gateKey, mintSigner, validators: [validator], ...opts }), Refused, what);
  };
  await refused("join without its delegate", joinIxs(user.publicKey, presale).slice(0, 1));
  await refused("an extra program", [...joinIxs(user.publicKey, presale), SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: gate, lamports: 1 })]);
  await refused("two joins", [...joinIxs(user.publicKey, presale), ...joinIxs(user.publicKey, presale)]);
  await refused("not on the beta list", joinIxs(user.publicKey, presale), { allow: new Set() });
  await refused("an unknown validator", joinIxs(user.publicKey, presale), { validators: [Keypair.generate().publicKey] });
  await refused("open without the seat delegate", openIxs(creator.publicKey, mint.publicKey, { drop: 2 }), { payer: creator });
  await refused("seat delegated before the presale", openIxs(creator.publicKey, mint.publicKey, { order: "swapped" }), { payer: creator });
  await refused("a mint the server didn't issue", openIxs(creator.publicKey, mint.publicKey), { payer: creator, mintSigner: () => undefined });
  const issuedTo = (who) => (m, u) => (m.equals(mint.publicKey) && u.equals(who) ? mint : undefined);
  await refused("a mint issued to another wallet", openIxs(creator.publicKey, mint.publicKey), { payer: creator, mintSigner: issuedTo(user.publicKey) });
  await refused("the mint as the creator", openIxs(mint.publicKey, mint.publicKey), { payer: mint });
  const misused = openIxs(creator.publicKey, mint.publicKey);
  misused[1].keys[5] = { pubkey: mint.publicKey, isSigner: false, isWritable: true };
  await refused("the mint key outside the mint slot", misused, { payer: creator });

  // a server with no ER validators configured refuses to run at all
  const tx = await unsigned(user, joinIxs(user.publicKey, presale));
  assert.throws(() => cosign(b64(tx), { pid, gateKey }), (e) => !(e instanceof Refused) && /validators/.test(e.message));

  // the gate as the fee payer
  const ixs = joinIxs(user.publicKey, presale);
  const { TransactionMessage } = await import("@solana/web3.js");
  const msg = new TransactionMessage({ payerKey: gate, recentBlockhash: BH, instructions: ixs }).compileToV0Message();
  assert.throws(() => cosign(b64(new VersionedTransaction(msg)), { pid, gateKey, validators: [validator] }), Refused);
});

test("crank batches and the launch tx fit the packet limit", async () => {
  const bot = Keypair.generate();
  const presale = presalePda(pid, Keypair.generate().publicKey);
  const mint = Keypair.generate();
  const users = Array.from({ length: 8 }, () => Keypair.generate().publicKey);
  const size = async (ixs, signers = [], legacy = false, alts = []) =>
    (await build(fakeConn, { ixs, payer: bot, signers, legacy, alts, blockhash: BH })).serialize().length;

  const settles = users.map((u) => I.settleSeat(pid, { cranker: bot.publicKey, seat: seatPda(pid, presale, u), user: u, presale }));
  assert.ok((await size(settles)) <= 1232, "8 settle_seats");
  const claims = users.slice(0, 6).map((u) => I.claim(pid, { cranker: bot.publicKey, presale, user: u, mint: mint.publicKey }));
  assert.ok((await size(claims)) <= 1232, `6 claims are ${await size(claims)} bytes`);
  const seats = users.concat(users.slice(0, 2)).map((u) => seatPda(pid, presale, u));
  assert.ok((await size([I.commitSeats(pid, { payer: bot.publicKey, presale, seats })], [], true)) <= 1232, "commit_seats x10 (legacy, ER)");

  const p = { mint: mint.publicKey, feeDest: Keypair.generate().publicKey };
  const meta = { name: "Mooner Canary Token", symbol: "MCANARY", uri: "https://ipfs.io/ipfs/bafkreidz2o3o2msfbddbrfvd6bnvvspzq6bpranau26ykahelm5zw7ko3e" };
  const pot = Keypair.generate();
  const ixs = launchIxs({ pid, bot: bot.publicKey, pot: pot.publicKey, presale, p, dbcConfig: MOONER_DBC_CONFIG, meta, released: 9_000_000_000n, minTokens: 1n, cuLimit: 400_000, cuPrice: 1000 });
  const alt = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: launchAltKeys(pid, MOONER_DBC_CONFIG) },
  });
  const n = await size(ixs, [mint, pot], false, [alt]);
  assert.ok(n <= 1232, `launch tx with its ALT is ${n} bytes`);
  const tx = await build(fakeConn, { ixs, payer: bot, signers: [mint, pot], alts: [alt], blockhash: BH });
  assert.equal(tx.message.header.numRequiredSignatures, 3, "bot, mint and pot sign");
});
