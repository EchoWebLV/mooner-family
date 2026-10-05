# Mooner UI: Terminal + cozy art, design

- **Date:** 2026-10-05 · **Branch:** `feat/mooner-wireframe` · **Status:** approved ("go", 2026-10-05). Plans: `docs/superpowers/plans/2026-10-05-mooner-ui-shared-phone.md` (shared code and the phone), `docs/superpowers/plans/2026-10-05-mooner-ui-web.md` (the website)
- **Scope:** one look for the phone app (`mobile/`) and the website (`web/`):
  - Terminal UI with the cozy scenes and the Mooner host;
  - Pulse with three lanes, which also replaces the phone's Live and Launched tabs;
  - the presale room with its chat and 12 custom emojis;
  - the launch moments (pool full, 3-2-1, launching, live), driven by real presale state;
  - the coin page and the Jupiter buy;
  - sounds and motion.
- **Out of scope:**
  - XP and titles. The engine has none yet; they arrive with the XP plan (`docs/superpowers/plans/2026-10-01-mooner-seeker-xp-genesis.md`). This spec only says where they show once they exist.
  - The landing page (`site/`), global chat on the phone, and new server endpoints.

## Goal

The demo the user approved (`docs/superpowers/2026-10-05-mooner-launch-terminal-cozy.mp4`) running on real data, in both apps:
- Same look, same sounds, same moments on the phone and the website.
- Every moment is driven by what the chain and the server say. The UI never fakes a step or a time.
- Calm: pictures move, the interface stays still, Pulse is quiet.

## Decisions (the user's, 2026-10-05)

| Topic | Decision |
|---|---|
| Look | **Terminal UI + cozy art** (after trying Cozy and a Cozy/Terminal Mix: "go with terminal fine") |
| Art | cozy low-poly dusk scenes for the room, launching and live; the talking Mooner host |
| Sounds | all 16 event sounds from the demo ("do the video only with the amount of sounds we got now") |
| Pulse sound | silent, except the click of switching lanes and opening a coin; menu switches and new screens click everywhere |
| Motion | "no need the UI to be over animated.. just the things related to the images"; then "bring those back" for the room's and the launch's elements rising in and the host typing, "just don't bring the one on the pulse" |
| Build order | approach A: restyle the screens that exist in both apps and add what's missing; phone first, then web (recommended, not overruled) |

## Facts this rests on (read 2026-10-05)

**The colours already match.**
- The mockup's Terminal tokens are the apps' own tokens: `web/src/globals.css:8-57` and `mobile/src/ui/theme.js:2-11`. Both use `#07080b` background, `#5468ff` accent, `#2ee6a0` up, `#ff4d6d` down, `#ffb23e` gold, `#3bd4ff` for presale pools, `#9d8cff` migrated, and Geist with Geist Mono.
- So this work is new screens, art, sound and motion, not a recolour.

**The phone app** (`mobile/`, Expo 55, RN 0.83):
- Tabs (`mobile/app/(tabs)/_layout.js`): Live (`index.js`), Launched (`launched.js`), Create, Me.
- The room is `mobile/app/presale/[key].js`. Its logic is in `mobile/src/room/room.js`:
  - `heroOf` gives the ring and the line under it;
  - `claimedOf` says whether your tokens arrived;
  - `momentStep` is the launch moment: null, launching, live, failed, done.
- `mobile/src/room/LaunchOverlay.js` is a modal with one ring and haptics.
- Chat is `mobile/src/room/ChatSheet.js`. The phone never subscribes `chat:global`.
- Coin page: `mobile/app/coin/[key].js`. Trade sheet: `mobile/src/launched/TradeSheet.js`. It already shows "At least", price impact and fee.
- Curve progress is `curveOf(pool)` in `mobile/src/launched/coin.js:35`.
- No animation library (core `Animated` only, in `Ring.js`), no audio package, no lint or typecheck.
- Tests are `node:test` over pure modules: `mobile/test/*.test.mjs`, run with `npm test`.

