// The simulator: bots open and join presales, trade and chat.
// step() is pure — same world + same rng state in, same world out.
import { isDraft, original, produce } from 'immer'
import {
  BOT_PRESALE_MINUTES, COMMIT_STEP, EXPIRED_PRUNE_MS, LAUNCH_SETTLE_MS, MAX_COMMIT, MAX_CREATOR_COMMIT,
  MAX_OPEN_PRESALES, MAX_TOKENS_PER_STAGE, MIN_COMMIT, MIN_OPEN_PRESALES,
} from '../constants'
import { curveProgress, isSoldOut } from '../curve'
import {
  clearMatchIf, executeBuy, executeSell, expireToken, launchToken, migrateToken, openPresale, postChat,
  setPosition, touchCandles, withdrawPosition,
} from '../engine'
import { fmtPct } from '../format'
import { TICKER_MAX } from '../launch'
import { mainTitle } from '../levels'
import { commitRange, participantOf } from '../presale'
import type { Rng } from '../rng'
import type { Lamports, Token, World, WorldEvent } from '../types'
import { GLOBAL_LINES, PRESALE_LINES, TITLE_LINES, TOKEN_IDEAS, TOKEN_LINES, type TokenIdea } from './personas'

export interface StepResult {
  world: World
  events: WorldEvent[]
}

export function step(world: World, rng: Rng, dtMs: number): StepResult {
  const events: WorldEvent[] = []
  const next = produce(world, (w) => {
    advance(w, rng, dtMs, events)
  })
  return { world: next, events }
}

/** Mutating version of step(), used on drafts and while seeding. */
export function advance(w: World, rng: Rng, dtMs: number, events: WorldEvent[]): void {
  w.now += dtMs
  const now = w.now
  for (const id of Object.keys(w.tokens)) {
    const t = w.tokens[id]
    if (t.stage === 'presale') tickPresale(w, t, rng, now, events)
    else if (t.stage === 'launching') {
      if (now - (t.presale.launchStartedAt ?? now) >= LAUNCH_SETTLE_MS) launchToken(w, t, rng, now, events)
    } else if (t.stage === 'live' || t.stage === 'migrated') tickMarket(w, t, rng, now, events)
  }
  maintainPresales(w, rng, now)
  botChat(w, rng, now)
  prune(w, now)
}

// ---- bots ----

/** Every user except the demo user is a bot. */
export function botIds(w: World): string[] {
  const me = w.meId
  // Users are only ever created by the seed, so the pre-draft object has every id
  // (and listing its keys skips a proxy trap per user).
  const users = isDraft(w.users) ? original(w.users)! : w.users
  return Object.keys(users).filter((id) => id !== me)
}

/**
 * Mostly small commits, a few big ones — snapped to 0.01 SOL and kept inside [min, max].
 * Shares of MAX_COMMIT: 70% at 0.1–0.4 (0.05–0.2 SOL with a 0.5 SOL max, the ones under the
 * 0.1 SOL minimum raised to it), 22% at 0.4–1 (0.2–0.5 SOL), 8% at 1–2, cut to the max.
 */
export function botCommit(rng: Rng, min: Lamports, max: Lamports): Lamports {
  const r = rng.next()
  const share = r < 0.7 ? rng.range(0.1, 0.4) : r < 0.92 ? rng.range(0.4, 1) : rng.range(1, 2)
  const snapped = Math.floor((share * MAX_COMMIT) / COMMIT_STEP) * COMMIT_STEP
  return Math.min(max, Math.max(min, snapped))
}

/** Bots that haven't joined this presale yet. */
function botsOutside(w: World, t: Token): string[] {
  const inside = new Set(t.presale.participants.map((x) => x.userId))
  return botIds(w).filter((id) => !inside.has(id))
}

/** A random bot that isn't in yet joins with an amount inside its range. */
export function botJoin(w: World, t: Token, rng: Rng, now: number): boolean {
  if (t.stage !== 'presale') return false
  const outside = botsOutside(w, t)
  if (outside.length === 0) return false
  const userId = rng.pick(outside)
  const { min, max } = commitRange(t.presale, userId)
  setPosition(w, t, userId, botCommit(rng, min, max), now)
  return true
}

