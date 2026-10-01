// /.well-known/assetlinks.json (Android App Links) and the MOONER_ANDROID_CERTS setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { ANDROID_PACKAGE, appLinksLog, assetLinks, makeAppLinkRoutes } from "../server/applinks.js";
import { androidCertsFrom, loadConfig } from "../server/config.js";
import { createServer } from "../server/http.js";

const CERT = `${"AB:".repeat(31)}CD`;
const CERT2 = `${"12:".repeat(31)}EF`;

async function serve(certs, more = []) {
  const server = createServer(makeAppLinkRoutes({ certs }).concat(more), { log: () => {} });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { get: (p) => fetch(base + p), close: () => new Promise((r) => server.close(r)) };
}

test("assetlinks.json: the app and its keys, as plain application/json", async () => {
  const s = await serve([CERT, CERT2]);
  try {
    const r = await s.get("/.well-known/assetlinks.json");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/json");
    assert.deepEqual(await r.json(), [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "family.mooner.app", sha256_cert_fingerprints: [CERT, CERT2] },
      },
    ]);
    assert.equal(ANDROID_PACKAGE, "family.mooner.app");
    assert.deepEqual(assetLinks([CERT]), [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [CERT] } }]);
  } finally {
    await s.close();
  }
});

test("assetlinks.json: no keys set, no file; other replies keep their JSON type", async () => {
  const s = await serve([]);
  try {
    const r = await s.get("/.well-known/assetlinks.json");
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal((await s.get("/.well-known/other.json")).status, 404);
  } finally {
    await s.close();
  }
});

test("a plain {json} route next to assetlinks.json keeps the default type on a 200", async () => {
  const s = await serve([CERT], [{ method: "GET", path: /^\/plain$/, handler: async () => ({ json: { ok: true } }) }]);
  try {
    assert.equal((await s.get("/.well-known/assetlinks.json")).headers.get("content-type"), "application/json");
    const r = await s.get("/plain");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await r.json(), { ok: true });
  } finally {
    await s.close();
  }
});

test("MOONER_ANDROID_CERTS: fingerprints, comma or space separated, uppercased; others and Expo's debug key left out and named", () => {
  assert.deepEqual(androidCertsFrom(""), { androidCerts: [], androidCertsBad: [] });
  assert.deepEqual(androidCertsFrom(` ${CERT.toLowerCase()},\n${CERT2} ${CERT}`), { androidCerts: [CERT, CERT2], androidCertsBad: [] });
  assert.deepEqual(androidCertsFrom(`${CERT}, AB:CD, sha256`), { androidCerts: [CERT], androidCertsBad: ["AB:CD", "sha256"] });
  // the key in Expo's template: public, so any app signed with it could claim the links
  const expoDebug = "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C";
  assert.deepEqual(androidCertsFrom(`${CERT} ${expoDebug.toLowerCase()}`), { androidCerts: [CERT], androidCertsBad: [expoDebug.toLowerCase()] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mooner-"));
  try {
    const k = () => Keypair.generate().publicKey.toBase58();
    fs.writeFileSync(`${dir}/deployment.json`, JSON.stringify({ programId: k(), dbcConfig: k(), alt: k() }));
    assert.deepEqual(loadConfig({ MOONER_DIR: dir }).androidCerts, []);
    const cfg = loadConfig({ MOONER_DIR: dir, MOONER_ANDROID_CERTS: `${CERT} nope` });
    assert.deepEqual([cfg.androidCerts, cfg.androidCertsBad], [[CERT], ["nope"]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("App Links log lines (main.js, --check too): how many keys; a left-out word only as its length and first 4 characters", () => {
  assert.deepEqual(appLinksLog(androidCertsFrom("")), ["no MOONER_ANDROID_CERTS: no assetlinks.json, app links open the site"]);
  assert.deepEqual(appLinksLog(androidCertsFrom(`${CERT},${CERT2}`)), ["App Links for 2 Android signing key(s)"]);
  // a secret pasted into the variable by mistake must not reach the host's logs
  const secret = "pinata-jwt-pasted-by-mistake-0123456789";
  const expoDebug = "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C";
  const lines = appLinksLog(androidCertsFrom(`${CERT} AB:CD ${secret} ${expoDebug}`));
  assert.deepEqual(lines, [
    "App Links for 1 Android signing key(s)",
    `MOONER_ANDROID_CERTS: 3 word(s) left out (not a SHA-256 fingerprint, or Expo's public debug key): 5 chars "AB:C…", 39 chars "pina…", 95 chars "FA:C…"`,
  ]);
  assert.ok(!lines.join("\n").includes(secret.slice(0, 5)));
});
