// next/image as a plain <img>.
import type { ImgHTMLAttributes } from 'react'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string }
  priority?: boolean
  quality?: number
  unoptimized?: boolean
  placeholder?: string
  fill?: boolean
}

export default function Image({ src, priority, quality, unoptimized, placeholder, fill, style, ...rest }: Props) {
  void quality
  void unoptimized
  void placeholder
  const s = fill ? { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', ...style } : style
  return <img src={typeof src === 'string' ? src : src.src} loading={priority ? 'eager' : 'lazy'} decoding="async" style={s} {...rest} />
}
