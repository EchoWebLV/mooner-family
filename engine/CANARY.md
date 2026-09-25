# Canary results

The canary runs real presales end to end, driven by the real bot (`scripts/canary.js`).
The canary build is the same program with small numbers: target 0.2 SOL, seats 0.01–0.1
SOL in 0.001 steps, a 120 s timer and a 60 s grace.

## How to run

```bash
npm test
```

```bash
RPC_PORT=8999 scripts/local-validator.sh
```

```bash
node scripts/canary.js --cluster local --rpc http://127.0.0.1:8999
```

```bash
npm run canary
```

- `--path happy|expiry|all` picks a path. `--resume <mint>` picks up a stopped happy run at
  the bot's half.
- `--server` (devnet only) runs the paths through the real server (`server/main.js`) instead
  of the canary's own bot. The server issues the mint, co-signs the opens and joins, and its
  keeper runs the presale to the end. The canary starts it on a free port with a fresh
  database and an openers list of the creator and E, then checks that a wallet not on the
  list gets no mint. It reads the result from the server's API. The server's log goes to
  `.canary/devnet/server-<time>.log`. Tokens get a placeholder link: nothing is pinned.
- On devnet's free faucet the payer runs short with `--path all --server`. Run
  `--path happy` and `--path expiry` one after the other: each run sweeps the test wallets
  back to the payer.
- On devnet it deploys the canary build if it is missing. The payer is
  `launch-test/er-speed/devnet-payer-keypair.json`.
- Keys, run state and JSON reports go to `engine/.canary/<cluster>/`, which is gitignored.

## Devnet through the server, 2026-09-25: 18/18 checks passed

Same program, gate and bot as below. The presales ran through `server/main.js` (`--server`):
the server issued each mint, co-signed each open and join, and its keeper ran each presale to
the end. The canary only played the users.

### Happy path (13/13)

- Mint (CA): `B2naUeynQVrHHyhEDKpKcxrmQaadxTK4cUxeXaW8M4Ai`, issued by the server before the open
- Presale: `8GecJ3sojuUeoN7iqpthkA5honscBWe6P8p5oQq2a2xk`
- Pool: `6oD2cBJMs8mBZJcuRWTGKJTeLHSQKaMnakCnga7qXtYJ`
- Launch: `5iUf7rSpSbUxGD9oScPRXVxUFtGEp93XR5qayKkt6ktBsVAnhKbmFjqo4mKAP4jyHG7YNHQjUpdtTpvB5QHTecJR`
  (released 0.1838988 SOL, cost 0.00999584 SOL, 6,463,279,851,771 tokens, 220,275 CU)

What it showed:
- A wallet not on the openers list got a 403 from `/api/mint`.
- The open and the four joins went through `/api/cosign`. The keeper was ticking the presale
  1 s after the open's block time. (A 10 s scan was also due then, so this run doesn't show
  which one handed it over; the server tests cover `watch()`.)
- `/api/presale/:key` showed FULL with the four seats, then SETTLED, then CLOSED with the
  launch on record.
- Block times (UTC): presale home 18:30:55, settle 18:31:13, launch 18:31:16, then the claims
  and the close. The settle and the launch went out in the same keeper tick.
- Every check of the direct runs held: the claimed tokens add up to what the pot bought, the
  pro-rata split, `min_tokens`, the pool's creator is fee_dest, and everything closed.

### Expiry path (5/5)

- Mint (CA): `HHE4L4h5YbrvEv2pQ8oSr8uPens24ZyTNhNJedsTXQKy`
- The keeper expired the presale in the ER when its 120 s timer ran out. Then it committed
  the 3 seats home, refunded them and closed the presale. E, F and G lost only fees (0.000618,
  0.000313 and 0.000313 SOL).

### Two runs before that failed their presales (refunded, as designed)

Public devnet answers `getProgramAccounts` with 429 after about ten calls in a burst. The RPC
wrapper retries a 429 up to 30 times, so one listing can hold a tick for up to 77 s with no
error. The canary grace is 60 s.

- **Run 1.** The keeper scanned every pass, and the canary read the API every second. The
  keeper committed the full presale home 35 s after it filled; the grace ran out before the
  launch.
  - Fix: the keeper scans every 10 s, and the API hands it each open. API reads are shared
    for 2–3 s.
- **Run 2.** The presale came home at 18:22:50 and the settle landed at 18:23:14. Then 38 s
  passed with no send and no error, and the fail landed at 18:23:52. In that build three
  listings ran in front of the launch: the scan, the late-seat listing and the home-seat
  listing. The build didn't time its ticks, so which one held it isn't recorded.
  - Fix: the bot's FULL lane launches as soon as the presale's counters say every seat is
    settled, with no listing first. After a settle, it reads the presale again and launches in
    the same tick.
  - Fix: the keeper's scan runs beside the ticks, never in front of them. Ticks over 10 s are
    logged.
  - Fix: the canary reads the API every 5 s.

