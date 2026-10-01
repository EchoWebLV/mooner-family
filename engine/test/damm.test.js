// Meteora DAMM v2 (engine/src/damm.js) against the mainnet DAMM v2 pool GwvAt96o…, read on
// 2026-10-01: the pool that DBC pool 5Dekcwc2… (test/dbc.test.js) migrated into.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { DBC, WSOL } from "../src/consts.js";
import { poolAuthority } from "../src/pdas.js";
import { priceFromSqrt } from "../src/views.js";
import { DAMM_V2, dammPoolAddress, dammPoolAuthority, decodeDammPool, findDammPool, MIGRATION_CONFIGS } from "../src/damm.js";

const fixture = (name) => {
  const j = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
  return { pubkey: new PublicKey(j.pubkey), data: Buffer.from(j.data, "base64") };
};
const MINT = new PublicKey("AcgB3riCTGBzQ626TRmEm1f6ikeFvxi4mL36piDXV6ug");

test("a DAMM v2 pool decodes; its price is the one Meteora's Data API gave for it", () => {
  const { pubkey, data } = fixture("damm-pool.json");
  assert.equal(pubkey.toBase58(), "GwvAt96oPP1fd1gMX9bPhERFKkvV5qBBVc7P1MHGPJk3");
  const p = decodeDammPool(data);
  assert.equal(p.tokenA.toBase58(), MINT.toBase58());
  assert.equal(p.tokenB.toBase58(), WSOL.toBase58());
  assert.equal(p.vaultA.toBase58(), "DV9oKp623sJeXNMR8j5BeQpQ7x7Wevh4efKp2CaVucHq");
  assert.equal(p.vaultB.toBase58(), "EwQ9pkifCeYbY78FDLAsEnAgJyZ7AR9BrSQsQu6CpUxv");
  assert.equal(p.liquidity, 77505928465126673851467666076082n);
  assert.equal(p.sqrtPrice, 185460299076988380n);
  assert.equal(p.activationPoint, 1790811206n);
  assert.equal(p.status, 0);
  // GET damm-v2.datapi.meteora.ag/pools/GwvAt96o… current_price, read with this account
  assert.equal(priceFromSqrt(p.sqrtPrice), 1.0107935607993896e-7);
  assert.equal(decodeDammPool(data.subarray(0, 500)), null);
  assert.equal(decodeDammPool(fixture("dbc-pool.json").data), null, "a DBC pool isn't one");
});

test("the pool's address: config, then the larger mint; the two pool authorities own the vaults", () => {
  // that pool's DBC config migrates with option 6 (Customizable)
  assert.equal(dammPoolAddress(MIGRATION_CONFIGS[6], MINT, WSOL).toBase58(), "GwvAt96oPP1fd1gMX9bPhERFKkvV5qBBVc7P1MHGPJk3");
  assert.equal(dammPoolAddress(MIGRATION_CONFIGS[6], WSOL, MINT).toBase58(), "GwvAt96oPP1fd1gMX9bPhERFKkvV5qBBVc7P1MHGPJk3");
  assert.equal(MIGRATION_CONFIGS[2].toBase58(), "Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp", "FixedBps100, Mooner's");
  // the owners of the vaults of both pools, read with getAccountInfo on 2026-10-01
  assert.equal(dammPoolAuthority().toBase58(), "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
  assert.equal(poolAuthority().toBase58(), "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
});

test("findDammPool: Mooner's config first, the others in the same read; only a real pool of the mint counts", async () => {
  const { pubkey, data } = fixture("damm-pool.json");
  const accounts = new Map([[pubkey.toBase58(), { owner: DAMM_V2, data }]]);
  const reads = [];
  const conn = { getMultipleAccountsInfo: async (keys) => (reads.push(keys.map((k) => k.toBase58())), keys.map((k) => accounts.get(k.toBase58()) ?? null)) };
  const found = await findDammPool(conn, MINT);
  assert.equal(found.pool.toBase58(), pubkey.toBase58());
  assert.equal(found.state.sqrtPrice, 185460299076988380n);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].length, 7);
  assert.equal(reads[0][0], dammPoolAddress(MIGRATION_CONFIGS[2], MINT, WSOL).toBase58());

  // the same bytes under another owner, or for another mint, aren't it
  accounts.set(pubkey.toBase58(), { owner: DBC, data });
  assert.equal(await findDammPool(conn, MINT), null);
  assert.equal(await findDammPool({ getMultipleAccountsInfo: async (k) => k.map(() => null) }, MINT), null);
});
