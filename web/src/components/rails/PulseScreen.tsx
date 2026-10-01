'use client'
// Pulse (spec §5.2): New Pairs, Final Stretch and Migrated, with the global chat docked right.
import { useMemo, useState } from 'react'
import { ChatDock } from '@/components/chat/ChatDock'
import { Tabs } from '@/components/ui/Tabs'
import { useApp } from '@/components/world/WorldProvider'
import { fmtSol } from '@/lib/format'
import { fillingPools, finalStretch, migratedRail, newPairs } from '@/lib/selectors'
import { MarketCard } from './MarketCard'
import { PresaleCard } from './PresaleCard'
import styles from './PulseScreen.module.css'
import { Rail } from './Rail'
import { useQuickBuy } from './useQuickBuy'

type RailId = 'new' | 'stretch' | 'migrated'

const GLOBAL_CHAT = [{ id: 'global', label: 'Global' }] as const

export function PulseScreen() {
  const world = useApp((s) => s.world)
  const search = useApp((s) => s.search)
  const setSearch = useApp((s) => s.setSearch)
  const quickBuy = useQuickBuy()
  const chatHidden = useApp((s) => s.chatHidden)
  const setChatHidden = useApp((s) => s.setChatHidden)
  const [tab, setTab] = useState<RailId>('new')

  const pairs = useMemo(() => newPairs(world, search), [world, search])
  const stretch = useMemo(() => finalStretch(world, search), [world, search])
  const migrated = useMemo(() => migratedRail(world, search), [world, search])
  const pools = useMemo(() => fillingPools(world), [world])

  const nothing = search.trim() ? 'Nothing matches your search.' : null

  return (
    <div className={styles.screen} data-chat={chatHidden ? 'folded' : 'open'}>
      <div className={styles.main}>
        <header className={styles.head}>
          <h1 className={`page-title ${styles.title}`}>Pulse</h1>
          <p className={styles.stats}>
            <span className="num">{fmtSol(pools.lamports, 1)} SOL</span> filling{' '}
            <span className="num">{pools.count}</span> {pools.count === 1 ? 'pool' : 'pools'} on MagicBlock ER
          </p>
        </header>
        {search.trim() && (
          <div className={styles.filter} role="status">
            <span>
              Showing tokens matching <strong>“{search.trim()}”</strong>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>
              Clear
            </button>
          </div>
        )}
        <Tabs
          className={styles.railTabs}
          label="Rails"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'new', label: <>New Pairs <span className={styles.count}>{pairs.length}</span></> },
            { id: 'stretch', label: <>Final Stretch <span className={styles.count}>{stretch.length}</span></> },
            { id: 'migrated', label: <>Migrated <span className={styles.count}>{migrated.length}</span></> },
          ]}
        />
        <div className={styles.rails}>
          <Rail id="new" title="New Pairs" hint="Presales filling on MagicBlock ER" count={pairs.length} active={tab === 'new'} empty={nothing ?? 'No open presales right now.'}>
            {pairs.map((t) => (
              <PresaleCard key={t.id} t={t} world={world} />
            ))}
          </Rail>
          <Rail id="stretch" title="Final Stretch" hint="Live on the curve" count={stretch.length} active={tab === 'stretch'} empty={nothing ?? 'Nothing live yet.'}>
            {stretch.map((t) => (
              <MarketCard key={t.id} t={t} world={world} onQuickBuy={quickBuy} />
            ))}
          </Rail>
          <Rail id="migrated" title="Migrated" hint="Graduated to the AMM pool" count={migrated.length} active={tab === 'migrated'} empty={nothing ?? 'Nothing has migrated yet.'}>
            {migrated.map((t) => (
              <MarketCard key={t.id} t={t} world={world} onQuickBuy={quickBuy} />
            ))}
          </Rail>
        </div>
      </div>
      <ChatDock
        mode="drawer"
        channels={GLOBAL_CHAT}
        className={styles.chat}
        folded={chatHidden}
        onFoldedChange={setChatHidden}
      />
    </div>
  )
}
