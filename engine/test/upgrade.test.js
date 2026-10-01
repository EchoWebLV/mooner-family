// mainnet.js --upgrade, its parts (src/upgrade.js). No network and no keys; the program
// bytes are made up, at the sizes of the real builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { BPF_UPGRADEABLE, numbers } from "../src/consts.js";
import { P, PRESALE_LEN, STATE } from "../src/layout.js";
import { programDataPda } from "../src/pdas.js";
import os from "node:os";
import { BUFFER_HEADER, LOADER_V4, blockers, bufferKeyFiles, bufferState, erProgram, numbersDiffer, readProgramData, rustNumbers, upgradeCost, upgradeDirProblems, upgradeIx } from "../src/upgrade.js";

const CONSTS_RS = fs.readFileSync(new URL("../../programs/presale/src/consts.rs", import.meta.url), "utf8");
const PID = new PublicKey("6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa");
const AUTH = new PublicKey("HKVgAYCTKDdtLyN4hGmBC49Psfb9yxsFWQk3jnBEXnhL");
// the first 45 bytes of the mainnet programdata (a read-only getAccountInfo, 2026-09-30):
// tag 3, deployed at slot 450423499, upgrade authority Some(HKVg…)
const PD_HEADER = Buffer.from("03000000cbead81a0000000001f277de5c13ba618edc69dd741de82f5b9b676c7060a16d2ecc8740592d7a2177", "hex");

test("rustNumbers reads the mainnet module, not the canary one", () => {
  const now = rustNumbers(CONSTS_RS);
  assert.deepEqual(now, { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n, DURATION: 3_600, GRACE: 900 });
  // the 10 SOL source that is on mainnet today (commit 3554261), rebuilt from this one
  const mainnetModule = CONSTS_RS.indexOf('#[cfg(not(feature = "canary"))]');
  const was = CONSTS_RS.slice(0, mainnetModule) + CONSTS_RS.slice(mainnetModule)
    .replace("pub const TARGET: u64 = 500_000_000;", "pub const TARGET: u64 = 10_000_000_000;")
    .replace("pub const MAX_SEAT: u64 = 500_000_000;", "pub const MAX_SEAT: u64 = 1_000_000_000;");
  const deployed = rustNumbers(was);
  assert.equal(deployed.TARGET, 10_000_000_000n);
  assert.equal(deployed.MAX_SEAT, 1_000_000_000n);
  assert.throws(() => rustNumbers("pub const TARGET: u64 = 1;"), /no mainnet numbers/);
});

test("the engine's mainnet numbers are the program's (what --upgrade checks)", () => {
  assert.deepEqual(numbersDiffer(rustNumbers(CONSTS_RS), numbers(false)), []);
});

test("numbersDiffer names what the engine must change", () => {
  const rust = { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n, DURATION: 3_600, GRACE: 900 };
  const engine10 = { TARGET: 10_000_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 1_000_000_000n, STEP: 10_000_000n, DURATION: 3_600, GRACE: 900 };
  assert.deepEqual(numbersDiffer(rust, engine10), ["TARGET", "MAX_SEAT"]);
  assert.deepEqual(numbersDiffer(rust, { ...rust }), []);
});

const presale = (state, raised = 0n) => {
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = 2;
  d[1] = state;
  d.writeBigUInt64LE(raised, P.RAISED);
  return { pubkey: Keypair.generate().publicKey, data: d };
};

