// A presale's whole life on mainnet with the wallets in engine/.env, through the live
// server the way the web app does it (the src/client.js builders, /api/mint, /api/cosign,
// ledger txs straight to the ER):
//   1. priv-1-wallet asks for a token and opens a presale with MIN_SEAT (0.1 SOL)
//   2. priv-2-wallet joins with MIN_SEAT
//   3. priv-2 puts it in the pool (set_commit in the ER)
//   4. priv-2 takes it out (set_commit 0): the SOL is still in its seat, on Solana
//   5. priv-2 gets it back now: leave (the seat goes home), then settle_seat
//   6. the creator can't take theirs out early (CreatorCannotLower): the keeper refunds
//      it after the deadline. This waits for that unless --no-wait.
// The keys stay on this machine: the server sees signed txs and one signed message.
//
//   node scripts/lifecycle.js             dry run, spends nothing: the wallets, the server,
//                                         the opener check, the open simulated on mainnet
//   node scripts/lifecycle.js --confirm   does it: 0.1 SOL from each wallet, plus fees and rent
//   node scripts/lifecycle.js --check     where the last run's presale and seats are now
//   --presale <key>   use that presale instead of opening one (join it; or pick a run back up)
//   --no-wait         don't wait for the creator's refund
//   --url <server>    https://app.mooner.family by default
// The last run's presale is in engine/.mainnet/lifecycle.json (public keys only).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";
import * as I from "../src/ix.js";
import { DELEGATION_PROGRAM } from "../src/consts.js";
import { PRESALE_LEN, SEAT_LEN, STATE_NAME, decodePresale, decodeSeat } from "../src/layout.js";
import { presalePda, seatPda } from "../src/pdas.js";
import { connect, send, simulate } from "../src/tx.js";
import { joinIxs, openIxs, unsignedTx } from "../src/client.js";
import { mintMessage, signMessage } from "../server/auth.js";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORD = `${ENGINE}/.mainnet/lifecycle.json`;
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const BASE = opt("--url") ?? "https://app.mooner.family";
const PRIORITY = 50_000; // micro-lamports per CU on entry txs, as the web app
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sol = (l) => `${(Number(l) / 1e9).toFixed(9)} SOL`;
const signed = (l) => (l < 0n ? `-${sol(-l)}` : `+${sol(l)}`);
const say = (s) => console.log(s);
const step = (n, s) => say(`\n${n}. ${s}`);

// ---- the wallets ----

