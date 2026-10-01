'use client'
import { usePathname } from 'next/navigation'
import { LevelUpOverlay } from '@/components/badges/LevelUpOverlay'
import { useApp } from '@/components/world/WorldProvider'

/** Plays queued level-ups one at a time. */
export function LevelUpHost() {
  const levelUp = useApp((s) => s.levelUps[0])
  const dismiss = useApp((s) => s.dismissLevelUp)
  const pathname = usePathname()
  if (!levelUp) return null
  // A launch you're watching finishes its own sequence first (spec §5.3): the overlay
  // waits until the presale page hands over to the token page.
  if (levelUp.tokenId && pathname === `/presale/${levelUp.tokenId}`) return null
  return <LevelUpOverlay key={levelUp.id} levelUp={levelUp} onDismiss={dismiss} />
}
