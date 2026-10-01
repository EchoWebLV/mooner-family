// What the room's share button sends: a line about the presale, how much is in, and its link.
// Android's share sheet takes text only (react-native Share.js passes `title` and `message`,
// not `url`), so the link ends the message. Plain functions, so Node tests run them.
import { shareLink } from "../../../engine/src/refs.js";
import { seatOf, secondsLeft, stageOf } from "../../../engine/src/views.js";
import { solText } from "../ui/format.js";

/** The first line, by stage and by who shares: the creator, someone in it, anyone else. */
function headline(stage, coin, who) {
  if (stage === "presale") {
    if (who === "creator") return coin ? `My ${coin} presale is open on Mooner.` : "My presale is open on Mooner.";
    if (who === "in") return coin ? `I'm in the ${coin} presale on Mooner.` : "I'm in this presale on Mooner.";
    return coin ? `The ${coin} presale is open on Mooner.` : "This presale is open on Mooner.";
  }
  if (stage === "launching") return coin ? `${coin} is launching on Mooner.` : "This presale is launching on Mooner.";
  if (stage === "live" || stage === "migrated") return coin ? `${coin} is live on Mooner.` : "This coin is live on Mooner.";
  return coin ? `The ${coin} presale on Mooner has closed.` : "This presale on Mooner has closed.";
}

/** { title, message } for sharing presale `view` (a list or a detail view). `launched`: its
 *  launched row or undefined. `wallet`: the connected wallet (base58) or null; the link then
 *  carries `?ref=<wallet>`. `N`: info.N. `base`: config.js BASE. `now`: ms. null while the
 *  presale is OPEN past its deadline: no one can join it, and it hasn't launched or closed
 *  yet, so there is nothing true to say; the room shows no Share button then. */
export function shareOf({ view, launched, wallet, N, base, now }) {
  const coin = view.token?.symbol ? `$${view.token.symbol}` : null;
  const stage = stageOf(view, launched);
  if (stage === "presale" && secondsLeft(view, now) <= 0) return null;
  const who = !wallet ? null
    : view.creator === wallet ? "creator"
    : seatOf(view, wallet) || view.users?.some((u) => u.user === wallet) ? "in"
    : null;
  const lines = [headline(stage, coin, who)];
  if (stage === "presale") lines.push(`${solText(view.raised)} of ${solText(N.TARGET)} SOL in so far.`);
  lines.push(shareLink(base, view.presale, wallet));
  return { title: coin ? `${coin} on Mooner` : "A presale on Mooner", message: lines.join("\n") };
}
