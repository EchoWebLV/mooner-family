// The chain flows the web app and the phone app share, against fakes: amounts, errors,
// session keys, waiting on the live socket, the mint request, the entry txs as the gate
// sees them, the ledger in a fake ER and getting the SOL back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SendTransactionError, Transaction, VersionedTransaction } from "@solana/web3.js";
import { mintMessage, signMessage, verifySignature } from "../server/auth.js";
import { checkEntryTx } from "../src/cosigner.js";
import { validSeat } from "../src/client.js";
import { DELEGATION_PROGRAM, describeTxError, IX, numbers } from "../src/consts.js";
import { explain, joinCost, joinFee, makeFlows, openCost, openFee, PUBLIC_RPC, PUBLIC_RPCS, sessionKeyName, sol, toLamports } from "../src/flows.js";
import { P, PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, STATE } from "../src/layout.js";
import { presalePda, seatPda } from "../src/pdas.js";
import { budget } from "../src/walletcheck.js";
import { ApiError } from "../src/apiclient.js";
import bs58 from "bs58";
import { OUTCOME_UNKNOWN } from "../src/tx.js";

const BH = "11111111111111111111111111111111";
const VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";
const SOL = 1_000_000_000n;
const tick = () => new Promise((r) => setImmediate(r));
async function until(cond) {
  for (let i = 0; i < 500 && !cond(); i++) await tick();
  assert.ok(cond(), "it never happened");
}

function memoryKeys() {
  const map = new Map();
  return { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => void map.set(k, v) };
}
const stored = (kp) => Buffer.from(kp.secretKey).toString("base64");

function fakeSocket() {
  const topics = new Map();
  const sock = {
    opened: 0, // subscriptions ever opened
    subscribe(topic, fn) {
      sock.opened++;
      topics.set(topic, (topics.get(topic) ?? new Set()).add(fn));
      return () => topics.get(topic).delete(fn);
    },
    push: (topic, msg) => [...(topics.get(topic) ?? [])].forEach((fn) => fn(msg)),
    count: (topic) => topics.get(topic)?.size ?? 0,
  };
  return sock;
}

function seatBytes({ user, presale, sessionKey, deposit = 0n, commit = 0n }) {
  const d = Buffer.alloc(SEAT_LEN);
  d[0] = SEAT_VERSION;
  user.toBuffer().copy(d, S.USER);
  sessionKey.toBuffer().copy(d, S.SESSION_KEY);
  presale.toBuffer().copy(d, S.PRESALE);
  d.writeBigUInt64LE(deposit, S.DEPOSIT);
  d.writeBigUInt64LE(commit, S.COMMIT);
  return d;
}

/** A Presale in `state` with its deadline (unix seconds; default an hour from now). The
 *  rest is zero: getBack reads only these. */
function presaleBytes(state, deadline = Math.floor(Date.now() / 1000) + 3_600) {
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  d[P.STATE] = state;
  d.writeBigInt64LE(BigInt(deadline), P.DEADLINE_TS);
  return d;
}

/** A fake ER (or Solana, with another url): accounts, every tx sent (decoded), what a
 *  simulation answers, and rotate_key applied to the seat as the program does. */
function fakeConn(pid, url = "https://devnet.magicblock.app") {
  const accounts = new Map();
  const c = {
    rpcEndpoint: url,
    sent: [],
    simErr: null,
    simLogs: null, // what a simulation logs
    txLogs: [], // what getTransaction logs
    sims: 0,
    reads: 0,
    sendOpts: [], // each send's options, refused ones too
    refusal: null, // what every send throws (a failed preflight): nothing goes out
    status: { confirmationStatus: "confirmed", err: null }, // every tx's status (null: none yet)
    height: 1, // the "confirmed" block height
    put: (key, owner, data) => accounts.set(key.toBase58(), { owner, data, lamports: 1, executable: false }),
    drop: (key) => accounts.delete(key.toBase58()),
    getSlot: async () => 1,
    getAccountInfo: async (k) => (c.reads++, accounts.get(k.toBase58()) ?? null),
    getLatestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    async sendRawTransaction(raw, opts) {
      c.sendOpts.push(opts);
      if (c.refusal) throw c.refusal;
      const v0 = raw[1 + 64 * raw[0]] & 0x80; // a versioned message's first byte has the top bit
      const tx = v0 ? VersionedTransaction.deserialize(raw) : Transaction.from(raw);
      c.sent.push(tx);
      for (const ix of v0 ? [] : tx.instructions) {
        if (ix.programId.equals(pid) && ix.data[0] === IX.ROTATE_KEY) ix.data.subarray(1, 33).copy(accounts.get(ix.keys[1].pubkey.toBase58()).data, S.SESSION_KEY);
      }
      return `sig${c.sent.length}`;
    },
    getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [c.status] }),
    getEpochInfo: async () => ({ blockHeight: c.height, absoluteSlot: 1 }),
    simulateTransaction: async () => (c.sims++, { value: { err: c.simErr, logs: c.simLogs } }),
    getTransaction: async () => ({ meta: { logMessages: c.txLogs } }),
  };
  return c;
}

/** `conn`'s simulations fail with Mooner's code `n` at ix 0, as the logs say. */
function refuse(conn, pid, n) {
  conn.simErr = { InstructionError: [0, { Custom: n }] };
  conn.simLogs = [`Program ${pid} invoke [1]`, `Program ${pid} failed: custom program error: 0x${n.toString(16)}`];
}

/** loadInfo()'s shape, with mainnet numbers and one ER (a fakeConn). */
function fakeInfo() {
  const pid = Keypair.generate().publicKey;
  const er = fakeConn(pid);
  return { pid, gate: Keypair.generate().publicKey, N: numbers(false), er, ers: [{ validator: new PublicKey(VALIDATOR), url: er.rpcEndpoint, conn: er }] };
}

/** A wallet that signs for real and keeps what it was asked; `reject(tx)` says no. */
function fakeWallet() {
  const kp = Keypair.generate();
  const w = {
    publicKey: kp.publicKey,
    asked: [],
    sent: [],
    reject: () => false,
    async signTransaction(tx) {
      w.asked.push(tx);
      if (w.reject(tx)) throw new Error("User rejected the request");
      if (tx instanceof Transaction) tx.partialSign(kp);
      else tx.sign([kp]);
      return tx;
    },
    async sendTransaction(tx, conn, opts) {
      w.sent.push({ tx, conn, opts });
      return "settle-sig";
    },
  };
  return w;
}

/** Mooner's instruction tags in a tx (legacy or v0). */
function tags(tx, pid) {
  if (tx instanceof Transaction) return tx.instructions.filter((i) => i.programId.equals(pid)).map((i) => i.data[0]);
  const keys = tx.message.staticAccountKeys;
  return tx.message.compiledInstructions.filter((ci) => keys[ci.programIdIndex].equals(pid)).map((ci) => ci.data[0]);
}

/** The session key an entry tx (open or join) gives the seat. */
function entryKey(tx, pid) {
  const keys = tx.message.staticAccountKeys;
  const ci = tx.message.compiledInstructions.find((c) => keys[c.programIdIndex].equals(pid) && [IX.JOIN, IX.OPEN_PRESALE].includes(c.data[0]));
  const at = ci.data[0] === IX.JOIN ? 1 : 33; // join: tag, key, deposit; open: tag, feeDest, key, ...
  return new PublicKey(ci.data.slice(at, at + 32));
}

/** The server: co-signs what the gate would sign, and then the seat is in the ER with
 *  the key in the tx (as delegation leaves it). */
function fakeApi(info, { confirmed = true, presale = async () => null } = {}) {
  const api = {
    cosigned: [],
    blockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    async cosign(b64) {
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      api.cosigned.push(tx);
      const e = checkEntryTx(tx, { pid: info.pid, gate: info.gate, validators: [info.ers[0].validator] });
      info.er.put(seatPda(info.pid, e.presale, e.user), info.pid, seatBytes({ user: e.user, presale: e.presale, sessionKey: entryKey(tx, info.pid) }));
      return { status: 200, json: { confirmed } };
    },
    presale,
  };
  return api;
}

const flows = (over = {}) => makeFlows({ api: {}, subscribe: () => () => {}, keys: memoryKeys(), ...over });

test("amounts and errors read plainly", () => {
  assert.equal(sol(1_500_000_000n), "1.5");
  assert.equal(sol(0n), "0");
  assert.equal(toLamports("0.1"), 100_000_000n);
  assert.equal(explain(new Error("custom program error: NoRoom")), "The pool is already full.");
  assert.equal(explain(new Error("User rejected the request")), "You cancelled it in your wallet.");
  assert.equal(explain(new Error("something else")), "something else");
});

test("joinCost: what a join takes from the wallet besides the deposit, with the fee counted at the price and compute units a wallet may add; rents read once", async () => {
  const asked = [];
  const rent = (n) => (128 + n) * 5_080; // mainnet's and devnet's rent (CANARY.md)
  const conn = { rpcEndpoint: "https://rent.test", getMinimumBalanceForRentExemption: async (n) => (asked.push(n), rent(n)) };
  const c = await joinCost({ rpc: conn });
  assert.equal(SEAT_LEN, 120);
  assert.deepEqual(c, {
    seat: BigInt(rent(SEAT_LEN)), // 1,259,840
    delegation: BigInt(rent(96) + rent(133)), // the delegation record and metadata
    fee: 90_300n, // 2 signatures: 10,000; 403,000 CU and 400,000 for two Lighthouse ixs, at Seed Vault's 100,000: 80,300
    keep: BigInt(rent(0)), // what the wallet keeps: 650,240
    total: 4_464_180n,
  });
  assert.deepEqual([...asked].sort((a, b) => a - b), [0, 96, 120, 133]);
  await joinCost({ rpc: conn });
  assert.equal(asked.length, 4, "rent is read once");
  assert.equal((await joinCost({ rpc: conn, priority: 100_000 })).fee, 90_300n);
  assert.equal((await joinCost({ rpc: conn, priority: 1 })).fee, 90_300n, "a price below Seed Vault's 100,000 is counted at 100,000");
  assert.equal((await joinCost({ rpc: conn, priority: 100_001 })).fee, 90_301n, "above it, at its own price, rounded up");
  // a read that fails isn't kept
  let n = 0;
  const flaky = { rpcEndpoint: "https://flaky.test", getMinimumBalanceForRentExemption: async () => { if (n++ === 0) throw new Error("429 Too Many Requests"); return 1; } };
  await assert.rejects(joinCost({ rpc: flaky }), /429/);
  assert.equal((await joinCost({ rpc: flaky })).total, 4n + 90_300n);
});

test("openCost: what an open takes from the wallet besides the commit; rents read once and shared, a failed read isn't kept", async () => {
  const asked = [];
  const rent = (n) => (128 + n) * 5_080;
  const conn = { rpcEndpoint: "https://rent-open.test", getMinimumBalanceForRentExemption: async (n) => (asked.push(n), rent(n)) };
  const c = await openCost({ rpc: conn });
  assert.equal(PRESALE_LEN, 272);
  assert.deepEqual(c, {
    presale: BigInt(rent(PRESALE_LEN)), // 2,032,000
    seat: BigInt(rent(SEAT_LEN)), // the creator's seat
    // a record each for the presale and the seat, and metadata sized by their seeds: 100 bytes
    // for ["presale", mint], 133 for ["seat", presale, user] (canary open D9eueWee… paid both)
    delegation: 2n * BigInt(rent(96)) + BigInt(rent(100) + rent(133)),
    fee: 115_300n, // 3 signatures: 15,000; 603,000 CU and 400,000 for two Lighthouse ixs, at 100,000: 100,300
    keep: BigInt(rent(0)),
    total: 8_817_340n,
  });
  assert.notEqual(c.total, 8_984_980n, "not the presale's metadata at the seat's size");
  assert.deepEqual([...asked].sort((a, b) => a - b), [0, 96, 100, 120, 133, 272]);
  await openCost({ rpc: conn });
  await joinCost({ rpc: conn });
  assert.equal(asked.length, 6, "rent is read once, for joinCost too");
  assert.equal((await openCost({ rpc: conn, priority: 100_000 })).fee, 115_300n);
  let n = 0;
  const flaky = { rpcEndpoint: "https://flaky-open.test", getMinimumBalanceForRentExemption: async () => { if (n++ === 0) throw new Error("429 Too Many Requests"); return 1; } };
  await assert.rejects(openCost({ rpc: flaky }), /429/);
  assert.equal((await openCost({ rpc: flaky })).total, 1n + 1n + 4n + 115_300n + 1n);
  // a URL reads through its own Connection, and shares what a Connection to it read
  const pub = { rpcEndpoint: PUBLIC_RPC, getMinimumBalanceForRentExemption: async (b) => rent(b) };
  await openCost({ rpc: pub });
  assert.equal((await openCost()).total, c.total, "the public RPC's rents: no second read");
});

