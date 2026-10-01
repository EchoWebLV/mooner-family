import { LINK_KINDS, linkHref } from '@/lib/launch'
import type { TokenLinks } from '@/lib/types'
import { Icon, type IconName } from './Icon'
import styles from './Links.module.css'

const META: Record<keyof TokenLinks, { icon: IconName; label: string }> = {
  x: { icon: 'x', label: 'X' },
  telegram: { icon: 'send', label: 'Telegram' },
  website: { icon: 'globe', label: 'Website' },
}

interface LinksProps {
  links: TokenLinks
  /** Labelled links for headers; bare icons for rows, where a missing link shows as a faint slot. */
  variant?: 'labels' | 'icons'
  /** Names the links for screen readers when the icons stand alone. */
  name?: string
  className?: string
}

/** A token's social links. Only http(s) addresses are rendered, whatever was stored. */
export function Links({ links, variant = 'labels', name, className }: LinksProps) {
  const items = LINK_KINDS.map((kind) => ({ kind, href: linkHref(kind, links[kind] ?? '') }))

  if (variant === 'icons') {
    return (
      <ul className={`${styles.icons} ${className ?? ''}`} aria-label={name ? `${name} socials` : 'Socials'}>
        {items.map(({ kind, href }) => (
          <li key={kind}>
            {href ? (
              <a className={styles.icon} href={href} target="_blank" rel="noopener noreferrer" title={META[kind].label}>
                <Icon name={META[kind].icon} size={13} />
                <span className="sr-only">
                  {META[kind].label} (opens in a new tab)
                </span>
              </a>
            ) : (
              <span className={`${styles.icon} ${styles.missing}`} title={`No ${META[kind].label}`}>
                <Icon name={META[kind].icon} size={13} />
                <span className="sr-only">No {META[kind].label}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    )
  }

  const present = items.filter((i): i is { kind: keyof TokenLinks; href: string } => i.href !== null)
  if (present.length === 0) return null
  return (
    <ul className={`${styles.labels} ${className ?? ''}`}>
      {present.map(({ kind, href }) => (
        <li key={kind}>
          <a className="btn btn-ghost btn-sm" href={href} target="_blank" rel="noopener noreferrer">
            <Icon name={META[kind].icon} size={12} />
            {META[kind].label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
