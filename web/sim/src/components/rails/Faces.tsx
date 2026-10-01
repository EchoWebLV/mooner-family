'use client'
import { useLayoutEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/art/Avatar'
import styles from './cards.module.css'

/** Spec §5.2: the first 12 participants, then "+N". */
const MAX = 12
const SIZE = 18
/** Each face after the first adds this much: its size less the overlap. */
const STEP = 12
/** Room kept for "+N". */
const MORE = 28

interface FacesProps {
  people: { id: string; handle: string }[]
}

/** A presale's participants as overlapping circles, in join order. Shows as many as the space allows, then "+N". */
export function Faces({ people }: FacesProps) {
  const ref = useRef<HTMLUListElement>(null)
  const [room, setRoom] = useState(MAX)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const fits = Math.floor((entry.contentRect.width - MORE - SIZE) / STEP) + 1
      setRoom(Math.max(1, Math.min(MAX, fits)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const shown = people.slice(0, room)
  const extra = people.length - shown.length

  return (
    <ul ref={ref} className={styles.faces} aria-label={`${people.length} participants`}>
      {shown.map((p) => (
        <li key={p.id}>
          <Avatar handle={p.handle} size={SIZE} />
        </li>
      ))}
      {extra > 0 && <li className={`num ${styles.more}`}>+{extra}</li>}
    </ul>
  )
}
