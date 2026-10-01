// The server: mint issuing, the co-sign endpoint, presale reads, the keeper's records.
// A real HTTP server on a free port, a fake chain, an in-memory store and a fake Pinata.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AddressLookupTableAccount, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import * as I from "../src/ix.js";
import { DBC, DELEGATION_PROGRAM, MOONER_DBC_CONFIG, numbers } from "../src/consts.js";
import { P, PRESALE_LEN, PRESALE_VERSION, S, SEAT_LEN, SEAT_VERSION, STATE } from "../src/layout.js";
import { poolAddresses, presalePda, seatPda } from "../src/pdas.js";
import { loginMessage, makeSocialRoutes } from "../server/social.js";
import { Bot, launchAltKeys, launchTxSize } from "../src/bot.js";
import { mintMessage, verifySignature } from "../server/auth.js";
import { createServer, webFile } from "../server/http.js";
import * as C from "../src/client.js";
import { makeRoutes, sniffImage } from "../server/api.js";
import { sigOf } from "../src/tx.js";
import { Store } from "../server/store.js";
import { Keeper } from "../server/keeper.js";
import { IPFS_GATEWAY, loadConfig, loadKey, openersFrom, openersFromList } from "../server/config.js";

const pid = Keypair.generate().publicKey;
const gateKey = Keypair.generate();
const botKey = Keypair.generate();
const validator = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const BH = "11111111111111111111111111111111";
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), crypto.randomBytes(40)]);
const alt = new AddressLookupTableAccount({
  key: Keypair.generate().publicKey,
  state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: launchAltKeys(pid, MOONER_DBC_CONFIG) },
});

/** ed25519 signature by a Keypair, the way a wallet's signMessage makes it. */
function signBytes(kp, bytes) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(kp.secretKey.subarray(0, 32))]);
  return crypto.sign(null, bytes, crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
}

function fakeChain() {
  const accounts = new Map();
  const chain = {
    accounts,
    sent: [],
    simErr: null,
    simLogs: null, // the simulation's logs (default: one line when it fails)
    confirm: true,
    rpcEndpoint: "http://fake",
    put(key, owner, data, lamports = 1_000_000) {
      accounts.set(key.toBase58(), { owner, data, lamports, executable: false });
    },
    async getAccountInfo(k) {
      return accounts.get(k.toBase58()) ?? null;
    },
    async getMultipleAccountsInfo(ks) {
      return ks.map((k) => accounts.get(k.toBase58()) ?? null);
    },
    async getProgramAccounts(program, { filters = [] } = {}) {
      const size = filters.find((f) => f.dataSize)?.dataSize;
      return [...accounts]
        .filter(([, a]) => a.owner.equals(program) && (!size || a.data.length === size))
        .map(([k, account]) => ({ pubkey: new PublicKey(k), account }));
    },
    async getBalance() {
      return 50_000_000;
    },
    async getLatestBlockhash() {
      return { blockhash: BH, lastValidBlockHeight: 100 };
    },
    async simulateTransaction(tx, opts) {
      assert.equal(opts.sigVerify, true, "the server simulates with signatures checked");
      const unsigned = tx.signatures.some((s) => s.every((b) => b === 0));
      return { value: { err: unsigned ? "SignatureFailure" : chain.simErr, logs: chain.simLogs ?? (chain.simErr ? ["Program log: nope"] : []) } };
    },
    async sendRawTransaction(raw) {
      chain.sent.push(raw);
      return `SIG${chain.sent.length}`;
    },
    async getSignatureStatuses() {
      return { value: [chain.confirm ? { confirmationStatus: "confirmed", err: null } : null] };
    },
  };
  return chain;
}

function presaleData(mint, state = STATE.OPEN) {
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  d[P.STATE] = state;
  mint.toBuffer().copy(d, P.MINT);
  return d;
}

async function startServer({ openers = [], limits, sendTimeoutMs = 2_000, simMs, pinUri, pinError, web = null } = {}) {
  const l1 = fakeChain();
  const store = new Store(":memory:");
  const pinned = [];
  const pinner = {
    async pinToken(t) {
      if (pinError) throw new Error(pinError);
      pinned.push(t);
      return { image: "https://ipfs.io/ipfs/bafkimage", uri: pinUri ?? `https://ipfs.io/ipfs/${"b".repeat(59)}` };
    },
  };
  const er = { rpcEndpoint: "https://devnet-as.magicblock.app/", getMultipleAccountsInfo: async (ks) => ks.map(() => null) };
  const bot = new Bot({ pid, l1, ers: { [validator.toBase58()]: er }, bot: botKey, dbcConfig: MOONER_DBC_CONFIG, canary: true, log: () => {} });
  const allowed = openers && new Set(openers.map((k) => k.publicKey.toBase58()));
  let skew = 0; // the server's clock runs ahead by this much (the read cache, the limits)
  const routes = makeRoutes({
    pid, l1, bot, gateKey, alt, dbcConfig: MOONER_DBC_CONFIG, store, pinner, openers: () => allowed, cluster: "devnet", canary: true, sendTimeoutMs,
    now: () => Date.now() + skew,
    ...(limits && { limits }),
    ...(simMs && { simMs }),
  });
  const server = createServer(routes, { log: () => {}, web });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { l1, store, pinned, allowed, base, call, routes, later: (ms) => (skew += ms), close: () => new Promise((r) => server.close(r)) };
}

function mintBody(wallet, over = {}, signer = wallet) {
  const b = {
    wallet: wallet.publicKey.toBase58(),
    name: "Moon Dog",
    symbol: "MDOG",
    description: "to the moon\nand back",
    links: { twitter: "https://x.com/moondog" },
    image: PNG.toString("base64"),
    time: Math.floor(Date.now() / 1000),
    ...over,
  };
  const l = { twitter: "", telegram: "", website: "", ...b.links };
  const msg = mintMessage({ wallet: wallet.publicKey, name: b.name, symbol: b.symbol, image: Buffer.from(b.image, "base64"), details: [b.description, l.twitter, l.telegram, l.website], time: b.time });
  return { ...b, signature: signBytes(signer, Buffer.from(msg, "utf8")).toString("base64"), ...(over.signature && { signature: over.signature }) };
}

function entryTx(payer, ixs) {
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: BH, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  return Buffer.from(tx.serialize()).toString("base64");
}

