// Constant-product bonding curve with virtual reserves (spec §3.4).
// Pure functions: SOL and token amounts are floats here; lamports live in presale/wallet code.
import {
  CURVE_TOKENS_FOR_SALE, LAMPORTS_PER_SOL, LP_TOKENS, PRESALE_TARGET, TOTAL_SUPPLY,
  VIRTUAL_SOL_0, VIRTUAL_TOKENS_0,
} from './constants'
import type { Allocation, Lamports, Pool } from './types'

export function initialCurvePool(): Pool {
  return { solReserve: VIRTUAL_SOL_0, tokenReserve: VIRTUAL_TOKENS_0, tokensSold: 0 }
}

export interface BuyQuote {
  tokensOut: number
  solUsed: number
}

/**
 * Tokens received for `solIn`. On the curve (`capped`), a buy that would exceed
 * the remaining for-sale tokens is capped and only charges the SOL needed.
 */
export function quoteBuy(pool: Pool, solIn: number, capped: boolean): BuyQuote {
  if (solIn <= 0) return { tokensOut: 0, solUsed: 0 }
  const k = pool.solReserve * pool.tokenReserve
  let tokensOut = pool.tokenReserve - k / (pool.solReserve + solIn)
  let solUsed = solIn
  if (capped) {
    const remaining = CURVE_TOKENS_FOR_SALE - pool.tokensSold
    if (remaining <= 0) return { tokensOut: 0, solUsed: 0 }
    if (tokensOut > remaining) {
      tokensOut = remaining
      solUsed = k / (pool.tokenReserve - remaining) - pool.solReserve
    }
  }
  return { tokensOut, solUsed }
}

/** SOL received for selling `tokensIn`. */
export function quoteSell(pool: Pool, tokensIn: number): number {
  if (tokensIn <= 0) return 0
  const k = pool.solReserve * pool.tokenReserve
  return pool.solReserve - k / (pool.tokenReserve + tokensIn)
}

export function applyBuy(pool: Pool, q: BuyQuote): Pool {
  return {
    solReserve: pool.solReserve + q.solUsed,
    tokenReserve: pool.tokenReserve - q.tokensOut,
    tokensSold: pool.tokensSold + q.tokensOut,
  }
}

export function applySell(pool: Pool, tokensIn: number, solOut: number): Pool {
  return {
    solReserve: pool.solReserve - solOut,
    tokenReserve: pool.tokenReserve + tokensIn,
    tokensSold: pool.tokensSold - tokensIn,
  }
}

/** SOL per token. */
export function spotPrice(pool: Pool): number {
  return pool.solReserve / pool.tokenReserve
}

export function marketCapSol(pool: Pool): number {
  return spotPrice(pool) * TOTAL_SUPPLY
}

export function curveProgress(pool: Pool): number {
  return Math.min(1, Math.max(0, pool.tokensSold / CURVE_TOKENS_FOR_SALE))
}

export function isSoldOut(pool: Pool): boolean {
  return pool.tokensSold >= CURVE_TOKENS_FOR_SALE - 1e-6
}

/** Real SOL raised by the curve so far. */
export function solRaised(pool: Pool): number {
  return pool.solReserve - VIRTUAL_SOL_0
}

/** Real SOL raised when the curve sells out and migrates (≈ 85.005). */
export const MIGRATION_SOL = (VIRTUAL_SOL_0 * VIRTUAL_TOKENS_0) / (VIRTUAL_TOKENS_0 - CURVE_TOKENS_FOR_SALE) - VIRTUAL_SOL_0

/** AMM pool seeded at migration: all SOL raised + LP_TOKENS. */
export function migrationPool(curvePool: Pool): Pool {
  return { solReserve: solRaised(curvePool), tokenReserve: LP_TOKENS, tokensSold: curvePool.tokensSold }
}

export interface PresaleResult {
  pool: Pool
  totalTokens: number
  /** SOL per token paid by every participant. */
  price: number
  allocations: Allocation[]
}

/** The whole presale executes as the first buy; tokens are split pro-rata to commits. */
export function presaleAllocation(participants: { userId: string; commit: Lamports }[]): PresaleResult {
  const start = initialCurvePool()
  const q = quoteBuy(start, PRESALE_TARGET / LAMPORTS_PER_SOL, true)
  const allocations = participants.map((p) => ({
    userId: p.userId,
    commit: p.commit,
    tokens: (q.tokensOut * p.commit) / PRESALE_TARGET,
  }))
  return {
    pool: applyBuy(start, q),
    totalTokens: q.tokensOut,
    price: q.solUsed / q.tokensOut,
    allocations,
  }
}

/** SOL per token paid by every presale participant. */
export function presalePrice(): number {
  const q = quoteBuy(initialCurvePool(), PRESALE_TARGET / LAMPORTS_PER_SOL, true)
  return q.solUsed / q.tokensOut
}

/** Tokens a commit would receive at launch (for the allocation preview). */
export function allocationFor(commit: Lamports): number {
  const q = quoteBuy(initialCurvePool(), PRESALE_TARGET / LAMPORTS_PER_SOL, true)
  return (q.tokensOut * commit) / PRESALE_TARGET
}
