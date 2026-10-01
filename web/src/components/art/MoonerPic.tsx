'use client'

import Image from 'next/image'
import { memo, useEffect, useRef, useState } from 'react'
import { pfpSizeFor, pfpUrl, requestPfp } from '@/lib/pfp/load'
import { PALETTES } from '@/lib/pfp/render/look'
import { pfpKey } from '@/lib/pfp/traits'
import type { Pfp } from '@/lib/types'
import styles from './MoonerPic.module.css'

interface MoonerPicProps {
  pfp: Pfp
  size: number
  className?: string
  /** Square with rounded corners instead of a circle. */
  square?: boolean
  /** Drawn before smaller or lower-priority pictures. */
  priority?: number
  /** Accessible name; the picture is decorative when unset. */
  label?: string
}

/**
 * A Mooner picture. It is drawn in the browser the first time it is on screen (see lib/pfp/load.ts); until then the
 * background's colours stand in with a pale moon.
 */
export const MoonerPic = memo(function MoonerPic({ pfp, size, className, square, priority = 0, label }: MoonerPicProps) {
  const px = pfpSizeFor(size)
  const key = `${pfpKey(pfp)}@${px}`
  const [got, setGot] = useState<{ key: string; url: string } | null>(null)
  const url = got?.key === key ? got.url : pfpUrl(pfp, px)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (url) return
    let live = true
    const draw = () =>
      requestPfp(pfp, px, priority + px / 1000).then(
        (u) => live && setGot({ key, url: u }),
        () => {},
      )
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      draw()
      return () => {
        live = false
      }
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        draw()
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [url, key, pfp, px, priority])

  const p = PALETTES[pfp.bg] ?? PALETTES.midnight
  const cls = [styles.pic, square ? styles.square : '', className].filter(Boolean).join(' ')
  return (
    <span
      ref={ref}
      className={cls}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 50% 44%, rgb(242 239 232 / 0.16) 0 29%, transparent 30%), radial-gradient(circle at 50% 46%, ${p.bg2}, ${p.bg} 78%)`,
      }}
    >
      {url && <Image src={url} alt="" width={size} height={size} draggable={false} />}
    </span>
  )
})
