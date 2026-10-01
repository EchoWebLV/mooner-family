'use client'
// The lobby (spec §5.3): one circle per participant in join order, like a match lobby.
import { memo, useCallback, useState, type CSSProperties } from 'react'
import { Avatar } from '@/components/art/Avatar'
import { Badge, badgeName } from '@/components/badges/Badge'
import { Icon } from '@/components/ui/Icon'
import { fmtSol } from '@/lib/format'
import { rarityOf } from '@/lib/levels'
import { canJoin, circleSize } from '@/lib/presale'
import { mainBadge } from '@/lib/selectors'
import type { Level, Title, Token, World } from '@/lib/types'
import styles from './Lobby.module.css'
import { PlayerCard } from './PlayerCard'

/** A join this recent pops in. */
const FRESH_MS = 2_000

interface LobbyProps {
  t: Token
  world: World
  invite?: string
  className?: string
}

export function Lobby({ t, world, invite, className }: LobbyProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = useCallback((userId: string) => setOpenId(userId), [])
  const people = t.presale.participants
  const size = circleSize(people.length)
  const joinable = canJoin(t, world.meId, invite).ok

  return (
    <section className={`panel ${styles.lobby} ${className ?? ''}`} aria-labelledby="lobby-title">
      <header className={styles.head}>
        <h2 id="lobby-title" className="panel-title">
          Lobby
        </h2>
        <span className="num muted">
          {people.length} {people.length === 1 ? 'wallet' : 'wallets'}
        </span>
      </header>
      <ul className={styles.circles} data-size={size} style={{ '--size': `${size}px` } as CSSProperties}>
        {people.map((p) => {
          const u = world.users[p.userId]
          if (!u) return null
          const badge = mainBadge(u)
          return (
            <li key={p.userId}>
              <Circle
                userId={u.id}
                handle={u.handle}
                title={badge.title}
                level={badge.level}
                commit={p.commit}
                size={size}
                me={u.id === world.meId}
                creator={u.id === t.creatorId}
                fresh={world.now - p.joinedAt < FRESH_MS}
                onOpen={open}
              />
            </li>
          )
        })}
        {joinable && (
          <li>
            <button type="button" className={styles.join} onClick={focusJoin}>
              <span className={styles.plus} aria-hidden>
                <Icon name="plus" size={Math.round(size * 0.4)} />
              </span>
              <span className={styles.joinLabel}>Join</span>
            </button>
          </li>
        )}
      </ul>
      <PlayerCard userId={openId} world={world} onClose={() => setOpenId(null)} />
    </section>
  )
}

interface CircleProps {
  userId: string
  handle: string
  title: Title
  level: Level
  commit: number
  size: number
  me: boolean
  creator: boolean
  fresh: boolean
  onOpen: (userId: string) => void
}

const Circle = memo(function Circle({ userId, handle, title, level, commit, size, me, creator, fresh, onOpen }: CircleProps) {
  const classes = [styles.circle, me && styles.me, fresh && styles.fresh].filter(Boolean).join(' ')
  const who = me ? 'You' : `@${handle}`
  return (
    <button
      type="button"
      className={classes}
      style={{ '--ring': `var(--r-${rarityOf(level)})` } as CSSProperties}
      title={`@${handle} · ${fmtSol(commit)} SOL`}
      aria-label={`${who}${creator ? ' (creator)' : ''}: ${badgeName(title, level)}, ${fmtSol(commit)} SOL. Open their card`}
      onClick={() => onOpen(userId)}
    >
      <span className={styles.ring}>
        <Avatar handle={handle} size={size} />
        <Badge title={title} level={level} size={Math.round(size * 0.46)} label={false} className={styles.badge} />
        {creator && (
          <span className={styles.crown}>
            <Icon name="crown" size={size > 32 ? 16 : 12} />
          </span>
        )}
      </span>
      <span className={styles.handle}>{me ? 'You' : `@${handle}`}</span>
    </button>
  )
})

/** The + circle: jump to the commit panel with the amount ready to change. */
function focusJoin() {
  const panel = document.getElementById('join')
  if (!panel) return
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  panel.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' })
  const slider = document.getElementById('commit-amount')
  const target =
    slider instanceof HTMLInputElement && !slider.disabled
      ? slider
      : panel.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')
  target?.focus({ preventScroll: true })
}
