// Market data and trades for launched coins, from public APIs the browser can call:
// GeckoTerminal (candles and trades of a pool), Jupiter (SOL price, quotes and swaps).
// A swap is a transaction Jupiter builds and the user's wallet signs and sends.
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js'
import type { Candle, Trade } from '@/lib/types'

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana'
const JUP = 'https://lite-api.jup.ag'
export const WSOL = 'So11111111111111111111111111111111111111112'
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
const SPL_TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

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
export async function candlesOf(pool: string, limit = 300): Promise<Candle[]> {
  const j = await getJson(`${GECKO}/pools/${pool}/ohlcv/minute?aggregate=1&limit=${limit}&currency=token`)
  const list: number[][] = j?.data?.attributes?.ohlcv_list ?? []
  const sorted = list.map(([ts, o, h, l, c]) => ({ t: ts * 1000, o, h, l, c })).sort((a, b) => a.t - b.t)
  // GeckoTerminal can list a minute twice; the chart needs strictly rising times
  const out: Candle[] = []
  for (const c of sorted) {
    const last = out[out.length - 1]
    if (last && last.t === c.t) out[out.length - 1] = { t: c.t, o: last.o, h: Math.max(last.h, c.h), l: Math.min(last.l, c.l), c: c.c }
    else out.push(c)
  }
  return out
}

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

export interface Quote {
  inAmount: string
  outAmount: string
  priceImpactPct: string
  raw: unknown
}

/** A Jupiter quote: `amount` in the input's smallest units. */
export async function quote(inputMint: string, outputMint: string, amount: bigint, slippageBps = 300): Promise<Quote> {
  const u = `${JUP}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
  const j = await getJson(u)
  if (!j?.outAmount) throw new Error('no route for this trade yet')
  return { inAmount: j.inAmount, outAmount: j.outAmount, priceImpactPct: j.priceImpactPct, raw: j }
}

type SendTx = (tx: VersionedTransaction, conn: Connection) => Promise<string>

/** Builds the swap for a quote, has the wallet sign and send it, and waits for it. */
export async function swap(q: Quote, user: PublicKey, conn: Connection, sendTransaction: SendTx): Promise<string> {
  const j = await getJson(`${JUP}/swap/v1/swap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: q.raw,
      userPublicKey: user.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  })
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(j.swapTransaction), (c) => c.charCodeAt(0)))
  const sig = await sendTransaction(tx, conn)
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
  const r = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  if (r.value.err) throw new Error('the swap failed on chain')
  return sig
}

/** The wallet's balance of a mint, in whole tokens (both token programs). */
export async function tokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<{ ui: number; raw: bigint; decimals: number }> {
  let raw = 0n
  let decimals = 6
  for (const programId of [TOKEN_2022, SPL_TOKEN]) {
    const r = await conn.getParsedTokenAccountsByOwner(owner, { programId })
    for (const a of r.value) {
      const info = a.account.data.parsed?.info
      if (info?.mint !== mint.toBase58()) continue
      raw += BigInt(info.tokenAmount.amount)
      decimals = info.tokenAmount.decimals
    }
  }
  return { ui: Number(raw) / 10 ** decimals, raw, decimals }
}
