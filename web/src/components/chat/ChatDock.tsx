'use client'
// Where a chat sits on the page (spec §6 responsive): shown on wide screens, where Pulse can fold it into a strip.
// Pulse's chat turns into a side drawer at ≤1279 px, where the three rails need the room; elsewhere the chat
// becomes an in-page panel at ≤1024 px.
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { ChatPanel, type ChatChannel } from './ChatPanel'
import styles from './ChatDock.module.css'

interface ChatDockProps {
  channels: readonly ChatChannel[]
  mode: 'drawer' | 'inline'
  className?: string
  /** Wide screens, drawer mode: the chat folds into a strip at the side. Omit `onFoldedChange` to keep it open. */
  folded?: boolean
  onFoldedChange?: (folded: boolean) => void
}

export function ChatDock({ channels, mode, className, folded = false, onFoldedChange }: ChatDockProps) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const stripRef = useRef<HTMLButtonElement>(null)
  const foldRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)
  const bodyId = useId()
  const foldable = mode === 'drawer' && onFoldedChange !== undefined

  // Folding moves focus to the control that undoes it; nothing moves on the first render.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    ;(folded ? stripRef : foldRef).current?.focus()
  }, [folded])

  useEffect(() => {
    if (!open || mode !== 'drawer') return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      toggleRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, mode])

  const close = () => {
    setOpen(false)
    toggleRef.current?.focus()
  }

  return (
    <div className={`${styles.dock} ${styles[mode]} ${className ?? ''}`} data-open={open} data-folded={foldable && folded}>
      <button
        ref={toggleRef}
        type="button"
        className={`btn ${styles.toggle}`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="chat" size={16} />
        {mode === 'inline' && open ? 'Hide chat' : 'Chat'}
      </button>
      {foldable && (
        <button
          ref={stripRef}
          type="button"
          className={styles.strip}
          aria-controls={bodyId}
          aria-expanded={false}
          onClick={() => onFoldedChange(false)}
        >
          <Icon name="chat" size={16} />
          <span>Show chat</span>
        </button>
      )}
      <div id={bodyId} className={styles.body}>
        <ChatPanel
          channels={channels}
          actions={
            mode === 'drawer' && (
              <>
                {foldable && (
                  <button
                    ref={foldRef}
                    type="button"
                    className={`btn btn-ghost btn-sm ${styles.fold}`}
                    aria-controls={bodyId}
                    aria-expanded
                    title="Hide chat"
                    onClick={() => onFoldedChange(true)}
                  >
                    <Icon name="chevrons-right" size={14} />
                    <span className="sr-only">Hide chat</span>
                  </button>
                )}
                <button ref={closeRef} type="button" className={`btn btn-ghost btn-sm ${styles.close}`} aria-label="Close chat" onClick={close}>
                  <Icon name="close" size={14} />
                </button>
              </>
            )
          }
        />
      </div>
    </div>
  )
}