test("joinCost and openCost: a rent read that never answers gives up after 10 s and isn't kept, so the next try reads again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stalled = true;
  let reads = 0;
  const conn = { rpcEndpoint: "https://stall.test", getMinimumBalanceForRentExemption: async () => (reads++, stalled ? new Promise(() => {}) : 1) };
  for (const cost of [joinCost, openCost]) {
    stalled = true;
    let done = false;
    const p = cost({ rpc: conn }).then(() => "resolved", (e) => e.message).finally(() => (done = true));
    for (let i = 0; i < 20; i++) await tick();
    t.mock.timers.tick(9_999);
    for (let i = 0; i < 20; i++) await tick();
    assert.equal(done, false, "not before 10 s");
    t.mock.timers.tick(1);
    await until(() => done);
    assert.equal(await p, "Solana didn't answer; try again");
    const before = reads;
    stalled = false;
    assert.ok((await cost({ rpc: conn })).total > 0n);
    assert.ok(reads > before, "a fresh read, not the stalled one");
  }
  assert.equal(reads, 4 + 4 + 2 + 2, "join: 4 stalled, then 4 afresh; open: its 2 other sizes, stalled, then afresh");
});

// Solana's fee for a tx that sets no CU limit: 5,000 lamports a signature, and the price on
// the default limit, 200,000 CU a program ix and 3,000 a builtin one (agave's
// compute_budget_instruction_details.rs), rounded up. The price counted is the higher of
// the one the tx is built at and 100,000: Seed Vault raises any lower price to it.
function feeOf(tx, built, addedCu) {
  const priority = built > 100_000n ? built : 100_000n;
  const builtins = [ComputeBudgetProgram.programId.toBase58(), SYSTEM];
  const keys = tx.message.staticAccountKeys.map(String);
  const cu = tx.message.compiledInstructions.reduce((n, ci) => n + (builtins.includes(keys[ci.programIdIndex]) ? 3_000n : 200_000n), addedCu);
  return BigInt(tx.message.header.numRequiredSignatures) * 5_000n + (cu * priority + 999_999n) / 1_000_000n;
}

test("joinFee and openFee: the signatures and compute units of the txs the flows build, the Lighthouse ixs a wallet may add, at the higher of the build price and Seed Vault's 100,000", async () => {
  const info = fakeInfo();
  const api = fakeApi(info);
  const w = fakeWallet();
  const f = flows({ api });
  await f.openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: Keypair.generate().publicKey.toBase58(), commit: 100_000_000n });
  await f.joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view: joinable(info).view, amount: 100_000_000n });
  const [open, join] = api.cosigned;
  assert.deepEqual([open, join].map((tx) => tx.message.header.numRequiredSignatures), [3, 2], "the wallet, the gate and (open) the mint sign");
  assert.deepEqual([open, join].map((tx) => tx.message.compiledInstructions.length), [4, 3], "the price, and 3 or 2 of Mooner's");
  // each Lighthouse ix a wallet adds raises the limit by 200,000 CU and signs nothing;
  // Solflare adds two (entry.test.js)
  const lighthouse = 2n * 200_000n;
  for (const p of [50_000, 100_000, 1, 1_000_000, 200_000]) {
    assert.equal(openFee(p), feeOf(open, BigInt(p), lighthouse), `open at ${p}`);
    assert.equal(joinFee(p), feeOf(join, BigInt(p), lighthouse), `join at ${p}`);
  }
  assert.equal(openFee(), 115_300n, "the default 50,000 is counted at 100,000");
  assert.equal(joinFee(), 90_300n);
  assert.equal(openFee(100_000), 115_300n);
  assert.equal(joinFee(100_000), 90_300n);
  assert.equal(joinFee(200_000), 170_600n, "above 100,000: its own price");
});

test("makeFlows' joinCost and openCost: its own priority, rents from its own rpc", async () => {
  const asked = [];
  const rent = (n) => (128 + n) * 5_080;
  const conn = { rpcEndpoint: "https://own-rpc.test", getMinimumBalanceForRentExemption: async (n) => (asked.push(n), rent(n)) };
  const info = { program: Keypair.generate().publicKey.toBase58(), gate: Keypair.generate().publicKey.toBase58(), cluster: "mainnet", numbers: {}, ers: [] };
  const f = makeFlows({ api: { info: async () => info }, subscribe: () => () => {}, keys: memoryKeys(), priority: 200_000, rpc: conn });
  const join = await f.joinCost();
  assert.equal(join.fee, 170_600n, "10,000 and 803,000 CU at 200,000");
  assert.equal(join.total, BigInt(rent(SEAT_LEN) + rent(96) + rent(133) + rent(0)) + 170_600n);
  assert.deepEqual([...asked].sort((a, b) => a - b), [0, 96, 120, 133], "read from its own rpc");
  assert.equal((await f.openCost()).fee, 215_600n, "15,000 and 1,003,000 CU at 200,000");
});

test("makeFlows' joinCost with no rpc: rents from the public RPC of the server's cluster", async () => {
  // devnet's rents here differ from every other test's, so a read from the wrong cluster shows
  const rent = (n) => (7 + n) * 1_000;
  await joinCost({ rpc: { rpcEndpoint: PUBLIC_RPCS.devnet, getMinimumBalanceForRentExemption: async (n) => rent(n) } });
  const info = { program: Keypair.generate().publicKey.toBase58(), gate: Keypair.generate().publicKey.toBase58(), cluster: "devnet", numbers: {}, ers: [] };
  const f = makeFlows({ api: { info: async () => info }, subscribe: () => () => {}, keys: memoryKeys() });
  assert.equal((await f.joinCost()).total, BigInt(rent(SEAT_LEN) + rent(96) + rent(133) + rent(0)) + 90_300n);
});

test("sol: whole numbers keep their zeros at any number of digits", () => {
  assert.equal(sol(100n * SOL, 0), "100");
  assert.equal(sol(10n * SOL, 0), "10");
  assert.equal(sol(0n, 0), "0");
  assert.equal(sol(100n * SOL), "100");
  assert.equal(sol(SOL), "1");
  assert.equal(sol(100_000_000n), "0.1");
  assert.equal(sol(1_234_567_890n, 4), "1.2346");
  assert.equal(sol(10_100_000_000n), "10.1");
});

test("makeFlows refuses a missing or wrong key store", () => {
  assert.throws(() => makeFlows({ api: {}, subscribe: () => () => {} }), /keys/);
  assert.throws(() => makeFlows({ api: {}, subscribe: () => () => {}, keys: { get: async () => null } }), /keys/);
});

test("session keys: none yet, the web app's stored format reads back, a broken store isn't fatal", async () => {
  const keys = memoryKeys();
  const f = flows({ keys });
  assert.equal(await f.sessionKey("P", "W"), null);
  const kp = Keypair.generate();
  keys.map.set(sessionKeyName("P", "W"), btoa(String.fromCharCode(...kp.secretKey))); // what chain.js wrote
  assert.ok((await f.sessionKey("P", "W")).publicKey.equals(kp.publicKey));
  const fail = async () => {
    throw new Error("no storage");
  };
  assert.equal(await flows({ keys: { get: fail, set: fail } }).sessionKey("P", "W"), null);
});

test("loadInfo: one request for callers at once, and a failure isn't kept", async () => {
  let calls = 0;
  let fail = true;
  const raw = { program: Keypair.generate().publicKey.toBase58(), gate: Keypair.generate().publicKey.toBase58(), numbers: { TARGET: "10", SLOTS: 3 }, ers: [{ validator: VALIDATOR, url: "https://er.test" }] };
  const f = flows({
    api: {
      info: async () => {
        calls++;
        await tick();
        if (fail) throw new Error("down");
        return raw;
      },
    },
  });
  await Promise.all([assert.rejects(f.loadInfo(), /down/), assert.rejects(f.loadInfo(), /down/)]);
  assert.equal(calls, 1);
  fail = false;
  const [a, b] = await Promise.all([f.loadInfo(), f.loadInfo()]);
  assert.equal(calls, 2);
  assert.equal(a, b);
  assert.ok(a.pid.equals(new PublicKey(raw.program)));
  assert.deepEqual(a.N, { TARGET: 10n, SLOTS: 3 });
  assert.equal(a.ers[0].conn.rpcEndpoint, "https://er.test");
  await f.loadInfo();
  assert.equal(calls, 2);
});

test("loadInfo: a server that never answers gives up after 10 s and isn't kept, so the next call asks again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let stalled = true;
  const raw = { program: Keypair.generate().publicKey.toBase58(), gate: Keypair.generate().publicKey.toBase58(), numbers: { SLOTS: 3 }, ers: [] };
  const f = flows({ api: { info: async () => (calls++, stalled ? new Promise(() => {}) : raw) } });
  let done = 0;
  const [a, b] = [f.loadInfo(), f.loadInfo()].map((p) => p.then(() => "resolved", (e) => e.message).finally(() => done++));
  for (let i = 0; i < 20; i++) await tick();
  t.mock.timers.tick(9_999);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(done, 0, "not before 10 s");
  t.mock.timers.tick(1);
  await until(() => done === 2);
  assert.equal(await a, "the server didn't answer; try again");
  assert.equal(await b, "the server didn't answer; try again");
  assert.equal(calls, 1);
  stalled = false;
  assert.equal((await f.loadInfo()).N.SLOTS, 3);
  assert.equal(calls, 2, "a fresh request, not the stalled one");
});

