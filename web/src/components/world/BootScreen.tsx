import { Logo } from '@/components/art/Logo'
import styles from './BootScreen.module.css'

/** Shown while the site loads. */
export function BootScreen() {
  return (
    <div className={styles.boot} role="status">
      <p className={styles.word}>
        <Logo size={40} />
        Mooner
      </p>
      <p className="muted">Loading…</p>
    </div>
  )
}
