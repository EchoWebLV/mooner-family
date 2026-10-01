'use client'
// Every Mooner trait, and every player's Mooner.
import Link from 'next/link'
import { useMemo } from 'react'
import { MoonerPic } from '@/components/art/MoonerPic'
import { useApp } from '@/components/world/WorldProvider'
import { RARITY_NAMES } from '@/lib/levels'
import { DEFAULT_PFP, SLOT_NAMES, SLOTS, TRAITS, unlockText, withTrait } from '@/lib/pfp/traits'
import styles from './MoonersScreen.module.css'

export function MoonersScreen() {
  const users = useApp((s) => s.world.users)
  const players = useMemo(() => Object.values(users).sort((a, b) => Number(a.isBot) - Number(b.isBot)), [users])
  return (
    <div className={`page ${styles.screen}`}>
      <header className={styles.head}>
        <h1 className="page-title">Mooners</h1>
        <p className={styles.lede}>
          Everyone here is a Mooner. You get a random one when you sign in and can change it on your profile. Common
          traits are free; rarer ones unlock as your titles level up.
        </p>
      </header>

      <section className={`panel ${styles.block}`} aria-labelledby="mooners-everyone">
        <h2 id="mooners-everyone" className={styles.blockTitle}>
          Everyone
        </h2>
        <ul className={styles.grid}>
          {players.map((u) => (
            <li key={u.id}>
              <Link href={`/profile/${u.handle}`} className={styles.card}>
                <MoonerPic pfp={u.pfp} size={120} square />
                <span className={styles.name}>@{u.handle}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {SLOTS.map((slot) => (
        <section key={slot} className={`panel ${styles.block}`} aria-labelledby={`mooners-${slot}`}>
          <h2 id={`mooners-${slot}`} className={styles.blockTitle}>
            {SLOT_NAMES[slot]}
          </h2>
          <ul className={styles.grid}>
            {TRAITS[slot].map((t) => (
              <li key={t.id} className={styles.card} data-rarity={t.rarity}>
                <MoonerPic pfp={withTrait(DEFAULT_PFP, slot, t.id)} size={120} square />
                <span className={styles.name}>{t.name}</span>
                <span className={styles.rarity}>
                  {RARITY_NAMES[t.rarity]}
                  {unlockText(t) && ` · ${unlockText(t)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
