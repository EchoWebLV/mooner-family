// runUpgrade (mainnet.js --upgrade) against a fake chain: no network, no keys. The fake
// applies the loader's Upgrade the way solana-bpf-loader-program 4.0.0 does (copy, zero the
// tail, spill the buffer). The program bytes are made up, at the sizes of the real builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BPF_UPGRADEABLE, DELEGATION_PROGRAM } from "../src/consts.js";
import { PRESALE_LEN, STATE } from "../src/layout.js";
import { programDataPda } from "../src/pdas.js";
import { BUFFER_HEADER, LOADER_V4, rustNumbers, runUpgrade } from "../src/upgrade.js";

const CONSTS_RS = fs.readFileSync(new URL("../../programs/presale/src/consts.rs", import.meta.url), "utf8");
const PID = new PublicKey("6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa");
const AUTH = new PublicKey("HKVgAYCTKDdtLyN4hGmBC49Psfb9yxsFWQk3jnBEXnhL");
const made = (len, mul, add) => Buffer.from(Array.from({ length: len }, (_, i) => (i * mul + add) & 0xff));
const SO05 = made(295_320, 17, 1); // the 0.5 SOL build's size
const SO10 = made(295_376, 31, 7); // the 10 SOL build's size, what mainnet holds
const RUST05 = rustNumbers(CONSTS_RS);
// mainnet's programdata: its real 45-byte header (slot 450423499, authority HKVg…), then the build
const PD_MAINNET = Buffer.concat([Buffer.from("03000000cbead81a0000000001f277de5c13ba618edc69dd741de82f5b9b676c7060a16d2ecc8740592d7a2177", "hex"), SO10]);
const rentOf = (n) => (128 + n) * 5080; // mainnet, checked by RPC
// the eu ER's LoaderV4 header for the program, read 2026-09-30 (slot, authority HKVg…, status 1)
const V4_EU = Buffer.from("44b8283500000000f277de5c13ba618edc69dd741de82f5b9b676c7060a16d2ecc8740592d7a21770100000000000000", "hex");
/** An ER's copy of the program, as MagicBlock's cloner makes it: a LoaderV4 account holding
 *  everything after the programdata's 45-byte header (magicblock-validator v0.16.0,
 *  remote_account_provider/program_account.rs get_state_v3). */
function v4Copy(programdata, status = 1n) {
  const h = Buffer.from(V4_EU);
  h.writeBigUInt64LE(status, 40);
  return { owner: LOADER_V4, data: Buffer.concat([h, programdata.subarray(45)]), executable: true };
}

function fakeChain({ balance = 2_000_000_000n } = {}) {
  const acc = new Map();
  const put = (k, a) => acc.set(k.toBase58(), a);
  put(programDataPda(PID), { owner: BPF_UPGRADEABLE, data: Buffer.from(PD_MAINNET), lamports: rentOf(PD_MAINNET.length) });
  put(AUTH, { owner: PublicKey.default, data: Buffer.alloc(0), lamports: Number(balance) });
  const conn = {
    getAccountInfo: async (k) => { const a = acc.get(k.toBase58()); return a ? { ...a, data: Buffer.from(a.data) } : null; },
    getBalance: async (k) => acc.get(k.toBase58())?.lamports ?? 0,
    getMinimumBalanceForRentExemption: async (n) => rentOf(n),
    getProgramAccounts: async (owner, { filters = [] } = {}) => [...acc.entries()]
      .filter(([, a]) => a.owner.equals(owner))
      .filter(([, a]) => filters.every((f) => (f.dataSize != null ? a.data.length === f.dataSize
        : a.data.subarray(f.memcmp.offset, f.memcmp.offset + 32).equals(new PublicKey(f.memcmp.bytes).toBuffer()))))
      .map(([k, a]) => ({ pubkey: new PublicKey(k), account: { ...a, data: Buffer.from(a.data) } })),
  };
  return { acc, put, conn };
}

function presale(state) {
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = 2;
  d[1] = state;
  return { owner: PID, data: d, lamports: rentOf(PRESALE_LEN) };
}

const BUFFER_FILE = "/x/upgrade-buffer-6fc630d5-keypair.json";

