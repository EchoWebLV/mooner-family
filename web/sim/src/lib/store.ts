// The client store (spec §7.5): the world, the simulator tick, user actions, and the
// toast and level-up queues. Actions validate through presale.ts / curve.ts / launch.ts
// and return an error message rather than throwing.
import { produce } from 'immer'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  COMMIT_STEP, MATCH_PRESALE_MINUTES, MAX_CHAT_LENGTH, MAX_COMMIT, MIN_COMMIT, SEED, TICK_MS, TOAST_MS,
  XP_X_ACTIVITY,
} from './constants'
import { isSoldOut, quoteBuy, quoteSell } from './curve'
import {
  awardXp, executeBuy, executeSell, migrateToken, openPresale, postChat, setPosition, withdrawPosition,
} from './engine'
import { fmtSol, solToLamports } from './format'
import { cleanLinks, hasErrors, normalizeTicker, validateLaunch, type LaunchForm } from './launch'
import { levelForXp, TITLE_NAMES, X_TITLES, xpProgress } from './levels'
import { DEFAULT_PFP, keepUnlocked, lockedTraits, sanitizePfp, unlockText } from './pfp/traits'
import { canAfford, canChange, canJoin, canWithdraw, clampCommit, participantOf, pickMatch } from './presale'
import { createRng, type Rng } from './rng'
import { createSeedWorld } from './sim/seed'
import { spawnPresale, step } from './sim/step'
import type { Lamports, Level, Pfp, Title, TitleStats, World, WorldEvent } from './types'

export interface Toast {
  id: number
  tone: 'info' | 'good' | 'bad'
  text: string
  href?: string
  /** World time it was raised; it goes after TOAST_MS. */
  at: number
}