// the web app's builders (src/client.js), so the cosign tests check what it sends
function openIxs(creator, mint, deposit = 50_000_000n) {
  return C.openIxs(pid, { creator, gate: gateKey.publicKey, mint, feeDest: creator, sessionKey: creator, deposit, commit: 50_000_000n, validator });
}

function joinIxs(user, presale) {
  return C.joinIxs(pid, { user, gate: gateKey.publicKey, presale, sessionKey: user, deposit: 20_000_000n, validator });
}

test("wallet signatures and image types", () => {
  const w = Keypair.generate();
  const sig = signBytes(w, Buffer.from("hello"));
  assert.ok(verifySignature(w.publicKey, "hello", sig));
  assert.ok(!verifySignature(Keypair.generate().publicKey, "hello", sig), "another wallet");
  assert.ok(!verifySignature(w.publicKey, "hellO", sig), "another message");
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(Buffer.from("GIF89a-------")), "image/gif");
  assert.equal(sniffImage(Buffer.from("RIFF0000WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>")), null);
});

test("the longest name and symbol with a Pinata link fit the launch tx", () => {
  const meta = { name: "x".repeat(32), symbol: "X".repeat(10), uri: `${IPFS_GATEWAY}${"b".repeat(59)}` };
  const n = launchTxSize({ pid, dbcConfig: MOONER_DBC_CONFIG, alt, meta });
  assert.ok(n <= 1232, `${n} bytes`);
  assert.ok(launchTxSize({ pid, dbcConfig: MOONER_DBC_CONFIG, alt, meta: { ...meta, uri: "u".repeat(400) } }) > 1232);
});

test("mint: IPFS failing is a 502 that says so, and no key is issued", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator], pinError: "https://x/ipfs/bafy did not load" });
  try {
    const r = await s.call("POST", "/api/mint", mintBody(creator));
    assert.equal(r.status, 502, JSON.stringify(r.json));
    assert.equal(r.json.error, "IPFS: https://x/ipfs/bafy did not load; try again");
    assert.equal(s.store.unopened(creator.publicKey).length, 0);
  } finally {
    await s.close();
  }
});

test("mint: a listed wallet gets a key bound to it", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator] });
  try {
    const r = await s.call("POST", "/api/mint", mintBody(creator));
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const mint = new PublicKey(r.json.mint);
    assert.equal(r.json.presale, presalePda(pid, mint).toBase58());
    assert.equal(s.pinned.length, 1);
    assert.deepEqual(s.pinned[0].links, { twitter: "https://x.com/moondog", telegram: "", website: "" });
    assert.equal(s.pinned[0].imageType, "image/png");
    assert.ok(s.store.mintKey(mint, creator.publicKey).publicKey.equals(mint), "the key is stored for the creator");
    assert.equal(s.store.mintKey(mint, Keypair.generate().publicKey), undefined, "and only for the creator");
    const t = await s.call("GET", `/api/token/${mint.toBase58()}`);
    assert.equal(t.json.symbol, "MDOG");
    assert.equal(t.json.secret, undefined, "the secret never leaves the store");
    const mine = await s.call("GET", `/api/wallet/${creator.publicKey.toBase58()}/tokens`);
    assert.equal(mine.json.tokens.length, 1);
  } finally {
    await s.close();
  }
});

test("mint: refusals", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator] });
  try {
    const status = async (body) => (await s.call("POST", "/api/mint", body)).status;
    assert.equal(await status(mintBody(Keypair.generate())), 403, "a wallet not on the list");
    assert.equal(await status(mintBody(creator, {}, Keypair.generate())), 401, "signed by another wallet");
    const signed = mintBody(creator);
    assert.equal(await status({ ...signed, name: "Other Name" }), 401, "details changed after signing");
    assert.equal(await status({ ...signed, image: Buffer.concat([PNG, Buffer.from([1])]).toString("base64") }), 401, "image changed after signing");
    assert.equal(await status(mintBody(creator, { time: Math.floor(Date.now() / 1000) - 1000 })), 400, "an old request");
    assert.equal(await status(mintBody(creator, { image: Buffer.from("<svg/>").toString("base64") })), 400, "not an image");
    assert.equal(await status(mintBody(creator, { image: Buffer.alloc(2_200_000).toString("base64") })), 400, "an image over 2 MB");
    assert.equal(await status(mintBody(creator, { symbol: "MO ON" })), 400, "a symbol with a space");
    assert.equal(await status(mintBody(creator, { name: "x".repeat(33) })), 400, "a name over 32 bytes");
    assert.equal(await status(mintBody(creator, { name: "a\u0000b" })), 400, "control characters");
    assert.equal(await status(mintBody(creator, { links: { website: "http://moon.dog" } })), 400, "a link without https");
    assert.equal(await status(mintBody(creator, { links: { discord: "https://d.gg/x" } })), 400, "an unknown link");
    assert.equal(s.pinned.length, 0, "nothing was pinned");
    assert.equal(await status(signed), 201);
    assert.equal(await status(signed), 409, "the same signed request twice");
  } finally {
    await s.close();
  }
});

test("mint: at most 3 unopened tokens per wallet, opens found on chain count", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator] });
  try {
    const mints = [];
    for (let i = 0; i < 3; i++) mints.push((await s.call("POST", "/api/mint", mintBody(creator, { name: `Moon ${i}` }))).json.mint);
    const r = await s.call("POST", "/api/mint", mintBody(creator, { name: "Moon 3" }));
    assert.equal(r.status, 429);
    assert.equal(r.json.unopened.length, 3);
    // the first one was opened, but the co-sign call stopped waiting before it confirmed
    const m0 = new PublicKey(mints[0]);
    s.l1.put(presalePda(pid, m0), DELEGATION_PROGRAM, presaleData(m0));
    assert.equal((await s.call("POST", "/api/mint", mintBody(creator, { name: "Moon 4" }))).status, 201);
    assert.equal(s.store.token(m0).presale, presalePda(pid, m0).toBase58());
  } finally {
    await s.close();
  }
});

