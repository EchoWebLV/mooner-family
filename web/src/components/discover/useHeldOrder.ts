import { useMemo, useRef, useState, type FocusEvent, type PointerEvent } from 'react'
import { holdOrder } from '@/lib/discover'
import type { Token } from '@/lib/types'

/** Goes on the element that holds the order: the table body. */
export interface HoldHandlers {
  onPointerEnter: () => void
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void
  onFocus: () => void
  onBlur: (e: FocusEvent<HTMLElement>) => void
}

/**
 * Holds a live-sorted list still while you point at it or move through it, so the row under your cursor stays put as
 * the numbers change. New coins join at the end, gone ones drop out, and the sort catches up when you leave.
 */
export function useHeldOrder(sorted: readonly Token[]): {
  rows: readonly Token[]
  held: boolean
  handlers: HoldHandlers
} {
  const [held, setHeld] = useState<readonly string[] | null>(null)
  const pointerIn = useRef(false)
  const focusIn = useRef(false)
  const rows = useMemo(() => holdOrder(sorted, held), [sorted, held])

  const sync = () => {
    const hold = pointerIn.current || focusIn.current
    const ids = sorted.map((t) => t.id)
    setHeld((h) => (hold ? (h ?? ids) : null))
  }

  const handlers: HoldHandlers = {
    onPointerEnter: () => {
      pointerIn.current = true
      sync()
    },
    onPointerLeave: (e) => {
      pointerIn.current = false
      // A focused row that drops out takes the focus with it, and no blur says so.
      if (!e.currentTarget.contains(document.activeElement)) focusIn.current = false
      sync()
    },
    onFocus: () => {
      focusIn.current = true
      sync()
    },
    onBlur: (e) => {
      focusIn.current = e.currentTarget.contains(e.relatedTarget)
      sync()
    },
  }

  return { rows, held: held !== null, handlers }
}
