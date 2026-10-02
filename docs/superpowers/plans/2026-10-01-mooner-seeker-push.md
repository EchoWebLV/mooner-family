# Mooner on Seeker, piece 5: push alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** The phone gets push alerts:
- your presale filled, it launched, your tokens arrived;
- someone joined the presale you opened;
- someone you follow joined or opened a presale;
- a coin passed a big market cap;
- Auto-join found room.

An Alerts tab lists them, newest first, with a switch per kind in three groups. A tap opens the presale or the coin. Mooners' cards get a Follow button (phone and web), Me shows who you follow and who follows you, and Live gets Auto-join.

**Architecture:**
- **Delivery: Expo's push service, which hands each alert to Firebase Cloud Messaging (FCM).** Not FCM directly. Why:
  - the spec names it (Push, "The service");
  - our server makes one plain JSON POST, with no Google OAuth or JWT signing;
  - the FCM service-account key stays at Expo, never on Railway or in this repo;
  - Expo's receipts say `DeviceNotRegistered` for a phone that's gone, so the server drops it.

  The costs:
  - one more hop;
  - Expo sees each alert's title and body (public chain facts: tickers, short wallets, amounts);
  - it needs an Expo account and project (USER STEP A);
  - a send gets tickets first and receipts later;
  - Expo takes at most 600 notifications a second per project.

  The server sends with an Expo access token only once the user turns on Expo's "enhanced security" (optional, USER STEP D).
- **Shared rules, pure, in `engine/src/`.**
  - `alertkinds.js` holds the kinds, the switches and their words. The server and the Alerts screen both use it.
  - `autojoin.js` holds Auto-join's amounts and its pick (the fullest presale with room, not too close to its end), and reads a `?join=` link.
- **The server.**
  - `engine/server/alertrules.js` is pure. It says what changed in a presale (opened, joined, filled, launched, tokens arrived), what an alert says, and which market-cap lines a coin passed.
  - `engine/server/alerts.js` (`Notifier`) listens to the live feed. It picks who gets each alert and sends each one once. It keeps the last 100 a wallet in SQLite (the Alerts list), and serves the phone's routes.
  - `engine/server/push.js` (`ExpoPush`) sends to Expo in batches of 100 and tries 429 and 5xx again. It reads receipts later and drops dead tokens.
  - `engine/server/follows.js` keeps who follows whom and serves `POST /api/follow` and `/api/unfollow`.
  - `social.js` hands out its sign-in code (`makeSessions`), so follows and alerts check the same Mooner sign-in as chat.
- **The feed (`engine/server/feed.js`).**
  - It tells its own listeners each presale it reads (`"presale"`), even with no socket on it, while the notifier listens. It also tells them each launched row it pushes (`"pool"`).
  - It serves a new socket topic, `follows:<wallet>`.
  - A follow alert comes only from a presale as read from the chain, so only a confirmed join or open sends one.
- **The phone.**
  - `mobile/src/alerts/store.js` is a zustand store, tested under Node with fakes. It holds the sign-up, the switches, the list, Auto-join's wait, and the follows from the socket.
  - `src/alerts/push.js` wraps `expo-notifications`: the permission, the token, the Android channel, and what a tap opens.
  - New parts: the Alerts tab, `FollowButton` on a Mooner's card in the room, Following and Followers on Me, the Auto-join card on Live, and the room's `?join=<lamports>` link, which opens the join sheet on that amount.
  - **Every join still needs the wallet's approval:** Auto-join only picks.
- **The web.** `web/src/lib/store.ts` gains `following` (from `follows:<wallet>`) and `follow()`. `PlayerCard.tsx` gets a Follow button.
- **One change from the spec.**
  - The spec says follower and following lists "ride the `profiles` topic". They ride `follows:<wallet>` instead, one topic per wallet.
  - `profiles` is every wallet's picture, sent whole to every socket on it. Putting every wallet's lists there would send everyone's follows to every screen that shows a picture.
  - A wallet's topic sends only the lists a screen shows, and the lists stay public.
  - The Final review notes this in the spec, as piece 3 did for its own change.

**Tech Stack:**
- Expo ~55, React Native 0.83, expo-router (Tabs), zustand 5;
- `expo-notifications` ~55.0.27 (the version `mobile/node_modules/expo/bundledNativeModules.json` lists; a new native module, so `prebuild --clean` and a new APK) and expo-constants (already in);
- Node 22 `node --test`, the server's SQLite, Expo's push API.

**Spec:** `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md`. The parts this plan covers:
- the piece 5 row of "Pieces" (line 113) and the tabs (line 163);
- Auto-join (lines 171-176) and Faces with a Follow button (line 186);
- Alerts (lines 202-205) and Me's "Who you follow and who follows you" (line 211);
- Push (lines 241-257), Follows (lines 259-264) and Market-cap milestones (lines 266-270);
- Security's push tokens and follows (lines 364-365);
- Testing (lines 368, 374, 376, 377).

Me's leaderboard rows (line 210) come with the leaderboard in piece 6. They will use this plan's `FollowButton`.

