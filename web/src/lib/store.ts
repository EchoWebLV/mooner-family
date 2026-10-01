// The client store: the world the screens draw, built from the Mooner server's live socket
// (presales, launched coins and their pools, chat, pictures, SOL price, your balance),
// GeckoTerminal and Jupiter (charts, trades, quotes) and the connected wallet. Nothing
// here polls: the server pushes each change. Actions sign with that wallet and return an
// error message rather than throwing.
import { Connection, PublicKey, type SendOptions, type Transaction, type VersionedTransaction } from '@solana/web3.js'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { api } from '@/real/api.js'
import * as chain from '@/real/chain.js'
import * as live from '@/real/live.js'
import { candlesOf, quote, swap, tokenBalance, tradesOf, WSOL } from '@/real/market'
import { COMMIT_STEP, MAX_CHAT_LENGTH, MAX_COMMIT, MAX_CREATOR_COMMIT, MIN_COMMIT, PRESALE_TARGET, setSolUsd, SOL_USD, TOAST_MS } from './constants'
import { priceFromSqrt } from './curve'
import { linkHref, normalizeTicker, notEnoughSol, type LaunchForm, NAME_MAX, TICKER_MAX } from './launch'
import { TITLES } from './levels'
import { DEFAULT_PFP, handlePfp, sanitizePfp } from './pfp/traits'
import { canJoin, pickMatch } from './presale'
import { joinCost, openCost } from '../../../engine/src/flows.js'
import { signIn as engineSignIn } from '../../../engine/src/signin.js'
import { stageOf as viewStage } from '../../../engine/src/views.js'
import type {
  Candle, ChatMessage, Lamports, Level, Participant, Pfp, Stage, Title, TitleProgress, TitleStats, Token, Trade,
  User, World,
} from './types'

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
  tokenId?: string
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface TradeDone {
  tokens: number
  sol: number
}

/** Your seat in a presale, as the chain holds it. `deposit` is the most you can commit. */
export interface MySeat {
  deposit: Lamports
  commit: Lamports
  where: 'home' | 'er'
  settled: boolean
  claimed: boolean
}

/** What the connected wallet can do, pushed in by <WalletBridge>. */
export interface WalletLink {
  publicKey: PublicKey
  signMessage?: (m: Uint8Array) => Promise<Uint8Array>
  signTransaction: <T>(tx: T) => Promise<T>
  sendTransaction: (tx: Transaction | VersionedTransaction, conn: Connection, opts?: SendOptions) => Promise<string>
}

export interface AppState {
  world: World
  toasts: Toast[]
  levelUps: LevelUp[]
  search: string
  chatHidden: boolean
  /** Signed in: the wallet signed the login message; chat and your Mooner are on. */
  signedIn: boolean
  signInOpen: boolean
  /** The server answered at least once. */
  loaded: boolean
  /** The live socket is down (it reconnects on its own). */
  offline: boolean
  wallet: WalletLink | null
  /** Your seats, by presale. */
  mine: Record<string, MySeat>
  /** What a running action is waiting for ("Sign in your wallet…"), or null. */
  step: string | null
  /** Your balance of the coin on the open token page, in whole tokens (null until read). */
  held: Record<string, number>
  /** SOL in USD (Pyth, via the server); also in constants.SOL_USD for the formatters. */
  solUsd: number
  setWallet(w: WalletLink | null): void
  /** <WalletBridge> hands over the wallet picker. */
  setWalletPicker(open: () => void): void
  /** Opens the wallet picker. */
  connectWallet(): void
  /** Subscribes to what every screen shows. Returns the stop function. */
  start(): () => void
  /** Subscribes to the presale or token page being looked at. Returns the stop function. */
  watch(tokenId: string, onRead?: () => void): () => void
  tick(): void
  findMatch(amount: Lamports): Promise<Result<{ tokenId: string }>>
  joinPresale(tokenId: string, amount: Lamports): Promise<Result>
  /** Get my SOL back: out of the pool, out of the ER, and into the wallet, in one go. */
  refundNow(tokenId: string): Promise<Result>
  sendChat(channel: string, text: string): Promise<Result>
  buy(tokenId: string, sol: number): Promise<Result<TradeDone>>
  sell(tokenId: string, tokens: number): Promise<Result<TradeDone>>
  createLaunch(form: LaunchForm, image: Uint8Array): Promise<Result<{ tokenId: string }>>
  notify(tone: Toast['tone'], text: string, href?: string): void
  dismissToast(id: number): void
  dismissLevelUp(): void
  setSearch(query: string): void
  setChatHidden(hidden: boolean): void
  openSignIn(): void
  closeSignIn(): void
  signIn(pfp: Pfp): Promise<Result>
  setPfp(pfp: Pfp): Promise<Result>
  signOut(): void
}

