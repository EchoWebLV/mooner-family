// The Seed Vault checks (spec 2026-09-29-mooner-seeker-app-design.md, "Seed Vault
// questions"), one function each. All of them only sign (or, for capabilitiesCheck, only
// ask), except sendCheck, which sends one memo tx (0.00001 SOL in fees) that the user
// approves on the phone, at most once per network until the app is force-stopped. The txs
// that are only signed are never sent; the entry and ER txs couldn't land even if they were:
// the entry tx lacks the gate's signature, the ER tx names a seat that doesn't exist. The
// no-fee memo is fully signed with a live blockhash and stays off chain only because nothing
// sends it.

import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { makeApi } from "../../engine/src/apiclient.js";
import { joinIxs, loginMessage, unsignedErTx, unsignedTx } from "../../engine/src/client.js";
import { MEMO } from "../../engine/src/consts.js";
import { checkEntryTx } from "../../engine/src/cosigner.js";
import * as I from "../../engine/src/ix.js";
import { SEAT_LEN } from "../../engine/src/layout.js";
import { seatPda } from "../../engine/src/pdas.js";
import { collationOrder, COLLATION_ORDER, digest, GOLDEN_ER_DIGEST, GOLDEN_JOIN_DIGEST, goldenErTx, goldenJoinTx }
  from "../../engine/src/selftest.js";
import { connect } from "../../engine/src/tx.js";
import { changes, pickSignature, walletSigned } from "../../engine/src/walletcheck.js";
import { errorText, FORCE_STOP } from "./runner";

export const api = makeApi("https://app.mooner.family");

const PRIORITY = 50_000; // µLamports per compute unit: the price the entry tx is built at
// What a join costs the wallet on top of the deposit and the seat's rent:
// - delegating the seat creates the delegation program's record, 96 bytes, and metadata, 133
//   (its fields plus the seat's seeds "seat", presale, user; delegation-program-api 3.1.0,
//   state/delegation_record.rs and delegation_metadata.rs serialized_size). The SDK's buffer
//   is made with 0 lamports and closed in the same instruction (ephemeral-rollups-sdk 0.16.2,
//   cpi.rs delegate_account_inner and utils.rs create_pda with rent_exempt false): free;
// - the fee: 2 signatures (the wallet's, the gate's) at 5,000 lamports, plus the priority. The
//   tx sets no compute-unit limit, so the runtime gives join and delegate 200,000 CU each and
//   the compute-budget instruction 3,000 (agave compute_budget_instruction_details.rs):
//   403,000 CU at PRIORITY, rounded up. Mainnet's getFeeForMessage for this tx says 30,150;
// - and the wallet must keep a 0-byte account's rent: after a tx an account may be empty or
//   rent-exempt, nothing in between.
const RECORD_LEN = 96;
const METADATA_LEN = 133;
const ENTRY_FEE = 2n * 5_000n + (403_000n * BigInt(PRIORITY) + 999_999n) / 1_000_000n;

const memo = (text, signer) =>
  new TransactionInstruction({
    programId: MEMO,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text, "utf8"),
  });

