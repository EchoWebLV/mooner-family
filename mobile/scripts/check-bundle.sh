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
# The screens must be this checkout's own: a Metro cache shared with another checkout can
# hand back expo-router's list of that checkout's app/ files (see metro.config.js).
ROOT=$(pwd -P)
mine=$(grep -oF "\"$ROOT/app/" "$B" | wc -l | tr -d ' ')
echo "app/ entries from this checkout: $mine"
grep -qF "\"$ROOT/app/presale/[key].js\"" "$B" || { echo "no app/presale/[key].js from $ROOT in the bundle: another checkout's cached screens (see metro.config.js)"; exit 1; }
[ "$copies" = 1 ] && [ "$stray" = 0 ] && [ "$mine" != 0 ]
