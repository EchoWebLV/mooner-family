import type { ReactNode } from 'react'
import { roman } from '@/lib/format'
import type { Level } from '@/lib/types'
import styles from './Badge.module.css'
import type { RarityColors } from './palette'

// All frames share a 120 × 120 box with the body centred near (60, 54).

function starPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const step = Math.PI / points
  let d = ''
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + i * step
    d += (i === 0 ? 'M' : 'L') + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1) + ' '
  }
  return d + 'Z'
}

function raysPath(cx: number, cy: number, r: number, count: number, halfWidthDeg: number): string {
  let d = ''
  for (let i = 0; i < count; i++) {
    const a = (i * 2 * Math.PI) / count
    const w = (halfWidthDeg * Math.PI) / 180
    const p1 = [cx + r * Math.cos(a - w), cy + r * Math.sin(a - w)]
    const p2 = [cx + r * Math.cos(a + w), cy + r * Math.sin(a + w)]
    d += `M${cx} ${cy} L${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L${p2[0].toFixed(1)} ${p2[1].toFixed(1)} Z `
  }
  return d
}

/** The body outline per level: disc → riveted hex → shield → crest → star. */
const BODY: Record<Level, string> = {
  1: 'M26 54 A34 34 0 1 1 94 54 A34 34 0 1 1 26 54 Z',
  2: 'M60 15 L93.8 34.5 L93.8 73.5 L60 93 L26.2 73.5 L26.2 34.5 Z',
  3: 'M28 22 L60 12 L92 22 V54 C92 75 78 88 60 97 C42 88 28 75 28 54 Z',
  4: 'M30 20 L46 16 L60 8 L74 16 L90 20 V54 C90 75 77 88 60 97 C43 88 30 75 30 54 Z',
  5: starPath(60, 55, 43, 34, 8),
}

const RIVETS: [number, number][] = [
  [60, 22],
  [87.3, 37.8],
  [87.3, 70.2],
  [32.7, 70.2],
  [32.7, 37.8],
]

const WING =
  'M33 30 C21 24 9 28 3 40 C11 37 17 37 23 39 C13 43 8 50 6 58 C14 52 20 50 26 51 C18 56 15 63 15 70 C22 63 27 60 32 59 Z'

const RAYS = raysPath(60, 55, 57, 12, 4.5)

interface FrameProps {
  level: Level
  colors: RarityColors
  /** Unique prefix for gradient and clip ids. */
  id: string
  simple: boolean
  children: ReactNode
}

export function BadgeFrame({ level, colors, id, simple, children }: FrameProps) {
  const body = BODY[level]
  const bannered = level >= 3
  return (
    <>
      <defs>
        <radialGradient id={`${id}-fill`} cx="0.5" cy="0.35" r="0.75">
          <stop offset="0" stopColor={colors.dark} />
          <stop offset="1" stopColor={colors.deep} />
        </radialGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colors.light} />
          <stop offset="0.5" stopColor={colors.base} />
          <stop offset="1" stopColor={colors.dark} />
        </linearGradient>
      </defs>

      {level === 5 && <path d={RAYS} fill={colors.base} opacity="0.35" />}
      {level === 4 && (
        <g fill={`url(#${id}-edge)`} stroke={colors.dark} strokeWidth="1.2" strokeLinejoin="round">
          <path d={WING} />
          <path d={WING} transform="translate(120 0) scale(-1 1)" />
        </g>
      )}

      <path d={body} fill={`url(#${id}-fill)`} stroke={`url(#${id}-edge)`} strokeWidth="4" strokeLinejoin="round" />
      <path d={body} fill="none" stroke={colors.light} strokeOpacity="0.25" strokeWidth="1" transform="translate(60 55) scale(0.86) translate(-60 -55)" />
      {level === 2 && !simple && RIVETS.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.3" fill={colors.light} />)}

      <g transform="translate(40 33)">{children}</g>

      {level === 5 && (
        <g>
          <path d="M40 22 L43 6 L51 15 L60 1 L69 15 L77 6 L80 22 Z" fill={`url(#${id}-edge)`} stroke={colors.dark} strokeWidth="1.2" strokeLinejoin="round" />
          {!simple && [43, 60, 77].map((x) => <circle key={x} cx={x} cy={x === 60 ? 2.5 : 7} r="2.6" fill={colors.light} />)}
        </g>
      )}

      {bannered ? (
        <g>
          <path d="M34 89 H21 L26.5 96 L21 103 H34 Z M86 89 H99 L93.5 96 L99 103 H86 Z" fill={colors.dark} />
          <path d="M33 86 H87 V102 H33 Z" fill={`url(#${id}-edge)`} />
        </g>
      ) : (
        !simple && <rect x="42" y="84" width="36" height="18" rx="4" fill={`url(#${id}-edge)`} />
      )}
      {!simple && (
        <text x="60" y="98.6" textAnchor="middle" className={styles.numeral} fill={colors.deep}>
          {roman(level)}
        </text>
      )}
    </>
  )
}
