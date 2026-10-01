// alreadyOpen (engine/src/opening.js): a same-coin retry of an open refused because the
// presale is there, so the first open landed. The errors are built the way the server and
// the client build them (describeTxError, TxError, ApiError), not typed out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { ApiError } from "../src/apiclient.js";
import { COMPUTE_BUDGET, describeTxError, SYSTEM } from "../src/consts.js";
import { alreadyOpen } from "../src/opening.js";
import { outcomeUnknown, TxError } from "../src/tx.js";

const PID = new PublicKey(new Uint8Array(32).fill(7));
const pid = PID.toBase58();
const OTHER = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const SIG = "5".repeat(88);
// the open tx: compute budget, open_presale (ix 1), two delegations
const PROGRAMS = [COMPUTE_BUDGET, PID, PID, PID];
const ERR = { InstructionError: [1, { Custom: 28 }] };
const failed = (who, code = "0x1c") => [`Program ${who} invoke [1]`, `Program ${who} consumed 4000 of 200000 compute units`, `Program ${who} failed: custom program error: ${code}`];

/** The server's answer as the client throws it: api.js unsent() adds `sent: false`. */
const refused = (message, extra) => new ApiError(400, message, { error: message, ...extra, sent: false });

test("alreadyOpen: the simulation's 400 (api.js cosignChecked)", () => {
  const logs = failed(pid);
  const e = refused(`the tx fails: ${describeTxError(ERR, PROGRAMS, PID, logs)}`, { logs });
  assert.match(e.message, /AlreadyExists \(28\)/); // the shape this relies on
  assert.equal(alreadyOpen(e, pid), true);
});

test("alreadyOpen: the chain's 400 when a retry lost the race, with logs and without", () => {
  const logs = failed(pid);
  const withLogs = new TxError(SIG, describeTxError(ERR, PROGRAMS, PID, logs), logs, "open");
  assert.equal(alreadyOpen(refused(withLogs.message, { sig: SIG, logs }), pid), true);
  // txLogs found nothing: no name, only who raised it
  const bare = new TxError(SIG, describeTxError(ERR, PROGRAMS, PID, []), [], "open");
  assert.equal(bare.message, `open (${SIG}): ix 1 (${pid}): custom 28`);
  assert.equal(alreadyOpen(refused(bare.message, { sig: SIG, logs: [] }), pid), true);
  // a TxError of its own (the logs on it, not on a body)
  assert.equal(alreadyOpen(Object.assign(new Error("open: failed"), { logs }), pid), true);
});

test("alreadyOpen: the program's log line alone is enough, and only that exact line", () => {
  assert.equal(alreadyOpen(refused("the tx fails", { logs: failed(pid) }), pid), true);
  assert.equal(alreadyOpen(refused("the tx fails", { logs: [`Program ${pid} failed: custom program error: 0x1c0`] }), pid), false);
  assert.equal(alreadyOpen(refused("the tx fails", { logs: [`Program ${pid} failed: custom program error: 0x1d`] }), pid), false);
  assert.equal(alreadyOpen(refused("the tx fails", { logs: [`x Program ${pid} failed: custom program error: 0x1c`] }), pid), false);
});

test("alreadyOpen: another program's 28 is something else", () => {
  const logs = failed(OTHER);
  const named = describeTxError(ERR, [COMPUTE_BUDGET, new PublicKey(OTHER)], PID, logs);
  assert.equal(named, `ix 1 (${OTHER}): custom 28`);
  assert.equal(alreadyOpen(refused(`the tx fails: ${named}`, { logs }), pid), false);
  assert.equal(alreadyOpen(Object.assign(new Error(`open (${SIG}): ${named}`), { logs }), pid), false);
  // `custom 28` only as a whole number
  assert.equal(alreadyOpen(refused(`open (${SIG}): ix 1 (${pid}): custom 280`, { logs: [] }), pid), false);
  // System's "already in use" is its 0, not this
  const system = [`Program ${SYSTEM.toBase58()} invoke [2]`, "Allocate: account Address { address: X, base: None } already in use", `Program ${SYSTEM.toBase58()} failed: custom program error: 0x0`];
  assert.equal(alreadyOpen(refused("the tx fails: ix 1 (11111111111111111111111111111111): custom 0", { logs: system }), pid), false);
});

test("alreadyOpen: unrelated errors, an unknown outcome, nothing", () => {
  assert.equal(alreadyOpen(new Error("You cancelled it in your wallet."), pid), false);
  assert.equal(alreadyOpen(refused("the tx fails: ix 1: NoRoom (6)", { logs: failed(pid, "0x6") }), pid), false);
  assert.equal(alreadyOpen(new ApiError(503, "the network is slow, try again", { error: "the network is slow, try again" }), pid), false);
  assert.equal(alreadyOpen(outcomeUnknown(SIG, "cosign"), pid), false);
  assert.equal(alreadyOpen(null, pid), false);
  assert.equal(alreadyOpen(undefined, pid), false);
  assert.equal(alreadyOpen({}, pid), false);
  assert.equal(alreadyOpen({ message: 42, logs: "no", body: { logs: null } }, pid), false);
  // no pid: only the program's name can say it
  assert.equal(alreadyOpen(refused(`open (${SIG}): ix 1 (${pid}): custom 28`, { logs: failed(pid) }), undefined), false);
});
