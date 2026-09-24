# Mooner — Wireframe & Demo Design

- **Date:** 2026-09-24
- **Status:** Revision 2 — updated after review, awaiting spec review
- **Scope of this spec:** a clickable, simulated front-end demo. No wallet, chain, MagicBlock integration, chat server, auth, or X data ingestion — each of those gets its own spec later.

## 0. Revision 2 changes

| Area | Revision 1 | Revision 2 |
|---|---|---|
| Joining | Creator picks a crew of role seats | Anyone joins a presale; no seats, no role requirements |
| Roles | Chosen per launch, gate seats | **Titles**: earned from activity, shown on everyone, never required |
| Launch trigger | All seats filled + 8.5 SOL + everyone Ready | **Automatic** the moment the pool hits 8.5 SOL — no Ready |
| Infrastructure story | — | Presale runs on a **MagicBlock Ephemeral Rollup**; launch settles to Solana |
| Leaderboard | Out of scope | **Public leaderboard** in scope; "invite to project" is a stub for later |
| Naming | lobby, `/lobby/[id]` | presale, `/presale/[id]` |

## 1. Product in one paragraph

Mooner is a social, gamified Solana launchpad, built to be the fairest way to launch a token. Every token starts as a **presale**: anyone chips in 0.1–2 SOL and everyone watches people join live, as circles. The presale runs on a MagicBlock Ephemeral Rollup, before the token exists on Solana. The moment the pool reaches **8.5 SOL** it settles to Solana and the token launches with the whole pool as its first buy, split **pro-rata at one price for everyone, creator included**. Everyone carries **titles** — KOL, Diamond Hands, Shiller, Raider — that level up through five badges, and it all lands on a **public leaderboard** that shows who is behind every project. Home is one big **global chat** next to three Axiom-style **rails** that only ever show Mooner tokens; every token has its own chart and chat.

## 2. Decisions

| Topic | Decision |
|---|---|
| Allocation | Same price, pro-rata to SOL committed. 2 SOL gets 20× what 0.1 SOL gets. (Confirmed twice.) |
| Launch trigger | Automatic when the pool reaches exactly 8.5 SOL. No Ready step. |
| Rails | **New Pairs** = presales filling · **Final Stretch** = launched, live on the curve · **Migrated** = graduated to an AMM pool |
| Presale infrastructure | MagicBlock Ephemeral Rollup during the presale → settles to Solana at launch. The demo shows this; real integration is a later spec. |
| Titles | Four titles, five levels each, one named badge per level (20 badges). Earned, not chosen; never a requirement to join. |
| Leaderboard | Public, ranked by XP overall and per title. Used to judge who is behind a project; later, to invite people to projects. |
| Visual direction | Hybrid: dense trading-terminal look for rails, chart, trades and chat; game-HUD look for matchmaking, presale, profiles, leaderboard, badges and level-ups |
| Matchmaking view | You watch the presale form: every participant is a circle, laid out in **rows** above the pool bar (Dota accept-screen style) |
| Build | Next.js App Router + plain CSS + TypeScript, mock world driven by a simulator |
| Reference | "Magic Pad" could not be found online; mechanics above were decided explicitly instead. |

## 3. Mechanics

### 3.1 Lifecycle

```
presale ──(pool reaches 8.5 SOL)──▶ launching ──▶ live ──(curve sold out)──▶ migrated
   │
   └──(timer runs out before 8.5 SOL)──▶ expired  (everyone refunded)
```

| Stage | Where it runs | Rail | What you can do |
|---|---|---|---|
| `presale` | MagicBlock Ephemeral Rollup | New Pairs | Join, change your commit, withdraw |
| `launching` | settling to Solana | New Pairs (card shows "SETTLING TO SOLANA…") | Nothing — locked in |
| `live` | Solana, bonding curve | Final Stretch | Buy / sell on the curve |
| `migrated` | Solana, AMM pool | Migrated | Buy / sell on the pool |
| `expired` | — | hidden from the rail after a 3 s "EXPIRED" flash; its presale page shows "Expired — everyone was refunded" | — |

