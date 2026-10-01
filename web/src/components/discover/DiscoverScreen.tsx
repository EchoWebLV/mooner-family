'use client'
// Discover (spec §5.10): every coin on Mooner in one table, like a trading terminal's token list. Filtered by stage,
// searched from the top bar, sorted by any column; the order holds still while you point at it.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuickBuy } from '@/components/rails/useQuickBuy'
import { Tabs, tabId, type TabItem } from '@/components/ui/Tabs'
import { useApp } from '@/components/world/WorldProvider'
import {
  DEFAULT_SORT, discoverLists, FIRST_DIR, sortTokens, type DiscoverTab, type Sort, type SortKey,
} from '@/lib/discover'
import styles from './Discover.module.css'
import { DiscoverTable } from './DiscoverTable'
import { useHeldOrder } from './useHeldOrder'

interface TabInfo {
  label: string
  /** What a row is called under the tab: one, many. */
  noun: readonly [string, string]
  hint: string
  empty: string
}

const COIN = ['coin', 'coins'] as const

const TABS: Record<DiscoverTab, TabInfo> = {
  all: { label: 'All', noun: COIN, hint: 'from presale to migration', empty: 'No coins yet.' },
  presale: {
    label: 'Presales',
    noun: ['presale', 'presales'],
    hint: 'filling on MagicBlock ER',
    empty: 'No open presales right now.',
  },
  live: { label: 'Live', noun: COIN, hint: 'trading on the bonding curve', empty: 'Nothing live yet.' },
  migrated: { label: 'Migrated', noun: COIN, hint: 'graduated to the AMM pool', empty: 'Nothing has migrated yet.' },
}

const TAB_IDS = Object.keys(TABS) as DiscoverTab[]

export function DiscoverScreen() {
  const world = useApp((s) => s.world)
  const search = useApp((s) => s.search)
  const setSearch = useApp((s) => s.setSearch)
  const quickBuy = useQuickBuy()
  const [tab, setTab] = useState<DiscoverTab>('all')
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)

  const query = search.trim()
  const everything = useMemo(() => discoverLists(world), [world])
  const lists = useMemo(() => (query ? discoverLists(world, query) : everything), [world, query, everything])
  const sorted = useMemo(() => sortTokens(lists[tab], sort, world.now), [lists, tab, sort, world.now])
  const { rows, held, handlers } = useHeldOrder(sorted)

  // A column's first click puts the biggest numbers (or the newest coins) on top; the next click flips it.
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: FIRST_DIR[key] }))

  const items: TabItem<DiscoverTab>[] = TAB_IDS.map((id) => ({
    id,
    label: (
      <>
        {TABS[id].label} <span className={styles.count}>{lists[id].length}</span>
      </>
    ),
  }))
  const total = everything[tab].length
  const matches = lists[tab].length
  const [one, many] = TABS[tab].noun
  const found = query
    ? `${matches} of ${total} ${total === 1 ? one : many} ${matches === 1 ? 'matches' : 'match'} “${query}”`
    : ''

  return (
    <div className={`page ${styles.screen}`}>
      <header className={styles.head}>
        <h1 className="page-title">Discover</h1>
        <p className={styles.lede}>
          Every coin on Mooner in one list: presales filling on MagicBlock ER, coins live on the bonding curve and the
          ones that migrated. Sort by any column, or search from the top bar.
        </p>
      </header>

      <section className={`panel ${styles.board}`} aria-label="Coins">
        <Tabs items={items} value={tab} onChange={setTab} label="Stages" idPrefix="discover" className={styles.tabs} />
        <div role="tabpanel" aria-labelledby={tabId('discover', tab)} className={styles.body}>
          <div className={styles.summary}>
            <p className={styles.summaryText}>
              {query ? (
                found
              ) : (
                <>
                  <span className="num">{total}</span> {total === 1 ? one : many}{' '}
                  <span className="faint">· {TABS[tab].hint}</span>
                </>
              )}
            </p>
            {held && (
              <span className={styles.paused} title="The order waits while you point at the list">
                <span className={styles.pausedIcon} aria-hidden />
                Order paused
              </span>
            )}
            {query && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>
                Clear search
              </button>
            )}
          </div>
          {/* Read out as you type a search; the tick-by-tick counts above stay quiet. */}
          <p className="sr-only" role="status">
            {found}
          </p>
          <DiscoverTable
            rows={rows}
            now={world.now}
            meId={world.meId}
            sort={sort}
            onSort={sortBy}
            onQuickBuy={quickBuy}
            hold={handlers}
            empty={query ? `No coin matches “${query}”.` : TABS[tab].empty}
          />
          <p className={styles.footnote}>
            Coin photos from Wikimedia Commons.{' '}
            <Link href="/credits" className={styles.footLink}>
              Credits
            </Link>
          </p>
        </div>
      </section>
    </div>
  )
}
