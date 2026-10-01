// Titles, levels, XP and badge names (spec §4).
import { LEVEL_XP } from './constants'
import type { Level, Title, TitleProgress } from './types'

export const TITLES: readonly Title[] = ['kol', 'diamond', 'shiller', 'raider']

/** Titles that will be scored from X. */
export const X_TITLES: readonly Title[] = ['kol', 'shiller', 'raider']

export const TITLE_NAMES: Record<Title, string> = {
  kol: 'KOL',
  diamond: 'Diamond Hands',
  shiller: 'Shiller',
  raider: 'Raider',
}

export const TITLE_MEASURES: Record<Title, string> = {
  kol: 'Reach and how their calls perform',
  diamond: 'Conviction',
  shiller: 'Original content',
  raider: 'Coordinated engagement',
}

export const TITLE_XP_HOWTO: Record<Title, string> = {
  kol: 'Coming later: follower reach and call win rate from X, plus your Mooner launch history.',
  diamond: 'Coming later: XP when a presale you are in goes live, and more when a coin you still hold migrates.',
  shiller: 'Coming later: posts, impressions and top posts from X.',
  raider: 'Coming later: raids joined, actions per raid and reply speed from X.',
}

export const LEVEL_NAMES: Record<Title, readonly [string, string, string, string, string]> = {
  kol: ['Caller', 'Voice', 'Signal', 'Oracle', 'Prophet'],
  diamond: ['Stone', 'Iron', 'Steel', 'Diamond', 'Moon'],
  shiller: ['Poster', 'Hypeman', 'Memelord', 'Storyteller', 'Mythmaker'],
  raider: ['Scout', 'Raider', 'Vanguard', 'Warlord', 'Legion'],
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']
export const RARITY_NAMES: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
}

export const LEVELS: readonly Level[] = [1, 2, 3, 4, 5]

export function levelForXp(xp: number): Level {
  let level: Level = 1
  for (const l of LEVELS) if (xp >= LEVEL_XP[l - 1]) level = l
  return level
}

export function progressFor(xp: number): TitleProgress {
  return { xp, level: levelForXp(xp) }
}

export function rarityOf(level: Level): Rarity {
  return RARITIES[level - 1]
}

export function levelName(title: Title, level: Level): string {
  return LEVEL_NAMES[title][level - 1]
}

export function xpForLevel(level: Level): number {
  return LEVEL_XP[level - 1]
}

export interface XpProgress {
  level: Level
  /** XP threshold of the current level. */
  floor: number
  /** XP threshold of the next level, or null at max level. */
  next: number | null
  /** 0..1 progress towards the next level (1 at max). */
  fraction: number
}

export function xpProgress(xp: number): XpProgress {
  const level = levelForXp(xp)
  const floor = xpForLevel(level)
  const next = level < 5 ? xpForLevel((level + 1) as Level) : null
  const fraction = next === null ? 1 : (xp - floor) / (next - floor)
  return { level, floor, next, fraction }
}

/** Highest level wins; ties go to more XP, then to TITLES order. */
export function mainTitle(titles: Record<Title, TitleProgress>): Title {
  let best: Title = TITLES[0]
  for (const t of TITLES) {
    const a = titles[t]
    const b = titles[best]
    if (a.level > b.level || (a.level === b.level && a.xp > b.xp)) best = t
  }
  return best
}
