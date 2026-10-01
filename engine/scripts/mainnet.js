#!/usr/bin/env node
// Mainnet setup for the presale program. Dry run by default: builds the mainnet .so from a
// clean tree, makes the keys, reads mainnet and prints the plan and what it costs. Nothing
// is sent without --confirm.
//   --confirm          Mooner's DBC config (if missing), deploy (if missing), init_config (or
//                      set_config), the launch lookup table, top up the bot. Each step is
//                      skipped when it is already done.
//   --rpc <url>        Solana RPC (default $MOONER_RPC, else the public mainnet RPC)
//   --authority <file> the deployer: pays, holds the upgrade authority, becomes Config.admin
//                      and the lookup table's authority (default: the solana CLI keypair)
//   --cu-price <µL>    priority price for the deploy's write txs (default 20000)
//   --bot-sol <sol>    SOL the bot keeps for the tx fees it fronts (default 0.05)
//   --dir <path>       keys and record (default engine/.mainnet); a rehearsal on a local
//                      validator uses its own dir, e.g. --rpc http://127.0.0.1:8999 --dir .rehearsal
//   --upgrade          replace the deployed program's bytes with this build, and nothing else.
//                      Works on an existing deployment only: --dir must already hold
//                      deployment.json and program-keypair.json, and no folder, gate, bot or
//                      program key is made (a dry run writes nothing but cargo's build output
//                      in programs/presale/target/; --confirm adds this build's buffer key).
//                      Refuses unless the upgrade authority is --authority, no presale is open,
//                      full or launching, none of our accounts is delegated to an ER, and
//                      engine/src/consts.js has the program's numbers. Writes the buffer
//                      (a re-run resumes it), upgrades, then checks the bytes on Solana and
//                      the program each ER runs (its LoaderV4 copy at the program id; each ER
//                      reloads it by itself, this waits about 8 minutes). A re-run once Solana
//                      holds the build still checks each ER and records the build in
//                      deployment.json. The order, by hand around it:
//                        1. pause opens: MOONER_OPENER_WALLETS="," on the app service, restart
//                           it, and wait until no presale is in flight
//                        2. mainnet.js --upgrade, a dry run, then --upgrade --confirm
//                        3. redeploy the app right after (sh deploy/railway.sh app): an app
//                           built before this change has the old numbers and no creator cap.
//                           railway.sh returns before the new app is live: wait until
//                             curl -s https://app.mooner.family/api/info | grep -o '"TARGET":"[0-9]*"'
//                           prints the new pool size in lamports ("TARGET":"500000000" for 0.5 SOL)
//                        4. unpause: restore MOONER_OPENER_WALLETS, restart the app service
//
// The gate is armed from the start: until the gate server runs, nobody can open or join.
// Keys and the deployment record live in engine/.mainnet/ (gitignored). The program
// keypair is copied there from programs/presale/target/deploy on the first run, so a
// `cargo clean` can't lose the program id before the deploy. The DBC config (consts.js
// MOONER_DBC_CONFIG) is created from dbc-config-keypair.json in the same dir; it is never
// generated here, since its address is pinned in the code and the tests.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AddressLookupTableProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { BPF_UPGRADEABLE, DBC, MOONER_DBC_CONFIG, MOONER_FEE_CLAIMER, numbers } from "../src/consts.js";
import { createConfig } from "../src/dbc.js";
import { CONFIG_LEN, decodeConfig } from "../src/layout.js";
import * as I from "../src/ix.js";
import { configPda, programDataPda } from "../src/pdas.js";
import { launchAltKeys } from "../src/bot.js";
import { connect, send, simulate } from "../src/tx.js";
import { bufferKeyFiles, runUpgrade, upgradeDirProblems } from "../src/upgrade.js";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ENGINE, "..");
const PROGRAM = `${REPO}/programs/presale`;
const SO = `${PROGRAM}/target/deploy/mooner_presale.so`;
const CANARY_SO = `${PROGRAM}/target/canary/mooner_presale.so`;
const FIXTURE = `${PROGRAM}/litesvm/fixtures/dbc-config.json`;
const ER = {
  as: ["MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57", "https://as.magicblock.app"],
  eu: ["MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e", "https://eu.magicblock.app"],
  us: ["MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd", "https://us.magicblock.app"],
};
const sol = (l) => (Number(l) / LAMPORTS_PER_SOL).toFixed(6);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const { values: args } = parseArgs({
  options: {
    confirm: { type: "boolean", default: false },
    rpc: { type: "string" },
    authority: { type: "string" },
    "cu-price": { type: "string", default: "20000" },
    "bot-sol": { type: "string", default: "0.05" },
    dir: { type: "string" },
    upgrade: { type: "boolean", default: false },
  },
});
const rpc = args.rpc ?? process.env.MOONER_RPC ?? "https://api.mainnet-beta.solana.com";
const authFile = args.authority ?? `${os.homedir()}/.config/solana/id.json`;
const cuPrice = Number(args["cu-price"]);
const botWant = BigInt(Math.round(Number(args["bot-sol"]) * LAMPORTS_PER_SOL));
const DIR = path.resolve(ENGINE, args.dir ?? ".mainnet");

