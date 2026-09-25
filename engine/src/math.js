// The program's money math (programs/presale/src/util.rs), for checking results and
// showing users what they get. BigInt lamports / raw token units.

import { TX_FEE, numbers } from "./consts.js";

export const validSeat = (amount, canary = false) => {
  const n = numbers(canary);
  return amount >= n.MIN_SEAT && amount <= n.MAX_SEAT && amount % n.STEP === 0n;
};

/** New commit after the room cut; null when there's no room for a raise. */
export function cutToRoom(amount, current, others, canary = false) {
  const t = numbers(canary).TARGET;
  const room = t > others ? t - others : 0n;
  if (amount <= current || amount <= room) return amount;
  if (room === 0n) return null;
  return room;
}

export const feeShare = (sameTag) => TX_FEE / (sameTag > 0n ? sameTag : 1n);

export function failedRefund(commit, feesPaid, settledSum) {
  if (settledSum === 0n) return commit;
  const share = (feesPaid * commit + settledSum - 1n) / settledSum;
  return commit > share ? commit - share : 0n;
}

export function tokenShare(total, claimed, commit, raised, last) {
  if (last) return total > claimed ? total - claimed : 0n;
  return (total * commit) / (raised > 0n ? raised : 1n);
}
