// Deterministic formatters (no locale APIs, so server and client agree).
import { LAMPORTS_PER_SOL } from './constants'
import type { Stage } from './types'

export function lamportsToSol(l: number): number {
  return l / LAMPORTS_PER_SOL
}

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL)
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 1234.5 → "1,234.50" */
export function fmtNumber(n: number, decimals = 2): string {
  const [i, d] = Math.abs(n).toFixed(decimals).split('.')
  const sign = n < 0 && Number(Math.abs(n).toFixed(decimals)) !== 0 ? '-' : ''
  return sign + groupThousands(i) + (d ? '.' + d : '')
}

/** 1_234_567 → "1.23M" */
export function fmtCompact(n: number, decimals = 2): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(decimals) + 'B'
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(decimals) + 'M'
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(decimals) + 'K'
  return sign + abs.toFixed(abs >= 100 ? 0 : decimals)
}

/** Lamports → "1.40" (no unit). */
export function fmtSol(lamports: number, decimals = 2): string {
  return fmtNumber(lamportsToSol(lamports), decimals)
}

/** Lamports → SOL without trailing zeros, for round figures in copy: 10 SOL → "10", 8.5 SOL → "8.5". */
export function fmtSolRound(lamports: number): string {
  const s = fmtSol(lamports)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** SOL float → "0.125" style with sensible precision. */
export function fmtSolAmount(sol: number): string {
  const abs = Math.abs(sol)
  if (abs >= 100) return fmtNumber(sol, 1)
  if (abs >= 1) return fmtNumber(sol, 2)
  return fmtNumber(sol, 3)
}

/** 12345 → "$12.3K" */
export function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1000) return (n < 0 ? '-$' : '$') + abs.toFixed(abs < 10 ? 2 : 0)
  return (n < 0 ? '-$' : '$') + fmtCompact(abs, 1)
}

/** 0.0279 → "2.79%" */
export function fmtPct(fraction: number, decimals = 2): string {
  return (fraction * 100).toFixed(decimals) + '%'
}

/** +0.123 → "+12.3%" */
export function fmtChange(fraction: number): string {
  const pct = fraction * 100
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : ''
  return sign + Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1) + '%'
}

/** Tiny prices: 3.588e-8 → "0.0₇3588" style is overkill; use exponent form. */
export function fmtPrice(sol: number): string {
  if (sol === 0) return '0'
  if (sol >= 0.001) return sol.toFixed(4)
  return sol.toExponential(3)
}

/** Milliseconds → "now", "42s", "12m", "3h", "2d" */
export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 5) return 'now'
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h'
  return Math.floor(h / 24) + 'd'
}

/** Milliseconds → "m:ss" (clamped at 0). */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m + ':' + String(s).padStart(2, '0')
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V'] as const
export function roman(level: number): string {
  return ROMAN[level - 1] ?? String(level)
}

/** "AbCd…WxYz" */
export function shortAddress(address: string): string {
  return address.length <= 10 ? address : address.slice(0, 4) + '…' + address.slice(-4)
}

/** What a coin's stage is called wherever it's written out. */
export const STAGE_LABELS: Record<Stage, string> = {
  presale: 'Presale',
  launching: 'Settling',
  live: 'Live on curve',
  migrated: 'Migrated',
  expired: 'Expired',
}
