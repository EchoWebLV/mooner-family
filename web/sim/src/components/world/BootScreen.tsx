import { Logo } from '@/components/art/Logo'
import styles from './BootScreen.module.css'

/** Shown by the server and until the simulated world exists in the browser. */
export function BootScreen() {
  return (
    <div className={styles.boot} role="status">
      <p className={styles.word}>
        <Logo size={40} />
        Mooner
      </p>
      <p className="muted">Starting the simulated world…</p>
    </div>
  )
}
