// Meteora DAMM v2 (cp-amm): where a coin trades once its DBC pool has migrated. DBC
// creates the DAMM v2 pool at a PDA of the migration config its own config names
// (migrationFeeOption; Mooner's is 2, FixedBps100: a 1% pool fee) and the two mints. The
// layout offsets were checked against mainnet pool GwvAt96o… (1112 bytes); its sqrt price
// gives exactly the price Meteora's Data API reports for it. No node: imports.

import { PublicKey } from "@solana/web3.js";
import { WSOL } from "./consts.js";

export const DAMM_V2 = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
export const DAMM_POOL_DISC = Buffer.from("f19a6d0411b16dbc", "hex");
export const DAMM_POOL_LEN = 1112;

/** The DAMM v2 configs DBC migrates into, by migrationFeeOption (Meteora's DBC SDK,
 *  DAMM_V2_MIGRATION_FEE_ADDRESS): 0 FixedBps25, 1 FixedBps30, 2 FixedBps100, 3 FixedBps200,
 *  4 FixedBps400, 5 FixedBps600, 6 Customizable. */
export const MIGRATION_CONFIGS = [
  "7F6dnUcRuyM2TwR8myT1dYypFXpPSxqwKNSFNkxyNESd",
  "2nHK1kju6XjphBLbNxpM5XRGFj7p9U8vvNzyZiha1z6k",
  "Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp",
  "2c4cYd4reUYVRAB9kUUkrq55VPyy2FNQ3FDL4o12JXmq",
  "AkmQWebAwFvWk55wBoCr5D62C6VVDTzi84NJuD9H7cFD",
  "DbCRBj8McvPYHJG1ukj8RE15h2dCNUdTAESG49XpQ44u",
  "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck",
].map((k) => new PublicKey(k));
/** Mooner's DBC config migrates with option 2 (dbc.js moonerConfigParams). */
export const MOONER_MIGRATION_OPTION = 2;

/** The pool's authority (owner of its two vaults). */
export const dammPoolAuthority = () => PublicKey.findProgramAddressSync([Buffer.from("pool_authority")], DAMM_V2)[0];

/** The DAMM v2 pool of mints `a` and `b` on migration config `config`: seeds "pool",
 *  config, then the bytewise-larger mint, then the other. */
export function dammPoolAddress(config, a, b) {
  const [hi, lo] = Buffer.compare(a.toBuffer(), b.toBuffer()) > 0 ? [a, b] : [b, a];
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), config.toBuffer(), hi.toBuffer(), lo.toBuffer()], DAMM_V2)[0];
}

const u128 = (b, at) => b.readBigUInt64LE(at) | (b.readBigUInt64LE(at + 8) << 64n);
const key = (b, at) => new PublicKey(b.subarray(at, at + 32));

/** The parts of a DAMM v2 Pool the app shows, or null if `data` isn't one. */
export function decodeDammPool(data) {
  if (!data || data.length < DAMM_POOL_LEN || !Buffer.from(data.subarray(0, 8)).equals(DAMM_POOL_DISC)) return null;
  const b = Buffer.from(data);
  return {
    tokenA: key(b, 168),
    tokenB: key(b, 200),
    vaultA: key(b, 232),
    vaultB: key(b, 264),
    liquidity: u128(b, 360),
    sqrtPrice: u128(b, 456),
    activationPoint: b.readBigUInt64LE(472),
    status: b[481],
  };
}

/** Where `mint` trades on DAMM v2 after its DBC pool migrated: { pool, state } or null
 *  (not migrated yet, or not found). Looks at Mooner's migration config first, then the
 *  others, all in one read; a candidate counts only if DAMM v2 owns it and it pairs `mint`
 *  (token A) with wSOL (token B). */
export async function findDammPool(conn, mint, { first = MOONER_MIGRATION_OPTION } = {}) {
  const configs = [MIGRATION_CONFIGS[first], ...MIGRATION_CONFIGS.filter((_, i) => i !== first)];
  const pools = configs.map((c) => dammPoolAddress(c, mint, WSOL));
  const accs = await conn.getMultipleAccountsInfo(pools);
  for (const [i, a] of accs.entries()) {
    if (!a?.owner?.equals(DAMM_V2)) continue;
    const state = decodeDammPool(a.data);
    if (state?.tokenA.equals(mint) && state.tokenB.equals(WSOL)) return { pool: pools[i], state };
  }
  return null;
}
