#!/usr/bin/env node
// The canary: real presales end to end, driven by the real bot.
//   --cluster local   solana-test-validator (scripts/local-validator.sh), no ER, gate off
//   --cluster devnet  the canary build on devnet, MagicBlock ER, gate on (co-signed here)
//   --path happy|expiry|all  (default all)
//   --rpc <url>       override the Solana RPC (e.g. a local validator on another port)
//   --resume <mint>   pick up a stopped happy run at the bot's half (reads its run.json)
//
// Happy path (canary TARGET 0.2 SOL):
//   creator commits 0.05 at open; A commits 0.05 through an unfunded session key;
//   B commits 0.03, withdraws to 0, leaves and settles its own seat (no fee);
//   C rotates its session key and commits 0.04 with the new one;
//   D asks for 0.1, is cut to 0.06, and the presale locks FULL.
//   The bot sends everything home, settles, launches, claims and closes.
// Expiry path: E opens with 0.05, F commits 0.02, G joins but never commits; the timer
//   runs out and the bot expires, sends home, refunds and closes.
//
// State and throwaway keys live in engine/.canary/<cluster>/ (gitignored).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  AddressLookupTableProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, VersionedTransaction,
} from "@solana/web3.js";
import {
  DELEGATION_PROGRAM, IX_SYSVAR, MOONER_DBC_CONFIG, SYSTEM, TOKEN22, WSOL, numbers,
} from "../src/consts.js";
import { STATE, STATE_NAME, decodeConfig, decodePresale } from "../src/layout.js";
import * as I from "../src/ix.js";
import * as D from "../src/dbc.js";
import { ata, configPda, eventAuthority, poolAddresses, poolAuthority, presalePda, seatPda, vaultOf } from "../src/pdas.js";
import { build, connect, send, sendSigned } from "../src/tx.js";
import { cosign } from "../src/cosigner.js";
import { Bot } from "../src/bot.js";
import { tokenShare } from "../src/math.js";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ENGINE, "..");
const SO = `${REPO}/programs/presale/target/canary/mooner_presale.so`;
const PROGRAM_KP = `${REPO}/programs/presale/target/canary/mooner_presale-keypair.json`;
const DEVNET_PAYER = `${REPO}/launch-test/er-speed/devnet-payer-keypair.json`;
const REGIONS = {
  eu: ["MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e", "https://devnet-eu.magicblock.app"],
  us: ["MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd", "https://devnet-us.magicblock.app"],
  as: ["MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57", "https://devnet-as.magicblock.app"],
};
const POOL_CREATOR_OFFSET = 104; // VirtualPool: disc 8, volatility tracker 64, config 32, creator
const META = { name: "Mooner Canary", symbol: "MCAN", uri: "https://example.com/mooner-canary.json" };
const SOL = (x) => BigInt(Math.round(x * LAMPORTS_PER_SOL));
const fmt = (l) => (Number(l) / LAMPORTS_PER_SOL).toFixed(6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { values: args } = parseArgs({
  options: {
    cluster: { type: "string", default: "local" },
    path: { type: "string", default: "all" },
    payer: { type: "string" },
    region: { type: "string", default: "as" },
    rpc: { type: "string" },
    resume: { type: "string" },
  },
});
const cluster = args.cluster;
if (!["local", "devnet"].includes(cluster)) throw new Error("--cluster local|devnet");
const useEr = cluster === "devnet";
const dir = `${ENGINE}/.canary/${cluster}`;
fs.mkdirSync(dir, { recursive: true });

const loadKey = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
function keyAt(name) {
  const f = `${dir}/${name}-keypair.json`;
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
  return loadKey(f);
}
const statePath = `${dir}/state.json`;
const saved = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(saved, null, 2));

