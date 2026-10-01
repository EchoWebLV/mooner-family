// Mooner's Meteora DBC curve (engine/src/dbc.js CURVE): one constant-product segment, 1B
// supply, 6 decimals, starts at 28 SOL market cap and graduates at 80 SOL in the curve.
// A presale's SOL goes in as the pool's first buy at the 1% fee floor.
import { LAMPORTS_PER_SOL, PRESALE_TARGET, TOTAL_SUPPLY } from './constants'
import type { Lamports, Pool } from './types'

const DECIMALS = 6
const SQRT_START = 97610994635780032n
const LIQUIDITY = 105571432261223416012914185700781n
/** SOL in the curve when it graduates to its AMM pool. */
export const MIGRATION_SOL = 80
/**
 * About what reaches the first buy from a full pool: the launch's rent and fee (about 0.01
 * SOL) and each seat's token account and claim fee (about 0.0015 SOL a seat) come out first.
 * The real amount depends on the number of seats. (Was 9.9 SOL of a 10 SOL pool.)
 */
export const PRESALE_BUY_LAMPORTS = PRESALE_TARGET - 20_000_000

/** Whole tokens the first buy of `lamports` gets from a fresh pool (1% fee). */
export function firstBuyTokens(lamports: Lamports): number {
  const q = (BigInt(Math.round(lamports)) * 99n) / 100n
  const s1 = SQRT_START + (q << 128n) / LIQUIDITY
  const raw = (LIQUIDITY * (s1 - SQRT_START)) / (SQRT_START * s1)
  return Number(raw) / 10 ** DECIMALS
}

/** SOL per whole token at a Q64.64 sqrt price (of lamports per raw token). */
export function priceFromSqrt(sqrtPrice: bigint): number {
  const s = Number(sqrtPrice) / 2 ** 64
  return (s * s * 10 ** DECIMALS) / LAMPORTS_PER_SOL
}

const PRESALE_TOKENS = firstBuyTokens(PRESALE_BUY_LAMPORTS)

/** SOL per token. */
export function spotPrice(pool: Pool): number {
  return pool.priceSol
}

export function marketCapSol(pool: Pool): number {
  return pool.priceSol * TOTAL_SUPPLY
}

export function curveProgress(pool: Pool): number {
  return pool.migrated ? 1 : Math.min(1, Math.max(0, pool.quoteSol / MIGRATION_SOL))
}

/** Real SOL in the curve. */
export function solRaised(pool: Pool): number {
  return pool.quoteSol
}

/** SOL per token every presale seat pays (what it put in over what it gets), about. */
export function presalePrice(): number {
  return PRESALE_TARGET / LAMPORTS_PER_SOL / PRESALE_TOKENS
}

/** About how many tokens a commit gets at launch (for the allocation preview). */
export function allocationFor(commit: Lamports): number {
  return (PRESALE_TOKENS * commit) / PRESALE_TARGET
}
