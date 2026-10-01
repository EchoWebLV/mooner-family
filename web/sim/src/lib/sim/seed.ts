// The initial demo world. Deterministic: the same seed always builds the same world.
import {
  COMMIT_STEP, LAUNCH_SETTLE_MS, MAX_COMMIT, MIN_COMMIT, PRESALE_TARGET, SEED, SEED_EPOCH, START_WALLET,
} from '../constants'
import { allocationFor, curveProgress } from '../curve'
import { launchToken, postChat, setPosition } from '../engine'
import { mainTitle, progressFor, TITLES, xpForLevel } from '../levels'
import { commitRange, poolLamports } from '../presale'
import { DEFAULT_PFP, rollPfp } from '../pfp/traits'
import { createRng, hashString, type Rng } from '../rng'
import type { Lamports, LaunchRecord, Level, Title, TitleProgress, Token, User, World, WorldEvent } from '../types'
import { BOT_HANDLES, GLOBAL_LINES, PRESALE_LINES, TITLE_LINES, TOKEN_IDEAS, TOKEN_LINES } from './personas'
import { botCommit, botIds, spawnPresale, tickMarket } from './step'

export const DEMO_START_XP = { kol: 40, diamond: 760, shiller: 120, raider: 250 } as const

function round(n: number, d: number): number {
  const f = 10 ** d
  return Math.round(n * f) / f
}

function makeDemoUser(): User {
  return {
    id: 'me',
    handle: 'you',
    isBot: false,
    // Signing in rolls the real one.
    pfp: { ...DEFAULT_PFP },
    titles: {
      kol: progressFor(DEMO_START_XP.kol),
      diamond: progressFor(DEMO_START_XP.diamond),
      shiller: progressFor(DEMO_START_XP.shiller),
      raider: progressFor(DEMO_START_XP.raider),
    },
    stats: {
      kol: { followers: 1_240, engagementPct: 2.1, callWinPct: 38 },
      diamond: { avgHoldHours: 41.5, heldToMigrationPct: 72, earlyDumps: 1 },
      shiller: { posts: 64, impressions: 88_400, topPostViews: 12_900 },
      raider: { raids: 23, actionsPerRaid: 6.4, replySpeedSec: 38 },
    },
    history: [],
  }
}

/** Odds of a bot's main level, I to V: most sit in the middle and legends are rare. */
const MAIN_LEVEL_ODDS = [0.2, 0.3, 0.26, 0.16, 0.08] as const
/** Top of the XP range a seeded level-V bot can start with. */
const SEED_XP_CAP = 2_600

/** One main title at a level drawn from MAIN_LEVEL_ODDS; the other three trail it. */
function botTitles(rng: Rng): Record<Title, TitleProgress> {
  const main = rng.pick(TITLES)
  let r = rng.next()
  let level: Level = 5
  for (let i = 0; i < MAIN_LEVEL_ODDS.length; i++) {
    if (r < MAIN_LEVEL_ODDS[i]) {
      level = (i + 1) as Level
      break
    }
    r -= MAIN_LEVEL_ODDS[i]
  }
  const ceiling = level < 5 ? xpForLevel((level + 1) as Level) : SEED_XP_CAP
  const mainXp = rng.int(xpForLevel(level), ceiling - 1)
  const titles = {} as Record<Title, TitleProgress>
  for (const t of TITLES) titles[t] = progressFor(t === main ? mainXp : Math.floor(rng.next() * mainXp * 0.8))
  return titles
}

