'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'
import { TokenArt } from '@/components/art/TokenArt'
import { Icon } from '@/components/ui/Icon'
import { Links } from '@/components/ui/Links'
import { Change } from '@/components/ui/Stat'
import { PRESALE_TARGET, QUICK_BUY_SOL } from '@/lib/constants'
import { holdersOf, isTrading, type Sort, type SortKey } from '@/lib/discover'
import { fmtAge, fmtPct, fmtSol, fmtSolRound, fmtUsd, STAGE_LABELS } from '@/lib/format'
import { participantOf, poolLamports } from '@/lib/presale'
import { liquidityUsd, marketCapUsd, priceChange, progressOf, tokenHref, volumeUsd } from '@/lib/selectors'
import type { Participant, Token } from '@/lib/types'
import styles from './Discover.module.css'
import type { HoldHandlers } from './useHeldOrder'

const COLUMNS: readonly { key: SortKey; label: ReactNode; className: string }[] = [
  { key: 'mcap', label: 'Market cap', className: styles.colMcap },
  { key: 'change', label: <>5m<span className="sr-only"> change</span></>, className: styles.colChange },
  { key: 'volume', label: 'Volume', className: styles.colVolume },
  { key: 'holders', label: 'Holders', className: styles.colHolders },
  { key: 'age', label: 'Age', className: styles.colAge },
]

const SORT_NAMES: Record<SortKey, string> = {
  mcap: 'market cap',
  change: 'price change over 5 minutes',
  volume: 'volume',
  holders: 'holders',
  age: 'age',
}

/** "sorted by market cap, highest first" */
export function sortPhrase({ key, dir }: Sort): string {
  const order = key === 'age' ? (dir === 'asc' ? 'newest' : 'oldest') : dir === 'desc' ? 'highest' : 'lowest'
  return `sorted by ${SORT_NAMES[key]}, ${order} first`
}

interface DiscoverTableProps {
  rows: readonly Token[]
  now: number
  meId: string
  sort: Sort
  onSort: (key: SortKey) => void
  onQuickBuy: (t: Token) => void
  /** Hold the order still while you point at the rows or move through them. */
  hold: HoldHandlers
  /** Said under the header when there are no rows. */
  empty: string
}

export function DiscoverTable({ rows, now, meId, sort, onSort, onQuickBuy, hold, empty }: DiscoverTableProps) {
  const router = useRouter()
  // Clicking anywhere on a row opens the coin; the name link is the keyboard and screen-reader path.
  const open = (e: MouseEvent<HTMLTableRowElement>, href: string) => {
    if ((e.target as Element).closest('a, button')) return
    router.push(href)
  }

  return (
    <>
      <table className={`table ${styles.table}`}>
        <caption className="sr-only">Coins on Mooner, {sortPhrase(sort)}.</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.colCoin}>
              Coin
            </th>
            {COLUMNS.map((c) => {
              const active = sort.key === c.key
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`right ${c.className}`}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <button type="button" className={styles.sort} onClick={() => onSort(c.key)}>
                    <span>{c.label}</span>
                    <span className={styles.arrow} aria-hidden>
                      {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              )
            })}
            <th scope="col" className={styles.colSocials}>
              Socials
            </th>
            <th scope="col" className={`right ${styles.colAction}`}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody {...hold}>
          {rows.map((t) => (
            <Row key={t.id} t={t} now={now} meId={meId} onOpen={open} onQuickBuy={onQuickBuy} />
          ))}
        </tbody>
      </table>
      {/* Outside the table: a spanning cell can't know how many columns this width shows. */}
      {rows.length === 0 && <p className={styles.empty}>{empty}</p>}
    </>
  )
}

interface RowProps {
  t: Token
  now: number
  meId: string
  onOpen: (e: MouseEvent<HTMLTableRowElement>, href: string) => void
  onQuickBuy: (t: Token) => void
}

