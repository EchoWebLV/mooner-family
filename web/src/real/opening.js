// An open this site couldn't tell went through (flows.js: outcome unknown). Its coin is kept
// per wallet, in localStorage too so a reload or another tab still knows, and Create tries
// that coin again instead of making a new one: if the first open landed, a new coin would
// lock a second deposit. It clears when a try succeeds, when the program says the presale is
// already there (engine/src/opening.js alreadyOpen), or when the presale shows up. Storage
// can throw (private mode): every call here is caught, and the store keeps its own copy.

import { alreadyOpen } from "../../../engine/src/opening.js";

/** Where a wallet's record is kept. */
export const openingKey = (wallet) => `mooner:opening:${wallet}`;

const local = () => globalThis.localStorage;
const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, as a Solana address
const SYMBOL = /^[A-Za-z0-9]{1,10}$/; // what the server takes (api.js mint)

/** { mint, presale, symbol, commit } from `r`, or null if it isn't one. `commit`: the
 *  lamports the first try put in, so a retry asks for the same. */
function coinOf(r) {
  if (!r || typeof r !== "object") return null;
  const { mint, presale, symbol, commit } = r;
  if (typeof mint !== "string" || !KEY.test(mint) || typeof presale !== "string" || !KEY.test(presale)) return null;
  if (typeof symbol !== "string" || !SYMBOL.test(symbol)) return null;
  if (!Number.isSafeInteger(commit) || commit <= 0) return null;
  return { mint, presale, symbol, commit };
}

/** The coin kept for `wallet`, or null: none, broken JSON, another wallet's, not a coin, or
 *  no storage. `storage` gives localStorage (tests pass their own). */
export function readOpening(wallet, storage = local) {
  if (!wallet) return null;
  try {
    const r = JSON.parse(storage().getItem(openingKey(wallet)) ?? "null");
    return r?.wallet === wallet ? coinOf(r) : null;
  } catch {
    return null;
  }
}

/** Keeps `coin` for `wallet`. Returns the coin as kept (also when storage fails: the store
 *  still holds it), or null if it isn't one. */
export function saveOpening(wallet, coin, storage = local) {
  const c = wallet ? coinOf(coin) : null;
  if (!c) return null;
  try {
    storage().setItem(openingKey(wallet), JSON.stringify({ wallet, ...c }));
  } catch {
    // no storage: it lasts as long as the page
  }
  return c;
}

export function clearOpening(wallet, storage = local) {
  try {
    storage().removeItem(openingKey(wallet));
  } catch {
    // no storage: nothing was kept
  }
}

/** What a failed open means for the coin; `retrying`: it was a retry of the kept coin.
 *  "open": the program says the presale is there, so an earlier open landed (clear it, go
 *  to the presale). "pending": it may have landed (outcome unknown), or a retry failed some
 *  other way (keep it). "failed": a first try that plainly failed (nothing to keep). */
export function afterFailedOpen(e, pid, retrying) {
  if (alreadyOpen(e, pid)) return "open";
  return retrying || e?.outcomeUnknown === true ? "pending" : "failed";
}

/** The one read before a retry (`read`: the server's view of the presale). "open": the
 *  server knows it, in any state, so an earlier open landed (it may have closed since, and a
 *  retry would then open the coin again). "retry": a 404, so it never opened. "unknown": the
 *  read failed, so nothing can be told. */
export async function checkBeforeRetry(read) {
  try {
    return (await read()) ? "open" : "unknown";
  } catch (e) {
    return e?.status === 404 ? "retry" : "unknown";
  }
}

/** Whether a `presale:<key>` push shows the presale ("missing" until it's there). */
export const shows = (m) => m?.type === "snapshot" && m.data != null;