function harness({ chain = fakeChain(), confirm = true, engineNumbers = RUST05, onWrite, erStale = [], erStatus = {}, erDown = [], bufferKeyMade = false, others = {} } = {}) {
  const calls = { exec: [], send: 0, simulate: 0, saved: 0, loadKey: 0, sleeps: 0, sleptMs: new Set(), bufferKeyMade: 0 };
  const lines = [];
  const bufferKp = Keypair.generate(); // a throwaway key for the fake chain only
  const state = { commit: "3554261467d8b57ab94d300be18c468c40b1d8fe", soSha256: "fc5c22ea60dd8e5b9b730ac192ae2a7ac0b38dabce243ce5ccc8a86a0bc52a27", soBytes: 295376 };
  // each ER: its own programdata copy, always L1's (so it proves nothing), and the program
  // it runs, a LoaderV4 copy that is the old build in the erStale regions
  const ers = ["as", "eu", "us"].map((region) => ({
    region, url: `https://${region}.example`,
    conn: {
      getAccountInfo: async (k) => {
        if (!k.equals(PID)) return chain.conn.getAccountInfo(k);
        if (erDown.includes(region)) throw new Error("fetch failed");
        const pd = erStale.includes(region) ? PD_MAINNET : chain.acc.get(programDataPda(PID).toBase58()).data;
        return v4Copy(pd, erStatus[region] ?? 1n);
      },
    },
  }));
  const ctx = {
    l1: chain.conn, ers, pid: PID, so: SO05, soSha: "6fc630d54584826be053241b215e564bd49dcbd4d73bdeb11ef0e299a987871f", soPath: "/x/mooner_presale.so",
    commit: "0000000000000000000000000000000000000abc", rustSrc: CONSTS_RS,
    engineNumbers, authority: AUTH, authFile: "/x/auth.json", rpc: "https://rpc.example", rpcShown: "https://rpc.example", cuPrice: 20_000, confirm, state,
    save: () => calls.saved++,
    // like mainnet.js: the key file for this build's buffer, made only when asked to
    bufferFile: ({ create = false } = {}) => {
      if (create && !bufferKeyMade) {
        bufferKeyMade = true;
        calls.bufferKeyMade++;
      }
      return bufferKeyMade ? BUFFER_FILE : null;
    },
    otherBufferFiles: () => Object.keys(others),
    pubkeyOf: (f) => (f === BUFFER_FILE ? bufferKp.publicKey : others[f]),
    loadKey: () => { calls.loadKey++; return { publicKey: AUTH }; },
    exec: (cmd, argv) => {
      calls.exec.push([cmd, ...argv]);
      if (argv[1] === "write-buffer") {
        const d = Buffer.alloc(BUFFER_HEADER + SO05.length);
        d.writeUInt32LE(1, 0); d[4] = 1; AUTH.toBuffer().copy(d, 5); SO05.copy(d, BUFFER_HEADER);
        const rent = rentOf(d.length);
        chain.put(bufferKp.publicKey, { owner: BPF_UPGRADEABLE, data: d, lamports: rent });
        chain.acc.get(AUTH.toBase58()).lamports -= rent;
        onWrite?.(chain, bufferKp.publicKey);
      }
    },
    simulate: async () => { calls.simulate++; return { err: null, logs: [], units: 2_370 }; },
    send: async (conn, { ixs }) => {
      calls.send++;
      const up = ixs.find((i) => i.programId.equals(BPF_UPGRADEABLE));
      assert.equal(up.data.toString("hex"), "03000000");
      const [pdK, , bufK, spillK, , , authK] = up.keys.map((k) => k.pubkey.toBase58());
      const pd = chain.acc.get(pdK), b = chain.acc.get(bufK);
      assert.ok(new PublicKey(b.data.subarray(5, 37)).toBase58() === authK && new PublicKey(pd.data.subarray(13, 45)).toBase58() === authK);
      const body = b.data.subarray(BUFFER_HEADER);
      pd.data.writeBigUInt64LE(999n, 4);
      body.copy(pd.data, 45);
      pd.data.fill(0, 45 + body.length);
      chain.acc.get(spillK).lamports += b.lamports;
      chain.acc.delete(bufK);
      return "UpgradeSig";
    },
    log: (...a) => lines.push(a.join(" ")),
    sleep: async (ms) => { calls.sleeps++; calls.sleptMs.add(ms); },
  };
  return { ctx, calls, lines, state, chain, bufferKp };
}