export interface LevelUp {
  id: number
  title: Title
  level: Level
  fromXp: number
  toXp: number
  /** The launch that paid the XP: the overlay waits until you leave its presale page. */
  tokenId?: string
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface TradeDone {
  tokens: number
  sol: number
}

export interface AppState {
  world: World
  toasts: Toast[]
  levelUps: LevelUp[]
  /** Rail filter from the top bar. */
  search: string
  /** The global chat on Pulse, folded away to give the rails the room. */
  chatHidden: boolean
  /** Signed in, you wear your own Mooner; signed out, you're the plain moon. */
  signedIn: boolean
  /** The sign-in dialog, where your first Mooner is rolled. */
  signInOpen: boolean
  tick(dtMs?: number): void
  findMatch(amount: Lamports): Result<{ tokenId: string }>
  joinPresale(tokenId: string, amount: Lamports, inviteCode?: string): Result
  changeCommit(tokenId: string, amount: Lamports): Result
  withdraw(tokenId: string): Result
  sendChat(channel: string, text: string): Result
  buy(tokenId: string, sol: number): Result<TradeDone>
  sell(tokenId: string, tokens: number): Result<TradeDone>
  createLaunch(form: LaunchForm): Result<{ tokenId: string }>
  simulateXActivity(title: Title): Result
  simulateLevelUp(title: Title): Result
  /** A toast for the result of something the user did. */
  notify(tone: Toast['tone'], text: string, href?: string): void
  dismissToast(id: number): void
  dismissLevelUp(): void
  setSearch(query: string): void
  setChatHidden(hidden: boolean): void
  openSignIn(): void
  closeSignIn(): void
  /** Signs in wearing this Mooner. Every trait must be unlocked. */
  signIn(pfp: Pfp): Result
  /** Changes your Mooner. Every trait must be unlocked. */
  setPfp(pfp: Pfp): Result
  signOut(): void
}

/** A returning player, from the browser's storage. */
export interface Session {
  pfp: Pfp
}

export type AppStore = StoreApi<AppState>

const MAX_TOASTS = 4

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

/** X-driven stats move a little with each simulated burst of activity. */
function bumpStats(stats: TitleStats, title: Title, rng: Rng): void {
  if (title === 'kol') stats.kol.followers += rng.int(40, 400)
  if (title === 'shiller') {
    stats.shiller.posts += rng.int(1, 4)
    stats.shiller.impressions += rng.int(2_000, 20_000)
  }
  if (title === 'raider') stats.raider.raids += rng.int(1, 3)
}

export function createAppStore(
  world: World = createSeedWorld(),
  rng: Rng = createRng(SEED + 1),
  session?: Session,
): AppStore {
  let uiId = 0
  if (session) {
    // The demo world starts over on every visit, so traits unlocked last time may be locked again.
    world = produce(world, (w) => {
      const me = w.users[w.meId]
      me.pfp = keepUnlocked(sanitizePfp(session.pfp), me.titles)
    })
  }

  return createStore<AppState>()((set, get) => {
    /** Turns world events into toasts and level-ups, and drops toasts that have run their time. */
    function react(s: AppState, w: World, events: WorldEvent[]): Pick<AppState, 'toasts' | 'levelUps'> {
      let toasts = s.toasts.filter((t) => w.now - t.at < TOAST_MS)
      let levelUps = s.levelUps
      const toast = (tone: Toast['tone'], text: string, href?: string) => {
        toasts = [...toasts, { id: ++uiId, tone, text, href, at: w.now }].slice(-MAX_TOASTS)
      }
      const ticker = (id: string) => (w.tokens[id] ? '$' + w.tokens[id].ticker : 'A presale')
      for (const e of events) {
        if (e.kind === 'expired') toast('bad', `${ticker(e.tokenId)} expired — ${fmtSol(e.refund)} SOL refunded`, `/presale/${e.tokenId}`)
        else if (e.kind === 'live') toast('good', `${ticker(e.tokenId)} is live on Solana — your allocation is in`, `/token/${e.tokenId}`)
        else if (e.kind === 'migrated') toast('good', `${ticker(e.tokenId)} migrated to its AMM pool`, `/token/${e.tokenId}`)
        else {
          const level = levelForXp(e.toXp)
          if (level > levelForXp(e.fromXp)) {
            levelUps = [...levelUps, { id: ++uiId, title: e.title, level, fromXp: e.fromXp, toXp: e.toXp, tokenId: e.tokenId }]
          } else toast('info', `+${e.toXp - e.fromXp} XP · ${TITLE_NAMES[e.title]}`)
        }
      }
      return { toasts, levelUps }
    }

    /** Applies a change to the world and reacts to what it caused. */
    function change(recipe: (w: World, events: WorldEvent[]) => void): void {
      const events: WorldEvent[] = []
      const next = produce(get().world, (w) => {
        recipe(w, events)
      })
      set((s) => ({ world: next, ...react(s, next, events) }))
    }

    /** Checks a Mooner against your titles, then puts it on. */
    function wear(pfp: Pfp): Result {
      const w = get().world
      const clean = sanitizePfp(pfp)
      const locked = lockedTraits(clean, w.users[w.meId].titles)
      if (locked.length) return fail(`${locked[0].name} unlocks at ${unlockText(locked[0])}`)
      change((d) => {
        d.users[d.meId].pfp = clean
      })
      return { ok: true }
    }

    return {
      world,
      toasts: [],
      levelUps: [],
      search: '',
      chatHidden: false,
      signedIn: !!session,
      signInOpen: false,

      tick(dtMs = TICK_MS) {
        const { world: next, events } = step(get().world, rng, dtMs)
        set((s) => ({ world: next, ...react(s, next, events) }))
      },

      findMatch(amount) {
        const w = get().world
        const value = Math.round(amount / COMMIT_STEP) * COMMIT_STEP
        if (value < MIN_COMMIT || value > MAX_COMMIT) return fail(`Pick ${fmtSol(MIN_COMMIT)}–${fmtSol(MAX_COMMIT)} SOL`)
        const afford = canAfford(w.walletLamports, value)
        if (!afford.ok) return fail(afford.reason!)
        let tokenId = ''
        change((d) => {
          const picked = pickMatch(d, d.meId, value)
          // Nothing can take the full amount: a bot opens a fresh public presale for it.
          const t = picked
            ? d.tokens[picked]
            : spawnPresale(d, rng, d.now, { visibility: 'public', minutes: MATCH_PRESALE_MINUTES })
          setPosition(d, t, d.meId, value, d.now)
          d.match = { tokenId: t.id, queuedAt: d.now }
          tokenId = t.id
        })
        return { ok: true, tokenId }
      },

      joinPresale(tokenId, amount, inviteCode) {
        const w = get().world
        const t = w.tokens[tokenId]
        if (!t) return fail('Presale not found')
        const check = canJoin(t, w.meId, inviteCode)
        if (!check.ok) return fail(check.reason!)
        const value = clampCommit(t.presale, w.meId, amount)
        const afford = canAfford(w.walletLamports, value)
        if (!afford.ok) return fail(afford.reason!)
        change((d) => setPosition(d, d.tokens[tokenId], d.meId, value, d.now))
        return { ok: true }
      },

      changeCommit(tokenId, amount) {
        const w = get().world
        const t = w.tokens[tokenId]
        if (!t) return fail('Presale not found')
        const check = canChange(t, w.meId)
        if (!check.ok) return fail(check.reason!)
        const value = clampCommit(t.presale, w.meId, amount)
        const current = participantOf(t.presale, w.meId)!.commit
        if (value === current) return { ok: true }
        const afford = canAfford(w.walletLamports, value - current)
        if (!afford.ok) return fail(afford.reason!)
        change((d) => setPosition(d, d.tokens[tokenId], d.meId, value, d.now))
        return { ok: true }
      },

      withdraw(tokenId) {
        const w = get().world
        const t = w.tokens[tokenId]
        if (!t) return fail('Presale not found')
        const check = canWithdraw(t, w.meId)
        if (!check.ok) return fail(check.reason!)
        change((d) => {
          withdrawPosition(d, d.tokens[tokenId], d.meId)
        })
        return { ok: true }
      },

      sendChat(channel, text) {
        const body = text.trim().slice(0, MAX_CHAT_LENGTH)
        if (!body) return fail('Type a message first')
        if (channel !== 'global' && !get().world.tokens[channel]) return fail('This chat is closed')
        change((d) => postChat(d, channel, d.meId, body, d.now))
        return { ok: true }
      },

      buy(tokenId, sol) {
        const w = get().world
        const t = w.tokens[tokenId]
        if (!t) return fail('Token not found')
        if (!t.pool || (t.stage !== 'live' && t.stage !== 'migrated')) return fail('Trading opens at launch')
        if (!(sol > 0)) return fail('Enter an amount')
        // On the curve a buy is capped at what's left, and only the SOL needed is charged.
        const q = quoteBuy(t.pool, sol, t.stage === 'live')
        if (q.tokensOut <= 0) return fail('The curve is sold out — migrating')
        const afford = canAfford(w.walletLamports, solToLamports(q.solUsed))
        if (!afford.ok) return fail(afford.reason!)
        change((d, events) => {
          const token = d.tokens[tokenId]
          const r = executeBuy(d, token, d.meId, sol, d.now)
          if (r) d.walletLamports -= solToLamports(r.sol)
          // Your buy took the last tokens on the curve: it graduates now, not on the next tick.
          if (token.stage === 'live' && token.pool && isSoldOut(token.pool)) migrateToken(d, token, d.now, events)
        })
        return { ok: true, tokens: q.tokensOut, sol: q.solUsed }
      },

      sell(tokenId, tokens) {
        const w = get().world
        const t = w.tokens[tokenId]
        if (!t) return fail('Token not found')
        if (!t.pool || (t.stage !== 'live' && t.stage !== 'migrated')) return fail('Trading opens at launch')
        const held = t.positions[w.meId] ?? 0
        if (held <= 0) return fail(`You hold no $${t.ticker}`)
        if (!(tokens > 0)) return fail('Enter an amount')
        const amount = Math.min(tokens, held)
        const sol = quoteSell(t.pool, amount)
        change((d) => {
          const r = executeSell(d, d.tokens[tokenId], d.meId, amount, d.now)
          if (r) d.walletLamports += solToLamports(r.sol)
        })
        return { ok: true, tokens: amount, sol }
      },

      createLaunch(form) {
        const w = get().world
        const errors = validateLaunch(w, form)
        if (hasErrors(errors)) return fail(Object.values(errors)[0])
        let tokenId = ''
        change((d) => {
          const t = openPresale(d, rng, d.now, {
            creatorId: d.meId,
            name: form.name.trim(),
            ticker: normalizeTicker(form.ticker),
            description: form.description.trim(),
            links: cleanLinks(form.links),
            visibility: form.visibility,
            minutes: form.minutes,
            commit: form.commit,
            heat: rng.range(0.15, 0.25),
          })
          tokenId = t.id
        })
        return { ok: true, tokenId }
      },

      simulateXActivity(title) {
        if (!X_TITLES.includes(title)) return fail(`${TITLE_NAMES[title]} XP comes from on-chain activity`)
        change((d, events) => {
          awardXp(d, d.meId, title, XP_X_ACTIVITY, events)
          bumpStats(d.users[d.meId].stats, title, rng)
        })
        return { ok: true }
      },

      simulateLevelUp(title) {
        const w = get().world
        const xp = w.users[w.meId].titles[title].xp
        const { next } = xpProgress(xp)
        if (next === null) {
          // Already Legendary: replay the moment.
          set((s) => ({ levelUps: [...s.levelUps, { id: ++uiId, title, level: 5, fromXp: xp, toXp: xp }] }))
          return { ok: true }
        }
        change((d, events) => awardXp(d, d.meId, title, next - xp, events))
        return { ok: true }
      },

      notify(tone, text, href) {
        set((s) => ({
          toasts: [...s.toasts, { id: ++uiId, tone, text, href, at: s.world.now }].slice(-MAX_TOASTS),
        }))
      },

      dismissToast(id) {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      },

      dismissLevelUp() {
        set((s) => ({ levelUps: s.levelUps.slice(1) }))
      },

      setSearch(query) {
        set({ search: query })
      },

      setChatHidden(hidden) {
        set({ chatHidden: hidden })
      },

      openSignIn() {
        if (!get().signedIn) set({ signInOpen: true })
      },

      closeSignIn() {
        set({ signInOpen: false })
      },

      signIn(pfp) {
        const done = wear(pfp)
        if (!done.ok) return done
        set({ signedIn: true, signInOpen: false })
        const w = get().world
        get().notify('good', `Welcome to Mooner, @${w.users[w.meId].handle}`)
        return done
      },

      setPfp(pfp) {
        if (!get().signedIn) return fail('Sign in first')
        return wear(pfp)
      },

      signOut() {
        change((d) => {
          d.users[d.meId].pfp = { ...DEFAULT_PFP }
        })
        set({ signedIn: false })
      },
    }
  })
}
