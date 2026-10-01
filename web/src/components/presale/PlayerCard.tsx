'use client'
import Link from 'next/link'
import { useMemo } from 'react'
import { Avatar } from '@/components/art/Avatar'
import { Badge } from '@/components/badges/Badge'
import { XpBar } from '@/components/badges/XpBar'
import { Dialog } from '@/components/ui/Dialog'
import { Stat } from '@/components/ui/Stat'
import { fmtPct, roman } from '@/lib/format'
import { migratedPct, presalesJoined, rankMap } from '@/lib/leaderboard'
import { levelName, TITLE_NAMES, TITLES } from '@/lib/levels'
import type { User, World } from '@/lib/types'
import styles from './Lobby.module.css'

interface PlayerCardProps {
  userId: string | null
  world: World
  onClose: () => void
}

/** A lobby player's titles and record (spec §5.3). */
export function PlayerCard({ userId, world, onClose }: PlayerCardProps) {
  const u = userId ? world.users[userId] : undefined
  return (
    <Dialog open={!!u} onClose={onClose} title="Mooner card">
      {u && <CardBody u={u} world={world} onClose={onClose} />}
    </Dialog>
  )
}

function CardBody({ u, world, onClose }: { u: User; world: World; onClose: () => void }) {
  const users = world.users
  const rank = useMemo(() => rankMap(Object.values(users), 'overall').get(u.id), [users, u.id])
  const migrated = migratedPct(u)
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Avatar handle={u.handle} size={56} />
        <p className={styles.cardHandle}>
          @{u.handle}
          {u.id === world.meId && <span className={styles.you}>You</span>}
        </p>
      </div>
      <dl className={styles.cardStats}>
        <Stat label="Overall rank">#{rank ?? '—'}</Stat>
        <Stat label="Presales joined">{presalesJoined(u)}</Stat>
        <Stat label="Migrated">{migrated === null ? '—' : fmtPct(migrated, 0)}</Stat>
      </dl>
      <ul className={styles.titles}>
        {TITLES.map((title) => {
          const p = u.titles[title]
          return (
            <li key={title} className={styles.titleItem}>
              <Badge title={title} level={p.level} size={40} label={false} />
              <div className={styles.titleBody}>
                <p className={styles.titleName}>
                  {TITLE_NAMES[title]}{' '}
                  <span className="muted">
                    {roman(p.level)} · {levelName(title, p.level)}
                  </span>
                </p>
                <XpBar xp={p.xp} />
              </div>
            </li>
          )
        })}
      </ul>
      <Link href={`/profile/${u.handle}`} className="btn btn-block" onClick={onClose}>
        View profile
      </Link>
    </div>
  )
}
