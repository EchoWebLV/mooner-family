// Devnet timing test: how long a presale pool takes to leave a MagicBlock Ephemeral Rollup
// and be usable on Solana again (the moment the launch tx could fire).
//
// Per region: a payer with a "balance" PDA (deposited once, delegated to that region's ER)
// and a "pool" PDA. Each round:
//   1. delegate the pool to the ER (Solana tx), then retry a join in the ER until it lands
//   2. a few more joins in the ER (SOL moves balance -> pool)
//   3. commit + undelegate the pool (ER tx)
//   4. poll Solana until the pool is owned by our program again with the new SOL
//   5. a Solana tx that writes the pool (stands in for the launch)
//
// Usage: node speed.mjs [rounds per region] [region,region,...]   (regions: eu, us, as)

import fs from "node:fs";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID, MAGIC_PROGRAM_ID, MAGIC_CONTEXT_ID,
  delegationRecordPdaFromDelegatedAccount, delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const HERE = new URL(".", import.meta.url).pathname;
const BASE_URL = "https://api.devnet.solana.com";
const REGIONS = {   // from getRoutes on https://devnet-router.magicblock.app
  eu: { url: "https://devnet-eu.magicblock.app", validator: "MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e" },
  us: { url: "https://devnet-us.magicblock.app", validator: "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd" },
  as: { url: "https://devnet-as.magicblock.app", validator: "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57" },
};
const ROUNDS = Number(process.argv[2] || 5);
const PICK = (process.argv[3] || "eu,us,as").split(",");
const FUND = 0.2 * LAMPORTS_PER_SOL;       // per region payer
const DEPOSIT = 0.1 * LAMPORTS_PER_SOL;    // into the balance PDA, once
const JOIN = 0.002 * LAMPORTS_PER_SOL;     // each join moves this into the pool
const JOINS = 3;
const POLL_MS = 250;

const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadKey = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(HERE + f))));
const saveKey = (f, k) => fs.writeFileSync(HERE + f, JSON.stringify([...k.secretKey]), { mode: 0o600 });
const PROGRAM = loadKey("target/deploy/er_speed-keypair.json").publicKey;
const MAIN = loadKey("devnet-payer-keypair.json");
// devnet's public RPC rate-limits per method; wait and retry instead of failing the run
const patientFetch = async (url, opts) => {
  for (let i = 0; ; i++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 || i === 20) return res;
    await sleep(400 + 100 * i);
  }
};
const base = new Connection(BASE_URL, { commitment: "confirmed", fetch: patientFetch, disableRetryOnRateLimit: true });
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const pda = (tag, payer) => PublicKey.findProgramAddressSync([Buffer.from(tag), payer.toBuffer()], PROGRAM)[0];
const ix = (keys, data) => new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.from(data) });
const w = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
const s = (pubkey, isWritable = true) => ({ pubkey, isSigner: true, isWritable });
const send = (conn, payer, ...ixs) =>
  sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], { skipPreflight: true, commitment: "confirmed" });