const payerFile = args.payer ?? (cluster === "devnet" ? DEVNET_PAYER : `${dir}/payer-keypair.json`);
const payer = loadKey(payerFile);
const l1 = connect(args.rpc ?? (cluster === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899"));
const [validatorStr, erUrl] = REGIONS[args.region];
const validator = new PublicKey(validatorStr);
const er = useEr ? connect(erUrl) : null;
const pid = loadKey(PROGRAM_KP).publicKey;
const N = numbers(true);

const report = { cluster, pid: pid.toBase58(), startedAt: new Date().toISOString(), steps: [], checks: [] };
const log = (...a) => console.log(...a);
function step(what, sig, extra = {}) {
  report.steps.push({ what, sig, ...extra });
  log(`  ✓ ${what}${sig ? `  ${sig}` : ""}`);
}
function check(what, ok, detail = "") {
  report.checks.push({ what, ok, detail });
  log(`  ${ok ? "PASS" : "FAIL"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
}

// ---- plumbing ----

const lamports = async (k) => BigInt(await l1.getBalance(k));

async function topUp(to, want) {
  const have = await lamports(to);
  if (have >= want) return;
  const ix = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: want - have });
  await send(l1, { ixs: [ix], payer, what: "top up" });
}

/** The client signs its part, the gate server checks and co-signs (devnet); locally
 *  the gate is off and the tx goes out as is. */
async function entry(user, ixs, what, mint) {
  if (!useEr) {
    const sig = await send(l1, { ixs, payer: user, signers: mint ? [mint] : [], pid, what });
    return step(what, sig);
  }
  const tx = await build(l1, { ixs, payer: user });
  const out = cosign(Buffer.from(tx.serialize()).toString("base64"), {
    pid, gateKey: ctx.gate, validators: [validator], mintSigner: (m) => (mint && m.equals(mint.publicKey) ? mint : undefined),
  });
  const sig = await sendSigned(l1, VersionedTransaction.deserialize(Buffer.from(out.tx, "base64")), { ixs, pid, what });
  step(what, sig);
}

/** A ledger instruction: in the ER on devnet (the signer pays, funded or not), on
 *  Solana locally (the user's wallet pays, the signer co-signs). */
async function ledger(signer, ixs, what, wallet) {
  const sig = useEr
    ? await send(er, { ixs, payer: signer, legacy: true, pid, what, timeoutMs: 30_000 })
    : await send(l1, { ixs, payer: wallet ?? signer, signers: [signer], pid, what });
  step(what + (useEr ? " (ER)" : ""), sig);
}

/** The presale as users see it: the ER copy while delegated. */
async function readPresale(presale) {
  const a = await l1.getAccountInfo(presale);
  if (!a) return null;
  if (a.owner.equals(DELEGATION_PROGRAM)) return decodePresale((await er.getAccountInfo(presale)).data);
  return decodePresale(a.data);
}

async function waitHome(acc, what, timeoutMs = 90_000) {
  const t0 = Date.now();
  for (;;) {
    const a = await l1.getAccountInfo(acc);
    if (a?.owner.equals(pid)) return log(`  … ${what} is home after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`${what} didn't come home`);
    await sleep(1000);
  }
}

/** Ticks the bot until the presale is closed. `onTick` sees each result. A failed tick
 *  is logged and retried, as a keeper would; five in a row stop the run. */
async function runBot(bot, presale, onTick, timeoutMs) {
  const t0 = Date.now();
  let fails = 0;
  for (;;) {
    let r;
    try {
      r = await bot.tick(presale);
      fails = 0;
    } catch (e) {
      if (++fails >= 5) throw e;
      log(`  bot tick failed (${fails}/5), retrying: ${e.message}`);
      report.steps.push({ what: "bot tick failed, retried", error: e.message, logs: e.logs });
      await sleep(3000);
      continue;
    }
    await onTick?.(r);
    if (r.did.length) log(`  bot: ${r.state} -> ${r.did.join(", ")}`);
    if (r.done) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`bot didn't finish: last state ${r.state}`);
    await sleep(r.did.length ? 1500 : Math.min(5000, typeof r.wait === "number" ? Math.max(1, r.wait) * 1000 : 3000));
  }
}

// ---- setup ----

const ctx = {};

