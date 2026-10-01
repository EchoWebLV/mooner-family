import { memo } from 'react'
import { roman } from '@/lib/format'
import { levelName, RARITY_NAMES, rarityOf, TITLE_NAMES } from '@/lib/levels'
import type { Level, Title } from '@/lib/types'
import { useSvgId } from '../art/useSvgId'
import styles from './Badge.module.css'
import { BadgeFrame } from './BadgeFrame'
import { RARITY_COLORS } from './palette'
import { TitleEmblem } from './TitleEmblem'

interface BadgeProps {
  title: Title
  level: Level
  size?: number
  /** Greyed out with a lock: not earned yet. */
  locked?: boolean
  /** Accessible name; `false` hides the badge from screen readers when text beside it says the same. */
  label?: string | false
  className?: string
}

export function badgeName(title: Title, level: Level): string {
  return `${TITLE_NAMES[title]} ${roman(level)} · ${levelName(title, level)}`
}

/** One of the 20 badges: frame by level, emblem by title, colour by rarity (spec §4.3). */
export const Badge = memo(function Badge({ title, level, size = 24, locked = false, label, className }: BadgeProps) {
  const id = useSvgId('badge')
  const rarity = rarityOf(level)
  const colors = RARITY_COLORS[rarity]
  const simple = size < 40
  const name = label === false ? undefined : (label ?? `${badgeName(title, level)} (${RARITY_NAMES[rarity]})${locked ? ', locked' : ''}`)
  const classes = [styles.badge, locked && styles.locked, className].filter(Boolean).join(' ')
  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={name ? 'img' : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      focusable="false"
    >
      <BadgeFrame level={level} colors={colors} id={id} simple={simple}>
        <TitleEmblem title={title} colors={colors} simple={simple} />
      </BadgeFrame>
      {locked && (
        <g transform="translate(78 70)">
          <circle cx="14" cy="14" r="15" fill="#0a1417" stroke="#56727a" strokeWidth="2" />
          <path d="M9 13 V10 A5 5 0 0 1 19 10 V13" fill="none" stroke="#8fa6ad" strokeWidth="2.4" />
          <rect x="7" y="13" width="14" height="10" rx="2" fill="#8fa6ad" />
        </g>
      )}
    </svg>
  )
})