test("confirm: writes the buffer, upgrades, checks Solana and every ER, records the old build", async () => {
  const h = harness();
  const before = h.chain.acc.get(AUTH.toBase58()).lamports;
  assert.equal(await runUpgrade(h.ctx), 0);
  const pd = h.chain.acc.get(programDataPda(PID).toBase58()).data;
  assert.ok(pd.subarray(45, 45 + SO05.length).equals(SO05));
  assert.ok(pd.subarray(45 + SO05.length).every((b) => b === 0));
  assert.equal(h.chain.acc.get(AUTH.toBase58()).lamports, before); // the buffer rent came back (the fake charges no fees)
  assert.equal(h.calls.exec.length, 1);
  const w = h.calls.exec[0];
  assert.deepEqual(w.slice(0, 3), ["solana", "program", "write-buffer"]);
  assert.equal(w[w.indexOf("--max-len") + 1], String(SO05.length));
  assert.equal(w[w.indexOf("--buffer") + 1], "/x/upgrade-buffer-6fc630d5-keypair.json");
  assert.equal(w[w.indexOf("--with-compute-unit-price") + 1], "20000");
  assert.equal(w.at(-1), "/x/mooner_presale.so");
  assert.equal(h.calls.simulate, 1);
  assert.equal(h.calls.send, 1);
  assert.equal(h.state.soSha256.slice(0, 8), "6fc630d5");
  assert.equal(h.state.soBytes, SO05.length);
  assert.equal(h.state.history.length, 1);
  assert.equal(h.state.history[0].soSha256.slice(0, 8), "fc5c22ea");
  assert.equal(h.state.history[0].upgradeTx, "UpgradeSig");
  assert.ok(h.lines.some((l) => /not needed: 295320 bytes fit the 295376/.test(l)));
  assert.equal(h.lines.filter((l) => /ER .* runs this build/.test(l)).length, 3);
});

test("dry run: reports, needs no key, sends nothing; exit 1 while not ready", async () => {
  const poor = harness({ chain: fakeChain({ balance: 745_598_611n }), confirm: false, engineNumbers: { ...RUST05, TARGET: 10_000_000_000n, MAX_SEAT: 1_000_000_000n } });
  assert.equal(await runUpgrade(poor.ctx), 1);
  assert.deepEqual([poor.calls.exec.length, poor.calls.send, poor.calls.simulate, poor.calls.loadKey, poor.calls.saved, poor.calls.bufferKeyMade], [0, 0, 0, 0, 0, 0]);
  const text = poor.lines.join("\n");
  assert.match(text, /DIFFER in TARGET, MAX_SEAT/);
  assert.match(text, /needed at once   1\.504084 SOL; the authority has 0\.745599 SOL/);
  assert.match(text, /the authority needs 0\.758485 more SOL/);
  assert.match(text, /1\.501064 SOL rent, held until step 3 returns it; at most 329 write txs, at most 0\.003011 SOL in fees/);
  const ready = harness({ confirm: false });
  assert.equal(await runUpgrade(ready.ctx), 0);
  assert.doesNotMatch(ready.lines.join("\n"), /not ready/);
});

test("confirm refuses before sending anything when not ready", async () => {
  const h = harness({ engineNumbers: { ...RUST05, TARGET: 10_000_000_000n } });
  await assert.rejects(runUpgrade(h.ctx), /not ready; nothing was sent/);
  assert.deepEqual([h.calls.exec.length, h.calls.send, h.calls.loadKey], [0, 0, 0]);
  const chain = fakeChain();
  chain.put(Keypair.generate().publicKey, presale(STATE.OPEN));
  const busy = harness({ chain });
  await assert.rejects(runUpgrade(busy.ctx), /not ready/);
  assert.match(busy.lines.join("\n"), /1 IN FLIGHT[\s\S]*OPEN raised 0/);
  // one of our accounts delegated to an ER: its record names our program at byte 40
  const er = fakeChain();
  const rec = Buffer.alloc(96);
  PID.toBuffer().copy(rec, 40);
  er.put(Keypair.generate().publicKey, { owner: DELEGATION_PROGRAM, data: rec, lamports: 1 });
  await assert.rejects(runUpgrade(harness({ chain: er }).ctx), /not ready/);
});

