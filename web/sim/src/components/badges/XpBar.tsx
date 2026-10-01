import type { CSSProperties } from 'react'
import { fmtNumber } from '@/lib/format'
import { rarityOf, xpProgress } from '@/lib/levels'
import styles from './XpBar.module.css'

interface XpBarProps {
  xp: number
  /** Fills from empty when it appears (level-up overlay). */
  animate?: boolean
  className?: string
}

/** Progress towards the next level, in the current level's rarity colour. */
export function XpBar({ xp, animate = false, className }: XpBarProps) {
  const p = xpProgress(xp)
  const style = { '--fill': `${(p.fraction * 100).toFixed(1)}%`, '--color': `var(--r-${rarityOf(p.level)})` } as CSSProperties
  return (
    <div className={`${styles.wrap} ${className ?? ''}`} style={style}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="XP towards the next level"
        aria-valuemin={p.floor}
        aria-valuemax={p.next ?? xp}
        aria-valuenow={xp}
      >
        <span className={animate ? styles.grow : undefined} />
      </div>
      <div className={`num ${styles.numbers}`}>
        {fmtNumber(xp, 0)} / {p.next === null ? 'MAX' : fmtNumber(p.next, 0)} XP
      </div>
    </div>
  )
}
