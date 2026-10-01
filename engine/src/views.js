// What a screen shows about a presale or a coin, read from the server's views (GET
// /api/presale/:key, the `presales`, `presale:<key>` and `launched` pushes). Pure: no
// network and no clock of its own (callers pass `nowMs`). The web app and the phone app
// both read presales through these. Amounts are BigInt lamports; the server sends strings.

/** Every Mooner coin's supply in whole tokens (engine/src/dbc.js: 1B, 6 decimals). */
export const SUPPLY = 1_000_000_000;
/** SOL in the curve when the pool moves to DAMM v2 (engine/src/dbc.js CURVE.GRAD_QUOTE). */
export const GRAD_SOL = 80;
const DECIMALS = 6;

const big = (v) => BigInt(v ?? 0);
const no = (why) => ({ ok: false, why });

/** "presale" | "launching" | "live" | "migrated" | "expired", from a presale's view and its
 *  launched row; either may be missing. */
export function stageOf(view, launched) {
  if (launched) return launched.pool?.migrated ? "migrated" : "live";
  switch (view?.state) {
    case "OPEN":
      return "presale";
    case "FULL":
    case "LAUNCHING":
      return "launching";
    case "SETTLED":
      return "live";
    case "CLOSED":
      return view.launch ? "live" : "expired";
    default:
      return "expired";
  }
}

/** SOL per whole token at a pool's Q64.64 sqrt price (of lamports per raw token). */
export function priceFromSqrt(sqrtPrice) {
  const s = Number(BigInt(sqrtPrice)) / 2 ** 64;
  return (s * s * 10 ** DECIMALS) / 1e9;
}

/** Market cap in SOL at a sqrt price. */
export const marketCapSol = (sqrtPrice) => priceFromSqrt(sqrtPrice) * SUPPLY;

/** How full the pool is, 0 to 1. `N`: /api/info `numbers` (BigInt or strings). */
export function fillOf(view, N) {
  const target = big(N.TARGET);
  if (target <= 0n) return 0;
  return Math.min(1, Math.max(0, Number(big(view.raised)) / Number(target)));
}

/** Lamports still to fill. */
export function roomOf(view, N) {
  const r = big(N.TARGET) - big(view.raised);
  return r > 0n ? r : 0n;
}

/** Whole seconds to the deadline; 0 once past or with no deadline. */
export function secondsLeft(view, nowMs) {
  const d = Number(view.deadlineTs ?? 0);
  return d > 0 ? Math.max(0, Math.floor(d - nowMs / 1000)) : 0;
}

/** "m:ss", or "h:mm:ss" from an hour. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const two = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** Who's in: [{ user, commit, creator }], biggest commit first. From the seats when the view
 *  has them (a detail view), else the list's users. A seat with nothing in the pool isn't in. */
export function whoIsIn(view) {
  const rows = (view.seats ?? view.users ?? []).map((r) => ({ user: r.user, commit: big(r.commit), creator: !!r.creator }));
  return rows.filter((r) => r.commit > 0n).sort((a, b) => (b.commit > a.commit ? 1 : b.commit < a.commit ? -1 : 0));
}

/** `wallet`'s seat in a detail view, or null. */
export function seatOf(view, wallet) {
  const s = view.seats?.find((x) => x.user === wallet);
  if (!s) return null;
  return { deposit: big(s.deposit), commit: big(s.commit), creator: !!s.creator, settled: !!s.settled, claimed: !!s.claimed, where: s.where };
}

/** Whether `wallet` (or anyone, with null) can join now: { ok: true } or { ok: false, why }.
 *  A view the server marks `stale` (it couldn't read the ER copy and sent the snapshot from
 *  before delegation) never offers a join. A list item's `users` leaves out seats with
 *  nothing in the pool, so the detail view (with `seats`) has the final say. */
export function joinCheck(view, wallet, N, nowMs) {
  if (view.state !== "OPEN" || view.where === "closed") return no("This presale isn't taking seats.");
  if (view.stale) return no("Can't see this pool right now. Try again in a moment.");
  if (secondsLeft(view, nowMs) <= 0) return no("Time's up for this presale.");
  if (wallet && (seatOf(view, wallet) || (view.users ?? []).some((u) => u.user === wallet))) return no("You're already in.");
  if (roomOf(view, N) <= 0n) return no("The pool is full.");
  return { ok: true };
}

/** Seat sizes the join sheet offers. */
export const SEAT_PRESETS = [100_000_000n, 250_000_000n, 500_000_000n];

/** The presets the program takes (util.rs valid_seat: MIN_SEAT..MAX_SEAT, a multiple of STEP). */
export function seatChoices(N) {
  const [min, max, step] = [big(N.MIN_SEAT), big(N.MAX_SEAT), big(N.STEP)];
  return SEAT_PRESETS.filter((a) => a >= min && a <= max && (step === 0n || a % step === 0n));
}

/** A pick of `amount`: what the seat holds and what goes in the pool. The program commits
 *  what fits (set_commit cuts to the room) and a seat holds at least MIN_SEAT; the rest of
 *  the deposit comes back with the seat. */
export function joinAmounts(view, N, amount) {
  const room = roomOf(view, N);
  const commit = amount < room ? amount : room;
  const min = big(N.MIN_SEAT);
  return { deposit: commit > min ? commit : min, commit };
}

/** Whether "Get my SOL back" applies to `wallet`'s seat in a detail view. Never the creator's
 *  seat. A seat with nothing in the pool can always leave and be refunded, in any state.
 *  A seat with SOL in the pool: if it's settled, only once the presale has FAILED (the
 *  refund then comes out of the presale); if not, while the presale is OPEN before its
 *  deadline (the SOL comes out of the pool), or once it's EXPIRED or FAILED. flows.getBack
 *  has the last word and says why when it can't. */
export function canGetBack(view, wallet, nowMs) {
  const s = seatOf(view, wallet);
  if (!s || s.creator) return false;
  if (s.commit === 0n) return true; // leave, or settle_seat with nothing in the pool: any state
  if (s.settled) return view.state === "FAILED"; // settle_seat refunds a settled seat's commit once FAILED
  if (view.state === "OPEN") return secondsLeft(view, nowMs) > 0;
  return view.state === "EXPIRED" || view.state === "FAILED";
}

/** Seconds of DBC's snipe tax after a pool opens (engine/src/dbc.js CURVE.SNIPE_S: about
 *  99% in the launch second, the 1% floor from 3 s on; buys and sells alike). */
export const SNIPE_S = 3;
/** Past the tax, the same margin the keeper waits before it delivers presale tokens. */
export const TAX_MARGIN_S = 1;

/** When a launched coin's Buy and Sell open (ms): its launch time (`launch.at`, the
 *  server's clock once the launch tx confirmed, so after the pool opened) plus the tax and
 *  the margin. null when the row has no launch. */
export const tradeOpensAt = (row) => (row?.launch?.at == null ? null : Number(row.launch.at) + (SNIPE_S + TAX_MARGIN_S) * 1000);