**Before this plan:**
- Branch `feat/mooner-wireframe`, HEAD `ad34216` (2026-10-01). Round 0 of this plan was written at `d09cae8`. The commits since then, and the files of theirs this plan reads or edits:
  - `649f28e` and `ccb0f94`: `mobile/src/store.js` (a share link's ref; at a cold start the ref waits for the saved wallet). Task 8 edits `store.js` (one block) and its alerts store reads the saved sign-in the same way.
  - `3bf01c3`, `6066273` and `4a205cc`: App Links (`applinks.js`, `config.js`, `http.js`, `main.js`). Task 7 edits `config.js` and `main.js`, after the App Links routes. Tasks 3 and 6 import `HttpError`, `Limiter`, `limit` and `toJson` from `http.js`, which still exports all four.
  - `56e866e`, `1b05969` and `adba6c1`: `feed.js`, `hub.js` (`adba6c1` only) and `live.test.js`. Task 5 edits all three.
  - `f7d9221`: `server.test.js`. Task 7 edits it.
  - `78b583a` and `b1e8e5c`: `mobile/app.json`. Tasks 9 and 16 change it by script, which reads it as JSON.
  - `93c7cc3` and `ccb0f94`: the room's Share button and its ref (`app/presale/[key].js`, `share.js`, `TopBar.js`, `icons.js`). Task 10 edits `[key].js` (its 4 anchors still match once at `27ea46f`), Task 12 edits `icons.js`, and Step 0 checks `share.js`.
  - `b1e8e5c` and `ad34216`: release signing (`withReleaseSigning.js`, `run-android.sh`, piece 3's plan). Step 0 checks the plugin; the Device rules run the script.
  - `d3144d5` and `28e3160`: the web's guard for an open whose outcome is unknown (`web/src/lib/store.ts`, `opening.js`). Task 14 edits `store.ts`.
  - `3fe02db`: piece 4's plan.
  - `27ea46f`: piece 3 Task 9, the web's share-link refs (`web/src/real/refs.js`, `store.ts`, `main.tsx`, `PresaleHeader.tsx`). Task 14 edits `store.ts`; its 6 anchors still match once at `27ea46f`. Step 0 checks `refs.js`.

  This plan doesn't read `applinks.js`, `TopBar.js`, `room.js` or `opening.js`. Every anchor was recounted at `ad34216`, read-only (see "Rechecked at `ad34216`" below).
- **Order:** piece 3 (share links, `docs/superpowers/plans/2026-10-01-mooner-seeker-share-links.md`), then piece 4 (create, `docs/superpowers/plans/2026-10-01-mooner-seeker-create.md`), then this plan. Task 1's Step 0 stops unless both are committed. Their USER STEPs may still be pending, except as Device below says.
- **What this plan takes from them:**
  - piece 4's `mobile/src/ui/Chip.js` (Auto-join's amount chips), its tabs layout with Create, and its `JoinSheet.js` (which uses `Chip`);
  - piece 3's room changes in `mobile/app/presale/[key].js` (the Share button, `?ref=`);
  - piece 3's Task 0, `check-bundle.sh`'s checkout check;
  - piece 3's `app.json`, already written by a JSON script;
  - piece 3's release-signing rules (Device below);
  - piece 3's App Links routes in `engine/server/main.js`. Task 7 adds its routes before them in the same chain.
- **Test counts:** take the engine's and the phone's counts before Task 1 (BEFORE_E, BEFORE_M). This plan adds 37 engine tests (autojoin 5, alertrules 9, follows 5, push 5, live 2, alerts 10, apiclient 1) and 13 phone tests (`test/alerts.test.mjs`). Nothing here hardcodes a total.
- **Rechecked at `ad34216` (round 1, read-only).** Nothing was run but `git show` and read-only scripts over the plans' text.
  - This plan has 53 Replace anchors. 51 match exactly once in `git show ad34216:<path>`. The other 2 are Task 12's first two blocks in `mobile/app/(tabs)/_layout.js`: they match 0 times at HEAD and once in piece 4's tabs layout ("Replace all of `mobile/app/(tabs)/_layout.js` with:" in piece 4's plan). Task 12's third block matches once in both.
  - No Replace block of piece 3's or piece 4's current plans removes or repeats one of these anchors, or shares a line with one, except piece 3's App Links block in `main.js`, which is already at HEAD (`3bf01c3`) and leaves Task 7's anchor matching once. Piece 3's Task 9 changes `store.ts`' imports and `join`, which none of Task 14's 6 anchors include.
  - Test counts, read statically (the `test(` lines in the test files): engine 429, phone 194 at `ad34216`. The same method gives 415 and 170 at `d09cae8`, where the suites ran 416 and 172, so it's a guide, not a count. Step 0's BEFORE_E and BEFORE_M are the real ones.
  - Round 1 added one engine test (Task 3's device key), so +36 became +37 from Task 3 on. The phone's +13 and the tests' tick counts are unchanged.
- **Checked while writing round 0 (a record, not a gate).** All of this was run on 2026-10-01 in a clean `git archive` of `d09cae8` in the scratchpad. Round 1's changes (Task 3's device key and byte check, Task 6's batched sends, Task 8's kept sign-in, `ALERT_NUMBERS`) were checked by reading only.
  - Pieces 3 and 4's changes to the files this plan edits were applied first, by script:
    - `Chip.js`;
    - `JoinSheet.js` using it;
    - `icons.js`' `PlusIcon` and `ShareIcon`;
    - the tabs layout;
    - the room's Share button and `?ref=`.

    Then this plan's blocks, in its order, each anchor matched exactly once. The file that results is identical to the plan's blocks applied one by one (the plan is rendered from them).
  - Engine: `# tests 416` before, `# tests 452` after, `# fail 0`. That's +36, before round 1's device-key test. Piece 3's App Links tests weren't in the copy.
  - Phone: `# tests 172` before, `# tests 185` after, `# fail 0`. That's +13. Pieces 3 and 4's phone tests weren't in the copy.
  - Every "Expected: FAIL" below was seen as written. Each task's full-suite count was seen too.
  - The parse check passed on the 16 screen and store files this plan touches.
  - A check for names used but never bound or imported found none.
  - Every relative import resolves to a file that exports the name, except `mobile/src/room/share.js`. That is piece 3's new file, which the copy didn't have.
  - `node --check` passed on the 12 engine files this plan touches. `main.js` also parses with piece 3's App Links routes in the chain.
  - Web: the type-check (`tsconfig.check.json`, with paths set to the repo's `node_modules`) gives the same 19 errors before and after, and none in `store.ts` or `PlayerCard.tsx`. `web/tests/opening.test.mjs` passes after (18 tests). `npm run build` was not run.
  - Tasks 9 and 16's `app.json` scripts were run on a copy of `app.json` with pieces 3 and 4's changes.
  - The current plans of pieces 3 and 4 were read for overlap. No block of theirs removes or repeats one of this plan's anchors. Piece 3 also changes `main.js`' routes chain and `config.js`; Task 7's blocks still match once after them.
  - `expo-notifications` 55.0.27 was read, not installed:
    - its exports include `getLastNotificationResponse` and `clearLastNotificationResponse` (sync), `setNotificationChannelAsync`, `getExpoPushTokenAsync`, `AndroidImportance.HIGH`, and the handler's `shouldShowBanner` and `shouldShowList`;
    - its Android manifest adds `RECEIVE_BOOT_COMPLETED` and `POST_NOTIFICATIONS`;
    - its config plugin writes the meta-data that Task 9 greps;
    - its build pulls `com.google.firebase:firebase-messaging`.
  - Not run: npm or expo installs, prebuild, Gradle, Metro, the phone, the server, Expo, Firebase, Railway. `node_modules` were symlinks from the repo, used only by `node --test` and the checks above, and removed afterwards.

---

## Ground rules for every task

- **Branch and commits.** Work on `feat/mooner-wireframe`. Commit after each task with the command given: `git add <files> && git commit -m "…" -- <files>`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit or print secrets.** That means `.env` files, anything under `engine/.mainnet`, keypair files, keystores, `site/`, `launch-test/`, `launch.py` and `.claude/`. Never read `engine/.mainnet`, `web/.env` or a keystore. Stage files by name, never `git add -A` or `git add .`.
- **This plan's secret and private files.** Task 9 gitignores them, and each is the user's:
  - `mobile/google-services.json` (USER STEP B). The agent may print its package name (Task 16) and nothing else.
  - The FCM service-account key (`*firebase-adminsdk*.json`, USER STEP C). It never goes into this repo's folders, and the user deletes the local copy after uploading it to Expo.
  - `MOONER_EXPO_TOKEN` (USER STEP D). It lives only in Railway's variables.
- **Accounts, terms and dashboards are the user's.** The user does these:
  - signing up or in at expo.dev, Firebase or Google Cloud;
  - accepting their terms;
  - creating projects, keys or tokens there;
  - `eas login` and `eas credentials`.

  The agent never does any of it.
- **Dirty files.** Before a task edits a shared file, its Step 0 runs `git diff --quiet HEAD -- <files>`. If that fails, another session has uncommitted changes there: stop and report. Never stash them, and never commit another piece's changes.
- **Servers.** Never start dev servers, the local engine server, or Metro. The only exceptions are `mobile/scripts/check-bundle.sh` and `mobile/scripts/run-android.sh`, where a step names them.
- **Bundles only in the repo's own `mobile/`.** Never run `check-bundle.sh`, `run-android.sh`, `expo export` or any Metro bundle from a copy, a git worktree or another checkout. Another checkout's bundle can poison a shared Metro cache.
- **Never deploy, never send SOL, never change Railway variables.** Production deploys (`sh deploy/railway.sh app`), Railway variables, mainnet spends and signing keys belong to the user. Each is marked **USER STEP**.
- **Seed Vault is the user's.**
  - The agent never taps, approves, declines or signs anything in Seed Vault, and never presses Back while it's up.
  - A Mooner sign-in (turning alerts on, the first follow) shows Seed Vault asking to sign a message, with no SOL. The user does it.
  - A join spends real SOL. The agent's checks stop at the join sheet and never press Join.
- **The user's phone.**
  - The agent doesn't answer Android's permission dialogs, the notification prompt included: the user does.
  - The agent never picks a target in the share sheet.
- **Copy.** Plain short English, no game words ("players", "lobby", "match"). Say "Who's in" and "Auto-join". The titles are Dev, KOL, Raider and Diamond Hands.
- **Real data only.** Screens show only real data, with no placeholder numbers or mock rows. A figure that isn't read yet shows a spinner.
- **Live data is pushed** over the socket and chain subscriptions; there are no client polling loops.
  - Follows ride `follows:<wallet>`.
  - The Alerts list is read once on each of these events: the Alerts tab gains focus, the app comes back to the front, an alert arrives, an alert is tapped. That's one read per event, never a timer that re-reads.
- **No time estimates** for the work, anywhere.
- **Test commands:**
  - engine: `cd engine && npm test`;
  - one engine file: `cd engine && node --test test/<name>.test.js`;
  - phone: `cd mobile && npm test`;
  - one phone file: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/<name>.test.mjs`;
  - bundle check: `cd mobile && sh scripts/check-bundle.sh`. It must print `web3.js copies: 1; files from engine/node_modules: 0`, then `app/ entries from this checkout: N` with N above 0. It exits non-zero otherwise.
  - web: `cd web && npm run build` must exit 0.
- **Parse check (screen files).** Files that import React Native can't run under Node, so each is parsed instead. Run from `mobile/`, with the files as arguments:

```bash
node -e 'const b = require("@babel/core"); const fs = require("fs"); for (const f of process.argv.slice(1)) b.parseSync(fs.readFileSync(f, "utf8"), { filename: f, sourceType: "module", configFile: false, babelrc: false, presets: ["@babel/preset-react"] }); console.log("parsed", process.argv.length - 1, "files")' <files>
```

It prints `parsed N files`. A syntax error throws instead.
- **Native project.**
  - `expo-notifications` is a native module, and `app.json` changes in Tasks 9 and 16. After each, run `cd mobile && npx expo prebuild --platform android --clean`, then build a new APK.
  - `mobile/android/` is gitignored: prebuild's output is never committed.
  - After each build, compare the permissions the app asks for (Tasks 9 and 16).
- **Device.**
  - Build and install with `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh`: the bundle check right before every install, in the same `mobile/`. If the check fails, don't install.
  - Signing follows piece 3's USER STEP B choice, recorded in its Task 10 checklist line. The agent never makes or changes that choice.
    - At `ad34216` that line records choice (a): once USER STEP B is done, `run-android.sh` builds are release-signed, because Gradle reads `MOONER_RELEASE_SIGN=1` from the user's `~/.gradle/gradle.properties`. If the line says (b) when you start, the agent's builds stay debug-signed and the agent installs nothing on the Seeker after piece 3's USER STEP C; ask the user to build and install.
    - If piece 3's B is done but its USER STEP C (the user removes the debug-signed app) is not, install nothing. Ask the user, and install only once they say it's done.
    - If it isn't known whether B and C are done, ask the user before installing.
  - The agent never opens `~/.gradle/gradle.properties` or the keystore.
  - If an install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, stop and bring it to the user. Never run `adb uninstall`: it deletes the app's data.
  - Screenshots: `adb exec-out screencap -p > <scratchpad>/<name>.png`, where `<scratchpad>` is the session's scratchpad directory.
  - The Seeker's screen is 1200×2670, and `adb shell input tap X Y` uses the same pixels as the screenshot. Read X and Y from the latest screenshot.
  - The phone is device `SM02E4072816959` (`adb devices`).
- **zustand selectors.** A selector passed to `useStore` returns a stable value: a primitive, or an object already in the state. Derived lists are made with `useMemo`.
- **Edit blocks.**
  - Each "Replace … with …" block occurs exactly once in its file when you apply it. Apply a file's blocks in the order given.
  - Blocks marked "Create" are the whole file.
  - Some blocks start or end inside a line. The heading says so; keep the rest of that line.
  - If a block isn't found because the file moved on (pieces 3 and 4 land first), stop and adapt. Read what changed, make the same change to the new code by hand, and say so in your report. Never force a block onto code it doesn't match.

## Server data shapes

BigInts and PublicKeys arrive as strings.

- **`POST /api/device` `{ token, push, kinds? }` → `{ wallet, kinds, key }`.**
  - `token` is a Mooner sign-in (`POST /api/login`, as chat uses). A bad one is 401 `sign in first` or `your sign-in ran out, sign in again`.
  - `push` must be an Expo push token (`ExponentPushToken[…]`), else 400 `push must be an Expo push token`.
  - `key` is an HMAC of `device:<wallet>:<push>` under the server's device key. That key is derived from the session secret with a fixed label, so a phone's key and a sign-in's MAC are never the same thing. The phone keeps `key` and sends it with every other device route, so reading alerts needs no new sign-in.
  - A wallet keeps at most 5 phones: a sixth drops the one updated longest ago.
  - The per-IP limit is 30 sign-ups per 10 minutes.
- **`POST /api/device/kinds` `{ push, key, kinds }` → `{ wallet, kinds }`.**
- **`POST /api/device/remove` `{ push, key }` → `{ ok: true }`.**
- **`POST /api/alerts` `{ push, key }` → `{ wallet, kinds, alerts, waiting }`.**
  - `alerts` is newest first, at most 100: `{ id, kind, title, body, url, at }`.
  - `waiting` is `{ amount, at }` or null.
- **`POST /api/autojoin` `{ push, key, amount }` → `{ waiting }`.** `amount` is in lamports, as a string. It must be one of Auto-join's amounts, else 400 `pick one of the amounts shown`. On mainnet (TARGET 0.5 SOL, MIN_SEAT 0.1) those are 0.1 and 0.25 SOL: the join sheet's seats up to TARGET − MIN_SEAT.
- **`POST /api/autojoin/stop` `{ push, key }` → `{ waiting: null }`.**
- **What all the `{ push, key }` routes share:**
  - an unknown phone or a wrong key is 404 `this phone isn't signed up for alerts`;
  - the per-IP limit is 600 requests per 10 minutes.
- **`POST /api/follow` and `POST /api/unfollow` `{ token, wallet }` → `{ wallet, following, followers }`.** Those are your lists, newest first.
  - 400 `you can't follow yourself`;
  - 400 `you can follow at most 1000 wallets`;
  - 401 as above;
  - per-IP and per-wallet limits.
- **The socket topic `follows:<wallet>`.** It sends a snapshot `{ wallet, following, followers }` on sub, and again on each change.
- **Who gets what** (`engine/server/alerts.js`):

| kind | who | title (example) | opens |
|---|---|---|---|
| filled | everyone in the presale | `$MOON filled` | `/presale/<key>` |
| launched | everyone in the presale | `$MOON launched` | `/coin/<key>` |
| arrived | the wallet whose tokens arrived | `Your $MOON arrived` | `/coin/<key>` |
| joined | the creator, when someone else puts SOL in | `HgZ9…5u8D joined $MOON` | `/presale/<key>` |
| follow | the followers of a wallet that joined or opened, grouped per presale | `3 people you follow are in $MOON` | `/presale/<key>` |
| mcap | every phone with it on, once per coin per line, ever | `$MOON passed $5M market cap` | `/coin/<key>` |
| room | the phone waiting with Auto-join, once | `$MOON has room` | `/presale/<key>?join=<lamports>` |

  - An open, a fill or a launch more than 30 minutes old is not news. That covers a server that was down, and a presale seen for the first time.
  - The market cap is the pool's price × 1B × SOL/USD. A migrated coin's row carries its DAMM v2 pool's price (the feed already does that), so the lines go on after migration, none twice.
  - The lines are $100K, $500K, $1M, $5M and $10M.
  - A phone gets at most 20 pushes an hour; past that, alerts are only listed. "room" doesn't count.
  - These numbers, the 30 minutes, the 10 s of grouping, 100 alerts kept a wallet and 5 phones a wallet are one block, `ALERT_NUMBERS` in `alertrules.js`.
  - A market-cap line for many wallets goes to Expo as one send, 100 messages a request.
- **What goes to Expo, per phone:** `{ to, title, body, data: { url }, sound: "default", priority: "high", channelId: "default", ttl }`. `ttl` is 600 s for "room" and 86 400 s for the rest.
  - The send goes to `https://exp.host/--/api/v2/push/send`, at most 100 messages a request.
  - Receipts come from `.../push/getReceipts`, at most 1000 ids. Expo advises reading them about 15 minutes after the send, and clears them after 24 hours.
  - `DeviceNotRegistered` in a ticket or receipt drops that phone.
  - 429 and 5xx are tried again with backoff.
  - With `MOONER_EXPO_TOKEN` set, each request carries `Authorization: Bearer <token>`.

## File map

- **engine**
  - Create `src/alertkinds.js`, `src/autojoin.js`, `server/alertrules.js`, `server/follows.js`, `server/push.js`, `server/alerts.js`.
  - Create the tests `autojoin`, `alertrules`, `follows`, `push`, `alerts` (`test/*.test.js`).
  - Modify `server/social.js` (`makeSessions`), `server/feed.js`, `server/hub.js`, `server/config.js`, `server/main.js` and `src/apiclient.js`.
  - Modify the tests `test/live.test.js`, `test/server.test.js` and `test/apiclient.test.js`.
- **mobile**
  - Create `src/alerts/store.js`, `src/alerts/rows.js`, `src/alerts/push.js`, `src/alerts/FollowButton.js`, `src/alerts/AutoJoin.js`, `src/alerts/FollowLists.js`, `app/(tabs)/alerts.js` and `test/alerts.test.mjs`.
  - Modify:
    - `src/store.js` (exports `loginName`);
    - `src/app.js` (the `alerts` store);
    - `app/_layout.js` (start, taps, back to the front);
    - `app/(tabs)/_layout.js` (the Alerts tab);
    - `src/ui/icons.js` (`BellIcon`);
    - `app/presale/[key].js` (Follow on a card, `?join=`);
    - `src/room/JoinSheet.js` (`start`);
    - `app/(tabs)/index.js` (Auto-join);
    - `app/(tabs)/me.js` (the lists, sign-out);
    - `.gitignore`;
    - `package.json` and `package-lock.json` (expo-notifications);
    - `app.json` (Task 9's plugin; Task 16's project and Firebase file).
- **web:** modify `src/lib/store.ts` and `src/components/presale/PlayerCard.tsx`.
- **docs:** modify `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md` (the Final review's note under Follows).

---

### Task 1: Alert kinds and Auto-join's pick (shared, pure)

**Files:**
- Create: `engine/src/alertkinds.js`, `engine/src/autojoin.js`
- Test: `engine/test/autojoin.test.js`

- [ ] **Step 0: Check pieces 3 and 4 are in, and take the counts.**

Run: `git cat-file -e HEAD:mobile/src/ui/Chip.js && git cat-file -e HEAD:mobile/src/room/share.js && git cat-file -e "HEAD:mobile/app/(tabs)/create.js" && git cat-file -e HEAD:mobile/plugins/withReleaseSigning.js && git cat-file -e HEAD:web/src/real/refs.js && echo "pieces 3 and 4 are in"`
Expected: `pieces 3 and 4 are in`. If not, stop: this plan builds on both. `withReleaseSigning.js` is piece 3's Task 8, which the Device rules and Tasks 9 and 16's prebuilds rely on. `web/src/real/refs.js` is piece 3's Task 9. `create.js` is piece 4's, whose tabs layout Task 12's blocks match.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'` and `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`. Write both counts down as BEFORE_E and BEFORE_M. Both must say `# fail 0`; if not, stop and report.

- [ ] **Step 1: Write the failing test.** Create `engine/test/autojoin.test.js`:

```js
// Auto-join's pick (src/autojoin.js) and the alert kinds (src/alertkinds.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOJOIN_MIN_LEFT_S, autoChoices, hasRoomFor, pickFullest, startOf } from "../src/autojoin.js";
import { DEFAULT_KINDS, GROUPS, KIND_LABEL, SWITCHES, cleanKinds } from "../src/alertkinds.js";

// mainnet's numbers, as /api/info sends them
const N = { TARGET: "500000000", MIN_SEAT: "100000000", MAX_SEAT: "500000000", STEP: "10000000" };
const NOW = 1_000_000_000_000;
const SOL = 1_000_000_000n;
const open = (presale, raised, leftS = 600, extra = {}) => ({
  presale, state: "OPEN", where: "er", raised: String(raised), deadlineTs: NOW / 1000 + leftS, token: { symbol: presale }, users: [], ...extra,
});

test("autoChoices: the seats that can ever fit beside the creator's", () => {
  assert.deepEqual(autoChoices(N), [100_000_000n, 250_000_000n]);
  assert.deepEqual(autoChoices({ ...N, TARGET: "10000000000", MAX_SEAT: "1000000000" }), [100_000_000n, 250_000_000n, 500_000_000n]);
  assert.deepEqual(autoChoices({ ...N, TARGET: "600000000" }), [100_000_000n, 250_000_000n, 500_000_000n]); // 0.5 fits beside a 0.1 creator
});

test("hasRoomFor: open, time left, not in it yet, and room for the whole amount", () => {
  const a = 250_000_000n;
  assert.equal(hasRoomFor(open("A", SOL / 10n), N, a, "me", NOW), true); // 0.4 left
  assert.equal(hasRoomFor(open("A", 300_000_000n), N, a, "me", NOW), false); // 0.2 left
  assert.equal(hasRoomFor(open("A", 250_000_000n), N, "250000000", "me", NOW), true); // exactly
  assert.equal(hasRoomFor(open("A", SOL / 10n, AUTOJOIN_MIN_LEFT_S), N, a, "me", NOW), true); // exactly the least time
  assert.equal(hasRoomFor(open("A", SOL / 10n, AUTOJOIN_MIN_LEFT_S - 1), N, a, "me", NOW), false);
  assert.equal(hasRoomFor(open("A", SOL / 10n, 600, { stale: true }), N, a, "me", NOW), false);
  assert.equal(hasRoomFor(open("A", SOL / 10n, 600, { state: "FULL" }), N, a, "me", NOW), false);
  assert.equal(hasRoomFor(open("A", SOL / 10n, 600, { users: [{ user: "me", commit: "100000000" }] }), N, a, "me", NOW), false);
  assert.equal(hasRoomFor(open("A", SOL / 10n, 600, { seats: [{ user: "me", commit: "0", deposit: "100000000" }] }), N, a, "me", NOW), false);
});

test("pickFullest: least room first, then the nearest end; none when nothing fits", () => {
  const views = [open("EMPTY", 100_000_000n), open("FULLER", 200_000_000n, 900), open("SAME", 200_000_000n, 300), open("NOROOM", 450_000_000n)];
  assert.equal(pickFullest(views, N, 100_000_000n, "me", NOW).presale, "SAME");
  assert.equal(pickFullest(views, N, 250_000_000n, "me", NOW).presale, "SAME");
  assert.equal(pickFullest(views, N, 350_000_000n, "me", NOW).presale, "EMPTY");
  assert.equal(pickFullest(views, N, 500_000_000n, "me", NOW), null);
  assert.equal(pickFullest([open("NOCOIN", 0n, 600, { token: null })], N, 100_000_000n, "me", NOW), null);
  assert.equal(pickFullest([], N, 100_000_000n, "me", NOW), null);
});

test("startOf: a ?join= that names one of the seats, else null", () => {
  assert.equal(startOf("250000000", N), 250_000_000n);
  assert.equal(startOf("123", N), null);
  assert.equal(startOf("-1", N), null);
  assert.equal(startOf("1e9", N), null);
  assert.equal(startOf(undefined, N), null);
  assert.equal(startOf("9".repeat(17), N), null);
});

test("alert kinds: every switch is in one group and has words; cleanKinds keeps known switches", () => {
  assert.deepEqual(GROUPS.flatMap((g) => g.kinds).sort(), [...SWITCHES].sort());
  for (const k of SWITCHES) assert.ok(KIND_LABEL[k], k);
  assert.deepEqual(DEFAULT_KINDS, SWITCHES);
  assert.deepEqual(cleanKinds(["mcap", "filled", "nope", "room", "mcap"]), ["filled", "mcap"]);
  assert.deepEqual(cleanKinds([]), []);
  assert.equal(cleanKinds("filled"), null);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test test/autojoin.test.js`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `engine/src/autojoin.js`.

- [ ] **Step 3: Write the kinds.** Create `engine/src/alertkinds.js`:

```js
// The kinds of push alert, shared by the server (engine/server/alerts.js) and the phone's
// Alerts screen. Pure: no imports.

/** Every kind an alert can be. */
export const KINDS = ["filled", "launched", "arrived", "joined", "follow", "mcap", "room"];

/** The kinds with a switch on the Alerts screen, all on for a new phone. "room" (Auto-join's
 *  push) has none: it goes only to a phone that asked for it, and "Stop waiting" ends it. */
export const SWITCHES = ["filled", "launched", "arrived", "joined", "follow", "mcap"];

/** What a new phone gets: every switch on (the spec: big market caps on by default too). */
export const DEFAULT_KINDS = [...SWITCHES];

/** The Alerts screen's three groups of switches. */
export const GROUPS = [
  { title: "Your presales", kinds: ["filled", "launched", "arrived", "joined"] },
  { title: "People you follow", kinds: ["follow"] },
  { title: "Big market caps", kinds: ["mcap"] },
];

/** Each switch's words. */
export const KIND_LABEL = {
  filled: "A presale you're in fills",
  launched: "A presale you're in launches",
  arrived: "Your tokens arrive",
  joined: "Someone joins your presale",
  follow: "Someone you follow joins or opens one",
  mcap: "A coin passes $100K, $500K, $1M, $5M or $10M",
};

/** The switches that are on, from what a client sent: known switch names, each once, in
 *  SWITCHES order. null when it isn't a list. */
export function cleanKinds(v) {
  if (!Array.isArray(v)) return null;
  return SWITCHES.filter((k) => v.includes(k));
}
```

- [ ] **Step 4: Write Auto-join's rules.** Create `engine/src/autojoin.js`:

```js
// Auto-join: pick an amount once, and the app picks the fullest presale with room for it.
// Every join still needs the wallet's approval: this only picks. Pure; views are the
// server's wire form (amounts as strings) or BigInt, as views.js takes them.
import { joinCheck, roomOf, seatChoices, secondsLeft } from "./views.js";

/** A presale this close to its end isn't picked: the wallet's approval would come too late. */
export const AUTOJOIN_MIN_LEFT_S = 30;

/** The amounts Auto-join offers: the join sheet's seats that can ever fit. The creator
 *  always has at least MIN_SEAT in, so a seat over TARGET - MIN_SEAT never has room. */
export function autoChoices(N) {
  const most = BigInt(N.TARGET) - BigInt(N.MIN_SEAT);
  return seatChoices(N).filter((a) => a <= most);
}

/** Whether `wallet` can join `view` now with `amount` lamports (BigInt or a string): it takes
 *  joins (joinCheck), it has at least AUTOJOIN_MIN_LEFT_S left, and its room is at least
 *  `amount`, so the whole amount goes in. */
export function hasRoomFor(view, N, amount, wallet, nowMs) {
  if (!joinCheck(view, wallet, N, nowMs).ok) return false;
  if (secondsLeft(view, nowMs) < AUTOJOIN_MIN_LEFT_S) return false;
  return roomOf(view, N) >= BigInt(amount);
}

/** The fullest presale with room for `amount`: the least room left, then the nearest end.
 *  Only presales with a coin (`token`). null when none has room. */
export function pickFullest(views, N, amount, wallet, nowMs) {
  const fits = views.filter((v) => v.token && hasRoomFor(v, N, amount, wallet, nowMs));
  fits.sort((a, b) => {
    const d = roomOf(a, N) - roomOf(b, N);
    return d !== 0n ? (d < 0n ? -1 : 1) : Number(a.deadlineTs ?? 0) - Number(b.deadlineTs ?? 0);
  });
  return fits[0] ?? null;
}

/** The seat a `?join=<lamports>` link asks for: one of seatChoices(N) as BigInt, else null. */
export function startOf(param, N) {
  if (typeof param !== "string" || !/^\d{1,16}$/.test(param)) return null;
  const v = BigInt(param);
  return seatChoices(N).find((c) => c === v) ?? null;
}
```

- [ ] **Step 5: Run the tests.**

Run: `cd engine && node --test test/autojoin.test.js`
Expected: `# pass 5`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 5 tests, `# fail 0`.

- [ ] **Step 6: Commit.**

```bash
git add engine/src/alertkinds.js engine/src/autojoin.js engine/test/autojoin.test.js && git commit -m "engine: alert kinds and Auto-join's pick (the fullest presale with room), shared by the server and the phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/src/alertkinds.js engine/src/autojoin.js engine/test/autojoin.test.js
```

---

### Task 2: What an alert says, and when one is due

`alertrules.js` is pure. It works over the presale views and launched rows the feed reads, in their wire form:
- what changed between two reads of a presale;
- each kind's words and link;
- the market cap in dollars;
- the lines passed.

It also holds `ALERT_NUMBERS`, the one block with every number push alerts use: the lines, 30 minutes' freshness, 20 pushes an hour a phone, 10 s of grouping, 100 alerts kept a wallet and 5 phones a wallet. `alerts.js` (Task 6) reads its numbers from there.

**Files:**
- Create: `engine/server/alertrules.js`
- Test: `engine/test/alertrules.test.js`

- [ ] **Step 1: Write the failing test.** Create `engine/test/alertrules.test.js`:

```js
// When an alert is due and what it says (server/alertrules.js), over wire-form views.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KIND_LABEL } from "../src/alertkinds.js";
import { ALERT_NUMBERS, FRESH_MS, MILESTONES, alertText, insOf, launchFresh, mcapUsd, milestonesPassed, presaleEvents, shortWallet, usdShort } from "../server/alertrules.js";

const NOW = 1_800_000_000_000;
const S = NOW / 1000;
const C = "Creator111111111111111111111111111111111111";
const A = "Alice1111111111111111111111111111111111111";
const B = "Bobby1111111111111111111111111111111111111";
const seat = (user, commit, creator = false) => ({ user, commit: String(commit), deposit: String(commit), creator });
const view = (over = {}) => ({
  presale: "P1", where: "er", state: "OPEN", creator: C, openedTs: S - 60, deadlineTs: S + 3000, fullTs: 0, raised: "0",
  token: { symbol: "MOON", creator: C }, launch: null, seats: [seat(C, 100_000_000n, true)], ...over,
});
const kinds = (r) => r.events.map((e) => `${e.kind}:${e.user ?? (e.to ?? []).join("+")}`);

test("a fresh open: the creator opened it; who's in is the baseline", () => {
  const r = presaleEvents(null, view(), NOW);
  assert.deepEqual(r.ins, [C]);
  assert.deepEqual(kinds(r), [`opened:${C}`]);
  assert.equal(r.events[0].ticker, "$MOON");
  // exactly FRESH_MS old still counts as fresh
  assert.deepEqual(kinds(presaleEvents(null, view({ openedTs: S - FRESH_MS / 1000 }), NOW)), [`opened:${C}`]);
});

test("a presale first seen long after it opened: nothing, what's in it is the baseline", () => {
  const r = presaleEvents(null, view({ openedTs: S - FRESH_MS / 1000 - 1, seats: [seat(C, 1n, true), seat(A, 1n)] }), NOW);
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.ins.sort(), [A, C].sort());
  // first seen already FULL, opened within the half hour: it's not a fresh open (no opened, no joins), only the fill
  const late = presaleEvents(null, view({ state: "FULL", fullTs: S - 5, seats: [seat(C, 1n, true), seat(A, 1n)] }), NOW);
  assert.deepEqual(kinds(late), [`filled:${[C, A].join("+")}`]);
});

test("joins: a wallet whose seat gets SOL in; a seat with nothing in isn't a join yet", () => {
  const prev = { ins: [C] };
  const zero = presaleEvents(prev, view({ seats: [seat(C, 1n, true), seat(A, 0n)] }), NOW);
  assert.deepEqual(zero.events, []);
  const r = presaleEvents(prev, view({ seats: [seat(C, 1n, true), seat(A, 250_000_000n)] }), NOW);
  assert.deepEqual(kinds(r), [`join:${A}`]);
  assert.deepEqual(r.events[0], { kind: "join", presale: "P1", user: A, commit: "250000000", creator: C, ticker: "$MOON" });
  // seen again: nothing new
  assert.deepEqual(presaleEvents({ ins: r.ins }, view({ seats: [seat(C, 1n, true), seat(A, 250_000_000n)] }), NOW).events, []);
});

test("a stale view changes nothing and keeps the last who's in", () => {
  const r = presaleEvents({ ins: [C, A] }, view({ stale: true, seats: [] }), NOW);
  assert.deepEqual(r, { ins: [C, A], events: [] });
});

test("filled: once the pool is full, to everyone in; not once launched, not when old", () => {
  const prev = { ins: [C, A] };
  const full = view({ state: "FULL", fullTs: S - 5, seats: [seat(C, 1n, true), seat(A, 1n), seat(B, 1n)] });
  const r = presaleEvents(prev, full, NOW);
  assert.deepEqual(kinds(r), [`join:${B}`, `filled:${[C, A, B].join("+")}`]);
  assert.deepEqual(presaleEvents(prev, { ...full, fullTs: S - FRESH_MS / 1000 - 1 }, NOW).events.map((e) => e.kind), ["join"]);
  // a launch already recorded: launched, not filled
  assert.deepEqual(presaleEvents(prev, { ...full, launch: { sig: "x", at: NOW - 3_000 } }, NOW).events.map((e) => e.kind), ["join", "launched"]);
});

test("launched, then each seat's tokens arriving as its seat closes; the closed record ends it", () => {
  const launch = { sig: "x", at: NOW - 3_000 };
  const settled = view({ state: "SETTLED", launch, seats: [seat(C, 1n, true), seat(A, 1n), seat(B, 1n)] });
  const r1 = presaleEvents({ ins: [C, A, B] }, settled, NOW);
  assert.deepEqual(kinds(r1), [`launched:${[C, A, B].join("+")}`]);
  // a read that skipped from OPEN to the launch still tells who joined on the way
  const skipped = presaleEvents({ ins: [C] }, settled, NOW);
  assert.deepEqual(kinds(skipped), [`join:${A}`, `join:${B}`, `launched:${[C, A, B].join("+")}`]);
  const r2 = presaleEvents({ ins: r1.ins }, { ...settled, seats: [seat(C, 1n, true), seat(B, 1n)] }, NOW);
  assert.deepEqual(kinds(r2), [`launched:${[C, A, B].join("+")}`, `arrived:${A}`]);
  const closed = { presale: "P1", where: "closed", state: "CLOSED", token: { symbol: "MOON", creator: C }, launch, seats: [] };
  const r3 = presaleEvents({ ins: r2.ins }, closed, NOW);
  assert.deepEqual(kinds(r3), [`launched:${[C, B].join("+")}`, `arrived:${C}`, `arrived:${B}`]);
  // an old launch is not news: no launched and no arrived
  assert.deepEqual(presaleEvents({ ins: [C] }, { ...closed, launch: { at: NOW - FRESH_MS - 1 } }, NOW).events, []);
});

test("an expired presale's seats leaving are refunds, not arrivals", () => {
  assert.deepEqual(presaleEvents({ ins: [C, A] }, view({ state: "EXPIRED", seats: [] }), NOW).events, []);
});

test("market cap: dollars from the pool's price and SOL/USD; milestones once each", () => {
  // sqrtPrice for 1e-7 SOL per token (raw: 1e-7 * 1e9 / 1e6 = 1e-4 lamports per raw unit)
  const sqrtPrice = String(BigInt(Math.round(Math.sqrt(1e-4) * 2 ** 64)));
  const usd = mcapUsd({ pool: { sqrtPrice } }, 150);
  assert.ok(Math.abs(usd - 15_000) < 1, String(usd)); // 1e-7 * 1e9 = 100 SOL = $15,000
  assert.equal(mcapUsd({ pool: null }, 150), null);
  assert.equal(mcapUsd({ pool: { sqrtPrice } }, 0), null);
  assert.deepEqual(milestonesPassed([], 1_200_000), [100_000, 500_000, 1_000_000]);
  assert.deepEqual(milestonesPassed([100_000, 500_000], 1_200_000), [1_000_000]);
  assert.deepEqual(milestonesPassed([], 99_999), []);
  assert.deepEqual(milestonesPassed([], 100_000), [100_000]); // exactly on a line counts as passed
  assert.deepEqual(MILESTONES, [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000]);
  assert.deepEqual(ALERT_NUMBERS, { milestones: MILESTONES, freshMs: 30 * 60_000, quietMax: 20, groupMs: 10_000, maxAlerts: 100, maxDevices: 5 });
  assert.equal(FRESH_MS, ALERT_NUMBERS.freshMs);
  assert.equal(launchFresh({ launch: { at: NOW - 1 } }, NOW), true);
  assert.equal(launchFresh({ launch: { at: NOW - FRESH_MS - 1 } }, NOW), false);
});

test("the words", () => {
  assert.equal(shortWallet(A), "Alic…1111");
  assert.deepEqual([usdShort(100_000), usdShort(1_000_000), usdShort(1_234_567), usdShort(999_999), usdShort(10_000_000)], ["$100K", "$1M", "$1.23M", "$1M", "$10M"]);
  const e = { presale: "P1", ticker: "$MOON" };
  assert.deepEqual(alertText("filled", e), { title: "$MOON filled", body: "The pool is full. It launches in a moment.", url: "/presale/P1" });
  assert.deepEqual(alertText("launched", e), { title: "$MOON launched", body: "It's live on Solana. Your tokens are on the way.", url: "/coin/P1" });
  assert.deepEqual(alertText("arrived", e), { title: "Your $MOON arrived", body: "Your tokens are in your wallet.", url: "/coin/P1" });
  assert.deepEqual(alertText("joined", { ...e, user: A, commit: "250000000" }), { title: "Alic…1111 joined $MOON", body: "0.25 SOL in your presale.", url: "/presale/P1" });
  assert.equal(alertText("follow", { ...e, users: [A], opened: null }).title, "Alic…1111 joined $MOON");
  assert.equal(alertText("follow", { ...e, users: [A], opened: A }).title, "Alic…1111 opened $MOON");
  assert.equal(alertText("follow", { ...e, users: [A, B], opened: null }).title, "2 people you follow are in $MOON");
  assert.deepEqual(alertText("follow", { ...e, users: [A, B, C], opened: C }), { title: "3 people you follow are in $MOON", body: "Tap to see who's in.", url: "/presale/P1" });
  assert.deepEqual(alertText("mcap", { ...e, usd: 1_000_000, now: 1_234_567 }), { title: "$MOON passed $1M market cap", body: "It's at $1.23M now.", url: "/coin/P1" });
  assert.deepEqual(alertText("room", { ...e, amount: "250000000" }), { title: "$MOON has room", body: "There's room for your 0.25 SOL. Tap to join.", url: "/presale/P1?join=250000000" });
  assert.deepEqual(insOf(view({ seats: [seat(A, 0n), seat(C, 1n, true)] })), [C]);
  assert.throws(() => alertText("nope", e), /no words for nope/);
  // the market-cap switch's label (src/alertkinds.js) lists exactly these lines
  const lines = MILESTONES.map(usdShort);
  assert.equal(KIND_LABEL.mcap, `A coin passes ${lines.slice(0, -1).join(", ")} or ${lines.at(-1)}`);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test test/alertrules.test.js`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `engine/server/alertrules.js`.

- [ ] **Step 3: Write the rules.** Create `engine/server/alertrules.js`:

```js
// What a push alert says, and when one is due: pure rules over the presale views and launched
// rows the live feed reads (feed.js), in their wire form (amounts and keys as strings, as
// JSON.parse(toJson(v)) gives them). alerts.js keeps the state, picks who gets what, and sends.
import { sol } from "../src/flows.js";
import { marketCapSol, whoIsIn } from "../src/views.js";

/** Push alerts' numbers, in one place so they're easy to change. This file uses the first
 *  two; alerts.js uses the rest. */
export const ALERT_NUMBERS = {
  /** The market caps (US dollars) a coin's holders hear about, each once per coin, ever. */
  milestones: [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000],
  /** An open, a fill or a launch older than this (by the chain's clock or the server's) is
   *  not news: a server that was down, or a presale seen for the first time, sends nothing. */
  freshMs: 30 * 60_000,
  /** Pushes a phone gets an hour; past that, alerts are only listed ("room" doesn't count). */
  quietMax: 20,
  /** How long follow alerts for one presale gather before they go as one push. */
  groupMs: 10_000,
  /** Alerts kept per wallet: the Alerts screen's list. */
  maxAlerts: 100,
  /** Phones per wallet; signing in on a sixth drops the one updated longest ago. */
  maxDevices: 5,
};
export const MILESTONES = ALERT_NUMBERS.milestones;
export const FRESH_MS = ALERT_NUMBERS.freshMs;

const fresh = (ms, nowMs) => ms > 0 && nowMs - ms <= FRESH_MS;
const tickerOf = (view) => (view.token?.symbol ? `$${view.token.symbol}` : "a new coin");

/** "HgZ9…5u8D", as the phone shows a wallet. */
export const shortWallet = (w) => (w && w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w ?? "");

/** "$100K", "$1M", "$1.2M": three significant digits at most, as the phone's compact(). */
export function usdShort(n) {
  const r = Number(n.toPrecision(3));
  for (const [v, u] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (r >= v) return `$${Number((r / v).toPrecision(3))}${u}`;
  return `$${r}`;
}

/** The wallets in a presale (a seat with SOL in the pool). */
export const insOf = (view) => whoIsIn(view).map((r) => r.user);

/**
 * What changed in a presale since `prev` ({ ins: [wallets] } as last seen, or null for one
 * never seen): { ins, events }. `ins` is who's in now, to keep for next time. Events:
 *   { kind: "opened", presale, user, ticker }            a fresh open; user: the creator
 *   { kind: "join", presale, user, commit, creator, ticker }  someone put SOL in
 *   { kind: "filled", presale, to, ticker }              the pool filled (to: who's in)
 *   { kind: "launched", presale, to, ticker }            the coin launched
 *   { kind: "arrived", presale, user, ticker }           a seat's tokens were delivered
 * A presale seen for the first time and not freshly opened sends nothing: what's in it now is
 * the baseline. A stale view (the server couldn't read the ER) changes nothing.
 */
export function presaleEvents(prev, view, nowMs) {
  if (view.stale) return { ins: prev?.ins ?? [], events: [] };
  const presale = view.presale;
  const ticker = tickerOf(view);
  const ins = insOf(view);
  const creator = view.creator ?? view.token?.creator ?? null;
  const events = [];
  const openedFresh = !prev && view.state === "OPEN" && fresh(Number(view.openedTs ?? 0) * 1000, nowMs);
  if (openedFresh && creator) events.push({ kind: "opened", presale, user: creator, ticker });

  // joins: the wallets in now that weren't before, while seats come in (SETTLED too: after a
  // launch a seat appears only in a read that skipped from OPEN, a failed read or a restart)
  if (["OPEN", "FULL", "LAUNCHING", "SETTLED"].includes(view.state) && (prev || openedFresh)) {
    const before = new Set(prev?.ins ?? []);
    for (const r of whoIsIn(view)) {
      if (before.has(r.user) || r.user === creator) continue;
      events.push({ kind: "join", presale, user: r.user, commit: String(r.commit), creator, ticker });
    }
  }

  const all = [...new Set([...(prev?.ins ?? []), ...ins])];
  if (["FULL", "LAUNCHING"].includes(view.state) && !view.launch && fresh(Number(view.fullTs ?? 0) * 1000, nowMs)) {
    events.push({ kind: "filled", presale, to: all, ticker });
  }
  if (view.launch && fresh(Number(view.launch.at ?? 0), nowMs)) {
    events.push({ kind: "launched", presale, to: all, ticker });
    // after a launch a seat closes only when its tokens are delivered (claim)
    const now = new Set(ins);
    for (const user of prev?.ins ?? []) if (!now.has(user)) events.push({ kind: "arrived", presale, user, ticker });
  }
  return { ins, events };
}

/** A launched row's market cap in US dollars, or null without a pool or a SOL price. */
export function mcapUsd(row, solUsd) {
  if (!row?.pool?.sqrtPrice || !(solUsd > 0)) return null;
  return marketCapSol(row.pool.sqrtPrice) * solUsd;
}

/** The milestones `usd` reaches that aren't in `had` yet, lowest first. */
export const milestonesPassed = (had, usd) => MILESTONES.filter((m) => usd >= m && !had.includes(m));

/** Whether a launched row's launch is recent enough for its first milestones to be news. */
export const launchFresh = (row, nowMs) => fresh(Number(row?.launch?.at ?? 0), nowMs);

// ---- the words ----

/** { title, body, url } for an alert. `e` is a presaleEvents event (or a milestone, a room,
 *  a group of follows); see each case. */
export function alertText(kind, e) {
  const room = `/presale/${e.presale}`;
  switch (kind) {
    case "filled":
      return { title: `${e.ticker} filled`, body: "The pool is full. It launches in a moment.", url: room };
    case "launched":
      return { title: `${e.ticker} launched`, body: "It's live on Solana. Your tokens are on the way.", url: `/coin/${e.presale}` };
    case "arrived":
      return { title: `Your ${e.ticker} arrived`, body: "Your tokens are in your wallet.", url: `/coin/${e.presale}` };
    case "joined":
      return { title: `${shortWallet(e.user)} joined ${e.ticker}`, body: `${sol(e.commit)} SOL in your presale.`, url: room };
    case "follow": {
      // e: { presale, ticker, users: [wallets], opened: wallet | null }
      if (e.users.length > 1) return { title: `${e.users.length} people you follow are in ${e.ticker}`, body: "Tap to see who's in.", url: room };
      const [user] = e.users;
      if (e.opened === user) return { title: `${shortWallet(user)} opened ${e.ticker}`, body: "A new presale from someone you follow.", url: room };
      return { title: `${shortWallet(user)} joined ${e.ticker}`, body: "Someone you follow is in. Tap to see who's in.", url: room };
    }
    case "mcap":
      // e: { presale, ticker, usd (the milestone), now (the market cap) }
      return { title: `${e.ticker} passed ${usdShort(e.usd)} market cap`, body: `It's at ${usdShort(e.now)} now.`, url: `/coin/${e.presale}` };
    case "room":
      // e: { presale, ticker, amount (lamports, a string) }
      return { title: `${e.ticker} has room`, body: `There's room for your ${sol(e.amount)} SOL. Tap to join.`, url: `${room}?join=${e.amount}` };
    default:
      throw new Error(`no words for ${kind}`);
  }
}
```

- [ ] **Step 4: Run the tests.**

Run: `cd engine && node --test test/alertrules.test.js`
Expected: `# pass 9`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 14, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add engine/server/alertrules.js engine/test/alertrules.test.js && git commit -m "engine: what each push alert says and when one is due: presale changes, market-cap lines, stale events skipped

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/alertrules.js engine/test/alertrules.test.js
```

---

### Task 3: Follows, with chat's sign-in shared

`social.js`' session code moves into `makeSessions(db, now)`, which it exports, so follows and alerts check the same Mooner sign-in.
- It also gains `deviceSign` and `deviceCheck`, the HMAC Task 6 uses for a phone's `key`.
- That HMAC uses its own device key, derived from the session secret with a fixed label (`HMAC(secret, "mooner:device-key")`). So a sign-in's MAC is never a valid phone key, nor the other way round.
- Every MAC compare checks the byte lengths before `crypto.timingSafeEqual`. A MAC of the right length in characters but not in bytes (a multibyte character) is then a plain no. Before, it made `timingSafeEqual` throw, which is a 500.
- That is the one change chat sees: such a forged sign-in is now a 401, not a 500. The moved `walletOf` is the only `timingSafeEqual` in the repo at this plan's base, so nothing else is left for a followup.

**Files:**
- Modify: `engine/server/social.js`
- Create: `engine/server/follows.js`
- Test: `engine/test/follows.test.js`

- [ ] **Step 0: Check the file is clean.** Run `git diff --quiet HEAD -- engine/server/social.js && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the failing test.** Create `engine/test/follows.test.js`:

```js
// Follows (server/follows.js) and the shared sign-in (social.js makeSessions), over an
// in-memory Store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { makeSessions, makeSocialRoutes } from "../server/social.js";
import { followersOf, followsOf, makeFollowRoutes } from "../server/follows.js";

const wallet = () => Keypair.generate().publicKey.toBase58();
const handler = (routes, path) => routes.find((r) => r.path.test(path)).handler;

function rig({ now = () => 1_000_000 } = {}) {
  const store = new Store(":memory:");
  const heard = [];
  const routes = makeFollowRoutes({ store, onFollow: (w) => heard.push(w), now });
  const sessions = makeSessions(store.db, now);
  const follow = (token, w, ip = "1.1.1.1") => handler(routes, "/api/follow")({ body: { token, wallet: w }, ip });
  const unfollow = (token, w, ip = "1.1.1.1") => handler(routes, "/api/unfollow")({ body: { token, wallet: w }, ip });
  return { store, heard, sessions, follow, unfollow };
}

test("sessions: one secret per db, shared by every part of the server; a forged or old token is 401", () => {
  let t = 1_000;
  const store = new Store(":memory:");
  const a = makeSessions(store.db, () => t);
  makeSocialRoutes({ store, isPresale: () => false, now: () => t }); // the social routes' own copy
  const b = makeSessions(store.db, () => t);
  const W = wallet();
  const { token } = a.issue(W);
  assert.equal(b.walletOf(token), W);
  assert.equal(b.deviceCheck("device:x", a.deviceSign("device:x")), true);
  assert.equal(b.deviceCheck("device:y", a.deviceSign("device:x")), false);
  assert.equal(b.deviceCheck("device:x", undefined), false);
  assert.throws(() => b.walletOf(token.slice(0, -2) + "xx"), { status: 401 });
  assert.throws(() => b.walletOf(undefined), { status: 401, message: "sign in first" });
  t += 8 * 24 * 3_600_000;
  assert.throws(() => b.walletOf(token), { status: 401, message: "your sign-in ran out, sign in again" });
});

test("sessions: a phone's key and a sign-in are MACs under different keys; a MAC the right length in characters but not in bytes is a no, not a throw", () => {
  const s = makeSessions(new Store(":memory:").db, () => 1_000);
  const { token } = s.issue(wallet());
  const [w, exp, mac] = token.split(".");
  assert.equal(s.deviceCheck(`${w}.${exp}`, mac), false, "a sign-in's MAC is not a phone's key");
  assert.throws(() => s.walletOf(`${w}.${exp}.${s.deviceSign(`${w}.${exp}`)}`), { status: 401 }, "nor is a phone's key a sign-in");
  // "é" is 1 character and 2 bytes: same length as the real MAC in characters, one byte longer
  const key = s.deviceSign("device:x");
  assert.equal(s.deviceCheck("device:x", `é${key.slice(1)}`), false);
  assert.throws(() => s.walletOf(`${w}.${exp}.é${mac.slice(1)}`), { status: 401 });
});

test("follow and unfollow: both lists, newest first; both wallets are pushed", async () => {
  let t = 1_000;
  const { sessions, follow, unfollow, heard, store } = rig({ now: () => t });
  const [me, a, b] = [wallet(), wallet(), wallet()];
  const token = sessions.issue(me).token;
  assert.deepEqual((await follow(token, a)).json, { wallet: me, following: [a], followers: [] });
  t += 1;
  assert.deepEqual((await follow(token, b)).json.following, [b, a]);
  assert.deepEqual((await follow(token, b)).json.following, [b, a]); // again: no change
  assert.deepEqual(followsOf(store.db, a), { wallet: a, following: [], followers: [me] });
  assert.deepEqual(followersOf(store.db, b), [me]);
  assert.deepEqual(heard.slice(0, 4), [me, a, me, b]);
  assert.deepEqual((await unfollow(token, a)).json.following, [b]);
  assert.deepEqual(followersOf(store.db, a), []);
});

test("refused: no sign-in, yourself, not an address, over the limits", async () => {
  const { sessions, follow } = rig();
  const me = wallet();
  const token = sessions.issue(me).token;
  await assert.rejects(follow("nope", wallet()), { status: 401 });
  await assert.rejects(follow(token, me), { status: 400, message: "you can't follow yourself" });
  await assert.rejects(follow(token, "not a key"), { status: 400, message: "wallet is not a Solana address" });
  // 60 a wallet each 10 minutes; the refusals above were before the wallet's count
  for (let i = 0; i < 60; i++) await follow(token, wallet());
  await assert.rejects(follow(token, wallet()), { status: 429 });
});

test("at most MAX_FOLLOWING wallets", async () => {
  const store = new Store(":memory:");
  const routes = makeFollowRoutes({ store, limits: { followPerIp: [1e9, 1], followPerWallet: [1e9, 1] } });
  const me = wallet();
  const token = makeSessions(store.db).issue(me).token;
  const insert = store.db.prepare("INSERT INTO follows (follower, followee, at) VALUES (?, ?, ?)");
  const first = wallet();
  insert.run(me, first, 0);
  for (let i = 1; i < 1_000; i++) insert.run(me, `w${i}`, i);
  const follow = (w) => handler(routes, "/api/follow")({ body: { token, wallet: w }, ip: "x" });
  await assert.rejects(follow(wallet()), { status: 400, message: "you can follow at most 1000 wallets" });
  assert.equal((await follow(first)).json.following.length, 1_000); // one already followed is fine
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test test/follows.test.js`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `engine/server/follows.js`.

- [ ] **Step 3: Share the sessions.**

Apply these 2 blocks to `engine/server/social.js`, in order.

Replace:

```js
  const usedSigs = new Map();

  // the session secret survives restarts, so a sign-in lasts its week
  let secret = db.prepare("SELECT value FROM secrets WHERE name = 'session'").get()?.value;
  if (!secret) {
    secret = crypto.randomBytes(32);
    db.prepare("INSERT INTO secrets (name, value) VALUES ('session', ?)").run(secret);
  }
  const mac = (s) => crypto.createHmac("sha256", secret).update(s).digest("base64url");

  function issue(wallet) {
    const exp = now() + SESSION_MS;
    const body = `${wallet}.${exp}`;
    return { token: `${body}.${mac(body)}`, exp };
  }

  /** The wallet a session token was issued to; 401 if it's forged or old. */
  function walletOf(token) {
    if (typeof token !== "string") throw new HttpError(401, "sign in first");
    const [wallet, exp, sig] = token.split(".");
    const want = mac(`${wallet}.${exp}`);
    const ok = sig && sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
    if (!ok || !(Number(exp) > now())) throw new HttpError(401, "your sign-in ran out, sign in again");
    return wallet;
  }
```

with:

```js
  const usedSigs = new Map();
  const { issue, walletOf } = makeSessions(db, now);
```

Replace:

```js
/** `store` is the server's Store (its db is shared); `isPresale(key)` says whether a chat
```

with:

```js
/** Mooner sign-ins, over the server's db: { issue(wallet) -> { token, exp }, walletOf(token)
 *  -> wallet (401 if it's forged or old), deviceSign(text) -> mac, deviceCheck(text, mac) ->
 *  boolean }. The secret lives in the db, so a sign-in survives restarts and lasts its week,
 *  and every part of the server that calls this shares it (follows.js, alerts.js). A phone's
 *  `key` (alerts.js) is a MAC under its own key, derived from the secret with a fixed label,
 *  so a sign-in's MAC is never a phone's key, nor the other way round. */
export function makeSessions(db, now = Date.now) {
  db.exec("CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value BLOB NOT NULL)");
  let secret = db.prepare("SELECT value FROM secrets WHERE name = 'session'").get()?.value;
  if (!secret) {
    secret = crypto.randomBytes(32);
    db.prepare("INSERT INTO secrets (name, value) VALUES ('session', ?)").run(secret);
  }
  const deviceKey = crypto.createHmac("sha256", secret).update("mooner:device-key").digest();
  const macWith = (key, s) => crypto.createHmac("sha256", key).update(s).digest("base64url");
  // Byte lengths, not string lengths: a MAC with a multibyte character can have the right
  // length in characters, and timingSafeEqual throws (a 500) on buffers of different lengths.
  const same = (mac, want) => {
    if (typeof mac !== "string") return false;
    const a = Buffer.from(mac);
    const b = Buffer.from(want);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  function issue(wallet) {
    const exp = now() + SESSION_MS;
    const body = `${wallet}.${exp}`;
    return { token: `${body}.${macWith(secret, body)}`, exp };
  }

  function walletOf(token) {
    if (typeof token !== "string") throw new HttpError(401, "sign in first");
    const [wallet, exp, mac] = token.split(".");
    if (!same(mac, macWith(secret, `${wallet}.${exp}`)) || !(Number(exp) > now())) throw new HttpError(401, "your sign-in ran out, sign in again");
    return wallet;
  }

  const deviceSign = (s) => macWith(deviceKey, s);
  const deviceCheck = (s, mac) => same(mac, deviceSign(s));

  return { issue, walletOf, deviceSign, deviceCheck };
}

/** `store` is the server's Store (its db is shared); `isPresale(key)` says whether a chat
```

- [ ] **Step 4: Write the follows.** Create `engine/server/follows.js`:

```js
// Who follows whom, kept in the server's SQLite beside the chat. Following is public, as on
// a Mooner's card: anyone's lists ride the socket's `follows:<wallet>` topic (feed.js).
//
//   POST /api/follow     { token, wallet }  -> { wallet, following, followers }  (yours)
//   POST /api/unfollow   { token, wallet }  -> the same
//
// `token` is a Mooner sign-in (social.js /api/login). alerts.js reads followersOf to tell a
// wallet's followers when it joins or opens a presale.

import { HttpError, Limiter, limit } from "./http.js";
import { parseKey } from "./api.js";
import { makeSessions } from "./social.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS follows (
  follower TEXT NOT NULL,
  followee TEXT NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (follower, followee)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee, at);`;

/** How many wallets one wallet can follow; the lists show this many at most. */
export const MAX_FOLLOWING = 1_000;

export const FOLLOW_LIMITS = {
  followPerIp: [120, 600_000],
  followPerWallet: [60, 600_000],
};

const ready = new WeakSet();
function schema(db) {
  if (ready.has(db)) return;
  db.exec(SCHEMA);
  ready.add(db);
}

/** A wallet's lists, newest first: { wallet, following, followers }. */
export function followsOf(db, wallet) {
  schema(db);
  const col = (sql, k) => db.prepare(sql).all(wallet, MAX_FOLLOWING).map((r) => r[k]);
  return {
    wallet,
    following: col("SELECT followee FROM follows WHERE follower = ? ORDER BY at DESC, followee LIMIT ?", "followee"),
    followers: col("SELECT follower FROM follows WHERE followee = ? ORDER BY at DESC, follower LIMIT ?", "follower"),
  };
}

/** Every wallet that follows `wallet`. */
export function followersOf(db, wallet) {
  schema(db);
  return db.prepare("SELECT follower FROM follows WHERE followee = ?").all(wallet).map((r) => r.follower);
}

/** The routes. `onFollow(wallet)` hears each wallet whose lists changed (both sides of a
 *  follow), so the live feed can push them. */
export function makeFollowRoutes({ store, onFollow = () => {}, limits = FOLLOW_LIMITS, now = Date.now }) {
  const db = store.db;
  schema(db);
  const { walletOf } = makeSessions(db, now);
  const L = Object.fromEntries(Object.entries(limits).map(([k, [max, ms]]) => [k, new Limiter(max, ms, now)]));

  const change = (on) => async ({ body, ip }) => {
    limit(L.followPerIp, ip, "follows");
    const follower = walletOf(body.token);
    const followee = parseKey(body.wallet, "wallet").toBase58();
    if (followee === follower) throw new HttpError(400, "you can't follow yourself");
    limit(L.followPerWallet, follower, "follows, slow down");
    if (on) {
      const had = db.prepare("SELECT 1 FROM follows WHERE follower = ? AND followee = ?").get(follower, followee);
      const n = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower = ?").get(follower).n;
      if (!had && n >= MAX_FOLLOWING) throw new HttpError(400, `you can follow at most ${MAX_FOLLOWING} wallets`);
      db.prepare("INSERT OR IGNORE INTO follows (follower, followee, at) VALUES (?, ?, ?)").run(follower, followee, now());
    } else {
      db.prepare("DELETE FROM follows WHERE follower = ? AND followee = ?").run(follower, followee);
    }
    for (const w of [follower, followee]) {
      try {
        onFollow(w);
      } catch {
        // the lists are saved; a push that failed reaches them at their next snapshot
      }
    }
    return { json: followsOf(db, follower) };
  };

  return [
    { method: "POST", path: /^\/api\/follow$/, body: 1_024, handler: change(true) },
    { method: "POST", path: /^\/api\/unfollow$/, body: 1_024, handler: change(false) },
  ];
}
```

- [ ] **Step 5: Run the tests.**

Run: `cd engine && node --test test/follows.test.js`
Expected: `# pass 5`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 19, `# fail 0`. The chat and sign-in tests in `server.test.js`, `pfp-profile.test.js` and `live.test.js` still pass on the shared sessions.

- [ ] **Step 6: Commit.**

```bash
git add engine/server/social.js engine/server/follows.js engine/test/follows.test.js && git commit -m "engine: follows (POST /api/follow, /api/unfollow, at most 1000), with Mooner sign-ins shared from social.js (makeSessions)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/social.js engine/server/follows.js engine/test/follows.test.js
```

---

### Task 4: Sending through Expo

**Files:**
- Create: `engine/server/push.js`
- Test: `engine/test/push.test.js`

- [ ] **Step 1: Write the failing test.** Create `engine/test/push.test.js`. It uses a fake `fetch`: nothing is sent.

```js
// Expo push sends (server/push.js) against a fake Expo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPO_RECEIPTS, EXPO_SEND, ExpoPush, PUSH_TOKEN } from "../server/push.js";

const tok = (n) => `ExponentPushToken[tok${n}]`;
const msg = (n) => ({ to: tok(n), title: "t", body: "b" });

/** A fetch that answers from `replies` ([status, body] each) and keeps every call. */
function fakeExpo(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const [status, body] = typeof replies === "function" ? replies(url, JSON.parse(init.body)) : replies.shift();
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test("PUSH_TOKEN: Expo's token shapes only", () => {
  assert.ok(PUSH_TOKEN.test("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"));
  assert.ok(PUSH_TOKEN.test("ExpoPushToken[abc]"));
  for (const bad of ["", "ExponentPushToken[]", "ExponentPushToken[a b]", "fcm:abc", "ExponentPushToken[a]x"]) assert.equal(PUSH_TOKEN.test(bad), false, bad);
});

test("send: one request per 100, the access token when there is one, tickets counted", async () => {
  const f = fakeExpo((url, body) => [200, { data: body.map(() => ({ status: "ok", id: "r" })) }]);
  const push = new ExpoPush({ fetch: f, accessToken: "secret", receiptMs: 60_000, log: () => {} });
  const messages = Array.from({ length: 150 }, (_, i) => msg(i));
  assert.equal(await push.send(messages), 150);
  assert.deepEqual(f.calls.map((c) => [c.url, c.body.length]), [[EXPO_SEND, 100], [EXPO_SEND, 50]]);
  assert.equal(f.calls[0].headers.authorization, "Bearer secret");
  push.stop();
  const plain = new ExpoPush({ fetch: fakeExpo([[200, { data: [{ status: "ok" }] }]]), log: () => {} });
  await plain.send([msg(1)]);
  assert.equal(plain.fetch.calls[0].headers.authorization, undefined);
});

test("a DeviceNotRegistered ticket drops the token; other errors are logged", async () => {
  const dead = [];
  const logs = [];
  const f = fakeExpo([[200, { data: [
    { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
    { status: "error", message: "too big", details: { error: "MessageTooBig" } },
    { status: "ok", id: "id3" },
  ] }]]);
  const push = new ExpoPush({ fetch: f, onDead: (t) => dead.push(t), log: (m) => logs.push(m), receiptMs: 60_000 });
  assert.equal(await push.send([msg(1), msg(2), msg(3)]), 1);
  assert.deepEqual(dead, [tok(1)]);
  assert.match(logs.join("\n"), /tok2.*MessageTooBig too big/);
  push.stop();
});

test("receipts: read receiptMs after the send; a dead token there is dropped too", async () => {
  const dead = [];
  const f = fakeExpo((url, body) =>
    url === EXPO_SEND
      ? [200, { data: body.map((m, i) => ({ status: "ok", id: `id${i}` })) }]
      : [200, { data: { id0: { status: "ok" }, id1: { status: "error", details: { error: "DeviceNotRegistered" } } } }],
  );
  const push = new ExpoPush({ fetch: f, onDead: (t) => dead.push(t), receiptMs: 20, log: () => {} });
  await push.send([msg(1), msg(2)]);
  assert.equal(f.calls.length, 1);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(f.calls[1], { url: EXPO_RECEIPTS, headers: f.calls[1].headers, body: { ids: ["id0", "id1"] } });
  assert.deepEqual(dead, [tok(2)]);
  // stop() clears receipt reads still waiting
  await push.send([msg(3)]);
  push.stop();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(f.calls.length, 3);
});

test("429 and 5xx are tried again with a backoff; a 400 or a timeout isn't; send never throws", async () => {
  const logs = [];
  const f = fakeExpo([[429, {}], [503, { errors: [{ message: "busy" }] }], [200, { data: [{ status: "ok" }] }]]);
  const push = new ExpoPush({ fetch: f, backoffMs: 1, log: (m) => logs.push(m) });
  assert.equal(await push.send([msg(1)]), 1);
  assert.equal(f.calls.length, 3);

  const g = fakeExpo([[400, { errors: [{ message: "bad request" }] }]]);
  const p2 = new ExpoPush({ fetch: g, backoffMs: 1, log: (m) => logs.push(m) });
  assert.equal(await p2.send([msg(1)]), 0);
  assert.equal(g.calls.length, 1);
  assert.match(logs.at(-1), /1 push\(es\) not sent: Expo said 400: bad request/);

  const h = fakeExpo([[500, {}], [500, {}], [500, {}]]);
  assert.equal(await new ExpoPush({ fetch: h, backoffMs: 1, log: (m) => logs.push(m) }).send([msg(1)]), 0);
  assert.equal(h.calls.length, 3);

  const never = async (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const p4 = new ExpoPush({ fetch: never, requestMs: 20, log: (m) => logs.push(m) });
  assert.equal(await p4.send([msg(1)]), 0);
  assert.match(logs.at(-1), /exp\.host didn't answer in 0\.02 s/);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test test/push.test.js`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `engine/server/push.js`.

- [ ] **Step 3: Write the sender.** Create `engine/server/push.js`:

```js
// Sends push alerts through Expo's push service, which hands them to Firebase Cloud Messaging
// for Android (https://docs.expo.dev/push-notifications/sending-notifications/). Expo keeps
// the FCM key; this server keeps at most an Expo access token (MOONER_EXPO_TOKEN, for Expo's
// "enhanced security"; none is fine while that's off).
//
// A send gets a ticket per message; a ticket's id gets a receipt later, once FCM answered.
// A token Expo or FCM calls DeviceNotRegistered (the app was removed, or its token changed)
// goes to `onDead`, so it's dropped.

import { getWithin } from "../src/market.js";

export const EXPO_SEND = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS = "https://exp.host/--/api/v2/push/getReceipts";
/** What an Expo push token looks like (expo-server-sdk's isExpoPushToken). */
export const PUSH_TOKEN = /^Expo(nent)?PushToken\[[^[\]\s]{1,200}\]$/;
/** Expo takes at most this many messages a request, and this many receipt ids. */
export const SEND_BATCH = 100;
export const RECEIPT_BATCH = 1_000;

export class ExpoPush {
  /**
   * `fetch`: for tests. `receiptMs`: how long after a send its receipts are read (Expo: about
   * 15 minutes). `tries`: sends of one batch when Expo answers 429 or 5xx, `backoffMs` apart,
   * doubling. A send that got no answer in `requestMs` isn't sent again: it may have gone.
   */
  constructor({ fetch = globalThis.fetch, accessToken = null, onDead = () => {}, log = console.log, receiptMs = 15 * 60_000, tries = 3, backoffMs = 1_000, requestMs = 10_000 } = {}) {
    Object.assign(this, { fetch, accessToken, onDead, log, receiptMs, tries, backoffMs, requestMs });
    this.timers = new Set();
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** POSTs `body` to `url`: Expo's JSON reply, or throws. 429 and 5xx are tried again. */
  async post(url, body) {
    const headers = { accept: "application/json", "content-type": "application/json", ...(this.accessToken && { authorization: `Bearer ${this.accessToken}` }) };
    for (let i = 1; ; i++) {
      const { r, j } = await getWithin(this.fetch, url, { method: "POST", headers, body: JSON.stringify(body) }, this.requestMs);
      if (r.ok && j) return j;
      const again = r.status === 429 || r.status >= 500;
      if (!again || i >= this.tries) throw new Error(`Expo said ${r.status}${j?.errors?.[0]?.message ? `: ${j.errors[0].message}` : ""}`);
      await new Promise((res) => setTimeout(res, this.backoffMs * 2 ** (i - 1)));
    }
  }

  /** Sends `messages` ({ to, title, body, data, ... } each, Expo's format), SEND_BATCH a
   *  request. Returns how many Expo took. Never throws: what failed is logged. */
  async send(messages) {
    let ok = 0;
    for (let i = 0; i < messages.length; i += SEND_BATCH) {
      const batch = messages.slice(i, i + SEND_BATCH);
      let tickets;
      try {
        tickets = (await this.post(EXPO_SEND, batch)).data;
      } catch (e) {
        this.log(`${batch.length} push(es) not sent: ${e.message}`);
        continue;
      }
      const ids = new Map(); // ticket id -> token
      (Array.isArray(tickets) ? tickets : []).forEach((t, k) => {
        const to = batch[k]?.to;
        if (t?.status === "ok") {
          ok++;
          if (t.id) ids.set(t.id, to);
        } else this.failed(to, t);
      });
      if (ids.size) this.receiptsLater(ids);
    }
    return ok;
  }

  /** A ticket or receipt that says the message didn't go. */
  failed(to, t) {
    if (t?.details?.error === "DeviceNotRegistered") {
      try {
        this.onDead(to);
      } catch (e) {
        this.log(`dropping ${to}: ${e?.message ?? e}`);
      }
      return;
    }
    this.log(`push to ${to} failed: ${t?.details?.error ?? ""} ${t?.message ?? ""}`.trim());
  }

  receiptsLater(ids) {
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.receipts(ids).catch((e) => this.log(`push receipts: ${e?.message ?? e}`));
    }, this.receiptMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  /** Reads the receipts of `ids` (ticket id -> token): a dead token goes to onDead. */
  async receipts(ids) {
    const all = [...ids.keys()];
    for (let i = 0; i < all.length; i += RECEIPT_BATCH) {
      const { data } = await this.post(EXPO_RECEIPTS, { ids: all.slice(i, i + RECEIPT_BATCH) });
      for (const [id, r] of Object.entries(data ?? {})) if (r?.status === "error") this.failed(ids.get(id), r);
    }
  }
}
```

- [ ] **Step 4: Run the tests.**

Run: `cd engine && node --test test/push.test.js`
Expected: `# pass 5`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 24, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add engine/server/push.js engine/test/push.test.js && git commit -m "engine: Expo push sender: batches of 100, 429 and 5xx tried again, receipts read later drop dead phones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/push.js engine/test/push.test.js
```

---

### Task 5: The feed tells the notifier, and serves `follows:<wallet>`

The feed already reads a presale when it changes, but only while a socket has it. With a `"presale"` listener, it reads every changed presale, and hands each read to its listeners. It also hands them each launched row it pushes (`"pool"`). A listener that throws is logged, never a crash. The hub accepts `follows:<wallet>`, and the feed answers it from SQLite.

**Files:**
- Modify: `engine/server/feed.js`, `engine/server/hub.js`
- Test: `engine/test/live.test.js`

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- engine/server/feed.js engine/server/hub.js engine/test/live.test.js && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the failing tests.**

Apply this block to `engine/test/live.test.js`.

Replace:

```js
// ---- migration, the DAMM v2 pool, coin stats ----
```

with:

```js
test("for push alerts: every presale read and pool push is heard, sockets or not; a listener that throws is logged", async () => {
  const s = await startLive();
  const heard = [];
  s.feed.on("presale", (v) => heard.push(["presale", v.presale.toBase58(), v.seats.length]));
  s.feed.on("pool", (row) => heard.push(["pool", row.mint, String(row.pool.quoteReserve)]));
  const { presale } = newPresale(s.l1, s.store);
  const k = presale.toBase58();
  const c = await s.client();
  try {
    // no socket on it: read anyway, for the listener
    const a = Keypair.generate().publicKey;
    s.l1.write(seatPda(pid, presale, a), pid, seatData(presale, a, 30_000_000n));
    await wait(150);
    assert.deepEqual(heard, [["presale", k, 1]]);

    const coin = launchedCoin(s.l1, s.store);
    s.feed.launched(coin.presale);
    await wait(150);
    assert.deepEqual(heard.filter((h) => h[0] === "pool"), [["pool", coin.mint.toBase58(), "197354828"]]);

    // a listener that throws: logged, and the socket still gets the presale
    s.feed.on("presale", () => {
      throw new Error("boom");
    });
    c.sub(`presale:${k}`);
    await c.next(on(`presale:${k}`, "snapshot"));
    const b = Keypair.generate().publicKey;
    s.l1.write(seatPda(pid, presale, b), pid, seatData(presale, b, 10_000_000n));
    assert.equal((await c.next(on(`presale:${k}`, "snapshot"))).data.seats.length, 2);
    assert.ok(s.logs.some((l) => l === "presale listener: boom"), s.logs.join("\n"));
  } finally {
    c.close();
    await s.close();
  }
});

test("follows:<wallet>: its lists, then again each time they change", async () => {
  const s = await startLive();
  const c = await s.client();
  try {
    const [w, f] = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];
    c.sub(`follows:${w}`);
    assert.deepEqual((await c.next(on(`follows:${w}`, "snapshot"))).data, { wallet: w, following: [], followers: [] });
    s.store.db.prepare("INSERT INTO follows (follower, followee, at) VALUES (?, ?, 1)").run(f, w);
    s.feed.followed(w);
    assert.deepEqual((await c.next(on(`follows:${w}`, "snapshot"))).data.followers, [f]);
    s.feed.followed(f); // nobody has f's lists open: nothing sent
    await wait(50);
    assert.equal(c.got.filter((m) => m.topic === `follows:${f}`).length, 0);
  } finally {
    c.close();
    await s.close();
  }
});

// ---- migration, the DAMM v2 pool, coin stats ----
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd engine && node --test test/live.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'`
Expected: `# fail 2`. The two failures are `for push alerts: every presale read and pool push is heard, sockets or not; a listener that throws is logged` and `follows:<wallet>: its lists, then again each time they change`. The second one gets `unknown topic follows:…`.

- [ ] **Step 3: Let the hub take the topic.**

Apply these 2 blocks to `engine/server/hub.js`, in order.

Replace this text, which starts mid-line (keep the start of that line as it is):

```js
(chat|presale|wallet|coin):[1-9A-HJ-NP-Za-km-z]{32,44})$/;
```

with:

```js
(chat|presale|wallet|coin|follows):[1-9A-HJ-NP-Za-km-z]{32,44})$/;
```

Replace:

```js
// wallet:<wallet>, coin:<mint>.
```

with:

```js
// wallet:<wallet>, coin:<mint>, follows:<wallet>.
```

- [ ] **Step 4: Change the feed.**

Apply these 7 blocks to `engine/server/feed.js`, in order.

Replace:

```js
//   - chat messages and pictures as the server saves them: `chat:<channel>`, `profiles`
```

with:

```js
//   - chat messages and pictures as the server saves them: `chat:<channel>`, `profiles`
//   - who a wallet follows and who follows it, as that changes: `follows:<wallet>`
// For push alerts (alerts.js) it also tells its own listeners each presale it read
// ("presale", read even with no socket on it while someone listens) and each launched
// row it pushed ("pool").
```

Replace:

```js
import { allProfiles, chatRows } from "./social.js";
```

with:

```js
import { allProfiles, chatRows } from "./social.js";
import { followsOf } from "./follows.js";
```

Replace:

```js
    if (!this.has(`presale:${k}`) && !this.has("presales")) return;
```

with:

```js
    if (!this.has(`presale:${k}`) && !this.has("presales") && !this.listenerCount("presale")) return;
```

Replace:

```js
    this.publish(`presale:${k}`, { type: "snapshot", data: v });
```

with:

```js
    try {
      this.emit("presale", v);
    } catch (e) {
      this.log(`presale listener: ${e?.message ?? e}`);
    }
    this.publish(`presale:${k}`, { type: "snapshot", data: v });
```

Replace:

```js
    this.publish("launched", { type: "upsert", data: row });
```

with:

```js
    this.publish("launched", { type: "upsert", data: row });
    try {
      this.emit("pool", row);
    } catch (e) {
      this.log(`pool listener: ${e?.message ?? e}`);
    }
```

Replace:

```js
    this.publish("profiles", { type: "upsert", data: { wallet, pfp } });
  }
```

with:

```js
    this.publish("profiles", { type: "upsert", data: { wallet, pfp } });
  }

  /** `wallet`'s follows changed (follows.js): its lists, to whoever has them open. */
  followed(wallet) {
    if (this.has(`follows:${wallet}`)) this.publish(`follows:${wallet}`, { type: "snapshot", data: followsOf(this.db, wallet) });
  }
```

Replace this text, which ends mid-line (keep the rest of that line as it is):

```js
      if (kind === "wallet") return send(
```

with:

```js
      if (kind === "follows") return send({ type: "snapshot", data: followsOf(this.db, arg) });
      if (kind === "wallet") return send(
```

- [ ] **Step 5: Run the tests.**

Run: `cd engine && node --test test/live.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 26, `# fail 0`.

- [ ] **Step 6: Commit.**

```bash
git add engine/server/feed.js engine/server/hub.js engine/test/live.test.js && git commit -m "engine: the feed hands its listeners each presale it reads and each launched row it pushes; follows:<wallet> topic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/feed.js engine/server/hub.js engine/test/live.test.js
```

---

### Task 6: The notifier

`Notifier` (`engine/server/alerts.js`) listens to the feed's `"presale"` and `"pool"`.
- It works out each change's alerts, and keeps a key per alert so each goes once.
- It lists each alert for the wallet, and pushes it to that wallet's phones with the kind on.
- It gathers follow alerts for one presale over 10 s, so they go as one push.
- A market-cap line goes to Expo as one send for every wallet that has it on; `push.js` splits that send into requests of 100 (Expo's limit, "an array of up to 100 message objects", per the sending docs cited in `push.js`). The hourly limit stays per phone.
- It serves the six device routes.
- The tests use the real SQLite store and a fake sender.

**Files:**
- Create: `engine/server/alerts.js`
- Test: `engine/test/alerts.test.js`

- [ ] **Step 1: Write the failing test.** Create `engine/test/alerts.test.js`:

```js
// Push alerts (server/alerts.js): the routes, who hears what, once, and Auto-join's wait,
// over an in-memory Store, a stand-in feed and a push that keeps what it was handed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Keypair } from "@solana/web3.js";
import { numbers } from "../src/consts.js";
import { DEFAULT_KINDS } from "../src/alertkinds.js";
import { Store } from "../server/store.js";
import { makeSessions } from "../server/social.js";
import { FRESH_MS } from "../server/alertrules.js";
import { makeFollowRoutes } from "../server/follows.js";
import { MAX_DEVICES, Notifier } from "../server/alerts.js";

const NOW = 1_800_000_000_000;
const S = NOW / 1000;
const N = numbers(false); // mainnet: a 0.5 SOL pool
const wallet = () => Keypair.generate().publicKey.toBase58();
const phone = (n) => `ExponentPushToken[phone${n}]`;
const seat = (user, commit, creator = false) => ({ user, commit: String(commit), deposit: String(commit), creator });

function rig({ quietMax = 20, groupMs = 60_000 } = {}) {
  let t = NOW;
  const store = new Store(":memory:");
  const feed = new EventEmitter();
  feed.sol = { usd: 150, at: NOW };
  const sent = [];
  const batches = []; // how many messages each push.send call carried
  const push = { send: async (m) => (batches.push(m.length), sent.push(...m), m.length), stop() {} };
  const logs = [];
  const n = new Notifier({ db: store.db, feed, push, N, now: () => t, log: (m) => logs.push(m), quietMax, groupMs }).start();
  const routes = n.routes();
  const call = (path, body, ip = "1.1.1.1") => routes.find((r) => r.path.test(path)).handler({ body, ip });
  const sessions = makeSessions(store.db, () => t);
  /** A wallet with a phone signed up: { w, push, key }. */
  async function signedUp(i, kinds) {
    const w = wallet();
    const { json } = await call("/api/device", { token: sessions.issue(w).token, push: phone(i), ...(kinds && { kinds }) });
    return { w, push: phone(i), key: json.key };
  }
  const view = (creator, over = {}) => ({
    presale: "P1", where: "er", state: "OPEN", creator, openedTs: S - 60, deadlineTs: S + 3_000, fullTs: 0, raised: "100000000",
    token: { symbol: "MOON", creator }, launch: null, seats: [seat(creator, 100_000_000n, true)], ...over,
  });
  const [followRoute] = makeFollowRoutes({ store, now: () => t, limits: { followPerIp: [1e9, 1], followPerWallet: [1e9, 1] } });
  const follow = (follower, followee) => followRoute.handler({ body: { token: sessions.issue(follower).token, wallet: followee }, ip: "f" });
  return {
    store, feed, n, sent, batches, logs, call, sessions, signedUp, view, follow,
    tick: (ms) => (t += ms),
    async settle() {
      n.flushFollows();
      await n.idle();
    },
    titles: () => sent.splice(0).map((m) => `${m.to.slice(18, -1)} ${m.title}`),
  };
}

test("/api/device: a signed-in wallet's phone, its key, its switches; the routes check the key", async () => {
  const r = rig();
  const w = wallet();
  const token = r.sessions.issue(w).token;
  await assert.rejects(r.call("/api/device", { push: phone(1) }), { status: 401 });
  await assert.rejects(r.call("/api/device", { token, push: "fcm:abc" }), { status: 400, message: "push must be an Expo push token" });
  const a = (await r.call("/api/device", { token, push: phone(1) })).json;
  assert.deepEqual([a.wallet, a.kinds, typeof a.key], [w, DEFAULT_KINDS, "string"]);
  const me = { push: phone(1), key: a.key };

  assert.deepEqual((await r.call("/api/device/kinds", { ...me, kinds: ["mcap", "nope", "filled", "mcap"] })).json, { wallet: w, kinds: ["filled", "mcap"] });
  await assert.rejects(r.call("/api/device/kinds", { ...me, kinds: "all" }), { status: 400 });
  // signing up again keeps the switches; sending kinds sets them
  assert.deepEqual((await r.call("/api/device", { token, push: phone(1) })).json.kinds, ["filled", "mcap"]);
  assert.deepEqual((await r.call("/api/alerts", me)).json, { wallet: w, kinds: ["filled", "mcap"], alerts: [], waiting: null });

  await assert.rejects(r.call("/api/alerts", { ...me, key: "x" }), { status: 404, message: "this phone isn't signed up for alerts" });
  await assert.rejects(r.call("/api/alerts", { push: phone(9), key: a.key }), { status: 404 });

  // another wallet signs in on this phone: it's theirs now, and the old key is no good
  const other = wallet();
  const b = (await r.call("/api/device", { token: r.sessions.issue(other).token, push: phone(1) })).json;
  assert.deepEqual([b.wallet, b.kinds], [other, DEFAULT_KINDS]);
  await assert.rejects(r.call("/api/alerts", me), { status: 404 });

  assert.deepEqual((await r.call("/api/device/remove", { push: phone(1), key: b.key })).json, { ok: true });
  await assert.rejects(r.call("/api/alerts", { push: phone(1), key: b.key }), { status: 404 });
});

test("at most MAX_DEVICES phones a wallet: the one updated longest ago goes", async () => {
  const r = rig();
  const w = wallet();
  const token = r.sessions.issue(w).token;
  const keys = [];
  for (let i = 0; i <= MAX_DEVICES; i++) {
    keys.push((await r.call("/api/device", { token, push: phone(i) })).json.key);
    r.tick(1);
  }
  await assert.rejects(r.call("/api/alerts", { push: phone(0), key: keys[0] }), { status: 404 });
  assert.equal((await r.call("/api/alerts", { push: phone(MAX_DEVICES), key: keys[MAX_DEVICES] })).json.wallet, w);
});

test("your presales: filled and launched to everyone in, joined to the creator, arrived to its wallet; each once", async () => {
  const r = rig();
  const c = await r.signedUp(1);
  const a = await r.signedUp(2);
  const nobody = wallet(); // no phone: nothing kept or sent
  r.feed.emit("presale", r.view(c.w)); // a fresh open: the baseline
  r.feed.emit("presale", r.view(c.w, { seats: [seat(c.w, 100_000_000n, true), seat(a.w, 250_000_000n), seat(nobody, 150_000_000n)] }));
  await r.settle();
  assert.deepEqual(r.titles(), [`phone1 ${a.w.slice(0, 4)}…${a.w.slice(-4)} joined $MOON`, `phone1 ${nobody.slice(0, 4)}…${nobody.slice(-4)} joined $MOON`]);

  const full = r.view(c.w, { state: "FULL", fullTs: S - 2, raised: "500000000", seats: [seat(c.w, 100_000_000n, true), seat(a.w, 250_000_000n), seat(nobody, 150_000_000n)] });
  r.feed.emit("presale", full);
  r.feed.emit("presale", full); // seen again: not sent again
  await r.settle();
  assert.deepEqual(r.titles().sort(), ["phone1 $MOON filled", "phone2 $MOON filled"]);

  const settled = { ...full, state: "SETTLED", launch: { sig: "L", at: NOW - 1_000 } };
  r.feed.emit("presale", settled);
  r.feed.emit("presale", { ...settled, seats: [seat(c.w, 100_000_000n, true), seat(nobody, 150_000_000n)] }); // a's seat closed: delivered
  await r.settle();
  assert.deepEqual(r.titles().sort(), ["phone1 $MOON launched", "phone2 $MOON launched", "phone2 Your $MOON arrived"]);
  assert.deepEqual(r.sent, []);

  const list = (await r.call("/api/alerts", { push: a.push, key: a.key })).json.alerts;
  assert.deepEqual(list.map((x) => [x.kind, x.url]), [["arrived", "/coin/P1"], ["launched", "/coin/P1"], ["filled", "/presale/P1"]]);
  assert.equal(r.store.db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE wallet = ?").get(nobody).n, 0);
});

test("a kind switched off is neither sent nor listed; a restart doesn't send what was seen", async () => {
  const r = rig();
  const c = await r.signedUp(1, ["filled"]);
  const a = wallet();
  r.feed.emit("presale", r.view(c.w));
  r.feed.emit("presale", r.view(c.w, { seats: [seat(c.w, 100_000_000n, true), seat(a, 100_000_000n)] }));
  await r.settle();
  assert.deepEqual(r.titles(), []);

  // the server restarts: who's in comes from the db, so nothing reads as new
  r.n.stop();
  const sent = [];
  const again = new Notifier({ db: r.store.db, feed: r.feed, push: { send: async (m) => (sent.push(...m), m.length) }, N, now: () => NOW, log: () => {} }).start();
  await r.call("/api/device/kinds", { push: c.push, key: c.key, kinds: ["joined"] });
  r.feed.emit("presale", r.view(c.w, { seats: [seat(c.w, 100_000_000n, true), seat(a, 100_000_000n)] }));
  again.flushFollows();
  await again.idle();
  assert.deepEqual(sent, []);
  again.stop();
});

test("people you follow: one push per presale for those who joined in the window; each once", async () => {
  const r = rig();
  const f = await r.signedUp(1);
  const c = wallet();
  const [a, b, d] = [wallet(), wallet(), wallet()];
  for (const x of [a, b, d, c]) await r.follow(f.w, x);
  r.feed.emit("presale", r.view(c)); // c, followed, opens it
  r.feed.emit("presale", r.view(c, { seats: [seat(c, 1n, true), seat(a, 1n), seat(b, 1n)] }));
  await r.settle();
  assert.deepEqual(r.titles(), ["phone1 3 people you follow are in $MOON"]);
  const [one] = (await r.call("/api/alerts", { push: f.push, key: f.key })).json.alerts;
  assert.deepEqual([one.kind, one.body, one.url], ["follow", "Tap to see who's in.", "/presale/P1"]);

  // d joins later: d alone; a leaving and coming back isn't news again
  r.feed.emit("presale", r.view(c, { seats: [seat(c, 1n, true), seat(b, 1n)] }));
  r.feed.emit("presale", r.view(c, { seats: [seat(c, 1n, true), seat(a, 1n), seat(b, 1n), seat(d, 1n)] }));
  await r.settle();
  assert.deepEqual(r.titles(), [`phone1 ${d.slice(0, 4)}…${d.slice(-4)} joined $MOON`]);

  // the creator follows a joiner: they hear "joined", not a follow alert too
  const r2 = rig();
  const creator = await r2.signedUp(1);
  const x = wallet();
  await r2.follow(creator.w, x);
  r2.feed.emit("presale", r2.view(creator.w));
  r2.feed.emit("presale", r2.view(creator.w, { seats: [seat(creator.w, 1n, true), seat(x, 5n)] }));
  await r2.settle();
  assert.deepEqual(r2.titles(), [`phone1 ${x.slice(0, 4)}…${x.slice(-4)} joined $MOON`]);
  assert.equal(r2.store.db.prepare("SELECT kind FROM alerts").get().kind, "joined");
});

test("a followed wallet opening a presale: '<wallet> opened $X'", async () => {
  const r = rig();
  const f = await r.signedUp(1);
  const c = wallet();
  await r.follow(f.w, c);
  r.feed.emit("presale", r.view(c));
  await r.settle();
  assert.deepEqual(r.titles(), [`phone1 ${c.slice(0, 4)}…${c.slice(-4)} opened $MOON`]);
});

test("quiet: past quietMax an hour a phone's alerts are listed, not pushed", async () => {
  const r = rig({ quietMax: 2 });
  const c = await r.signedUp(1, ["joined"]);
  r.feed.emit("presale", r.view(c.w));
  r.feed.emit("presale", r.view(c.w, { seats: [seat(c.w, 1n, true), ...[1, 2, 3].map(() => seat(wallet(), 1n))] }));
  await r.settle();
  assert.equal(r.titles().length, 2);
  assert.equal((await r.call("/api/alerts", { push: c.push, key: c.key })).json.alerts.length, 3);
  r.tick(3_600_000);
  r.feed.emit("presale", r.view(c.w, { seats: [seat(c.w, 1n, true), seat(wallet(), 1n)] }));
  await r.settle();
  assert.equal(r.titles().length, 1, "an hour later, pushes again");
});

test("big market caps: each milestone once per coin, to every phone with it on, in one send; an old coin's past isn't news", async () => {
  const r = rig();
  const on = await r.signedUp(1);
  await r.signedUp(2, ["filled"]); // mcap off
  // SOL at $150: a market cap of `usd` is a price of usd / 150 / 1e9 SOL per token
  const sqrtFor = (usd) => String(BigInt(Math.round(Math.sqrt((usd / 150 / 1e9) * 1e9 / 1e6) * 2 ** 64)));
  const row = (usd, launchAt) => ({ presale: "P1", mint: "M1", token: { symbol: "MOON" }, launch: { sig: "L", at: launchAt }, pool: { sqrtPrice: sqrtFor(usd) } });

  const old = NOW - FRESH_MS - 1;
  r.feed.emit("pool", row(700_000, old)); // first seen, long after its launch: noted, not sent
  await r.settle();
  assert.deepEqual(r.titles(), []);
  r.feed.emit("pool", row(1_200_000, old));
  r.feed.emit("pool", row(1_300_000, old));
  r.feed.emit("pool", row(900_000, old));
  r.feed.emit("pool", row(1_100_000, old)); // back over $1M: not again
  await r.settle();
  assert.deepEqual(r.titles(), ["phone1 $MOON passed $1M market cap"]);
  assert.equal((await r.call("/api/alerts", { push: on.push, key: on.key })).json.alerts[0].body, "It's at $1.2M now.");

  // migrated to DAMM v2: the feed's row carries that pool's price now (feed.js), and the
  // coin's milestones go on from where they were, none twice
  const moved = (usd) => ({ ...row(usd, old), pool: { sqrtPrice: sqrtFor(usd), migrated: true, damm: "D1" } });
  r.feed.emit("pool", moved(1_150_000));
  r.feed.emit("pool", moved(5_500_000));
  r.feed.emit("pool", moved(4_000_000));
  r.feed.emit("pool", moved(5_200_000));
  await r.settle();
  assert.deepEqual(r.titles(), ["phone1 $MOON passed $5M market cap"]);

  // a fresh launch already past two milestones: one push, the highest
  r.feed.emit("pool", { ...row(600_000, NOW - 5_000), mint: "M2", presale: "P2" });
  await r.settle();
  assert.deepEqual(r.titles(), ["phone1 $MOON passed $500K market cap"]);

  // many wallets, one line: one send for all of them (push.js splits it 100 a request)
  await r.signedUp(3);
  await r.signedUp(4);
  r.batches.length = 0;
  r.feed.emit("pool", { ...row(150_000, NOW - 5_000), mint: "M4", presale: "P4" });
  await r.settle();
  assert.deepEqual(r.titles().sort(), ["phone1 $MOON passed $100K market cap", "phone3 $MOON passed $100K market cap", "phone4 $MOON passed $100K market cap"]);
  assert.deepEqual(r.batches, [3]);

  // no SOL price: nothing (and nothing noted)
  r.feed.sol = null;
  r.feed.emit("pool", { ...row(20_000_000, NOW), mint: "M3" });
  await r.settle();
  assert.deepEqual(r.titles(), []);
  assert.equal(r.store.db.prepare("SELECT COUNT(*) AS n FROM milestones WHERE mint = 'M3'").get().n, 0);
});

test("Auto-join: the waiting phone hears of room once, with the amount in the link; joining anywhere ends the wait", async () => {
  const r = rig();
  const me = await r.signedUp(1, []); // every switch off: room still comes
  const auth = { push: me.push, key: me.key };
  await assert.rejects(r.call("/api/autojoin", { ...auth, amount: "500000000" }), { status: 400, message: "pick one of the amounts shown" });
  await assert.rejects(r.call("/api/autojoin", { ...auth, amount: 250_000_000 }), { status: 400 });
  assert.deepEqual((await r.call("/api/autojoin", { ...auth, amount: "250000000" })).json, { waiting: { amount: "250000000", at: NOW } });

  const c = wallet();
  r.feed.emit("presale", r.view(c, { raised: "300000000", seats: [seat(c, 300_000_000n, true)] })); // 0.2 SOL of room
  r.feed.emit("presale", r.view(c, { presale: "P2", token: null, raised: "100000000" })); // no coin yet
  r.feed.emit("presale", r.view(c, { presale: "P3", deadlineTs: S + 10 })); // too close to its end
  await r.settle();
  assert.deepEqual(r.sent, []);
  r.feed.emit("presale", r.view(c, { presale: "P4" }));
  r.feed.emit("presale", r.view(c, { presale: "P5" })); // once: the wait is over
  await r.settle();
  assert.deepEqual(r.sent.map((m) => [m.to, m.title, m.body, m.data.url, m.ttl]), [[me.push, "$MOON has room", "There's room for your 0.25 SOL. Tap to join.", "/presale/P4?join=250000000", 600]]);
  r.sent.length = 0;
  const after = (await r.call("/api/alerts", auth)).json;
  assert.deepEqual([after.waiting, after.alerts[0].kind], [null, "room"]);

  // waiting again, then joining a presale by hand: the wait ends
  await r.call("/api/autojoin", { ...auth, amount: "100000000" });
  r.feed.emit("presale", r.view(c, { presale: "P6", raised: "500000000", state: "FULL", seats: [seat(c, 1n, true)] }));
  r.feed.emit("presale", r.view(c, { presale: "P6", raised: "500000000", state: "FULL", seats: [seat(c, 1n, true), seat(me.w, 1n)] }));
  assert.equal((await r.call("/api/alerts", auth)).json.waiting, null);
  await r.call("/api/autojoin", { ...auth, amount: "100000000" });
  assert.deepEqual((await r.call("/api/autojoin/stop", auth)).json, { waiting: null });
});

test("a phone Expo calls gone is forgotten; a listener that throws is logged", async () => {
  const r = rig();
  const me = await r.signedUp(1);
  r.n.push.onDead(me.push);
  await assert.rejects(r.call("/api/alerts", { push: me.push, key: me.key }), { status: 404 });
  r.feed.emit("presale", { presale: "P1", state: "OPEN", seats: "not a list" });
  assert.match(r.logs.join("\n"), /^presale: /m);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test test/alerts.test.js`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `engine/server/alerts.js`.

- [ ] **Step 3: Write the notifier.** Create `engine/server/alerts.js`:

```js
// Push alerts (the phone app's piece 5): who hears what, and when. The live feed reads every
// presale that changes and every launched pool that trades (feed.js "presale" and "pool");
// alertrules.js says what changed; this file picks who gets it, keeps each wallet's last
// MAX_ALERTS in SQLite (the Alerts screen), and sends them to the phones that have that kind
// on, through Expo (push.js).
//
//   POST /api/device          { token, push, kinds? }   -> { wallet, kinds, key }
//   POST /api/device/kinds    { push, key, kinds }      -> { wallet, kinds }
//   POST /api/device/remove   { push, key }             -> { ok: true }
//   POST /api/alerts          { push, key }             -> { wallet, kinds, alerts, waiting }
//   POST /api/autojoin        { push, key, amount }     -> { waiting: { amount, at } }
//   POST /api/autojoin/stop   { push, key }             -> { waiting: null }
//
// `token` is a Mooner sign-in (social.js /api/login); /api/device ties the phone's Expo push
// token (`push`) to that wallet and answers a `key` (an HMAC of the pair under the server's
// device key, social.js makeSessions) that the phone keeps and sends with the rest, so
// reading alerts doesn't need a fresh sign-in.
//
// Who gets what:
//   filled, launched      everyone in the presale
//   arrived               the wallet whose tokens arrived
//   joined                the presale's creator, when someone else puts SOL in
//   follow                the followers of a wallet that joined or opened a presale: one
//                         push per followed wallet per presale, grouped over `groupMs`
//   mcap                  every phone with it on, once per coin per milestone, ever
//   room                  the phone waiting with Auto-join, once, then it stops waiting
// Each (kind, presale, subject, wallet) is sent once (alert_keys). A phone gets at most
// `quietMax` pushes an hour (room excepted); past that they're only listed. The numbers are
// ALERT_NUMBERS in alertrules.js.

import { autoChoices, hasRoomFor } from "../src/autojoin.js";
import { DEFAULT_KINDS, cleanKinds } from "../src/alertkinds.js";
import { ALERT_NUMBERS, alertText, launchFresh, mcapUsd, milestonesPassed, presaleEvents } from "./alertrules.js";
import { followersOf } from "./follows.js";
import { HttpError, Limiter, limit, toJson } from "./http.js";
import { PUSH_TOKEN } from "./push.js";
import { makeSessions } from "./social.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  token      TEXT PRIMARY KEY,
  wallet     TEXT NOT NULL,
  kinds      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_wallet ON devices (wallet);
CREATE TABLE IF NOT EXISTS alerts (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  kind   TEXT NOT NULL,
  title  TEXT NOT NULL,
  body   TEXT NOT NULL,
  url    TEXT NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_wallet ON alerts (wallet, id);
CREATE TABLE IF NOT EXISTS alert_keys (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS presale_seen (presale TEXT PRIMARY KEY, ins TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS milestones (
  mint TEXT NOT NULL,
  usd  INTEGER NOT NULL,
  at   INTEGER NOT NULL,
  PRIMARY KEY (mint, usd)
);
CREATE TABLE IF NOT EXISTS waits (push TEXT PRIMARY KEY, wallet TEXT NOT NULL, amount TEXT NOT NULL, at INTEGER NOT NULL);`;

/** Alerts kept per wallet, and phones per wallet (ALERT_NUMBERS in alertrules.js). */
export const { maxAlerts: MAX_ALERTS, maxDevices: MAX_DEVICES } = ALERT_NUMBERS;
/** How long a sent alert's key and a presale's last who's-in are kept. */
export const KEEP_MS = 7 * 24 * 3_600_000;
const TTL_S = { room: 600, other: 86_400 };

export const ALERT_LIMITS = {
  devicePerIp: [30, 600_000],
  alertsPerIp: [600, 600_000],
};

export class Notifier {
  /**
   * `db`: the server's SQLite. `feed`: the live feed (its "presale" and "pool" events, and
   * `feed.sol` for SOL/USD). `push`: an ExpoPush (its onDead is set here). `N`: the
   * program's numbers (consts.js numbers), for Auto-join's amounts and room. `groupMs`: how
   * long follow alerts for one presale gather before they go as one. `quietMax`: pushes a
   * phone gets an hour. Both default to ALERT_NUMBERS; the tests pass their own.
   */
  constructor({ db, feed, push, N, now = Date.now, log = console.log, groupMs = ALERT_NUMBERS.groupMs, quietMax = ALERT_NUMBERS.quietMax, limits = ALERT_LIMITS }) {
    Object.assign(this, { db, feed, push, N, now, log, groupMs });
    db.exec(SCHEMA);
    this.sessions = makeSessions(db, now);
    this.quiet = new Limiter(quietMax, 3_600_000, now);
    this.L = Object.fromEntries(Object.entries(limits).map(([k, [max, ms]]) => [k, new Limiter(max, ms, now)]));
    this.groups = new Map(); // `${wallet} ${presale}` -> { wallet, presale, ticker, users: Set, opened, timer }
    this.sending = new Set();
    push.onDead = (token) => this.dead(token);
    this.onPresale = (v) => this.guard("presale", () => this.presale(JSON.parse(toJson(v))));
    this.onPool = (row) => row && this.guard("pool", () => this.pool(JSON.parse(toJson(row))));
  }

  start() {
    this.feed.on("presale", this.onPresale);
    this.feed.on("pool", this.onPool);
    this.prune();
    this.pruner = setInterval(() => this.guard("prune", () => this.prune()), 3_600_000);
    this.pruner.unref?.();
    return this;
  }

  stop() {
    this.feed.off("presale", this.onPresale);
    this.feed.off("pool", this.onPool);
    clearInterval(this.pruner);
    for (const g of this.groups.values()) clearTimeout(g.timer);
    this.groups.clear();
    this.push.stop?.();
  }

  guard(what, fn) {
    try {
      fn();
    } catch (e) {
      this.log(`${what}: ${e?.message ?? e}`);
    }
  }

  /** Waits for every push already handed to Expo (tests, and a clean stop). */
  async idle() {
    while (this.sending.size) await Promise.all([...this.sending]);
  }

  prune() {
    const old = this.now() - KEEP_MS;
    this.db.prepare("DELETE FROM alert_keys WHERE at < ?").run(old);
    this.db.prepare("DELETE FROM presale_seen WHERE at < ?").run(old);
  }

  // ---- presales ----

  /** A presale as the feed just read it (wire form). */
  presale(view) {
    const db = this.db;
    const nowMs = this.now();
    const row = db.prepare("SELECT ins FROM presale_seen WHERE presale = ?").get(view.presale);
    const prev = row ? { ins: JSON.parse(row.ins) } : null;
    const { ins, events } = presaleEvents(prev, view, nowMs);
    if (view.where === "closed") db.prepare("DELETE FROM presale_seen WHERE presale = ?").run(view.presale);
    else if (!view.stale) db.prepare("INSERT OR REPLACE INTO presale_seen (presale, ins, at) VALUES (?, ?, ?)").run(view.presale, JSON.stringify(ins), nowMs);

    for (const e of events) {
      if (e.kind === "filled" || e.kind === "launched") for (const w of e.to) this.alert(w, e.kind, e, `${e.kind}:${e.presale}:${w}`);
      if (e.kind === "arrived") this.alert(e.user, "arrived", e, `arrived:${e.presale}:${e.user}`);
      if (e.kind === "join") {
        if (e.creator && e.creator !== e.user) this.alert(e.creator, "joined", e, `joined:${e.presale}:${e.user}:${e.creator}`);
        db.prepare("DELETE FROM waits WHERE wallet = ?").run(e.user); // they're in one: Auto-join is done
      }
      if (e.kind === "join" || e.kind === "opened") this.followed(e, view);
    }
    if (view.state === "OPEN" && !view.stale && view.token) this.room(view, nowMs);
  }

  /** A followed wallet joined or opened `e.presale`: each follower's group for it gathers. */
  followed(e, view) {
    const creator = view.creator ?? view.token?.creator ?? null;
    for (const w of followersOf(this.db, e.user)) {
      if (w === creator) continue; // the creator hears "joined"
      if (!this.wants(w, "follow")) continue;
      const k = `${w} ${e.presale}`;
      let g = this.groups.get(k);
      if (!g) {
        g = { wallet: w, presale: e.presale, ticker: e.ticker, users: new Set(), opened: null, timer: null };
        this.groups.set(k, g);
        g.timer = setTimeout(() => this.guard("follow", () => this.flushGroup(k)), this.groupMs);
        g.timer.unref?.();
      }
      g.users.add(e.user);
      if (e.kind === "opened") g.opened = e.user;
    }
  }

  /** Sends follow groups now (all of them, or one). */
  flushFollows() {
    for (const k of [...this.groups.keys()]) this.flushGroup(k);
  }

  flushGroup(k) {
    const g = this.groups.get(k);
    if (!g) return;
    clearTimeout(g.timer);
    this.groups.delete(k);
    const fresh = [...g.users].filter((u) => this.claim(`follow:${g.presale}:${u}:${g.wallet}`));
    if (!fresh.length) return;
    const e = { presale: g.presale, ticker: g.ticker, users: fresh, opened: fresh.includes(g.opened) ? g.opened : null };
    this.alert(g.wallet, "follow", e, null);
  }

  /** Auto-join: each phone waiting for room that `view` has room for hears it, once. */
  room(view, nowMs) {
    for (const w of this.db.prepare("SELECT push, wallet, amount FROM waits ORDER BY at").all()) {
      if (!hasRoomFor(view, this.N, w.amount, w.wallet, nowMs)) continue;
      this.db.prepare("DELETE FROM waits WHERE push = ?").run(w.push);
      const e = { presale: view.presale, ticker: view.token?.symbol ? `$${view.token.symbol}` : "a new coin", amount: w.amount };
      this.alert(w.wallet, "room", e, null, [w.push]);
    }
  }

  // ---- market caps ----

  /** A launched coin's row as the feed just pushed it (wire form). */
  pool(row) {
    const usd = mcapUsd(row, this.feed.sol?.usd);
    if (usd == null) return;
    const db = this.db;
    const had = db.prepare("SELECT usd FROM milestones WHERE mint = ?").all(row.mint).map((r) => r.usd);
    const seeded = had.length > 0; // usd 0: the coin was seen
    const passed = milestonesPassed(had, usd);
    const add = db.prepare("INSERT OR IGNORE INTO milestones (mint, usd, at) VALUES (?, ?, ?)");
    if (!seeded) add.run(row.mint, 0, this.now());
    if (!passed.length) return;
    for (const m of passed) add.run(row.mint, m, this.now());
    // a coin first seen long after its launch: what it passed before isn't news
    if (!seeded && !launchFresh(row, this.now())) return;
    const e = { presale: row.presale, ticker: row.token?.symbol ? `$${row.token.symbol}` : "a new coin", usd: passed.at(-1), now: usd };
    const wallets = db.prepare("SELECT DISTINCT wallet FROM devices").all().map((r) => r.wallet);
    // every wallet's phones in one send: push.js splits it into Expo's 100 a request
    this.deliver(wallets.flatMap((w) => this.record(w, "mcap", e, null)));
  }

  // ---- sending ----

  /** Takes `key` if it wasn't taken: true the first time only. */
  claim(key) {
    return this.db.prepare("INSERT OR IGNORE INTO alert_keys (key, at) VALUES (?, ?)").run(key, this.now()).changes === 1;
  }

  /** Whether any of `wallet`'s phones has `kind` on. */
  wants(wallet, kind) {
    return this.devicesOf(wallet).some((d) => d.kinds.includes(kind));
  }

  devicesOf(wallet) {
    return this.db.prepare("SELECT token, kinds FROM devices WHERE wallet = ?").all(wallet).map((d) => ({ token: d.token, kinds: JSON.parse(d.kinds) }));
  }

  /** One alert to `wallet`: listed and pushed to its phones with `kind` on (or to `only`). */
  alert(wallet, kind, e, key, only = null) {
    this.deliver(this.record(wallet, kind, e, key, only));
  }

  /** Lists one alert for `wallet` and returns its messages: one for each of its phones with
   *  `kind` on (or in `only`) that is under the hourly limit ("room" always is). `key`: sent
   *  once ever (null: the caller made sure). Nothing for a wallet with no such phone. */
  record(wallet, kind, e, key, only = null) {
    const phones = this.devicesOf(wallet).filter((d) => (only ? only.includes(d.token) : d.kinds.includes(kind)));
    if (!phones.length) return [];
    if (key && !this.claim(key)) return [];
    const { title, body, url } = alertText(kind, e);
    const at = this.now();
    const db = this.db;
    db.prepare("INSERT INTO alerts (wallet, kind, title, body, url, at) VALUES (?, ?, ?, ?, ?, ?)").run(wallet, kind, title, body, url, at);
    db.prepare("DELETE FROM alerts WHERE wallet = ? AND id NOT IN (SELECT id FROM alerts WHERE wallet = ? ORDER BY id DESC LIMIT ?)").run(wallet, wallet, MAX_ALERTS);
    return phones
      .filter((d) => kind === "room" || this.quiet.take(d.token))
      .map((d) => ({ to: d.token, title, body, data: { url }, sound: "default", priority: "high", channelId: "default", ttl: kind === "room" ? TTL_S.room : TTL_S.other }));
  }

  /** Hands `messages` to Expo in one send (push.js makes it 100 a request). */
  deliver(messages) {
    if (!messages.length) return;
    const p = this.push.send(messages).finally(() => this.sending.delete(p));
    this.sending.add(p);
  }

  /** A push token Expo says is gone: forget the phone. */
  dead(token) {
    this.db.prepare("DELETE FROM devices WHERE token = ?").run(token);
    this.db.prepare("DELETE FROM waits WHERE push = ?").run(token);
  }

  // ---- routes ----

  /** The phone a request comes from: { token, wallet, kinds }. 404 unless `push` is a phone
   *  signed up here and `key` is the one /api/device gave it. */
  device(body) {
    const push = body?.push;
    const row = typeof push === "string" && PUSH_TOKEN.test(push) ? this.db.prepare("SELECT token, wallet, kinds FROM devices WHERE token = ?").get(push) : null;
    if (!row || !this.sessions.deviceCheck(`device:${row.wallet}:${push}`, body.key)) throw new HttpError(404, "this phone isn't signed up for alerts");
    return { token: row.token, wallet: row.wallet, kinds: JSON.parse(row.kinds) };
  }

  waitingOf(push) {
    const w = this.db.prepare("SELECT amount, at FROM waits WHERE push = ?").get(push);
    return w ? { amount: w.amount, at: w.at } : null;
  }

  routes() {
    const db = this.db;
    const L = this.L;
    const signUp = async ({ body, ip }) => {
      limit(L.devicePerIp, ip, "sign-ups for alerts");
      const wallet = this.sessions.walletOf(body.token);
      const push = body.push;
      if (typeof push !== "string" || !PUSH_TOKEN.test(push)) throw new HttpError(400, "push must be an Expo push token");
      const had = db.prepare("SELECT wallet, kinds FROM devices WHERE token = ?").get(push);
      const kinds = cleanKinds(body.kinds) ?? (had?.wallet === wallet ? JSON.parse(had.kinds) : DEFAULT_KINDS);
      if (had && had.wallet !== wallet) db.prepare("DELETE FROM waits WHERE push = ?").run(push); // another wallet's wait
      db.prepare("INSERT OR REPLACE INTO devices (token, wallet, kinds, updated_at) VALUES (?, ?, ?, ?)").run(push, wallet, JSON.stringify(kinds), this.now());
      const extra = db.prepare("SELECT token FROM devices WHERE wallet = ? ORDER BY updated_at DESC, token LIMIT -1 OFFSET ?").all(wallet, MAX_DEVICES);
      for (const d of extra) this.dead(d.token);
      return { json: { wallet, kinds, key: this.sessions.deviceSign(`device:${wallet}:${push}`) } };
    };
    const withDevice = (fn) => async ({ body, ip }) => {
      limit(L.alertsPerIp, ip, "requests");
      return { json: fn(this.device(body), body) };
    };
    const setKinds = withDevice((d, body) => {
      const kinds = cleanKinds(body.kinds);
      if (!kinds) throw new HttpError(400, "kinds must be a list");
      db.prepare("UPDATE devices SET kinds = ?, updated_at = ? WHERE token = ?").run(JSON.stringify(kinds), this.now(), d.token);
      return { wallet: d.wallet, kinds };
    });
    const remove = withDevice((d) => {
      this.dead(d.token);
      return { ok: true };
    });
    const list = withDevice((d) => ({
      wallet: d.wallet,
      kinds: d.kinds,
      alerts: db.prepare("SELECT id, kind, title, body, url, at FROM alerts WHERE wallet = ? ORDER BY id DESC LIMIT ?").all(d.wallet, MAX_ALERTS),
      waiting: this.waitingOf(d.token),
    }));
    const wait = withDevice((d, body) => {
      const amount = typeof body.amount === "string" && /^\d{1,16}$/.test(body.amount) ? BigInt(body.amount) : null;
      if (amount === null || !autoChoices(this.N).includes(amount)) throw new HttpError(400, "pick one of the amounts shown");
      db.prepare("INSERT OR REPLACE INTO waits (push, wallet, amount, at) VALUES (?, ?, ?, ?)").run(d.token, d.wallet, String(amount), this.now());
      return { waiting: this.waitingOf(d.token) };
    });
    const stopWaiting = withDevice((d) => {
      db.prepare("DELETE FROM waits WHERE push = ?").run(d.token);
      return { waiting: null };
    });
    const r = (path, handler) => ({ method: "POST", path, body: 2_048, handler });
    return [
      r(/^\/api\/device$/, signUp),
      r(/^\/api\/device\/kinds$/, setKinds),
      r(/^\/api\/device\/remove$/, remove),
      r(/^\/api\/alerts$/, list),
      r(/^\/api\/autojoin$/, wait),
      r(/^\/api\/autojoin\/stop$/, stopWaiting),
    ];
  }
}
```

- [ ] **Step 4: Run the tests.**

Run: `cd engine && node --test test/alerts.test.js`
Expected: `# pass 10`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 36, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add engine/server/alerts.js engine/test/alerts.test.js && git commit -m "engine: the push notifier: who hears each presale change and market-cap line, once each, follows grouped per presale, at most 20 pushes an hour a phone; device, alerts and Auto-join routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/alerts.js engine/test/alerts.test.js
```

---

### Task 7: The server runs it; the API client calls it

The changes:
- `config.js` reads `MOONER_EXPO_TOKEN`, which is optional.
- `main.js` starts the notifier with an `ExpoPush`, adds the follow and device routes to the routes chain, and stops the notifier first on shutdown.
- `engine/src/apiclient.js` (the phone's and the web's client) gains the eight calls.

**Files:**
- Modify: `engine/server/config.js`, `engine/server/main.js`, `engine/src/apiclient.js`
- Test: `engine/test/server.test.js`, `engine/test/apiclient.test.js`

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- engine/server/config.js engine/server/main.js engine/src/apiclient.js engine/test/server.test.js engine/test/apiclient.test.js && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the failing tests.**

Apply this block to `engine/test/server.test.js`.

Replace:

```js
    assert.equal(loadConfig({ MOONER_DIR: dir }).openerWallets, null);
```

with:

```js
    assert.equal(loadConfig({ MOONER_DIR: dir }).openerWallets, null);
    assert.equal(loadConfig({ MOONER_DIR: dir }).expoToken, null);
    assert.equal(loadConfig({ MOONER_DIR: dir, MOONER_EXPO_TOKEN: "expo-t" }).expoToken, "expo-t");
```

Apply this block to `engine/test/apiclient.test.js`.

Add at the end of the file:

```js
test("push alerts and follows: each a POST of its JSON", async () => {
  const f = fakeFetch(Array.from({ length: 9 }, () => [200, { ok: true }]));
  const api = makeApi("https://app.mooner.family", f);
  await api.device("T", "P");
  await api.device("T", "P", ["mcap"]);
  await api.deviceKinds("P", "K", ["filled"]);
  await api.removeDevice("P", "K");
  assert.deepEqual(await api.alerts("P", "K"), { ok: true });
  await api.autojoin("P", "K", 100_000_000n);
  await api.autojoinStop("P", "K");
  await api.follow("T", "W");
  await api.unfollow("T", "W");
  assert.deepEqual(
    f.calls.map((c) => [c.url.slice("https://app.mooner.family".length), c.init.method, JSON.parse(c.init.body)]),
    [
      ["/api/device", "POST", { token: "T", push: "P" }],
      ["/api/device", "POST", { token: "T", push: "P", kinds: ["mcap"] }],
      ["/api/device/kinds", "POST", { push: "P", key: "K", kinds: ["filled"] }],
      ["/api/device/remove", "POST", { push: "P", key: "K" }],
      ["/api/alerts", "POST", { push: "P", key: "K" }],
      ["/api/autojoin", "POST", { push: "P", key: "K", amount: "100000000" }],
      ["/api/autojoin/stop", "POST", { push: "P", key: "K" }],
      ["/api/follow", "POST", { token: "T", wallet: "W" }],
      ["/api/unfollow", "POST", { token: "T", wallet: "W" }],
    ],
  );
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd engine && node --test test/server.test.js test/apiclient.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok|not a function'`
Expected: `# fail 2`:
- `push alerts and follows: each a POST of its JSON` fails with `api.device is not a function`;
- `config: the deployment record, the openers file` fails because `expoToken` is undefined, not null.

- [ ] **Step 3: Read the token.**

Apply these 2 blocks to `engine/server/config.js`, in order.

Replace:

```js
//   MOONER_IPFS_GATEWAY  prefix of the token links            (IPFS_GATEWAY)
```

with:

```js
//   MOONER_IPFS_GATEWAY  prefix of the token links            (IPFS_GATEWAY)
//   MOONER_EXPO_TOKEN    Expo access token for push alerts, once the Expo project turns on
//                        "enhanced security for push notifications" (none: sent without)
```

Replace:

```js
    pinataJwt: env.PINATA_JWT || null,
```

with:

```js
    pinataJwt: env.PINATA_JWT || null,
    expoToken: env.MOONER_EXPO_TOKEN || null,
```

- [ ] **Step 4: Add the client calls.**

Apply this block to `engine/src/apiclient.js`.

Replace:

```js
    saveProfile: async (token, pfp) => (await call("POST", "/api/profile", { token, pfp })).json,
```

with:

```js
    saveProfile: async (token, pfp) => (await call("POST", "/api/profile", { token, pfp })).json,
    // push alerts (server/alerts.js): `push` is the phone's Expo push token, `key` what
    // device() answered for it
    device: async (token, push, kinds) => (await call("POST", "/api/device", { token, push, ...(kinds && { kinds }) })).json,
    deviceKinds: async (push, key, kinds) => (await call("POST", "/api/device/kinds", { push, key, kinds })).json,
    removeDevice: async (push, key) => (await call("POST", "/api/device/remove", { push, key })).json,
    alerts: async (push, key) => (await call("POST", "/api/alerts", { push, key })).json,
    autojoin: async (push, key, amount) => (await call("POST", "/api/autojoin", { push, key, amount: String(amount) })).json,
    autojoinStop: async (push, key) => (await call("POST", "/api/autojoin/stop", { push, key })).json,
    // follows (server/follows.js)
    follow: async (token, wallet) => (await call("POST", "/api/follow", { token, wallet })).json,
    unfollow: async (token, wallet) => (await call("POST", "/api/unfollow", { token, wallet })).json,
```

- [ ] **Step 5: Start the notifier and the routes.** Piece 3 changed the end of the routes chain to add `makeAppLinkRoutes`. The third block below starts and ends inside the line `}))…`. Keep piece 3's `.concat(makeAppLinkRoutes(…))` and its `log` lines after it.

Apply these 4 blocks to `engine/server/main.js`, in order.

Replace:

```js
import { Feed } from "./feed.js";
```

with:

```js
import { Feed } from "./feed.js";
import { makeFollowRoutes } from "./follows.js";
import { Notifier } from "./alerts.js";
import { ExpoPush } from "./push.js";
import { numbers } from "../src/consts.js";
```

Replace:

```js
const keeper = new Keeper({
```

with:

```js
// push alerts: what the feed reads and pushes, sent through Expo (alerts.js, push.js)
const notifier = new Notifier({
  db: ctx.store.db, feed, N: numbers(cfg.canary), log: (m) => log(`alerts ${m}`),
  push: new ExpoPush({ accessToken: cfg.expoToken, log: (m) => log(`push ${m}`) }),
}).start();
const keeper = new Keeper({
```

Replace this text, which sits inside a line (keep the rest of that line as it is):

```js
feed.profile(wallet, pfp),
}))
```

with:

```js
feed.profile(wallet, pfp),
})).concat(makeFollowRoutes({ store: ctx.store, onFollow: (wallet) => feed.followed(wallet) })).concat(notifier.routes())
```

Replace:

```js
  await feed.stop();
  ctx.store.close();
```

with:

```js
  notifier.stop();
  await feed.stop();
  ctx.store.close();
```

- [ ] **Step 6: Run the tests.**

Run: `cd engine && node --test test/server.test.js test/apiclient.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 0`.

Run: `cd engine && node --check server/main.js && echo ok`
Expected: `ok`.

Run: `cd engine && grep -n 'concat(' server/main.js`
Expected: one line with `.concat(makeFollowRoutes(…)).concat(notifier.routes())` followed by piece 3's `.concat(makeAppLinkRoutes(…))`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 37, `# fail 0`.

- [ ] **Step 7: Commit.**

```bash
git add engine/server/config.js engine/server/main.js engine/src/apiclient.js engine/test/server.test.js engine/test/apiclient.test.js && git commit -m "engine: the server runs the notifier with Expo push and serves the follow and device routes; MOONER_EXPO_TOKEN (optional); the API client's alert and follow calls

Needs a server deploy to take effect (USER STEP E of the push alerts plan).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/config.js engine/server/main.js engine/src/apiclient.js engine/test/server.test.js engine/test/apiclient.test.js
```

---

### Task 8: The phone's alerts store

`createAlertsStore` takes:
- the app's main store;
- the socket;
- the API client;
- secure storage;
- `push`, a `{ permission, ask, token }` object that `src/alerts/push.js` gives in the app and the tests fake.

It holds this phone's sign-up (`mooner:alerts` in secure storage: `{ push, key, wallet, kinds }`), the switches, the list, Auto-join's wait, and the wallet's follows from `follows:<wallet>`.
- A 401 forgets the saved sign-in, so the next try signs again.
- At start, a push token that changed signs up again with the sign-in that secure storage keeps for the wallet. It can't use the app store's: at a cold start that store's wallet and session are still null while it reads them (`mobile/src/store.js`, `setWallet`).
- Both need the sign-in's storage name, which is why `src/store.js` exports `loginName`.
- A 404 drops the sign-up, so the screen offers "Turn on alerts" again.

**Files:**
- Create: `mobile/src/alerts/store.js`, `mobile/src/alerts/rows.js`
- Modify: `mobile/src/store.js`
- Test: `mobile/test/alerts.test.mjs`

- [ ] **Step 0: Check the file is clean.** Run `git diff --quiet HEAD -- mobile/src/store.js && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the failing test.** Create `mobile/test/alerts.test.mjs`:

```js
// Push alerts and follows on the phone (src/alerts/store.js, src/alerts/rows.js) with a fake
// app store, socket, API, secure storage and notifications.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "zustand/vanilla";
import { DEVICE_NAME, createAlertsStore } from "../src/alerts/store.js";
import { ago, safeUrl } from "../src/alerts/rows.js";
import { loginName } from "../src/store.js";
import { DEFAULT_KINDS } from "../../engine/src/alertkinds.js";

const W = "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D";
const OTHER = "C".repeat(44);
const KEY = "11111111111111111111111111111111";
const PUSH = "ExponentPushToken[phone1]";
const signer = { publicKey: { toBase58: () => W } };
const tick = () => new Promise((r) => setImmediate(r));
const refused = (status, message) => Object.assign(new Error(message), { status });

function rig({ api: apiOver = {}, push: pushOver = {}, session = null, now = 1_000_000, disk: preset = {} } = {}) {
  const calls = [];
  const subs = new Map();
  const live = {
    subscribe(topic, fn) {
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic).add(fn);
      return () => subs.get(topic).delete(fn);
    },
  };
  const send = (topic, data) => [...(subs.get(topic) ?? [])].forEach((fn) => fn({ topic, type: "snapshot", data }));
  const listening = (topic) => (subs.get(topic)?.size ?? 0) > 0;
  const disk = new Map(Object.entries(preset));
  const saved = (name) => ({
    get: async () => (disk.has(name) ? structuredClone(disk.get(name)) : undefined),
    set: async (v) => void disk.set(name, structuredClone(v)),
    clear: async () => void disk.delete(name),
  });
  // the app's store: just what alerts read (wallet, session, signIn)
  const main = createStore(() => ({
    wallet: null,
    session,
    signIn: async (s) => {
      calls.push(["signIn", s.publicKey.toBase58()]);
      const fresh = { token: "fresh", exp: now + 1_000 };
      main.setState({ session: fresh });
      return { ok: true, session: fresh };
    },
  }));
  let perm = "undetermined";
  const push = {
    permission: async () => perm,
    ask: async () => (calls.push(["ask"]), (perm = "granted")),
    token: async () => PUSH,
    ...pushOver,
  };
  const api = {
    device: async (token, p, kinds) => (calls.push(["device", token, p, kinds]), { wallet: W, kinds: DEFAULT_KINDS, key: "k1" }),
    deviceKinds: async (p, key, kinds) => (calls.push(["kinds", p, key, kinds]), { wallet: W, kinds }),
    removeDevice: async (p, key) => (calls.push(["remove", p, key]), { ok: true }),
    alerts: async (p, key) => (calls.push(["alerts", p, key]), { wallet: W, kinds: DEFAULT_KINDS, alerts: [{ id: 1, kind: "filled", title: "$MOON filled", body: "b", url: `/presale/${KEY}`, at: 5 }], waiting: null }),
    autojoin: async (p, key, amount) => (calls.push(["autojoin", p, key, String(amount)]), { waiting: { amount: String(amount), at: 7 } }),
    autojoinStop: async (p, key) => (calls.push(["stop", p, key]), { waiting: null }),
    follow: async (token, w) => (calls.push(["follow", token, w]), { wallet: W, following: [w], followers: [] }),
    unfollow: async (token, w) => (calls.push(["unfollow", token, w]), { wallet: W, following: [], followers: [] }),
    ...apiOver,
  };
  const alerts = createAlertsStore({ main, live, api, saved, push, now: () => now });
  return { alerts, main, calls, send, listening, disk, setPerm: (p) => (perm = p) };
}

test("safeUrl: only a presale (with an Auto-join amount) or a coin opens", () => {
  assert.equal(safeUrl(`/presale/${KEY}`), `/presale/${KEY}`);
  assert.equal(safeUrl(`/presale/${KEY}?join=250000000`), `/presale/${KEY}?join=250000000`);
  assert.equal(safeUrl(`/coin/${KEY}`), `/coin/${KEY}`);
  for (const bad of [undefined, 5, "", "https://evil.example", `/coin/${KEY}?join=1`, `/presale/${KEY}?join=x`, `/presale/0OIl${KEY}`, `/connect`, `/presale/${KEY}/../x`]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
});

test("ago: now, minutes, hours, days", () => {
  const t = 10_000_000_000;
  assert.equal(ago(t, t + 59_000), "now");
  assert.equal(ago(t, t + 60_000), "1m");
  assert.equal(ago(t, t + 3_599_000), "59m");
  assert.equal(ago(t, t + 7_200_000), "2h");
  assert.equal(ago(t, t + 3 * 86_400_000), "3d");
  assert.equal(ago(t + 5_000, t), "now", "a clock behind the server's");
});

test("follows: the connected wallet's lists from the socket; a new wallet switches the topic", async () => {
  const { alerts, main, send, listening } = rig();
  const stop = alerts.getState().start();
  assert.equal(listening(`follows:${W}`), false);
  main.setState({ wallet: W });
  assert.ok(listening(`follows:${W}`));
  send(`follows:${W}`, { wallet: W, following: [OTHER], followers: [KEY] });
  assert.deepEqual([alerts.getState().following, alerts.getState().followers], [[OTHER], [KEY]]);
  send(`follows:${W}`, { wallet: OTHER, following: [], followers: [] }); // not this wallet's
  assert.deepEqual(alerts.getState().following, [OTHER]);
  main.setState({ wallet: OTHER });
  assert.equal(listening(`follows:${W}`), false);
  assert.ok(listening(`follows:${OTHER}`));
  assert.deepEqual(alerts.getState().following, []);
  stop();
  assert.equal(listening(`follows:${OTHER}`), false);
});

test("turnOn: the permission first; refused, nothing is signed up", async () => {
  const { alerts, main, calls, disk } = rig({ push: { ask: async () => "blocked" } });
  main.setState({ wallet: W });
  const r = await alerts.getState().turnOn(signer);
  assert.deepEqual(r, { ok: false, permission: "blocked" });
  assert.equal(alerts.getState().permission, "blocked");
  assert.equal(alerts.getState().device, null);
  assert.equal(disk.has(DEVICE_NAME), false);
  assert.deepEqual(calls, []);
});

test("turnOn: asks, gets the token, signs in once, signs the phone up and reads its alerts", async () => {
  const { alerts, main, calls, disk } = rig();
  main.setState({ wallet: W });
  alerts.getState().start();
  await tick();
  assert.equal(alerts.getState().permission, "undetermined");
  const r = await alerts.getState().turnOn(signer);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls.map((c) => c[0]), ["ask", "signIn", "device", "alerts"]);
  assert.deepEqual(calls[2], ["device", "fresh", PUSH, undefined]);
  assert.deepEqual(disk.get(DEVICE_NAME), { push: PUSH, key: "k1", wallet: W, kinds: DEFAULT_KINDS });
  const s = alerts.getState();
  assert.equal(s.permission, "granted");
  assert.deepEqual(s.device, { push: PUSH, key: "k1", wallet: W });
  assert.equal(s.alerts.length, 1);
  assert.equal(s.loaded, true);
  assert.equal(s.busy, null);
});

test("turnOn: a saved sign-in is used; a 401 forgets it so the next try signs again", async () => {
  const { alerts, main, calls, disk } = rig({
    session: { token: "old", exp: 2_000_000 },
    disk: { [loginName(W)]: { token: "old", exp: 2_000_000 } },
    api: { device: async () => Promise.reject(refused(401, "your sign-in ran out, sign in again")) },
  });
  main.setState({ wallet: W });
  const r = await alerts.getState().turnOn(signer);
  assert.deepEqual(r, { ok: false, error: "your sign-in ran out, sign in again" });
  assert.equal(calls.some((c) => c[0] === "signIn"), false);
  assert.equal(main.getState().session, null);
  assert.equal(disk.has(loginName(W)), false);
  assert.equal(alerts.getState().error, "your sign-in ran out, sign in again");
  assert.equal(alerts.getState().busy, null);
});

test("turnOn: no Expo project in the build says so", async () => {
  const { alerts, main } = rig({ push: { token: async () => Promise.reject(new Error("This build can't get alerts yet: it has no Expo project.")) } });
  main.setState({ wallet: W });
  const r = await alerts.getState().turnOn(signer);
  assert.equal(r.ok, false);
  assert.equal(alerts.getState().error, "This build can't get alerts yet: it has no Expo project.");
});

test("start: a saved phone reads its alerts; one the server forgot (404) is dropped", async () => {
  const device = { push: PUSH, key: "k1", wallet: W };
  const a = rig({ disk: { [DEVICE_NAME]: device } });
  a.setPerm("granted");
  a.main.setState({ wallet: W });
  a.alerts.getState().start();
  await tick();
  await tick();
  assert.deepEqual(a.alerts.getState().device, device);
  assert.equal(a.alerts.getState().alerts.length, 1);

  const b = rig({ disk: { [DEVICE_NAME]: device }, api: { alerts: async () => Promise.reject(refused(404, "this phone isn't signed up for alerts")) } });
  b.setPerm("granted");
  b.alerts.getState().start();
  await tick();
  await tick();
  assert.equal(b.alerts.getState().device, null);
  assert.equal(b.disk.has(DEVICE_NAME), false);
  assert.equal(b.alerts.getState().error, null, "the screen just offers Turn on alerts again");
});

test("start: a new push token signs up again with the sign-in kept in storage, even at a cold start; with none kept, or an old one, the phone is dropped", async () => {
  const device = { push: "ExponentPushToken[old]", key: "k0", wallet: W, kinds: ["filled"] };
  // a cold start: the app's store hasn't read the wallet or its sign-in yet (both null)
  const a = rig({ disk: { [DEVICE_NAME]: device, [loginName(W)]: { token: "kept", exp: 2_000_000 } } });
  a.setPerm("granted");
  a.alerts.getState().start();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(a.calls.map((c) => c[0]), ["device", "remove", "alerts"]);
  assert.deepEqual(a.calls[0], ["device", "kept", PUSH, ["filled"]]);
  assert.deepEqual(a.calls[1], ["remove", "ExponentPushToken[old]", "k0"]);
  assert.deepEqual(a.alerts.getState().device, { push: PUSH, key: "k1", wallet: W });
  assert.deepEqual(a.disk.get(DEVICE_NAME), { push: PUSH, key: "k1", wallet: W, kinds: DEFAULT_KINDS });

  for (const login of [undefined, { token: "old", exp: 999_999 }]) {
    const b = rig({ disk: { [DEVICE_NAME]: device, ...(login && { [loginName(W)]: login }) } });
    b.setPerm("granted");
    b.main.setState({ wallet: W });
    b.alerts.getState().start();
    for (let i = 0; i < 5; i++) await tick();
    assert.deepEqual(b.calls, [], "no sign-in kept: never a wallet prompt on start");
    assert.equal(b.alerts.getState().device, null);
    assert.equal(b.disk.has(DEVICE_NAME), false);
  }
});

test("setKind: shown at once, sent; a failure puts it back and says why", async () => {
  const { alerts, main, calls, disk } = rig({ disk: { [DEVICE_NAME]: { push: PUSH, key: "k1", wallet: W } } });
  main.setState({ wallet: W });
  alerts.getState().start();
  for (let i = 0; i < 3; i++) await tick();
  const p = alerts.getState().setKind("mcap", false);
  const off = DEFAULT_KINDS.filter((k) => k !== "mcap");
  assert.deepEqual(alerts.getState().kinds, off);
  await p;
  assert.deepEqual(calls.at(-1), ["kinds", PUSH, "k1", off]);
  assert.deepEqual(alerts.getState().kinds, off);
  assert.deepEqual(disk.get(DEVICE_NAME).kinds, off, "kept for a new push token");

  const b = rig({ disk: { [DEVICE_NAME]: { push: PUSH, key: "k1", wallet: W } }, api: { deviceKinds: async () => Promise.reject(refused(0, "the server didn't answer in 10 s")) } });
  b.alerts.getState().start();
  for (let i = 0; i < 3; i++) await tick();
  await b.alerts.getState().setKind("follow", false);
  assert.ok(b.alerts.getState().kinds.includes("follow"));
  assert.equal(b.alerts.getState().error, "the server didn't answer in 10 s");
});

test("Auto-join's wait: set and stopped through the phone's sign-up; none without it", async () => {
  const { alerts, main, calls } = rig({ disk: { [DEVICE_NAME]: { push: PUSH, key: "k1", wallet: W } } });
  main.setState({ wallet: W });
  assert.deepEqual(await alerts.getState().wait(250_000_000n), { ok: false, error: "Turn on alerts first." });
  alerts.getState().start();
  for (let i = 0; i < 3; i++) await tick();
  assert.deepEqual(await alerts.getState().wait(250_000_000n), { ok: true });
  assert.deepEqual(alerts.getState().waiting, { amount: "250000000", at: 7 });
  assert.deepEqual(calls.at(-1), ["autojoin", PUSH, "k1", "250000000"]);
  assert.deepEqual(await alerts.getState().stopWaiting(), { ok: true });
  assert.equal(alerts.getState().waiting, null);
});

test("follow and unfollow: sign in when needed, the lists from the answer; a 401 forgets the sign-in", async () => {
  const { alerts, main, calls } = rig();
  main.setState({ wallet: W });
  alerts.getState().start();
  assert.deepEqual(await alerts.getState().follow(OTHER, true, signer), { ok: true });
  assert.deepEqual(calls.map((c) => c[0]), ["signIn", "follow"]);
  assert.deepEqual(alerts.getState().following, [OTHER]);
  await alerts.getState().follow(OTHER, false, signer);
  assert.deepEqual(calls.at(-1), ["unfollow", "fresh", OTHER]);
  assert.deepEqual(alerts.getState().following, []);
  assert.equal(alerts.getState().busy, null);

  const b = rig({ session: { token: "old", exp: 2_000_000 }, api: { follow: async () => Promise.reject(refused(401, "sign in first")) } });
  b.main.setState({ wallet: W });
  assert.deepEqual(await b.alerts.getState().follow(OTHER, true, signer), { ok: false, error: "sign in first" });
  assert.equal(b.main.getState().session, null);
  assert.equal(b.alerts.getState().error, null, "the card shows its own error");
});

test("forget (sign-out): the server forgets the phone, the phone forgets its sign-up", async () => {
  const { alerts, main, calls, disk } = rig({ disk: { [DEVICE_NAME]: { push: PUSH, key: "k1", wallet: W } } });
  main.setState({ wallet: W });
  alerts.getState().start();
  for (let i = 0; i < 3; i++) await tick();
  await alerts.getState().forget();
  assert.deepEqual(calls.at(-1), ["remove", PUSH, "k1"]);
  assert.equal(disk.has(DEVICE_NAME), false);
  assert.deepEqual([alerts.getState().device, alerts.getState().alerts, alerts.getState().waiting], [null, [], null]);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/alerts.test.mjs`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `mobile/src/alerts/store.js`.

- [ ] **Step 3: Write the store.** Create `mobile/src/alerts/store.js`:

```js
// Push alerts and follows on the phone: whether this phone gets the wallet's alerts (Expo
// push, engine/server/alerts.js), which kinds, the alerts it got, Auto-join's wait, and who
// the wallet follows and who follows it (the socket's follows:<wallet> topic,
// engine/server/follows.js). Nothing here imports React Native: `push` wraps
// expo-notifications (src/alerts/push.js), so this runs in Node tests with fakes.

import { createStore } from "zustand/vanilla";
import { DEFAULT_KINDS } from "../../../engine/src/alertkinds.js";
import { explain } from "../../../engine/src/flows.js";
import { loginName } from "../store.js";

/** Where this phone keeps its sign-up for alerts: { push, key, wallet, kinds }. One a phone. */
export const DEVICE_NAME = "mooner:alerts";

// Secure storage may throw on the spot or reject; neither may fail what the user did.
const keep = (fn) => Promise.resolve().then(fn).catch(() => undefined);

/**
 * main:  the app's store (src/store.js): its wallet, session and signIn
 * live:  { subscribe(topic, fn) -> off }                       engine/src/live.js
 * api:   engine/src/apiclient.js makeApi(BASE)
 * saved: (name) -> { get(), set(value), clear() }              securekeys.js secureJson
 * push:  { permission(), ask(), token() }                      src/alerts/push.js phonePush
 *        permission() and ask() give "granted", "denied", "blocked" (Android won't ask
 *        again: only its settings can turn it on) or "undetermined"; token() the Expo push
 *        token, or throws in plain words.
 */
export function createAlertsStore({ main, live, api, saved, push, now = () => Date.now() }) {
  let followsOff = null;
  const store = createStore(() => ({
    wallet: null, // main's wallet, whose follows these are
    following: [], // newest first
    followers: [],
    permission: null, // null until read
    device: null, // { push, key, wallet }: this phone gets `wallet`'s alerts
    kinds: DEFAULT_KINDS, // the switches that are on
    alerts: [], // newest first: { id, kind, title, body, url, at }
    waiting: null, // Auto-join's wait: { amount (lamports, a string), at }
    loaded: false, // the alerts came at least once for this device
    error: null, // the Alerts screen's words for what failed
    busy: null, // "on", "wait" or `follow:<wallet>` while it runs
  }));
  const { getState: get, setState: set } = store;
  const same = (d) => get().device?.push === d.push && get().device?.key === d.key;

  // ---- follows ----

  function onWallet(wallet) {
    followsOff?.();
    followsOff = null;
    set({ wallet, following: [], followers: [] });
    if (!wallet) return;
    followsOff = live.subscribe(`follows:${wallet}`, (m) => {
      if (m.type !== "snapshot" || m.data?.wallet !== wallet) return;
      set({ following: m.data.following ?? [], followers: m.data.followers ?? [] });
    });
  }

  /** Follows wallet changes and reads this phone's sign-up. Returns stop(). */
  function start() {
    const off = main.subscribe((s) => {
      if (s.wallet !== get().wallet) onWallet(s.wallet);
    });
    onWallet(main.getState().wallet);
    load();
    return () => {
      off();
      followsOff?.();
      followsOff = null;
    };
  }

  // ---- this phone's sign-up ----

  /** A Mooner sign-in for `signer`'s wallet: the saved one, else one signature now. */
  async function sessionFor(signer) {
    const m = main.getState();
    if (m.wallet === signer.publicKey.toBase58() && m.session && m.session.exp > now()) return { ok: true, session: m.session };
    return m.signIn(signer);
  }

  /** The server said the sign-in is no good: forget it, so the next try signs again. */
  async function signedOut(wallet) {
    if (main.getState().wallet === wallet) main.setState({ session: null });
    await keep(() => saved(loginName(wallet)).clear());
  }

  async function save(device, kinds) {
    await keep(() => saved(DEVICE_NAME).set({ ...device, kinds }));
  }

  /** The server forgot this phone (signed out elsewhere, or Expo said the token is gone):
   *  the screen offers "Turn on alerts" again. */
  async function drop() {
    set({ device: null, kinds: DEFAULT_KINDS, alerts: [], waiting: null, loaded: false });
    await keep(() => saved(DEVICE_NAME).clear());
  }

  /** The permission and the saved sign-up, at start. A push token that changed since (Android
   *  may roll it) signs up again with the wallet's sign-in as secure storage keeps it, never
   *  with a wallet prompt: with no sign-in kept, the phone is dropped and the screen offers
   *  "Turn on alerts". The sign-in is read from storage, not from `main`: at a cold start
   *  main's wallet and session are still null while its own read of them runs. */
  async function load() {
    const [permission, kept] = await Promise.all([keep(() => push.permission()), keep(() => saved(DEVICE_NAME).get())]);
    set({ permission: permission ?? null });
    if (!kept?.push || !kept.key || !kept.wallet) return;
    const device = { push: kept.push, key: kept.key, wallet: kept.wallet };
    set({ device });
    if (permission === "granted") {
      const token = await keep(() => push.token());
      if (token && token !== device.push) {
        const session = await keep(() => saved(loginName(device.wallet)).get());
        if (!session?.token || !(session.exp > now())) return drop();
        try {
          const r = await api.device(session.token, token, kept.kinds);
          const fresh = { push: token, key: r.key, wallet: r.wallet };
          await save(fresh, r.kinds);
          set({ device: fresh, kinds: r.kinds });
          await keep(() => api.removeDevice(device.push, device.key));
        } catch {
          return drop();
        }
      }
    }
    await refresh();
  }

  /** Reads the permission again (the person may have changed it in Android's settings). */
  async function checkPermission() {
    const p = await keep(() => push.permission());
    if (p) set({ permission: p });
  }

  /** The alerts this phone got, its switches and its wait, from the server: when the Alerts
   *  screen shows, and when an alert comes in or is tapped (src/alerts/push.js). */
  async function refresh() {
    const d = get().device;
    if (!d) return;
    try {
      const r = await api.alerts(d.push, d.key);
      if (!same(d)) return;
      set({ kinds: r.kinds, alerts: r.alerts ?? [], waiting: r.waiting ?? null, loaded: true, error: null });
    } catch (e) {
      if (!same(d)) return;
      if (e.status === 404) return drop();
      set({ error: explain(e) });
    }
  }

  const fail = (error) => {
    set({ error });
    return { ok: false, error };
  };

  /** "Turn on alerts": Android's permission prompt, the push token, a Mooner sign-in (one
   *  signature unless saved), then the server signs this phone up for the wallet's alerts.
   *  Returns { ok: true }, { ok: false, permission } or { ok: false, error }. */
  async function turnOn(signer) {
    if (get().busy) return { ok: false };
    const wallet = signer.publicKey.toBase58();
    set({ busy: "on", error: null });
    try {
      let permission = await push.permission();
      if (permission !== "granted") permission = await push.ask();
      set({ permission });
      if (permission !== "granted") return { ok: false, permission };
      const token = await push.token();
      const s = await sessionFor(signer);
      if (!s.ok) return fail(s.error);
      const r = await api.device(s.session.token, token);
      const device = { push: token, key: r.key, wallet: r.wallet };
      await save(device, r.kinds);
      set({ device, kinds: r.kinds, alerts: [], waiting: null, loaded: false });
      await refresh();
      return { ok: true };
    } catch (e) {
      if (e?.status === 401) await signedOut(wallet);
      return fail(explain(e));
    } finally {
      set({ busy: null });
    }
  }

  /** One switch: shown at once, then sent. A failure puts it back (unless another tap changed
   *  it since) and says why. */
  async function setKind(kind, on) {
    const d = get().device;
    if (!d) return;
    const was = get().kinds;
    const kinds = on ? [...was.filter((k) => k !== kind), kind] : was.filter((k) => k !== kind);
    set({ kinds, error: null });
    try {
      const r = await api.deviceKinds(d.push, d.key, kinds);
      if (!same(d)) return;
      if (get().kinds === kinds) set({ kinds: r.kinds });
      await save(d, r.kinds);
    } catch (e) {
      if (!same(d)) return;
      if (e.status === 404) return drop();
      if (get().kinds === kinds) set({ kinds: was });
      set({ error: explain(e) });
    }
  }

  /** Runs `fn(device)` as `busy`; { ok: true } or { ok: false, error } for the caller to show. */
  async function withDevice(busy, fn) {
    const d = get().device;
    if (!d) return { ok: false, error: "Turn on alerts first." };
    if (get().busy) return { ok: false };
    set({ busy });
    try {
      await fn(d);
      return { ok: true };
    } catch (e) {
      if (e.status === 404 && same(d)) await drop();
      return { ok: false, error: explain(e) };
    } finally {
      set({ busy: null });
    }
  }

  /** Auto-join found no presale with room: the server pushes when one has room for `amount`
   *  (lamports). One wait a phone; a join from this wallet ends it. */
  const wait = (amount) =>
    withDevice("wait", async (d) => {
      const r = await api.autojoin(d.push, d.key, amount);
      if (same(d)) set({ waiting: r.waiting });
    });

  const stopWaiting = () =>
    withDevice("wait", async (d) => {
      await api.autojoinStop(d.push, d.key);
      if (same(d)) set({ waiting: null });
    });

  /** Follows (`on`) or unfollows `target` as `signer`'s wallet, signing in first if needed.
   *  Returns { ok: true } or { ok: false, error } for the card to show. */
  async function follow(target, on, signer) {
    if (get().busy) return { ok: false };
    const wallet = signer.publicKey.toBase58();
    set({ busy: `follow:${target}` });
    try {
      const s = await sessionFor(signer);
      if (!s.ok) return { ok: false, error: s.error };
      const r = await (on ? api.follow : api.unfollow)(s.session.token, target);
      if (get().wallet === r.wallet) set({ following: r.following, followers: r.followers });
      return { ok: true };
    } catch (e) {
      if (e?.status === 401) await signedOut(wallet);
      return { ok: false, error: explain(e) };
    } finally {
      set({ busy: null });
    }
  }

  /** Sign-out: the phone forgets its sign-up, and the server is told to stop sending this
   *  wallet's alerts here. Sign-out doesn't wait for that: if the server can't be reached, the
   *  alerts keep coming until this phone signs up again (for any wallet) or the app is removed. */
  async function forget() {
    const d = get().device;
    await drop();
    set({ error: null });
    if (d) keep(() => api.removeDevice(d.push, d.key));
  }

  set({ start, refresh, checkPermission, turnOn, setKind, wait, stopWaiting, follow, forget });
  return store;
}
```

- [ ] **Step 4: Write the row helpers.** Create `mobile/src/alerts/rows.js`:

```js
// The Alerts screen's links and times: plain functions, so Node tests run them.

/** Where an alert may open: a presale (with Auto-join's amount) or a coin, by presale key.
 *  The server writes these (engine/server/alertrules.js alertText); a push's data is checked
 *  anyway before the app navigates to it. */
const SAFE = /^\/(presale\/[1-9A-HJ-NP-Za-km-z]{32,44}(\?join=\d{1,16})?|coin\/[1-9A-HJ-NP-Za-km-z]{32,44})$/;

/** `url` when it's one of those, else null. */
export const safeUrl = (url) => (typeof url === "string" && SAFE.test(url) ? url : null);

/** How long ago `at` (ms) was: "now", "5m", "3h", "2d". */
export function ago(at, nowMs) {
  const s = Math.max(0, Math.floor((nowMs - at) / 1000));
  if (s < 60) return "now";
  if (s < 3_600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}
```

- [ ] **Step 5: Run it again.**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/alerts.test.mjs`
Expected: FAIL, `SyntaxError: The requested module '../store.js' does not provide an export named 'loginName'`.

- [ ] **Step 6: Export the sign-in's name.**

Apply this block to `mobile/src/store.js`.

Replace:

```js
const loginName = (w) => `mooner:login:${w}`;
```

with:

```js
/** Where a wallet's Mooner sign-in is kept; src/alerts/store.js forgets it on a 401 too. */
export const loginName = (w) => `mooner:login:${w}`;
```

- [ ] **Step 7: Run the tests.**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/alerts.test.mjs`
Expected: `# pass 13`, `# fail 0`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M + 13, `# fail 0`.

- [ ] **Step 8: Commit.**

```bash
git add mobile/src/alerts/store.js mobile/src/alerts/rows.js mobile/src/store.js mobile/test/alerts.test.mjs && git commit -m "mobile: the alerts store: this phone's sign-up for alerts, its switches and list, Auto-join's wait, and the wallet's follows over the socket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/alerts/store.js mobile/src/alerts/rows.js mobile/src/store.js mobile/test/alerts.test.mjs
```

---

### Task 9: expo-notifications, the push wrapper, and the app's root

The plugin sets two things:
- the notification color, the app's accent `#5468ff` (`C.accent` in `src/ui/theme.js`);
- the default channel, `default`, which the server's `channelId` matches.

It sets no icon: `assets/icon.png` is the full-color app icon, and Android draws a small icon as a white shape, so Android's default stays until the user supplies one (USER STEP G, Task 15). Until the user gets the alerts address (Task 16), "Turn on alerts" ends in `This build can't get alerts yet: it has no Expo project.`

**Files:**
- Modify: `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/.gitignore`, `mobile/src/app.js`, `mobile/app/_layout.js`
- Create: `mobile/src/alerts/push.js`

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/.gitignore mobile/src/app.js mobile/app/_layout.js && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Save the permissions the last APK asks for.** Step 8's `prebuild --clean` deletes `mobile/android/` with the APK in it, so read them first. Run from the repo root:

```bash
AAPT2=/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0/aapt2
"$AAPT2" dump permissions mobile/android/app/build/outputs/apk/release/app-release.apk | sort > <scratchpad>/p5-perms-before.txt; cat <scratchpad>/p5-perms-before.txt
```

Expected: `package: family.mooner.app` and lines like `uses-permission: name='android.permission.INTERNET'`, with piece 4's `android.permission.CAMERA` among them. If the APK isn't there, write that down and compare by hand in Step 9 against this list. It was read with that command from the APK built here on 2026-10-01, before pieces 3 and 4:
- `INTERNET`
- `READ_EXTERNAL_STORAGE` (`maxSdkVersion='32'`)
- `SYSTEM_ALERT_WINDOW`
- `VIBRATE`
- `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion='32'`)
- `ACCESS_NETWORK_STATE`
- `USE_BIOMETRIC`
- `USE_FINGERPRINT`
- `family.mooner.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (declared and used)

Piece 4 adds `CAMERA` to it.

- [ ] **Step 2: Install the package.**

Run: `cd mobile && npx expo install expo-notifications`
Then: `cd mobile && node -e 'console.log(require("./package.json").dependencies["expo-notifications"])' && npm ls expo-notifications expo-application`
Expected:
- `~55.0.27`;
- `npm ls` shows both packages, with no `UNMET` or `invalid`. `expo-application` is a dependency of expo-notifications.

If `expo install` picks another version, stop and report.

- [ ] **Step 3: Set the plugin.** Edit `app.json` as JSON, so whatever else is in it stays. `expo install` may have added a plain `"expo-notifications"` entry; this replaces it. Run from `mobile/`:

```bash
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("app.json", "utf8"));
const want = ["expo-notifications", { color: "#5468ff", defaultChannel: "default" }];
const at = j.expo.plugins.findIndex((p) => (Array.isArray(p) ? p[0] : p) === "expo-notifications");
if (at === -1) j.expo.plugins.push(want);
else j.expo.plugins[at] = want;
fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");
'
```

Run: `cd mobile && node -e 'const p = require("./app.json").expo.plugins; console.log(JSON.stringify(p.filter((x) => (Array.isArray(x) ? x[0] : x) === "expo-notifications")))' && git diff --stat -- app.json`
Expected: `[["expo-notifications",{"color":"#5468ff","defaultChannel":"default"}]]`, and only `app.json`'s plugin lines changed.

- [ ] **Step 4: Keep Firebase's files out of git.**

Apply this block to `mobile/.gitignore`.

Replace:

```gitignore
.env
.env.*
```

with:

```gitignore
.env
.env.*
# Firebase (push alerts): the app's config, and never a service-account key
google-services.json
*firebase-adminsdk*.json
service-account*.json
```

Run: `git check-ignore -v mobile/google-services.json mobile/my-app-firebase-adminsdk-x.json`
Expected: two lines naming `mobile/.gitignore`.

- [ ] **Step 5: Write the push wrapper.** Create `mobile/src/alerts/push.js`:

```js
// This phone's notifications through expo-notifications: Android's permission, the Expo push
// token, the one Android channel, and what a tap on an alert opens. React Native only: the
// alerts store (src/alerts/store.js) takes `phonePush`, so its Node tests use a fake.
import { useEffect } from "react";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { safeUrl } from "./rows";

/** The Android channel every alert uses; the server sends channelId "default" (alerts.js). */
export const CHANNEL = "default";

// An alert that comes while the app is open shows as a banner too, with its sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// The channel comes first: Android 13+ shows the permission prompt only once a channel exists,
// and the token is read after it. Made once; a failed try is tried again next time.
let channel = null;
function ensureChannel() {
  channel ??= Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Alerts",
    importance: Notifications.AndroidImportance.HIGH,
  }).catch((e) => {
    channel = null;
    throw e;
  });
  return channel;
}

/** expo-notifications' answer in four words: "blocked" when Android won't ask again. */
function statusOf(p) {
  if (p.granted || p.status === "granted") return "granted";
  if (p.status === "denied") return p.canAskAgain ? "denied" : "blocked";
  return "undetermined";
}

export const phonePush = {
  permission: async () => statusOf(await Notifications.getPermissionsAsync()),
  async ask() {
    await ensureChannel();
    return statusOf(await Notifications.requestPermissionsAsync());
  },
  async token() {
    await ensureChannel();
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) throw new Error("This build can't get alerts yet: it has no Expo project.");
    try {
      return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch (e) {
      throw new Error(`Couldn't get this phone's alert address: ${e?.message ?? e}`);
    }
  },
};

/** Opens what a tapped alert points at (the tap that started the app too), and calls
 *  `onAlert` when an alert comes in or is tapped, so the Alerts list reads again. Mount it
 *  once, beside the root Stack. */
export function AlertTaps({ onAlert }) {
  useEffect(() => {
    const open = (response) => {
      onAlert();
      const url = safeUrl(response?.notification?.request?.content?.data?.url);
      if (url) router.push(url);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      Notifications.clearLastNotificationResponse();
      open(last);
    }
    const subs = [
      Notifications.addNotificationResponseReceivedListener(open),
      Notifications.addNotificationReceivedListener(() => onAlert()),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [onAlert]);
  return null;
}
```

- [ ] **Step 6: Make the store, and start it.**

Apply these 2 blocks to `mobile/src/app.js`, in order.

Replace:

```js
import { createMoonerStore } from "./store";
```

with:

```js
import { createMoonerStore } from "./store";
import { phonePush } from "./alerts/push";
import { createAlertsStore } from "./alerts/store";
```

Replace:

```js
export const store = createMoonerStore({ live, api, flows, market, saved: (name) => secureJson(SecureStore, name) });
```

with:

```js
export const store = createMoonerStore({ live, api, flows, market, saved: (name) => secureJson(SecureStore, name) });
// push alerts and follows (src/alerts/store.js)
export const alerts = createAlertsStore({ main: store, live, api, push: phonePush, saved: (name) => secureJson(SecureStore, name) });
```

Apply these 5 blocks to `mobile/app/_layout.js`, in order.

Replace:

```js
import { live, store } from "../src/app";
```

with:

```js
import { alerts, live, store } from "../src/app";
import { AlertTaps } from "../src/alerts/push";
```

Replace:

```js
const BANNER_AFTER_MS = 2_000;
```

with:

```js
const BANNER_AFTER_MS = 2_000;
/** An alert came in or was tapped: the Alerts list reads again. */
const readAlerts = () => alerts.getState().refresh();
```

Replace:

```js
  useEffect(() => store.getState().start(), []);
```

with:

```js
  useEffect(() => store.getState().start(), []);
  useEffect(() => alerts.getState().start(), []);
```

Replace:

```js
      } else if (state === "active") {
```

with:

```js
      } else if (state === "active") {
        // back from Android's settings, or alerts came while away: read both again
        alerts.getState().checkPermission();
        alerts.getState().refresh();
```

Replace:

```js
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg0 }, animation: "slide_from_right" }} />
        </View>
```

with:

```js
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg0 }, animation: "slide_from_right" }} />
        </View>
        <AlertTaps onAlert={readAlerts} />
```

- [ ] **Step 7: Check.**

Run (from `mobile/`): the parse check with `app/_layout.js src/app.js src/alerts/push.js`.
Expected: `parsed 3 files`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M + 13, `# fail 0`.

- [ ] **Step 8: Prebuild and check the manifest.**

Run: `cd mobile && npx expo prebuild --platform android --clean`
Then: `cd mobile && grep -o 'com.google.firebase.messaging.default_notification_color\|expo.modules.notifications.default_notification_color\|com.google.firebase.messaging.default_notification_channel_id' android/app/src/main/AndroidManifest.xml | sort -u`
Expected: the three names. The channel's meta-data has `android:value="default"`.

- [ ] **Step 9: Build, install, compare the permissions.** This build has no `google-services.json` yet. Whether Gradle builds without it was not checked while writing. If the build fails, stop and report the error; don't add the file yourself (USER STEP B).

Run: `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh`
Then run Step 1's two lines again, writing to `<scratchpad>/p5-perms-after.txt`, and `diff <scratchpad>/p5-perms-before.txt <scratchpad>/p5-perms-after.txt`.
Expected:
- new lines for `android.permission.POST_NOTIFICATIONS` and `android.permission.RECEIVE_BOOT_COMPLETED` (from expo-notifications' manifest);
- maybe lines from Firebase Messaging's own manifest, such as `android.permission.WAKE_LOCK` or `com.google.android.c2dm.permission.RECEIVE`. Which ones was not checked while writing.

Stop and bring the diff to the user if it shows anything else. Look especially for `com.google.android.gms.permission.AD_ID`, and for any line removed.

- [ ] **Step 10: The app starts.** Open the app (`adb shell monkey -p family.mooner.app 1`), wait for Live, take a screenshot (`p5-9-live.png`). Expected: Live shows as before.

- [ ] **Step 11: Commit.**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/.gitignore mobile/src/alerts/push.js mobile/src/app.js mobile/app/_layout.js && git commit -m "mobile: expo-notifications: the permission, the Expo push token, one Android channel, and alert taps that open the presale or the coin

Firebase's google-services.json and any service-account key are gitignored.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/.gitignore mobile/src/alerts/push.js mobile/src/app.js mobile/app/_layout.js
```

---

### Task 10: Follow on a Mooner's card; an Auto-join link opens the join sheet

**Room:**
- A face's card gets `FollowButton`.
- `?join=<lamports>` opens the join sheet on that chip, once, when the presale and the wallet are there. `startOf` takes the join sheet's seat amounts (any of `seatChoices(N)`), and the sheet's `start` starts its chip there.

**Files:**
- Create: `mobile/src/alerts/FollowButton.js`
- Modify: `mobile/app/presale/[key].js`, `mobile/src/room/JoinSheet.js`

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- "mobile/app/presale/[key].js" mobile/src/room/JoinSheet.js && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the button.** Create `mobile/src/alerts/FollowButton.js`:

```js
// Follow and Unfollow on a Mooner's card. Follows are public (engine/server/follows.js); the
// first one needs a Mooner sign-in, one wallet signature kept 7 days.
import { useState } from "react";
import { View } from "react-native";
import { useStore } from "zustand";
import { alerts, store } from "../app";
import { useSigner } from "../wallet";
import { Button, T } from "../ui/kit";
import { C } from "../ui/theme";

/** For `wallet`'s card. Nothing with no wallet connected, or on the wallet's own card. */
export function FollowButton({ wallet }) {
  const me = useStore(store, (s) => s.wallet);
  const following = useStore(alerts, (s) => s.following.includes(wallet));
  const busy = useStore(alerts, (s) => s.busy);
  const signer = useSigner();
  const [error, setError] = useState(null);
  if (!wallet || !me || !signer || me === wallet) return null;
  const mine = busy === `follow:${wallet}`;

  async function press() {
    setError(null);
    const r = await alerts.getState().follow(wallet, !following, signer);
    if (!r.ok && r.error) setError(r.error);
  }

  return (
    <View style={{ alignSelf: "stretch", gap: 8 }}>
      <Button
        title={following ? "Unfollow" : "Follow"}
        kind={following ? "quiet" : "primary"}
        busy={mine}
        disabled={!!busy && !mine}
        onPress={press}
      />
      {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
    </View>
  );
}
```

- [ ] **Step 2: Put it on the card, and read `?join=`.** These blocks were checked against the room after piece 3's Share button and `?ref=`.

Apply these 4 blocks to `mobile/app/presale/[key].js`, in order.

Replace:

```js
import { useNow } from "../../src/ui/useNow";
```

with:

```js
import { useNow } from "../../src/ui/useNow";
import { FollowButton } from "../../src/alerts/FollowButton";
import { startOf } from "../../../engine/src/autojoin.js";
```

Replace:

```js
  const closeChat = useCallback(() => setChatOpen(false), []);
```

with:

```js
  const closeChat = useCallback(() => setChatOpen(false), []);

  // An Auto-join alert's link (`?join=<lamports>`): once the presale and the wallet are here,
  // the join sheet opens on that amount, once. The wallet still approves the join.
  const join0 = Array.isArray(params.join) ? params.join[0] : params.join;
  const start = useMemo(() => (info ? startOf(join0, info.N) : null), [join0, info]);
  const [asked, setAsked] = useState(null);
  const here = !!view;
  useEffect(() => {
    if (start == null || asked === join0 || !here || !wallet) return;
    setAsked(join0);
    setJoinOpen(true);
  }, [start, asked, join0, here, wallet]);
```

Replace this text, which ends mid-line (keep the rest of that line as it is):

```js
        signer={signer}
        why={bottom.kind === "why"
```

with:

```js
        signer={signer}
        start={start}
        why={bottom.kind === "why"
```

Replace:

```js
          {shown.creator ? <Pill text="Creator" color={C.gold} /> : null}
```

with:

```js
          {shown.creator ? <Pill text="Creator" color={C.gold} /> : null}
          <FollowButton wallet={shown.user} />
```

- [ ] **Step 3: Let the sheet start on an amount.**

Apply these 2 blocks to `mobile/src/room/JoinSheet.js`, in order.

Replace:

```js
 *  when a join fails, so the room can open the sheet again if it was closed meanwhile. */
export function JoinSheet({ open, onClose, onFailed, view, info, lamports, signer, why }) {
```

with:

```js
 *  when a join fails, so the room can open the sheet again if it was closed meanwhile.
 *  `start` (a seat, BigInt, or null): the chip each opening starts on, from an Auto-join link. */
export function JoinSheet({ open, onClose, onFailed, view, info, lamports, signer, why, start = null }) {
```

Replace:

```js
  const [chip, setChip] = useState(() => choices[0] ?? null);
```

with:

```js
  const [chip, setChip] = useState(() => start ?? choices[0] ?? null);
  useEffect(() => {
    if (open && start != null && choices.includes(start)) setChip(start);
  }, [open, start, choices]);
```

- [ ] **Step 4: Check.**

Run (from `mobile/`): the parse check with `"app/presale/[key].js" src/room/JoinSheet.js src/alerts/FollowButton.js`.
Expected: `parsed 3 files`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M + 13, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add mobile/src/alerts/FollowButton.js "mobile/app/presale/[key].js" mobile/src/room/JoinSheet.js && git commit -m "mobile: Follow on a Mooner's card in the room; an Auto-join link (?join=) opens the join sheet on its amount, and the wallet still approves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/alerts/FollowButton.js "mobile/app/presale/[key].js" mobile/src/room/JoinSheet.js
```

---

### Task 11: Auto-join on Live

A card over Live's list, which shows only with a wallet connected. "Pick" opens a sheet:
- Auto-join's amount chips;
- "Every join needs your wallet's approval. Auto-join picks the presale; it never signs for you.";
- "Find a presale".

With a presale with room for the amount, its room opens with the join sheet on that amount. With none:
- "Tell me when one does" if alerts are on (the server's wait);
- else a way to the Alerts tab.

While it waits, the card says so and offers "Stop waiting".

**Files:**
- Create: `mobile/src/alerts/AutoJoin.js`
- Modify: `mobile/app/(tabs)/index.js`

- [ ] **Step 0: Check the file is clean.** Run `git diff --quiet HEAD -- "mobile/app/(tabs)/index.js" && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the card.** Create `mobile/src/alerts/AutoJoin.js`:

```js
// Auto-join, on Live: pick an amount once and Mooner picks the fullest presale with room for
// it; its room opens with the join sheet ready on that amount. With none, the server pushes
// an alert when one has room. Every join needs the wallet's approval: this only picks.
import { useMemo, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useStore } from "zustand";
import { autoChoices, pickFullest } from "../../../engine/src/autojoin.js";
import { alerts, store } from "../app";
import { Chip } from "../ui/Chip";
import { solText } from "../ui/format";
import { Button, Card, PillButton, Sheet, T } from "../ui/kit";
import { C } from "../ui/theme";

export const NEVER_SIGNS = "Every join needs your wallet's approval. Auto-join picks the presale; it never signs for you.";

/** The card over Live's list. `list`: Live's presales (list views); `info`: store.info.
 *  Nothing with no wallet connected. */
export function AutoJoin({ list, info }) {
  const wallet = useStore(store, (s) => s.wallet);
  const waiting = useStore(alerts, (s) => s.waiting);
  const [open, setOpen] = useState(false);
  if (!wallet || !info) return null;
  return (
    <View style={{ marginBottom: 12 }}>
      {waiting ? (
        <Waiting waiting={waiting} />
      ) : (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="body">Auto-join</T>
            <T v="small">Pick an amount once. Mooner finds the fullest presale with room.</T>
          </View>
          <PillButton title="Pick" accessibilityLabel="Pick an amount for Auto-join" onPress={() => setOpen(true)} />
        </Card>
      )}
      <AutoJoinSheet open={open} onClose={() => setOpen(false)} list={list} info={info} wallet={wallet} />
    </View>
  );
}

/** "Waiting for room for X SOL", and Stop waiting. On Live and on the Alerts screen. */
export function Waiting({ waiting }) {
  const busy = useStore(alerts, (s) => s.busy === "wait");
  const [error, setError] = useState(null);
  async function stop() {
    setError(null);
    const r = await alerts.getState().stopWaiting();
    if (!r.ok && r.error) setError(r.error);
  }
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="body">{`Auto-join is waiting for room for ${solText(waiting.amount)} SOL`}</T>
          <T v="small">You'll get an alert when a presale has it.</T>
        </View>
        <PillButton title={busy ? "Stopping…" : "Stop waiting"} onPress={busy ? undefined : stop} />
      </View>
      {error ? <T v="small" color={C.down}>{error}</T> : null}
    </Card>
  );
}

function AutoJoinSheet({ open, onClose, list, info, wallet }) {
  const choices = useMemo(() => autoChoices(info.N), [info]);
  const on = useStore(alerts, (s) => !!s.device && s.device.wallet === s.wallet && s.permission === "granted");
  const busy = useStore(alerts, (s) => s.busy === "wait");
  const [amount, setAmount] = useState(() => choices[0] ?? null);
  const [none, setNone] = useState(false); // no presale had room at the last look
  const [error, setError] = useState(null);

  const close = () => {
    setNone(false);
    setError(null);
    onClose();
  };

  function find() {
    if (amount == null) return;
    setError(null);
    const pick = pickFullest(list, info.N, amount, wallet, Date.now());
    if (!pick) return setNone(true);
    close();
    router.push(`/presale/${pick.presale}?join=${amount}`);
  }

  async function wait() {
    const r = await alerts.getState().wait(amount);
    if (r.ok) close();
    else if (r.error) setError(r.error);
  }

  return (
    <Sheet open={open} onClose={close} title="Auto-join">
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {choices.map((c) => (
            <Chip
              key={String(c)}
              text={`${solText(c)} SOL`}
              on={c === amount}
              disabled={busy}
              onPress={() => {
                setAmount(c);
                setNone(false);
              }}
            />
          ))}
        </View>
        <T v="small">{NEVER_SIGNS}</T>
        {none ? (
          <>
            <T v="small" color={C.text0}>{`No presale has room for ${solText(amount)} SOL right now.`}</T>
            {on ? (
              <Button title="Tell me when one does" onPress={wait} busy={busy} />
            ) : (
              <>
                <T v="small">Turn on alerts and Mooner tells you when one does.</T>
                <Button
                  title="Turn on alerts"
                  kind="quiet"
                  onPress={() => {
                    close();
                    router.push("/(tabs)/alerts");
                  }}
                />
              </>
            )}
          </>
        ) : (
          <Button title="Find a presale" onPress={find} disabled={amount == null} />
        )}
        {error ? <T v="small" color={C.down}>{error}</T> : null}
      </View>
    </Sheet>
  );
}
```

- [ ] **Step 2: Put it on Live.**

Apply these 2 blocks to `mobile/app/(tabs)/index.js`, in order.

Replace:

```js
import { PresaleCard } from "../../src/live/PresaleCard";
```

with:

```js
import { PresaleCard } from "../../src/live/PresaleCard";
import { AutoJoin } from "../../src/alerts/AutoJoin";
```

Replace:

```js
            ItemSeparatorComponent={Gap}
            ListEmptyComponent={
```

with:

```js
            ItemSeparatorComponent={Gap}
            ListHeaderComponent={<AutoJoin list={list} info={info} />}
            ListEmptyComponent={
```

- [ ] **Step 3: Check.**

Run (from `mobile/`): the parse check with `"app/(tabs)/index.js" src/alerts/AutoJoin.js`.
Expected: `parsed 2 files`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M + 13, `# fail 0`.

- [ ] **Step 4: Commit.**

```bash
git add mobile/src/alerts/AutoJoin.js "mobile/app/(tabs)/index.js" && git commit -m "mobile: Auto-join on Live: pick an amount once and Mooner opens the fullest presale with room for it, or waits and sends an alert

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/alerts/AutoJoin.js "mobile/app/(tabs)/index.js"
```

---

### Task 12: The Alerts tab

The tab sits between Create and Me, with a bell. Its states:
- **No wallet:** connect.
- **Wallet but alerts off:** the reason first, then "Turn on alerts". Android asks for notifications, then the wallet signs in to Mooner once. If Android won't ask again, it shows "Open settings" instead.
- **On:** the list, newest first, with pull to refresh and "No alerts yet" when empty. Settings has a switch per kind, in three groups. Auto-join's wait shows above the list.

Each focus reads the permission and the list once.

**Files:**
- Create: `mobile/app/(tabs)/alerts.js`
- Modify: `mobile/src/ui/icons.js`, `mobile/app/(tabs)/_layout.js`

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- mobile/src/ui/icons.js "mobile/app/(tabs)/_layout.js" && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the screen.** Create `mobile/app/(tabs)/alerts.js`. `Logo` is the existing `src/ui/Logo` (the logo file, never redrawn).

```js
// Alerts: what Mooner sent this phone, newest first; a tap opens the presale or the coin.
// Settings has a switch per kind, in three groups. Turning alerts on says why first, then
// Android asks, then the wallet signs in to Mooner once (src/alerts/store.js turnOn).
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Switch, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useStore } from "zustand";
import { GROUPS, KIND_LABEL } from "../../../engine/src/alertkinds.js";
import { alerts, store } from "../../src/app";
import { Waiting } from "../../src/alerts/AutoJoin";
import { ago, safeUrl } from "../../src/alerts/rows";
import { useConnect } from "../../src/useConnect";
import { useSigner } from "../../src/wallet";
import { Logo } from "../../src/ui/Logo";
import { Button, Card, Empty, PillButton, Screen, Sheet, T } from "../../src/ui/kit";
import { useNow } from "../../src/ui/useNow";
import { C, F, S } from "../../src/ui/theme";

/** Why Mooner wants notifications, said before Android asks. */
const REASON = "Mooner tells you when your presale fills, when it launches and when your tokens arrive. Turn on notifications to get them.";

export default function Alerts() {
  const wallet = useStore(store, (s) => s.wallet);
  const on = useStore(alerts, (s) => !!s.device && s.device.wallet === wallet && s.permission === "granted");
  const [settings, setSettings] = useState(false);

  // Each visit reads the list again, and the permission (it may have changed in Android's
  // settings). An alert that comes while the screen is open reads it too (src/alerts/push.js).
  useFocusEffect(
    useCallback(() => {
      const a = alerts.getState();
      a.checkPermission();
      a.refresh();
    }, []),
  );

  let body;
  if (!wallet) body = <NoWallet />;
  else if (!on) body = <TurnOn />;
  else body = <List />;

  return (
    <Screen padded={false}>
      <View
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: S.gutter, paddingTop: 12, minHeight: 56,
        }}
      >
        <T v="title">Alerts</T>
        {on ? <PillButton title="Settings" accessibilityLabel="Choose which alerts you get" onPress={() => setSettings(true)} /> : null}
      </View>
      {body}
      <Switches open={settings && on} onClose={() => setSettings(false)} />
    </Screen>
  );
}

function NoWallet() {
  const { connect, busy, error } = useConnect();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: S.gutter, paddingBottom: 32 }}>
      <Logo size={96} />
      <T v="body" color={C.text1} style={{ textAlign: "center" }}>Connect your wallet to get alerts</T>
      {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
      <Button title="Connect Seed Vault" onPress={connect} busy={busy} />
    </View>
  );
}

/** The reason, then "Turn on alerts". When Android won't ask again, "Open settings". */
function TurnOn() {
  const permission = useStore(alerts, (s) => s.permission);
  const busy = useStore(alerts, (s) => s.busy === "on");
  const error = useStore(alerts, (s) => s.error);
  const signer = useSigner();
  const blocked = permission === "blocked";
  return (
    <View style={{ flex: 1, justifyContent: "center", gap: 16, paddingHorizontal: S.gutter, paddingBottom: 32 }}>
      <Card style={{ gap: 10 }}>
        <T v="body">{REASON}</T>
        <T v="small">Also when someone joins your presale, when people you follow join or open one, and when a coin passes a big market cap. You choose which in Settings.</T>
      </Card>
      {blocked ? (
        <>
          <T v="small" color={C.text1} style={{ textAlign: "center" }}>Notifications are off for Mooner in Android's settings.</T>
          <Button title="Open settings" onPress={() => Linking.openSettings().catch(() => {})} />
        </>
      ) : (
        <>
          <T v="small" color={C.text2} style={{ textAlign: "center" }}>Android asks first. Then your wallet signs you in to Mooner, once.</T>
          <Button title="Turn on alerts" onPress={() => signer && alerts.getState().turnOn(signer)} busy={busy} disabled={!signer} />
        </>
      )}
      {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
    </View>
  );
}

const Gap = () => <View style={{ height: 12 }} />;

function List() {
  const items = useStore(alerts, (s) => s.alerts);
  const loaded = useStore(alerts, (s) => s.loaded);
  const error = useStore(alerts, (s) => s.error);
  const waiting = useStore(alerts, (s) => s.waiting);
  const now = useNow(60_000);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await alerts.getState().refresh();
    setRefreshing(false);
  }, []);
  const renderItem = useCallback(({ item }) => <Row alert={item} now={now} />, [now]);

  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
        <ActivityIndicator color={C.text1} />
        {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
      </View>
    );
  }
  return (
    <FlatList
      data={items}
      keyExtractor={(a) => String(a.id)}
      renderItem={renderItem}
      contentContainerStyle={{ padding: S.gutter, paddingBottom: 32 }}
      ItemSeparatorComponent={Gap}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={
        error || waiting ? (
          <View style={{ gap: 12, marginBottom: 12 }}>
            {error ? <T v="small" color={C.down}>{error}</T> : null}
            {waiting ? <Waiting waiting={waiting} /> : null}
          </View>
        ) : null
      }
      ListEmptyComponent={<Empty title="No alerts yet" body="They show up here as they come." />}
    />
  );
}

/** One alert: what happened, and how long ago. A tap opens its presale or coin. */
function Row({ alert, now }) {
  const url = safeUrl(alert.url);
  return (
    <Card onPress={url ? () => router.push(url) : undefined} accessibilityLabel={`${alert.title}. ${alert.body}`}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T v="body" style={{ fontFamily: F.medium }}>{alert.title}</T>
          <T v="small">{alert.body}</T>
        </View>
        <T v="small" color={C.text2}>{ago(alert.at, now)}</T>
      </View>
    </Card>
  );
}

/** A switch per kind, in GROUPS. A change shows at once; a failed one goes back. */
function Switches({ open, onClose }) {
  const kinds = useStore(alerts, (s) => s.kinds);
  const error = useStore(alerts, (s) => s.error);
  return (
    <Sheet open={open} onClose={onClose} title="Alerts you get">
      <View style={{ gap: 20 }}>
        {GROUPS.map((g) => (
          <View key={g.title} style={{ gap: 12 }}>
            <T v="label">{g.title}</T>
            {g.kinds.map((k) => (
              <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <T v="body" style={{ flex: 1 }}>{KIND_LABEL[k]}</T>
                <Switch
                  accessibilityLabel={KIND_LABEL[k]}
                  value={kinds.includes(k)}
                  onValueChange={(v) => alerts.getState().setKind(k, v)}
                  trackColor={{ false: C.bg3, true: C.accent }}
                  thumbColor={C.text0}
                />
              </View>
            ))}
          </View>
        ))}
        {error ? <T v="small" color={C.down}>{error}</T> : null}
      </View>
    </Sheet>
  );
}
```

- [ ] **Step 2: Add the bell.**

Apply this block to `mobile/src/ui/icons.js`.

Replace:

```js
/** A person, outlined: a head over shoulders. */
```

with:

```js
/** A bell: alerts. */
export function BellIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 16.5 V11 A6 6 0 0 1 18 11 V16.5 L19.5 18.5 H4.5 Z" stroke={color} {...STROKE} />
      <Path d="M10 21 H14" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A person, outlined: a head over shoulders. */
```

- [ ] **Step 3: Add the tab.** These blocks were checked against piece 4's tabs layout.
  - The first two anchors (`// presale), Me.` and the icons import with `PlusIcon`) come from piece 4's rewrite of this file (its "Replace all of `mobile/app/(tabs)/_layout.js` with:"), not from HEAD `ad34216`: there each matches 0 times, and in piece 4's text once.
  - The third (`<Tabs.Screen name="me" `) matches once in both.
  - Step 0 already stops if piece 4 isn't committed. If either of the first two still matches 0 times, piece 4's layout changed after this plan: stop and adapt by hand, as the edit-block rule says.

Apply these 3 blocks to `mobile/app/(tabs)/_layout.js`, in order.

Replace:

```js
// presale), Me.
```

with:

```js
// presale), Alerts (what Mooner sent this phone, and its switches), Me.
```

Replace:

```js
import { LaunchedIcon, LiveIcon, MeIcon, PlusIcon } from "../../src/ui/icons";
```

with:

```js
import { BellIcon, LaunchedIcon, LiveIcon, MeIcon, PlusIcon } from "../../src/ui/icons";
```

Replace this text, which ends mid-line (keep the rest of that line as it is):

```js
      <Tabs.Screen name="me" 
```

with:

```js
      <Tabs.Screen name="alerts" options={{ title: "Alerts", tabBarIcon: ({ color }) => <BellIcon color={color} /> }} />
      <Tabs.Screen name="me" 
```

- [ ] **Step 4: Check.**

Run (from `mobile/`): the parse check with `"app/(tabs)/alerts.js" "app/(tabs)/_layout.js" src/ui/icons.js`.
Expected: `parsed 3 files`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M + 13, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add "mobile/app/(tabs)/alerts.js" mobile/src/ui/icons.js "mobile/app/(tabs)/_layout.js" && git commit -m "mobile: the Alerts tab: why first, then turn on; every alert newest first, a tap opens the presale or the coin; a switch per kind in three groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- "mobile/app/(tabs)/alerts.js" mobile/src/ui/icons.js "mobile/app/(tabs)/_layout.js"
```

---

### Task 13: Following and Followers on Me; sign-out stops this phone's alerts

Me shows two rows of faces, Following and Followers, from the socket. A tap on a face opens that Mooner with Follow or Unfollow. Sign-out first tells the server to stop this wallet's alerts on this phone, then signs out as before.

**Files:**
- Create: `mobile/src/alerts/FollowLists.js`
- Modify: `mobile/app/(tabs)/me.js`

- [ ] **Step 0: Check the file is clean.** Run `git diff --quiet HEAD -- "mobile/app/(tabs)/me.js" && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the lists.** Create `mobile/src/alerts/FollowLists.js`:

```js
// Me: who the wallet follows and who follows it, as faces. A tap on a face opens that person's
// card with Follow or Unfollow. The lists come over the socket (alerts store, follows:<wallet>).
import { useRef, useState } from "react";
import { View } from "react-native";
import { useStore } from "zustand";
import { alerts } from "../app";
import { Face, Faces } from "../ui/Face";
import { shortWallet } from "../ui/format";
import { Card, Sheet, T } from "../ui/kit";
import { C } from "../ui/theme";
import { FollowButton } from "./FollowButton";

const FACES = 8;

export function FollowLists() {
  const following = useStore(alerts, (s) => s.following);
  const followers = useStore(alerts, (s) => s.followers);
  const [person, setPerson] = useState(null);
  return (
    <View style={{ gap: 12, marginBottom: 28 }}>
      <Row label="Following" wallets={following} none="Nobody yet. Tap a face in a presale to follow them." onFace={setPerson} />
      <Row label="Followers" wallets={followers} none="Nobody yet." onFace={setPerson} />
      <PersonSheet wallet={person} onClose={() => setPerson(null)} />
    </View>
  );
}

function Row({ label, wallets, none, onFace }) {
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T v="label">{label}</T>
        <T v="num" color={C.text1}>{wallets.length}</T>
      </View>
      {wallets.length ? (
        <Faces wallets={wallets} size={32} max={FACES} ring={C.bg1} onPress={onFace} />
      ) : (
        <T v="small" color={C.text2}>{none}</T>
      )}
    </Card>
  );
}

/** One person: face, short wallet, Follow or Unfollow. Keeps the last person while it slides
 *  out, so it doesn't go blank on the way down. */
function PersonSheet({ wallet, onClose }) {
  const last = useRef(wallet);
  if (wallet) last.current = wallet;
  const shown = last.current;
  return (
    <Sheet open={!!wallet} onClose={onClose}>
      {shown ? (
        <View style={{ alignItems: "center", gap: 12, paddingBottom: 8 }}>
          <Face wallet={shown} size={64} />
          <T v="num">{shortWallet(shown)}</T>
          <FollowButton wallet={shown} />
        </View>
      ) : null}
    </Sheet>
  );
}
```

- [ ] **Step 2: Put them on Me.**

Apply these 3 blocks to `mobile/app/(tabs)/me.js`, in order.

Replace:

```js
import { store } from "../../src/app";
```

with:

```js
import { alerts, store } from "../../src/app";
import { FollowLists } from "../../src/alerts/FollowLists";
```

Replace:

```js
      await store.getState().signOut();
```

with:

```js
      await alerts.getState().forget();
      await store.getState().signOut();
```

Replace:

```js
      <T v="label" style={{ marginBottom: 12 }}>Your presales</T>
```

with:

```js
      <FollowLists />
      <T v="label" style={{ marginBottom: 12 }}>Your presales</T>
```

- [ ] **Step 3: Check.**

Run (from `mobile/`): the parse check with `"app/(tabs)/me.js" src/alerts/FollowLists.js`.
Expected: `parsed 2 files`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M + 13, `# fail 0`.

- [ ] **Step 4: Commit.**

```bash
git add mobile/src/alerts/FollowLists.js "mobile/app/(tabs)/me.js" && git commit -m "mobile: who you follow and who follows you, on Me; sign-out stops this wallet's alerts on this phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/alerts/FollowLists.js "mobile/app/(tabs)/me.js"
```

- [ ] **Step 5: Device check of Tasks 10-13.** This runs against production's server, which doesn't have Tasks 1-7 until USER STEP E. So follows and alerts answer 404 there for now; this step checks the screens only. The user should be at the phone: Android's prompt is theirs.
  1. Run `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh`, and open the app.
  2. **Tabs.** Screenshot `p5-13-tabs.png`. Expected: Live, Launched, Create, Alerts (a bell), Me.
  3. **Live.** With a wallet connected, the Auto-join card ("Auto-join", "Pick an amount once. Mooner finds the fullest presale with room.", Pick) shows over the list. Tap Pick, then screenshot `p5-13-autojoin.png`. Expected: chips `0.1 SOL` and `0.25 SOL`, the "never signs" line, and "Find a presale".
     - Tap "Find a presale". If a presale has room, its room opens with the join sheet up on 0.1 SOL: screenshot `p5-13-autojoin-room.png`, then close the sheet. Don't press Join.
     - If none has room, the sheet says `No presale has room for 0.1 SOL right now.` with "Turn on alerts".
  4. **The link.** Find an open presale's key: `curl -s https://app.mooner.family/api/presales | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const o=JSON.parse(s).presales.find((p)=>p.state==="OPEN");console.log(o?o.presale:"no OPEN presale now")})'`. If there is one, run `adb shell "am start -W -a android.intent.action.VIEW -d 'mooner:///presale/<KEY>?join=250000000'"` and screenshot `p5-13-join-link.png`.
     - Expected: the room opens with the join sheet up on `0.25 SOL`. Close it and don't press Join.
     - If the wallet is already in that presale, the sheet says "You're already in."
     - With no OPEN presale, skip this and note it.
  5. **Card.** In the room, tap a face that isn't the wallet's own. Expected: the card shows "Follow". Don't press it yet (the server isn't deployed).
  6. **Alerts.** Open Alerts. Expected: the reason ("Mooner tells you when your presale fills, …"), "Android asks first. Then your wallet signs you in to Mooner, once.", and "Turn on alerts". Tap it.
     - Android's notification prompt shows. The user answers it.
     - If they allow, the screen shows `This build can't get alerts yet: it has no Expo project.`, because the project comes in Task 16. Seed Vault doesn't open.
     - If they don't allow, the reason stays. After a second "Don't allow", "Open settings" shows.
     - Screenshot `p5-13-alerts.png`.
  7. **Me.** Expected: Following and Followers cards, each "Nobody yet…" or faces. Because the server isn't deployed, the lists stay empty.

---

### Task 14: Follow on the web

`PlayerCard` gets Follow or Unfollow for someone else's card, when a wallet is connected. It shows nothing on your own card or a bot's. If you're not signed in to Mooner, the sign-in opens. `store.ts` keeps `following` from `follows:<wallet>`, and `follow()` posts.

**Files:**
- Modify: `web/src/lib/store.ts`, `web/src/components/presale/PlayerCard.tsx`

- [ ] **Step 0: Check the files are clean, and take the baseline.** Run `git diff --quiet HEAD -- web/src/lib/store.ts web/src/components/presale/PlayerCard.tsx && echo clean`. Expected: `clean`. If not, stop and report.

Run: `cd web && npm run build`. Expected: exit 0. If it already fails, stop and report.
- Optional: save the type-check's list first, as piece 3's plan does: `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep 'error TS' | sed -E 's/\([0-9]+,[0-9]+\)//' | sort > <scratchpad>/p5-tsc-before.txt`.
- `web/tsconfig.check.json` belongs to another session and may point at other scratchpads, so it isn't a gate.

- [ ] **Step 1: The store.**

Apply these 6 blocks to `web/src/lib/store.ts`, in order.

Replace:

```ts
  signOut(): void
```

with:

```ts
  signOut(): void
  /** Who your wallet follows, newest first (the server's follows:<wallet> topic). */
  following: string[]
  /** Follows (`on`) or unfollows `wallet`. Needs a Mooner sign-in, as chat does. */
  follow(wallet: string, on: boolean): Promise<Result>
```

Replace:

```ts
  let walletOff: (() => void) | null = null
```

with:

```ts
  let walletOff: (() => void) | null = null
  let followsOff: (() => void) | null = null
```

Replace:

```ts
    /** Your SOL, pushed as it changes. */
```

with:

```ts
    /** Who you follow, pushed as it changes (engine/server/follows.js). */
    function followFollows(wallet: string | null) {
      followsOff?.()
      set({ following: [] })
      followsOff = wallet
        ? live.subscribe(`follows:${wallet}`, (m: Push) => {
            const d = m.data as { wallet?: string; following?: string[] } | null
            if (m.type !== 'snapshot' || me() !== wallet || d?.wallet !== wallet) return
            set({ following: d?.following ?? [] })
          })
        : null
    }

    /** Your SOL, pushed as it changes. */
```

Replace:

```ts
        followWallet(now)
```

with:

```ts
        followWallet(now)
        followFollows(now)
```

Replace:

```ts
      solUsd: SOL_USD,
```

with:

```ts
      solUsd: SOL_USD,
      following: [],
```

Replace:

```ts
      buy: (tokenId, sol) => trade(tokenId, 'buy', sol),
```

with:

```ts
      async follow(wallet, on) {
        if (!get().signedIn || !login) {
          get().openSignIn()
          return fail('Sign in to follow')
        }
        try {
          const r: { wallet: string; following: string[] } = await (on ? api.follow : api.unfollow)(login.token, wallet)
          if (me() === r.wallet) set({ following: r.following })
          return { ok: true }
        } catch (e) {
          const err = e as { status?: number; message: string }
          if (err.status === 401) {
            // the saved sign-in is no good: forget it, so the next try signs again
            const w = me()
            if (w)
              try {
                localStorage.removeItem(LOGIN_KEY(w))
              } catch {}
            login = null
            set({ signedIn: false })
          }
          return fail(err.message)
        }
      },

      buy: (tokenId, sol) => trade(tokenId, 'buy', sol),
```

- [ ] **Step 2: The card.**

Apply these 4 blocks to `web/src/components/presale/PlayerCard.tsx`, in order.

Replace:

```tsx
import { useMemo } from 'react'
```

with:

```tsx
import { useMemo, useState } from 'react'
```

Replace:

```tsx
import { Stat } from '@/components/ui/Stat'
```

with:

```tsx
import { Stat } from '@/components/ui/Stat'
import { useApp } from '@/components/world/WorldProvider'
```

Replace:

```tsx
      <Link href={`/profile/${u.handle}`} className="btn btn-block" onClick={onClose}>
```

with:

```tsx
      <FollowButton u={u} meId={world.meId} />
      <Link href={`/profile/${u.handle}`} className="btn btn-block" onClick={onClose}>
```

Add at the end of the file:

```tsx
/** Follow or Unfollow on someone else's card. Nothing with no wallet connected, on your own
 *  card, or on a bot's. Not signed in: the sign-in opens (store.follow). */
function FollowButton({ u, meId }: { u: User; meId: string }) {
  const connected = useApp((s) => !!s.wallet)
  const following = useApp((s) => s.following.includes(u.id))
  const follow = useApp((s) => s.follow)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!connected || u.isBot || u.id === meId) return null

  async function press() {
    setBusy(true)
    setError(null)
    const r = await follow(u.id, !following)
    setBusy(false)
    if (!r.ok) setError(r.error)
  }

  return (
    <>
      <button
        type="button"
        className={following ? 'btn btn-ghost btn-block' : 'btn btn-primary btn-block'}
        disabled={busy}
        onClick={press}
      >
        {following ? 'Unfollow' : 'Follow'}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
```

- [ ] **Step 3: Build and test.**

Run: `cd web && npm run build`. Expected: exit 0.

Optional: rerun the type-check into `<scratchpad>/p5-tsc-after.txt` and `diff` the two lists. Expected: no difference, and no line naming `store.ts` or `PlayerCard.tsx`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`. Expected: BEFORE_E + 37, `# fail 0`.

- [ ] **Step 4: Commit.**

```bash
git add web/src/lib/store.ts web/src/components/presale/PlayerCard.tsx && git commit -m "web: Follow and Unfollow on a Mooner's card, with the lists pushed over follows:<wallet>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- web/src/lib/store.ts web/src/components/presale/PlayerCard.tsx
```

---

### Task 15: USER STEPs: Expo, Firebase, the server

Bring these to the user, in this order (G, a choice, at any time). The agent doesn't do them, and doesn't read anything secret from them.

- [ ] **USER STEP A: the Expo project.**
  1. Sign up or sign in at https://expo.dev, accepting Expo's terms.
  2. Create a project named `mooner`. The slug must be `mooner`, as `mobile/app.json`'s `slug`.
  3. Tell the agent two things, neither of them secret: the project ID (a UUID on the project's page), and the account or organization that owns it.
- [ ] **USER STEP B: Firebase's config file.**
  1. In the Firebase console (https://console.firebase.google.com), accepting its terms, create a project (or use one).
  2. Add an Android app with package name `family.mooner.app`.
  3. Download `google-services.json` and put it at `mobile/google-services.json`. Task 9 gitignored it, and it stays out of git. So a fresh clone needs this file from the user's Firebase project, put back at `mobile/google-services.json`, to build a phone that gets alerts.
  4. If the file's API key gets restricted in Google Cloud, it must allow the Firebase Installations and FCM Registration APIs. Any SHA-1 restriction must match the key the APK is signed with. Expo's docs say a mismatch means the phone never gets a token.
- [ ] **USER STEP C: Firebase's sending key, to Expo only.**
  1. In the Firebase console: Project settings → Service accounts → Generate new private key.
  2. Upload that JSON at expo.dev: the project → Credentials → Android → `family.mooner.app` → FCM V1 service account key. `eas credentials` works too.
  3. Then delete the local copy. It never goes into this repo, Railway or a chat.
- [ ] **USER STEP D (optional, recommended on): Expo's enhanced security.** With it on, Expo delivers only pushes that carry an access token. It's the user's choice; turning it on is recommended.
  1. Create an access token on expo.dev.
  2. Set it as `MOONER_EXPO_TOKEN` on Railway's `app` service.
  3. Deploy (E).
  4. Only then turn on enhanced push security in the project's settings. In the other order, every push fails until the token is there.
  5. With it off, the server sends without a token. That works, but anyone holding a phone's push token could send it a notification through Expo.
- [ ] **USER STEP E: deploy the server.** Tasks 1-7 must be committed: the deploy ships HEAD. Run `sh deploy/railway.sh app`. Then the agent checks:

Run: `curl -s -w ' %{http_code}\n' -X POST https://app.mooner.family/api/alerts -H 'content-type: application/json' -d '{}'`
Expected: `{"error":"this phone isn't signed up for alerts"} 404`. A 404 from the web app's HTML instead means the deploy doesn't have Task 7.

- [ ] **USER STEP G (a choice, not needed for alerts to work): the notification icon.** Android draws a notification's small icon as a white shape on a clear background. `assets/icon.png` is a full-color square with no alpha, so the app keeps Android's default icon.
  - To change that, the user or a designer supplies a white one-shape silhouette PNG on a transparent background. Expo's notifications docs ask for 96×96, all white, with transparency.
  - The agent never redraws the logo or derives an icon from it.
  - Once the user puts the file in the repo, using it is a separate change: the `expo-notifications` plugin's `icon` option in `app.json`, then a prebuild and a new APK.

---

### Task 16: The phone's Expo project and Firebase file; the full check

**Files:**
- Modify: `mobile/app.json`

- [ ] **Step 0: Check.** Run `git diff --quiet HEAD -- mobile/app.json && echo clean`. Expected: `clean`. If not, stop and report.

Run: `git check-ignore -q mobile/google-services.json && test -f mobile/google-services.json && echo ok`
Expected: `ok`. If not, USER STEP B isn't done: stop.

Run: `cd mobile && node -e 'console.log(require("./google-services.json").client.map((c) => c.client_info.android_client_info.package_name))'`
Expected: `[ 'family.mooner.app' ]`. Print nothing else from that file.

- [ ] **Step 1: Set the project.** Use USER STEP A's two values. Run from `mobile/`:

```bash
PROJECT_ID="<from USER STEP A>" OWNER="<from USER STEP A>" node -e '
const fs = require("fs");
const { PROJECT_ID: id, OWNER: owner } = process.env;
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id ?? "") || !/^[a-z0-9_-]+$/i.test(owner ?? "")) throw new Error("set PROJECT_ID (a UUID) and OWNER (the Expo account) first");
const j = JSON.parse(fs.readFileSync("app.json", "utf8"));
j.expo.owner = owner;
j.expo.android.googleServicesFile = "./google-services.json";
j.expo.extra = { ...j.expo.extra, eas: { ...j.expo.extra?.eas, projectId: id } };
fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");
'
```

Run: `cd mobile && git diff -- app.json`
Expected: only `owner`, `android.googleServicesFile` and `extra.eas.projectId` added.

- [ ] **Step 2: Prebuild, build, compare.**

Run: `cd mobile && npx expo prebuild --platform android --clean`
Then: `cd mobile && test -f android/app/google-services.json && grep -c 'com.google.gms.google-services' android/app/build.gradle`
Expected: the file is there, and the count is at least 1.

Run: `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh`
Then run Task 9 Step 1's two lines into `<scratchpad>/p5-perms-final.txt`, and `diff <scratchpad>/p5-perms-after.txt <scratchpad>/p5-perms-final.txt`.
Expected: the same list, or only Firebase lines added. Bring anything else to the user.

- [ ] **Step 3: Turn alerts on.** The user is at the phone. Open Alerts and tap "Turn on alerts".
  - Android's prompt shows, unless it was answered in Task 13; the user answers it.
  - Seed Vault opens for the Mooner sign-in, unless a saved one is still good; the user approves it.
  - Expected: the screen changes to the list, with "No alerts yet" and Settings. Screenshot `p5-16-on.png`.
  - If it shows `Couldn't get this phone's alert address: …`, stop and bring the text to the user. It usually means USER STEP B's file or C's key, or a restricted API key.
- [ ] **Step 4: A switch persists.** Open Settings and turn "Big market caps" off. Close and reopen the app, then open Settings again. Expected: it's still off. Turn it back on.
- [ ] **Step 5: A follow.** In an open presale's room, tap a face that isn't the wallet's, and tap Follow.
  - Expected: the button turns to Unfollow. That face is under Following on Me.
  - Tap Unfollow if the user doesn't want to keep it.
  - If Seed Vault opens for a sign-in, the user does it.
- [ ] **Step 6: Auto-join's wait.** On Live, Pick → 0.25 SOL → Find a presale.
  - If no presale has room, tap "Tell me when one does". Expected: the card says `Auto-join is waiting for room for 0.25 SOL`, and Alerts shows it above the list. Tap "Stop waiting" unless the user wants to keep it for Step 7.
  - If a presale has room, its room opens: close the sheet.
- [ ] **Step 7: A real alert (USER STEP F).** A real alert needs a real event on chain:
  - a join into a presale this wallet is in or opened;
  - a fill or launch of one;
  - a presale with room while Auto-join waits;
  - a followed wallet joining or opening.

  The user makes one, or waits for one; this may spend their SOL, which is theirs to decide. When it arrives:
  1. Screenshot the notification shade (`adb shell cmd statusbar expand-notifications`, then `p5-16-shade.png`). Expected: Mooner's alert, with its title and body.
  2. **The cold-start tap.** Press Home (`adb shell input keyevent KEYCODE_HOME`), then `adb shell am kill family.mooner.app`. Then `adb shell pidof family.mooner.app` should print nothing; if it prints a number, skip the cold start and note it.
  3. Open the shade and tap the alert. Expected: the app starts on the alert's screen: the room, the coin, or for "room" the room with the join sheet on the amount. Screenshot `p5-16-tap.png`. Don't press Join.
     - **Handled once?** Close the sheet if one is up, then press Back once (`adb shell input keyevent KEYCODE_BACK`) and screenshot `p5-16-back.png`. Expected: the tabs, not the same screen again. The same screen again means the tap was handled twice (Known limits): note it for the user.
  4. Open Alerts. Expected: the alert is at the top, with its time.
- [ ] **Step 8: Commit.**

```bash
git add mobile/app.json && git commit -m "mobile: the Expo project and Firebase config file for push alerts (google-services.json stays out of git)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/app.json
```

---

## Final review

- [ ] **The spec note.** Run `git diff --quiet HEAD -- docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md && echo clean`. Expected: `clean`. If not, stop and report.

  In the spec, under **Follows**, after the line ``- Follower and following lists ride the `profiles` topic.``, add:

```markdown
  - Piece 5 (push alerts): they ride `follows:<wallet>` instead, one topic per wallet. It sends `{ wallet, following, followers }` on sub and again on each change (`engine/server/feed.js`, `engine/server/follows.js`). Why: `profiles` is every wallet's picture, sent whole to every socket on it, so every wallet's lists there would go to every screen that shows a picture. A wallet's own topic sends only the lists a screen shows. The lists stay public, as above.
```

  Then commit:

```bash
git add docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md && git commit -m "spec: piece 5's follow lists ride follows:<wallet>, not profiles, and why

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md
```

- [ ] `cd engine && npm test`: BEFORE_E + 37, `# fail 0`. `cd mobile && npm test`: BEFORE_M + 13, `# fail 0`. `cd web && npm run build`: exit 0.
- [ ] `git status --short` shows no `google-services.json`, no `*firebase-adminsdk*.json`, and nothing under `mobile/android/`.
- [ ] `git log --oneline` shows the 16 commits of Tasks 1-14, Task 16 and the spec note.
- [ ] Report to the user:
  - which USER STEPs are done, and whether G (the icon) was chosen;
  - the permission diffs (Tasks 9 and 16);
  - whether the cold-start tap was seen, and whether it was handled once;
  - the known limits below.

## Decided in review

1. **The notification's small icon:** Android's default stays until a white one-shape icon exists. The user or a designer supplies it (USER STEP G); the logo is never redrawn or derived here.
2. **`google-services.json`** stays out of git. A fresh clone needs the file from the user's Firebase project to build a phone that gets alerts (USER STEP B).
3. **Enhanced security (USER STEP D)** stays optional and the user's choice; the step recommends on.
4. **The numbers stay as written,** in one block, `ALERT_NUMBERS` in `alertrules.js` (Task 2):
   - at most 20 pushes an hour a phone;
   - follow alerts gathered over 10 s;
   - an event older than 30 minutes is not news;
   - the market-cap lines $100K, $500K, $1M, $5M and $10M;
   - 100 alerts kept a wallet;
   - 5 phones a wallet.
5. **Follows ride `follows:<wallet>`, not `profiles`.** The lists stay public, as the spec has them. The Final review's spec note records the change and why.
6. **The limits below stay as built.**

## Known limits

- **In memory only.** Receipt reads still waiting (`push.js`) and the hourly limit per phone (`alerts.js`) live in memory. A restart forgets them: those receipts are never read, and each phone's count for the hour starts again.
- **A first sight is a baseline.** After the first deploy, and for any presale the server sees for the first time, its first read only records who's in when it opened more than 30 minutes before. Joins already in it send nothing. A fill or launch from the last 30 minutes still sends, and "arrived" needs an earlier read.
- **Joins while the server was down.** Who was in is kept in SQLite (`presale_seen`, until 7 days after its last read). So after a restart, joins made while the server was down count as new, however long ago they were. They send "joined" and follow alerts at the first read; only opens, fills and launches have the 30-minute check.
- **Windows for "launched", "arrived" and "filled".** "Launched" and "arrived" are sent only within 30 minutes of the launch: tokens delivered later send no "arrived". "Filled" is skipped when the read that first sees the pool full already has the launch; only "launched" goes then.
- **A known push token can be taken over.** A signed-in user who knows another phone's Expo push token can sign it up for their own wallet. That phone then gets their alerts, and stops getting its own until it signs up again. The app never shows its push token.
- **A cold-start tap may be handled twice.** Task 9's `AlertTaps` opens the last notification response at start and also listens for taps. Task 16 Step 7 checks on the phone that a cold-start tap opens its screen once.
- **Firebase's permissions are known only after a build.** Whether Firebase's library adds `AD_ID` or other permissions shows only in the built APK. Task 9's permission diff checks it, and Task 16 Step 2's diff checks again.
- **The feed reads more.** The notifier listens from server start, so from then on the feed reads every presale that changes, not only those a screen shows. That happens whether or not any phone is signed up, once per change, paced as today.
- **An Auto-join wait never runs out.** It ends with Stop waiting, a join from that wallet, or its one "room" alert.
- **Follow alerts still gathering are lost** when the server restarts.
- **Sign-out doesn't wait.** It tells the server to stop this phone's alerts but doesn't wait for the answer. If the server can't be reached then, alerts keep coming until the phone signs up again or the app is removed.
- **A new push token needs a kept sign-in.** When Android gives the app a new push token, the phone signs up again only with the Mooner sign-in that secure storage keeps for the wallet. Without one, or with one that ran out, it drops the sign-up and asks to turn alerts on again.
- **Me's "+N"** past eight faces isn't tappable.
- **The web forgets more.** On the web, a 401 from follow forgets the saved sign-in. Chat's send doesn't do that today.

## Not verified while writing

- Whether Gradle builds without `google-services.json` (Task 9).

## Self-review

- **Spec coverage:**
  - **Tabs with Alerts:** Task 12.
  - **Auto-join, steps 1-4 and "never signs":** Tasks 1, 10, 11. The server's wait and its "room" alert are Task 6.
  - **Faces, a card with Follow:** Task 10 for the room, Task 13 for Me.
  - **Alerts:** every push newest first, with a switch per kind in three groups, and a tap that opens the presale or the coin. Tasks 6, 8, 9, 12.
  - **Me, who you follow and who follows you:** Task 13. The leaderboard's rows come in piece 6, with `FollowButton`.
  - **Push.** The devices table and `POST /api/device` with a session token (Task 6). The feed hands changes to the notifier (Task 5). The who-gets-what table (Task 6). Expo through FCM (Tasks 4, 9, 15, 16). One push per followed wallet per presale, grouped (Task 6).
  - **Follows.** The table and `POST /api/follow` and `/api/unfollow` with a session token (Task 3). The lists (Task 5, on `follows:<wallet>`, the one change). The web's button (Task 14). Only confirmed joins and opens, because the feed reads the chain (Tasks 5, 6).
  - **Milestones.** Price × 1B × SOL/USD, from DBC before migration and DAMM v2 after. One list in code (`ALERT_NUMBERS.milestones`). Once per coin, ever (the `milestones` table). On by default with its own switch. Tasks 2, 6 and `alertkinds.js`.
  - **Security.** Push tokens tied to the wallet by a session token, and the `key` under its own device key (Tasks 3 and 6). Follows need a session token (Task 3).
  - **Testing.** The notifier's fan-out, follow alerts only on confirmed joins and grouped, each milestone once per coin before and after migration (`alerts.test.js`, Task 6).
- **Placeholders:** none. Every code step shows its code. The values the user gives (USER STEP A) go in through Task 16's script, which refuses anything that isn't a UUID and an account name.
- **Names across tasks:**
  - `makeSessions` (Task 3) is used by `follows.js` and `alerts.js`; its `deviceSign` and `deviceCheck` by `alerts.js` only.
  - `ALERT_NUMBERS`, `MILESTONES` and `FRESH_MS` (Task 2) are used by `alerts.js` and the tests; `MAX_ALERTS` and `MAX_DEVICES` (Task 6) come from `ALERT_NUMBERS`.
  - `record` and `deliver` (Task 6) are `Notifier`'s own: `alert` is the two in a row, and `pool` gathers every wallet's `record` into one `deliver`.
  - `followsOf` and `followersOf` (Task 3) are used by `feed.js` (Task 5) and `alerts.js` (Task 6).
  - `PUSH_TOKEN` (Task 4) is used by `alerts.js`.
  - `autoChoices`, `hasRoomFor`, `pickFullest` and `startOf` (Task 1) are used by `alerts.js`, `AutoJoin.js` and `[key].js`.
  - The API client's `device`, `deviceKinds`, `removeDevice`, `alerts`, `autojoin`, `autojoinStop`, `follow` and `unfollow` (Task 7) are used by the alerts store (Task 8) and the web store (Task 14).
  - `phonePush` and `AlertTaps` (Task 9).
  - `loginName` (Task 8).
  - `CHANNEL` `"default"` matches the server's `channelId` and the plugin's `defaultChannel`.
