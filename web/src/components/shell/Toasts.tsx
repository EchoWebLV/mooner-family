'use client'
import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import { useApp } from '@/components/world/WorldProvider'
import styles from './Toasts.module.css'

const ICONS = { good: 'check', bad: 'alert', info: 'info' } as const

/** Results of your actions and world events that concern you; each clears after a few seconds. */
export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.tone]}`}>
          <Icon name={ICONS[t.tone]} size={16} className={styles.icon} />
          <p className={styles.text}>{t.text}</p>
          {t.href && (
            <Link href={t.href} className="btn btn-sm" onClick={() => dismiss(t.id)}>
              View
            </Link>
          )}
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
