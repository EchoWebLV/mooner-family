import Link from 'next/link'
import { Badge } from '@/components/badges/Badge'
import { LEVELS, TITLE_NAMES, TITLES } from '@/lib/levels'
import { badgesEarned } from '@/lib/profile'
import type { User } from '@/lib/types'
import styles from './Profile.module.css'

/** All 20 badges, title by level; the ones not earned yet are greyed out and locked (spec §5.8). */
export function BadgeCabinet({ u }: { u: User }) {
  return (
    <section className={`panel ${styles.cabinet}`} aria-labelledby="cabinet-title">
      <header className={styles.panelHead}>
        <h2 id="cabinet-title" className="panel-title">
          Badge cabinet
        </h2>
        <span className={styles.panelNote}>
          <span className="num">{badgesEarned(u)}</span> of <span className="num">20</span> earned
        </span>
      </header>
      <ul className={styles.shelves}>
        {TITLES.map((title) => (
          <li key={title} className={styles.shelf}>
            <span className={styles.shelfName}>{TITLE_NAMES[title]}</span>
            <span className={styles.shelfBadges}>
              {LEVELS.map((level) => (
                <Badge key={level} title={title} level={level} size={48} locked={level > u.titles[title].level} />
              ))}
            </span>
          </li>
        ))}
      </ul>
      <footer className={styles.panelFoot}>
        <Link href="/badges" className="btn btn-ghost btn-sm">
          How badges work
        </Link>
      </footer>
    </section>
  )
}
