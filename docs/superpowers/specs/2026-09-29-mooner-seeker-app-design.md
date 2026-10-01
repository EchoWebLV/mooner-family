# Mooner on Seeker: design

- **Date:** 2026-09-29 · **Branch:** `feat/mooner-wireframe` · **Status:** approved in conversation, spec under review
- **Scope:** Mooner as an Android app for the Solana Seeker, entered in the Clock In hackathon; trading through Jupiter (which routes each coin's Meteora pool) with full coin info; the server work it needs (coin info, real XP, push, Genesis perk, App Links); SKR payments.
- **Out of scope:** iOS, private presales, the fee router, dApp Store publishing (only needed after results).

## Goal

The Mooner launchpad as a native Android app, built for the phone rather than ported from the web:
- the same presales, launches and Mooners, on the same program, server and live feed;
- sign-in with Seed Vault, or with X or email.

Four things must hold throughout:
- It is one product: a presale joined on the phone is the same presale on the web.
- Nothing a judge sees is a web page.
- Mooner still pays nothing.
- No game words in the copy: no "players", "lobby" or "match" (see "Words").

## The hackathon (read 2026-09-29 from solanamobile.radiant.nexus)

| | |
|---|---|
| Submissions close | **2026-10-09 09:59 EEST** (06:59 UTC); results 2026-11-10 |
| Must submit | a functional Android APK that runs on a device; a GitHub repo the judges can open, whose commit history they read; a demo video of about 3 minutes; a pitch deck |
| Must use | the Solana Mobile Stack and Mobile Wallet Adapter; meaningful Solana network use |
| Scores poorly | "direct ports or PWA wrappers with little mobile optimisation". An existing web app is allowed with significant mobile-specific work |
| Judged on | four criteria, 25% each: stickiness & PMF (daily habit, Seeker community); user experience; innovation / x-factor; presentation & demo |
| Bonus | $10k in SKR for the best SKR integration. Staking doesn't count; "in-app purchases, rewards, access" do |
| After winning | publish on the Solana dApp Store within 30 days of results; KYC via Sumsub; USDC prizes only for teams without VC/angel funding |

## Decisions (the user's)

| Topic | Decision |
|---|---|
| What the app is | Mooner itself on Seeker, not a companion |
| Device | the user has a Seeker; every piece is proven on it |
| Sign-in | Seed Vault (and any MWA wallet) through Mobile Wallet Adapter, plus X or email through Privy with an embedded wallet |
| Build | React Native + Expo, a development build (not Expo Go), Android only |
| First release | the core app, share links, create from the phone, push alerts, Seeker perks, Join with SKR |
| SKR | **Join with SKR**: pay a seat in SKR, swapped to SOL in the same flow |
| Titles | **Dev** (new), **KOL**, **Raider** (Shiller merged into it), **Diamond Hands**, with real XP |
| Words | no game words; "Who's in", not Lobby; "Auto-join", not matchmaking |
| Trading | buy and sell in the app through Jupiter, as the website does; Jupiter routes the coin's Meteora pools (the launch-curve DBC pool before migration, DAMM v2 after); plus full coin info from Meteora (user, 2026-09-30: "jupiter for trading was fine") |
| Alerts | besides your own presales: people you follow joining or opening a presale, and coins passing a big market cap (user, 2026-09-30) |

## Facts this rests on (checked 2026-09-29)

**Solana Mobile** (docs.solanamobile.com, npm):
- The official start is `npm create solana-dapp@latest` with a Solana Mobile template (github.com/solana-foundation/templates `mobile/`). The templates pin Expo ~55, React Native 0.83.6 and React 19.2.
- Mobile Wallet Adapter needs a development build; Expo Go can't load its Kotlin module.
- The web3.js v1 route is `@wallet-ui/react-native-web3js` 4.3.0 over `@solana-mobile/mobile-wallet-adapter-protocol-web3js` 2.3.0.
  - `signTransaction(s)` signs without sending, for `Transaction` and `VersionedTransaction`.
  - `signAndSendTransaction(tx, minContextSlot)` sends.
  - `signMessage` takes bytes.
- The only polyfill in the docs is `react-native-quick-crypto` (`install()` first in `index.js`, with `react-native-nitro-modules`).
- The wallet's auth token is cached in AsyncStorage by default; the docs say to pass an `expo-secure-store` cache.
- MWA spec 2.0 lists sign-only (`sign_transactions`) as deprecated but still supported. The official mock wallet doesn't implement it, so sign-only is tested on Seed Vault or Solflare.

**Seeker Genesis Token:**
- It is a Token-2022 token, one mint per phone.
- A wallet holds one when a token account with a non-zero balance has a mint whose metadata pointer and group-member group are both `GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te`.
- The mint address identifies the phone. It isn't NonTransferable (it has a permanent delegate).
- Source: docs recipe `/recipes/general/detecting-seeker-users`.

**SKR:**
- Mint `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`, classic SPL Token, 6 decimals.
- Jupiter lists it as verified with a live SOL route. A 0.1 SOL quote returned 648.01 SKR.

**Seeker:**
- Android 16 since MR7.
- The user's Seeker, read over `adb` on 2026-09-30: Android 16, build `BP2A.260811.100.A3`, Google Play Services `26.32.34` and the Play Store installed.

**Privy** (`@privy-io/expo` 0.75.0, npm tarball + docs.privy.io):
- Sign-only works on Expo: `wallets[0].getProvider()` → `request({ method: "signTransaction" })`, for web3.js v1 `Transaction` and `VersionedTransaction`. The embedded wallet must be a static key in the transaction.
- There's no built-in signing UI on Expo.
- The wallet runs inside `react-native-webview`.
- Needs a dev build, polyfills (`react-native-get-random-values`, `buffer`, `fast-text-encoding`) and Metro tweaks for `jose`, `isows` and `zustand`.
- One Privy app serves web and mobile. Mobile needs an app client: the Android package as the allowed app identifier, a URL scheme, and `clientId` on the provider.
- External wallets aren't Privy connectors on React Native. MWA is done by the app itself.

**This repo:**
- The engine files the web signs with (`engine/src/consts, ix, layout, pdas, tx, client`) import only `@solana/web3.js` and each other. `dbc.js` (`node:crypto`) isn't on that path.
- The web's `chain.js` needs `localStorage`, `btoa`, the API and the live socket.
- The live socket (`/api/ws`) has no origin check.
- XP, titles, badges, the leaderboard and Find Match exist only in the sim (`web/src/lib/sim`). The server keeps no XP and has no follows.
- `decodePoolState` already reads a DBC pool's `migrated` flag and `feed.js` publishes it on `launched`. It is tested only on a fresh pool, where it's false, and nothing reacts when it flips.
- Coins migrate to a Meteora DAMM v2 pool (`migrationOption: 1` in `engine/src/dbc.js`). The server has no price for a coin after that.
- Supply is 1B per coin, and `feed.js` already has SOL/USD from Pyth, so a market cap in dollars is price × 1B × SOL/USD.
- `engine/src/dbc.js` already builds a DBC `swap2` (the keeper's 1% buy at launch).
- The website's trade panel (`web/src/components/token/TradePanel.tsx`) trades through Jupiter today, with candles and trades from GeckoTerminal.
- No Mooner coin has launched on mainnet yet (`/api/launched` was empty on 2026-09-30). The first real trade is proven on the first launch.

**Meteora** (npm, docs.meteora.ag, live API calls, 2026-09-30):
- SDKs: `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.13 and `@meteora-ag/cp-amm-sdk` 1.5.0 (DAMM v2). Both are on `@solana/web3.js` v1 and `@coral-xyz/anchor` 0.31, and both quote swaps and build swap txs.
- The DAMM v2 Data API at `https://damm-v2.datapi.meteora.ag` is live, limited to 10 requests a second.
  - `/pools/{address}` returns each token's price, market cap and holder count, plus the pool's TVL.
  - `/pools/{address}/ohlcv` returns candles and `/pools/{address}/volume/history` returns volume.
- Meteora's docs index lists no data API for DBC pools.
- Jupiter's route list includes both `Dynamic Bonding Curve` (the DBC program) and `Meteora DAMM v2`.
- Mooner pictures are drawn in the browser by a three.js scene plus a sprite manifest (`web/src/lib/pfp/render`).

## Pieces, in build order

Each piece is usable on its own and adds a scene to the demo video. Each gets its own implementation plan.

| # | Piece | Needs on the server |
|---|---|---|
| 0 | **Device spike**: a bare dev build that connects Seed Vault and signs the three kinds of tx Mooner uses (see "Seed Vault questions") | nothing |
| 1 | **Core app**: sign-in, Live, the presale room (join, who's in, chat, get my SOL back), Launched, Me | nothing (shared chain code is a refactor) |
| 2 | **Trade + coin info**: buy and sell on the coin screen through Jupiter; price, market cap, chart, holders, liquidity, volume | the migrated event, the DAMM v2 pool's price, Meteora stats |
| 3 | **Share links**: `app.mooner.family/presale/<key>` opens the app; share sheet in the room | `assetlinks.json` |
| 4 | **Create from the phone** | nothing (`POST /api/mint` and the open tx exist) |
| 5 | **Push alerts**: your presales, people you follow, big market caps | devices table, sender on `feed.js`, follows (market caps come from piece 2) |
| 6 | **Real XP and Seeker perks**: the four titles, the streak, the leaderboard on web and phone, the Genesis perk | the XP ledger, the Genesis check |
| 7 | **Join with SKR** | nothing (Jupiter from the app) |
| 8 | **Submission kit**: repo access, APK, video, deck, registration. Runs alongside from the start | – |
| + | Optional, if the rest is solid: an Android home-screen widget with your presale's fill ring | – |

## The app (`mobile/`)

**Stack:**
- Expo ~55 (the version Solana Mobile's templates are built and tested on), React Native, expo-router, zustand.
- `@wallet-ui/react-native-web3js`, `@privy-io/expo`, `expo-secure-store`, `expo-notifications`, `expo-image-picker`, `expo-haptics`, `expo-sharing`.
- Package name `family.mooner.app`.

**Shared code, no forks:**
- **Engine code:** `engine/src` is imported through Metro `watchFolders`.
- **The flows:** open, join, set commit, get back and request mint move out of `web/src/real/chain.js` into one shared module. It takes three things from outside:
  - `api`: fetch against a base URL;
  - `subscribe`: the live socket;
  - `keys`: the session-key store.
- **Web:** keeps a thin adapter over the shared module, using `localStorage` and relative URLs.
- **Phone:** uses `expo-secure-store` and `https://app.mooner.family`.
- **Result:** the join and get-back logic, with its retries and ER fallbacks, exists once.

**One signer, two wallets:**

```
Signer {
  publicKey
  signTransactions(txs)   // sign only: entry txs, co-signed and sent by the server
  signAndSend(tx)         // settle_seat, the SKR swap
  signMessage(bytes)      // Mooner sign-in, the mint request
}
```

- **MWA:** `transact()`, with the auth token cached in `expo-secure-store` so reconnecting skips the approval screen.
- **Privy:** the embedded wallet's provider (`signTransaction`), plus `signAndSend` = sign + `sendRawTransaction`.
- **Screens** never know which one they have.
- **Mooner sign-in** stays Mooner's own `/api/login` (a signed message) for both wallets.

**Live data:**
- The same `/api/ws` socket and topics as the web: `presales`, `presale:<key>`, `launched`, `chat:*`, `wallet:<wallet>`, `profiles`.
- No polling. A dropped socket shows a thin banner and reconnects.

**Mooner pictures:**
- **How they're drawn:** the web's own renderer runs in a hidden WebView used only to draw pictures. The PNGs are cached on the device.
- **What judges see:** native screens only; the WebView is never on screen.
- **Fallback, if it misbehaves on the device:** the server draws them.

## Screens

**Tabs:** Live · Launched · **+** · Alerts · Me.

**Sign-in**
- "Connect Seed Vault" is the main button. "Continue with X or email" sits under it.
- A wallet holding a Genesis Token sees its perk right after sign-in.

**Live**
- Open presales as cards: coin image, ticker, fill bar out of 0.5 SOL (0.5 SOL for testing since 2026-09-30; was 10 SOL), time left, the faces of who's in. All of it updates live.
- **Auto-join:**
  1. Pick an amount once.
  2. The app picks the fullest presale with room for it, so it fills soonest.
  3. You approve once and you're in.
  4. If none has room, it waits and sends a push when one does. The tap opens that presale with the join sheet ready.
- **Every join needs the wallet's approval.** Auto-join picks the presale; it never signs for you.

**Presale room**
- **Top:** the coin, a large ring filling as SOL comes in with the Mooner faces of who's in around it, and the countdown.
- **Bottom:** a sticky "Join · 0.5 SOL" button opens a sheet:
  - amount chips 0.1 / 0.25 / 0.5 / 1;
  - pay with SOL or SKR;
  - approve on Seed Vault (double-tap the side button).
- **Once in:** "You're in · 0.5 SOL" and one "Get my 0.5 SOL back" button. The creator's stays locked until launch.
- **Chat:** slides up from the bottom.
- **Faces:** a tap opens that Mooner's card with a Follow button.
- **When it fills:** a full-screen launch sequence with haptics, then "Your tokens arrived" once the snipe tax is over, then the token screen.

**Launched**
- Every launched coin with its price, market cap and a small chart, updating live.
- A tap opens the coin screen: the info in "Coin info" below, your position, share, and sticky **Buy** and **Sell** buttons.
- **Buy sheet:** SOL amount chips 0.1 / 0.5 / 1 or your own amount. **Sell sheet:** 25% / 50% / 100%.
- Both show what you get, the price impact, the fee and the slippage (3% by default, as on the web). Approve on Seed Vault; haptics when it lands.

**+ Create**
1. Camera or gallery, cropped square.
2. Name, ticker, optional description and links.
3. Your commit.
4. Review: sign the mint request, then the open tx.
5. The new presale opens with the share sheet up.

**Alerts**
- Every push, newest first, with a switch per kind.
- Three groups: your presales, people you follow, big market caps.
- A tap opens the presale or the coin.

**Me**
- Your Mooner, large. From piece 6 on: XP, the four titles, badges (Genesis included) and your streak.
- Your presales: in, launched, refunded.
- The leaderboard, where every row can be followed. Editing your Mooner.
- Who you follow and who follows you.

**Phone-only touches:** haptics (join, fill, launch), the Android share sheet, App Links, the camera, push, Seed Vault's side-button approval.

## Server additions (`engine/server/`)

**Migration and the price after it**
- `feed.js` notices when a pool's `migrated` flag flips and emits a migrated event. XP and alerts listen to it.
- The flag's offset gets a test against a migrated mainnet DBC pool, not only a fresh one.
- The server finds the DAMM v2 pool each coin migrated to, subscribes to it, and decodes its price. How to find that pool and its price layout are read from Meteora's program and tested against a mainnet account.

**XP ledger**
- SQLite table `xp(wallet, title, points, reason, ref, at)`. `ref` is the presale or mint, so no event is counted twice.
- Awarded from events the keeper and feed already see:

| Title | Event | When it counts |
|---|---|---|
| Dev | you created the presale | it launches; more when the coin migrates |
| KOL | you joined the presale | it launches; more when the coin migrates |
| Raider | a wallet joined through your link | that presale launches; not yourself; one referrer per join |
| Diamond Hands | you got presale tokens | at migration, your wallet still holds them |

- **Streak:** consecutive UTC days with a confirmed join or open.
- **Point values and level thresholds:** the existing `xpForLevel` curve (levels 1–5). Per-event points are set in the plan and kept in one table in code.
- **Referral:**
  - A share link carries `?ref=<wallet>` (real profiles have a wallet and a picture, no handle).
  - The app keeps it until the join and sends it with `POST /api/cosign`.
  - The server records it only when the join confirms.
- **Where it shows:** `GET /api/xp/:wallet` and the `profiles` topic. The web leaderboard switches from sim to these, and `web/src/lib/levels.ts` gets the new titles (Dev in, Shiller out).

**Push**
- A `devices(wallet, token, kinds, updated_at)` table. `POST /api/device` takes a Mooner session token.
- `feed.js` hands each change to a notifier, which works out whose it is:

| Alert | Who gets it |
|---|---|
| filled | everyone in the presale |
| launched | everyone in the presale |
| tokens arrived | that wallet |
| someone joined yours | the creator |
| a presale has room | Auto-join waiters |
| someone you follow joined a presale, or opened one | their followers |
| a coin passed a market-cap milestone | everyone with that alert on |

- **The service:**
  - Expo push, which delivers through Firebase Cloud Messaging. The user's Seeker has Google Play Services, which that needs.
- **No spam:** one push per followed wallet per presale. When several people you follow join the same presale close together, they go out as one push ("3 people you follow are in $TICKER").

**Follows**
- A `follows(follower, followee, at)` table.
- `POST /api/follow` and `POST /api/unfollow` take a Mooner session token.
- Follower and following lists ride the `profiles` topic.
- The web gets the same Follow button on a Mooner's card.
- A follow alert fires only when the join or open confirms on chain.

**Market-cap milestones**
- Market cap is the coin's price × 1B × SOL/USD, from the DBC pool before migration and the DAMM v2 pool after.
- Milestones: $100k, $500k, $1M, $5M, $10M. They live in one list in code so they're easy to change.
- Each milestone fires once per coin, ever. A table `milestones(mint, usd, at)` records it, so a price bouncing around a line sends one alert, not many.
- On by default, with its own switch in Alerts.

**Genesis check**
- `POST /api/genesis` takes a session token.
- The server reads the wallet's Token-2022 accounts, skips zero balances, and reads each mint's metadata-pointer and group-member extensions against `GT22…`.
- It stores `genesis(mint, wallet)`, so one phone's token grants the perk once.
- **The perk:** a Genesis badge, a Seeker-only Mooner trait, and a one-time XP bonus.

**App Links**
- `/.well-known/assetlinks.json` with `family.mooner.app` and the release key's SHA-256, served by the app service.

## Trading

**Where a trade goes**
- Through Jupiter's swap API (`lite-api.jup.ag/swap/v1`), with the code the website already uses (`web/src/real/market.ts`, moved into shared code). Jupiter routes the coin's Meteora pool: DBC before migration, DAMM v2 after.
- The wallet signs and sends the swap. The server isn't involved and never holds anyone's funds.
- Before the wallet sees it, the phone checks that the wallet is the only signer the swap needs.
- Your balance updates over the `wallet:<wallet>` topic when the trade lands.
- **Unknown:** how soon after a launch Jupiter routes a brand-new DBC pool. It's checked on the first mainnet launch. Until a route exists, the coin screen says trading opens in a moment (the website says "no route for this trade yet").

**The snipe tax**
- DBC charges about 99% in the launch second, falling to the 1% floor at 3 s. It applies to buys and sells.
- The Buy and Sell buttons stay locked with a countdown until the floor, so nobody pays the tax by accident.

**The website**
- Unchanged: its trade panel already trades through Jupiter.

## Coin info

| | Before migration (DBC pool) | After migration (DAMM v2 pool) |
|---|---|---|
| Price, market cap | the pool account over the live socket (streamed today) | the DAMM v2 pool account, subscribed on chain the same way |
| Progress | SOL in the pool toward the 80 SOL migration line | "Migrated to Meteora DAMM v2" |
| Chart | GeckoTerminal candles, as the web does today | Meteora Data API candles |
| Liquidity | from the pool account | Meteora Data API TVL |
| Holders | the top holders from chain (`getTokenLargestAccounts`) | Meteora Data API holder count, plus the top holders from chain |
| 24h volume | GeckoTerminal | Meteora Data API |
| Your position | your balance and what it's worth | same |

- **Meteora Data API calls are made by the server, not the phone.** It fetches a pool's stats at most once a minute, only while someone has that coin open, and pushes them over the live socket. That stays far under the 10 requests a second limit.
- **The GeckoTerminal risk:** whether it indexes a fresh DBC pool is unknown until the first Mooner launch. If it doesn't, the server builds candles from the price changes it already receives for that pool.

## Join with SKR

1. The join sheet shows the price in SKR: a Jupiter quote from SKR to exactly the seat's lamports plus the join's fees.
2. The app builds the swap tx (Jupiter `swap/v1`, the code in `web/src/real/market.ts`, shared), then the join tx.
3. In one MWA session, the wallet signs and sends the swap, then signs the join (sign-only). The server co-signs and sends the join as today.
4. If the swap lands and the join fails, the SOL is in the user's wallet. The sheet says so and offers the SOL join.

Still to verify in the plan: whether Jupiter serves an exact-output route for SKR→SOL. If not, the app swaps a small margin extra and says so; any leftover stays in the wallet as SOL.

## Seed Vault questions (piece 0 settles them)

**Already known**, from a clean-room Seeker test in solana-mobile/mobile-wallet-adapter#1459, confirmed there by the Seed Vault team:
- Seed Vault signs without sending (MWA `signTransactions`).
- It rewrites a compute-unit price below 100,000 µLamports up to 100,000. Some dApp origins are configured differently.
- Mooner's entry txs use 50,000 today (`web/src/real/chain.js`), so a Seeker user pays double what the app shows. The gate skips compute-budget instructions, so it still co-signs.

Only a real Seeker can answer the rest, so these come first:

| Question | If the answer is bad |
|---|---|
| Does Seed Vault sign Mooner's own entry tx (v0, with the gate's key), and does the server's co-sign still verify after its fee rewrite? | Entry txs switch to wallet-sends: the gate signs first and the wallet signs and sends |
| Does its pre-sign simulation refuse an ER tx (`rotate_key`, `leave`), whose accounts are delegated on L1? | ER txs are signed by the session key only (the code already prefers it); the wallet signs only L1 txs |
| Does it add a priority fee to a tx that has none? | The app always sets one, at 100,000 on the phone, so the fee shown is the fee paid |

**Answers (Seeker, 2026-10-01):** Seed Vault Wallet 1.16.2, wallet `HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D`, release APK. The log lines are copied exactly.

| Question | What Seed Vault did (log lines) | Decision |
|---|---|---|
| The phone builds txs as Node does (Engine: golden join and ER txs, text sorting, device locale, one web3.js) | `golden join tx: same bytes as Node`, `golden ER tx (legacy): same bytes as Node`, `text sorting matches Node (web3.js's account order): yes`, `device locale: en-US; "en" sorting resolves to en`, `one web3.js: yes`, `wallet-ui's Connection is the app's web3.js: yes` | `engine/src` runs on the phone as it is |
| What Seed Vault reports it supports (Capabilities: its own answer; v0 txs yes / NO) | `Seed Vault's answer: {"supports_sign_and_send_transactions":true,"features":["solana:signTransactions"],"supported_transaction_versions":["legacy",0,1],"max_messages_per_request":20,"max_transactions_per_request":20,"supports_clone_authorization":false}`, `it has features, an MWA 2.0 field`, `v0 txs: yes`, `the adapter's getCapabilities() changes nothing` | (feeds the entry-tx row) |
| Signs the entry tx; gate still co-signs | `Seed Vault changed: compute-unit price 50000 -> 100000; account order changed`, `its signature covers the tx it returned: yes`, `the gate would co-sign it: yes (join)`. No presale was open and the wallet held 0.01 SOL (`a refusal here is inconclusive` both times), so it signed a join that would fail simulation: a signature counts, since `checkEntryTx` reads no chain state | keep server-sends |
| Signs an ER tx | `ER: https://as.magicblock.app`, `Seed Vault changed: compute-unit price none -> 100000; compute-unit limit none -> 200000`, `its signature covers the tx it returned: yes` (mainnet authorization). Not sent, so whether the ER accepts the added compute-budget instructions is untested | the wallet may sign ER txs; `flows.js` still tries the session key first |
| Adds a fee to a tx with none | `wallet holds 0.01 SOL on this network`, `Seed Vault changed: compute-unit price none -> 100000; compute-unit limit none -> 220000; added an instruction for L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`, `its signature covers the tx it returned: yes` | phone priority: 100,000 µLamports on every tx |
| Signs for devnet | Connect on devnet works (`wallet: HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D`). With `wallet holds 5 SOL on this network`, No-fee tx failed twice with `error: EUNSPECIFIED: java.util.concurrent.CancellationException` and once with `error: Timed out waiting for response: java.util.concurrent.TimeoutException: Timed out waiting for response with id=2`; Seed Vault's screen said "network mismatch" (seen by the user). After Disconnect and a fresh devnet Connect: ER tx `error: EUNSPECIFIED: java.util.concurrent.CancellationException`; Entry tx (mainnet cluster) signed, `the gate would co-sign it: yes (join)`. No devnet switch was found in Seed Vault Wallet 1.16.2 | phone flows tested on mainnet |
| signMessages reply layout | `signMessages returned 64 bytes`, `layout: signature only`, `Mooner sign-in: ok` (the first try logged `error: Network request failed`: the phone had no network, `Active default network: none`) | (pickSignature already handles it) |
| Fee on the real send | `fee paid: 12000 lamports (expected 10000)` | Seed Vault keeps the price and raises the limit for its Lighthouse instruction; `flows.js`'s fee check counts the wallet's price (100,000, `WALLET_PRICE`) and 400,000 CU on top (`WALLET_CU`), so a join is counted at 90,300 and an open at 115,300 lamports of fee |
| What landed on the real send (and any declined send that landed anyway) | `sent: 71GK6iM9TL35j2r6fXXTaFbve94PsAXsNw1FvHv2cWeNrMLQDSmmnJ2gYY84rnBvZu9iLCd1vYzeGUKuhDgxts3`, `confirmed`, `what landed differs: compute-unit limit 50000 -> 70000; added an instruction for L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`. Nothing was declined | the server's checks must keep letting the Lighthouse instruction through (they do today) |
| Error codes Seed Vault answered with (declines; Connect) | none with a numeric code: no prompt was declined and Connect never failed. The devnet failures above carry no code | nothing to change |

## Who pays

Unchanged: Mooner pays nothing.
- Users pay their own tx fees, the SKR swap's fees, and the MagicBlock fees as today.
- Push costs nothing to send (Expo push).

## Security

- **The gate:** it co-signs exactly what it does today. The phone changes nothing about what the server will sign.
- **Session keys:** in `expo-secure-store` (Android Keystore), never in plain storage.
- **The MWA auth token:** in `expo-secure-store`.
- **Referrals:** they count only for joins that confirm, in presales that launch. Self-referral is ignored.
- **Genesis perk:** one per Genesis mint, not per wallet.
- **Push tokens:** tied to the wallet by a Mooner session token, so nobody can register alerts for someone else's wallet.
- **Follows:** need a session token, so nobody can follow on someone else's behalf.
- **Trades:** Jupiter builds them and the wallet signs and sends them; the server never touches them. The phone refuses a swap that needs any signer besides the wallet.

## Testing

- **Engine and server** (`node --test`, the existing suite):
  - migration decoding against a mainnet fixture;
  - XP rules on the fake chain;
  - referral attribution;
  - the push notifier's fan-out;
  - the Genesis check against real Token-2022 account bytes saved from mainnet;
  - follow alerts fan out only on confirmed joins, grouped per presale;
  - each market-cap milestone fires once per coin, before and after migration;
  - the swap check rejects a tx that needs a signer besides the wallet.
- **Shared flows:** tested once under node with the fake chain, used by web and phone.
- **Web:** `vite build` and the existing checks; the leaderboard is checked in the browser pane.
- **Phone:** every piece is installed on the user's Seeker over `adb` and checked with `adb` screenshots. The user does the Seed Vault approvals.
- **Devnet or mainnet:** Seed Vault Wallet 1.16.2 doesn't sign devnet txs (piece 0, 2026-10-01: "network mismatch"), so the phone flows are proven on mainnet presales the user runs.
- **Trades:** the first real buy and sell are made by the user on mainnet, on the first Mooner coin that launches.

## Submission kit

Built alongside from piece 0, not at the end:
- **Repo:** `mobile/` work lands as regular commits (judges read the history). The repo `EchoWebLV/mooner-family` is private: it's made public or the judges are given access, the user's choice.
- **APK:** a signed release APK, built locally with `expo run:android --variant release` or with EAS.
- **Demo video:** about 3 minutes, recorded on the Seeker. Sign in with Seed Vault → Live → join (SOL and SKR) → the fill and launch → tokens arrive → buy and sell (Jupiter, on the coin's Meteora pool) → create from the camera → share link → push → Me with Genesis perk and XP.
- **Pitch deck.**
- **Align registration** and the funding-eligibility answer: the user's.

## Not in this release

- limit orders;
- iOS;
- private presales and invites;
- the fee router;
- dApp Store publishing (required within 30 days of winning);
- the home-screen widget unless time allows.