async function setup() {
  log(`\n== setup (${cluster}) program ${pid.toBase58()}`);
  log(`  payer ${payer.publicKey.toBase58()} ${fmt(await lamports(payer.publicKey))} SOL`);
  if (!(await l1.getAccountInfo(pid))) {
    if (!useEr) throw new Error("program missing: start scripts/local-validator.sh first");
    const size = fs.statSync(SO).size;
    log(`  deploying the canary build (${size} bytes)…`);
    execFileSync("solana", ["program", "deploy", "-u", "devnet", "--keypair", payerFile, "--program-id", PROGRAM_KP, "--max-len", String(size), SO], { stdio: "inherit" });
    step("deploy");
  }

  if (useEr) {
    const kp = keyAt("dbc-config");
    if (!(await l1.getAccountInfo(kp.publicKey))) {
      const sig = await send(l1, { ixs: [D.createConfig({ config: kp.publicKey, partner: payer.publicKey, payer: payer.publicKey })], payer, signers: [kp], what: "create DBC config" });
      step("create the DBC config (Mooner params)", sig, { config: kp.publicKey.toBase58() });
    }
    ctx.dbcConfig = kp.publicKey;
  } else {
    ctx.dbcConfig = MOONER_DBC_CONFIG;
  }

  ctx.bot = keyAt("bot");
  ctx.gate = useEr ? keyAt("gate") : null;
  ctx.gateKey = ctx.gate?.publicKey ?? PublicKey.default;
  const want = { admin: payer.publicKey, gate: ctx.gateKey, bot: ctx.bot.publicKey, dbcConfig: ctx.dbcConfig };
  const cfg = await l1.getAccountInfo(configPda(pid));
  if (!cfg) {
    const sig = await send(l1, { ixs: [I.initConfig(pid, { authority: payer.publicKey, ...want })], payer, pid, what: "init_config" });
    step("init_config", sig);
  } else {
    const c = decodeConfig(cfg.data);
    if (!["admin", "gate", "bot", "dbcConfig"].every((k) => c[k].equals(want[k]))) {
      const sig = await send(l1, { ixs: [I.setConfig(pid, { signer: payer.publicKey, ...want })], payer, pid, what: "set_config" });
      step("set_config", sig);
    }
  }
  await topUp(ctx.bot.publicKey, SOL(0.1));

  // the launch tx's lookup table: keys every launch shares that no top-level ix invokes
  const altKeys = [configPda(pid), ctx.dbcConfig, poolAuthority(), eventAuthority(), WSOL, TOKEN22, SYSTEM, IX_SYSVAR];
  let alt = saved.alt && (await l1.getAddressLookupTable(new PublicKey(saved.alt))).value;
  if (!alt || !altKeys.every((k) => alt.state.addresses.some((a) => a.equals(k)))) {
    const slot = await l1.getSlot("finalized");
    const [create, addr] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
    const extend = AddressLookupTableProgram.extendLookupTable({ lookupTable: addr, authority: payer.publicKey, payer: payer.publicKey, addresses: altKeys });
    step("create the launch lookup table", await send(l1, { ixs: [create, extend], payer, what: "create ALT" }), { alt: addr.toBase58() });
    saved.alt = addr.toBase58();
    save();
    await sleep(2000); // an extended table is usable from the next slot
    alt = (await l1.getAddressLookupTable(addr)).value;
  }
  ctx.alt = alt;
  report.config = { dbcConfig: ctx.dbcConfig.toBase58(), gate: ctx.gateKey.toBase58(), bot: ctx.bot.publicKey.toBase58(), alt: saved.alt };
}

function newBot(mint) {
  return new Bot({
    pid, l1, ers: useEr ? { [validator.toBase58()]: er } : {}, bot: ctx.bot, dbcConfig: ctx.dbcConfig, canary: true,
    mintSigner: (m) => (m.equals(mint.publicKey) ? mint : undefined),
    tokenMeta: async () => META,
    alts: [ctx.alt],
    log: (m) => log(`  bot ${m}`),
  });
}

function newRun(name) {
  const runDir = `${dir}/run-${Date.now()}-${name}`;
  fs.mkdirSync(runDir);
  const mint = Keypair.generate();
  fs.writeFileSync(`${runDir}/mint-keypair.json`, JSON.stringify([...mint.secretKey]), { mode: 0o600 });
  return { mint, runDir };
}