test("finished presales do not block", async () => {
  const chain = fakeChain();
  for (const s of [STATE.SETTLED, STATE.EXPIRED, STATE.FAILED]) chain.put(Keypair.generate().publicKey, presale(s));
  const h = harness({ chain });
  assert.equal(await runUpgrade(h.ctx), 0);
  assert.match(h.lines.join("\n"), /none in flight; 3 finished/);
});

test("a presale that opens while the buffer is written stops the upgrade; the buffer is kept", async () => {
  const h = harness({ onWrite: (chain) => chain.put(Keypair.generate().publicKey, presale(STATE.OPEN)) });
  await assert.rejects(runUpgrade(h.ctx), /in flight now/);
  assert.equal(h.calls.send, 0);
  assert.ok(h.chain.acc.has(h.bufferKp.publicKey.toBase58()));
});

test("a buffer the CLI left unfinished stops the upgrade, and a re-run resumes into it", async () => {
  const h = harness({ onWrite: (chain, buf) => chain.acc.get(buf.toBase58()).data.fill(0, BUFFER_HEADER + 900) });
  await assert.rejects(runUpgrade(h.ctx), /is partial; run again to resume/);
  assert.equal(h.calls.send, 0);
  // the second run sees the partial buffer, holds no new rent for it, and writes again
  const again = { ...h.ctx, exec: (cmd, argv) => { h.calls.exec.push([cmd, ...argv]); h.chain.acc.get(h.bufferKp.publicKey.toBase58()).data.set(SO05, BUFFER_HEADER); } };
  h.lines.length = 0;
  assert.equal(await runUpgrade(again), 0);
  assert.match(h.lines.join("\n"), /partial, 328 of 329 parts left/);
  assert.doesNotMatch(h.lines.join("\n"), /SOL rent, held/);
  assert.equal(h.calls.exec.length, 2);
});

// what a stale ER tells the operator: safe to run again, and the re-run waits the whole window
const EU_BEHIND = /ER eu does not run this build yet: keep opens paused\. It is safe to run this again with --confirm: Solana already holds this build, so nothing is sent, and the re-run waits about 8 minutes for each ER again\. If an ER stays behind, ask MagicBlock/;

test("an ER whose programdata copy is new but whose program is the old build fails the run (opens stay paused)", async () => {
  const h = harness({ erStale: ["eu"] });
  await assert.rejects(runUpgrade(h.ctx), EU_BEHIND);
  assert.equal(h.calls.send, 1);
  assert.equal(h.state.history.length, 1); // the upgrade itself is on record
  const eu = h.ctx.ers[1].conn;
  const pd = programDataPda(PID);
  assert.ok((await eu.getAccountInfo(pd)).data.equals(h.chain.acc.get(pd.toBase58()).data), "eu's programdata copy is L1's, the new build");
  assert.match(h.lines.join("\n"), /✗ ER eu https:\/\/eu\.example does not run this build: it runs another build/);
  assert.equal(h.calls.sleeps, 95, "96 looks: every look but the last waits");
  assert.deepEqual([...h.calls.sleptMs], [5_000]);
  assert.equal(h.calls.sleeps * 5_000, 300_000 + 60_000 + 115_000, "MagicBlock's 300 s sweep and 60 s verify throttle, with 115 s for the sweep pass and the reload");
});

test("an ER whose copy of the program is not deployed fails the run", async () => {
  const h = harness({ erStatus: { us: 0n } });
  await assert.rejects(runUpgrade(h.ctx), /ER us does not run this build/);
  assert.match(h.lines.join("\n"), /✗ ER us https:\/\/us\.example does not run this build: not deployed \(status 0\)/);
  assert.equal(h.lines.filter((l) => /✓ ER .* runs this build/.test(l)).length, 2);
});

test("an ER that can't be read counts as not running the build", async () => {
  const h = harness({ erDown: ["as"] });
  await assert.rejects(runUpgrade(h.ctx), /ER as does not run this build/);
  assert.match(h.lines.join("\n"), /✗ ER as https:\/\/as\.example does not run this build: unreadable: fetch failed/);
  assert.equal(h.lines.filter((l) => /✓ ER .* runs this build/.test(l)).length, 2);
});

