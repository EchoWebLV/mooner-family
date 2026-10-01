// Discover (spec §5.10): every coin on Mooner in one list, filtered by stage, searched from the top bar, sorted by any
// column. Pure reads of the world; the screen memoizes them.
import { LAMPORTS_PER_SOL, SOL_USD } from './constants'
import { poolLamports } from './presale'
import { marketCapUsd, matchesSearch, priceChange, volumeUsd } from './selectors'
import type { Stage, Token, World } from './types'

export type DiscoverTab = 'all' | 'presale' | 'live' | 'migrated'
export type SortKey = 'mcap' | 'change' | 'volume' | 'holders' | 'age'
export type SortDir = 'asc' | 'desc'

export interface Sort {
  key: SortKey
  dir: SortDir
}

export const DEFAULT_SORT: Sort = { key: 'mcap', dir: 'desc' }

/** A column's first click: the biggest numbers first, and the newest coins first. */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  mcap: 'desc',
  change: 'desc',
  volume: 'desc',
  holders: 'desc',
  age: 'asc',
}

/** The tab a coin is listed under: settling pools stay with the presales. Expired coins aren't listed. */
export function tabOf(stage: Stage): Exclude<DiscoverTab, 'all'> | null {
  if (stage === 'presale' || stage === 'launching') return 'presale'
  if (stage === 'live' || stage === 'migrated') return stage
  return null
}

/** The listed coins that match the search, under each tab. */
export function discoverLists(w: World, query = ''): Record<DiscoverTab, Token[]> {
  const lists: Record<DiscoverTab, Token[]> = { all: [], presale: [], live: [], migrated: [] }
  for (const t of Object.values(w.tokens)) {
    const tab = tabOf(t.stage)
    if (!tab || !matchesSearch(t, query)) continue
    lists.all.push(t)
    lists[tab].push(t)
  }
  return lists
}

export function isTrading(t: Token): boolean {
  return t.stage === 'live' || t.stage === 'migrated'
}

/** The people in the pool before launch; holders after it aren't counted yet (NaN). */
export function holdersOf(t: Token): number {
  return isTrading(t) ? NaN : t.presale.participants.length
}

/** The pool in USD, which stands in for a presale's market cap: it has no price until launch. */
export function poolUsd(t: Token): number {
  return (poolLamports(t.presale) / LAMPORTS_PER_SOL) * SOL_USD
}

/** A coin's number in a column; null where the column doesn't apply yet (a presale has no price or volume). */
export function sortValue(t: Token, key: SortKey, now: number): number | null {
  switch (key) {
    case 'mcap':
      return isTrading(t) ? marketCapUsd(t) : poolUsd(t)
    case 'change':
      return isTrading(t) ? priceChange(t, now) : null
    case 'volume':
      return isTrading(t) ? volumeUsd(t) : null
    case 'holders':
      return isTrading(t) ? null : holdersOf(t)
    case 'age':
      return now - t.createdAt
  }
}

/** Sorted by a column, either way; coins the column doesn't apply to go last both ways. Ties keep a fixed order. */
export function sortTokens(tokens: readonly Token[], sort: Sort, now: number): Token[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return tokens
    .map((t) => ({ t, v: sortValue(t, sort.key, now) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? byId(a.t, b.t) : a.v === null ? 1 : -1
      return (a.v - b.v) * sign || byId(a.t, b.t)
    })
    .map((x) => x.t)
}

/**
 * The rows in a held order (the ids as they stood when it was held): coins keep their places, new ones join at the
 * end and gone ones drop out. With nothing held, the sorted list as it is.
 */
export function holdOrder(sorted: readonly Token[], held: readonly string[] | null): readonly Token[] {
  if (!held) return sorted
  const index = new Map(sorted.map((t) => [t.id, t]))
  const heldIds = new Set(held)
  return [...held.flatMap((id) => index.get(id) ?? []), ...sorted.filter((t) => !heldIds.has(t.id))]
}

function byId(a: Token, b: Token): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
