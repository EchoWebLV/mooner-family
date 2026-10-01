// Program upgrades (mainnet.js --upgrade): the checks, the loader's Upgrade instruction and
// the run itself. runUpgrade gets its connections, keys and senders from the caller, so it
// can be tried against a fake chain (test/run-upgrade.test.js).

import fs from "node:fs";
import { ComputeBudgetProgram, LAMPORTS_PER_SOL, PublicKey, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { BPF_UPGRADEABLE, DELEGATION_PROGRAM } from "./consts.js";
import { PRESALE_LEN, PRESALE_VERSION, STATE, STATE_NAME, decodePresale } from "./layout.js";
import { programDataPda } from "./pdas.js";

// BPF upgradeable loader v3 (solana-loader-v3-interface state.rs)
export const BUFFER_HEADER = 37; // u32 tag 1, Option<authority>: 1 + 32
export const PROGRAMDATA_HEADER = 45; // u32 tag 3, slot u64, Option<authority>: 1 + 32
const UPGRADE = 3; // UpgradeableLoaderInstruction::Upgrade, bincode u32 LE

// What a MagicBlock ER runs: a LoaderV4 account at the program id, not the programdata (the ER
// keeps a separate copy of that, which says nothing about what it runs). LoaderV4State,
// solana-loader-v4-interface 3.1.0 state.rs: slot u64 at 0, authority 32 at 8, status u64 at
// 0x28 (Retracted 0, Deployed 1, Finalized 2 = "same as Deployed, but can not be retracted"),
// the ELF from 0x30. MagicBlock's cloner copies the whole programdata tail, zero fill included
// (magicblock-validator v0.16.0 remote_account_provider/program_account.rs get_state_v3).
export const LOADER_V4 = new PublicKey("LoaderV411111111111111111111111111111111111");
const V4_HEADER = 48;
const V4_STATUS = 40;
const V4_RUNS = [1n, 2n];

// An ER reloads an upgraded program by itself (magicblock-validator v0.16.0, magicblock-chainlink/
// src/chainlink/fetch_cloner/). The window must cover its worst case, a programdata subscription
// that died with the upgrade landing just after a sweep:
//   300 s  PROGRAMDATA_SWEEP_INTERVAL, the backup for dead subscriptions (mod.rs:240, slept at :1380)
//    60 s  PROGRAM_VERIFY_THROTTLE between verifications of a loaded program (program_loader.rs:33)
//   115 s  left for the sweep pass itself and the reload (fetch and clone; no figure in the source)
// 96 looks, 5 s apart: 95 sleeps, 475 s.
export const ER_LOOKS = 96;
export const ER_LOOK_MS = 5_000;

/** Whether an ER's program account (getAccountInfo(pid) on the ER) runs exactly `so`. */
export function erProgram(acc, so) {
  if (!acc) return { runs: false, why: "no program account" };
  if (!acc.owner.equals(LOADER_V4)) return { runs: false, why: `the program is owned by ${acc.owner}, not LoaderV4` };
  const d = acc.data;
  if (d.length >= V4_HEADER) {
    const status = d.readBigUInt64LE(V4_STATUS);
    if (!V4_RUNS.includes(status)) return { runs: false, why: `not deployed (status ${status})` };
  }
  // a shorter copy fails the compare; a longer one must be zero past the ELF
  const same = d.subarray(V4_HEADER, V4_HEADER + so.length).equals(so)
    && d.subarray(V4_HEADER + so.length).every((b) => b === 0);
  return same ? { runs: true } : { runs: false, why: "it runs another build" };
}

/** What --dir lacks for --upgrade, which only works on an existing deployment and makes no
 *  keys or folders (a dry run writes nothing but cargo's build output). */
export function upgradeDirProblems(dir) {
  if (!fs.existsSync(dir)) return [`${dir} does not exist`];
  const out = [];
  const record = `${dir}/deployment.json`;
  if (!fs.existsSync(record)) {
    out.push(`${record} is missing`);
  } else {
    let st;
    try {
      st = JSON.parse(fs.readFileSync(record, "utf8"));
      if (!st?.programId) out.push(`${record} has no programId`);
    } catch {
      out.push(`${record} is not JSON`);
    }
  }
  if (!fs.existsSync(`${dir}/program-keypair.json`)) out.push(`${dir}/program-keypair.json is missing`);
  return out;
}

// MagicBlock delegation record: 96 bytes, the owner program at byte 40 (checked on mainnet)
export const RECORD_LEN = 96;
export const RECORD_OWNER = 40;

const NUMBER_NAMES = ["TARGET", "MIN_SEAT", "MAX_SEAT", "STEP", "DURATION", "GRACE"];

/** The mainnet numbers in consts.rs source (the `not(feature = "canary")` module), as
 *  BigInt for amounts and Number for seconds, like consts.js numbers(false). */
export function rustNumbers(src) {
  const at = src.indexOf('#[cfg(not(feature = "canary"))]');
  if (at < 0) throw new Error("consts.rs: no mainnet numbers module");
  const body = src.slice(at, src.indexOf("}", at));
  const out = {};
  for (const name of NUMBER_NAMES) {
    const m = body.match(new RegExp(`pub const ${name}: (u64|i64) = ([0-9_]+);`));
    if (!m) throw new Error(`consts.rs: no mainnet ${name}`);
    const v = m[2].replaceAll("_", "");
    out[name] = m[1] === "u64" ? BigInt(v) : Number(v);
  }
  return out;
}

/** Names whose value differs between the program build and the engine (consts.js). */
export const numbersDiffer = (rust, js) => NUMBER_NAMES.filter((n) => rust[n] !== js[n]);

/** What stops an upgrade. `home`: [{ pubkey, data }] our program owns at PRESALE_LEN;
 *  `records`: delegation records whose owner is our program (a Presale or Seat in an ER).
 *  OPEN, FULL and LAUNCHING presales read TARGET and the seat limits, so they block.
 *  SETTLED, EXPIRED and FAILED only pay out by `raised` (finish.rs), so they are safe. */
export function blockers({ home, records }) {
  const block = [];
  const safe = [];
  for (const { pubkey, data } of home) {
    if (data.length !== PRESALE_LEN || data[0] !== PRESALE_VERSION) {
      block.push(`${pubkey}: ${data.length}-byte account, not a v${PRESALE_VERSION} Presale`);
      continue;
    }
    const p = decodePresale(data);
    const line = `${pubkey} ${STATE_NAME[p.state]} raised ${p.raised}`;
    if (p.state === STATE.OPEN || p.state === STATE.FULL || p.state === STATE.LAUNCHING) block.push(line);
    else safe.push(line);
  }
  for (const r of records) block.push(`${r.pubkey}: delegation record, one of our accounts is in an ER`);
  return { block, safe };
}

/** The lamports an upgrade needs. `programDataSpace`: the programdata account's data
 *  length; `bufferRent`, `extendRent`: from getMinimumBalanceForRentExemption.
 *  Write txs: at most one per `chunk` bytes, each 5,000 + `writeCu` at `cuPrice` µL/CU
 *  (the same bound as the deploy), plus 50,000 for resends. */
export function upgradeCost({ soLen, programDataSpace, bufferRent, extendRent = 0n, cuPrice, chunk = 900, writeCu = 200_000, upgradeCu = 200_000 }) {
  const room = programDataSpace - PROGRAMDATA_HEADER;
  const extendBytes = Math.max(0, soLen - room);
  const perTx = (cu) => 5_000n + BigInt(Math.ceil((cu * cuPrice) / 1e6));
  const writes = Math.ceil(soLen / chunk);
  const writeFees = BigInt(writes) * perTx(writeCu) + 50_000n;
  const upgradeFee = perTx(upgradeCu);
  const extend = extendBytes ? extendRent : 0n;
  return {
    room,
    extendBytes,
    extendRent: extend, // locked in the programdata for good (returned only if the program is closed)
    bufferRent, // held while the buffer is written, back to the spill account at upgrade
    writes,
    writeFees,
    upgradeFee,
    atOnce: bufferRent + writeFees + upgradeFee + extend, // the authority must hold this before it starts
    spent: writeFees + upgradeFee + extend, // at most, once the buffer rent is back
  };
}

/** A buffer account's state against the .so to upgrade to. `acc`: getAccountInfo result
 *  (or null). `ok` means the upgrade may go ahead; `write` means write-buffer must (re)run. */
export function bufferState(acc, so, authority) {
  if (!acc) return { state: "missing", write: true, ok: false };
  const d = acc.data;
  const bad = (why) => ({ state: "unusable", why, write: false, ok: false });
  if (!acc.owner.equals(BPF_UPGRADEABLE)) return bad(`owned by ${acc.owner}, not the loader`);
  if (d.length < BUFFER_HEADER || d.readUInt32LE(0) !== 1) return bad("not a loader buffer");
  if (d[4] !== 1) return bad("the buffer is immutable (no authority)");
  const auth = new PublicKey(d.subarray(5, 37));
  if (!auth.equals(authority)) return bad(`buffer authority ${auth}, not ${authority}`);
  // an upgrade copies the whole buffer, so a longer one would leave its tail in the program
  if (d.length - BUFFER_HEADER !== so.length) return bad(`holds ${d.length - BUFFER_HEADER} bytes, the .so is ${so.length}; close it and use a new buffer`);
  const body = d.subarray(BUFFER_HEADER);
  if (body.equals(so)) return { state: "complete", write: false, ok: true };
  let differ = 0;
  for (let o = 0; o < so.length; o += 900) if (!body.subarray(o, o + 900).equals(so.subarray(o, o + 900))) differ++;
  return { state: "partial", differ, of: Math.ceil(so.length / 900), write: true, ok: false };
}

/** A programdata account's upgrade authority and whether it holds exactly `so` (the
 *  loader zero-fills past the program). The same test as mainnet.js checkProgram. */
export function readProgramData(data, so) {
  if (data.length < PROGRAMDATA_HEADER || data.readUInt32LE(0) !== 3) throw new Error("not a programdata account");
  const authority = data[12] === 1 ? new PublicKey(data.subarray(13, 45)) : null;
  const slot = data.readBigUInt64LE(4);
  const room = data.length - PROGRAMDATA_HEADER;
  const same = so.length <= room && data.subarray(PROGRAMDATA_HEADER, PROGRAMDATA_HEADER + so.length).equals(so)
    && data.subarray(PROGRAMDATA_HEADER + so.length).every((b) => b === 0);
  return { authority, slot, room, same };
}

/** The loader's Upgrade: buffer -> program, buffer lamports to `spill`. */
export function upgradeIx({ pid, buffer, authority, spill = authority }) {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(UPGRADE, 0);
  return new TransactionInstruction({
    programId: BPF_UPGRADEABLE,
    keys: [
      { pubkey: programDataPda(pid), isSigner: false, isWritable: true },
      { pubkey: pid, isSigner: false, isWritable: true },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: spill, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

const sol = (l) => (Number(l) / LAMPORTS_PER_SOL).toFixed(6);

/** Everything our program has in flight: Presales at home, and delegation records for any of
 *  our accounts (a Presale or Seat that is in an ER). */
export async function inFlight(l1, pid, presaleLen = PRESALE_LEN) {
  const home = (await l1.getProgramAccounts(pid, { filters: [{ dataSize: presaleLen }] }))
    .map((a) => ({ pubkey: a.pubkey, data: a.account.data }));
  const records = (await l1.getProgramAccounts(DELEGATION_PROGRAM, {
    dataSlice: { offset: 0, length: 0 },
    filters: [{ dataSize: RECORD_LEN }, { memcmp: { offset: RECORD_OWNER, bytes: pid.toBase58() } }],
  })).map((a) => ({ pubkey: a.pubkey }));
  return blockers({ home, records });
}

/** mainnet.js's buffer key files, one per build: this build's (made only with `create`, so a
 *  dry run leaves no file) and the ones other builds left in `dir`. `keyFile(name)` makes
 *  <dir>/<name>-keypair.json if it is missing and returns its path. */
export function bufferKeyFiles(dir, soSha, keyFile) {
  const name = `upgrade-buffer-${soSha.slice(0, 8)}`;
  const own = `${dir}/${name}-keypair.json`;
  return {
    bufferFile: ({ create = false } = {}) => (create ? keyFile(name) : fs.existsSync(own) ? own : null),
    otherBufferFiles: () => fs.readdirSync(dir)
      .filter((f) => /^upgrade-buffer-[0-9a-f]{8}-keypair\.json$/.test(f) && f !== `${name}-keypair.json`)
      .map((f) => `${dir}/${f}`),
  };
}

export const APP_INFO = "https://app.mooner.family/api/info";

/** The steps around an upgrade that this script can't do: opens are paused by hand, and the
 *  app's co-signer checks opens with the numbers it was built with (N: the engine's). */
export function upgradeOrder(N) {
  return [
    `1. pause opens: MOONER_OPENER_WALLETS="," on the app service, then restart it; wait until no presale is in flight`,
    `2. upgrade: this script, a dry run, then --confirm`,
    `   each ER reloads the program by itself; this script waits about 8 minutes for each`,
    `   (MagicBlock's validator 0.16.0 watches the programdata account, and sweeps every 5 minutes as a backup)`,
    `3. redeploy the app right after: sh deploy/railway.sh app. An app built before this change has the old numbers and no creator cap in its co-signer`,
    `   it returns before the new app is live: wait until  curl -s ${APP_INFO} | grep -o '"TARGET":"[0-9]*"'`,
    `   prints "TARGET":"${N.TARGET}" (the old app prints another number)`,
    `4. unpause: restore MOONER_OPENER_WALLETS on the app service, then restart it`,
  ];
}

/** mainnet.js --upgrade. Dry run unless `confirm`. Returns the exit code; throws when a
 *  confirmed run has to stop. ctx: { l1, ers: [{ region, url, conn }], pid, so, soSha, soPath,
 *  commit, rustSrc, engineNumbers, authority, authFile, rpc, rpcShown, cuPrice, confirm,
 *  state, save, bufferFile({ create }) (this build's buffer key file, or null while there is
 *  none; `create` makes it), otherBufferFiles(), pubkeyOf(file), loadKey(file), exec(cmd, argv),
 *  send, simulate, log, sleep }. */
export async function runUpgrade(ctx) {
  const { l1, ers, pid, so, soSha, soPath, commit, authority, authFile, rpc, cuPrice, state, log } = ctx;
  const rent = async (n) => BigInt(await l1.getMinimumBalanceForRentExemption(n));
  const lamports = async (k) => BigInt(await l1.getBalance(k));

  log(`\n== Mooner presale, program upgrade ${ctx.confirm ? "(CONFIRM: sends txs)" : "(dry run: sends nothing)"}`);
  log(`  rpc            ${ctx.rpcShown}`);
  log(`  program id     ${pid}`);
  log(`  this build     ${so.length} bytes, sha256 ${soSha.slice(0, 16)}…, commit ${commit.slice(0, 7)}`);
  log(`  authority      ${authority}   (${authFile})`);
  log(`\n  the order (steps 1, 3 and 4 are by hand; nothing checks them):`);
  for (const step of upgradeOrder(ctx.engineNumbers)) log(`  ${step}`);
  log("");
  const problems = [];
  const notReady = () => {
    if (!problems.length) return;
    log(`\n  not ready:`);
    for (const p of problems) log(`  - ${p}`);
  };

  // deployment.json: the build on chain, and the one it replaced
  const record = (upgradeTx, slot) => {
    if (state.soSha256) {
      state.history = [...(state.history ?? []), {
        commit: state.commit, soSha256: state.soSha256, soBytes: state.soBytes,
        replacedAt: new Date().toISOString(), replacedAtSlot: Number(slot), upgradeTx,
      }];
    }
    Object.assign(state, { commit, soSha256: soSha, soBytes: so.length, upgradedAt: new Date().toISOString() });
    ctx.save();
  };

  // each ER runs its own copy of the program: a presale delegated there must see the same numbers
  const staleErs = async (tries) => {
    const stale = [];
    for (const { region, url, conn } of ers) {
      let seen = { runs: false, why: "not read" };
      for (let i = 0; i < tries && !seen.runs; i++) {
        if (i) await ctx.sleep(ER_LOOK_MS);
        seen = await conn.getAccountInfo(pid).then((acc) => erProgram(acc, so), (e) => ({ runs: false, why: `unreadable: ${e.message}` }));
      }
      log(`  ${seen.runs ? "✓" : "✗"} ER ${region} ${url} ${seen.runs ? "runs this build" : `does not run this build: ${seen.why}`}`);
      if (!seen.runs) stale.push(region);
    }
    return stale;
  };
  const erProblem = (stale) => `ER ${stale.join(", ")} does not run this build yet: keep opens paused. It is safe to run this again with --confirm: `
    + `Solana already holds this build, so nothing is sent, and the re-run waits about 8 minutes for each ER again. If an ER stays behind, ask MagicBlock`;

  // the engine checks and builds txs with these numbers: they must be the program's
  const rust = rustNumbers(ctx.rustSrc);
  const off = numbersDiffer(rust, ctx.engineNumbers);
  log(`  numbers        pool ${sol(rust.TARGET)}, seats ${sol(rust.MIN_SEAT)} to ${sol(rust.MAX_SEAT)} SOL; the engine's ${off.length ? `DIFFER in ${off.join(", ")}` : "are the same"}`);
  if (off.length) problems.push(`engine/src/consts.js MAINNET differs from consts.rs in ${off.join(", ")}`);

  const pdKey = programDataPda(pid);
  const pd = await l1.getAccountInfo(pdKey);
  if (!pd) throw new Error(`${pid} is not deployed: run without --upgrade`);
  const was = readProgramData(pd.data, so);
  log(`  on chain       ${state.soSha256 ? `sha256 ${state.soSha256.slice(0, 16)}…, ${state.soBytes} bytes, commit ${state.commit?.slice(0, 7)}` : "build not on record"}; deployed at slot ${was.slot}`);
  log(`                 upgrade authority ${was.authority ?? "none"}`);
  if (!was.authority?.equals(authority)) throw new Error("the upgrade authority is not --authority");
  if (was.same) {
    // a re-run after an upgrade whose ER check failed, or whose send ended "outcome unknown":
    // nothing to send, but the record and every ER still have to be right
    log(`\n  Solana already holds this build (deployed at slot ${was.slot}): nothing to send`);
    if (state.soSha256 !== soSha) {
      if (ctx.confirm) {
        record(null, was.slot);
        log(`  ✓ deployment.json now records this build`);
      } else {
        problems.push(`deployment.json records ${state.soSha256 ? `sha256 ${state.soSha256.slice(0, 16)}…` : "no build"}, not this build: --confirm records it`);
      }
    }
    const stale = await staleErs(ctx.confirm ? ER_LOOKS : 1);
    if (stale.length) problems.push(erProblem(stale));
    notReady();
    if (!ctx.confirm) {
      log(`\ndry run only. Nothing was sent.`);
      return problems.length ? 1 : 0;
    }
    if (problems.length) throw new Error(problems.join("; "));
    log(`\ndone. Next, by hand: steps 3 and 4 above.`);
    return 0;
  }

  const flight = await inFlight(l1, pid);
  log(`  presales       ${flight.block.length ? `${flight.block.length} IN FLIGHT` : "none in flight"}${flight.safe.length ? `; ${flight.safe.length} finished (safe: their payouts use raised, not the pool size)` : ""}`);
  for (const b of flight.block) log(`                 blocks: ${b}`);
  if (flight.block.length) problems.push("a presale is in flight: pause opens and wait until every presale has finished");

  // one buffer per build, so a re-run resumes it and a different build never lands in it.
  // Its key file is made under --confirm only, once the run is ready.
  let bufferFile = ctx.bufferFile();
  let buffer = bufferFile ? ctx.pubkeyOf(bufferFile) : null;
  const buf = buffer ? bufferState(await l1.getAccountInfo(buffer), so, authority) : bufferState(null);
  if (!buf.ok && !buf.write) problems.push(`buffer ${buffer} is unusable: ${buf.why}`);

  // buffers of other builds hold rent until they are closed
  for (const f of ctx.otherBufferFiles()) {
    const k = ctx.pubkeyOf(f);
    const acc = await l1.getAccountInfo(k);
    if (!acc) {
      log(`  old buffer     ${k} (${f}), from another build, holds nothing: the file can go`);
      continue;
    }
    log(`  old buffer     ${k} (${f}), from another build, holds ${sol(acc.lamports)} SOL of rent. To get it back:`);
    log(`                 solana program close ${k} -u ${ctx.rpcShown} --keypair ${authFile} --authority ${authFile} --recipient ${authority}`);
  }

  const extendBytes = Math.max(0, so.length - was.room);
  const cost = upgradeCost({
    soLen: so.length,
    programDataSpace: pd.data.length,
    bufferRent: buf.state === "missing" ? await rent(BUFFER_HEADER + so.length) : 0n,
    extendRent: extendBytes ? (await rent(pd.data.length + extendBytes)) - BigInt(pd.lamports) : 0n,
    cuPrice,
  });
  const writeFees = buf.state === "complete" ? 0n : cost.writeFees;
  const atOnce = cost.bufferRent + writeFees + cost.upgradeFee + cost.extendRent;
  const authHas = await lamports(authority);

  log(`\n  plan`);
  log(`  1. extend        ${extendBytes ? `${extendBytes} bytes: ${sol(cost.extendRent)} SOL rent, locked in the program for good` : `not needed: ${so.length} bytes fit the ${was.room} the program has`}`);
  log(`  2. write buffer  ${buffer ? `${buffer} (${bufferFile})` : "a new buffer: its key file is made under --confirm"}`);
  log(`                   ${buf.state}${buf.why ? `: ${buf.why}` : ""}${buf.state === "partial" ? `, ${buf.differ} of ${buf.of} parts left` : ""}`);
  log(`                   ${cost.bufferRent ? `${sol(cost.bufferRent)} SOL rent, held until step 3 returns it; ` : ""}${writeFees ? `at most ${cost.writes} write txs, at most ${sol(writeFees)} SOL in fees` : "nothing to write"}`);
  log(`  3. upgrade       one tx, at most ${sol(cost.upgradeFee)} SOL; the buffer's rent comes back to ${authority}`);
  log(`  4. check         the program's bytes on Solana, then the program each ER runs (about 8 minutes each at most)`);
  log(`  needed at once   ${sol(atOnce)} SOL; the authority has ${sol(authHas)} SOL`);
  log(`  spent, at most   ${sol(writeFees + cost.upgradeFee + cost.extendRent)} SOL`);
  if (authHas < atOnce) problems.push(`the authority needs ${sol(atOnce - authHas)} more SOL`);

  notReady();
  if (!ctx.confirm) {
    log(`\ndry run only. Nothing was sent.`);
    return problems.length ? 1 : 0;
  }
  if (problems.length) throw new Error("not ready; nothing was sent");

  // ---- confirm ----

  log(`\n== sending`);
  const auth = ctx.loadKey(authFile);
  if (!auth.publicKey.equals(authority)) throw new Error("authority key mismatch");
  if (!bufferFile) {
    bufferFile = ctx.bufferFile({ create: true });
    buffer = ctx.pubkeyOf(bufferFile);
    log(`  new buffer key ${buffer} (${bufferFile})`);
  }
  if (extendBytes) {
    ctx.exec("solana", ["program", "extend", "-u", rpc, "--keypair", authFile, pid.toBase58(), String(extendBytes)]);
    if (readProgramData((await l1.getAccountInfo(pdKey)).data, so).room < so.length) throw new Error("the extend did not take");
  }
  if (buf.write) {
    // the CLI resumes a buffer it already started (same keypair, same size)
    ctx.exec("solana", [
      "program", "write-buffer", "-u", rpc, "--keypair", authFile, "--buffer", bufferFile,
      "--max-len", String(so.length), "--with-compute-unit-price", String(cuPrice), soPath,
    ]);
  }
  const written = bufferState(await l1.getAccountInfo(buffer), so, authority);
  if (!written.ok) throw new Error(`buffer ${buffer} is ${written.state}${written.why ? `: ${written.why}` : ""}; run again to resume`);
  log(`  ✓ buffer ${buffer} holds this build`);

  // a last look: nothing may have opened while the buffer was written
  const late = await inFlight(l1, pid);
  if (late.block.length) throw new Error(`a presale is in flight now (${late.block[0]}); the buffer is kept, run again once none is`);

  const ixs = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }), upgradeIx({ pid, buffer, authority })];
  const sim = await ctx.simulate(l1, { ixs, payer: authority });
  if (sim.err) throw new Error(`the upgrade fails in simulation: ${sim.errText}\n${sim.logs.join("\n")}`);
  const sig = await ctx.send(l1, { ixs, payer: auth, what: "upgrade" });
  log(`  ✓ upgraded ${sig}`);

  const now = readProgramData((await l1.getAccountInfo(pdKey)).data, so);
  if (!now.same) throw new Error("the program's bytes differ from this build after the upgrade");
  log(`  ✓ Solana holds this build (slot ${now.slot}); the authority has ${sol(await lamports(authority))} SOL`);
  record(sig, now.slot);

  const stale = await staleErs(ER_LOOKS);
  if (stale.length) throw new Error(erProblem(stale));

  log(`\ndone. Next, by hand: steps 3 and 4 above.`);
  return 0;
}
