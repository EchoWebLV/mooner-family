'use client'
// Launch wizard (spec §5.6): token, presale, your commit. Opening the presale puts it at the
// top of New Pairs and lands you on its page.
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { TokenArt } from '@/components/art/TokenArt'
import { Allocation } from '@/components/presale/CommitPanel'
import { PresaleCard } from '@/components/rails/PresaleCard'
import { AmountPicker } from '@/components/ui/AmountPicker'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Links } from '@/components/ui/Links'
import { useApp } from '@/components/world/WorldProvider'
import { COMMIT_PRESETS, COMMIT_STEP, MAX_COMMIT, MAX_CREATOR_COMMIT, MIN_COMMIT, PRESALE_TARGET, PRESALE_TIMER_MINUTES } from '@/lib/constants'
import { fmtSol, fmtSolRound } from '@/lib/format'
import {
  DESCRIPTION_MAX, NAME_MAX, TICKER_MAX, cleanLinks, draftToken, normalizeTicker, validateLaunch,
  type LaunchErrors, type LaunchForm,
} from '@/lib/launch'
import type { TokenLinks, World } from '@/lib/types'
import styles from './LaunchScreen.module.css'

type Field = keyof LaunchErrors
type Patch = (change: Partial<LaunchForm>) => void

const STEPS: readonly { label: string; fields: readonly Field[] }[] = [
  { label: 'Token', fields: ['name', 'ticker', 'description', 'x', 'telegram', 'website'] },
  { label: 'Presale', fields: ['minutes'] },
  { label: 'Your commit', fields: ['commit'] },
]
const LAST = STEPS.length - 1

const LINK_FIELDS: readonly { kind: keyof TokenLinks; label: string; placeholder: string }[] = [
  { kind: 'x', label: 'X', placeholder: '@handle or x.com link' },
  { kind: 'telegram', label: 'Telegram', placeholder: '@group or t.me link' },
  { kind: 'website', label: 'Website', placeholder: 'mooncat.xyz' },
]

/** Stands in for the name in the art and the preview until you type one. */
const PLACEHOLDER_NAME = 'Your token'

const fieldId = (f: Field) => `launch-${f}`
const stepOf = (f: Field) => STEPS.findIndex((s) => s.fields.includes(f))
const firstError = (errors: LaunchErrors, step: number) => STEPS[step].fields.find((f) => errors[f])

