// The site is plain static files (dist/), served by the Mooner server at the same origin
// as its API. `npm run dev` serves it here and forwards /api to a running server.
// The screens come from the wireframe (a Next app): next/link, next/navigation and
// next/image are small shims on react-router.
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const src = (p) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig(({ mode }) => {
  // signing in is Privy: its app id (public) goes in web/.env as VITE_PRIVY_APP_ID. Privy
  // throws on an id that isn't 25 characters, which would leave the page blank.
  const id = process.env.VITE_PRIVY_APP_ID ?? loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_").VITE_PRIVY_APP_ID;
  if (id?.length !== 25) {
    throw new Error("VITE_PRIVY_APP_ID is missing or not a Privy app id: put the app id from dashboard.privy.io in web/.env");
  }
  return config;
});

const config = {
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^next\/link$/, replacement: src("shims/link.tsx") },
      { find: /^next\/navigation$/, replacement: src("shims/navigation.ts") },
      { find: /^next\/image$/, replacement: src("shims/image.tsx") },
      { find: /^@\//, replacement: src("") },
    ],
    // engine/src imports these too: one copy of each (two web3.js copies fail PublicKey checks).
    // @noble/hashes: every importer gets the root copy (1.8.0); a package that needs 2.x
    // (other export paths) would break here, so check this list when one comes in.
    dedupe: ["@solana/web3.js", "buffer", "@noble/hashes"],
  },
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production") },
  server: {
    port: 5173,
    fs: { allow: [".."] }, // ../engine/src
    // ws: the live socket; changeOrigin: a hosted API (MOONER_API=https://app.mooner.family) routes by Host
    proxy: { "/api": { target: process.env.MOONER_API ?? "http://127.0.0.1:8788", ws: true, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2_000 }, // web3.js, Privy, three.js
};
