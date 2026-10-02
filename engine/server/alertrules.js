// What a push alert says, and when one is due: pure rules over the presale views and launched
// rows the live feed reads (feed.js), in their wire form (amounts and keys as strings, as
// JSON.parse(toJson(v)) gives them). alerts.js keeps the state, picks who gets what, and sends.
import { sol } from "../src/flows.js";
import { marketCapSol, whoIsIn } from "../src/views.js";

/** Push alerts' numbers, in one place so they're easy to change. This file uses the first
 *  two; alerts.js uses the rest. */
export const ALERT_NUMBERS = {
  /** The market caps (US dollars) a coin's holders hear about, each once per coin, ever. */
  milestones: [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000],
  /** An open, a fill or a launch older than this (by the chain's clock or the server's) is
   *  not news: a server that was down, or a presale seen for the first time, sends nothing. */
  freshMs: 30 * 60_000,
  /** Pushes a phone gets an hour; past that, alerts are only listed ("room" doesn't count). */
  quietMax: 20,
  /** How long follow alerts for one presale gather before they go as one push. */
  groupMs: 10_000,
  /** Alerts kept per wallet: the Alerts screen's list. */
  maxAlerts: 100,
  /** Phones per wallet; signing in on a sixth drops the one updated longest ago. */
  maxDevices: 5,
};
export const MILESTONES = ALERT_NUMBERS.milestones;
export const FRESH_MS = ALERT_NUMBERS.freshMs;

const fresh = (ms, nowMs) => ms > 0 && nowMs - ms <= FRESH_MS;
const tickerOf = (view) => (view.token?.symbol ? `$${view.token.symbol}` : "a new coin");

/** "HgZ9…5u8D", as the phone shows a wallet. */
export const shortWallet = (w) => (w && w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w ?? "");

/** "$100K", "$1M", "$1.2M": three significant digits at most, as the phone's compact(). */
export function usdShort(n) {
  const r = Number(n.toPrecision(3));
  for (const [v, u] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (r >= v) return `$${Number((r / v).toPrecision(3))}${u}`;
  return `$${r}`;
}

/** The wallets in a presale (a seat with SOL in the pool). */
export const insOf = (view) => whoIsIn(view).map((r) => r.user);

/**
 * What changed in a presale since `prev` ({ ins: [wallets] } as last seen, or null for one
 * never seen): { ins, events }. `ins` is who's in now, to keep for next time. Events:
 *   { kind: "opened", presale, user, ticker }            a fresh open; user: the creator
 *   { kind: "join", presale, user, commit, creator, ticker }  someone put SOL in
 *   { kind: "filled", presale, to, ticker }              the pool filled (to: who's in)
 *   { kind: "launched", presale, to, ticker }            the coin launched
 *   { kind: "arrived", presale, user, ticker }           a seat's tokens were delivered
 * A presale seen for the first time and not freshly opened sends nothing: what's in it now is
 * the baseline. A stale view (the server couldn't read the ER) changes nothing.
 */
export function presaleEvents(prev, view, nowMs) {
  if (view.stale) return { ins: prev?.ins ?? [], events: [] };
  const presale = view.presale;
  const ticker = tickerOf(view);
  const ins = insOf(view);
  const creator = view.creator ?? view.token?.creator ?? null;
  const events = [];
  const openedFresh = !prev && view.state === "OPEN" && fresh(Number(view.openedTs ?? 0) * 1000, nowMs);
  if (openedFresh && creator) events.push({ kind: "opened", presale, user: creator, ticker });

  // joins: while seats can still come in, the wallets in now that weren't before
  if (["OPEN", "FULL", "LAUNCHING"].includes(view.state) && (prev || openedFresh)) {
    const before = new Set(prev?.ins ?? []);
    for (const r of whoIsIn(view)) {
      if (before.has(r.user) || r.user === creator) continue;
      events.push({ kind: "join", presale, user: r.user, commit: String(r.commit), creator, ticker });
    }
  }

  const all = [...new Set([...(prev?.ins ?? []), ...ins])];
  if (["FULL", "LAUNCHING"].includes(view.state) && !view.launch && fresh(Number(view.fullTs ?? 0) * 1000, nowMs)) {
    events.push({ kind: "filled", presale, to: all, ticker });
  }
  if (view.launch && fresh(Number(view.launch.at ?? 0), nowMs)) {
    events.push({ kind: "launched", presale, to: all, ticker });
    // after a launch a seat closes only when its tokens are delivered (claim)
    const now = new Set(ins);
    for (const user of prev?.ins ?? []) if (!now.has(user)) events.push({ kind: "arrived", presale, user, ticker });
  }
  return { ins, events };
}

/** A launched row's market cap in US dollars, or null without a pool or a SOL price. */
export function mcapUsd(row, solUsd) {
  if (!row?.pool?.sqrtPrice || !(solUsd > 0)) return null;
  return marketCapSol(row.pool.sqrtPrice) * solUsd;
}

/** The milestones `usd` reaches that aren't in `had` yet, lowest first. */
export const milestonesPassed = (had, usd) => MILESTONES.filter((m) => usd >= m && !had.includes(m));

/** Whether a launched row's launch is recent enough for its first milestones to be news. */
export const launchFresh = (row, nowMs) => fresh(Number(row?.launch?.at ?? 0), nowMs);

// ---- the words ----

/** { title, body, url } for an alert. `e` is a presaleEvents event (or a milestone, a room,
 *  a group of follows); see each case. */
export function alertText(kind, e) {
  const room = `/presale/${e.presale}`;
  switch (kind) {
    case "filled":
      return { title: `${e.ticker} filled`, body: "The pool is full. It launches in a moment.", url: room };
    case "launched":
      return { title: `${e.ticker} launched`, body: "It's live on Solana. Your tokens are on the way.", url: `/coin/${e.presale}` };
    case "arrived":
      return { title: `Your ${e.ticker} arrived`, body: "Your tokens are in your wallet.", url: `/coin/${e.presale}` };
    case "joined":
      return { title: `${shortWallet(e.user)} joined ${e.ticker}`, body: `${sol(e.commit)} SOL in your presale.`, url: room };
    case "follow": {
      // e: { presale, ticker, users: [wallets], opened: wallet | null }
      if (e.users.length > 1) return { title: `${e.users.length} people you follow are in ${e.ticker}`, body: "Tap to see who's in.", url: room };
      const [user] = e.users;
      if (e.opened === user) return { title: `${shortWallet(user)} opened ${e.ticker}`, body: "A new presale from someone you follow.", url: room };
      return { title: `${shortWallet(user)} joined ${e.ticker}`, body: "Someone you follow is in. Tap to see who's in.", url: room };
    }
    case "mcap":
      // e: { presale, ticker, usd (the milestone), now (the market cap) }
      return { title: `${e.ticker} passed ${usdShort(e.usd)} market cap`, body: `It's at ${usdShort(e.now)} now.`, url: `/coin/${e.presale}` };
    case "room":
      // e: { presale, ticker, amount (lamports, a string) }
      return { title: `${e.ticker} has room`, body: `There's room for your ${sol(e.amount)} SOL. Tap to join.`, url: `${room}?join=${e.amount}` };
    default:
      throw new Error(`no words for ${kind}`);
  }
}
