// The simulation: its own Vite root, served under /sim by the Mooner server next to the real
// app. It builds into ../dist/sim after the real app's build, and shares the real app's
// packages (../node_modules) and next/* shims.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("."),
  base: "/sim/",
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^next\/link$/, replacement: here("../src/shims/link.tsx") },
      { find: /^next\/navigation$/, replacement: here("../src/shims/navigation.ts") },
      { find: /^next\/image$/, replacement: here("../src/shims/image.tsx") },
      { find: /^@\//, replacement: here("./src/") },
    ],
  },
  server: { port: 5174, fs: { allow: [here("..")] } },
  build: { outDir: here("../dist/sim"), emptyOutDir: true, chunkSizeWarningLimit: 2_000 }, // three.js
});
