# Mooner presale engine — design

- **Date:** 2026-09-25 · **Branch:** `feat/mooner-wireframe` · **Status:** approved in conversation, building
- **Scope:** the on-chain presale program, the bot that drives it, and a devnet canary.
- **Out of scope:** the web app, the chat, the fee router and holder rewards (each gets its own spec).

## Goal

A presale where:
- many independent wallets each put in 0.1–1 SOL;
- the pool fills to exactly 10 SOL within 1 hour;
- it launches on Meteora DBC with the whole pot as one top-level first buy at the 1% fee floor;
- every buyer gets tokens pro rata, at one price.

Four things must hold throughout:
- Nobody buys ahead of the presale.
- The holder map shows no hub between buyers.
- Mooner pays nothing per presale.
- Nobody, the bot and Mooner included, can take a buyer's SOL.

## Decisions (the user's)

| Topic | Decision |
|---|---|
| Target | exactly 10 SOL; the pool locks the moment it gets there |
| Seat | 0.1–1 SOL per wallet in 0.01 steps; the last commit is cut to the room left |
| Timer | **1 hour**, fixed. The wireframe's 5/10/15 min and the bot's 2–8 min timers are replaced |
| Change | a buyer can change their commit any time before full |
| Withdraw | anyone except the creator can withdraw before full |
| Exit | withdraw, refund and claim never need Mooner's signature |
| Entry | invite-gated: the server co-signs every open and every join (invite list, private presales, rate limits) |
| Money model | **MagicPad way** (chosen 2026-09-25, replacing the shared "Mooner balance"). There is one seat per wallet per presale. The SOL stays in the seat's escrow on Solana. Inside the MagicBlock ER only the ledger moves, and a permissionless settle step moves the SOL afterwards |
| Who pays | **Mooner pays nothing.** See the "Who pays" table |
| Launch | one tx does all of these: `init_pool`, release, the pot's single top-level buy, settle, and `transfer_pool_creator` to the creator's fee destination |
| Failed launch | a full presale that doesn't launch within the grace period refunds everyone |
| Delivery | the bot pushes tokens to every buyer, paid from the pot; buyers can also claim themselves |
| CA | the server holds the mint keypair, so the token address is known during the presale |
| Fees | Mooner gets 50% of trading fees, and the creator picks where the other 50% goes. This phase records one fee destination pubkey; routing to buyers or holder rewards is the fee-router spec |

## Facts this rests on (checked 2026-09-25)

- **The proven presale program** is `launch-test/presale-program`: native, `solana-program` 2.3, live on mainnet as `CHsp35WE…`. Its `release` and `settle` checks (the pool is created in the same tx, exactly one swap, exact-in of everything released, output into our vault) launched a real token. The mainnet launch tx cost 0.010153 SOL.
- **Meteora DBC** is `dbcij3LW…`, IDL v0.1.10, fetched on-chain. Account positions used by our checks:
  - `initialize_virtual_pool_with_token2022` `[169,118,51,78,145,110,220,155]`: 0 config, 2 creator (signer), 3 base_mint, 5 pool, 6 base_vault, 7 quote_vault, 8 payer.
  - `swap2` `[65,75,63,76,235,91,91,136]`: 2 pool, 3 input, 4 output, 7 base_mint, 9 payer.
  - `transfer_pool_creator` `[20,7,169,33,58,147,166,33]`: 0 virtual_pool, 1 config, 2 creator (signer), 3 new_creator.
  - Pool PDA: `["pool", config, max(mint,wSOL), min(mint,wSOL)]`. Vaults: `["token_vault", mint|wSOL, pool]`.
  - DBC is also deployed on devnet at the same address.
- **MagicPad** (`~/Documents/GitHub/MAGICPAD`, program `27HH4…`, 96 mainnet txs from 2026-08-25 to 2026-09-23) runs the same money model on MagicBlock:
  - escrow on Solana, ledger in the ER, a permissionless reconcile, an entry gate co-signer, session keys, a keeper;
  - its group-launch spec is the closest precedent for this one.
