'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MouseEvent } from 'react'
import { Avatar } from '@/components/art/Avatar'
import { Badge, badgeName } from '@/components/badges/Badge'
import { Icon } from '@/components/ui/Icon'
import { fmtNumber, fmtPct, roman } from '@/lib/format'
import { boardXp, KEY_STAT_LABELS, keyStat, migratedPct, presalesJoined, type Board } from '@/lib/leaderboard'
import { levelName, mainTitle, TITLES } from '@/lib/levels'
import type { User } from '@/lib/types'
import styles from './Leaderboard.module.css'

export interface RankedRow {
  user: User
  /** 1-based rank on the whole board, kept while a search filters the list. */
  rank: number
}

interface LeaderboardTableProps {
  rows: readonly RankedRow[]
  /** Your row, pinned above the ranking whatever the search. */
  mine?: RankedRow
  board: Board
  meId: string
  query: string
}

export function LeaderboardTable({ rows, mine, board, meId, query }: LeaderboardTableProps) {
  const router = useRouter()
  // Clicking anywhere on a row opens the profile; the handle link is the keyboard and screen-reader path.
  const open = (e: MouseEvent<HTMLTableRowElement>, handle: string) => {
    if ((e.target as Element).closest('a, button')) return
    router.push(`/profile/${handle}`)
  }

  return (
    <>
      <table className={`table ${styles.table}`}>
        <caption className="sr-only">Leaderboard, ranked by XP. Your row is pinned first.</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.colRank}>
              #
            </th>
            <th scope="col">Mooner</th>
            <th scope="col" className={styles.colBadge}>
              {board === 'overall' ? (
                <>
                  <span className={styles.notPhone}>Badges</span>
                  <span className={styles.phoneOnly}>Title</span>
                </>
              ) : (
                'Level'
              )}
            </th>
            <th scope="col" className={`right ${styles.colXp}`}>
              XP
            </th>
            <th scope="col" className={`right ${styles.colRecord}`}>
              Presales
            </th>
            <th scope="col" className={`right ${styles.colRecord}`}>
              Migrated
            </th>
            <th scope="col" className={`right ${styles.colStat}`}>
              {KEY_STAT_LABELS[board]}
            </th>
            <th scope="col" className={`right ${styles.colInvite}`}>
              <span className="sr-only">Invite</span>
            </th>
          </tr>
        </thead>
        {mine && (
          <tbody className={styles.pinned}>
            <Row row={mine} board={board} me onOpen={open} />
          </tbody>
        )}
        <tbody>
          {rows.map((r) => (
            <Row key={r.user.id} row={r} board={board} me={r.user.id === meId} onOpen={open} />
          ))}
        </tbody>
      </table>
      {/* Outside the table: a spanning cell can't know how many columns this width shows. */}
      {rows.length === 0 && <p className={styles.empty}>Nobody matches &ldquo;{query}&rdquo;.</p>}
    </>
  )
}

interface RowProps {
  row: RankedRow
  board: Board
  me: boolean
  onOpen: (e: MouseEvent<HTMLTableRowElement>, handle: string) => void
}

function Row({ row: { user: u, rank }, board, me, onOpen }: RowProps) {
  const migrated = migratedPct(u)
  const stat = keyStat(u, board)
  return (
    <tr className={styles.row} data-me={me || undefined} onClick={(e) => onOpen(e, u.handle)}>
      <td className={styles.colRank}>
        <span className={`num ${styles.rank}`} data-rank={rank <= 3 ? rank : undefined}>
          {rank}
        </span>
      </td>
      <td>
        <span className={styles.who}>
          <Link href={`/profile/${u.handle}`} className={styles.player} title={`@${u.handle}`}>
            <Avatar handle={u.handle} size={28} className={styles.avatar} />
            <span className="ellipsis">@{u.handle}</span>
          </Link>
          {me && <span className={styles.you}>You</span>}
        </span>
      </td>
      <td className={styles.colBadge}>
        <BoardBadge u={u} board={board} />
      </td>
      <td className={`num right ${styles.colXp} ${styles.xp}`}>{fmtNumber(boardXp(u, board), 0)}</td>
      <td className={`num right ${styles.colRecord}`}>{presalesJoined(u)}</td>
      <td className={`num right ${styles.colRecord}`}>{migrated === null ? '—' : fmtPct(migrated, 0)}</td>
      <td className={`right ${styles.colStat} ${board === 'overall' ? '' : 'num'}`}>{stat.value}</td>
      <td className={`right ${styles.colInvite}`}>
        <button
          type="button"
          className={`btn btn-sm ${styles.invite}`}
          disabled
          title="Project invites coming soon"
          aria-label={`Invite @${u.handle}: project invites coming soon`}
        >
          <Icon name="lock" size={12} />
          Invite
        </button>
      </td>
    </tr>
  )
}

/** Overall: all four badges, main title first. A title board: that title's badge and level. */
function BoardBadge({ u, board }: { u: User; board: Board }) {
  if (board === 'overall') {
    const main = mainTitle(u.titles)
    const order = [main, ...TITLES.filter((t) => t !== main)]
    return (
      <span className={styles.badges}>
        {order.map((t) => (
          <Badge key={t} title={t} level={u.titles[t].level} size={t === main ? 28 : 22} className={styles.badge} />
        ))}
      </span>
    )
  }
  const level = u.titles[board].level
  return (
    <span className={styles.level}>
      <Badge title={board} level={level} size={28} label={badgeName(board, level)} className={styles.badge} />
      <span className={styles.levelText} aria-hidden>
        {roman(level)} · {levelName(board, level)}
      </span>
    </span>
  )
}
