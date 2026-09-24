# Mooner — Wireframe & Demo Design

- **Date:** 2026-09-24
- **Status:** Approved in brainstorming, awaiting spec review
- **Scope of this spec:** a clickable, simulated front-end demo. No wallet, chain, chat server, auth, or X data ingestion — each of those gets its own spec later.

## 1. Product in one paragraph

Mooner is a social, gamified Solana launchpad. Every token starts as a **match**: a crew of friends or strangers, each playing a **role** (KOL, Diamond Hands, Shiller, Raider), fills an **8.5 SOL pre-bond** together, presses **Ready** like a Dota/Pokémon Go lobby, and launches. The whole pre-bond executes as the first buy on the bonding curve and is split **pro-rata at the same price for everyone**. Home is one big **global chat** next to three Axiom-style **rails** that only ever show Mooner tokens. Every token has its own chart and chat. Playing roles earns XP; each role levels up through five named badges.

## 2. Decisions made in brainstorming

| Topic | Decision |
|---|---|
| Allocation | Same price, pro-rata to SOL committed. 2 SOL gets 20× what 0.1 SOL gets. |
| Rails | **New Pairs** = matches filling their pre-bond · **Final Stretch** = pre-bond filled, live on the curve · **Migrated** = graduated to an AMM pool |
| Visual direction | Hybrid: dense trading-terminal look for rails, chart, trades and chat; game-HUD look for matchmaking, lobby, profiles, badges and level-ups |
| Build | Next.js App Router + plain CSS + TypeScript, mock world driven by a simulator |
| Matchmaking view | You watch the match form: every seat is a circle, laid out in **rows** above a pre-bond bar (Dota accept-screen style). Circles fill with people as they join. |
| Roles | Four roles, five levels each, one named badge per level (20 badges) |
| Reference | "Magic Pad" could not be found online; the allocation rule above was decided explicitly instead. |

## 3. Mechanics

### 3.1 Lifecycle

```
lobby ──(all seats filled + pool = 8.5 SOL + everyone Ready)──▶ countdown (5 s) ──▶ live ──(curve sold out)──▶ migrated
  │
  └──(timer runs out before launch)──▶ expired  (everyone refunded, card removed)
```

| Stage | Rail | Can change? |
|---|---|---|
| `lobby` | New Pairs | Join, leave, change commit, toggle Ready |
| `countdown` | New Pairs (card shows "LAUNCHING 3…") | Nothing — locked in |
| `live` | Final Stretch | Buy / sell on the curve |
| `migrated` | Migrated | Buy / sell on the AMM pool |
| `expired` | hidden from the rail after a 3 s "EXPIRED" flash; its lobby page shows "Expired — everyone was refunded" | — |

Stages only move forward.

### 3.2 Pre-bond and seat rules

All SOL math uses **integer lamports** (1 SOL = 1,000,000,000) so pool totals are exact.

| Constant | Value |
|---|---|
| `PREBOND_TARGET` | 8.5 SOL |
| `MIN_COMMIT` / `MAX_COMMIT` | 0.1 SOL / 2 SOL per member |
| `COMMIT_STEP` | 0.01 SOL (slider granularity) |
| `MIN_SEATS` / `MAX_SEATS` | 5 / 20 (5 × 2 SOL is the fewest seats that can reach 8.5) |
| `READY_WINDOW` | 30 s |
| `COUNTDOWN` | 5 s |
| Lobby timer | creator picks 5, 10 or 15 min (seeded demo lobbies use 2–8 min) |

- **Seat:** has a `role` (one of the four, or `any`) and a `minLevel` (1–5). A user can take a seat when the role they choose to play matches (anything matches `any`) and their level in that role ≥ `minLevel`.
- **Max commit** for a seat:
  `maxCommit = min(MAX_COMMIT, PREBOND_TARGET − (sum of other members' commits) − MIN_COMMIT × (open seats other than this one))`
  This guarantees the pool can never fill before every seat can still put in 0.1 SOL. Invariant: `maxCommit ≥ MIN_COMMIT` for any open seat.