- **The MagicBlock native SDK** `ephemeral-rollups-sdk` 0.16.2 with `solana-program` 4.0 builds under `cargo-build-sbf` 4.1.0. Delegate, commit-and-undelegate and the undelegate callback all ran on devnet (`launch-test/er-speed`). Mainnet and devnet validators run magicblock-core 0.16.0.
- **MagicBlock fees:** 300,000 lamports per delegated account per session. The account's delegation payer pays it.
- **Pre-funded ATAs:** when an ATA address already holds lamports, the ATA program only tops up the shortfall from the payer (`spl-associated-token-account` 6.0.0, `tools/account.rs:28`; confirmed on ATA 1.1.1 in litesvm).
- **Paying a buyer's ATA from the pot:** claim can't move pot lamports into the ATA address before the ATA CPI. A CPI syncs only the accounts it's given, so the Presale's debit is missed and the runtime fails the instruction with UnbalancedInstruction (seen in litesvm). Instead:
  1. the cranker pays the shortfall inside the ATA program;
  2. the token transfer runs;
  3. the Presale pays the cranker back what the CPI took, capped at rent(vault len), together with the crank fee.

  Every direct lamport move comes after the last CPI.
- Rent comes from the Rent sysvar at runtime. The program never hard-codes it.

## Why native, not Anchor

- The launch half (release, settle, claim) is native code that already launched on mainnet.
- The native SDK path is proven on the current toolchain.
- Deploy rent is the only cost Mooner carries. The native test program is 111,968 bytes (0.57 SOL); MagicPad's Anchor build is 789,624 bytes.
- MagicPad contributes its design and test cases (ported), not its Anchor code.

## Accounts

All are PDAs of the presale program. Byte offsets are fixed; `u64` and `i64` are little-endian.

**Config** `["config"]`, 130 bytes:

| off | field |
|---|---|
| 0 | version = 1 |
| 1 | bump |
| 2 | admin |
| 34 | gate: the server co-signer; all zeros = open entry |
| 66 | bot: the key allowed to run `release` |
| 98 | dbc_config: the only Meteora config a launch may use |

**Presale** `["presale", mint]`, 272 bytes:

| off | field |
|---|---|
| 0 | version = 2 |
| 1 | state: 0 OPEN, 1 FULL, 2 LAUNCHING, 3 SETTLED, 4 EXPIRED, 5 FAILED |
| 2 | bump |
| 3 | creator |
| 35 | mint |
| 67 | fee_dest (`transfer_pool_creator` target) |
| 99 | validator (the ER validator; seats must delegate to the same one) |
| 131 | pot (set at release) |
| 163 | opened_ts |
| 171 | deadline_ts = opened + 3600 |
| 179 | full_ts |
| 187 | raised (ledger sum of commits) |
| 195 | seats_committed (seats with commit > 0) |
| 203 | seats_settled |
| 211 | seats_refunded |
| 219 | released |
| 227 | total_tokens |
| 235 | claimed_tokens |
| 243 | claims_done |
| 251 | fees_paid (settle fees the pot paid while FULL) |
| 259 | settled_sum (Σ commits moved into the Presale by settle_seat) |
| 267 | spare: 5 bytes |

A layout unit test pins these offsets.

**Seat** `["seat", presale, user]`, 120 bytes:

| off | field |
|---|---|
| 0 | version = 1 |
| 1 | bump |
| 2 | flags: bit 0 settled, bit 1 claimed, bit 2 creator |
| 3 | user |
| 35 | session_key |
| 67 | presale |
| 99 | deposit (lamports escrowed in this account) |
| 107 | commit (ledger) |
| 115 | spare |

## Numbers

| name | value |
|---|---|
| TARGET | 10_000_000_000 (10 SOL) |
| MIN_SEAT / MAX_SEAT / STEP | 100_000_000 / 1_000_000_000 / 10_000_000 |
| DURATION | 3_600 s |
| GRACE (full → failed) | 900 s |
| TX_FEE | 10_000 lamports: the allowance for one crank tx; one per tx, split across its ixs |
| LAUNCH_TX_FEE | 100_000 lamports (mainnet measured 95_000) |
| LAUNCH_COST_CAP | 50_000_000 (0.05 SOL): a hard ceiling on what the pot reimburses for the launch |

## Instructions

The tag is the first data byte. The undelegate callback uses its 8-byte discriminator.

**Solana (L1):**