/** Lamports as SOL, without trailing zeros. */
const sol = (lamports) => (Number(lamports) / 1e9).toFixed(9).replace(/\.?0+$/, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A tx's wire bytes. A wallet may hand back a legacy Transaction, which needs the options
 *  to serialize without the signatures it doesn't have yet. */
const wireBytes = (tx) => ("version" in tx ? tx.serialize() : tx.serialize({ requireAllSignatures: false, verifySignatures: false }));

/** What the wallet changed, and whether its signature covers what it returned. */
function report(log, before, after, wallet) {
  const c = changes(before, after);
  log(c.length ? `Seed Vault changed: ${c.join("; ")}` : "Seed Vault changed nothing");
  log(`its signature covers the tx it returned: ${walletSigned(after, wallet) ? "yes" : "NO"}`);
}

/** Whether a golden tx's digest is the one Node computes. */
const golden = (tx, want) => {
  const d = digest(tx);
  return d === want ? "same bytes as Node" : `DIFFERENT (${d})`;
};

/** The device's locale, and what "en" (the locale web3.js sorts with) resolves to here. */
function locales() {
  try {
    return `${Intl.DateTimeFormat().resolvedOptions().locale}; "en" sorting resolves to `
      + `${new Intl.Collator("en").resolvedOptions().locale}`;
  } catch (e) {
    return `unknown (${errorText(e)})`;
  }
}

/** No wallet: the bundle builds both golden txs (v0 and legacy) byte for byte as Node does,
 *  with one web3.js (the Connection wallet-ui made with its own import of web3.js is this
 *  app's too). web3.js orders a legacy tx's accounts with localeCompare, so the engine's text
 *  sorting is checked on its own too, next to the device's locale (a tailored one is the case
 *  that could sort differently). */
export function engineCheck({ log, connection }) {
  const tx = goldenJoinTx();
  log(`golden join tx: ${golden(tx, GOLDEN_JOIN_DIGEST)}`);
  log(`golden ER tx (legacy): ${golden(goldenErTx(), GOLDEN_ER_DIGEST)}`);
  const order = collationOrder();
  const sameOrder = order.join(" ") === COLLATION_ORDER.join(" ");
  log(`text sorting matches Node (web3.js's account order): ${sameOrder ? "yes" : `NO: ${order.join(" ")}`}`);
  if (!sameOrder) log("so legacy txs built on this phone may order their accounts differently from Node's: "
    + "the golden ER tx above is expected to differ too");
  log(`device locale: ${locales()}`);
  log(`one web3.js: ${tx.message.staticAccountKeys[0] instanceof PublicKey ? "yes" : "NO"}`);
  log(`wallet-ui's Connection is the app's web3.js: ${connection instanceof Connection ? "yes" : "NO"}`);
  log(`random keypair: ${Keypair.generate().publicKey.toBase58()}`);
}

/** What Seed Vault says it supports, asked without authorizing. The adapter's
 *  getCapabilities() rewrites the answer (protocol lib handleMobileWalletResponse): on MWA 2.0
 *  it adds both supports_*, on MWA 1.x it makes up features. So the same RPC method is also
 *  asked by its own name, get_capabilities, which comes back untouched (the adapter turns any
 *  property into that method call and rewrites only "getCapabilities"), and the difference
 *  is logged. supported_transaction_versions and max_* are always Seed Vault's own. */
export async function capabilitiesCheck({ w, log }) {
  // One session. Seed Vault's own answer is logged before the adapter's rewrite, which throws
  // on an MWA 2.0 session whose answer has no features (only its 2.0 branch reads
  // features.includes), so a failure there also says the session is MWA 2.0.
  await w.connectAnd(async (wallet) => {
    const raw = await wallet.get_capabilities();
    log(`Seed Vault's answer: ${JSON.stringify(raw)}`);
    log(raw.features
      ? "it has features, an MWA 2.0 field"
      : "it has no features: an MWA 1.x answer, or an MWA 2.0 one that leaves them out");
    log(`v0 txs: ${(raw.supported_transaction_versions ?? []).map(String).includes("0") ? "yes" : "NO"}`);
    let seen;
    try {
      seen = await wallet.getCapabilities();
    } catch (e) {
      return log(`the adapter's getCapabilities() fails on this answer: ${errorText(e)}`);
    }
    const changed = Object.keys(seen).filter((k) => JSON.stringify(seen[k]) !== JSON.stringify(raw[k]));
    log(changed.length
      ? `the adapter's getCapabilities() adds or changes: ${changed.map((k) => `${k} ${JSON.stringify(seen[k])}`).join(", ")}`
      : "the adapter's getCapabilities() changes nothing");
  });
}

/** Mooner sign-in: signMessages, find the signature in the reply, log in on the server. */
export async function signInCheck({ wallet, w, log }) {
  const time = Math.floor(Date.now() / 1000);
  const msg = new Uint8Array(Buffer.from(loginMessage(wallet.toBase58(), time), "utf8"));
  const payload = await w.signMessages(msg);
  log(`signMessages returned ${payload.length} bytes`);
  const got = pickSignature(msg, payload, wallet);
  if (!got) return log("no 64 bytes in the reply verify against the wallet");
  log(`layout: ${got.layout}`);
  const r = await api.login({ wallet: wallet.toBase58(), time, signature: Buffer.from(got.signature).toString("base64") });
  log(`Mooner sign-in: ${r.token ? "ok" : JSON.stringify(r)}`);
}

/** An open presale this wallet has no seat in, with a minute or more left to join; null
 *  when there's none. The list shows only committed wallets, so each one's seats are read
 *  (one that can't be read is skipped). */
async function joinablePresale(wallet) {
  const soon = Date.now() / 1000 + 60;
  for (const p of await api.presales()) {
    // written so a missing deadline is skipped too
    if (p.state !== "OPEN" || !(Number(p.deadlineTs) >= soon)) continue;
    const one = await api.presale(p.presale).catch(() => null);
    if (one && !one.seats.some((s) => s.user === wallet.toBase58())) return p;
  }
  return null;
}

/** Question 1: Seed Vault signs Mooner's entry tx (v0, the gate's key in it), and the gate
 *  would still co-sign what comes back. It joins a real open presale when there is one, so
 *  a pre-sign simulation can pass. Signed only. */
export async function entryCheck({ wallet, w, log, connection }) {
  const info = await api.info();
  log(`uses the server's cluster (${info.cluster}), whatever the Network button says`);
  const pid = new PublicKey(info.program);
  const gate = new PublicKey(info.gate);
  const validators = info.ers.map((e) => new PublicKey(e.validator));
  const deposit = BigInt(info.numbers.MIN_SEAT);
  const open = await joinablePresale(wallet);
  if (open) log(`joins open presale ${open.presale} (ER validator ${open.validator})`);
  else log("no open presale right now, so this join names one that doesn't exist and fails simulation: a refusal here is inconclusive");
  const presale = open ? new PublicKey(open.presale) : Keypair.generate().publicKey;
  const validator = open ? new PublicKey(open.validator) : validators[0];
  const lamports = BigInt(await api.balance(wallet));
  // rents are read on the app's network; mainnet and devnet charge the same per byte
  const rentOf = async (bytes) => BigInt(await connection.getMinimumBalanceForRentExemption(bytes));
  const [seatRent, recordRent, metadataRent, keep] = await Promise.all([SEAT_LEN, RECORD_LEN, METADATA_LEN, 0].map(rentOf));
  const needs = deposit + seatRent + recordRent + metadataRent + ENTRY_FEE + keep;
  log(`wallet holds ${sol(lamports)} SOL; the join needs about ${sol(needs)} SOL: `
    + `the ${sol(deposit)} deposit, ${sol(seatRent)} seat rent, `
    + `${sol(recordRent + metadataRent)} rent for the delegation record and metadata, `
    + `a ${sol(ENTRY_FEE)} fee, and ${sol(keep)} the wallet must keep`);
  if (lamports < needs) log("that's less, so the join may fail simulation: a refusal here is inconclusive");
  const ixs = joinIxs(pid, { user: wallet, gate, presale, sessionKey: Keypair.generate().publicKey, deposit, validator });
  const { blockhash } = await api.blockhash();
  const before = unsignedTx({
    ixs: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), ...ixs],
    payer: wallet,
    blockhash,
  });
  log(`built at a priority of ${PRIORITY} µLamports per compute unit`);
  const after = await w.signTransactions(VersionedTransaction.deserialize(before.serialize()));
  report(log, before, after, wallet);
  try {
    // the server reads the tx from its bytes, so a legacy tx is checked the way it would be there
    const onServer = VersionedTransaction.deserialize(wireBytes(after));
    log(`the gate would co-sign it: yes (${checkEntryTx(onServer, { pid, gate, validators }).kind})`);
  } catch (e) {
    log(`the gate would co-sign it: NO (${e.message})`);
  }
}

