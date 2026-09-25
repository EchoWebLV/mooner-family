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
- On devnet it deploys the canary build if it is missing. The payer is
  `launch-test/er-speed/devnet-payer-keypair.json`.
- Keys, run state and JSON reports go to `engine/.canary/<cluster>/`, which is gitignored.

## Devnet, 2026-09-25: 13/13 checks passed

- Program: `5eaEHXi1YMQ18qDeZk1u1U5MAkYsfn5sHze1wNQhEqaC` (canary build)
- DBC config (Mooner params): `7a7A9ydLL8DeDbbrsdBfTGwcqVuGbyfK6wQyosbR9GzD`
- Gate: `5g5HBpFLvozLDJssb4CxiidKmsTfkSBjis1PpzncTwM2`
- Bot: `BLfKaNXYfwatnt9Csn6K4gatHKiTDbCWwzRjCJDySuGY`
- Launch lookup table: `DBMQewHaHPRFKKTZRGTamUMBbcqPGgiBuAFLofikkVEm`
- ER: MagicBlock devnet-as (`MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`)

### Happy path (9/9)

Mint `DHCSjdrJoF15yvtvqyrHZH3yT3yvomWHadaSMAZkQmE6`, presale
`7KVMR3LkRrRUAtmkF52JtDLbnfSfD5wYREssV4JhZEe4`, pool
`9KLPQW8hU82bYaJUeNfSZ3oB2sVSo23o3RKp2d1YQp3Z`.

1. The creator opens with 0.05. The open, the presale delegate and the seat delegate are one tx:
   `5BXGyj1yqZGd9Vn21n6bGZt9dvi7gz8VtKEucFCHC1KEU8QGN1AGoHHSc3U999Fv6Qm9fho1Bj8KURQstJb6su3d`.
2. A, B, C and D each join and delegate in one tx, co-signed by the gate.
3. In the ER:
   - A commits 0.05 through a session key that holds 0 SOL.
   - B commits 0.03, drops to 0, and leaves. B's seat was home 1.1 s later, and B settled it
     itself (a refund with no bot fee).
   - C rotates its session key and commits 0.04 with the new key.
   - D asks for 0.1 and gets cut to 0.06. The presale locks FULL at exactly 0.2.
4. From there to fully closed, the bot took 26 s:
   - `commit_seats` ×4 and `commit_presale` in the ER;
   - `settle_seat` ×4;
   - the launch tx;
   - `claim` ×4;
   - `close_presale`.
5. Launch tx:
   `rPfuJ57XrR2d421kzkpSKvAyotVgZpwCtc4YZRZCoGCfAs767xpr5wwWWT1XEkz3vvew9byp3kpqGMiK8c8GWRb`.
   - It is v0 with one lookup table and 2 signatures.
   - It used 218,638 CU and paid a 10,000-lamport fee.
   - Released to the pot: 0.18395468 SOL.
   - Launch cost, taken from the pot: 0.00993996 SOL (rent of the new accounts plus the fee
     allowance).
   - The pot bought 6,465,232.054908 tokens, exactly what the dry run quoted.
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

### Expiry path (4/4)

Mint `CptoEgS4nB7ejw9oiEMKpSEdiiXpv26JCsJrmC7wthNv`, presale
`42sAroXaVkFW61o9D79netEoUnW4g1Vn2Rc9adBsYufE`.

- E opens with 0.05, F commits 0.02, and G joins but never commits.
- At the deadline the bot runs:
  - `expire` in the ER;
  - `commit_seats` ×3 and `commit_presale`;
  - `settle_seat` ×3 (refunds);
  - `close_presale`.
- Everything was closed 115 s after the joins.
- Nobody lost their deposit. The creator lost 0.000618 SOL and each joiner 0.000313 SOL, which
  is only tx fees and MagicBlock's fee.

### Failed launch (not planned, but it ran for real)

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
  fee, the tx cost 10,000, so the bot kept 90,000. On mainnet some of this goes to the priority
  fee (capped by the allowance).
- **The bot ended the happy + expiry runs 94,999 lamports up.** That is exactly:
  - the launch allowance surplus, 90,000;
  - plus the settle and claim fee shares, minus the tx fees of those batches: +5,000,
    +5,000 and +4,999 (10,000 split 3 ways);
  - minus two `close_presale` tx fees, 10,000.

  So its ER txs cost it nothing. `close_presale` (and `fail`) tx fees are the bot's own,
  5,000 lamports each, and nothing reimburses them.
- **Rent on devnet and on mainnet today is 5,080 lamports per byte** (`solana rent`, both
  clusters). Deploying the program (293 KB) costs 1.49 SOL of rent, not the 2.05 SOL
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

Happy 9/9 and expiry 4/4. The ledger instructions run on Solana against home accounts. It
uses the mainnet DBC program and Mooner's mainnet DBC config from the litesvm fixtures.