| # | name | who | what |
|---|---|---|---|
| 0 | init_config | the program's upgrade authority (read from ProgramData) | creates Config |
| 1 | set_config | admin | rotates admin, gate, bot, dbc_config |
| 2 | open_presale | creator + gate + mint key | creates Presale (OPEN, deadline = now + 1h) and the creator's Seat (deposit ≥ commit, commit a valid seat size); raised = commit; seats_committed = 1. The mint can't be the creator |
| 3 | join | user + gate | creates a Seat with `deposit` in [MIN_SEAT, MAX_SEAT]. The Presale is read from its raw L1 snapshot (it is delegated): it must be OPEN and before the deadline. The escrow moves wallet → seat |
| 4 | delegate | payer | kind 0 Presale (payer = creator; state must be OPEN, so a Presale never re-enters the ER; the validator must be one of ER_VALIDATORS, MagicBlock's as/eu/us, and is stored), kind 1 Seat (payer = seat.user; validator must equal presale.validator). SDK `delegate_account`, with periodic commits off if `DelegateConfig` allows it (checked in the SDK source during the build) |
| 5 | settle_seat | anyone | see "Settling a seat" |
| 6 | release | bot | launch tx only, see "Launch tx" |
| 7 | settle | anyone | launch tx only, see "Launch tx" |
| 8 | claim | anyone | tokens to `seat.user`, pro rata; funds the ATA from the pot if missing; a memo CPI right before the transfer, so an ATA that requires memos still receives; closes the seat, its rent and the rest of the deposit to the user |
| 9 | fail | anyone | FULL, home, now ≥ full_ts + GRACE → FAILED |
| 10 | close_presale | anyone | after every committed seat is claimed (SETTLED) or refunded (EXPIRED/FAILED): on SETTLED, burns any tokens left in the vault (a stray token must not block the close) and closes it; closes the presale; rent and dust to the creator |

**Inside the ER:**

| # | name | who | what |
|---|---|---|---|
| 11 | set_commit | the seat's session key or wallet | state OPEN and before the deadline. `amount` is 0 or a valid seat size, ≤ deposit. The creator can't lower their commit. The amount is cut to the room left, and if no room is left it fails. Updates raised and seats_committed. When raised == TARGET: FULL, full_ts = now |
| 12 | rotate_key | the seat's wallet | new session key |
| 13 | leave | the seat's session key or wallet | commit == 0 and not the creator → commit and undelegate this seat |
| 14 | expire | anyone | OPEN and now ≥ deadline → EXPIRED |
| 15 | commit_presale | anyone | FULL or EXPIRED → commit and undelegate the Presale |
| 16 | commit_seats | anyone | the Presale is not OPEN (it may already be home: the ER reads it) → commit and undelegate the listed seats of this presale |

## Home guard (the ER-lane trap)

Inside the ER a delegated account looks program-owned, so an L1-only instruction could run there on a delegated Presale or Seat and its writes would commit home. MagicPad's rollout notes flag the same trap. The fix:
- every L1-only instruction that writes a Presale or a Seat (settle_seat, release, fail, close_presale) also takes that account's MagicBlock delegation record (`["delegation", account]` under `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`);
- it requires that record to be empty.

The record exists only while the account is delegated. `claim` and `settle` don't need the guard, because SETTLED and LAUNCHING are reachable only on L1 and delegate kind 0 requires OPEN.

The MagicBlock session fee is taken from the delegation record and metadata rent at undelegation, not from the delegated account (`processor/fast/undelegate.rs` in the delegation program). So a seat's escrow comes home whole.

## Settling a seat (L1, permissionless)

The seat must be home, meaning owned by this program. The payout always goes to `seat.user`. A cranker who is not the user gets their share of TX_FEE, taken as stated below.

| case | effect |
|---|---|
| commit == 0 (never committed, withdrew, or left) | refund the whole deposit, close the seat, rent to the user. The Presale isn't read (the seat's own PDA pins it), so this works while the Presale is delegated or after it is closed. The fee comes out of the refund |
| Presale home + FULL, commit > 0, not settled | commit → Presale, mark settled, seats_settled += 1, settled_sum += commit. The rest of the deposit stays in the seat and goes to the user with the seat's rent at claim (or refund): paying a small amount to a wallet the user emptied would fail Solana's rent check and block the launch. The fee comes from the pot and is added to `fees_paid` |
| Presale home + EXPIRED/FAILED, commit > 0, not settled | the whole deposit goes from the seat to the user. Close the seat, seats_refunded += 1. The fee comes out of the refund |
| Presale home + FAILED, commit > 0, settled | the seat still holds the rest of the deposit, which goes to the user when it closes. The Presale pays `commit − ceil(fees_paid × commit / settled_sum)`, so the settled seats share the pot's settle fees pro rata and the payouts never exceed what the Presale holds (`settled_sum − fees_paid`). Seats that never settled aren't in the Presale, which is why the divisor is `settled_sum`, not `raised`. Close the seat, seats_refunded += 1. The fee comes out of the refund |