test("blockers: open, full and launching block; finished presales are safe", () => {
  assert.deepEqual(blockers({ home: [], records: [] }), { block: [], safe: [] });
  for (const s of [STATE.OPEN, STATE.FULL, STATE.LAUNCHING]) assert.equal(blockers({ home: [presale(s)], records: [] }).block.length, 1);
  const done = blockers({ home: [presale(STATE.SETTLED, 500_000_000n), presale(STATE.EXPIRED), presale(STATE.FAILED)], records: [] });
  assert.equal(done.block.length, 0);
  assert.equal(done.safe.length, 3);
  assert.match(done.safe[0], /SETTLED raised 500000000/);
  // anything of ours delegated to an ER blocks, whatever it is
  assert.equal(blockers({ home: [], records: [{ pubkey: Keypair.generate().publicKey }] }).block.length, 1);
  // an unexpected account at the Presale size blocks rather than being skipped
  const odd = presale(STATE.SETTLED);
  odd.data[0] = 1;
  assert.match(blockers({ home: [odd], records: [] }).block[0], /not a v2 Presale/);
});

test("upgradeCost: the 0.5 SOL build into today's mainnet programdata", () => {
  // mainnet programdata space 295421 (RPC); rent (128 + 37 + 295320) × 5080
  const c = upgradeCost({ soLen: 295_320, programDataSpace: 295_421, bufferRent: 1_501_063_800n, cuPrice: 20_000 });
  assert.equal(c.room, 295_376);
  assert.equal(c.extendBytes, 0);
  assert.equal(c.writes, 329);
  assert.equal(c.writeFees, 3_011_000n); // 329 × (5,000 + 4,000) + 50,000
  assert.equal(c.upgradeFee, 9_000n);
  assert.equal(c.atOnce, 1_504_083_800n);
  assert.equal(c.spent, 3_020_000n);
  // at no priority price
  assert.equal(upgradeCost({ soLen: 295_320, programDataSpace: 295_421, bufferRent: 1n, cuPrice: 0 }).writeFees, 329n * 5_000n + 50_000n);
  // the 10 SOL build (295376 bytes) fits exactly; one byte more needs an extend
  assert.equal(upgradeCost({ soLen: 295_376, programDataSpace: 295_421, bufferRent: 0n, cuPrice: 0 }).extendBytes, 0);
  const big = upgradeCost({ soLen: 295_377, programDataSpace: 295_421, bufferRent: 0n, extendRent: 5_080n, cuPrice: 0 });
  assert.equal(big.extendBytes, 1);
  assert.equal(big.extendRent, 5_080n);
});

const so = Buffer.from(Array.from({ length: 2_000 }, (_, i) => (i * 7 + 3) & 0xff));
const buf = ({ tag = 1, hasAuth = 1, auth = AUTH, body = so, owner = BPF_UPGRADEABLE } = {}) => {
  const d = Buffer.alloc(BUFFER_HEADER + body.length);
  d.writeUInt32LE(tag, 0);
  d[4] = hasAuth;
  auth.toBuffer().copy(d, 5);
  body.copy(d, BUFFER_HEADER);
  return { owner, data: d };
};

test("bufferState", () => {
  assert.deepEqual(bufferState(null, so, AUTH), { state: "missing", write: true, ok: false });
  assert.equal(bufferState(buf(), so, AUTH).state, "complete");
  assert.equal(bufferState(buf(), so, AUTH).ok, true);
  const part = Buffer.from(so);
  part.fill(0, 900); // the first chunk landed, the other two did not
  assert.deepEqual(bufferState(buf({ body: part }), so, AUTH), { state: "partial", differ: 2, of: 3, write: true, ok: false });
  assert.match(bufferState(buf({ owner: PID }), so, AUTH).why, /not the loader/);
  assert.match(bufferState(buf({ tag: 3 }), so, AUTH).why, /not a loader buffer/);
  assert.match(bufferState(buf({ hasAuth: 0 }), so, AUTH).why, /immutable/);
  assert.match(bufferState(buf({ auth: PID }), so, AUTH).why, /buffer authority/);
  assert.match(bufferState(buf({ body: Buffer.concat([so, Buffer.alloc(56)]) }), so, AUTH).why, /close it/);
  assert.match(bufferState(buf({ body: so.subarray(1) }), so, AUTH).why, /close it/);
});

