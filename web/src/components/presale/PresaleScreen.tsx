'use client'
// Presale (spec §5.3): a pool fills to PRESALE_TARGET on MagicBlock ER, then settles to Solana.
// The same screen serves New Pairs and Find Match; a launched token hands over to its token page.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef } from 'react'
import { ChatDock } from '@/components/chat/ChatDock'
import { Icon } from '@/components/ui/Icon'
import { NotFound } from '@/components/ui/NotFound'
import { Redirecting } from '@/components/ui/Redirecting'
import { useApp, useWatch } from '@/components/world/WorldProvider'
import { LIVE_FLASH_MS, PRESALE_TARGET } from '@/lib/constants'
import { fmtClock, fmtSol, fmtSolRound } from '@/lib/format'
import { participantOf, poolLamports } from '@/lib/presale'
import { play, playChat } from '@/lib/sound'
import type { Token, World } from '@/lib/types'
import { CommitPanel } from './CommitPanel'
import { LaunchSequence } from './LaunchSequence'
import { Lobby } from './Lobby'
import { PoolBar } from './PoolBar'
import { PresaleHeader } from './PresaleHeader'
import styles from './PresaleScreen.module.css'

interface PresaleScreenProps {
  id: string
  /** From `?invite=`: opens a private presale. */
  invite?: string
}

export function PresaleScreen({ id, invite }: PresaleScreenProps) {
  const world = useApp((s) => s.world)
  const loaded = useApp((s) => s.loaded)
  const router = useRouter()
  const t = world.tokens[id]
  const launched = !!t && (t.stage === 'live' || t.stage === 'migrated')
  const reading = useWatch(id)
  // The launch sequence holds its LIVE frame this long, then the token page takes over.
  const flashLeft = launched ? LIVE_FLASH_MS - (world.now - (t.launchedAt ?? world.now)) : 0

  useEffect(() => {
    if (!launched) return
    const timer = window.setTimeout(() => router.replace(`/token/${id}`), Math.max(0, flashLeft))
    return () => window.clearTimeout(timer)
  }, [launched, flashLeft, id, router])

  if (!t) return !loaded || reading ? <Redirecting text="Loading the presale…" /> : <NotFound what="Presale" />
  if (launched && flashLeft <= 0) return <Redirecting text="It's live. Opening the token page…" />
  return <PresaleView t={t} world={world} invite={invite} />
}

const GLOBAL = { id: 'global', label: 'Global' }

function PresaleView({ t, world, invite }: { t: Token; world: World; invite?: string }) {
  const channels = useMemo(() => [{ id: t.id, label: '$' + t.ticker }, GLOBAL], [t.id, t.ticker])
  const settling = t.stage !== 'presale' && t.stage !== 'expired'
  usePresaleSounds(t)
  return (
    <div className={`page ${styles.screen}`}>
      {world.match?.tokenId === t.id && <MatchBanner t={t} world={world} />}
      {t.stage === 'expired' && <ExpiredBanner t={t} world={world} />}
      <div className={styles.cols}>
        <div className={styles.main}>
          <PresaleHeader t={t} world={world} invite={invite} className={styles.head} />
          <PoolBar t={t} world={world} className={styles.pool} />
          <Lobby t={t} world={world} invite={invite} className={styles.lobby} />
        </div>
        <div className={styles.side}>
          <CommitPanel t={t} world={world} invite={invite} className={styles.commit} />
          <ChatDock mode="inline" channels={channels} className={styles.chat} />
        </div>
      </div>
      {settling && <LaunchSequence t={t} now={world.now} />}
    </div>
  )
}

const NO_LINES: readonly { id: string }[] = []

/** `join` when a wallet takes a seat while the pool fills, `chat` when a line lands in its
 *  chat, as the phone's room (the first look at either is quiet). */
function usePresaleSounds(t: Token) {
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = t.presale.participants.map((p) => p.userId)
    const before = seen.current
    seen.current = new Set(ids)
    if (before && t.stage === 'presale' && ids.some((id) => !before.has(id))) play('join')
  }, [t.presale.participants, t.stage])

  const lines = useApp((s) => s.world.chat[t.id] ?? NO_LINES)
  const last = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const id = lines.at(-1)?.id ?? null
    if (last.current !== undefined && id !== last.current && id != null) playChat()
    last.current = id
  }, [lines])
}

/** Find Match put you here: the queue clock runs until it launches, expires or you withdraw. */
function MatchBanner({ t, world }: { t: Token; world: World }) {
  const found = t.stage !== 'presale'
  const queuedAt = world.match?.queuedAt ?? world.now
  return (
    <section className={`${styles.match} ${found ? styles.found : ''}`} aria-label="Matchmaking">
      <p className={styles.matchTitle}>
        {found ? 'Match found' : 'Looking for match'} · <span className="num">{fmtClock(world.now - queuedAt)}</span>
      </p>
      <p className={styles.matchHint}>
        {found
          ? 'The pool is full. Settling to Solana…'
          : `Your SOL is in the pool. It launches for everyone the moment it reaches ${fmtSolRound(PRESALE_TARGET)} SOL.`}
      </p>
    </section>
  )
}

function ExpiredBanner({ t, world }: { t: Token; world: World }) {
  const seat = useApp((s) => s.mine[t.id])
  const mine = participantOf(t.presale, world.meId) ?? (seat ? { commit: seat.deposit } : undefined)
  return (
    <section className={styles.expired} role="status">
      <Icon name="alert" size={20} />
      <div className={styles.expiredText}>
        <p className={styles.expiredTitle}>Expired: everyone gets their SOL back</p>
        <p className="muted">
          The timer ran out at {fmtSol(poolLamports(t.presale))} / {fmtSolRound(PRESALE_TARGET)} SOL.{' '}
          {mine ? `Your ${fmtSol(mine.commit)} SOL goes back to your wallet.` : 'Every seat goes back to its wallet.'}
        </p>
      </div>
      <Link href="/" className="btn btn-sm">
        Back to Pulse
      </Link>
    </section>
  )
}