// Timed send: the blockhash is fetched first, so the clock covers only send -> "confirmed".
// Status is polled directly (every 50 ms on the ER, 300 ms on Solana) instead of web3.js's
// confirm helper, which adds its own delay. Throws if the tx failed.
async function sendTimed(conn, payer, ...ixs) {
  const tx = new Transaction().add(...ixs);
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  const raw = tx.serialize();
  const every = conn === base ? 300 : 50;
  const t0 = now();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true });
  for (let i = 0; ; i++) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      if (st.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(st.err)}`);
      return { sig, ms: now() - t0, t0 };
    }
    if (i % 20 === 19) await conn.sendRawTransaction(raw, { skipPreflight: true }).catch(() => {});
    if (now() - t0 > 90_000) throw new Error(`tx ${sig} not confirmed in 90 s`);
    await sleep(every);
  }
}

function delegateIx(payer, kind, target, validator) {
  return ix([
    s(payer), r(SystemProgram.programId), w(target), r(PROGRAM),
    w(delegateBufferPdaFromDelegatedAccountAndOwnerProgram(target, PROGRAM)),
    w(delegationRecordPdaFromDelegatedAccount(target)),
    w(delegationMetadataPdaFromDelegatedAccount(target)),
    r(DELEGATION_PROGRAM_ID), r(validator),
  ], [2, kind]);
}

async function setup(name, region) {
  const file = `devnet-${name}-keypair.json`;
  let payer;
  try { payer = loadKey(file); } catch { payer = Keypair.generate(); saveKey(file, payer); }
  const pk = payer.publicKey;
  if ((await base.getBalance(pk)) < FUND / 2) {
    await send(base, MAIN, SystemProgram.transfer({ fromPubkey: MAIN.publicKey, toPubkey: pk, lamports: FUND }));
  }
  const pool = pda("pool", pk), bal = pda("bal", pk);
  if (!(await base.getAccountInfo(pool))) await send(base, payer, ix([s(pk), w(pool), r(SystemProgram.programId)], [0]));
  const balInfo = await base.getAccountInfo(bal);
  if (!balInfo) await send(base, payer, ix([s(pk), w(bal), r(SystemProgram.programId)], [1, ...u64(DEPOSIT)]));
  if (!balInfo || balInfo.owner.equals(PROGRAM)) {
    await send(base, payer, delegateIx(pk, 1, bal, new PublicKey(region.validator)));
  }
  if (!(await base.getAccountInfo(pool)).owner.equals(PROGRAM)) {   // left in the ER by a crashed run
    const er = new Connection(region.url, "confirmed");
    await sendTimed(er, payer, ix([s(pk), w(pool), r(MAGIC_PROGRAM_ID), w(MAGIC_CONTEXT_ID)], [4]));
    while (!(await base.getAccountInfo(pool)).owner.equals(PROGRAM)) await sleep(1000);
  }
  return { payer, pk, pool, bal };
}

async function round(er, region, { payer, pk, pool, bal }) {
  const t = {};
  const joinIx = () => ix([s(pk, false), w(bal), w(pool)], [3, ...u64(JOIN)]);

  // 1. pool enters the ER
  let t0 = now();
  await sendTimed(base, payer, delegateIx(pk, 0, pool, new PublicKey(region.validator)));
  t.delegate_solana_ms = now() - t0;
  let tries = 0;
  for (;;) {
    tries++;
    try { await sendTimed(er, payer, joinIx()); break; }
    catch (e) { if (tries > 100) throw e; }
    await sleep(POLL_MS);
  }
  t.enter_er_ms = now() - t0;   // delegate sent -> first join confirmed in the ER
  t.enter_er_tries = tries;

  // 2. joins inside the ER
  t.join_ms = [];
  for (let i = 1; i < JOINS; i++) t.join_ms.push(Math.round((await sendTimed(er, payer, joinIx())).ms));
  const erPool = await er.getAccountInfo(pool);

  // 3. commit + undelegate the pool
  const exit = await sendTimed(er, payer, ix([s(pk), w(pool), r(MAGIC_PROGRAM_ID), w(MAGIC_CONTEXT_ID)], [4]));
  t0 = exit.t0;                  // the clock for the exit starts when the exit tx is sent
  t.exit_er_tx_ms = exit.ms;

  // 4. until Solana shows the pool back with our program and the new SOL
  for (;;) {
    const info = await base.getAccountInfo(pool, "confirmed").catch(() => null);
    if (info && info.owner.equals(PROGRAM) && info.lamports === erPool.lamports) break;
    if (now() - t0 > 10 * 60_000) throw new Error("pool did not come back within 10 minutes");
    await sleep(300);
  }
  t.back_on_solana_ms = now() - t0;

  // 5. a Solana tx that uses the pool (where the launch would go)
  const launch = await sendTimed(base, payer, ix([w(pool)], [5]));
  t.launch_tx_ms = launch.ms;
  t.launch_ready_ms = now() - t0;

  // which Solana txs the ER validator sent for this exit, and their slots
  const sigs = await base.getSignaturesForAddress(pool, { limit: 8 }, "confirmed");
  t.solana_txs = sigs.filter((x) => x.signature !== launch.sig).slice(0, 4)
    .map((x) => ({ sig: x.signature, slot: x.slot, err: x.err }));
  t.launch_slot = sigs.find((x) => x.signature === launch.sig)?.slot ?? null;
  t.exit_sig = exit.sig;
  t.launch_sig = launch.sig;
  t.pool_lamports = erPool.lamports;
  for (const k of Object.keys(t)) if (typeof t[k] === "number" && !k.endsWith("slot") && k !== "pool_lamports") t[k] = Math.round(t[k]);
  return t;
}

const stats = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? { min: v[0], median: v[Math.floor(v.length / 2)], max: v[v.length - 1] } : null;
};

const out = { started: new Date().toISOString(), base: BASE_URL, program: PROGRAM.toBase58(), regions: {} };
for (const name of PICK) {
  const region = REGIONS[name];
  const er = new Connection(region.url, "confirmed");
  const acct = await setup(name, region);
  const pings = [];
  for (let i = 0; i < 5; i++) { const p0 = now(); await er.getSlot(); pings.push(Math.round(now() - p0)); }
  console.log(`\n== ${name} (${region.url})  payer ${acct.pk.toBase58()}  pool ${acct.pool.toBase58()}  ping ${Math.min(...pings)} ms`);
  const rounds = [];
  for (let i = 1; i <= ROUNDS; i++) {
    try {
      const t = await round(er, region, acct);
      rounds.push(t);
      console.log(`round ${i}: enter ER ${t.enter_er_ms} ms (${t.enter_er_tries} tries) | joins ${t.join_ms.join("/")} ms | ` +
        `exit tx ${t.exit_er_tx_ms} ms | pool back on Solana ${t.back_on_solana_ms} ms | ` +
        `launch tx confirmed ${t.launch_ready_ms} ms (${t.launch_tx_ms} of that is the launch tx)`);
    } catch (e) {
      console.log(`round ${i}: FAILED ${e.message}`);
      rounds.push({ error: e.message });
      break;
    }
  }
  const ok = rounds.filter((x) => !x.error);
  out.regions[name] = {
    ping_ms: Math.min(...pings),
    rounds,
    summary: {
      enter_er_ms: stats(ok.map((x) => x.enter_er_ms)),
      join_ms: stats(ok.flatMap((x) => x.join_ms)),
      exit_er_tx_ms: stats(ok.map((x) => x.exit_er_tx_ms)),
      back_on_solana_ms: stats(ok.map((x) => x.back_on_solana_ms)),
      launch_ready_ms: stats(ok.map((x) => x.launch_ready_ms)),
    },
  };
  console.log(`${name} summary:`, JSON.stringify(out.regions[name].summary));
}
fs.mkdirSync(HERE + "runs", { recursive: true });
const file = `${HERE}runs/speed-${out.started.replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log("\nsaved", file);
