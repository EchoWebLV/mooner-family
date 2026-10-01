#!/bin/sh
# Bundles the app for Android and checks it holds exactly one @solana/web3.js and nothing
# from engine/node_modules (see metro.config.js). Module resolution is the same as in the
# release build; minification and the Hermes compile are not (--dev --no-bytecode).
set -e
cd "$(dirname "$0")/.."
rm -rf dist
npx expo export --platform android --dev --no-bytecode --output-dir dist > /dev/null
B=$(ls dist/_expo/static/js/android/*.js)
copies=$(grep -o '"[^"]*@solana/web3\.js/lib/index[^"]*"' "$B" | sort -u | wc -l | tr -d ' ')
stray=$(grep -c 'engine/node_modules' "$B" || true)
echo "web3.js copies: $copies; files from engine/node_modules: $stray"
[ "$copies" = 1 ] && [ "$stray" = 0 ]
