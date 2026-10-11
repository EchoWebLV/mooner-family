# Mooner — Colosseum Crypto World's Fair submission info

For the agent filling the form at https://colosseum.com/arena/hackathon?createProject=1:
- Fill only what is below.
- Leave anything marked **SKIP** empty.
- Do NOT press Submit; the owner reviews first.
- Deadline: Oct 12, 2026, 11:59 PM PT.

Everything here is checked against the repo, the chain or the live sites (2026-10-10/11). Before submitting, fix the items in **"Fix first"** at the bottom.

---

## Basics

| Field | Value |
|---|---|
| Product name | Mooner |
| Category | Consumer app or DeFi, whichever the list has closest to "token launchpad" |
| Country | Bulgaria |
| Team location details | Bulgaria |
| Website | https://mooner.family |
| Live product link | https://app.mooner.family (see Fix first #1) |
| Repo link | https://github.com/EchoWebLV/mooner-family (see Fix first #2) |
| Logo | `assets/mooner.svg` in the repo (export a PNG if the form wants one) |
| Chains | Solana |
| Solana Mobile project? | Yes, in part. Mooner is a web platform plus a native Android app; the app supports the Seeker (Seed Vault, Genesis Token). |
| University project? | No (owner: confirm) |
| X / Twitter handle | **SKIP** |
| Telegram handle | **SKIP** |
| Teammates | **SKIP** (owner adds) |
| Team commitment | **SKIP** |
| External contributors | **SKIP** |
| Accelerator opt-in | **SKIP** (owner's call) |
| Legal entity / investment received / fundraising / live token | **SKIP** (owner's call). Mooner has no token of its own; the coins on mainnet were test launches. |
| Survey questions | **SKIP** |

## Brief description

Mooner is a token launchpad, on the web and on mobile, where a coin launches together. People chip in SOL to a pool before the coin exists. When the pool fills, one transaction creates the coin's Meteora pool and makes a single buy for everyone at the lowest fee. Everyone gets the same price, with tokens in proportion to what they put in. Bots that buy right after launch pay a snipe tax that starts at 99%.

## Technologies

Solana, Anchor (Rust), MagicBlock Ephemeral Rollups, Meteora Dynamic Bonding Curve, Jupiter, Solana Mobile Stack (Mobile Wallet Adapter, Seed Vault), Seeker Genesis Token, Expo / React Native (Android), React + Vite, Privy, Node.js, SQLite, IPFS (Pinata)

## How the product uses Solana (chain usage)

- **Our own Anchor program**, live on mainnet since 2026-09-25 at `6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa`. It holds the pooled SOL in a PDA and handles open, join, leave, settle, claim, fail and expire.
- **Joins are recorded on a MagicBlock Ephemeral Rollup**, so the pool fills instantly. The SOL itself moves in and out on Solana.
- **The launch is one transaction.** It creates the Meteora Dynamic Bonding Curve pool and makes one top-level buy with all the pooled SOL. Meteora gives that first buy the 1% minimum fee. The tokens land in the program's vault, and each member claims their own share.
- **Snipe tax:** a Meteora fee schedule of 98.95% in the first second, 21.39% at 1 s, 4.63% at 2 s, then 1% from 3 s. Members' claims are held until the tax is over.
- **Trading after launch** goes through Jupiter, which routes into the coin's Meteora pool.
- **Sign-in:**
  - On the web: Privy (any Solana wallet, X or email, with an embedded wallet).
  - On Android: Mobile Wallet Adapter, with Seed Vault on the Seeker. The app checks the Seeker Genesis Token for a bonus.

## What are you building, and who is it for?

Every coin launch on Solana starts the same way: a bot buys in the very first block, then the bundlers, and by the time a normal person taps buy they are the exit. Mooner changes the order. A creator opens a pool, and people chip in before the coin exists. When the pool fills, our program creates the coin and buys for the whole pool in one transaction, so every member gets the same price and tokens in proportion to their SOL. A bot that buys right after pays a fee that starts at 99%.

It is a platform: the web app at app.mooner.family, and a native Android app (built for mobile, not a website in a wrapper) that also supports the Seeker. Both have:
- a live feed of pools and launched coins
- create a coin
- coin pages with trading through Jupiter
- chat
- ranks with XP titles: Dev for launching coins, KOL for backing launches, Raider for posting about coins on X, Diamond Hands for holding

It is for people who trade new coins, on desktop or on their phone, and are tired of being the bots' exit liquidity, and for creators who want their community in at the same price as them.

## Why now?

- **More and more traders want launches that reward them.** Pump.fun now pays callers USDC every day: almost $700K went to its top 50 callers alone ([Protos, Aug 27, 2026](https://protos.com/pump-fun-paid-700k-to-callers-shilling-mostly-tiny-tokens/)). Mooner is designed to share the rewards with each coin's whole community: its Dev, KOLs, Raiders and Diamond Hands.

## Market validation / demand

- **Waitlist:** 107 sign-ups at mooner.family as of 2026-10-09. Since that date, joining requires a verified email and X account.
- **Mainnet tests with our own wallets:**
  - In the pooled launch, three wallets each got exactly 3,501,375.15 tokens for 0.1 SOL each.
  - A bot in the same block paid a 99% fee and got about 105k tokens for 0.3 SOL.
- **SKIP the rest**, unless the owner has user interviews or other numbers to add.

## Traction

- Program live on Solana mainnet since 2026-09-25.
- Test launches on mainnet from Sept 24 to Oct 6, 2026.
- 107 waitlist sign-ups.
- No public launches by outside users yet; the app opens after the hackathon.

## Competition

- **pump.fun and other bonding-curve launchpads:** anyone can buy from the first block, so bots and bundlers get in first.
- **Meteora's Alpha Vault** does pooled pro-rata buys, but only for its DLMM and DAMM pools, not for Dynamic Bonding Curve launches.
- **Anti-snipe launch venues** like [Vertigo](https://colosseum.com/projects/explore/vertigo) (Colosseum Breakout) fight bots with pool math.
- **Mooner's angle:** it puts the community in before the coin exists, buys for all of them in the launch transaction itself, and wraps that in a web platform and a mobile app with chat and roles.

## Monetization

- Revenue comes from the trading fees on each coin's Meteora pool.
- Planned split: Meteora 20%, Mooner 40%, and 10% each to the coin's Dev, KOLs, Raiders and Diamond Hands, claimed in the app.
- The split is designed but not live yet.

## Repo context (if asked)

- `programs/presale` — the Anchor program (about 4.1k lines of Rust).
- `engine/` — the server, keeper and shared JS, with 554 tests.
- `mobile/` — the Expo / React Native Android app (Seeker supported), with 326 tests.
- `web/` — the React web app.
- `site/` — the waitlist site.
- `deploy/` — Railway deploy scripts.

## Prior work disclosure (required by the rules)

Mooner is a new repo; its first commit is 2026-09-23, after the hackathon started on 2026-09-14. Before it, the founder built **MagicPad**, a MagicBlock launchpad, from 2026-08-18 to 2026-09-23. MagicPad's "group launch" design and MagicBlock patterns informed Mooner's pool design. (Owner: say whether any MagicPad code was copied in.)

## Videos

| Field | Value |
|---|---|
| Presentation / pitch video (2–3 min) | **SKIP for now.** The file is `docs/superpowers/2026-10-10-mooner-pitch.mp4` (2:48); it needs a YouTube upload, and see Fix first #4. |
| Technical demo video (max 3 min) | **SKIP.** The existing demo clips use made-up pool data; record a real one. |
| Live product access instructions | **SKIP** until #1 is fixed. Then: "Open app.mooner.family and sign in with a Solana wallet, X or email (Privy). Android APK: <link>." |

---

## Fix first (before pressing Submit)

1. **app.mooner.family is down.** Its data calls return 500 because every RPC key is out of quota except Alchemy. Run:
   `printf %s "$(vault get ALCHEMY_RPC_URL)" | railway variable set MOONER_RPC --stdin --project 14215b7b-adff-430c-81f8-71e01298c7c3 --environment production --service app`
2. **The repo is private, and GitHub has only "Initial commit".** Push the 203 local commits first (keep the >100 MB videos out), then make the repo public or give Colosseum access as their FAQ says.
3. **No Android APK link.** Rebuild with the release key and host it.
4. **The pitch video says things that aren't true yet:**
   - "Sign in with X or email": the phone has Seed Vault only.
   - "Bring people in with your link, you're a Raider": Raider is now posts on X.
   - "Up to one SOL": the chain allows 0.5 SOL now.
   - "Live on mainnet today": the server is down until #1.
   - At about 1:00, a "THE LAUNCH, LIVE" shot shows a fake 10 SOL pool.

   Re-cut those lines before uploading.
5. **Judges' read on wording:** judges read these answers as the team's own words. Rewrite them in your voice where you want to.
