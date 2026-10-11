// The numbers the site shows. The presale ones match the program (GET /api/info).

export const LAMPORTS_PER_SOL = 1_000_000_000

// Presale (spec §3.2) — all in lamports
// 0.5 SOL for testing since 2026-09-30; was 10 SOL (PRESALE_TARGET) and 1 SOL (MAX_COMMIT).
// VITE_FULL_POOL=1 shows the 10 SOL pool (for recordings against engine/scripts/demo-server.js).
const FULL_POOL = import.meta.env.VITE_FULL_POOL === '1'
export const PRESALE_TARGET = FULL_POOL ? 10_000_000_000 : 500_000_000
export const MIN_COMMIT = 100_000_000
export const MAX_COMMIT = FULL_POOL ? 1_000_000_000 : 500_000_000
/**
 * The most a creator opens with. The program only locks a pool full when a commit brings it
 * to the target, so a creator opening at the target would sit at 100% until it expires.
 */
export const MAX_CREATOR_COMMIT = Math.min(MAX_COMMIT, PRESALE_TARGET - MIN_COMMIT)
/** Amount shortcuts, in SOL, beside each commit's Max button (which is MAX_COMMIT while the pool has room). */
export const COMMIT_PRESETS = FULL_POOL ? ([0.1, 0.5, 1] as const) : ([0.1, 0.25, 0.5] as const)
export const COMMIT_STEP = 10_000_000
export const LAUNCH_SETTLE_MS = 4_000
/** Every presale runs one hour (the program's DURATION). */
export const PRESALE_TIMER_MINUTES = [60] as const

// Meteora DBC (lib/curve.ts)
export const TOTAL_SUPPLY = 1_000_000_000
/** SOL in USD, from Jupiter once a minute (a live binding: readers see the update). */
export let SOL_USD = 150
export function setSolUsd(v: number): void {
  if (v > 0) SOL_USD = v
}

// Levels and XP (spec §4.2)
export const LEVEL_XP = [0, 100, 300, 800, 2000] as const
/** Diamond Hands XP when a presale you're in goes live. */
export const XP_LIVE = 80
/** Diamond Hands XP when a token you still hold migrates. */
export const XP_MIGRATION = 150

// UI
export const TICK_MS = 1_000
export const CANDLE_MS = 10_000
export const MAX_CANDLES = 360
export const MAX_TRADES = 200
export const MAX_CHAT = 500
export const MAX_HISTORY = 30
export const RAIL_LIMIT = 30
export const EXPIRED_FLASH_MS = 3_000
export const EXPIRED_PRUNE_MS = 5 * 60_000
export const MAX_TOKENS_PER_STAGE = 40
export const MIN_OPEN_PRESALES = 6
export const MAX_OPEN_PRESALES = 10
export const START_WALLET = 25 * LAMPORTS_PER_SOL
export const TOAST_MS = 5_000
export const LIVE_FLASH_MS = 1_500
export const QUICK_BUY_SOL = 0.1
export const MAX_CHAT_LENGTH = 280
/** Window for the price change shown on cards and the token header. */
export const CHANGE_WINDOW_MS = 5 * 60_000
