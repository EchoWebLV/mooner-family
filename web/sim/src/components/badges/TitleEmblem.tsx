import type { Title } from '@/lib/types'
import type { RarityColors } from './palette'

interface EmblemProps {
  title: Title
  colors: RarityColors
  /** Drops fine strokes that turn to mush at small sizes. */
  simple: boolean
}

/** The title's emblem, drawn in a 40 × 40 box (spec §4.3). */
export function TitleEmblem({ title, colors, simple }: EmblemProps) {
  const { light, base, deep } = colors
  switch (title) {
    case 'kol':
      // Megaphone with waves.
      return (
        <g>
          <path d="M5 15 H11 L27 6 V34 L11 25 H5 Z" fill={light} />
          <path d="M12 25 L14.5 33 H19 L16.5 26.5 Z" fill={light} />
          <path d="M31 13.5 Q35.5 20 31 26.5" fill="none" stroke={light} strokeWidth="2.6" strokeLinecap="round" />
          {!simple && <path d="M35 9.5 Q42 20 35 30.5" fill="none" stroke={light} strokeWidth="2.6" strokeLinecap="round" />}
        </g>
      )
    case 'diamond':
      // A diamond held in cupped hands.
      return (
        <g>
          <path d="M13 4 H27 L32.5 10.5 L20 25 L7.5 10.5 Z" fill={light} />
          {!simple && (
            <path d="M7.5 10.5 H32.5 M16 4 L14 10.5 L20 25 M24 4 L26 10.5 L20 25" fill="none" stroke={deep} strokeWidth="1.1" opacity="0.55" />
          )}
          <path d="M2.5 22 C3.5 31 10 37 20 37 C30 37 36.5 31 37.5 22 L33 21 C31.5 27.5 27 31 20 31 C13 31 8.5 27.5 7 21 Z" fill={light} />
          <circle cx="4.8" cy="21.2" r="2.4" fill={light} />
          <circle cx="35.2" cy="21.2" r="2.4" fill={light} />
        </g>
      )
    case 'shiller':
      // A rocket inside a speech bubble.
      return (
        <g>
          <path
            d="M6 4 H34 A4 4 0 0 1 38 8 V25 A4 4 0 0 1 34 29 H17 L9 36.5 V29 H6 A4 4 0 0 1 2 25 V8 A4 4 0 0 1 6 4 Z"
            fill={deep}
            fillOpacity="0.35"
            stroke={light}
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <g transform="rotate(40 20 16.5)">
            <path d="M20 6.5 C24 9.5 25 14.5 24 21 H16 C15 14.5 16 9.5 20 6.5 Z" fill={light} />
            <path d="M16 16.5 L12.5 22.5 L16 21 Z M24 16.5 L27.5 22.5 L24 21 Z" fill={light} />
            <path d="M17.5 21.5 L20 26.5 L22.5 21.5 Z" fill={base} />
            {!simple && <circle cx="20" cy="13" r="1.9" fill={deep} />}
          </g>
        </g>
      )
    case 'raider':
      // Crossed swords with a bolt.
      return (
        <g>
          {[false, true].map((mirror) => (
            <g key={String(mirror)} transform={mirror ? 'translate(40 0) scale(-1 1)' : undefined}>
              <path d="M30.5 3.5 H36.5 V9.5 L14.5 31.5 L8.5 25.5 Z" fill={light} />
              <path d="M6.5 21.5 L18.5 33.5" stroke={light} strokeWidth="3.2" strokeLinecap="round" />
              <path d="M10 30 L4.5 35.5" stroke={light} strokeWidth="3.6" strokeLinecap="round" />
            </g>
          ))}
          <path d="M23 7 L13.5 21.5 H19.5 L16.5 33 L27 17.5 H21 L24.5 7 Z" fill={base} stroke={deep} strokeWidth="1.4" strokeLinejoin="round" />
        </g>
      )
  }
}
