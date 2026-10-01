import Image from 'next/image'
import styles from './Logo.module.css'

/** The Mooner mark, from public/mooner.svg (a copy of assets/mooner.svg, never redrawn). */
export function Logo({ size, className }: { size: number; className?: string }) {
  return (
    <Image
      src={`${import.meta.env.BASE_URL}mooner.svg`}
      alt=""
      width={size}
      height={size}
      loading="eager"
      draggable={false}
      className={className ? `${styles.logo} ${className}` : styles.logo}
    />
  )
}
