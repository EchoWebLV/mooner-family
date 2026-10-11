#!/usr/bin/env node
// The bubble test: three unlinked wallets fill one real mainnet presale through the server,
// the way the phone does it (engine/src/flows.js), so Bubblemaps can show whether the ER and
// the launch tie seats together. The creator opens with 0.1 SOL, two buyers join with 0.2
// each: 0.5 fills the pool and the server's keeper launches on Meteora by itself.
//
//   node scripts/bubbletest.js                 dry run: wallets, balances, costs; sends nothing
//   node scripts/bubbletest.js --upload-only   gets the coin (IPFS + mint) and prints the CA
//   node scripts/bubbletest.js --confirm       opens, joins both, waits for launch and tokens
//
// Wallets: secret keys in engine/.env, by name (base58 or a JSON byte array). Defaults:
// --creator priv-3-wallet --buyers priv-1-wallet,priv-2-wallet. Session keys and the run
// (mint, presale) are kept in engine/.bubble/ (gitignored), so a stopped run picks up
// where it was: a coin is asked for once, an open or a join that landed is not sent again.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { makeApi } from "../src/apiclient.js";
import { makeFlows, sol } from "../src/flows.js";
import { makeLive } from "../src/live.js";
import { connect } from "../src/tx.js";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ENGINE, ".bubble");
const RUN = path.join(DIR, "run.json");
const KEYS = path.join(DIR, "session-keys.json");
const IMAGE = path.join(DIR, "image.png");
const BASE = "https://app.mooner.family";
const COIN = {
  name: "Loose Bubbles",
  symbol: "LOOSE",
  description: "Three strangers, one pool. No bubbles between them.",
  links: { twitter: "", telegram: "", website: "" },
};
const CREATOR_SOL = "0.1";
const BUYER_SOL = "0.2";

const { values: args } = parseArgs({
  options: {
    confirm: { type: "boolean", default: false },
    "upload-only": { type: "boolean", default: false },
    creator: { type: "string", default: "priv-3-wallet" },
    buyers: { type: "string", default: "priv-1-wallet,priv-2-wallet" },
  },
});
const mode = args.confirm ? "confirm" : args["upload-only"] ? "upload-only" : "dry";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lamports = (s) => BigInt(Math.round(Number(s) * 1e9));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);
const writeJson = (f, v) => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2), { mode: 0o600 });
};

// ---- wallets ----

