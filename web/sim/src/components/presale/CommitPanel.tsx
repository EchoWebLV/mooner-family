'use client'
// Your side of the presale (spec §5.3): join, change your amount, or withdraw.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AmountPicker } from '@/components/ui/AmountPicker'
import { Icon } from '@/components/ui/Icon'
import { useApp } from '@/components/world/WorldProvider'
import { COMMIT_PRESETS, TOTAL_SUPPLY } from '@/lib/constants'
import { allocationFor } from '@/lib/curve'
import { fmtCompact, fmtPct, fmtSol, solToLamports } from '@/lib/format'
import { canJoin, canWithdraw, clampCommit, commitLimitReason, commitRange, participantOf } from '@/lib/presale'
import type { Lamports, Token, World } from '@/lib/types'
import styles from './CommitPanel.module.css'

interface CommitPanelProps {
  t: Token
  world: World
  invite?: string
  className?: string
}

export function CommitPanel({ t, world, invite, className }: CommitPanelProps) {
  const mine = participantOf(t.presale, world.meId)

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
        {mine
          ? `The timer ran out. Your ${fmtSol(mine.commit)} SOL went back to your wallet.`
          : 'The timer ran out before the pool filled. Every commit was refunded.'}
      </Closed>
    )
  } else if (t.stage !== 'presale') {
    title = mine ? 'Your commit' : 'Presale closed'
    body = mine ? <LockedIn t={t} commit={mine.commit} /> : <Closed>The pool is full and launching on Solana.</Closed>
  } else if (mine) {
    title = 'Your commit'
    body = <ChangeForm key={t.id} t={t} world={world} commit={mine.commit} />
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

function JoinForm({ t, world, invite }: { t: Token; world: World; invite?: string }) {
  const joinPresale = useApp((s) => s.joinPresale)
  const notify = useApp((s) => s.notify)
  const [picked, setPicked] = useState<Lamports>(solToLamports(0.5))
  const [error, setError] = useState<string | null>(null)
  const range = commitRange(t.presale, world.meId)
  // Other people keep joining, so the pick is re-fitted to what's left on every render.
  const amount = clampCommit(t.presale, world.meId, picked)
  const short = amount > world.walletLamports

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const r = joinPresale(t.id, amount, invite)
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
      <Free>Free to join, change or withdraw</Free>
      <Wallet lamports={world.walletLamports} />
      {(short || error) && (
        <p className="field-error" role="alert">
          {short ? 'Not enough SOL in your demo wallet' : error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={short}>
        Join · {fmtSol(amount)} SOL
      </button>
    </form>
  )
}

function ChangeForm({ t, world, commit }: { t: Token; world: World; commit: Lamports }) {
  const changeCommit = useApp((s) => s.changeCommit)
  const withdraw = useApp((s) => s.withdraw)
  const notify = useApp((s) => s.notify)
  const [picked, setPicked] = useState<Lamports>(commit)
  const [error, setError] = useState<string | null>(null)
  const range = commitRange(t.presale, world.meId)
  const amount = clampCommit(t.presale, world.meId, picked)
  const delta = amount - commit
  const short = delta > world.walletLamports
  const exit = canWithdraw(t, world.meId)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const r = changeCommit(t.id, amount)
    if (r.ok) notify('good', `Your commit is now ${fmtSol(amount)} SOL`)
    else setError(r.error)
  }

  const leave = () => {
    const r = withdraw(t.id)
    if (r.ok) notify('info', `Withdrew ${fmtSol(commit)} SOL from $${t.ticker}`)
    else setError(r.error)
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.current}>
        <span className="muted">You&apos;re in with</span>
        <span className="num">{fmtSol(commit)} SOL</span>
      </p>
      <AmountPicker
        id="commit-amount"
        label="Change amount"
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
      <p className={`num ${styles.delta}`}>
        {delta > 0
          ? `+${fmtSol(delta)} SOL from your wallet`
          : delta < 0
            ? `${fmtSol(-delta)} SOL back to your wallet`
            : 'No change yet'}
      </p>
      <Allocation amount={amount} ticker={t.ticker} />
      <Free>{exit.ok ? 'Free to change or withdraw' : 'Free to change'}</Free>
      <Wallet lamports={world.walletLamports} />
      {(short || error) && (
        <p className="field-error" role="alert">
          {short ? 'Not enough SOL in your demo wallet' : error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={delta === 0 || short}>
          Update commit
        </button>
        {exit.ok ? (
          <button type="button" className="btn btn-block" onClick={leave}>
            Withdraw
          </button>
        ) : (
          <p className="field-hint">{exit.reason}</p>
        )}
      </div>
    </form>
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

/** Spec §3.2: moving SOL in and out of a presale costs nothing; you get back exactly what you put in. */
function Free({ children }: { children: ReactNode }) {
  return (
    <p className={styles.fair} title="Mooner pays the fees. You get back exactly what you put in.">
      <Icon name="check" size={12} />
      {children} · no fees
    </p>
  )
}

function Wallet({ lamports }: { lamports: Lamports }) {
  return (
    <p className={styles.wallet}>
      <span>Demo wallet</span>
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