/** Question 2: Seed Vault signs an ER tx (legacy, the ER's blockhash; simulating it on
 *  Solana fails). Signed only. */
export async function erCheck({ wallet, w, log }) {
  const info = await api.info();
  log(`uses the server's cluster (${info.cluster}) and its ER, whatever the Network button says`);
  const pid = new PublicKey(info.program);
  const er = info.ers[0];
  log(`ER: ${er.url}`);
  const { blockhash } = await connect(er.url).getLatestBlockhash("confirmed");
  const seat = seatPda(pid, Keypair.generate().publicKey, wallet); // no such seat
  const ixs = [I.rotateKey(pid, { user: wallet, seat, key: Keypair.generate().publicKey })];
  const after = await w.signTransactions(unsignedErTx({ ixs, payer: wallet, blockhash }));
  report(log, unsignedErTx({ ixs, payer: wallet, blockhash }), after, wallet);
}

/** Question 3: what Seed Vault does to a tx with no compute-budget instructions. On devnet
 *  this also answers whether it signs for devnet. Signed only. */
export async function noFeeCheck({ wallet, w, log, connection }) {
  const lamports = await connection.getBalance(wallet, "confirmed");
  log(`wallet holds ${sol(lamports)} SOL on this network`);
  if (lamports === 0) log("an empty wallet can't pay the fee, so simulation fails: "
    + "a refusal here is expected and says nothing about the network");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const build = () => unsignedTx({ ixs: [memo("mooner spike: no fee", wallet)], payer: wallet, blockhash });
  const after = await w.signTransactions(build());
  report(log, build(), after, wallet);
}

