import { RARITY_NAMES } from '@/lib/levels'
import { SLOT_NAMES, SLOTS, traitOf } from '@/lib/pfp/traits'
import type { Pfp } from '@/lib/types'
import styles from './TraitList.module.css'

/** A Mooner's traits as chips, coloured by rarity. Empty slots are left out. */
export function TraitList({ pfp, className }: { pfp: Pfp; className?: string }) {
  const traits = SLOTS.map((s) => traitOf(s, pfp[s])).filter((t) => t && t.id !== 'none')
  return (
    <ul className={className ? `${styles.list} ${className}` : styles.list} aria-label="Traits">
      {traits.map(
        (t) =>
          t && (
            <li key={t.slot} className={styles.chip} data-rarity={t.rarity} title={RARITY_NAMES[t.rarity]}>
              <span className={styles.slot}>{SLOT_NAMES[t.slot]}</span>
              {t.name}
              <span className="sr-only">, {RARITY_NAMES[t.rarity]}</span>
            </li>
          ),
      )}
    </ul>
  )
}