export type AppStore = StoreApi<AppState>

// ---- the server's shapes ----

interface TokenView {
  mint: string
  creator: string
  name: string
  symbol: string
  description: string
  links: { twitter?: string; telegram?: string; website?: string }
  image: string
  createdAt: number
  openedAt: number | null
}

interface SeatView {
  user: string
  deposit: string
  commit: string
  settled: boolean
  claimed: boolean
  creator: boolean
  where: 'home' | 'er'
}

interface PresaleView {
  presale: string
  where: 'home' | 'er' | 'closed'
  state: 'OPEN' | 'FULL' | 'LAUNCHING' | 'SETTLED' | 'EXPIRED' | 'FAILED' | 'CLOSED'
  creator?: string
  validator?: string
  openedTs?: string
  deadlineTs?: string
  fullTs?: string
  raised?: string
  token: TokenView | null
  launch: { at: number; tokens: string } | null
  users?: { user: string; commit: string; creator: boolean }[]
  seats?: SeatView[]
}

interface LaunchedRow {
  presale: string
  mint: string
  token: TokenView
  launch: { at: number; tokens: string; released: string }
  pool: { address: string; quoteReserve: string; sqrtPrice: string; migrated: boolean } | null
}

interface ChatRow {
  id: number
  channel: string
  wallet: string
  text: string
  at: number
}

// ---- helpers ----

const GUEST = 'guest'
const MAX_TOASTS = 4
const PUBLIC = new Connection(chain.PUBLIC_RPC, 'confirmed')
const LOGIN_KEY = (w: string) => `mooner:login:${w}`

