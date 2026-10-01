// The coin screen's chart as plain numbers (no React Native, so Node tests run it): a line
// through the candles' closes, the pool's live price last, scaled into a box.

/** Points { t (ms), p (SOL per token) } oldest first: each candle's close, then the live
 *  price `live` at `nowMs` when there is one and it's newer than the last candle. */
export function pointsOf(candles, live, nowMs) {
  const pts = (candles ?? []).map((c) => ({ t: c.t, p: c.c }));
  if (live > 0 && (!pts.length || nowMs > pts[pts.length - 1].t)) pts.push({ t: nowMs, p: live });
  return pts;
}

const r1 = (n) => Math.round(n * 10) / 10;

/** SVG paths through `pts` in a `w`×`h` box, `pad` px in from the top and bottom: { line,
 *  area, lo, hi, change } (change: last / first - 1), or null with fewer than 2 points. x
 *  follows time, y the price; a price that never moved draws mid-box. */
export function chartPath(pts, w, h, pad = 4) {
  if (pts.length < 2) return null;
  const t0 = pts[0].t;
  const span = pts[pts.length - 1].t - t0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const { p } of pts) {
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  }
  const x = (t) => (span > 0 ? ((t - t0) / span) * w : w);
  const y = (p) => (hi === lo ? h / 2 : pad + (1 - (p - lo) / (hi - lo)) * (h - 2 * pad));
  const line = pts.map((q, i) => `${i ? "L" : "M"}${r1(x(q.t))} ${r1(y(q.p))}`).join(" ");
  return { line, area: `${line} L${r1(w)} ${h} L0 ${h} Z`, lo, hi, change: pts[pts.length - 1].p / pts[0].p - 1 };
}

/** "+12.3%", "-4.56%", "0%": a change as a signed percent, 3 significant digits. Under
 *  0.01% either way reads "0%": a candle's close and the pool's own price can differ in their
 *  last digits, and that's no move (nor "+3.6e-9%"). */
export function changeText(change) {
  const pct = Number((change * 100).toPrecision(3));
  if (Math.abs(pct) < 0.01) return "0%";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** "Last 5 h", "Last 40 min": how much time the chart covers, from its first point to now. */
export function spanText(fromMs, nowMs) {
  const min = Math.max(1, Math.round((nowMs - fromMs) / 60_000));
  return min < 120 ? `Last ${min} min` : `Last ${Math.round(min / 60)} h`;
}

/** Where the candles come from, for the line under the chart. */
export const SOURCES = { geckoterminal: "GeckoTerminal", meteora: "Meteora", mooner: "Mooner's server" };
