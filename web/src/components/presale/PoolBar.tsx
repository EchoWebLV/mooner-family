import { PRESALE_TARGET } from '@/lib/constants'
import { fmtSol, fmtSolRound, lamportsToSol } from '@/lib/format'
import { poolLamports } from '@/lib/presale'
import type { Token, World } from '@/lib/types'
import styles from './PresaleScreen.module.css'

/** The pool with one segment per participant (spec §5.3): "0.35 / 0.5 SOL · 0.15 to launch". */
export function PoolBar({ t, world, className }: { t: Token; world: World; className?: string }) {
  const pool = poolLamports(t.presale)
  const left = Math.max(0, PRESALE_TARGET - pool)
  const status = t.stage === 'expired' ? 'Refunded' : left > 0 ? `${fmtSol(left)} to launch` : 'Full'
  return (
    <section className={`panel ${styles.poolPanel} ${className ?? ''}`} aria-label="Pool">
      <p className={styles.poolText}>
        <span className="num">
          <strong>{fmtSol(pool)}</strong> / {fmtSolRound(PRESALE_TARGET)} SOL
        </span>
        <span className="num muted">{status}</span>
      </p>
      <div
        className={styles.segments}
        role="progressbar"
        aria-label="Pool filled"
        aria-valuemin={0}
        aria-valuemax={lamportsToSol(PRESALE_TARGET)}
        aria-valuenow={lamportsToSol(pool)}
        aria-valuetext={`${fmtSol(pool)} of ${fmtSolRound(PRESALE_TARGET)} SOL`}
      >
        {t.presale.participants.map((p, i) => (
          <span
            key={p.userId}
            className={p.userId === world.meId ? styles.segMine : i % 2 ? styles.segB : styles.segA}
            style={{ width: `${(p.commit / PRESALE_TARGET) * 100}%` }}
            title={`@${world.users[p.userId]?.handle ?? p.userId} · ${fmtSol(p.commit)} SOL`}
          />
        ))}
      </div>
    </section>
  )
}
