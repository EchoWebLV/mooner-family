'use client'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
}

interface TabsProps<T extends string> {
  items: readonly TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Accessible name of the tab list. */
  label: string
  /** Gives each tab an id (`<idPrefix>-tab-<id>`) so its panel can point back at it. */
  idPrefix?: string
  className?: string
}

export function tabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`
}

/** ARIA tabs: arrow keys, Home and End move between them. */
export function Tabs<T extends string>({ items, value, onChange, label, idPrefix, className }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((it) => it.id === value)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(items[next].id)
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={`tabs ${className ?? ''}`} onKeyDown={onKeyDown}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          id={idPrefix ? tabId(idPrefix, it.id) : undefined}
          className="tab"
          aria-selected={it.id === value}
          tabIndex={it.id === value ? 0 : -1}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