/** A run's saved state (`run.json`), so a stopped run can be picked up with --resume. */
const saveRun = (runDir, o) => fs.writeFileSync(`${runDir}/run.json`, JSON.stringify(o, null, 2));
function findRun(mintStr) {
  for (const d of fs.readdirSync(dir).filter((n) => n.startsWith("run-"))) {
    const f = `${dir}/${d}/mint-keypair.json`;
    if (fs.existsSync(f) && loadKey(f).publicKey.toBase58() === mintStr) {
      return { mint: loadKey(f), run: JSON.parse(fs.readFileSync(`${dir}/${d}/run.json`, "utf8")) };
    }
  }
  throw new Error(`no run with mint ${mintStr} in ${dir}`);
}

/** open (+ delegate the presale and the creator seat) */
async function open(creator, mint, feeDest, deposit, commit) {
  const presale = presalePda(pid, mint.publicKey);
  const ixs = [I.openPresale(pid, { creator: creator.publicKey, gate: ctx.gateKey, mint: mint.publicKey, feeDest, sessionKey: creator.publicKey, deposit, commit })];
  if (useEr) {
    ixs.push(
      I.delegate(pid, { payer: creator.publicKey, target: presale, validator, kind: 0 }),
      I.delegate(pid, { payer: creator.publicKey, target: seatPda(pid, presale, creator.publicKey), validator, kind: 1, presale }),
    );
  }
  await entry(creator, ixs, `open_presale (creator ${fmt(commit)} SOL)${useEr ? " + delegate presale + seat" : ""}`, mint);
  return presale;
}

/** join (+ delegate the seat) */
async function join(user, presale, sessionKey, deposit, name) {
  const ixs = [I.join(pid, { user: user.publicKey, gate: ctx.gateKey, presale, sessionKey, deposit })];
  if (useEr) ixs.push(I.delegate(pid, { payer: user.publicKey, target: seatPda(pid, presale, user.publicKey), validator, kind: 1, presale }));
  await entry(user, ixs, `${name} joins (deposit ${fmt(deposit)})${useEr ? " + delegate seat" : ""}`);
}

const seatOf = (presale, user) => seatPda(pid, presale, user.publicKey);
const HAPPY = ["creator", "a", "b", "c", "d"];

// ---- happy path ----

async function happy() {
  log(`\n== happy path`);
  const { mint, runDir } = newRun("happy");
  const feeDest = keyAt("fee-dest").publicKey;
  const [creator, A, B, C, Dw] = HAPPY.map(keyAt);
  const deposits = new Map([[creator, SOL(0.05)], [A, SOL(0.05)], [B, SOL(0.03)], [C, SOL(0.04)], [Dw, SOL(0.1)]]);
  for (const [k, dep] of deposits) await topUp(k.publicKey, dep + SOL(k === creator ? 0.03 : 0.02));
  const before = {};
  for (const [n, k] of HAPPY.map((n) => [n, keyAt(n)])) before[n] = String(await lamports(k.publicKey));
  log(`  mint (CA) ${mint.publicKey.toBase58()}`);

  const presale = await open(creator, mint, feeDest, SOL(0.05), SOL(0.05));
  saveRun(runDir, { path: "happy", presale: presale.toBase58(), before });
  const sA = Keypair.generate(); // unfunded session key
  await join(A, presale, sA.publicKey, SOL(0.05), "A");
  await join(B, presale, B.publicKey, SOL(0.03), "B");
  await join(C, presale, C.publicKey, SOL(0.04), "C");
  await join(Dw, presale, Dw.publicKey, SOL(0.1), "D");

  const commit = (signer, user, amount) => I.setCommit(pid, { signer: signer.publicKey, seat: seatOf(presale, user), presale, amount });
  await ledger(sA, [commit(sA, A, SOL(0.05))], "A commits 0.05 with its unfunded session key", A);
  await ledger(B, [commit(B, B, SOL(0.03))], "B commits 0.03");
  await ledger(B, [commit(B, B, 0n)], "B withdraws to 0");
  const bSeat = seatOf(presale, B);
  if (useEr) {
    await ledger(B, [I.leave(pid, { payer: B.publicKey, seat: bSeat })], "B leaves (its seat goes home)");
    await waitHome(bSeat, "B's seat");
  }
  const bBefore = await lamports(B.publicKey);
  const bSig = await send(l1, { ixs: [I.settleSeat(pid, { cranker: B.publicKey, seat: bSeat, user: B.publicKey, presale })], payer: B, pid, what: "B settles its own seat" });
  step("B settles its own seat (refund, no fee)", bSig);
  const bAfter = await lamports(B.publicKey);
  check("B's seat is closed", !(await l1.getAccountInfo(bSeat)));
  check("B got its whole deposit back, less only the tx fee", bAfter - bBefore > SOL(0.03), `+${fmt(bAfter - bBefore)} SOL`);

  const sC = Keypair.generate();
  await ledger(C, [I.rotateKey(pid, { user: C.publicKey, seat: seatOf(presale, C), key: sC.publicKey })], "C rotates its session key");
  await ledger(sC, [commit(sC, C, SOL(0.04))], "C commits 0.04 with the new key", C);
  await ledger(Dw, [commit(Dw, Dw, SOL(0.1))], "D asks for 0.1");

  const p = await readPresale(presale);
  check("the presale locked FULL at exactly the target", p.state === STATE.FULL && p.raised === N.TARGET, `${STATE_NAME[p.state]}, raised ${fmt(p.raised)}`);
  check("4 committed seats (B left)", p.seatsCommitted === 4n, `${p.seatsCommitted}`);
  await finishHappy(mint, presale, before);
}

