// Builds site/join/join.js (React + Privy, borrowed from web/node_modules) into site/assets/join/:
// join.js, which main.js imports by name, and its hashed chunks. The Privy app id is in
// join.js itself. deploy/railway.sh site runs this first.
//   node site/tools/build-join.mjs        (needs web/node_modules)
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..");
const web = path.resolve(site, "../web");
const src = path.join(site, "join");
const { build } = await import(pathToFileURL(path.join(web, "node_modules/vite/dist/node/index.js")).href);
// site/ has no node_modules: a bare import from site/join resolves as if web's app made it
const FROM_WEB = path.join(web, "src", "main.tsx");

await build({
  configFile: false,
  root: src,
  mode: "production",
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [
    {
      name: "resolve-from-web",
      enforce: "pre",
      resolveId(source, importer, options) {
        if (!importer?.startsWith(src + path.sep) || /^[./\0]/.test(source) || path.isAbsolute(source)) return null;
        return this.resolve(source, FROM_WEB, { ...options, skipSelf: true });
      },
    },
  ],
  build: {
    outDir: path.join(site, "assets", "join"),
    emptyOutDir: true,
    target: "es2022",
    minify: true,
    lib: { entry: path.join(src, "join.js"), formats: ["es"], fileName: () => "join.js" },
    rolldownOptions: {
      // Privy's packages start with "use client", which a bundle can't keep; every other warning shows
      onLog(level, log, handler) {
        if (log.code === "MODULE_LEVEL_DIRECTIVE" && log.message?.includes('"use client"')) return;
        handler(level, log);
      },
      output: {
        // lib mode names chunks .mjs when no package.json says "type": "module"; server.mjs serves .js.
        // Hash only: a module's name ("keypair"…) in a file name trips deploy/railway.sh's refusal
        chunkFileNames: "[hash].js",
        // lib mode keeps whitespace (minify without codegen) and /* @__PURE__ */ comments for
        // a later bundler; this is a page's bundle, so minify fully and drop comments
        minify: true,
        comments: false,
      },
    },
  },
});
console.log("built site/assets/join/");
