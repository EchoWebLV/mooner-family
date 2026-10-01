// State transitions shared by the simulator, the seed and the store.
// Every function mutates the world/token it is given: call them on plain
// objects (seed) or on immer drafts (step, store actions).
import { enableArrayMethods } from 'immer'
import {
  CANDLE_MS, CURVE_TOKENS_FOR_SALE, LAMPORTS_PER_SOL, MAX_CANDLES, MAX_CHAT, MAX_HISTORY, MAX_TRADES,
  PRESALE_TARGET, XP_LIVE, XP_MIGRATION,
} from './constants'
import {
  applyBuy, applySell, initialCurvePool, migrationPool, presaleAllocation, quoteBuy, quoteSell,
  spotPrice,
} from './curve'
import { progressFor } from './levels'
import { isFull, participantOf } from './presale'
import type { Rng } from './rng'
import type { Lamports, Participant, Title, Token, TokenLinks, Trade, World, WorldEvent } from './types'

// Lets push/splice/filter/find on drafts skip creating a proxy per element.
enableArrayMethods()

export function nextId(w: World, prefix: string): string {
  w.seq += 1
  return prefix + w.seq.toString(36)
}

export function pushCapped<T>(list: T[], item: T, cap: number): void {
  list.push(item)
  if (list.length > cap) list.splice(0, list.length - cap)
}

export function postChat(w: World, channel: string, userId: string, text: string, at: number): void {
  const list = (w.chat[channel] ??= [])
  pushCapped(list, { id: nextId(w, 'm'), channel, userId, text, at }, MAX_CHAT)
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** A mock contract address. */
export function randomAddress(rng: Rng): string {
  let s = ''
  for (let i = 0; i < 40; i++) s += B58[rng.int(0, B58.length - 1)]
  return s + 'moon'
}

export function randomInviteCode(rng: Rng): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[rng.int(0, chars.length - 1)]
  return s
}

// ---- presales ----

export interface PresaleSpec {
  creatorId: string
  name: string
  ticker: string
  description: string
  /** The meme a bot's coin is named after (see Token.meme). */
  meme?: string
  links: TokenLinks
  visibility: 'public' | 'private'
  minutes: number
  /** The creator's commit, already clamped to the allowed range. */
  commit: Lamports
  /** Join pace for the simulator, 0..1. */
  heat: number
}

/** Opens a presale; the creator commits like everyone else. */
export function openPresale(w: World, rng: Rng, now: number, spec: PresaleSpec): Token {
  const t: Token = {
    id: nextId(w, 't'),
    name: spec.name,
    ticker: spec.ticker,
    description: spec.description,
    meme: spec.meme,
    address: randomAddress(rng),
    links: spec.links,
    creatorId: spec.creatorId,
    stage: 'presale',
    createdAt: now,
    presale: {
      visibility: spec.visibility,
      inviteCode: spec.visibility === 'private' ? randomInviteCode(rng) : undefined,
      participants: [],
      expiresAt: now + spec.minutes * 60_000,
    },
    positions: {},
    costBasis: {},
    candles: [],
    trades: [],
    volumeSol: 0,
    heat: spec.heat,
  }
  w.tokens[t.id] = t
  setPosition(w, w.tokens[t.id], spec.creatorId, spec.commit, now)
  return w.tokens[t.id]
}

/**
 * Joins or changes a position (the caller validated and clamped `commit`). Moves the
 * demo user's SOL, and starts the launch the moment the pool reaches PRESALE_TARGET.
 */
export function setPosition(w: World, t: Token, userId: string, commit: Lamports, now: number): void {
  const p = t.presale
  const current = participantOf(p, userId)
  const delta = commit - (current?.commit ?? 0)
  if (current) current.commit = commit
  else p.participants.push({ userId, commit, joinedAt: now })
  if (userId === w.meId) w.walletLamports -= delta
  if (isFull(p)) {
    t.stage = 'launching'
    p.launchStartedAt = now
  }
}

