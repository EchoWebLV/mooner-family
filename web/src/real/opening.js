// An open this site couldn't tell went through (flows.js: outcome unknown). Its coin is kept
// per wallet from before the open is signed (openKept), in localStorage so a reload or another
// tab still knows, and Create tries that coin again instead of making a new one: if the first
// open landed, a new coin would lock a second deposit. It clears when a try succeeds, when the
// program says the presale is already there (engine/src/opening.js alreadyOpen), when the
// presale shows up, when a first try plainly fails, or when the creator starts over
// (canStartOver). Storage can throw (private mode, a full quota) or be emptied under the page:
// every call here is caught, and a copy in memory, kept for as long as the page is open, stands
// in for it.

import { alreadyOpen } from "../../../engine/src/opening.js";
import { validSeat } from "../../../engine/src/client.js";

/** Where a wallet's record is kept. */
export const openingKey = (wallet) => `mooner:opening:${wallet}`;

const local = () => globalThis.localStorage;
const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, as a Solana address
const SYMBOL = /^[A-Za-z0-9]{1,10}$/; // what the server takes (api.js mint)

// as flows.js keeps session keys: every record saved here, read when storage has none for the
// wallet (it throws, or was emptied) or this page's last save didn't reach it. Another tab's
// clear of the coin drops it (forgetOpening, from that tab's storage event).
const kept = new Map(); // wallet -> record
const unsaved = new Set(); // wallets whose last save here didn't reach storage

/** { mint, presale, symbol, commit, at } from `r`, or null if it isn't one. `commit`: the
 *  lamports the first try put in, so a retry asks for the same. `at`: when an open of it was
 *  last signed (ms), or null if that isn't known. */
function coinOf(r) {
  if (!r || typeof r !== "object") return null;
  const { mint, presale, symbol, commit, at } = r;
  if (typeof mint !== "string" || !KEY.test(mint) || typeof presale !== "string" || !KEY.test(presale)) return null;
  if (typeof symbol !== "string" || !SYMBOL.test(symbol)) return null;
  if (!Number.isSafeInteger(commit) || commit <= 0) return null;
  return { mint, presale, symbol, commit, at: Number.isSafeInteger(at) && at > 0 ? at : null };
}

/** The coin kept for `wallet`, or null: none, broken JSON, another wallet's, or not a coin.
 *  From storage, or from memory when storage has none for the wallet (it throws, or was
 *  emptied) or this page's save didn't reach it. `storage` gives localStorage (tests pass
 *  their own). */
export function readOpening(wallet, storage = local) {
  if (!wallet) return null;
  if (!unsaved.has(wallet)) {
    try {
      const r = JSON.parse(storage().getItem(openingKey(wallet)) ?? "null");
      const c = r?.wallet === wallet ? coinOf(r) : null;
      if (c) return c;
    } catch {
      // no storage: the copy in memory
    }
  }
  return kept.get(wallet) ?? null;
}

/** Keeps `coin` for `wallet`, in storage and in memory. Returns the coin as kept (also when
 *  storage fails), or null if it isn't one. */
export function saveOpening(wallet, coin, storage = local) {
  const c = wallet ? coinOf(coin) : null;
  if (!c) return null;
  kept.set(wallet, c);
  try {
    storage().setItem(openingKey(wallet), JSON.stringify({ wallet, ...c }));
    unsaved.delete(wallet);
  } catch {
    // no storage: the copy in memory lasts as long as the page
    unsaved.add(wallet);
  }
  return c;
}

/** Drops `wallet`'s record if it is the coin of `presale`: a record for another coin (another
 *  tab's, written since) stays. */
export function clearOpening(wallet, presale, storage = local) {
  if (kept.get(wallet)?.presale === presale) {
    kept.delete(wallet);
    unsaved.delete(wallet);
  }
  try {
    const r = JSON.parse(storage().getItem(openingKey(wallet)) ?? "null");
    if (r?.presale === presale) storage().removeItem(openingKey(wallet));
  } catch {
    // no storage: nothing kept there
  }
}

/** Another tab removed `wallet`'s record (`removed`: its storage event's oldValue): this
 *  page's memory copy goes too if it is that coin, so that tab's Start over or success stands. */