function tickPresale(w: World, t: Token, rng: Rng, now: number, events: WorldEvent[]): void {
  const p = t.presale
  if (now >= p.expiresAt) {
    expireToken(w, t, now, events)
    return
  }
  // Now and then a bot changes its mind. Creators can change but never withdraw.
  if (rng.chance(0.004)) {
    const leavers = p.participants.filter((x) => x.userId !== w.meId && x.userId !== t.creatorId)
    if (leavers.length) withdrawPosition(w, t, rng.pick(leavers).userId)
  }
  if (rng.chance(0.008)) {
    const movers = p.participants.filter((x) => x.userId !== w.meId)
    if (movers.length) {
      const userId = rng.pick(movers).userId
      const { min, max } = commitRange(p, userId)
      setPosition(w, t, userId, botCommit(rng, min, max), now)
    }
  }
  if (rng.chance(t.heat)) botJoin(w, t, rng, now)
}

export interface MarketBias {
  tradeProb: number
  buyProb: number
}

function botTrade(w: World, t: Token, rng: Rng, now: number, buyProb: number, bots: string[]): void {
  const me = w.meId
  const sellers = Object.keys(t.positions).filter((id) => id !== me)
  if (sellers.length === 0 || rng.chance(buyProb)) {
    const sol = Math.round((0.03 + Math.pow(rng.next(), 2) * 2.2) * (0.5 + t.heat) * 1000) / 1000
    executeBuy(w, t, rng.pick(bots), sol, now)
    return
  }
  const seller = rng.pick(sellers)
  // Diamond Hands mostly hold.
  if (mainTitle(w.users[seller].titles) === 'diamond' && rng.chance(0.8)) return
  const fraction = rng.chance(0.35) ? 1 : rng.range(0.15, 0.7)
  executeSell(w, t, seller, (t.positions[seller] ?? 0) * fraction, now)
}

export function tickMarket(w: World, t: Token, rng: Rng, now: number, events: WorldEvent[], bias?: MarketBias): void {
  if (!bias) {
    const bump = rng.chance(0.004) ? rng.range(0.15, 0.45) : 0
    t.heat = Math.min(1, Math.max(0.02, t.heat * 0.994 + bump))
  }
  const live = t.stage === 'live'
  const tradeProb = bias?.tradeProb ?? (live ? 0.12 + 0.78 * t.heat : 0.05 + 0.35 * t.heat)
  const buyProb = bias?.buyProb ?? 0.3 + 0.42 * t.heat
  if (rng.chance(tradeProb)) {
    const bots = botIds(w)
    botTrade(w, t, rng, now, buyProb, bots)
    if (rng.chance(t.heat * 0.4)) botTrade(w, t, rng, now, buyProb, bots)
  }
  touchCandles(t, now)
  if (live && t.pool && isSoldOut(t.pool)) migrateToken(w, t, now, events)
}

// ---- presales ----

/** Once every meme has a coin, spin-offs, the way memecoins multiply: Baby Pepe, Based Doge… */
const SPINOFFS = ['Baby', 'Based', 'Mini', 'Super', 'Mega', 'Golden']

export function pickIdea(w: World, rng: Rng): TokenIdea {
  const used = new Set(Object.values(w.tokens).map((t) => t.ticker))
  const free = TOKEN_IDEAS.filter((i) => !used.has(i.ticker))
  if (free.length) return rng.pick(free)
  for (const prefix of SPINOFFS) {
    const spinoffs = TOKEN_IDEAS.map((i) => ({
      ...i,
      meme: i.ticker,
      name: `${prefix} ${i.name}`,
      ticker: (prefix.toUpperCase() + i.ticker).slice(0, TICKER_MAX),
    })).filter((i) => !used.has(i.ticker))
    if (spinoffs.length) return rng.pick(spinoffs)
  }
  const base = rng.pick(TOKEN_IDEAS)
  for (let n = 2; ; n++) {
    const ticker = base.ticker.slice(0, TICKER_MAX - String(n).length) + n
    if (!used.has(ticker)) return { ...base, meme: base.ticker, name: `${base.name} ${n}`, ticker }
  }
}

export interface SpawnOptions {
  visibility?: 'public' | 'private'
  minutes?: number
}