/** The bot's half of the happy path: home, settle, launch, claim, close; then the checks. */
async function finishHappy(mint, presale, before) {
  const feeDest = keyAt("fee-dest").publicKey;
  const bot = newBot(mint);
  let settled = null;
  let launch = null;
  const origLaunch = bot.launch.bind(bot);
  bot.launch = async (...a) => (launch = await origLaunch(...a));
  const t0 = Date.now();
  await runBot(bot, presale, async (r) => {
    if (!settled && r.did.includes("launch")) settled = await readPresale(presale);
  }, 10 * 60_000);
  step(`bot finished in ${((Date.now() - t0) / 1000).toFixed(0)} s`, launch?.sig, { launch: launch && { released: String(launch.released), cost: String(launch.cost), tokens: String(launch.tokens), units: launch.units } });
  if (!settled) {
    // e.g. the bot came back after full_ts + GRACE: the program refuses the launch, the
    // bot fails the presale and refunds every seat
    check("the presale launched", false, "it ended without a launch (failed and refunded)");
    const lost = {};
    for (const n of HAPPY) lost[n] = fmt(BigInt(before[n]) - (await lamports(keyAt(n).publicKey)));
    report.happy = { mint: mint.publicKey.toBase58(), presale: presale.toBase58(), launched: false, spentPerWallet: lost };
    return;
  }

  // pro-rata: every committed seat got total * commit / raised, the last claimer the rest
  const commits = new Map([["creator", SOL(0.05)], ["a", SOL(0.05)], ["c", SOL(0.04)], ["d", SOL(0.06)]]);
  let sum = 0n;
  let exact = 0;
  for (const [n, c] of commits) {
    const bal = await l1.getTokenAccountBalance(ata(keyAt(n).publicKey, mint.publicKey, TOKEN22)).then((r) => BigInt(r.value.amount)).catch(() => 0n);
    sum += bal;
    if (bal === tokenShare(settled.totalTokens, 0n, c, settled.raised, false)) exact++;
  }
  check("claimed tokens add up to what the pot bought", sum === settled.totalTokens, `${sum} of ${settled.totalTokens}`);
  check("every seat got total × commit / raised (one takes the rounding rest)", exact >= commits.size - 1, `${exact}/${commits.size} exact`);
  check("the pot got exactly the tokens the dry run quoted (min_tokens held)", launch && launch.tokens === settled.totalTokens);

  const { pool } = poolAddresses(ctx.dbcConfig, mint.publicKey);
  const poolData = (await l1.getAccountInfo(pool))?.data;
  const poolCreator = poolData && new PublicKey(poolData.subarray(POOL_CREATOR_OFFSET, POOL_CREATOR_OFFSET + 32));
  check("the pool's creator (fee share) is fee_dest", poolCreator?.equals(feeDest), poolCreator?.toBase58());

  const left = await l1.getMultipleAccountsInfo([presale, vaultOf(presale, mint.publicKey), ...HAPPY.map((n) => seatOf(presale, keyAt(n)))]);
  check("presale, vault and every seat are closed", left.every((a) => !a), `${left.filter(Boolean).length} still open`);

  const costs = {};
  for (const n of HAPPY) costs[n] = fmt(BigInt(before[n]) - (await lamports(keyAt(n).publicKey)));
  report.happy = { mint: mint.publicKey.toBase58(), presale: presale.toBase58(), pool: pool.toBase58(), launch: launch?.sig, totalTokens: String(settled.totalTokens), spentPerWallet: costs };
}

