import Link from 'next/link'
import styles from './NotFound.module.css'

const TOKEN_HINT =
  "It may have expired and been cleared, or the link is wrong. The demo world starts over on every reload, so links to tokens made in an earlier visit don't carry over."

interface NotFoundProps {
  what: string
  /** Why it might be missing; defaults to the explanation for tokens and presales. */
  hint?: string
  /** The way back; defaults to Pulse. */
  back?: { href: string; label: string }
}

/** Unknown token, presale or profile (spec §8): say so and offer the way back. */
export function NotFound({ what, hint = TOKEN_HINT, back = { href: '/', label: 'Back to Pulse' } }: NotFoundProps) {
  return (
    <div className={styles.wrap}>
      <p className={`num ${styles.code}`} aria-hidden>
        404
      </p>
      <h1 className={styles.title}>{what} not found</h1>
      <p className="muted">{hint}</p>
      <Link href={back.href} className="btn btn-primary">
        {back.label}
      </Link>
    </div>
  )
}