test("waitFor: a pushed snapshot, or the first read, or a plain timeout", async () => {
  const sock = fakeSocket();
  const presale = Keypair.generate().publicKey;
  const f = flows({ api: { presale: async () => ({ where: "open", seats: [] }) }, subscribe: sock.subscribe });
  const topic = `presale:${presale}`;
  const p = f.waitFor(presale, (v) => v.seats.length === 1);
  sock.push(topic, { type: "snapshot", data: { seats: [1] } });
  assert.deepEqual(await p, { seats: [1] });
  assert.equal(sock.count(topic), 0); // it stops listening
  assert.deepEqual(await f.waitFor(presale, (v) => v.where === "open"), { where: "open", seats: [] });
  assert.equal(sock.count(topic), 0);
  await assert.rejects(f.waitFor(presale, () => false, { timeoutMs: 10, what: "your seat" }), /your seat didn't show up yet/);
  assert.equal(sock.count(topic), 0);
});

test("waitFor: only a snapshot that matches ends it", async () => {
  const sock = fakeSocket();
  const presale = Keypair.generate().publicKey;
  const topic = `presale:${presale}`;
  const f = flows({ api: { presale: async () => ({ n: 0 }) }, subscribe: sock.subscribe });
  let over = false;
  const p = f.waitFor(presale, (v) => v.n === 2, { timeoutMs: 1_000 }).then((v) => ((over = true), v));
  await tick();
  sock.push(topic, { type: "missing", data: { n: 2 } });
  sock.push(topic, { type: "upsert", data: { n: 2 } });
  sock.push(topic, { type: "snapshot", data: { n: 1 } });
  await tick();
  assert.equal(over, false);
  sock.push(topic, { type: "snapshot", data: { n: 2 } });
  assert.deepEqual(await p, { n: 2 });
  assert.equal(sock.count(topic), 0);
});

test("waitFor: a socket that hands over a snapshot inside subscribe()", async () => {
  const presale = Keypair.generate().publicKey;
  let live = 0;
  const syncSocket = (data) => (topic, fn) => {
    live++;
    fn({ topic, type: "snapshot", data });
    return () => live--;
  };
  const f = flows({ api: { presale: async () => ({ n: 0 }) }, subscribe: syncSocket({ n: 1 }) });
  assert.deepEqual(await f.waitFor(presale, (v) => v.n === 1, { timeoutMs: 1_000 }), { n: 1 });
  assert.equal(live, 0, "it stopped listening");
  // one that doesn't match yet: the first read can still end it
  const g = flows({ api: { presale: async () => ({ n: 2 }) }, subscribe: syncSocket({ n: 1 }) });
  assert.deepEqual(await g.waitFor(presale, (v) => v.n === 2, { timeoutMs: 1_000 }), { n: 2 });
  assert.equal(live, 0);
});

test("waitFor: a view `done` can't read fails the wait at once", async () => {
  const sock = fakeSocket();
  const presale = Keypair.generate().publicKey;
  const f = flows({ api: { presale: async () => null }, subscribe: sock.subscribe });
  const t0 = Date.now();
  await assert.rejects(f.waitFor(presale, (v) => v.where === "er", { timeoutMs: 2_000 }), TypeError);
  assert.ok(Date.now() - t0 < 1_000, "not the timeout");
  assert.equal(sock.count(`presale:${presale}`), 0);
  // and a pushed one
  const g = flows({ api: { presale: () => new Promise(() => {}) }, subscribe: sock.subscribe });
  const p = g.waitFor(presale, (v) => v.where === "er", { timeoutMs: 2_000 });
  sock.push(`presale:${presale}`, { type: "snapshot", data: null });
  await assert.rejects(p, TypeError);
  assert.equal(sock.count(`presale:${presale}`), 0);
});

test("waitFor: a first read that comes after the timeout changes nothing", async () => {
  const sock = fakeSocket();
  const presale = Keypair.generate().publicKey;
  let answer;
  const f = flows({ api: { presale: () => new Promise((r) => (answer = r)) }, subscribe: sock.subscribe });
  let asked = 0;
  await assert.rejects(f.waitFor(presale, (v) => (asked++, v.ok), { timeoutMs: 5 }), /didn't show up yet/);
  answer({ ok: true });
  await tick();
  assert.equal(asked, 0);
  assert.equal(sock.count(`presale:${presale}`), 0);
});

test("requestMint: trimmed details, signed as the server checks them", async () => {
  let sent;
  const f = flows({ api: { mint: async (body) => ((sent = body), { mint: "M" }) } });
  const wallet = Keypair.generate();
  const image = new Uint8Array([1, 2, 3]);
  let asked;
  const signMessageFn = async (bytes) => {
    asked = bytes;
    return new Uint8Array(signMessage(wallet, Buffer.from(bytes).toString("utf8")));
  };
  const r = await f.requestMint({
    wallet: wallet.publicKey, signMessage: signMessageFn, name: " Moon ", symbol: " MOON ", description: " hi ",
    links: { twitter: " x ", telegram: "", website: "" }, image,
  });
  assert.deepEqual(r, { mint: "M" });
  assert.equal(Object.getPrototypeOf(asked), Uint8Array.prototype); // not a Buffer
  assert.deepEqual({ ...sent, time: 0, signature: "" }, {
    wallet: wallet.publicKey.toBase58(), name: "Moon", symbol: "MOON", description: "hi",
    links: { twitter: "x" }, image: Buffer.from(image).toString("base64"), time: 0, signature: "",
  });
  const text = mintMessage({ wallet: wallet.publicKey, name: "Moon", symbol: "MOON", image, details: ["hi", "x", "", ""], time: sent.time });
  assert.ok(verifySignature(wallet.publicKey, text, Buffer.from(sent.signature, "base64")));
});

test("openPresale: the wallet pays, the app's CU price, the saved session key is the one in the tx, the gate would sign it", async () => {
  const keys = memoryKeys();
  const wallet = Keypair.generate().publicKey;
  let cosigned;
  const api = {
    blockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1 }),
    cosign: async (tx) => {
      cosigned = VersionedTransaction.deserialize(Buffer.from(tx, "base64"));
      return { status: 200, json: { confirmed: true } };
    },
  };
  const f = flows({ api, keys, priority: 100_000 });
  const info = fakeInfo();
  const mint = Keypair.generate().publicKey;
  const presale = await f.openPresale({ info, wallet, signTransaction: async (tx) => tx, mint: mint.toBase58(), commit: 400_000_000n });
  assert.ok(presale.equals(presalePda(info.pid, mint)));
  assert.ok(cosigned.message.staticAccountKeys[0].equals(wallet));
  assert.equal(budget(cosigned).price, 100_000n);
  const keysOf = cosigned.message.staticAccountKeys;
  const open = cosigned.message.compiledInstructions.find((ci) => keysOf[ci.programIdIndex].equals(info.pid) && ci.data[0] === IX.OPEN_PRESALE);
  const sk = await f.sessionKey(presale.toBase58(), wallet.toBase58());
  assert.ok(new PublicKey(open.data.slice(33, 65)).equals(sk.publicKey)); // data: tag, feeDest, sessionKey, deposit, commit
  // 0.4 SOL, the largest creator commit: the co-signer's cap agrees
  assert.equal(checkEntryTx(cosigned, { pid: info.pid, gate: info.gate, validators: [info.ers[0].validator], N: info.N }).kind, "open");
});

test("a cosign the server didn't answer in time may have been sent: outcome unknown, named by the signed tx; other failures stay theirs", async () => {
  const info = fakeInfo();
  const w = fakeWallet();
  const late = Object.assign(new ApiError(0, "the server didn't answer in 90 s", null), { timedOut: true });
  let fail = late;
  const api = { ...fakeApi(info), cosign: async () => { throw fail; } };
  const open = () => flows({ api }).openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: Keypair.generate().publicKey.toBase58(), commit: 100_000_000n });
  const e = await open().catch((x) => x);
  assert.equal(e.outcomeUnknown, true);
  assert.equal(e.message, OUTCOME_UNKNOWN);
  assert.equal(explain(e), OUTCOME_UNKNOWN);
  assert.equal(e.what, "cosign");
  assert.equal(e.sig, bs58.encode(w.asked[0].signatures[0]), "the wallet's signature: the tx's id");
  // the server refusing, or a blockhash read timing out, is a plain failure
  fail = new ApiError(400, "the gate refused", { error: "the gate refused" });
  await assert.rejects(open(), (x) => x === fail);
  const slow = Object.assign(new ApiError(0, "the server didn't answer in 10 s", null), { timedOut: true });
  const api2 = { ...fakeApi(info), blockhash: async () => { throw slow; } };
  await assert.rejects(flows({ api: api2 }).openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: Keypair.generate().publicKey.toBase58(), commit: 100_000_000n }), (x) => x === slow);
});

test("openPresale: 50,000 micro-lamports per CU when the app sets no price", async () => {
  const info = fakeInfo();
  const api = fakeApi(info);
  const w = fakeWallet();
  await flows({ api }).openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: Keypair.generate().publicKey.toBase58(), commit: 100_000_000n });
  assert.equal(budget(api.cosigned[0]).price, 50_000n);
});

test("openPresale: a tx the server sent but hasn't confirmed waits for the presale to show", async () => {
  const info = fakeInfo();
  const sock = fakeSocket();
  const api = fakeApi(info, { confirmed: false, presale: async () => ({ where: "closed" }) });
  const w = fakeWallet();
  const mint = Keypair.generate().publicKey;
  const topic = `presale:${presalePda(info.pid, mint)}`;
  let over = false;
  const p = flows({ api, subscribe: sock.subscribe })
    .openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: mint.toBase58(), commit: 100_000_000n })
    .then((r) => ((over = true), r));
  await until(() => sock.count(topic) === 1);
  await tick();
  assert.equal(over, false, "a closed view doesn't end it");
  sock.push(topic, { type: "snapshot", data: { where: "er" } });
  assert.ok((await p).equals(presalePda(info.pid, mint)));
});

test("openPresale: the creator can't take the whole pool; caught before the wallet is asked", async () => {
  const info = fakeInfo();
  const api = fakeApi(info);
  const w = fakeWallet();
  const cap = info.N.TARGET - info.N.MIN_SEAT;
  const over = cap + info.N.STEP;
  assert.ok(validSeat(over, info.N), "a seat size the program takes from a joiner");
  const open = (commit) => flows({ api }).openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: Keypair.generate().publicKey.toBase58(), commit });
  await assert.rejects(open(over), new RegExp(`the creator can put in at most ${sol(cap).replace(".", "\\.")} SOL, so others can join`));
  await assert.rejects(open(info.N.TARGET), /at most/);
  assert.equal(w.asked.length, 0, "the wallet wasn't asked");
  assert.equal(api.cosigned.length, 0, "nothing reached the server");
  await open(cap);
  assert.equal(api.cosigned.length, 1, "the cap itself is fine");
});

test("a seat size the program would refuse is caught before the wallet is asked", async () => {
  let asked = false;
  const signTransaction = async () => {
    asked = true;
  };
  const view = { presale: Keypair.generate().publicKey.toBase58(), validator: VALIDATOR };
  await assert.rejects(flows().joinPresale({ info: fakeInfo(), wallet: Keypair.generate().publicKey, signTransaction, view, amount: 50_000_000n }), /pick 0.1 to 0.5 SOL/);
  assert.equal(asked, false);
});

/** A presale a wallet can join: its view before the join. */
function joinable(info) {
  const presale = presalePda(info.pid, Keypair.generate().publicKey);
  return { presale, view: { presale: presale.toBase58(), validator: VALIDATOR, raised: "0", seats: [] } };
}

test("joinPresale: the gate would sign it, the stored key is the one in the tx, and it signs the commit with no popup", async () => {
  const info = fakeInfo();
  const keys = memoryKeys();
  const api = fakeApi(info);
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const f = flows({ api, keys });
  await f.joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  const [tx] = api.cosigned;
  assert.equal(checkEntryTx(tx, { pid: info.pid, gate: info.gate, validators: [info.ers[0].validator] }).kind, "join");
  const sk = await f.sessionKey(presale.toBase58(), w.publicKey.toBase58());
  assert.ok(entryKey(tx, info.pid).equals(sk.publicKey));
  assert.equal(w.asked.length, 1, "the wallet signed the entry tx only");
  const [commit] = info.er.sent;
  assert.deepEqual(tags(commit, info.pid), [IX.SET_COMMIT]);
  assert.ok(commit.feePayer.equals(sk.publicKey));
  assert.ok(commit.instructions[0].keys[0].pubkey.equals(sk.publicKey));
  assert.ok(commit.verifySignatures());
  assert.equal(commit.instructions[0].data.readBigUInt64LE(1), 200_000_000n);
});

test("joinPresale: a key already stored for the seat is the one it uses, and a cancelled join keeps it", async () => {
  const info = fakeInfo();
  const keys = memoryKeys();
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const name = sessionKeyName(presale.toBase58(), w.publicKey.toBase58());
  const old = Keypair.generate();
  keys.map.set(name, stored(old));
  w.reject = () => true;
  await assert.rejects(flows({ api: fakeApi(info), keys }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n }), /rejected/);
  assert.equal(keys.map.get(name), stored(old), "a cancelled join doesn't replace the key");
  // a retry after an unknown outcome: the tx carries the same key
  w.reject = () => false;
  const api = fakeApi(info);
  await flows({ api, keys }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  assert.ok(entryKey(api.cosigned[0], info.pid).equals(old.publicKey));
  assert.equal(keys.map.get(name), stored(old));
});

test("joinPresale: a key store that can't save still commits with no rotate_key popup", async () => {
  const info = fakeInfo();
  const w = fakeWallet();
  const { view } = joinable(info);
  const keys = {
    get: async () => null,
    set: async () => {
      throw new Error("QuotaExceededError");
    },
  };
  await flows({ api: fakeApi(info), keys }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  assert.equal(w.asked.length, 1, "the entry tx only");
  assert.deepEqual(info.er.sent.map((tx) => tags(tx, info.pid)), [[IX.SET_COMMIT]]);
});

/** A seat already in the ER with `key`, and a flows whose store holds `mine`. */
function seated({ key, mine, commit = 0n }) {
  const info = fakeInfo();
  const keys = memoryKeys();
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const seat = seatPda(info.pid, presale, w.publicKey);
  info.er.put(seat, info.pid, seatBytes({ user: w.publicKey, presale, sessionKey: key.publicKey, deposit: 500_000_000n, commit }));
  const name = sessionKeyName(presale.toBase58(), w.publicKey.toBase58());
  if (mine) keys.map.set(name, stored(mine));
  return { info, keys, w, presale, seat, name, view: { ...view, seats: [{ user: w.publicKey.toBase58(), where: "er", commit: commit.toString() }] } };
}

test("setCommit: a stored key the seat doesn't have costs one rotate_key, and the new key is stored and signs", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  await f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount: 300_000_000n });
  assert.equal(s.w.asked.length, 1);
  const [rotate, commit] = s.info.er.sent;
  assert.deepEqual(tags(rotate, s.info.pid), [IX.ROTATE_KEY]);
  const fresh = new PublicKey(rotate.instructions[0].data.subarray(1, 33));
  assert.ok((await f.sessionKey(s.presale.toBase58(), s.w.publicKey.toBase58())).publicKey.equals(fresh));
  assert.ok(commit.feePayer.equals(fresh));
  assert.deepEqual(tags(commit, s.info.pid), [IX.SET_COMMIT]);
});