const NO_TITLES = Object.fromEntries(TITLES.map((t) => [t, { xp: 0, level: 1 }])) as Record<Title, TitleProgress>
const NO_STATS: TitleStats = {
  kol: { followers: 0, engagementPct: 0, callWinPct: 0 },
  diamond: { avgHoldHours: 0, heldToMigrationPct: 0, earlyDumps: 0 },
  shiller: { posts: 0, impressions: 0, topPostViews: 0 },
  raider: { raids: 0, actionsPerRaid: 0, replySpeedSec: 0 },
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const short = (w: string) => (w.length > 10 ? w.slice(0, 4) + w.slice(-4) : w)
const num = (v: string | number | undefined | null) => (v == null ? 0 : Number(v))

function person(id: string, pfp?: Pfp): User {
  return {
    id,
    handle: id === GUEST ? 'guest' : short(id),
    isBot: false,
    pfp: pfp ?? (id === GUEST ? DEFAULT_PFP : handlePfp(id)),
    titles: NO_TITLES,
    stats: NO_STATS,
    history: [],
  }
}

const stageOf = (v: PresaleView | undefined, l: LaunchedRow | undefined): Stage => viewStage(v, l) as Stage

function loadLogin(wallet: string): { token: string; exp: number } | null {
  try {
    const s = JSON.parse(localStorage.getItem(LOGIN_KEY(wallet)) ?? 'null')
    return s && s.exp > Date.now() ? s : null
  } catch {
    return null
  }
}

/** A live message from the server (real/live.js). */
interface Push<T = unknown> {
  topic: string
  type: 'snapshot' | 'upsert' | 'remove' | 'message' | 'missing' | 'error'
  data: T
}

/** Calls `fn` at once, then at most once per `ms` while asked again; the last ask always runs. */
function pacer(ms: number, fn: () => Promise<unknown>): { ask(): void; stop(): void } {
  let timer = 0
  let busy = false
  let again = false
  let stopped = false
  const run = async () => {
    busy = true
    again = false
    await fn().catch(() => {})
    timer = window.setTimeout(() => {
      busy = false
      if (again && !stopped) run()
    }, ms)
  }
  return {
    ask() {
      if (stopped) return
      if (busy) again = true
      else run()
    },
    stop() {
      stopped = true
      window.clearTimeout(timer)
    },
  }
}

const emptyWorld = (): World => ({
  now: Date.now(),
  seq: 0,
  meId: GUEST,
  walletLamports: 0,
  users: { [GUEST]: person(GUEST) },
  tokens: {},
  chat: {},
})

export function createAppStore(): AppStore {
  let uiId = 0
  // what the server and the APIs said last, by presale
  const views = new Map<string, PresaleView>()
  const launched = new Map<string, LaunchedRow>()
  const markets = new Map<string, { candles: Candle[]; trades: Trade[]; volumeSol: number }>()
  const chats = new Map<string, ChatRow[]>()
  let profiles: Record<string, Pfp> = {}
  // the pages open now: their chart and your balance of the coin, refreshed on pushes
  const watched = new Map<string, { market: ReturnType<typeof pacer>; held: ReturnType<typeof pacer>; traded(r: LaunchedRow): void }>()
  let walletOff: (() => void) | null = null
  let login: { token: string; exp: number } | null = null
  let openModal: () => void = () => {}

  return createStore<AppState>()((set, get) => {
    const me = () => get().wallet?.publicKey.toBase58() ?? null

    /** Builds the world from everything read so far and toasts what changed for you. */
    function rebuild() {
      const prev = get().world
      const wallet = me()
      const meId = wallet ?? GUEST
      const users: Record<string, User> = {}
      const user = (id: string) => (users[id] ??= person(id, profiles[id] && sanitizePfp(profiles[id])))
      user(meId)
      const tokens: Record<string, Token> = {}
      const ids = new Set([...views.keys(), ...launched.keys()])
      for (const id of ids) {
        const v = views.get(id)
        const l = launched.get(id)
        const tv = v?.token ?? l?.token
        if (!tv) continue // a presale the server didn't issue a coin for
        const stage = stageOf(v, l)
        const createdAt = v?.openedTs ? num(v.openedTs) * 1000 : (tv.openedAt ?? tv.createdAt)
        const participants: Participant[] = v?.seats
          ? v.seats
              .filter((s) => num(s.commit) > 0)
              .map((s) => ({ userId: s.user, commit: num(s.commit), joinedAt: createdAt }))
              .sort((a, b) => b.commit - a.commit)
          : (v?.users ?? []).map((u) => ({ userId: u.user, commit: num(u.commit), joinedAt: createdAt }))
        for (const p of participants) user(p.userId)
        const creatorId = v?.creator ?? tv.creator
        user(creatorId)
        const market = markets.get(id)
        for (const t of market?.trades ?? []) user(t.userId)
        const launchAt = l?.launch.at ?? v?.launch?.at
        const pool = l?.pool
        const old = prev.tokens[id]
        tokens[id] = {
          id,
          name: tv.name,
          ticker: tv.symbol,
          description: tv.description,
          meme: tv.image,
          image: tv.image,
          address: tv.mint,
          links: { x: tv.links.twitter, telegram: tv.links.telegram, website: tv.links.website },
          creatorId,
          stage,
          createdAt,
          launchedAt: launchAt,
          // ended at its deadline, or when we saw it go if that was earlier (it failed or closed early)
          expiredAt: stage === 'expired' ? (old?.expiredAt ?? Math.min(v?.deadlineTs ? num(v.deadlineTs) * 1000 : Infinity, Date.now())) : undefined,
          presale: {
            visibility: 'public',
            participants,
            expiresAt: v?.deadlineTs ? num(v.deadlineTs) * 1000 : createdAt + 3_600_000,
            launchStartedAt: v?.fullTs && num(v.fullTs) > 0 ? num(v.fullTs) * 1000 : stage === 'launching' ? (old?.presale.launchStartedAt ?? Date.now()) : undefined,
            raised: v?.raised != null ? num(v.raised) : stage === 'live' || stage === 'migrated' ? PRESALE_TARGET : undefined,
          },
          pool: pool
            ? {
                address: pool.address,
                quoteSol: num(pool.quoteReserve) / 1e9,
                priceSol: priceFromSqrt(BigInt(pool.sqrtPrice)),
                migrated: pool.migrated,
              }
            : undefined,
          allocations: undefined,
          positions: wallet && get().held[id] > 0 ? { [wallet]: get().held[id] } : {},
          costBasis: {},
          candles: market?.candles ?? [],
          trades: market?.trades ?? [],
          volumeSol: market?.volumeSol ?? 0,
          heat: 0,
        }
        // what happened to a presale you're in
        const was = old?.stage
        const inIt = !!wallet && (!!get().mine[id] || participants.some((p) => p.userId === wallet))
        if (old && was !== stage && inIt) {
          if (stage === 'live') get().notify('good', `$${tv.symbol} is live on Solana. Your tokens are on the way.`, `/token/${id}`)
          if (stage === 'expired') get().notify('bad', `$${tv.symbol} ran out of time. Everyone gets their SOL back.`, `/presale/${id}`)
        }
      }
      const chat: Record<string, ChatMessage[]> = {}
      for (const [channel, rows] of chats) {
        chat[channel] = rows.map((r) => {
          user(r.wallet)
          return { id: String(r.id), channel, userId: r.wallet, text: r.text, at: r.at }
        })
      }
      set({ world: { ...prev, now: Date.now(), meId, users, tokens, chat } })
    }

    // ---- what the server pushes (real/live.js) ----

    /** Your seat, from a presale's seats. */
    function setMine(id: string, v: PresaleView) {
      const wallet = me()
      if (!wallet || !v.seats) return
      const s = v.seats.find((x) => x.user === wallet)
      const mine = { ...get().mine }
      if (s) mine[id] = { deposit: num(s.deposit), commit: num(s.commit), where: s.where, settled: s.settled, claimed: s.claimed }
      else delete mine[id]
      set({ mine })
    }

    /** A presale with its seats (its page, or a read before an action). */
    function applyView(id: string, v: PresaleView) {
      views.set(id, v)
      setMine(id, v)
      rebuild()
    }

    /** A presale as the list has it; the seats we have for it stay. */
    function listed(v: PresaleView) {
      const had = views.get(v.presale)
      views.set(v.presale, { ...had, ...v, seats: had?.seats })
    }

    /** A presale that left the list closed: kept, as launched or expired. */
    function closed(id: string) {
      const v = views.get(id)
      if (v && v.state !== 'CLOSED') views.set(id, { ...v, state: 'CLOSED', where: 'closed' })
    }

    function onPresales(m: Push) {
      if (m.type === 'snapshot') {
        const list = m.data as PresaleView[]
        const seen = new Set(list.map((v) => v.presale))
        for (const v of list) listed(v)
        for (const id of views.keys()) if (!seen.has(id)) closed(id)
        set({ loaded: true })
      } else if (m.type === 'upsert') listed(m.data as PresaleView)
      else if (m.type === 'remove') closed((m.data as { presale: string }).presale)
      else return
      rebuild()
    }

    function onLaunched(m: Push) {
      if (m.type === 'snapshot') {
        launched.clear()
        for (const r of m.data as LaunchedRow[]) launched.set(r.presale, r)
      } else if (m.type === 'upsert') {
        const r = m.data as LaunchedRow
        launched.set(r.presale, r)
        watched.get(r.presale)?.traded(r)
      } else return
      for (const [id, w] of watched) if (launched.get(id)?.pool && !markets.has(id)) w.market.ask()
      rebuild()
    }

    const onChat = (channel: string) => (m: Push) => {
      const had = chats.get(channel) ?? []
      if (m.type === 'snapshot') {
        const rows = m.data as ChatRow[]
        const last = rows.length ? rows[rows.length - 1].id : 0
        chats.set(channel, [...rows, ...had.filter((r) => r.id > last)].slice(-200))
      } else if (m.type === 'message') {
        const r = m.data as ChatRow
        if (had.some((x) => x.id === r.id)) return
        chats.set(channel, [...had, r].sort((a, b) => a.id - b.id).slice(-200))
      } else return
      rebuild()
    }

    function onProfiles(m: Push) {
      if (m.type === 'snapshot') profiles = m.data as Record<string, Pfp>
      else if (m.type === 'upsert') {
        const { wallet, pfp } = m.data as { wallet: string; pfp: Pfp }
        profiles = { ...profiles, [wallet]: pfp }
      } else return
      rebuild()
    }

    function onSol(m: Push) {
      const usd = (m.data as { usd?: number } | null)?.usd
      if (m.type !== 'snapshot' || !usd || !(usd > 0)) return
      setSolUsd(usd)
      set({ solUsd: usd })
      rebuild()
    }

    /** Your SOL, pushed as it changes. */
    function followWallet(wallet: string | null) {
      walletOff?.()
      walletOff = wallet
        ? live.subscribe(`wallet:${wallet}`, (m: Push) => {
            if (m.type !== 'snapshot' || me() !== wallet) return
            const lamports = Number((m.data as { lamports: number | string }).lamports)
            set((s) => ({ world: { ...s.world, walletLamports: lamports } }))
            for (const w of watched.values()) w.held.ask() // SOL moved: maybe a trade of this coin
          })
        : null
    }

    /** The pool's price now, as the last one-minute candle (GeckoTerminal fills the rest). */
    function liveCandle(id: string, price: number) {
      const m = markets.get(id)
      if (!m?.candles.length || !(price > 0)) return
      const t = Math.floor(Date.now() / 60_000) * 60_000
      const last = m.candles[m.candles.length - 1]
      if (last.t > t) return
      const candles =
        last.t === t
          ? [...m.candles.slice(0, -1), { ...last, h: Math.max(last.h, price), l: Math.min(last.l, price), c: price }]
          : [...m.candles, { t, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price }]
      markets.set(id, { ...m, candles })
    }

    // ---- one-off reads ----

    async function readPresale(id: string) {
      const v: PresaleView = await api.presale(id)
      applyView(id, v)
      return v
    }

    async function readMarket(id: string) {
      const l = launched.get(id)
      if (!l?.pool) return
      // keep what did arrive: the two calls fail on their own (GeckoTerminal rate-limits)
      const [c, t] = await Promise.allSettled([candlesOf(l.pool.address), tradesOf(l.pool.address, l.mint)])
      const old = markets.get(id)
      markets.set(id, {
        candles: c.status === 'fulfilled' ? c.value : (old?.candles ?? []),
        trades: t.status === 'fulfilled' ? t.value.trades : (old?.trades ?? []),
        volumeSol: t.status === 'fulfilled' ? (SOL_USD > 0 ? t.value.volumeUsd / SOL_USD : 0) : (old?.volumeSol ?? 0),
      })
      rebuild()
    }

    async function readHeld(id: string) {
      const w = get().wallet
      const t = get().world.tokens[id]
      if (!w || !t?.address || (t.stage !== 'live' && t.stage !== 'migrated')) return
      const b = await tokenBalance(PUBLIC, w.publicKey, new PublicKey(t.address))
      set((s) => ({ held: { ...s.held, [id]: b.ui } }))
      rebuild()
    }

    /** Needs a connected wallet; opens the picker if there isn't one. */
    function needWallet(): WalletLink | null {
      const w = get().wallet
      if (!w) {
        openModal()
        return null
      }
      return w
    }

    async function withSteps<T>(fn: (onStep: (s: string) => void) => Promise<T>): Promise<T> {
      if (get().step) throw new Error('Finish the last step first')
      try {
        return await fn((s) => set({ step: s }))
      } finally {
        set({ step: null })
      }
    }

    async function viewOf(id: string): Promise<PresaleView> {
      return readPresale(id)
    }

    const snap = (amount: Lamports) => Math.max(MIN_COMMIT, Math.min(MAX_COMMIT, Math.floor(amount / COMMIT_STEP) * COMMIT_STEP))

    async function join(tokenId: string, amount: Lamports): Promise<Result> {
      const w = needWallet()
      if (!w) return fail('Connect your wallet first')
      const t = get().world.tokens[tokenId]
      if (!t) return fail('Presale not found')
      const check = canJoin(t, w.publicKey.toBase58())
      if (!check.ok) return fail(check.reason!)
      if (get().mine[tokenId]) return fail('You already have a seat here')
      const deposit = snap(amount)
      try {
        const info = await chain.loadInfo()
        await withSteps(async (onStep) => {
          onStep('Reading the presale')
          const view = await viewOf(tokenId)
          await chain.joinPresale({
            info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: BigInt(deposit), onStep,
          })
        })
        await readPresale(tokenId).catch(() => {})
        return { ok: true }
      } catch (e) {
        return fail(chain.explain(e))
      }
    }

    async function trade(tokenId: string, side: 'buy' | 'sell', amount: number): Promise<Result<TradeDone>> {
      const w = needWallet()
      if (!w) return fail('Connect your wallet first')
      const t = get().world.tokens[tokenId]
      if (!t) return fail('Token not found')
      if (t.stage !== 'live' && t.stage !== 'migrated') return fail('Trading opens at launch')
      if (!(amount > 0)) return fail('Enter an amount')
      try {
        return await withSteps(async (onStep) => {
          onStep('Getting a price from Jupiter')
          const q =
            side === 'buy'
              ? await quote(WSOL, t.address, BigInt(Math.round(amount * 1e9)))
              : await quote(t.address, WSOL, BigInt(Math.floor(amount * 1e6)))
          // the wallet signs only; the trade is sent from here until it lands or its
          // blockhash runs out (a lost answer is outcome unknown, never a plain failure)
          await swap(q, w.publicKey, PUBLIC, w.signTransaction, onStep)
          const tokens = side === 'buy' ? Number(q.outAmount) / 1e6 : Number(q.inAmount) / 1e6
          const sol = side === 'buy' ? Number(q.inAmount) / 1e9 : Number(q.outAmount) / 1e9
          readHeld(tokenId).catch(() => {})
          return { ok: true as const, tokens, sol }
        })
      } catch (e) {
        return fail(chain.explain(e))
      }
    }

    return {
      world: emptyWorld(),
      toasts: [],
      levelUps: [],
      search: '',
      chatHidden: false,
      signedIn: false,
      signInOpen: false,
      loaded: false,
      offline: false,
      wallet: null,
      mine: {},
      step: null,
      held: {},
      solUsd: SOL_USD,

      setWallet(w) {
        const was = me()
        const now = w?.publicKey.toBase58() ?? null
        if (was === now && !!w === !!get().wallet) {
          set({ wallet: w })
          return
        }
        login = now ? loadLogin(now) : null
        set((s) => ({ wallet: w, signedIn: !!login, mine: {}, held: {}, world: { ...s.world, walletLamports: 0 } }))
        rebuild()
        followWallet(now)
      },

      setWalletPicker(open) {
        openModal = open
      },

      connectWallet() {
        openModal()
      },

      start() {
        const offs = [
          live.onStatus((up: boolean) => set({ offline: !up })),
          live.subscribe('presales', onPresales),
          live.subscribe('launched', onLaunched),
          live.subscribe('chat:global', onChat('global')),
          live.subscribe('profiles', onProfiles),
          live.subscribe('sol', onSol),
        ]
        return () => offs.forEach((off) => off())
      },

      watch(tokenId, onRead) {
        let first = true
        const done = () => {
          if (first) onRead?.()
          first = false
        }
        let follow = 0
        const w = {
          market: pacer(10_000, () => readMarket(tokenId)),
          held: pacer(5_000, () => readHeld(tokenId)),
          traded(r: LaunchedRow) {
            if (r.pool) liveCandle(tokenId, priceFromSqrt(BigInt(r.pool.sqrtPrice)))
            w.market.ask()
            // GeckoTerminal lists a trade a little after it lands: look once more then
            window.clearTimeout(follow)
            follow = window.setTimeout(() => w.market.ask(), 20_000)
          },
        }
        watched.set(tokenId, w)
        const offs = [
          live.subscribe(`presale:${tokenId}`, (m: Push) => {
            if (m.type === 'snapshot') {
              const v = m.data as PresaleView
              applyView(tokenId, v)
              if (!['OPEN', 'FULL', 'LAUNCHING'].includes(v.state)) {
                if (!markets.has(tokenId)) w.market.ask()
                w.held.ask()
              }
            }
            if (m.type === 'snapshot' || m.type === 'missing') done()
          }),
          live.subscribe(`chat:${tokenId}`, onChat(tokenId)),
        ]
        // the socket is down: one direct read, so the page isn't stuck loading
        if (get().offline) readPresale(tokenId).catch(() => {}).finally(done)
        return () => {
          offs.forEach((off) => off())
          w.market.stop()
          w.held.stop()
          window.clearTimeout(follow)
          if (watched.get(tokenId) === w) watched.delete(tokenId)
        }
      },

      tick() {
        const now = Date.now()
        set((s) => ({
          world: { ...s.world, now },
          toasts: s.toasts.some((t) => now - t.at >= TOAST_MS) ? s.toasts.filter((t) => now - t.at < TOAST_MS) : s.toasts,
        }))
      },

      async findMatch(amount) {
        const w = needWallet()
        if (!w) return fail('Connect your wallet first')
        const value = snap(amount)
        // the same join tx JoinForm sends: the deposit, and what the join takes besides it
        const extra = await joinCost().then((c) => Number(c.total), () => null)
        if (value + (extra ?? 0) > get().world.walletLamports) return fail(notEnoughSol('the join', value, extra))
        const tokenId = pickMatch(get().world, w.publicKey.toBase58(), value)
        if (!tokenId) return fail('No open presale has room for that right now. Open your own.')
        set((s) => ({ world: { ...s.world, match: { tokenId, queuedAt: Date.now() } } }))
        const r = await join(tokenId, value)
        if (!r.ok) {
          set((s) => ({ world: { ...s.world, match: undefined } }))
          return r
        }
        return { ok: true, tokenId }
      },

      joinPresale: join,

      async refundNow(tokenId) {
        const w = needWallet()
        if (!w) return fail('Connect your wallet first')
        try {
          const info = await chain.loadInfo()
          await withSteps(async (onStep) => {
            onStep('Checking your seat') // before the read: a second click now hits the guard
            const view = await viewOf(tokenId)
            await chain.getBack({
              info, wallet: w.publicKey, signTransaction: w.signTransaction, sendTransaction: w.sendTransaction, view, onStep,
            })
          })
          // the refund is confirmed and the seat closed; a read now could still be the
          // server's copy from a moment ago, so it goes from here
          const v = views.get(tokenId)
          const wallet = w.publicKey.toBase58()
          if (v?.seats) applyView(tokenId, { ...v, seats: v.seats.filter((s) => s.user !== wallet) })
          return { ok: true }
        } catch (e) {
          return fail(chain.explain(e))
        }
      },

      async sendChat(channel, text) {
        const body = text.trim().slice(0, MAX_CHAT_LENGTH)
        if (!body) return fail('Type a message first')
        if (!get().signedIn || !login) {
          get().openSignIn()
          return fail('Sign in to chat')
        }
        try {
          const row: ChatRow = await api.sendChat(login.token, channel, body)
          const rows = chats.get(channel) ?? []
          if (!rows.some((r) => r.id === row.id)) chats.set(channel, [...rows, row].slice(-200))
          rebuild()
          return { ok: true }
        } catch (e) {
          const err = e as { status?: number; message: string }
          if (err.status === 401) {
            login = null
            set({ signedIn: false })
          }
          return fail(err.message)
        }
      },

      buy: (tokenId, sol) => trade(tokenId, 'buy', sol),
      sell: (tokenId, tokens) => trade(tokenId, 'sell', tokens),

      async createLaunch(form, image) {
        const w = needWallet()
        if (!w) return fail('Connect your wallet first')
        if (!w.signMessage) return fail("This wallet can't sign messages. Try Phantom or Solflare.")
        const name = form.name.trim()
        const ticker = normalizeTicker(form.ticker)
        if (name.length < 1 || new TextEncoder().encode(name).length > NAME_MAX) return fail(`Name: 1 to ${NAME_MAX} bytes`)
        if (ticker.length < 1 || ticker.length > TICKER_MAX) return fail(`Ticker: 1 to ${TICKER_MAX} letters or digits`)
        const links = {
          twitter: form.links.x ? (linkHref('x', form.links.x) ?? '') : '',
          telegram: form.links.telegram ? (linkHref('telegram', form.links.telegram) ?? '') : '',
          website: form.links.website ? (linkHref('website', form.links.website) ?? '') : '',
        }
        if ((form.links.x && !links.twitter) || (form.links.telegram && !links.telegram) || (form.links.website && !links.website))
          return fail('Links must be https:// addresses')
        const value = Math.min(snap(form.commit), MAX_CREATOR_COMMIT)
        // before the wallet signs anything and the server pins the metadata: the commit, and
        // what opening takes besides it
        const extra = await openCost().then((c) => Number(c.total), () => null)
        if (value + (extra ?? 0) > get().world.walletLamports) return fail(notEnoughSol('opening the presale', value, extra))
        try {
          const info = await chain.loadInfo()
          const presale = await withSteps(async (onStep) => {
            onStep('Sign the coin details in your wallet')
            const minted = await chain.requestMint({
              wallet: w.publicKey, signMessage: w.signMessage, name, symbol: ticker, description: form.description.trim(), links, image,
            })
            onStep('Sign to open the presale with your SOL')
            const key = await chain.openPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, mint: minted.mint, commit: BigInt(value) })
            return key.toBase58()
          })
          await readPresale(presale).catch(() => {})
          return { ok: true, tokenId: presale }
        } catch (e) {
          return fail(chain.explain(e))
        }
      },

      notify(tone, text, href) {
        set((s) => ({ toasts: [...s.toasts, { id: ++uiId, tone, text, href, at: Date.now() }].slice(-MAX_TOASTS) }))
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

      async signIn(pfp) {
        const w = needWallet()
        if (!w) return fail('Connect your wallet, then sign in')
        if (!w.signMessage) return fail("This wallet can't sign messages. Try Phantom or Solflare.")
        const wallet = w.publicKey.toBase58()
        try {
          const signMessage = w.signMessage
          login = await engineSignIn({ api, wallet: w.publicKey, signMessage: (bytes: Uint8Array) => signMessage(bytes) })
          try {
            localStorage.setItem(LOGIN_KEY(wallet), JSON.stringify(login))
          } catch {}
          const clean = sanitizePfp(pfp)
          await api.saveProfile(login.token, clean).catch(() => {})
          profiles = { ...profiles, [wallet]: clean }
          set({ signedIn: true, signInOpen: false })
          rebuild()
          get().notify('good', `Welcome to Mooner, ${short(wallet)}`)
          return { ok: true }
        } catch (e) {
          return fail(chain.explain(e))
        }
      },

      async setPfp(pfp) {
        const wallet = me()
        if (!wallet || !login) return fail('Sign in first')
        const clean = sanitizePfp(pfp)
        try {
          await api.saveProfile(login.token, clean)
          profiles = { ...profiles, [wallet]: clean }
          rebuild()
          return { ok: true }
        } catch (e) {
          return fail((e as Error).message)
        }
      },

      signOut() {
        const wallet = me()
        if (wallet)
          try {
            localStorage.removeItem(LOGIN_KEY(wallet))
          } catch {}
        login = null
        set({ signedIn: false })
      },
    }
  })
}
