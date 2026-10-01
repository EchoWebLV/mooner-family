// Numbers as the screens show them.
import { sol } from "../../../engine/src/flows.js";

/** Lamports (BigInt, number or string) as SOL text: 0.5, 0.25. */
export const solText = (lamports, digits = 2) => sol(BigInt(lamports ?? 0), digits);

/** 950, 12.3K, 4.56M, 1B: three significant digits at most. */
export function compact(n) {
  const units = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, u] of units) if (Math.abs(n) >= v) return `${Number((n / v).toPrecision(3))}${u}`;
  return String(Number(n.toPrecision(3)));
}

/** Dollars: cents under 10k, compact above, 3 significant digits under $1. */
export function usd(n) {
  if (Math.abs(n) >= 10_000) return `$${compact(n)}`;
  if (Math.abs(n) >= 1) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${Number(n.toPrecision(3))}`;
}

/** HgZ9…5u8D */
export const shortWallet = (w) => (w && w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w ?? "");