test("mint: rate limits and a link too long for the launch tx", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator], limits: { mintPerIp: [3, 60_000], mintPerWallet: [1, 60_000], cosignPerIp: [1, 60_000], cosignPerWallet: [1, 60_000] } });
  try {
    assert.equal((await s.call("POST", "/api/mint", mintBody(creator))).status, 201);
    assert.equal((await s.call("POST", "/api/mint", mintBody(creator, { name: "Again" }))).status, 429, "per wallet");
    assert.equal((await s.call("POST", "/api/mint", mintBody(creator, { name: "More" }))).status, 429);
    assert.equal((await s.call("POST", "/api/mint", mintBody(creator, { name: "Most" }))).status, 429, "per IP");
  } finally {
    await s.close();
  }
  const s2 = await startServer({ openers: [creator], pinUri: `https://example.com/${"u".repeat(380)}` });
  try {
    const r = await s2.call("POST", "/api/mint", mintBody(creator));
    assert.equal(r.status, 400);
    assert.match(r.json.error, /launch tx/);
    assert.equal(s2.store.unopened(creator.publicKey).length, 0, "no key handed out");
  } finally {
    await s2.close();
  }
});

test("cosign: opens for listed wallets with their own mint, joins for anyone", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator] });
  try {
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    const r = await s.call("POST", "/api/cosign", { tx: entryTx(creator, openIxs(creator.publicKey, mint)) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.kind, r.json.confirmed, r.json.mint], ["open", true, mint.toBase58()]);
    const sent = VersionedTransaction.deserialize(s.l1.sent.at(-1));
    const keys = sent.message.staticAccountKeys;
    const msgBytes = sent.message.serialize();
    for (const k of [creator.publicKey, gateKey.publicKey, mint]) {
      const i = keys.findIndex((x) => x.equals(k));
      const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), k.toBuffer()]);
      assert.ok(crypto.verify(null, msgBytes, crypto.createPublicKey({ key: spki, format: "der", type: "spki" }), sent.signatures[i]), `${k.toBase58().slice(0, 4)} signed`);
    }
    assert.equal(s.store.token(mint).presale, presalePda(pid, mint).toBase58(), "recorded as opened");

    // anyone joins; the openers list doesn't apply
    const joiner = Keypair.generate();
    const j = await s.call("POST", "/api/cosign", { tx: entryTx(joiner, joinIxs(joiner.publicKey, presalePda(pid, mint))) });
    assert.equal(j.status, 200);
    assert.equal(j.json.kind, "join");

    // an open by a wallet not on the list, even with a mint issued to it earlier
    const other = Keypair.generate();
    s.allowed.add(other.publicKey.toBase58());
    const m2 = new PublicKey((await s.call("POST", "/api/mint", mintBody(other))).json.mint);
    s.allowed.delete(other.publicKey.toBase58());
    const off = await s.call("POST", "/api/cosign", { tx: entryTx(other, openIxs(other.publicKey, m2)) });
    assert.equal(off.status, 403);
    assert.match(off.json.error, /openers list/);

    // a listed wallet with a mint issued to someone else
    const stolen = await s.call("POST", "/api/cosign", { tx: entryTx(creator, openIxs(creator.publicKey, m2)) });
    assert.equal(stolen.status, 403);
    assert.match(stolen.json.error, /not a mint this server issued/);
    assert.equal(s.l1.sent.length, 2, "only the good open and the join went out");
  } finally {
    await s.close();
  }
});

test("cosign: the creator's deposit leaves room for at least one other seat", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator] });
  try {
    const N = numbers(true); // the test server runs the canary numbers
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    const big = await s.call("POST", "/api/cosign", { tx: entryTx(creator, openIxs(creator.publicKey, mint, N.TARGET - N.MIN_SEAT + 1n)) });
    assert.equal(big.status, 403, JSON.stringify(big.json));
    assert.match(big.json.error, /at most 0\.19 SOL, so others can join/);
    assert.equal(s.l1.sent.length, 0, "nothing went out");
    const ok = await s.call("POST", "/api/cosign", { tx: entryTx(creator, openIxs(creator.publicKey, mint, N.TARGET - N.MIN_SEAT)) });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  } finally {
    await s.close();
  }
});

test("openers *: any wallet asks for a token and opens with it", async () => {
  const s = await startServer({ openers: null });
  try {
    const creator = Keypair.generate();
    const m = await s.call("POST", "/api/mint", mintBody(creator));
    assert.equal(m.status, 201, JSON.stringify(m.json));
    const mint = new PublicKey(m.json.mint);
    const r = await s.call("POST", "/api/cosign", { tx: entryTx(creator, openIxs(creator.publicKey, mint)) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.kind, "open");
    const other = Keypair.generate();
    const stolen = await s.call("POST", "/api/cosign", { tx: entryTx(other, openIxs(other.publicKey, mint)) });
    assert.equal(stolen.status, 403, "a mint still opens only for the wallet it was issued to");
  } finally {
    await s.close();
  }
});

test("cosign: simulation failures, slow confirms, garbage, rate limits", async () => {
  const user = Keypair.generate();
  const presale = presalePda(pid, Keypair.generate().publicKey);
  const s = await startServer({ sendTimeoutMs: 300 });
  try {
    s.l1.simErr = { InstructionError: [0, { Custom: 1 }] };
    const r = await s.call("POST", "/api/cosign", { tx: entryTx(user, joinIxs(user.publicKey, presale)) });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json.logs, ["Program log: nope"]);
    assert.equal(s.l1.sent.length, 0, "a failing tx is never sent");
    // the join's create_account short of SOL: System's 1 (the logs say who), not PastDeadline
    const system = "11111111111111111111111111111111";
    s.l1.simLogs = [`Program ${pid} invoke [1]`, `Program ${system} invoke [2]`, "Transfer: insufficient lamports 5, need 9", `Program ${system} failed: custom program error: 0x1`, `Program ${pid} failed: custom program error: 0x1`];
    const short = await s.call("POST", "/api/cosign", { tx: entryTx(user, joinIxs(user.publicKey, presale)) });
    assert.equal(short.json.error, `the tx fails: ix 0 (${system}): insufficient lamports (custom 1)`);
    s.l1.simLogs = [`Program ${pid} invoke [1]`, `Program ${pid} failed: custom program error: 0x1`];
    const late = await s.call("POST", "/api/cosign", { tx: entryTx(user, joinIxs(user.publicKey, presale)) });
    assert.equal(late.json.error, "the tx fails: ix 0: PastDeadline (1)");
    s.l1.simLogs = null;
    s.l1.simErr = null;
    s.l1.confirm = false;
    const slow = await s.call("POST", "/api/cosign", { tx: entryTx(user, joinIxs(user.publicKey, presale)) });
    assert.equal(slow.status, 202);
    assert.equal(slow.json.confirmed, false);
    assert.ok(slow.json.sig);
    assert.equal((await s.call("POST", "/api/cosign", { tx: "bm90IGEgdHg=" })).status, 400);
    assert.equal((await s.call("POST", "/api/cosign", {})).status, 400);
  } finally {
    await s.close();
  }
  const s2 = await startServer({ limits: { mintPerIp: [1, 60_000], mintPerWallet: [1, 60_000], cosignPerIp: [2, 60_000], cosignPerWallet: [1, 60_000] } });
  try {
    const tx = entryTx(user, joinIxs(user.publicKey, presale));
    assert.equal((await s2.call("POST", "/api/cosign", { tx })).status, 200);
    assert.equal((await s2.call("POST", "/api/cosign", { tx })).status, 429, "per wallet");
    const u2 = Keypair.generate();
    assert.equal((await s2.call("POST", "/api/cosign", { tx: entryTx(u2, joinIxs(u2.publicKey, presale)) })).status, 429, "per IP");
  } finally {
    await s2.close();
  }
});

