import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import { Links } from '@/components/ui/Links'
import { PRESALE_TARGET } from '@/lib/constants'
import { fmtAge, fmtClock, fmtPct, fmtSol, fmtSolRound, lamportsToSol } from '@/lib/format'
import { participantOf, poolLamports } from '@/lib/presale'
import type { Token, World } from '@/lib/types'
import { ArtRing } from './ArtRing'
import { Faces } from './Faces'
import styles from './cards.module.css'

const FRESH_MS = 3_000
/** The clock turns red for the last minute. */
const URGENT_MS = 60_000

interface PresaleCardProps {
  t: Token
  world: World
  /** The launch wizard's draft: no link, no fade-in. */
  preview?: boolean
}

/** A New Pairs card (spec §5.2): how full the pool is, who's in and the time left. */
export function PresaleCard({ t, world, preview = false }: PresaleCardProps) {
  const now = world.now
  const people = t.presale.participants.length
  const pool = poolLamports(t.presale)
  const fill = Math.min(1, pool / PRESALE_TARGET)
  const left = t.presale.expiresAt - now
  const mine = participantOf(t.presale, world.meId)
  const launching = t.stage === 'launching'
  const expired = t.stage === 'expired'
  const isPrivate = t.presale.visibility === 'private'
  const fresh = !preview && now - t.createdAt < FRESH_MS
  const age = fmtAge(now - t.createdAt)
  const classes = [styles.card, fresh && styles.fresh, expired && styles.expired].filter(Boolean).join(' ')

  let action = null
  if (expired) {
    action = <span className={styles.note}>Expired · SOL goes back</span>
  } else if (mine) {
    action = <span className={styles.mine}>You&apos;re in · {fmtSol(mine.commit)} SOL</span>
  } else if (launching) {
    action = <span className={styles.note}>Settling to Solana…</span>
  } else if (isPrivate) {
    action = (
      <button type="button" className={`btn btn-sm ${styles.action}`} disabled>
        <Icon name="lock" size={12} />
        Invite only
      </button>
    )
  } else {
    action = (
      <Link href={`/presale/${t.id}#join`} prefetch={false} className={`btn btn-primary btn-sm ${styles.action}`}>
        Join<span className="sr-only"> the {t.name} presale</span>
      </Link>
    )
  }

  return (
    <article className={classes} data-stage={t.stage}>
      <ArtRing name={t.name} meme={t.meme} stage={t.stage} fill={fill} />

      <div className={styles.main}>
        <div className={styles.line}>
          <h3 className={styles.name}>
            {preview ? (
              t.name
            ) : (
              <Link href={`/presale/${t.id}`} prefetch={false} className={styles.stretch}>
                {t.name}
              </Link>
            )}
          </h3>
          <span className={`num ${styles.ticker}`}>${t.ticker}</span>
          {isPrivate && (
            <span className={styles.lock} title="Private presale: invite link only">
              <Icon name="lock" size={12} />
              <span className="sr-only">Private</span>
            </span>
          )}
          <span className={`num ${styles.figure}`}>
            <span className={styles.value}>{fmtSol(pool)}</span>
            <span className={styles.target}> / {fmtSolRound(PRESALE_TARGET)}</span> SOL
          </span>
        </div>

        <div className={styles.meta}>
          <span className={`num ${styles.stat}`} title={age === 'now' ? 'Just opened' : `Opened ${age} ago`}>
            {age}
          </span>
          <span className={styles.stat} title="People in the pool">
            <Icon name="users" size={12} />
            <span className="num">{people}</span>
          </span>
          <span className={`${styles.stat} ${!launching && !expired && left < URGENT_MS ? styles.urgent : ''}`} title="Time left">
            <Icon name="clock" size={12} />
            <span className="num">{launching ? 'full' : expired ? 'ended' : fmtClock(left)}</span>
          </span>
        </div>

        <div className={styles.progress}>
          <div
            className="bar"
            role="progressbar"
            aria-label="Pool"
            aria-valuemin={0}
            aria-valuemax={lamportsToSol(PRESALE_TARGET)}
            aria-valuenow={lamportsToSol(pool)}
            aria-valuetext={`${fmtSol(pool)} of ${fmtSolRound(PRESALE_TARGET)} SOL`}
          >
            <span style={{ width: `${(fill * 100).toFixed(1)}%` }} />
          </div>
          <span className="num" aria-hidden>
            {fmtPct(fill, 0)}
          </span>
        </div>
      </div>

      <div className={styles.foot}>
        <Links links={t.links} variant="icons" name={t.name} />
        <Faces
          people={t.presale.participants.map((p) => ({ id: p.userId, handle: world.users[p.userId]?.handle ?? p.userId }))}
        />
        {action}
      </div>
    </article>
  )
}
