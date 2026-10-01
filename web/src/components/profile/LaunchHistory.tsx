import Link from 'next/link'
import { fmtAge, fmtSol, fmtSolAmount, STAGE_LABELS } from '@/lib/format'
import { historyPnl, tokenHref } from '@/lib/selectors'
import type { User, World } from '@/lib/types'
import styles from './Profile.module.css'

interface LaunchHistoryProps {
  u: User
  world: World
  me: boolean
}

/** Every presale they were in that launched or expired, newest first, with its paper PnL (spec §5.8). */
export function LaunchHistory({ u, world, me }: LaunchHistoryProps) {
  return (
    <section className={`panel ${styles.history}`} aria-labelledby="history-title">
      <header className={styles.panelHead}>
        <h2 id="history-title" className="panel-title">
          Launch history
        </h2>
        <span className={styles.panelNote}>PnL is marked to the current price</span>
      </header>
      {u.history.length === 0 ? (
        <div className={styles.empty}>
          {me ? (
            <>
              <p>Nothing yet. Join a presale and it shows up here once it launches or expires.</p>
              <Link href="/" className="btn btn-sm">
                Find one on Pulse
              </Link>
            </>
          ) : (
            <p>@{u.handle} hasn&apos;t been in a presale yet.</p>
          )}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={`table ${styles.table}`}>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col" className="right">
                  Committed
                </th>
                <th scope="col">Outcome</th>
                <th scope="col" className="right">
                  PnL
                </th>
                <th scope="col" className={`right ${styles.colWhen}`}>
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {u.history.map((h) => {
                const t = world.tokens[h.tokenId]
                const age = fmtAge(world.now - h.at)
                return (
                  <tr key={h.tokenId}>
                    <td className={styles.tokenCell}>
                      {t ? (
                        <Link href={tokenHref(t)} prefetch={false} className={styles.tokenLink}>
                          {h.name}
                        </Link>
                      ) : (
                        <span className={styles.tokenName}>{h.name}</span>
                      )}{' '}
                      <span className="num faint">${h.ticker}</span>
                    </td>
                    <td className="num right">{fmtSol(h.commit)} SOL</td>
                    <td>{STAGE_LABELS[h.outcome]}</td>
                    <td className="num right">
                      {h.outcome === 'expired' ? <span className="faint">Refunded</span> : <Pnl sol={historyPnl(world, h)} />}
                    </td>
                    <td className={`num right faint ${styles.colWhen}`}>{age === 'now' ? 'just now' : `${age} ago`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Signed, so a gain or loss never rests on colour alone. */
function Pnl({ sol }: { sol: number }) {
  const dir = sol > 0.0005 ? 'up' : sol < -0.0005 ? 'down' : 'muted'
  const sign = dir === 'up' ? '+' : dir === 'down' ? '-' : ''
  return (
    <span className={dir}>
      {sign}
      {fmtSolAmount(Math.abs(sol))} SOL
    </span>
  )
}
