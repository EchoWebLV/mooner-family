// Where the phone app talks to. Mooner runs on mainnet (Seed Vault won't sign devnet txs:
// spec, Answers 2026-10-01).
export const BASE = "https://app.mooner.family";
export const WS_URL = "wss://app.mooner.family/api/ws";
/** µLamports per CU the phone builds txs at: Seed Vault raises anything lower to this. */
export const PRIORITY = 100_000;
/** The wallet's network for Mobile Wallet Adapter, and the app's Solana RPC: the server's,
 *  through POST /api/rpc (engine/server/rpcproxy.js), not the rate-limited public one. */
export const CHAIN = "solana:mainnet";
export const RPC = `${BASE}/api/rpc`;
/** How the app shows itself in the wallet's approval screen. */
export const IDENTITY = { name: "Mooner", uri: "https://mooner.family", icon: "assets/icon-180.png" };
