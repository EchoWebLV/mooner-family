import Link from 'next/link'
import { Avatar } from '@/components/art/Avatar'
import { PhotoCredit } from '@/components/art/PhotoCredit'
import { TokenArt } from '@/components/art/TokenArt'
import { Badge } from '@/components/badges/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { Links } from '@/components/ui/Links'
import { Change, Stat } from '@/components/ui/Stat'
import { MIGRATION_SOL, solRaised } from '@/lib/curve'
import { fmtAge, fmtPct, fmtPrice, fmtSolAmount, fmtUsd, shortAddress } from '@/lib/format'
import {
  holderCount, liquidityUsd, mainBadge, marketCapUsd, priceChange, priceSol, progressOf, volumeUsd,
} from '@/lib/selectors'
import type { Token, World } from '@/lib/types'
import styles from './TokenHeader.module.css'

/** What it is, where it trades and how it's doing (spec §5.5). */
export function TokenHeader({ t, world }: { t: Token; world: World }) {
  const creator = world.users[t.creatorId]
  const badge = creator ? mainBadge(creator) : null
  const live = t.stage === 'live'
  const progress = progressOf(t)
  const migratedAge = fmtAge(world.now - (t.migratedAt ?? world.now))

  return (
    <header className={`panel ${styles.header}`}>
      <TokenArt name={t.name} meme={t.meme} size={56} />
      <div className={styles.identity}>
        <div className={styles.titleRow}>
          <h1 className={styles.name}>{t.name}</h1>
          <span className={`num ${styles.ticker}`}>${t.ticker}</span>
        </div>
        <div className={styles.meta}>
          <span className={styles.address}>
            <span className="num" title={t.address}>
              {shortAddress(t.address)}
            </span>
            <CopyButton value={t.address} label="Copy contract address" />
          </span>
          {creator && badge && (
            <span className={styles.creator}>
              <span className="muted">by</span>
              <Link href={`/profile/${creator.handle}`} className={styles.creatorLink}>
                <Avatar handle={creator.handle} size={18} />@{creator.handle}
              </Link>
              <Badge title={badge.title} level={badge.level} size={18} />
            </span>
          )}
          <Links links={t.links} />
        </div>
        {t.description && <p className={styles.desc}>{t.description}</p>}
        <PhotoCredit meme={t.meme} />
      </div>

      <div className={styles.market}>
        <dl className={styles.stats}>
          <div className={styles.mcap}>
            <dt className={styles.mcapLabel}>Market cap</dt>
            <dd className={styles.mcapValue}>
              <span className="num">{fmtUsd(marketCapUsd(t))}</span>
              <Change value={priceChange(t, world.now)} className={styles.change} />
              <span className="sr-only"> over 5 minutes</span>
            </dd>
          </div>
          <Stat label="Price">{fmtPrice(priceSol(t))} SOL</Stat>
          {!live && <Stat label="Liquidity">{fmtUsd(liquidityUsd(t))}</Stat>}
          <Stat label="Volume">{fmtUsd(volumeUsd(t))}</Stat>
          <Stat label="Holders">{holderCount(t)}</Stat>
        </dl>
        {live ? (
          <div className={styles.curve}>
            <p className={styles.curveText}>
              <span>
                Bonding curve · <span className="num">{fmtPct(progress, 1)}</span> sold
              </span>
              <span className="num">{fmtSolAmount(t.pool ? solRaised(t.pool) : 0)} SOL raised</span>
            </p>
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
            <p className={styles.curveHint}>
              Sells out and migrates to an AMM pool at {fmtSolAmount(MIGRATION_SOL)} SOL raised.
            </p>
          </div>
        ) : (
          <p className={styles.migrated}>
            {migratedAge === 'now' ? 'Just migrated' : `Migrated ${migratedAge} ago`} · trading on the AMM pool
          </p>
        )}
      </div>
    </header>
  )
}
