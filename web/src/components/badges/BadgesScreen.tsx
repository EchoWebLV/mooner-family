'use client'
// The badge gallery (spec §5.9): all 20 badges, one row per title, and how each title earns XP.
import Link from 'next/link'
import { useApp } from '@/components/world/WorldProvider'
import { fmtNumber, roman } from '@/lib/format'
import {
  LEVELS, levelName, RARITY_NAMES, rarityOf, TITLE_MEASURES, TITLE_NAMES, TITLE_XP_HOWTO, TITLES, xpForLevel,
} from '@/lib/levels'
import type { Level, Title } from '@/lib/types'
import { Badge } from './Badge'
import styles from './BadgesScreen.module.css'

export function BadgesScreen() {
  const me = useApp((s) => s.world.users[s.world.meId])
  return (
    <div className={`page ${styles.screen}`}>
      <header className={styles.head}>
        <h1 className="page-title">Badges</h1>
        <p className={styles.lede}>
          Twenty badges: four titles, five levels each. The frame shows the level, the emblem the title and the colour
          the rarity. Every title levels up on its own, from what you do.
        </p>
      </header>

      <div className={`panel ${styles.gallery}`}>
        {TITLES.map((title) => (
          <section key={title} className={styles.row} aria-labelledby={`badges-${title}`}>
            <div className={styles.rowHead}>
              <h2 id={`badges-${title}`} className={styles.rowTitle}>
                {TITLE_NAMES[title]}
              </h2>
              <p className={styles.measures}>{TITLE_MEASURES[title]}</p>
            </div>
            <ol className={styles.levels}>
              {LEVELS.map((level) => (
                <LevelCard key={level} title={title} level={level} mine={me.titles[title].level === level} />
              ))}
            </ol>
          </section>
        ))}
      </div>

      <section className={styles.howto} aria-labelledby="badges-howto">
        <h2 id="badges-howto" className={styles.howtoTitle}>
          How each title earns XP
        </h2>
        <dl className={styles.howList}>
          {TITLES.map((title) => (
            <div key={title} className={styles.how}>
              <dt className={styles.howTitle}>{TITLE_NAMES[title]}</dt>
              <dd className={styles.howText}>{TITLE_XP_HOWTO[title]}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.try}>
          Scoring isn&apos;t live yet: XP starts counting in a later update.
          <Link href={`/profile/${me.handle}`} className="btn btn-sm">
            Open your profile
          </Link>
        </p>
      </section>
    </div>
  )
}

function LevelCard({ title, level, mine }: { title: Title; level: Level; mine: boolean }) {
  const rarity = rarityOf(level)
  return (
    <li className={styles.card}>
      <Badge title={title} level={level} size={128} label={false} className={styles.badge} />
      <p className={styles.name}>{levelName(title, level)}</p>
      <p className={styles.meta}>
        {roman(level)} · <span style={{ color: `var(--r-${rarity})` }}>{RARITY_NAMES[rarity]}</span>
      </p>
      <p className={styles.xp}>
        {level === 1 ? (
          'Everyone starts here'
        ) : (
          <>
            Unlocks at <span className="num">{fmtNumber(xpForLevel(level), 0)}</span> XP
          </>
        )}
      </p>
      {mine && <p className={styles.mine}>You&apos;re here</p>}
    </li>
  )
}
