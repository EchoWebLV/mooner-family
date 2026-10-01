// /.well-known/assetlinks.json (Android App Links) and the MOONER_ANDROID_CERTS setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { ANDROID_PACKAGE, assetLinks, makeAppLinkRoutes } from "../server/applinks.js";
import { androidCertsFrom, loadConfig } from "../server/config.js";
import { createServer } from "../server/http.js";

const CERT = `${"AB:".repeat(31)}CD`;
const CERT2 = `${"12:".repeat(31)}EF`;

async function serve(certs) {
  const server = createServer(makeAppLinkRoutes({ certs }), { log: () => {} });
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
