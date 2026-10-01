// Market data and trades for launched coins. Quotes, swaps and token balances are the
// engine's (engine/src/swap.js), the code the phone app trades with; a swap is a
// transaction Jupiter builds and the user's wallet signs and sends. Candles come from
// GeckoTerminal through engine/src/market.js; trades of a pool from GeckoTerminal and SOL/USD
// from Jupiter, here.
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js'
import type { Candle, Trade } from '@/lib/types'
import { geckoCandles } from '../../../engine/src/market.js'
import { explainSwap, quote as jupQuote, swap as jupSwap, tokenBalance as balanceOf, WSOL } from '../../../engine/src/swap.js'

export { WSOL }

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana'
const JUP = 'https://lite-api.jup.ag'

async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init)
  const json = await r.json().catch(() => null)
  if (!r.ok) throw new Error(json?.error ?? json?.errors?.[0]?.title ?? `${new URL(url).host} said ${r.status}`)
  return json
}

/** SOL in USD from Jupiter. */
export async function solUsd(): Promise<number> {
  const j = await getJson(`${JUP}/price/v3?ids=${WSOL}`)
  const v = Number(j?.[WSOL]?.usdPrice)
  if (!(v > 0)) throw new Error('no SOL price')
  return v
}

/** One-minute candles in SOL per token, oldest first, one per minute. */
export const candlesOf = (pool: string, limit = 300): Promise<Candle[]> => geckoCandles(pool, { limit })

/** Recent trades, oldest first. `userId` is the trader's wallet. */
export async function tradesOf(pool: string, mint: string): Promise<{ trades: Trade[]; volumeUsd: number }> {
  const j = await getJson(`${GECKO}/pools/${pool}/trades`)
  const rows: { attributes: Record<string, string> }[] = j?.data ?? []
  let volumeUsd = 0
  const trades = rows.map(({ attributes: a }) => {
    const buy = a.kind === 'buy'
    // a buy spends SOL (from) for the token (to); a sell the other way round
    const sol = Number(buy ? a.from_token_amount : a.to_token_amount)
    const tokens = Number(buy ? a.to_token_amount : a.from_token_amount)
    volumeUsd += Number(a.volume_in_usd) || 0
    return {
      id: a.tx_hash,
      at: Date.parse(a.block_timestamp),
      userId: a.tx_from_address,
      side: buy ? 'buy' : 'sell',
      sol,
      tokens,
      price: tokens > 0 ? sol / tokens : 0,
    } satisfies Trade
  })
  void mint
  return { trades: trades.sort((a, b) => a.at - b.at), volumeUsd }
}

type EngineQuote = Awaited<ReturnType<typeof jupQuote>>

export interface Quote {
  inAmount: string
  outAmount: string
  priceImpactPct: string
  raw: EngineQuote
}

/** A Jupiter quote: `amount` in the input's smallest units. No route throws "no route for
 *  this trade yet". */
export async function quote(inputMint: string, outputMint: string, amount: bigint, slippageBps = 300): Promise<Quote> {
  const q = await jupQuote({ input: inputMint, output: outputMint, amount, slippageBps })
  return { inAmount: String(q.inAmount), outAmount: String(q.outAmount), priceImpactPct: String(q.impact), raw: q }
}

type SendTx = (tx: VersionedTransaction, conn: Connection) => Promise<string>

/** Builds the swap for a quote, checks the wallet is its only signer, has the wallet sign and
 *  send it, and waits for it against Jupiter's blockhash. Errors are in plain words. */
export async function swap(q: Quote, user: PublicKey, conn: Connection, sendTransaction: SendTx): Promise<string> {
  try {
    // engine/src is plain JS: its optional signer params read as null to TypeScript
    return await jupSwap({ quote: q.raw, wallet: user, conn, sendTransaction: sendTransaction as never })
  } catch (e) {
    throw new Error(explainSwap(e))
  }
}

/** The wallet's balance of a mint in its associated token account, the account a Jupiter
 *  swap sells from (either token program). */
export async function tokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<{ ui: number; raw: bigint; decimals: number }> {
  return balanceOf(conn, owner, mint)
}