// Send memo sends at most once per network until the app is force-stopped. `sends` lives at
// module scope, so it outlives the screen: a network switch, the provider or the whole App
// remounting (Android recreating the activity while Seed Vault is in front). Leaving the app
// and coming back doesn't empty it either (runner.js FORCE_STOP); ending the process, or a JS
// reload, does. A network's entry is set before the tx goes to the wallet. It stays unless
// Seed Vault's answer shows nothing was sent (or no session started): then it's removed, and
// Send memo can be tried again. Any other ending (the adapter's own 90 s timeout, endSession
// failing after a good send, signed but not submitted, no answer yet) leaves it: the memo may
// have landed. The key is the connection's endpoint; each network in SpikeScreen.js has
// exactly one.
const sends = new Map(); // connection.rpcEndpoint -> { connection, wallet, slot, build, sig, waiting }
// The last send Seed Vault refused, per network, keyed as `sends`. A wallet should refuse only
// what it didn't send, but if one sent it anyway, the memo can land: the next Send memo looks
// for it first, and sends nothing if it's there. It can land until its blockhash expires, at
// the lastValidBlockHeight that came with it: 150 blocks on (both public RPCs), and a block
// takes at least a slot, 0.23-0.27 s on both today, so tens of seconds at the least and more
// when slots are skipped or the network is congested. A retap in that time that doesn't find
// it yet sends a second memo. That's accepted: waiting the blockhash out would hold up the
// retry after every decline.
const refused = new Map();
const SEND_MEMO = "mooner spike: send";
const READ_TRIES = 5;
const LOOKUP_LIMIT = 1000; // the most getSignaturesForAddress returns

// Errors that mean nothing was sent:
// - Seed Vault's JSON-RPC errors, which the protocol lib turns into
//   SolanaMobileWalletAdapterProtocolError with the wallet's numeric code (index.native.js
//   281-294; the codes object is at 34-41): all but ERROR_NOT_SUBMITTED (-4: signed, then the
//   submit failed, so it may be out there). A decline is ERROR_NOT_SIGNED (-3);
// - a session that never started (SolanaMobileWalletAdapterModule.kt 116-117, 149, 154, which
//   the lib turns into SolanaMobileWalletAdapterError with that code): no wallet, the user
//   left before it connected, or it didn't connect in time.
const NOT_SENT_CODES = new Set([-1, -2, -3, -5, -100]);
const NO_SESSION = new Set([
  "ERROR_WALLET_NOT_FOUND",
  "Session not established: Local association cancelled by user",
  "Timed out waiting for local association to be ready",
]);
const refusedByWallet = (e) => e?.name === "SolanaMobileWalletAdapterProtocolError" && NOT_SENT_CODES.has(e.code);
const noSession = (e) => e?.name === "SolanaMobileWalletAdapterError" && NO_SESSION.has(e.code);
const OVERTAKEN = "another Send memo on this network went ahead while this one waited: "
  + "this tap sends nothing; tap Send memo again";

