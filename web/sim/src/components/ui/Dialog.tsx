'use client'
// A modal on the native <dialog>: the browser handles the focus trap, Esc and the top layer.
import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './Dialog.module.css'
import { Icon } from './Icon'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  size?: 's' | 'm'
}

export function Dialog({ open, onClose, title, children, size = 's' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[size]}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Content mounts only while open, so each opening starts fresh. */}
      {open && (
        <div className={styles.inner}>
          <header className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  )
}
