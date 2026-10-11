# Mooner — Colosseum pitch video

The words to say are in [2026-10-11-mooner-colosseum-pitch-script.txt](2026-10-11-mooner-colosseum-pitch-script.txt). This file covers what to show, the facts behind every line, and what has to be true before you record.

## Colosseum's rules for this video

These come from the [Colosseum submission workshop](https://blog.colosseum.com/perfecting-your-hackathon-submission):
- 3 minutes or less.
- It's a startup pitch, not a demo.
- Cover your background, the problem, who it's for, any validation, and the vision.
- A clear story beats polished editing.
- No buzzwords and no flashy visuals without substance.
- Judges watch it first, and it decides the shortlist.

## Shots

Show only real screens: no demo-server pools, no "LIVE" over fake data.

| Part | On screen |
|---|---|
| hook | Solscan, block 450111237 ($MTRIAL, 2026-09-24): our pool tx at position 555, the bot's buy at 690 in the same block. |
| team | You on camera. Colosseum wants the team background in this video. |
| insight | A simple diagram: one creation tx = create pool + one buy at 1%, then the fee drops 99% → 21% → 5% → 1% over 3 s. |
| how | Screen recording of the real web app: open a pool, chip in, the pool fills, the coin launches (a real 0.5 SOL pool on mainnet). |
| proof | Solscan for the $MPRE launch (2026-09-25): 3 holders × 3,501,375.15, and the bot's 0.3 SOL buy paying the 99% fee. |
| platform | The web app and the phone side by side: a coin page with Jupiter trading, chat, and Ranks with titles. |
| market | Two number cards with the source on screen: "$1.2B+ earned since launch", "$42–48M last 30 days" (Crypto Briefing, Aug 26, 2026). |
| business | Split graphic: Meteora 20 · Mooner 40 · Dev 10 · KOL 10 · Raider 10 · Diamond Hands 10. |
| traction | The program on Solscan (6iCH5T57…), the two apps, and mooner.family. |
| close | The logo, from `assets/mooner.svg` only. |

## Facts behind each line

| Line | Fact | Source |
|---|---|---|
| "tens of thousands of coin launches a day" | "Daily token launches on the platform remain in the tens of thousands." | [Crypto Briefing, Aug 26, 2026](https://cryptobriefing.com/pumpfun-daily-revenue-highest-since-september/) |
| "over $1.2B earned", "over $40M a month" | "Cumulative earnings since launch have now surpassed $1.2 billion"; trailing 30-day revenue "$42 million and $48 million" | same |
| "on our first test launch, a bot bought in the same block" | $MTRIAL, block 450111237: ours at position 555, the bot at 690 | your mainnet test, 2026-09-24 |
| "first swap … can pay the lowest fee" | DBC gives the 1% floor to the first top-level swap in the pool-creation tx when the config enables it (`enable_first_swap_with_min_fee`) | Meteora DBC `process_swap.rs` |
| snipe tax "starts at 99%" | config j7j5…: 98.95% / 21.39% / 4.63% / 1% from 3 s | mainnet config, 2026-09-27 |
| three equal wallets, the 99% bot, 100× fewer tokens | $MPRE: 3 × 3,501,375.15 for 0.1 SOL each; the bot paid 0.3 SOL, a 99% fee, and got ~105k vs the pool's 10.5M | your mainnet test, 2026-09-25 |
| "live on mainnet since Sept 25" | program 6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa | deployment record |
| "over eight hundred tests" | 554 engine + 326 mobile = 880 (3 fail now from uncommitted demo tweaks) | test runs, 2026-10-10 |
| "over a hundred on the waitlist" | 107 rows before the verified-join flow went live, 2026-10-09 | waitlist DB |

## Must be true before you record (or cut the line)

1. **"Raider" = posting on X:** built, not deployed. Deploy it, or say just "titles" in the platform line.
2. **The fee split:** designed, not live (fees go to the creator today). The business line says how you earn; keep "after Meteora's cut…" only if you're fine pitching the planned split.
3. **The "how" recording** needs app.mooner.family working: fix the RPC first (command in the submission file).
4. **Repo public** with the commits pushed. Judges check that what the video shows was built during the hackathon.
5. **Your line** in "team": your name and why you are the one to build this. Colosseum asks for the team background in this video.

## Separate: the technical demo video

Colosseum also asks for a demo video (max 3 min) showing how it's built: the program, the rollup join, the one-tx launch, the snipe tax, the apps. It's a different script; I can write it next.
