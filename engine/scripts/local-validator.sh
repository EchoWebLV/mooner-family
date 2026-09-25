#!/usr/bin/env bash
# A local validator for `npm run local`: the canary build of our program (upgrade
# authority = the local payer, so init_config works), the mainnet DBC program and
# Mooner's DBC config from the litesvm fixtures. No MagicBlock: ledger instructions run
# on Solana against home accounts.
#   cargo build-sbf --features canary --sbf-out-dir target/canary   (in programs/presale)
#   programs/presale/litesvm/fixtures/fetch.sh                      (dumps dbc.so)
# RPC_PORT moves it off 8899 when another validator is running there (the canary then
# needs --rpc http://127.0.0.1:$RPC_PORT); the other ports follow it.
# Genesis copies mainnet's feature set: the test validator otherwise turns on every
# feature, including SIMD-0500 (no new SBPF v0 deploys), which mainnet doesn't have.
set -euo pipefail
RPC_PORT=${RPC_PORT:-8899}
cd "$(dirname "$0")/.."
PRESALE=../programs/presale
FIX=$PRESALE/litesvm/fixtures
DIR=.canary/local
mkdir -p "$DIR"
[[ -f $DIR/payer-keypair.json ]] || solana-keygen new --no-bip39-passphrase --silent -o "$DIR/payer-keypair.json"
PAYER=$(solana-keygen pubkey "$DIR/payer-keypair.json")
PID=$(solana-keygen pubkey "$PRESALE/target/canary/mooner_presale-keypair.json")
exec solana-test-validator --reset --quiet --ledger "$DIR/ledger" \
  --clone-feature-set --url mainnet-beta \
  --rpc-port "$RPC_PORT" --faucet-port $((RPC_PORT + 1001)) --gossip-port $((RPC_PORT + 101)) \
  --dynamic-port-range $((RPC_PORT + 201))-$((RPC_PORT + 301)) \
  --mint "$PAYER" \
  --upgradeable-program "$PID" "$PRESALE/target/canary/mooner_presale.so" "$PAYER" \
  --bpf-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN "$FIX/dbc.so" \
  --account HnKg7Vb2aHPhX8LVy4gMXZ6dACGPHUPFkQeX82FB8LmF "$FIX/dbc-config.json" \
  --account So11111111111111111111111111111111111111112 "$FIX/wsol-mint.json"