if (args.upgrade) {
  // an upgrade works on an existing deployment: a mistyped --dir must not become a new one
  const missing = upgradeDirProblems(DIR);
  if (missing.length) throw new Error(`--upgrade needs an existing deployment in --dir; nothing was created:\n  ${missing.join("\n  ")}`);
} else {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
}
const loadKey = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
const pubkeyOf = (f) => new PublicKey(execFileSync("solana-keygen", ["pubkey", f], { encoding: "utf8" }).trim());
function keyFile(name) {
  const f = `${DIR}/${name}-keypair.json`;
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
  return f;
}
const statePath = `${DIR}/deployment.json`;
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

// ---- build: the mainnet numbers, from committed source ----

const dirty = execFileSync("git", ["-C", REPO, "status", "--porcelain", "--", "programs/presale"], { encoding: "utf8" }).trim();
if (dirty) throw new Error(`programs/presale has uncommitted changes; commit them first:\n${dirty}`);
const commit = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
log(`building the mainnet program (no canary feature) at ${commit.slice(0, 7)}…`);
if (args.upgrade) log(`  (cargo writes its build output in programs/presale/target/; a dry run writes nothing else)`);
execFileSync("cargo", ["build-sbf"], { cwd: PROGRAM, stdio: ["ignore", "ignore", "inherit"] });
const so = fs.readFileSync(SO);
const soSha = sha(so);
if (fs.existsSync(CANARY_SO) && sha(fs.readFileSync(CANARY_SO)) === soSha) throw new Error("the mainnet .so equals the canary build");

// ---- upgrade: the program id from deployment.json, checked against program-keypair.json, and
// --authority. No key is made here (--confirm makes this build's buffer key) ----

if (args.upgrade) {
  const pid = new PublicKey(state.programId);
  const fromKey = pubkeyOf(`${DIR}/program-keypair.json`);
  if (!pid.equals(fromKey)) throw new Error(`deployment.json's programId ${pid} is not program-keypair.json's ${fromKey}`);
  process.exitCode = await runUpgrade({
    l1: connect(rpc), ers: Object.entries(ER).map(([region, [, url]]) => ({ region, url, conn: connect(url) })),
    pid, so, soSha, soPath: SO, commit,
    rustSrc: fs.readFileSync(`${PROGRAM}/src/consts.rs`, "utf8"), engineNumbers: numbers(false),
    authority: pubkeyOf(authFile), authFile, rpc, rpcShown: rpc.replace(/api[-_]?key=[^&]+/i, "api-key=…"),
    cuPrice, confirm: args.confirm, state, save,
    ...bufferKeyFiles(DIR, soSha, keyFile), pubkeyOf, loadKey,
    exec: (cmd, argv) => execFileSync(cmd, argv, { stdio: "inherit" }), send, simulate, log, sleep,
  });
  process.exit();
}

// ---- keys ----

const programKp = `${DIR}/program-keypair.json`;
if (!fs.existsSync(programKp)) fs.copyFileSync(`${PROGRAM}/target/deploy/mooner_presale-keypair.json`, programKp);
fs.chmodSync(programKp, 0o600);
const pid = pubkeyOf(programKp);
const gate = pubkeyOf(keyFile("gate"));
const botFile = keyFile("bot");
const bot = pubkeyOf(botFile);
const authority = pubkeyOf(authFile);
const bufferKp = keyFile("buffer"); // a failed deploy resumes into the same buffer

// ---- read mainnet ----

const l1 = connect(rpc);
const rent = async (n) => BigInt(await l1.getMinimumBalanceForRentExemption(n));
const lamports = async (k) => BigInt(await l1.getBalance(k));
const rpcShown = rpc.replace(/api[-_]?key=[^&]+/i, "api-key=…");

log(`\n== Mooner presale, mainnet setup ${args.confirm ? "(CONFIRM: sends txs)" : "(dry run: sends nothing)"}`);
log(`  rpc            ${rpcShown}`);
log(`  program id     ${pid}   (${so.length} bytes, sha256 ${soSha.slice(0, 16)}…, commit ${commit.slice(0, 7)})`);
log(`  authority      ${authority}   (${authFile}) — pays, upgrade authority, Config.admin`);
log(`  gate           ${gate}   (armed: opens and joins need its co-signature)`);
log(`  bot            ${bot}`);
log(`  DBC config     ${MOONER_DBC_CONFIG}`);

