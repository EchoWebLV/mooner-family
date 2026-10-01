// Derived views for the screens (spec §5). Pure reads of the world; components memoize them.
import { CHANGE_WINDOW_MS, EXPIRED_FLASH_MS, LAMPORTS_PER_SOL, RAIL_LIMIT, SOL_USD, TOTAL_SUPPLY } from './constants'
import { curveProgress, marketCapSol, presalePrice, spotPrice } from './curve'
import { mainTitle } from './levels'
import { poolLamports } from './presale'
import type { Lamports, LaunchRecord, Level, Title, Token, User, World } from './types'

// ---- rails ----

/** Case-insensitive match on name or ticker; a leading "$" is ignored. */
export function matchesSearch(t: Token, query: string): boolean {
  const q = query.trim().replace(/^\$/, '').toLowerCase()
  if (!q) return true
  return t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q)
}

/** An expired presale flashes "EXPIRED" in New Pairs for a moment before it goes. */
export function isExpiredFlashing(t: Token, now: number): boolean {
  return t.stage === 'expired' && now - (t.expiredAt ?? now) < EXPIRED_FLASH_MS
}

function byIdDesc(a: Token, b: Token): number {
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** Presales filling (and settling), newest first; expired ones flash for a moment. */
export function newPairs(w: World, query = ''): Token[] {
  return Object.values(w.tokens)
    .filter((t) => (t.stage === 'presale' || t.stage === 'launching' || isExpiredFlashing(t, w.now)) && matchesSearch(t, query))
    .sort((a, b) => b.createdAt - a.createdAt || byIdDesc(a, b))
    .slice(0, RAIL_LIMIT)
}

/** Live on the curve, closest to migrating first. */
export function finalStretch(w: World, query = ''): Token[] {
  return Object.values(w.tokens)
    .filter((t) => t.stage === 'live' && matchesSearch(t, query))
    .sort((a, b) => progressOf(b) - progressOf(a) || byIdDesc(a, b))
    .slice(0, RAIL_LIMIT)
}

/** Graduated to the AMM pool, most recent first. */
export function migratedRail(w: World, query = ''): Token[] {
  return Object.values(w.tokens)
    .filter((t) => t.stage === 'migrated' && matchesSearch(t, query))
    .sort((a, b) => (b.migratedAt ?? 0) - (a.migratedAt ?? 0) || byIdDesc(a, b))
    .slice(0, RAIL_LIMIT)
}

/** The presales still filling and the SOL in them, for the Pulse header. Settling pools are full, so they don't count. */
export function fillingPools(w: World): { count: number; lamports: Lamports } {
  let count = 0
  let lamports = 0
  for (const t of Object.values(w.tokens)) {
    if (t.stage !== 'presale') continue
    count++
    lamports += poolLamports(t.presale)
  }
  return { count, lamports }
}

/** Where a click on a token goes: its presale until launch, then its token page. */
export function tokenHref(t: Token): string {
  return t.stage === 'live' || t.stage === 'migrated' ? `/token/${t.id}` : `/presale/${t.id}`
}

// ---- market numbers ----

export function progressOf(t: Token): number {
  return t.pool ? curveProgress(t.pool) : 0
}

export function priceSol(t: Token): number {
  return t.pool ? spotPrice(t.pool) : 0
}

export function marketCapUsd(t: Token): number {
  return t.pool ? marketCapSol(t.pool) * SOL_USD : 0
}

/** Both sides of the AMM pool, in USD (the token side is worth the SOL side at spot). */
export function liquidityUsd(t: Token): number {
  return t.stage === 'migrated' && t.pool ? 2 * t.pool.solReserve * SOL_USD : 0
}

export function volumeUsd(t: Token): number {
  return t.volumeSol * SOL_USD
}

export type McapHeat = 'cool' | 'warm' | 'hot'

/** Colours a market cap on the rails. In the simulator about half the live tokens run warm, and over a quarter of the migrated ones hot. */
export function mcapHeat(usd: number): McapHeat {
  return usd >= 50_000 ? 'hot' : usd >= 25_000 ? 'warm' : 'cool'
}

export function holderCount(t: Token): number {
  return Object.keys(t.positions).length
}

/**
 * Price change over the last `windowMs`. A token younger than that is measured
 * from the presale price everyone paid, not from the empty curve.
 */
export function priceChange(t: Token, now: number, windowMs = CHANGE_WINDOW_MS): number {
  if (!t.pool || t.candles.length === 0) return 0
  const from = now - windowMs
  const ref = t.candles.find((c) => c.t >= from) ?? t.candles[t.candles.length - 1]
  const base = ref.t <= (t.launchedAt ?? 0) ? presalePrice() : ref.o
  return spotPrice(t.pool) / base - 1
}

// ---- people ----

export interface BadgeRef {
  userId: string
  title: Title
  level: Level
}

export function mainBadge(u: User): BadgeRef {
  const title = mainTitle(u.titles)
  return { userId: u.id, title, level: u.titles[title].level }
}

export function userByHandle(w: World, handle: string): User | undefined {
  const h = handle.toLowerCase()
  return Object.values(w.users).find((u) => u.handle.toLowerCase() === h)
}

// ---- token page ----

export interface Holder {
  userId: string
  tokens: number
  /** Share of total supply, 0..1. */
  share: number
  /** Got an allocation in the presale. */
  presale: boolean
}

export function holders(t: Token): Holder[] {
  const fromPresale = new Set(t.allocations?.map((a) => a.userId))
  return Object.entries(t.positions)
    .map(([userId, tokens]) => ({ userId, tokens, share: tokens / TOTAL_SUPPLY, presale: fromPresale.has(userId) }))
    .sort((a, b) => b.tokens - a.tokens || (a.userId < b.userId ? -1 : 1))
}

export interface PresaleRow {
  userId: string
  commit: Lamports
  tokens: number
  /** Tokens held now. */
  held: number
  /** Whether they still hold their allocation. */
  holds: 'all' | 'some' | 'none'
}

/** Every presale participant with what they got and whether they kept it. */
export function presaleRows(t: Token): PresaleRow[] {
  return (t.allocations ?? []).map((a) => {
    const held = t.positions[a.userId] ?? 0
    const holds = held >= a.tokens * 0.999 ? 'all' : held > 0 ? 'some' : 'none'
    return { userId: a.userId, commit: a.commit, tokens: a.tokens, held, holds }
  })
}

export interface PositionView {
  tokens: number
  costSol: number
  /** SOL per token paid on average. */
  avgEntry: number
  valueSol: number
  pnlSol: number
  pnlPct: number
}

export function positionOf(t: Token, userId: string): PositionView | null {
  const tokens = t.positions[userId] ?? 0
  if (tokens <= 0 || !t.pool) return null
  const costSol = t.costBasis[userId] ?? 0
  const valueSol = tokens * spotPrice(t.pool)
  const pnlSol = valueSol - costSol
  return { tokens, costSol, avgEntry: costSol / tokens, valueSol, pnlSol, pnlPct: costSol > 0 ? pnlSol / costSol : 0 }
}

/** Paper PnL of a launch record: marked to the current price while the token still trades. */
export function historyPnl(w: World, h: LaunchRecord): number {
  const t = w.tokens[h.tokenId]
  if (h.outcome === 'expired' || !t?.pool) return h.pnlSol
  return h.tokens * spotPrice(t.pool) - h.commit / LAMPORTS_PER_SOL
}

// ---- chat ----

/** TICKER → token id, for linking `$TICKER` mentions. */
export function tickerIndex(w: World): Map<string, string> {
  const map = new Map<string, string>()
  for (const t of Object.values(w.tokens)) if (t.stage !== 'expired') map.set(t.ticker.toUpperCase(), t.id)
  return map
}

export type ChatPart = { kind: 'text'; text: string } | { kind: 'ticker'; text: string; tokenId: string }

/** Splits a message so `$TICKER` mentions of existing tokens can render as links. */
export function chatParts(text: string, tickers: Map<string, string>): ChatPart[] {
  const parts: ChatPart[] = []
  let last = 0
  for (const m of text.matchAll(/\$([A-Za-z0-9]{2,10})\b/g)) {
    const tokenId = tickers.get(m[1].toUpperCase())
    if (!tokenId) continue
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) })
    parts.push({ kind: 'ticker', text: m[0], tokenId })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