function makeBot(rng: Rng, id: string, handle: string, now: number): User {
  const history: LaunchRecord[] = []
  const n = rng.int(2, 7)
  for (let i = 0; i < n; i++) {
    const idea = rng.pick(TOKEN_IDEAS)
    const commit = rng.int(MIN_COMMIT / COMMIT_STEP, MAX_COMMIT / COMMIT_STEP) * COMMIT_STEP
    const outcome = rng.pick<LaunchRecord['outcome']>(['migrated', 'live', 'expired', 'migrated'])
    history.push({
      tokenId: `past-${id}-${i}`,
      name: idea.name,
      ticker: idea.ticker,
      commit,
      tokens: outcome === 'expired' ? 0 : allocationFor(commit),
      outcome,
      pnlSol: outcome === 'expired' ? 0 : round(rng.range(-0.8, 3) * (commit / 1e9), 3),
      at: now - rng.int(1, 240) * 3_600_000,
    })
  }
  history.sort((a, b) => b.at - a.at)
  const titles = botTitles(rng)
  return {
    id,
    handle,
    isBot: true,
    // Its own stream, so the world's draws stay as they were: the same handle always gets the same Mooner.
    pfp: rollPfp(createRng(hashString('pfp:' + handle)), titles),
    titles,
    stats: {
      kol: {
        followers: Math.floor(Math.pow(rng.next(), 3) * 180_000) + 200,
        engagementPct: round(rng.range(0.5, 6), 1),
        callWinPct: Math.round(rng.range(20, 75)),
      },
      diamond: {
        avgHoldHours: round(rng.range(0.2, 96), 1),
        heldToMigrationPct: Math.round(rng.range(5, 90)),
        earlyDumps: rng.int(0, 12),
      },
      shiller: {
        posts: rng.int(5, 900),
        impressions: Math.floor(Math.pow(rng.next(), 2) * 2_000_000),
        topPostViews: Math.floor(Math.pow(rng.next(), 2) * 400_000),
      },
      raider: {
        raids: rng.int(0, 300),
        actionsPerRaid: round(rng.range(1, 14), 1),
        replySpeedSec: rng.int(4, 240),
      },
    },
    history,
  }
}

/**
 * Bots join until the pool holds exactly `target` lamports, with join times spread
 * between `from` and `to`. A target below PRESALE_TARGET never starts the launch.
 */
function fillTo(w: World, t: Token, rng: Rng, target: Lamports, from: number, to: number): void {
  const p = t.presale
  for (let i = 0; target - poolLamports(p) >= MIN_COMMIT; i++) {
    const inside = new Set(p.participants.map((x) => x.userId))
    const outside = botIds(w).filter((id) => !inside.has(id))
    if (outside.length === 0) throw new Error(`seed ran out of bots for ${t.ticker}`)
    const userId = rng.pick(outside)
    const { min, max } = commitRange(p, userId)
    const at = from + Math.floor((to - from) * Math.min(1, (i + 1) / 40))
    setPosition(w, t, userId, Math.min(botCommit(rng, min, max), target - poolLamports(p)), at)
  }
  // Under 0.1 SOL short: someone already in tops up the difference.
  const left = target - poolLamports(p)
  if (left <= 0) return
  const bumpable = p.participants.filter((x) => x.userId !== w.meId && x.commit + left <= MAX_COMMIT)
  if (bumpable.length === 0) return
  const x = rng.pick(bumpable)
  setPosition(w, t, x.userId, x.commit + left, to)
}

function seedMarketToken(w: World, rng: Rng, now: number, kind: 'live' | 'migrated', events: WorldEvent[]): void {
  const launchedAt = kind === 'live' ? now - rng.int(3, 25) * 60_000 : now - rng.int(25, 70) * 60_000
  const t = spawnPresale(w, rng, launchedAt - rng.int(60, 240) * 1000, { visibility: 'public' })
  const settleAt = launchedAt - LAUNCH_SETTLE_MS
  fillTo(w, t, rng, PRESALE_TARGET, t.createdAt, settleAt)
  if (poolLamports(t.presale) !== PRESALE_TARGET) throw new Error(`seed could not fill ${t.ticker}`)
  t.presale.launchStartedAt = settleAt
  launchToken(w, t, rng, launchedAt, events)
  const target = kind === 'live' ? rng.range(0.08, 0.92) : 1
  const endAt = kind === 'live' ? now : launchedAt + rng.int(8, 20) * 60_000
  t.heat = 0.5
  for (let ts = launchedAt + 1000; ts <= now; ts += 1000) {
    if (t.stage === 'live' && t.pool) {
      const want = target * Math.pow(Math.min(1, (ts - launchedAt) / (endAt - launchedAt)), 0.85)
      const behind = curveProgress(t.pool) < want
      tickMarket(w, t, rng, ts, events, behind ? { tradeProb: 0.9, buyProb: 1 } : { tradeProb: 0.35, buyProb: 0.3 })
    } else {
      tickMarket(w, t, rng, ts, events)
    }
  }
  t.heat = t.stage === 'live' ? 0.1 + 0.9 * Math.pow(rng.next(), 1.4) : rng.range(0.05, 0.35)
}

