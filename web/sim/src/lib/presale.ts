// Presale rules (spec §3.2) and Find Match (spec §5.4). Pure: nothing here mutates.
// The transitions that move SOL live in engine.ts.
import { COMMIT_STEP, MAX_COMMIT, MAX_CREATOR_COMMIT, MIN_COMMIT, PRESALE_TARGET } from './constants'
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
 * `min = min(MIN_COMMIT, room)`, `max = min(MAX_COMMIT, room)`. Under 0.1 SOL of room, the
 * commit is exactly what's left, so the pool can always be completed. A seat alone in the
 * pool (the creator before anyone joins) stops at MAX_CREATOR_COMMIT, so one wallet can't
 * fill a pool by itself; that only bites while one seat could hold the whole pool.
 */
export function commitRange(p: Presale, userId: string): CommitRange {
  const room = remaining(p) + (participantOf(p, userId)?.commit ?? 0)
  const alone = p.participants.length === 1 && p.participants[0].userId === userId
  const cap = alone ? MAX_CREATOR_COMMIT : MAX_COMMIT
  return { room, min: Math.min(MIN_COMMIT, room), max: Math.min(cap, room) }
}

/** Snaps down to 0.01 SOL, then clamps into the user's range. */
export function clampCommit(p: Presale, userId: string, amount: Lamports): Lamports {
  const { min, max } = commitRange(p, userId)
  const snapped = Math.floor(amount / COMMIT_STEP) * COMMIT_STEP
  return Math.min(max, Math.max(min, snapped))
}

/** Explains the range, e.g. "max 0.40 SOL — that's all that's left". */
export function commitLimitReason(p: Presale, userId: string): string {
  const { min, max, room } = commitRange(p, userId)
  if (room < MIN_COMMIT) return `exactly ${fmtSol(room)} SOL — that's what's left`
  if (max < Math.min(MAX_COMMIT, room)) return `max ${fmtSol(max)} SOL — others need room to join`
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
  if (!participantOf(t.presale, userId)) return no('You are not in this presale')
  return OK
}

export function canWithdraw(t: Token, userId: string): Check {
  const c = canChange(t, userId)
  if (!c.ok) return c
  if (t.creatorId === userId) return no('Creators can lower their commit but not withdraw')
  return OK
}

/**
 * Launch sequence step while a full pool settles (spec §5.3): 0 "Pool full",
 * 1 "Settling to Solana", 2 "Token created". The world ticks once a second and the
 * pool can fill just before a tick, so "Pool full" holds through the first tick too:
 * every step stays up for at least a full second.
 */
export function launchPhase(elapsedMs: number): 0 | 1 | 2 {
  if (elapsedMs < 2_000) return 0
  if (elapsedMs < 3_000) return 1
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
