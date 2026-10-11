// Privy's Solana code uses Node's Buffer; the browser gets the `buffer` package. join.js imports
// this first, as web/src/main.tsx does web/src/real/polyfills.js.
import { Buffer } from "buffer";

globalThis.Buffer ??= Buffer;
