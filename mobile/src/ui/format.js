// Numbers as the screens show them.
import { sol } from "../../../engine/src/flows.js";

/** Lamports (BigInt, number or string) as SOL text: 0.5, 0.25. */
export const solText = (lamports, digits = 2) => sol(BigInt(lamports ?? 0), digits);

/** 950, 12.3K, 4.56M, 1B: three significant digits at most. Rounds first, then picks the
 *  unit, so 999_999 is 1M and never 1000K. */
export function compact(n) {
  const r = Number(n.toPrecision(3));
  const units = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, u] of units) if (Math.abs(r) >= v) return `${Number((r / v).toPrecision(3))}${u}`;
  return String(r);
}

/** "1234.50" as "1,234.50": thousands separators by hand (Hermes' Intl may be missing). */
export const grouped = (fixed) => {
  const [int, frac] = fixed.split(".");
  return int.replace(/\B(?=(\d{3})+$)/g, ",") + (frac ? `.${frac}` : "");
};

/** Dollars: cents under 10k, compact above, 3 significant digits under $1. The minus sign
 *  goes before the $. Under a millionth of a dollar reads "<$0.000001" (never 1e-7). */
export function usd(n) {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 10_000) return `${sign}$${compact(a)}`;
  if (a >= 1) return `${sign}$${grouped(a.toFixed(2))}`;
  if (a === 0) return "$0";
  if (a < 1e-6) return n < 0 ? ">-$0.000001" : "<$0.000001";
  return `${sign}$${Number(a.toPrecision(3))}`;
}

/** HgZ9…5u8D */
export const shortWallet = (w) => (w && w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w ?? "");
