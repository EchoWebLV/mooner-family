import { Change, Stat } from '@/components/ui/Stat'
import { SOL_USD, TOTAL_SUPPLY } from '@/lib/constants'
import { fmtCompact, fmtSol, fmtSolAmount, fmtUsd } from '@/lib/format'
import { positionOf } from '@/lib/selectors'
import type { Token, World } from '@/lib/types'
import styles from './PositionCard.module.css'

interface PositionCardProps {
  t: Token
  world: World
  className?: string
}

/** Your holding, average entry and paper PnL (spec §5.5). */
export function PositionCard({ t, world, className }: PositionCardProps) {
  const pos = positionOf(t, world.meId)
  const alloc = t.allocations?.find((a) => a.userId === world.meId)
  return (
    <section className={`panel ${styles.panel} ${className ?? ''}`} aria-labelledby="position-title">
      <h2 id="position-title" className="panel-title">
        Your position
      </h2>
      {pos ? (
        <dl className={styles.grid}>
          <Stat label="Holding">
            {fmtCompact(pos.tokens)} ${t.ticker}
          </Stat>
          <Stat label="Value">{fmtSolAmount(pos.valueSol)} SOL</Stat>
          <Stat label="Avg entry (MC)">{fmtUsd(pos.avgEntry * TOTAL_SUPPLY * SOL_USD)}</Stat>
          <Stat label="PnL" className={styles.pnl}>
            <span className={pos.pnlSol > 0 ? 'up' : pos.pnlSol < 0 ? 'down' : 'muted'}>
              {pos.pnlSol > 0 ? '+' : ''}
              {fmtSolAmount(pos.pnlSol)} SOL
            </span>
            <Change value={pos.pnlPct} className={styles.pct} />
          </Stat>
        </dl>
      ) : (
        <p className="muted">You don&apos;t hold ${t.ticker}. Buy above and it shows up here.</p>
      )}
      {alloc && (
        <p className={styles.note}>
          Presale: {fmtSol(alloc.commit)} SOL → {fmtCompact(alloc.tokens)} ${t.ticker}, same price as everyone.
        </p>
      )}
    </section>
  )
}
