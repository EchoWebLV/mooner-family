// Auto-join: pick an amount once, and the app picks the fullest presale with room for it.
// Every join still needs the wallet's approval: this only picks. Pure; views are the
// server's wire form (amounts as strings) or BigInt, as views.js takes them.
import { joinCheck, roomOf, seatChoices, secondsLeft } from "./views.js";

/** A presale this close to its end isn't picked: the wallet's approval would come too late. */
export const AUTOJOIN_MIN_LEFT_S = 30;

/** The amounts Auto-join offers: the join sheet's seats that can ever fit. The creator
 *  always has at least MIN_SEAT in, so a seat over TARGET - MIN_SEAT never has room. */
export function autoChoices(N) {
  const most = BigInt(N.TARGET) - BigInt(N.MIN_SEAT);
  return seatChoices(N).filter((a) => a <= most);
}

/** Whether `wallet` can join `view` now with `amount` lamports (BigInt or a string): it takes
 *  joins (joinCheck), it has at least AUTOJOIN_MIN_LEFT_S left, and its room is at least
 *  `amount`, so the whole amount goes in. */
export function hasRoomFor(view, N, amount, wallet, nowMs) {
  if (!joinCheck(view, wallet, N, nowMs).ok) return false;
  if (secondsLeft(view, nowMs) < AUTOJOIN_MIN_LEFT_S) return false;
  return roomOf(view, N) >= BigInt(amount);
}

/** The fullest presale with room for `amount`: the least room left, then the nearest end.
 *  Only presales with a coin (`token`). null when none has room. */
export function pickFullest(views, N, amount, wallet, nowMs) {
  const fits = views.filter((v) => v.token && hasRoomFor(v, N, amount, wallet, nowMs));
  fits.sort((a, b) => {
    const d = roomOf(a, N) - roomOf(b, N);
    return d !== 0n ? (d < 0n ? -1 : 1) : Number(a.deadlineTs ?? 0) - Number(b.deadlineTs ?? 0);
  });
  return fits[0] ?? null;
}

/** The seat a `?join=<lamports>` link asks for: one of seatChoices(N) as BigInt, else null. */
export function startOf(param, N) {
  if (typeof param !== "string" || !/^\d{1,16}$/.test(param)) return null;
  const v = BigInt(param);
  return seatChoices(N).find((c) => c === v) ?? null;
}
