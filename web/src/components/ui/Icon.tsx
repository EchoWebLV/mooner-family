import type { ReactNode } from 'react'

export type IconName =
  | 'alert' | 'arrow-right' | 'at' | 'bolt' | 'chat' | 'check' | 'chevrons-right' | 'clock' | 'close' | 'copy'
  | 'crown' | 'globe' | 'info' | 'lock' | 'moon' | 'plus' | 'rocket' | 'search' | 'send' | 'users' | 'wallet' | 'x'

// Simple 24×24 stroke icons drawn for Mooner, plus the X mark (filled, from Simple Icons, CC0) for links to X.
const PATHS: Record<IconName, ReactNode> = {
  alert: (
    <>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4M12 17.5h.01" />
    </>
  ),
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  at: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </>
  ),
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  'chevrons-right': <path d="M6 7l5 5-5 5M13 7l5 5-5 5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  crown: <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  // Filled: the brand mark.
  moon: <path fill="currentColor" stroke="none" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  rocket: (
    <>
      <path d="M12 2c3 2.4 4.5 5.8 4.5 10.2L14.5 16h-5l-2-3.8C7.5 7.8 9 4.4 12 2z" />
      <circle cx="12" cy="9" r="1.5" />
      <path d="M7.6 12.6L5 15.5 6 19l3.5-3M16.4 12.6L19 15.5 18 19l-3.5-3M10.5 19l1.5 3 1.5-3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  send: (
    <>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h13v4" />
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M16 13.5h2" />
    </>
  ),
  x: (
    <path
      fill="currentColor"
      stroke="none"
      d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
    />
  ),
}

interface IconProps {
  name: IconName
  size?: number
  className?: string
}

/** Decorative: pair it with visible text or an aria-label on the control. */
export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
