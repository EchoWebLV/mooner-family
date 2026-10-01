import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { CURVE, decodePoolState, disc, encodeConfigParams, feeNumeratorAt, moonerConfigParams } from "../src/dbc.js";
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
  assert.equal(createHash("sha256").update(d).digest("hex"), "ce30f220da989046c12121d8ac809e9c79adefd16780b7cb22d39e7584f4382b");
});

test("the curve numbers are the ones in Mooner's mainnet DBC config", () => {
  const acc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.equal(acc.pubkey, MOONER_DBC_CONFIG.toBase58());
  const d = Buffer.from(acc.account.data[0], "base64");
  const u128 = (o) => d.readBigUInt64LE(o) | (d.readBigUInt64LE(o + 8) << 64n);
  // base fee: cliff, period_frequency (s), reduction_factor (bps), number_of_period, mode
  assert.equal(d.readBigUInt64LE(104), CURVE.FEE_CLIFF);
  assert.equal(d.readBigUInt64LE(112), 1n);
  assert.equal(d.readBigUInt64LE(120), CURVE.FEE_REDUCTION_BPS);
  assert.equal(d.readUInt16LE(128), CURVE.SNIPE_S);
  assert.equal(d[130], 1); // exponential
  assert.equal(u128(392), CURVE.SQRT_START_PRICE);
  assert.equal(u128(424), CURVE.LIQUIDITY);
});

test("the snipe tax: 98.95%, 21.39%, 4.63%, then exactly the 1% floor", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 60].map(feeNumeratorAt), [989539134n, 213938360n, 46253473n, 10000000n, 10000000n, 10000000n]);
  assert.equal(feeNumeratorAt(CURVE.SNIPE_S), CURVE.FEE_FLOOR);
  assert.ok(feeNumeratorAt(0) <= 990_000_000n); // DBC's MAX_FEE_NUMERATOR
  assert.equal(feeNumeratorAt(-5), CURVE.FEE_CLIFF);
  assert.equal(feeNumeratorAt(2.9), 46253473n);
});

test("pool addresses match the live mainnet pool of the trial launch", () => {
  // mint GS2x... launched on Mooner's first config (HnKg7Vb2..., the 60 s linear fee); the
  // pool and vaults exist on mainnet (checked with getAccountInfo: owners DBC / Token-2022 /
  // SPL Token, mints match)
  const config = new PublicKey("HnKg7Vb2aHPhX8LVy4gMXZ6dACGPHUPFkQeX82FB8LmF");
  const p = poolAddresses(config, new PublicKey("GS2xpNeKkon1rQHa7XcwkbZ65yP3rBT2v4uh2KMdQDeC"));
  assert.equal(p.pool.toBase58(), "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri");
  assert.equal(p.base.toBase58(), "BoZ7TTRxXfuZyWkzb7B7GRFGUG7HwQodvdSYx7ZhTXH2");
  assert.equal(p.quote.toBase58(), "EXWdgu1S49nyWhY5AHt6uQ4hcmyV5D6JMJREN2yxBdaM");
});

test("a pool account decodes (the trial launch's pool, read from mainnet on 2026-09-26)", () => {
  const acc = JSON.parse(readFileSync(new URL("./fixtures/dbc-pool.json", import.meta.url), "utf8"));
  assert.equal(acc.pubkey, "8bnXSQC6zNX8BhWanfNLjn7wEmSU2NJRHjjeWVkpD3ri");
  const d = Buffer.from(acc.data, "base64");
  const s = decodePoolState(d);
  assert.equal(s.quoteReserve, 197354828n);
  assert.equal(s.sqrtPrice, 98247117170863603n);
  assert.equal(s.migrated, false);
  assert.equal(s.activationPoint, 1790312370n);
  assert.ok(s.sqrtPrice > CURVE.SQRT_START_PRICE);
  assert.equal(decodePoolState(d.subarray(0, 200)), null);
  assert.equal(decodePoolState(Buffer.alloc(424)), null);
});
