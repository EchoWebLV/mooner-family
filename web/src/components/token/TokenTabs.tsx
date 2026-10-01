'use client'
// Under the chart (spec §5.5): recent trades, holders, and how the presale split.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Avatar } from '@/components/art/Avatar'
import { Badge } from '@/components/badges/Badge'
import { Tabs, tabId } from '@/components/ui/Tabs'
import { PRESALE_TARGET, SOL_USD, TOTAL_SUPPLY } from '@/lib/constants'
import { fmtAge, fmtCompact, fmtPct, fmtSol, fmtSolAmount, fmtSolRound, fmtUsd } from '@/lib/format'
import { rankMap } from '@/lib/leaderboard'
import { holders, mainBadge, presaleRows, type PresaleRow } from '@/lib/selectors'
import type { Token, World } from '@/lib/types'
import styles from './TokenTabs.module.css'

type TabIdent = 'trades' | 'holders' | 'presale'

const SHOWN = 50

interface TokenTabsProps {
  t: Token
  world: World
  className?: string
}

export function TokenTabs({ t, world, className }: TokenTabsProps) {
  const [tab, setTab] = useState<TabIdent>('trades')
  const items = [
    { id: 'trades', label: 'Trades' },
    { id: 'holders', label: 'Holders' },
    { id: 'presale', label: <>Presale <span className={styles.count}>{t.allocations?.length ?? 0}</span></> },
  ] as const
  return (
    <section className={`panel ${styles.panel} ${className ?? ''}`} aria-label="Market activity">
      <Tabs items={items} value={tab} onChange={setTab} label="Market activity" idPrefix="token" className={styles.tabs} />
      <div className={styles.body} role="tabpanel" aria-labelledby={tabId('token', tab)} tabIndex={0}>
        {tab === 'trades' && <TradesTable t={t} world={world} />}
        {tab === 'holders' && <HoldersTable t={t} world={world} />}
        {tab === 'presale' && <PresaleTable t={t} world={world} />}
      </div>
    </section>
  )
}

function Trader({ userId, world }: { userId: string; world: World }) {
  const u = world.users[userId]
  if (!u) return <span className="muted">unknown</span>
  const badge = mainBadge(u)
  return (
    <span className={styles.trader}>
      <Link href={`/profile/${u.handle}`} prefetch={false} className={styles.traderLink}>
        <Avatar handle={u.handle} size={18} className={styles.avatar} />
        <span className="ellipsis">@{u.handle}</span>
      </Link>
      <Badge title={badge.title} level={badge.level} size={16} />
      {u.id === world.meId && <span className={styles.you}>You</span>}
    </span>
  )
}

/** Newest first. */
function TradesTable({ t, world }: { t: Token; world: World }) {
  const rows = useMemo(() => t.trades.slice(-SHOWN).reverse(), [t.trades])
  if (rows.length === 0) return <p className={styles.empty}>No trades yet.</p>
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Age</th>
          <th scope="col">Side</th>
          <th scope="col">Trader</th>
          <th scope="col" className="right">SOL</th>
          <th scope="col" className="right">${t.ticker}</th>
          <th scope="col" className={`right ${styles.wide}`}>
            MC
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.id} data-me={x.userId === world.meId || undefined}>
            <td className="num muted" title={new Date(x.at).toISOString().slice(11, 19) + ' UTC'}>
              {fmtAge(world.now - x.at)}
            </td>
            <td className={x.side === 'buy' ? 'up' : 'down'}>{x.side === 'buy' ? 'Buy' : 'Sell'}</td>
            <td>
              <Trader userId={x.userId} world={world} />
            </td>
            <td className="num right">{fmtSolAmount(x.sol)}</td>
            <td className="num right">{fmtCompact(x.tokens)}</td>
            <td className={`num right muted ${styles.wide}`}>{fmtUsd(x.price * TOTAL_SUPPLY * SOL_USD)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function HoldersTable({ t, world }: { t: Token; world: World }) {
  const rows = useMemo(() => holders(t).slice(0, SHOWN), [t])
  if (rows.length === 0) return <p className={styles.empty}>The holder list isn&apos;t in yet. Your own balance is under Your position.</p>
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Holder</th>
          <th scope="col" className={`right ${styles.wide}`}>
            ${t.ticker}
          </th>
          <th scope="col" className="right">Supply</th>
          <th scope="col">
            <span className="sr-only">Tags</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h, i) => (
          <tr key={h.userId} data-me={h.userId === world.meId || undefined}>
            <td className="num muted">{i + 1}</td>
            <td>
              <Trader userId={h.userId} world={world} />
            </td>
            <td className={`num right ${styles.wide}`}>{fmtCompact(h.tokens)}</td>
            <td className="num right">{fmtPct(h.share)}</td>
            <td>
              <span className={styles.tags}>
                {h.presale && <span className={styles.tag}>Presale</span>}
                {h.userId === t.creatorId && <span className={styles.tag}>Creator</span>}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const HOLDS: Record<PresaleRow['holds'], { label: string; className: string }> = {
  all: { label: 'All', className: styles.holdsAll },
  some: { label: 'Some', className: styles.holdsSome },
  none: { label: 'None', className: styles.holdsNone },
}

function PresaleTable({ t, world }: { t: Token; world: World }) {
  const rows = useMemo(() => presaleRows(t), [t])
  const users = world.users
  const ranks = useMemo(() => rankMap(Object.values(users), 'overall'), [users])
  const holdingAll = rows.filter((r) => r.holds === 'all').length
  return (
    <>
      <p className={styles.summary}>
        {rows.length} wallets filled the {fmtSolRound(PRESALE_TARGET)} SOL pool at one price. {holdingAll} still hold everything
        they got.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Participant</th>
            <th scope="col" className="right">Rank</th>
            <th scope="col" className="right">SOL in</th>
            <th scope="col" className="right">Got</th>
            <th scope="col">Holds</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} data-me={r.userId === world.meId || undefined}>
              <td>
                <Trader userId={r.userId} world={world} />
              </td>
              <td className="num right muted">#{ranks.get(r.userId) ?? '—'}</td>
              <td className="num right">{fmtSol(r.commit)}</td>
              <td className="num right">{fmtCompact(r.tokens)}</td>
              <td>
                <span className={HOLDS[r.holds].className}>{HOLDS[r.holds].label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
