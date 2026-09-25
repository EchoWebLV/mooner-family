import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { CURVE, disc, encodeConfigParams, moonerConfigParams } from "../src/dbc.js";
import { MOONER_DBC_CONFIG } from "../src/consts.js";
import { poolAddresses } from "../src/pdas.js";

const FIXTURE = new URL("../../programs/presale/litesvm/fixtures/dbc-config.json", import.meta.url);

test("discriminators match the ones the program checks (consts.rs)", () => {
  assert.deepEqual([...disc("swap2")], [65, 75, 63, 76, 235, 91, 91, 136]);
  assert.deepEqual([...disc("swap")], [248, 198, 158, 145, 225, 117, 135, 200]);
  assert.deepEqual([...disc("initialize_virtual_pool_with_token2022")], [169, 118, 51, 78, 145, 110, 220, 155]);
  assert.deepEqual([...disc("transfer_pool_creator")], [20, 7, 169, 33, 58, 147, 166, 33]);
});

test("create_config data is byte-identical to launch-test/dbc_layout.py", () => {
  // sha256 of dbc_layout.create_config_data(launch.mooner_config()), 211 bytes
  const d = Buffer.concat([disc("create_config"), encodeConfigParams(moonerConfigParams())]);
  assert.equal(d.length, 211);
  assert.equal(createHash("sha256").update(d).digest("hex"), "1649f6082f7cf2207006a5dbfa25dd4eb1552af0e644a59ef00721523aa049cf");
});

test("the curve numbers are the ones in Mooner's mainnet DBC config", () => {
  const acc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.equal(acc.pubkey, MOONER_DBC_CONFIG.toBase58());
  const d = Buffer.from(acc.account.data[0], "base64");
  const u128 = (o) => d.readBigUInt64LE(o) | (d.readBigUInt64LE(o + 8) << 64n);
  assert.equal(d.readBigUInt64LE(104), CURVE.FEE_CLIFF);
  assert.equal(d.readBigUInt64LE(120), CURVE.FEE_STEP);
  assert.equal(u128(392), CURVE.SQRT_START_PRICE);
  assert.equal(u128(424), CURVE.LIQUIDITY);
});

test("pool addresses match the live mainnet pool of the trial launch", () => {
  // mint GS2x... launched on Mooner's config; the pool and vaults exist on mainnet
  // (checked with getAccountInfo: owners DBC / Token-2022 / SPL Token, mints match)
  const p = poolAddresses(MOONER_DBC_CONFIG, new PublicKey("GS2xpNeKkon1rQHa7XcwkbZ65yP3rBT2v4uh2KMdQDeC"));
  assert.equal(p.pool.toBase58(), "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri");
  assert.equal(p.base.toBase58(), "BoZ7TTRxXfuZyWkzb7B7GRFGUG7HwQodvdSYx7ZhTXH2");
  assert.equal(p.quote.toBase58(), "EXWdgu1S49nyWhY5AHt6uQ4hcmyV5D6JMJREN2yxBdaM");
});
