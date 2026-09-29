// Domain model (spec §7.3). Plain JSON-serialisable data only.

export type Title = 'kol' | 'diamond' | 'shiller' | 'raider'
export type Level = 1 | 2 | 3 | 4 | 5
export type Stage = 'presale' | 'launching' | 'live' | 'migrated' | 'expired'
/** Integer lamports (1 SOL = 1e9). */
export type Lamports = number

export interface TitleProgress {
  xp: number
  level: Level
}

/** Demo stats per title (spec §4.1); later they come from X and on-chain data. */
export interface TitleStats {
  kol: { followers: number; engagementPct: number; callWinPct: number }
  diamond: { avgHoldHours: number; heldToMigrationPct: number; earlyDumps: number }
  shiller: { posts: number; impressions: number; topPostViews: number }
  raider: { raids: number; actionsPerRaid: number; replySpeedSec: number }
}

/** Self-contained, so it survives token pruning. */
export interface LaunchRecord {
  tokenId: string
  name: string
  ticker: string
  commit: Lamports
  /** Tokens allocated at launch (0 if the presale expired). */
  tokens: number
  outcome: 'live' | 'migrated' | 'expired'
  /** Last recorded mark-to-market PnL in SOL. */
  pnlSol: number
  at: number
}

/** The parts of a Mooner PFP; see lib/pfp/traits.ts for what each can hold. */
export type PfpSlot = 'skin' | 'eyes' | 'mouth' | 'head' | 'face' | 'outfit' | 'neck' | 'aura' | 'bg'
/** A player's Mooner: one trait id per slot. */
export type Pfp = Record<PfpSlot, string>

export interface User {
  id: string
  handle: string
  isBot: boolean
  pfp: Pfp
  titles: Record<Title, TitleProgress>
  stats: TitleStats
  history: LaunchRecord[]
}

export interface Participant {
  userId: string
  commit: Lamports
  joinedAt: number
}

export interface Presale {
  visibility: 'public' | 'private'
  inviteCode?: string
  /** Join order. */
  participants: Participant[]
  expiresAt: number
  /** Set when the pool reaches PRESALE_TARGET. */
  launchStartedAt?: number
}

/** Curve stage: virtual reserves. Migrated: real AMM reserves. */
export interface Pool {
  solReserve: number
  tokenReserve: number
  tokensSold: number
}

export interface Allocation {
  userId: string
  commit: Lamports
  tokens: number
}

export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
}

export interface Trade {
  id: string
  at: number
  userId: string
  side: 'buy' | 'sell'
  sol: number
  tokens: number
  price: number
}

export interface TokenLinks {
  x?: string
  telegram?: string
  website?: string
}

export interface Token {
  id: string
  name: string
  ticker: string
  description: string
  /**
   * The real meme a bot's coin is named after, as a TOKEN_IDEAS ticker; spin-offs keep their original's ("Baby Pepe"
   * → PEPE). Picks the coin's photo. Absent on the user's own coins.
   */
  meme?: string
  /** Mock contract address. */
  address: string
  links: TokenLinks
  creatorId: string
  stage: Stage
  createdAt: number
  launchedAt?: number
  migratedAt?: number
  expiredAt?: number
  presale: Presale
  /** From launch onward. */
  pool?: Pool
  allocations?: Allocation[]
  /** userId → tokens held; zero balances are deleted. */
  positions: Record<string, number>
  /** userId → SOL spent on what they hold (for average entry and PnL). */
  costBasis: Record<string, number>
  /** 10 s candles, newest last. */
  candles: Candle[]
  /** Newest last. */
  trades: Trade[]
  volumeSol: number
  /** Simulator pressure, 0..1: join pace during the presale, buy pressure once live. */
  heat: number
}

export interface ChatMessage {
  id: string
  /** 'global' or a token id. */
  channel: string
  userId: string
  text: string
  at: number
}

export interface MatchQueue {
  tokenId: string
  queuedAt: number
}

export interface World {
  now: number
  /** Id counter for everything the world creates. */
  seq: number
  meId: string
  walletLamports: Lamports
  users: Record<string, User>
  tokens: Record<string, Token>
  /** Channel → messages, oldest first. */
  chat: Record<string, ChatMessage[]>
  /** Set by Find Match; drives "LOOKING FOR MATCH · m:ss". */
  match?: MatchQueue
}

/** Things that happened to the demo user during a tick; the store turns them into toasts and overlays. */
export type WorldEvent =
  | { kind: 'expired'; tokenId: string; refund: Lamports }
  | { kind: 'live'; tokenId: string }
  | { kind: 'migrated'; tokenId: string }
  /** `tokenId` is the launch or migration that paid the XP, if any. */
  | { kind: 'xp'; title: Title; fromXp: number; toXp: number; tokenId?: string }