// the DBC config must be the one the tests ran against, byte for byte. Missing, --confirm
// creates it and checks the bytes after.
const dbcKpFile = `${DIR}/dbc-config-keypair.json`;
const fixture = Buffer.from(JSON.parse(fs.readFileSync(FIXTURE, "utf8")).account.data[0], "base64");
const dbcSame = (a) => a?.owner.equals(DBC) && a.data.equals(fixture);
const dbcAcc = await l1.getAccountInfo(MOONER_DBC_CONFIG);
const feeClaimer = new PublicKey(fixture.subarray(40, 72));
if (!feeClaimer.equals(MOONER_FEE_CLAIMER)) throw new Error("the test fixture's fee claimer is not MOONER_FEE_CLAIMER");
if (dbcAcc) {
  if (!dbcSame(dbcAcc)) throw new Error("the mainnet DBC config differs from the test fixture");
  log(`                 owner DBC, same bytes as the test fixture; Mooner's fee share goes to ${feeClaimer}`);
} else {
  if (!fs.existsSync(dbcKpFile) || !pubkeyOf(dbcKpFile).equals(MOONER_DBC_CONFIG)) {
    throw new Error(`${MOONER_DBC_CONFIG} is not on chain and ${dbcKpFile} is not its keypair`);
  }
  log(`                 not on chain yet: --confirm creates it; Mooner's fee share goes to ${feeClaimer}`);
}

for (const [region, [identity, url]] of Object.entries(ER)) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }) })
    .then((x) => x.json()).catch((e) => ({ error: e.message }));
  const ok = r?.result?.identity === identity;
  log(`  ER ${region}          ${url} ${ok ? "answers as" : "DOES NOT answer as"} ${identity}`);
}

const progAcc = await l1.getAccountInfo(pid);
const cfgAcc = await l1.getAccountInfo(configPda(pid));
const altKeys = launchAltKeys(pid, MOONER_DBC_CONFIG);
const altAcc = state.alt && (await l1.getAddressLookupTable(new PublicKey(state.alt))).value;
const altOk = altAcc && altKeys.every((k) => altAcc.state.addresses.some((a) => a.equals(k)));

const cost = {
  dbcConfig: dbcAcc ? 0n : await rent(fixture.length),
  program: progAcc ? 0n : (await rent(36)) + (await rent(45 + so.length)),
  config: cfgAcc ? 0n : await rent(CONFIG_LEN),
  alt: altOk ? 0n : await rent(56 + 32 * altKeys.length),
};
const botHas = await lamports(bot);
cost.bot = botHas >= botWant ? 0n : botWant - botHas;
// the deploy's write txs: at most one per 900 bytes, each 5,000 + 200k CU at the priority price
const writes = progAcc ? 0 : Math.ceil(so.length / 900);
const feeCap = BigInt(writes) * (5_000n + BigInt(Math.ceil((200_000 * cuPrice) / 1e6))) + 50_000n;
const total = cost.dbcConfig + cost.program + cost.config + cost.alt + cost.bot + feeCap;
const authHas = await lamports(authority);

log(`\n  plan`);
log(`  1. DBC config    ${dbcAcc ? "exists, same bytes as the fixture" : `${sol(cost.dbcConfig)} SOL rent (${fixture.length} bytes, the snipe tax)`}`);
log(`  2. deploy        ${progAcc ? "done (checked below)" : `${sol(cost.program)} SOL rent (program + ${so.length}-byte program data), ${writes} write txs at most`}`);
log(`  3. init_config   ${cfgAcc ? "exists (checked below)" : `${sol(cost.config)} SOL rent`}`);
log(`  4. lookup table  ${altOk ? `done ${state.alt}` : `${sol(cost.alt)} SOL rent (${altKeys.length} keys)`}`);
log(`  5. bot           ${cost.bot ? `top up ${sol(cost.bot)} SOL` : `has ${sol(botHas)} SOL`}`);
log(`     tx fees       at most ${sol(feeCap)} SOL`);
log(`  total, at most   ${sol(total)} SOL; authority has ${sol(authHas)} SOL`);
log(`  program rent is locked, not spent: closing the program returns it.`);
if (authHas < total) throw new Error(`the authority needs ${sol(total - authHas)} more SOL`);