process.loadEnvFile(`${ENGINE}/.env`);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function fromBase58(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const out = [];
  for (; n > 0n; n >>= 8n) out.unshift(Number(n & 255n));
  for (const c of s) {
    if (c !== "1") break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}
function wallet(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not in engine/.env`);
  // Keypair checks the secret matches its public half
  return Keypair.fromSecretKey(v.startsWith("[") ? Uint8Array.from(JSON.parse(v)) : fromBase58(v));
}
const opener = wallet("priv-1-wallet");
const joiner = wallet("priv-2-wallet");
const l1 = connect(process.env.MOONER_RPC || "https://api.mainnet-beta.solana.com");

// ---- the server ----

async function call(method, p, body) {
  const r = await fetch(new URL(p, BASE), { method, headers: body ? { "content-type": "application/json" } : {}, body: body && JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(`${method} ${p}: ${r.status} ${json?.error ?? ""}`);
    Object.assign(e, { status: r.status, logs: json?.logs });
    throw e;
  }
  return { status: r.status, json };
}

async function loadInfo() {
  const { json: i } = await call("GET", "/api/info");
  return {
    ...i,
    pid: new PublicKey(i.program),
    gate: new PublicKey(i.gate),
    N: Object.fromEntries(Object.entries(i.numbers).map(([k, v]) => [k, typeof v === "string" ? BigInt(v) : v])),
    ers: i.ers.map((e) => ({ validator: new PublicKey(e.validator), url: e.url, conn: connect(e.url) })),
  };
}

/** The ER that answers fastest from here, as the web app picks one for a new presale. */
async function nearestEr(info) {
  const timed = await Promise.allSettled(info.ers.map(async (e) => {
    const t0 = performance.now();
    await e.conn.getSlot();
    return { e, ms: Math.round(performance.now() - t0) };
  }));
  const ok = timed.filter((r) => r.status === "fulfilled").map((r) => r.value).sort((a, b) => a.ms - b.ms);
  if (!ok.length) throw new Error("no MagicBlock ER answered");
  return ok[0];
}

/** Signs an entry tx and hands it to the server, which checks it, co-signs, simulates and
 *  sends it (a tx that would fail is refused before it costs anything). */
async function cosignSend(kp, ixs) {
  const { json: bh } = await call("GET", "/api/blockhash");
  const tx = unsignedTx({ ixs: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), ...ixs], payer: kp.publicKey, blockhash: bh.blockhash });
  tx.sign([kp]);
  return (await call("POST", "/api/cosign", { tx: Buffer.from(tx.serialize()).toString("base64") })).json;
}

/** A small moon, as a PNG. */
function png(size = 256) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const moon = (x - c) ** 2 + (y - c) ** 2 < (size * 0.32) ** 2;
      raw.set(moon ? [245, 228, 150] : [12, 12, 24], y * row + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const b = Buffer.alloc(8 + td.length);
    b.writeUInt32BE(data.length, 0);
    td.copy(b, 4);
    b.writeUInt32BE(zlib.crc32(td), 4 + td.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** POST /api/mint as the web app's requestMint: the wallet signs the details. */
async function requestMint(kp) {
  const image = png();
  const t = { name: "Mooner Test", symbol: "MTEST", description: "A lifecycle test of Mooner: open, join, take it back." };
  const time = Math.floor(Date.now() / 1000);
  const text = mintMessage({ wallet: kp.publicKey, ...t, image, details: [t.description, "", "", ""], time });
  const signature = signMessage(kp, text).toString("base64");
  return (await call("POST", "/api/mint", { wallet: kp.publicKey.toBase58(), ...t, links: {}, image: image.toString("base64"), time, signature })).json;
}

// ---- the chain ----

/** Where a seat is: "none", "er" (delegated) or "home". */
async function seatWhere(pid, seat) {
  const a = await l1.getAccountInfo(seat);
  if (!a) return "none";
  return a.owner.equals(DELEGATION_PROGRAM) ? "er" : a.owner.equals(pid) ? "home" : `owned by ${a.owner.toBase58()}`;
}

async function erSeat(er, pid, seat) {
  const a = await er.getAccountInfo(seat);
  return a?.owner.equals(pid) && a.data.length === SEAT_LEN ? decodeSeat(a.data) : null;
}

/** The presale as users see it: the ER copy while it's delegated. */
async function readPresale(info, presale) {
  const a = await l1.getAccountInfo(presale);
  if (!a) return null;
  const snap = decodePresale(a.data);
  if (!a.owner.equals(DELEGATION_PROGRAM)) return { where: "home", p: snap };
  const er = info.ers.find((e) => e.validator.equals(snap.validator));
  const e = er && (await er.conn.getAccountInfo(presale));
  return e?.data.length === PRESALE_LEN ? { where: "er", p: decodePresale(e.data), er } : { where: "er (no ER copy read)", p: snap, er };
}

/** Resolves once `ok(account or null)` holds, heard over the RPC's websocket; reads once at
 *  the start and once more at the timeout. */
function until(conn, key, ok, { timeoutMs, what }) {
  return new Promise((resolve, reject) => {
    let over = false;
    const finish = (err, v) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      conn.removeAccountChangeListener(sub).catch(() => {});
      if (err) reject(err);
      else resolve(v);
    };
    const sub = conn.onAccountChange(key, (a) => {
      const v = a.lamports === 0 ? null : a;
      if (ok(v)) finish(null, v);
    }, { commitment: "confirmed" });
    const timer = setTimeout(async () => {
      const a = await conn.getAccountInfo(key).catch(() => undefined);
      if (a !== undefined && ok(a)) finish(null, a);
      else finish(new Error(`${what}: not there after ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    conn.getAccountInfo(key).then((a) => ok(a) && finish(null, a), () => {});
  });
}

