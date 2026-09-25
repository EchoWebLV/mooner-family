# Mooner presale engine — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkboxes.

**Goal:** build the on-chain presale program from `docs/superpowers/specs/2026-09-25-mooner-presale-engine-design.md`, a litesvm suite that proves it (including a real DBC launch from mainnet fixtures), and the Node engine that drives it on devnet.

**Architecture:**
- a native Solana program (`programs/presale`), built with solana-program 4.0 and ephemeral-rollups-sdk 0.16.2, in the same dependency set as the devnet-proven `launch-test/er-speed`;
- the launch half is ported from the mainnet-proven `launch-test/presale-program`;
- the tests are a standalone litesvm crate, as in MagicPad;
- the engine is Node ESM using @solana/web3.js 1.

**Tech stack:** Rust (cargo-build-sbf 4.1.0), litesvm 0.13.1, Node 22.

---

## Changes to the spec found while planning (applied to the spec in Task 0)

1. **Presale grows to 272 bytes. The new field is `settled_sum` at offset 259, spare moves to 267 (5 bytes).**
   - A FAILED refund of a settled seat has to share `fees_paid` over the commits that were actually settled, not over `raised`. Seats that never settled don't sit in the Presale.
   - With the old formula, `Σ payouts = S − F·S/R`, which is more than the `S − F` the Presale holds whenever S < R.
   - New formula: payout = `commit − ceil(fees_paid × commit / settled_sum)`. That keeps `Σ payouts ≤ S − F`.
