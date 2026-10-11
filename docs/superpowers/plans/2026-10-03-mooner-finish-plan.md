# Mooner: finishing for Clock In, with the rewards system — Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is the master plan: most items point at a task in an existing piece plan, or at a new piece plan this plan says to write first. A new piece plan is written with superpowers:writing-plans (full code, tests, commands) before anyone builds it.

**Goal:** A signed Android APK of Mooner running on the Seeker, with every piece the submission shows, plus a rewards system: trading fees split Meteora 20 / Mooner 40 / Dev 10 / KOL 10 / Raider 10 / Diamond Hands 10, alongside XP, titles and the Genesis perk. Then the submission itself: repo, demo video, pitch deck.

**Architecture:** The rewards system needs no program upgrade and no new DBC config. New presales name a Mooner rewards wallet as `fee_dest`, so at launch that wallet becomes the pool's creator and earns the creator's 40% of every fee. The server claims it, splits it four ways in a SQLite ledger, and each person takes their share with a "Get my rewards" transaction they sign and pay the fee for. XP stays as piece 6 planned it, with the KOL and Raider rules swapped to match the new roles.

**Tech Stack:** Node 22 (`node:sqlite`, `node:test`), `@solana/web3.js` 1.x, Meteora DBC (hand-built instructions in `engine/src/dbc.js`), React + Vite + zustand (web), Expo SDK 55 + MWA/Seed Vault (phone), Railway.

---

## Deadline (checked against the hackathon page)

- Submissions close **2026-10-09 09:59 EEST**.
- Required: a functional APK running on a device, a GitHub repo, a demo video (~3 min), a pitch deck.
- **Not required by the deadline:** the dApp Store listing. Winners must publish within 30 days of the results.
- Judging: 25% each for stickiness/PMF, UX, innovation, presentation. Bonus: $10k in SKR for the best SKR integration. Staking doesn't count; "in-app purchases, rewards, access" do.

## Where things stand (checked 2026-10-03)

| What | State |
|---|---|
| HEAD | `e64bb49` on `feat/mooner-wireframe`. 137 commits ahead of `origin/main`; the branch isn't on GitHub |
| Tests | engine 466/466, mobile 258/258, web 51/51 |
| Production | `POST /api/rpc` answers **404**: the RPC proxy (e64bb49) isn't deployed. The site's refunds, costs, balances, trades and Privy stay broken in browsers until it is |
| Alchemy | Both networks answer "SOLANA_MAINNET/DEVNET is not enabled for this app" |
| Phone | `adb devices`: none |
| Signing key | `~/.gradle/gradle.properties` missing, `~/mooner-keys` empty |
| Pieces 1–2 (core, trade) | built |
| Piece 3 (share links) | built; Task 10 (yours) and Task 11 left |
| Piece 4 (create) | Task 7 device steps 4–11, Task 8 (yours), Task 9 (yours, optional), Task 10 left |
| Piece 5 (push, follow, auto-join) | Tasks 1–3 in; Task 3's small fixes, then Tasks 4–16 (Task 15 is yours) |
| Piece 6 (XP + Genesis) | plan written (18 tasks), uncommitted, waiting on your answers |
| Piece 7 (SKR join) | no plan |
| Piece 8 (submission kit) | no plan |
| Rewards (fee split) | new, designed below; no plan yet |

## The rewards system

### What happens to fees today (verified)

- Meteora's DBC takes **20% of each trading fee** as its protocol fee (Meteora docs, "DBC Fees Overview"). The referral share comes out of that 20%, not on top of it.
- The other 80% splits by `creatorTradingFeePercentage`. Mooner's config sets it to 50 (`engine/src/dbc.js`), so:
  - **the partner gets 40% of the fee**: Mooner, claimed by the config's fee claimer `4aieXRzn…` (`engine/src/consts.js:37`). That key isn't in `engine/.mainnet/` or `launch-test/`;
  - **the pool creator gets 40%**.
