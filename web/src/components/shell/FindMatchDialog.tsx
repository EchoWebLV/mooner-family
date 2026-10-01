'use client'
// Launch (spec §5.4): join a presale by Find Match (pick an amount; you join the open presale that fits it best),
// or go create your own coin.
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { AmountPicker } from '@/components/ui/AmountPicker'
import { Dialog } from '@/components/ui/Dialog'
import { Stat } from '@/components/ui/Stat'
import { Tabs, tabId, type TabItem } from '@/components/ui/Tabs'
import { useApp } from '@/components/world/WorldProvider'
import { COMMIT_PRESETS, MAX_COMMIT, MIN_COMMIT, PRESALE_TARGET, TOTAL_SUPPLY } from '@/lib/constants'
import { allocationFor } from '@/lib/curve'
import { fmtCompact, fmtPct, fmtSol, fmtSolRound, solToLamports } from '@/lib/format'
import { notEnoughSol } from '@/lib/launch'
import styles from './FindMatchDialog.module.css'
import { joinCost } from '../../../../engine/src/flows.js'

type Choice = 'join' | 'create'

const CHOICES: readonly TabItem<Choice>[] = [
  { id: 'join', label: 'Join a presale' },
  { id: 'create', label: 'Create a coin' },
]

interface FindMatchDialogProps {
  open: boolean
  onClose: () => void
  onMatched: (tokenId: string) => void
}

export function FindMatchDialog({ open, onClose, onMatched }: FindMatchDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Launch">
      <LaunchChoice onMatched={onMatched} onClose={onClose} />
    </Dialog>
  )
}

function LaunchChoice({ onMatched, onClose }: { onMatched: (tokenId: string) => void; onClose: () => void }) {
  const [choice, setChoice] = useState<Choice>('join')
  return (
    <div className={styles.choice}>
      <Tabs items={CHOICES} value={choice} onChange={setChoice} label="Launch" idPrefix="launch" className={styles.tabs} />
      <div role="tabpanel" aria-labelledby={tabId('launch', choice)}>
        {choice === 'join' ? <FindMatchForm onMatched={onMatched} /> : <CreateCoin onClose={onClose} />}
      </div>
    </div>
  )
}

/** Creating is a whole wizard, so this tab only says what it takes and goes there. */
function CreateCoin({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.form}>
      <p className="muted">
        Name it, pick a ticker, add a picture and its socials, and open its presale. You commit{' '}
        {fmtSolRound(MIN_COMMIT)}–{fmtSolRound(MAX_COMMIT)} SOL like everyone and pay the same price. When the pool
        reaches {fmtSolRound(PRESALE_TARGET)} SOL, it launches on Meteora by itself.
      </p>
      <Link href="/launch" className="btn btn-primary btn-lg btn-block" onClick={onClose}>
        Create a coin
      </Link>
    </div>
  )
}

function FindMatchForm({ onMatched }: { onMatched: (tokenId: string) => void }) {
  const findMatch = useApp((s) => s.findMatch)
  const wallet = useApp((s) => s.world.walletLamports)
  const connected = useApp((s) => !!s.wallet)
  const connect = useApp((s) => s.connectWallet)
  const step = useApp((s) => s.step)
  const [amount, setAmount] = useState(solToLamports(0.5))
  const [error, setError] = useState<string | null>(null)
  const tokens = allocationFor(amount)
  // The join also pays rent and the Solana fee, and the wallet keeps a little (flows.js
  // joinCost, as CommitPanel counts it); while that's unknown, just the amount.
  const [extra, setExtra] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    joinCost().then((c) => live && setExtra(Number(c.total)), () => {})
    return () => {
      live = false
    }
  }, [])
  const short = connected && amount + (extra ?? 0) > wallet

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!connected) return connect()
    if (step) return
    setError(null)
    const r = await findMatch(amount)
    if (r.ok) onMatched(r.tokenId)
    else setError(r.error)
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      <p className="muted">
        Pick what you&apos;ll commit. You join the open presale closest to launching that can take your full amount,
        then watch the pool fill up.
      </p>
      <AmountPicker
        id="match-amount"
        label="Your commit"
        value={amount}
        min={MIN_COMMIT}
        max={MAX_COMMIT}
        presets={COMMIT_PRESETS}
        hint={`${fmtSol(MIN_COMMIT)}–${fmtSol(MAX_COMMIT)} SOL per wallet · joining costs a Solana fee`}
        onChange={(v) => {
          setAmount(v)
          setError(null)
        }}
      />
      <dl className={styles.preview}>
        <Stat label="You get at launch">
          ≈ {fmtCompact(tokens)} ({fmtPct(tokens / TOTAL_SUPPLY)})
        </Stat>
        <Stat label="Your wallet">{connected ? `${fmtSol(wallet)} SOL` : '—'}</Stat>
      </dl>
      {step && (
        <p className="field-hint" role="status">
          {step}…
        </p>
      )}
      {(short || error) && (
        <p className="field-error" role="alert">
          {short ? notEnoughSol('the join', amount, extra) : error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={short || !!step}>
        {!connected ? 'Connect wallet' : step ? 'Working…' : 'Find a presale'}
      </button>
      <p className="field-hint">Everyone in a pool pays the same price, creator included.</p>
    </form>
  )
}
