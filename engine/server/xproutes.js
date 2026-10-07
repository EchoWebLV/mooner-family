// XP over HTTP (spec "XP ledger", "Genesis perk"):
//
//   GET  /api/xp/<wallet>   -> the wallet's XP row (xp.js XpLedger.row)
//   POST /api/genesis       { token } -> { wallet, genesis: { mint, at }, fresh, xp }
//
// `token` is a Mooner sign-in (social.js /api/login, makeSessions). The Genesis check reads
// the chain only until the wallet's claim is stored; after that the claim answers. One
// Seeker's token gives the perk to one wallet (XpLedger.claimGenesis). Nothing here sends.

import { PublicKey } from "@solana/web3.js";
import { HttpError, Limiter, limit } from "./http.js";
import { parseKey } from "./api.js";
import { findGenesis } from "./genesis.js";

const KEY = "(?<key>[1-9A-HJ-NP-Za-km-z]{32,44})";

export const XP_LIMITS = {
  genesisPerIp: [10, 60_000],
  genesisPerWallet: [3, 60_000],
};

const short = (w) => `${w.slice(0, 4)}…${w.slice(-4)}`;

/** `ledger`: XpLedger. `l1`: a Connection (reads only). `walletOf(token)`: the wallet of a
 *  Mooner sign-in, or a 401 (makeSessions). `onXp(wallets)`: their rows changed. */
export function makeXpRoutes({ ledger, l1, walletOf, onXp = () => {}, limits = XP_LIMITS, now = Date.now }) {
  const L = Object.fromEntries(Object.entries({ ...XP_LIMITS, ...limits }).map(([k, [max, ms]]) => [k, new Limiter(max, ms, now)]));
  const answer = (wallet, claim) => ({ json: { wallet, genesis: { mint: claim.mint, at: claim.at }, fresh: claim.fresh, xp: ledger.row(wallet, now()) } });

  async function genesis({ body, ip }) {
    limit(L.genesisPerIp, ip, "Genesis checks");
    const wallet = walletOf(body.token);
    limit(L.genesisPerWallet, wallet, "Genesis checks from this wallet");
    const had = ledger.genesisOf(wallet);
    if (had) return answer(wallet, { ...had, fresh: false });
    let mints;
    try {
      mints = await findGenesis(l1, new PublicKey(wallet));
    } catch (e) {
      // the cause goes to the server's log (http.js logs an HttpError's `cause`)
      throw Object.assign(new HttpError(503, "couldn't read this wallet's tokens, try again"), { cause: e });
    }
    if (!mints.length) throw new HttpError(404, "no Seeker Genesis Token in this wallet");
    let taken = null;
    for (const mint of mints) {
      const claim = ledger.claimGenesis(mint, wallet, now());
      if (claim.taken) {
        taken ??= claim.taken;
        continue;
      }
      if (claim.fresh) {
        try {
          onXp([wallet]);
        } catch {
          // the claim is saved; a push that failed reaches clients at their next snapshot
        }
      }
      return answer(wallet, claim);
    }
    throw new HttpError(409, `this Seeker's Genesis Token was already used by ${short(taken)}`);
  }

  return [
    { method: "GET", path: new RegExp(`^/api/xp/${KEY}$`), handler: async ({ params }) => ({ json: ledger.row(parseKey(params.key, "wallet").toBase58(), now()) }) },
    { method: "POST", path: /^\/api\/genesis$/, body: 1_024, handler: genesis },
  ];
}
