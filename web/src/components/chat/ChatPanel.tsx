'use client'
// Chat (spec §5.2): avatar, handle, main badge, level, time, text; `$TICKER` mentions of
// existing tokens are links. Sticks to the newest message unless you scroll up.
import Link from 'next/link'
import { memo, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Avatar } from '@/components/art/Avatar'
import { Badge } from '@/components/badges/Badge'
import { Icon } from '@/components/ui/Icon'
import { Tabs, tabId } from '@/components/ui/Tabs'
import { useApp } from '@/components/world/WorldProvider'
import { MAX_CHAT_LENGTH } from '@/lib/constants'
import { roman } from '@/lib/format'
import { chatParts, mainBadge, tokenHref } from '@/lib/selectors'
import type { ChatMessage, User, World } from '@/lib/types'
import styles from './ChatPanel.module.css'

export interface ChatChannel {
  /** 'global' or a token id. */
  id: string
  label: string
}

interface ChatPanelProps {
  channels: readonly ChatChannel[]
  /** Extra controls in the header (e.g. the drawer's close button). */
  actions?: ReactNode
}

const SHOWN = 100
const EMPTY: ChatMessage[] = []

/** One string per token that can be mentioned, so the selector result is a stable primitive. */
function tickerSignature(w: World): string {
  let s = ''
  for (const t of Object.values(w.tokens)) if (t.stage !== 'expired') s += `${t.ticker.toUpperCase()} ${t.id} ${tokenHref(t)}\n`
  return s
}

function parseSignature(signature: string): { tickers: Map<string, string>; hrefs: Map<string, string> } {
  const tickers = new Map<string, string>()
  const hrefs = new Map<string, string>()
  for (const row of signature.split('\n')) {
    if (!row) continue
    const [ticker, id, href] = row.split(' ')
    tickers.set(ticker, id)
    hrefs.set(id, href)
  }
  return { tickers, hrefs }
}

export function ChatPanel({ channels, actions }: ChatPanelProps) {
  const [picked, setPicked] = useState(channels[0].id)
  const channel = channels.some((c) => c.id === picked) ? picked : channels[0].id
  const label = channels.find((c) => c.id === channel)!.label
  const all = useApp((s) => s.world.chat[channel] ?? EMPTY)
  const messages = useMemo(() => all.slice(-SHOWN), [all])
  const users = useApp((s) => s.world.users)
  const meId = useApp((s) => s.world.meId)
  const signature = useApp((s) => tickerSignature(s.world))
  const { tickers, hrefs } = useMemo(() => parseSignature(signature), [signature])
  const idPrefix = useId()

  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = () => {
    const el = listRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  return (
    <section className={styles.panel} aria-label="Chat">
      <div className={styles.head}>
        {channels.length > 1 ? (
          <Tabs
            items={channels.map((c) => ({ id: c.id, label: c.label }))}
            value={channel}
            onChange={(id) => {
              stick.current = true
              setPicked(id)
            }}
            label="Chat channels"
            idPrefix={idPrefix}
            className={styles.tabs}
          />
        ) : (
          <h2 className="panel-title">{label} chat</h2>
        )}
        {actions}
      </div>
      <div
        ref={listRef}
        className={styles.list}
        onScroll={onScroll}
        role={channels.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={channels.length > 1 ? tabId(idPrefix, channel) : undefined}
        tabIndex={0}
      >
        {messages.length === 0 && <p className={styles.empty}>No messages yet. Say gm.</p>}
        {messages.map((m) => (
          <ChatLine key={m.id} msg={m} user={users[m.userId]} mine={m.userId === meId} tickers={tickers} hrefs={hrefs} />
        ))}
      </div>
      <Composer
        channel={channel}
        label={label}
        onSent={() => {
          stick.current = true
        }}
      />
    </section>
  )
}

interface ChatLineProps {
  msg: ChatMessage
  user: User | undefined
  mine: boolean
  tickers: Map<string, string>
  hrefs: Map<string, string>
}

const ChatLine = memo(function ChatLine({ msg, user, mine, tickers, hrefs }: ChatLineProps) {
  const handle = user?.handle ?? 'unknown'
  const badge = user ? mainBadge(user) : null
  const time = new Date(msg.at).toISOString().slice(11, 16)
  return (
    <div className={`${styles.line} ${mine ? styles.mine : ''}`}>
      <Avatar handle={handle} size={22} />
      <div className={styles.body}>
        <div className={styles.meta}>
          <Link href={`/profile/${handle}`} className={styles.handle}>
            {handle}
          </Link>
          {badge && (
            <>
              <Badge title={badge.title} level={badge.level} size={16} />
              <span className={styles.lvl} aria-hidden>
                {roman(badge.level)}
              </span>
            </>
          )}
          <time className={`num ${styles.time}`} dateTime={new Date(msg.at).toISOString()}>
            {time}
          </time>
        </div>
        <p className={styles.text}>
          {chatParts(msg.text, tickers).map((part, i) =>
            part.kind === 'ticker' ? (
              <Link key={i} href={hrefs.get(part.tokenId) ?? `/token/${part.tokenId}`} className={styles.ticker}>
                {part.text}
              </Link>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      </div>
    </div>
  )
})

function Composer({ channel, label, onSent }: { channel: string; label: string; onSent: () => void }) {
  const sendChat = useApp((s) => s.sendChat)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [sending, setSending] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (sending) return
    setSending(true)
    const r = await sendChat(channel, text)
    setSending(false)
    if (r.ok) {
      setText('')
      setError(null)
      onSent()
    } else setError(r.error)
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <div className={styles.row}>
        <input
          className="input"
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={`Message ${label}`}
          aria-label={`Message ${label}`}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
        />
        <button type="submit" className="btn btn-primary" aria-label="Send" disabled={sending}>
          <Icon name="send" size={14} />
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