test("readProgramData: the mainnet header, and the bytes after it", () => {
  const deployedSo = Buffer.from(Array.from({ length: 295_376 }, (_, i) => (i * 31 + 7) & 0xff)); // the 10 SOL build's size
  const pd = Buffer.concat([PD_HEADER, deployedSo]);
  const deployed = readProgramData(pd, deployedSo);
  assert.equal(deployed.same, true);
  assert.ok(deployed.authority.equals(AUTH));
  assert.equal(deployed.slot, 450_423_499n);
  assert.equal(deployed.room, 295_376);
  const newSo = Buffer.from(Array.from({ length: 295_320 }, (_, i) => (i * 17 + 1) & 0xff)); // the 0.5 SOL build's size
  assert.equal(readProgramData(pd, newSo).same, false);
  // after an upgrade: the new build, then zeros to the end
  const upgraded = Buffer.concat([PD_HEADER, newSo, Buffer.alloc(56)]);
  assert.equal(readProgramData(upgraded, newSo).same, true);
  upgraded[upgraded.length - 1] = 1;
  assert.equal(readProgramData(upgraded, newSo).same, false, "a byte left past the program");
  const frozen = Buffer.from(pd);
  frozen[12] = 0;
  assert.equal(readProgramData(frozen, deployedSo).authority, null);
  assert.throws(() => readProgramData(Buffer.alloc(45), deployedSo), /not a programdata account/);
});

test("upgradeIx matches solana-loader-v3-interface upgrade()", () => {
  const buffer = Keypair.generate().publicKey;
  const ix = upgradeIx({ pid: PID, buffer, authority: AUTH });
  assert.ok(ix.programId.equals(BPF_UPGRADEABLE));
  assert.equal(ix.data.toString("hex"), "03000000");
  const want = [
    [programDataPda(PID), false, true],
    [PID, false, true],
    [buffer, false, true],
    [AUTH, false, true], // spill defaults to the authority: the buffer rent comes back
    [SYSVAR_RENT_PUBKEY, false, false],
    [SYSVAR_CLOCK_PUBKEY, false, false],
    [AUTH, true, false],
  ];
  assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), want.map(([k, s, w]) => [k.toBase58(), s, w]));
});

