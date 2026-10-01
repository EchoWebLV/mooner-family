'use client'
// SOL amount on the 0.01 grid: slider, typed amount and presets (spec §3.2).
// Out-of-range input is clamped and the hint says why.
import { useState, type ReactNode } from 'react'
import { COMMIT_STEP } from '@/lib/constants'
import { lamportsToSol, solToLamports } from '@/lib/format'
import type { Lamports } from '@/lib/types'
import styles from './AmountPicker.module.css'

interface AmountPickerProps {
  /** Id of the slider, so a label or another control can point at it. */
  id: string
  label: string
  value: Lamports
  min: Lamports
  max: Lamports
  onChange: (value: Lamports) => void
  /** Quick amounts in SOL; a "Max" button is added after them. */
  presets?: readonly number[]
  /** Explains the limit, e.g. "max 0.40 SOL — that's all that's left". */
  hint?: ReactNode
  disabled?: boolean
}

const toText = (l: Lamports) => lamportsToSol(l).toFixed(2)

/** Snaps down to 0.01 SOL, then clamps into [min, max] (same rule as the store). */
function fit(l: Lamports, min: Lamports, max: Lamports): Lamports {
  const snapped = Math.floor(l / COMMIT_STEP) * COMMIT_STEP
  return Math.min(max, Math.max(min, snapped))
}

export function AmountPicker({ id, label, value, min, max, onChange, presets = [], hint, disabled = false }: AmountPickerProps) {
  // What the user is typing; null shows the value itself.
  const [draft, setDraft] = useState<string | null>(null)
  const [adjusted, setAdjusted] = useState(false)
  const fixed = min >= max

  const pick = (l: Lamports) => {
    setAdjusted(false)
    onChange(fit(l, min, max))
  }

  const type = (text: string) => {
    setDraft(text)
    const sol = Number(text.replace(',', '.'))
    if (!text.trim() || !Number.isFinite(sol)) return
    const typed = solToLamports(sol)
    const next = fit(typed, min, max)
    setAdjusted(next !== typed)
    onChange(next)
  }

  return (
    <div className={styles.picker}>
      <div className={styles.top}>
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <div className={styles.amount}>
          <input
            className={`input num ${styles.number}`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={`${label} in SOL`}
            value={draft ?? toText(value)}
            disabled={disabled}
            onChange={(e) => type(e.target.value)}
            onBlur={() => setDraft(null)}
          />
          <span className={styles.unit} aria-hidden>
            SOL
          </span>
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={Math.max(min, max)}
        step={COMMIT_STEP}
        value={value}
        disabled={disabled || fixed}
        aria-valuetext={`${toText(value)} SOL`}
        onChange={(e) => pick(Number(e.target.value))}
      />
      {presets.length > 0 && (
        <div className={styles.presets}>
          {presets.map((p) => {
            const l = solToLamports(p)
            return (
              <button
                key={p}
                type="button"
                className="btn btn-sm"
                disabled={disabled || l < min || l > max}
                aria-pressed={value === l}
                onClick={() => pick(l)}
              >
                {p} SOL
              </button>
            )
          })}
          <button type="button" className="btn btn-sm" disabled={disabled || fixed} aria-pressed={value === max} onClick={() => pick(max)}>
            Max
          </button>
        </div>
      )}
      {hint && (
        <p className={`field-hint ${adjusted ? styles.adjusted : ''}`} aria-live="polite">
          {adjusted && `Set to ${toText(value)} SOL · `}
          {hint}
        </p>
      )}
    </div>
  )
}
