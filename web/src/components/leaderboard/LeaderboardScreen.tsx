'use client'
// Public leaderboard (spec §4.5, §5.7): everyone ranked by XP, overall and per title.
import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Tabs, tabId, type TabItem } from '@/components/ui/Tabs'
import { useApp } from '@/components/world/WorldProvider'
import { BOARDS, ranking, type Board } from '@/lib/leaderboard'
import { TITLE_MEASURES, TITLE_NAMES } from '@/lib/levels'
import styles from './Leaderboard.module.css'
import { LeaderboardTable, type RankedRow } from './LeaderboardTable'

export const BOARD_NAMES: Record<Board, string> = { overall: 'Overall', ...TITLE_NAMES }

const TAB_ITEMS: readonly TabItem<Board>[] = BOARDS.map((b) => ({ id: b, label: BOARD_NAMES[b] }))

/** The board's URL, so a tab can be shared or linked from a profile. */
export function boardHref(board: Board): string {
  return board === 'overall' ? '/leaderboard' : `/leaderboard?board=${board}`
}

export function LeaderboardScreen({ initialBoard }: { initialBoard: Board }) {
  const users = useApp((s) => s.world.users)
  const meId = useApp((s) => s.world.meId)
  const [board, setBoard] = useState(initialBoard)
  const [query, setQuery] = useState('')

  const ranked = useMemo<RankedRow[]>(
    () => ranking(Object.values(users), board).map((user, i) => ({ user, rank: i + 1 })),
    [users, board],
  )
  const q = query.trim().replace(/^@/, '').toLowerCase()
  const rows = q ? ranked.filter((r) => r.user.handle.toLowerCase().includes(q)) : ranked
  const mine = ranked.find((r) => r.user.id === meId)

  const pick = (next: Board) => {
    setBoard(next)
    window.history.replaceState(null, '', boardHref(next))
  }

  return (
    <div className={`page ${styles.screen}`}>
      <header className={styles.head}>
        <h1 className="page-title">Leaderboard</h1>
        <p className={styles.lede}>
          Everyone, ranked in public by XP. Before you join a presale, see who&apos;s behind it: KOLs who call
          winners, Diamond Hands who hold to migration, Shillers and Raiders who bring the crowd.
        </p>
      </header>

      <section className={`panel ${styles.board}`} aria-label="Rankings">
        <div className={styles.toolbar}>
          <Tabs items={TAB_ITEMS} value={board} onChange={pick} label="Leaderboards" idPrefix="lb" className={styles.tabs} />
          <div className={styles.search}>
            <Icon name="search" size={14} className={styles.searchIcon} />
            <label htmlFor="lb-search" className="sr-only">
              Search by handle
            </label>
            <input
              id="lb-search"
              type="search"
              className="input"
              placeholder="Search @handle"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div role="tabpanel" aria-labelledby={tabId('lb', board)} className={styles.panelBody}>
          <p className={styles.summary} aria-live="polite">
            {q ? (
              <>
                <span className="num">{rows.length}</span> of <span className="num">{ranked.length}</span>{' '}
                {ranked.length === 1 ? 'Mooner matches' : 'Mooners match'} &ldquo;{query.trim()}&rdquo;
              </>
            ) : (
              <>
                <span className="num">{ranked.length}</span> {ranked.length === 1 ? 'Mooner' : 'Mooners'} ranked by{' '}
                {board === 'overall' ? (
                  'total XP across all four titles'
                ) : (
                  <>
                    {TITLE_NAMES[board]} XP <span className="faint">· {TITLE_MEASURES[board].toLowerCase()}</span>
                  </>
                )}
              </>
            )}
          </p>
          <LeaderboardTable rows={rows} mine={mine} board={board} meId={meId} query={query.trim()} />
          <p className={styles.footnote}>
            <Icon name="lock" size={12} /> Project invites are coming soon: invite the top of the board straight into
            your presale.
          </p>
        </div>
      </section>
    </div>
  )
}
