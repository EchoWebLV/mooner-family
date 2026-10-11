// The app bundles ../engine/src as is (the chain code the web app and the server use).
// Every package engine/src imports resolves from this app's node_modules, never engine's:
// one @solana/web3.js (two copies break PublicKey checks; the web app dedupes the same
// way) and no need for engine/'s own install. So this package.json lists each package
// engine/src imports.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Expo's default store (a FileStore in $TMPDIR/metro-cache) is shared by every checkout
// of this repo; the same class rooted here keeps each checkout's cache its own.
// .metro-cache never shrinks (clear it as scripts/check-bundle.sh says), and copying mobile/ copies it.
const stores = config.cacheStores;
if (!(Array.isArray(stores) && stores.length === 1 && stores[0]?.constructor?.name === "FileStore")) {
  throw new Error("metro.config.js: Expo's default cacheStores is no longer one FileStore, so the per-checkout .metro-cache can't be set up; update metro.config.js");
}
config.cacheStores = [new stores[0].constructor({ root: path.join(__dirname, ".metro-cache") })];
const engine = path.resolve(__dirname, "../engine");
const fromApp = path.join(__dirname, "index.js");

config.watchFolders = [engine];
config.resolver.resolveRequest = (context, name, platform) => {
  const bare = !name.startsWith(".") && !name.startsWith("/");
  const fromEngine = context.originModulePath.startsWith(engine + path.sep);
  const ctx = fromEngine && bare ? { ...context, originModulePath: fromApp } : context;
  return ctx.resolveRequest(ctx, name, platform);
};

// `expo start --web` only: the server's /api/rpc has no CORS (rpcproxy.js), so the app in a
// browser calls this dev server's /api/rpc (config.js) and it's forwarded here, as web/'s
// vite proxy does. Phone builds call the server directly and never pass through this.
const SERVER = process.env.EXPO_PUBLIC_MOONER_SERVER || "https://app.mooner.family";
const enhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const next = enhance ? enhance(middleware, server) : middleware;
  return (req, res, fallthrough) => {
    if (req.url !== "/api/rpc" || req.method !== "POST") return next(req, res, fallthrough);
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const r = await fetch(`${SERVER}/api/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) });
        res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `dev proxy: ${e.message}` }));
      }
    });
  };
};

module.exports = config;