// ---- expiry path ----

async function expiry() {
  log(`\n== expiry path (${N.DURATION} s timer)`);
  const { mint } = newRun("expiry");
  const [E, F, G] = ["e", "f", "g"].map(keyAt);
  const deposits = new Map([[E, SOL(0.05)], [F, SOL(0.02)], [G, SOL(0.02)]]);
  for (const [k, dep] of deposits) await topUp(k.publicKey, dep + SOL(k === E ? 0.03 : 0.02));
  const before = new Map();
  for (const k of deposits.keys()) before.set(k, await lamports(k.publicKey));

  const presale = await open(E, mint, keyAt("fee-dest").publicKey, SOL(0.05), SOL(0.05));
  await join(F, presale, F.publicKey, SOL(0.02), "F");
  await join(G, presale, G.publicKey, SOL(0.02), "G");
  await ledger(F, [I.setCommit(pid, { signer: F.publicKey, seat: seatOf(presale, F), presale, amount: SOL(0.02) })], "F commits 0.02");

  const t0 = Date.now();
  await runBot(newBot(mint), presale, null, (N.DURATION + 10 * 60) * 1000);
  step(`bot expired, refunded and closed ${((Date.now() - t0) / 1000).toFixed(0)} s after the joins`);

  const left = await l1.getMultipleAccountsInfo([presale, ...[...deposits.keys()].map((k) => seatOf(presale, k))]);
  check("presale and every seat are closed", left.every((a) => !a), `${left.filter(Boolean).length} still open`);
  const lost = {};
  for (const [k, b] of before) {
    const d = b - (await lamports(k.publicKey));
    lost[k.publicKey.toBase58()] = fmt(d);
    check(`${k === E ? "E" : k === F ? "F" : "G"} got its deposit back (lost only fees)`, d < SOL(0.01), `${fmt(d)} SOL spent`);
  }
  report.expiry = { mint: mint.publicKey.toBase58(), presale: presale.toBase58(), spentPerWallet: lost };
}

// ---- sweep ----

async function sweep() {
  for (const name of ["creator", "a", "b", "c", "d", "e", "f", "g"]) {
    const k = keyAt(name);
    const bal = await lamports(k.publicKey);
    if (bal <= 5_000n) continue;
    await send(l1, { ixs: [SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: payer.publicKey, lamports: bal - 5_000n })], payer: k, what: "sweep" });
  }
  log(`\n  swept the throwaway wallets back; payer now ${fmt(await lamports(payer.publicKey))} SOL`);
}

// ---- main ----

try {
  await setup();
  if (args.resume) {
    const { mint, run } = findRun(args.resume);
    log(`\n== happy path, resumed at the bot (mint ${args.resume})`);
    await finishHappy(mint, new PublicKey(run.presale), run.before);
  } else if (args.path === "all" || args.path === "happy") await happy();
  if (args.path === "all" || args.path === "expiry") await expiry();
  await sweep();
} catch (e) {
  report.error = String(e.stack ?? e);
  if (e.logs?.length) report.logs = e.logs;
  console.error(e);
  if (e.logs?.length) console.error(e.logs.join("\n"));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  const out = `${dir}/report-${Date.now()}.json`;
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const failed = report.checks.filter((c) => !c.ok).length;
  log(`\n${report.checks.length - failed}/${report.checks.length} checks passed${report.error ? ", stopped on an error" : ""}. Report: ${out}`);
}