test("setCommit: a rotate_key the wallet cancels isn't asked again", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  s.w.reject = () => true;
  await assert.rejects(flows({ keys: s.keys }).setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount: 300_000_000n, retries: 3 }), /rejected/);
  assert.equal(s.w.asked.length, 1);
  assert.equal(s.info.er.sent.length, 0);
});

test("setCommit: two at once on a seat that needs a new key ask the wallet once, and the stored key is the seat's", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  const go = (amount) => f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount });
  await Promise.all([go(300_000_000n), go(400_000_000n)]);
  assert.equal(s.w.asked.length, 1);
  const seatKey = new PublicKey((await s.info.er.getAccountInfo(s.seat)).data.subarray(S.SESSION_KEY, S.SESSION_KEY + 32));
  assert.ok((await f.sessionKey(s.presale.toBase58(), s.w.publicKey.toBase58())).publicKey.equals(seatKey));
  assert.ok(s.info.er.sent.filter((tx) => tags(tx, s.info.pid)[0] === IX.SET_COMMIT).every((tx) => tx.feePayer.equals(seatKey)));
});

/** getBack's world: the seat (in the ER with SOL in the pool, unless `home`, where it came
 *  back with none after a leave), the presale (OPEN in the ER), the socket, Solana (`rpc`)
 *  and the server's reads, which show `reads` in turn (the last one stays). */
function refundable({ home = false } = {}) {
  const key = Keypair.generate();
  const s = seated({ key, mine: key, commit: 300_000_000n });
  const sock = fakeSocket();
  const rpc = fakeConn(s.info.pid, "https://solana.test");
  const seatData = (commit) => seatBytes({ user: s.w.publicKey, presale: s.presale, sessionKey: key.publicKey, deposit: 500_000_000n, commit });
  /** The seat home on Solana with `commit` in the pool. */
  const landHome = (commit = 0n) => rpc.put(s.seat, s.info.pid, seatData(commit));
  /** The presale in `state`: home on Solana, or delegated (the ER has the live copy). */
  const presaleIs = (state, { home: there = false, deadline } = {}) => {
    rpc.put(s.presale, there ? s.info.pid : DELEGATION_PROGRAM, presaleBytes(there ? state : STATE.OPEN, deadline));
    if (there) s.info.er.drop(s.presale);
    else s.info.er.put(s.presale, s.info.pid, presaleBytes(state, deadline));
  };
  presaleIs(STATE.OPEN);
  rpc.put(s.seat, DELEGATION_PROGRAM, seatData(0n));
  if (home) {
    landHome();
    s.info.er.drop(s.seat);
    s.view.seats[0] = { ...s.view.seats[0], where: "home", commit: "0" };
  }
  const reads = [];
  const api = { blockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 7 }), presale: async () => (reads.length > 1 ? reads.shift() : (reads[0] ?? null)) };
  const f = flows({ api, keys: s.keys, subscribe: sock.subscribe, rpc });
  const steps = [];
  const seen = []; // reads of Solana and the ER done by each step
  const onStep = (t) => (steps.push(t), seen.push(rpc.reads + s.info.er.reads));
  const run = (view = s.view) => f.getBack({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, sendTransaction: s.w.sendTransaction, view, onStep });
  // a seat that's home left the pool first, unless `commit` says otherwise
  const withSeat = (where, commit = where === "home" ? "0" : "300000000") => ({ ...s.view, seats: [{ ...s.view.seats[0], where, commit }] });
  return { ...s, key, sock, rpc, run, steps, seen, reads, landHome, presaleIs, topic: `presale:${s.presale}`, withSeat, without: { ...s.view, seats: [] } };
}

/** What went out on Solana: each tx's Mooner instructions. */
const settled = (r) => r.rpc.sent.map((tx) => tags(tx, r.info.pid));

test("getBack: a seat already home is only settled: the wallet signs, the app sends it on its Solana connection and it lands", async () => {
  const r = refundable({ home: true });
  await r.run();
  assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]]);
  assert.equal(r.w.sent.length, 0, "the wallet only signs");
  assert.equal(r.w.asked.length, 1, "one signature: the settle");
  assert.ok(Buffer.from(r.rpc.sent[0].serialize()).equals(Buffer.from(r.w.asked[0].serialize())), "the tx the wallet signed, on the app's Solana connection");
  assert.deepEqual(r.rpc.sendOpts, [{ skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" }], "a settle the program would refuse fails before it's sent");
  // the wallet cranks its own seat and gets the SOL: no fee (settle_seat.rs)
  const { message } = r.rpc.sent[0];
  const [ix] = message.compiledInstructions;
  const [cranker, seat, , user, presale] = ix.accountKeyIndexes.map((i) => message.staticAccountKeys[i]);
  assert.ok(cranker.equals(r.w.publicKey) && user.equals(r.w.publicKey));
  assert.ok(seat.equals(r.seat) && presale.equals(r.presale), "the wallet's own seat, in this presale");
  assert.equal(message.recentBlockhash, BH, "the server's blockhash");
  assert.equal(r.info.er.sent.length, 0);
});

test("getBack: the session key takes the seat out of the ER with no popup when the ER would take it", async () => {
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  await g.run();
  const [leave] = g.info.er.sent;
  assert.deepEqual(tags(leave, g.info.pid), [IX.SET_COMMIT, IX.LEAVE]);
  assert.ok(leave.feePayer.equals(g.key.publicKey));
  assert.deepEqual(g.w.asked.map((tx) => tags(tx, g.info.pid)), [[IX.SETTLE_SEAT]], "no popup for the leave: the one signature is the settle");
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
  assert.deepEqual(g.steps, ["Checking your seat", "Taking your SOL out", "Bringing it back to Solana", "Sending it to your wallet"]);
  assert.equal(g.seen[0], 0, "the first step shows before anything is read");
});

test("getBack: Mooner's own refusal is the error, with no popup", async () => {
  const r = refundable();
  refuse(r.info.er, r.info.pid, 5); // CreatorCannotLower
  r.w.reject = () => true; // a popup ends the run at once: no waiting on what it sent
  await assert.rejects(r.run(), /CreatorCannotLower/);
  assert.equal(r.w.asked.length, 0);
  assert.equal(r.info.er.sent.length, 0);
  assert.equal(r.rpc.sent.length, 0);
});

test("getBack: a code another program raised in the ER isn't Mooner's refusal: the wallet signs", async () => {
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  g.info.er.simErr = { InstructionError: [0, { Custom: 0 }] };
  g.info.er.simLogs = [`Program ${g.info.pid} invoke [1]`, `Program ${SYSTEM} invoke [2]`, `Program ${SYSTEM} failed: custom program error: 0x0`, `Program ${g.info.pid} failed: custom program error: 0x0`];
  await g.run();
  assert.deepEqual(g.w.asked.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE], [IX.SETTLE_SEAT]], "the wallet signed the leave, then the settle");
  assert.ok(g.info.er.sent[0].feePayer.equals(g.w.publicKey));
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: any other refusal falls back to the wallet", async () => {
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  g.info.er.simErr = "InsufficientFundsForFee";
  await g.run();
  assert.deepEqual(g.w.asked.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE], [IX.SETTLE_SEAT]]);
  const [leave] = g.info.er.sent;
  assert.deepEqual(tags(leave, g.info.pid), [IX.SET_COMMIT, IX.LEAVE]);
  assert.ok(leave.feePayer.equals(g.w.publicKey));
  assert.ok(g.steps.includes("Sign in your wallet to take your SOL out"));
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: a view that misses the seat on its way home isn't taken for a refund", async () => {
  const g = refundable();
  g.reads.push(g.without);
  const p = g.run();
  await until(() => g.sock.count(g.topic) === 1 && g.rpc.reads > 0);
  await tick();
  assert.equal(g.rpc.sent.length, 0, "still waiting");
  g.sock.push(g.topic, { type: "snapshot", data: g.withSeat("home") });
  await p;
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: a seat Solana no longer has was refunded already: no settle_seat", async () => {
  const g = refundable();
  g.reads.push(g.without);
  // the keeper refunds it (the account closes) just after the leave
  const send = g.info.er.sendRawTransaction;
  g.info.er.sendRawTransaction = async (raw) => (g.rpc.drop(g.seat), send(raw));
  await g.run();
  assert.deepEqual(g.info.er.sent.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
  assert.equal(g.rpc.sent.length, 0);
});

test("getBack: a view without the seat to begin with asks Solana before it gives up", async () => {
  // gone: nothing to do
  const a = refundable();
  a.rpc.drop(a.seat);
  await a.run(a.without);
  assert.equal(a.rpc.sent.length + a.w.asked.length + a.info.er.sent.length, 0);
  assert.equal(a.rpc.reads, 1, "one read: a view without the seat has nothing to catch up on");
  // still there, on its way home: it waits for it, then settles
  const g = refundable();
  g.reads.push(g.without);
  g.info.er.drop(g.seat);
  const p = g.run(g.without);
  await until(() => g.sock.count(g.topic) === 1);
  g.sock.push(g.topic, { type: "snapshot", data: g.withSeat("home") });
  await p;
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
  assert.deepEqual(g.steps, ["Checking your seat", "Bringing it back to Solana", "Sending it to your wallet"], "nothing to take out of the ER");
});

// ---- keys kept in memory, and rotations ----

/** Another device's rotate_key: a new key on the seat in the ER. Returns it. */
async function rotateElsewhere(er, seat) {
  const kp = Keypair.generate();
  kp.publicKey.toBuffer().copy((await er.getAccountInfo(seat)).data, S.SESSION_KEY);
  return kp;
}
const seatKeyOf = async (er, seat) => new PublicKey((await er.getAccountInfo(seat)).data.subarray(S.SESSION_KEY, S.SESSION_KEY + 32));
const isCommit = (pid) => (tx) => tags(tx, pid)[0] === IX.SET_COMMIT;

/** A wallet that joined with `keys` as its store; `commit(amount)` sets its commit after. */
async function joined(keys, more = {}) {
  const info = fakeInfo();
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const api = fakeApi(info);
  const f = flows({ api, keys, ...more });
  await f.joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  const after = { ...view, raised: "200000000", seats: [{ user: w.publicKey.toBase58(), where: "er", commit: "200000000" }] };
  const commit = (amount, extra = {}) => f.setCommit({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view: after, amount, ...extra });
  return { info, w, presale, seat: seatPda(info.pid, presale, w.publicKey), api, f, view: after, commit, name: sessionKeyName(presale.toBase58(), w.publicKey.toBase58()) };
}

test("a key store that can't save: the key kept in memory signs later commits and the leave, with no popup", async () => {
  const sock = fakeSocket();
  const rpc = fakeConn(Keypair.generate().publicKey, "https://solana.test");
  const keys = {
    get: async () => null,
    set: async () => {
      throw new Error("QuotaExceededError");
    },
  };
  const j = await joined(keys, { subscribe: sock.subscribe, rpc });
  await j.commit(300_000_000n);
  await j.commit(100_000_000n);
  rpc.put(j.seat, DELEGATION_PROGRAM, Buffer.alloc(SEAT_LEN));
  j.api.presale = async () => ({ ...j.view, seats: [{ ...j.view.seats[0], where: "home", commit: "0" }] });
  await j.f.getBack({ info: j.info, wallet: j.w.publicKey, signTransaction: j.w.signTransaction, sendTransaction: j.w.sendTransaction, view: j.view });
  assert.equal(j.w.asked.length, 2, "the entry tx and the settle: no popup for the commits or the leave");
  assert.deepEqual(j.info.er.sent.map((tx) => tags(tx, j.info.pid)), [[IX.SET_COMMIT], [IX.SET_COMMIT], [IX.SET_COMMIT], [IX.LEAVE]]);
  assert.equal(rpc.sent.length, 1, "settle_seat");
});

