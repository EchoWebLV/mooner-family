'use client'

import Image from 'next/image'
import { memo, useState } from 'react'
import { memePhoto } from '@/lib/memes'
import { hashString } from '@/lib/rng'
import { useSvgId } from './useSvgId'

/** The tile's corner radius, matching the drawing's rx="8", so clipping and glows keep the same shape at any size. */
const TILE = { borderRadius: '8%' } as const
/** A photo gets the drawing's faint inner edge, so a dark photo keeps its shape on a dark row. */
const PHOTO = { ...TILE, objectFit: 'cover', outline: '1px solid rgb(255 255 255 / 0.1)', outlineOffset: -1 } as const

interface TokenArtProps {
  name: string
  /** The meme the coin is named after (Token.meme), or the coin's own picture as an https URL. */
  meme?: string
  size?: number
  className?: string
}

/**
 * A coin's square tile with softly rounded corners (spec §6): the photo of the meme it is named after, else a
 * deterministic drawing from the name, a small moon in its own sky. A photo that fails to load falls back to the drawing.
 */
export const TokenArt = memo(function TokenArt({ name, meme, size = 40, className }: TokenArtProps) {
  const id = useSvgId('art')
  const [failed, setFailed] = useState<string | null>(null)
  const photo = meme && /^(https|blob):/.test(meme) ? { src: meme } : memePhoto(meme)
  if (photo && failed !== photo.src) {
    return (
      <Image
        className={className}
        style={PHOTO}
        src={photo.src}
        width={size}
        height={size}
        alt=""
        onError={() => setFailed(photo.src)}
      />
    )
  }
  const h = hashString(name.trim().toLowerCase() || 'mooner')
  const r = (shift: number, mod: number) => (h >>> shift) % mod
  const hue = r(0, 360)
  const skyHue = (hue + 180 + r(9, 60)) % 360
  const orbX = 44 + r(3, 14)
  const orbY = 46 + r(6, 12)
  const orbR = 20 + r(10, 6)
  const ringed = ((h >>> 20) & 1) === 1
  const craters = [0, 1, 2].map((i) => {
    const k = hashString(name + ':' + i)
    return { x: orbX - orbR / 2 + (k % Math.round(orbR)), y: orbY - orbR / 2 + ((k >>> 8) % Math.round(orbR)), r: 2.5 + ((k >>> 16) % 5) }
  })
  const stars = [0, 1, 2, 3, 4].map((i) => {
    const k = hashString(name + ':star' + i)
    return { x: 6 + (k % 88), y: 6 + ((k >>> 8) % 30), r: 0.8 + ((k >>> 16) % 3) * 0.5 }
  })
  return (
    <svg className={className} style={TILE} width={size} height={size} viewBox="0 0 100 100" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${skyHue} 55% 16%)`} />
          <stop offset="1" stopColor={`hsl(${skyHue} 60% 6%)`} />
        </linearGradient>
        <radialGradient id={`${id}-orb`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor={`hsl(${hue} 95% 88%)`} />
          <stop offset="0.45" stopColor={`hsl(${hue} 80% 62%)`} />
          <stop offset="1" stopColor={`hsl(${hue} 70% 26%)`} />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx={orbX} cy={orbY} r={orbR} />
        </clipPath>
      </defs>
      <rect width="100" height="100" rx="8" fill={`url(#${id}-sky)`} />
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity="0.7" />
      ))}
      {ringed && (
        <ellipse cx={orbX} cy={orbY} rx={orbR * 1.7} ry={orbR * 0.45} fill="none" stroke={`hsl(${hue} 90% 75%)`} strokeWidth="3" opacity="0.55" transform={`rotate(-18 ${orbX} ${orbY})`} />
      )}
      <circle cx={orbX} cy={orbY} r={orbR} fill={`url(#${id}-orb)`} />
      <g clipPath={`url(#${id}-clip)`} fill={`hsl(${hue} 60% 30%)`} opacity="0.35">
        {craters.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={c.r} />
        ))}
      </g>
      <rect x="1" y="1" width="98" height="98" rx="7" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
    </svg>
  )
})
