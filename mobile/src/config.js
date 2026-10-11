// Where the phone app talks to. Mooner runs on mainnet (Seed Vault won't sign devnet txs:
// spec, Answers 2026-10-01).
// EXPO_PUBLIC_MOONER_SERVER points it at another server (engine/scripts/demo-server.js for
// recordings); builds without it use the live one.
export const BASE = process.env.EXPO_PUBLIC_MOONER_SERVER || "https://app.mooner.family";
export const WS_URL = `${BASE.replace(/^http/, "ws")}/api/ws`;
/** The site shared links point to: BASE, unless EXPO_PUBLIC_MOONER_LINKS says otherwise (a
 *  recording build on the demo server still shares app.mooner.family links). */
export const LINKS = process.env.EXPO_PUBLIC_MOONER_LINKS || BASE;
/** µLamports per CU the phone builds txs at: Seed Vault raises anything lower to this. */
export const PRIORITY = 100_000;
/** The wallet's network for Mobile Wallet Adapter, and the app's Solana RPC: the server's,
 *  through POST /api/rpc (engine/server/rpcproxy.js), not the rate-limited public one. */
export const CHAIN = "solana:mainnet";
// In a browser (`expo start --web`) the server's /api/rpc refuses other sites (no CORS), so the
// call goes to the dev server's own /api/rpc, which forwards it (metro.config.js). Only a browser
// has a `document`; checking for it keeps react-native out of this file, so Node tests import it.
export const RPC = typeof document !== "undefined" ? `${window.location.origin}/api/rpc` : `${BASE}/api/rpc`;
/** How the app shows itself in the wallet's approval screen. */
export const IDENTITY = { name: "Mooner", uri: "https://mooner.family", icon: "assets/icon-180.png" };