- **Pool cap:** the pool can never exceed 8.5 SOL (follows from the max-commit rule).
- **Escrow:** committing moves SOL from the wallet into the pool immediately. Lowering a commit, leaving, being removed, or expiry returns it.
- **Short pool:** if every seat is filled but the pool is below 8.5 SOL, the lobby shows "short by X SOL — top up"; members can raise their commit.
- **Ready:** you can press Ready once you have committed. Changing your commit clears your Ready.
- **Ready window:** when all seats are filled *and* the pool is exactly 8.5 SOL, a 30 s window starts. Anyone not Ready when it ends is removed and refunded; their seat reopens. The window only runs while the lobby stays full and funded — if someone leaves or lowers their commit, it is cancelled and restarts once both hold again.
- **Launch:** fires the moment all seats are filled, the pool is exactly 8.5 SOL, and every member is Ready.
- **Creator:** occupies a seat like anyone else and must commit.
- **Leaving:** allowed in `lobby`, refunds your commit, reopens your seat. Not allowed in `countdown`.
- **Private lobbies:** appear in New Pairs with a lock icon; their seats can only be taken through the invite link (`/lobby/[id]?invite=CODE`). Find Match never places anyone in a private lobby. Bots join both kinds (in private ones they stand in for invited friends).
- **Expiry:** at the lobby timer, an unlaunched lobby becomes `expired` and refunds everyone.

### 3.3 Bonding curve and allocation

Constant-product math with virtual reserves. **All parameters are placeholders**, kept as named constants so the real values drop in later.

| Constant | Value |
|---|---|
| `TOTAL_SUPPLY` | 1,000,000,000 |
| `VIRTUAL_SOL_0` | 30 SOL |
| `VIRTUAL_TOKENS_0` | 1,073,000,000 |
| `CURVE_TOKENS_FOR_SALE` | 793,100,000 |
| `LP_TOKENS` | 206,900,000 |
| `SOL_USD` | 150 (mock, display only) |

- **Buy:** `tokensOut = vT − k / (vS + solIn)`, `k = vS × vT`. A buy that would exceed the remaining for-sale tokens is capped and charges only the SOL needed.
- **Sell:** `solOut = vS − k / (vT + tokensIn)`.
- **Launch:** the 8.5 SOL pool is the first buy. `T = tokensOut(8.5 SOL)`; member *i* gets `T × commit_i / 8.5`. Every member's price is `8.5 / T` — identical by construction.
- **Migration:** when all `CURVE_TOKENS_FOR_SALE` are sold. The AMM pool is seeded with the SOL raised and `LP_TOKENS`, then trades with the same constant-product formula on real reserves.
- **Curve progress:** tokens sold ÷ `CURVE_TOKENS_FOR_SALE`.
- **Market cap:** spot price × `TOTAL_SUPPLY` (× `SOL_USD` for display).
- No fees in the demo.

Numbers these placeholders produce (computed, not estimated):

| | Value |
|---|---|
| Pre-bond tokens (`T`) | 236,896,104 — **23.69 % of supply goes to the crew** |
| 1.0 SOL commit | 27,870,130 tokens (2.787 % of supply) |
| Crew entry price | 3.588e-8 SOL per token |
| Market cap at start → after pre-bond | 27.96 SOL → 46.05 SOL |
| SOL raised at migration | 85.005 SOL (the 8.5 SOL pre-bond is exactly 10 % of it) |
| Market cap at migration | 410.9 SOL |

> **Parameter to revisit with the real curve:** at these values the crew holds ~23.7 % of supply at launch.

## 4. Roles, levels, badges

### 4.1 Roles

Every user has all four roles and levels each one independently. Each user also has a **main role** (their highest-level role, ties broken by XP) that is shown next to their name in chat.

