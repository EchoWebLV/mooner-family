// Share links and who shared them (spec "Referral"). A presale link may carry
// `?ref=<wallet>`, the wallet that shared it. The app keeps the newest one per presale until
// a join there lands, and sends it with that join's co-sign; the server records it with the
// join it sends (server/referrals.js). No imports: the phone, the web and Node tests all use it.

/** How many presales' refs a device keeps; the oldest go first. */
export const MAX_REFS = 10;

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** `v` as a wallet (base58, trimmed), or null for anything else. */
export function cleanRef(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return WALLET.test(s) ? s : null;
}

/** `refs` ({ presale: { ref, at } }) with `ref` noted for `presale` at `at` (ms). The newest
 *  link wins and only the newest `max` presales stay. Anything that changes nothing (junk,
 *  the same ref again) gives back `refs` itself, so callers can skip the save. */
export function withRef(refs, presale, ref, at, max = MAX_REFS) {
  const r = cleanRef(ref);
  const base = isMap(refs) ? refs : {};
  if (!r || !cleanRef(presale) || base[presale]?.ref === r) return refs;
  const next = Object.entries({ ...base, [presale]: { ref: r, at } })
    .sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
    .slice(0, max);
  return Object.fromEntries(next);
}

/** The wallet that shared `presale` with this device, or null. Never `wallet` itself: no one
 *  refers themselves. */
export function refFor(refs, presale, wallet) {
  const r = isMap(refs) ? cleanRef(refs[presale]?.ref) : null;
  return r && r !== wallet ? r : null;
}

/** `refs` without `presale` (a join there landed); `refs` itself if it had none. */
export function withoutRef(refs, presale) {
  if (!isMap(refs) || !Object.hasOwn(refs, presale)) return refs;
  const { [presale]: _, ...rest } = refs;
  return rest;
}

/** The link that opens presale `key`: `<base>/presale/<key>`, with `?ref=<wallet>` when a
 *  wallet is connected. `base`: an origin ("https://app.mooner.family") or "" for a path. */
export function shareLink(base, key, wallet) {
  const r = cleanRef(wallet);
  return `${base}/presale/${key}${r ? `?ref=${r}` : ""}`;
}