/** The chain after an upgrade to SO05 landed (the loader's copy and zero fill). */
function landed(chain) {
  const pd = chain.acc.get(programDataPda(PID).toBase58()).data;
  SO05.copy(pd, 45);
  pd.fill(0, 45 + SO05.length);
}

test("the program already holds the build and the record says so: every ER is checked, exit 0", async () => {
  for (const confirm of [false, true]) {
    const h = harness({ confirm });
    landed(h.chain);
    Object.assign(h.state, { soSha256: h.ctx.soSha, soBytes: SO05.length });
    assert.equal(await runUpgrade(h.ctx), 0);
    const text = h.lines.join("\n");
    assert.match(text, /Solana already holds this build/);
    assert.equal(h.lines.filter((l) => /ER .* runs this build/.test(l)).length, 3);
    assert.deepEqual([h.calls.exec.length, h.calls.send, h.calls.saved, h.calls.loadKey], [0, 0, 0, 0]);
  }
  const other = harness();
  other.ctx.authority = Keypair.generate().publicKey;
  await assert.rejects(runUpgrade(other.ctx), /upgrade authority is not --authority/);
  assert.equal(other.calls.exec.length, 0);
});

test("a re-run after the ER check failed still fails while an ER runs the old build (opens stay paused)", async () => {
  const erStale = ["eu"];
  const h = harness({ erStale });
  await assert.rejects(runUpgrade(h.ctx), EU_BEHIND);
  assert.equal(h.state.history.length, 1, "the upgrade itself is on record");
  const sends = h.calls.send;
  // the operator runs it again: Solana holds the build now, the ER still doesn't
  h.calls.sleeps = 0;
  await assert.rejects(runUpgrade(h.ctx), EU_BEHIND);
  assert.equal(h.calls.sleeps, 95, "--confirm gives the ER the whole window again");
  const dry = await runUpgrade({ ...h.ctx, confirm: false });
  assert.equal(dry, 1, "a dry run says it too");
  assert.equal(h.calls.sleeps, 95, "a dry run looks once, without waiting");
  assert.match(h.lines.join("\n"), new RegExp(`not ready:[\\s\\S]*${EU_BEHIND.source}`));
  assert.equal(h.calls.send, sends, "nothing more was sent");
  assert.equal(h.state.history.length, 1, "recorded once");
  // once the ER has caught up, the re-run is clean
  erStale.length = 0;
  assert.equal(await runUpgrade(h.ctx), 0);
});

test("an upgrade whose outcome was unknown but that landed is recorded by the re-run", async () => {
  const h = harness();
  const send = h.ctx.send;
  h.ctx.send = async (conn, opts) => {
    await send(conn, opts);
    throw new Error("upgrade: outcome unknown (timed out waiting for confirmation)");
  };
  await assert.rejects(runUpgrade(h.ctx), /outcome unknown/);
  assert.equal(h.state.soSha256.slice(0, 8), "fc5c22ea", "nothing recorded yet");
  // a dry run points it out and writes nothing
  assert.equal(await runUpgrade({ ...h.ctx, confirm: false }), 1);
  assert.match(h.lines.join("\n"), /deployment\.json records sha256 fc5c22ea60dd8e5b…, not this build: --confirm records it/);
  assert.equal(h.calls.saved, 0);
  // --confirm records it, with the build it replaced; no upgrade tx was seen
  h.ctx.send = send;
  assert.equal(await runUpgrade(h.ctx), 0);
  assert.equal(h.calls.send, 1, "the re-run sent nothing");
  assert.equal(h.calls.saved, 1);
  assert.equal(h.state.soSha256, h.ctx.soSha);
  assert.equal(h.state.soBytes, SO05.length);
  assert.equal(h.state.commit, h.ctx.commit);
  assert.equal(h.state.history.length, 1);
  assert.equal(h.state.history[0].soSha256.slice(0, 8), "fc5c22ea");
  assert.equal(h.state.history[0].upgradeTx, null);
  assert.equal(h.state.history[0].replacedAtSlot, 999);
  // a record with no build on it gets this one, and no history line
  const bare = harness();
  landed(bare.chain);
  for (const k of Object.keys(bare.state)) delete bare.state[k];
  assert.equal(await runUpgrade(bare.ctx), 0);
  assert.equal(bare.state.soSha256, bare.ctx.soSha);
  assert.equal(bare.state.history, undefined);
});

