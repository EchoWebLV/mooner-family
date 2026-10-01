'use client'
// Signing in: X isn't wired up in the demo, so this rolls your first Mooner and signs you in as the demo
// player. You can roll again as often as you like before you sign in.
import { useState } from 'react'
import { MoonerPic } from '@/components/art/MoonerPic'
import { TraitList } from '@/components/pfp/TraitList'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { useApp } from '@/components/world/WorldProvider'
import { pfpKey, rollPfp } from '@/lib/pfp/traits'
import { createRng } from '@/lib/rng'
import type { Pfp, Title, TitleProgress } from '@/lib/types'
import styles from './SignInDialog.module.css'

export function SignInDialog() {
  const open = useApp((s) => s.signInOpen)
  const close = useApp((s) => s.closeSignIn)
  return (
    <Dialog open={open} onClose={close} title="Sign in to Mooner" size="m">
      <SignInBody />
    </Dialog>
  )
}

function roll(titles: Record<Title, TitleProgress>): Pfp {
  return rollPfp(createRng(Math.floor(Math.random() * 2 ** 32)), titles)
}

function SignInBody() {
  const titles = useApp((s) => s.world.users[s.world.meId].titles)
  const signIn = useApp((s) => s.signIn)
  const notify = useApp((s) => s.notify)
  const [pfp, setPfp] = useState(() => roll(titles))

  return (
    <>
      <div className={styles.body}>
        <div className={styles.stage}>
          <span key={pfpKey(pfp)} className={styles.reveal}>
            <MoonerPic pfp={pfp} size={200} square priority={10} label="Your Mooner" />
          </span>
        </div>
        <div className={styles.side}>
          <p className={styles.kicker}>Your Mooner</p>
          <p className={styles.lede}>
            Everyone gets a random Mooner. Don&apos;t like this one? Roll again. You can change it anytime on your
            profile.
          </p>
          <TraitList pfp={pfp} />
          <button type="button" className={`btn ${styles.reroll}`} onClick={() => setPfp(roll(titles))}>
            Roll again
          </button>
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => {
            const r = signIn(pfp)
            if (!r.ok) notify('bad', r.error)
          }}
        >
          <Icon name="x" size={14} />
          Sign in with X
        </button>
        <p className={styles.note}>Demo: no real X account is used.</p>
      </div>
    </>
  )
}
