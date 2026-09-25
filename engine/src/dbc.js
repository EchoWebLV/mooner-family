// Meteora DBC builders (IDL v0.1.10 / program v0.2.1), ported from launch-test/launch.py
// and dbc_layout.py, plus the small SPL helpers the launch tx needs.

import { createHash } from "node:crypto";
import { ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { ATA_PROGRAM, DBC, IX_SYSVAR, SYSTEM, TOKEN, TOKEN22, WSOL } from "./consts.js";
import { ata, eventAuthority, poolAddresses, poolAuthority } from "./pdas.js";

const w = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
const ws = (pubkey) => ({ pubkey, isSigner: true, isWritable: true });
const rs = (pubkey) => ({ pubkey, isSigner: true, isWritable: false });

/** Anchor discriminator: sha256("global:<name>")[..8]. */
export const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

// ---- Mooner's curve (launch.py "Mooner's test curve") ----
// One constant-product segment: start FDV 28 SOL, graduates at 80 SOL, 1B supply, 6
// decimals. Fee: linear anti-sniper schedule from ~99% to the 1% floor over 60 s; the
// first swap in the pool-creating tx pays the floor. The sqrt prices are Q64.64 of
// sqrt(lamports per raw token), computed once in launch.py (curve_params) with floats;
// test/dbc.test.js checks every number against Mooner's mainnet config account.
export const CURVE = {
  DECIMALS: 6,
  GRAD_QUOTE: 80_000_000_000n,
  SQRT_START_PRICE: 97610994635780032n,
  LIQUIDITY: 105571432261223416012914185700781n,
  MAX_SQRT_PRICE: 79226673521066979257578248091n,
  FEE_FLOOR: 10_000_000n, // 1% of FEE_DENOMINATOR 1e9
  SNIPE_WINDOW_S: 60,
  FEE_STEP: 16_333_333n, // (99% cap - floor) / window
  FEE_CLIFF: 989_999_980n, // floor + step * window
};

export function moonerConfigParams() {
  const zeroVest = { vestingPercentage: 0, bpsPerPeriod: 0, numberOfPeriods: 0, cliffDurationFromMigrationTime: 0, frequency: 0 };
  return {
    baseFee: { cliffFeeNumerator: CURVE.FEE_CLIFF, firstFactor: CURVE.SNIPE_WINDOW_S, secondFactor: 1n, thirdFactor: CURVE.FEE_STEP, baseFeeMode: 0 },
    collectFeeMode: 0, // fees in SOL
    migrationOption: 1, // DAMM v2
    activationType: 1, // timestamp
    tokenType: 1, // Token-2022
    tokenDecimal: CURVE.DECIMALS,
    partnerLiquidityPercentage: 40,
    partnerPermanentLockedLiquidityPercentage: 10,
    creatorLiquidityPercentage: 40,
    creatorPermanentLockedLiquidityPercentage: 10,
    migrationQuoteThreshold: CURVE.GRAD_QUOTE,
    sqrtStartPrice: CURVE.SQRT_START_PRICE,
    migrationFeeOption: 2, // graduated pool fee 1%
    creatorTradingFeePercentage: 50,
    tokenUpdateAuthority: 1, // immutable metadata
    poolCreationFee: 0n,
    partnerLiquidityVestingInfo: zeroVest,
    creatorLiquidityVestingInfo: zeroVest,
    enableFirstSwapWithMinFee: true,
    curve: [{ sqrtPrice: CURVE.MAX_SQRT_PRICE, liquidity: CURVE.LIQUIDITY }],
  };
}

// ---- borsh writer ----
class Writer {
  parts = [];
  u8(v) { this.parts.push(Buffer.from([v])); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); this.parts.push(b); return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); this.parts.push(b); return this; }
  u64(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); this.parts.push(b); return this; }
  u128(v) {
    const b = Buffer.alloc(16);
    b.writeBigUInt64LE(BigInt(v) & 0xffffffffffffffffn, 0);
    b.writeBigUInt64LE(BigInt(v) >> 64n, 8);
    this.parts.push(b);
    return this;
  }
  bool(v) { return this.u8(v ? 1 : 0); }
  str(s) { const e = Buffer.from(s, "utf8"); this.u32(e.length); this.parts.push(e); return this; }
  raw(b) { this.parts.push(Buffer.from(b)); return this; }
  done() { return Buffer.concat(this.parts); }
}

/** ConfigParameters, field order of process_create_config.rs (dbc_layout.enc_config).
 *  Fields this engine never sets (dynamic fee, locked vesting, token supply, migration
 *  fee, migrated-pool fee settings, compounding) are written as zero / None. */