test("cosign: a simulation the RPC doesn't answer in 15 s is a 503 \"the network is slow, try again\"; nothing is sent", async (t) => {
  const user = Keypair.generate();
  const presale = presalePda(pid, Keypair.generate().publicKey);
  const tx = () => entryTx(user, joinIxs(user.publicKey, presale));
  const d = await startServer();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    d.l1.simulateTransaction = () => new Promise(() => {}); // the RPC never answers
    const cosign = d.routes.find((r) => r.method === "POST" && r.path.test("/api/cosign")).handler;
    let out = null;
    cosign({ body: { tx: tx() }, ip: "127.0.0.1" }).then((v) => (out = v), (e) => (out = e));
    const flush = () => new Promise((r) => setImmediate(r));
    await flush();
    t.mock.timers.tick(14_999);
    await flush();
    assert.equal(out, null, "still simulating at 14.999 s");
    t.mock.timers.tick(1);
    await flush();
    assert.equal(out?.status, 503, "15 s by default");
    assert.equal(out.message, "the network is slow, try again");
    assert.equal(out.extra?.sent, false, "it says nothing went out");
    assert.equal(d.l1.sent.length, 0, "nothing is sent");
  } finally {
    t.mock.timers.reset();
    await d.close();
  }
  // over HTTP, with a short deadline
  const s = await startServer({ simMs: 50 });
  try {
    s.l1.simulateTransaction = () => new Promise(() => {});
    const r = await s.call("POST", "/api/cosign", { tx: tx() });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "the network is slow, try again");
    assert.equal(r.json.sent, false, "it says nothing went out");
    assert.equal(s.l1.sent.length, 0, "nothing is sent");
  } finally {
    await s.close();
  }
});

test("cosign: every answer from before the tx goes out says sent: false; none from after it does", async () => {
  const user = Keypair.generate();
  const presale = presalePda(pid, Keypair.generate().publicKey);
  const join = (u = user) => entryTx(u, joinIxs(u.publicKey, presale));
  const s = await startServer({ sendTimeoutMs: 300 });
  try {
    const cosign = (tx) => s.call("POST", "/api/cosign", { tx });
    const before = [];
    before.push(["garbage", await cosign("bm90IGEgdHg=")]);
    before.push(["refused by the gate", await cosign(entryTx(user, openIxs(user.publicKey, Keypair.generate().publicKey)))]);
    s.l1.simErr = { InstructionError: [0, { Custom: 1 }] };
    before.push(["the simulation fails", await cosign(join(Keypair.generate()))]);
    s.l1.simErr = null;
    const simulate = s.l1.simulateTransaction;
    s.l1.simulateTransaction = async () => { throw new Error("fetch failed"); };
    before.push(["the simulation's RPC fails", await cosign(join(Keypair.generate()))]);
    s.l1.simulateTransaction = simulate;
    assert.deepEqual(before.map(([what, r]) => [what, r.status]), [["garbage", 400], ["refused by the gate", 403], ["the simulation fails", 400], ["the simulation's RPC fails", 500]]);
    for (const [what, r] of before) assert.equal(r.json.sent, false, what);
    assert.equal(s.l1.sent.length, 0, "nothing went out");
    // after the send began: no marker, so the client can't take it for nothing sent
    s.l1.confirm = false;
    const slow = await cosign(join(Keypair.generate()));
    assert.equal(slow.status, 202);
    assert.equal(slow.json.sent, undefined);
    const send = s.l1.sendRawTransaction;
    s.l1.sendRawTransaction = async () => { throw Object.assign(new Error("failed to send transaction"), { transactionMessage: "Blockhash not found" }); };
    const refused = await cosign(join(Keypair.generate()));
    s.l1.sendRawTransaction = send;
    assert.equal(refused.status, 500);
    assert.equal(refused.json.sent, undefined, "the send's own errors are the client's to weigh");
  } finally {
    await s.close();
  }
  const s2 = await startServer({ limits: { mintPerIp: [1, 60_000], mintPerWallet: [1, 60_000], cosignPerIp: [5, 60_000], cosignPerWallet: [1, 60_000] } });
  try {
    assert.equal((await s2.call("POST", "/api/cosign", { tx: join() })).status, 200);
    const limited = await s2.call("POST", "/api/cosign", { tx: join() });
    assert.equal(limited.status, 429);
    assert.equal(limited.json.sent, false, "rate limited");
  } finally {
    await s2.close();
  }
});