/** The one send: a memo at the app's price (limit 50,000 CU, 100,000 µLamports), so the fee
 *  should be 5,000 + 5,000 lamports. Reads back what landed and what it cost. */
export async function sendCheck({ wallet, w, log, connection, retryMs = 2_000 }) {
  const net = connection.rpcEndpoint;
  if (sends.has(net)) return refuse(sends.get(net), log, retryMs);
  const last = refused.get(net);
  if (last) {
    const { hit, unsure, forGood } = await find(last);
    // Another tap (a screen from before a remount has its own) may have moved on during the
    // lookup: its send is under way or latched, or it ended one Seed Vault refused, which this
    // lookup never checked (and whose memo it mustn't take for this one's).
    if (sends.has(net)) return refuse(sends.get(net), log, retryMs);
    if (refused.get(net) !== last) return log(OVERTAKEN);
    if (unsure) {
      log(unsure);
      const next = forGood ? `to send another, ${FORCE_STOP}` : "tap Send memo to look again";
      return log(`so this tap sends nothing: Seed Vault refused the last Send memo on this network, `
        + `and whether that one landed isn't known; ${next}`);
    }
    refused.delete(net);
    if (hit) {
      last.sig = hit.signature;
      sends.set(net, last);
      log(`the send Seed Vault refused landed anyway: ${hit.signature}${failed(hit)}`);
      return readBack(last, log, retryMs);
    }
    // not found (yet: it can still land until its blockhash expires, see `refused`)
    log(`the send Seed Vault refused isn't on chain (no tx of the wallet's since slot ${last.slot} has the memo); `
      + `sending a new one`);
  }
  const { context, value } = await connection.getLatestBlockhashAndContext("confirmed");
  // Another tap may also have moved on while the blockhash came. What this tap found in
  // `refused` is gone by now, so an entry there is a refusal this tap never looked up.
  if (sends.has(net)) return refuse(sends.get(net), log, retryMs);
  if (refused.has(net)) return log(OVERTAKEN);
  const build = () => unsignedTx({
    ixs: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      memo(SEND_MEMO, wallet),
    ],
    payer: wallet,
    blockhash: value.blockhash,
  });
  const tx = build();
  const send = { connection, wallet, slot: context.slot, build, sig: null, waiting: true };
  sends.set(net, send);
  let sig;
  try {
    sig = await w.signAndSendTransactions(tx, context.slot);
  } catch (e) {
    send.waiting = false;
    // (unless a lookup from another screen found it meanwhile: then the answer is wrong)
    if (!send.sig && (refusedByWallet(e) || noSession(e))) {
      sends.delete(net);
      if (refusedByWallet(e)) refused.set(net, send); // no session: the wallet never had it
      throw e;
    }
    if (await unclear(send, errorText(e), log, retryMs)) return;
    throw e;
  }
  send.waiting = false;
  // An answer with no signature (not per spec: the adapter returns signatures[0] of what Seed
  // Vault answered, index.native.mjs 317-331) doesn't say whether the memo went out, so it's
  // treated like an error that may have sent it. A signature a lookup from another screen
  // found meanwhile is kept.
  if (sig) send.sig = sig;
  else if (!send.sig) {
    const why = "Seed Vault's answer has no signature";
    if (await unclear(send, why, log, retryMs)) return;
    throw new Error(why);
  }
  log(`sent: ${send.sig}`);
  // a confirm that throws (the blockhash expired, say) still gets the read-back: the tx may have landed
  try {
    const done = await connection.confirmTransaction(
      { signature: send.sig, blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight },
      "confirmed",
    );
    log(done.value.err ? `failed: ${JSON.stringify(done.value.err)}` : "confirmed");
  } catch (e) {
    log(`confirmation didn't come back (${errorText(e)}); reading it anyway`);
  }
  await readBack(send, log, retryMs);
}

/** Seed Vault's answer (`why`) doesn't say whether the memo went out: looks for it. True
 *  when it's there (and read back); otherwise says the latch stays, and why nothing's known. */
