// Polyfills first (engine/src and web3.js expect crypto.getRandomValues and Buffer), then
// expo-router, which loads the screens under app/.
import "./polyfill";
import "expo-router/entry";
