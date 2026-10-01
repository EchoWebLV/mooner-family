import { useCallback } from 'react'
import { useApp } from '@/components/world/WorldProvider'
import { QUICK_BUY_SOL } from '@/lib/constants'
import { fmtCompact, fmtSolAmount } from '@/lib/format'
import type { Token } from '@/lib/types'

/** The ⚡ buttons on Pulse and Discover: buys QUICK_BUY_SOL of a coin and says how it went. */
export function useQuickBuy(): (t: Token) => void {
  const buy = useApp((s) => s.buy)
  const notify = useApp((s) => s.notify)
  return useCallback(
    async (t: Token) => {
      const r = await buy(t.id, QUICK_BUY_SOL)
      if (r.ok) notify('good', `Bought ${fmtCompact(r.tokens)} $${t.ticker} for ${fmtSolAmount(r.sol)} SOL`, `/token/${t.id}`)
      else notify('bad', r.error)
    },
    [buy, notify],
  )
}