test("cosign: the same signed tx again after it went out is a 202 with its sig and no sent marker; a blockhash the RPC doesn't know is one only when the tx's status is found", async () => {
  const creator = Keypair.generate();
  const presale = presalePda(pid, Keypair.generate().publicKey);
  const join = (u) => entryTx(u, joinIxs(u.publicKey, presale));
  const sigIn = (b64) => sigOf(VersionedTransaction.deserialize(Buffer.from(b64, "base64")));
  const s = await startServer({ openers: [creator], simMs: 50 });
  const statuses = s.l1.getSignatureStatuses;
  try {
    const cosign = (tx) => s.call("POST", "/api/cosign", { tx });
    // AlreadyProcessed (a unit variant: the RPC's JSON has the name as a string; an object
    // keyed by it is read the same): it went out before
    for (const err of ["AlreadyProcessed", { AlreadyProcessed: null }]) {
      s.l1.simErr = err;
      const tx = join(Keypair.generate());
      const r = await cosign(tx);
      assert.equal(r.status, 202, JSON.stringify(err));
      assert.deepEqual([r.json.sig, r.json.confirmed, r.json.kind, r.json.presale], [sigIn(tx), false, "join", presale.toBase58()]);
      assert.equal("sent" in r.json, false, "no sent marker");
    }
    // an open the same way: what the first request recorded is left to it
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    s.l1.simErr = "AlreadyProcessed";
    const open = await cosign(entryTx(creator, openIxs(creator.publicKey, mint)));
    assert.equal(open.status, 202);
    assert.deepEqual([open.json.kind, open.json.mint, "sent" in open.json], ["open", mint.toBase58(), false]);
    assert.notEqual(s.store.token(mint).presale, presalePda(pid, mint).toBase58(), "not recorded as opened here");
    // BlockhashNotFound: the tx's own status decides
    const asked = [];
    const status = (answer) => (s.l1.getSignatureStatuses = async (sigs, opts) => (asked.push([sigs, opts]), answer()));
    for (const err of ["BlockhashNotFound", { BlockhashNotFound: null }]) {
      s.l1.simErr = err;
      status(async () => ({ context: { slot: 9 }, value: [{ slot: 8, confirmationStatus: "finalized", err: null }] }));
      const tx = join(Keypair.generate());
      const found = await cosign(tx);
      assert.equal(found.status, 202, `found: ${JSON.stringify(err)}`);
      assert.deepEqual([found.json.sig, found.json.confirmed, "sent" in found.json], [sigIn(tx), false, false]);
      assert.deepEqual(asked.at(-1), [[sigIn(tx)], { searchTransactionHistory: true }]);
    }
    s.l1.simErr = "BlockhashNotFound";
    status(async () => ({ context: { slot: 9 }, value: [null] }));
    const none = await cosign(join(Keypair.generate()));
    assert.deepEqual([none.status, none.json.sent], [400, false], "no status: it never went out");
    assert.match(none.json.error, /BlockhashNotFound/);
    status(async () => { throw new Error("fetch failed"); });
    const failed = await cosign(join(Keypair.generate()));
    assert.deepEqual([failed.status, failed.json.error, "sent" in failed.json], [503, "the network is slow, try again", false], "the read failed");
    status(() => new Promise(() => {}));
    const hung = await cosign(join(Keypair.generate()));
    assert.deepEqual([hung.status, hung.json.error, "sent" in hung.json], [503, "the network is slow, try again", false], "the read took over simMs");
    // any other simulation error: today's 400, nothing went out
    s.l1.simErr = "AccountInUse";
    const other = await cosign(join(Keypair.generate()));
    assert.deepEqual([other.status, other.json.sent], [400, false]);
    assert.equal(s.l1.sent.length, 0, "nothing was sent on any of these");
  } finally {
    s.l1.getSignatureStatuses = statuses;
    await s.close();
  }
});

test("presale reads: live from the chain, closed from the record", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator] });
  try {
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    const presale = presalePda(pid, mint);
    s.l1.put(presale, pid, presaleData(mint, STATE.SETTLED));
    const list = await s.call("GET", "/api/presales");
    assert.equal(list.json.presales.length, 1);
    assert.deepEqual([list.json.presales[0].state, list.json.presales[0].where, list.json.presales[0].token.symbol], ["SETTLED", "home", "MDOG"]);
    const one = await s.call("GET", `/api/presale/${presale.toBase58()}`);
    assert.deepEqual(one.json.seats, []);
    assert.equal(typeof one.json.raised, "string", "u64s come as decimal strings");

    // a delegated account that isn't at our PDA for its mint is not a presale
    const fake = Keypair.generate().publicKey;
    s.l1.put(fake, DELEGATION_PROGRAM, presaleData(mint));
    assert.equal((await s.call("GET", `/api/presale/${fake.toBase58()}`)).status, 404);

    s.store.markOpened(mint, presale);
    s.store.addLaunch(presale, mint, { sig: "LAUNCH", released: 9n, cost: 1n, tokens: 5n, units: 7 });
    s.l1.accounts.delete(presale.toBase58());
    assert.equal((await s.call("GET", `/api/presale/${presale.toBase58()}`)).json.state, "SETTLED", "a view is shared for 2 s");
    s.later(2_000);
    const closed = await s.call("GET", `/api/presale/${presale.toBase58()}`);
    assert.deepEqual([closed.json.state, closed.json.launch.sig, closed.json.launch.tokens], ["CLOSED", "LAUNCH", "5"]);
    assert.equal((await s.call("GET", `/api/presale/${Keypair.generate().publicKey.toBase58()}`)).status, 404);
    assert.equal((await s.call("GET", "/api/nope")).status, 404);
    assert.equal((await s.call("POST", "/api/presales", {})).status, 405);
    const info = await s.call("GET", "/api/info");
    assert.deepEqual([info.json.gate, info.json.ers[0].validator, info.json.numbers.TARGET], [gateKey.publicKey.toBase58(), validator.toBase58(), "200000000"]);
    const health = await s.call("GET", "/api/health");
    assert.deepEqual([health.status, health.json.botLamports], [200, 50_000_000]);
    assert.equal((await s.call("POST", "/api/cosign", { tx: "A".repeat(10_000) })).status, 413, "body over the route's limit");
  } finally {
    await s.close();
  }
});

function seatData(presale, user, deposit, commit) {
  const d = Buffer.alloc(SEAT_LEN);
  d[0] = SEAT_VERSION;
  user.toBuffer().copy(d, S.USER);
  presale.toBuffer().copy(d, S.PRESALE);
  d.writeBigUInt64LE(deposit, S.DEPOSIT);
  d.writeBigUInt64LE(commit, S.COMMIT);
  return d;
}