/** A bot opens a new presale and commits to it. */
export function spawnPresale(w: World, rng: Rng, now: number, opts: SpawnOptions = {}): Token {
  const idea = pickIdea(w, rng)
  return openPresale(w, rng, now, {
    creatorId: rng.pick(botIds(w)),
    name: idea.name,
    ticker: idea.ticker,
    description: idea.description,
    meme: idea.meme ?? idea.ticker,
    // A search for the cashtag: a guessed x.com/<ticker> would open some stranger's account.
    links: { x: `https://x.com/search?q=%24${idea.ticker}` },
    visibility: opts.visibility ?? (rng.chance(0.15) ? 'private' : 'public'),
    minutes: opts.minutes ?? rng.int(BOT_PRESALE_MINUTES.min, BOT_PRESALE_MINUTES.max),
    commit: botCommit(rng, MIN_COMMIT, MAX_CREATOR_COMMIT),
    // At the 0.5 SOL target most presales fill within seconds. The few slow ones take a
    // minute or more, and some of them run out the clock.
    heat: rng.chance(0.1) ? rng.range(0.01, 0.03) : rng.range(0.1, 0.3),
  })
}

function maintainPresales(w: World, rng: Rng, now: number): void {
  let open = 0
  for (const t of Object.values(w.tokens)) if (t.stage === 'presale' || t.stage === 'launching') open++
  if (open < MIN_OPEN_PRESALES || (open < MAX_OPEN_PRESALES && rng.chance(0.03))) spawnPresale(w, rng, now)
}

// ---- chat ----

function fillLine(line: string, rng: Rng, ticker: string, progress: number): string {
  return line
    .replaceAll('{t}', '$' + ticker)
    .replaceAll('{n}', String(rng.int(12, 99)))
    .replaceAll('{p}', fmtPct(progress, 0))
}

function botChat(w: World, rng: Rng, now: number): void {
  const active = Object.values(w.tokens).filter((t) => t.stage !== 'expired')
  if (active.length && rng.chance(0.3)) {
    const bots = botIds(w)
    const bot = w.users[rng.pick(bots)]
    const lines = rng.chance(0.35) ? TITLE_LINES[mainTitle(bot.titles)] : GLOBAL_LINES
    const t = rng.pick(active)
    postChat(w, 'global', bot.id, fillLine(rng.pick(lines), rng, t.ticker, t.pool ? curveProgress(t.pool) : 0), now)
  }
  for (const t of active) {
    if (t.stage === 'presale' || t.stage === 'launching') {
      if (rng.chance(0.04)) {
        const speakers = t.presale.participants.filter((x) => x.userId !== w.meId)
        if (speakers.length) {
          postChat(w, t.id, rng.pick(speakers).userId, fillLine(rng.pick(PRESALE_LINES), rng, t.ticker, 0), now)
        }
      }
    } else if (t.pool && rng.chance(0.015 + 0.08 * t.heat)) {
      const holders = Object.keys(t.positions).filter((id) => id !== w.meId)
      if (holders.length) {
        const line = t.stage === 'live' ? rng.pick(TOKEN_LINES) : rng.pick(TOKEN_LINES.filter((l) => !l.includes('{p}')))
        postChat(w, t.id, rng.pick(holders), fillLine(line, rng, t.ticker, curveProgress(t.pool)), now)
      }
    }
  }
}

// ---- pruning ----

/** Tokens the demo user holds or has SOL committed to are never pruned. */
function isProtected(w: World, t: Token): boolean {
  if ((t.positions[w.meId] ?? 0) > 0) return true
  return (t.stage === 'presale' || t.stage === 'launching') && !!participantOf(t.presale, w.meId)
}

function lastTradeAt(t: Token): number {
  return t.trades.length ? t.trades[t.trades.length - 1].at : (t.launchedAt ?? t.createdAt)
}

function prune(w: World, now: number): void {
  const doomed: string[] = []
  const live: Token[] = []
  const migrated: Token[] = []
  for (const t of Object.values(w.tokens)) {
    if (t.stage === 'expired') {
      if (now - (t.expiredAt ?? now) > EXPIRED_PRUNE_MS && !isProtected(w, t)) doomed.push(t.id)
    } else if (t.stage === 'live') live.push(t)
    else if (t.stage === 'migrated') migrated.push(t)
  }
  // Beyond the cap, the token with the oldest last trade goes first.
  for (const list of [live, migrated]) {
    const extra = list.length - MAX_TOKENS_PER_STAGE
    if (extra <= 0) continue
    list
      .filter((t) => !isProtected(w, t))
      .sort((a, b) => lastTradeAt(a) - lastTradeAt(b))
      .slice(0, extra)
      .forEach((t) => doomed.push(t.id))
  }
  for (const id of doomed) {
    delete w.tokens[id]
    delete w.chat[id]
    clearMatchIf(w, id)
  }
}