| Role | Measures | Later data source | Demo stats |
|---|---|---|---|
| **KOL** | Reach and call quality | X + Mooner launch history | followers, engagement %, call win rate |
| **Diamond Hands** | Conviction | on-chain | avg hold time, % held to migration, early dumps |
| **Shiller** | Original content | X | posts, impressions, top post |
| **Raider** | Coordinated engagement | X | raids joined, actions per raid, reply speed |

### 4.2 Levels and XP

| Level | Rarity | XP needed | KOL | Diamond Hands | Shiller | Raider |
|---|---|---|---|---|---|---|
| 1 | Common | 0 | Caller | Stone | Poster | Scout |
| 2 | Uncommon | 100 | Voice | Iron | Hypeman | Raider |
| 3 | Rare | 300 | Signal | Steel | Memelord | Vanguard |
| 4 | Epic | 800 | Oracle | Diamond | Storyteller | Warlord |
| 5 | Legendary | 2000 | Prophet | Moon | Mythmaker | Legion |

Demo XP awards (placeholders): **+80 XP** to the role you played when your lobby launches, **+150 XP** to that role when the token migrates.

### 4.3 Badge art

Badges are SVG React components — `<Badge role level size />` — built from three layers, so all 20 come from one system:

| Layer | Encodes | Progression |
|---|---|---|
| Frame | Level | L1 plain disc → L2 riveted hex → L3 shield with banner → L4 winged crest → L5 crowned star with rotating rays |
| Emblem | Role | KOL: megaphone with waves · Diamond Hands: diamond held in cupped hands · Shiller: rocket inside a speech bubble · Raider: crossed swords with a bolt |
| Colour | Rarity | grey → green → blue → purple → gold (gold has an animated shimmer) |

Level is also shown as a roman numeral on the banner, so colour is never the only signal.

### 4.4 Level-up moment

Full-screen overlay: dark backdrop, radial burst, badge spins and scales in, shine sweeps across, particles, "LEVEL UP · Raider III · Vanguard", XP bar fills to the new value. Dismiss with click or Esc. Fires when an XP award crosses a threshold; the profile page has a "Simulate level-up" button for demos. With `prefers-reduced-motion`, it fades in with no spin or particles.

### 4.5 Where badges appear

Chat (small, next to the handle, main role), lobby circles (corner badge of the role being played), holders and trades tables, crew strip on Final Stretch cards, profile role cards, badge cabinet, `/badges` gallery.

## 5. Screens

### 5.1 Shell (every page)

Top bar: **MOONER** wordmark · nav (Pulse, Launch, Badges) · search (filters rails by name or ticker) · SOL price (mock) · **Find Match** (primary, game-styled) · demo wallet balance (starts at 25 SOL; commits and buys deduct, refunds and sells credit) · profile chip (avatar, main badge, level).

### 5.2 Pulse — `/`

Three rails plus the global chat docked on the right (collapsible).

| Rail | Sort | Card shows |
|---|---|---|
| New Pairs | newest first | token art, name, $TICKER, age, **mini circle rows** (filled avatars / dashed empty seats), pre-bond bar "6.2 / 8.5 SOL", seats "8/12", time left, **Join** |
| Final Stretch | curve progress, highest first | art, name, ticker, time since launch, market cap, curve progress bar, volume, holders, price change, crew badge strip, **quick buy 0.1 SOL** |
| Migrated | most recently migrated first | art, name, ticker, market cap, liquidity, volume, holders, price change, "migrated 12m ago", **quick buy 0.1 SOL** |

- A token entering a rail animates in at the top of the rail with a brief highlight.
- Each rail shows at most 30 cards.
- Clicking a New Pairs card opens its lobby; any other card opens the token page.
- **Global chat:** avatar, handle, main-role badge, level, time, text. `$TICKER` mentions of existing tokens are links. Composer at the bottom. Bots post continuously.

### 5.3 Lobby / match — `/lobby/[id]`

