'use client'
// The level-up moment (spec §4.4): the new badge scales in over a dark backdrop and the XP bar fills. Click or Esc
// dismisses.
import { useEffect, useRef, type CSSProperties } from 'react'
import { roman } from '@/lib/format'
import { levelName, RARITY_NAMES, rarityOf, TITLE_NAMES } from '@/lib/levels'
import { SLOT_NAMES, unlocksAt } from '@/lib/pfp/traits'
import type { LevelUp } from '@/lib/store'
import { Badge } from './Badge'
import styles from './LevelUpOverlay.module.css'
import { XpBar } from './XpBar'

interface LevelUpOverlayProps {
  levelUp: LevelUp
  onDismiss: () => void
}

export function LevelUpOverlay({ levelUp, onDismiss }: LevelUpOverlayProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { title, level, toXp } = levelUp
  const rarity = rarityOf(level)
  const unlocks = unlocksAt(title, level)

  useEffect(() => {
    // Take focus while it plays, then give it back to whatever had it.
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div
      ref={ref}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="level-up-title"
      tabIndex={-1}
      onClick={onDismiss}
      style={{ '--rarity': `var(--r-${rarity})` } as CSSProperties}
    >
      <div className={styles.content}>
        <div className={styles.badge}>
          <Badge title={title} level={level} size={184} label={false} />
        </div>
        <p className={styles.kicker}>Level up</p>
        <h2 id="level-up-title" className={styles.headline}>
          {TITLE_NAMES[title]} {roman(level)} · {levelName(title, level)}
        </h2>
        <p className={styles.rarity}>{RARITY_NAMES[rarity]} badge unlocked</p>
        {unlocks.length > 0 && (
          <p className={styles.unlocks}>
            New for your Mooner: {unlocks.map((t) => `${t.name} (${SLOT_NAMES[t.slot].toLowerCase()})`).join(', ')}
          </p>
        )}
        <XpBar xp={toXp} animate className={styles.xp} />
        <p className={styles.hint}>Click anywhere or press Esc to continue</p>
      </div>
    </div>
  )
}