2. **Home guard (MagicPad's ER-lane fix).** A delegated account looks program-owned inside the ER, so every L1-only instruction that writes a Presale or a Seat also takes that account's MagicBlock delegation record, `["delegation", account]` under `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`, and requires it to be empty. Verified in the SDK: the delegation program's `undelegate` keeps the delegated account's lamports, and it takes its fee from the record and metadata rent (`processor/fast/undelegate.rs`). So a seat's escrow arrives home whole.
3. **settle_seat, commit == 0** doesn't read the Presale at all. The seat's own PDA check (`["seat", seat.presale, seat.user]`) is enough. That keeps withdraw refunds working even after the Presale is closed.
4. **close_presale on SETTLED** burns any tokens left in the vault before closing it. Otherwise one stray token sent to the vault would block the close forever.
5. **delegate kind 0 requires OPEN**, so a Presale can never go back into the ER after it leaves. That is why `claim` and `settle` don't need the home guard.
6. **set_config** can also rotate `admin`.

## File structure

```
.gitignore                         keypairs, .env, target/, node_modules/, fixtures/*.so
programs/presale/
  Cargo.toml                       standalone crate; deps as launch-test/er-speed
  src/lib.rs                       entrypoint + dispatch on the tag byte / undelegate callback
  src/consts.rs                    numbers, program ids, discriminators, tags
  src/state.rs                     Config / Presale / Seat: load (owner + PDA + version) and store, offsets
  src/util.rs                      pda + home guard, gate, rent, ix-sysvar helpers, fee share, lamport moves
  src/admin.rs                     0 init_config, 1 set_config
  src/entry.rs                     2 open_presale, 3 join, 4 delegate
  src/ledger.rs                    11 set_commit, 12 rotate_key, 13 leave, 14 expire, 15 commit_presale, 16 commit_seats
  src/settle_seat.rs               5 settle_seat
  src/launch.rs                    6 release, 7 settle
  src/finish.rs                    8 claim, 9 fail, 10 close_presale
programs/presale/litesvm/
  Cargo.toml                       standalone [workspace], MagicPad's pinned versions
  fixtures/fetch.sh                dumps dbc.so + the Mooner DBC config from mainnet
  fixtures/dbc-config.json         HnKg7Vb2… account (committed; small)
  tests/common/mod.rs              svm setup, PDAs, ix builders, decoders, DBC builders
  tests/config_gate.rs  tests/entry.rs  tests/ledger.rs  tests/settle_seat.rs
  tests/launch.rs       tests/finish.rs
engine/
  package.json                     ESM; @solana/web3.js 1, @magicblock-labs/ephemeral-rollups-sdk
  src/layout.js                    offsets + decoders (mirror of state.rs)
  src/pdas.js  src/ix.js  src/dbc.js    PDAs, presale ix builders, DBC builders (port of launch.py)
  src/bot.js                       keeper lanes: expire, commit home, settle, launch, claim, fail, close
  src/cosigner.js                  gate co-signer stub (allowlist)
  scripts/canary.js                devnet: happy path + expiry path
```

## Instruction interface (the contract between the program, the tests and the engine)

`s` = signer, `w` = writable. `rec(X)` = the delegation record of X.

| # | ix | accounts | data after the tag |
|---|---|---|---|
| 0 | init_config | authority s w, config w, program_data, system | admin 32, gate 32, bot 32, dbc_config 32 |
| 1 | set_config | admin s, config w | admin 32, gate 32, bot 32, dbc_config 32 |
| 2 | open_presale | creator s w, gate_signer, config, mint s, presale w, seat w, system | fee_dest 32, session_key 32, deposit 8, commit 8 |
| 3 | join | user s w, gate_signer, config, presale, seat w, system | session_key 32, deposit 8 |
| 4 | delegate | payer s w, pda w, owner_program, buffer w, record w, metadata w, delegation_program, system, validator, presale (kind 1) | kind 1 |
| 5 | settle_seat | cranker s w, seat w, rec(seat), user w, presale w, rec(presale), ix_sysvar | — |
| 6 | release | bot s w, config, presale w, rec(presale), pot, pot_wsol w, mint, pool, base_vault, quote_vault, presale_vault, ix_sysvar | — |
| 7 | settle | presale w, config, presale_vault, pot_wsol, ix_sysvar | min_tokens 8 |
| 8 | claim | cranker s w, presale w, seat w, user w, presale_vault w, user_ata w, mint, token22, ata_program, system, ix_sysvar | — |
| 9 | fail | presale w, rec(presale) | — |
| 10 | close_presale | presale w, rec(presale), creator w, presale_vault w, mint w, token22 | — |
| 11 | set_commit | signer s, seat w, presale w | amount 8 |
| 12 | rotate_key | user s, seat w | session_key 32 |
| 13 | leave | payer s w, seat w, magic_program, magic_context | — |
| 14 | expire | presale w | — |
| 15 | commit_presale | payer s w, presale w, magic_program, magic_context | — |
| 16 | commit_seats | payer s w, presale, magic_program, magic_context, seat w … | — |
| cb | undelegate callback `[196,28,41,206,48,37,51,167]` | pda w, buffer, payer w, system | borsh Vec<Vec<u8>> seeds |

Notes:
- `gate_signer`: when config.gate is all zeros, any account works and it doesn't need to sign. Otherwise it must be config.gate and must sign.
- A `presale` read in the ER or from a raw L1 snapshot is verified by `["presale", data.mint, data.bump]`. Its owner may be the delegation program only where the spec reads a snapshot: join, delegate kind 1, and settle_seat with commit == 0.

## Tasks

### Task 0: repo hygiene and spec sync
- [ ] Add a root `.gitignore`: `.env*`, `*keypair*.json`, `**/target/`, `node_modules/`, `programs/presale/litesvm/fixtures/*.so`, `.claude/`, `launch-test/`. launch-test holds live keypairs and stays untracked.
- [ ] Apply the spec changes 1–6 above to the design doc.
- [ ] Commit: `docs: presale engine plan; spec: settled_sum, home guard`.

### Task 1: program scaffold, constants and layouts, with unit tests
- [ ] `programs/presale/Cargo.toml`, with deps as er-speed plus `[profile.release] overflow-checks = true`.
- [ ] `consts.rs`, `state.rs` with offsets as `const`s, `util.rs` with `valid_seat(amount)`.
- [ ] Unit tests (`cargo test`, host):
  - the offsets and lengths (Config 130, Presale 272, Seat 120);
  - `valid_seat`: 0.1 and 1.0 pass; 0.09, 1.01 and 0.105 fail;
  - `fee_share(10_000, 3) == 3_333`;
  - the refund formula at S < R stays solvent.
- [ ] `cargo build-sbf` succeeds.
- [ ] Commit.

### Task 2: litesvm harness
- [ ] Create the `litesvm/` crate. `fresh_svm()` loads `../target/deploy/mooner_presale.so` and writes ProgramData with an upgrade authority. litesvm writes `None` there, so the harness patches bytes 12..45 of ProgramData.
- [ ] Add `fixtures/fetch.sh` (`solana program dump` of DBC, `solana account` of the config), and load both.
- [ ] Add the builders for every ix in the table, the decoders, `send`, `warp_to`, and `assert_err`.
- [ ] Commit.

### Task 3: config and gate (tests/config_gate.rs)
- Tests:
  - init by the upgrade authority passes;
  - init by anyone else fails;
  - a second init fails;
  - set_config by admin passes, by others fails;
  - open with the gate armed needs the gate signature;
  - with an all-zero gate, open passes without it;
  - a forged gate key fails.
- [ ] Red → implement admin.rs + gate → green → commit.

### Task 4: open and join (tests/entry.rs)
- Tests:
  - open writes every Presale and Seat field;
  - raised = commit; deadline = now + 3600;
  - lamports = rent + deposit;
  - the mint must sign;
  - commit 0.105 fails;
  - deposit < commit fails;
  - join creates the seat: deposit bounds, and the session key can't be zero;
  - join fails after the deadline, on a non-OPEN presale, and when the seat already exists;
  - join reads a presale whose owner is the delegation program (simulated by `set_account` with owner = DLP).
- [ ] Red → implement → green → commit.

### Task 5: ledger inside the ER (tests/ledger.rs)
These run on L1 in litesvm on program-owned accounts, which is what the ER sees.

- **set_commit:**
  - session key and wallet pass; a stranger fails;
  - bad sizes, and more than the deposit, fail;
  - the creator can't lower;
  - a commit is cut to the room left;
  - with no room left it fails;
  - an exact fill → FULL with full_ts;
  - a set after the deadline or after FULL fails;
  - 0 → seats_committed goes down;
  - 0 → x goes up.
- **rotate_key:** only the wallet can rotate; after rotation the old key fails and the new key passes.
- **expire:** before the deadline it fails; after it → EXPIRED; twice fails.
- **leave, commit_presale, commit_seats:**
  - the precondition failures are asserted: leave with commit > 0, leave by the creator, commit_presale while OPEN, commit_seats while OPEN, and a seat from another presale;
  - the success paths need MagicBlock and are covered by the canary.
- [ ] Red → implement ledger.rs → green → commit.

### Task 6: delegate (entry.rs)
litesvm has no delegation program, so these tests assert the precondition failures:
- kind 0 by a non-creator;
- kind 0 when not OPEN;
- kind 1 by a non-user;
- kind 1 with a validator mismatch;
- kind 1 when the presale has no validator.

The CPI itself is covered by the canary.
- [ ] Implement → green → commit.

### Task 7: settle_seat (tests/settle_seat.rs)
- **The four cases:**
  - commit 0 → full refund and close;
  - FULL → commit to the presale, the excess to the user, settled_sum, seats_settled;
  - EXPIRED → full refund and seats_refunded;
  - FAILED + settled → `commit − ceil(F·c/S)`.
- **Fee rules:**
  - the cranker's share = TX_FEE / (same-tag ixs), from the refund, or from the pot when FULL;
  - self-crank pays no fee.
- **Failures:**
  - a double settle fails;
  - the wrong user account fails;
  - a non-empty delegation record fails (a record account is set with data);
  - a presale owned by DLP with commit > 0 fails.
- [ ] Red → implement → green → commit.

### Task 8: release + settle, a real DBC launch (tests/launch.rs)
- **The happy path:**
  - a full presale of 10 seats settles;
  - one tx runs init_pool (bot) → pot wSOL ATA → vault ATA → release → sync_native → swap2 (pot, with the sysvar) → settle → transfer_pool_creator → close the pot's wSOL;
  - checks: state SETTLED; total_tokens = the vault balance; the pool creator = fee_dest; the bot got exactly the rents + LAUNCH_TX_FEE; `released` is as the formula says.
- **Each of these makes the tx fail:**
  - a wrong DBC config;
  - no transfer_pool_creator;
  - transfer_pool_creator to the wrong key;
  - two swaps;
  - swap2 amount = released − 1;
  - a release without a settle;
  - release by a non-bot;
  - not all seats settled;
  - the cost cap breached (by lowering the cap? No: the cap is a constant, so the test builds a tx whose mint account is oversized. If DBC doesn't allow that, assert the cap arithmetic in a unit test).
- [ ] Red → port release and settle from launch-test/presale-program with the new checks → green → commit.

### Task 9: claim, fail, close (tests/finish.rs)
- **claim:**
  - pro rata;
  - the last claimer gets the remainder;
  - a missing ATA is funded from the presale (the cranker's balance changes only by the fee share it earns);
  - an existing ATA passes;
  - a double claim fails;
  - the wrong ATA fails;
  - a seat that isn't settled fails.
- **fail:** before grace it fails; after grace → FAILED; then refunds work (Task 7 case).
- **close_presale:**
  - SETTLED with all seats claimed → the vault is burned and closed, and rent and dust go to the creator;
  - EXPIRED with all refunded → closes;
  - with a seat still open it fails.
- [ ] Red → implement → green → commit.

### Task 10: engine (Node) and the devnet canary
- [ ] `engine/src/*`: mirror the table above, plus the DBC builders ported from launch.py.
- [ ] `bot.js`: one loop, one lane at a time:
  1. OPEN past the deadline → expire (ER);
  2. FULL or EXPIRED in the ER → commit_presale + commit_seats;
  3. home and FULL → settle_seat, in batches;
  4. all settled → launch tx (v0 + ALT);
  5. SETTLED → claim, in batches;
  6. FULL past grace → fail;
  7. everything done → close.
- [ ] `canary.js` on devnet:
  - deploy with a fresh keypair, then init_config;
  - happy path: the creator plus throwaway users, funded from the devnet payer, fill 10 SOL. The canary's own config uses devnet amounts, because devnet SOL is scarce. The program is identical, and the TARGET is a compile-time feature `canary` = 0.5 SOL with MIN and MAX scaled down, used only for the canary build.
  - expiry path: `canary` DURATION = 120 s.
- [ ] Commit, then report the devnet results.

## Self-review
- **Spec coverage:**
  - each spec instruction maps to a task: 0–1 → T3, 2–4 → T4/T6, 5 → T7, 6–7 → T8, 8–10 → T9, 11–16 → T5, callback → T10 canary;
  - the who-pays rows are asserted in T7, T8 and T9;
  - the security invariants map to T7 (lamports only to the user or the presale), T8 (bot cap, config, fee_dest) and T3 (the gate can't move money: no gate account on any money path).
- **Open items the build must verify:**
  - DBC runs in litesvm from the dumped fixtures (T8);
  - ATA 1.1.1 in litesvm accepts a pre-funded address (T9);
  - `transfer_pool_creator` has no restriction that breaks the launch tx (T8);
  - the launch tx size with ALTs (T10).