test("a key store that keeps nothing: the key kept in memory signs, with no popup", async () => {
  const j = await joined({ get: async () => null, set: async () => {} });
  await j.commit(300_000_000n);
  assert.equal(j.w.asked.length, 1);
  assert.ok(j.info.er.sent.every((tx) => tx.feePayer.equals(entryKey(j.api.cosigned[0], j.info.pid))));
});

test("joinPresale: its own key signs the first commit, even if another tab stored another key meanwhile", async () => {
  const keys = memoryKeys();
  const info = fakeInfo();
  const w = fakeWallet();
  const { presale, view } = joinable(info);
  const api = fakeApi(info);
  const cosign = api.cosign;
  api.cosign = async (b64) => {
    const r = await cosign(b64);
    keys.map.set(sessionKeyName(presale.toBase58(), w.publicKey.toBase58()), stored(Keypair.generate()));
    return r;
  };
  await flows({ api, keys }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  assert.equal(w.asked.length, 1, "no rotate_key");
  assert.ok(info.er.sent[0].feePayer.equals(entryKey(api.cosigned[0], info.pid)));
});

test("a key store that reads but can't save: after one rotate_key the new key signs, not the stored old one", async () => {
  const old = Keypair.generate();
  const j = await joined({
    get: async () => stored(old),
    set: async () => {
      throw new Error("QuotaExceededError");
    },
  });
  assert.ok(entryKey(j.api.cosigned[0], j.info.pid).equals(old.publicKey), "the stored key is reused");
  await rotateElsewhere(j.info.er, j.seat);
  await j.commit(300_000_000n);
  assert.equal(j.w.asked.length, 2, "one rotate_key");
  await j.commit(400_000_000n);
  await j.commit(100_000_000n);
  assert.equal(j.w.asked.length, 2, "and no more");
  const key = await seatKeyOf(j.info.er, j.seat);
  assert.ok(j.info.er.sent.filter(isCommit(j.info.pid)).slice(1).every((tx) => tx.feePayer.equals(key)));
});

test("a key store that works again is read again: a key another tab saved there signs", async () => {
  const keys = memoryKeys();
  const set = keys.set;
  let failing = true;
  keys.set = async (k, v) => {
    if (failing) throw new Error("QuotaExceededError");
    return set(k, v);
  };
  const j = await joined(keys);
  failing = false;
  await rotateElsewhere(j.info.er, j.seat);
  await j.commit(300_000_000n); // one rotate_key, saved this time
  assert.equal(j.w.asked.length, 2);
  const other = await rotateElsewhere(j.info.er, j.seat); // another tab's, saved in the store
  keys.map.set(j.name, stored(other));
  await j.commit(400_000_000n);
  assert.equal(j.w.asked.length, 2, "no popup");
  assert.ok(j.info.er.sent.at(-1).feePayer.equals(other.publicKey));
});

test("openPresale: a key already stored for the presale is the one in the tx", async () => {
  const info = fakeInfo();
  const keys = memoryKeys();
  const api = fakeApi(info);
  const w = fakeWallet();
  const mint = Keypair.generate().publicKey;
  const old = Keypair.generate();
  keys.map.set(sessionKeyName(presalePda(info.pid, mint).toBase58(), w.publicKey.toBase58()), stored(old));
  await flows({ api, keys }).openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: mint.toBase58(), commit: 100_000_000n });
  assert.ok(entryKey(api.cosigned[0], info.pid).equals(old.publicKey));
});

test("setCommit: a later rotate_key isn't blocked by an earlier one", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  const go = (amount) => f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount });
  await go(300_000_000n);
  await rotateElsewhere(s.info.er, s.seat);
  await go(400_000_000n);
  assert.equal(s.w.asked.length, 2);
  assert.ok(s.info.er.sent.at(-1).feePayer.equals(await seatKeyOf(s.info.er, s.seat)));
});

test("setCommit: the new key is kept before rotate_key goes out, so a lost answer costs no second popup", async (t) => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  const go = (amount, retries) => f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount, retries });
  // the rotate_key lands, but no status read answers: a failed read only means "ask again",
  // so the send ends when its 30 s are up
  const statuses = s.info.er.getSignatureStatuses;
  s.info.er.getSignatureStatuses = async () => {
    throw new Error("fetch failed");
  };
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  let lost = null;
  go(300_000_000n, 0).then(() => (lost = "resolved"), (e) => (lost = e));
  for (let i = 0; i < 400 && !lost; i++) {
    for (let j = 0; j < 5; j++) await tick();
    t.mock.timers.tick(250);
  }
  t.mock.timers.reset();
  assert.match(lost?.message ?? String(lost), /rotate_key \(sig1\): not confirmed in time/);
  s.info.er.getSignatureStatuses = statuses;
  assert.ok(s.info.er.sent.every((tx) => tags(tx, s.info.pid).join() === String(IX.ROTATE_KEY)), "only the rotate_key went out (sent again while unanswered)");
  await go(300_000_000n);
  assert.equal(s.w.asked.length, 1, "no second rotate_key");
  assert.ok(s.info.er.sent.at(-1).feePayer.equals(await seatKeyOf(s.info.er, s.seat)));
});

test("setCommit: one that read the seat just before another's rotate_key landed doesn't rotate again", async () => {
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const f = flows({ keys: s.keys });
  const go = (amount) => f.setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount });
  // A's wallet signs only when we say so
  let sign;
  const signed = new Promise((r) => (sign = r));
  const walletSign = s.w.signTransaction;
  let prompts = 0;
  s.w.signTransaction = async (tx) => (prompts++, await signed, walletSign(tx));
  const a = go(300_000_000n);
  await until(() => prompts === 1);
  // B reads the seat now (the old key), and the answer comes after A is done
  const read = s.info.er.getAccountInfo;
  let answer;
  const later = new Promise((r) => (answer = r));
  s.info.er.getAccountInfo = async (k) => {
    s.info.er.getAccountInfo = read;
    const now = await read(k);
    const copy = now && { ...now, data: Buffer.from(now.data) };
    await later;
    return copy;
  };
  const b = go(400_000_000n);
  await until(() => s.info.er.getAccountInfo === read);
  sign();
  await a;
  answer();
  await b;
  assert.equal(prompts, 1, "one rotate_key");
  const key = await seatKeyOf(s.info.er, s.seat);
  assert.ok(s.info.er.sent.filter(isCommit(s.info.pid)).every((tx) => tx.feePayer.equals(key)));
});

// ---- waitFor edges ----

test("waitFor: a socket that hands over a snapshot inside subscribe() that `done` can't read", async () => {
  const presale = Keypair.generate().publicKey;
  let live = 0;
  const sub = (topic, fn) => {
    live++;
    fn({ topic, type: "snapshot", data: null });
    return () => live--;
  };
  const f = flows({ api: { presale: async () => null }, subscribe: sub });
  const t0 = Date.now();
  await assert.rejects(f.waitFor(presale, (v) => v.where === "er", { timeoutMs: 2_000 }), TypeError);
  assert.ok(Date.now() - t0 < 1_000, "not the timeout");
  assert.equal(live, 0, "it stopped listening");
});

test("waitFor and getBack's reads: their timers are cleared however they end", async () => {
  const [set, clear] = [globalThis.setTimeout, globalThis.clearTimeout];
  const timers = new Set();
  globalThis.setTimeout = (fn, ms, ...a) => {
    const t = set(fn, ms, ...a);
    if (ms === 7_777 || ms === 10_000) timers.add(t);
    return t;
  };
  globalThis.clearTimeout = (t) => (timers.delete(t), clear(t));
  try {
    const sock = fakeSocket();
    const presale = Keypair.generate().publicKey;
    const f = flows({ api: { presale: async () => ({ n: 0 }) }, subscribe: sock.subscribe });
    const p = f.waitFor(presale, (v) => v.n === 1, { timeoutMs: 7_777 });
    sock.push(`presale:${presale}`, { type: "snapshot", data: { n: 1 } });
    await p;
    await assert.rejects(f.waitFor(presale, (v) => v.x.y, { timeoutMs: 7_777 }), TypeError);
    await refundable({ home: true }).run(); // one Solana read, with a 10 s limit
    const c = refundable({ home: true }); // and the presale read, for SOL in the pool
    c.landHome(300_000_000n);
    c.presaleIs(STATE.EXPIRED, { home: true });
    await c.run();
    assert.equal(c.rpc.sent.length, 1);
  } finally {
    globalThis.setTimeout = set;
    globalThis.clearTimeout = clear;
  }
  assert.equal(timers.size, 0, "no timer left");
});

test("waitFor: a `done` that fails without an error still fails the wait", async () => {
  const f = flows({ api: { presale: async () => ({ n: 0 }) } });
  const out = await f.waitFor(Keypair.generate().publicKey, () => Promise.reject(), { timeoutMs: 1_000 }).then(() => "resolved", () => "rejected");
  assert.equal(out, "rejected");
});

// ---- getBack: what Solana says, and reads that fail ----

test("getBack: a seat home on Solana is settled though the view doesn't list it yet", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.reads.push(g.withSeat("er"));
  const p = g.run();
  await until(() => g.sock.count(g.topic) === 1 && g.info.er.sent.length === 1);
  // it lands home, and the feed's last push comes before the server's listing has it
  g.landHome();
  g.sock.push(g.topic, { type: "snapshot", data: g.without });
  await until(() => g.rpc.sent.length === 1);
  await p;
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: Solana says the seat is home: settled at once, whatever the view says", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.landHome();
  const p = g.run(); // the view says "er"
  await until(() => g.rpc.sent.length === 1);
  await p;
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
  assert.equal(g.info.er.sent.length, 0);
  assert.equal(g.sock.count(g.topic), 0, "no wait");
});

test("getBack: a Solana read that fails isn't taken for a refund, and the timeout says Solana didn't answer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.info.er.drop(g.seat); // it left the ER already
  g.rpc.getAccountInfo = async () => (g.rpc.reads++, Promise.reject(new Error("429 Too Many Requests")));
  g.reads.push(g.without);
  let out = "pending";
  const p = g.run(g.without).then(() => (out = "resolved"), (e) => (out = e.message));
  await until(() => g.sock.count(g.topic) === 1 && g.rpc.reads >= 2);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(out, "pending");
  t.mock.timers.tick(120_000);
  await p;
  assert.match(out, /couldn't reach Solana to check your seat/);
  assert.equal(g.rpc.sent.length, 0);
  // Solana answers but the seat never shows: the plain timeout
  const h = refundable();
  h.info.er.drop(h.seat);
  h.reads.push(h.without);
  const q = h.run(h.without).then(() => "resolved", (e) => e.message);
  await until(() => h.sock.count(h.topic) === 1 && h.rpc.reads >= 2);
  t.mock.timers.tick(120_000);
  assert.match(await q, /your seat on Solana didn't show up yet/);
});

test("getBack: Solana doesn't answer and the view says home: settled at once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = refundable({ home: true });
  r.rpc.getAccountInfo = async () => (r.rpc.reads++, Promise.reject(new Error("fetch failed")));
  const p = r.run();
  await until(() => r.rpc.sent.length + r.sock.opened + r.info.er.reads > 0);
  assert.equal(r.sock.opened + r.info.er.reads, 0, "no ER read, no wait");
  await p;
  assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]]);
});

test("getBack: a view that has the seat again after Solana didn't answer times out plainly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.info.er.drop(g.seat);
  g.rpc.getAccountInfo = async () => (g.rpc.reads++, Promise.reject(new Error("429 Too Many Requests")));
  g.reads.push(g.without);
  const p = g.run(g.without).then(() => "resolved", (e) => e.message);
  await until(() => g.sock.count(g.topic) === 1 && g.rpc.reads >= 2);
  g.sock.push(g.topic, { type: "snapshot", data: g.withSeat("er") });
  await tick();
  t.mock.timers.tick(120_000);
  assert.match(await p, /your seat on Solana didn't show up yet/);
});

test("getBack: a Solana read that hangs counts as no answer, and an ER that hangs is an error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.rpc.getAccountInfo = () => (g.rpc.reads++, new Promise(() => {}));
  g.info.er.getAccountInfo = () => (g.info.er.reads++, new Promise(() => {}));
  const p = g.run().then(() => "resolved", (e) => e.message);
  await until(() => g.rpc.reads === 1);
  t.mock.timers.tick(10_000);
  await until(() => g.info.er.reads === 1);
  t.mock.timers.tick(10_000);
  assert.match(await p, /the presale's ER didn't answer; try again/);
  assert.equal(g.rpc.sent.length + g.info.er.sent.length, 0);
});

