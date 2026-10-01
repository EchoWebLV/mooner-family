// The public leaderboard (spec §4.5). Ranks are derived from users on demand, never stored.
import { fmtCompact, roman } from './format'
import { mainTitle, TITLE_NAMES, TITLES } from './levels'
import type { Title, User } from './types'

export type Board = 'overall' | Title

export const BOARDS: readonly Board[] = ['overall', ...TITLES]

/** XP on a board: one title's XP, or the sum of all four for Overall. */
export function boardXp(u: User, board: Board): number {
  if (board !== 'overall') return u.titles[board].xp
  let sum = 0
  for (const t of TITLES) sum += u.titles[t].xp
  return sum
}

function byHandle(a: User, b: User): number {
  return a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0
}

/** Highest XP first; equal XP is ordered by handle, so the order never flickers. */
export function ranking(users: readonly User[], board: Board): User[] {
  return [...users].sort((a, b) => boardXp(b, board) - boardXp(a, board) || byHandle(a, b))
}

/** userId → 1-based rank on a board. */
export function rankMap(users: readonly User[], board: Board): Map<string, number> {
  const ranks = new Map<string, number>()
  ranking(users, board).forEach((u, i) => ranks.set(u.id, i + 1))
  return ranks
}

/** Presales the user was in that launched or expired. */
export function presalesJoined(u: User): number {
  return u.history.length
}

/** Migrated ÷ launched, or null when nothing the user joined has launched yet. */
export function migratedPct(u: User): number | null {
  let launched = 0
  let migrated = 0
  for (const h of u.history) {
    if (h.outcome === 'expired') continue
    launched++
    if (h.outcome === 'migrated') migrated++
  }
  return launched === 0 ? null : migrated / launched
}

export interface KeyStat {
  label: string
  value: string
}

/** What each board's key stat measures: the same for every player, so it can head a column. */
export const KEY_STAT_LABELS: Record<Board, string> = {
  overall: 'Main title',
  kol: 'Followers',
  diamond: 'Held to migration',
  shiller: 'Impressions',
  raider: 'Raids joined',
}

/** The one stat each leaderboard tab shows next to XP. */
export function keyStat(u: User, board: Board): KeyStat {
  return { label: KEY_STAT_LABELS[board], value: keyStatValue(u, board) }
}

function keyStatValue(u: User, board: Board): string {
  switch (board) {
    case 'overall': {
      const t = mainTitle(u.titles)
      return `${TITLE_NAMES[t]} ${roman(u.titles[t].level)}`
    }
    case 'kol':
      return fmtCompact(u.stats.kol.followers, 1)
    case 'diamond':
      return `${u.stats.diamond.heldToMigrationPct}%`
    case 'shiller':
      return fmtCompact(u.stats.shiller.impressions, 1)
    case 'raider':
      return String(u.stats.raider.raids)
  }
}