The same screen serves a lobby opened from New Pairs and a match found through Find Match. After Find Match the header reads **LOOKING FOR MATCH · 0:42** (time since you queued) until the lobby is full.

- **Header:** token art, name, ticker, creator, description, Public or Private (with a copyable invite link), time left.
- **Seat circles in rows:**
  - Filled: avatar, role badge in the corner, level, handle underneath. A green ring plus a check icon when that person is Ready. Your circle is marked **YOU**.
  - Empty: dashed ring, pulsing, role icon and requirement ("Raider Lv 3+", or "Any").
  - Clicking a filled circle opens that player's stat card (role, level, key stats, badges).
- **Pre-bond bar:** segmented by member contribution, labelled "6.2 / 8.5 SOL".
- **Status line:** "8/12 joined · needs 2 Raider, 1 KOL, 1 any".
- **Your panel:**
  - Not joined: pick an open seat and the role you'll play there (seats you can't take show a lock with the required level), choose a commit (0.1 → your max, 0.01 steps), **Join seat**.
  - Joined: change commit, **READY** toggle, **Leave**.
  - Commit input explains its limit, e.g. "max 1.40 SOL — 4 open seats still need 0.1 each".
  - **Allocation preview:** "1.00 SOL → ≈ 27.87M $MOON (2.79 % of supply) — same price as everyone".
- **Ready window banner:** "All seats filled — READY UP 0:30".
- **Launch:** 5-second countdown overlay → "LAUNCHED" → navigate to `/token/[id]` → level-up overlay if your XP crossed a threshold.
- **Chat:** the token's channel, with a tab to switch to Global.
- A `live` or `migrated` token's lobby URL redirects to its token page.

### 5.4 Find Match (dialog)

Opened from the top bar.

1. **Pick your role:** four cards showing your level and current badge for each role.
2. **Pick your amount:** 0.1–2 SOL.
3. **Find Match:** chooses the public lobby that has an open seat you qualify for, preferring the one with the most seats filled, then the one soonest to expire; if none exists, spawns a new public lobby with a matching seat. You are seated immediately and taken to `/lobby/[id]` in LOOKING FOR MATCH mode, where you watch the circles fill. Your requested amount is clamped to that seat's max (the panel says so if it was).

### 5.5 Token — `/token/[id]`

- **Header:** art, name, ticker, mock contract address (copy), social links (stubs), stage pill (Live on curve / Migrated), price, market cap, change, curve progress or liquidity.
- **Chart:** lightweight-charts candlestick series, 10-second candles, updates live.
- **Tabs under the chart:**
  - Trades: time, buy/sell, SOL, tokens, trader with badge.
  - Holders: rank, trader with badge, % of supply, "crew" tag.
  - Crew: every lobby member with role, level, SOL committed, tokens allocated, and whether they still hold.
- **Right column:** trade panel (Buy / Sell, presets 0.1 · 0.5 · 1 · 2, amount input, "you receive ≈", confirm), your position (tokens, average entry, PnL), then the token's chat.
- A token still in `lobby` or `countdown` redirects to its lobby.

### 5.6 Launch wizard — `/launch`

1. **Token:** name, ticker (2–10 characters, uppercased), description, optional X / Telegram / website. Art is generated from the name (upload is a disabled stub).
2. **Crew:** a counter for each seat type (KOL, Diamond Hands, Shiller, Raider, Any) with an optional minimum level each; total must be 5–20, validated inline.
3. **Lobby:** Public (open to matchmaking) or Private (invite link); timer 5 / 10 / 15 min.
4. **You:** pick your own seat and role, set your commit, review, **Open lobby**. The new token appears at the top of New Pairs and you land in its lobby.

### 5.7 Profile — `/profile/[handle]`

