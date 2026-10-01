// Presale rules (spec §3.2) and Find Match (spec §5.4), as the program enforces them.
// Pure: nothing here mutates. The store's actions move the SOL.
import { COMMIT_STEP, MAX_COMMIT, MIN_COMMIT, PRESALE_TARGET } from './constants'
import { fmtSol } from './format'
import type { Lamports, Participant, Presale, Token, World } from './types'

export interface Check {
  ok: boolean
  /** Why not, in words the UI can show. */
  reason?: string
}

const OK: Check = { ok: true }
const no = (reason: string): Check => ({ ok: false, reason })

export function poolLamports(p: Presale): Lamports {
  if (p.raised != null) return p.raised
  let sum = 0
  for (const x of p.participants) sum += x.commit
  return sum
}

export function remaining(p: Presale): Lamports {
  return PRESALE_TARGET - poolLamports(p)
}

export function isFull(p: Presale): boolean {
  return remaining(p) <= 0
}

export function participantOf(p: Presale, userId: string): Participant | undefined {
  return p.participants.find((x) => x.userId === userId)
}

export interface CommitRange {
  min: Lamports
  max: Lamports
  /** What's left in the pool plus the user's current commit. */
  room: Lamports
}

/**
 * The allowed total position for a user: `room = remaining + current commit`,
 * `min = min(0.1, room)`, `max = min(cap, room)`. `cap` is what you put in when you
 * joined (a seat can't be topped up). Under 0.1 SOL of room, the commit is exactly
 * what's left: the program cuts a bigger one to fit, so the pool can always fill.
 */
export function commitRange(p: Presale, userId: string, cap: Lamports = MAX_COMMIT): CommitRange {
  const room = Math.max(0, remaining(p) + (participantOf(p, userId)?.commit ?? 0))
  return { room, min: Math.min(MIN_COMMIT, room), max: Math.min(cap, room) }
}

/** Snaps down to 0.01 SOL, then clamps into the user's range. */
export function clampCommit(p: Presale, userId: string, amount: Lamports, cap: Lamports = MAX_COMMIT): Lamports {
  const { min, max } = commitRange(p, userId, cap)
  const snapped = Math.floor(amount / COMMIT_STEP) * COMMIT_STEP
  return Math.min(max, Math.max(min, snapped))
}

/** Explains the range, e.g. "max 0.40 SOL — that's all that's left". */
export function commitLimitReason(p: Presale, userId: string, cap: Lamports = MAX_COMMIT): string {
  const { min, max, room } = commitRange(p, userId, cap)
  if (room < MIN_COMMIT) return `exactly ${fmtSol(room)} SOL — that's what's left`
  if (max < MAX_COMMIT && max === cap) return `max ${fmtSol(max)} SOL — what you put in when you joined`
  if (max < MAX_COMMIT) return `max ${fmtSol(max)} SOL — that's all that's left`
  return `${fmtSol(min)}–${fmtSol(max)} SOL per wallet`
}

export function canJoin(t: Token, userId: string, inviteCode?: string): Check {
  const p = t.presale
  if (t.stage !== 'presale') return no('This presale is closed')
  if (participantOf(p, userId)) return no('You are already in')
  if (p.visibility === 'private' && inviteCode !== p.inviteCode) return no('Invite only')
  if (isFull(p)) return no('The pool is full')
  return OK
}

export function canChange(t: Token, userId: string): Check {
  if (t.stage === 'launching') return no('Locked in — settling to Solana')
  if (t.stage !== 'presale') return no('This presale is closed')
  if (t.creatorId === userId) return no("As the creator, your commit is locked in until launch")
  if (!participantOf(t.presale, userId)) return no('You are not in this presale')
  return OK
}

export function canWithdraw(t: Token, userId: string): Check {
  return canChange(t, userId)
}

/**
 * Launch sequence step while a full pool settles (spec §5.3): 0 "Pool full",
 * 1 "Settling to Solana", 2 "Token created". The keeper launches within seconds of the
 * pool filling; the steps pace the wait until the chain says it's live.
 */
export function launchPhase(elapsedMs: number): 0 | 1 | 2 {
  if (elapsedMs < 3_000) return 0
  if (elapsedMs < 8_000) return 1
  return 2
}

/** Lobby circle size in px: it steps down as the presale grows (spec §5.3). */
export function circleSize(participants: number): 64 | 44 | 32 {
  if (participants <= 20) return 64
  if (participants <= 50) return 44
  return 32
}

/** Moving `delta` more lamports into the pool needs that much in the wallet. */
export function canAfford(walletLamports: Lamports, delta: Lamports): Check {
  return delta <= walletLamports ? OK : no('Not enough SOL')
}

/**
 * Find Match (spec §5.4): among public presales the user isn't in, the one that can
 * take the full amount with the least room to spare; ties go to the one expiring soonest.
 */
export function pickMatch(w: World, userId: string, amount: Lamports): string | undefined {
  let best: Token | undefined
  let bestSpare = Infinity
  for (const t of Object.values(w.tokens)) {
    if (t.stage !== 'presale' || t.presale.visibility !== 'public') continue
    if (participantOf(t.presale, userId)) continue
    const spare = remaining(t.presale) - amount
    if (spare < 0) continue
    if (spare < bestSpare || (spare === bestSpare && t.presale.expiresAt < best!.presale.expiresAt)) {
      best = t
      bestSpare = spare
    }
  }
  return best?.id
}
