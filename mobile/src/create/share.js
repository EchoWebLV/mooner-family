// The words a new presale is shared with right after it opens: piece 3's share text
// (room/share.js shareOf), with the creator's wallet as ref. The view is made from the open
// itself, since the feed's snapshot may not have reached the phone yet. Plain functions, so
// Node tests run them.
import { BASE } from "../config.js";
import { shareOf } from "../room/share.js";

/** { title, message } for presale `key`, just opened by `wallet` for coin `symbol` with
 *  `commit` (BigInt lamports), or null (shareOf's rule). `N`: info.N; `now`: ms. */
export function newPresaleShare({ key, symbol, wallet, commit, N, now }) {
  const view = {
    presale: key,
    state: "OPEN",
    creator: wallet,
    raised: String(commit),
    token: { symbol },
    deadlineTs: Math.floor(now / 1000) + Number(N.DURATION),
  };
  return shareOf({ view, launched: undefined, wallet, N, base: BASE, now });
}
