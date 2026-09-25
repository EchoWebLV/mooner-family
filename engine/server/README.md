# Mooner server

The gate co-signer, the mint issuer and the keeper, in one Node process. The design is in the
engine spec, under "Off-chain / The server". All settings are listed at the top of `config.js`.

## Setup (mainnet)

1. `engine/.mainnet/` already holds `deployment.json`, `gate-keypair.json` and
   `bot-keypair.json` (from `scripts/mainnet.js`).
2. In `engine/.env`:
   ```
   PINATA_JWT=...
   MOONER_RPC=https://...        # a paid RPC; the public one drops requests
   ```
3. `engine/.mainnet/openers.txt`: the wallets that may open a presale, one per line. `#`
   starts a comment. The server re-reads the file when it changes. Anyone can join.
4. Check it, then start it (from `engine/`):
   ```bash
   npm run server:check
   ```
   ```bash
   npm run server
   ```

It listens on `127.0.0.1:8787`. To reach it from outside this machine, put a proxy or tunnel
in front and set `MOONER_TRUST_PROXY=1`.

## Back up

`engine/.mainnet/server.db` holds every mint secret key the server issued. Without it, a
presale that fills can't launch: the bot fails it after the grace period and everyone is
refunded. Back the folder up, and keep it private.

## Test

- `npm test` runs the server tests with a fake chain.
- `node scripts/canary.js --cluster devnet --server --path happy` (then `--path expiry`)
  runs a real presale on devnet through this server. See `CANARY.md`.

## Load

The keeper scans for presales (`getProgramAccounts`) every 10 s (`MOONER_SCAN_MS`) and
ticks the ones it knows in between. Reads through the API are shared for 2–3 s. Public RPCs
throttle `getProgramAccounts`; a slow keeper can miss the grace window after a presale
fills, and then the presale fails and refunds instead of launching. Use a paid RPC.