test("getBack: Solana is the app's rpc, else the public RPC of the server's cluster", async (t) => {
  let owner, data;
  t.mock.method(Connection.prototype, "getAccountInfo", async () => ({ owner, data, lamports: 1, executable: false }));
  let sentTo = []; // the endpoint of each send
  t.mock.method(Connection.prototype, "sendRawTransaction", async function () {
    sentTo.push(this.rpcEndpoint);
    return "settle-sig";
  });
  t.mock.method(Connection.prototype, "getSignatureStatuses", async () => ({ context: { slot: 1 }, value: [{ confirmationStatus: "confirmed", err: null }] }));
  const settleOn = async (cluster, rpc) => {
    sentTo = [];
    const s = seated({ key: Keypair.generate() });
    owner = s.info.pid;
    data = seatBytes({ user: s.w.publicKey, presale: s.presale, sessionKey: Keypair.generate().publicKey });
    const f = flows({ api: { blockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 7 }) }, keys: s.keys, ...(rpc && { rpc }) });
    const view = { ...s.view, seats: [{ ...s.view.seats[0], where: "home" }] };
    await f.getBack({ info: { ...s.info, cluster }, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, sendTransaction: s.w.sendTransaction, view });
    assert.equal(sentTo.length, 1);
    return sentTo[0];
  };
  assert.equal(await settleOn("devnet"), "https://api.devnet.solana.com");
  assert.equal(await settleOn("mainnet"), "https://api.mainnet-beta.solana.com");
  assert.equal(await settleOn("devnet", "https://rpc.example.test"), "https://rpc.example.test");
  await assert.rejects(settleOn("localnet"), /no public Solana RPC/);
});

// ---- getBack: SOL still in the pool (settle_seat.rs: what it pays out, and when) ----

const FILLED = "The pool filled: your SOL is in and turns into tokens at launch.";
const BY_ITSELF = "It comes back to your wallet by itself.";
const nothingSent = (r) => r.rpc.sent.length + r.w.asked.length + r.info.er.sent.length + r.info.er.sims;
const failure = (p) => p.then(() => "resolved", (e) => e.message);

/** A seat that came home with SOL in the pool (the keeper's commit_seats), the presale in
 *  `state`, home on Solana unless `delegated`. */
function committedHome(state, { delegated = false } = {}) {
  const r = refundable({ home: true });
  r.landHome(300_000_000n);
  r.view.seats[0].commit = "300000000";
  r.presaleIs(state, { home: !delegated });
  return r;
}

test("getBack: SOL in a pool that filled: it says so, and nothing is sent", async () => {
  for (const state of [STATE.FULL, STATE.LAUNCHING, STATE.SETTLED]) {
    const r = committedHome(state);
    assert.equal(await failure(r.run()), FILLED, `state ${state}`);
    assert.equal(nothingSent(r), 0);
  }
});

test("getBack: SOL in an EXPIRED or FAILED presale that's home: settle_seat pays it out", async () => {
  for (const state of [STATE.EXPIRED, STATE.FAILED]) {
    const r = committedHome(state);
    await r.run();
    assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]], `state ${state}`);
  }
});

test("getBack: SOL in an expired presale still in the ER: it comes back by itself, nothing sent", async () => {
  for (const state of [STATE.EXPIRED, STATE.FAILED]) {
    const r = committedHome(state, { delegated: true });
    assert.equal(await failure(r.run()), BY_ITSELF);
    assert.equal(nothingSent(r), 0);
  }
});

test("getBack: SOL in a home seat of an OPEN presale: nothing sent, the seat isn't delegated again", async () => {
  // the program has no such seat: a committed one comes home only once the presale isn't OPEN
  const r = committedHome(STATE.OPEN, { delegated: true });
  assert.match(await failure(r.run()), /try again in a moment/);
  assert.equal(nothingSent(r), 0);
});

test("getBack: a home seat with nothing in the pool is settled, and the presale isn't read", async () => {
  const r = refundable({ home: true });
  r.presaleIs(STATE.FULL, { home: true });
  await r.run();
  assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]]);
  assert.equal(r.rpc.reads, 1, "the seat only");
});

test("getBack: a presale that couldn't be read: nothing sent", async () => {
  const r = committedHome(STATE.EXPIRED);
  r.rpc.drop(r.presale);
  assert.match(await failure(r.run()), /try again/);
  assert.equal(nothingSent(r), 0);
});

test("getBack: a seat still in the ER of a pool that filled: it says so, and nothing goes to the ER", async () => {
  const r = refundable();
  r.reads.push(r.withSeat("home"));
  r.presaleIs(STATE.FULL);
  assert.equal(await failure(r.run()), FILLED);
  assert.equal(nothingSent(r), 0);
  // expired: the keeper sends the seat home and refunds it
  const x = refundable();
  x.reads.push(x.withSeat("home"));
  x.presaleIs(STATE.EXPIRED, { home: true });
  assert.equal(await failure(x.run()), BY_ITSELF);
  assert.equal(nothingSent(x), 0);
});

test("getBack: the ER refuses set_commit 0 past the deadline: it comes back by itself", async () => {
  const r = refundable();
  refuse(r.info.er, r.info.pid, 1); // PastDeadline
  r.w.reject = () => true; // no popup: one would end the run at once
  assert.equal(await failure(r.run()), BY_ITSELF);
  assert.equal(r.rpc.sent.length + r.w.asked.length + r.info.er.sent.length, 0);
});

test("getBack: a pool that fills between the check and the leave: it says so", async () => {
  const r = refundable();
  r.info.er.simulateTransaction = async () => (r.presaleIs(STATE.FULL), { value: { err: { InstructionError: [0, { Custom: 0 }] }, logs: [`Program ${r.info.pid} failed: custom program error: 0x0`] } }); // BadState
  r.w.reject = () => true; // no popup: one would end the run at once
  assert.equal(await failure(r.run()), FILLED);
  assert.equal(r.rpc.sent.length + r.w.asked.length + r.info.er.sent.length, 0);
});

test("getBack: a seat that comes home with SOL in a pool that filled: it says so, nothing sent", async () => {
  // the view says it's home
  const a = refundable();
  a.info.er.drop(a.seat); // on its way home (commit_seats)
  a.presaleIs(STATE.FULL, { home: true });
  a.reads.push(a.withSeat("home", "300000000"));
  assert.equal(await failure(a.run()), FILLED);
  assert.equal(nothingSent(a), 0);
  // Solana says it's home
  const b = refundable();
  b.info.er.drop(b.seat);
  b.presaleIs(STATE.FULL, { home: true });
  b.reads.push(b.without);
  const p = failure(b.run());
  await until(() => b.sock.count(b.topic) === 1);
  b.landHome(300_000_000n);
  b.sock.push(b.topic, { type: "snapshot", data: b.without });
  assert.equal(await p, FILLED);
  assert.equal(nothingSent(b), 0);
  // expired and home: settle_seat refunds it
  const c = refundable();
  c.info.er.drop(c.seat);
  c.presaleIs(STATE.EXPIRED, { home: true });
  c.reads.push(c.withSeat("home", "300000000"));
  await c.run();
  assert.deepEqual(settled(c), [[IX.SETTLE_SEAT]]);
});

test("getBack: a refund that fails on chain is an error that names the program's error", async () => {
  const r = refundable({ home: true });
  r.rpc.status = { confirmationStatus: "confirmed", err: { InstructionError: [0, { Custom: 6 }] } };
  r.rpc.txLogs = [`Program ${r.info.pid} invoke [1]`, `Program ${r.info.pid} failed: custom program error: 0x6`];
  const e = await r.run().then(() => null, (e) => e);
  assert.equal(e?.message, "the refund failed: ix 0: NoRoom (6)");
  assert.equal(explain(e), "The pool is already full.");
  assert.equal(e.outcomeUnknown, undefined);
  assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]], "sent once");
  // the same code with no logs isn't known to be Mooner's: no name
  const n = refundable({ home: true });
  n.rpc.status = { confirmationStatus: "confirmed", err: { InstructionError: [0, { Custom: 6 }] } };
  assert.equal((await n.run().then(() => null, (e) => e))?.message, `the refund failed: ix 0 (${n.info.pid}): custom 6`);
});

test("getBack: a refund Solana never says anything about: outcome unknown, sent again but never signed again; one whose blockhash ran out: the refund failed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const drive = async (p) => {
    let out = null;
    p.then(() => (out = "landed"), (e) => (out = e));
    for (let i = 0; i < 2_000 && !out; i++) {
      await tick();
      t.mock.timers.tick(500);
    }
    return out;
  };
  const r = refundable({ home: true });
  r.rpc.status = null; // no status, ever; the block height stays under the blockhash's 7
  const e = await drive(r.run());
  assert.equal(e?.outcomeUnknown, true);
  assert.equal(e.message, OUTCOME_UNKNOWN);
  assert.equal(explain(e), OUTCOME_UNKNOWN);
  assert.equal(e.what, "refund");
  assert.ok(Date.now() >= 300_000, "the keeper's 300 s");
  assert.equal(r.w.asked.length, 1, "signed once");
  assert.ok(r.rpc.sent.length > 1, "sent again while it could still land");
  assert.ok(r.rpc.sent.every((tx) => Buffer.from(tx.serialize()).equals(Buffer.from(r.rpc.sent[0].serialize()))), "the same tx each time");
  // past block height 7 with no status at a node caught up: it can't land any more
  const x = refundable({ home: true });
  x.rpc.status = null;
  x.rpc.height = 8;
  const y = await drive(x.run());
  assert.equal(y?.message, "the refund failed: expired: the blockhash ran out and the tx never landed");
  assert.equal(y.outcomeUnknown, undefined);
});

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM = "11111111111111111111111111111111";

test("explain: names only: a bare `custom program error: 0x..` could be any program's, so it stays as it is", () => {
  // a Jupiter trade's Token and System errors: Mooner's OverDeposit, BadState and NoRoom by number
  const cases = [
    `Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 3: custom program error: 0x4. \nLogs: \n["Program ${TOKEN} invoke [2]","Program log: Error: owner does not match","Program ${TOKEN} failed: custom program error: 0x4"]. \nCatch the \`SendTransactionError\` and call \`getLogs()\` on it for full details.`,
    `Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 1: custom program error: 0x0. \nLogs: \n["Program ${SYSTEM} invoke [2]","Allocate: account Address { address: X, base: None } already in use","Program ${SYSTEM} failed: custom program error: 0x0"].`,
    `Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x6. \nLogs: \n["Program log: Error: account or token already in use"].`,
  ];
  for (const m of cases) assert.equal(explain(new Error(m)), m);
  assert.equal(explain(new Error("the refund failed: ix 0: NoRoom (6)")), "The pool is already full.", "a name still reads plainly");
});

/** Logs of ix `i` (Mooner's) failing with `hex`, raised by `by` (Mooner itself, or a
 *  program it calls: that one's failure is logged first). */
const failLogs = (pid, by, hex) => [
  `Program ${pid} invoke [1]`,
  ...(String(by) === String(pid) ? [] : [`Program ${by} invoke [2]`, `Program ${by} failed: custom program error: ${hex}`]),
  `Program ${pid} failed: custom program error: ${hex}`,
];