test("bufferKeyFiles: this build's buffer key file is made only when asked; other builds' are listed", () => {
  const dir = fs.mkdtempSync(`${os.tmpdir()}/mooner-upgrade-`);
  try {
    // mainnet.js keyFile: makes <dir>/<name>-keypair.json if missing (a stand-in, no real key)
    const made = [];
    const keyFile = (name) => {
      const f = `${dir}/${name}-keypair.json`;
      if (!fs.existsSync(f)) { fs.writeFileSync(f, "[]"); made.push(name); }
      return f;
    };
    for (const f of ["buffer-keypair.json", "deployment.json", "upgrade-buffer-fc5c22ea-keypair.json", "upgrade-buffer-0a1b2c3d-keypair.json", "upgrade-buffer-fc5c22ea-keypair.json.bak", "upgrade-buffer-XYZ-keypair.json"]) {
      fs.writeFileSync(`${dir}/${f}`, "[]");
    }
    const k = bufferKeyFiles(dir, "6fc630d54584826be053241b215e564bd49dcbd4d73bdeb11ef0e299a987871f", keyFile);
    const own = `${dir}/upgrade-buffer-6fc630d5-keypair.json`;
    assert.equal(k.bufferFile(), null, "a dry run gets no file");
    assert.equal(fs.existsSync(own), false, "and none is made");
    assert.deepEqual(k.otherBufferFiles().sort(), [`${dir}/upgrade-buffer-0a1b2c3d-keypair.json`, `${dir}/upgrade-buffer-fc5c22ea-keypair.json`]);
    assert.equal(k.bufferFile({ create: true }), own);
    assert.deepEqual(made, ["upgrade-buffer-6fc630d5"]);
    assert.equal(k.bufferFile(), own, "a re-run finds it");
    assert.equal(k.bufferFile({ create: true }), own);
    assert.deepEqual(made, ["upgrade-buffer-6fc630d5"], "made once");
    assert.equal(k.otherBufferFiles().length, 2, "this build's is not another build's");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The eu ER's copy of the program, read 2026-09-30: a LoaderV4 account (owner LoaderV411…),
// 48-byte header (slot 891861060, authority HKVg…, status 1 = Deployed), then the ELF.
const V4_EU = Buffer.from("44b8283500000000f277de5c13ba618edc69dd741de82f5b9b676c7060a16d2ecc8740592d7a21770100000000000000", "hex");

test("erProgram: an ER runs what its LoaderV4 program account holds", () => {
  const so = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 7 + 3) & 0xff));
  const old = Buffer.from(Array.from({ length: 1100 }, (_, i) => (i * 5 + 1) & 0xff));
  const v4 = (elf, { status = 1n, owner = LOADER_V4, header = V4_EU } = {}) => {
    const h = Buffer.from(header);
    if (h.length >= 48) h.writeBigUInt64LE(status, 40);
    return { owner, data: Buffer.concat([h, elf]) };
  };
  assert.equal(LOADER_V4.toBase58(), "LoaderV411111111111111111111111111111111111");
  assert.deepEqual(erProgram(v4(so), so), { runs: true });
  // the ER copies the whole programdata tail, zeros included (program_account.rs get_state_v3)
  assert.deepEqual(erProgram(v4(Buffer.concat([so, Buffer.alloc(56)])), so), { runs: true });
  assert.deepEqual(erProgram(v4(so, { status: 2n }), so), { runs: true }, "Finalized is Deployed that can't be retracted");
  const no = (acc, why) => {
    const r = erProgram(acc, so);
    assert.equal(r.runs, false);
    assert.match(r.why, why);
  };
  no(null, /no program account/);
  no(v4(old), /another build/);
  no(v4(Buffer.concat([so, Buffer.from([0, 0, 1])])), /another build/);
  no(v4(so.subarray(0, 999)), /another build/);
  no(v4(so, { status: 0n }), /not deployed \(status 0\)/);
  no(v4(so, { status: 3n }), /not deployed \(status 3\)/);
  no(v4(so, { owner: BPF_UPGRADEABLE }), /owned by BPFLoaderUpgradeab1e/);
  no({ owner: LOADER_V4, data: V4_EU.subarray(0, 47) }, /another build/);
});

test("upgradeDirProblems: --upgrade needs an existing deployment and makes nothing", () => {
  const root = fs.mkdtempSync(`${os.tmpdir()}/mooner-upgrade-dir-`);
  try {
    const missing = `${root}/.mainnt`; // a mistyped --dir
    assert.deepEqual(upgradeDirProblems(missing), [`${missing} does not exist`]);
    assert.equal(fs.existsSync(missing), false, "and it still doesn't");
    const dir = `${root}/d`;
    fs.mkdirSync(dir);
    assert.deepEqual(upgradeDirProblems(dir), [`${dir}/deployment.json is missing`, `${dir}/program-keypair.json is missing`]);
    assert.deepEqual(fs.readdirSync(dir), [], "nothing was made");
    fs.writeFileSync(`${dir}/deployment.json`, "{ not json");
    fs.writeFileSync(`${dir}/program-keypair.json`, "[]"); // a stand-in: never read here
    assert.deepEqual(upgradeDirProblems(dir), [`${dir}/deployment.json is not JSON`]);
    fs.writeFileSync(`${dir}/deployment.json`, JSON.stringify({ commit: "abc" }));
    assert.deepEqual(upgradeDirProblems(dir), [`${dir}/deployment.json has no programId`]);
    fs.writeFileSync(`${dir}/deployment.json`, JSON.stringify({ programId: "6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa" }));
    assert.deepEqual(upgradeDirProblems(dir), []);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["deployment.json", "program-keypair.json"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
