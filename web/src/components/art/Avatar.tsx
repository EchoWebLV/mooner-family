'use client'

import { memo } from 'react'
import { useApp } from '@/components/world/WorldProvider'
import { handlePfp } from '@/lib/pfp/traits'
import { userByHandle } from '@/lib/selectors'
import { MoonerPic } from './MoonerPic'

interface AvatarProps {
  handle: string
  size?: number
  className?: string
}

/** A player's Mooner, looked up by handle; a handle with no player gets a steady one of its own. */
export const Avatar = memo(function Avatar({ handle, size = 24, className }: AvatarProps) {
  const pfp = useApp((s) => userByHandle(s.world, handle)?.pfp) ?? handlePfp(handle)
  return <MoonerPic pfp={pfp} size={size} className={className} />
})