test("describeTxError: a code is Mooner's only when the logs say Mooner raised it", () => {
  const pid = Keypair.generate().publicKey;
  const progs = [ComputeBudgetProgram.programId, pid, DELEGATION_PROGRAM]; // a join as the web sends it
  const custom = (i, n) => ({ InstructionError: [i, { Custom: n }] });
  // join's create_account with too little SOL: System's 1, not PastDeadline
  const short = describeTxError(custom(1, 1), progs, pid, failLogs(pid, SYSTEM, "0x1"));
  assert.equal(short, `ix 1 (${SYSTEM}): insufficient lamports (custom 1)`);
  assert.equal(explain(new Error(`the tx fails: ${short}`)), SHORT_OF_SOL);
  // System's 0 (already in use) isn't BadState
  const inUse = describeTxError(custom(1, 0), progs, pid, failLogs(pid, SYSTEM, "0x0"));
  assert.equal(inUse, `ix 1 (${SYSTEM}): custom 0`);
  assert.equal(explain(new Error(inUse)), inUse);
  // Mooner's own
  assert.equal(describeTxError(custom(1, 1), progs, pid, failLogs(pid, pid, "0x1")), "ix 1: PastDeadline (1)");
  assert.equal(describeTxError(custom(1, 22), progs, pid, failLogs(pid, pid, "0x16")), "ix 1: WrongPresale (22)");
  // no logs: whose code it is isn't known, so it gets no name
  assert.equal(describeTxError(custom(1, 1), progs, pid), `ix 1 (${pid}): custom 1`);
  assert.equal(describeTxError(custom(1, 1), progs, pid, null), `ix 1 (${pid}): custom 1`);
  // logs of another code don't name this one
  assert.equal(describeTxError(custom(1, 6), progs, pid, failLogs(pid, pid, "0x1")), `ix 1 (${pid}): custom 6`);
  // the delegation program's codes aren't Mooner's (its names aren't checked: none given)
  const dl = describeTxError(custom(2, 1), progs, pid, [`Program ${DELEGATION_PROGRAM} invoke [1]`, `Program ${DELEGATION_PROGRAM} failed: custom program error: 0x1`]);
  assert.equal(dl, `ix 2 (${DELEGATION_PROGRAM}): custom 1`);
  assert.equal(explain(new Error(dl)), dl);
  // ...and System's short SOL inside a delegation is still short SOL
  const dls = describeTxError(custom(2, 1), progs, pid, [`Program ${DELEGATION_PROGRAM} invoke [1]`, `Program ${SYSTEM} invoke [2]`, "Transfer: insufficient lamports 5, need 9", `Program ${SYSTEM} failed: custom program error: 0x1`, `Program ${DELEGATION_PROGRAM} failed: custom program error: 0x1`]);
  assert.equal(dls, `ix 2 (${SYSTEM}): insufficient lamports (custom 1)`);
  // open: [compute budget, open_presale, delegate(presale), delegate(seat)], the same way
  const open = [ComputeBudgetProgram.programId, pid, DELEGATION_PROGRAM, DELEGATION_PROGRAM];
  assert.equal(describeTxError(custom(1, 1), open, pid, failLogs(pid, SYSTEM, "0x1")), `ix 1 (${SYSTEM}): insufficient lamports (custom 1)`);
  assert.equal(describeTxError(custom(1, 0), open, pid, failLogs(pid, SYSTEM, "0x0")), `ix 1 (${SYSTEM}): custom 0`);
  assert.equal(describeTxError(custom(3, 1), open, pid, [`Program ${DELEGATION_PROGRAM} invoke [1]`, `Program ${SYSTEM} invoke [2]`, `Program ${SYSTEM} failed: custom program error: 0x1`, `Program ${DELEGATION_PROGRAM} failed: custom program error: 0x1`]), `ix 3 (${SYSTEM}): insufficient lamports (custom 1)`);
  // a System ix of its own: nothing it calls, so its code is its own
  assert.equal(describeTxError(custom(0, 1), [new PublicKey(SYSTEM)], pid), `ix 0 (${SYSTEM}): insufficient lamports (custom 1)`);
  // the runtime's own errors in its own words (solana-transaction-error lib.rs)
  assert.equal(describeTxError("InsufficientFundsForFee"), "Insufficient funds for fee");
  assert.equal(describeTxError("AccountNotFound"), "Attempt to debit an account but found no record of a prior credit.");
  assert.equal(describeTxError({ InsufficientFundsForRent: { account_index: 2 } }), "Transaction results in an account (2) with insufficient funds for rent");
  for (const e of ["InsufficientFundsForFee", "AccountNotFound", { InsufficientFundsForRent: { account_index: 0 } }]) assert.equal(explain(new Error(`the tx fails: ${describeTxError(e)}`)), SHORT_OF_SOL);
  assert.equal(describeTxError("BlockhashNotFound"), '"BlockhashNotFound"');
});

const SHORT_OF_SOL = "Your wallet needs a little more SOL to cover rent and the Solana fee.";

test("explain: the runtime's words for a wallet short of SOL read as such; Token's insufficient funds doesn't", () => {
  for (const m of [
    "Transaction simulation failed: Insufficient funds for fee",
    "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.",
    "Transaction simulation failed: Transaction results in an account (0) with insufficient funds for rent",
    "Transfer: insufficient lamports 47558004, need 60000000",
  ]) assert.equal(explain(new Error(m)), SHORT_OF_SOL, m);
  // Token's own "insufficient funds" (a Jupiter trade's): tokens, not the wallet's SOL
  const token = new SendTransactionError({
    action: "simulate",
    signature: "",
    transactionMessage: "Transaction simulation failed: Error processing Instruction 3: custom program error: 0x1",
    logs: [`Program ${TOKEN} invoke [2]`, "Program log: Instruction: TransferChecked", "Program log: Error: insufficient funds", `Program ${TOKEN} failed: custom program error: 0x1`],
  });
  assert.match(token.message, /insufficient funds/);
  assert.equal(explain(token), token.message);
  assert.equal(explain(new Error("Error: insufficient funds")), "Error: insufficient funds");
});

/** A failed preflight as web3.js throws it: instruction 0 (Mooner's) failed with `hex`
 *  after `inner`, the logs of what it called. */
const refusedBy = (pid, hex, inner = []) =>
  new SendTransactionError({
    action: "simulate",
    signature: "",
    transactionMessage: `Transaction simulation failed: Error processing Instruction 0: custom program error: ${hex}`,
    logs: [`Program ${pid} invoke [1]`, ...inner, `Program ${pid} consumed 9000 of 200000 compute units`, `Program ${pid} failed: custom program error: ${hex}`],
  });

test("getBack: a settle the preflight refuses: Mooner's own code reads as its error, another program's doesn't", async () => {
  const refused = async (error) => {
    const r = refundable({ home: true });
    r.rpc.refusal = error(r.info.pid.toBase58());
    const e = await r.run().then(() => null, (e) => e);
    assert.ok(e, "it failed");
    assert.equal(r.rpc.sent.length, 0, "nothing went out");
    assert.equal(r.rpc.sendOpts.length, 1, "a refusal isn't sent again");
    assert.equal(r.rpc.sendOpts[0].skipPreflight, false);
    return e;
  };
  assert.equal(explain(await refused((pid) => refusedBy(pid, "0xb"))), FILLED); // AlreadySettled
  assert.match(explain(await refused((pid) => refusedBy(pid, "0x9"))), /on its way back to Solana/); // NotHome
  assert.match((await refused((pid) => refusedBy(pid, "0x16"))).message, / \(WrongPresale\)$/, "22, not 1");
  // an RPC's refusal (it has web3.js's transactionMessage) with the logs on the error only
  const msg = "Transaction simulation failed: Error processing Instruction 0: custom program error: 0xb";
  const bare = (pid) => Object.assign(new Error(msg), { transactionMessage: msg, logs: [`Program ${pid} failed: custom program error: 0xb`] });
  assert.equal(explain(await refused(bare)), FILLED);
  // ...and one with the logs only in its message
  const inMessage = (pid) => Object.assign(new Error(`Simulation failed. Logs: ["Program ${pid} invoke [1]","Program ${pid} failed: custom program error: 0xb"]`), { transactionMessage: msg });
  const m = await refused(inMessage);
  assert.equal(m.logs, undefined);
  assert.match(m.message, / \(AlreadySettled\)$/);
  assert.equal(explain(m), FILLED);
  // the innermost failure is what raised the code: Token or System, called by Mooner
  const token = await refused((pid) => refusedBy(pid, "0x4", [`Program ${TOKEN} invoke [2]`, "Program log: Error: owner does not match", `Program ${TOKEN} failed: custom program error: 0x4`]));
  assert.equal(explain(token), token.message);
  const system = await refused((pid) => refusedBy(pid, "0x0", [`Program ${SYSTEM} invoke [2]`, "Allocate: account already in use", `Program ${SYSTEM} failed: custom program error: 0x0`]));
  assert.equal(explain(system), system.message);
});

// ---- getBack: which read counts ----

test("getBack: Solana saying the seat is away beats a view that says home", async () => {
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  await g.run(g.withSeat("home"));
  assert.deepEqual(g.info.er.sent.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: one 'gone' while the view lists the seat is asked again after the server's 2 s cache", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // both say gone: nothing to do
  const a = refundable();
  a.rpc.drop(a.seat);
  let out = "pending";
  const p = a.run().then(() => (out = "resolved"), (e) => (out = e.message));
  await until(() => a.rpc.reads === 1);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(out, "pending", "it waits before the second read");
  t.mock.timers.tick(2_000);
  await p;
  assert.equal(out, "resolved");
  assert.equal(a.rpc.reads, 3, "the seat twice, then the presale: the view isn't final and the seat had SOL in the pool");
  assert.equal(nothingSent(a), 0);
  // an RPC that's behind says gone once; the second read has the seat
  const g = refundable();
  g.reads.push(g.withSeat("home"));
  const read = g.rpc.getAccountInfo;
  g.rpc.getAccountInfo = async () => ((g.rpc.getAccountInfo = read), g.rpc.reads++, null);
  const q = g.run();
  await until(() => g.rpc.reads === 1);
  for (let i = 0; i < 20; i++) await tick(); // the first read's answer reaches getBack
  t.mock.timers.tick(2_000);
  await q;
  assert.deepEqual(g.info.er.sent.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
  assert.deepEqual(settled(g), [[IX.SETTLE_SEAT]]);
});

test("getBack: an older Solana read that fails after a newer one answered doesn't make the timeout 'couldn't reach Solana'", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = refundable();
  g.info.er.drop(g.seat); // it left the ER already
  g.reads.push(g.without);
  const read = g.rpc.getAccountInfo;
  let fail;
  const late = new Promise((_, no) => (fail = no));
  let n = 0;
  g.rpc.getAccountInfo = (k) => (++n === 2 ? (g.rpc.reads++, late) : read(k)); // the wait's first read hangs
  const p = failure(g.run(g.without));
  await until(() => g.sock.count(g.topic) === 1 && n === 2);
  g.sock.push(g.topic, { type: "snapshot", data: g.without });
  await until(() => n === 3);
  for (let i = 0; i < 20; i++) await tick(); // the newer read answers: away
  fail(new Error("429 Too Many Requests"));
  for (let i = 0; i < 20; i++) await tick();
  t.mock.timers.tick(120_000);
  assert.match(await p, /your seat on Solana didn't show up yet/);
});

// ---- getBack: a seat that's gone, the deadline, and reads that fail ----

const CLAIMED = "Your seat was claimed at launch: the tokens are in your wallet.";
const AT_LAUNCH = "Your seat was settled at launch: its tokens or SOL are in your wallet.";
const UNREACHABLE = "couldn't reach Solana to check your seat; try again";
/** Solana's reads of `key` fail. */
const downOn = (r, key) => {
  const get = r.rpc.getAccountInfo;
  r.rpc.getAccountInfo = (k, c) => (k.equals(key) ? (r.rpc.reads++, Promise.reject(new Error("503 Service Unavailable"))) : get(k, c));
};

test("getBack: gone from a presale that launched: a seat with SOL in the pool was claimed, an empty one got its SOL back", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  /** getBack with Solana saying gone, past the 2 s second read. */
  const gone = async (r, view) => {
    r.rpc.drop(r.seat);
    const p = failure(r.run(view));
    await until(() => r.rpc.reads === 1);
    for (let i = 0; i < 20; i++) await tick();
    t.mock.timers.tick(2_000);
    return p;
  };
  // the view still lists it, with SOL in the pool
  const a = refundable();
  assert.equal(await gone(a, { ...a.view, state: "SETTLED" }), CLAIMED);
  assert.equal(nothingSent(a), 0);
  assert.equal(a.rpc.reads, 2);
  // an empty seat the keeper settled: that's a refund
  const b = refundable({ home: true });
  assert.equal(await gone(b, { ...b.view, state: "SETTLED" }), "resolved");
  // not launched: gone is a refund, whatever the seat had
  const c = refundable();
  assert.equal(await gone(c, { ...c.view, state: "EXPIRED" }), "resolved");
  // the view doesn't list it (or it's closed, which lists no seats): what it had isn't known
  const d = refundable();
  assert.equal(await gone(d, { ...d.without, state: "SETTLED" }), AT_LAUNCH);
  const e = refundable();
  assert.equal(await gone(e, { ...e.without, state: "CLOSED", launch: { sig: "launch-sig" } }), AT_LAUNCH);
  // closed without a launch: it expired or failed, and every seat was refunded
  const f = refundable();
  assert.equal(await gone(f, { ...f.without, state: "CLOSED", launch: null }), "resolved");
  assert.equal(nothingSent(d) + nothingSent(e) + nothingSent(f), 0);
});

test("getBack: gone with SOL in the pool while the view isn't final: Solana's presale says whether it launched", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const SETTLED_ANY = "Your seat was settled: its SOL or tokens are in your wallet.";
  /** getBack from a stale `state` view that lists the seat with SOL in the pool; Solana
   *  says gone twice. */
  const gone = async (r, state = "FULL") => {
    r.rpc.drop(r.seat);
    const p = failure(r.run({ ...r.view, state }));
    await until(() => r.rpc.reads === 1);
    for (let i = 0; i < 20; i++) await tick();
    t.mock.timers.tick(2_000);
    return p;
  };
  // it launched: the keeper claimed the seat, and paid tokens
  const a = refundable();
  a.presaleIs(STATE.SETTLED, { home: true });
  assert.equal(await gone(a), CLAIMED);
  assert.equal(a.rpc.reads, 3, "the seat twice, then the presale");
  // in the ER still (only a presale that's home launches), or home and not launched: the
  // seat had nothing in the pool by then, and got it all back
  for (const [state, home] of [[STATE.OPEN, false], [STATE.FULL, true], [STATE.EXPIRED, true], [STATE.FAILED, true]]) {
    const r = refundable();
    r.presaleIs(state, { home });
    assert.equal(await gone(r), "resolved", `presale ${state}, home ${home}`);
  }
  // closed: the server's fresh view says if it launched first
  const c = refundable();
  c.rpc.drop(c.presale);
  c.reads.push({ ...c.without, state: "CLOSED", launch: { sig: "launch-sig" } });
  assert.equal(await gone(c, "LAUNCHING"), CLAIMED);
  const d = refundable();
  d.rpc.drop(d.presale);
  d.reads.push({ ...d.without, state: "CLOSED", launch: null });
  assert.equal(await gone(d), "resolved");
  // closed, and someone sent SOL to its address since: System's now, still closed
  const s = refundable();
  s.rpc.put(s.presale, new PublicKey(SYSTEM), Buffer.alloc(0));
  s.reads.push({ ...s.without, state: "CLOSED", launch: { sig: "launch-sig" } });
  assert.equal(await gone(s), CLAIMED);
  // not known: it says what's sure, and not that the SOL is back
  const e = refundable();
  downOn(e, e.presale);
  assert.equal(await gone(e), SETTLED_ANY);
  const f = refundable();
  f.rpc.drop(f.presale); // closed, and the server's view doesn't answer
  assert.equal(await gone(f, "OPEN"), SETTLED_ANY);
  // closed, and the server still has it FULL: not known either, whatever `launch` says
  const m = refundable();
  m.rpc.drop(m.presale);
  m.reads.push({ ...m.without, state: "FULL" });
  assert.equal(await gone(m), SETTLED_ANY);
  // closed, and the server never answers: it stops waiting after 10 s
  const n = refundable();
  n.rpc.drop(n.presale);
  n.reads.push(new Promise(() => {}));
  let out;
  gone(n).then((o) => (out = o));
  await until(() => n.rpc.reads === 3);
  for (let i = 0; i < 20; i++) await tick();
  t.mock.timers.tick(9_999);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(out, undefined, "still waiting at 9.999 s");
  t.mock.timers.tick(1);
  await until(() => out !== undefined);
  assert.equal(out, SETTLED_ANY);
  assert.equal([a, c, d, e, f, m, n].reduce((k, r) => k + nothingSent(r), 0), 0);
  // a final view decides by itself
  for (const state of ["EXPIRED", "FAILED"]) {
    const g = refundable();
    downOn(g, g.presale);
    assert.equal(await gone(g, state), "resolved", state);
    assert.equal(g.rpc.reads, 2, "no presale read");
  }
});

