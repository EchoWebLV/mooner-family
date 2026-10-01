import type { ReactNode } from 'react'
import styles from './AppShell.module.css'
import { LevelUpHost } from './LevelUpHost'
import { SignInDialog } from './SignInDialog'
import { Toasts } from './Toasts'
import { TopBar } from './TopBar'

/** Every page (spec §5.1): top bar, content, toasts, the level-up overlay and the sign-in window. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <TopBar />
      <main id="main" className={styles.main} tabIndex={-1}>
        {children}
      </main>
      <Toasts />
      <LevelUpHost />
      <SignInDialog />
    </>
  )
}