**The website** (`web/`, Vite + React 19 + zustand):
- Pulse is `web/src/components/rails/PulseScreen.tsx`. It has three lanes (New Pairs, Final Stretch, Migrated) from `web/src/lib/selectors.ts` and a 340 px global chat column.
- The room is `web/src/components/presale/PresaleScreen.tsx` (PoolBar, Lobby, CommitPanel, ChatDock).
- **The launch steps are timed, not real.** `LaunchSequence.tsx` takes its step from `launchPhase(elapsed)` in `web/src/lib/presale.ts:95-99`: step 0 under 3 s, step 1 under 8 s, then step 2.
- The coin page is `web/src/components/token/TokenScreen.tsx`.
  - `TradePanel.tsx` shows only "You receive ≈".
  - The quote already carries the minimum out, price impact and pool fee (`engine/src/swap.js:52-53, 179-196`).
- XP is always level 1 / 0 XP (`NO_TITLES`, `web/src/lib/store.ts:216`).
- No sound. CSS keyframes only.
- Tests: `web/tests/*.test.mjs` with the `resolve-ts.mjs` loader.

**The server** (`engine/server/`):
- One websocket at `/api/ws`, with these topics:
  - `presales`, `presale:<key>` (state OPEN, FULL, LAUNCHING, SETTLED, EXPIRED, FAILED, or CLOSED made up when the account is gone);
  - `launched` (a row with `launch {sig, tokens, at…}` and `pool {quoteReserve, sqrtPrice, migrated, damm}`);
  - `coin:<mint>`, `chat:<channel>`, `sol`, `wallet:<addr>`.
- `stageOf` (`engine/src/views.js:17-32`) maps these to presale, launching, live, migrated, expired.
- **A full presale launches in one transaction.** It creates the Meteora DBC pool and makes the pot's one buy, which pays DBC's 1% floor fee (`programs/presale/src/launch.rs:5, 120`). Then the keeper claims each seat. A claim closes the seat (`room.js` `claimedOf`, `finish.rs`).
- **Chat:**
  - 280 characters, counted in code points (`engine/server/social.js:157`);
  - rate limits of 5 per 10 s per wallet and 30 per 60 s per IP;
  - no emoji handling anywhere;
  - the apps count UTF-16 units in `maxLength`.

**Mockup assets** (in `.superpowers/brainstorm/49580-1791193657/content/`, gitignored):
- Scenes: `cz-{lobby,loading,victory}-{tall,wide}.jpg`, 652 KB together.
- Host: `cz-host.png`, 45 KB.
- 12 emojis: `emo-*.png`, 324 KB.
- 16 sounds: `sfx-*.mp3`, 312 KB.
- The art was made with Codex image generation. The sounds were made with ElevenLabs Sound Effects (`eleven_text_to_sound_v2`) and peak-normalised.

## The look

- **Tokens:** unchanged. Both apps keep their token files. Nothing new is added unless a screen below needs it:
  - the phone gets `C.migratedSoft`, `C.erSoft` and `C.goldSoft`, the same alphas as the web.
- **Flat:**
  - no drop shadows, glows, bevels or fake 3D;
  - the mockup's `.card.glow` on the live screen is dropped;
  - text over a scene gets a dark veil, not a text shadow: `bg-0` at 60% at the top (under the top row) fading out a fifth of the way down, clear through the middle, and `bg-0` at the bottom.
- **Art:**
  - the room, launching and live screens each have one scene: tall on the phone, wide on the web, cropped with `object-fit: cover`;
  - the host (`host.png`) speaks in a bubble on those three screens. Its lines stay in the bubble; they aren't added to the chat.
- **Pictures:** 3D Mooner PFPs come from the apps' own renderers:
  - phone: `mobile/src/pfp/PfpRenderer.js`;
  - web: `web/src/lib/pfp/`.
  - The mockup's `m3-*.jpg` files are not copied.
- **Words:** no game words. The mockup's copy changes like this:

  | Mockup | Apps |
  |---|---|
  | "Lobby · Sword Cat" | "Presale · Sword Cat" |
  | "Lobby complete" | dropped |
  | "First 1% bought" (reads as 1% of supply) | "One buy, one price for everyone" |
  | "Invite · KOL XP" | "Invite" until XP exists |

