import { useEffect, useRef } from 'react'
import { TokenArt } from '@/components/art/TokenArt'
import { Icon } from '@/components/ui/Icon'
import { launchPhase } from '@/lib/presale'
import { play } from '@/lib/sound'
import type { Token } from '@/lib/types'
import styles from './LaunchSequence.module.css'

const STEPS = ['Pool full', 'Settling to Solana', 'Token created · pool is the first buy', 'Live'] as const
const HEADLINES = ['Pool full', 'Settling to Solana', 'Token created', 'Live'] as const

/**
 * Plays for everyone on the page when the pool fills (spec §5.3):
 * POOL FULL → Settling to Solana → Token created → LIVE, then the token page takes over.
 */
export function LaunchSequence({ t, now }: { t: Token; now: number }) {
  const phase = t.stage === 'launching' ? launchPhase(now - (t.presale.launchStartedAt ?? now)) : 3
  usePhaseSounds(phase)
  return (
    <div className={`${styles.overlay} ${phase === 3 ? styles.live : ''}`}>
      <div className={styles.card}>
        <TokenArt name={t.name} meme={t.meme} size={96} />
        <p className={styles.headline} role="status">
          <span key={phase} className={styles.enter}>
            {HEADLINES[phase]}
          </span>
        </p>
        <ol className={styles.steps}>
          {STEPS.map((step, i) => {
            const state = i < phase ? 'done' : i === phase ? 'now' : 'next'
            return (
              <li key={step} data-state={state}>
                <span className={styles.mark} aria-hidden>
                  {(state === 'done' || phase === 3) && <Icon name="check" size={12} />}
                </span>
                {step}
                <span className="sr-only">{state === 'done' ? ' (done)' : state === 'now' ? ' (now)' : ''}</span>
              </li>
            )
          })}
        </ol>
        <p className={styles.note}>
          <span className="num">${t.ticker}</span> · {t.presale.participants.length} wallets · one price for everyone
        </p>
      </div>
    </div>
  )
}

/** The phone's launch sounds (mobile/src/room/Moment*.js): stamp + poolfull as it opens, a
 *  step for each step done, liftoff when it's live, then the stamp and the coins. Each plays
 *  once, the LIVE ones even after the token page takes over. */
function usePhaseSounds(phase: number) {
  const heard = useRef(-1)
  useEffect(() => {
    if (phase <= heard.current) return
    const first = heard.current < 0
    heard.current = phase
    if (first) {
      play('stamp')
      play('poolfull')
    }
    if (phase === 1 || phase === 2) play('step')
    if (phase === 3) {
      play('liftoff')
      window.setTimeout(() => play('stamp'), 700)
      window.setTimeout(() => play('coins'), 1_300)
    }
  }, [phase])
}