function seedPresale(w: World, rng: Rng, now: number, target: Lamports): Token {
  const t = spawnPresale(w, rng, now - rng.int(10, 150) * 1000)
  t.presale.expiresAt = Math.max(t.presale.expiresAt, now + rng.int(90, 420) * 1000)
  fillTo(w, t, rng, target, t.createdAt, now)
  return t
}

function seedChat(w: World, rng: Rng, now: number): void {
  const bots = botIds(w)
  const tokens = Object.values(w.tokens)
  let at = now - 4 * 60_000
  for (let i = 0; i < 40; i++) {
    at += rng.int(2, 9) * 1000
    const bot = w.users[rng.pick(bots)]
    const t = rng.pick(tokens)
    const lines = rng.chance(0.35) ? TITLE_LINES[mainTitle(bot.titles)] : GLOBAL_LINES
    const text = rng.pick(lines).replaceAll('{t}', '$' + t.ticker).replaceAll('{n}', String(rng.int(12, 99)))
    postChat(w, 'global', bot.id, text, Math.min(at, now))
  }
  for (const t of tokens) {
    const speakers = t.pool ? Object.keys(t.positions) : t.presale.participants.map((x) => x.userId)
    if (speakers.length === 0) continue
    const lines = t.pool ? TOKEN_LINES.filter((l) => !l.includes('{p}')) : PRESALE_LINES
    const count = rng.int(2, 6)
    for (let i = 0; i < count; i++) {
      postChat(w, t.id, rng.pick(speakers), rng.pick(lines), now - (count - i) * rng.int(5, 40) * 1000)
    }
  }
}

/** A multiple of COMMIT_STEP, so the pool stays on the 0.01 SOL grid. */
function onGrid(lamports: number): Lamports {
  return Math.floor(lamports / COMMIT_STEP) * COMMIT_STEP
}

export function createSeedWorld(seed: number = SEED): World {
  const rng = createRng(seed)
  const now = SEED_EPOCH
  const w: World = {
    now,
    seq: 0,
    meId: 'me',
    walletLamports: START_WALLET,
    users: { me: makeDemoUser() },
    tokens: {},
    chat: { global: [] },
  }
  BOT_HANDLES.forEach((handle, i) => {
    w.users['b' + i] = makeBot(rng, 'b' + i, handle, now)
  })
  const events: WorldEvent[] = []
  // These launches are the bots' past, which the XP they were made with already covers:
  // replaying them through the engine must not pay Diamond Hands XP a second time.
  const titles = new Map(Object.values(w.users).map((u) => [u.id, { ...u.titles }]))
  for (let i = 0; i < 8; i++) seedMarketToken(w, rng, now, 'migrated', events)
  for (let i = 0; i < 10; i++) seedMarketToken(w, rng, now, 'live', events)
  for (const u of Object.values(w.users)) u.titles = titles.get(u.id)!
  for (const fill of [0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0]) seedPresale(w, rng, now, onGrid(fill * PRESALE_TARGET))
  // One presale is about to launch: 0.1–0.2 SOL left, and slow enough to leave that gap for the user.
  const hot = seedPresale(w, rng, now, PRESALE_TARGET - rng.int(MIN_COMMIT / COMMIT_STEP, (2 * MIN_COMMIT) / COMMIT_STEP) * COMMIT_STEP)
  hot.presale.visibility = 'public'
  delete hot.presale.inviteCode
  hot.presale.expiresAt = Math.max(hot.presale.expiresAt, now + 6 * 60_000)
  hot.heat = 0.01
  seedChat(w, rng, now)
  return w
}