- **Numbers:** pool size, seat range and time come from the server (`/api/info` on the phone, `web/src/lib/constants.ts` on the web), never from the mockup's 10 SOL.

## Screens

### 1. Pulse

**Phone:**
- The tabs become **Pulse · Create · Me**. Pulse replaces Live and Launched; `launched.js` is removed.
- Pulse has three lanes you swipe between, with a tab strip on top. Each tab shows its lane's count:
  - **New Pairs:** presales filling. State OPEN, plus FULL and LAUNCHING (shown "Launching"). A presale that `stageOf` already calls live but has no `launched` row yet also shows "Launching" (`pairStage`), so it doesn't vanish between the launch and the feed. Expired presales stay 3 s, as on the web; past its deadline an OPEN card says "Time's up". Newest first.
  - **Final Stretch:** live coins on the curve, sorted by `curveOf(pool)`, closest to migrating first.
  - **Migrated:** coins with `pool.migrated`, newest launch first (`launch.at`): `launched` rows carry no migration time.
- Cards follow the mockup:
  - presale cards: coin image, ticker, pool cells, SOL in / pool, wallets, time left, Faces, and "You're in · X SOL" or Join;
  - market cards: market cap and curve bar. No change figure: the `launched` feed has no price history, and a socket watches at most 4 coins.
- Tapping a card opens the room or the coin page.
- The header keeps the wallet's SOL and adds the web's "X SOL filling N pools" line.
- The lane logic is a pure module, `mobile/src/live/lanes.js`, tested like `room.js`. It reuses `stageOf` and `curveOf`. `liveList` and `launchedList` in `store.js` are replaced by it.

**Web:** `PulseScreen.tsx` already has the three lanes and global chat. It gets the card look and the motion rules below, and nothing else.

### 2. The room (presale)

