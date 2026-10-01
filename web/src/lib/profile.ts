// What a profile shows (spec §5.8), derived from a user on demand.
import { fmtCompact, fmtNumber } from './format'
import type { KeyStat } from './leaderboard'
import { TITLES } from './levels'
import type { Title, User } from './types'

/** A profile URL's handle as typed: with or without the @. */
export function handleFromParam(param: string): string {
  let handle = param
  try {
    handle = decodeURIComponent(param)
  } catch {
    // A malformed escape: look it up as it came.
  }
  return handle.replace(/^@/, '')
}

/** The three demo stats on each title card (spec §4.1). */
export function titleStats(u: User, title: Title): KeyStat[] {
  switch (title) {
    case 'kol': {
      const s = u.stats.kol
      return [
        { label: 'Followers', value: fmtCompact(s.followers, 1) },
        { label: 'Engagement', value: `${s.engagementPct}%` },
        { label: 'Call win rate', value: `${s.callWinPct}%` },
      ]
    }
    case 'diamond': {
      const s = u.stats.diamond
      return [
        { label: 'Average hold', value: `${s.avgHoldHours}h` },
        { label: 'Held to migration', value: `${s.heldToMigrationPct}%` },
        { label: 'Early dumps', value: String(s.earlyDumps) },
      ]
    }
    case 'shiller': {
      const s = u.stats.shiller
      return [
        { label: 'Posts', value: fmtNumber(s.posts, 0) },
        { label: 'Impressions', value: fmtCompact(s.impressions, 1) },
        { label: 'Top post', value: `${fmtCompact(s.topPostViews, 1)} views` },
      ]
    }
    case 'raider': {
      const s = u.stats.raider
      return [
        { label: 'Raids joined', value: fmtNumber(s.raids, 0) },
        { label: 'Actions per raid', value: String(s.actionsPerRaid) },
        { label: 'Reply speed', value: `${s.replySpeedSec}s` },
      ]
    }
  }
}

/** Badges earned out of 20: a title at level III has its I, II and III badges. */
export function badgesEarned(u: User): number {
  let n = 0
  for (const t of TITLES) n += u.titles[t].level
  return n
}
