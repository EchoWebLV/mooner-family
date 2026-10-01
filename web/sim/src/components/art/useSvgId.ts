import { useId } from 'react'

/** A document-unique id that is safe inside SVG `url(#…)` references. */
export function useSvgId(prefix: string): string {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, '')
}