"Your share of TX_FEE" means TX_FEE divided by the number of this program's instructions with the same tag in the tx (read from the instructions sysvar). A cranker can't farm fees by splitting work into more instructions.

## Launch tx (L1, one transaction, top-level only)

1. `init_pool` (DBC): creator = bot, payer = bot, config = Config.dbc_config.
2. Create the pot's wSOL ATA. The pot is a one-time key per launch, so no key is shared across launches.
3. Create the presale's Token-2022 vault (the ATA of the Presale).
4. **release** (bot signs). It checks:
   - FULL, home, and seats_settled == seats_committed;
   - the pool, the vaults and the mint match the `init_pool` ix and the PDA derivations;
   - a `settle` for this presale comes later in the tx.

   The launch cost is Σ rent(data_len) of the mint, pool, base vault, quote vault and presale vault, plus LAUNCH_TX_FEE. It must be ≤ LAUNCH_COST_CAP.

   The delivery reserve is seats_committed × (rent(vault.data_len) + TX_FEE).

   released = settled_sum − fees_paid − launch cost − delivery reserve, from the ledger and not the balance, so lamports sent to the Presale can't change what the bot planned (they go to the creator at close). The Presale must still hold its rent + reserve + cost + released. `released` goes to the pot's wSOL and the launch cost to the bot. State LAUNCHING, pot recorded.
5. `sync_native`, then the pot's **swap2**: exact-in `released`, from the pot's wSOL, output = the presale vault, with the instructions sysvar attached. Without the sysvar DBC skips the 1% first-buy floor and charges the config's full scheduler fee, so settle requires it.
6. **settle** (`min_tokens`). It checks:
   - the tx order is init_pool < release < the one swap < settle;
   - exactly one DBC swap in the tx;
   - the pot's wSOL is empty;
   - the vault is ours and holds ≥ min_tokens;
   - init_pool.config == Config.dbc_config;
   - a DBC `transfer_pool_creator` exists for this pool, where creator = init_pool's creator and new_creator = presale.fee_dest;
   - the pool (passed to settle) shows the buy paid at most the floor fee: released − quote_reserve ≤ ceil(released / 100), else BuyMissedFloor.

   Then total_tokens = the vault balance and state SETTLED.
7. `transfer_pool_creator` (bot → fee_dest), then close the pot's wSOL (its rent goes back to the bot).

If any check fails, the whole tx reverts and the pot stays intact. After GRACE, `fail` opens refunds.

## Flows

- **Happy path:**
  1. Open, which the creator pays for: open_presale, then delegate the presale, then delegate the creator seat, all in one tx.
  2. Joins, each paid by its user: join + delegate, in one tx.

  The entry and its delegates must share a tx. A seat is created with commit 0, and settle_seat on a commit-0 seat is permissionless, so a cranker could settle it home (and take a fee from the deposit) in the gap between a separate open or join and its delegate. The co-signer only signs these exact shapes, with the presale delegated before the seat (delegate(seat) reads the validator that delegate(presale) writes).
  3. Free commits in the ER, until the last one hits 10 SOL and makes it FULL.
  4. The bot runs commit_presale and commit_seats in the ER.
  5. The bot settles every committed seat on L1.
  6. The bot sends the launch tx.
  7. The bot claims for every seat.
  8. close_presale.
- **Withdraw:** set_commit 0 (free), then leave (free), then settle_seat (the user signs it themselves, or the bot does it for a fee share taken from the refund).
- **Expiry:** at the deadline anyone can run expire, then commit_presale and commit_seats, then settle_seat for each seat. Every step is permissionless, so a buyer can do all of it without the bot.
- **Failed launch:** fail after GRACE, then settle_seat refunds everyone.
- **ER down:** MagicBlock's own recovery applies (a timeout, then undelegation back to the last commit). This is out of our control and noted as a trust assumption.

## Who pays