test("dry run and --confirm say the order around the upgrade before anything is sent", async () => {
  const order = [
    /1\. pause opens: MOONER_OPENER_WALLETS="," on the app service, then restart it/,
    /2\. upgrade: this script/,
    /each ER reloads the program by itself; this script waits about 8 minutes for each/,
    /3\. redeploy the app right after: sh deploy\/railway\.sh app/,
    /it returns before the new app is live: wait until\s+curl -s https:\/\/app\.mooner\.family\/api\/info \| grep -o '"TARGET":"\[0-9\]\*"'/,
    /prints "TARGET":"500000000" \(the old app prints another number\)/,
    /4\. unpause: restore MOONER_OPENER_WALLETS/,
  ];
  const at = (lines, re) => lines.findIndex((l) => re.test(l));
  for (const confirm of [false, true]) {
    const h = harness({ confirm });
    await runUpgrade(h.ctx);
    const idx = order.map((re) => at(h.lines, re));
    assert.ok(idx.every((i) => i >= 0), `all four steps are printed (${idx})`);
    assert.deepEqual([...idx].sort((a, b) => a - b), idx, "in that order");
    assert.match(h.lines.join("\n"), /the old numbers and no creator cap in its co-signer/);
    if (confirm) assert.ok(idx[3] < at(h.lines, /== sending/), "before anything is sent");
  }
  const same = harness();
  landed(same.chain);
  Object.assign(same.state, { soSha256: same.ctx.soSha });
  await runUpgrade(same.ctx);
  assert.ok(order.every((re) => at(same.lines, re) >= 0), "also when Solana already holds the build");
});

test("a dry run makes no buffer key file; --confirm makes it only once ready", async () => {
  const dry = harness({ confirm: false });
  assert.equal(await runUpgrade(dry.ctx), 0);
  assert.equal(dry.calls.bufferKeyMade, 0);
  assert.match(dry.lines.join("\n"), /2\. write buffer  a new buffer: its key file is made under --confirm/);
  const notReady = harness({ engineNumbers: { ...RUST05, TARGET: 10_000_000_000n } });
  await assert.rejects(runUpgrade(notReady.ctx), /not ready/);
  assert.equal(notReady.calls.bufferKeyMade, 0);
  const h = harness();
  assert.equal(await runUpgrade(h.ctx), 0);
  assert.equal(h.calls.bufferKeyMade, 1);
  assert.equal(h.calls.exec[0][h.calls.exec[0].indexOf("--buffer") + 1], BUFFER_FILE);
});

test("buffer key files from other builds: what they hold on chain and how to get it back", async () => {
  const held = Keypair.generate().publicKey;
  const gone = Keypair.generate().publicKey;
  const others = { "/x/upgrade-buffer-aaaaaaaa-keypair.json": held, "/x/upgrade-buffer-bbbbbbbb-keypair.json": gone };
  for (const confirm of [false, true]) {
    const h = harness({ confirm, others });
    const d = Buffer.alloc(BUFFER_HEADER + 295_376);
    d.writeUInt32LE(1, 0); d[4] = 1; AUTH.toBuffer().copy(d, 5);
    h.chain.put(held, { owner: BPF_UPGRADEABLE, data: d, lamports: rentOf(d.length) });
    assert.equal(await runUpgrade(h.ctx), 0, "they don't stop the upgrade");
    const text = h.lines.join("\n");
    assert.match(text, new RegExp(`${held} \\(/x/upgrade-buffer-aaaaaaaa-keypair\\.json\\), from another build, holds 1\\.501348 SOL of rent`));
    assert.match(text, new RegExp(`solana program close ${held} -u https://rpc\\.example --keypair /x/auth\\.json --authority /x/auth\\.json --recipient ${AUTH}`));
    assert.match(text, new RegExp(`${gone} \\(/x/upgrade-buffer-bbbbbbbb-keypair\\.json\\), from another build, holds nothing: the file can go`));
  }
});

