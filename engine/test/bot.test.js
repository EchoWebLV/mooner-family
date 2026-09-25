// The keeper's safety checks against a fake RPC: counting seats before a close, the
// crank's per-ix fallback, when a send gives up, and what a full presale does first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { Bot } from "../src/bot.js";
import { DELEGATION_PROGRAM } from "../src/consts.js";
import { P, PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, STATE, decodePresale } from "../src/layout.js";
import { presalePda, seatPda } from "../src/pdas.js";
import { sendSigned } from "../src/tx.js";

const pid = Keypair.generate().publicKey;
const presale = presalePda(pid, Keypair.generate().publicKey);
const BH = "11111111111111111111111111111111";

function seatData(user, of = presale) {
  const d = Buffer.alloc(SEAT_LEN);
  d[0] = SEAT_VERSION;
  user.toBuffer().copy(d, S.USER);
  of.toBuffer().copy(d, S.PRESALE);
  return d;
}

/** A fake Solana: `accounts` is the chain now; `lists` can replace a program's listing
 *  (a lagging RPC); `afterList` runs after each listing (something lands meanwhile). */
function fakeChain() {
  const accounts = new Map();
  const chain = {
    accounts,
    lists: {},
    afterList: () => {},
    sent: [],
    put: (key, owner, data) => accounts.set(key.toBase58(), { owner, data, lamports: 1 }),
    conn: {
      rpcEndpoint: "http://fake",
      async getProgramAccounts(owner, { filters = [], dataSlice } = {}) {
        const bytesOf = (m) => (m.encoding === "base64" ? Buffer.from(m.bytes, "base64") : new PublicKey(m.bytes).toBuffer());
        const all = chain.lists[owner.toBase58()] ?? [...accounts].map(([k, a]) => ({ pubkey: new PublicKey(k), account: a }));
        const out = all
          .filter(({ account: a }) => a.owner.equals(owner))
          .filter(({ account: a }) =>
            filters.every((f) => (f.dataSize != null ? a.data.length === f.dataSize : a.data.subarray(f.memcmp.offset).subarray(0, bytesOf(f.memcmp).length).equals(bytesOf(f.memcmp)))),
          )
          .map(({ pubkey, account: a }) => ({ pubkey, account: { ...a, data: dataSlice ? a.data.subarray(dataSlice.offset, dataSlice.offset + dataSlice.length) : a.data } }));
        chain.afterList(owner);
        return out;
      },
      async getMultipleAccountsInfo(keys) {
        return keys.map((k) => accounts.get(k.toBase58()) ?? null);
      },
    },
  };
  return chain;
}

const newBot = (l1) => new Bot({ pid, l1, bot: Keypair.generate(), log: () => {} });

test("a seat that goes home while the seats are listed still blocks the close", async () => {
  const c = fakeChain();
  const user = Keypair.generate().publicKey;
  const seat = seatPda(pid, presale, user);
  c.put(seat, DELEGATION_PROGRAM, seatData(user));
  // the commit lands right after the delegated listing, and the home listing lags
  c.afterList = (owner) => {
    if (owner.equals(DELEGATION_PROGRAM)) {
      c.put(seat, pid, seatData(user));
      c.lists[pid.toBase58()] = [];
    }
  };
  assert.equal(await newBot(c.conn).seatsLeft(presale), 1);
});

test("seats left: home, delegated, closed, and look-alikes", async () => {
  const c = fakeChain();
  const [a, b, d] = [0, 1, 2].map(() => Keypair.generate().publicKey);
  c.put(seatPda(pid, presale, a), pid, seatData(a));
  c.put(seatPda(pid, presale, b), DELEGATION_PROGRAM, seatData(b));
  // delegated at a key that isn't the seat PDA: anyone can make one, it must not block
  c.put(Keypair.generate().publicKey, DELEGATION_PROGRAM, seatData(d));
  // a seat of another presale
  c.put(seatPda(pid, presalePda(pid, d), d), pid, seatData(d, presalePda(pid, d)));
  const bot = newBot(c.conn);
  assert.equal(await bot.seatsLeft(presale), 2);

  // a stale listing still names a seat that has closed since
  c.lists[pid.toBase58()] = [{ pubkey: seatPda(pid, presale, a), account: { owner: pid, data: seatData(a) } }];
  c.accounts.delete(seatPda(pid, presale, a).toBase58());
  c.accounts.delete(seatPda(pid, presale, b).toBase58());
  assert.equal(await bot.seatsLeft(presale), 0);
});

test("the close waits while a seat is left and says so", async () => {
  const c = fakeChain();
  const user = Keypair.generate().publicKey;
  c.put(seatPda(pid, presale, user), DELEGATION_PROGRAM, seatData(user));
  c.conn.simulateTransaction = async () => assert.fail("must not try to close");
  const p = { creator: Keypair.generate().publicKey, mint: Keypair.generate().publicKey };
  const out = await newBot(c.conn).closeWhenEmpty(presale, p, "EXPIRED", []);
  assert.deepEqual(out.did, []);
  assert.match(out.wait, /1 seat/);
});

