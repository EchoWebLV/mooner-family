// Chat text, read the same way in both apps (spec §3): the 12 Mooner emojis typed as
// `:name:`, `$TICKER` links, and the server's 280 code-point limit (engine/server/social.js
// counts `[...text].length`). The text stays plain on the wire; each app draws the parts.

/** The 12 Mooner emojis. Each is a picture at <app assets>/emoji/<name>.png. */
export const EMOJI = ["lfg", "moon", "gm", "diamond", "jeet", "rug", "wen", "ngmi", "pump", "ser", "fire", "gg"];
const KNOWN = new Set(EMOJI);

/** The longest chat line, in code points (the server's limit). */
export const CHAT_MAX = 280;

const TOKEN = /:([a-z]+):|\$([A-Za-z0-9]{2,10})\b/g;

/** `text` in parts, in order: { kind: "text", text } | { kind: "emoji", name, text } |
 *  { kind: "ticker", text, tokenId }. A `$TICKER` is a part only when `tickers` (a Map of
 *  upper-case ticker to token id) has it. An unknown `:name:` stays text, and its closing
 *  colon can still open a known one (":foo:moon:"). */
export function chatParts(text, tickers = null) {
  const s = text ?? "";
  const re = new RegExp(TOKEN);
  const parts = [];
  let last = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    const name = m[1];
    const tokenId = m[2] ? tickers?.get(m[2].toUpperCase()) : undefined;
    if (name ? !KNOWN.has(name) : !tokenId) {
      re.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) parts.push({ kind: "text", text: s.slice(last, m.index) });
    parts.push(name ? { kind: "emoji", name, text: m[0] } : { kind: "ticker", text: m[0], tokenId });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ kind: "text", text: s.slice(last) });
  return parts;
}

/** Whether a line is only emojis (and spaces): the apps draw those larger. */
export const emojiOnly = (parts) =>
  parts.some((p) => p.kind === "emoji") && parts.every((p) => p.kind === "emoji" || (p.kind === "text" && !p.text.trim()));

/** The emoji names in `text`, in order, at most `max`: the ones that float up. */
export const emojisIn = (text, max = Infinity) =>
  chatParts(text).filter((p) => p.kind === "emoji").slice(0, max).map((p) => p.name);

/** The length the server counts: code points, so an emoji counts once. */
export const codePoints = (text) => Array.from(text ?? "").length;

/** `text` cut to `max` code points (never in the middle of an emoji). */
export function clipChat(text, max = CHAT_MAX) {
  const s = text ?? "";
  const cps = Array.from(s);
  return cps.length > max ? cps.slice(0, max).join("") : s;
}