/** set_commit in the ER, retried while a seat delegated moments ago isn't there yet. */
async function setCommit(er, pid, signer, seat, presale, amount) {
  for (let i = 0; ; i++) {
    try {
      return await send(er, { ixs: [I.setCommit(pid, { signer: signer.publicKey, seat, presale, amount })], payer: signer, legacy: true, pid, what: "set_commit", timeoutMs: 30_000 });
    } catch (e) {
      if (i >= 8 || /NotAuthorized|BadState|PastDeadline|OverDeposit|NoRoom|CreatorCannotLower|BadSeatSize/.test(e.message)) throw e;
      await sleep(1_500);
    }
  }
}

async function balances() {
  const [a, b] = await Promise.all([l1.getBalance(opener.publicKey), l1.getBalance(joiner.publicKey)]);
  return { opener: BigInt(a), joiner: BigInt(b) };
}

const readRecord = () => (fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, "utf8")) : null);
const at = (ts) => `${new Date(ts * 1000).toLocaleTimeString()} (${new Date(ts * 1000).toISOString().slice(11, 19)} UTC)`;

// ---- dry run ----

async function dryRun(info) {
  const b = await balances();
  step(1, "wallets (engine/.env)");
  say(`   opener priv-1 ${opener.publicKey.toBase58()}  ${sol(b.opener)}`);
  say(`   joiner priv-2 ${joiner.publicKey.toBase58()}  ${sol(b.joiner)}`);

  step(2, `server ${BASE}`);
  const { json: h } = await call("GET", "/api/health");
  say(`   ${h.ok ? "ok" : "NOT ok"}, ${h.cluster}; keeper ${h.keeper?.running ? "running" : "NOT running"}, bot ${sol(h.botLamports)}`);
  say(`   seat ${sol(info.N.MIN_SEAT)} to ${sol(info.N.MAX_SEAT)}, pool ${sol(info.N.TARGET)}, ${info.N.DURATION} s to fill`);

  step(3, "may priv-1 open? (a token request with no details: refused either way, nothing is stored)");
  const probe = await call("POST", "/api/mint", { wallet: opener.publicKey.toBase58() }).catch((e) => e);
  if (probe.status === 403) throw new Error(`the server says priv-1 can't open: ${probe.message}`);
  say(probe.status === 400 ? "   yes (it got past the openers check)" : `   unexpected answer: ${probe.message ?? probe.status}`);

  step(4, "nearest ER");
  const { e: er, ms } = await nearestEr(info);
  say(`   ${er.url} (${ms} ms)`);

  step(5, "the open tx, simulated on mainnet (a throwaway mint key; the real one comes from the server)");
  const mint = Keypair.generate().publicKey;
  const ixs = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }),
    ...openIxs(info.pid, { creator: opener.publicKey, gate: info.gate, mint, feeDest: opener.publicKey, sessionKey: Keypair.generate().publicKey, deposit: info.N.MIN_SEAT, commit: info.N.MIN_SEAT, validator: er.validator }),
  ];
  const sim = await simulate(l1, { ixs, payer: opener.publicKey, accounts: [opener.publicKey], pid: info.pid });
  if (sim.err) {
    say(sim.logs.slice(-12).map((l) => `   | ${l}`).join("\n"));
    throw new Error(`the open would fail: ${sim.errText}`);
  }
  const after = sim.accounts[0]?.lamports;
  say(`   ok, ${sim.units} CU${after != null ? `; priv-1's balance in the simulation: ${signed(BigInt(after) - b.opener)}` : ""}`);

  step(6, "the RPC's websocket (the script waits on it)");
  const heard = await new Promise((r) => {
    const t = setTimeout(() => r(false), 10_000);
    const id = l1.onSlotChange(() => {
      clearTimeout(t);
      l1.removeSlotChangeListener(id).catch(() => {});
      r(true);
    });
  });
  say(heard ? "   ok" : "   heard nothing in 10 s: waits fall back to one read at their timeout");

  say(`\nNothing was spent. --confirm opens with ${sol(info.N.MIN_SEAT)} from priv-1, joins with ${sol(info.N.MIN_SEAT)} from priv-2,`);
  say("commits it, takes it out and gets it back to priv-2's wallet, then waits for the keeper to refund priv-1.");
}

// ---- the real thing ----