- **Header:** avatar, handle, mock "Connected to X" chip, main-role badge, launches played, win rate.
- **Four role cards:** big badge, level name, XP bar with numbers, next badge shown locked, that role's stats.
- **Badge cabinet:** 20 badges in a role × level grid; locked ones greyed out.
- **Launch history:** token, role played, SOL committed, outcome (live / migrated / expired), mock PnL.
- **Simulate level-up** (own profile only): pick a role, play the overlay.

### 5.8 Badges — `/badges`

A role × level grid of all 20 badges at 128 px with level name, rarity and XP needed; each animates on hover. Below it, how each role earns XP.

## 6. Visual language

- **Terminal zones** (rails, token page, trades, holders, chat): compact 12–13 px data, monospaced numerals, hairline borders, colour reserved for up (green) and down (red).
- **Game zones** (Find Match, lobby circles, profile, badges, level-up): display typeface, rarity glows, XP bars, bold motion.
- **Type:** Geist Sans (UI), Geist Mono (numbers), Chakra Petch (HUD headings) via `next/font/google`. Font availability is checked when scaffolding.
- **Colour:** tokens defined once in `globals.css`. Dark base (`--bg-0` #07080C, `--bg-1` #0D1017, `--bg-2` #141925, `--line` #1F2633), text (`--text-0` #E8ECF4, `--text-1` #9AA4B8, `--text-2` #5F6B80), trade up/down, five rarity colours, and one brand accent for primary actions that doesn't collide with those (starting value: hot magenta #FF4FB8). All values are starting points for the implementation design pass.
- **Generated art:** avatars and token art are deterministic SVGs from a hash of the handle or name — no image files, no external requests.
- **Motion:** circles pop in on join, empty seats pulse, the Ready ring glows, rail entries highlight, countdown, level-up burst. Everything respects `prefers-reduced-motion`.
- **Responsive:** built for ≥1280 px. At ≤1024 px the chat dock collapses behind a toggle. At ≤768 px the rails become tabs, circle rows wrap, and the token page stacks chart → trade → chat.
- **Accessibility:** visible focus states, labelled controls, and state never shown by colour alone (Ready = ring + check, rarity = colour + frame + numeral).

## 7. Architecture

### 7.1 Stack

Next.js 16.3 (App Router, Turbopack), React 19.3, TypeScript (the version `create-next-app` pins), plain CSS (global tokens + CSS Modules), zustand 5, lightweight-charts 5.2, Vitest, pnpm.

### 7.2 Layout

```
src/
  app/
    layout.tsx                 fonts, <WorldProvider>, <TopBar>
    globals.css                design tokens, reset
    page.tsx                   Pulse
    lobby/[id]/page.tsx        Lobby / match
    token/[id]/page.tsx        Token
    launch/page.tsx            Launch wizard
    profile/[handle]/page.tsx  Profile
    badges/page.tsx            Badge gallery
  components/
    shell/     TopBar, WalletChip, ProfileChip, FindMatchDialog, Toasts
    rails/     Rail, LobbyCard, LiveCard, MigratedCard
    chat/      ChatPanel, ChatMessage, ChatComposer
    match/     SeatRows, SeatCircle, PlayerCard, PrebondBar, CommitPanel, ReadyBanner, CountdownOverlay
    token/     PriceChart, TradePanel, PositionCard, TradesTable, HoldersTable, CrewTable
    badges/    Badge, BadgeFrame, RoleEmblem, LevelUpOverlay, XpBar
    profile/   RoleCard, BadgeCabinet, LaunchHistory
    ui/        Button, Tabs, Dialog, Avatar, TokenArt, Stat, Pill, Skeleton
  lib/
    types.ts       domain model (7.3)
    constants.ts   every number in §3 and §4.2
    curve.ts       buy, sell, spot price, market cap, prebondAllocation
    lobby.ts       maxCommit, canTakeSeat, canLaunch, join / leave / commit / ready transitions, expiry, ready window
    levels.ts      levelForXp, xpToNext, level names, mainRole
    format.ts      SOL, USD, compact numbers, percentages, ages
    rng.ts         seeded PRNG
    sim/
      personas.ts  bot handles, chat phrase bank per role
      seed.ts      initial world
      step.ts      step(world, rng, dtMs) → world (pure)
    store.ts       zustand store: world, user actions, simulator loop
```

`curve.ts`, `lobby.ts` and `levels.ts` are pure and hold every rule; components only call them. When the backend arrives, these become the client-side mirror of the on-chain program, and `store.ts` swaps the simulator for real data sources.

### 7.3 Domain model

```ts
type Role = 'kol' | 'diamond' | 'shiller' | 'raider';
type Stage = 'lobby' | 'countdown' | 'live' | 'migrated' | 'expired';
type Lamports = number; // integer

interface RoleProgress { xp: number; level: 1 | 2 | 3 | 4 | 5 }

interface User {
  id: string; handle: string; isBot: boolean;
  roles: Record<Role, RoleProgress>;
  stats: RoleStats;                      // per-role demo stats from §4.1
  history: LaunchRecord[];               // bots: seeded; demo user: appended by the store
}

interface LaunchRecord {                 // self-contained, so it survives token pruning
  tokenId: string; name: string; ticker: string; playing: Role;
  commit: Lamports; outcome: 'live' | 'migrated' | 'expired'; pnlSol: number; at: number;
}

interface Seat {
  id: string; role: Role | 'any'; minLevel: 1 | 2 | 3 | 4 | 5;
  member?: { userId: string; playing: Role; commit: Lamports; ready: boolean; joinedAt: number };
}

interface Lobby {
  visibility: 'public' | 'private'; inviteCode?: string;
  seats: Seat[]; expiresAt: number;
  readyWindowEndsAt?: number; countdownEndsAt?: number;
}

interface Pool { solReserve: number; tokenReserve: number; tokensSold: number } // curve: virtual reserves; AMM: real reserves

interface Token {
  id: string; name: string; ticker: string; description: string; creatorId: string;
  stage: Stage; createdAt: number; launchedAt?: number; migratedAt?: number;
  lobby: Lobby;
  pool?: Pool;                           // from launch onward
  allocations?: { userId: string; commit: Lamports; tokens: number }[];
  positions: Record<string, number>;     // userId → tokens held
  candles: Candle[];                     // 10 s, newest last, capped at 360
  trades: Trade[];                       // newest last, capped at 200
  volumeSol: number; heat: number;       // heat: simulator buy pressure 0..1
}

interface Candle { t: number; o: number; h: number; l: number; c: number }
interface Trade { id: string; at: number; userId: string; side: 'buy' | 'sell'; sol: number; tokens: number; price: number }
interface ChatMessage { id: string; channel: 'global' | string; userId: string; text: string; at: number }

interface World {
  now: number; meId: string; walletLamports: Lamports;
  users: Record<string, User>; tokens: Record<string, Token>;
  chat: Record<string, ChatMessage[]>;   // keyed by channel ('global' or token id), each capped at 500
  queuedAt?: number;                     // set by Find Match, drives "LOOKING FOR MATCH · m:ss"
}
```

### 7.4 Simulator

- `step(world, rng, dtMs)` is pure: same inputs, same output. The store calls it once per second.
- Each tick:
  - keeps 6–10 lobbies in New Pairs by spawning bot-created ones (random seat mix, 5–20 seats)
  - bots join open seats they qualify for and commit within the allowed range
  - bots top up short pools and press Ready a few seconds after a lobby fills
  - applies the ready window, lobby expiry, countdown and launch (running the pre-bond first buy and allocations)
  - trades live and migrated tokens: buy/sell size and direction come from the token's `heat`, which is rolled at launch and decays, so some tokens run to migration within minutes and others stall
  - updates candles, volume and holders
  - migrates tokens whose curve sold out
  - posts bot chat to global and token channels, weighted by token activity
- All lists are capped so memory stays bounded over a long demo. Tokens are pruned too: expired tokens after 5 minutes, and beyond 40 per stage the oldest stalled `live` and oldest `migrated` tokens go first. Tokens the demo user holds or is seated in are never pruned.
- **Seed:** ~60 bot users with a spread of levels and stats; ~8 lobbies at different fill levels (one close to launch); ~10 live tokens at different curve progress; ~8 migrated tokens; pre-generated candle history; ~40 chat messages.
- **Demo user:** handle `you`, 25 SOL. Starting XP: KOL 40 (L1), Diamond Hands 760 (L3), Shiller 120 (L2), Raider 250 (L2). The first launch as KOL, Diamond Hands or Raider crosses a threshold and shows the level-up overlay.
- **Determinism:** fixed seed, so every load starts from the same state. The world is created in the browser only (inside `WorldProvider`), so server and client markup never disagree; pages render skeletons until it exists. Route params are read with `useParams()`.

### 7.5 Store actions

`findMatch(role, amount)`, `takeSeat(tokenId, seatId, playing, amount)`, `setCommit(tokenId, amount)`, `toggleReady(tokenId)`, `leaveSeat(tokenId)`, `sendChat(channel, text)`, `buy(tokenId, sol)`, `sell(tokenId, tokens)`, `createLaunch(form)`, `simulateLevelUp(role)`.

Every action validates through `lobby.ts` / `curve.ts` and either applies or returns an error message the UI shows inline or as a toast. Wallet balance is checked before any commit or buy.

## 8. Edge cases

| Case | Behaviour |
|---|---|
| Commit above your max | Clamped; the limit and reason are shown |
| Commit above wallet balance | Blocked with "not enough SOL" |
| Seat above your level | Shown locked with the required level |
| Ready before committing | Button disabled |
| Commit changed after Ready | Ready cleared |
| Not Ready when the ready window ends | Removed, refunded, toast |
| Lobby expires | Everyone refunded, toast for you, card flashes "EXPIRED" then goes |
| Leave during countdown | Disabled |
| Buy larger than what's left on the curve | Capped; only the needed SOL is charged |
| Sell more than you hold | Capped to your position |
| Unknown token or profile id | "Not found" state with a link back to Pulse |
| Find Match with no qualifying lobby | A new public lobby is spawned with a seat for you |

## 9. Testing and verification

**Vitest (pure logic):**
- `curve.test.ts` — price strictly increases with buys and decreases with sells; 8.5 SOL from the initial state yields 236,896,104 ± 1 tokens; migration happens at 85.005 ± 0.001 SOL raised; buy-then-sell never returns more SOL than went in; pro-rata allocations sum to `T` and give every member the same price.
- `lobby.test.ts` — `maxCommit` leaves 0.1 SOL for each other open seat; `maxCommit ≥ MIN_COMMIT` for every open seat; the pool never exceeds 8.5 SOL; seat totals outside 5–20 are rejected; `canLaunch` is false unless all three conditions hold; changing a commit clears Ready; the ready window removes non-Ready members and refunds them; expiry refunds everyone.
- `levels.test.ts` — thresholds map to the right levels and names; main role picks the highest level, then XP.
- `step.test.ts` — over 2,000 ticks from a fixed seed: no pool above 8.5 SOL, no negative reserves, stages only move forward, every migrated token sold out its curve, list sizes stay within their caps, and the same seed gives the same world.

**Build:** `pnpm build` passes (type check included).

**In the browser pane:** walk every screen at desktop and mobile widths and capture screenshots — Pulse with cards moving between rails, Find Match → circles filling → Ready → countdown → token page → level-up overlay, a trade, a launch created through the wizard, profile, badge gallery, and an expired lobby.

## 10. Out of scope (future specs)

- Wallet connection and the on-chain program (pre-bond escrow, curve, migration)
- Realtime chat backend and moderation
- X data ingestion and role scoring
- Auth and real profiles
- Leaderboards, seasons, notifications
- Real token image upload
