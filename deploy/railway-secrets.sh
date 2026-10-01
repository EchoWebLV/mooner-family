#!/bin/sh
# Puts the app's secrets on Railway (service "app") from this machine without printing them:
# the gate and bot keys from engine/.mainnet, PINATA_JWT and MOONER_RPC from engine/.env, and
# the wallets allowed to open presales (the arguments). Also the program, DBC config and
# lookup table from engine/.mainnet/deployment.json (public keys; the image doesn't carry
# the record). It doesn't deploy: run `sh deploy/railway.sh app` after.
#   sh deploy/railway-secrets.sh [wallet ...]      or '*' (quoted): any wallet may open
set -eu
E=$(cd "$(dirname "$0")/../engine" && pwd)
put() { railway variable set "$1" --stdin --skip-deploys --project 14215b7b-adff-430c-81f8-71e01298c7c3 --environment production --service app; }
from_env() { node -e 'process.loadEnvFile(process.argv[1]); process.stdout.write(process.env[process.argv[2]] ?? "")' "$E/.env" "$1"; }
from_rec() { node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (!r[process.argv[2]]) process.exit(1); process.stdout.write(r[process.argv[2]])' "$E/.mainnet/deployment.json" "$1"; }

for w in "$@"; do
  [ "$w" = "*" ] && continue
  echo "$w" | grep -Eq '^[1-9A-HJ-NP-Za-km-z]{32,44}$' || { echo "not a wallet address: $w" >&2; exit 1; }
done

put MOONER_GATE_KEY < "$E/.mainnet/gate-keypair.json"
for kv in MOONER_PROGRAM:programId MOONER_DBC_CONFIG:dbcConfig MOONER_ALT:alt; do
  v=$(from_rec "${kv#*:}") || { echo "${kv#*:} is not in engine/.mainnet/deployment.json: run engine/scripts/mainnet.js --confirm" >&2; exit 1; }
  printf %s "$v" | put "${kv%%:*}"
done
put MOONER_BOT_KEY < "$E/.mainnet/bot-keypair.json"
for k in PINATA_JWT MOONER_RPC; do
  v=$(from_env "$k")
  if [ -n "$v" ]; then printf %s "$v" | put "$k"; else echo "$k is not in engine/.env: skipped"; fi
done
if [ $# -gt 0 ]; then printf %s "$*" | put MOONER_OPENER_WALLETS; fi