| cost | payer |
|---|---|
| Presale and creator seat rent, and the delegation of both | creator (the rent returns at close / claim; the MagicBlock fee does not) |
| Seat rent, the join tx and seat delegation | the user (the rent returns at claim / refund) |
| Commits and changes inside the ER | free (the ER charges 0) |
| Exit to Solana (commit + undelegate) | the validator pays its own exit tx; MagicBlock's per-session fee comes out of the delegation deposit |
| Settle txs on a full presale | the pot (the TX_FEE share) |
| Launch tx rents and fee | the pot, reimbursed to the bot, capped |
| Token delivery (buyer ATA + claim tx) | the pot (the delivery reserve) |
| Refund txs | out of each refund, only when someone else cranks it |
| Program deploy | Mooner, once; recoverable by closing the program |

## Security invariants

- A seat's lamports on L1 only ever go to `seat.user`, or to the Presale for exactly `commit` while FULL.
- The ER can't move SOL; it only writes ledger numbers, and each seat's deposit caps its commit.
- Only `release` takes SOL out of the Presale for a launch. That SOL can only go to the one-time pot's wSOL (which must end at zero, spent on the one swap into our vault) or to the bot, capped at the measured rents plus LAUNCH_TX_FEE, never above LAUNCH_COST_CAP.
- A stolen bot key can:
  - launch on the wrong config: blocked by the dbc_config check;
  - skip the fee destination: blocked by the transfer_pool_creator check;
  - take more than the capped cost.

  All of these fail.
- A stolen gate key can only let people in. It can't move money.
- Every exit path works without the gate, the bot or the admin.

## Off-chain