test("crank drops the ixs that fail alone and reports what it sent", async () => {
  const c = fakeChain();
  const BAD = 99;
  const dataOf = (tx) => tx.message.compiledInstructions.map((i) => Buffer.from(i.data)[0]);
  c.conn.simulateTransaction = async (tx) => ({
    value: { err: dataOf(tx).includes(BAD) ? { InstructionError: [0, { Custom: 1 }] } : null, logs: [], unitsConsumed: 1 },
  });
  c.conn.getLatestBlockhash = async () => ({ blockhash: BH, lastValidBlockHeight: 1e9 });
  c.conn.sendRawTransaction = async (raw) => {
    c.sent.push(dataOf(VersionedTransaction.deserialize(raw)));
    return "sig";
  };
  c.conn.getSignatureStatuses = async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] });
  const ix = (n) => new TransactionInstruction({ programId: pid, keys: [], data: Buffer.from([n]) });
  const bot = newBot(c.conn);

  assert.equal(await bot.crank([ix(1), ix(BAD), ix(2)], "claim x3", presale), "claim x2");
  assert.deepEqual(c.sent, [[1, 2]]);
  assert.equal(await bot.crank([ix(BAD), ix(BAD)], "claim x2", presale), null);
  assert.equal(await bot.crank([ix(3)], "close_presale", presale), "close_presale");
  assert.deepEqual(c.sent, [[1, 2], [3]]);
});

test("sendSigned: after the blockhash runs out, one history look decides", async () => {
  const tx = { serialize: () => Buffer.alloc(1) };
  const conn = (history, height = 2000) => ({
    rpcEndpoint: "http://fake",
    sendRawTransaction: async () => "sig",
    getBlockHeight: async () => height,
    getSignatureStatuses: async (_, o) => ({ value: [o?.searchTransactionHistory ? history : null] }),
  });
  const opts = { lastValidBlockHeight: 1000, resendMs: 0 };
  // it landed in the last block: that's success, not a hang
  assert.equal(await sendSigned(conn({ confirmationStatus: "finalized", err: null }), tx, opts), "sig");
  await assert.rejects(sendSigned(conn(null), tx, opts), /expired/);
  // an RPC whose block height never moves ends too
  await assert.rejects(sendSigned(conn(null, 0), tx, { ...opts, stuckMs: 50 }), /outcome unknown/);
});

// ---- a full presale: the launch comes before any listing ----

const validator = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");

function presaleBytes({ state = STATE.FULL, fullTs, committed, settled }) {
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  d[P.STATE] = state;
  validator.toBuffer().copy(d, P.VALIDATOR);
  d.writeBigInt64LE(BigInt(fullTs), P.FULL_TS);
  d.writeBigUInt64LE(committed, P.SEATS_COMMITTED);
  d.writeBigUInt64LE(settled, P.SEATS_SETTLED);
  return d;
}

/** A bot whose listings, sends and launch only record that they ran. `chain.bytes` is the
 *  presale account now; `homeUnsettled` how many home seats the listing shows unsettled;
 *  `settleLands` whether the settle shows up in the next read. */
function fullBot({ committed = 4n, settled = 0n, homeUnsettled = 4, settleLands = true, age = 10, state } = {}) {
  const T = 1_800_000_000;
  const chain = { bytes: presaleBytes({ state, fullTs: T - age, committed, settled }) };
  const l1 = { rpcEndpoint: "http://fake", getAccountInfo: async () => ({ owner: pid, data: chain.bytes, lamports: 1 }) };
  const bot = new Bot({ pid, l1, ers: { [validator.toBase58()]: { rpcEndpoint: "https://devnet-as.magicblock.app" } }, bot: Keypair.generate(), canary: true, log: () => {} });
  const calls = [];
  bot.now = () => T;
  bot.homeSeats = async () => (calls.push("list home seats"), Array.from({ length: homeUnsettled }, () => ({ settled: false })));
  bot.commitSeatsHome = async () => (calls.push("list ER seats"), []);
  bot.settleSeats = async (_, open) => {
    calls.push(`settle x${open.length}`);
    if (settleLands) chain.bytes = presaleBytes({ state, fullTs: T - age, committed, settled: settled + BigInt(open.length) });
    return [`settle_seat x${open.length}`];
  };
  bot.crank = async (_, what) => (calls.push(what), what);
  bot.launch = async (_, p) => (calls.push(`launch (${p.seatsSettled}/${p.seatsCommitted} settled)`), {});
  return { bot, calls, p: () => decodePresale(chain.bytes) };
}

test("full, every seat settled: the launch goes out with no listing in front of it", async () => {
  const f = fullBot({ settled: 4n });
  const r = await f.bot.atHome(presale, f.p());
  assert.deepEqual(f.calls, ["launch (4/4 settled)"]);
  assert.deepEqual(r.did, ["launch"]);
});

test("full, seats to settle: settle, read again, launch in the same tick", async () => {
  const f = fullBot();
  const r = await f.bot.atHome(presale, f.p());
  assert.deepEqual(f.calls, ["list home seats", "settle x4", "launch (4/4 settled)"], "the launch sees the presale after the settle");
  assert.deepEqual(r.did, ["settle_seat x4", "launch"]);
});

test("full, the settle not visible yet: wait for it, no ER listing", async () => {
  const f = fullBot({ settleLands: false });
  const r = await f.bot.atHome(presale, f.p());
  assert.deepEqual(f.calls, ["list home seats", "settle x4"]);
  assert.equal(r.wait, "settles landing");
});

test("full, committed seats not home: look for them in the ER", async () => {
  const f = fullBot({ settled: 2n, homeUnsettled: 0 });
  const r = await f.bot.atHome(presale, f.p());
  assert.deepEqual(f.calls, ["list home seats", "list ER seats"]);
  assert.match(r.wait, /2 committed seat\(s\) not home/);
});

test("full past the grace: fail, nothing listed first", async () => {
  const f = fullBot({ settled: 4n, age: 61 });
  assert.equal(f.bot.n.GRACE, 60);
  const r = await f.bot.atHome(presale, f.p());
  assert.deepEqual([f.calls, r.did], [["fail"], ["fail"]]);
});

test("other states still bring late seats home first", async () => {
  const f = fullBot({ state: STATE.LAUNCHING, settled: 4n });
  await f.bot.atHome(presale, f.p());
  assert.deepEqual(f.calls, ["list ER seats"]);
});