/** Removes a position and refunds it. */
export function withdrawPosition(w: World, t: Token, userId: string): Participant | undefined {
  const p = t.presale
  const i = p.participants.findIndex((x) => x.userId === userId)
  if (i < 0) return undefined
  const [removed] = p.participants.splice(i, 1)
  if (userId === w.meId) {
    w.walletLamports += removed.commit
    clearMatchIf(w, t.id)
  }
  return removed
}

// ---- market ----

/** Records a price point in the current 10 s candle (or opens a new one). */
export function addCandlePoint(t: Token, price: number, now: number): void {
  const bucket = Math.floor(now / CANDLE_MS) * CANDLE_MS
  const last = t.candles[t.candles.length - 1]
  if (last && last.t === bucket) {
    last.h = Math.max(last.h, price)
    last.l = Math.min(last.l, price)
    last.c = price
    return
  }
  const open = last ? last.c : price
  pushCapped(
    t.candles,
    { t: bucket, o: open, h: Math.max(open, price), l: Math.min(open, price), c: price },
    MAX_CANDLES,
  )
}

/** Opens a flat candle when a 10 s bucket passes without trades, so the chart stays continuous. */
export function touchCandles(t: Token, now: number): void {
  const last = t.candles[t.candles.length - 1]
  if (!last) return
  const bucket = Math.floor(now / CANDLE_MS) * CANDLE_MS
  if (bucket > last.t) addCandlePoint(t, last.c, now)
}

function recordTrade(w: World, t: Token, trade: Omit<Trade, 'id'>): void {
  pushCapped(t.trades, { id: nextId(w, 'x'), ...trade }, MAX_TRADES)
}

export function awardXp(
  w: World, userId: string, title: Title, amount: number, events: WorldEvent[], tokenId?: string,
): void {
  const user = w.users[userId]
  if (!user) return
  const fromXp = user.titles[title].xp
  user.titles[title] = progressFor(fromXp + amount)
  if (userId === w.meId) events.push({ kind: 'xp', title, fromXp, toXp: fromXp + amount, tokenId })
}

export function clearMatchIf(w: World, tokenId: string): void {
  if (w.match?.tokenId === tokenId) delete w.match
}

function markToMarket(t: Token, tokens: number, commit: Lamports): number {
  if (!t.pool) return 0
  return tokens * spotPrice(t.pool) - commit / LAMPORTS_PER_SOL
}

function upsertMyHistory(w: World, t: Token, outcome: 'live' | 'migrated' | 'expired', commit: Lamports, tokens: number, at: number): void {
  const me = w.users[w.meId]
  const existing = me.history.find((h) => h.tokenId === t.id)
  const pnlSol = outcome === 'expired' ? 0 : markToMarket(t, tokens, commit)
  if (existing) {
    existing.outcome = outcome
    existing.pnlSol = pnlSol
    return
  }
  me.history.unshift({ tokenId: t.id, name: t.name, ticker: t.ticker, commit, tokens, outcome, pnlSol, at })
  if (me.history.length > MAX_HISTORY) me.history.splice(MAX_HISTORY)
}

export interface TradeResult {
  tokens: number
  sol: number
}

/** Buys on the curve (capped at what's left) or the AMM pool. */
export function executeBuy(w: World, t: Token, userId: string, sol: number, now: number): TradeResult | null {
  if (!t.pool || (t.stage !== 'live' && t.stage !== 'migrated')) return null
  const q = quoteBuy(t.pool, sol, t.stage === 'live')
  if (q.tokensOut <= 0) return null
  const pool = applyBuy(t.pool, q)
  if (t.stage === 'migrated') pool.tokensSold = CURVE_TOKENS_FOR_SALE
  t.pool = pool
  t.positions[userId] = (t.positions[userId] ?? 0) + q.tokensOut
  t.costBasis[userId] = (t.costBasis[userId] ?? 0) + q.solUsed
  t.volumeSol += q.solUsed
  recordTrade(w, t, { at: now, userId, side: 'buy', sol: q.solUsed, tokens: q.tokensOut, price: q.solUsed / q.tokensOut })
  addCandlePoint(t, spotPrice(t.pool), now)
  return { tokens: q.tokensOut, sol: q.solUsed }
}