- The pool creator is the presale's `fee_dest`. The launch tx must contain `transfer_pool_creator` to `fee_dest`, or the program refuses it (`programs/presale/src/launch.rs:202`). `engine/src/bot.js:70` sends it.
- Today the web and the phone set `fee_dest` to the creator's own wallet (`engine/src/flows.js:377`), and the co-signer doesn't check it (`engine/src/cosigner.js:75-79`). So today the Dev gets the whole 40%.
- Fees are paid in SOL. Creator fees are claimed with `claim_creator_trading_fee`. `launch-test/claim.py` has the instruction's exact accounts, and reads the pool's creator fee at byte 352.
- At migration to DAMM v2 (80 SOL), the LP splits partner 40% + 10% locked, creator 40% + 10% locked (`dbc.js`). Today a Dev could withdraw an unlocked 40% of the LP right at migration.

### What it becomes (your split, 2026-10-03)

| Share of each fee | Who | How |
|---|---|---|
| 20% | Meteora | protocol fee, unchanged |
| 40% | Mooner | the partner fee, unchanged (`4aieXRzn…` claims it) |
| 10% | Dev | a quarter of the creator fee |
| 10% | KOL | a quarter of the creator fee |
| 10% | Raider | a quarter of the creator fee |
| 10% | Diamond Hands | a quarter of the creator fee |

- **One change makes this possible:** new presales set `fee_dest` to a **Mooner rewards wallet** (a new server key, held like the launch bot's). The co-signer refuses an open whose `fee_dest` is anything else. At launch, the program makes that wallet the pool's creator, so it earns the creator's 40%.
- No program upgrade, no new DBC config, no new lookup table.
- **The migration risk goes away too:** the creator's LP lands in the rewards wallet, not with the Dev (decision R5 below says what Mooner does with it).
- Presales opened before the change keep their creator as `fee_dest`: those Devs keep the full 40% on their coins (R8).
- Example: a coin trades 10 SOL after the snipe tax at the 1% floor, so 0.1 SOL in fees. Meteora 0.02, Mooner 0.04; Dev, KOL, Raider and Diamond Hands 0.01 each.

### Who gets each role's 10% on a coin (recommended rules; R1–R4 confirm them)

All of these are checkable from Mooner's own records and the chain:

- **Dev:** the coin's creator (the presale's `creator`). All of it.
- **KOL (a caller):** wallets whose Mooner link brought confirmed joins into that coin's presale. Shared pro rata by the SOL those joins put in (seats with SOL in at launch).
  - A KOL posts their link wherever they call coins: GMGN, Axiom, pump.fun, Fomo, X. The link counts on every one of them.
  - This is how pump.fun pays its callers: by the buying their callout drives, not by price.
  - Self-referral is already refused (`engine/server/api.js:83`), and one referrer per seat (`referrals.js`).
- **Raider (a backer):** every seat with SOL in at launch, except the creator's own. Shared pro rata by seat SOL.
- **Diamond Hands (a holder):** at each split, the presale wallets still holding at least their seat's token share. Shared pro rata by that share; holding more doesn't earn more, so a whale can't buy in for a bigger cut.
  - Read from each wallet's associated token account (one `getMultipleAccounts` call per 100 wallets). Claims deliver there.

### How calls on GMGN, Axiom, pump.fun and Fomo can be read (research, 2026-10-03; Fomo re-checked on chain)

Calls do travel between platforms. GMGN is the hub, and Fomo's trades are visible on chain:

| Platform | What a call is | How Mooner can read it |
|---|---|---|
| GMGN | A callout (wallet + linked X), plus `kol`/`renowned` wallet tags. GMGN also pins **Fomo calls** on its token charts (GMGN blog, "How to Read FOMO Calls on the GMGN Chart") | **The Callout OpenAPI.** `/get_record` and `/global` return GMGN's own callouts *and third-party platforms' callouts*, each with `source` set to that platform's id. GMGN's docs don't list which platforms. Each record has the wallet, `call_price`, time, X handle and `is_kol`. Needs GMGN's partner approval (a form; signed keys; IP allowlist). A partner can also publish calls into GMGN (`/create`), so Mooner calls would show up on GMGN too |
| Fomo (fomo.family) | A post you can only write about a token you hold, with your position attached. Every trade shows in the feed | **On chain, no API needed.** Every Fomo trade is fee-paid by Fomo's wallet `AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51`, and the trader's own wallet co-signs. It routes through DFlow, settled in USDC. Checked 2026-10-03 on two recent txs: fee payer `AgmLJBMD…`, second signer the trader, the token moved to the trader. Bitquery found the address; Fomo hasn't published it. So the server can see each Fomo buy of a Mooner coin, and who made it. The post text itself isn't on chain (GMGN's feed carries it) |
| Axiom | "Callouts" (who called a token and what they hold) and "Callers" (a ranking), per a third-party guide (axiompro.app). Axiom's own docs don't say where they come from | No API. What Axiom shows can be matched through the sources above |
| pump.fun | An in-app callout pushed to followers. pump.fun pays callers daily in USDC for the buying it drives | Off chain, in pump.fun's database. One way is an undocumented, unauthenticated endpoint (`/callout/user/{wallet}/mint/{mint}`, 50 requests a minute), but pump.fun's terms ban automated access. Whether pump.fun callouts reach GMGN's feed isn't known. Tools like call'd post callouts through your own logged-in pump.fun tab |

**What this gives the KOL role:**
- **Mooner link joins** (presale): fully checkable today.
- **Fomo buys of a Mooner coin** (trading): checkable today, on chain. But a buy isn't proof of a call, and anyone can make one, so this is a weak signal. On its own it suits a "Called on Fomo" mark or XP better than SOL (R1b).
- **GMGN-relayed callouts** (GMGN, Fomo and the other third-party sources GMGN carries), with X handles and `is_kol`: the strong signal. It starts once GMGN approves the application (U13).
- **pump.fun directly:** not used unless you accept the terms risk (R1c).

### The money flow, step by step

1. **Open.** `flows.js` sets `feeDest: REWARDS_WALLET` (a new constant in `engine/src/consts.js`). `cosigner.js` refuses an open whose `fee_dest` (open data bytes 1–33) isn't `REWARDS_WALLET`. An old app gets "update Mooner to open a presale".
2. **Launch.** Unchanged: `bot.js` already transfers the pool creator to `p.feeDest`.
3. **Claim.** The feed already watches every DBC pool account (`engine/server/feed.js:243`). When a pool's creator fee reaches `CLAIM_MIN` (a product number in one place), the keeper sends `claim_creator_trading_fee` signed by the rewards key. The SOL is unwrapped in the same tx, as `claim.py` does. No polling: the trigger is the pool account change the feed already receives.
4. **Split.** Each confirmed claim becomes rows in a new SQLite ledger (`engine/server/rewards.js`):
   - `fee_claims(sig PRIMARY KEY, mint, lamports, at)`;
   - `reward_shares(wallet, role, mint, claim_sig, lamports, UNIQUE(wallet, role, claim_sig))`, split by the rules above, rounded down to the lamport. Leftover lamports from rounding, and any role with nobody in it (R4), stay in the wallet as Mooner's.
5. **Get my rewards.** Web profile and phone Me show "Rewards: X SOL" and a button.
   - `POST /api/rewards/claim` (a Mooner sign-in) builds `transfer(REWARDS_WALLET → you, owed)`. You are the fee payer; the server signs as the rewards wallet. You sign and send it, as with a join.
   - The amount is reserved in `reward_payouts(wallet, sig, lamports, lastValidBlockHeight, confirmed)` until the tx lands or its blockhash expires, so it can't be paid twice.
   - Owed = shares − confirmed payouts − reserved payouts.
6. **Live.** Rewards rows go out on the `profiles` topic beside the `xp` rows (pushed, not polled).

**Limits to state in the rewards plan:**
- The rewards key is a hot key on the server (like the bot's). It only ever holds claimed fees not yet taken, and it signs only claims and payouts it can check against the ledger.
- The first claim needs a little SOL in the rewards wallet, for its fee and the wSOL account's rent. That's your step.
- Whether DBC still allows a creator-fee claim after a pool migrates isn't verified. The rewards plan checks it, and claims everything before migration if needed.
- After migration, fees come from the DAMM v2 creator position (`claim_position_fee`). That part is after the submission unless a Mooner coin migrates before it.

### XP and titles

- Piece 6's plan stands (ledger, streak, Genesis, leaderboard, routes, `profiles` topic). One change follows from the roles above: **swap KOL's and Raider's XP rules**.
  - KOL XP comes per confirmed referral (the plan gave that to Raider).
  - Raider XP comes per backed seat at launch and migration (the plan gave that to KOL).
  - In `POINTS`, `kolLaunch`/`kolMigrate` become `raiderLaunch`/`raiderMigrate`, and `raiderJoin` becomes `kolJoin`.
  - The web's title copy says KOL = caller, Raider = backer.
- Fee rewards and XP are separate: XP is levels, titles and the board; rewards are SOL.
- This edit is made to the piece 6 plan before its Task 1 is built.

### Decisions for you: the rewards (R1–R10)

Each has a recommended default. Say "go with defaults" and the plan uses them.

- **R1 — KOL's 10%.** Callers by Mooner link, pro rata by SOL their links brought; GMGN-relayed callouts join the same pot once GMGN approves. *(default)* Or: an equal split per caller.
- **R1b — Fomo buys seen on chain.** A "Called on Fomo" mark and KOL XP, no SOL. *(default)* Or: they share KOL's 10% too, weighted by SOL bought, held until the split.
- **R1c — pump.fun's undocumented callout endpoint.** Not used. *(default)* Or: use it and accept that pump.fun's terms ban automated access.
- **R2 — Raider's 10%.** Presale backers pro rata by seat, creator's seat out. *(default)* Or: drop Raider and give its 10% to another role.
- **R3 — Diamond Hands' 10%.** Presale wallets still holding their full share, pro rata by share. *(default)* Or: every holder of the coin. That needs a full holder scan per split, and it favours whoever buys big right before one.
- **R4 — A role with nobody in it on a coin** (say, no link joins). Its 10% stays with Mooner. *(default)* Or: it's shared among the coin's other roles.
- **R5 — The creator LP at migration**, which now lands in the rewards wallet. Never withdraw it; split only its fees 10/10/10/10. *(default)* Or: withdraw it.
- **R6 — Payouts.** You press "Get my rewards" and pay the tx fee, as with joins. *(default)* Or: Mooner sends automatically, and pays every fee.
- **R7 — Mooner's 40%.** Confirm you hold the key for `4aieXRznxvzASx5EqiVZGNdv9vq77gcKmPUL6sruyuLq`. It isn't in this repo's key folders.
- **R8 — Presales already open** with the creator as `fee_dest` keep the old 40% to their Dev. *(default: yes, the program can't change it)*
- **R9 — The rewards key** lives on the server (Railway variable, file in `engine/.mainnet/`). *(default)* Or: a cold wallet you sign with, which rules out self-serve "Get my rewards".
- **R10 — `CLAIM_MIN`**, the creator fee a pool must reach before the server claims it. Default 0.02 SOL. Each claim costs about 0.000005 SOL plus the priority fee.

### Decisions for you: piece 6's 16 open questions (updated for the swap)

Full text in `docs/superpowers/plans/2026-10-01-mooner-seeker-xp-genesis.md` → "Open questions". Defaults in brackets.

1. Seeker-only trait art. [no trait: the mark and the bonus only]
2. Points. [Dev 100 at launch / 200 at migration; Raider 25 / 50; KOL 25 per confirmed referral; Diamond Hands 100; Genesis 250]
3. Streak gives XP or a badge? [no; a line on the profile and Me]
4. KOL counts confirmed referrals only. [yes]
5. Genesis bonus counts in Overall only. [yes]
6. Diamond Hands threshold is the seat's full token share. [yes]
7. A moved Genesis token stays with the first wallet that claimed it. [yes]
8. Dev level names Builder, Shipper, Founder, Launcher, Moonmaker. [approve or replace]
9. Shiller's rocket and traits go to Dev. [yes]
10. A wallet with no XP shows Dev I. [yes]
11. The creator's own seat gives Dev only, not Raider. [yes]
12. Genesis check shown on every phone; the server decides. [yes]
13. Move level names into shared code so the phone says them. [yes, one small task]
14. Genesis check by button, not automatically after sign-in. [button]
15. Zero-XP wallets off the board on web and phone. [off both]
16. Places past 500. [hide them]

---

## Stages

Tags: **[YOU]** your step · **[AGENT]** needs nothing from you · **[PHONE]** needs the Seeker plugged in, with you there for Seed Vault prompts and real spends.

Three tracks run side by side: your steps, the agent's server/web work, and the phone work once the Seeker is connected.

### Stage 0 — Your steps (each unblocks a list below)

- [ ] **U1 Alchemy:** enable Solana Mainnet and Devnet on the Alchemy app. Unblocks the switch to Alchemy and the devnet checks.
- [ ] **U2 Deploy:** `sh deploy/railway.sh app`. Ships `/api/rpc`, which fixes the site's refunds, costs, balances, trades and Privy. The agent then checks the live site in the browser pane, and the log line `rpc: first call, from <ip>` (to confirm Railway passes the real IP).
- [ ] **U3 RPC choice:** set `MOONER_RPC` (and optionally `MOONER_APP_RPC`) to the Alchemy URL on Railway, after U1.
- [ ] **U4 Signing key:** finish `keytool`, write `~/.gradle/gradle.properties` (handoff §4.1), `chmod 600`, and back up the keystore.
- [ ] **U5 Phone:** plug in the Seeker, allow USB debugging, run `adb uninstall family.mooner.app` once.
- [ ] **U6 App Links:** set `MOONER_ANDROID_CERTS` on Railway (the fingerprint from `signingReport`, after U4), then deploy. This is piece 3, Task 10.
- [ ] **U7 Answers:** R1–R10 and the 16 questions above ("defaults" is a valid answer).
- [ ] **U8 Push accounts:** an Expo account and project; Firebase `google-services.json`; Firebase's sending key, given to Expo only. This is piece 5, Task 15.
- [ ] **U9 Rewards wallet funding:** once the agent creates the rewards key, send it a small amount of SOL for its first claim (R9).
- [ ] **U10 Devnet SOL:** to the devnet canary wallet, for the rewards and launch checks on devnet.
- [ ] **U11 Repo:** say yes to pushing `feat/mooner-wireframe`, and choose: make `EchoWebLV/mooner-family` public, or invite the judges.
- [ ] **U12 Align registration** and the funding-eligibility answer.
- [ ] **U13 GMGN partner application:** fill in GMGN's Callout OpenAPI form (linked from `docs.gmgn.ai/index/gmgn-callout-openapi.md`) as Mooner. Approval time is GMGN's. Once the keys arrive, they go in `vault`, and the server's IP goes on GMGN's allowlist.

### Stage 1 — Agent, server and web (no phone needed)

Order within the track; each item is one commit or more, and each is reviewed (spec, then code) before the next.

- [ ] **A1** Piece 5, Task 3's small fixes. Tests: the token sign check, the per-IP follow limit, re-follow order, several followers, a throwing listener.
- [ ] **A2** Piece 6, Tasks 2, 4 and 5 (ledger, streak days, Genesis check). These don't depend on the answers.
- [ ] **A3** After U7: edit the piece 6 plan for the KOL/Raider swap and the answers, commit the plan, then Tasks 1 and 3.
- [ ] **A4** Write the **rewards plan** (`docs/superpowers/plans/2026-10-0x-mooner-rewards.md`), from "The rewards system" above and the answers to R1–R10. Its tasks:
  1. the rewards key (generated into `engine/.mainnet/`, gitignored) and `REWARDS_WALLET`;
  2. `flows.js` `feeDest`, and the co-signer's `fee_dest` check;
  3. `dbc.js` `claimCreatorTradingFee` (ported from `claim.py`) and the creator fee read from the pool;
  4. `rewards.js` ledger and split rules;
  5. the keeper's claim on pool change;
  6. `POST /api/rewards/claim` and its payout reservation;
  7. `profiles` topic rows;
  8. the web panel;
  9. a devnet canary: open → fill → launch → trade → claim → split → payout (after U1 and U10);
  10. Fomo buys (R1b): a `logsSubscribe` on each Mooner pool the feed watches. A tx whose fee payer is `AgmLJBMD…` is a Fomo buy by its other signer; it's recorded for the mark, XP or share R1b picks;
  11. GMGN callouts (after U13): read `/get_record` for Mooner coins and add them to KOL's pot by R1's rule. Mooner's own calls are published with `/create`.

  Then build it.
- [ ] **A5** Piece 5, Tasks 4–7: Expo push sending, the feed telling the notifier, the notifier, and the server running it.
- [ ] **A6** Piece 6, Tasks 6–10 and 17: routes, `profiles` rows, wiring, web titles (Dev in, Shiller out, KOL/Raider copy), web leaderboard and profile on real data.
- [ ] **A7** Write the **SKR join plan** (piece 7, spec "Join with SKR"). First thing it checks: whether Jupiter serves an exact-output SKR→SOL route. Then build its shared part: the quote, and the swap tx from `web/src/real/market.ts` moved into shared code. An optional extra for the SKR bonus ("rewards"): "Get my rewards in SKR", which swaps at payout.
- [ ] **A8** Piece 5, Task 14: Follow on the web.
- [ ] **A9** Known issues users would see: web `claimed` always false; `MAX_UNOPENED`, so the web can't reopen an unopened mint; holder counts once U3 lands.
- [ ] **A10** After U2: the live check of the site in the browser pane (refund, costs, balances, Privy), then piece 6, Task 11's live checks.

### Stage 2 — Phone (after U4 and U5)

- [ ] **B1** Release-build fixes, coded before the phone arrives and checked on it:
  - the spike's debug screen out of the release APK;
  - the splash colour;
  - `edgeToEdgeEnabled` removed;
  - storage permissions trimmed;
  - the phone's `/api/rpc` use checked against production after U2.
- [ ] **B2** Piece 4, Task 7 device steps 4–11, then Task 8 [YOU: the first real open from the phone], Task 9 [YOU, optional], Task 10.
- [ ] **B3** Piece 3, Task 11: the share-link checks on the phone, after U6.
- [ ] **B4** Piece 5, Tasks 8–13 and 16: alerts store, push wrapper, Follow, Auto-join, Alerts tab, Following/Followers. Task 16 comes after U8.
- [ ] **B5** Piece 6, Tasks 12–16, then Task 18 [YOU present]: XP on Me, the leaderboard, the Genesis check.
- [ ] **B6** Rewards on the phone: the line and "Get my rewards" on Me, from the rewards plan, with its device check [YOU sign].
- [ ] **B7** SKR join on the phone: the join sheet's SKR price, swap then join in one MWA session, with its device check [YOU sign].

### Stage 3 — Submission kit (piece 8; write its plan first, as A11)

- [ ] **S1** A signed release APK built from HEAD, installed on the Seeker, and the full flow run once end to end on mainnet [YOU sign]. The APK file goes in the repo's release notes or the submission form.
- [ ] **S2** Repo for judges: a README covering what Mooner is, how it works (presale → ER → DBC launch → claims → rewards), program and config addresses, how to build and run, and the APK. Push after U11.
- [ ] **S3** Demo video (~3 min, on the Seeker). The script follows the spec's storyline, plus rewards:
  1. Seed Vault sign-in;
  2. Live;
  3. join with SOL and SKR;
  4. fill and launch;
  5. tokens arrive;
  6. buy and sell;
  7. create from the camera;
  8. share link (the KOL link);
  9. push;
  10. Me with XP, Genesis and "Get my rewards".

  The agent writes the script and shot list, records the screen with `adb shell screenrecord` while you do the Seed Vault steps, and can cut it in Reel (`~/screenstudio`).
- [ ] **S4** Pitch deck: problem, how Mooner works, the fee split and roles, Seeker integration (Seed Vault, Genesis, SKR), traction (live on mainnet since 2026-09-25), roadmap. Made as a Slides artifact.
- [ ] **S5** [YOU] Submit: APK, repo link, video, deck, Align registration.
- [ ] **Freeze:** you call it. After the freeze, only fixes found while recording go in, and the submitted APK is the one in the video.

### If it doesn't all fit: what gets cut first

Cut from the top of this list down:

1. Web Follow (A8).
2. Auto-join (piece 5, Task 11).
3. Following/Followers on Me (piece 5, Task 13).
4. The phone leaderboard screen (piece 6, Task 15). XP on Me stays.
5. "Get my rewards in SKR".
6. Known issues A9.

**Never cut:**
- the signed APK on the Seeker;
- core join → launch → claim on mainnet;
- the fee split with "Get my rewards";
- XP and titles;
- SKR join (the bonus);
- the video, the deck and repo access.

## After the submission

- dApp Store publishing: required within 30 days of the results if Mooner wins.
- DAMM v2 position fee claims for migrated coins (rewards plan, later task).
- GMGN callouts in KOL's pot, if GMGN's approval (U13) comes after the submission.
- Server known issues:
  - `store.mintKey` has no `presale IS NULL` filter;
  - the feed watches only the 200 newest launches;
  - the feed's `migrated` event stops at the first listener that throws;
  - the `candles` table is never pruned.
- The spec's "Not in this release: the fee router" is superseded by this plan's rewards split; update the spec's line when the rewards plan lands.

## Self-review

- **Coverage:** every row of the handoff's piece table, its "waiting on you" list, its "next for the agent" list and its known issues has a stage item above. The user's rewards answers have their own sections:
  - Dev = XP + a fee cut;
  - KOL = calls on GMGN/Axiom/pump.fun/Fomo, by link;
  - Diamond Hands = holders;
  - the 20/40/10/10/10/10 split.
- **Durations:** none. Order and dependencies only.
- **Verified facts:**
  - the fee split (Meteora docs; `dbc.js`);
  - the creator = `fee_dest` rule (`launch.rs:202`, `bot.js:70`, `flows.js:377`);
  - the co-signer not checking `fee_dest` (`cosigner.js:75-79`);
  - the self-referral guard (`api.js:83`);
  - the pool subscriptions (`feed.js:243`);
  - the claim layout (`launch-test/claim.py`);
  - production `/api/rpc` 404, Alchemy disabled, no phone, no signing key, test counts.
- **Not verified:**
  - a creator-fee claim after migration;
  - Jupiter's exact-output SKR→SOL route;
  - who holds `4aieXRzn…`;
  - whether Railway passes the client IP;
  - the pump.fun "hold to call" rule (not used).
