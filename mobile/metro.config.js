// The app bundles ../engine/src as is (the chain code the web app and the server use).
// Every package engine/src imports resolves from this app's node_modules, never engine's:
// one @solana/web3.js (two copies break PublicKey checks; the web app dedupes the same
// way) and no need for engine/'s own install. So this package.json lists each package
// engine/src imports.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const engine = path.resolve(__dirname, "../engine");
const fromApp = path.join(__dirname, "index.js");

config.watchFolders = [engine];
config.resolver.resolveRequest = (context, name, platform) => {
  const bare = !name.startsWith(".") && !name.startsWith("/");
  const fromEngine = context.originModulePath.startsWith(engine + path.sep);
  const ctx = fromEngine && bare ? { ...context, originModulePath: fromApp } : context;
  return ctx.resolveRequest(ctx, name, platform);
};

module.exports = config;