test("a build larger than the program's room extends first", async () => {
  const h = harness();
  const big = Buffer.concat([SO05, Buffer.alloc(100, 7)]); // 295420 > 295376
  h.ctx.so = big;
  h.ctx.exec = (cmd, argv) => {
    h.calls.exec.push([cmd, ...argv]);
    if (argv[1] === "extend") {
      const pd = h.chain.acc.get(programDataPda(PID).toBase58());
      pd.data = Buffer.concat([pd.data, Buffer.alloc(Number(argv.at(-1)))]);
    } else {
      const d = Buffer.alloc(BUFFER_HEADER + big.length);
      d.writeUInt32LE(1, 0); d[4] = 1; AUTH.toBuffer().copy(d, 5); big.copy(d, BUFFER_HEADER);
      h.chain.put(h.bufferKp.publicKey, { owner: BPF_UPGRADEABLE, data: d, lamports: rentOf(d.length) });
    }
  };
  h.ctx.ers = [];
  assert.equal(await runUpgrade(h.ctx), 0);
  assert.deepEqual(h.calls.exec[0].slice(0, 3), ["solana", "program", "extend"]);
  assert.equal(h.calls.exec[0].at(-1), "44");
  assert.match(h.lines.join("\n"), /44 bytes: 0\.000224 SOL rent, locked in the program for good/);
});

test("an upgrade that lands but leaves other bytes fails the run before the ERs are checked", async () => {
  const h = harness();
  const send = h.ctx.send;
  h.ctx.send = async (conn, opts) => {
    const sig = await send(conn, opts);
    h.chain.acc.get(programDataPda(PID).toBase58()).data[45 + SO05.length] = 1; // a byte left past the program
    return sig;
  };
  await assert.rejects(runUpgrade(h.ctx), /differ from this build after the upgrade/);
  assert.equal(h.state.history, undefined);
  assert.equal(h.calls.saved, 0);
});

test("confirm stops before sending when the key file is not the authority, or the upgrade fails in simulation", async () => {
  const wrongKey = harness();
  wrongKey.ctx.loadKey = () => ({ publicKey: Keypair.generate().publicKey });
  await assert.rejects(runUpgrade(wrongKey.ctx), /authority key mismatch/);
  assert.deepEqual([wrongKey.calls.exec.length, wrongKey.calls.send], [0, 0], "nothing written or sent");

  const failing = harness();
  failing.ctx.simulate = async () => ({ err: { InstructionError: [1, "InvalidAccountData"] }, errText: "invalid account data", logs: ["upgrade log"] });
  await assert.rejects(runUpgrade(failing.ctx), /fails in simulation: invalid account data\nupgrade log/);
  assert.equal(failing.calls.send, 0);
  assert.equal(failing.state.history, undefined);
});

test("a buffer at the build's address that can't be used stops the run before any key is loaded", async () => {
  const h = harness({ bufferKeyMade: true });
  const d = Buffer.alloc(BUFFER_HEADER + SO05.length + 56); // a longer buffer would leave its tail in the program
  d.writeUInt32LE(1, 0); d[4] = 1; AUTH.toBuffer().copy(d, 5); SO05.copy(d, BUFFER_HEADER);
  h.chain.put(h.bufferKp.publicKey, { owner: BPF_UPGRADEABLE, data: d, lamports: rentOf(d.length) });
  await assert.rejects(runUpgrade(h.ctx), /not ready; nothing was sent/);
  assert.match(h.lines.join("\n"), /is unusable: holds 295376 bytes, the \.so is 295320; close it/);
  assert.deepEqual([h.calls.exec.length, h.calls.send, h.calls.loadKey], [0, 0, 0]);
});

test("an extend that doesn't take stops the run before the buffer is written", async () => {
  const h = harness();
  h.ctx.so = Buffer.concat([SO05, Buffer.alloc(100, 7)]); // needs 44 more bytes
  h.ctx.exec = (cmd, argv) => h.calls.exec.push([cmd, ...argv]); // the CLI "succeeds" but the account stays the same
  await assert.rejects(runUpgrade(h.ctx), /the extend did not take/);
  assert.deepEqual(h.calls.exec.map((c) => c[2]), ["extend"]);
  assert.equal(h.calls.send, 0);
});
