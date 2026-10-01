import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import { Links } from '@/components/ui/Links'
import { Change } from '@/components/ui/Stat'
import { QUICK_BUY_SOL } from '@/lib/constants'
import { fmtAge, fmtPct, fmtUsd } from '@/lib/format'
import { holderCount, liquidityUsd, marketCapUsd, priceChange, progressOf, volumeUsd } from '@/lib/selectors'
import type { Token, World } from '@/lib/types'
import { ArtRing } from './ArtRing'
import styles from './cards.module.css'

const FRESH_MS = 3_000

interface MarketCardProps {
  t: Token
  world: World
  onQuickBuy: (t: Token) => void
}

/** A Final Stretch or Migrated card (spec §5.2): the same rows as a presale's, with the market's numbers. */
export function MarketCard({ t, world, onQuickBuy }: MarketCardProps) {
  const now = world.now
  const live = t.stage === 'live'
  const since = now - ((live ? t.launchedAt : t.migratedAt) ?? now)
  const progress = progressOf(t)
  const age = fmtAge(since)
  const ageTitle = live
    ? age === 'now' ? 'Just went live' : `Live for ${age}`
    : age === 'now' ? 'Just migrated' : `Migrated ${age} ago`
  const classes = [styles.card, since < FRESH_MS && styles.fresh].filter(Boolean).join(' ')

  return (
    <article className={classes} data-stage={t.stage}>
      <ArtRing name={t.name} meme={t.meme} stage={t.stage} fill={live ? progress : 1} />

      <div className={styles.main}>
        <div className={styles.line}>
          <h3 className={styles.name}>
            <Link href={`/token/${t.id}`} prefetch={false} className={styles.stretch}>
              {t.name}
            </Link>
          </h3>
          <span className={`num ${styles.ticker}`}>${t.ticker}</span>
          <span className={`num ${styles.figure}`}>
            <abbr title="Market cap">MC</abbr> <span className={styles.value}>{fmtUsd(marketCapUsd(t))}</span>
          </span>
        </div>

        <div className={styles.meta}>
          <span className={`num ${styles.stat}`} title={ageTitle}>
            {age}
          </span>
          <span className={`${styles.stat} ${styles.holders}`} title="Holders">
            <Icon name="users" size={12} />
            <span className="num">{holderCount(t)}</span>
          </span>
          <span className={styles.stat}>
            <abbr title="Volume">V</abbr>
            <span className="num">{fmtUsd(volumeUsd(t))}</span>
          </span>
          <Change value={priceChange(t, now)} className={`${styles.change} ${styles.end}`} />
        </div>

        {live ? (
          <div className={styles.progress}>
            <div
              className="bar bar-up"
              role="progressbar"
              aria-label="Bonding curve"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <span style={{ width: `${(progress * 100).toFixed(1)}%` }} />
            </div>
            <span className="num" aria-hidden>
              {fmtPct(progress, 1)}
            </span>
          </div>
        ) : (
          <div className={styles.meta}>
            <span className={styles.stat}>
              Liquidity
              <span className="num">{fmtUsd(liquidityUsd(t))}</span>
            </span>
          </div>
        )}
      </div>

      <div className={styles.foot}>
        <Links links={t.links} variant="icons" name={t.name} />
        <button type="button" className={`btn btn-primary btn-sm ${styles.action}`} onClick={() => onQuickBuy(t)}>
          <Icon name="bolt" size={12} />
          <span className="num">{QUICK_BUY_SOL}</span> SOL<span className="sr-only"> quick buy {t.name}</span>
        </button>
      </div>
    </article>
  )
}