test("reads: an open presale lists its wallets, launched tokens come with their pool", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator] });
  try {
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    const presale = presalePda(pid, mint);
    s.l1.put(presale, pid, presaleData(mint, STATE.OPEN));
    const [a, b, c] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
    s.l1.put(seatPda(pid, presale, a), pid, seatData(presale, a, 30_000_000n, 30_000_000n));
    s.l1.put(seatPda(pid, presale, b), pid, seatData(presale, b, 90_000_000n, 90_000_000n));
    s.l1.put(seatPda(pid, presale, c), pid, seatData(presale, c, 50_000_000n, 0n));
    const list = await s.call("GET", "/api/presales");
    assert.deepEqual(list.json.presales[0].users, [
      { user: b.toBase58(), commit: "90000000", creator: false },
      { user: a.toBase58(), commit: "30000000", creator: false },
    ], "biggest first, a seat at 0 isn't in");
    assert.deepEqual((await s.call("GET", `/api/wallet/${a.toBase58()}/balance`)).json, { lamports: 50_000_000 });

    assert.deepEqual((await s.call("GET", "/api/launched")).json.launched, []);
    s.store.markOpened(mint, presale);
    s.store.addLaunch(presale, mint, { sig: "LAUNCH", released: 9n, cost: 1n, tokens: 5n, units: 7 });
    s.later(5_000);
    const none = (await s.call("GET", "/api/launched")).json.launched;
    assert.deepEqual([none.length, none[0].mint, none[0].token.symbol, none[0].launch.sig, none[0].pool], [1, mint.toBase58(), "MDOG", "LAUNCH", null]);
    const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/dbc-pool.json", import.meta.url), "utf8"));
    const pool = poolAddresses(MOONER_DBC_CONFIG, mint).pool;
    s.l1.put(pool, DBC, Buffer.from(fixture.data, "base64"));
    s.later(5_000);
    const one = (await s.call("GET", "/api/launched")).json.launched[0];
    assert.deepEqual(one.pool, { address: pool.toBase58(), quoteReserve: "197354828", sqrtPrice: "98247117170863603", migrated: false, damm: null });
  } finally {
    await s.close();
  }
});

async function startSocial({ presales = [], limits } = {}) {
  const store = new Store(":memory:");
  let skew = 0;
  const now = () => Date.now() + skew;
  const known = new Set(presales.map((k) => k.toBase58()));
  const server = createServer(makeSocialRoutes({ store, isPresale: (k) => known.has(k), now, ...(limits && { limits }) }), { log: () => {} });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const login = (kp, time = Math.floor(now() / 1000), signer = kp) =>
    call("POST", "/api/login", { wallet: kp.publicKey.toBase58(), time, signature: signBytes(signer, Buffer.from(loginMessage(kp.publicKey.toBase58(), time), "utf8")).toString("base64") });
  return { store, call, login, later: (ms) => (skew += ms), close: () => new Promise((r) => server.close(r)) };
}

const PFP = { skin: "moon", eyes: "stars", head: "none", face: "grin", outfit: "hoodie", neck: "none", aura: "none", bg: "night" };

test("social: sign in with a wallet, chat, save a picture", async () => {
  const presale = Keypair.generate().publicKey;
  const s = await startSocial({ presales: [presale] });
  try {
    const me = Keypair.generate();
    assert.equal((await s.login(me, undefined, Keypair.generate())).status, 401, "signed by another wallet");
    assert.equal((await s.login(me, Math.floor(Date.now() / 1000) - 3_600)).status, 400, "an old time");
    const time = Math.floor(Date.now() / 1000);
    const ok = await s.login(me, time);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.wallet, me.publicKey.toBase58());
    assert.equal((await s.login(me, time)).status, 409, "the same signature twice");
    const token = ok.json.token;

    assert.equal((await s.call("POST", "/api/chat", { channel: "global", text: "gm" })).status, 401, "not signed in");
    assert.equal((await s.call("POST", "/api/chat", { token: token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), channel: "global", text: "gm" })).status, 401, "a forged token");
    const sent = await s.call("POST", "/api/chat", { token, channel: "global", text: "  gm moon  " });
    assert.deepEqual([sent.status, sent.json.text, sent.json.wallet], [201, "gm moon", me.publicKey.toBase58()]);
    assert.equal((await s.call("POST", "/api/chat", { token, channel: presale.toBase58(), text: "in" })).status, 201);
    assert.equal((await s.call("POST", "/api/chat", { token, channel: Keypair.generate().publicKey.toBase58(), text: "x" })).status, 404, "an unknown presale");
    assert.equal((await s.call("POST", "/api/chat", { token, channel: "global", text: "   " })).status, 400);
    assert.equal((await s.call("POST", "/api/chat", { token, channel: "global", text: "a\u0007b" })).status, 400);
    assert.equal((await s.call("POST", "/api/chat", { token, channel: "global", text: "x".repeat(281) })).status, 400);

    const global = (await s.call("GET", "/api/chat/global")).json.messages;
    assert.deepEqual(global.map((m) => m.text), ["gm moon"]);
    assert.deepEqual((await s.call("GET", `/api/chat/global?after=${global[0].id}`)).json.messages, []);
    assert.deepEqual((await s.call("GET", `/api/chat/${presale.toBase58()}`)).json.messages.map((m) => m.text), ["in"]);

    assert.equal((await s.call("POST", "/api/profile", { token, pfp: { ...PFP, bg: "<script>" } })).status, 400);
    assert.equal((await s.call("POST", "/api/profile", { token, pfp: PFP })).status, 200);
    assert.deepEqual((await s.call("GET", "/api/profiles")).json.profiles, { [me.publicKey.toBase58()]: PFP });

    s.later(8 * 24 * 3_600_000);
    assert.equal((await s.call("POST", "/api/chat", { token, channel: "global", text: "late" })).status, 401, "a week later");
  } finally {
    await s.close();
  }
});

test("social: chat slows down a fast wallet", async () => {
  const s = await startSocial({ limits: { loginPerIp: [5, 60_000], chatPerWallet: [2, 10_000], chatPerIp: [30, 60_000], profilePerWallet: [5, 60_000] } });
  try {
    const { token } = (await s.login(Keypair.generate())).json;
    const say = () => s.call("POST", "/api/chat", { token, channel: "global", text: "hi" });
    assert.deepEqual([(await say()).status, (await say()).status, (await say()).status], [201, 201, 429]);
    s.later(10_000);
    assert.equal((await say()).status, 201);
  } finally {
    await s.close();
  }
});

