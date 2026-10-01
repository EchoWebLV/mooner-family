'use client'
// Launch (spec §5.4): join a presale by Find Match (pick an amount; the store drops you into the public presale that
// fits it best, or has a bot open one), or go create your own coin.
import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { AmountPicker } from '@/components/ui/AmountPicker'
import { Dialog } from '@/components/ui/Dialog'
import { Stat } from '@/components/ui/Stat'
import { Tabs, tabId, type TabItem } from '@/components/ui/Tabs'
import { useApp } from '@/components/world/WorldProvider'
import { COMMIT_PRESETS, MAX_COMMIT, MIN_COMMIT, PRESALE_TARGET, TOTAL_SUPPLY } from '@/lib/constants'
import { allocationFor } from '@/lib/curve'
import { fmtCompact, fmtPct, fmtSol, fmtSolRound, solToLamports } from '@/lib/format'
import styles from './FindMatchDialog.module.css'

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
        Name it, pick a ticker, add its socials and open its presale, public or invite-only. You commit{' '}
        {fmtSolRound(MIN_COMMIT)}–{fmtSolRound(MAX_COMMIT)} SOL like every player and pay the same price. When the pool
        reaches {fmtSolRound(PRESALE_TARGET)} SOL, it launches on Solana by itself.
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
  const [amount, setAmount] = useState(solToLamports(0.5))
  const [error, setError] = useState<string | null>(null)
  const tokens = allocationFor(amount)
  const short = amount > wallet

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const r = findMatch(amount)
    if (r.ok) onMatched(r.tokenId)
    else setError(r.error)
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      <p className="muted">
        Pick what you&apos;ll commit. You join the public presale closest to launching that can take your full
        amount — or a bot opens a new one — and watch the pool fill up.
      </p>
      <AmountPicker
        id="match-amount"
        label="Your commit"
        value={amount}
        min={MIN_COMMIT}
        max={MAX_COMMIT}
        presets={COMMIT_PRESETS}
        hint={`${fmtSol(MIN_COMMIT)}–${fmtSol(MAX_COMMIT)} SOL per wallet · free to join or withdraw`}
        onChange={(v) => {
          setAmount(v)
          setError(null)
        }}
      />
      <dl className={styles.preview}>
        <Stat label="You get at launch">
          ≈ {fmtCompact(tokens)} ({fmtPct(tokens / TOTAL_SUPPLY)})
        </Stat>
        <Stat label="Demo wallet">{fmtSol(wallet)} SOL</Stat>
      </dl>
      {(short || error) && (
        <p className="field-error" role="alert">
          {short ? 'Not enough SOL' : error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={short}>
        Launch
      </button>
      <p className="field-hint">Everyone in a pool pays the same price, creator included. Private presales are skipped.</p>
    </form>
  )
}
