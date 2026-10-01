'use client'
// Buy and sell (spec §5.5). Buys take SOL presets; sells take a share of what you hold.
// Prices come from Jupiter, which routes the Meteora pool; your wallet signs the swap.
import { useEffect, useState, type FormEvent } from 'react'
import { Tabs, tabId } from '@/components/ui/Tabs'
import { useApp } from '@/components/world/WorldProvider'
import { fmtCompact, fmtNumber, fmtSol, fmtSolAmount, solToLamports } from '@/lib/format'
import { quote as jupQuote, WSOL } from '@/real/market'
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
  const step = useApp((s) => s.step)
  const connected = useApp((s) => !!s.wallet)
  const connect = useApp((s) => s.connectWallet)
  const held = useApp((s) => s.held[t.id] ?? 0)
  const [side, setSide] = useState<Side>('buy')
  const [buyText, setBuyText] = useState('0.5')
  const [sellPick, setSellPick] = useState<SellPick>({ pct: 0.5 })
  const [error, setError] = useState<string | null>(null)

  const onCurve = t.stage === 'live'

  // Buy side
  const sol = parseAmount(buyText)
  const short = connected && sol > 0 && solToLamports(sol) > world.walletLamports

  // Sell side
  const typed = 'text' in sellPick ? parseAmount(sellPick.text) : held * sellPick.pct
  const amount = Math.min(typed, held)
  const sellText = 'text' in sellPick ? sellPick.text : String(Math.floor(held * sellPick.pct))

  // What Jupiter would give right now, asked again a moment after the amount stops changing
  const [out, setOut] = useState<{ key: string; value: number } | { key: string; error: string } | null>(null)
  const key = side === 'buy' ? `b${sol}` : `s${amount}`
  useEffect(() => {
    const n = side === 'buy' ? sol : amount
    if (!(n > 0) || !t.pool) return
    let gone = false
    const id = setTimeout(async () => {
      try {
        const q =
          side === 'buy'
            ? await jupQuote(WSOL, t.address, BigInt(Math.round(n * 1e9)))
            : await jupQuote(t.address, WSOL, BigInt(Math.floor(n * 1e6)))
        if (!gone) setOut({ key, value: Number(q.outAmount) / (side === 'buy' ? 1e6 : 1e9) })
      } catch (e) {
        if (!gone) setOut({ key, error: e instanceof Error ? e.message : String(e) })
      }
    }, 400)
    return () => {
      gone = true
      clearTimeout(id)
    }
  }, [key, side, sol, amount, t.address, t.pool])
  const got = out && out.key === key ? out : null

  const pickSide = (next: Side) => {
    setSide(next)
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!connected) return connect()
    if (step) return
    setError(null)
    if (side === 'buy') {
      const r = await buy(t.id, sol)
      if (r.ok) notify('good', `Bought ${fmtCompact(r.tokens)} $${t.ticker} for ${fmtSolAmount(r.sol)} SOL`)
      else setError(r.error)
    } else {
      const r = await sell(t.id, amount)
      if (r.ok) notify('good', `Sold ${fmtCompact(r.tokens)} $${t.ticker} for ${fmtSolAmount(r.sol)} SOL`)
      else setError(r.error)
    }
  }

  let receive = got && 'value' in got ? (side === 'buy' ? `${fmtCompact(got.value)} $${t.ticker}` : `${fmtSolAmount(got.value)} SOL`) : '—'
  if (!got && (side === 'buy' ? sol > 0 : amount > 0)) receive = '…'
  let problem: string | null = error ?? (got && 'error' in got ? got.error : null)
  let canSubmit = !step
  if (side === 'buy') {
    if (!problem && short) problem = 'Not enough SOL in your wallet'
    canSubmit &&= sol > 0 && !short
  } else {
    canSubmit &&= held > 0 && amount > 0
  }
  if (!connected) canSubmit = true

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
        {side === 'sell' && typed > held && held > 0 && (
          <p className="field-hint">You hold {fmtNumber(held, 0)}. That&apos;s what sells.</p>
        )}

        <p className={styles.wallet}>
          <span>{side === 'buy' ? 'Your wallet' : 'You hold'}</span>
          <span className="num">
            {side === 'buy' ? `${fmtSol(world.walletLamports)} SOL` : `${fmtCompact(held)} $${t.ticker}`}
          </span>
        </p>
        {step && (
          <p className="field-hint" role="status">
            {step}…
          </p>
        )}
        {problem && (
          <p className="field-error" role="alert">
            {problem}
          </p>
        )}
        {side === 'sell' && held <= 0 && connected ? (
          <p className="field-hint">You don&apos;t hold ${t.ticker} yet.</p>
        ) : null}
        <button
          type="submit"
          className={`btn btn-lg btn-block ${side === 'buy' ? 'btn-up' : 'btn-down'}`}
          disabled={!canSubmit}
        >
          {!connected ? 'Connect wallet' : step ? 'Working…' : `${side === 'buy' ? 'Buy' : 'Sell'} $${t.ticker}`}
        </button>
        <p className={styles.venue}>
          {onCurve ? 'Meteora bonding curve' : 'Meteora AMM pool'} · routed by Jupiter · 3% max slippage
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