export function LaunchScreen() {
  const world = useApp((s) => s.world)
  const createLaunch = useApp((s) => s.createLaunch)
  const notify = useApp((s) => s.notify)
  const router = useRouter()

  const [form, setForm] = useState<LaunchForm>({
    name: '',
    ticker: '',
    description: '',
    links: {},
    visibility: 'public',
    minutes: 10,
    commit: MIN_COMMIT, // 0.1 SOL; the creator can raise it up to MAX_CREATOR_COMMIT
  })
  const [step, setStep] = useState(0)
  // Errors show once you've tried to leave their step, or left a field you filled in.
  const [tried, setTried] = useState<readonly boolean[]>(STEPS.map(() => false))
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Your commit can't go over what the demo wallet holds, or leave no room for anyone else.
  const maxCommit = Math.max(MIN_COMMIT, Math.min(MAX_CREATOR_COMMIT, Math.floor(world.walletLamports / COMMIT_STEP) * COMMIT_STEP))
  const current: LaunchForm = { ...form, commit: Math.min(form.commit, maxCommit) }
  const errors = validateLaunch(world, current)
  const shown = (f: Field) => (tried[stepOf(f)] || touched[f] ? errors[f] : undefined)
  const draft = draftToken(world, { ...current, name: current.name.trim() || PLACEHOLDER_NAME, ticker: current.ticker || 'TICKER' })

  const patch: Patch = (change) => {
    setForm((f) => ({ ...f, ...change }))
    setSubmitError(null)
  }
  const touch = (f: Field) => setTouched((t) => ({ ...t, [f]: true }))

  /** Moves to a step, stopping at the first earlier step that still has a problem. */
  const goTo = (target: number) => {
    let to = Math.min(target, LAST)
    let focus = 'launch-step-title'
    for (let i = 0; i < target; i++) {
      const bad = firstError(errors, i)
      if (bad) {
        to = i
        focus = fieldId(bad)
        break
      }
    }
    flushSync(() => {
      if (focus !== 'launch-step-title') setTried((t) => t.map((v, i) => v || i === to))
      setStep(to)
    })
    document.getElementById(focus)?.focus()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (step < LAST) return goTo(step + 1)
    // Something changed since you passed a step (say, a bot took your ticker): go back to it.
    if (STEPS.some((_, i) => firstError(errors, i))) return goTo(STEPS.length)
    const r = createLaunch(current)
    if (!r.ok) return setSubmitError(r.error)
    notify('good', `$${normalizeTicker(current.ticker)} presale is open. Share it to fill the pool.`)
    router.push(`/presale/${r.tokenId}`)
  }

  return (
    <div className={`page ${styles.screen}`}>
      <header className={styles.head}>
        <h1 className="page-title">Create a coin</h1>
        <p className={styles.lede}>
          Open a presale on MagicBlock ER. When the pool reaches {fmtSolRound(PRESALE_TARGET)} SOL it goes live on Solana by
          itself, and everyone in it gets the same price.
        </p>
      </header>

      <div className={styles.layout}>
        <form className={`panel ${styles.wizard}`} onSubmit={submit} noValidate aria-labelledby="launch-step-title">
          <Stepper step={step} onPick={goTo} />
          <h2 id="launch-step-title" tabIndex={-1} className={`panel-title ${styles.stepTitle}`}>
            Step {step + 1} of {STEPS.length} · {STEPS[step].label}
          </h2>

          {step === 0 && <TokenStep form={form} patch={patch} shown={shown} touch={touch} />}
          {step === 1 && <PresaleStep form={form} patch={patch} />}
          {step === 2 && (
            <CommitStep form={current} world={world} maxCommit={maxCommit} patch={patch} error={errors.commit} onEdit={goTo} />
          )}

          {submitError && (
            <p className="field-error" role="alert">
              {submitError}
            </p>
          )}
          <div className={styles.nav}>
            {step > 0 && (
              <button type="button" className="btn" onClick={() => goTo(step - 1)}>
                Back
              </button>
            )}
            {step < LAST ? (
              <button type="submit" className={`btn btn-primary ${styles.next}`}>
                Next: {STEPS[step + 1].label}
                <Icon name="arrow-right" size={14} />
              </button>
            ) : (
              <button type="submit" className={`btn btn-primary btn-lg ${styles.open}`} disabled={!!errors.commit}>
                Open presale · {fmtSol(current.commit)} SOL
              </button>
            )}
          </div>
        </form>

        <aside className={styles.aside} aria-labelledby="launch-preview-title">
          <h2 id="launch-preview-title" className={styles.asideTitle}>
            Preview · New Pairs
          </h2>
          <PresaleCard t={draft} world={world} preview />
          <section className={`panel ${styles.how}`} aria-labelledby="launch-how-title">
            <h2 id="launch-how-title" className="panel-title">
              How it launches
            </h2>
            <ol className={styles.howList}>
              <li>
                <strong>Presale on MagicBlock ER.</strong> Players commit {fmtSol(MIN_COMMIT)}–{fmtSol(MAX_COMMIT)} SOL each. The
                token isn&apos;t on Solana yet, so there&apos;s nothing to snipe.
              </li>
              <li>
                <strong>One price.</strong> Everyone gets tokens at the same price, you included. No team allocation.
              </li>
              <li>
                <strong>Launches at {fmtSolRound(PRESALE_TARGET)} SOL.</strong> The whole pool is the first buy on the curve, in one
                transaction.
              </li>
              <li>
                <strong>No fill, no loss.</strong> If the timer runs out first, everyone gets their SOL back.
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Stepper({ step, onPick }: { step: number; onPick: (step: number) => void }) {
  return (
    <ol className={styles.steps} aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s.label}>
          <button
            type="button"
            className={styles.step}
            data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}
            aria-current={i === step ? 'step' : undefined}
            onClick={() => onPick(i)}
          >
            <span className={`num ${styles.stepNum}`}>{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
            <span className={styles.stepLabel}>{s.label}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

interface FieldProps {
  id: string
  label: string
  optional?: boolean
  /** "12/32" */
  count?: string
  error?: string
  hint?: string
  children: (a11y: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode
}

/** Label, counter, control and its hint or error, wired together for screen readers. */
function Field({ id, label, optional, count, error, hint, children }: FieldProps) {
  const note = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="field">
      <div className={styles.labelRow}>
        <label htmlFor={id} className="field-label">
          {label}
          {optional && <span className="faint"> (optional)</span>}
        </label>
        {count && <span className={`num ${styles.count}`}>{count}</span>}
      </div>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': note })}
      {error ? (
        <p id={note} className="field-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={note} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

interface TokenStepProps {
  form: LaunchForm
  patch: Patch
  shown: (f: Field) => string | undefined
  touch: (f: Field) => void
}

function TokenStep({ form, patch, shown, touch }: TokenStepProps) {
  const leave = (f: Field, value: string) => {
    if (value.trim()) touch(f)
  }
  return (
    <div className={styles.fields}>
      <div className={styles.artRow}>
        <TokenArt name={form.name.trim() || PLACEHOLDER_NAME} size={88} className={styles.art} />
        <div className={styles.artText}>
          <p className={styles.artTitle}>Token art</p>
          <p className="field-hint">Drawn from the name. Change the name and you get new art.</p>
          <button type="button" className="btn btn-sm" disabled title="Image uploads are coming soon">
            <Icon name="plus" size={12} />
            Upload image · soon
          </button>
        </div>
      </div>

      <div className={styles.pair}>
        <Field id={fieldId('name')} label="Name" count={`${form.name.length}/${NAME_MAX}`} error={shown('name')}>
          {(a11y) => (
            <input
              {...a11y}
              className="input"
              value={form.name}
              maxLength={NAME_MAX}
              placeholder="Moon Cat"
              autoComplete="off"
              onChange={(e) => patch({ name: e.target.value })}
              onBlur={(e) => leave('name', e.target.value)}
            />
          )}
        </Field>
        <Field id={fieldId('ticker')} label="Ticker" count={`${form.ticker.length}/${TICKER_MAX}`} error={shown('ticker')}>
          {(a11y) => (
            <div className={styles.tickerBox}>
              <span className={`num ${styles.dollar}`} aria-hidden>
                $
              </span>
              <input
                {...a11y}
                className={`input num ${styles.tickerInput}`}
                value={form.ticker}
                maxLength={TICKER_MAX}
                placeholder="MCAT"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => patch({ ticker: normalizeTicker(e.target.value).slice(0, TICKER_MAX) })}
                onBlur={(e) => leave('ticker', e.target.value)}
              />
            </div>
          )}
        </Field>
      </div>

      <Field
        id={fieldId('description')}
        label="Description"
        optional
        count={`${form.description.length}/${DESCRIPTION_MAX}`}
        error={shown('description')}
      >
        {(a11y) => (
          <textarea
            {...a11y}
            className="input"
            rows={3}
            value={form.description}
            maxLength={DESCRIPTION_MAX}
            placeholder="What's the meme? One or two lines."
            onChange={(e) => patch({ description: e.target.value })}
          />
        )}
      </Field>

      <fieldset className={styles.group}>
        <legend className="field-label">
          Links <span className="faint">(optional)</span>
        </legend>
        <div className={styles.linkGrid}>
          {LINK_FIELDS.map(({ kind, label, placeholder }) => (
            <Field key={kind} id={fieldId(kind)} label={label} error={shown(kind)}>
              {(a11y) => (
                <input
                  {...a11y}
                  className="input"
                  value={form.links[kind] ?? ''}
                  placeholder={placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => patch({ links: { ...form.links, [kind]: e.target.value } })}
                  onBlur={(e) => leave(kind, e.target.value)}
                />
              )}
            </Field>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

function PresaleStep({ form, patch }: { form: LaunchForm; patch: Patch }) {
  return (
    <div className={styles.fields}>
      <fieldset className={styles.group}>
        <legend className="field-label">Who can join</legend>
        <div className={styles.choices}>
          <Choice
            name="visibility"
            icon="globe"
            title="Public"
            checked={form.visibility === 'public'}
            onPick={() => patch({ visibility: 'public' })}
          >
            Anyone can join from New Pairs, and matchmaking can send players in.
          </Choice>
          <Choice
            name="visibility"
            icon="lock"
            title="Private"
            checked={form.visibility === 'private'}
            onPick={() => patch({ visibility: 'private' })}
          >
            Only people with your invite link can join. Matchmaking skips it.
          </Choice>
        </div>
        {form.visibility === 'private' && (
          <p className={styles.note}>
            <Icon name="info" size={14} />
            <span>
              Your invite link is on the presale page once it opens. In this demo, simulated friends with the link join over
              time.
            </span>
          </p>
        )}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="field-label">Presale timer</legend>
        <div className={styles.timers}>
          {PRESALE_TIMER_MINUTES.map((m, i) => (
            <label key={m} className={styles.timer}>
              <input
                type="radio"
                name="minutes"
                id={i === 0 ? fieldId('minutes') : undefined}
                checked={form.minutes === m}
                onChange={() => patch({ minutes: m })}
              />
              <span className={`num ${styles.timerValue}`}>{m}</span>
              <span className={styles.timerUnit}>min</span>
            </label>
          ))}
        </div>
        <p className="field-hint">If the pool isn&apos;t full when the timer ends, the presale closes and everyone is refunded.</p>
      </fieldset>
    </div>
  )
}

interface ChoiceProps {
  name: string
  icon: IconName
  title: string
  checked: boolean
  onPick: () => void
  children: ReactNode
}

/** A radio button drawn as a card. */
function Choice({ name, icon, title, checked, onPick, children }: ChoiceProps) {
  return (
    <label className={styles.choice}>
      <input type="radio" name={name} checked={checked} onChange={onPick} />
      <span className={styles.choiceTitle}>
        <Icon name={icon} size={14} />
        {title}
      </span>
      <span className={styles.choiceText}>{children}</span>
    </label>
  )
}

interface CommitStepProps {
  form: LaunchForm
  world: World
  maxCommit: number
  patch: Patch
  error?: string
  onEdit: (step: number) => void
}

function CommitStep({ form, world, maxCommit, patch, error, onEdit }: CommitStepProps) {
  const ticker = normalizeTicker(form.ticker)
  const links = cleanLinks(form.links)
  const short = form.commit > world.walletLamports
  return (
    <div className={styles.fields}>
      <AmountPicker
        id={fieldId('commit')}
        label="Your commit"
        value={form.commit}
        min={MIN_COMMIT}
        max={maxCommit}
        presets={COMMIT_PRESETS}
        hint={`${fmtSol(MIN_COMMIT)}–${fmtSol(MAX_CREATOR_COMMIT)} SOL${MAX_CREATOR_COMMIT < MAX_COMMIT ? ', so others have room to join' : ', like every player'}. You can lower it later, but as the creator you can't withdraw.`}
        onChange={(v) => patch({ commit: v })}
      />
      <Allocation amount={form.commit} ticker={ticker} />
      {error && (
        <p className="field-error" role="alert">
          {short ? 'Not enough SOL in your demo wallet' : error}
        </p>
      )}

      <dl className={styles.review}>
        <Row label="Token" onEdit={() => onEdit(0)}>
          <span className={styles.reviewToken}>
            <TokenArt name={form.name} size={22} className={styles.reviewArt} />
            <span className="ellipsis">{form.name.trim()}</span>
            <span className="num muted">${ticker}</span>
          </span>
          {form.description.trim() && <span className={`muted ${styles.reviewDesc}`}>{form.description.trim()}</span>}
          <Links links={links} />
        </Row>
        <Row label="Who can join" onEdit={() => onEdit(1)}>
          {form.visibility === 'public' ? 'Public · open to matchmaking' : 'Private · invite link only'}
        </Row>
        <Row label="Timer" onEdit={() => onEdit(1)}>
          <span className="num">{form.minutes} min</span>
        </Row>
        <Row label="Launches at">
          <span>
            <span className="num">{fmtSolRound(PRESALE_TARGET)} SOL</span> in the pool
          </span>
        </Row>
      </dl>

      <p className={styles.wallet}>
        <span>Demo wallet</span>
        <span className="num">{fmtSol(world.walletLamports)} SOL</span>
      </p>
    </div>
  )
}

function Row({ label, onEdit, children }: { label: string; onEdit?: () => void; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{children}</dd>
      {onEdit && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          Edit<span className="sr-only"> {label.toLowerCase()}</span>
        </button>
      )}
    </div>
  )
}