async function confirm(info) {
  const pid = info.pid;
  const SEAT = info.N.MIN_SEAT;
  const start = await balances();
  say(`priv-1 ${opener.publicKey.toBase58()}  ${sol(start.opener)}`);
  say(`priv-2 ${joiner.publicKey.toBase58()}  ${sol(start.joiner)}`);

  let presale;
  let mine = true; // priv-1 opened it
  if (opt("--presale")) {
    presale = new PublicKey(opt("--presale"));
    step(1, `presale ${presale.toBase58()} (given)`);
  } else {
    step(1, `priv-1 asks for a token and opens a presale with ${sol(SEAT)}`);
    const m = await requestMint(opener);
    const mint = new PublicKey(m.mint);
    presale = presalePda(pid, mint);
    say(`   token ${mint.toBase58()} (${m.uri})`);
    const { e: er } = await nearestEr(info);
    const ixs = openIxs(pid, { creator: opener.publicKey, gate: info.gate, mint, feeDest: opener.publicKey, sessionKey: Keypair.generate().publicKey, deposit: SEAT, commit: SEAT, validator: er.validator });
    const r = await cosignSend(opener, ixs);
    say(`   open ${r.confirmed ? "confirmed" : "sent"}: ${r.sig}`);
    if (!r.confirmed) await until(l1, presale, (a) => !!a, { timeoutMs: 90_000, what: "the presale" });
    fs.writeFileSync(RECORD, JSON.stringify({ presale: presale.toBase58(), mint: mint.toBase58(), opener: opener.publicKey.toBase58(), joiner: joiner.publicKey.toBase58(), at: new Date().toISOString() }, null, 2));
  }
  const first = await readPresale(info, presale);
  if (!first) throw new Error(`no presale at ${presale.toBase58()}`);
  mine = first.p.creator.equals(opener.publicKey);
  const er = first.er?.conn;
  if (!er) throw new Error(`the server has no endpoint for this presale's ER (${first.p.validator.toBase58()})`);
  say(`   ${BASE}/presale/${presale.toBase58()}`);
  say(`   ${STATE_NAME[first.p.state]} in the ER, deadline ${at(first.p.deadlineTs)}`);

  const seat = seatPda(pid, presale, joiner.publicKey);
  let where = await seatWhere(pid, seat);
  let key = joiner; // the ledger signer: the session key made at join, or the wallet (the program takes either)
  if (where === "none") {
    step(2, `priv-2 joins with ${sol(SEAT)}`);
    const sk = Keypair.generate();
    const r = await cosignSend(joiner, joinIxs(pid, { user: joiner.publicKey, gate: info.gate, presale, sessionKey: sk.publicKey, deposit: SEAT, validator: first.p.validator }));
    say(`   join ${r.confirmed ? "confirmed" : "sent"}: ${r.sig}`);
    if (!r.confirmed) await until(l1, seat, (a) => !!a, { timeoutMs: 90_000, what: "priv-2's seat" });
    key = sk;
    where = "er";
    say(`   the ${sol(SEAT)} is in priv-2's seat on Solana: ${seat.toBase58()} (${sol((await l1.getAccountInfo(seat)).lamports)} in it)`);
  } else {
    step(2, `priv-2 already has a seat here (${where})`);
  }

  if (where === "er") {
    step(3, `priv-2 puts ${sol(SEAT)} in the pool (set_commit in the ER, free)`);
    await setCommit(er, pid, key, seat, presale, SEAT);
    let s = await erSeat(er, pid, seat);
    let p = (await readPresale(info, presale)).p;
    say(`   priv-2's commit ${sol(s.commit)}, the pool ${sol(p.raised)}`);

    step(4, "priv-2 takes it out (set_commit 0 in the ER)");
    await setCommit(er, pid, key, seat, presale, 0n);
    s = await erSeat(er, pid, seat);
    p = (await readPresale(info, presale)).p;
    say(`   priv-2's commit ${sol(s.commit)}, the pool ${sol(p.raised)}; the deposit is still in the seat: ${sol((await l1.getAccountInfo(seat)).lamports)}`);

    step(5, "priv-2 gets it back now: leave (the seat goes home, free), then settle_seat");
    const sig = await send(er, { ixs: [I.leave(pid, { payer: joiner.publicKey, seat })], payer: joiner, legacy: true, pid, what: "leave", timeoutMs: 30_000 });
    say(`   leave: ${sig}`);
    await until(l1, seat, (a) => !a || a.owner.equals(pid), { timeoutMs: 120_000, what: "priv-2's seat back on Solana" });
    where = await seatWhere(pid, seat);
    say(`   the seat is ${where === "home" ? "home on Solana" : where}`);
  } else if (where === "home") {
    step(5, "priv-2's seat is home: settle_seat");
  }
  if (where === "home") {
    const sig = await send(l1, { ixs: [I.settleSeat(pid, { cranker: joiner.publicKey, seat, user: joiner.publicKey, presale })], payer: joiner, pid, what: "settle_seat" });
    say(`   settle_seat: ${sig}`);
  }
  if (await l1.getAccountInfo(seat)) throw new Error(`priv-2's seat is still there (${await seatWhere(pid, seat)})`);
  const mid = await balances();
  say(`   the seat is closed; priv-2 ${sol(mid.joiner)} (${signed(mid.joiner - start.joiner)} since the start: fees and rent)`);

  if (!mine || has("--no-wait")) return done(start, presale);
  step(6, `priv-1's ${sol(SEAT)} can't come out early: the keeper refunds it after the deadline, ${at(first.p.deadlineTs)}`);
  say("   waiting (Ctrl-C is safe: the keeper refunds it anyway; --check shows it later)");
  const cseat = seatPda(pid, presale, opener.publicKey);
  const waitMs = Math.max(0, first.p.deadlineTs * 1000 - Date.now()) + 30 * 60_000;
  await until(l1, cseat, (a) => !a, { timeoutMs: waitMs, what: "the keeper's refund of priv-1" });
  say("   priv-1's seat is closed: refunded");
  return done(start, presale);
}

