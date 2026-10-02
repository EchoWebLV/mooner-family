// The kinds of push alert, shared by the server (engine/server/alerts.js) and the phone's
// Alerts screen. Pure: no imports.

/** Every kind an alert can be. */
export const KINDS = ["filled", "launched", "arrived", "joined", "follow", "mcap", "room"];

/** The kinds with a switch on the Alerts screen, all on for a new phone. "room" (Auto-join's
 *  push) has none: it goes only to a phone that asked for it, and "Stop waiting" ends it. */
export const SWITCHES = ["filled", "launched", "arrived", "joined", "follow", "mcap"];

/** What a new phone gets: every switch on (the spec: big market caps on by default too). */
export const DEFAULT_KINDS = [...SWITCHES];

/** The Alerts screen's three groups of switches. */
export const GROUPS = [
  { title: "Your presales", kinds: ["filled", "launched", "arrived", "joined"] },
  { title: "People you follow", kinds: ["follow"] },
  { title: "Big market caps", kinds: ["mcap"] },
];

/** Each switch's words. */
export const KIND_LABEL = {
  filled: "A presale you're in fills",
  launched: "A presale you're in launches",
  arrived: "Your tokens arrive",
  joined: "Someone joins your presale",
  follow: "Someone you follow joins or opens one",
  mcap: "A coin passes $100K, $500K, $1M, $5M or $10M",
};

/** The switches that are on, from what a client sent: known switch names, each once, in
 *  SWITCHES order. null when it isn't a list. */
export function cleanKinds(v) {
  if (!Array.isArray(v)) return null;
  return SWITCHES.filter((k) => v.includes(k));
}