async function checkProgram() {
  const pa = await l1.getAccountInfo(pid);
  if (!pa?.owner.equals(BPF_UPGRADEABLE)) throw new Error(`${pid} is not an upgradeable program`);
  const pd = await l1.getAccountInfo(programDataPda(pid));
  const upgrader = pd.data[12] === 1 ? new PublicKey(pd.data.subarray(13, 45)) : null;
  const onChain = pd.data.subarray(45, 45 + so.length);
  const same = onChain.equals(so) && pd.data.subarray(45 + so.length).every((b) => b === 0);
  log(`  program: upgrade authority ${upgrader ?? "none"}; bytes ${same ? "match" : "DIFFER from"} the local build`);
  if (!upgrader?.equals(authority)) throw new Error("the upgrade authority is not --authority");
  return same;
}
async function checkConfig() {
  const c = decodeConfig((await l1.getAccountInfo(configPda(pid))).data);
  const want = { admin: authority, gate, bot, dbcConfig: MOONER_DBC_CONFIG };
  const off = Object.keys(want).filter((k) => !c[k].equals(want[k]));
  log(`  config ${configPda(pid)}: ${off.length ? `differs in ${off.join(", ")}` : "admin, gate, bot, dbc_config as planned"}`);
  return off.length === 0;
}
if (progAcc) await checkProgram();
if (cfgAcc) await checkConfig();

if (!args.confirm) {
  log(`\ndry run only. Nothing was sent.`);
  process.exit(0);
}

// ---- confirm ----

log(`\n== sending`);
const auth = loadKey(authFile);
if (!auth.publicKey.equals(authority)) throw new Error("authority key mismatch");

if (!(await l1.getAccountInfo(MOONER_DBC_CONFIG))) {
  const ix = createConfig({ config: MOONER_DBC_CONFIG, partner: MOONER_FEE_CLAIMER, payer: authority });
  const sig = await send(l1, { ixs: [ix], payer: auth, signers: [loadKey(dbcKpFile)], what: "create the DBC config" });
  log(`  ✓ DBC config ${MOONER_DBC_CONFIG} ${sig}`);
}
if (!dbcSame(await l1.getAccountInfo(MOONER_DBC_CONFIG))) throw new Error("the mainnet DBC config differs from the test fixture");

if (!progAcc) {
  execFileSync("solana", [
    "program", "deploy", "-u", rpc, "--keypair", authFile, "--program-id", programKp, "--buffer", bufferKp,
    "--max-len", String(so.length), "--with-compute-unit-price", String(cuPrice), SO,
  ], { stdio: "inherit" });
}
if (!(await checkProgram())) throw new Error("the deployed bytes differ from the local build");
Object.assign(state, { programId: pid.toBase58(), commit, soSha256: soSha, soBytes: so.length, authority: authority.toBase58() });
save();

const want = { admin: authority, gate, bot, dbcConfig: MOONER_DBC_CONFIG };
if (!(await l1.getAccountInfo(configPda(pid)))) {
  const sig = await send(l1, { ixs: [I.initConfig(pid, { authority, ...want })], payer: auth, pid, what: "init_config" });
  log(`  ✓ init_config ${sig}`);
} else if (!(await checkConfig())) {
  const sig = await send(l1, { ixs: [I.setConfig(pid, { signer: authority, ...want })], payer: auth, pid, what: "set_config" });
  log(`  ✓ set_config ${sig}`);
}
if (!(await checkConfig())) throw new Error("the config did not take");
Object.assign(state, { config: configPda(pid).toBase58(), gate: gate.toBase58(), bot: bot.toBase58(), dbcConfig: MOONER_DBC_CONFIG.toBase58() });
save();

if (!altOk) {
  const slot = await l1.getSlot("finalized");
  const [create, addr] = AddressLookupTableProgram.createLookupTable({ authority, payer: authority, recentSlot: slot });
  const extend = AddressLookupTableProgram.extendLookupTable({ lookupTable: addr, authority, payer: authority, addresses: altKeys });
  const sig = await send(l1, { ixs: [create, extend], payer: auth, what: "create ALT" });
  log(`  ✓ launch lookup table ${addr} ${sig}`);
  state.alt = addr.toBase58();
  save();
  await sleep(2000);
}
const alt = (await l1.getAddressLookupTable(new PublicKey(state.alt))).value;
if (!altKeys.every((k) => alt?.state.addresses.some((a) => a.equals(k)))) throw new Error("the lookup table is missing keys");

const botNow = await lamports(bot);
if (botNow < botWant) {
  const sig = await send(l1, { ixs: [SystemProgram.transfer({ fromPubkey: authority, toPubkey: bot, lamports: botWant - botNow })], payer: auth, what: "top up the bot" });
  log(`  ✓ bot topped up to ${sol(botWant)} SOL ${sig}`);
}

state.finishedAt = new Date().toISOString();
save();
log(`\ndone. Program ${pid}, config ${state.config}, lookup table ${state.alt}. Record: ${statePath}`);