/** Sells up to the user's position. */
export function executeSell(w: World, t: Token, userId: string, tokens: number, now: number): TradeResult | null {
  if (!t.pool || (t.stage !== 'live' && t.stage !== 'migrated')) return null
  const held = t.positions[userId] ?? 0
  const amount = Math.min(tokens, held)
  if (amount <= 0) return null
  const sol = quoteSell(t.pool, amount)
  const pool = applySell(t.pool, amount, sol)
  pool.tokensSold = t.stage === 'migrated' ? CURVE_TOKENS_FOR_SALE : Math.max(0, pool.tokensSold)
  t.pool = pool
  const left = held - amount
  if (left < 1) {
    delete t.positions[userId]
    delete t.costBasis[userId]
  } else {
    t.positions[userId] = left
    t.costBasis[userId] = (t.costBasis[userId] ?? 0) * (left / held)
  }
  t.volumeSol += sol
  recordTrade(w, t, { at: now, userId, side: 'sell', sol, tokens: amount, price: sol / amount })
  addCandlePoint(t, spotPrice(t.pool), now)
  return { tokens: amount, sol }
}

/** Buy pressure for a freshly launched token: most cool off, a few run hot. */
export function rollHeat(rng: Rng): number {
  return 0.05 + 0.95 * Math.pow(rng.next(), 2.2)
}

// ---- lifecycle ----

/** Settled on Solana: the whole pool is the first buy, at one price for everyone. */
export function launchToken(w: World, t: Token, rng: Rng, now: number, events: WorldEvent[]): void {
  const r = presaleAllocation(t.presale.participants)
  t.stage = 'live'
  t.launchedAt = now
  t.pool = r.pool
  t.allocations = r.allocations
  t.heat = rollHeat(rng)
  addCandlePoint(t, spotPrice(initialCurvePool()), now)
  for (const a of r.allocations) {
    const sol = a.commit / LAMPORTS_PER_SOL
    t.positions[a.userId] = (t.positions[a.userId] ?? 0) + a.tokens
    t.costBasis[a.userId] = (t.costBasis[a.userId] ?? 0) + sol
    recordTrade(w, t, { at: now, userId: a.userId, side: 'buy', sol, tokens: a.tokens, price: r.price })
    awardXp(w, a.userId, 'diamond', XP_LIVE, events, t.id)
  }
  t.volumeSol += PRESALE_TARGET / LAMPORTS_PER_SOL
  addCandlePoint(t, spotPrice(t.pool), now)
  const mine = r.allocations.find((a) => a.userId === w.meId)
  if (mine) {
    events.push({ kind: 'live', tokenId: t.id })
    upsertMyHistory(w, t, 'live', mine.commit, mine.tokens, now)
  }
  clearMatchIf(w, t.id)
}

/** Curve sold out: seed the AMM pool; everyone still holding earns Diamond Hands XP. */
export function migrateToken(w: World, t: Token, now: number, events: WorldEvent[]): void {
  if (!t.pool) return
  t.stage = 'migrated'
  t.migratedAt = now
  t.pool = migrationPool(t.pool)
  t.heat *= 0.6
  for (const userId of Object.keys(t.positions)) awardXp(w, userId, 'diamond', XP_MIGRATION, events, t.id)
  if ((t.positions[w.meId] ?? 0) > 0) events.push({ kind: 'migrated', tokenId: t.id })
  const mine = t.allocations?.find((a) => a.userId === w.meId)
  if (mine) upsertMyHistory(w, t, 'migrated', mine.commit, mine.tokens, now)
}

/** The timer ran out before the pool filled: everyone is refunded. */
export function expireToken(w: World, t: Token, now: number, events: WorldEvent[]): void {
  const mine = participantOf(t.presale, w.meId)
  t.stage = 'expired'
  t.expiredAt = now
  if (mine) {
    w.walletLamports += mine.commit
    events.push({ kind: 'expired', tokenId: t.id, refund: mine.commit })
    upsertMyHistory(w, t, 'expired', mine.commit, 0, now)
  }
  clearMatchIf(w, t.id)
}