export function forgetOpening(wallet, removed) {
  let r = null;
  try {
    r = JSON.parse(removed ?? "null");
  } catch {
    return;
  }
  if (r?.presale != null && kept.get(wallet)?.presale === r.presale) {
    kept.delete(wallet);
    unsaved.delete(wallet);
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

/** @typedef {{ mint: string, presale: string, symbol: string, commit: number, at: number | null }} Coin */

/** Runs `open` (it signs and sends the open of `coin`) with the coin kept for `wallet` from
 *  before anything is signed, as of `clock()`: a reload or a closed tab mid-open still finds
 *  it. `coin.at`: the record's, on a retry. Another coin kept for the wallet (another tab's,
 *  since this page read none) stays, and `coin` isn't opened: { ok: false, error, verdict:
 *  "other", kept }. Gives { ok: true, value } with the coin still kept (the store clears it as
 *  the presale shows), or { ok: false, error, verdict } (afterFailedOpen): "failed" clears it;
 *  "pending" keeps it, as of when the unknown was reported, or with the `at` it had if this try
 *  failed plainly (nothing from it can land); "open" leaves it to the store. Each of these
 *  writes only over this try's own save (or, for an unknown, none): another tab's since, a
 *  newer try of the coin or another coin, stands. A coin that can't be kept isn't opened.
 *  @returns {Promise<{ ok: true, value: any } | { ok: false, error: unknown, verdict: string, kept?: Coin }>} */
export async function openKept(wallet, coin, open, { pid = null, retrying = false, clock = Date.now, storage = local } = {}) {
  const there = readOpening(wallet, storage);
  if (there && there.presale !== coin.presale) {
    const error = new Error(`$${there.symbol} is still pending for this wallet, so $${coin.symbol} wasn't opened`);
    return { ok: false, error, verdict: "other", kept: there };
  }
  const at = clock();
  if (!saveOpening(wallet, { ...coin, at }, storage)) {
    return { ok: false, error: new Error("Couldn't keep the coin to open"), verdict: "failed" };
  }
  try {
    return { ok: true, value: await open() };
  } catch (error) {
    const verdict = afterFailedOpen(error, pid, retrying);
    const now = readOpening(wallet, storage);
    const own = now?.presale === coin.presale && now.at === at;
    // another tab's save since: this page's copy follows it, not this try's (a coin never sent,
    // or an older `at`), for when storage is emptied later
    if (!own && now) kept.set(wallet, now);
    if (verdict === "failed") {
      if (own) clearOpening(wallet, coin.presale, storage);
    } else if (verdict === "pending" && error?.outcomeUnknown === true) {
      if (own || !now) saveOpening(wallet, { ...coin, at: clock() }, storage);
    } else if (verdict === "pending") {
      if (own) saveOpening(wallet, coin, storage);
    }
    return { ok: false, error, verdict };
  }
}

/** The error the server sends with its 404 for a presale it has neither the account nor a
 *  record of (engine/server/api.js onePresale). */
export const NO_SUCH_PRESALE = "no such presale";

/** The one read before a retry (`read`: the server's view of the presale). "open": the
 *  server knows it, in any state, so an earlier open landed (it may have closed since, and a
 *  retry would then open the coin again). "retry": the server's own 404 (NO_SUCH_PRESALE),
 *  so it hasn't opened. "unknown": anything else, a 404 from a proxy or a wrong path too, so
 *  nothing can be told. */
export async function checkBeforeRetry(read) {
  try {
    return (await read()) ? "open" : "unknown";
  } catch (e) {
    return e?.status === 404 && e.body?.error === NO_SUCH_PRESALE ? "retry" : "unknown";
  }
}

/** An open's blockhash is good for about 150 blocks (about a minute); 5 minutes leaves a wide margin. */
export const START_OVER_MS = 5 * 60_000;

/** Whether the creator may leave `record` for a new coin: the read before this retry
 *  (checkBeforeRetry) got the server's own 404, and its open was last signed more than
 *  START_OVER_MS before `now`, so it can't land any more. */
export function canStartOver(record, read, now) {
  const at = record?.at;
  return read === "retry" && Number.isSafeInteger(at) && at > 0 && Number.isFinite(now) && now - at > START_OVER_MS;
}

/** The toast when the kept coin's presale shows up; `open`: it still takes SOL. */
export const openedNote = (symbol, open) => (open ? `$${symbol} presale is open. Share it to fill the pool.` : `$${symbol}'s presale is already done.`);

/** Whether the kept `commit` (lamports) still fits a creator's seat under /api/info's
 *  numbers `N` (BigInt), as openPresale checks before it signs (flows.js): "ok"; "over",
 *  more than a seat holds or than leaves room for one more; "off", under the least or off its
 *  steps. */
export function seatFit(commit, N) {
  const c = BigInt(commit);
  if (validSeat(c, N) && c <= N.TARGET - N.MIN_SEAT) return "ok";
  return c < N.MIN_SEAT || c % N.STEP !== 0n ? "off" : "over";
}

/** Whether a `presale:<key>` push shows the presale ("missing" until it's there). */
export const shows = (m) => m?.type === "snapshot" && m.data != null;
