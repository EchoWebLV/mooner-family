'use client'
// Your side of the presale (spec §5.3): join, or get it all back. Joining puts SOL in a seat that
// waits in the MagicBlock ER; one button takes it out of the pool and the ER and back to the wallet.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AmountPicker } from '@/components/ui/AmountPicker'
import { Icon } from '@/components/ui/Icon'
import { useApp } from '@/components/world/WorldProvider'
import { COMMIT_PRESETS, MAX_COMMIT, MIN_COMMIT, TOTAL_SUPPLY } from '@/lib/constants'
import { allocationFor } from '@/lib/curve'
import { fmtCompact, fmtPct, fmtSol, fmtSolRound, solToLamports } from '@/lib/format'
import { notEnoughSol } from '@/lib/launch'
import { canJoin, clampCommit, commitLimitReason, commitRange, participantOf } from '@/lib/presale'
import type { Lamports, Token, World } from '@/lib/types'
import styles from './CommitPanel.module.css'
import { joinCost } from '@/real/chain.js'

interface CommitPanelProps {
  t: Token
  world: World
  invite?: string
  className?: string
}

export function CommitPanel({ t, world, invite, className }: CommitPanelProps) {
  const seat = useApp((s) => s.mine[t.id])
  const connected = useApp((s) => !!s.wallet)
  const connect = useApp((s) => s.connectWallet)
  const mine = participantOf(t.presale, world.meId) ?? (seat && seat.commit > 0 ? { userId: world.meId, commit: seat.commit, joinedAt: 0 } : undefined)

  useEffect(() => {
    // Rail "Join" buttons link to #join: put the cursor on the amount straight away.
    if (window.location.hash === '#join') document.getElementById('commit-amount')?.focus()
  }, [])

  let title = 'Join the presale'
  let body: ReactNode
  if (t.stage === 'expired') {
    title = 'Presale closed'
    body = (
      <Closed>
        {seat && !seat.settled
          ? `The timer ran out. Your ${fmtSol(seat.deposit)} SOL is on its way back to your wallet.`
          : 'The timer ran out before the pool filled. Everyone gets their SOL back.'}
      </Closed>
    )
  } else if (t.stage !== 'presale') {
    title = mine ? 'Your commit' : 'Presale closed'
    body = mine ? <LockedIn t={t} commit={mine.commit} /> : <Closed>The pool is full and launching on Solana.</Closed>
  } else if (mine || seat) {
    title = 'Your commit'
    body = (
      <InForm
        key={t.id}
        t={t}
        commit={mine?.commit ?? 0}
        deposit={seat?.deposit ?? mine?.commit ?? 0}
        creator={t.creatorId === world.meId}
      />
    )
  } else if (!connected) {
    body = (
      <div className={styles.form}>
        <p className="muted">Sign in with a wallet, X or email to join. You put in {fmtSolRound(MIN_COMMIT)}–{fmtSolRound(MAX_COMMIT)} SOL and get the same price as everyone.</p>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={connect}>
          Sign in to join
        </button>
      </div>
    )
  } else {
    const check = canJoin(t, world.meId, invite)
    body = check.ok ? (
      <JoinForm key={t.id} t={t} world={world} invite={invite} />
    ) : (
      <Closed>
        {check.reason === 'Invite only'
          ? 'This presale is private. Ask the creator for the invite link to join.'
          : check.reason}
      </Closed>
    )
  }

  return (
    <section id="join" className={`panel ${styles.panel} ${className ?? ''}`} aria-labelledby="commit-title">
      <h2 id="commit-title" className="panel-title">
        {title}
      </h2>
      {body}
    </section>
  )
}

