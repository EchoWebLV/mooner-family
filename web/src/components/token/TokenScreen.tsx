'use client'
// Token page (spec §5.5): the chart and market activity on the left; trade, your position
// and the token chat on the right. Until launch the token lives on its presale page.
import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { ChatDock } from '@/components/chat/ChatDock'
import { NotFound } from '@/components/ui/NotFound'
import { Redirecting } from '@/components/ui/Redirecting'
import { useApp, useWatch } from '@/components/world/WorldProvider'
import type { Token, World } from '@/lib/types'
import { PositionCard } from './PositionCard'
import { PriceChart } from './PriceChart'
import { TokenHeader } from './TokenHeader'
import { TokenTabs } from './TokenTabs'
import { TradePanel } from './TradePanel'
import styles from './TokenScreen.module.css'

export function TokenScreen({ id }: { id: string }) {
  const world = useApp((s) => s.world)
  const loaded = useApp((s) => s.loaded)
  const router = useRouter()
  const t = world.tokens[id]
  const beforeLaunch = !!t && t.stage !== 'live' && t.stage !== 'migrated'
  const reading = useWatch(id)

  useEffect(() => {
    if (beforeLaunch) router.replace(`/presale/${id}`)
  }, [beforeLaunch, id, router])

  if (!t) return !loaded || reading ? <Redirecting text="Loading the coin…" /> : <NotFound what="Token" />
  if (beforeLaunch) return <Redirecting text="Not trading yet. Opening the presale…" />
  return <TokenView t={t} world={world} />
}

const GLOBAL = { id: 'global', label: 'Global' }

function TokenView({ t, world }: { t: Token; world: World }) {
  const channels = useMemo(() => [{ id: t.id, label: '$' + t.ticker }, GLOBAL], [t.id, t.ticker])
  return (
    <div className={`page ${styles.screen}`}>
      <TokenHeader t={t} world={world} />
      <div className={styles.cols}>
        <div className={styles.main}>
          <PriceChart key={t.id} t={t} now={world.now} className={styles.chart} />
          <TokenTabs t={t} world={world} className={styles.tabs} />
        </div>
        <div className={styles.side}>
          <TradePanel key={t.id} t={t} world={world} className={styles.trade} />
          <PositionCard t={t} world={world} className={styles.position} />
          <ChatDock mode="inline" channels={channels} className={styles.chat} />
        </div>
      </div>
    </div>
  )
}