test("keeper: records launches, backs off a failing presale, notices opens", async () => {
  const store = new Store(":memory:");
  const creator = Keypair.generate().publicKey;
  const mintKp = Keypair.generate();
  store.addMint({ mint: mintKp, creator, name: "n", symbol: "S", description: "", links: {}, image: "", uri: "u" });
  const presale = presalePda(pid, mintKp.publicKey);
  const broken = presalePda(pid, Keypair.generate().publicKey);
  let brokenTicks = 0;
  const bot = {
    scan: async () => [presale, broken],
    async tick(k) {
      if (k.equals(broken)) {
        brokenTicks++;
        throw new Error("rpc hiccup");
      }
      await this.launch(k, { mint: mintKp.publicKey });
      return { state: "FULL", did: ["launch"] };
    },
    launch: async () => ({ sig: "SIG", released: 5n, cost: 1n, tokens: 9n, units: 100 }),
  };
  const keeper = new Keeper({ bot, store, pid, log: () => {} });
  keeper.running = true;
  await keeper.scan();
  assert.equal(await keeper.pass(), true);
  assert.equal(store.launch(presale).sig, "SIG");
  assert.equal(store.launch(presale).tokens, "9");
  assert.equal(store.token(mintKp.publicKey).presale, presale.toBase58(), "the open was noticed from the scan");
  await keeper.pass();
  assert.equal(brokenTicks, 1, "the failing presale waits before its next try");
  const st = keeper.status().presales.find((p) => p.presale === broken.toBase58());
  assert.deepEqual([st.fails, st.error], [1, "rpc hiccup"]);
});

test("keeper: scans on a timer beside the ticks, ticks what the API hands it, drops finished presales", async () => {
  const store = new Store(":memory:");
  const [a, b] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  const live = [a];
  const done = new Set();
  const ticks = [];
  let scans = 0;
  let scanFails = false;
  let scanGate = null; // a promise the scan waits on (a throttled RPC)
  const bot = {
    async scan() {
      scans++;
      await scanGate;
      if (scanFails) throw new Error("429 Too Many Requests");
      return [...live];
    },
    async tick(k) {
      ticks.push(k.toBase58());
      return done.has(k.toBase58()) ? { state: "CLOSED", did: [], done: true } : { state: "OPEN", did: [] };
    },
    launch: async () => ({}),
  };
  const logs = [];
  const keeper = new Keeper({ bot, store, pid, scanMs: 60_000, pollMs: 60_000, slowMs: 0, log: (m) => logs.push(m) });
  keeper.running = true;
  await keeper.pass();
  assert.deepEqual([scans, ticks.length], [1, 0], "the first pass starts a scan and doesn't wait for it");
  await keeper.scanning;
  await keeper.pass();
  await keeper.pass();
  assert.deepEqual([scans, ticks.length], [1, 2], "one scan, then the known presale is ticked without scanning");
  assert.ok(logs.some((m) => m.includes("slow tick")), "slow ticks are logged");

  keeper.watch(b); // the API confirmed an open the last scan didn't see
  ticks.length = 0;
  await keeper.pass();
  assert.deepEqual([scans, ticks.sort()], [1, [a, b].map(String).sort()]);

  done.add(a.toBase58());
  live.length = 0;
  ticks.length = 0;
  await keeper.pass();
  await keeper.pass();
  assert.deepEqual(ticks, [a.toBase58(), b.toBase58(), b.toBase58()], "a closed presale is ticked once more, then dropped");
  assert.deepEqual(keeper.status().presales.map((p) => p.presale), [b.toBase58()]);

  // a scan stuck on a throttled RPC doesn't hold the ticks; then it fails, and the ticks go on
  keeper.scanMs = 0;
  scanFails = true;
  let release;
  scanGate = new Promise((r) => (release = r));
  ticks.length = 0;
  await keeper.pass();
  await keeper.pass();
  assert.deepEqual([scans, keeper.status().scanning, ticks], [2, true, [b.toBase58(), b.toBase58()]], "one scan in flight, two passes of ticks");
  release();
  await keeper.scanning;
  assert.equal(keeper.status().scanError, "429 Too Many Requests");
  scanGate = null;
  scanFails = false;

  // watch() wakes a sleeping loop: the new presale is ticked long before pollMs
  const c = Keypair.generate().publicKey;
  keeper.scanMs = 60_000;
  keeper.start();
  try {
    for (let i = 0; i < 100 && !keeper.wake; i++) await new Promise((r) => setTimeout(r, 10)); // asleep for pollMs
    assert.ok(keeper.wake, "the loop went to sleep");
    keeper.watch(c);
    for (let i = 0; i < 100 && !ticks.includes(c.toBase58()); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(ticks.includes(c.toBase58()), "watch() woke the keeper");
  } finally {
    await keeper.stop();
  }
});

test("reads: callers share one fetch for a moment, a failed fetch isn't kept", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator] });
  try {
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    const presale = presalePda(pid, mint);
    let gpa = 0;
    const real = s.l1.getProgramAccounts;
    s.l1.getProgramAccounts = (...x) => (gpa++, real(...x));

    const lists = await Promise.all([1, 2, 3].map(() => s.call("GET", "/api/presales")));
    const perList = gpa;
    assert.ok(perList > 0);
    assert.deepEqual(lists.map((l) => l.json.presales.length), [0, 0, 0]);
    s.l1.put(presale, pid, presaleData(mint));
    assert.equal((await s.call("GET", "/api/presales")).json.presales.length, 0, "the list is shared for 3 s");
    assert.equal(gpa, perList, "three callers together, and one right after, made one listing");
    s.later(3_000);
    assert.equal((await s.call("GET", "/api/presales")).json.presales.length, 1);
    const withFaces = gpa - perList; // the listing, plus the open presale's seats for its faces
    assert.ok(withFaces > perList);
    s.later(3_000);
    await s.call("GET", "/api/presales");
    assert.equal(gpa, perList + withFaces + perList, "the seats behind the faces are kept 10 s");

    const otherMint = Keypair.generate().publicKey;
    const other = presalePda(pid, otherMint);
    assert.equal((await s.call("GET", `/api/presale/${other.toBase58()}`)).status, 404);
    s.l1.put(other, pid, presaleData(otherMint));
    assert.equal((await s.call("GET", `/api/presale/${other.toBase58()}`)).status, 200, "the 404 wasn't kept");
  } finally {
    await s.close();
  }
});

