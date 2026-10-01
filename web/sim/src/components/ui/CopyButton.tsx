'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

interface CopyButtonProps {
  /** Text to copy. A path starting with "/" is copied as a full URL on this site. */
  value: string
  /** Accessible name, e.g. "Copy contract address". */
  label: string
  className?: string
  children?: ReactNode
}

export function CopyButton({ value, label, className, children }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(id)
  }, [copied])

  const copy = async () => {
    const text = value.startsWith('/') ? new URL(import.meta.env.BASE_URL.replace(/\/$/, '') + value, window.location.origin).toString() : value
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard blocked (permissions or an insecure origin): let the user copy it by hand.
      window.prompt(label, text)
    }
  }

  return (
    <button type="button" className={className ?? 'btn btn-ghost btn-sm'} onClick={copy} aria-label={label} title={label}>
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      {children}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}
