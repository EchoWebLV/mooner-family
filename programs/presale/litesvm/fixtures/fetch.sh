#!/usr/bin/env bash
# Mainnet fixtures for the litesvm suite. The DBC program is too big to commit, so
# it is dumped here; the two small accounts are committed but can be refreshed too.
#   ./fetch.sh            dump dbc.so only (needed once per checkout)
#   ./fetch.sh --accounts also refresh dbc-config.json and wsol-mint.json
set -euo pipefail
cd "$(dirname "$0")"
RPC="${RPC:-https://api.mainnet-beta.solana.com}"
DBC=dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
DBC_CONFIG=j7j5CfUSa9DGZCzKKxKBbCYvySiM14Hbr8V6uKbA6Be # Mooner's DBC config
WSOL=So11111111111111111111111111111111111111112

solana program dump -u "$RPC" "$DBC" dbc.so
if [[ "${1:-}" == "--accounts" ]]; then
  solana account -u "$RPC" "$DBC_CONFIG" --output json -o dbc-config.json
  solana account -u "$RPC" "$WSOL" --output json -o wsol-mint.json
fi
ls -la dbc.so dbc-config.json wsol-mint.json