On mainnet the grace is 900 s and the server should use a paid RPC. These fixes keep the
launch off the throttled call either way.

## Devnet, 2026-09-25, after the security fixes: 13/13 checks passed

This run uses the fixed program and engine:
- the launch tx has a fresh pot key (3 signers);
- settle reads the pool back to check the 1% floor fee;
- release plans from the ledger;
- claims carry a memo;
- only MagicBlock's 3 validators are accepted.

The old canary program (`5eaEHXi1…`, the run before the fixes) was closed to pay for this deploy. A closed program id can't be used again, so devnet now keeps its own program key in `.canary/devnet/`.

- Program: `PfkvjTuwQEohpNXTZAutUG3Q2x8wPNfV7sU1VDtxcpE` (canary build, 295,320 bytes)
- DBC config (Mooner params): `7a7A9ydLL8DeDbbrsdBfTGwcqVuGbyfK6wQyosbR9GzD`
- Gate: `5g5HBpFLvozLDJssb4CxiidKmsTfkSBjis1PpzncTwM2`
- Bot: `BLfKaNXYfwatnt9Csn6K4gatHKiTDbCWwzRjCJDySuGY`
- Launch lookup table: `9gsGYJfUaAT5DXgoyPDJhwygRrKRt19M4L8dT7F81Dej`
- ER: MagicBlock devnet-as (`MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`)

### Happy path (9/9)

Mint `4t6MYTwvLGxEGLG6mS77dLW9hwauPRwVBsXPd3kQXBAV`, presale
`2nHxZANo6wG4LDNs96ZT2c22udteoT1Y6Hj8UpuSCBKG`, pool
`8NJq7ocEadEN4FH5HudouVb45puQUa4XiYYbxqKjnEGs`.

1. The creator opens with 0.05. The open, the presale delegate and the seat delegate are one tx:
   `5u7x18oDaLFVZ4C3bsMDF2jwaxzs5ugNjpH3ob47BNAMM7kMurNdRTf71DWzmKHzMQxiYiSB4pp1qeYDiKSd7M2f`.
2. A, B, C and D each join and delegate in one tx, co-signed by the gate.
3. In the ER:
   - A commits 0.05 through a session key that holds 0 SOL.
   - B commits 0.03, drops to 0, and leaves. B settles its own seat (a refund with no bot fee).
   - C rotates its session key and commits 0.04 with the new key.
   - D asks for 0.1 and gets cut to 0.06. The presale locks FULL at exactly 0.2.
4. From there to fully closed, the bot took 30 s:
   - `commit_seats` ×4 and `commit_presale` in the ER;
   - `settle_seat` ×4;
   - the launch tx;
   - `claim` ×4;
   - `close_presale`.
