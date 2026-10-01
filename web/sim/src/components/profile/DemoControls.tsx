'use client'
import { useApp } from '@/components/world/WorldProvider'
import { XP_X_ACTIVITY } from '@/lib/constants'
import { TITLE_NAMES, TITLES, X_TITLES } from '@/lib/levels'
import type { Result } from '@/lib/store'
import styles from './Profile.module.css'

/** Your profile only (spec §5.8): X isn't wired up in the demo, so its titles earn XP from these buttons. */
export function DemoControls() {
  const simulateXActivity = useApp((s) => s.simulateXActivity)
  const simulateLevelUp = useApp((s) => s.simulateLevelUp)
  const notify = useApp((s) => s.notify)
  const signedIn = useApp((s) => s.signedIn)
  const signOut = useApp((s) => s.signOut)
  const openSignIn = useApp((s) => s.openSignIn)
  const run = (result: Result) => {
    if (!result.ok) notify('bad', result.error)
  }

  return (
    <section className={`panel ${styles.demo}`} aria-labelledby="demo-title">
      <header className={styles.panelHead}>
        <h2 id="demo-title" className="panel-title">
          Demo controls
        </h2>
        <span className={styles.panelNote}>Only you see these</span>
      </header>
      <div className={styles.demoBody}>
        <p className={styles.demoNote}>
          The demo has no X account behind it, so KOL, Shiller and Raider earn XP here. Diamond Hands levels on-chain
          only: when a presale you&apos;re in goes live, and when a token you still hold migrates.
        </p>
        <div className={styles.demoRow}>
          <span id="demo-x" className={styles.demoLabel}>
            Simulate X activity
          </span>
          <div className={styles.demoButtons} role="group" aria-labelledby="demo-x">
            {X_TITLES.map((title) => (
              <button key={title} type="button" className="btn btn-sm" onClick={() => run(simulateXActivity(title))}>
                {TITLE_NAMES[title]}
                <span className={`num ${styles.award}`}>+{XP_X_ACTIVITY} XP</span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.demoRow}>
          <span id="demo-level" className={styles.demoLabel}>
            Simulate level-up
          </span>
          <div className={styles.demoButtons} role="group" aria-labelledby="demo-level">
            {TITLES.map((title) => (
              <button key={title} type="button" className="btn btn-sm" onClick={() => run(simulateLevelUp(title))}>
                {TITLE_NAMES[title]}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.demoRow}>
          <span id="demo-account" className={styles.demoLabel}>
            Account
          </span>
          <div className={styles.demoButtons} role="group" aria-labelledby="demo-account">
            {signedIn ? (
              <button type="button" className="btn btn-sm" onClick={signOut}>
                Sign out
              </button>
            ) : (
              <button type="button" className="btn btn-sm" onClick={openSignIn}>
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