function readEnv(file) {
  const out = {};
  for (let line of fs.readFileSync(file, "utf8").split("\n")) {
    line = line.trim();
    const m = /^([A-Za-z0-9_.-]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function wallet(env, name) {
  const v = env[name];
  if (!v) throw new Error(`${name} is not in engine/.env`);
  const kp = v.startsWith("[") ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(v))) : Keypair.fromSecretKey(bs58.decode(v));
  const signTransaction = async (tx) => {
    if (tx instanceof Transaction) tx.partialSign(kp);
    else tx.sign([kp]);
    return tx;
  };
  const signMessage = async (bytes) => {
    const { ed25519 } = await import("@noble/curves/ed25519");
    return ed25519.sign(bytes, kp.secretKey.subarray(0, 32));
  };
  return { name, kp, publicKey: kp.publicKey, signTransaction, signMessage };
}

const env = readEnv(path.join(ENGINE, ".env"));
const creator = { ...wallet(env, args.creator), amount: lamports(CREATOR_SOL) };
const buyers = args.buyers.split(",").map((n) => ({ ...wallet(env, n.trim()), amount: lamports(BUYER_SOL) }));
const all = [creator, ...buyers];
if (new Set(all.map((w) => w.publicKey.toBase58())).size !== all.length) throw new Error("the same wallet is named twice");

// ---- the app's own clients, pointed at the live server ----

const api = makeApi(BASE);
const live = makeLive({ url: `${BASE.replace(/^http/, "ws")}/api/ws`, warn: () => {} });
const store = readJson(KEYS, {});
const keys = {
  get: async (k) => store[k] ?? null,
  set: async (k, v) => {
    store[k] = v;
    writeJson(KEYS, store);
  },
};
// Solana reads go through the server's /api/rpc, as the phone's do, unless RPC is set
const rpc = connect(process.env.RPC || `${BASE}/api/rpc`);
const flows = makeFlows({ api, subscribe: live.subscribe, keys, rpc });

async function main() {
  const info = await flows.loadInfo();
  if (info.cluster !== "mainnet") throw new Error(`the server is on ${info.cluster}, not mainnet`);
  const total = all.reduce((s, w) => s + w.amount, 0n);
  console.log(`server ${BASE}: mainnet, pool ${sol(info.N.TARGET)} SOL; this run puts in ${sol(total)} SOL`);
  if (total !== info.N.TARGET) throw new Error(`the seats add up to ${sol(total)} SOL, not the pool's ${sol(info.N.TARGET)}: it wouldn't fill`);

  const [openCost, joinCost] = [(await flows.openCost()).total, (await flows.joinCost()).total];
  let short = false;
  for (const w of all) {
    const need = w.amount + (w === creator ? openCost : joinCost);
    const has = BigInt(await rpc.getBalance(w.publicKey));
    const ok = has >= need;
    short ||= !ok;
    console.log(`  ${w === creator ? "opens" : "joins"} ${sol(w.amount)}  ${w.name.padEnd(14)} ${w.publicKey.toBase58()}  has ${sol(has, 4)}, needs ${sol(need, 4)}  ${ok ? "ok" : "SHORT"}`);
  }
  if (short) throw new Error("a wallet is short: top it up from its own exchange withdrawal, never from another wallet here");
  if (!fs.existsSync(IMAGE)) throw new Error(`no picture at ${IMAGE}`);

  let run = readJson(RUN, null);
  if (run) console.log(`saved coin: ${run.symbol} ${run.mint} (presale ${run.presale})`);
  if (mode === "dry") {
    console.log(`\ndry run: nothing sent. ${run ? "" : "--upload-only gets the coin and its CA; "}--confirm runs it.`);
    return;
  }

  // ---- the coin: asked for once, then reused ----
  if (!run) {
    const image = fs.readFileSync(IMAGE);
    const r = await flows.requestMint({ wallet: creator.publicKey, signMessage: creator.signMessage, ...COIN, image });
    run = { mint: r.mint, presale: r.presale, name: r.name, symbol: r.symbol, image: r.image, uri: r.uri, creator: creator.publicKey.toBase58() };
    writeJson(RUN, run);
    console.log(`coin: ${run.name} ($${run.symbol})\n  CA      ${run.mint}\n  presale ${run.presale}\n  meta    ${run.uri}`);
  }
  if (run.creator !== creator.publicKey.toBase58()) throw new Error(`the saved coin is for ${run.creator}, not ${creator.name}: delete ${RUN} to start over`);
  if (mode === "upload-only") {
    console.log("\nupload only: the coin is saved; --confirm opens the presale with it.");
    return;
  }

  // ---- open ----
  const presale = new PublicKey(run.presale);
  const seatOf = (v, w) => v?.seats?.find((s) => s.user === w.publicKey.toBase58());
  let view = await api.presale(run.presale).catch(() => null);
  if (view && view.where !== "closed") {
    console.log("presale already open");
  } else {
    console.log(`opening with ${sol(creator.amount)} SOL from ${creator.name}…`);
    await flows.openPresale({ info, wallet: creator.publicKey, signTransaction: creator.signTransaction, mint: run.mint, commit: creator.amount });
    console.log("  open");
  }

  // ---- joins ----
  for (const b of buyers) {
    view = await flows.waitFor(presale, (v) => v && v.where !== "closed", { what: "the presale", timeoutMs: 60_000 });
    const mine = seatOf(view, b);
    if (mine && BigInt(mine.commit ?? 0) >= b.amount) {
      console.log(`${b.name} already in with ${sol(BigInt(mine.commit))} SOL`);
      continue;
    }
    console.log(`${b.name} joins with ${sol(b.amount)} SOL…`);
    if (mine) await flows.setCommit({ info, wallet: b.publicKey, signTransaction: b.signTransaction, view, amount: b.amount });
    else await flows.joinPresale({ info, wallet: b.publicKey, signTransaction: b.signTransaction, view, amount: b.amount, onStep: (s) => console.log(`  ${s}`) });
    console.log("  in");
  }

  // ---- launch and token delivery: the keeper's half ----
  console.log("pool full: waiting for the keeper to launch…");
  const until = Date.now() + 15 * 60_000;
  let launched = null;
  while (!launched && Date.now() < until) {
    launched = (await api.launched().catch(() => [])).find((r) => r.mint === run.mint) ?? null;
    if (!launched) await sleep(5_000);
  }
  if (!launched) throw new Error("not launched after 15 minutes: check /api/health and the keeper's log");
  console.log(`launched: pool ${launched.pool?.address ?? "?"}`);

  const mint = new PublicKey(run.mint);
  const held = async (w) => {
    const r = await rpc.getParsedTokenAccountsByOwner(w.publicKey, { mint });
    return r.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
  };
  let got = [];
  while (Date.now() < until) {
    got = await Promise.all(all.map(held));
    if (got.every((x) => x > 0)) break;
    await sleep(5_000);
  }
  all.forEach((w, i) => console.log(`  ${w.name.padEnd(14)} holds ${got[i] ?? 0} ${run.symbol}`));
  console.log(`\nCA ${run.mint}\nsolscan   https://solscan.io/token/${run.mint}\nbubblemaps: search the CA on bubblemaps.io (chain: Solana)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\nstopped: ${e?.message ?? e}${e?.outcomeUnknown ? "\n(it may have landed: run --confirm again, it checks before sending)" : ""}`);
    process.exit(1);
  });
