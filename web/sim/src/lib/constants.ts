// Every tunable number in the demo lives here. Curve values are placeholders
// until the on-chain program exists (spec §3.4).

export const LAMPORTS_PER_SOL = 1_000_000_000

// Presale (spec §3.2) — all in lamports
// 0.5 SOL for testing since 2026-09-30; was 10 SOL (PRESALE_TARGET) and 1 SOL (MAX_COMMIT)
export const PRESALE_TARGET = 500_000_000
export const MIN_COMMIT = 100_000_000
export const MAX_COMMIT = 500_000_000
/** The most a creator opens with, so the pool always has room for someone else. */
export const MAX_CREATOR_COMMIT = Math.min(MAX_COMMIT, PRESALE_TARGET - MIN_COMMIT)
/** Amount shortcuts, in SOL, beside each commit's Max button (which is MAX_COMMIT while the pool has room). */
export const COMMIT_PRESETS = [0.1, 0.25, 0.5] as const
export const COMMIT_STEP = 10_000_000
export const LAUNCH_SETTLE_MS = 4_000
export const PRESALE_TIMER_MINUTES = [5, 10, 15] as const
export const BOT_PRESALE_MINUTES = { min: 2, max: 8 } as const
export const MATCH_PRESALE_MINUTES = 10

// Bonding curve (spec §3.4)
export const TOTAL_SUPPLY = 1_000_000_000
export const VIRTUAL_SOL_0 = 30
export const VIRTUAL_TOKENS_0 = 1_073_000_000
export const CURVE_TOKENS_FOR_SALE = 793_100_000
export const LP_TOKENS = 206_900_000
export const SOL_USD = 150

// Levels and XP (spec §4.2)
export const LEVEL_XP = [0, 100, 300, 800, 2000] as const
/** Diamond Hands XP when a presale you're in goes live. */
export const XP_LIVE = 80
/** Diamond Hands XP when a token you still hold migrates. */
export const XP_MIGRATION = 150
/** KOL / Shiller / Raider XP per "Simulate X activity". */
export const XP_X_ACTIVITY = 120

// Simulator and UI
export const SEED = 20260924
export const SEED_EPOCH = Date.UTC(2026, 8, 24, 12, 0, 0)
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