async function done(start, presale) {
  const end = await balances();
  say(`\npriv-1 ${sol(end.opener)} (${signed(end.opener - start.opener)})`);
  say(`priv-2 ${sol(end.joiner)} (${signed(end.joiner - start.joiner)})`);
  say(`${BASE}/presale/${presale.toBase58()}`);
}

// ---- --check ----

async function check(info) {
  const rec = readRecord();
  const presale = opt("--presale") ? new PublicKey(opt("--presale")) : rec && new PublicKey(rec.presale);
  if (!presale) throw new Error("no run yet (engine/.mainnet/lifecycle.json): pass --presale <key>");
  say(`presale ${presale.toBase58()}  ${BASE}/presale/${presale.toBase58()}`);
  const r = await readPresale(info, presale);
  if (!r) say("   closed (no account on Solana)");
  else say(`   ${STATE_NAME[r.p.state]}, ${r.where}; pool ${sol(r.p.raised)}; deadline ${at(r.p.deadlineTs)}; seats refunded ${r.p.seatsRefunded} of ${r.p.seatsCommitted} committed`);
  for (const [name, kp] of [["priv-1", opener], ["priv-2", joiner]]) {
    const seat = seatPda(info.pid, presale, kp.publicKey);
    const where = await seatWhere(info.pid, seat);
    const s = where === "er" && r?.er ? await erSeat(r.er.conn, info.pid, seat) : where === "home" ? decodeSeat((await l1.getAccountInfo(seat)).data) : null;
    say(`   ${name} seat: ${where === "none" ? "none (never joined, or refunded and closed)" : where}${s ? `, deposit ${sol(s.deposit)}, commit ${sol(s.commit)}` : ""}`);
  }
  const { json: h } = await call("GET", "/api/health");
  const k = h.keeper?.presales?.find((x) => x.presale === presale.toBase58());
  say(`   keeper: ${k ? JSON.stringify(k) : "not ticking it"}`);
  const b = await balances();
  say(`priv-1 ${sol(b.opener)}  priv-2 ${sol(b.joiner)}`);
}

// ---- main ----

const info = await loadInfo();
if (info.cluster !== "mainnet") say(`note: ${BASE} runs ${info.cluster}`);
try {
  if (has("--check")) await check(info);
  else if (has("--confirm")) await confirm(info);
  else await dryRun(info);
  process.exit(0);
} catch (e) {
  console.error(`\nstopped: ${e.message}`);
  if (e.logs?.length) console.error(e.logs.slice(-15).map((l) => `  | ${l}`).join("\n"));
  const rec = readRecord();
  if (has("--confirm") && rec) console.error(`\npick it back up: node scripts/lifecycle.js --confirm --presale ${opt("--presale") ?? rec.presale}`);
  process.exit(1);
}