export function encodeConfigParams(c) {
  const wr = new Writer();
  const bf = c.baseFee;
  wr.u64(bf.cliffFeeNumerator).u16(bf.firstFactor).u64(bf.secondFactor).u64(bf.thirdFactor).u8(bf.baseFeeMode);
  wr.u8(0); // dynamic_fee: None
  for (const k of [
    "collectFeeMode", "migrationOption", "activationType", "tokenType", "tokenDecimal",
    "partnerLiquidityPercentage", "partnerPermanentLockedLiquidityPercentage",
    "creatorLiquidityPercentage", "creatorPermanentLockedLiquidityPercentage",
  ]) wr.u8(c[k]);
  wr.u64(c.migrationQuoteThreshold).u128(c.sqrtStartPrice);
  for (let i = 0; i < 5; i++) wr.u64(0); // locked_vesting
  wr.u8(c.migrationFeeOption);
  wr.u8(0); // token_supply: None
  wr.u8(c.creatorTradingFeePercentage).u8(c.tokenUpdateAuthority);
  wr.u8(0).u8(0); // migration_fee: fee_percentage, creator_fee_percentage
  wr.u8(0).u8(0).u16(0); // migrated_pool_fee: collect_fee_mode, dynamic_fee, pool_fee_bps
  wr.u64(c.poolCreationFee);
  for (const v of [c.partnerLiquidityVestingInfo, c.creatorLiquidityVestingInfo]) {
    wr.u8(v.vestingPercentage).u16(v.bpsPerPeriod).u16(v.numberOfPeriods).u32(v.cliffDurationFromMigrationTime).u32(v.frequency);
  }
  wr.u8(0); // migrated_pool_base_fee_mode
  wr.u16(0).u16(0).u32(0).u64(0); // migrated_pool_market_cap_fee_scheduler_params
  wr.bool(c.enableFirstSwapWithMinFee).u16(0); // compounding_fee_bps
  wr.raw([0, 0]); // padding
  wr.u32(c.curve.length);
  for (const p of c.curve) wr.u128(p.sqrtPrice).u128(p.liquidity);
  return wr.done();
}

/** A new DBC config account (`config` signs) with Mooner as partner and fee claimer. */
export function createConfig({ config, partner, payer, params = moonerConfigParams() }) {
  return new TransactionInstruction({
    programId: DBC,
    keys: [ws(config), r(partner), r(partner), r(WSOL), ws(payer), r(SYSTEM), r(eventAuthority()), r(DBC)],
    data: Buffer.concat([disc("create_config"), encodeConfigParams(params)]),
  });
}

/** initialize_virtual_pool_with_token2022. The mint keypair signs. */
export function initPool({ config, creator, mint, payer, name, symbol, uri }) {
  const { pool, base, quote } = poolAddresses(config, mint);
  return new TransactionInstruction({
    programId: DBC,
    keys: [
      r(config), r(poolAuthority()), rs(creator), ws(mint), r(WSOL), w(pool), w(base), w(quote),
      ws(payer), r(TOKEN), r(TOKEN22), r(SYSTEM), r(eventAuthority()), r(DBC),
    ],
    data: new Writer().raw(disc("initialize_virtual_pool_with_token2022")).str(name).str(symbol).str(uri).done(),
  });
}

/** swap2 exact-in (mode 0), wSOL -> token, no referral, the ix sysvar appended so the
 *  first swap in the pool-creating tx pays the floor fee. */
export function swap2({ config, mint, payer, input, output, amountIn, minOut }) {
  const { pool, base, quote } = poolAddresses(config, mint);
  return new TransactionInstruction({
    programId: DBC,
    keys: [
      r(poolAuthority()), r(config), w(pool), w(input), w(output), w(base), w(quote), r(mint), r(WSOL),
      rs(payer), r(TOKEN22), r(TOKEN), r(DBC), r(eventAuthority()), r(DBC), r(IX_SYSVAR),
    ],
    data: new Writer().raw(disc("swap2")).u64(amountIn).u64(minOut).u8(0).done(),
  });
}

export function transferPoolCreator({ config, mint, creator, newCreator }) {
  const { pool } = poolAddresses(config, mint);
  return new TransactionInstruction({
    programId: DBC,
    keys: [w(pool), r(config), rs(creator), r(newCreator), r(eventAuthority()), r(DBC)],
    data: disc("transfer_pool_creator"),
  });
}

// ---- compute budget, ATA, SPL ----

export const computeLimit = (units) => ComputeBudgetProgram.setComputeUnitLimit({ units });
export const computePrice = (microLamports) => ComputeBudgetProgram.setComputeUnitPrice({ microLamports });

/** CreateIdempotent. */
export function createAta({ payer, owner, mint, tokenProgram }) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [ws(payer), w(ata(owner, mint, tokenProgram)), r(owner), r(mint), r(SYSTEM), r(tokenProgram)],
    data: Buffer.from([1]),
  });
}

export const syncNative = (account) =>
  new TransactionInstruction({ programId: TOKEN, keys: [w(account)], data: Buffer.from([17]) });

export const closeAccount = ({ account, dest, owner }) =>
  new TransactionInstruction({ programId: TOKEN, keys: [w(account), w(dest), rs(owner)], data: Buffer.from([9]) });
