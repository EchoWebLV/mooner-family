// The coin screen's chart as plain numbers (no React Native, so Node tests run it): a line
// through the candles' closes, the pool's live price last, scaled into a box.

/** A point to draw: its time and price are numbers and the price is above 0. A close that
 *  isn't one (null is JSON's NaN) would draw "NaN" into the path, which react-native-svg
 *  throws on, or a 0 that isn't a price. */
const drawable = (q) => Number.isFinite(q.t) && Number.isFinite(q.p) && q.p > 0;
/** A field as a number; missing or null is none (Number(null) is 0, a time in 1970). */
const num = (v) => (v == null ? NaN : Number(v));

/** Points { t (ms), p (SOL per token) } oldest first, whatever order the candles came in:
 *  each candle's close that's a price, then the live price `live` at `nowMs` when there is
 *  one and it's newer than the last candle. */
export function pointsOf(candles, live, nowMs) {
  const pts = (candles ?? [])
    .map((c) => ({ t: num(c?.t), p: num(c?.c) }))
    .filter(drawable)
    .sort((a, b) => a.t - b.t);
  const now = { t: num(nowMs), p: num(live) };
  if (drawable(now) && (!pts.length || now.t > pts[pts.length - 1].t)) pts.push(now);
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

/** A change (last / first - 1) in percent as the chart's header shows it, 3 significant
 *  digits: its text and its color both follow this. Under 0.01% either way is 0: a candle's
 *  close and the pool's own price can differ in their last digits, and that's no move (nor
 *  "+3.6e-9%"). null when the change isn't a number. */
export function pctOf(change) {
  if (!Number.isFinite(change)) return null;
  const pct = Number((change * 100).toPrecision(3));
  return Math.abs(pct) < 0.01 ? 0 : pct;
}

/** "+12.3%", "-4.56%", "0%": a change as a signed percent (pctOf), or null when it isn't a
 *  number. */
export function changeText(change) {
  const pct = pctOf(change);
  if (pct == null) return null;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** "Last 5 h", "Last 40 min": how much time the chart covers, from its first point to now. */
export function spanText(fromMs, nowMs) {
  const min = Math.max(1, Math.round((nowMs - fromMs) / 60_000));
  return min < 120 ? `Last ${min} min` : `Last ${Math.round(min / 60)} h`;
}

/** What the chart's box says while it has no line: `missing`, the server has no stats for
 *  this coin; `stats`, its stats (fewer than 2 prices in them); `error`, the last read's
 *  words. */
export function emptyChartText({ missing, stats, error }) {
  if (missing) return "No chart for this coin";
  if (stats) return "The chart starts with the first trades";
  return error ? "No chart right now" : "Loading the chart";
}

/** Where the candles come from, for the line under the chart. */
export const SOURCES = { geckoterminal: "GeckoTerminal", meteora: "Meteora", mooner: "Mooner's server" };
