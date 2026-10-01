import Link from 'next/link'
import { Badge } from '@/components/badges/Badge'
import { XpBar } from '@/components/badges/XpBar'
import { boardHref } from '@/components/leaderboard/LeaderboardScreen'
import { fmtNumber, roman } from '@/lib/format'
import { levelName, RARITY_NAMES, rarityOf, TITLE_NAMES, xpForLevel } from '@/lib/levels'
import { titleStats } from '@/lib/profile'
import type { Level, Title, User } from '@/lib/types'
import styles from './Profile.module.css'

interface TitleCardProps {
  u: User
  title: Title
  /** Rank on this title's leaderboard. */
  rank?: number
}

/** One title (spec §5.8): its badge and level, XP towards the next, the badge after this one, the stats behind it. */
export function TitleCard({ u, title, rank }: TitleCardProps) {
  const { xp, level } = u.titles[title]
  const rarity = rarityOf(level)
  const next = level < 5 ? ((level + 1) as Level) : null
  const headingId = `title-${title}`
  return (
    <article className={styles.titleCard} aria-labelledby={headingId}>
      <div className={styles.titleTop}>
        <Badge title={title} level={level} size={64} label={false} />
        <div className={styles.titleText}>
          <h3 id={headingId} className={styles.titleName}>
            {TITLE_NAMES[title]}
          </h3>
          <p className={styles.levelLine}>
            {roman(level)} · {levelName(title, level)} ·{' '}
            <span style={{ color: `var(--r-${rarity})` }}>{RARITY_NAMES[rarity]}</span>
          </p>
        </div>
        {rank !== undefined && (
          <Link href={boardHref(title)} className={styles.titleRank} title={`Rank on the ${TITLE_NAMES[title]} leaderboard`}>
            <span className="sr-only">{TITLE_NAMES[title]} rank </span>
            <span className="num">#{rank}</span>
          </Link>
        )}
      </div>

      <XpBar xp={xp} />

      <p className={styles.next}>
        {next ? (
          <>
            <Badge title={title} level={next} size={28} locked label={false} />
            <span>
              Next: <span className={styles.nextName}>{levelName(title, next)}</span> in{' '}
              <span className="num">{fmtNumber(xpForLevel(next) - xp, 0)}</span> XP
            </span>
          </>
        ) : (
          'Top level: every badge of this title earned'
        )}
      </p>

      <dl className={styles.titleStats}>
        {titleStats(u, title).map((s) => (
          <div key={s.label} className={styles.statRow}>
            <dt>{s.label}</dt>
            <dd className="num">{s.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}
