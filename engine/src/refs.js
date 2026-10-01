// Share links and who shared them (spec "Referral"). A presale link may carry
// `?ref=<wallet>`, the wallet that shared it. The app keeps the newest one per presale until
// a join there lands, and sends it with that join's co-sign; the server records it with the
// join it sends (server/referrals.js). No imports: the phone, the web and Node tests all use it.

/** How many presales' refs a device keeps; the oldest go first. */
export const MAX_REFS = 10;

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** A surrogate pair, or a lone surrogate (which `encodeURIComponent` throws on). */
const SURROGATE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

/** `v` as a wallet, or null for anything else. The shape only: base58 characters, 32–44
 *  long, after trimming. It doesn't check that `v` decodes to 32 bytes; the server's `refOf`
 *  does that with `new PublicKey`. */
export function cleanRef(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return WALLET.test(s) ? s : null;
}

/** `refs` ({ presale: { ref, at } }) with `ref` noted for `presale` at `at` (ms). The newest
 *  link wins, except the viewer's own: `me` is their wallet as a base58 string, or
 *  null/undefined when it isn't known, and their own link never replaces a friend's ref. Only
 *  the newest `MAX_REFS` presales stay. Keys and refs are stored trimmed; an entry whose key
 *  isn't a trimmed wallet or whose ref isn't a wallet is dropped, and one without a number
 *  `at` counts as oldest, so a broken save is cleaned on the next write. Anything that changes
 *  nothing (junk, your own link, a note too old to keep, the same ref again) gives back `refs`
 *  itself, so callers can skip the save. The same ref again keeps its first `at` on purpose:
 *  no save on every open. */
export function withRef(refs, presale, ref, at, me) {
  const r = cleanRef(ref);
  const p = cleanRef(presale);
  const base = isMap(refs) ? refs : {};
  if (!r || r === cleanRef(me) || !p || base[p]?.ref === r) return refs;
  const when = (v) => (Number.isFinite(v.at) ? v.at : 0);
  const next = Object.entries({ ...base, [p]: { ref: r, at } })
    .filter(([k, v]) => cleanRef(k) === k && cleanRef(v?.ref))
    .map(([k, v]) => [k, { ...v, ref: cleanRef(v.ref) }])
    .sort((a, b) => when(b[1]) - when(a[1]))
    .slice(0, MAX_REFS);
  return next.some(([k]) => k === p) ? Object.fromEntries(next) : refs;
}

/** The wallet that shared `presale` with this device, or null. Never `wallet` itself: no one
 *  refers themselves. */
export function refFor(refs, presale, wallet) {
  const r = isMap(refs) ? cleanRef(refs[presale]?.ref) : null;
  return r && r !== (cleanRef(wallet) ?? wallet) ? r : null;
}

/** `refs` without `presale` (a join there landed); `refs` itself if it had none. */
export function withoutRef(refs, presale) {
  if (!isMap(refs) || !Object.hasOwn(refs, presale)) return refs;
  const { [presale]: _, ...rest } = refs;
  return rest;
}

/** The link that opens presale `key`: `<base>/presale/<key>`, with `?ref=<wallet>` when a
 *  wallet is connected. `base`: an origin ("https://app.mooner.family", a trailing `/` is
 *  dropped) or "" for a path. The key is URI-encoded (a base58 key comes out the same), so
 *  it can't add its own `?` or `#`. Never throws: a lone surrogate, which
 *  `encodeURIComponent` throws on, becomes U+FFFD first. */
export function shareLink(base, key, wallet) {
  const r = cleanRef(wallet);
  const b = String(base).replace(/\/+$/, "");
  const k = String(key).replace(SURROGATE, (c) => (c.length === 2 ? c : "\uFFFD"));
  return `${b}/presale/${encodeURIComponent(k)}${r ? `?ref=${r}` : ""}`;
}
