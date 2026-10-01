import type { ReactNode } from 'react'
import styles from './Rail.module.css'

interface RailProps {
  id: string
  title: string
  hint: string
  count: number
  /** On phones only the active rail shows (the others sit behind tabs). */
  active: boolean
  empty: string
  children: ReactNode
}

/** One Pulse column: a header with the rail's name and count, over a scrolling list of cards. */
export function Rail({ id, title, hint, count, active, empty, children }: RailProps) {
  const headingId = `rail-${id}-title`
  return (
    <section className={styles.rail} aria-labelledby={headingId} data-active={active}>
      <header className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        <span className={`num ${styles.count}`} aria-label={`${count} tokens`}>
          {count}
        </span>
        <span className={styles.hint}>{hint}</span>
      </header>
      <div className={styles.list}>{count === 0 ? <p className={styles.empty}>{empty}</p> : children}</div>
    </section>
  )
}