async function unclear(send, why, log, retryMs) {
  const { hit, unsure } = await find(send);
  if (hit) {
    landed(send, hit, log);
    log(`the adapter then reported: ${why}`);
    await readBack(send, log, retryMs);
    return true;
  }
  log(`the memo may have landed (${why}), so Send memo won't send again on this network `
    + `until the app is force-stopped and opened again`);
  log(unsure ?? notThere(send));
  return false;
}

/** A tap while this network has a send: says why nothing is sent, and looks for a send that
 *  has no answer yet. `waiting`: its check is still waiting for Seed Vault (a screen from
 *  before a remount has it); a decline then clears it. */
async function refuse(send, log, retryMs) {
  if (send.sig) return log(`already sent ${send.sig} on this network; to send another, ${FORCE_STOP}`);
  if (send.waiting) log(`an earlier Send memo on this network is still waiting for Seed Vault: this tap sends nothing; `
    + `if its prompt is declined, Send memo works again; if it never answers, ${FORCE_STOP}`);
  else log(`an earlier Send memo on this network may have landed: this tap sends nothing; to send another, ${FORCE_STOP}`);
  const { hit, unsure } = await find(send);
  if (!hit) return log(unsure ?? notThere(send));
  landed(send, hit, log);
  await readBack(send, log, retryMs);
}

/** Looks for the memo among the wallet's txs from the send's slot on (read only): { hit }
 *  when it's there, {} when it isn't, { unsure: why } when that can't be told, with
 *  `forGood` when looking again can't tell either. */
async function find(send) {
  let recent;
  try {
    recent = await send.connection.getSignaturesForAddress(send.wallet, { limit: LOOKUP_LIMIT }, "confirmed");
  } catch (e) {
    return { unsure: `looking for it failed (${errorText(e)}); look up ${send.wallet.toBase58()} on an explorer` };
  }
  const hit = recent.find((t) => t.slot >= send.slot && (t.memo ?? "").includes(SEND_MEMO));
  if (hit) return { hit };
  // Newest first. A list shorter than the limit is all the RPC has for the wallet (a wallet
  // first funded after the send has no tx older than it), and a full one that reaches back
  // past the send's slot holds every tx since. A full one that doesn't reach back never will:
  // new txs only push it further up. An empty one proves nothing: a public RPC can answer []
  // for an address with txs (both do for the Memo program's).
  const explorer = `look up ${send.wallet.toBase58()} on an explorer`;
  if (recent.length === 0) return { unsure: `the search is incomplete: the RPC returned no txs for the wallet; ${explorer}` };
  if (recent.length === LOOKUP_LIMIT && recent.every((t) => t.slot >= send.slot)) {
    return {
      unsure: `the search is incomplete: all ${LOOKUP_LIMIT} txs the RPC returned are from slot ${send.slot} on, `
        + `and none has the memo; ${explorer}`,
      forGood: true,
    };
  }
  return {};
}
const notThere = (send) => `no tx of the wallet's since slot ${send.slot} has the memo: `
  + `if its Seed Vault prompt is still open, approve or decline it; tap Send memo later to look again`;
const failed = (hit) => (hit.err ? ` (failed: ${JSON.stringify(hit.err)})` : "");
function landed(send, hit, log) {
  send.sig = hit.signature;
  log(`it landed: ${hit.signature}${failed(hit)}`);
}

/** Reads the memo back, a few times: a public RPC can lag behind its own "confirmed". */
async function readBack(send, log, retryMs) {
  let got = null;
  for (let i = 1; i <= READ_TRIES && !got; i++) {
    if (i > 1) await sleep(retryMs);
    got = await send.connection.getTransaction(send.sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch((e) => {
      log(`read-back ${i}/${READ_TRIES} failed: ${errorText(e)}`);
      return undefined;
    });
    if (got === null) log(`read-back ${i}/${READ_TRIES}: not there yet`);
  }
  if (!got) return log(`couldn't read it back; look it up on an explorer: ${send.sig}`);
  if (got.version !== 0) log(`landed as version ${got.version}`);
  const c = changes(send.build(), new VersionedTransaction(got.transaction.message));
  log(c.length ? `what landed differs: ${c.join("; ")}` : "what landed is what the app built");
  log(got.meta ? `fee paid: ${got.meta.fee} lamports (expected 10000)` : "the reply has no fee (meta is null); look it up on an explorer");
}
