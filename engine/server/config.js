// Server settings. engine/.env (or the file MOONER_ENV names) is read first; variables
// already set in the environment win. Mainnet by default, with the deployment record and keys in engine/.mainnet (from
// scripts/mainnet.js). MOONER_CLUSTER=devnet runs against a devnet deployment, e.g. the
// canary's (scripts/canary.js --server sets every variable itself).
//
//   MOONER_CLUSTER       mainnet | devnet                     (mainnet)
//   MOONER_RPC           Solana RPC                           (the cluster's public RPC)
//   MOONER_DIR           keys, record, database, openers list (engine/.mainnet)
//   MOONER_PROGRAM, MOONER_DBC_CONFIG, MOONER_ALT            (from <dir>/deployment.json)
//   MOONER_GATE_KEY, MOONER_BOT_KEY                          (<dir>/gate-keypair.json, bot-)
//                        a keypair file, or the file's JSON itself (a host's secret variable)
//   MOONER_DB            SQLite file                          (<dir>/server.db)
//   MOONER_OPENERS       wallets that may open, one per line  (<dir>/openers.txt)
//   MOONER_OPENER_WALLETS the same wallets in a variable, comma or space separated (instead of the file);
//                        * = any wallet may open
//   MOONER_CANARY        1 = the canary build's numbers (devnet only)
//   MOONER_HOST, MOONER_PORT                                  (127.0.0.1, 8787)
//   MOONER_CORS          Access-Control-Allow-Origin          (*)
//   MOONER_WEB           the built web app, served at /         (<repo>/web/dist)
//   MOONER_TRUST_PROXY   1 = take the client IP from X-Forwarded-For (behind a proxy)
//   MOONER_PRIORITY      launch priority price, micro-lamports (100000, capped by the bot)
//   MOONER_POLL_MS       keeper pause when there's nothing to do (3000)
//   MOONER_SCAN_MS       time between the keeper's full scans   (10000)
//   PINATA_JWT           Pinata API key; required on mainnet
//   MOONER_IPFS_GATEWAY  prefix of the token links            (IPFS_GATEWAY)
//   MOONER_ANDROID_CERTS SHA-256 fingerprints of the Android app's signing keys, comma or space
//                        separated, for /.well-known/assetlinks.json (none: no such file)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey } from "@solana/web3.js";

export const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The Pinata account's dedicated gateway: it serves only what that account pinned, so it
// goes with PINATA_JWT. ipfs.io stopped serving HTTP on 2026-09-21 (429/403 for every CID),
// and a token's metadata link can't be changed after launch.
export const IPFS_GATEWAY = "https://blush-lazy-haddock-40.mypinata.cloud/ipfs/";

const RPC = { mainnet: "https://api.mainnet-beta.solana.com", devnet: "https://api.devnet.solana.com" };
// the three validators MagicBlock runs (ER_VALIDATORS); the same keys on both clusters
const ER = {
  mainnet: {
    MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57: "https://as.magicblock.app",
    MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e: "https://eu.magicblock.app",
    MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd: "https://us.magicblock.app",
  },
  devnet: {
    MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57: "https://devnet-as.magicblock.app",
    MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e: "https://devnet-eu.magicblock.app",
    MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd: "https://devnet-us.magicblock.app",
  },
};

/** A keypair from its file, or from the file's JSON (a secret-key array) given directly. */
export const loadKey = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(f.trim().startsWith("[") ? f : fs.readFileSync(f, "utf8"))));

