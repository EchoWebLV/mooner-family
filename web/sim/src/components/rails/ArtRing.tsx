import type { CSSProperties } from 'react'
import { TokenArt } from '@/components/art/TokenArt'
import type { Stage } from '@/lib/types'
import styles from './cards.module.css'

interface ArtRingProps {
  name: string
  /** The meme the coin is named after, for its photo (Token.meme). */
  meme?: string
  stage: Stage
  /** 0..1: the pool on a presale, the curve once live, full once migrated. */
  fill: number
  size?: number
}

/** Token art inside a ring that fills in the stage's colour. Decoration: the row states the numbers. */
export function ArtRing({ name, meme, stage, fill, size = 56 }: ArtRingProps) {
  const style = { '--fill': Math.min(1, Math.max(0, fill)) } as CSSProperties
  return (
    <span className={styles.ring} data-stage={stage} style={style} aria-hidden>
      <TokenArt name={name} meme={meme} size={size} />
    </span>
  )
}
