#!/usr/bin/env node
// The Mooner server: the gate co-signer, the mint issuer and the keeper, in one process.
//   node server/main.js           start (settings: server/config.js)
//   node server/main.js --check   check everything it needs, then exit
// Before it serves anything it checks the chain: the program, the Config's gate, bot and
// DBC config against the key files, the launch lookup table, each ER's identity and Pinata.

import fs from "node:fs";
import { parseArgs } from "node:util";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { decodeConfig } from "../src/layout.js";
import { configPda } from "../src/pdas.js";
import { connect } from "../src/tx.js";
import { Bot, launchAltKeys } from "../src/bot.js";
import { BOARD_TOP } from "../src/xp.js";
import { loadConfig, loadEnv, loadKey, openersFrom, openersFromList } from "./config.js";
import { Store } from "./store.js";
import { NoPin, Pinata } from "./pinata.js";
import { Keeper } from "./keeper.js";
import { makeReads, makeRoutes } from "./api.js";
import { makeSessions, makeSocialRoutes } from "./social.js";
import { Referrals } from "./referrals.js";
import { XpLedger } from "./xp.js";
import { XpRules, holds, keeperHooks, openSeats, readLaunch } from "./xprules.js";
import { makeXpRoutes } from "./xproutes.js";
import { appLinksLog, makeAppLinkRoutes } from "./applinks.js";
import { makeRpcRoutes } from "./rpcproxy.js";
import { createServer } from "./http.js";
import { Hub } from "./hub.js";
import { Feed } from "./feed.js";

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

  const openers = cfg.openerWallets === null ? openersFrom(cfg.openersFile) : openersFromList(cfg.openerWallets);
  const who = openers() === null ? "any wallet" : `${openers().size} wallet(s)`;
  log(`${who} may open (${cfg.openerWallets === null ? cfg.openersFile : "MOONER_OPENER_WALLETS"})${openers()?.size === 0 ? ": nobody can open a presale yet" : ""}`);
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
for (const line of appLinksLog(cfg)) log(line); // before the checks, so --check shows it too
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

// a migrated coin's price and DAMM v2 pool come from the feed, which watches that pool
const reads = makeReads({ pid: cfg.pid, l1: ctx.l1, bot: ctx.bot, store: ctx.store, dbcConfig: cfg.dbcConfig, damm: (mint) => feed.dammOf(mint) });
// XP (xp.js, xprules.js): the ledger in the server's db, the board on `profiles`
const ledger = new XpLedger(ctx.store.db);
const feed = new Feed({
  reads, l1: ctx.l1, ers: ctx.bot.ers, pid: cfg.pid, dbcConfig: cfg.dbcConfig, store: ctx.store, db: ctx.store.db,
  xpBoard: () => ledger.board(BOARD_TOP, Date.now()), log: (m) => log(`live ${m}`),
});
const xpPush = (wallets) => feed.xpChanged(ledger.rows(wallets, Date.now()));
const rules = new XpRules({
  ledger, referrals: new Referrals(ctx.store.db),
  readLaunch: (presale) => readLaunch(ctx.bot, ctx.l1, presale),
  openSeats: (presale) => openSeats(ctx.bot, presale),
  holds: (wallet, mint) => holds(ctx.l1, wallet, mint),
  launches: () => ctx.store.launches(100_000), isMigrated: (mint) => feed.isMigrated(mint),
  onChange: xpPush, log: (m) => log(`xp ${m}`),
});
feed.on("migrated", (row) => rules.migrated(row.presale).catch((e) => log(`xp: migrated ${row.presale}: ${e?.message ?? e}`)));
// the rules are there before the keeper's first tick: a launch it claims at start is counted
// from the seats it read first (onSeats), not left to the catch-up's read below
const keeper = new Keeper({
  bot: ctx.bot, store: ctx.store, pid: cfg.pid, pollMs: cfg.pollMs, scanMs: cfg.scanMs, log: (m) => log(`keeper ${m}`),
  onScan: (keys) => feed.scanned(keys), ...keeperHooks({ feed, rules, log }),
}).start();
const routes = makeRoutes({
  pid: cfg.pid, l1: ctx.l1, bot: ctx.bot, gateKey: ctx.gate, alt: ctx.alt, dbcConfig: cfg.dbcConfig, store: ctx.store,
  pinner: ctx.pinner, openers: ctx.openers, cluster: cfg.cluster, canary: cfg.canary, keeper, feed, xp: rules, reads,
}).concat(makeSocialRoutes({
  store: ctx.store, isPresale: (key) => !!ctx.store.tokenOfPresale(new PublicKey(key)),
  onChat: (row) => feed.chat(row), onProfile: (wallet, pfp) => feed.profile(wallet, pfp),
})).concat(makeAppLinkRoutes({ certs: cfg.androidCerts })).concat(makeXpRoutes({
  ledger, l1: ctx.l1, walletOf: makeSessions(ctx.store.db).walletOf, onXp: xpPush,
})).concat(makeRpcRoutes({ url: cfg.appRpc, log }));
if (cfg.appRpc !== cfg.rpc) log(`the apps' RPC (/api/rpc): ${new URL(cfg.appRpc).host}`);
const web = fs.existsSync(`${cfg.web}/index.html`) ? cfg.web : null;
log(web ? `web app from ${web}` : `no web app at ${cfg.web} (npm run build in web/): API only`);
const server = createServer(routes, { cors: cfg.cors, trustProxy: cfg.trustProxy, log, web });
const hub = new Hub(server, {
  trustProxy: cfg.trustProxy, log,
  onFirst: (t) => feed.first(t), onLast: (t) => feed.last(t), onSub: (t, send) => feed.snapshot(t, send),
});
await feed.start(hub);
// what launched or migrated while the server was down (the feed has read its pools)
rules.catchUp().catch((e) => log(`xp: catch-up: ${e?.message ?? e}`));
log("live updates on /api/ws");
server.listen(cfg.port, cfg.host, () => log(`listening on http://${cfg.host}:${server.address().port}`));

let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log(`${sig}: stopping`);
  hub.close();
  server.close();
  await keeper.stop();
  await feed.stop();
  ctx.store.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
