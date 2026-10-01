// Launch wizard rules (spec §5.6). Pure: the wizard shows these errors inline
// and the store refuses a form that has any.
import { COMMIT_STEP, MAX_CREATOR_COMMIT, MIN_COMMIT, PRESALE_TIMER_MINUTES } from './constants'
import { fmtSol } from './format'
import type { Lamports, Token, TokenLinks, World } from './types'

export const NAME_MAX = 32
export const TICKER_MIN = 2
export const TICKER_MAX = 10
export const DESCRIPTION_MAX = 280

export interface LaunchForm {
  name: string
  ticker: string
  description: string
  links: TokenLinks
  visibility: 'public' | 'private'
  minutes: number
  commit: Lamports
}

export type LaunchErrors = Partial<Record<'name' | 'ticker' | 'description' | 'minutes' | 'commit' | keyof TokenLinks, string>>

export const LINK_KINDS: readonly (keyof TokenLinks)[] = ['x', 'telegram', 'website']

/** "$moon" → "MOON": uppercase letters and digits only. */
export function normalizeTicker(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const HANDLE = /^@?([A-Za-z0-9_]{1,32})$/
const HANDLE_BASE: Partial<Record<keyof TokenLinks, string>> = { x: 'https://x.com/', telegram: 'https://t.me/' }
const LINK_ERRORS: Record<keyof TokenLinks, string> = {
  x: 'Enter an X link or @handle',
  telegram: 'Enter a Telegram link or @handle',
  website: 'Enter a web address',
}

/**
 * A link the page can point at: http(s) with a dotted host, or null. A bare
 * @handle becomes an X or Telegram address; a bare domain gets https://.
 */
export function linkHref(kind: keyof TokenLinks, value: string): string | null {
  const v = value.trim()
  if (!v) return null
  const handle = HANDLE.exec(v)
  const base = HANDLE_BASE[kind]
  if (handle && base) return base + handle[1]
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Normalizes every link and drops the empty or unusable ones. */
export function cleanLinks(links: TokenLinks): TokenLinks {
  const out: TokenLinks = {}
  for (const key of LINK_KINDS) {
    const href = linkHref(key, links[key] ?? '')
    if (href) out[key] = href
  }
  return out
}

export function validateLaunch(w: World, form: LaunchForm): LaunchErrors {
  const errors: LaunchErrors = {}
  const name = form.name.trim()
  if (name.length < 2) errors.name = 'At least 2 characters'
  else if (name.length > NAME_MAX) errors.name = `At most ${NAME_MAX} characters`

  const ticker = normalizeTicker(form.ticker)
  if (ticker.length < TICKER_MIN || ticker.length > TICKER_MAX) errors.ticker = `${TICKER_MIN}–${TICKER_MAX} letters or digits`
  else if (Object.values(w.tokens).some((t) => t.stage !== 'expired' && t.ticker === ticker)) errors.ticker = `$${ticker} is taken`

  if (form.description.trim().length > DESCRIPTION_MAX) errors.description = `At most ${DESCRIPTION_MAX} characters`

  for (const key of LINK_KINDS) {
    const value = form.links[key] ?? ''
    if (value.trim() && !linkHref(key, value)) errors[key] = LINK_ERRORS[key]
  }

  if (!(PRESALE_TIMER_MINUTES as readonly number[]).includes(form.minutes)) {
    errors.minutes = `Pick ${PRESALE_TIMER_MINUTES.join(', ')} minutes`
  }

  if (form.commit < MIN_COMMIT || form.commit > MAX_CREATOR_COMMIT || form.commit % COMMIT_STEP !== 0) {
    errors.commit = `${fmtSol(MIN_COMMIT)}–${fmtSol(MAX_CREATOR_COMMIT)} SOL`
  } else if (form.commit > w.walletLamports) errors.commit = 'Not enough SOL'
  return errors
}

export function hasErrors(errors: LaunchErrors): boolean {
  return Object.keys(errors).length > 0
}

/** The presale this form would open, for the wizard's preview card. Leaves the world alone. */
export function draftToken(w: World, form: LaunchForm): Token {
  return {
    id: 'draft',
    name: form.name.trim(),
    ticker: normalizeTicker(form.ticker),
    description: form.description.trim(),
    address: '',
    links: cleanLinks(form.links),
    creatorId: w.meId,
    stage: 'presale',
    createdAt: w.now,
    presale: {
      visibility: form.visibility,
      participants: [{ userId: w.meId, commit: form.commit, joinedAt: w.now }],
      expiresAt: w.now + form.minutes * 60_000,
    },
    positions: {},
    costBasis: {},
    candles: [],
    trades: [],
    volumeSol: 0,
    heat: 0,
  }
}
