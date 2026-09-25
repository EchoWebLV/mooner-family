#!/usr/bin/env node
// The Mooner server: the gate co-signer, the mint issuer and the keeper, in one process.
//   node server/main.js           start (settings: server/config.js)
//   node server/main.js --check   check everything it needs, then exit
// Before it serves anything it checks the chain: the program, the Config's gate, bot and
// DBC config against the key files, the launch lookup table, each ER's identity and Pinata.

import fs from "node:fs";
import { parseArgs } from "node:util";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { decodeConfig } from "../src/layout.js";
import { configPda } from "../src/pdas.js";
import { connect } from "../src/tx.js";
import { Bot, launchAltKeys } from "../src/bot.js";
import { loadConfig, loadEnv, loadKey, openersFrom } from "./config.js";
import { Store } from "./store.js";
import { NoPin, Pinata } from "./pinata.js";
import { Keeper } from "./keeper.js";
import { makeRoutes } from "./api.js";
import { createServer } from "./http.js";

const { values: args } = parseArgs({ options: { check: { type: "boolean", default: false } } });
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`${stamp()} ${m}`);
const sol = (l) => (Number(l) / LAMPORTS_PER_SOL).toFixed(4);

async function erIdentity(url) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }),
    signal: AbortSignal.timeout(10_000),
  });
  return (await r.json()).result?.identity;
}

/** Everything the server needs, checked against the chain. Throws on a mismatch. */
async function prepare(cfg) {
  const gate = loadKey(cfg.gateKeyFile);
  const botKey = loadKey(cfg.botKeyFile);
  const l1 = connect(cfg.rpc);
  log(`${cfg.cluster}${cfg.canary ? " (canary numbers)" : ""}, RPC ${new URL(cfg.rpc).host}`);

  const prog = await l1.getAccountInfo(cfg.pid);
  if (!prog?.executable) throw new Error(`program ${cfg.pid.toBase58()} is not deployed on ${cfg.cluster}`);
  const acc = await l1.getAccountInfo(configPda(cfg.pid));
  if (!acc) throw new Error("the program's Config is missing (init_config)");
  const c = decodeConfig(acc.data);
  const mismatch = [
    ["gate", c.gate, gate.publicKey],
    ["bot", c.bot, botKey.publicKey],
    ["dbcConfig", c.dbcConfig, cfg.dbcConfig],
  ].filter(([, onChain, ours]) => !onChain.equals(ours));
  for (const [k, onChain, ours] of mismatch) log(`Config.${k} is ${onChain.toBase58()}, ours is ${ours.toBase58()}`);
  if (mismatch.length) throw new Error("the key files don't match the on-chain Config");
  log(`program ${cfg.pid.toBase58()}, gate ${gate.publicKey.toBase58()}, bot ${botKey.publicKey.toBase58()}`);

  const alt = (await l1.getAddressLookupTable(cfg.alt)).value;
  const need = launchAltKeys(cfg.pid, cfg.dbcConfig);
  if (!alt || !need.every((k) => alt.state.addresses.some((a) => a.equals(k)))) throw new Error(`lookup table ${cfg.alt.toBase58()} is missing launch keys`);

  const ers = {};
  for (const [validator, url] of Object.entries(cfg.ers)) {
    const id = await erIdentity(url).catch((e) => `unreachable (${e.message})`);
    if (id === validator) ers[validator] = connect(url);
    else if (id?.startsWith("unreachable")) log(`ER ${url}: ${id}; no presales go to this validator until a restart`);
    else throw new Error(`ER ${url} says it is ${id}, expected ${validator}`);
  }
  if (!Object.keys(ers).length) throw new Error("no ER endpoint answered");
  log(`ERs: ${Object.values(ers).map((e) => new URL(e.rpcEndpoint).host).join(", ")}`);

  let pinner;
  if (cfg.pinataJwt) {
    pinner = new Pinata({ jwt: cfg.pinataJwt, gateway: cfg.gateway });
    await pinner.test();
    log(`Pinata ok, links via ${cfg.gateway}`);
  } else if (cfg.cluster === "devnet") {
    pinner = new NoPin();
    log("no PINATA_JWT: devnet tokens get a placeholder link");
  } else throw new Error("set PINATA_JWT in engine/.env (token images and metadata go to IPFS)");

  const openers = openersFrom(cfg.openersFile);
  log(`${openers().size} wallet(s) may open (${cfg.openersFile})${openers().size ? "" : ": nobody can open a presale yet"}`);
  const botLamports = await l1.getBalance(botKey.publicKey);
  log(`bot balance ${sol(botLamports)} SOL`);

  const store = new Store(cfg.dbFile);
  const bot = new Bot({
    pid: cfg.pid, l1, ers, bot: botKey, dbcConfig: cfg.dbcConfig, canary: cfg.canary, alts: [alt],
    mintSigner: (m, creator) => store.mintKey(m, creator),
    tokenMeta: async (m) => {
      const meta = store.meta(m);
      if (!meta) throw new Error(`no metadata for ${m.toBase58()}`);
      return meta;
    },
    priorityMicroLamports: cfg.priority,
    log: (m) => log(`bot ${m}`),
  });
  const presales = await bot.scan();
  log(`${presales.length} live presale(s)`);
  return { l1, gate, bot, alt, store, pinner, openers };
}

loadEnv(process.env.MOONER_ENV); // another env file, or one that doesn't exist for none
const cfg = loadConfig();
fs.mkdirSync(cfg.dir, { recursive: true, mode: 0o700 });
let ctx;
try {
  ctx = await prepare(cfg);
} catch (e) {
  log(`not starting: ${e.message}`);
  process.exit(1);
}
if (args.check) {
  ctx.store.close();
  log("check passed");
  process.exit(0);
}

const keeper = new Keeper({ bot: ctx.bot, store: ctx.store, pid: cfg.pid, pollMs: cfg.pollMs, scanMs: cfg.scanMs, log: (m) => log(`keeper ${m}`) }).start();
const routes = makeRoutes({
  pid: cfg.pid, l1: ctx.l1, bot: ctx.bot, gateKey: ctx.gate, alt: ctx.alt, dbcConfig: cfg.dbcConfig, store: ctx.store,
  pinner: ctx.pinner, openers: ctx.openers, cluster: cfg.cluster, canary: cfg.canary, keeper,
});
const server = createServer(routes, { cors: cfg.cors, trustProxy: cfg.trustProxy, log });
server.listen(cfg.port, cfg.host, () => log(`listening on http://${cfg.host}:${server.address().port}`));

let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log(`${sig}: stopping`);
  server.close();
  await keeper.stop();
  ctx.store.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
