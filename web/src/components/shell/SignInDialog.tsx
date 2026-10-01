'use client'
// After you sign in (Privy): pick your first Mooner, and your wallet signs a short message (no
// transaction, no fee) so the server knows it's you. Roll again as often as you like first.
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
    <Dialog open={open} onClose={close} title="Your Mooner" size="m">
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
  const connect = useApp((s) => s.connectWallet)
  const notify = useApp((s) => s.notify)
  const hasWallet = useApp((s) => !!s.wallet)
  const [pfp, setPfp] = useState(() => roll(titles))
  const [busy, setBusy] = useState(false)

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
        {hasWallet ? (
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const r = await signIn(pfp)
              setBusy(false)
              if (!r.ok) notify('bad', r.error)
            }}
          >
            <Icon name="wallet" size={14} />
            {busy ? 'Saving…' : 'Keep this one'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={connect}>
            <Icon name="wallet" size={14} />
            Sign in
          </button>
        )}
        <p className={styles.note}>Your wallet signs a short message. No transaction, no fee.</p>
      </div>
    </>
  )
}