test("client: the web app's commit rules match the program's", () => {
  const N = { MIN_SEAT: 100n, MAX_SEAT: 1_000n, STEP: 10n };
  assert.deepEqual([100n, 1_000n, 550n, 90n, 1_010n, 555n].map((a) => C.validSeat(a, N)), [true, true, true, false, false, false]);
  // cutToRoom(amount, current, others, target)
  assert.equal(C.cutToRoom(500n, 0n, 9_000n, 10_000n), 500n, "fits");
  assert.equal(C.cutToRoom(500n, 0n, 9_800n, 10_000n), 200n, "cut to the room left");
  assert.equal(C.cutToRoom(500n, 0n, 10_000n, 10_000n), null, "no room");
  assert.equal(C.cutToRoom(100n, 300n, 10_000n, 10_000n), 100n, "a cut down always goes through");
  const wallet = Keypair.generate().publicKey;
  const a = { wallet, name: "N", symbol: "S", time: 7 };
  assert.equal(
    C.mintMessageText({ ...a, imageHash: crypto.createHash("sha256").update(PNG).digest("hex"), detailsHash: crypto.createHash("sha256").update(JSON.stringify(["d", "", "", ""])).digest("hex") }),
    mintMessage({ ...a, image: PNG, details: ["d", "", "", ""] }),
  );
});

test("web: the app's files, its routes, nothing outside it", async () => {
  const web = fs.mkdtempSync(path.join(os.tmpdir(), "mooner-web-"));
  const s = await startServer({ web });
  try {
    fs.mkdirSync(`${web}/assets`);
    fs.writeFileSync(`${web}/index.html`, "<!doctype html>app");
    fs.writeFileSync(`${web}/assets/app-1.js`, "js");
    fs.mkdirSync(`${web}/sim/assets`, { recursive: true });
    fs.writeFileSync(`${web}/sim/index.html`, "<!doctype html>sim");
    fs.writeFileSync(`${web}/sim/assets/sim-1.js`, "simjs");
    fs.writeFileSync(`${web}/.secret`, "no");
    fs.writeFileSync(`${path.dirname(web)}/outside.txt`, "no");
    const get = async (p) => {
      const r = await fetch(s.base + p);
      return { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), body: await r.text() };
    };
    let r = await get("/");
    assert.deepEqual([r.status, r.body, r.cache, r.type], [200, "<!doctype html>app", "no-cache", "text/html; charset=utf-8"]);
    r = await get("/presale/abc");
    assert.deepEqual([r.status, r.body], [200, "<!doctype html>app"], "an app route gets index.html");
    r = await get("/assets/app-1.js");
    assert.deepEqual([r.status, r.body, r.cache], [200, "js", "public, max-age=31536000, immutable"]);
    assert.equal((await get("/assets/none.js")).status, 404, "a missing file isn't the app");
    for (const p of ["/sim", "/sim/", "/sim/presale/abc"]) assert.equal((await get(p)).body, "<!doctype html>sim", `${p} is the simulation`);
    r = await get("/sim/assets/sim-1.js");
    assert.deepEqual([r.status, r.body, r.cache], [200, "simjs", "public, max-age=31536000, immutable"]);
    assert.equal((await get("/assets")).body, "<!doctype html>app", "a folder without its own index.html is the app");
    assert.equal((await get("/.secret")).status, 404);
    assert.equal((await get("/%2e%2e/outside.txt")).status, 404);
    assert.equal((await get("/..%2foutside.txt")).status, 404);
    assert.equal(webFile(web, "/../outside.txt"), null, "a dot segment is refused");
    assert.equal(webFile(web, "/a/b"), path.join(web, "index.html"));
    assert.equal((await get("/api/nope")).status, 404, "the API stays JSON");
    assert.equal((await s.call("GET", "/api/nope")).json.error, "not found");
    const bh = await s.call("GET", "/api/blockhash");
    assert.deepEqual([bh.status, bh.json.blockhash], [200, BH]);
  } finally {
    await s.close();
    fs.rmSync(web, { recursive: true });
    fs.rmSync(`${path.dirname(web)}/outside.txt`, { force: true });
  }
});

test("config: the deployment record, the openers file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mooner-"));
  try {
    const rec = { programId: pid.toBase58(), dbcConfig: MOONER_DBC_CONFIG.toBase58(), alt: alt.key.toBase58() };
    fs.writeFileSync(`${dir}/deployment.json`, JSON.stringify(rec));
    const cfg = loadConfig({ MOONER_DIR: dir });
    assert.deepEqual([cfg.cluster, cfg.pid.toBase58(), cfg.port, cfg.host], ["mainnet", pid.toBase58(), 8787, "127.0.0.1"]);
    assert.equal(cfg.ers.MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57, "https://as.magicblock.app");
    assert.equal(loadConfig({ MOONER_DIR: dir, MOONER_CLUSTER: "devnet" }).ers.MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57, "https://devnet-as.magicblock.app");
    assert.throws(() => loadConfig({ MOONER_DIR: dir, MOONER_CANARY: "1" }), /devnet only/);
    assert.throws(() => loadConfig({ MOONER_DIR: `${dir}/none` }), /MOONER_PROGRAM/);

    const openers = openersFrom(`${dir}/openers.txt`);
    assert.equal(openers().size, 0, "no file: nobody");
    const a = Keypair.generate().publicKey.toBase58();
    fs.writeFileSync(`${dir}/openers.txt`, `# beta\n${a}  # alice\n\n`);
    assert.deepEqual([...openers()], [a]);
    fs.writeFileSync(`${dir}/openers.txt`, "");
    fs.utimesSync(`${dir}/openers.txt`, new Date(), new Date(Date.now() + 5_000));
    assert.equal(openers().size, 0, "re-read after a change");

    // on a host that configures by variables (Railway): the wallets and the keys themselves
    const b = Keypair.generate().publicKey.toBase58();
    assert.deepEqual([...openersFromList(` ${a}, ${b}\n`)()], [a, b]);
    assert.equal(openersFromList("")().size, 0, "empty: nobody");
    assert.equal(openersFromList(" * ")(), null, "*: any wallet");
    assert.throws(() => openersFromList("not-a-wallet"), /base58/, "a typo stops the server");
    assert.equal(loadConfig({ MOONER_DIR: dir, MOONER_OPENER_WALLETS: a }).openerWallets, a);
    assert.equal(loadConfig({ MOONER_DIR: dir }).openerWallets, null);
    const kp = Keypair.generate();
    fs.writeFileSync(`${dir}/k.json`, JSON.stringify([...kp.secretKey]));
    assert.equal(loadKey(`${dir}/k.json`).publicKey.toBase58(), kp.publicKey.toBase58(), "a key file");
    assert.equal(loadKey(`\n${JSON.stringify([...kp.secretKey])}\n`).publicKey.toBase58(), kp.publicKey.toBase58(), "the key's JSON");
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