function JoinForm({ t, world }: { t: Token; world: World; invite?: string }) {
  const joinPresale = useApp((s) => s.joinPresale)
  const notify = useApp((s) => s.notify)
  const step = useApp((s) => s.step)
  const [picked, setPicked] = useState<Lamports>(solToLamports(0.5))
  const [error, setError] = useState<string | null>(null)
  const range = commitRange(t.presale, world.meId)
  // Other people keep joining, so the pick is re-fitted to what's left on every render.
  const amount = clampCommit(t.presale, world.meId, picked)
  // A seat holds at least 0.1 SOL; the program counts only what fits in the pool.
  const deposit = Math.max(MIN_COMMIT, amount)
  // The join also pays the seat's rent, the delegation's and the Solana fee, and the wallet
  // keeps a little: counted with what a wallet may add (flows.js joinCost).
  const [extra, setExtra] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    joinCost().then((c) => live && setExtra(Number(c.total)), () => {})
    return () => {
      live = false
    }
  }, [])
  const need = deposit + (extra ?? 0)
  const short = need > world.walletLamports
  const shortText = notEnoughSol('the join', deposit, extra)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (step) return
    setError(null)
    const r = await joinPresale(t.id, deposit)
    if (r.ok) notify('good', `You're in $${t.ticker} with ${fmtSol(amount)} SOL`)
    else setError(r.error)
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <AmountPicker
        id="commit-amount"
        label="Your commit"
        value={amount}
        min={range.min}
        max={range.max}
        presets={COMMIT_PRESETS}
        hint={commitLimitReason(t.presale, world.meId)}
        onChange={(v) => {
          setPicked(v)
          setError(null)
        }}
      />
      <Allocation amount={amount} ticker={t.ticker} />
      <Free>Changed your mind? Get it all back with one button until the pool fills</Free>
      <Wallet lamports={world.walletLamports} />
      <Step />
      {(short || error) && (
        <p className="field-error" role="alert">
          {short ? shortText : error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={short || !!step}>
        {step ? 'Working…' : `Join · ${fmtSol(amount)} SOL`}
      </button>
    </form>
  )
}

/** You're in. One button gets the whole deposit back to the wallet: out of the pool, out of
 *  the ER, and home. The creator's commit stays until launch. */
function InForm({ t, commit, deposit, creator }: { t: Token; commit: Lamports; deposit: Lamports; creator: boolean }) {
  const refundNow = useApp((s) => s.refundNow)
  const notify = useApp((s) => s.notify)
  const step = useApp((s) => s.step)
  const [error, setError] = useState<string | null>(null)

  const getBack = async () => {
    if (step) return
    setError(null)
    const r = await refundNow(t.id)
    if (r.ok) notify('good', `${fmtSol(deposit)} SOL is back in your wallet`)
    else setError(r.error)
  }

  return (
    <div className={styles.form}>
      <p className={styles.current}>
        <span className="muted">{commit > 0 ? "You're in with" : 'Out of the pool, in your seat'}</span>
        <span className="num">{fmtSol(commit > 0 ? commit : deposit)} SOL</span>
      </p>
      {commit > 0 && <Allocation amount={commit} ticker={t.ticker} />}
      {creator ? (
        <p className="field-hint">
          As the creator, your commit is locked in until launch. If the pool doesn&apos;t fill in time, it comes back to your
          wallet by itself.
        </p>
      ) : (
        <>
          <p className="muted">Changed your mind? This sends it all straight back to your wallet. You pay only the Solana fee.</p>
          <Step />
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-lg btn-block" disabled={!!step} onClick={getBack}>
            {step ? 'Working…' : `Get my ${fmtSol(deposit)} SOL back`}
          </button>
        </>
      )}
    </div>
  )
}

/** What the running action waits for. */
function Step() {
  const step = useApp((s) => s.step)
  if (!step) return null
  return (
    <p className="field-hint" role="status">
      {step}…
    </p>
  )
}

function LockedIn({ t, commit }: { t: Token; commit: Lamports }) {
  return (
    <div className={styles.locked}>
      <p className={styles.lockedAmount}>
        <Icon name="lock" size={14} />
        <span className="num">{fmtSol(commit)} SOL</span> locked in
      </p>
      <Allocation amount={commit} ticker={t.ticker} />
      <p className="muted">
        {t.stage === 'launching' ? 'The pool is full. Settling to Solana…' : `$${t.ticker} is live. Your allocation is in your wallet.`}
      </p>
    </div>
  )
}

/** "1.00 SOL → ≈ 27.87M $MOON (2.79% of supply)" plus the fairness line. Also used by the launch wizard. */
export function Allocation({ amount, ticker }: { amount: Lamports; ticker: string }) {
  const tokens = allocationFor(amount)
  return (
    <div className={styles.alloc}>
      <p className="num">
        {fmtSol(amount)} SOL → ≈ {fmtCompact(tokens)} ${ticker}{' '}
        <span className={`muted ${styles.share}`}>({fmtPct(tokens / TOTAL_SUPPLY)} of supply)</span>
      </p>
      <p className={styles.fair}>
        <Icon name="check" size={12} />
        Same price as everyone, creator included
      </p>
    </div>
  )
}

/** Your SOL waits in a seat in the MagicBlock ER until launch, and can come back any time before. */
function Free({ children }: { children: ReactNode }) {
  return (
    <p className={styles.fair} title="Your SOL waits in a seat on MagicBlock ER until the pool fills.">
      <Icon name="check" size={12} />
      {children}
    </p>
  )
}

function Wallet({ lamports }: { lamports: Lamports }) {
  return (
    <p className={styles.wallet}>
      <span>Your wallet</span>
      <span className="num">{fmtSol(lamports)} SOL</span>
    </p>
  )
}

function Closed({ children }: { children: ReactNode }) {
  return (
    <p className={styles.closed}>
      <Icon name="lock" size={14} />
      <span>{children}</span>
    </p>
  )
}