test("getBack: gone on its way home from a presale that launched: claimed if it had SOL in the pool, not once the leave took it out", async () => {
  /** The seat left the ER already; Solana says away, then gone; the view then is `after`. */
  const onItsWay = (r, after) => {
    r.info.er.drop(r.seat);
    r.reads.push(after);
    const read = r.info.er.getAccountInfo;
    r.info.er.getAccountInfo = async (k) => (k.equals(r.seat) && r.rpc.drop(r.seat), read(k));
    return failure(r.run());
  };
  const a = refundable();
  assert.equal(await onItsWay(a, { ...a.without, state: "CLOSED", launch: { sig: "launch-sig" } }), CLAIMED);
  const b = refundable();
  assert.equal(await onItsWay(b, { ...b.without, state: "CLOSED", launch: null }), "resolved", "expired, closed: refunded");
  const c = refundable();
  c.view.seats[0].commit = "0";
  assert.equal(await onItsWay(c, { ...c.without, state: "SETTLED" }), "resolved", "nothing in the pool");
  assert.equal(nothingSent(a) + nothingSent(b) + nothingSent(c), 0);
  // the leave took the SOL out; then the keeper settled the empty seat
  const g = refundable();
  g.reads.push({ ...g.without, state: "SETTLED" });
  const send = g.info.er.sendRawTransaction;
  g.info.er.sendRawTransaction = async (raw) => (g.rpc.drop(g.seat), send(raw));
  assert.equal(await failure(g.run()), "resolved");
  assert.deepEqual(g.info.er.sent.map((tx) => tags(tx, g.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
});

test("getBack: gone, and then Solana doesn't answer the second read: it says so, and nothing is sent", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const r = refundable({ home: true });
  let n = 0;
  const get = r.rpc.getAccountInfo;
  r.rpc.getAccountInfo = (k, c) => (k.equals(r.seat) && ++n > 1 ? (r.rpc.reads++, Promise.reject(new Error("503 Service Unavailable"))) : k.equals(r.seat) ? (r.rpc.reads++, Promise.resolve(null)) : get(k, c));
  const p = failure(r.run());
  await until(() => n === 1);
  for (let i = 0; i < 20; i++) await tick();
  t.mock.timers.tick(2_000);
  assert.equal(await p, UNREACHABLE);
  assert.equal(nothingSent(r), 0);
});

test("getBack: SOL in an OPEN pool past its deadline: it comes back by itself, with no popup and nothing sent", async (t) => {
  // no session key on this device: the leave would ask the wallet, and the ER would refuse it
  const r = refundable();
  r.reads.push(r.withSeat("home"));
  r.keys.map.clear();
  r.presaleIs(STATE.OPEN, { deadline: Math.floor(Date.now() / 1000) - 60 });
  assert.equal(await failure(r.run()), BY_ITSELF);
  assert.equal(nothingSent(r), 0);
  assert.deepEqual(r.steps, ["Checking your seat"]);
  // set_commit refuses from the deadline's second on (t >= deadline_ts, ledger.rs)
  t.mock.timers.enable({ apis: ["Date"], now: 1_900_000_000_000 });
  const d = refundable();
  d.reads.push(d.withSeat("home"));
  d.presaleIs(STATE.OPEN, { deadline: 1_900_000_000 });
  assert.equal(await failure(d.run()), BY_ITSELF);
  assert.equal(nothingSent(d), 0);
  const e = refundable();
  e.reads.push(e.withSeat("home"));
  e.presaleIs(STATE.OPEN, { deadline: 1_900_000_001 });
  await e.run();
  assert.deepEqual(e.info.er.sent.map((tx) => tags(tx, e.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]], "a second before it");
  // nothing in the pool: leave doesn't care about the deadline
  const z = refundable();
  z.reads.push(z.withSeat("home"));
  z.info.er.put(z.seat, z.info.pid, seatBytes({ user: z.w.publicKey, presale: z.presale, sessionKey: z.key.publicKey, deposit: 500_000_000n }));
  z.presaleIs(STATE.OPEN, { deadline: 1_899_999_000 });
  await z.run();
  assert.deepEqual(z.info.er.sent.map((tx) => tags(tx, z.info.pid)), [[IX.LEAVE]]);
});

test("getBack: Solana can't read the presale while the seat is in the ER: the ER's copy, the one set_commit checks, decides", async () => {
  const r = refundable();
  r.reads.push(r.withSeat("home"));
  downOn(r, r.presale);
  await r.run();
  assert.deepEqual(r.info.er.sent.map((tx) => tags(tx, r.info.pid)), [[IX.SET_COMMIT, IX.LEAVE]]);
  assert.deepEqual(settled(r), [[IX.SETTLE_SEAT]]);
  const f = refundable();
  f.presaleIs(STATE.FULL);
  downOn(f, f.presale);
  assert.equal(await failure(f.run()), FILLED);
  assert.equal(nothingSent(f), 0);
  // an ER copy that isn't Mooner's doesn't count
  const x = refundable();
  x.reads.push(x.withSeat("home"));
  x.info.er.put(x.presale, DELEGATION_PROGRAM, presaleBytes(STATE.OPEN));
  downOn(x, x.presale);
  assert.match(await failure(x.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(x), 0);
  // a home seat is settled on Solana: an ER copy (stale by then) doesn't count
  const h = committedHome(STATE.EXPIRED);
  h.info.er.put(h.presale, h.info.pid, presaleBytes(STATE.OPEN));
  downOn(h, h.presale);
  assert.match(await failure(h.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(h), 0);
});

test("getBack: the ER's copy of the presale counts only if it's Mooner's and Solana still has the presale", async () => {
  // Solana has it delegated; the ER's copy isn't owned by Mooner
  const a = refundable();
  a.reads.push(a.withSeat("home"));
  a.info.er.put(a.presale, DELEGATION_PROGRAM, presaleBytes(STATE.OPEN));
  assert.match(await failure(a.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(a), 0);
  // Solana has no presale: it closed, whatever the ER still holds
  const b = refundable();
  b.reads.push(b.withSeat("home"));
  b.rpc.drop(b.presale);
  assert.match(await failure(b.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(b), 0);
  // the ER's read fails
  const c = refundable();
  c.reads.push(c.withSeat("home"));
  const read = c.info.er.getAccountInfo;
  c.info.er.getAccountInfo = async (k) => (k.equals(c.presale) ? Promise.reject(new Error("503 Service Unavailable")) : read(k));
  assert.match(await failure(c.run()), /Couldn't read the presale/);
  assert.equal(nothingSent(c), 0);
});

test("getBack: Solana can't read the seat, the view has it home with SOL in a pool that filled: it says so, nothing sent", async () => {
  const r = committedHome(STATE.FULL);
  downOn(r, r.seat);
  assert.equal(await failure(r.run()), FILLED);
  assert.equal(nothingSent(r), 0);
});

// ---- the key store and the rotation lock ----

/** `k`, with writes that finish when `write()` says so. */
function slowKeys(k = memoryKeys()) {
  const set = k.set;
  let open;
  const gate = new Promise((r) => (open = r));
  k.writes = 0;
  k.write = () => open();
  k.set = async (name, v) => (k.writes++, await gate, set(name, v));
  return k;
}

test("a new key is written to the store before any tx that carries it is signed", async () => {
  // rotate_key
  const s = seated({ key: Keypair.generate(), mine: Keypair.generate() });
  const keys = slowKeys(s.keys);
  const go = flows({ keys }).setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount: 300_000_000n });
  await until(() => keys.writes === 1);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(s.w.asked.length, 0, "rotate_key waits for the write");
  keys.write();
  await go;
  assert.equal(s.w.asked.length, 1);
  // join
  const info = fakeInfo();
  const w = fakeWallet();
  const { view } = joinable(info);
  const j = slowKeys();
  const join = flows({ api: fakeApi(info), keys: j }).joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n });
  await until(() => j.writes === 1);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(w.asked.length, 0, "the join waits for the write");
  j.write();
  await join;
  assert.equal(w.asked.length, 1);
});

test("setCommit: inside the rotation lock the key read under the lock counts, not the caller's stale one", async () => {
  const f0 = Keypair.generate();
  const s = seated({ key: f0, mine: f0 });
  await flows({ keys: s.keys }).setCommit({ info: s.info, wallet: s.w.publicKey, signTransaction: s.w.signTransaction, view: s.view, amount: 300_000_000n, key: Keypair.generate() });
  assert.equal(s.w.asked.length, 0, "no rotate_key");
  assert.deepEqual(s.info.er.sent.map((tx) => tags(tx, s.info.pid)), [[IX.SET_COMMIT]]);
  assert.ok(s.info.er.sent[0].feePayer.equals(f0.publicKey));
});
