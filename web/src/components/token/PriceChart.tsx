'use client'
// Market-cap candles, one minute each, from GeckoTerminal (spec §5.5). The store keeps candles in
// SOL per token; the chart shows market cap in USD, which is what traders read.
import {
  CandlestickSeries, ColorType, createChart, CrosshairMode, type CandlestickData, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import { SOL_USD, TOTAL_SUPPLY } from '@/lib/constants'
import { fmtCompact, fmtUsd } from '@/lib/format'
import { marketCapUsd, priceChange } from '@/lib/selectors'
import type { Candle, Token } from '@/lib/types'
import styles from './PriceChart.module.css'

function toBar(c: Candle): CandlestickData<UTCTimestamp> {
  const TO_MCAP_USD = TOTAL_SUPPLY * SOL_USD // SOL_USD follows Jupiter's price
  return {
    time: (c.t / 1000) as UTCTimestamp,
    open: c.o * TO_MCAP_USD,
    high: c.h * TO_MCAP_USD,
    low: c.l * TO_MCAP_USD,
    close: c.c * TO_MCAP_USD,
  }
}

/** Axis labels need more precision than the header's "$12.3K". */
function axisUsd(n: number): string {
  return '$' + fmtCompact(n, 2)
}

interface PriceChartProps {
  t: Token
  now: number
  className?: string
}

/** Mount with `key={t.id}`: the chart keeps its own copy of the candles it has drawn. */
export function PriceChart({ t, now, className }: PriceChartProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  // What the series holds, so a new tick only redraws the bars that changed.
  const drawn = useRef({ first: -1, count: 0 })

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const css = getComputedStyle(el)
    const color = (name: string) => css.getPropertyValue(name).trim()
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: color('--text-1'),
        fontFamily: color('--font-mono'),
        fontSize: 11,
      },
      grid: { vertLines: { color: color('--line') }, horzLines: { color: color('--line') } },
      rightPriceScale: { borderColor: color('--line') },
      timeScale: { borderColor: color('--line'), timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 9 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: color('--bg-3') },
        horzLine: { labelBackgroundColor: color('--bg-3') },
      },
      // Let a vertical swipe over the chart scroll the page on phones.
      handleScroll: { vertTouchDrag: false },
    })
    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: color('--up'),
      downColor: color('--down'),
      wickUpColor: color('--up'),
      wickDownColor: color('--down'),
      borderVisible: false,
      priceFormat: { type: 'custom', formatter: axisUsd, minMove: 1 },
    })
    drawn.current = { first: -1, count: 0 }
    return () => {
      seriesRef.current = null
      chart.remove()
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const candles = t.candles
    const first = candles[0]?.t ?? -1
    const prev = drawn.current
    if (prev.count === 0 || first !== prev.first || candles.length < prev.count) {
      // First draw, or the oldest candles were dropped (the list is capped): redraw all.
      series.setData(candles.map(toBar))
    } else {
      // The last drawn candle may have moved; anything after it is new.
      for (let i = prev.count - 1; i < candles.length; i++) series.update(toBar(candles[i]))
    }
    drawn.current = { first, count: candles.length }
  }, [t.candles])

  const mcap = fmtUsd(marketCapUsd(t))
  const change = priceChange(t, now)
  return (
    <section className={`panel ${styles.panel} ${className ?? ''}`} aria-labelledby="chart-title">
      <div className={styles.head}>
        <h2 id="chart-title" className="panel-title">
          Market cap
        </h2>
        <span className={styles.legend}>1 min candles · USD</span>
      </div>
      <div
        ref={boxRef}
        className={styles.box}
        role="img"
        aria-label={`Market cap chart in 1 minute candles. Now ${mcap}, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change * 100).toFixed(1)}% over 5 minutes.`}
      />
    </section>
  )
}
