import type { ReactNode } from 'react'
import { fmtChange } from '@/lib/format'
import styles from './Stat.module.css'

interface StatProps {
  label: ReactNode
  children: ReactNode
  className?: string
}

/** A label/value pair. Use inside a <dl>. */
export function Stat({ label, children, className }: StatProps) {
  return (
    <div className={`${styles.stat} ${className ?? ''}`}>
      <dt className={styles.label}>{label}</dt>
      <dd className={`num ${styles.value}`}>{children}</dd>
    </div>
  )
}

/** A price change with its sign and an arrow, so it never relies on colour alone. */
export function Change({ value, className }: { value: number; className?: string }) {
  const dir = value > 0.0005 ? 'up' : value < -0.0005 ? 'down' : 'flat'
  return (
    <span className={`num ${dir === 'flat' ? 'muted' : dir} ${className ?? ''}`}>
      {dir !== 'flat' && <span aria-hidden>{dir === 'up' ? '▲ ' : '▼ '}</span>}
      {fmtChange(value)}
    </span>
  )
}
