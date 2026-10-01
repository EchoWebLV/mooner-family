'use client'
// Buy and sell (spec §5.5). Buys take SOL presets; sells take a share of what you hold.
// On the curve a buy is capped at what's left before migration, and only that SOL is charged.
import { useState, type FormEvent } from 'react'
import { Tabs, tabId } from '@/components/ui/Tabs'
import { useApp } from '@/components/world/WorldProvider'
import { quoteBuy, quoteSell } from '@/lib/curve'
import { fmtCompact, fmtNumber, fmtSol, fmtSolAmount, solToLamports } from '@/lib/format'
import type { Token, World } from '@/lib/types'
import styles from './TradePanel.module.css'

type Side = 'buy' | 'sell'
const SIDES = [
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
] as const
const BUY_PRESETS = [0.1, 0.5, 1, 2] as const
const SELL_PRESETS = [0.25, 0.5, 0.75, 1] as const

/** "1.5" or "1,5" → 1.5; anything that isn't a plain decimal → NaN. */
function parseAmount(text: string): number {
  const s = text.trim().replace(',', '.')
  return /^(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN
}

/** A sell is either a share of your holding (presets) or a typed token amount. */
type SellPick = { pct: number } | { text: string }

interface TradePanelProps {
  t: Token
  world: World
  className?: string
}

/** Mount with `key={t.id}` so amounts don't carry over between tokens. */
export function TradePanel({ t, world, className }: TradePanelProps) {
  const buy = useApp((s) => s.buy)
  const sell = useApp((s) => s.sell)
  const notify = useApp((s) => s.notify)
  const [side, setSide] = useState<Side>('buy')
  const [buyText, setBuyText] = useState('0.5')
  const [sellPick, setSellPick] = useState<SellPick>({ pct: 0.5 })
  const [error, setError] = useState<string | null>(null)

  const onCurve = t.stage === 'live'
  const held = t.positions[world.meId] ?? 0

  // Buy side
  const sol = parseAmount(buyText)
  const quote = sol > 0 && t.pool ? quoteBuy(t.pool, sol, onCurve) : null
  const capped = !!quote && quote.tokensOut > 0 && quote.solUsed < sol - 1e-9
  const short = !!quote && solToLamports(quote.solUsed) > world.walletLamports

  // Sell side
  const typed = 'text' in sellPick ? parseAmount(sellPick.text) : held * sellPick.pct
  const amount = Math.min(typed, held)
  const solOut = amount > 0 && t.pool ? quoteSell(t.pool, amount) : 0
  const sellText = 'text' in sellPick ? sellPick.text : String(Math.floor(held * sellPick.pct))

  const pickSide = (next: Side) => {
    setSide(next)
    setError(null)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (side === 'buy') {
      const r = buy(t.id, sol)
      if (r.ok) notify('good', `Bought ${fmtCompact(r.tokens)} $${t.ticker} for ${fmtSolAmount(r.sol)} SOL`)
      else setError(r.error)
    } else {
      const r = sell(t.id, amount)
      if (r.ok) notify('good', `Sold ${fmtCompact(r.tokens)} $${t.ticker} for ${fmtSolAmount(r.sol)} SOL`)
      else setError(r.error)
    }
  }

  let receive = '—'
  let problem: string | null = error
  let canSubmit = false
  if (side === 'buy') {
    if (quote && quote.tokensOut > 0) receive = `${fmtCompact(quote.tokensOut)} $${t.ticker}`
    if (!problem && short) problem = 'Not enough SOL in your demo wallet'
    canSubmit = !!quote && quote.tokensOut > 0 && !short
  } else {
    if (solOut > 0) receive = `${fmtSolAmount(solOut)} SOL`
    canSubmit = held > 0 && amount > 0
  }

  return (
    <section className={`panel ${styles.panel} ${className ?? ''}`} aria-label="Trade">
      <Tabs items={SIDES} value={side} onChange={pickSide} label="Buy or sell" idPrefix="trade" className={styles.sides} />
      <form className={styles.form} role="tabpanel" aria-labelledby={tabId('trade', side)} onSubmit={submit}>
        {side === 'buy' ? (
          <>
            <div className={styles.presets}>
              {BUY_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-sm"
                  aria-pressed={sol === p}
                  onClick={() => {
                    setBuyText(String(p))
                    setError(null)
                  }}
                >
                  {p} SOL
                </button>
              ))}
            </div>
            <AmountField
              unit="SOL"
              value={buyText}
              onChange={(text) => {
                setBuyText(text)
                setError(null)
              }}
            />
          </>
        ) : (
          <>
            <div className={styles.presets}>
              {SELL_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-sm"
                  disabled={held <= 0}
                  aria-pressed={'pct' in sellPick && sellPick.pct === p}
                  onClick={() => {
                    setSellPick({ pct: p })
                    setError(null)
                  }}
                >
                  {p * 100}%
                </button>
              ))}
            </div>
            <AmountField
              unit={`$${t.ticker}`}
              value={held > 0 ? sellText : ''}
              disabled={held <= 0}
              onChange={(text) => {
                setSellPick({ text })
                setError(null)
              }}
            />
          </>
        )}

        <p className={styles.receive}>
          <span className="muted">You receive ≈</span>
          <span className={`num ${styles.receiveValue}`}>{receive}</span>
        </p>
        {side === 'buy' && capped && quote && (
          <p className="field-hint">
            Only {fmtSolAmount(quote.solUsed)} SOL fills: that buys the rest of the curve, then it migrates.
          </p>
        )}
        {side === 'sell' && typed > held && held > 0 && (
          <p className="field-hint">You hold {fmtNumber(held, 0)}. That&apos;s what sells.</p>
        )}

        <p className={styles.wallet}>
          <span>{side === 'buy' ? 'Demo wallet' : 'You hold'}</span>
          <span className="num">
            {side === 'buy' ? `${fmtSol(world.walletLamports)} SOL` : `${fmtCompact(held)} $${t.ticker}`}
          </span>
        </p>
        {problem && (
          <p className="field-error" role="alert">
            {problem}
          </p>
        )}
        {side === 'sell' && held <= 0 ? (
          <p className="field-hint">You don&apos;t hold ${t.ticker} yet.</p>
        ) : null}
        <button
          type="submit"
          className={`btn btn-lg btn-block ${side === 'buy' ? 'btn-up' : 'btn-down'}`}
          disabled={!canSubmit}
        >
          {side === 'buy' ? 'Buy' : 'Sell'} ${t.ticker}
        </button>
        <p className={styles.venue}>
          {onCurve ? 'Trades on the bonding curve' : 'Trades on the AMM pool'} · demo wallet, no fees
        </p>
      </form>
    </section>
  )
}

interface AmountFieldProps {
  unit: string
  value: string
  disabled?: boolean
  onChange: (text: string) => void
}

function AmountField({ unit, value, disabled = false, onChange }: AmountFieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor="trade-amount" className="field-label">
        Amount<span className="sr-only"> in {unit}</span>
      </label>
      <div className={styles.amount}>
        <input
          id="trade-amount"
          className={`input num ${styles.input}`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className={styles.unit} aria-hidden>
          {unit}
        </span>
      </div>
    </div>
  )
}