Top to bottom on the phone:
1. The scene (`room`) with the coin image, ticker, "Presale · Name" and time left over a veil.
2. The last 3 chat lines over the scene's bottom edge.
3. **Pool:** SOL in / pool, 10 cells (each a tenth of the pool, filled by SOL in), "N wallets in · X SOL to go".
4. **Who's in:** a grid of PFPs with each wallet's SOL, then "+N" (not tappable). Once XP exists, the frame is the best title's rarity and the corner is that badge.
5. **Your seat,** in gold: your PFP and "Your seat · X SOL". No ≈ tokens: the engine has no shared curve estimate (the web's `allocationFor` uses web-only constants); the real amount shows on the live screen. The demo's "3 joined via your link" is left out: no feed reports it today.
6. The host's line, Invite (with a seat; without one, Share is a round button over the scene), the chat button, and "Get my X SOL back".

The ring on the phone's room is replaced by the pool cells. The join sheet and seat logic stay (`JoinSheet.js`, `YourSeat.js`, `seatPlan`, `bottomOf`).

**Web:** the same parts. The wide scene sits on top, the crowd and pool share one panel, and your seat and the invite sit on the right with the chat (`PresaleScreen`, `Lobby`, `PoolBar`, `CommitPanel`).

### 3. Chat and emojis

- **12 Mooner emojis:** diamond, fire, gg, gm, jeet, lfg, moon, ngmi, pump, rug, ser, wen. You type them as `:name:`.
- The text stays plain on the wire: no server change, and old clients show `:lfg:`.
- Each app turns the known `:name:` tokens into images inline. Unknown names stay as text.
- On the web, the existing `$TICKER` links still work alongside emojis. A ticker is 1–10 letters or digits, as the server's `api.js` accepts.
- An emoji row sits above the input. Tapping an emoji adds `:name:` at the end of the message, not at the cursor. At 280 code points more typing is refused (the end of the message is never cut off); only a paste that would go past the limit is cut.
- A message that is only emojis shows them larger.
- **Floating emojis:** when a room chat line with emojis arrives while you're on the room, launching or live screen, up to 4 of its emojis float up over the scene. All lines share one queue: floats start `FLOAT_GAP_MS` apart, at most 10 in flight and 10 waiting (the oldest waiting is dropped). What waits is dropped when a sheet or the launch moment covers the scene, and a channel change (or the first read of one) replays nothing.
- **The host's lines** are the moments' own lines (see 4). They're local to the app and never sent to the server.
- **Length:** both apps count code points, as the server does, so emojis no longer count double.

### 4. Pool full → 3-2-1 → launching → live

These screens follow real state, built on the phone's `momentStep` and on one shared step function (see "Shared code"). The countdown never holds back a real step.

1. **Pool full.** The state becomes FULL, or LAUNCHING is seen while it was OPEN.
   - Screen: the room's scene dimmed, a "POOL FULL" stamp, the coin image, "pool / pool SOL · N wallets", and the crowd with a tick on each PFP.
   - Then a 3-2-1 (haptic per count on the phone), "Launching on Meteora", and the host: "Nothing to do. I'll bring your tokens to you."
2. **Launching.** It slides up after the countdown.
   - Screen: the `loading` scene, the coin chip, the chat, and four steps:

   | Step | Done when |
   |---|---|
   | Pool full | always, on this screen |
   | Meteora pool created | the `launched` row for this presale arrives |
   | One buy, one price for everyone | the same row (the same transaction); it ticks right after the pool step |
   | Sending everyone their tokens · N to go | no committed seat is left. N is the committed seats still in the room; a claim closes a seat |

   - Host: "Keep holding your presale tokens and you level up Diamond Hands." This line shows only once XP exists. Until then: "Your tokens come to you. Nothing to sign."
3. **Live.** When your claim lands (`claimedOf`), or the step list completes.
   - Screen: the `live` scene, a "LIVE ON METEORA" pill, the ticker, and "Your tokens arrived · for X SOL" with your token amount from the chain. The amount is set straight away, not counted up.
   - The crowd that launched it.
   - **Trade** opens the coin page. It stays locked until `tradeOpensAt`, with the existing countdown.
   - **Share the win** uses the existing share.
   - XP lines per title appear here once XP exists.
4. **Failed or expired:** the existing "The launch didn't go through." and refund copy, on the room's scene, with no stamp and no sound.

**Opening the room late:**
- Opened while FULL or LAUNCHING: it opens on the launching screen with the done steps already ticked, with no POOL FULL and no countdown. This is the one new case in `momentStep`, which today starts nothing on first sight. On the phone, `momentScreen` (`room.js`) picks the screen from the phase, whether the moment started late, whether the 3-2-1 has finished, whether every step is done, and whether your tokens arrived.
- Opened after live: the room in its live state, as today (the "Your tokens arrived · See $TICKER" bottom). Nothing replays. The keeper's token delivery happens while the stage is already live, so a room reopened during it opens live, not on the launching screen.
- A moment screen shown again (the room refocused, or the phone unlocked) shows as it was: no whoosh, stamp, liftoff or coins, no steps re-ticking, the host quiet.
- **Away from the app:** the moment only shows while the room is focused and the app is in front. Locked or in another app, it hides, and its 3-2-1 starts over on return, so no sound plays from a pocket and no overdue countdown fires in a burst.

**Web:**
- `LaunchSequence` keeps its overlay but takes its steps from the shared function. `launchPhase` and its timers are deleted.
- The redirect to the token page after `LIVE_FLASH_MS` becomes the live screen's Trade button.

### 5. Coin page and buy

**Phone:** the layout of `coin/[key].js` stays. It gets the card look and the new motion.
- The trade sheet already shows You get, At least, Price impact and Fee.
- After a confirmed buy, it shows "Bought" and plays `coins`.

**Web:**
- `TradePanel` adds the lines it lacks from the quote it already has: At least (`otherAmountThreshold`), Price impact (`priceImpactPct`, in the down colour at 5% or more, as on the phone), and Fee (`POOL_FEE_BPS`, 1%).
- The venue line stays.
- The chart, trades, position card and the coin's chat are unchanged apart from the look.

## Sound

**One table of cues, shared by both apps.** Each cue has a name, a file and a volume.

**Volumes:**

| Cue | Volume |
|---|---|
| tap | .5 |
| join | .55 |
| tick | .3 |
| poolfull | .7 |
| count | .6 |
| go | .7 |
| liftoff | .75 |
| step | .5 |
| coins | .6 |
| xp | .55 |
| host | .45 |
| whoosh | .45 |
| stamp | .75 |
| chat | .4 |
| emoji | .5 |
| sheet | .45 |

**When each cue plays:**

| Cue | When |
|---|---|
| tap | a tab, menu or lane switch; opening a coin or a room; a new screen |
| sheet | a sheet opens (lower and faster when it closes) |
| whoosh | entering the room, the launching screen, or the coin page from live |
| join | a wallet takes a seat in the room you're on |
| chat | a room chat line arrives, at most one every 400 ms |
| emoji | you pick an emoji; floating emojis, up to 4, staggered |
| host | the host starts a line |
| stamp + poolfull | POOL FULL |
| count, go | 3, 2, 1, then go |
| step | a launch step ticks done |
| tick | "N to go" goes down; a quote value arrives in the trade sheet |
| liftoff, stamp | the live screen and its title |
| coins | your tokens arrived; your buy confirmed |
| xp | the XP lines, once XP exists |

**Rules:**
- **Pulse is quiet.** On Pulse only `tap` plays. That covers its global chat on the web.
- **Only where you are:** a screen's own sounds (host, join, chat, the moment's cues, a quote's tick) play only after the first touch, with the app in front and the screen focused. `join` plays only while the presale takes seats, so the seat that fills the pool doesn't stack on POOL FULL. `chat` stays quiet under POOL FULL and failed, which don't show the chat. The emoji cue plays at most every 400 ms.
- **Screen sounds on the phone** come from the route: `whoosh` into a room (`/presale/…`), `tap` into any other screen, and live's Trade whooshes into the coin page. Nothing plays before the first touch, so opening the app or a link is quiet.
- **Other people's trades** on the coin page are silent. The demo played one; a busy coin would chatter. This is a new call, made here.
- **Volume:** sounds follow the media volume. The ringer's silent mode doesn't mute them on Android; the Sounds switch does. The app never takes audio focus from other apps and never records.
- **Mute:** a "Sounds" switch, on by default. On the phone it's in Me; on the web it's in the wallet menu. It's kept on the device (`expo-secure-store` is already used; on the web, `localStorage`).

**How each app plays sound:**
- **Phone:**
  - `expo-audio`, the SDK 55 version via `npx expo install`, which needs a new dev build;
  - players are loaded once at start, and `mobile/src/ui/sound.js` exposes `play(cue)`;
  - haptics stay where they are.
- **Web:**
  - Web Audio in `web/src/lib/sound.ts`;
  - buffers are decoded on the first tap, because browsers block audio before a gesture;
  - same `play(cue)` API.

## Motion

**Pictures always move.**
- **Scenes:**
  - the launching scene zooms out slowly, once (scale 1.14 to 1.02 over 9 s, ease-out);
  - the live scene lifts into place (90 px up, scale 1.12 to 1, 1.5 s);
  - the room's scene stays still, as in the demo.
- **PFPs** pop in when a wallet joins.
- **Emojis** float.
- **The coin image** pops in on POOL FULL and on live.

**Outside Pulse, interface parts come in once as they appear:**
- the launch steps, live's title and cards, chat lines, the trade sheet's quote values and toasts rise or pop;
- the launching screen slides up;
- the host's bubble pops and types at 18 ms per character.

**On Pulse, the interface only fades.** That covers new cards and lane counts, and on the web a card leaving its lane. On the phone a card leaving its lane just goes: core `Animated` can't animate an unmount without a library.

**Never:**
- bumps;
- button press scale (the phone's `Button` drops its 0.98 scale and keeps the opacity change);
- shake or flash;
- coin bursts;
- numbers counting up, for tokens, XP or market cap.

`prefers-reduced-motion` on the web, and Reduce Motion on Android (`AccessibilityInfo.isReduceMotionEnabled`), turn every move into a fade and keep the scenes still.

**How each app animates:**
- **Phone:** core `Animated` with the native driver (opacity and transform only). A small `mobile/src/ui/motion.js` holds `rise`, `pop`, `fade`, `slideUp` and `kenBurns`. No new animation library.
- **Web:** CSS keyframes in `globals.css`: `rise-in` and `fade-in` exist; add `pop-in`, `slide-up` and `ken-burns`.
  - `cards.module.css` `.fresh` becomes a fade.
  - Toasts keep their entry.

## Shared code (`engine/src/`, imported by both apps as `views.js` already is)

| File | What it holds | Tested by |
|---|---|---|
| `emoji.js` | `EMOJI` (the 12 names); `chatParts(text)` gives text, emoji and `$TICKER` parts (it replaces the web's `chatParts` in `web/src/lib/selectors.ts`); `codePoints(text)` for the 280 limit | `engine/test/emoji.test.js` |
| `cues.js` | the cue table above (name → volume) and `QUIET_ON_PULSE = ['tap']` | `engine/test/cues.test.js` (every cue has a file in both apps' asset lists) |
| `launchsteps.js` | `launchSteps(view, launchedRow)` gives the four steps as done, now or todo, plus `toGo` | `engine/test/launchsteps.test.js` (FULL with no row; row with seats left; all claimed; CLOSED with launch; FAILED) |

## Assets

They are copied from the mockup folder and committed. The mockup folder stays gitignored.

| What | Phone | Web |
|---|---|---|
| Scenes (tall on the phone, wide on the web) | `mobile/assets/scenes/{room,launching,live}.jpg` | `web/public/scenes/{room,launching,live}.jpg` |
| Host | `mobile/assets/host.png` | `web/public/host.png` |
| Emojis | `mobile/assets/emoji/<name>.png` | `web/public/emoji/<name>.png` |
| Sounds | `mobile/assets/sfx/<cue>.mp3` | `web/public/sfx/<cue>.mp3` |

That adds about 1 MB to each app. The logo stays `assets/mooner.svg`, never redrawn.

## Build order (approach A, phone first)

1. Shared code and its tests: `emoji.js`, `cues.js`, `launchsteps.js`.
2. **Phone:**
   - assets;
   - `sound.js` and `motion.js`;
   - Pulse tabs and lanes;
   - the room;
   - chat and emojis;
   - the launch moments on `LaunchOverlay`'s place;
   - the coin page and trade sheet look;
   - the Sounds switch in Me.
   - Each step is proven on the Seeker.
3. **Web:**
   - assets;
   - `sound.ts` and the keyframes;
   - Pulse motion;
   - the room;
   - chat and emojis;
   - `LaunchSequence` on real steps;
   - `TradePanel` lines;
   - the Sounds switch.
4. The XP slots fill in when the XP plan lands. That is a separate plan.

## Errors and edge cases

- **Socket drops mid-launch.** The moment waits. When the snapshot comes back, the steps jump to what it says (opening late, above). The phone's existing "Reconnecting…" banner shows.
- **A missing sound or picture never blocks a screen.** It's skipped. Scenes fall back to `bg-0`.
- **Audio won't start on the web before the first tap.** Cues before it are dropped, not queued.
- **The launch fails after POOL FULL** (state goes to FAILED or EXPIRED). The countdown stops, the failed copy shows, and the refund line follows. `momentStep` already returns "failed".
- **You're not in the presale.** You see the same moments, without "Your tokens" and without your seat.

## Testing

- **Pure logic, under `node:test`:**
  - engine `npm test`: `emoji`, `cues`, `launchsteps`;
  - phone `npm test`: `lanes.js`, plus `room.js` cases for opening late.
  - Each boundary gets a test: exactly 280 code points; an unknown `:name:`; a seat claimed while the socket was down.
- **Web:** the three engine modules are covered by the engine tests. Web screens are checked in the browser preview against a local server: Pulse quiet, room cues, the launch steps on a devnet presale.
- **Phone:**
  - `npm run bundle:check`, then a release build on the Seeker (the JS is bundled in; no Metro);
  - the phone runs on mainnet only, so a mainnet presale (the 0.5 SOL testing pool), filled by the user, is run through pool full to live, screen-recorded with sound;
  - the result is compared with the approved demo video.
- **No new lint or typecheck.** The web's `tsc -p tsconfig.check.json` must not go above its baseline of 55 errors.