- **engine/** (Node ESM, @solana/web3.js 1, the MagicBlock SDK): PDAs, instruction builders, account decoders.
  - A **bot** loop, following MagicPad's keeper lanes: expire, commit home, settle seats, launch, claim, fail, close.
  - A **co-signer**. It signs only `open + delegate(presale) + delegate(creator seat)` and `join + delegate(seat)`, with compute-budget instructions allowed and nothing else (see Flows). Opens are limited to an openers list; anyone can join.
  - A **devnet canary** that runs the whole happy path and the expiry path against the MagicBlock devnet ER and DBC on devnet. With `--server` it goes through the real server.
- The DBC launch-ix builders are ported from `launch-test/launch.py` and `dbc_layout.py`.

### The server (`engine/server/`, closed beta)

One Node process, `npm run server` in engine/. It runs the gate, the mint issuer and the keeper. Beta decisions (the user's): anyone joins, only wallets on the list open; images and metadata go to IPFS through Pinata; it runs on the user's Mac first, and is built to move to a host later.

- **Before serving**, it checks the chain:
  - the program is deployed;
  - the Config's gate, bot and dbc_config match the key files;
  - the launch lookup table holds every launch key;
  - each ER endpoint's `getIdentity` is its validator (an unreachable one is left out; a wrong one stops the start);
  - Pinata accepts the JWT (required on mainnet);
  - the bot's `getProgramAccounts` scan works on this RPC.

  `--check` runs these checks and exits.
- **Mint keys** (`POST /api/mint`). A wallet on the openers list signs a text message (`signMessage`) with:
  - the name and symbol;
  - the sha256 of the image;
  - the sha256 of `[description, twitter, telegram, website]`;
  - the time, within 5 minutes.

  A signature works once. The server checks the image type from its bytes (PNG, JPEG, GIF, WebP; 2 MB at most). It pins the image, then the metadata JSON, and waits until the JSON loads over HTTP. It checks that the launch tx with this name, symbol and link fits 1232 bytes. Then it makes a mint keypair and stores it tied to that wallet, so the CA is known before the presale exists.

  Limits: 5 an hour per wallet, 20 an hour per IP, and at most 3 unopened tokens per wallet. Before refusing on that last limit, the server checks the chain for opens it missed.
- **Co-sign** (`POST /api/cosign`). The user signs first. The server:
  1. checks the shape (above) and the openers list for opens;
  2. signs with the gate, and for an open with the mint key, only if it was issued to that wallet;
  3. simulates with signature checks;
  4. sends and waits up to 45 s. The reply is 200 when confirmed, 202 when still pending.

  Limits: 30 a minute per IP, 10 per wallet.
- **Reads**:
  - `/api/presales` and `/api/presale/:key` show presales as users see them: the ER copy while delegated, with seats from the ER and home. A closed presale comes from the server's record.
  - `/api/info` gives the keys, the ER URLs (clients send ledger txs straight to the ER) and the numbers.
  - Also `/api/token/:mint`, `/api/wallet/:wallet/tokens` and `/api/health`.
  - Callers share one read for a moment: the list for 3 s, one presale for 2 s. RPCs rate-limit `getProgramAccounts`, and the keeper needs it too. A failed read isn't kept.
- **Keeper**: the bot's loop over every presale.
  - It scans (`getProgramAccounts`) every 10 s (`MOONER_SCAN_MS`), beside the ticks and never in front of them, and ticks the presales it knows every pass. An open the co-sign call confirms is handed to it straight away, so a new presale doesn't wait for the next scan. A presale is dropped once its tick finds it closed.
  - A presale whose tick fails backs off (up to a minute) while the others go on. A failed or stuck scan doesn't stop the ticks. A tick over 10 s is logged.
  - The bot's FULL lane launches as soon as the presale's own counters say every committed seat is settled, with no listing in front of it. If it settles seats itself, it reads the presale again and launches in the same tick. It looks for committed seats still in the ER only when the counters say some are missing. Late seats (joined after the lock) come home in the lanes after the launch.
  - Launches are recorded, and opens that confirmed after the co-sign call stopped waiting are picked up from the scan.
  - Why: two devnet runs through the server failed their presales instead of launching (the bot then refunded every seat, as designed). Public devnet answers `getProgramAccounts` with 429 after about ten calls in a burst. The RPC wrapper retries a 429 up to 30 times, so one listing can hold a tick for up to 77 s without an error.
    - Run 1: the keeper scanned every pass while the canary read the API every second. It committed the full presale home 35 s after it filled, and the 60 s canary grace ran out.
    - Run 2 (with the scan timer and the read cache): the commit went out within seconds, and the settle landed 24 s after the presale came home. Then 38 s passed with every seat settled, no send and no error, and the presale failed. In that build three `getProgramAccounts` calls ran in front of the launch: the keeper's scan, the late-seat listing and the home-seat listing. That build didn't time its ticks, so which one held it isn't recorded.
- **State**: `<dir>/server.db` (SQLite, 0600) holds the mint secrets, the token metadata and the launch records. Everything else is read from the chain. Keys, the record and the openers list live in the gitignored `engine/.mainnet/`.
- It binds to 127.0.0.1. To reach it from outside, run it behind a proxy or tunnel and set `MOONER_TRUST_PROXY=1`, so rate limits use the proxy's X-Forwarded-For entry.

## Testing

- **Program unit tests:** layout offsets and seat-size validation.
- **litesvm suite** (a standalone crate, as in MagicPad). ER instructions run on program-owned accounts, which is how the ER sees a delegated account:
  - config and gate: armed, open, forged, wrong key;
  - open and join;
  - set_commit: sizes, steps, cut to the room left, exact fill → FULL, the creator can't lower, deposit ceiling, after deadline, after full;
  - expire;
  - settle_seat: all three cases, fee shares, double settle;
  - release and settle, using DBC's program and config dumped from mainnet as fixtures:
    - the happy path;
    - a wrong config;
    - a missing transfer_pool_creator;
    - two swaps;
    - a cost-cap breach;
    - a released amount off by one;
  - claim: pro rata, remainder to the last claimer, the ATA funded from the pot, a double claim;
  - fail and close.
- **Devnet canary:** the delegation and commit paths, which litesvm can't run, end to end.

## Rollout

1. litesvm green.
2. Devnet deploy and canary, with the happy path and the expiry path.
3. The user runs the mainnet deploy.
4. One closed-beta mainnet presale.

## Also changed by this spec

The wireframe spec (`2026-09-24-mooner-wireframe-design.md`) changes as follows:
- the timer is 1 hour everywhere;
- "Free / Mooner pays every fee" becomes: joining is one Solana tx the user pays (the network fee plus MagicBlock's delegation fee; the rent comes back); changing and withdrawing inside the presale are free; the refund arrives through one Solana settle.

## Not in this phase

- The fee router: fee destinations for buyers or holder rewards.
- Top-ups above a seat's deposit (MagicPad's note pattern); to raise it, you leave and rejoin.
- Find Match's "bot opens a presale". The creator pays the open cost and can't withdraw, so a bot creator would mean Mooner paying. It needs a decision in the matchmaking spec.
