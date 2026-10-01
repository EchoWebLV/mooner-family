import Link from 'next/link'
import { Avatar } from '@/components/art/Avatar'
import { PhotoCredit } from '@/components/art/PhotoCredit'
import { TokenArt } from '@/components/art/TokenArt'
import { Badge } from '@/components/badges/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { Icon } from '@/components/ui/Icon'
import { Links } from '@/components/ui/Links'
import { fmtClock } from '@/lib/format'
import { participantOf } from '@/lib/presale'
import { shareLink } from '@/real/refs.js'
import { mainBadge } from '@/lib/selectors'
import type { Token, World } from '@/lib/types'
import styles from './PresaleScreen.module.css'

interface PresaleHeaderProps {
  t: Token
  world: World
  invite?: string
  className?: string
}

/** What it is, who launched it, how people get in, and how long the pool has left (spec §5.3). */
export function PresaleHeader({ t, world, invite, className }: PresaleHeaderProps) {
  const p = t.presale
  const creator = world.users[t.creatorId]
  const badge = creator ? mainBadge(creator) : null
  const isPrivate = p.visibility === 'private'
  // The invite link is shown only to people who already have it.
  const hasInvite = isPrivate && (invite === p.inviteCode || !!participantOf(p, world.meId))
  const left = p.expiresAt - world.now
  const full = t.stage === 'launching' || t.stage === 'live' || t.stage === 'migrated'

  return (
    <header className={`panel ${styles.header} ${className ?? ''}`}>
      <TokenArt name={t.name} meme={t.meme} size={72} className={styles.art} />
      <div className={styles.identity}>
        <div className={styles.titleRow}>
          <h1 className={styles.name}>{t.name}</h1>
          <span className={`num ${styles.ticker}`}>${t.ticker}</span>
        </div>
        {creator && badge && (
          <p className={styles.creator}>
            <span className="muted">Launched by</span>
            <Link href={`/profile/${creator.handle}`} className={styles.creatorLink}>
              <Avatar handle={creator.handle} size={20} />@{creator.handle}
            </Link>
            <Badge title={badge.title} level={badge.level} size={18} />
          </p>
        )}
        {t.description && <p className={styles.desc}>{t.description}</p>}
        <p className={styles.facts}>
          <span className={styles.fact}>
            <Icon name={isPrivate ? 'lock' : 'globe'} size={12} />
            {isPrivate ? 'Private, invite only' : 'Public, open to matchmaking'}
          </span>
          <span className={styles.fact}>Fills on MagicBlock ER</span>
        </p>
        <div className={styles.actions}>
          {hasInvite && (
            <CopyButton value={`/presale/${t.id}?invite=${p.inviteCode}`} label="Copy invite link" className="btn btn-sm">
              Invite link
            </CopyButton>
          )}
          {!isPrivate && (
            <CopyButton value={shareLink('', t.id, world.meId)} label="Copy presale link" className="btn btn-sm">
              Share
            </CopyButton>
          )}
          <Links links={t.links} />
        </div>
        <PhotoCredit meme={t.meme} />
      </div>
      <div className={styles.clock} data-urgent={t.stage === 'presale' && left < 60_000}>
        <span className={styles.clockLabel}>{full ? 'Pool' : 'Time left'}</span>
        <span className={`num ${styles.clockValue}`}>{full ? 'Full' : fmtClock(left)}</span>
      </div>
    </header>
  )
}
