'use client'
// Your Mooner, on your profile: one trait per slot. Common traits are free; rarer ones unlock as your titles level up.
import { useMemo, useState } from 'react'
import { MoonerPic } from '@/components/art/MoonerPic'
import { TraitList } from '@/components/pfp/TraitList'
import { Icon } from '@/components/ui/Icon'
import { tabId, Tabs } from '@/components/ui/Tabs'
import { useApp } from '@/components/world/WorldProvider'
import { RARITY_NAMES } from '@/lib/levels'
import { blockerOf, isUnlocked, rollPfp, SLOT_NAMES, SLOTS, TRAITS, unlockText, withTrait } from '@/lib/pfp/traits'
import { createRng } from '@/lib/rng'
import type { Pfp, PfpSlot } from '@/lib/types'
import styles from './MoonerEditor.module.css'
import profile from './Profile.module.css'

const SLOT_TABS = SLOTS.map((s) => ({ id: s, label: SLOT_NAMES[s] }))

export function MoonerEditor() {
  const signedIn = useApp((s) => s.signedIn)
  const openSignIn = useApp((s) => s.openSignIn)
  return (
    <section className={`panel ${styles.editor}`} aria-labelledby="mooner-title">
      <header className={profile.panelHead}>
        <h2 id="mooner-title" className="panel-title">
          Your Mooner
        </h2>
        <span className={profile.panelNote}>Rarer traits unlock as your titles level up</span>
      </header>
      {signedIn ? (
        <Editor />
      ) : (
        <div className={styles.signedOut}>
          <p>Sign in to get your own Mooner. You can change it here any time after.</p>
          <button type="button" className="btn btn-primary" onClick={openSignIn}>
            <Icon name="wallet" size={14} />
            Sign in
          </button>
        </div>
      )}
    </section>
  )
}

function Editor() {
  const pfp = useApp((s) => s.world.users[s.world.meId].pfp)
  const titles = useApp((s) => s.world.users[s.world.meId].titles)
  const setPfp = useApp((s) => s.setPfp)
  const notify = useApp((s) => s.notify)
  const [slot, setSlot] = useState<PfpSlot>('skin')
  const blocker = blockerOf(pfp, slot)
  const options = useMemo(() => TRAITS[slot].map((t) => ({ t, look: withTrait(pfp, slot, t.id) })), [pfp, slot])
  const unlocked = options.filter((o) => isUnlocked(o.t, titles)).length

  const wear = async (next: Pfp) => {
    const r = await setPfp(next)
    if (!r.ok) notify('bad', r.error)
  }

  return (
    <div className={styles.body}>
      <div className={styles.preview}>
        <MoonerPic pfp={pfp} size={180} square priority={10} label="Your Mooner" />
        <TraitList pfp={pfp} className={styles.traits} />
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => wear(rollPfp(createRng(Math.floor(Math.random() * 2 ** 32)), titles))}
        >
          Randomize
        </button>
      </div>
      <div className={styles.picker}>
        <Tabs items={SLOT_TABS} value={slot} onChange={setSlot} label="Mooner parts" idPrefix="mooner" />
        <div role="tabpanel" aria-labelledby={tabId('mooner', slot)} className={styles.tabPanel}>
          {blocker ? (
            <p className={styles.note}>
              Your {blocker.name} covers this spot. Take it off to wear something here.
            </p>
          ) : (
            <>
              <p className={styles.note}>
                {unlocked} of {options.length} unlocked
              </p>
              <ul className={styles.grid}>
                {options.map(({ t, look }) => {
                  const open = isUnlocked(t, titles)
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={styles.option}
                        data-rarity={t.rarity}
                        aria-pressed={pfp[slot] === t.id}
                        disabled={!open}
                        onClick={() => wear(look)}
                      >
                        <span className={styles.thumb}>
                          <MoonerPic pfp={look} size={64} square />
                          {!open && (
                            <span className={styles.lock}>
                              <Icon name="lock" size={14} />
                            </span>
                          )}
                        </span>
                        <span className={styles.name}>{t.name}</span>
                        <span className={styles.meta}>{open ? RARITY_NAMES[t.rarity] : unlockText(t)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