function Row({ t, now, meId, onOpen, onQuickBuy }: RowProps) {
  const trading = isTrading(t)
  const href = tokenHref(t)
  const mine = participantOf(t.presale, meId)
  const holding = trading && (t.positions[meId] ?? 0) > 0
  const age = fmtAge(now - t.createdAt)

  return (
    <tr className={styles.row} data-me={mine || holding ? '' : undefined} onClick={(e) => onOpen(e, href)}>
      <td className={styles.colCoin}>
        <span className={styles.coin}>
          <TokenArt name={t.name} meme={t.meme} size={36} className={styles.art} />
          <span className={styles.coinText}>
            <span className={styles.nameLine}>
              <Link href={href} prefetch={false} className={`ellipsis ${styles.name}`}>
                {t.name}
              </Link>
              {!trading && t.presale.visibility === 'private' && (
                <span className={styles.lock} title="Private presale: invite link only">
                  <Icon name="lock" size={12} />
                  <span className="sr-only">Private</span>
                </span>
              )}
            </span>
            <span className={styles.subLine}>
              <span className={`num ${styles.ticker}`}>${t.ticker}</span>
              <span className={styles.stage}>{STAGE_LABELS[t.stage]}</span>
              {holding && <span className={`${styles.stage} ${styles.mine}`}>Holding</span>}
            </span>
          </span>
        </span>
      </td>
      <td className={`right ${styles.colMcap}`}>
        <Figure t={t} />
      </td>
      <td className={`num right ${styles.colChange}`}>
        {trading ? <Change value={priceChange(t, now)} /> : <None label="No price yet" />}
      </td>
      <td className={`num right ${styles.colVolume}`}>{trading ? fmtUsd(volumeUsd(t)) : <None label="No trades yet" />}</td>
      <td className={`num right ${styles.colHolders}`} title={trading ? undefined : 'People in the pool'}>
        {holdersOf(t)}
      </td>
      <td className={`num right ${styles.colAge}`} title={age === 'now' ? 'Just opened' : `Opened ${age} ago`}>
        {age}
      </td>
      <td className={styles.colSocials}>
        <Links links={t.links} variant="icons" name={t.name} />
      </td>
      <td className={`right ${styles.colAction}`}>
        <Action t={t} mine={mine} onQuickBuy={onQuickBuy} />
      </td>
    </tr>
  )
}

/** Market cap once it trades, with the curve or the pool's liquidity; before that, the pool filling to its target. */
function Figure({ t }: { t: Token }) {
  if (!isTrading(t)) {
    const pool = poolLamports(t.presale)
    const target = fmtSolRound(PRESALE_TARGET)
    return (
      <>
        <span className={`num ${styles.figure}`}>
          <span className={styles.value}>{fmtSol(pool)}</span>
          <span className={styles.target}> / {target}</span> SOL
        </span>
        <Meter fill={Math.min(1, pool / PRESALE_TARGET)} label="Pool" text={`${fmtSol(pool)} of ${target} SOL`} />
      </>
    )
  }
  return (
    <>
      <span className={`num ${styles.figure}`}>
        <span className={styles.value}>{fmtUsd(marketCapUsd(t))}</span>
      </span>
      {t.stage === 'live' ? (
        <Meter fill={progressOf(t)} label="Bonding curve" up />
      ) : (
        <span className={`num ${styles.sub}`}>
          <abbr title="Liquidity">L</abbr> {fmtUsd(liquidityUsd(t))}
        </span>
      )}
    </>
  )
}

function Meter({ fill, label, text, up = false }: { fill: number; label: string; text?: string; up?: boolean }) {
  const pct = fmtPct(fill, 0)
  return (
    <span className={styles.meter}>
      <span
        className={`bar ${up ? 'bar-up' : ''} ${styles.bar}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill * 100)}
        aria-valuetext={text ?? pct}
      >
        <span style={{ width: `${(fill * 100).toFixed(1)}%` }} />
      </span>
      {up && (
        <span className="num" aria-hidden>
          {pct}
        </span>
      )}
    </span>
  )
}

/** A column that doesn't apply yet: a presale has no price or trades. */
function None({ label }: { label: string }) {
  return (
    <>
      <span className="faint" aria-hidden>
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  )
}

function Action({ t, mine, onQuickBuy }: { t: Token; mine?: Participant; onQuickBuy: (t: Token) => void }) {
  if (mine) {
    return (
      <span className={styles.stack}>
        <span className={styles.mine}>You&apos;re in</span>
        <span className={`num ${styles.sub} ${styles.commit}`}>{fmtSol(mine.commit)} SOL</span>
      </span>
    )
  }
  if (t.stage === 'launching') return <span className={styles.note}>Pool full</span>
  if (t.stage === 'presale' && t.presale.visibility === 'private') {
    return (
      <button type="button" className={`btn btn-sm ${styles.act}`} disabled title="Private presale: invite link only">
        <Icon name="lock" size={12} />
        <span className={styles.actText}>Invite only</span>
      </button>
    )
  }
  if (t.stage === 'presale') {
    return (
      <Link href={`/presale/${t.id}#join`} prefetch={false} className={`btn btn-primary btn-sm ${styles.act}`}>
        Join<span className="sr-only"> the {t.name} presale</span>
      </Link>
    )
  }
  return (
    <button type="button" className={`btn btn-primary btn-sm ${styles.act}`} onClick={() => onQuickBuy(t)}>
      <Icon name="bolt" size={12} />
      <span className="num">{QUICK_BUY_SOL}</span>
      <span className={styles.actText}> SOL</span>
      <span className="sr-only"> quick buy {t.name}</span>
    </button>
  )
}