export function loadEnv(file = `${ENGINE}/.env`) {
  try {
    process.loadEnvFile(file);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

export function loadConfig(env = process.env) {
  const cluster = env.MOONER_CLUSTER ?? "mainnet";
  if (!RPC[cluster]) throw new Error("MOONER_CLUSTER must be mainnet or devnet");
  const dir = path.resolve(ENGINE, env.MOONER_DIR ?? ".mainnet");
  const recFile = `${dir}/deployment.json`;
  const rec = fs.existsSync(recFile) ? JSON.parse(fs.readFileSync(recFile, "utf8")) : {};
  const key = (name, field) => {
    const v = env[name] ?? rec[field];
    if (!v) throw new Error(`set ${name} (or "${field}" in ${recFile})`);
    return new PublicKey(v);
  };
  const canary = env.MOONER_CANARY === "1";
  if (canary && cluster === "mainnet") throw new Error("MOONER_CANARY is for devnet only");
  return {
    cluster,
    canary,
    dir,
    rpc: env.MOONER_RPC || RPC[cluster],
    ers: ER[cluster],
    pid: key("MOONER_PROGRAM", "programId"),
    dbcConfig: key("MOONER_DBC_CONFIG", "dbcConfig"),
    alt: key("MOONER_ALT", "alt"),
    gateKeyFile: env.MOONER_GATE_KEY ?? `${dir}/gate-keypair.json`,
    botKeyFile: env.MOONER_BOT_KEY ?? `${dir}/bot-keypair.json`,
    dbFile: env.MOONER_DB ?? `${dir}/server.db`,
    openersFile: env.MOONER_OPENERS ?? `${dir}/openers.txt`,
    openerWallets: env.MOONER_OPENER_WALLETS ?? null,
    host: env.MOONER_HOST ?? "127.0.0.1",
    port: Number(env.MOONER_PORT ?? 8787),
    cors: env.MOONER_CORS ?? "*",
    web: path.resolve(env.MOONER_WEB ?? `${ENGINE}/../web/dist`),
    trustProxy: env.MOONER_TRUST_PROXY === "1",
    priority: Number(env.MOONER_PRIORITY ?? 100_000),
    pollMs: Number(env.MOONER_POLL_MS ?? 3_000),
    scanMs: Number(env.MOONER_SCAN_MS ?? 10_000),
    pinataJwt: env.PINATA_JWT || null,
    gateway: env.MOONER_IPFS_GATEWAY ?? IPFS_GATEWAY,
    ...androidCertsFrom(env.MOONER_ANDROID_CERTS ?? ""),
  };
}

const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
// The debug key in Expo's project template: public (it ships in every new project), so any app
// signed with it could claim app.mooner.family links. Never listed.
const EXPO_DEBUG_KEY = "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C";

/** The App Links signing keys from a list of SHA-256 fingerprints ("AB:CD:…", 32 bytes),
 *  comma or space separated: { androidCerts, androidCertsBad }. A word that isn't one, or
 *  is Expo's public debug key, is left out and listed in androidCertsBad for main.js to log:
 *  a typo there costs links that open the site, not the server. */
export function androidCertsFrom(text) {
  const words = text.split(/[\s,]+/).filter(Boolean);
  const ok = (w) => FINGERPRINT.test(w.toUpperCase()) && w.toUpperCase() !== EXPO_DEBUG_KEY;
  return { androidCerts: [...new Set(words.filter(ok).map((w) => w.toUpperCase()))], androidCertsBad: words.filter((w) => !ok(w)) };
}

/** The openers list, re-read when the file changes. Lines are wallets; `#` starts a
 *  comment. A missing file means nobody may open. */
export function openersFrom(file) {
  let mtime = -1;
  let set = new Set();
  return () => {
    const m = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
    if (m !== mtime) {
      mtime = m;
      const lines = m ? fs.readFileSync(file, "utf8").split("\n") : [];
      set = walletSet(lines.map((l) => l.replace(/#.*/, "")));
    }
    return set;
  };
}

/** The openers list from a variable: wallets separated by commas or whitespace, or "*"
 *  for any wallet (null: nothing is checked). */
export function openersFromList(text) {
  if (text.trim() === "*") return () => null;
  const set = walletSet(text.split(/[\s,]+/));
  return () => set;
}

const walletSet = (words) => new Set(words.map((w) => w.trim()).filter(Boolean).map((w) => new PublicKey(w).toBase58()));