Stages only move forward. In the demo, `launching` lasts 4 s and plays the settle animation; the real duration is set by the chain and is not modelled.

### 3.2 Presale rules

All SOL math uses **integer lamports** (1 SOL = 1,000,000,000) so pool totals are exact.

| Constant | Value |
|---|---|
| `PRESALE_TARGET` | 8.5 SOL |
| `MIN_COMMIT` / `MAX_COMMIT` | 0.1 SOL / 2 SOL per wallet |
| `COMMIT_STEP` | 0.01 SOL — every commit is a multiple of it, so what's left in the pool always is too |
| `LAUNCH_SETTLE` | 4 s (demo animation only) |
| Presale timer | the creator picks 5, 10 or 15 min; bot-opened presales use 2–8 min |

- **Remaining:** `remaining = PRESALE_TARGET − pool`.
- **Commit range** for your total position: let `room = remaining + your current commit`; then `min = min(MIN_COMMIT, room)` and `max = min(MAX_COMMIT, room)`. When `room` is under 0.1 SOL (only possible for someone who hasn't joined yet), min = max = room: the commit is exactly what's left, so the pool can always be completed.
- **Pool cap:** the pool can never exceed 8.5 SOL. A requested amount above the max is clamped, and the UI says so.
- **Participants:** one position per wallet. The count falls out of the limits: at least 5 (4 × 2 SOL + 0.5), at most 85 (85 × 0.1 SOL).
- **Change / withdraw:** while in `presale`, you can raise or lower your commit within the range, or withdraw it entirely (full refund).
- **Escrow:** committing moves SOL from the wallet into the pool immediately. Lowering, withdrawing, or expiry returns it.
- **Launch:** the moment the pool reaches exactly 8.5 SOL, the presale moves to `launching`, then `live`. No Ready step, no waiting on anyone.
- **Creator:** commits like everyone else — same price, same 2 SOL cap, no team allocation. The creator can change their commit but can't withdraw it.
- **Titles never gate anything:** anyone can join any public presale.
- **Private presales:** appear in New Pairs with a lock icon; joining needs the invite link (`/presale/[id]?invite=CODE`). Find Match never places anyone in a private presale. Bots join both kinds (in private ones they stand in for invited friends).
- **Expiry:** at the presale timer, an unfilled presale becomes `expired` and refunds everyone.

### 3.3 No snipers, no insiders

How the design removes each advantage. The demo shows it; the real guarantees belong to the on-chain spec.

| Advantage elsewhere | Why it doesn't exist on Mooner |
|---|---|
| Bots buying in the creation block | During the presale the token doesn't exist on Solana — there is no mint to watch or buy. |
| Buying between creation and the community | Launch creates the token and executes the whole 8.5 SOL pool as the first curve buy in one transaction, so nothing can land in between. |
| Cheaper insider entry | Everyone in the presale, creator included, gets the identical price (§3.4). There is no team allocation. |
| Hidden holders | Every participant appears publicly with their titles, levels and leaderboard rank — on the presale circles, the token page, and the leaderboard. |

**Known limit (for the on-chain spec, not the pitch):** one person can still split SOL across several wallets. The 2 SOL per-wallet cap limits the size of that, and titles plus the public leaderboard make anonymous wallets visible as such, but neither prevents it.

### 3.4 Bonding curve and allocation

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
- **Launch:** the 8.5 SOL pool is the first buy. `T = tokensOut(8.5 SOL)`; participant *i* gets `T × commit_i / 8.5`. Everyone's price is `8.5 / T` — identical by construction.
- **Migration:** when all `CURVE_TOKENS_FOR_SALE` are sold. The AMM pool is seeded with the SOL raised and `LP_TOKENS`, then trades with the same constant-product formula on real reserves.
- **Curve progress:** tokens sold ÷ `CURVE_TOKENS_FOR_SALE`.
- **Market cap:** spot price × `TOTAL_SUPPLY` (× `SOL_USD` for display).
- No fees in the demo.

Numbers these placeholders produce (computed, not estimated):

| | Value |
|---|---|
| Presale tokens (`T`) | 236,896,104 — **23.69 % of supply goes to presale participants** |
| 1.0 SOL commit | 27,870,130 tokens (2.787 % of supply) |
| Presale price | 3.588e-8 SOL per token |
| Market cap at start → after presale buy | 27.96 SOL → 46.05 SOL |
| SOL raised at migration | 85.005 SOL (the 8.5 SOL presale is ≈ 10 % of it) |
| Market cap at migration | 410.9 SOL |

> **Parameter to revisit with the real curve:** at these values presale participants hold ~23.7 % of supply at launch.

## 4. Titles, levels, badges, leaderboard

### 4.1 Titles

Every user has all four titles and levels each one independently from their activity. A user's **main title** (highest level; ties go to more XP, then the order KOL, Diamond Hands, Shiller, Raider) is shown next to their name in chat and on their presale circle. Titles are display and reputation only — they never gate joining.

| Title | Measures | Later data source | Demo stats |
|---|---|---|---|
| **KOL** | Reach and how their calls perform | X + Mooner launch history | followers, engagement %, call win rate |
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

Demo XP awards (placeholders). On-chain events feed Diamond Hands; X-driven titles are simulated from the profile page because the demo has no X data.

| Event | Award |
|---|---|
| A presale you're in goes live | +80 Diamond Hands XP |
| A token you still hold migrates | +150 Diamond Hands XP |
| "Simulate X activity" (profile, per X-driven title) | +120 XP to KOL, Shiller or Raider |

### 4.3 Badge art

Badges are SVG React components — `<Badge title level size />` — built from three layers, so all 20 come from one system:

| Layer | Encodes | Progression |
|---|---|---|
| Frame | Level | L1 plain disc → L2 riveted hex → L3 shield with banner → L4 winged crest → L5 crowned star with rotating rays |
| Emblem | Title | KOL: megaphone with waves · Diamond Hands: diamond held in cupped hands · Shiller: rocket inside a speech bubble · Raider: crossed swords with a bolt |
| Colour | Rarity | grey → green → blue → purple → gold (gold has an animated shimmer) |

Level is also shown as a roman numeral on the banner, so colour is never the only signal.

### 4.4 Level-up moment

Full-screen overlay: dark backdrop, radial burst, badge spins and scales in, shine sweeps across, particles, "LEVEL UP · Diamond Hands IV · Diamond", XP bar fills to the new value. Dismiss with click or Esc. Fires when an XP award crosses a threshold; the profile page also has "Simulate level-up". With `prefers-reduced-motion`, it fades in with no spin or particles.

### 4.5 Public leaderboard

- Ranks every user by XP: **Overall** (sum across titles) plus one tab per title.
- Row: rank, avatar and handle, badge and level for that tab, XP, presales joined, % migrated, the tab's key stat, and an **Invite** button — disabled, labelled "Project invites coming soon".
- **Presales joined** counts every presale the user was in that launched or expired; **% migrated** is migrated ÷ launched.
- Search by handle; your own row is pinned and highlighted; clicking a row opens the profile.
- Ranks also appear wherever people do: on presale circle cards, the token page's Presale tab, and profiles — so anyone can judge who is behind a project.

### 4.6 Where badges appear

Chat (main title), presale circles (main title), New Pairs and Final Stretch cards (the three highest-level participants' badges), holders and trades tables, token page Presale tab, profile, leaderboard, `/badges` gallery.

## 5. Screens

### 5.1 Shell (every page)

Top bar: **MOONER** wordmark · nav (Pulse, Leaderboard, Launch, Badges) · search (filters rails by name or ticker) · SOL price (mock) · **Find Match** (primary, game-styled) · demo wallet balance (starts at 25 SOL; commits and buys deduct, refunds and sells credit) · profile chip (avatar, main badge, level).

### 5.2 Pulse — `/`

Three rails plus the global chat docked on the right (collapsible).

| Rail | Sort | Card shows |
|---|---|---|
| New Pairs | newest first | token art, name, $TICKER, age, "MagicBlock ER" chip, **mini participant circles** (first 12, then "+N"), pool bar "6.2 / 8.5 SOL", participant count, time left, the three highest-level participants' badges, **Join** |
| Final Stretch | curve progress, highest first | art, name, ticker, time since launch, market cap, curve progress bar, volume, holders, price change, the three highest-level presale participants' badges, **quick buy 0.1 SOL** |
| Migrated | most recently migrated first | art, name, ticker, market cap, liquidity, volume, holders, price change, "migrated 12m ago", **quick buy 0.1 SOL** |

- A token entering a rail animates in at the top with a brief highlight; a `launching` card shows "SETTLING TO SOLANA…".
- Each rail shows at most 30 cards.
- Clicking a New Pairs card opens its presale; any other card opens the token page.
- **Global chat:** avatar, handle, main-title badge, level, time, text. `$TICKER` mentions of existing tokens are links. Composer at the bottom. Bots post continuously.

### 5.3 Presale — `/presale/[id]`

The same screen serves a presale opened from New Pairs and one reached through Find Match. On the presale Find Match put you in, the header reads **LOOKING FOR MATCH · 0:42** (time since you queued) until it launches or expires, or you withdraw.

- **Header:** token art, name, ticker, creator with their main badge, description, Public or Private (with a copyable invite link), time left, "Runs on MagicBlock ER" chip.
- **Participant circles in rows:** one circle per participant — avatar, main-title badge in the corner, level, handle underneath. New joins pop in. Your circle is marked **YOU**. If you haven't joined, a pulsing **+** circle closes the rows. Circle size steps down as the presale grows (64 px up to 20 people, 44 px up to 50, 32 px beyond). Clicking a circle opens a player card: all four titles with levels, leaderboard rank, presales joined, % migrated.
- **Pool bar:** segmented by participant, labelled "6.2 / 8.5 SOL · 2.3 to launch".
- **Your panel:**
  - Not joined: amount slider (range from §3.2, 0.01 steps) and **Join**.
  - Joined: change amount, **Withdraw** (not offered to the creator).
  - The input explains its limit, e.g. "max 0.40 SOL — that's all that's left".
  - **Allocation preview:** "1.00 SOL → ≈ 27.87M $MOON (2.79 % of supply) — same price as everyone, creator included".
- **Launch sequence** (plays for everyone the moment the pool fills): "POOL FULL" → "Settling to Solana" → "Token created · pool is the first buy" → "LIVE" → navigate to `/token/[id]` → level-up overlay if your XP crossed a threshold.
- **Chat:** the token's channel, with a tab to switch to Global.
- A `live` or `migrated` token's presale URL redirects to its token page.

### 5.4 Find Match (dialog)

Opened from the top bar.

1. **Pick your amount:** 0.1–2 SOL (checked against your wallet).
2. **Find Match:** among public presales you aren't in, picks the one that can take your full amount with the least room to spare — the closest to launching — with ties going to the one soonest to expire. If none can take your full amount, a bot opens a new public presale (10 min timer) and you join it. You land on `/presale/[id]` in LOOKING FOR MATCH mode and watch the circles fill; if your amount fills the pool exactly, the launch sequence starts right away.

### 5.5 Token — `/token/[id]`

- **Header:** art, name, ticker, mock contract address (copy), social links (stubs), stage pill (Live on curve / Migrated) with a "Solana" chip, price, market cap, change, curve progress or liquidity.
- **Chart:** lightweight-charts candlestick series, 10-second candles, updates live.
- **Tabs under the chart:**
  - Trades: time, buy/sell, SOL, tokens, trader with badge.
  - Holders: rank, trader with badge, % of supply, "presale" tag.
  - Presale: every participant with main badge, leaderboard rank, SOL committed, tokens allocated, and whether they still hold.
- **Right column:** trade panel (Buy / Sell, presets 0.1 · 0.5 · 1 · 2, amount input, "you receive ≈", confirm), your position (tokens, average entry, PnL), then the token's chat.
- A token in `presale`, `launching` or `expired` redirects to its presale page.

### 5.6 Launch wizard — `/launch`

1. **Token:** name, ticker (2–10 characters, uppercased), description, optional X / Telegram / website. Art is generated from the name (upload is a disabled stub).
2. **Presale:** Public (open to Find Match) or Private (invite link); timer 5 / 10 / 15 min.
3. **Your commit:** amount (0.1–2 SOL), review, **Open presale**. The new token appears at the top of New Pairs and you land on its presale page.

### 5.7 Leaderboard — `/leaderboard`

As specified in §4.5: tabs (Overall, KOL, Diamond Hands, Shiller, Raider), ranked rows, search, your pinned row, disabled Invite buttons.

### 5.8 Profile — `/profile/[handle]`

- **Header:** avatar, handle, mock "Connected to X" chip, main-title badge, overall leaderboard rank, presales joined, % migrated.
- **Four title cards:** big badge, level name, XP bar with numbers, next badge shown locked, that title's stats, rank for that title.
- **Badge cabinet:** 20 badges in a title × level grid; locked ones greyed out.
- **Launch history:** token, SOL committed, outcome (live / migrated / expired), mock PnL.
- **Demo controls** (own profile only): "Simulate X activity" per X-driven title, and "Simulate level-up" (pick a title, play the overlay).

### 5.9 Badges — `/badges`

A title × level grid of all 20 badges at 128 px with level name, rarity and XP needed; each animates on hover. Below it, how each title earns XP.

## 6. Visual language

- **Terminal zones** (rails, token page, trades, holders, chat): compact 12–13 px data, monospaced numerals, hairline borders, colour reserved for up (green) and down (red).
- **Game zones** (Find Match, presale circles, leaderboard, profile, badges, level-up): display typeface, rarity glows, XP bars, bold motion.
- **Type:** Geist Sans (UI), Geist Mono (numbers), Chakra Petch (HUD headings) via `next/font/google`. Font availability is checked when scaffolding.
- **Colour:** tokens defined once in `globals.css`. Dark base (`--bg-0` #07080C, `--bg-1` #0D1017, `--bg-2` #141925, `--line` #1F2633), text (`--text-0` #E8ECF4, `--text-1` #9AA4B8, `--text-2` #5F6B80), trade up/down, five rarity colours, and one brand accent for primary actions that doesn't collide with those (starting value: hot magenta #FF4FB8). All values are starting points for the implementation design pass.
- **Infrastructure chips:** small neutral chips — "MagicBlock ER" on presales, "Solana" on launched tokens — so the settle step is visible without explaining it.
- **Generated art:** avatars and token art are deterministic SVGs from a hash of the handle or name — no image files, no external requests.
- **Motion:** circles pop in on join, the **+** circle pulses, rail entries highlight, the launch sequence, level-up burst. Everything respects `prefers-reduced-motion`.
- **Responsive:** built for ≥1280 px. At ≤1024 px the chat dock collapses behind a toggle. At ≤768 px the rails become tabs, circle rows wrap, and the token page stacks chart → trade → chat.
- **Accessibility:** visible focus states, labelled controls, and state never shown by colour alone (rarity = colour + frame + numeral; your circle = label, not just a ring).

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
    presale/[id]/page.tsx      Presale
    token/[id]/page.tsx        Token
    launch/page.tsx            Launch wizard
    leaderboard/page.tsx       Leaderboard
    profile/[handle]/page.tsx  Profile
    badges/page.tsx            Badge gallery
  components/
    shell/        TopBar, WalletChip, ProfileChip, FindMatchDialog, Toasts
    rails/        Rail, PresaleCard, LiveCard, MigratedCard
    chat/         ChatPanel, ChatMessage, ChatComposer
    presale/      ParticipantRows, ParticipantCircle, PlayerCard, PoolBar, CommitPanel, LaunchSequence
    token/        PriceChart, TradePanel, PositionCard, TradesTable, HoldersTable, PresaleTable
    badges/       Badge, BadgeFrame, TitleEmblem, LevelUpOverlay, XpBar
    leaderboard/  LeaderboardTable, LeaderboardTabs
    profile/      TitleCard, BadgeCabinet, LaunchHistory, DemoControls
    ui/           Button, Tabs, Dialog, Avatar, TokenArt, Stat, Pill, Chip, Skeleton
  lib/
    types.ts       domain model (7.3)
    constants.ts   every number in §3 and §4.2
    curve.ts       buy, sell, spot price, market cap, presaleAllocation
    presale.ts     commitRange, join / change / withdraw, isFull, expiry, pickMatch (Find Match)
    levels.ts      levelForXp, xpToNext, level names, mainTitle, awards
    leaderboard.ts rankings overall and per title
    format.ts      SOL, USD, compact numbers, percentages, ages
    rng.ts         seeded PRNG
    sim/
      personas.ts  bot handles, chat phrase bank per title
      seed.ts      initial world
      step.ts      step(world, rng, dtMs) → world (pure)
    store.ts       zustand store: world, user actions, simulator loop
```

`curve.ts`, `presale.ts`, `levels.ts` and `leaderboard.ts` are pure and hold every rule; components only call them. When the backend arrives, they become the client-side mirror of the on-chain program and the ranking service, and `store.ts` swaps the simulator for real data sources.

### 7.3 Domain model

```ts
type Title = 'kol' | 'diamond' | 'shiller' | 'raider';
type Stage = 'presale' | 'launching' | 'live' | 'migrated' | 'expired';
type Lamports = number; // integer

interface TitleProgress { xp: number; level: 1 | 2 | 3 | 4 | 5 }

interface User {
  id: string; handle: string; isBot: boolean;
  titles: Record<Title, TitleProgress>;
  stats: TitleStats;                     // per-title demo stats from §4.1
  history: LaunchRecord[];               // bots: seeded; demo user: appended by the store
}

interface LaunchRecord {                 // self-contained, so it survives token pruning
  tokenId: string; name: string; ticker: string;
  commit: Lamports; outcome: 'live' | 'migrated' | 'expired'; pnlSol: number; at: number;
}

interface Participant { userId: string; commit: Lamports; joinedAt: number }

interface Presale {
  visibility: 'public' | 'private'; inviteCode?: string;
  participants: Participant[];           // join order
  expiresAt: number;
  launchStartedAt?: number;              // set when the pool reaches 8.5 SOL
}

interface Pool { solReserve: number; tokenReserve: number; tokensSold: number } // curve: virtual reserves; AMM: real reserves

interface Token {
  id: string; name: string; ticker: string; description: string; creatorId: string;
  stage: Stage; createdAt: number; launchedAt?: number; migratedAt?: number;
  presale: Presale;
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
  match?: { tokenId: string; queuedAt: number }; // set by Find Match, drives "LOOKING FOR MATCH · m:ss"
}
```

Leaderboard ranks are derived from `users` on demand, never stored.

### 7.4 Simulator

- `step(world, rng, dtMs)` is pure: same inputs, same output. The store calls it once per second.
- Each tick:
  - keeps 6–10 presales in New Pairs by spawning bot-created ones
  - bots join public and private presales with amounts inside the allowed range, sometimes change or withdraw (creators only change)
  - moves full presales through `launching` (4 s) to `live`, running the presale first buy and allocations
  - expires unfilled presales and refunds them
  - trades live and migrated tokens: buy/sell size and direction come from the token's `heat`, rolled at launch and decaying, so some tokens run to migration within minutes and others stall
  - updates candles, volume and holders; migrates tokens whose curve sold out
  - applies XP awards from §4.2 for on-chain events
  - posts bot chat to global and token channels, weighted by token activity
- All lists are capped so memory stays bounded over a long demo. Tokens are pruned too: expired tokens after 5 minutes, and beyond 40 tokens in `live` or in `migrated`, the one with the oldest last trade goes first. Tokens the demo user holds or has committed to are never pruned.
- **Seed:** 60 bot users with a spread of levels and stats; 8 presales at different fill levels (one within 0.5 SOL of launching); 10 live tokens at different curve progress; 8 migrated tokens; pre-generated candle history; 40 global chat messages.
- **Demo user:** handle `you`, 25 SOL. Starting XP: KOL 40 (L1), Diamond Hands 760 (L3), Shiller 120 (L2), Raider 250 (L2). The first presale you're in that goes live (+80 Diamond Hands) crosses 800 and shows the level-up overlay.
- **Determinism:** fixed seed, so every load starts from the same state. The world is created in the browser only (inside `WorldProvider`), so server and client markup never disagree; pages render skeletons until it exists. Route params are read with `useParams()`.

### 7.5 Store actions

`findMatch(amount)`, `joinPresale(tokenId, amount, inviteCode?)`, `changeCommit(tokenId, amount)`, `withdraw(tokenId)`, `sendChat(channel, text)`, `buy(tokenId, sol)`, `sell(tokenId, tokens)`, `createLaunch(form)`, `simulateXActivity(title)`, `simulateLevelUp(title)`.

Every action validates through `presale.ts` / `curve.ts` / `levels.ts` and either applies or returns an error message the UI shows inline or as a toast. Wallet balance is checked before any commit or buy.

## 8. Edge cases

| Case | Behaviour |
|---|---|
| Amount above your max | Clamped; the limit and reason are shown |
| Less than 0.1 SOL left in the pool | The next commit is exactly the remainder |
| Amount above wallet balance | Blocked with "not enough SOL" |
| Your commit completes the pool | Launch sequence starts immediately |
| Private presale without the invite code | Join disabled, "invite only" |
| Withdraw during `launching` | Disabled |
| Presale expires | Everyone refunded, toast for you, card flashes "EXPIRED" then goes |
| Buy larger than what's left on the curve | Capped; only the needed SOL is charged |
| Sell more than you hold | Capped to your position |
| Unknown token or profile id | "Not found" state with a link back to Pulse |
| Find Match with no public presale that can take your full amount | A bot opens a new public presale (10 min timer) and you join it |
| Creator tries to withdraw | Not offered; they can lower their commit to 0.1 SOL |

## 9. Testing and verification

**Vitest (pure logic):**
- `curve.test.ts` — price strictly increases with buys and decreases with sells; 8.5 SOL from the initial state yields 236,896,104 ± 1 tokens; migration happens at 85.005 ± 0.001 SOL raised; buy-then-sell never returns more SOL than went in; pro-rata allocations sum to `T` (within 1 token) and give every participant the same price.
- `presale.test.ts` — the commit range follows §3.2, including the under-0.1 remainder; no position drops below 0.1 SOL except the one that fills the pool; the pool never exceeds 8.5 SOL; the presale launches exactly when the pool reaches 8.5 SOL and not before; change and withdraw refund correctly; the creator can't withdraw; expiry refunds everyone; a private presale rejects joins without the invite code; `pickMatch` follows §5.4.
- `levels.test.ts` — thresholds map to the right levels and names; main title picks the highest level, then XP; awards cross thresholds correctly.
- `leaderboard.test.ts` — overall and per-title rankings order by XP with a stable tie-break on handle.
- `step.test.ts` — over 2,000 ticks from a fixed seed: no pool above 8.5 SOL, no negative reserves, stages only move forward, every launched token had a full pool, every migrated token sold out its curve, list sizes stay within their caps, and the same seed gives the same world.

**Build:** `pnpm build` passes (type check included).

**In the browser pane:** walk every screen at desktop and mobile widths and capture screenshots — Pulse with cards moving between rails, Find Match → circles filling → your commit completing a pool → settle sequence → token page → level-up overlay, a trade, a presale created through the wizard, the leaderboard, a profile, the badge gallery, and an expired presale.

## 10. Out of scope (future specs)

- Wallet connection and the on-chain program (presale escrow, curve, migration)
- MagicBlock Ephemeral Rollup integration (delegating presale accounts, committing back to Solana at launch)
- Realtime chat backend and moderation
- X data ingestion and title scoring
- Auth and real profiles
- Project invites from the leaderboard (stubbed button in the demo)
- Seasons, notifications, real token image upload