5. Launch tx:
   `4KZjWrikG8hA2iyxZd1AhEUdBtRaughxZao1bkjagsAmipcJuKYpNkFhmkaKFDiHzwrRJLRufjdWcuLQUpkzayL6`.
   - It is v0 with one lookup table and 3 signatures: the bot, the mint, and a one-time pot
     key (`5PKPN2ie…`).
   - It used 234,325 CU and paid a 15,000-lamport fee.
   - Released to the pot: 0.18395468 SOL.
   - Launch cost, taken from the pot: 0.00993996 SOL (rent of the new accounts plus the fee
     allowance).
   - The pot bought 6,465,232.054908 tokens, exactly what the dry run quoted.
   - The pot paid DBC exactly the 1% floor: 1,839,547 of 183,954,680 lamports (read back from
     the pool's quote reserve).
6. Checks:
   - the claims add up to every token the pot bought;
   - 3 of 4 seats got exactly total × commit / raised, and the last one took the rounding rest;
   - the pool's creator (and its fee share) is fee_dest;
   - the presale, the vault and every seat are closed.

Spend per wallet (the commit, plus fees):

| wallet | spent | notes |
|---|---|---|
| A, C, D | commit + 0.00031 | join tx 10,000 lamports + MagicBlock 300,000 |
| B (left) | 0.000315 | join + MagicBlock + its own settle tx; nothing committed |
| creator | 0.049071 | commit 0.05; it gets the presale's leftover lamports back at close |

### Re-run after the review fixes (13/13)

These fixes are in the bot and the tx sender only; the program was unchanged:
- one re-read counts the seats before a close;
- the crank reports what it really sent;
- a send stops once history shows the tx landed.

The run passed 13/13 again with the same numbers:
- the same tokens (6,465,232,054,908);
- the same release;
- the same spend per wallet.

Launch
`eyPNnEnUzYApE3HbJbaJRK7zGx616yfUYx9bXc4y9vxyHuzLrQZvWVddRLETT5qi1joZDwp8JALfjVxBVqJY4y2`
(229,825 CU). Report `.canary/devnet/report-1790347849869.json`.

### Expiry path (4/4)

Mint `26snphSLFKHn1ogp6cfP18KtZ4x37B6amjCzSefX1nBz`, presale
`G5CSRsdCwnZzD7eoS2gh1hZqUxC4R87Gur3sNBsRREp`.

- E opens with 0.05, F commits 0.02, and G joins but never commits.
- At the deadline the bot runs:
  - `expire` in the ER;
  - `commit_seats` ×3 and `commit_presale`;
  - `settle_seat` ×3 (refunds);
  - `close_presale`.
- Everything was closed 109 s after the joins.
- Nobody lost their deposit. The creator lost 0.000618 SOL and each joiner 0.000313 SOL, which
  is only tx fees and MagicBlock's fee.

## Devnet, earlier the same day (before the fixes): 13/13

This was program `5eaEHXi1YMQ18qDeZk1u1U5MAkYsfn5sHze1wNQhEqaC`, now closed. The launch tx
had 2 signatures (the bot was the pot) and paid 10,000 lamports. Launch
`rPfuJ57XrR2d421kzkpSKvAyotVgZpwCtc4YZRZCoGCfAs767xpr5wwWWT1XEkz3vvew9byp3kpqGMiK8c8GWRb`.

### Failed launch (not planned, but it ran for real, on the earlier program)

The first happy run stopped at FULL on a bot bug (see below). By the time the bot came back,
the 60 s grace had passed. The program would not launch late. Instead the bot ran:

- `commit_seats` ×4 and `commit_presale`;
- `fail`: `6677HJeEjY7Eon7WC2CKZEHM5QVcvdGf1p7MbzyLBpm3WjScBSYrrVDfSrVMWQzvEUyuyZuQuEp2t3voEMnki5SL`;
- `settle_seat` ×4 (full refunds);
- `close_presale`.

This took 20 s. Each joiner lost 312,500 lamports: the join tx, MagicBlock's fee, and a
2,500-lamport share of the bot's settle fee.

## What devnet answered

- **Open + both delegates in one tx works** with the real delegation program. So does join +
  delegate.
- **ER instructions are free.** A session key with 0 SOL can commit.
- **The undelegate callback works.** Seats and presales come back owned by our program, and
  the bot and users carry on from there.
- **MagicBlock's fee is 300,000 lamports per delegated account, paid by the wallet that
  delegated.** Each joiner pays for 1 account and the creator pays for 2. Mooner pays
  MagicBlock nothing.
- **The pot pays a flat 100,000-lamport launch fee allowance.** On devnet, with no priority
  fee, the tx now costs 15,000 (3 signatures), so the bot keeps 85,000. On mainnet some of
  this goes to the priority fee (capped by the allowance less the signatures).
- **In the earlier run, the bot ended the happy + expiry runs 94,999 lamports up.** That is
  exactly:
  - the launch allowance surplus, 90,000;
  - plus the settle and claim fee shares, minus the tx fees of those batches: +5,000,
    +5,000 and +4,999 (10,000 split 3 ways);
  - minus two `close_presale` tx fees, 10,000.

  So its ER txs cost it nothing. `close_presale` (and `fail`) tx fees are the bot's own,
  5,000 lamports each, and nothing reimburses them.
- **Rent on devnet and on mainnet today is 5,080 lamports per byte** (`solana rent`, both
  clusters). Deploying the program (295 KB) costs about 1.5 SOL of rent, not the 2.05 SOL
  estimated earlier. A local `solana-test-validator` still uses the old rate, which is why the
  local launch cost is 0.01358 SOL.

## Found and fixed on devnet

- The public devnet RPC's `getProgramAccounts` listed a seat that had already gone home and
  closed. One stale seat fails a whole `commit_seats` batch.
  - Fix: the bot now keeps only the seats the ER still holds as delegated seats of that
    presale (`Bot.liveInEr`).
  - Fix: the canary's bot loop retries a failed tick, as a keeper would.
- The canary grace is only 60 s, so the bot must run while a presale fills. The mainnet
  grace is 900 s.

## Not tested on devnet yet

- **The late-seat lane:** `commit_seats` for a seat that is still in the ER after its
  presale already went home. In every run, the seats went home before or with the presale.
- **Unfunded payers for the other ER instructions.** `leave`, `commit_seats`,
  `commit_presale` and `expire` were sent by wallets that hold SOL (they were not charged).
- **Priority fees on the launch.** Devnet ran with none.
- **A full-size presale:** 10 SOL with enough seats to fill the batches of 8 settles, 6 claims
  and 10 commits.

## Local (solana-test-validator, no ER): 13/13

Re-run after the security fixes, on a validator with mainnet's feature set: happy 9/9 and expiry 4/4. The launch tx had 3 signatures and the pot paid exactly the 1% floor fee (1,780,722 of 178,072,160 lamports). The ledger instructions run on Solana against home accounts. It
uses the mainnet DBC program and Mooner's mainnet DBC config from the litesvm fixtures.
