# Mooner on Seeker, piece 4: create from the phone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** A new Create tab on the phone. The creator picks a picture (camera or gallery, cropped square), types the name, ticker, description and links, picks their commit, and reviews it all. Then they sign twice in Seed Vault: the coin's details, then the open tx with their SOL. The new presale's room opens with Android's share sheet up.

**Architecture:**
- **Nothing new on the server.** `POST /api/mint` and the co-signed open tx exist, and `engine/src/flows.js` already has `requestMint`, `openPresale` and `openCost`.
- **Plain rules, tested under Node.** `mobile/src/create/rules.js` holds:
  - the form's rules (the website's, plus the server's byte limits);
  - the commit's bounds (at most `TARGET − MIN_SEAT`, the co-signer's cap);
  - the tickers in use;
  - the wallet's unopened coins;
  - every error in words.
- **The store.** It gains `mintCoin`, `openCoin`, `openCost` and `forgetOpening`. They run through the store's one-action-at-a-time `run`, so the screen shows each step ("Sign the coin details in your wallet", …). A successful open is remembered as this wallet's seat, so Me shows it at once.
- **An open that may have gone out is never a plain failure.**
  - Right before the wallet is asked to sign the open, the store saves the coin for the wallet (`mooner:opening:<wallet>`, with `at`, the time), and keeps a copy in memory for the app's run. It saves it again, with a new `at`, once the wallet has signed and when an unknown outcome is reported.
  - Once the wallet has signed, any failure except the server's refusal (400, 403, 429, or any answer of its own that says `sent: false`) comes back as `engine/src/tx.js`'s OUTCOME_UNKNOWN, and the saved coin stays. So a crash, Android ending the app, a restart or a reconnect brings the screen back to that coin.
  - The screen retries only that coin and watches its presale over the socket. A retry first asks the server for that presale, and goes to the room if the server knows it in any state. Only the server's own 404 (`no such presale`) lets it sign again.
  - A success or ALREADY_OPEN clears the coin. A first try's plain failure clears it too, but a retry's keeps it.
  - The one way to a new coin is Start over. It shows only after a retry's read got that 404 more than 5 minutes after the coin's last save (`at`, `canStartOver`).
  - **What that guarantees, on this phone:** an unknown outcome leads neither to a second coin nor to a second presale for the same coin.
  - **The one gap:** secure storage refuses the save, and then the app ends before the outcome is known. The copy in memory goes with the app, so nothing is left to restore.
- **The screen.** `mobile/app/(tabs)/create.js` steps through four parts in `mobile/src/create/`. A coin that was issued but never opened shows at the top and opens without signing its details again.
- **Sharing.** The new presale's room opens with Android's share sheet up, with piece 3's share words and link (`?ref=<wallet>`, so joins through the creator's share credit them).
- **The picture.** `expo-image-picker` gives Android's 1:1 crop screen. `expo-image-manipulator` then makes a square JPEG of at most 1024 px.

**Tech Stack:** Expo ~55, React Native 0.83, expo-router (Tabs), zustand 5, expo-image-picker ~55.0.24, expo-image-manipulator ~55.0.21 (new native modules, so a new build), expo-haptics, React Native's `Share`, Node 22 `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md`. The relevant parts:
- "+ Create", steps 1–5 (lines 195-200);
- the piece 4 row of "Pieces" (line 112): nothing new on the server.

**Before this plan:**
- Branch `feat/mooner-wireframe`, HEAD `ccb0f94` (2026-10-01; the last item lists the commits since `ef2e0f2`, the base before it). Piece 2's work is committed: among its commits since this plan's first draft are `fd71eec`, `ed221c0` and `148d2a2` (the phone's trade sheet), `d3d532e` (the server's coin stats), `a552f42` (the API client's deadlines, and `outcomeUnknown` in `engine/src/tx.js`), `8edc177` (the phone: when a launch counts as seen live, and a trade's minimum), `238150c` (a cosign that fails other than with the server's own 4xx is outcome unknown; the server's cosign simulation answers 503 after 15 s), `0ebf9be` (every cosign answer from before the tx goes out says `sent: false`, and the client keeps those plain), `c38e1c4` (the server's coin stats) and `6b9bbfe` (`openPresale` takes `waitMs`, and a 202 whose presale doesn't show in time is outcome unknown; the server answers the same signed tx again, once it went out, with a 202 and no `sent` marker). `8edc177` added the last import in `mobile/src/store.js`, which Task 3 anchors on. `6b9bbfe` changed only `engine/server/api.js`, `engine/src/flows.js` and their tests.
- **`engine/src/opening.js` came with `df9abda`** (the web's fix for an open whose outcome is unknown, after `6b9bbfe`). It exports `alreadyOpen(e, pid)` (`pid`: the presale program's key in base58), which tells the program's refusal of a second presale for a mint (`AlreadyExists`, 28), with its tests in `engine/test/opening.test.js`. Task 2's `createError` uses it. If it isn't in HEAD when this plan starts, Task 1's Step 0 stops. `df9abda` changed nothing in `mobile/`.
- **`0c1cad3` and `e81bb45` came after it.** They changed `engine/src/live.js` (a topic the socket already has is asked for again, so a second listener gets the snapshot too), `engine/server/hub.js` and the live tests. This plan anchors on none of them.
- **Then `c339fe8`, `d16c55e`, `ad647cb` and `874b210`:**
  - `c339fe8` changed the deploy script.
  - `d16c55e` is piece 3's plan.
  - `ad647cb` is piece 3's Task 0: `mobile/.gitignore`, `mobile/metro.config.js` and `mobile/scripts/check-bundle.sh`.
  - `874b210` changed `engine/server/feed.js`, `engine/server/hub.js` and the doc comment of `engine/src/live.js` `subscribe`, with live tests. Since then the server answers at most 30 repeat subs of a held topic a minute per socket.
- **Then `65c49d5`, `581f12f`, `5ba106a`, `4b2c676` and `ef2e0f2`:**
  - `65c49d5` is the web's guard for an open whose outcome is unknown (`web/src/real/opening.js`, `web/src/lib/store.ts`, `LaunchScreen.tsx`): saved before the open is signed, the read before a retry with the server's own 404, and Start over. Task 2's `checkBeforeRetry`, `START_OVER_MS` and `canStartOver` match its own.
  - `581f12f` changed the deploy script.
  - `5ba106a` is piece 3's `engine/src/refs.js` (with `shareLink(base, key, wallet)`) and its tests.
  - `4b2c676` changed only the failure words of `mobile/scripts/check-bundle.sh` and a guard in `mobile/metro.config.js`. The check's output when it passes is the same.
  - `ef2e0f2` changed `engine/server/feed.js` and the live tests.

  This plan anchors on none of them. At `ef2e0f2`, `mobile/` differed from `df9abda` only in `mobile/.gitignore`, `mobile/metro.config.js` and `mobile/scripts/check-bundle.sh` (`ad647cb`, `4b2c676`), and `engine/src/flows.js`, `engine/src/apiclient.js`, `engine/src/tx.js`, `engine/src/opening.js`, `engine/server/api.js` and `engine/server/http.js` were the same as at `df9abda` (`git diff --stat df9abda ef2e0f2`). That no longer holds at `ccb0f94` (next item).
- **Then 18 commits, up to `ccb0f94`.** Those that touch files this plan reads or edits:
  - `8940f86` and `d09cae8`: `engine/src/flows.js` and `engine/src/apiclient.js`. A join's ref goes beside the tx, cleaned first (`refs.js` `cleanRef`): `signAndCosign(signTransaction, payer, ixs, { ref = null } = {})` and `api.cosign(tx, { ref })`.
  - `0a584e5`: `engine/server/api.js`. The server records who shared a join's link (`refOf`, `referrals.js`). Only the join's path changed; the lines it added move `onePresale` down by 18.
  - `3bf01c3`: `engine/server/http.js`. `reply` takes a content type (for `/.well-known/assetlinks.json`); its "not found" and its error reply each move down by 1, to lines 166 and 173.
  - `8dce021` and `897d345`: `engine/src/refs.js`. `shareLink` encodes the key, drops a trailing slash on the base and never throws. Task 2's share test link, `https://app.mooner.family/presale/Pre1?ref=<wallet>`, is the same.
  - `649f28e` (piece 3's Task 5) and `ccb0f94`: `mobile/src/store.js` and `mobile/test/store.test.mjs`. `649f28e` added the `refs.js` import after `flows.js`'s, `REFS` after `mineName`, and `noteRef` in the final `set`; `ccb0f94` changed only `noteRef`'s doc comment there.
  - `78b583a` (piece 3's Task 7) and `b1e8e5c` (its Task 8): `mobile/app.json`, the App Links filter and `./plugins/withReleaseSigning`, which Task 1's expected plugins print already ends with. `b1e8e5c` also changed `mobile/scripts/run-android.sh` (its comments on signing, see Device).
  - `93c7cc3` (piece 3's Task 6): `mobile/src/room/share.js`, new, with `shareOf({ view, launched, wallet, N, base, now })`, and `mobile/src/ui/icons.js` (`ShareIcon` before `CheckIcon`, and the header comment).
  - `6871fe7` and `d3144d5`: the web's guard (`web/src/real/opening.js`, `web/src/lib/store.ts`), which this plan follows. A coin whose outcome is unknown is kept as of when that was reported, and since `d3144d5` it is kept again once the wallet has signed, before the open is sent. Task 3 does both.

  The other five (`56e866e`, `1b05969`, `f7d9221`, `6066273`, `4a205cc`) changed `engine/server/feed.js`, `engine/server/applinks.js`, `engine/server/main.js` and their tests, and `ccb0f94`'s other files are the room's (`mobile/app/presale/[key].js`, `mobile/src/room/room.js`, `mobile/src/ui/TopBar.js`, `room.test.mjs`, and two tests in `share.test.mjs`, with `share.js` unchanged). This plan reads none of them.

  What this plan relies on still holds at `ccb0f94`:
  - `openPresale({ info, wallet, signTransaction, mint, commit, waitMs = 90_000 })` is unchanged, and calls `signAndCosign(signTransaction, wallet, ixs)` with no ref;
  - the open's server answers (Server data shapes) are unchanged: `cosignChecked` and its `sent: false`, the 202 for the same tx again, the 503 with no marker;
  - `onePresale`'s 404 body is still `{ error: "no such presale" }`;
  - `engine/src/tx.js`, `engine/src/opening.js`, `mobile/src/room/JoinSheet.js`, `mobile/app/(tabs)/_layout.js`, `mobile/package.json`, `mobile/package-lock.json` and the spec are the same as at `ef2e0f2`.
- **Order:** piece 2, then piece 3 (share links, `docs/superpowers/plans/2026-10-01-mooner-seeker-share-links.md`), then this plan. Start Task 1 only once piece 3's Tasks 0–9 are committed. Its Task 10 USER STEPs may still be pending.
- **What this plan takes from piece 3:**
  - `shareLink(base, key, wallet)` (`engine/src/refs.js`) and `shareOf({ view, launched, wallet, N, base, now })` (`mobile/src/room/share.js`), for the new presale's share words and link;
  - its Task 0: `check-bundle.sh` checks that the bundle holds this checkout's own screens, Metro keeps a cache per checkout, and every install runs the check first;
  - `app.json` already written by a JSON script (`JSON.stringify(j, null, 2) + "\n"`), with its release-signing plugin and App Links filter, so Task 1's script changes only the picker's entry;
  - its USER STEP B choice about release signing, recorded in Task 10's checklist line there: **(a)**, the agent's builds sign with the user's key. This plan's installs follow it (see Device below).
- **Test counts:** the phone's count before Task 2 is whatever `cd mobile && npm test` prints then (BEFORE). Nothing here hardcodes it. This plan adds 52 tests: 23 in `test/create.test.mjs` and 29 in `test/create-store.test.mjs`.
- **Checked while writing (a record, not a gate).** The second round's changes were not run in a copy at `6b9bbfe`, `df9abda`, `e81bb45`, `874b210` or `ef2e0f2`: the saved open and the read before a retry, `alreadyOpen`, `openPresale`'s unknown outcome after a 202, the share only after an open that succeeded here, and the Device wording. The third round's weren't either: the save before the wallet is asked, the copy in memory, the read before the commit check and its server-only 404, Start over, and the `trying` watch. Its check was read-only: each store, `JoinSheet.js` and `icons.js` anchor was counted at `ef2e0f2` (14 anchors, each found once), and piece 3's committed blocks were read, not applied: none of them holds or shares a line with any of these anchors, so each still matches once after piece 3. The checks below are from before them, on 2026-10-01 at HEAD `c38e1c4`, in a clean `git archive` of it in the scratchpad (and first at `8edc177` and `238150c`, with the same results but for the engine's count). Piece 3's blocks were applied by script first (68 edits), then this plan's (26: Task 1's `app.json` script, the new files, the store, `JoinSheet.js` and `icons.js` edits, and the tabs layout). Each anchor matched exactly once. The fourth round's changes (the coin saved again once the wallet signs and when an unknown is reported, and their tests) were not run either. Its check was read-only as well: the 14 anchors were counted again at `ccb0f94`, by a script that reads `git show HEAD:<file>`, and each was found once.
  - Task 1: the plugins print begins exactly as in Step 2, and the `app.json` diff after piece 3 is only the picker's lines. `mobile/node_modules/expo/bundledNativeModules.json` lists `expo-image-manipulator` `~55.0.21` and `expo-image-picker` `~55.0.24`.
  - `cd mobile && npm test`: `# pass 221`, `# fail 0`. That is 187 after piece 3 (BEFORE) plus the 34 new tests the plan had then: `create.test.mjs` 19, `create-store.test.mjs` 15. It has 52 now (23 and 29).
  - Failing first, as written: `create.test.mjs` with `ERR_MODULE_NOT_FOUND` for `rules.js`; `create-store.test.mjs` with `# fail 15` (`mintCoin`, `openCoin`, `openCost` not functions) before the store edits. With the fourth round's tests, Task 3 Step 2 expects `# fail 29` (not run).
  - `cd engine && npm test`: `# pass 384`, `# fail 0`: 369 at `c38e1c4`, plus piece 3's 15. `6b9bbfe`, `df9abda`, `0c1cad3`, `e81bb45`, `874b210`, `5ba106a` and `ef2e0f2` change engine tests; that count wasn't taken. This plan changes nothing in `engine/`.
  - The parse check passes on `create.js`, `_layout.js`, the six files of Task 6, `picture.js`, `Chip.js`, `JoinSheet.js`, `icons.js` and `store.js`, with piece 3's screen files. `JoinSheet.js` has no `Pressable`, `F.` or `R.` left, and keeps `Haptics`.
  - Not run: `expo install`, prebuild, any Metro bundle and the device steps. `node_modules` were symlinks from the repo, used only by `node --test`, and removed afterwards.
- If piece 3 and this plan run back to back, one `prebuild --clean` can cover both pieces. This plan still gets its own APK pass (Tasks 1 and 7).

---

## Ground rules for every task

- **Branch and commits.** Work on `feat/mooner-wireframe`. Commit after each task with the command given: `git add <files> && git commit -m "…" -- <files>`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit or print** `.env` files, anything under `engine/.mainnet`, keypair files, `site/`, `launch-test/`, `launch.py` or `.claude/`. Never touch `engine/.mainnet`, keypairs or `.env` files. Stage files by name, never `git add -A` or `git add .`.
- **Piece 2's files.** Piece 2 owns `mobile/app/coin/[key].js` and `mobile/src/launched/` (its `TradeSheet.js` among them). This plan never edits them.
- **Dirty files.** Before a task edits a shared file (`mobile/src/store.js`, `mobile/test/store.test.mjs`, `mobile/src/room/JoinSheet.js`, `mobile/src/ui/icons.js`, `mobile/app/(tabs)/_layout.js`, `mobile/app.json`, `mobile/src/ui/Chip.js`), its Step 0 runs `git diff --quiet HEAD -- <those files>`. If that fails, another session has uncommitted changes there: stop and report. Never stash them, and never commit another piece's changes.
- **Servers.** Never start dev servers, the local engine server, or Metro. The only exceptions are `mobile/scripts/check-bundle.sh` and `mobile/scripts/run-android.sh`, where a step names them.
- **Bundles only in the repo's own `mobile/`.** Never run `check-bundle.sh`, `run-android.sh`, `expo export` or any Metro bundle from a copy, a git worktree or another checkout: another checkout's bundle can poison a shared Metro cache. Piece 3's Task 0 gives each checkout its own cache and makes the check fail when the bundle doesn't hold this checkout's screens.
- **Never deploy. Never send SOL. Never change Railway variables.** Production deploys, Railway variables, mainnet spends and signing keys belong to the user. Each is marked **USER STEP**.
- **Seed Vault is the user's.**
  - Opening a presale spends real mainnet SOL. The agent's device check goes only up to Seed Vault's approval screen.
  - The agent never taps, approves, declines or signs anything in Seed Vault, and never presses Back while it's up.
  - A real open is a USER STEP (Task 8), done with the user present.
- **The user's phone.**
  - The agent doesn't browse the phone's photo gallery: the user picks the picture.
  - The agent doesn't answer Android's permission dialogs: the user does.
  - The agent never picks a target in the share sheet (that sends a message).
- **Copy.** No game words ("players", "lobby", "match"). Say "Who's in" and "Auto-join" where those come up. The titles are Dev, KOL, Raider and Diamond Hands.
- **Real data only.** Real screens show only real data, with no placeholder numbers and no mock rows. A figure that isn't read yet shows a spinner, or "Not known yet" if its read failed.
- **Live data is pushed** over the socket and chain subscriptions; there are no client polling loops. One read when a screen opens or a step is reached is fine (the wallet's coins on focus, the open cost on the commit step); a timer that re-reads is not.
- **No durations or time estimates** anywhere: in code comments, commit messages or notes to the user.
- **Test commands:**
  - phone: `cd mobile && npm test` (node:test, `test/*.test.mjs`);
  - one phone file: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/<name>.test.mjs`;
  - engine: `cd engine && npm test` (this plan changes nothing in `engine/`, so it must stay at 0 fail);
  - bundle check: `cd mobile && sh scripts/check-bundle.sh` prints `web3.js copies: 1; files from engine/node_modules: 0`, then `app/ entries from this checkout: N` with N above 0 (piece 3's Task 0). It exits non-zero otherwise.
- **Parse check (screen files).** Files that import React Native can't run under Node, so each is parsed instead. Run from `mobile/`, with the files as arguments:

```bash
node -e 'const b = require("@babel/core"); const fs = require("fs"); for (const f of process.argv.slice(1)) b.parseSync(fs.readFileSync(f, "utf8"), { filename: f, sourceType: "module", configFile: false, babelrc: false, presets: ["@babel/preset-react"] }); console.log("parsed", process.argv.length - 1, "files")' <files>
```

It prints `parsed N files`. A syntax error throws instead.
- **Device.**
  - Build and install with `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh`: the bundle check right before every install, in the same `mobile/`. If the check fails, don't install.
  - Signing follows piece 3's USER STEP B choice, recorded in its Task 10 checklist line: **(a)**, the agent's builds sign with the user's key through Gradle. The agent never makes or changes that choice.
    - Before the user has done piece 3's USER STEP B: the command above, debug-signed as today.
    - Once USER STEP B is done, every `run-android.sh` build is release-signed: Gradle reads `MOONER_RELEASE_SIGN=1` from the user's `~/.gradle/gradle.properties`.
    - If B is done but piece 3's USER STEP C (the user removes the debug-signed app) is not, install nothing. Ask the user to do USER STEP C, and install only once they say it's done.
    - Whether B and C are done is what the user said during piece 3's Task 10. If that isn't known, ask the user before installing.
  - The agent never opens `~/.gradle/gradle.properties` or the keystore.
  - If an install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (the APK's key differs from the installed app's), stop and bring it to the user. Never run `adb uninstall`: it deletes the app's data, and it is the user's (piece 3's USER STEP C).
  - Take screenshots with `adb exec-out screencap -p > <scratchpad>/<name>.png`, where `<scratchpad>` is the session's scratchpad directory.
  - The Seeker's screen is 1200×2670, and `adb shell input tap X Y` uses the same pixels as the screenshot. Read X and Y from the latest screenshot.
  - Type with `adb shell input text "<text>"`, where `%s` is a space.
  - The phone is device `SM02E4072816959` (`adb devices`).
- **zustand selectors.** A selector passed to `useStore` returns a stable value: a primitive, or an object already in the state. Derived lists are made with `useMemo`.
- **Edit blocks.** Each "Replace … with …" block occurs exactly once in its file when you apply it. Apply a file's blocks in the order given. Blocks marked "Create" and "Replace all of" are the whole file. If a block isn't found because the file moved on, stop and adapt: read what changed, make the same change to the new code by hand, and say so in your report. Never force a block onto code it doesn't match.

## Server data shapes (checked against engine/server and app.mooner.family, 2026-10-01)

BigInts and PublicKeys arrive as strings.

- **`GET /api/info` → `numbers`** (mainnet, read 2026-10-01): `{ TARGET: "500000000", MIN_SEAT: "100000000", MAX_SEAT: "500000000", STEP: "10000000", DURATION: 3600, GRACE: 900 }`.
  - `flows.loadInfo()` turns the strings into BigInts (`info.N`). `DURATION` stays a number of seconds.
  - So the commit chips are 0.1, 0.25 and 0.4 SOL: the seat presets under the cap, then the cap, 0.5 − 0.1.
  - `mintMessage` lists the lines the wallet signs, starting `Mooner: create a token`.
- **`POST /api/mint`** (`engine/server/api.js` `mint`). It checks, in this order:
  1. the per-IP limit: 429 `too many token requests, try again later`;
  2. the openers list: 403 `this wallet can't open presales yet (closed beta)`. `MOONER_OPENER_WALLETS` is `*` in production today (anyone), so this only shows if the user changes it;
  3. the fields: name 1–32 bytes; symbol `^[A-Za-z0-9]{1,10}$`; description at most 600 bytes; links; image at most 2 MB and a PNG, JPEG, GIF or WebP;
  4. the time: 400 `time must be now, in unix seconds`;
  5. the signature: 401;
  6. a signature already used: 409;
  7. the per-wallet limit: 429;
  8. three unopened coins: 429 `N of your tokens aren't opened yet; open one of them first`, with body `{ unopened: [mints] }`;
  9. then it pins to IPFS: 502 if that fails.

  The reply is `{ mint, presale, name, symbol, image, uri }`.
- **`POST /api/cosign`.** For the open tx, the co-signer (`engine/src/cosigner.js`) refuses with 403 `{ error }`, for example `wallet not on the openers list`. `flows.openPresale` itself refuses a commit over `TARGET − MIN_SEAT` (`the creator can put in at most 0.4 SOL, so others can join`).
  - The wallet pays the fee (`signAndCosign(signTransaction, wallet, ixs)`).
  - Before sending, the server simulates the tx. A failure there is 400 `the tx fails: …` with body `{ logs }`, and a send that failed for certain is 400 too. Neither sent anything.
  - A simulation the RPC doesn't answer in 15 s is 503 `the network is slow, try again` (since `238150c`).
  - Since `0ebf9be`, every answer from before the send (`cosignChecked` in `api.js`: the checks, the co-signer's 403, the simulation's 400 and 503, even a 500) has `sent: false` in its body, beside `error` and any `logs`. Answers from after the send never do. `flows.signAndCosign` keeps a `sent: false` answer as a plain failure, and so does this plan (`mayHaveSent`, Task 2).
  - Since `6b9bbfe`, the same signed tx again, once it went out (the simulation says `AlreadyProcessed`, or `BlockhashNotFound` with the tx's status found), gets a 202 with no `sent` marker, before any send. A status read that fails there gets a 503 with no marker. Its text, `the network is slow, try again`, is the same as the simulation timeout's 503, and only the marker tells them apart: without it, the outcome is unknown.
  - A second open of a mint whose presale exists fails in the presale program itself. `create_pda` (`programs/presale/src/util.rs`, lines 107-108) returns the program's own `AlreadyExists` (28, `error.rs` line 36) when the presale's account is already there; it never reaches System's `already in use`. The litesvm test `one_presale_per_mint` expects 28.
    - The simulation's 400, with `sent: false`: `the tx fails: ix 1: AlreadyExists (28)`, and `logs` hold `Program <pid> failed: custom program error: 0x1c`.
    - Two opens racing on chain: the send's own 400 (no `sent` marker), `open (<sig>): ix 1: AlreadyExists (28)`, or `open (<sig>): ix 1 (<pid>): custom 28` when there are no logs.
    - `alreadyOpen(e, pid)` (`engine/src/opening.js`) reads these. None of them was produced on mainnet.
  - A presale that closed (launched or expired) leaves no account: `close` (`util.rs`, lines 142-146) empties it and gives it back to System, so the program would open the same mint again. The server still knows it: `GET /api/presale/<key>` answers with its record (`where: "closed"`) once the open was recorded (`markOpened`: after a confirmed open, or by the keeper's `syncOpened` once the presale is on chain). So a retry reads the presale first (Task 3).
  - Success is 200 `{ sig, confirmed: true, kind: "open", user, presale, mint }`, or 202 when the tx wasn't confirmed in time (or was the same tx again, above). On a 202 `flows.openPresale` waits for the presale to show. Since `6b9bbfe` a wait that ends throws `outcomeUnknown(sig, "open")` (`waitSent`, with the server's sig, else the signed tx's); before it, it threw `the presale didn't show up yet; refresh in a moment`. `openPresale` takes `waitMs` (default 90 000), and `openCoin` leaves the default.
  - On a confirmed open the server marks the coin opened and the keeper watches the presale. After a 202 it doesn't mark it, but the keeper's scan still finds the presale and pushes it over the socket.
- **Deadlines.** The API client's deadlines come from piece 2's fixes (`a552f42`). Every call gets 10 s, and a call that runs out is `ApiError(0, "the server didn't answer in N s")` with `timedOut: true`. `cosign` gets 90 s. Since `0ebf9be`, `flows.signAndCosign` keeps two kinds of cosign failure plain: an `ApiError` with a 4xx status, and one whose body says `sent: false`. Any other (no answer in time, a 5xx without `sent: false` from the server or a proxy, a network error, a reply that isn't JSON) becomes `outcomeUnknown(sig, "cosign")` (`engine/src/tx.js`). This plan relies on those and adds no deadlines of its own. `POST /api/mint` gets the default 10 s while the server pins to IPFS (see Self-review notes).
- **`GET /api/wallet/<wallet>/tokens`** → `{ tokens }`, newest first. Each is `{ mint, creator, name, symbol, description, links: { twitter?, telegram?, website? }, image, uri, createdAt, presale, openedAt }`. `presale` stays null until the open is recorded.
- **`GET /api/presale/<key>`** → the view: `state` (`OPEN`, …), `token`, and `seats: [{ seat, user, deposit, commit, settled, claimed, creator, where }]`.
  - A presale no longer on chain that the server recorded as opened gives `{ presale, where: "closed", state: "CLOSED", token, launch, seats: [] }`. One it doesn't know at all is a 404 whose body is `{ error: "no such presale" }`:
    - it comes from `api.js` line 259, in `onePresale` (lines 255-261): `if (!token) throw new HttpError(404, "no such presale");`;
    - `http.js` line 173 sends it as `{ error: e.message, ...e.extra }`, and `apiclient.js` line 46 makes it `ApiError(404, "no such presale", body)`.

    Other 404s say other things. `http.js`'s own 404 for a path no route has is `not found` (line 166). A proxy's 404 that isn't JSON becomes `the server said 404`, with a null body. Only the first one means the server knows no such presale (`NO_SUCH_PRESALE`, Task 2).
- **What an open costs besides the commit.** These are mainnet's rents on 2026-10-01, with Seed Vault's 100k µLamports priority (`flows.openCost`): 8,817,340 lamports. That is the presale 2,032,000, the seat 1,259,840, the delegation 4,759,960, the fee 115,300 and the keep 650,240. So a 0.1 SOL open needs 0.10881734 SOL in the wallet. The screen shows "about 0.0088 SOL".
- **After the open.**
  - The creator can't lower or take back their commit (`CreatorCannotLower`).
  - If the pool doesn't fill before the presale's end (`DURATION`), it expires and the keeper sends the commit back by itself.
  - Whether the open's rent comes back is not known (see Self-review notes).

## File map

**Phone (mobile/):**
- Modify `package.json`, `package-lock.json` (expo-image-picker, expo-image-manipulator) and `app.json` (the picker's plugin: no microphone, the crop screen in the app's colours).
- Create `src/create/rules.js`: the form's rules, the commit's bounds, tickers in use, unopened coins, errors in words, the picture's checks.
- Create `src/create/share.js`: the new presale's share words, through piece 3's `shareOf` (its link carries `?ref=<wallet>`).
- Modify `src/store.js`:
  - `openCost`, `mintCoin`;
  - `openCoin`: the coin is saved for the wallet as `opening` before the wallet is asked, and again once it has signed. An unknown outcome after signing stays unknown and keeps it, saved again as of the report. A retry reads the presale first and hands that read back for Start over;
  - `forgetOpening(wallet, presale)`;
  - a copy of the saved open in memory;
  - busy kind `"create"`.
- Create `src/create/picture.js`: camera, gallery, Android's pending result, the square JPEG.
- Create `src/ui/Chip.js` (moved out of `src/room/JoinSheet.js`, which then imports it), with an optional `label` for screen readers. Modify `src/ui/icons.js` (`PlusIcon`).
- Create `src/create/Field.js`, `src/create/PictureStep.js`, `src/create/DetailsStep.js`, `src/create/CommitStep.js`, `src/create/ReviewStep.js`, `src/create/Unopened.js`.
- Create `app/(tabs)/create.js`. Modify `app/(tabs)/_layout.js` (the Create tab, between Launched and Me).
- Create `test/create.test.mjs` (23 tests) and `test/create-store.test.mjs` (29 tests).

**Docs:** at the end, a piece 4 status line in the spec.

---

### Task 1: The picture packages and a new native build

**Files:**
- Modify: `mobile/package.json`, `mobile/package-lock.json` (via `npx expo install`)
- Modify: `mobile/app.json`

- [ ] **Step 0: Check the files are clean**

Run: `git diff --quiet HEAD -- mobile/app.json mobile/package.json mobile/package-lock.json && echo clean`
Expected: `clean`. If not, stop and report (Dirty files).

Run: `git cat-file -e HEAD:engine/src/opening.js && git cat-file -e HEAD:engine/test/opening.test.js && git grep -n "alreadyOpen" HEAD -- engine/src/opening.js`
Expected: lines from `engine/src/opening.js`, one of them exporting `alreadyOpen`. If either file isn't in HEAD, stop and report: Task 2's `createError` needs it; it came with `df9abda`. Read its doc comment as well. If it doesn't take `(error, pid)` with the program's key in base58, stop and report.

Run: `cd engine && node --test test/opening.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 0`.

- [ ] **Step 1: Install the SDK 55 versions**

Run: `cd mobile && npx expo install expo-image-picker expo-image-manipulator`

Run: `cd mobile && grep -n '"expo-image' package.json`
Expected:
```
"expo-image-manipulator": "~55.0.21",
"expo-image-picker": "~55.0.24",
```
These are the versions in `mobile/node_modules/expo/bundledNativeModules.json` for SDK 55. If either differs, stop and report.

`expo install` may add a plain `"expo-image-picker"` entry to `app.json`'s plugins on its own. The next step replaces that entry in place, or adds one if there is none. `expo-image-manipulator` has no config plugin.

- [ ] **Step 2: Configure the picker's plugin**

The plugin's options:
- `microphonePermission: false`: Android's `RECORD_AUDIO` is blocked. The picker adds it otherwise, and Mooner records no sound.
- The crop screen's colours: the app's `bg1`, `text0` and `bg0` (`src/ui/theme.js`), for both light and dark.
- `CAMERA` comes from the library's own manifest, so it needs no option. Setting `cameraPermission: false` would block it.

Run from `mobile/`:

```bash
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("app.json", "utf8"));
const crop = { cropToolbarColor: "#0d0e12", cropToolbarIconColor: "#f3f4f6", cropToolbarActionTextColor: "#f3f4f6", cropBackButtonIconColor: "#f3f4f6", cropBackgroundColor: "#07080b" };
const want = ["expo-image-picker", { microphonePermission: false, colors: crop, dark: { colors: crop } }];
const at = j.expo.plugins.findIndex((p) => (Array.isArray(p) ? p[0] : p) === "expo-image-picker");
if (at === -1) j.expo.plugins.push(want);
else j.expo.plugins[at] = want;
fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");
'
```

Run: `cd mobile && node -e 'console.log(JSON.stringify(require("./app.json").expo.plugins))'`
Expected:
```
[["expo-router",{"sitemap":false}],"expo-secure-store","expo-font","./plugins/withReleaseSigning",["expo-image-picker",{"microphonePermission":false,"colors":{"cropToolbarColor":"#0d0e12","cropToolbarIconColor":"#f3f4f6","cropToolbarActionTextColor":"#f3f4f6","cropBackButtonIconColor":"#f3f4f6","cropBackgroundColor":"#07080b"},"dark":{"colors":{"cropToolbarColor":"#0d0e12","cropToolbarIconColor":"#f3f4f6","cropToolbarActionTextColor":"#f3f4f6","cropBackButtonIconColor":"#f3f4f6","cropBackgroundColor":"#07080b"}}}]]
```
`./plugins/withReleaseSigning` is piece 3's. Piece 3's App Links filter is under `expo.android.intentFilters`, not in the plugins, so it doesn't show here. If another plugin was added since, it shows too; what matters is that the `expo-image-picker` entry is exactly this one.

Run: `git diff --stat -- mobile/app.json`
Expected: only the picker's lines change. Piece 3 already wrote the file in this format, so nothing else is reformatted.

- [ ] **Step 3: Regenerate the native project**

New native modules and a changed plugin need a fresh `android/`. `android/` is git-ignored, so nothing tracked changes. Expo's prebuild asks before running on a dirty git tree; `EXPO_NO_GIT_STATUS=1` skips the question.

Run: `cd mobile && EXPO_NO_GIT_STATUS=1 npx expo prebuild --platform android --clean`
Expected: it ends without an error and `mobile/android/` exists again.

Run: `cd mobile && grep -n "RECORD_AUDIO" android/app/src/main/AndroidManifest.xml`
Expected: one line, for `android.permission.RECORD_AUDIO`, with `tools:node="remove"`

Run: `cd mobile && grep -c "expoCrop" android/app/src/main/res/values/colors.xml android/app/src/main/res/values-night/colors.xml`
Expected: `5` for each file

Piece 3's parts of the native project are still there:

Run: `cd mobile && grep -c 'android:autoVerify="true"' android/app/src/main/AndroidManifest.xml`
Expected: `1` (the App Links filter)

Run: `cd mobile && grep -n "mooner: release signing\|MOONER_RELEASE_SIGN" android/app/build.gradle`
Expected: three lines, as in piece 3's Task 8 Step 7: the mark `// mooner: release signing`, `if (project.findProperty('MOONER_RELEASE_SIGN') == '1') {`, and `signingConfig(project.findProperty('MOONER_RELEASE_SIGN') == '1' ? signingConfigs.release : signingConfigs.debug)`.

If a check doesn't match, stop and report what the files hold.

- [ ] **Step 4: Bundle check, then build and install**

Run: `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh` (after piece 3's USER STEP B and before its USER STEP C, install nothing; see Device in the ground rules)
Expected: `web3.js copies: 1; files from engine/node_modules: 0`, `app/ entries from this checkout:` above 0, then `BUILD SUCCESSFUL`, and the app opens on the phone. On `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, stop and bring it to the user.

- [ ] **Step 5: Read the permissions**

Run: `adb shell dumpsys package family.mooner.app | grep -E "android.permission.(CAMERA|RECORD_AUDIO)"`
Expected: lines for `android.permission.CAMERA` (requested, `granted=false` until the user allows it) and none for `RECORD_AUDIO`.

Take a screenshot (`create-t1-live.png`). Expected: the Live tab, as before this task. Nothing on screen has changed yet.

- [ ] **Step 6: Phone tests still pass**

Run: `cd mobile && npm test`
Expected: 0 fail, the same pass count as before this task.

- [ ] **Step 7: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json && git commit -m "mobile: expo-image-picker and expo-image-manipulator for a coin's picture; no microphone; the crop screen in the app's colours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/package.json mobile/package-lock.json mobile/app.json
```

---

### Task 2: Create's rules and its share words

**Files:**
- Create: `mobile/src/create/rules.js`, `mobile/src/create/share.js`
- Test: `mobile/test/create.test.mjs`

An open whose outcome isn't known:
- Once the wallet has signed the open, any failure except the server's refusal (an `ApiError` with status 400, 403 or 429, or one whose body says `sent: false`: nothing was sent) may mean the tx went out. That covers a network error, a 5xx without `sent: false`, the API client's deadline (`timedOut`, status 0), the co-signer's own `outcomeUnknown`, and a 202 whose wait ends: `outcomeUnknown(sig, "open")` since `6b9bbfe` (passed on as it is, with its `sig`), `the presale didn't show up yet` before it.
- Since `0ebf9be`, `flows.signAndCosign` already turns every cosign failure into `outcomeUnknown` except a 4xx or an answer that says `sent: false`. `mayHaveSent` reads `sent: false` the same way, so a slow simulation's 503 stays a plain failure, in the server's words. `openFailure` still matters: it covers the wait after a 202, which isn't the cosign, and it treats a 4xx other than 400, 403 and 429 (http.js's 404, 405 or 413, which come before the route runs) as unknown, the safe side.
- `openFailure` turns such a failure into `tx.js`'s `outcomeUnknown`, whose words are OUTCOME_UNKNOWN: "We couldn't tell if it went through. Check your wallet before you try again."
- The screen then keeps the coin, retries only that mint (`presaleKeyOf` gives its presale's key) and watches the presale (`openLanded`). Back stays put meanwhile (`backAction`).
- A retry of an open that had landed is refused by the presale program's `AlreadyExists` (28): in the server's simulation, or in the send when two opens race. `createError(e, pid)` reads that through `alreadyOpen` (`engine/src/opening.js`) as ALREADY_OPEN, and the screen goes to the room. ALREADY_OPEN's words, "This coin's presale was already opened.", hold for a presale that has closed since too.
- The store's own read before a retry (Task 3) goes through `checkBeforeRetry`:
  - "open" when the server knows the presale in any state, so ALREADY_OPEN;
  - "retry" only on the server's own 404, whose body's `error` is exactly `NO_SUCH_PRESALE` ("no such presale", `api.js` line 259);
  - "unknown" for anything else (another 404, a 5xx, a timeout, a network error), so RETRY_UNCHECKED.
- `canStartOver(record, read, now)` is the one way to leave a saved coin for a new one. It needs both:
  - the read before a retry got the server's own 404;
  - that read was asked more than `START_OVER_MS` (5 minutes) after the coin was last saved (`at`). The store saves it before the wallet is asked, again once the wallet has signed, and again when an unknown outcome is reported (Task 3), so a prompt held a long time doesn't count against the wait.

  Anything else is no.
- `keptCommitProblem` words a saved commit that the presale numbers no longer take. A retry can't change it: the commit is fixed for its mint.
- `isOpening` tells a whole saved record from a broken one.
- `OPEN_PENDING` refuses another coin while one is saved.
- `restoredOpen` turns the store's saved open (Task 3) back into the screen's state: the coin, its form and picture, the commit, and the presale to watch, on the last look with Back locked.

The rules match the website's (`web/src/lib/launch.ts`):
- the name: 2–32 characters;
- the ticker: 2–10 capital letters or digits;
- the description: at most 280 characters;
- links: a bare `@handle` becomes an X or Telegram address, and a bare domain gets `https://`.

The phone adds the server's byte limits (name 32, description 600, links 120 bytes), so a name full of emoji is caught on the phone and not refused by the server. The commit cap is the co-signer's: at most `TARGET − MIN_SEAT`, so another seat always fits.

- [ ] **Step 1: Record the phone's test count**

Run: `cd mobile && npm test 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 0`. Write down the pass count as BEFORE. Don't take it from this plan: it changes as other pieces land.

- [ ] **Step 2: Write the failing test**

Create `mobile/test/create.test.mjs`:

```js
// Create's rules (src/create/rules.js), an open whose outcome isn't known, and the new
// presale's share words (src/create/share.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { ApiError } from "../../engine/src/apiclient.js";
import { OUTCOME_UNKNOWN, outcomeUnknown } from "../../engine/src/tx.js";
import {
  ALREADY_OPEN, NO_SUCH_PRESALE, OPEN_PENDING, RETRY_UNCHECKED, START_OVER_MS, backAction, blankDraft, canStartOver, checkBeforeRetry,
  cleanDescription, cleanName, commitBounds, commitChoices, commitProblem, createError, draftOf, hasErrors, imageProblem, isOpening,
  isUnknown, keptCommitProblem, linkHref, mayHaveSent, mintFields, normalizeTicker, openFailure, openLanded, presaleKeyOf,
  restoredOpen, shortOfOpen, squareOf, takenTickers, unopenedOf, utf8Length, validate,
} from "../src/create/rules.js";
import { newPresaleShare } from "../src/create/share.js";

const N = { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n };
const BIG = { TARGET: 10_000_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 1_000_000_000n, STEP: 10_000_000n };
const draft = (over = {}) => ({ ...blankDraft(), name: "Moon Dog", ticker: "MDOG", ...over, links: { ...blankDraft().links, ...over.links } });
const PID = "6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa"; // the presale program (mainnet)
const OPENER = "This wallet can't open presales yet. Mooner lets a short list of wallets open them for now; you can still join any presale.";

test("normalizeTicker: capital letters and digits only", () => {
  assert.equal(normalizeTicker("$moon"), "MOON");
  assert.equal(normalizeTicker("m00n dog!"), "M00NDOG");
  assert.equal(normalizeTicker("ñ"), "");
});

test("utf8Length: bytes, as the server counts them", () => {
  assert.equal(utf8Length("abc"), 3);
  assert.equal(utf8Length("é"), 2);
  assert.equal(utf8Length("€"), 3);
  assert.equal(utf8Length("🚀"), 4);
});

test("cleanName and cleanDescription: what the server accepts", () => {
  assert.equal(cleanName("  Moon\tDog\n "), "Moon Dog");
  assert.equal(cleanName("Moon   Dog"), "Moon Dog");
  assert.equal(cleanDescription(" one\r\ntwo\rthree\tfour\u0007 "), "one\ntwo\nthree four");
});

test("linkHref: handles, bare domains and https links; nothing else", () => {
  assert.equal(linkHref("x", "@moondog"), "https://x.com/moondog");
  assert.equal(linkHref("x", "moondog"), "https://x.com/moondog");
  assert.equal(linkHref("telegram", "@moon_dog"), "https://t.me/moon_dog");
  assert.equal(linkHref("website", "moondog.xyz"), "https://moondog.xyz");
  assert.equal(linkHref("website", "https://moondog.xyz/about?a=1#top"), "https://moondog.xyz/about?a=1#top");
  assert.equal(linkHref("x", " x.com/moondog "), "https://x.com/moondog");
  assert.equal(linkHref("website", "  "), null);
  const bad = ["moondog", "@moondog", "http://moondog.xyz", "ftp://moondog.xyz", "https://user@moondog.xyz", "https://moondog.xyz:8080", "localhost:3000", "https://moon dog.xyz", "javascript:alert(1)"];
  for (const v of bad) assert.equal(linkHref("website", v), null, v);
  // the server takes a link when Node's new URL parses it as https (engine/server/api.js parseLinks)
  const serverTakes = (href) => {
    try {
      return new URL(href).protocol === "https:";
    } catch {
      return false;
    }
  };
  for (const host of ["999.1", "1.2.3.4.5", "xn--a.com"]) {
    assert.equal(serverTakes(`https://${host}`), false, `the server refuses ${host}`);
    assert.equal(linkHref("website", host), null, host);
  }
  for (const host of ["moondog.xyz", "app.moondog.xyz", "MoonDog.XYZ"]) {
    const href = linkHref("website", host);
    assert.equal(href, `https://${host}`, host);
    assert.equal(serverTakes(href), true, `the server takes ${host}`);
  }
});

test("validate: name, ticker, description and links", () => {
  assert.deepEqual(validate(draft()), {});
  assert.equal(validate(draft({ name: " M " })).name, "At least 2 characters");
  assert.equal(validate(draft({ name: "M".repeat(33) })).name, "At most 32 characters");
  assert.equal(validate(draft({ name: "é".repeat(17) })).name, "Too long: emoji and accented letters take more room");
  assert.equal(validate(draft({ ticker: "M" })).ticker, "2–10 letters or digits");
  assert.equal(validate(draft({ ticker: "ABCDEFGHIJK" })).ticker, "2–10 letters or digits");
  assert.equal(validate(draft({ ticker: "mdog" }), { taken: new Set(["MDOG"]) }).ticker, "$MDOG is taken");
  assert.equal(validate(draft({ description: "a".repeat(281) })).description, "At most 280 characters");
  assert.equal(validate(draft({ description: "€".repeat(201) })).description, "Too long: emoji and accented letters take more room");
  assert.deepEqual(validate(draft({ links: { x: "http://x.com/a", telegram: "@", website: "moondog" } })), {
    x: "Enter an X link or @handle",
    telegram: "Enter a Telegram link or @handle",
    website: "Enter a web address",
  });
  assert.equal(validate(draft({ links: { website: `moondog.xyz/${"a".repeat(120)}` } })).website, "At most 120 characters");
  assert.equal(hasErrors({}), false);
  assert.equal(hasErrors({ name: "At least 2 characters" }), true);
});

test("mintFields: what the wallet signs and the server stores", () => {
  const d = draft({ name: " Moon  Dog ", ticker: "$mdog", description: " hi\r\nthere ", links: { x: "@moondog", website: "moondog.xyz" } });
  assert.deepEqual(mintFields(d), {
    name: "Moon Dog",
    symbol: "MDOG",
    description: "hi\nthere",
    links: { twitter: "https://x.com/moondog", telegram: "", website: "https://moondog.xyz" },
  });
});

test("draftOf: an issued coin back as the form, and the same fields again", () => {
  const token = { mint: "M1", name: "Moon Dog", symbol: "MDOG", description: "hi", links: { twitter: "https://x.com/moondog" }, presale: null };
  const d = draftOf(token);
  assert.deepEqual(d, { name: "Moon Dog", ticker: "MDOG", description: "hi", links: { x: "https://x.com/moondog", telegram: "", website: "" } });
  assert.deepEqual(mintFields(d).links, { twitter: "https://x.com/moondog", telegram: "", website: "" });
});

test("commit: at most TARGET − MIN_SEAT, so another seat fits", () => {
  assert.deepEqual(commitBounds(N), { min: 100_000_000n, max: 400_000_000n, step: 10_000_000n });
  assert.deepEqual(commitChoices(N), [100_000_000n, 250_000_000n, 400_000_000n]);
  assert.deepEqual(commitChoices(BIG), [100_000_000n, 250_000_000n, 500_000_000n, 1_000_000_000n]);
  assert.equal(commitProblem(100_000_000n, N), null);
  assert.equal(commitProblem(400_000_000n, N), null);
  for (const bad of [90_000_000n, 410_000_000n, 500_000_000n, 105_000_000n, 100_000_000]) {
    assert.equal(commitProblem(bad, N), "Pick 0.1 to 0.4 SOL, so others have room to join.", String(bad));
  }
});

test("shortOfOpen: the commit plus fees and rent against the wallet", () => {
  assert.equal(shortOfOpen(100_000_000n, 8_800_000n, 200_000_000), null);
  assert.equal(shortOfOpen(100_000_000n, null, 1), null); // cost not read yet
  assert.equal(shortOfOpen(100_000_000n, 8_800_000n, null), null); // wallet not read yet
  assert.equal(
    shortOfOpen(100_000_000n, 8_800_000n, 100_000_000),
    "You need 0.109 SOL to open this (your commit plus about 0.0088 SOL in fees and rent). You have 0.1.",
  );
  // a balance reply without `lamports` (apiclient.js balance: Number(undefined)) is not read
  assert.equal(shortOfOpen(100_000_000n, 8_800_000n, Number.NaN), null);
  assert.equal(shortOfOpen(100_000_000n, 8_800_000n, Number.POSITIVE_INFINITY), null);
});

test("takenTickers: presales in play and launched coins; an expired one's is free", () => {
  const presales = {
    A: { presale: "A", state: "OPEN", token: { symbol: "MDOG" } },
    B: { presale: "B", state: "EXPIRED", token: { symbol: "OLD" } },
    C: { presale: "C", state: "FULL", token: { symbol: "cat" } },
    D: { presale: "D", state: "OPEN", token: null },
    F: { presale: "F", state: "LAUNCHING", token: { symbol: "FOX" } },
    G: { presale: "G", state: "SETTLED", token: { symbol: "GNU" } },
  };
  const launched = { E: { presale: "E", token: { symbol: "PUP" } } };
  assert.deepEqual([...takenTickers({ presales, launched })].sort(), ["CAT", "FOX", "GNU", "MDOG", "PUP"]);
});

test("unopenedOf: the wallet's coins no presale has opened", () => {
  const tokens = [{ mint: "M1", presale: null }, { mint: "M2", presale: "P2" }, { mint: "M3", presale: null }];
  const presales = { P3: { presale: "P3", token: { mint: "M3" } } };
  assert.deepEqual(unopenedOf(tokens, presales).map((t) => t.mint), ["M1"]);
  assert.deepEqual(unopenedOf(null, {}), []);
});

test("createError: the server's and the wallet's refusals in plain words", () => {
  assert.equal(createError(new ApiError(403, "this wallet can't open presales yet (closed beta)", {})), OPENER);
  assert.equal(createError(new ApiError(403, "wallet not on the openers list", {})), OPENER);
  assert.equal(createError(Object.assign(new Error("transaction not signed"), { code: -3 })), "You cancelled it in your wallet.");
  assert.equal(createError(Object.assign(new Error("authorization failed"), { code: -1 })), "You cancelled it in your wallet.");
  assert.equal(createError(new Error("User rejected the request")), "You cancelled it in your wallet.");
  assert.equal(
    createError(new ApiError(429, "3 of your tokens aren't opened yet; open one of them first", { unopened: ["A", "B", "C"] })),
    "3 of your coins aren't open yet. Open one of them first: they're at the top of Create.",
  );
  assert.equal(createError(new ApiError(429, "too many token requests from this wallet, try again later", {})), "Too many tries from here for now. Try again later.");
  assert.equal(createError(new ApiError(401, "the signature doesn't match this wallet and these details", {})), "The wallet's signature didn't match the coin's details. Try again.");
  assert.equal(createError(new ApiError(409, "this signed request was already used", {})), "That signature was already used. Try again.");
  assert.equal(createError(new ApiError(502, "IPFS: pin failed; try again", {})), "Couldn't save the picture and details to IPFS. Try again.");
  // only the mint's own 502 (api.js: `IPFS: …; try again`) is about IPFS; a proxy's 502 is not
  assert.equal(createError(new ApiError(502, "the server said 502", null)), "the server said 502");
  assert.equal(createError(new ApiError(502, "bad gateway", { error: "bad gateway" })), "bad gateway");
  assert.equal(createError(new ApiError(400, "time must be now, in unix seconds", {})), "Your phone's clock is off. Turn on automatic date and time, then try again.");
  assert.equal(
    createError(new ApiError(400, "the name, symbol and link make the launch tx 1240 bytes (max 1232)", {})),
    "The name and ticker are too long together. Make the name shorter.",
  );
  assert.equal(createError(new ApiError(403, "the creator can put in at most 0.4 SOL, so others can join", {})), "the creator can put in at most 0.4 SOL, so others can join");
  assert.equal(createError(outcomeUnknown("SIG", "open")), OUTCOME_UNKNOWN);
  // a second presale for the mint: the program's own AlreadyExists (28), never System's "already in use"
  const logs = [`Program ${PID} invoke [1]`, `Program ${PID} failed: custom program error: 0x1c`];
  const simulated = new ApiError(400, "the tx fails: ix 1: AlreadyExists (28)", { error: "the tx fails: ix 1: AlreadyExists (28)", logs, sent: false });
  assert.equal(createError(simulated, PID), ALREADY_OPEN, "the server's simulation");
  const raced = new ApiError(400, "open (SIG): ix 1: AlreadyExists (28)", { error: "open (SIG): ix 1: AlreadyExists (28)", sig: "SIG", logs });
  assert.equal(createError(raced, PID), ALREADY_OPEN, "two opens raced: the send's own 400");
  const bare = new ApiError(400, `open (SIG): ix 1 (${PID}): custom 28`, { sig: "SIG", logs: [] });
  assert.equal(createError(bare, PID), ALREADY_OPEN, "no logs: the code and who raised it");
  const other = new ApiError(400, "the tx fails: ix 1 (11111111111111111111111111111111): custom 28", { logs: [], sent: false });
  assert.notEqual(createError(other, PID), ALREADY_OPEN, "another program's 28");
  const system = new ApiError(400, "the tx fails: ix 2 (11111111111111111111111111111111): custom 0", {
    logs: ["Allocate: account Address { address: Pre1, base: None } already in use"],
  });
  assert.notEqual(createError(system, PID), ALREADY_OPEN, "System's own words aren't the program's refusal");
  assert.equal(createError(new Error(ALREADY_OPEN)), ALREADY_OPEN, "the store's read before a retry");
  assert.equal(ALREADY_OPEN, "This coin's presale was already opened.", "true for a presale that closed since too");
  assert.equal(createError(new Error(RETRY_UNCHECKED)), RETRY_UNCHECKED);
  assert.equal(createError(new Error(OPEN_PENDING)), OPEN_PENDING, "the store refuses another coin while one is saved");
  assert.equal(
    createError(new ApiError(400, "the tx fails: Transaction results in an account (0) with insufficient funds for rent", { logs: [] })),
    "Your wallet needs a little more SOL to cover rent and the Solana fee.",
  );
});

test("openFailure: after the wallet signed, anything but the server's refusal is an unknown outcome", () => {
  const late = Object.assign(new ApiError(0, "the server didn't answer in 10 s"), { timedOut: true });
  const unknown = [
    new TypeError("Network request failed"),
    new ApiError(502, "bad gateway", {}),
    late,
    new Error("the presale didn't show up yet; refresh in a moment"),
  ];
  for (const e of unknown) {
    assert.equal(mayHaveSent(e), true, e.message);
    const out = openFailure(e, true);
    assert.equal(out.outcomeUnknown, true, e.message);
    assert.equal(out.message, OUTCOME_UNKNOWN, e.message);
  }
  const cosign = outcomeUnknown("SIG", "cosign");
  assert.equal(openFailure(cosign, true), cosign, "the co-signer's own unknown passes as it is");
  const waited = outcomeUnknown("SIG", "open");
  assert.equal(openFailure(waited, true), waited, "the wait after a 202 ended (flows.js waitSent, since 6b9bbfe): as it is");
  assert.equal(openFailure(waited, true).sig, "SIG");
  for (const status of [400, 403, 429]) {
    const e = new ApiError(status, "refused", {});
    assert.equal(mayHaveSent(e), false, String(status));
    assert.equal(openFailure(e, true), e, `a ${status}: the server sent nothing`);
  }
  // http.js's own 4xx from before a route runs (no route, wrong method, a body too big): not
  // the server's refusal, so the safe side
  for (const status of [404, 405, 413]) {
    const e = new ApiError(status, "refused", {});
    assert.equal(mayHaveSent(e), true, String(status));
    assert.equal(openFailure(e, true).outcomeUnknown, true, String(status));
  }
  const slow = new ApiError(503, "the network is slow, try again", { error: "the network is slow, try again", sent: false });
  assert.equal(mayHaveSent(slow), false, "an answer from before the send says sent: false");
  assert.equal(openFailure(slow, true), slow, "a 503 with sent: false: the server sent nothing");
  const before = new TypeError("Network request failed");
  assert.equal(openFailure(before, false), before, "before the wallet signed, nothing can have gone out");
  assert.equal(isUnknown(OUTCOME_UNKNOWN), true);
  assert.equal(isUnknown("You cancelled it in your wallet."), false);
});

test("presaleKeyOf: the presale's key from the program and the mint, as the chain derives it", () => {
  const info = { pid: new PublicKey("6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa") };
  assert.equal(presaleKeyOf(info, "So11111111111111111111111111111111111111112"), "9BatUyfhMsGHAQ5PpR9CT5C5tGzrbppmZkkCu29onKWz");
});

test("backAction: nothing while an open runs or its outcome is unknown; else a step back, or a fresh start from an issued coin's commit", () => {
  assert.equal(backAction({ at: 0, locked: false, issued: false, step: "picture" }), "leave");
  assert.equal(backAction({ at: 1, locked: false, issued: false, step: "details" }), "previous");
  assert.equal(backAction({ at: 2, locked: false, issued: true, step: "commit" }), "restart");
  assert.equal(backAction({ at: 3, locked: false, issued: true, step: "review" }), "previous");
  assert.equal(backAction({ at: 3, locked: true, issued: true, step: "review" }), "stay");
  assert.equal(backAction({ at: 0, locked: true, issued: false, step: "picture" }), "stay", "locked wins, even on the first step");
});

test("openLanded: the watched presale's snapshot or its row in the list means the open landed", () => {
  const view = { presale: "Pre1", state: "OPEN" };
  assert.equal(openLanded(null, { views: { Pre1: view }, presales: {} }), false, "nothing watched");
  assert.equal(openLanded("Pre1", { views: {}, presales: {} }), false);
  assert.equal(openLanded("Pre1", { views: { Pre1: null }, presales: {} }), false, "no state: not there yet");
  assert.equal(openLanded("Pre1", { views: { Pre1: view }, presales: {} }), true, "a presale snapshot");
  assert.equal(openLanded("Pre1", { views: {}, presales: { Pre1: view } }), true, "the list has it");
});

test("restoredOpen: a saved open whose outcome wasn't known comes back on the last look, locked to its coin", () => {
  assert.equal(restoredOpen(null), null);
  assert.equal(restoredOpen(undefined), null);
  assert.equal(restoredOpen({ mint: "Mint1", presale: "Pre1" }), null, "not a whole record");
  const saved = {
    mint: "Mint1",
    presale: "Pre1",
    name: "Moon Dog",
    symbol: "MDOG",
    description: "",
    links: { twitter: "https://x.com/moondog", telegram: "", website: "" },
    image: "https://gw/ipfs/img",
    commit: "100000000",
    at: 1_790_000_000_000,
  };
  assert.equal(isOpening(saved), true);
  assert.equal(isOpening({ ...saved, commit: "0.1" }), false, "the commit is whole lamports");
  assert.equal(isOpening({ ...saved, commit: "0" }), false, "a commit of more than 0");
  assert.equal(isOpening({ ...saved, symbol: "" }), false, "a ticker");
  assert.equal(isOpening({ ...saved, symbol: " " }), false, "a ticker, not blanks");
  assert.equal(restoredOpen({ ...saved, commit: "0" }), null);
  assert.equal(isOpening({ ...saved, at: undefined }), true, "a missing at still locks; canStartOver never lets it go");
  const r = restoredOpen(saved);
  assert.equal(r.step, "review");
  assert.equal(r.coin, saved);
  assert.equal(r.unknown, "Pre1", "its presale is watched");
  assert.equal(r.commit, 100_000_000n);
  assert.deepEqual(r.picture, { uri: "https://gw/ipfs/img", bytes: null });
  assert.deepEqual(r.draft, draftOf(saved));
  assert.equal(r.error, OUTCOME_UNKNOWN);
  // the screen's last look is step 3; an unknown outcome locks it, so Back stays put
  assert.equal(backAction({ at: 3, locked: !!r.unknown, issued: !!r.coin, step: r.step }), "stay");
});

/** A read before a retry (GET /api/presale) that throws `e`. */
const failsWith = (e) => async () => {
  throw e;
};
/** The server's own 404 (engine/server/api.js onePresale), as apiclient.js throws it. */
const GONE = new ApiError(404, "no such presale", { error: "no such presale" });

test("checkBeforeRetry: a presale the server knows is open; only its own 404 lets a retry go on; anything else can't tell", async () => {
  assert.equal(NO_SUCH_PRESALE, "no such presale", "api.js onePresale: if (!token) throw new HttpError(404, \"no such presale\");");
  assert.equal(await checkBeforeRetry(async () => ({ presale: "Pre1", state: "OPEN", seats: [] })), "open");
  assert.equal(await checkBeforeRetry(async () => ({ presale: "Pre1", where: "closed", state: "CLOSED", seats: [] })), "open", "closed since");
  assert.equal(await checkBeforeRetry(failsWith(GONE)), "retry");
  assert.equal(await checkBeforeRetry(failsWith(new ApiError(404, "not found", { error: "not found" }))), "unknown", "http.js's 404 for a path no route has");
  assert.equal(await checkBeforeRetry(failsWith(new ApiError(404, "the server said 404", null))), "unknown", "a proxy's 404 that isn't JSON");
  assert.equal(await checkBeforeRetry(failsWith(new ApiError(502, "bad gateway", {}))), "unknown");
  const late = Object.assign(new ApiError(0, "the server didn't answer in 10 s", null), { timedOut: true });
  assert.equal(await checkBeforeRetry(failsWith(late)), "unknown");
  assert.equal(await checkBeforeRetry(failsWith(new TypeError("Network request failed"))), "unknown");
  assert.equal(await checkBeforeRetry(async () => null), "unknown", "no view: can't tell");
});

test("canStartOver: the server's own 404, asked more than START_OVER_MS after the coin was last saved; nothing else", async () => {
  const NOW = 1_790_000_000_000;
  const saved = (at) => ({ mint: "Mint1", presale: "Pre1", symbol: "MDOG", commit: "100000000", at });
  const old = saved(NOW - START_OVER_MS - 1);
  assert.equal(START_OVER_MS, 300_000);
  assert.equal(canStartOver(old, await checkBeforeRetry(failsWith(GONE)), NOW), true, "404 and old");
  assert.equal(canStartOver(saved(NOW - 60_000), await checkBeforeRetry(failsWith(GONE)), NOW), false, "404 and new: its open may still land");
  assert.equal(canStartOver(saved(NOW - START_OVER_MS), "retry", NOW), false, "exactly START_OVER_MS is not more");
  const reads = [
    [async () => ({ presale: "Pre1", state: "OPEN", seats: [] }), "a 200"],
    [failsWith(new ApiError(502, "bad gateway", {})), "a 5xx"],
    [failsWith(new TypeError("Network request failed")), "a read that threw"],
    [failsWith(new ApiError(404, "not found", { error: "not found" })), "another 404"],
  ];
  for (const [read, why] of reads) assert.equal(canStartOver(old, await checkBeforeRetry(read), NOW), false, why);
  for (const at of [undefined, null, "1000", 0, -5, 1.5, Number.NaN]) {
    assert.equal(canStartOver(saved(at), "retry", NOW), false, `at: ${String(at)}`);
  }
  assert.equal(canStartOver(null, "retry", NOW), false, "no record");
});

test("keptCommitProblem: a retry's saved commit against the presale numbers now, in one line", () => {
  assert.equal(keptCommitProblem(100_000_000n, N), null);
  assert.equal(keptCommitProblem(400_000_000n, N), null);
  assert.equal(keptCommitProblem(450_000_000n, N), "0.45 SOL is more than a seat can hold now.");
  assert.equal(keptCommitProblem(300_000_000n, { ...N, TARGET: 350_000_000n }), "0.3 SOL is more than a seat can hold now.");
  assert.equal(keptCommitProblem(105_000_000n, N), "0.105 SOL doesn't fit a seat now.");
  assert.equal(keptCommitProblem(90_000_000n, N), "0.09 SOL doesn't fit a seat now.");
});

test("squareOf: the centred square, at most 1024 px", () => {
  assert.deepEqual(squareOf(3000, 4000), { crop: { originX: 0, originY: 500, width: 3000, height: 3000 }, size: 1024 });
  assert.deepEqual(squareOf(801, 600), { crop: { originX: 100, originY: 0, width: 600, height: 600 }, size: 600 });
});

test("imageProblem: a JPEG or PNG of at most 2 MB", () => {
  const jpeg = (n) => {
    const b = new Uint8Array(n);
    b.set([0xff, 0xd8, 0xff]);
    return b;
  };
  const UNREAD = "That picture couldn't be read. Pick another.";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.equal(imageProblem(jpeg(1000)), null);
  assert.equal(imageProblem(Uint8Array.from([...png, 0])), null);
  assert.equal(imageProblem(new Uint8Array(0)), "Pick a picture.");
  assert.equal(imageProblem(null), "Pick a picture.");
  assert.equal(imageProblem(jpeg(2 * 1024 * 1024 + 1)), "That picture is over 2 MB. Pick another.");
  assert.equal(imageProblem(Uint8Array.from([1, 2, 3, 4])), UNREAD);
  // as the server's sniffImage: a PNG needs more than its 8-byte signature, all of it; a JPEG more than 3 bytes
  assert.equal(imageProblem(Uint8Array.from(png)), UNREAD, "the PNG signature alone");
  assert.equal(imageProblem(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])), UNREAD, "half a PNG signature");
  assert.equal(imageProblem(jpeg(3)), UNREAD, "a JPEG's three bytes alone");
  assert.equal(imageProblem(jpeg(4)), null);
});

test("newPresaleShare: piece 3's share words for the creator, the commit as what's in, the wallet as ref", () => {
  const W = "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D";
  const s = newPresaleShare({ key: "Pre1", symbol: "MDOG", wallet: W, commit: 100_000_000n, N: { ...N, DURATION: 3600 }, now: 1_790_000_000_000 });
  assert.deepEqual(s, {
    title: "$MDOG on Mooner",
    message: `My $MDOG presale is open on Mooner.\n0.1 of 0.5 SOL in so far.\nhttps://app.mooner.family/presale/Pre1?ref=${W}`,
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/create.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` … `Cannot find module '…/mobile/src/create/rules.js'`

- [ ] **Step 4: Write the rules**

Create `mobile/src/create/rules.js`:

```js
// What the Create screen allows and says: the coin's name, ticker, description and links, the
// creator's commit, the picture, and errors in words. Plain functions (no React Native, so Node
// tests run them). The text rules are the website's (web/src/lib/launch.ts) plus the server's
// byte limits (engine/server/api.js mint), so what the form takes the server takes too.
import { PublicKey } from "@solana/web3.js";
import { ApiError } from "../../../engine/src/apiclient.js";
import { explain, sol } from "../../../engine/src/flows.js";
import { alreadyOpen } from "../../../engine/src/opening.js";
import { presalePda } from "../../../engine/src/pdas.js";
import { OUTCOME_UNKNOWN, outcomeUnknown } from "../../../engine/src/tx.js";
import { SEAT_PRESETS } from "../../../engine/src/views.js";
import { solText } from "../ui/format.js";

export const NAME_MAX = 32;
export const TICKER_MIN = 2;
export const TICKER_MAX = 10;
export const DESCRIPTION_MAX = 280;
export const IMAGE_MAX = 2 * 1024 * 1024; // the server's MAX_IMAGE
const NAME_BYTES = 32;
const DESCRIPTION_BYTES = 600;
const LINK_BYTES = 120;
const TOO_BIG = "Too long: emoji and accented letters take more room";

export const LINK_KINDS = ["x", "telegram", "website"];
const LINK_ERRORS = {
  x: "Enter an X link or @handle",
  telegram: "Enter a Telegram link or @handle",
  website: "Enter a web address",
};

/** An empty form. */
export const blankDraft = () => ({ name: "", ticker: "", description: "", links: { x: "", telegram: "", website: "" } });

/** A coin the server already issued, as the form (to open an unopened coin). */
export function draftOf(token) {
  const links = token.links ?? {};
  return {
    name: token.name ?? "",
    ticker: token.symbol ?? "",
    description: token.description ?? "",
    links: { x: links.twitter ?? "", telegram: links.telegram ?? "", website: links.website ?? "" },
  };
}

/** "$moon" → "MOON": capital letters and digits only. */
export const normalizeTicker = (input) => input.toUpperCase().replace(/[^A-Z0-9]/g, "");

const encoder = new TextEncoder();
/** Bytes `s` takes as UTF-8: the server's limits are in bytes. */
export const utf8Length = (s) => encoder.encode(s).length;

/** The name as the server takes it: one line, no control characters, single spaces. */
export const cleanName = (s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ {2,}/g, " ").trim();

/** The description as the server takes it: lines are fine, tabs become spaces, other control
 *  characters go. */
export const cleanDescription = (s) =>
  s.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();

const HANDLE = /^@?([A-Za-z0-9_]{1,32})$/;
const HANDLE_BASE = { x: "https://x.com/", telegram: "https://t.me/" };
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// https, then a host the server's new URL (Node's) takes, checked by hand since the phone's URL
// (Expo's whatwg-url-minimum) doesn't check punycode: dotted labels of letters, digits and
// hyphens, 1–63 long with no hyphen at either end and none starting "xn--", the last of 2–63
// letters (so never a number, as in 999.1); no user, no port; then maybe a path, query or
// fragment without spaces or control characters
const HTTPS = /^https:\/\/(?:(?!xn--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}([/?#][^\s\u0000-\u001f\u007f]*)?$/i;

/** The https address a link field means, or null. A bare @handle becomes an X or Telegram
 *  address; a bare domain gets https://. */
export function linkHref(kind, value) {
  const v = value.trim();
  if (!v) return null;
  const handle = HANDLE.exec(v);
  if (handle && HANDLE_BASE[kind]) return HANDLE_BASE[kind] + handle[1];
  const url = SCHEME.test(v) ? v : `https://${v}`;
  return HTTPS.test(url) ? url : null;
}

/** The form's problems by field ({} when there are none). `taken`: tickers in use
 *  (takenTickers). */
export function validate(draft, { taken = new Set() } = {}) {
  const errors = {};
  const name = cleanName(draft.name);
  if (name.length < 2) errors.name = "At least 2 characters";
  else if (name.length > NAME_MAX) errors.name = `At most ${NAME_MAX} characters`;
  else if (utf8Length(name) > NAME_BYTES) errors.name = TOO_BIG;

  const ticker = normalizeTicker(draft.ticker);
  if (ticker.length < TICKER_MIN || ticker.length > TICKER_MAX) errors.ticker = `${TICKER_MIN}–${TICKER_MAX} letters or digits`;
  else if (taken.has(ticker)) errors.ticker = `$${ticker} is taken`;

  const description = cleanDescription(draft.description);
  if (description.length > DESCRIPTION_MAX) errors.description = `At most ${DESCRIPTION_MAX} characters`;
  else if (utf8Length(description) > DESCRIPTION_BYTES) errors.description = TOO_BIG;

  for (const kind of LINK_KINDS) {
    const value = draft.links[kind] ?? "";
    if (!value.trim()) continue;
    const href = linkHref(kind, value);
    if (!href) errors[kind] = LINK_ERRORS[kind];
    else if (utf8Length(href) > LINK_BYTES) errors[kind] = `At most ${LINK_BYTES} characters`;
  }
  return errors;
}

export const hasErrors = (errors) => Object.keys(errors).length > 0;

/** The form as flows.requestMint takes it: links as https addresses, "" when empty. */
export function mintFields(draft) {
  const href = (kind) => linkHref(kind, draft.links[kind] ?? "") ?? "";
  return {
    name: cleanName(draft.name),
    symbol: normalizeTicker(draft.ticker),
    description: cleanDescription(draft.description),
    links: { twitter: href("x"), telegram: href("telegram"), website: href("website") },
  };
}

/** What the creator may commit, in BigInt lamports: { min, max, step }. The co-signer refuses
 *  more than TARGET − MIN_SEAT (cosigner.js), so another seat always fits. */
export function commitBounds(N) {
  const cap = N.TARGET - N.MIN_SEAT;
  return { min: N.MIN_SEAT, max: N.MAX_SEAT < cap ? N.MAX_SEAT : cap, step: N.STEP };
}

/** The commit chips: the seat presets under the most the creator may put in, then that most. */
export function commitChoices(N) {
  const { min, max } = commitBounds(N);
  // assumes TARGET − MIN_SEAT is a multiple of STEP and at least MIN_SEAT, as mainnet's numbers are
  return [...SEAT_PRESETS.filter((a) => a >= min && a < max), max];
}

/** Why `commit` (BigInt lamports) can't open a presale, or null. */
export function commitProblem(commit, N) {
  const { min, max, step } = commitBounds(N);
  const ok = typeof commit === "bigint" && commit >= min && commit <= max && commit % step === 0n;
  return ok ? null : `Pick ${sol(min)} to ${sol(max)} SOL, so others have room to join.`;
}

/** What the wallet lacks to open, as one line, or null. `extra`: openCost() (BigInt, or null
 *  while it's read); `lamports`: the wallet's SOL (a number, or null while it's read; NaN, from
 *  a reply without lamports, counts as not read). Unknown amounts block nothing: the wallet
 *  and Solana have the last word. */
export function shortOfOpen(commit, extra, lamports) {
  if (extra == null || lamports == null || !Number.isFinite(Number(lamports))) return null;
  const have = BigInt(Math.floor(Number(lamports)));
  const need = commit + extra;
  if (need <= have) return null;
  return `You need ${solText(need, 3)} SOL to open this (your commit plus about ${solText(extra, 4)} SOL in fees and rent). You have ${solText(have, 3)}.`;
}

const IN_PLAY = new Set(["OPEN", "FULL", "LAUNCHING", "SETTLED"]);

/** Tickers in use: presales in play and launched coins. One that expired or failed is free. */
export function takenTickers({ presales, launched }) {
  const out = new Set();
  for (const v of Object.values(presales)) if (IN_PLAY.has(v.state) && v.token?.symbol) out.add(v.token.symbol.toUpperCase());
  for (const r of Object.values(launched)) if (r.token?.symbol) out.add(r.token.symbol.toUpperCase());
  return out;
}

/** The wallet's coins that no presale has opened, newest first. `tokens`: GET
 *  /api/wallet/<wallet>/tokens (null before it's read); `presales`: the store's list (an open
 *  can reach the feed before the server's record says so). */
export function unopenedOf(tokens, presales) {
  const opened = new Set(Object.values(presales).map((v) => v.token?.mint).filter(Boolean));
  return (tokens ?? []).filter((t) => !t.presale && !opened.has(t.mint));
}

const OPENER = /can't open presales yet|not on the openers list/;

/** A retry of a coin whose open had landed: the presale program refuses it with its own
 *  AlreadyExists (28) (engine/src/opening.js alreadyOpen), the store's read before the
 *  retry finds the presale on the server (in any state: it may have closed since), or the
 *  feed has it before the wallet is asked. The screen then goes to the room. */
export const ALREADY_OPEN = "This coin's presale was already opened.";

/** The store's read before a retry gave anything but the server's own 404, so it can't tell
 *  whether the presale is there: nothing is signed, and the coin stays saved. */
export const RETRY_UNCHECKED = "Couldn't check whether this coin's presale was already opened. Try again.";

/** The store refuses to open another coin while one is saved for the wallet (its open's
 *  outcome isn't known): only that coin can be tried, or left by Start over. */
export const OPEN_PENDING = "Another coin's open isn't settled yet. Try that coin again first.";

/** The error the server sends with its 404 for a presale it neither has on chain nor
 *  recorded: engine/server/api.js, in onePresale,
 *  `if (!token) throw new HttpError(404, "no such presale");` (http.js sends it as
 *  { error }). Any other 404 (http.js's "not found" for a path no route has, a proxy's) says
 *  nothing about the presale. */
export const NO_SUCH_PRESALE = "no such presale";

/** The one read before a retry. `read()`: GET /api/presale/<key> (apiclient.js presale).
 *  "open": the server knows the presale in any state, so an earlier open landed (it may have
 *  closed since, and the program would then open the same coin again). "retry": the
 *  server's own 404 (NO_SUCH_PRESALE), so it hasn't opened. "unknown": anything else (another
 *  404, a 5xx, a timeout, a network error, no view), so nothing can be told. */
export async function checkBeforeRetry(read) {
  try {
    return (await read()) ? "open" : "unknown";
  } catch (e) {
    return e?.status === 404 && e.body?.error === NO_SUCH_PRESALE ? "retry" : "unknown";
  }
}

// an open's blockhash lasts about 150 blocks (about a minute), so 5 minutes is a wide margin
export const START_OVER_MS = 5 * 60_000;

/** Whether the creator may leave the saved open `record` for a new coin. Yes only when both
 *  hold: `read`, the verdict of the read before the last retry (checkBeforeRetry), was the
 *  server's own 404 ("retry"); and `now`, when that read was asked (ms), is more than
 *  START_OVER_MS after the record's `at`, so its last open can't land any more. The store
 *  sets `at` at each save: before the wallet is asked, once it has signed, and when an
 *  unknown outcome is reported. Anything else is no: "open" or "unknown", a missing or
 *  broken `at`. */
export function canStartOver(record, read, now) {
  const at = record?.at;
  return read === "retry" && Number.isSafeInteger(at) && at > 0 && Number.isFinite(now) && now - at > START_OVER_MS;
}

/** Why a retry's saved `commit` (BigInt lamports, fixed for its mint) can't open under `N`
 *  now, in one line, or null. The screen can't change it; Start over is the way out. */
export function keptCommitProblem(commit, N) {
  if (commitProblem(commit, N) === null) return null;
  const s = sol(commit, 9);
  return commit > commitBounds(N).max ? `${s} SOL is more than a seat can hold now.` : `${s} SOL doesn't fit a seat now.`;
}

/** A create error in words: an open that may have gone out (openFailure), a retry of one
 *  that landed (`pid`: the presale program's key in base58, for alreadyOpen), the store's
 *  own refusals, the server's (engine/server/api.js mint, cosigner.js), the wallet's
 *  Decline, else explain(). */
export function createError(e, pid = null) {
  const m = e?.message ?? String(e);
  if (e?.outcomeUnknown) return OUTCOME_UNKNOWN;
  if (m === ALREADY_OPEN || m === RETRY_UNCHECKED || m === OPEN_PENDING) return m; // the store's own
  if (alreadyOpen(e, pid)) return ALREADY_OPEN;
  if (OPENER.test(m)) return "This wallet can't open presales yet. Mooner lets a short list of wallets open them for now; you can still join any presale.";
  // Seed Vault's Decline: MWA's ERROR_NOT_SIGNED (-3) or ERROR_AUTHORIZATION_FAILED (-1), with
  // the wallet's own wording (checks.js, useConnect.js)
  if (e?.code === -3 || e?.code === -1) return "You cancelled it in your wallet.";
  if (e?.status === 429 && Array.isArray(e.body?.unopened)) {
    return `${e.body.unopened.length} of your coins aren't open yet. Open one of them first: they're at the top of Create.`;
  }
  if (e?.status === 429) return "Too many tries from here for now. Try again later.";
  if (e?.status === 401) return "The wallet's signature didn't match the coin's details. Try again.";
  if (e?.status === 409) return "That signature was already used. Try again.";
  // only the mint's own 502 is about IPFS (api.js: `IPFS: …; try again`); a proxy's isn't
  if (e?.status === 502 && /^IPFS: /.test(m)) return "Couldn't save the picture and details to IPFS. Try again.";
  if (/time must be now/.test(m)) return "Your phone's clock is off. Turn on automatic date and time, then try again.";
  if (/make the launch tx \d+ bytes/.test(m)) return "The name and ticker are too long together. Make the name shorter.";
  return explain(e);
}

/** Whether a failure after the wallet signed the open may have sent it: anything but the
 *  server's refusal (400, 403, 429) or an answer of its own that says `sent: false` (api.js:
 *  from before the send, such as its 503 for a slow simulation), which send nothing. */
export const mayHaveSent = (e) => !(e instanceof ApiError && ([400, 403, 429].includes(e.status) || e.body?.sent === false));

/** An open's failure as the store throws it. `sent`: the wallet had signed. A failure after
 *  that which may have sent the open (a network error, a 5xx without `sent: false`, a
 *  deadline, the presale not seen in time) becomes tx.js outcomeUnknown, never a plain
 *  failure: the screen then retries only the same coin, so no second coin comes of it. An
 *  outcomeUnknown already (the co-signer's, or flows.js waitSent's after a 202) passes as it
 *  is, with its `sig`. */
export function openFailure(e, sent) {
  if (!sent || !mayHaveSent(e)) return e;
  return e?.outcomeUnknown ? e : outcomeUnknown(e?.sig ?? null, "open");
}

/** Whether a store result's words are the unknown outcome. */
export const isUnknown = (error) => error === OUTCOME_UNKNOWN;

/** The key of coin `mint`'s presale (base58), as the chain derives it. */
export const presaleKeyOf = (info, mint) => presalePda(info.pid, new PublicKey(mint)).toBase58();

/** Whether the watched presale `key` has shown up: its pushed snapshot (the store's watch) or
 *  its row in the list. Only a presale the feed has carries a `state`. */
export const openLanded = (key, { views, presales }) => !!key && !!(views[key]?.state || presales[key]?.state);

/** What Back does on step `at`: "stay", "leave" (the tab), "restart" or "previous". `locked`:
 *  an open is running or its outcome is unknown, so the coin stays; `issued`: the server has
 *  the coin, whose details are then fixed. */
export function backAction({ at, locked, issued, step }) {
  if (locked) return "stay";
  if (at === 0) return "leave";
  if (issued && step === "commit") return "restart";
  return "previous";
}

/** Whether `o` is a whole saved open: its mint, presale and ticker (not blank), and its commit
 *  as whole lamports above 0. A missing or broken `at` still counts: the coin stays locked,
 *  and canStartOver never lets it go. */
export const isOpening = (o) =>
  !!o &&
  typeof o.mint === "string" &&
  typeof o.presale === "string" &&
  typeof o.symbol === "string" &&
  o.symbol.trim() !== "" &&
  /^[1-9]\d*$/.test(String(o.commit ?? ""));

/** The screen's state for `opening`, the store's saved open whose outcome wasn't known ({ mint,
 *  presale, symbol, name, description, links, image, commit, at }), or null: the coin on the
 *  last look, its form and picture, the commit (BigInt), and its presale to watch (`unknown`),
 *  which locks Back and allows only a retry of this coin. */
export function restoredOpen(opening) {
  const o = opening;
  if (!isOpening(o)) return null;
  return {
    step: "review",
    coin: o,
    draft: draftOf(o),
    picture: { uri: o.image ?? null, bytes: null },
    commit: BigInt(o.commit),
    unknown: o.presale,
    error: OUTCOME_UNKNOWN,
  };
}

/** The centred square of a w×h picture, and the side to scale it to (at most `max` px). */
export function squareOf(w, h, max = 1024) {
  const side = Math.min(w, h);
  return {
    crop: { originX: Math.floor((w - side) / 2), originY: Math.floor((h - side) / 2), width: side, height: side },
    size: Math.min(side, max),
  };
}

// as the server's sniffImage (engine/server/api.js): a JPEG's first three bytes and more, a
// PNG's whole 8-byte signature and more
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b) => b.length > 8 && PNG.every((x, i) => b[i] === x);

/** Why the picture's bytes can't go to the server, or null. */
export function imageProblem(bytes) {
  if (!bytes || bytes.length === 0) return "Pick a picture.";
  if (bytes.length > IMAGE_MAX) return "That picture is over 2 MB. Pick another.";
  if (!isJpeg(bytes) && !isPng(bytes)) return "That picture couldn't be read. Pick another.";
  return null;
}
```

Create `mobile/src/create/share.js`:

```js
// The words a new presale is shared with right after it opens: piece 3's share text
// (room/share.js shareOf), with the creator's wallet as ref. The view is made from the open
// itself, since the feed's snapshot may not have reached the phone yet. Plain functions, so
// Node tests run them.
import { BASE } from "../config.js";
import { shareOf } from "../room/share.js";

/** { title, message } for presale `key`, just opened by `wallet` for coin `symbol` with
 *  `commit` (BigInt lamports), or null (shareOf's rule). `N`: info.N; `now`: ms. */
export function newPresaleShare({ key, symbol, wallet, commit, N, now }) {
  const view = {
    presale: key,
    state: "OPEN",
    creator: wallet,
    raised: String(commit),
    token: { symbol },
    deadlineTs: Math.floor(now / 1000) + Number(N.DURATION),
  };
  return shareOf({ view, launched: undefined, wallet, N, base: BASE, now });
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/create.test.mjs`
Expected: `# pass 23`, `# fail 0`

Run: `cd mobile && npm test 2>&1 | grep -E '^# (pass|fail)'`
Expected: pass is BEFORE + 23, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add mobile/src/create/rules.js mobile/src/create/share.js mobile/test/create.test.mjs && git commit -m "mobile: Create's rules (name, ticker, description, links, the commit's cap, tickers in use, unopened coins, the picture), its errors in words (a second presale for a mint is the program's AlreadyExists, through engine/src/opening.js), an open whose outcome isn't known and its saved coin restored, the read before a retry (only the server's own 404 lets it sign), when Start over may show (that 404, more than 5 minutes after the coin was last saved), and the new presale's share words

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/create/rules.js mobile/src/create/share.js mobile/test/create.test.mjs
```

---

### Task 3: The store's create actions

**Files:**
- Modify: `mobile/src/store.js`
- Test: `mobile/test/create-store.test.mjs`

The store gains four actions and one piece of state:
- `mintCoin(coin, signer)`: the wallet signs the details, then the server pins them and issues the coin.
- `openCoin(coin, commit, signer)`: the open tx with the creator's commit. `coin` is the server's coin with its presale's key (`{ mint, presale, symbol, name, description, links, image }`). The seat is then remembered as this wallet's, under `mooner:mine:<wallet>`, as a join does.
- `openCost()`: what an open takes besides the commit.
- `forgetOpening(wallet, presale)`: clears the wallet's saved open, only if it is the coin of `presale` (the screen's fresh start, and Start over). A saved open for another coin stays.
- `opening`: the connected wallet's saved open whose outcome wasn't known, or null; undefined until `setWallet` has read it. It is saved under `mooner:opening:<wallet>` through `saved`, the way `remember` saves `mooner:mine:<wallet>`, and read by `setWallet` with the sign-in and the seats.

Both create actions go through `run(key, kind, fn, why)` with kind `"create"` and `createError` for the words, so only one action runs at a time. The steps the screen shows change at the moment the wallet is asked and when it answers: the signer's `signMessage` and `signTransaction` are wrapped, so "Sign to open the presale with your SOL" is set just before the wallet is asked, and the next step when it hands the signature back.

An open whose outcome isn't known (Task 2's intro): `openCoin`'s wrapper notes when the wallet has signed. A failure after that goes through `openFailure`, so anything but the server's refusal comes back as OUTCOME_UNKNOWN, and no seat is remembered. A failure before it (the wallet's Decline, a network error while building the tx) is a plain failure.

The saved open (`opening`):
- **Saved before the wallet is asked, and again after.** The `signTransaction` wrapper awaits the save of `{ mint, presale, symbol, name, description, links, image, commit, at }` and only then asks the wallet. `commit` is a string of lamports; `at` is the time of the save (ms). Nothing is saved when no prompt comes (a commit refused, a network error while the tx is built). So an app restart, Android ending the app while the user checks their wallet, or a reconnect brings the screen back to the coin (Task 7, `restoredOpen`), even if the app ends before the outcome is known. The same record is saved again, each time with a new `at`:
  - once the wallet has signed, before the open goes out. Seed Vault changes the tx as it signs (the 100k priority, a Lighthouse instruction); whether it also replaces the blockhash is not known. If it does, a prompt held a long time must not use up Start over's wait while the signed tx can still land. The web does the same since `d3144d5`;
  - when an unknown outcome is reported, as the web does (`6871fe7`).

  So `at` is the coin's last save, by any try, and Start over (`canStartOver`, Task 2) counts from it.
- **A copy in memory.** Secure storage can refuse a save (`keep` swallows the error). A `Map` of wallet → record keeps the coin for as long as the app runs, and `openingOf` and `setWallet` read it before the disk. Every save and clear writes the `Map` first, and a clear leaves `null` there rather than deleting the entry: every write goes through `noteOpening`, so the `Map` is never older than the disk, while the disk can be, after a refused save or clear. Read first, the disk would bring back a coin the app already cleared, or an older `at` (which could let Start over show too soon).
- **Kept:** an unknown outcome (OUTCOME_UNKNOWN), saved again as of the report; a retry's plain failure, as the record was before that try (its `at` too: nothing from that try can land, even after the sign, since a plain failure means the server never sent the tx, or sent it and it failed for certain); a retry stopped by the read, the kept commit or the funds check. **Cleared:** a success; ALREADY_OPEN (the program's AlreadyExists, the read, or the feed); a first try's plain failure (the wallet's Decline, the server's refusal), since nothing of it can land.
- **The read comes first.** A retry of the saved coin reads its presale once (`checkBeforeRetry` with `api.presale`), before any other check, so a landed open is never signed again whatever else is wrong. If the server knows it in any state (on chain, or its record of one that closed), that open landed: the saved coin is cleared and the answer is ALREADY_OPEN, with nothing signed. A presale that closed leaves no account, so the program alone would open the same coin again. Only the server's own 404 (`e.body.error` is exactly "no such presale", api.js line 259) lets the retry go on. Anything else (another 404, a 5xx, a timeout, a network error) stops it with RETRY_UNCHECKED, and the coin stays saved.
- **The saved commit.** A retry opens with the saved commit, whatever the screen hands in: it is fixed for its mint. If it no longer fits a seat under /api/info's numbers, `keptCommitProblem` says so in one line (e.g. "0.45 SOL is more than a seat can hold now.") and nothing is signed. Then the funds check (`shortOfOpen` with `openCost()` and the wallet's SOL), after the read, so a wallet short of SOL still gets the read that Start over needs.
- **The read goes back to the screen** in `openCoin`'s answer, as `read: { verdict, at }` (`at`: when it was asked, taken before the read, the cautious side). It isn't a separate action: there is one read per tap, and it belongs to the try it gated. The screen hands it to `canStartOver` with `opening` (Task 7).
- **The feed has it.** Just before the wallet is asked, the wrapper checks `openLanded(coin.presale, state)`. If the feed already shows the presale, it throws ALREADY_OPEN and the wallet isn't asked.
- **One coin at a time.** While a coin is saved for the wallet, `openCoin` refuses any other mint with OPEN_PENDING: only that coin can be tried, or left by Start over.

- [ ] **Step 0: Check the files are clean**

Run: `git diff --quiet HEAD -- mobile/src/store.js mobile/test/store.test.mjs && echo clean`
Expected: `clean`. If not, stop and report (Dirty files).

- [ ] **Step 1: Write the failing test**

Create `mobile/test/create-store.test.mjs`:

```js
// The store's create actions (mintCoin, openCoin, openCost, forgetOpening) with fake flows:
// the steps the screen shows, the words a refusal comes back in, the open remembered as this
// wallet's, an open that may have gone out coming back unknown, never as a plain failure, and
// its coin saved for the wallet before the wallet is asked, again once it has signed and when
// an unknown is reported (on disk, and in memory when the disk refuses), until a retry, the
// presale or Start over settles it. A retry reads its presale first, signs only after the
// server's own 404, and keeps its commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { ApiError } from "../../engine/src/apiclient.js";
import { OUTCOME_UNKNOWN, outcomeUnknown } from "../../engine/src/tx.js";
import { ALREADY_OPEN, OPEN_PENDING, RETRY_UNCHECKED } from "../src/create/rules.js";
import { createMoonerStore } from "../src/store.js";

const W = "Wallet1111";
const OPENER = "This wallet can't open presales yet. Mooner lets a short list of wallets open them for now; you can still join any presale.";
const N = { TARGET: 500_000_000n, MIN_SEAT: 100_000_000n, MAX_SEAT: 500_000_000n, STEP: 10_000_000n };
const COIN = {
  name: "Moon Dog",
  symbol: "MDOG",
  description: "",
  links: { twitter: "", telegram: "", website: "" },
  image: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
};
const PID = "6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa";
/** The server's coin, with its presale's key, as the screen hands it to openCoin. */
const OPENING = {
  mint: "Mint1",
  presale: "Pre1",
  symbol: "MDOG",
  name: "Moon Dog",
  description: "",
  links: { twitter: "", telegram: "", website: "" },
  image: "https://gw/ipfs/img",
};
/** What the wrapper saves for the wallet before it asks: the coin, its commit, and `at`, the
 *  time of the save (the rig's clock, 5_000 unless a test moves it). */
const SAVED = { ...OPENING, commit: "100000000", at: 5_000 };
/** The same coin as an earlier try saved it. */
const OLD = { ...SAVED, at: 1_000 };
const SAVED_NAME = `mooner:opening:${W}`;
/** A retry's read as openCoin hands it back: its verdict, and when it was asked. */
const readOf = (verdict) => ({ verdict, at: 5_000 });
/** GET /api/presale for a presale the server doesn't know: its own 404 (api.js onePresale). */
const NOT_FOUND = async () => {
  throw new ApiError(404, "no such presale", { error: "no such presale" });
};
/** The server's simulation refusing a second presale for the mint: the program's own
 *  AlreadyExists (28), as api.js cosignChecked answers it. */
const ALREADY_EXISTS = new ApiError(400, "the tx fails: ix 1: AlreadyExists (28)", {
  error: "the tx fails: ix 1: AlreadyExists (28)",
  logs: [`Program ${PID} invoke [1]`, `Program ${PID} failed: custom program error: 0x1c`],
  sent: false,
});

/** `disk`: the phone's saved state (a fresh rig on the same disk is the app started again);
 *  `presale(key)`: what GET /api/presale gives; `setFails`: secure storage refuses every save;
 *  `now`: the store's clock (5_000 unless a test moves it). */
function rig({ flows: over = {}, signer: signerOver = {}, presale = NOT_FOUND, disk = new Map(), setFails = false, now = () => 5_000 } = {}) {
  const live = { subscribe: () => () => {}, onStatus: () => () => {} };
  const saved = (name) => ({
    get: async () => (disk.has(name) ? structuredClone(disk.get(name)) : undefined),
    set: async (v) => {
      if (setFails) throw new Error("the secure store refused it");
      disk.set(name, structuredClone(v));
    },
    clear: async () => void disk.delete(name),
  });
  const calls = [];
  const flows = {
    loadInfo: async () => ({ N, pid: new PublicKey(PID) }),
    requestMint: async (a) => {
      calls.push(["mint", a]);
      await a.signMessage(new Uint8Array([1, 2, 3]));
      return { mint: "Mint1", presale: "Pre1", name: a.name, symbol: a.symbol, image: "https://gw/ipfs/img", uri: "https://gw/ipfs/meta" };
    },
    openPresale: async (a) => {
      calls.push(["open", a]);
      await a.signTransaction("TX");
      return { toBase58: () => "Pre1" };
    },
    openCost: async () => ({ total: 8_800_000n }),
    ...over,
  };
  const signer = {
    publicKey: { toBase58: () => W },
    signTransaction: async (t) => (calls.push(["signTransaction", t]), t),
    signMessage: async (b) => (calls.push(["signMessage", b]), new Uint8Array(64)),
    ...signerOver,
  };
  const api = { presale: async (key) => (calls.push(["presale", key]), presale(key)) };
  const store = createMoonerStore({ live, api, flows, saved, market: {}, now });
  const steps = [];
  store.subscribe((s) => {
    const step = s.busy?.step;
    if (step && steps.at(-1) !== step) steps.push(step);
  });
  return { store, calls, disk, signer, steps };
}

test("mintCoin: the wallet signs the details, then the server's coin comes back", async () => {
  const { store, calls, signer, steps } = rig();
  const r = await store.getState().mintCoin(COIN, signer);
  assert.deepEqual(r, { ok: true, value: { mint: "Mint1", presale: "Pre1", name: "Moon Dog", symbol: "MDOG", image: "https://gw/ipfs/img", uri: "https://gw/ipfs/meta" } });
  const [, a] = calls.find(([k]) => k === "mint");
  assert.equal(a.wallet, signer.publicKey);
  assert.equal(a.name, "Moon Dog");
  assert.equal(a.image, COIN.image);
  assert.ok(calls.some(([k]) => k === "signMessage"));
  assert.deepEqual(steps, ["Sign the coin details in your wallet", "Saving the picture and details to IPFS"]);
  assert.equal(store.getState().busy, null);
});

test("mintCoin: a wallet that can't open presales is told so in plain words", async () => {
  const { store, signer } = rig({
    flows: { requestMint: async () => { throw new ApiError(403, "this wallet can't open presales yet (closed beta)", {}); } },
  });
  assert.deepEqual(await store.getState().mintCoin(COIN, signer), { ok: false, error: OPENER });
  assert.equal(store.getState().busy, null);
});

test("mintCoin: too many unopened coins points at them", async () => {
  const { store, signer } = rig({
    flows: { requestMint: async () => { throw new ApiError(429, "3 of your tokens aren't opened yet; open one of them first", { unopened: ["A", "B", "C"] }); } },
  });
  const r = await store.getState().mintCoin(COIN, signer);
  assert.equal(r.error, "3 of your coins aren't open yet. Open one of them first: they're at the top of Create.");
});

test("mintCoin: Decline in the wallet is a cancel, and nothing reaches the server", async () => {
  const declined = Object.assign(new Error("transaction not signed"), { code: -3 });
  const { store, calls, signer } = rig({
    signer: { signMessage: async () => { throw declined; } },
    flows: {
      requestMint: async (a) => {
        await a.signMessage(new Uint8Array([1]));
        calls.push(["api.mint"]);
        return {};
      },
    },
  });
  assert.deepEqual(await store.getState().mintCoin(COIN, signer), { ok: false, error: "You cancelled it in your wallet." });
  assert.ok(!calls.some(([k]) => k === "api.mint"));
});

test("openCoin: the open with the creator's commit, then remembered as this wallet's seat", async () => {
  const { store, calls, disk, signer, steps } = rig();
  await store.getState().setWallet(W);
  const r = await store.getState().openCoin(OPENING, 100_000_000n, signer);
  assert.deepEqual(r, { ok: true, value: "Pre1" });
  const [, a] = calls.find(([k]) => k === "open");
  assert.equal(a.mint, "Mint1");
  assert.equal(a.commit, 100_000_000n);
  assert.equal(a.wallet, signer.publicKey);
  assert.deepEqual(a.info.N, N);
  assert.deepEqual(calls.find(([k]) => k === "signTransaction"), ["signTransaction", "TX"]);
  assert.deepEqual(steps, ["Sign to open the presale with your SOL", "Opening the presale"]);
  assert.deepEqual(store.getState().mine.Pre1, { deposit: "100000000", at: 5_000, back: null });
  assert.deepEqual(disk.get(`mooner:mine:${W}`).Pre1, { deposit: "100000000", at: 5_000, back: null });
  assert.ok(!calls.some(([k]) => k === "presale"), "no saved coin: no read first");
  assert.equal(store.getState().opening, null);
});

test("openCoin: a commit over the cap stops before the wallet is asked", async () => {
  const { store, calls, signer } = rig();
  const r = await store.getState().openCoin(OPENING, 500_000_000n, signer);
  assert.deepEqual(r, { ok: false, error: "Pick 0.1 to 0.4 SOL, so others have room to join." });
  assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"));
});

test("openCoin: the co-signer's refusals in plain words", async () => {
  const opener = rig({ flows: { openPresale: async () => { throw new ApiError(403, "wallet not on the openers list", {}); } } });
  assert.deepEqual(await opener.store.getState().openCoin(OPENING, 100_000_000n, opener.signer), { ok: false, error: OPENER });
  const other = rig({ flows: { openPresale: async () => { throw new ApiError(403, "the creator can put in at most 0.4 SOL, so others can join", {}); } } });
  assert.deepEqual(await other.store.getState().openCoin(OPENING, 100_000_000n, other.signer), {
    ok: false,
    error: "the creator can put in at most 0.4 SOL, so others can join",
  });
});

test("openCost: the flow's total", async () => {
  const { store } = rig();
  assert.equal(await store.getState().openCost(), 8_800_000n);
});

test("create waits for any other action, and frees the store after", async () => {
  let release;
  const { store, signer } = rig({
    flows: {
      requestMint: async () => {
        await new Promise((r) => (release = r));
        return { mint: "Mint1" };
      },
    },
  });
  const first = store.getState().mintCoin(COIN, signer);
  assert.equal(store.getState().busy.kind, "create");
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: "Wait for the last one to finish." });
  release();
  assert.equal((await first).ok, true);
  assert.equal(store.getState().busy, null);
});

/** A rig whose open fails with `e` after the wallet signed it; `after()` runs between the
 *  signature and the failure, during the cosign; `more`: rig's other options. */
const signedThen = (e, { after = () => {}, ...more } = {}) =>
  rig({
    ...more,
    flows: {
      openPresale: async (a) => {
        await a.signTransaction("TX");
        after();
        throw e;
      },
    },
  });

/** signedThen's options for a clock that moves on: 5_000 when the wallet is asked, 7_000 once
 *  it has signed, 9_000 when the failure comes back. */
function movingClock() {
  let t = 5_000;
  return {
    now: () => t,
    signer: { signTransaction: async (tx) => ((t = 7_000), tx) },
    after: () => void (t = 9_000),
  };
}
/** The coin as saved once the wallet signed, and as saved when the unknown was reported. */
const SIGNED = { ...SAVED, at: 7_000 };
const REPORTED = { ...SAVED, at: 9_000 };

/** openCoin on signedThen(e): what it gave back, the wallet's seats (the state's and the
 *  saved ones) and the steps shown. */
async function openAfterSigning(e) {
  const { store, disk, signer, steps } = signedThen(e);
  await store.getState().setWallet(W);
  const r = await store.getState().openCoin(OPENING, 100_000_000n, signer);
  return { r, mine: store.getState().mine, saved: disk.get(`mooner:mine:${W}`), steps };
}

test("openCoin: the co-signer's unknown outcome after the wallet signed stays unknown, and no seat is remembered", async () => {
  const { r, mine, saved, steps } = await openAfterSigning(outcomeUnknown("SIG", "cosign"));
  assert.deepEqual(r, { ok: false, error: OUTCOME_UNKNOWN });
  assert.deepEqual(steps, ["Sign to open the presale with your SOL", "Opening the presale"]);
  assert.equal(mine.Pre1, undefined);
  assert.equal(saved?.Pre1, undefined);
});

test("openCoin: the presale not seen in time after the server's 202 is an unknown outcome", async () => {
  // flows.js since 6b9bbfe (waitSent), and the words before it
  for (const e of [outcomeUnknown("SIG", "open"), new Error("the presale didn't show up yet; refresh in a moment")]) {
    const { r, mine } = await openAfterSigning(e);
    assert.deepEqual(r, { ok: false, error: OUTCOME_UNKNOWN }, e.message);
    assert.equal(mine.Pre1, undefined, e.message);
  }
});

test("openCoin: a network error or a 5xx after the wallet signed is an unknown outcome", async () => {
  for (const e of [new TypeError("Network request failed"), new ApiError(502, "bad gateway", {})]) {
    const { r, saved } = await openAfterSigning(e);
    assert.deepEqual(r, { ok: false, error: OUTCOME_UNKNOWN }, e.message);
    assert.equal(saved?.Pre1, undefined, e.message);
  }
});

test("openCoin: the API client's deadline after the wallet signed is an unknown outcome", async () => {
  const late = Object.assign(new ApiError(0, "the server didn't answer in 10 s"), { timedOut: true });
  const { r } = await openAfterSigning(late);
  assert.deepEqual(r, { ok: false, error: OUTCOME_UNKNOWN });
});

test("openCoin: the server's refusal after signing sent nothing: its own words, and a retry of an open that landed says so", async () => {
  const rent = await openAfterSigning(
    new ApiError(400, "the tx fails: Transaction results in an account (0) with insufficient funds for rent", { logs: [] }),
  );
  assert.deepEqual(rent.r, { ok: false, error: "Your wallet needs a little more SOL to cover rent and the Solana fee." });
  const again = await openAfterSigning(ALREADY_EXISTS);
  assert.deepEqual(again.r, { ok: false, error: ALREADY_OPEN });
  assert.equal(again.mine.Pre1, undefined, "the screen goes to the room, whose seats show it");
});

test("openCoin: a failure before the wallet signed is a plain failure", async () => {
  const net = rig({ flows: { openPresale: async () => { throw new TypeError("Network request failed"); } } });
  assert.deepEqual(await net.store.getState().openCoin(OPENING, 100_000_000n, net.signer), { ok: false, error: "Network request failed" });
  const declined = Object.assign(new Error("transaction not signed"), { code: -3 });
  const no = rig({ signer: { signTransaction: async () => { throw declined; } } });
  assert.deepEqual(await no.store.getState().openCoin(OPENING, 100_000_000n, no.signer), { ok: false, error: "You cancelled it in your wallet." });
});

test("openCoin: an unknown outcome keeps the coin saved for its wallet, as of when that was reported; the app started again reads it back, for that wallet only", async () => {
  const first = signedThen(outcomeUnknown("SIG", "cosign"), movingClock());
  await first.store.getState().setWallet(W);
  assert.equal(first.store.getState().opening, null, "none saved yet");
  assert.deepEqual(await first.store.getState().openCoin(OPENING, 100_000_000n, first.signer), { ok: false, error: OUTCOME_UNKNOWN });
  assert.deepEqual(first.store.getState().opening, REPORTED, "the report's time, not the prompt's or the sign's");
  assert.deepEqual(first.disk.get(SAVED_NAME), REPORTED);
  const again = rig({ disk: first.disk });
  assert.equal(again.store.getState().opening, undefined, "not read before a wallet connects");
  await again.store.getState().setWallet("Other1111");
  assert.equal(again.store.getState().opening, null, "another wallet has none");
  await again.store.getState().setWallet(W);
  assert.deepEqual(again.store.getState().opening, REPORTED);
});

test("openCoin: a retry of the saved coin reads its presale once first; a success and the program's AlreadyExists clear it", async () => {
  const ok = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await ok.store.getState().setWallet(W);
  assert.deepEqual(await ok.store.getState().openCoin(OPENING, 100_000_000n, ok.signer), { ok: true, value: "Pre1", read: readOf("retry") });
  assert.deepEqual(ok.calls.filter(([k]) => k === "presale"), [["presale", "Pre1"]]);
  assert.equal(ok.store.getState().opening, null);
  assert.equal(ok.disk.has(SAVED_NAME), false);
  const taken = signedThen(ALREADY_EXISTS, { disk: new Map([[SAVED_NAME, OLD]]) });
  await taken.store.getState().setWallet(W);
  assert.deepEqual(await taken.store.getState().openCoin(OPENING, 100_000_000n, taken.signer), {
    ok: false,
    error: ALREADY_OPEN,
    read: readOf("retry"),
  });
  assert.equal(taken.store.getState().opening, null);
  assert.equal(taken.disk.has(SAVED_NAME), false);
});

test("openCoin: a retry whose presale the server knows, closed too, was already opened: nothing is signed and the saved coin clears", async () => {
  const closed = { presale: "Pre1", where: "closed", state: "CLOSED", token: { mint: "Mint1" }, launch: null, seats: [] };
  const { store, calls, disk, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]), presale: async () => closed });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: ALREADY_OPEN, read: readOf("open") });
  assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"));
  assert.equal(store.getState().opening, null);
  assert.equal(disk.has(SAVED_NAME), false);
});

test("openCoin: a retry whose presale can't be read signs nothing, and the saved coin stays", async () => {
  const late = Object.assign(new ApiError(0, "the server didn't answer in 10 s"), { timedOut: true });
  const { store, calls, disk, signer } = rig({
    disk: new Map([[SAVED_NAME, OLD]]),
    presale: async () => {
      throw late;
    },
  });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: RETRY_UNCHECKED, read: readOf("unknown") });
  assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"));
  assert.deepEqual(store.getState().opening, OLD);
  assert.deepEqual(disk.get(SAVED_NAME), OLD);
});

test("openCoin: the coin is saved, with when, before the wallet is asked; nothing is saved when no prompt comes", async () => {
  const disk = new Map();
  const seen = {};
  const { store, signer } = rig({
    disk,
    signer: { signTransaction: async (t) => ((seen.prompt = structuredClone(disk.get(SAVED_NAME))), t) },
    flows: {
      openPresale: async (a) => {
        await a.signTransaction("TX");
        seen.open = structuredClone(disk.get(SAVED_NAME));
        return { toBase58: () => "Pre1" };
      },
    },
  });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: true, value: "Pre1" });
  assert.deepEqual(seen.prompt, SAVED, "on disk, with `at`, when the wallet is asked");
  assert.deepEqual(seen.open, SAVED, "and while the open goes out");
  assert.equal(disk.has(SAVED_NAME), false, "a success clears it");
  assert.equal(store.getState().opening, null);
  const writes = [];
  const quiet = new Map();
  const put = quiet.set.bind(quiet);
  quiet.set = (k, v) => (writes.push(k), put(k, v));
  const net = rig({ disk: quiet, flows: { openPresale: async () => { throw new TypeError("Network request failed"); } } });
  await net.store.getState().setWallet(W);
  assert.deepEqual(await net.store.getState().openCoin(OPENING, 100_000_000n, net.signer), { ok: false, error: "Network request failed" });
  assert.ok(!writes.includes(SAVED_NAME), "no prompt came, so nothing was written");
  assert.equal(net.store.getState().opening, null);
});

test("openCoin: a first try the wallet refuses leaves no saved coin", async () => {
  const declined = Object.assign(new Error("transaction not signed"), { code: -3 });
  const { store, disk, signer } = rig({ signer: { signTransaction: async () => { throw declined; } } });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: "You cancelled it in your wallet." });
  assert.equal(disk.has(SAVED_NAME), false);
  assert.equal(store.getState().opening, null);
});

test("openCoin: a retry the wallet refuses, or the server refuses after the sign, keeps the saved coin as it was; a signed retry's unknown outcome keeps it, as of when that was reported", async () => {
  const declined = Object.assign(new Error("transaction not signed"), { code: -3 });
  const no = rig({ disk: new Map([[SAVED_NAME, OLD]]), signer: { signTransaction: async () => { throw declined; } } });
  await no.store.getState().setWallet(W);
  assert.deepEqual(await no.store.getState().openCoin(OPENING, 100_000_000n, no.signer), {
    ok: false,
    error: "You cancelled it in your wallet.",
    read: readOf("retry"),
  });
  assert.deepEqual(no.disk.get(SAVED_NAME), OLD, "as the earlier try left it: this one was never signed");
  assert.deepEqual(no.store.getState().opening, OLD);
  const rent = new ApiError(400, "the tx fails: Transaction results in an account (0) with insufficient funds for rent", { logs: [] });
  const refused = signedThen(rent, { disk: new Map([[SAVED_NAME, OLD]]), ...movingClock() });
  await refused.store.getState().setWallet(W);
  assert.equal((await refused.store.getState().openCoin(OPENING, 100_000_000n, refused.signer)).ok, false);
  assert.deepEqual(refused.disk.get(SAVED_NAME), OLD, "signed, but the server never sent it: as the earlier try left it");
  assert.deepEqual(refused.store.getState().opening, OLD);
  const lost = signedThen(outcomeUnknown("SIG", "cosign"), { disk: new Map([[SAVED_NAME, OLD]]), ...movingClock() });
  await lost.store.getState().setWallet(W);
  assert.deepEqual(await lost.store.getState().openCoin(OPENING, 100_000_000n, lost.signer), {
    ok: false,
    error: OUTCOME_UNKNOWN,
    read: readOf("retry"),
  });
  assert.deepEqual(lost.disk.get(SAVED_NAME), REPORTED);
  assert.deepEqual(lost.store.getState().opening, REPORTED);
});

test("openCoin: the coin is saved again once the wallet signs, so an app that ends during the cosign comes back with the time it was signed", async () => {
  const disk = new Map();
  const clock = movingClock();
  let cosign; // the disk during the cosign, where the app ends
  const { store, signer } = signedThen(outcomeUnknown("SIG", "cosign"), {
    disk,
    ...clock,
    after: () => {
      cosign = structuredClone(disk);
      clock.after();
    },
  });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: OUTCOME_UNKNOWN });
  // checked here, not in the stub: an assertion thrown there, after the sign, would come back as
  // OUTCOME_UNKNOWN like the stub's own failure, and the test would pass anyway
  assert.deepEqual(cosign.get(SAVED_NAME), SIGNED, "the sign's time, not the prompt's");
  const again = rig({ disk: cosign });
  await again.store.getState().setWallet(W);
  assert.deepEqual(again.store.getState().opening, SIGNED);
});

test("openCoin: when secure storage refuses the save, a copy in memory keeps the coin for its wallet while the app runs", async () => {
  const { store, disk, signer } = signedThen(outcomeUnknown("SIG", "cosign"), { setFails: true });
  await store.getState().setWallet(W);
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: OUTCOME_UNKNOWN });
  assert.equal(disk.has(SAVED_NAME), false, "the save didn't reach the disk");
  await store.getState().setWallet(null);
  await store.getState().setWallet(W);
  assert.deepEqual(store.getState().opening, SAVED);
  await store.getState().setWallet("Other1111");
  assert.equal(store.getState().opening, null, "another wallet has none");
  await store.getState().setWallet(W);
  assert.deepEqual(store.getState().opening, SAVED);
  await store.getState().forgetOpening(W, "Pre1");
  assert.equal(store.getState().opening, null);
  await store.getState().setWallet(null);
  await store.getState().setWallet(W);
  assert.equal(store.getState().opening, null, "a clear removes the copy too");
});

test("openCoin: a presale the feed already shows stops the open before the wallet is asked", async () => {
  const { store, calls, disk, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await store.getState().setWallet(W);
  store.setState({ presales: { Pre1: { presale: "Pre1", state: "OPEN" } } });
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: ALREADY_OPEN, read: readOf("retry") });
  assert.ok(calls.some(([k]) => k === "open"), "the open was built");
  assert.ok(!calls.some(([k]) => k === "signTransaction"), "the wallet wasn't asked");
  assert.equal(store.getState().opening, null);
  assert.equal(disk.has(SAVED_NAME), false);
});

test("openCoin: no other coin opens while one is saved, and forgetOpening clears only the coin it names", async () => {
  const { store, calls, disk, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await store.getState().setWallet(W);
  await store.getState().forgetOpening(W, "Pre2");
  assert.deepEqual(store.getState().opening, OLD, "another presale's key clears nothing");
  assert.deepEqual(disk.get(SAVED_NAME), OLD);
  const other = { ...OPENING, mint: "Mint2", presale: "Pre2", symbol: "MCAT" };
  assert.deepEqual(await store.getState().openCoin(other, 100_000_000n, signer), { ok: false, error: OPEN_PENDING });
  assert.ok(!calls.some(([k]) => k === "presale" || k === "open" || k === "signTransaction"));
  assert.deepEqual(disk.get(SAVED_NAME), OLD);
  await store.getState().forgetOpening(W, "Pre1");
  assert.equal(store.getState().opening, null);
  assert.equal(disk.has(SAVED_NAME), false);
});

test("openCoin: a 404 without the server's own words signs nothing, and the saved coin stays", async () => {
  // http.js's 404 for a path no route has, and a proxy's with no JSON (apiclient.js: body null)
  for (const e of [new ApiError(404, "not found", { error: "not found" }), new ApiError(404, "the server said 404", null)]) {
    const { store, calls, disk, signer } = rig({
      disk: new Map([[SAVED_NAME, OLD]]),
      presale: async () => {
        throw e;
      },
    });
    await store.getState().setWallet(W);
    assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), { ok: false, error: RETRY_UNCHECKED, read: readOf("unknown") }, e.message);
    assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"), e.message);
    assert.deepEqual(disk.get(SAVED_NAME), OLD, e.message);
    assert.deepEqual(store.getState().opening, OLD, e.message);
  }
});

test("openCoin: a retry reads first, then checks its saved commit, which it keeps whatever the screen hands in", async () => {
  const BIG = { ...OLD, commit: "450000000" };
  const closed = { presale: "Pre1", where: "closed", state: "CLOSED", token: { mint: "Mint1" }, launch: null, seats: [] };
  const landed = rig({ disk: new Map([[SAVED_NAME, BIG]]), presale: async () => closed });
  await landed.store.getState().setWallet(W);
  assert.deepEqual(await landed.store.getState().openCoin(OPENING, 100_000_000n, landed.signer), { ok: false, error: ALREADY_OPEN, read: readOf("open") });
  assert.equal(landed.disk.has(SAVED_NAME), false, "the read came before the commit check");
  const over = rig({ disk: new Map([[SAVED_NAME, BIG]]) });
  await over.store.getState().setWallet(W);
  assert.deepEqual(await over.store.getState().openCoin(OPENING, 100_000_000n, over.signer), {
    ok: false,
    error: "0.45 SOL is more than a seat can hold now.",
    read: readOf("retry"),
  });
  assert.ok(!over.calls.some(([k]) => k === "open" || k === "signTransaction"));
  assert.deepEqual(over.disk.get(SAVED_NAME), BIG);
  const kept = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await kept.store.getState().setWallet(W);
  assert.equal((await kept.store.getState().openCoin(OPENING, 250_000_000n, kept.signer)).ok, true);
  assert.equal(kept.calls.find(([k]) => k === "open")[1].commit, 100_000_000n, "the saved commit, not the screen's");
  assert.deepEqual(kept.store.getState().mine.Pre1, { deposit: "100000000", at: 5_000, back: null });
});

test("openCoin: a retry short of SOL says so after the read, signs nothing, and the saved coin stays", async () => {
  const { store, calls, disk, signer } = rig({ disk: new Map([[SAVED_NAME, OLD]]) });
  await store.getState().setWallet(W);
  store.setState({ lamports: 50_000_000 });
  assert.deepEqual(await store.getState().openCoin(OPENING, 100_000_000n, signer), {
    ok: false,
    error: "You need 0.109 SOL to open this (your commit plus about 0.0088 SOL in fees and rent). You have 0.05.",
    read: readOf("retry"),
  });
  assert.deepEqual(calls.filter(([k]) => k === "presale"), [["presale", "Pre1"]]);
  assert.ok(!calls.some(([k]) => k === "open" || k === "signTransaction"));
  assert.deepEqual(disk.get(SAVED_NAME), OLD);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/create-store.test.mjs`
Expected: `# fail 29`, with errors such as `store.getState(...).mintCoin is not a function`

- [ ] **Step 3: Add the actions to the store**

Apply these nine edits to `mobile/src/store.js`, in order. Piece 3's store edits (its Task 5) are already in; none of these touch its lines.

Replace (the header):

```js
// wallet's balance of an open coin, and what the user does (sign in, join, get SOL back, chat,
// buy, sell). Screens read it with zustand's useStore and call its actions. Nothing here
// imports React Native, so it runs in Node tests with fakes.
```

with:

```js
// wallet's balance of an open coin, and what the user does (sign in, join, get SOL back, chat,
// buy, sell, create a coin and open its presale). Screens read it with zustand's useStore and
// call its actions. Nothing here imports React Native, so it runs in Node tests with fakes.
```

Replace (the last import since `8edc177`, still the last at `ccb0f94`):

```js
import { SNIPE_S, TAX_MARGIN_S } from "../../engine/src/views.js";
```

with:

```js
import { SNIPE_S, TAX_MARGIN_S } from "../../engine/src/views.js";
import {
  ALREADY_OPEN,
  OPEN_PENDING,
  RETRY_UNCHECKED,
  checkBeforeRetry,
  commitProblem,
  createError,
  isOpening,
  keptCommitProblem,
  openFailure,
  openLanded,
  shortOfOpen,
} from "./create/rules.js";
```

If piece 2 has changed the imports since, put the new line after the last import instead.

Replace (the seats' saved name; piece 3's `REFS` lines follow it):

```js
const mineName = (w) => `mooner:mine:${w}`;
```

with:

```js
const mineName = (w) => `mooner:mine:${w}`;
/** An open whose outcome wasn't known, saved per wallet until it's settled (openCoin). */
const openingName = (w) => `mooner:opening:${w}`;
```

Replace (the seats in the state):

```js
    mine: {}, // presale key -> { deposit, at, back? }: joined from this phone
```

with:

```js
    mine: {}, // presale key -> { deposit, at, back? }: joined from this phone
    // the connected wallet's open whose outcome wasn't known: { mint, presale, symbol, name,
    // description, links, image, commit, at } (create/rules.js restoredOpen); `at`: its last
    // save (openCoin); null: none; undefined: not read yet
    opening: undefined,
```

Replace (the busy comment):

```js
    busy: null, // { key, kind: "join" | "back" | "buy" | "sell", step }
```

with:

```js
    busy: null, // { key, kind: "join" | "back" | "buy" | "sell" | "create", step }
```

Replace (in `setWallet`, the wallet's fresh state):

```js
    set({ wallet, lamports: null, session: null, mine: {}, holdings: {} });
```

with:

```js
    set({ wallet, lamports: null, session: null, mine: {}, holdings: {}, opening: undefined });
```

Replace (in `setWallet`, the wallet's saved state):

```js
    const [session, mine] = await Promise.all([
      keep(() => saved(loginName(wallet)).get()),
      keep(() => saved(mineName(wallet)).get()),
    ]);
    if (get().wallet !== wallet) return; // switched meanwhile
    set({ session: session && session.exp > now() ? session : null, mine: mine ?? {} });
```

with:

```js
    const [session, mine, opening] = await Promise.all([
      keep(() => saved(loginName(wallet)).get()),
      keep(() => saved(mineName(wallet)).get()),
      openingOf(wallet),
    ]);
    if (get().wallet !== wallet) return; // switched meanwhile
    set({ session: session && session.exp > now() ? session : null, mine: mine ?? {}, opening });
```

Replace (after `joinCost`):

```js
  const joinCost = async () => (await flows.joinCost()).total;
```

with:

```js
  const joinCost = async () => (await flows.joinCost()).total;

  /** What an open takes from the wallet besides the commit (BigInt lamports). */
  const openCost = async () => (await flows.openCost()).total;

  /** Asks the server for a new coin: the wallet signs its details, then the server pins the
   *  picture and details to IPFS and issues the coin to this wallet. `coin`: create/rules.js
   *  mintFields(draft) plus `image` (the picture's bytes). Returns { ok: true, value: { mint,
   *  presale, name, symbol, image, uri } } or { ok: false, error }. */
  function mintCoin(coin, signer) {
    return run(
      "create",
      "create",
      async (onStep) => {
        onStep("Sign the coin details in your wallet");
        const signMessage = async (bytes) => {
          const signature = await signer.signMessage(bytes);
          onStep("Saving the picture and details to IPFS");
          return signature;
        };
        return flows.requestMint({ wallet: signer.publicKey, signMessage, ...coin });
      },
      createError,
    );
  }

  // wallet -> its saved open, or null once cleared: what this run of the app last wrote,
  // read before the disk. Secure storage can refuse a save (keep swallows it); this copy then
  // keeps the coin locked while the app runs. Every write goes through noteOpening, so it is
  // never older than the disk, which can be after a refused save or clear.
  const openings = new Map();

  /** Saves `record` as `wallet`'s open whose outcome wasn't known, or clears it (null): in
   *  memory first, then on disk. Saved for that wallet even if another is connected by now;
   *  the state shows it only while that wallet is the connected one (as remember does). */
  async function noteOpening(wallet, record) {
    openings.set(wallet, record);
    if (get().wallet === wallet) set({ opening: record });
    await keep(() => (record ? saved(openingName(wallet)).set(record) : saved(openingName(wallet)).clear()));
  }

  /** Clears `wallet`'s saved open if it is the coin of presale `key` (the screen's fresh
   *  start, Start over, and openCoin's own clears). A saved open for another coin stays. */
  async function forgetOpening(wallet, key) {
    if ((await openingOf(wallet))?.presale === key) await noteOpening(wallet, null);
  }

  /** `wallet`'s saved open, or null: this run's copy first, else the disk's if it is a whole
   *  record (create/rules.js isOpening). */
  async function openingOf(wallet) {
    if (openings.has(wallet)) return openings.get(wallet);
    const r = await keep(() => saved(openingName(wallet)).get());
    return isOpening(r) ? r : null;
  }

  /** Opens the presale for `coin` with the creator's `commit` (BigInt lamports), which is also
   *  their seat, then remembers the seat as this wallet's. `coin`: { mint, presale, symbol,
   *  name, description, links, image }, the server's coin with its presale's key
   *  (create/rules.js presaleKeyOf). Returns { ok: true, value: the presale's key (base58) }
   *  or { ok: false, error }, and on a retry also `read: { verdict, at }`: the read before it
   *  (create/rules.js checkBeforeRetry) and when it was asked, for the screen's canStartOver.
   *  - The coin is saved for the wallet (`opening`), with `at`, before the wallet is asked,
   *    so the screen keeps it, after a restart too, watches its presale and retries only it.
   *    No prompt, nothing saved. While it is saved, another mint gets OPEN_PENDING.
   *  - It is saved again, with a new `at`, once the wallet has signed and when an unknown
   *    outcome is reported: `at` is the coin's last save, which Start over waits on.
   *  - Once the wallet has signed, a failure that may have sent the open comes back as
   *    OUTCOME_UNKNOWN (create/rules.js openFailure), never a plain failure; the coin stays
   *    saved, and no seat is remembered.
   *  - A retry reads its presale first, before any other check: the server knowing it in
   *    any state means that open landed (ALREADY_OPEN, nothing signed; a presale that closed
   *    leaves no account, so the program would open the same coin again). Only the server's
   *    own 404 lets it go on, with the saved commit; anything else is RETRY_UNCHECKED.
   *  - A success and ALREADY_OPEN clear the saved coin, and so does a first try's plain
   *    failure. A retry's plain failure keeps it as it was before that try, even after the
   *    sign: the server never sent this try's tx, or sent it and it failed for certain. */
  async function openCoin(coin, commit, signer) {
    let pid = null; // the presale program's key (base58), for createError
    let read = null; // a retry's read: { verdict, at }
    const r = await run(
      "create",
      "create",
      async (onStep) => {
        const wallet = signer.publicKey.toBase58();
        const info = get().info ?? (await flows.loadInfo());
        pid = info.pid.toBase58();
        const had = await openingOf(wallet);
        if (had && had.mint !== coin.mint) throw new Error(OPEN_PENDING);
        let amount = commit;
        if (had) {
          // the read first: a landed open must never be signed again, whatever else is wrong
          onStep("Checking whether the presale is open");
          const at = now();
          const verdict = await checkBeforeRetry(() => api.presale(coin.presale));
          read = { verdict, at };
          if (verdict === "open") {
            await forgetOpening(wallet, coin.presale);
            throw new Error(ALREADY_OPEN);
          }
          if (verdict !== "retry") throw new Error(RETRY_UNCHECKED);
          amount = BigInt(had.commit); // fixed for its mint, whatever the screen hands in
          const kept = keptCommitProblem(amount, info.N);
          if (kept) throw new Error(kept);
          const lamports = get().wallet === wallet ? get().lamports : null;
          const short = shortOfOpen(amount, await openCost().catch(() => null), lamports);
          if (short) throw new Error(short);
        } else {
          const problem = commitProblem(commit, info.N);
          if (problem) throw new Error(problem);
        }
        const { mint, presale: key, symbol, name, description, links, image } = coin;
        const record = { mint, presale: key, symbol, name, description, links, image, commit: String(amount) };
        let sent = false; // the wallet signed: from here on the open may go out
        const signTransaction = async (tx) => {
          if (openLanded(key, get())) throw new Error(ALREADY_OPEN); // the feed has it: don't ask
          await noteOpening(wallet, { ...record, at: now() }); // saved before the wallet is asked
          onStep("Sign to open the presale with your SOL");
          const signed = await signer.signTransaction(tx);
          // saved again: Seed Vault changes the tx as it signs, maybe its blockhash too, so a
          // prompt held a long time must not count against Start over's wait
          await noteOpening(wallet, { ...record, at: now() });
          sent = true;
          onStep("Opening the presale");
          return signed;
        };
        let presale;
        try {
          presale = (await flows.openPresale({ info, wallet: signer.publicKey, signTransaction, mint, commit: amount })).toBase58();
        } catch (e) {
          const out = openFailure(e, sent);
          if (out?.outcomeUnknown) {
            // it may have landed: the coin stays saved, as of when that was reported
            await noteOpening(wallet, { ...record, at: now() });
            throw out;
          }
          if (createError(out, pid) === ALREADY_OPEN) await forgetOpening(wallet, key);
          // a retry's plain failure: as it was. Safe after the sign too: the server never sent
          // this try's tx, or sent it and it failed for certain, so it can't land
          else if (had) await noteOpening(wallet, had);
          else await forgetOpening(wallet, key); // a first try's: nothing of it can land
          throw out;
        }
        await forgetOpening(wallet, key);
        await remember(wallet, presale, { deposit: String(amount), at: now(), back: null });
        return presale;
      },
      (e) => createError(e, pid),
    );
    return read ? { ...r, read } : r;
  }
```

In the final `set({ … })` that lists the store's actions, replace the substring:

```js
preview, trade });
```

with:

```js
preview, trade, openCost, mintCoin, openCoin, forgetOpening });
```

After piece 3 the line ends `…joinCost, sendChat, noteRef, preview, trade });`. If it no longer ends `preview, trade });` (piece 2 or 3 changed it), add `, openCost, mintCoin, openCoin, forgetOpening` before its closing `});` by hand.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/create-store.test.mjs`
Expected: `# pass 29`, `# fail 0`

Run: `cd mobile && npm test 2>&1 | grep -E '^# (pass|fail)'`
Expected: pass is BEFORE + 52, `# fail 0`. `test/store.test.mjs` passes unchanged.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/store.js mobile/test/create-store.test.mjs && git commit -m "mobile: the store mints a coin and opens its presale, one action at a time, and remembers the creator's seat; an open that may have gone out after the wallet signed comes back unknown, never as a plain failure, and its coin is saved for the wallet before the wallet is asked, again once it has signed and when the unknown is reported (on disk, and in memory when the disk refuses); a retry of that coin reads its presale first: a presale the server knows in any state means the open landed, only the server's own 404 lets it sign, with the saved commit, and the read goes back to the screen for Start over; a retry's plain failure keeps the coin, and no other coin opens while it is saved

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/store.js mobile/test/create-store.test.mjs
```

---

### Task 4: The picture: camera, gallery, square JPEG

**Files:**
- Create: `mobile/src/create/picture.js`

How a picture is made:
1. Android's crop screen at 1:1 (`allowsEditing`, `aspect: [1, 1]`).
2. The picture is decoded first, because the picker's width and height may not match the pixels when the photo is rotated.
3. Its centred square is cut out (`squareOf`, in case the crop wasn't quite square), scaled to at most 1024 px and saved as a JPEG at 0.85.
4. The bytes are checked (`imageProblem`).

Native image references are released whatever happens. `pendingPicture` brings back a photo taken when Android closed the app to free memory while the camera was open.

This file imports native modules, so it can't run under Node. The parse check, the bundle check (Task 7) and the device (Task 7) cover it.

- [ ] **Step 1: Write the module**

Create `mobile/src/create/picture.js`:

```js
// The coin's picture, from the camera or the gallery: Android's crop screen at 1:1 first,
// then the centred square of what it gave (in case it isn't quite square), at most 1024 px,
// as a JPEG. Each gives { uri, bytes } (bytes: a Uint8Array, what flows.requestMint signs
// and sends), or null when the person backed out.
import { Buffer } from "buffer";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { imageProblem, squareOf } from "./rules";

const PICK = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 };

/** An error in words for the screen (anything else is the system's, shown in general terms). */
export class PictureError extends Error {}

/** A photo from the camera. Asks for the camera first; after a "don't ask again", says
 *  where to allow it. */
export async function fromCamera() {
  let perm = await ImagePicker.getCameraPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new PictureError("Mooner can't use the camera. Allow it in Settings, or choose from the gallery.");
  return finish(await ImagePicker.launchCameraAsync(PICK));
}

/** A picture from the gallery (Android's photo picker: no permission needed). */
export async function fromGallery() {
  return finish(await ImagePicker.launchImageLibraryAsync(PICK));
}

/** A picture taken just before Android closed the app to free memory (it can while the
 *  camera is open), or null. */
export async function pendingPicture() {
  const r = await ImagePicker.getPendingResultAsync();
  if (!r || "code" in r) return null; // nothing, or the picker's error ({ code, message })
  return finish(r);
}

async function finish(result) {
  if (result.canceled || !result.assets?.[0]) return null;
  const natives = []; // released at the end, whatever happens
  const hold = (x) => (natives.push(x), x);
  try {
    // decode first: the picker's width and height may not match the pixels (rotation)
    const decoded = hold(await hold(ImageManipulator.manipulate(result.assets[0].uri)).renderAsync());
    const { crop, size } = squareOf(decoded.width, decoded.height);
    const square = hold(await hold(ImageManipulator.manipulate(decoded)).crop(crop).resize({ width: size, height: size }).renderAsync());
    const saved = await square.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    const bytes = new Uint8Array(Buffer.from(saved.base64, "base64"));
    const problem = imageProblem(bytes);
    if (problem) throw new PictureError(problem);
    return { uri: saved.uri, bytes };
  } finally {
    for (const n of natives) {
      try {
        n.release();
      } catch {}
    }
  }
}
```

- [ ] **Step 2: Parse check**

Run from `mobile/` the parse check from the ground rules with `src/create/picture.js`.
Expected: `parsed 1 files`

- [ ] **Step 3: Commit**

```bash
git add mobile/src/create/picture.js && git commit -m "mobile: a coin's picture from the camera or the gallery, cropped square, at most 1024 px, as a JPEG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/create/picture.js
```

---

### Task 5: One Chip for seats and commits; the Create tab's icon

**Files:**
- Create: `mobile/src/ui/Chip.js`
- Modify: `mobile/src/room/JoinSheet.js`, `mobile/src/ui/icons.js`

The join sheet's amount chip moves to `src/ui/Chip.js`, so the commit step uses the same one. It gains an optional `label` for screen readers (the visible text when there's none), so the join sheet's chips read as before. Piece 2's `src/launched/TradeSheet.js` keeps its own copy: don't touch it in this plan. Reusing `ui/Chip.js` there is a follow-up.

- [ ] **Step 0: Check the files are clean**

Run: `git diff --quiet HEAD -- mobile/src/room/JoinSheet.js mobile/src/ui/icons.js && [ ! -e mobile/src/ui/Chip.js ] && echo clean`
Expected: `clean`. If not, stop and report (Dirty files).

- [ ] **Step 1: Create the shared chip**

Create `mobile/src/ui/Chip.js`:

```js
// An oval amount chip, for picking a seat or a commit.
import { Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { T } from "./kit";
import { C, F, R } from "./theme";

/** Quiet, or with the accent rim on a soft accent when picked (`on`). `label`: what a screen
 *  reader says, when it should say more than `text`. */
export function Chip({ text, label, on, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? text}
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        {
          flex: 1, height: 44, borderRadius: R.pill, borderWidth: 1, alignItems: "center", justifyContent: "center",
          backgroundColor: on ? C.accentSoft : C.bg2, borderColor: on ? C.accent : C.lineStrong,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <T style={{ fontFamily: F.semi, fontSize: 15 }}>{text}</T>
    </Pressable>
  );
}
```

- [ ] **Step 2: The join sheet uses it**

Apply these blocks to `mobile/src/room/JoinSheet.js`, in order.

Replace:

```js
import { ActivityIndicator, Pressable, View } from "react-native";
```

with:

```js
import { ActivityIndicator, View } from "react-native";
```

Replace:

```js
import { solText } from "../ui/format";
```

with:

```js
import { Chip } from "../ui/Chip";
import { solText } from "../ui/format";
```

Replace:

```js
import { C, F, R } from "../ui/theme";
```

with:

```js
import { C } from "../ui/theme";
```

Delete the local chip at the end of the file: this block, and the blank line before it. The file then ends with the `JoinSheet` function's closing `}` and a newline.

```js
/** An oval amount chip: quiet, or with the accent rim on a soft accent when picked. */
function Chip({ text, on, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        {
          flex: 1, height: 44, borderRadius: R.pill, borderWidth: 1, alignItems: "center", justifyContent: "center",
          backgroundColor: on ? C.accentSoft : C.bg2, borderColor: on ? C.accent : C.lineStrong,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <T style={{ fontFamily: F.semi, fontSize: 15 }}>{text}</T>
    </Pressable>
  );
}
```

- [ ] **Step 3: The plus icon**

In `mobile/src/ui/icons.js`, replace:

```js
/** A chevron pointing left: back. */
```

with:

```js
/** A plus in a rounded square: create. */
export function PlusIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={3} width={18} height={18} rx={5} stroke={color} {...STROKE} />
      <Path d="M12 8 V16 M8 12 H16" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A chevron pointing left: back. */
```

- [ ] **Step 4: Tests and parse check**

Run: `cd mobile && npm test 2>&1 | grep -E '^# (pass|fail)'`
Expected: pass is BEFORE + 52, `# fail 0`

Run from `mobile/` the parse check with `src/ui/Chip.js src/room/JoinSheet.js src/ui/icons.js`.
Expected: `parsed 3 files`

Run: `cd mobile && grep -n "Pressable\|\bF\.\|\bR\." src/room/JoinSheet.js`
Expected: no output. Nothing else in the sheet used them.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/ui/Chip.js mobile/src/room/JoinSheet.js mobile/src/ui/icons.js && git commit -m "mobile: the amount chip shared from ui/Chip.js, with an optional screen-reader label; a plus icon for the Create tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/ui/Chip.js mobile/src/room/JoinSheet.js mobile/src/ui/icons.js
```

---

### Task 6: The four steps' parts

**Files:**
- Create: `mobile/src/create/Field.js`, `mobile/src/create/PictureStep.js`, `mobile/src/create/DetailsStep.js`, `mobile/src/create/CommitStep.js`, `mobile/src/create/ReviewStep.js`, `mobile/src/create/Unopened.js`

Each part only shows what it's given; the screen (Task 7) holds the state.
- `Field`: a labelled input in the well.
- `PictureStep`: Camera / Gallery and the picture.
- `DetailsStep`: name, ticker, description, X, Telegram, Website. Problems show once Next was tried.
- `CommitStep`: the chips, the target, the wallet's SOL, and what it lacks.
- `ReviewStep`: the coin as it will look, the numbers, how many times the wallet asks, the steps, and Open presale. While an open's outcome isn't known (`waiting`), a line says the room opens by itself if it went through, and that trying again can't open the coin twice. Open presale stays pressable then even if the wallet looks short: the store's retry reads the presale before its own funds check, and that read is what Start over needs. With `onStartOver` (the screen passes it only when `canStartOver` says yes), the line says the last open is too old to land, and a quiet "Start over with a new coin" button shows.
- `Unopened`: coins issued but never opened, each with Open.

- [ ] **Step 1: The text field**

Create `mobile/src/create/Field.js`:

```js
// A labelled text field in the well: the accent rim while typing, the down rim and the
// problem under it when there's one, else the hint.
import { useState } from "react";
import { TextInput, View } from "react-native";
import { T } from "../ui/kit";
import { C, F, R } from "../ui/theme";

/** `error` and `hint`: text or nothing. Other props go to the TextInput. */
export function Field({ label, error, hint, multiline, ...input }) {
  const [focused, setFocused] = useState(false);
  const rim = error ? C.down : focused ? C.accent : C.wellLine;
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label}</T>
      <TextInput
        {...input}
        multiline={multiline}
        accessibilityLabel={label}
        placeholderTextColor={C.text2}
        selectionColor={C.accentSoft}
        cursorColor={C.accent}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          minHeight: multiline ? 96 : 48, paddingHorizontal: 14, paddingVertical: multiline ? 12 : 0,
          borderRadius: R.m, backgroundColor: C.well, borderWidth: 1, borderColor: rim,
          color: C.text0, fontFamily: F.regular, fontSize: 16, textAlignVertical: multiline ? "top" : "center",
        }}
      />
      {error ? <T v="small" color={C.down}>{error}</T> : hint ? <T v="small" color={C.text2}>{hint}</T> : null}
    </View>
  );
}
```

- [ ] **Step 2: Step 1, the picture**

Create `mobile/src/create/PictureStep.js`:

```js
// Step 1: the coin's picture, from the camera or the gallery, cropped square.
import { useEffect, useState } from "react";
import { View } from "react-native";
import { CoinImage } from "../ui/CoinImage";
import { Button, T } from "../ui/kit";
import { C } from "../ui/theme";
import { PictureError, fromCamera, fromGallery, pendingPicture } from "./picture";

const SIZE = 200;

/** `picture`: { uri, bytes } or null. `onPicture` must keep its identity (a state setter). */
export function PictureStep({ picture, onPicture, onNext }) {
  const [opening, setOpening] = useState(null); // "camera" | "gallery" while it's open
  const [error, setError] = useState(null);

  // Android may close the app while the camera is open: the photo comes back on the next start.
  useEffect(() => {
    let on = true;
    pendingPicture().then((p) => on && p && onPicture(p), () => {});
    return () => {
      on = false;
    };
  }, [onPicture]);

  async function pick(kind) {
    if (opening) return;
    setOpening(kind);
    setError(null);
    try {
      const p = kind === "camera" ? await fromCamera() : await fromGallery();
      if (p) onPicture(p);
    } catch (e) {
      setError(e instanceof PictureError ? e.message : "Couldn't get that picture. Try again.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        {picture ? (
          <CoinImage uri={picture.uri} size={SIZE} />
        ) : (
          <View
            style={{
              width: SIZE, height: SIZE, borderRadius: SIZE * 0.28, borderWidth: 1, borderStyle: "dashed",
              borderColor: C.lineStrong, backgroundColor: C.bg1, alignItems: "center", justifyContent: "center",
            }}
          >
            <T v="small" color={C.text2}>No picture yet</T>
          </View>
        )}
      </View>
      <T v="small" style={{ textAlign: "center" }}>It's cropped square and shows next to the ticker everywhere.</T>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button kind="quiet" title="Camera" busy={opening === "camera"} disabled={!!opening} onPress={() => pick("camera")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button kind="quiet" title="Gallery" busy={opening === "gallery"} disabled={!!opening} onPress={() => pick("gallery")} />
        </View>
      </View>
      {error ? <T v="small" color={C.down}>{error}</T> : null}
      <Button title="Next" disabled={!picture || !!opening} onPress={onNext} />
    </View>
  );
}
```

- [ ] **Step 3: Step 2, the details**

Create `mobile/src/create/DetailsStep.js`:

```js
// Step 2: the coin's name, ticker, description and links. Problems show once Next was tried.
import { View } from "react-native";
import { Button } from "../ui/kit";
import { Field } from "./Field";
import { DESCRIPTION_MAX, NAME_MAX, TICKER_MAX, normalizeTicker } from "./rules";

/** `draft`: rules.js blankDraft() as typed; `errors`: validate(draft); `tried`: Next was
 *  pressed once (the problems show from then on). */
export function DetailsStep({ draft, onDraft, errors, tried, onNext }) {
  const set = (field, clean = (v) => v) => (v) => onDraft({ ...draft, [field]: clean(v) });
  const setLink = (kind) => (v) => onDraft({ ...draft, links: { ...draft.links, [kind]: v } });
  const shown = tried ? errors : {};
  const left = DESCRIPTION_MAX - draft.description.length;
  const link = { autoCapitalize: "none", autoCorrect: false, returnKeyType: "next" };
  return (
    <View style={{ gap: 16 }}>
      <Field label="Name" value={draft.name} onChangeText={set("name")} error={shown.name} maxLength={NAME_MAX} autoCapitalize="words" returnKeyType="next" />
      <Field
        label="Ticker"
        value={draft.ticker}
        onChangeText={set("ticker", normalizeTicker)}
        error={shown.ticker}
        hint="2 to 10 letters or digits"
        maxLength={TICKER_MAX}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="next"
      />
      <Field
        label="Description (optional)"
        value={draft.description}
        onChangeText={set("description")}
        error={shown.description}
        hint={`${left} characters left`}
        maxLength={DESCRIPTION_MAX}
        multiline
      />
      <Field label="X (optional)" value={draft.links.x} onChangeText={setLink("x")} error={shown.x} placeholder="@handle or link" keyboardType="email-address" {...link} />
      <Field label="Telegram (optional)" value={draft.links.telegram} onChangeText={setLink("telegram")} error={shown.telegram} placeholder="@group or link" keyboardType="email-address" {...link} />
      <Field label="Website (optional)" value={draft.links.website} onChangeText={setLink("website")} error={shown.website} placeholder="yoursite.com" keyboardType="url" {...link} />
      <Button title="Next" onPress={onNext} />
    </View>
  );
}
```

- [ ] **Step 4: Step 3, the commit**

Create `mobile/src/create/CommitStep.js`:

```js
// Step 3: the creator's commit, which is also their seat: from the smallest seat up to the
// most the co-signer lets a creator put in, and whether the wallet covers it.
import { ActivityIndicator, View } from "react-native";
import { Chip } from "../ui/Chip";
import { solText } from "../ui/format";
import { Button, T } from "../ui/kit";
import { C } from "../ui/theme";

/** `choices`: rules.js commitChoices(N); `commit`: the pick (BigInt lamports); `extra`:
 *  openCost() (BigInt, null while it's read); `costFailed`: it couldn't be read; `lamports`:
 *  the wallet's SOL (a number, null while it's read); `short`: rules.js shortOfOpen(...);
 *  `target`: N.TARGET. */
export function CommitStep({ choices, commit, onCommit, extra, costFailed, lamports, short, target, onNext }) {
  const reading = extra == null && !costFailed;
  return (
    <View style={{ gap: 16 }}>
      <T v="body" color={C.text1}>
        You're first in. Your commit is your seat in the pool, at the same price as everyone. It stays in until launch; if the pool doesn't fill in time, it comes back to your wallet by itself.
      </T>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {choices.map((c) => (
          <Chip key={String(c)} text={`${solText(c)} SOL`} label={`Commit ${solText(c)} SOL`} on={c === commit} onPress={() => onCommit(c)} />
        ))}
      </View>
      <T v="small">{`It launches when ${solText(target)} SOL is in the pool.`}</T>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T v="small">Wallet</T>
        {lamports == null ? <ActivityIndicator size="small" color={C.text1} /> : <T v="num">{`${solText(lamports)} SOL`}</T>}
      </View>
      {costFailed ? (
        <T v="small">Couldn't read the fees and rent right now. You can still go on; Solana refuses the open if your SOL doesn't cover it.</T>
      ) : null}
      {short ? <T v="small" color={C.down}>{short}</T> : null}
      <Button title="Next" onPress={onNext} busy={reading} disabled={!!short} />
    </View>
  );
}
```

- [ ] **Step 5: Step 4, the last look**

Create `mobile/src/create/ReviewStep.js`:

```js
// Step 4: a last look at the coin and what opening takes, then Open presale.
import { ActivityIndicator, View } from "react-native";
import { CoinImage } from "../ui/CoinImage";
import { solText } from "../ui/format";
import { LinkPills } from "../ui/LinkPills";
import { Button, Card, Steps, T } from "../ui/kit";
import { C } from "../ui/theme";

function Row({ label, children }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <T v="small">{label}</T>
      {typeof children === "string" ? <T v="num">{children}</T> : children}
    </View>
  );
}

/** `fields`: rules.js mintFields(draft); `issued`: the server already has this coin (the
 *  wallet then signs once); `step`: the store's busy step while creating; `blocked`: another
 *  action is running; `waiting`: an open's outcome isn't known, and the screen watches for it.
 *  While waiting, `short` doesn't disable Open presale: the store reads the presale before
 *  its own funds check, and Start over needs that read. `onStartOver`: given only when
 *  rules.js canStartOver says yes (Task 7), else null. */
export function ReviewStep({ picture, fields, commit, extra, costFailed, target, minutes, issued, short, error, waiting, creating, step, blocked, canSign, onOpen, onStartOver }) {
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <CoinImage uri={picture?.uri} size={56} ticker={fields.symbol} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h2" numberOfLines={1}>{fields.name}</T>
            <T v="small">{`$${fields.symbol}`}</T>
          </View>
        </View>
        {fields.description ? <T v="small" color={C.text0}>{fields.description}</T> : null}
        <LinkPills token={{ links: fields.links }} />
      </Card>
      <View style={{ gap: 10 }}>
        <Row label="Your commit">{`${solText(commit)} SOL`}</Row>
        <Row label="Fees and rent">
          {extra != null ? `about ${solText(extra, 4)} SOL` : costFailed ? "Not known yet" : <ActivityIndicator size="small" color={C.text1} />}
        </Row>
        <Row label="Launches at">{`${solText(target)} SOL`}</Row>
        <Row label="Time to fill">{`${minutes} minutes`}</Row>
      </View>
      <T v="small">
        {issued
          ? "Your wallet asks once: to open the presale with your SOL."
          : "Your wallet asks twice: to sign the coin's details, then to open the presale with your SOL."}
      </T>
      {short ? <T v="small" color={C.down}>{short}</T> : null}
      {error ? <T v="small" color={C.down}>{error}</T> : null}
      {waiting ? (
        <T v="small">
          {onStartOver
            ? `No $${fields.symbol} presale showed up, and its last open is too old to land now. Try it again, or start over with a new coin.`
            : "If it went through, the room opens by itself. Trying again uses the same coin, so it can't open twice."}
        </T>
      ) : null}
      {creating ? <Steps step={step} /> : null}
      <Button title={`Open presale · ${solText(commit)} SOL`} onPress={onOpen} busy={creating} disabled={!canSign || blocked || (!!short && !waiting)} />
      {onStartOver ? <Button kind="quiet" title="Start over with a new coin" onPress={onStartOver} /> : null}
    </View>
  );
}
```

- [ ] **Step 6: Coins not opened yet**

Create `mobile/src/create/Unopened.js`:

```js
// The wallet's coins whose presale never opened (the open failed or was cancelled): each
// opens from here without signing its details again.
import { View } from "react-native";
import { CoinImage } from "../ui/CoinImage";
import { Card, PillButton, T } from "../ui/kit";

/** `tokens`: rules.js unopenedOf(...); `onOpen(token)`. */
export function Unopened({ tokens, onOpen }) {
  return (
    <Card style={{ gap: 12 }}>
      <T v="label">Not opened yet</T>
      {tokens.map((t) => (
        <View key={t.mint} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <CoinImage uri={t.image} size={40} ticker={t.symbol} />
          <View style={{ flex: 1 }}>
            <T numberOfLines={1}>{t.name}</T>
            <T v="small">{`$${t.symbol}`}</T>
          </View>
          <PillButton title="Open" accessibilityLabel={`Open the $${t.symbol} presale`} onPress={() => onOpen(t)} />
        </View>
      ))}
    </Card>
  );
}
```

- [ ] **Step 7: Parse check**

Run from `mobile/` the parse check with `src/create/Field.js src/create/PictureStep.js src/create/DetailsStep.js src/create/CommitStep.js src/create/ReviewStep.js src/create/Unopened.js`.
Expected: `parsed 6 files`

- [ ] **Step 8: Commit**

```bash
git add mobile/src/create/Field.js mobile/src/create/PictureStep.js mobile/src/create/DetailsStep.js mobile/src/create/CommitStep.js mobile/src/create/ReviewStep.js mobile/src/create/Unopened.js && git commit -m "mobile: Create's parts: the field, the picture, the details, the commit, the last look and coins not opened yet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/create/Field.js mobile/src/create/PictureStep.js mobile/src/create/DetailsStep.js mobile/src/create/CommitStep.js mobile/src/create/ReviewStep.js mobile/src/create/Unopened.js
```

---

### Task 7: The Create tab, and the device check up to Seed Vault

**Files:**
- Create: `mobile/app/(tabs)/create.js`
- Modify: `mobile/app/(tabs)/_layout.js`

How the screen works:
- **Signed out:** the logo, a line on what connecting gives, and Connect Seed Vault.
- **Signed in:** the `Creator` is keyed by the wallet, so another wallet starts afresh. It starts once the store has read the wallet's saved open (`opening` is no longer undefined). A saved one comes back through `restoredOpen`: its coin on the last look, its commit, Back locked, and its presale watched.
- **Moving between steps:** Back and Android's back move one step back. On the first step, Android's back leaves the tab as usual. While an open runs, or its outcome isn't known, Back is hidden and Android's back stays put (`backAction`).
- **The wallet's coins** are read from `GET /api/wallet/<wallet>/tokens` each time the tab is shown and after each failed try. The server doesn't push them.
- **The open cost** is read on reaching the commit step.
- **Open presale:**
  1. `mintCoin`, unless the coin was issued already;
  2. `openCoin`;
  3. a success buzz, then the form resets and the room opens with the share sheet up. The share words are piece 3's, through `newPresaleShare`, with the creator's wallet as the link's ref. Only an open that succeeded here brings the share sheet: its words are made from that open. A presale found later (the watch, or ALREADY_OPEN) may have aged or closed since, so the room opens without it, and the room's own Share (piece 3) has its real numbers.

  If the open fails after the coin was issued, the coin stays in the screen's state. Pressing Open presale again then asks the wallet once. The coin also shows under "Not opened yet" the next time the tab is shown.
- **An open whose outcome isn't known** (OUTCOME_UNKNOWN from `openCoin`):
  - the coin stays, and Back stays put, so Open presale can only retry the same coin;
  - the store saved the coin for the wallet before the wallet was asked, again once it signed, and again when the unknown was reported, so after an app restart, Android ending the app or a reconnect, the screen comes back to it the same way, until it settles;
  - a retry reads the presale first (Task 3): if the server knows it in any state, the screen goes to the room. Only the server's own 404 lets it sign; any other answer shows "Couldn't check…" and nothing is signed;
  - a retry uses the saved commit. If that no longer fits a seat, the store's one line says so (for example "0.3 SOL is more than a seat can hold now."), and nothing is signed. Start over, once it shows, is the way out;
  - Open presale stays pressable while waiting, even if the wallet looks short: the store's funds check comes after its read, and Start over needs that read;
  - the screen watches the presale's key (`presaleKeyOf`) through the store's `watch`, and runs the success path once the presale shows up (`openLanded`). It skips that while a try runs (`trying`: from the tap until `open()` has handled the answer), and picks it up again after every answer that keeps the coin;
  - so an open that succeeded here always brings the share sheet. `open()` calls `opened(key, symbol, true)` before `trying` goes false, and `opened` resets the form, which clears `unknown` and stops the watch. The store's `busy` alone wouldn't do: `run` clears it in its `finally`, before `openCoin`'s answer reaches `open()`, and the watch could take the presale first, with no share sheet;
  - a retry of an open that had landed comes back ALREADY_OPEN, and goes to the room the same way;
  - **Start over:** "Start over with a new coin" shows only when `canStartOver(opening, read.verdict, read.at)` says yes: the last retry's read got the server's own 404, more than 5 minutes after the coin's last save (`opening.at`: before the prompt, once the wallet signed, or when an unknown was reported). It never shows while a try runs. It clears that coin's saved open (`forgetOpening(wallet, presale)`), then resets the form and reads the wallet's coins again. The coin shows under "Not opened yet" then: its `presale` is still null on the server;
  - the fresh form after a landed open clears the saved coin: `reset(key)` with the presale's key, which `opened(key)` passes. A reset without a key (Back's fresh start) clears nothing.
- **Back from the commit step of an issued coin** starts afresh. An issued coin's details are fixed: its name, ticker and picture were signed and pinned.

- [ ] **Step 0: Check the files are clean**

Run: `git diff --quiet HEAD -- "mobile/app/(tabs)/_layout.js" && git diff --quiet c38e1c4 HEAD -- "mobile/app/(tabs)/_layout.js" && [ ! -e "mobile/app/(tabs)/create.js" ] && echo clean`
Expected: `clean`. If the second check fails, someone changed the tabs since this plan was checked: make Step 2's changes by hand (see there). Otherwise stop and report (Dirty files).

- [ ] **Step 1: The screen**

Create `mobile/app/(tabs)/create.js`:

```js
// Create: a new coin and its presale in four steps (the picture, the details, your commit, a
// last look). The wallet signs the coin's details (the server pins them to IPFS and issues
// the coin), then the open with the creator's SOL; then the room opens with the share sheet
// up. A coin issued but never opened waits at the top, to open without signing its details
// again. An open whose outcome isn't known keeps its coin and watches its presale: it can
// only be retried, never become a second coin. The store saves that coin for the wallet
// before the wallet is asked (and again once it signs, and when an unknown is reported), so
// it comes back after a restart too. Start over shows only once the server's own 404 came
// more than 5 minutes after the coin was last saved.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Pressable, ScrollView, Share, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { api, store } from "../../src/app";
import { CommitStep } from "../../src/create/CommitStep";
import { DetailsStep } from "../../src/create/DetailsStep";
import { PictureStep } from "../../src/create/PictureStep";
import { ReviewStep } from "../../src/create/ReviewStep";
import { Unopened } from "../../src/create/Unopened";
import {
  ALREADY_OPEN, backAction, blankDraft, canStartOver, commitChoices, draftOf, hasErrors, isUnknown, mintFields, openLanded,
  presaleKeyOf, restoredOpen, shortOfOpen, takenTickers, unopenedOf, validate,
} from "../../src/create/rules";
import { newPresaleShare } from "../../src/create/share";
import { useConnect } from "../../src/useConnect";
import { useAccount, useSigner } from "../../src/wallet";
import { BackIcon } from "../../src/ui/icons";
import { Logo } from "../../src/ui/Logo";
import { Button, Screen, T } from "../../src/ui/kit";
import { C, S } from "../../src/ui/theme";

const STEPS = ["picture", "details", "commit", "review"];
const TITLES = { picture: "Picture", details: "Name and links", commit: "Your commit", review: "Open the presale" };

export default function Create() {
  const wallet = useStore(store, (s) => s.wallet);
  const opening = useStore(store, (s) => s.opening); // undefined until the wallet's saved open is read
  const account = useAccount();
  if (wallet && opening !== undefined) return <Creator key={wallet} wallet={wallet} saved={opening} />;
  return (
    <Screen padded={false}>
      <Header />
      {account === undefined || wallet ? <Loading /> : <SignedOut />}
    </Screen>
  );
}

/** "Create", with Back (not while `locked`) and the step on a step past the first. */
function Header({ at = 0, locked = false, onBack }) {
  return (
    <View style={{ paddingHorizontal: S.gutter, paddingTop: 12, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8 }}>
      {at > 0 && !locked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onBack();
          }}
          style={({ pressed }) => [{ width: 32, height: 44, justifyContent: "center" }, pressed && { opacity: 0.6 }]}
        >
          <BackIcon color={C.text0} />
        </Pressable>
      ) : null}
      <T v="title" style={{ flex: 1 }}>Create</T>
      {onBack ? <T v="small" color={C.text2}>{`Step ${at + 1} of ${STEPS.length}`}</T> : null}
    </View>
  );
}

const Loading = () => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
    <ActivityIndicator color={C.text1} />
  </View>
);

/** No wallet: the logo, what connecting gives, and Connect Seed Vault. */
function SignedOut() {
  const { connect, busy, error } = useConnect();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: S.gutter, paddingBottom: 32 }}>
      <Logo size={96} />
      <T v="body" color={C.text1} style={{ textAlign: "center" }}>Connect your wallet to create a coin and open its presale</T>
      {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
      <Button title="Connect Seed Vault" onPress={connect} busy={busy} />
    </View>
  );
}

/** The four steps for `wallet` (keyed by it, so another wallet starts afresh). `saved`: the
 *  store's `opening` when it mounts; later changes don't reach the state (the live `opening`
 *  is read for Start over only). */
function Creator({ wallet, saved }) {
  const signer = useSigner();
  const info = useStore(store, (s) => s.info);
  const infoError = useStore(store, (s) => s.infoError);
  const lamports = useStore(store, (s) => s.lamports);
  const presales = useStore(store, (s) => s.presales);
  const launched = useStore(store, (s) => s.launched);
  const busy = useStore(store, (s) => s.busy);
  const opening = useStore(store, (s) => s.opening); // the saved open as it is now, with its `at`

  // an open whose outcome wasn't known, saved for this wallet: back on the last look, locked
  // to its coin, watching its presale
  const [start] = useState(() => restoredOpen(saved));
  const [step, setStep] = useState(start?.step ?? "picture");
  const [picture, setPicture] = useState(start?.picture ?? null); // { uri, bytes }; bytes null for a coin already issued
  const [draft, setDraft] = useState(() => start?.draft ?? blankDraft());
  const [tried, setTried] = useState(false); // Next was pressed on the details: problems show
  const [commit, setCommit] = useState(start?.commit ?? null); // BigInt lamports; null: the smallest
  const [coin, setCoin] = useState(start?.coin ?? null); // the server's coin once issued ({ mint, symbol, ... })
  const [extra, setExtra] = useState(null); // openCost(), BigInt
  const [costFailed, setCostFailed] = useState(false);
  const [error, setError] = useState(start?.error ?? null);
  const [tokens, setTokens] = useState(null); // GET /api/wallet/<wallet>/tokens
  const [unknown, setUnknown] = useState(start?.unknown ?? null); // the presale key of an open whose outcome isn't known
  const [read, setRead] = useState(null); // the last retry's read: { verdict, at } (store openCoin)
  const [trying, setTrying] = useState(false); // open() runs: from the tap until it has handled the answer

  const creating = busy?.kind === "create";
  const locked = creating || trying || !!unknown; // the coin stays, and Back stays put
  // only after the server's own 404, more than START_OVER_MS after the coin's last save
  const mayStartOver =
    !!unknown && !creating && !trying && opening?.presale === unknown && canStartOver(opening, read?.verdict, read?.at);
  const at = STEPS.indexOf(step);
  const taken = useMemo(() => takenTickers({ presales, launched }), [presales, launched]);
  const errors = useMemo(() => validate(draft, { taken }), [draft, taken]);
  const fields = useMemo(() => mintFields(draft), [draft]);
  const choices = useMemo(() => (info ? commitChoices(info.N) : []), [info]);
  const unopened = useMemo(() => unopenedOf(tokens, presales), [tokens, presales]);
  const pick = commit ?? choices[0] ?? null;
  const short = pick == null ? null : shortOfOpen(pick, extra, lamports);
  // at the start, and on the last look (where "open one of them first" shows): never over a coin being opened
  const showUnopened = !coin && unopened.length > 0 && (step === "picture" || step === "review");

  // The wallet's coins: read each time the tab is shown and after each try (no push for them).
  const readTokens = useCallback(() => {
    api.walletTokens(wallet).then(setTokens, () => {});
  }, [wallet]);
  useFocusEffect(readTokens);

  // What opening takes besides the commit: read on reaching the commit step.
  const needCost = step === "commit" || step === "review";
  useEffect(() => {
    if (!needCost) return;
    let on = true;
    setCostFailed(false);
    store.getState().openCost().then(
      (x) => on && setExtra(x),
      () => on && setCostFailed(true),
    );
    return () => {
      on = false;
    };
  }, [needCost]);

  // A fresh form. `key`: the presale that just settled (opened passes it), whose saved open is
  // cleared; none (Back's fresh start) clears nothing.
  const reset = useCallback(
    (key) => {
      setStep("picture");
      setPicture(null);
      setDraft(blankDraft());
      setTried(false);
      setCommit(null);
      setCoin(null);
      setError(null);
      setUnknown(null);
      setRead(null);
      if (key) store.getState().forgetOpening(wallet, key);
    },
    [wallet],
  );

  // Back a step; from the commit of a coin already issued, back to a fresh start; nothing
  // while locked. false on the first step, so Android's back leaves the tab as usual.
  const back = useCallback(() => {
    const action = backAction({ at, locked, issued: !!coin, step });
    if (action === "leave") return false;
    if (action === "stay") return true;
    setError(null);
    if (action === "restart") reset();
    else setStep(STEPS[at - 1]);
    return true;
  }, [at, locked, coin, step, reset]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", back);
      return () => sub.remove();
    }, [back]),
  );

  // The open landed: a success buzz, a fresh form (which stops the watch below before the room
  // starts its own, and clears the saved open), the room, and over it the share sheet, only
  // for an open that succeeded here (`share`): its words are made from that open. A presale
  // found later (the watch, ALREADY_OPEN) may have aged or closed since; the room's own Share
  // has its real numbers. Once per presale: the store's answer and the watched presale can
  // both bring it.
  const done = useRef(null);
  const opened = useCallback(
    (key, symbol, share) => {
      if (done.current === key) return;
      done.current = key;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      reset(key);
      readTokens();
      router.push(`/presale/${key}`);
      const words = share ? newPresaleShare({ key, symbol, wallet, commit: pick, N: info.N, now: Date.now() }) : null;
      if (words) Share.share(words, { dialogTitle: "Share this presale" }).catch(() => {});
    },
    [reset, readTokens, wallet, pick, info],
  );

  // An open whose outcome isn't known: watch its presale over the socket. Once it shows up,
  // the open landed, and it goes the way a success does. Not while a try runs: open() handles
  // its own answer first (a success here brings the share sheet), and every answer that keeps
  // the coin sets `trying` false, which runs this again.
  useEffect(() => {
    if (!unknown) return;
    return store.getState().watch(unknown);
  }, [unknown]);
  const landed = useStore(store, (s) => openLanded(unknown, s));
  useEffect(() => {
    if (landed && !creating && !trying) opened(unknown, coin.symbol, false);
  }, [landed, creating, trying, unknown, coin, opened]);

  // Leaves the saved coin for a new one: only when canStartOver said yes (mayStartOver).
  async function startOver() {
    if (!mayStartOver) return;
    await store.getState().forgetOpening(wallet, unknown);
    reset();
    readTokens(); // the coin left shows under "Not opened yet"
  }

  function resume(t) {
    if (locked) return;
    setPicture({ uri: t.image, bytes: null });
    setDraft(draftOf(t));
    setCoin(t);
    setCommit(null);
    setError(null);
    setStep("commit");
  }

  function details() {
    setTried(true);
    if (!hasErrors(errors)) setStep("commit");
  }

  function failed(why) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setError(why);
    readTokens();
  }

  async function open() {
    if (trying || store.getState().busy || !signer || pick == null) return;
    setError(null);
    setRead(null);
    setTrying(true);
    try {
      let issued = coin;
      if (!issued) {
        const r = await store.getState().mintCoin({ ...fields, image: picture.bytes }, signer);
        if (!r.ok) return failed(r.error);
        issued = r.value;
        setCoin(issued);
      }
      const key = presaleKeyOf(info, issued.mint);
      const r = await store.getState().openCoin({ ...fields, mint: issued.mint, presale: key, image: issued.image }, pick, signer);
      setRead(r.read ?? null); // a retry's read, for Start over
      if (r.ok) return opened(r.value, issued.symbol, true);
      if (r.error === ALREADY_OPEN) return opened(key, issued.symbol, false);
      if (isUnknown(r.error)) setUnknown(key); // the coin stays (the store saved it); the watch above sees it land
      failed(r.error);
    } finally {
      setTrying(false); // after opened() above, so the watch can't take a success first
    }
  }

  let body;
  if (step === "picture") {
    body = <PictureStep picture={picture} onPicture={setPicture} onNext={() => setStep("details")} />;
  } else if (step === "details") {
    body = <DetailsStep draft={draft} onDraft={setDraft} errors={errors} tried={tried} onNext={details} />;
  } else if (!info) {
    body = infoError ? <T v="small" color={C.down}>{infoError}</T> : <ActivityIndicator color={C.text1} />;
  } else if (step === "commit") {
    body = (
      <CommitStep
        choices={choices}
        commit={pick}
        onCommit={setCommit}
        extra={extra}
        costFailed={costFailed}
        lamports={lamports}
        short={short}
        target={info.N.TARGET}
        onNext={() => setStep("review")}
      />
    );
  } else {
    body = (
      <ReviewStep
        picture={picture}
        fields={fields}
        commit={pick}
        extra={extra}
        costFailed={costFailed}
        target={info.N.TARGET}
        minutes={Math.round(Number(info.N.DURATION) / 60)}
        issued={!!coin}
        short={short}
        error={error}
        waiting={!!unknown}
        creating={creating}
        step={creating ? busy.step : null}
        blocked={!!busy && !creating}
        canSign={!!signer}
        onOpen={open}
        onStartOver={mayStartOver ? startOver : null}
      />
    );
  }

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <Header at={at} locked={locked} onBack={back} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.gutter, paddingBottom: 32, gap: 16 }}>
          {showUnopened ? <Unopened tokens={unopened} onOpen={resume} /> : null}
          <T v="h2">{TITLES[step]}</T>
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
```

- [ ] **Step 2: The tab**

Replace all of `mobile/app/(tabs)/_layout.js` with:

```js
// The tabs: Live (open presales), Launched (coins out of presale), Create (a new coin and its
// presale), Me.
import { Tabs } from "expo-router";
import { LaunchedIcon, LiveIcon, MeIcon, PlusIcon } from "../../src/ui/icons";
import { C, F } from "../../src/ui/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg0 },
        tabBarStyle: { backgroundColor: C.bg1, borderTopColor: C.line, borderTopWidth: 1 },
        tabBarActiveTintColor: C.text0,
        tabBarInactiveTintColor: C.text2,
        tabBarLabelStyle: { fontFamily: F.medium, fontSize: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Live", tabBarIcon: ({ color }) => <LiveIcon color={color} /> }} />
      <Tabs.Screen name="launched" options={{ title: "Launched", tabBarIcon: ({ color }) => <LaunchedIcon color={color} /> }} />
      <Tabs.Screen
        name="create"
        options={{ title: "Create", tabBarHideOnKeyboard: true, tabBarIcon: ({ color }) => <PlusIcon color={color} /> }}
      />
      <Tabs.Screen name="me" options={{ title: "Me", tabBarIcon: ({ color }) => <MeIcon color={color} /> }} />
    </Tabs>
  );
}
```

The other screens' options are exactly as at `c38e1c4` (the file is unchanged since `15faf16`). If Step 0 found it changed since `c38e1c4`, don't replace it. Make the same three changes by hand:
- the header comment;
- `PlusIcon` in the icons import;
- the `create` `Tabs.Screen` between `launched` and `me`, as above.

- [ ] **Step 3: Tests, parse check, bundle check**

Run: `cd mobile && npm test 2>&1 | grep -E '^# (pass|fail)'`
Expected: pass is BEFORE + 52, `# fail 0`

Run from `mobile/` the parse check with `"app/(tabs)/create.js" "app/(tabs)/_layout.js"`.
Expected: `parsed 2 files`

- [ ] **Step 4: Bundle check, then install on the Seeker**

Run: `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh` (after piece 3's USER STEP B and before its USER STEP C, install nothing; see Device in the ground rules)
Expected: `web3.js copies: 1; files from engine/node_modules: 0`, `app/ entries from this checkout:` above 0, then `BUILD SUCCESSFUL`; the app opens with four tabs: Live, Launched, Create, Me. On `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, stop and bring it to the user.

The user must be at the phone from here to the end of this task. They pick the picture, answer the camera's permission dialog, and decline in Seed Vault.

- [ ] **Step 5: The wallet's coins before**

Ask the user for the wallet's address (Me → "Copy the wallet address"). Call it `<wallet>`.

Run: `curl -s https://app.mooner.family/api/wallet/<wallet>/tokens | python3 -c 'import json,sys; t=json.load(sys.stdin)["tokens"]; print(len(t), [(x["symbol"], x["presale"]) for x in t[:3]])'`
Expected: a count and the newest three. Write the count down.

- [ ] **Step 6: Step 1, the picture**

Tap the Create tab. Take a screenshot (`create-1-empty.png`). Expected:
- "Create" with "Step 1 of 4", and no Back;
- "Picture";
- a dashed square saying "No picture yet";
- Camera and Gallery;
- Next, disabled.

If the wallet has coins with no presale, a "Not opened yet" card is on top with an Open button for each. If the screen instead says "Connect your wallet to create a coin and open its presale", the phone isn't signed in. Ask the user to connect: the approval is theirs.

Tap Gallery. Android's photo picker opens. Ask the user to pick a picture; the agent doesn't browse the gallery. Take a screenshot of the crop screen (`create-1-crop.png`). Expected: the crop box is square and the toolbar is the app's near-black. The user confirms the crop.

Take a screenshot (`create-1-picture.png`). Expected: the picture in the square, and Next enabled.

Tap Camera. If Android asks for the camera, take a screenshot (`create-1-camera-ask.png`) and let the user answer:
- **Don't allow:** the line "Mooner can't use the camera. Allow it in Settings, or choose from the gallery." shows at once. Write down whether Android asks again on the next tap of Camera, or shows the line straight away.
- **Allow:** the camera opens. The user can take a photo or press back. Pressing back leaves the earlier picture in place with no error.

- [ ] **Step 7: Step 2, the details**

Tap Next. Then tap Next again with every field empty, and take a screenshot (`create-2-errors.png`). Expected:
- "Step 2 of 4", a Back chevron, "Name and links";
- under Name: "At least 2 characters";
- under Ticker: "2–10 letters or digits".

Tap the Name field, then run `adb shell input text "Test%sCoin"`. Take a screenshot with the keyboard up (`create-2-keyboard.png`). Expected:
- the tab bar is hidden while the keyboard is up;
- the Name field is above the keyboard.

Tap Ticker, then run `adb shell input text "tst1"`. Expected: it shows `TST1`.

Tap Website, then run `adb shell input text "notaurl"`. Tap Next, then take a screenshot (`create-2-website.png`). Expected: "Enter a web address" under Website, still on Step 2.

Tap Website and clear it: run `adb shell input keyevent KEYCODE_MOVE_END` then `adb shell input keyevent 67` seven times. Then run `adb shell input text "example.com"`.

- [ ] **Step 8: Step 3, the commit**

Tap Next. Take a screenshot (`create-3-commit.png`). Expected:
- "Step 3 of 4", "Your commit", the line "You're first in. …";
- chips 0.1 SOL (picked), 0.25 SOL and 0.4 SOL;
- "It launches when 0.5 SOL is in the pool.";
- the Wallet row with the wallet's SOL;
- Next.

Next shows a spinner until the cost is read. If the wallet holds less than 0.10881734 SOL, a red line says "You need 0.109 SOL to open this (your commit plus about 0.0088 SOL in fees and rent). You have …" and Next stays disabled. Write down which one shows.

Tap 0.25 SOL, then 0.1 SOL. Expected: the rim moves with each tap.

- [ ] **Step 9: Step 4, the last look**

Tap Next. This only works if the wallet has enough SOL; if it doesn't, skip to Step 11. Take a screenshot (`create-4-review.png`). Expected:
- "Step 4 of 4", "Open the presale";
- a card with the picture, "Test Coin", "$TST1" and a website pill;
- "Your commit 0.1 SOL";
- "Fees and rent about 0.0088 SOL";
- "Launches at 0.5 SOL";
- "Time to fill" with `numbers.DURATION / 60` from `/api/info`, then "minutes";
- "Your wallet asks twice: to sign the coin's details, then to open the presale with your SOL.";
- "Open presale · 0.1 SOL".

Run `adb shell input keyevent KEYCODE_BACK`. Expected: Step 3, still in Create. Tap Next to return to Step 4.

- [ ] **Step 10: Up to Seed Vault's prompt, and the user declines**

Tell the user, before anything is approved: "I'm about to tap Open presale. Seed Vault will ask you to sign the coin's details. Please tap Decline. If a second prompt comes up, decline that too. If you approve the first prompt instead, the server pins this test coin's picture and details to IPFS, which is public and permanent, and the coin takes one of your 3 unopened slots. No SOL moves until the second prompt."

The agent never taps anything in Seed Vault: every approve or decline there is the user's.

Tap "Open presale · 0.1 SOL". Once Seed Vault's screen is up, take a screenshot (`create-4-seedvault.png`) and **stop touching the phone**. Note for the user:
- whether Seed Vault shows the message's text (the lines starting "Mooner: create a token") or only raw bytes;
- whether it asked to authorize first.

The user taps Decline. Take a screenshot (`create-4-declined.png`). Expected:
- back on Step 4, with "You cancelled it in your wallet." in red;
- Open presale enabled again.

If other words show, write them down exactly. That means Seed Vault's Decline for a message isn't MWA's code -3 or -1, and `createError` needs that case (bring it to the user before changing code).

Run: the `curl … /tokens` command from Step 5.
Expected: the same count as Step 5. A declined signature reaches no server.

- [ ] **Step 11: Leave the form**

Run `adb shell input keyevent KEYCODE_BACK` until "Step 1 of 4" shows. Then switch to the Live tab and back. Expected: Create is still at Step 1, with the picture kept. The form resets only after an open, after Start over, or when another wallet signs in.

If anything in Steps 6-11 didn't match, collect the phone's log and bring it to the user before changing code:

```bash
adb logcat -d -s ReactNativeJS | tail -50
```

- [ ] **Step 12: Commit**

```bash
git add "mobile/app/(tabs)/create.js" "mobile/app/(tabs)/_layout.js" && git commit -m "mobile: the Create tab: picture, details, commit and a last look, then the wallet signs the coin and the open, and the room opens with the share sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- "mobile/app/(tabs)/create.js" "mobile/app/(tabs)/_layout.js"
```

---

### Task 8 (USER STEP): The first real open from the phone

This spends real mainnet SOL. Only the user does it, on their phone, with the agent watching. The agent reads the screen and the public APIs; it never touches the phone while Seed Vault is up, and never picks a share target.

What the user should know first:
- **The coin is public and permanent.** Its name, ticker, picture, description and links are pinned to IPFS and listed on Live and on the website for everyone. The user picks them.
- **The commit is 0.1 SOL**, the smallest. It stays in the pool; the creator can't take it back.
  - If the pool reaches 0.5 SOL, it launches.
  - If it doesn't fill before the presale's end, the keeper sends the 0.1 SOL back by itself.
- **About 0.0088 SOL goes on fees and rent** (8,817,340 lamports on 2026-10-01). So the wallet needs at least 0.10881734 SOL.
- **The first approval already does something.** Signing the coin's details makes the server pin the picture and details to IPFS (public and permanent) and issue the coin, which takes one of the wallet's 3 unopened slots. No SOL moves until the second prompt, the open.

- [ ] **Step 1 (USER STEP): The open**

On the phone, the user:
1. picks a picture;
2. fills in the name, ticker and any links, keeping 0.1 SOL as the commit;
3. taps "Open presale · 0.1 SOL";
4. approves "sign the coin's details" in Seed Vault;
5. approves the open tx.

Whenever the app is in front between the prompts, take a screenshot of the step line above Open presale. Seed Vault covers the app while it asks, so not every step may be caught. The lines, in order:
1. "Sign the coin details in your wallet";
2. "Saving the picture and details to IPFS";
3. "Sign to open the presale with your SOL";
4. "Opening the presale".

Expected at the end:
- a success buzz;
- the presale's room opens, with Android's share sheet over it titled "Share this presale". Take a screenshot (`open-share.png`).

The share text is three lines (piece 3's words for the creator): `My $<TICKER> presale is open on Mooner.`, `0.1 of 0.5 SOL in so far.`, and `https://app.mooner.family/presale/<key>?ref=<wallet>`. The user shares it or dismisses the sheet.

If instead the red line says "We couldn't tell if it went through. Check your wallet before you try again.", the open's outcome isn't known. Don't press Open presale again yet. Take a screenshot, run Step 2's commands, and wait: if the open landed, the room opens by itself once the server pushes the presale. If Step 2 shows no presale for the coin, bring it to the user before any retry.

- [ ] **Step 2: The server's record**

Run: `curl -s https://app.mooner.family/api/wallet/<wallet>/tokens | python3 -c 'import json,sys; t=json.load(sys.stdin)["tokens"][0]; print(t["mint"], t["symbol"], t["presale"], t["image"])'`
Expected: the new ticker, and a presale key (not `None`). Call the key `<presale>`.

Run: `curl -s https://app.mooner.family/api/presale/<presale> | python3 -c 'import json,sys; v=json.load(sys.stdin); print(v["state"], v["token"]["symbol"], [(s["user"], s["deposit"], s["commit"], s["creator"]) for s in v["seats"]])'`
Expected: `OPEN`, the ticker, and one seat: `(<wallet>, '100000000', '100000000', True)`

- [ ] **Step 3: The open tx on chain**

Run: `curl -s https://api.mainnet-beta.solana.com -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["<presale>",{"limit":5}]}'`
Expected: at least one signature. The oldest is the open.

Run: `curl -s https://api.mainnet-beta.solana.com -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":["<signature>",{"encoding":"json","maxSupportedTransactionVersion":0}]}'`
Expected:
- `result.meta.err` is null;
- `result.transaction.message.accountKeys[0]` (the fee payer) is `<wallet>`.

The tx's size and fee, from the same tx in base64:

```bash
curl -s https://api.mainnet-beta.solana.com -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":["<signature>",{"encoding":"base64","maxSupportedTransactionVersion":0}]}' | python3 -c 'import base64,json,sys; r=json.load(sys.stdin)["result"]; print(r["version"], len(base64.b64decode(r["transaction"][0])), r["meta"]["fee"])'
```

Expected: `0`, a size of at most 1232 bytes, and the fee in lamports. Tell the user the size and the fee.

The open is a v0 tx with no lookup table (`unsignedTx` compiles a v0 message). Measured locally with dummy keys, it was about 908 bytes with 3 signers and 17 keys, which leaves about 324 bytes for the Lighthouse instruction Seed Vault adds (with the priority raised to 100k). That is a local measurement, not a fact about the live tx; this step is the check.

- [ ] **Step 4: The phone shows it everywhere**

Take screenshots. Expected:
- **Live** (`open-live.png`): the new presale's card;
- **Me** (`open-me.png`): the presale under your presales, with "In · 0.1 SOL";
- **Create** (`open-create.png`): back at "Step 1 of 4" with an empty form, and no "Not opened yet" row for this coin.

The website's page: open `https://app.mooner.family/presale/<presale>` in the Browser pane and read the page text. Expected: the ticker and the pool. The server answers 200 for any path, so the status code alone proves nothing.

- [ ] **Step 5: If it failed**

If the phone said "We couldn't tell if it went through…", first check whether the open landed: Step 2's commands, then Step 3's `getSignaturesForAddress` on `<presale>`. The presale's key can also be read from the phone's log (the screen watches `presale:<key>`). If it landed, the room opens by itself once the server pushes it, or a retry of the same coin goes to the room ("This coin's presale was already opened."). Never open a second coin while an outcome is unknown. Closing and opening the app again brings Create back to the same coin, locked: the store saved it for the wallet before Seed Vault asked (`mooner:opening:<wallet>`, stored as `mooner_opening_<wallet>` by `safeName`).

"Start over with a new coin" shows only after a retry's read got the server's own 404 more than 5 minutes after that coin was last saved on the phone (before the prompt, once the wallet signed, or when the unknown was reported). Before anyone taps it, run Step 2's and Step 3's commands: no presale key for the coin and no signatures on `<presale>`. If either shows the open, don't start over; bring it to the user.

Collect the phone's log and the server's view, and bring them to the user before changing code:

```bash
adb logcat -d -s ReactNativeJS | tail -50
```

Run the `/tokens` command from Step 2.
- If the newest coin has `presale` null, it was issued but not opened. It shows under "Not opened yet" in Create and opens from there with one signature, once the cause is known.
- Three unopened coins block new ones (429), so don't retry blindly.

---

### Task 9 (USER STEP, optional): A wallet that can't open, on the phone

The refusal's words are tested in Node (Tasks 2-3). Production lets anyone open (`MOONER_OPENER_WALLETS=*`), so the phone can't see the refusal unless the variable changes. Only the user changes Railway variables. Skip this task unless the user wants it.

- [ ] **Step 1 (USER STEP): Narrow the openers**

On Railway (project mooner, the `app` service), the user sets `MOONER_OPENER_WALLETS` to one wallet that isn't the phone's. Railway redeploys the service.

- [ ] **Step 2: Try on the phone**

The user goes through Create to "Open presale" and approves "sign the coin's details". This signs a message only; no SOL moves.

Take a screenshot (`opener-refused.png`). Expected: "This wallet can't open presales yet. Mooner lets a short list of wallets open them for now; you can still join any presale."

Run the `/tokens` command from Task 7 Step 5. Expected: no new coin. The server refuses before IPFS.

- [ ] **Step 3 (USER STEP): Put it back**

The user sets `MOONER_OPENER_WALLETS` back to `*` on Railway. Then the user taps Open presale again on the phone. Expected: Seed Vault asks to sign the coin's details again. The user declines, and the app shows "You cancelled it in your wallet."

---

### Task 10: Review, every suite, and the spec's status line

- [ ] **Step 1: Whole-piece code review**

Run superpowers:code-reviewer over the commits of Tasks 1-7, against this plan and the spec's "+ Create". Fix the Critical and Important findings, and commit the fixes (stage files by name).

- [ ] **Step 2: Every suite and the bundle check**

Run: `cd mobile && npm test 2>&1 | grep -E '^# (pass|fail)'`
Expected: pass is BEFORE + 52, plus any tests the review added; `# fail 0`

Run: `cd engine && npm test`
Expected: 0 fail. This plan changes nothing in `engine/`.

Run: `cd mobile && sh scripts/check-bundle.sh`
Expected: `web3.js copies: 1; files from engine/node_modules: 0`, then `app/ entries from this checkout:` above 0

- [ ] **Step 3: The spec's piece status**

In `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md`, under the "Pieces" table, add one line for piece 4. It starts `**Piece 4 status:**` and says:
- built, with the date;
- what the device showed in Task 7: the crop screen, the keyboard, and the words on Seed Vault's Decline;
- whether the real open (Task 8) was done, with its presale key and fee, or that it waits for the user;
- what is still open, from the list in the self-review notes below.

```bash
git add docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md && git commit -m "spec: piece 4 status after the device pass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md
```

---

## Self-review notes

**Spec coverage ("+ Create", lines 195-200):**
- 1. Camera or gallery, cropped square → Task 1 (packages, plugin), Task 4 (`picture.js`) and Task 6 (`PictureStep`).
- 2. Name, ticker, optional description and links → Task 2 (`validate`, `mintFields`, `linkHref`) and Task 6 (`DetailsStep`).
- 3. Your commit → Task 2 (`commitChoices`, `commitProblem`, `shortOfOpen`) and Task 6 (`CommitStep`).
- 4. Review: sign the mint request, then the open tx → Task 3 (`mintCoin`, `openCoin`) and Task 6 (`ReviewStep`).
- 5. The new presale opens with the share sheet up → Task 2 (`newPresaleShare`, through piece 3's `shareOf`) and Task 7 (`router.push`, then `Share.share`).
- An open whose outcome isn't known never leads to a second coin on this phone → Task 2 (`openFailure`, `mayHaveSent`, `ALREADY_OPEN` through `alreadyOpen`, `RETRY_UNCHECKED`, `OPEN_PENDING`, `checkBeforeRetry`, `canStartOver`, `keptCommitProblem`, `isOpening`, `presaleKeyOf`, `openLanded`, `backAction`, `restoredOpen`), Task 3 (`openCoin`: the coin saved before the wallet is asked, again once it signs and when an unknown is reported, the copy in memory, the read before any other check with the server's own 404 only, the saved commit, the feed's check before the prompt, one coin at a time; twenty tests) and Task 7 (the restored state, the watch held while a try runs, the locked Back, and Start over only through `canStartOver`). The one gap: secure storage refuses the save and the app ends before the outcome is known; the copy in memory ends with it.
- The phone-only touches (line 213): haptics on the chips, Back and the result; the Android share sheet; the camera → Tasks 5-7.
- A refused opener (`MOONER_OPENER_WALLETS`) → Task 2 (`createError`), Task 3 (tests for both the mint's 403 and the co-signer's), and optionally on the device in Task 9.

**Names used across tasks** (check these match when executing):
- `rules.js`: `blankDraft`, `draftOf`, `normalizeTicker`, `utf8Length`, `cleanName`, `cleanDescription`, `linkHref`, `validate`, `hasErrors`, `mintFields`, `commitBounds`, `commitChoices`, `commitProblem`, `shortOfOpen`, `takenTickers`, `unopenedOf`, `createError(e, pid)`, `squareOf`, `imageProblem`, `NAME_MAX`, `TICKER_MAX`, `DESCRIPTION_MAX`, and for an open whose outcome isn't known `ALREADY_OPEN`, `RETRY_UNCHECKED`, `mayHaveSent(e)`, `openFailure(e, sent)`, `isUnknown(error)`, `presaleKeyOf(info, mint)`, `openLanded(key, { views, presales })`, `backAction({ at, locked, issued, step })`, `restoredOpen(opening)`, `isOpening(o)`, `OPEN_PENDING`, `NO_SUCH_PRESALE`, `checkBeforeRetry(read)` ("open" | "retry" | "unknown"), `START_OVER_MS`, `canStartOver(record, read, now)`, `keptCommitProblem(commit, N)`.
- From `engine/src/opening.js` (`df9abda`): `alreadyOpen(e, pid)`, `pid` in base58.
- `share.js`: `newPresaleShare({ key, symbol, wallet, commit, N, now })`. It calls piece 3's `shareOf({ view, launched, wallet, N, base, now })` (`src/room/share.js`), which builds the link with `shareLink(base, key, wallet)` (`engine/src/refs.js`).
- From `engine/src/tx.js` (piece 2): `OUTCOME_UNKNOWN`, `outcomeUnknown(sig, what)`.
- The store: `openCost()`, `mintCoin(coin, signer)`, `openCoin(coin, commit, signer)` (on a retry its answer also has `read: { verdict, at }`), `forgetOpening(wallet, presale)`, and the state `opening` (`{ mint, presale, symbol, name, description, links, image, commit, at }`, `at` its last save, saved as `mooner:opening:<wallet>`, with a copy in memory). The busy kind is `"create"`, and the steps are "Sign the coin details in your wallet", "Saving the picture and details to IPFS", "Checking whether the presale is open" (a retry of the saved coin only), "Sign to open the presale with your SOL" and "Opening the presale".
- `picture.js`: `fromCamera`, `fromGallery`, `pendingPicture`, `PictureError`, each giving `{ uri, bytes }` or null.
- `ui/Chip.js`: `Chip({ text, label, on, disabled, onPress })`. `ui/icons.js`: `PlusIcon`.

**Built on piece 3, which lands first** (`docs/superpowers/plans/2026-10-01-mooner-seeker-share-links.md`):
- **Sharing.** `src/create/share.js` builds a view from the open and calls piece 3's `shareOf`, which builds the link with `shareLink(base, key, wallet)`. So the creator's share has piece 3's words and `?ref=<wallet>`, and the sheet's title is the same "Share this presale". A view built from the open is used because the feed's snapshot may not have reached the phone when the room opens.
- **`mobile/src/store.js`.** Piece 3 adds an import after the `flows.js` import line, `REFS` after `mineName`, a share-links section above `join`, two lines inside `join`, and `noteRef` after `joinCost, sendChat` in the final `set({ … })`. This plan's edits (the header, a line after the last import, a line after `mineName`, the `opening` state after `mine`, the busy comment, two places in `setWallet`, the block after `joinCost`, and the substring `preview, trade });`) don't touch those lines. Piece 3's `REFS` lines then follow this plan's `openingName` line.
- **`mobile/src/ui/icons.js`.** Piece 3 adds `ShareIcon` before `CheckIcon` and changes the header's list of small icons; this plan adds `PlusIcon` (a tab icon) before `BackIcon`.
- **`mobile/app.json`.** Piece 3 writes it with a JSON script (so it's already in `JSON.stringify(j, null, 2)` form), adds `android.intentFilters` (App Links) and the plugin `./plugins/withReleaseSigning`. Task 1's script only replaces or adds the `expo-image-picker` entry, and Task 1's prebuild checks that piece 3's filter and signing lines are still there.
- **`mobile/scripts/`.** Piece 3's Task 0 changes `check-bundle.sh` and `metro.config.js`, and its Task 8 `run-android.sh`. This plan only runs them, the check right before each install.
- **Release signing.** This plan's installs follow piece 3's recorded USER STEP B choice, (a) (Device, in the ground rules). The agent never makes or changes it.
- **Not shared.** Piece 3 doesn't touch `mobile/app/(tabs)/_layout.js` or `mobile/src/room/JoinSheet.js`.

**Not in this plan:**
- **The website's drawn art.** The website can draw a picture when none is given; the phone requires one (Next is disabled without it).
- **`expo-sharing`.** The spec's stack lists it. This plan uses React Native's built-in `Share`, which opens Android's share sheet for text, so no new module is needed.
- **The trade sheet's chip.** Piece 2's `TradeSheet.js` could later use `ui/Chip.js` (a follow-up); it lives in `src/launched/`, which this plan doesn't touch.

**Facts not verified (for the device pass or the user):**
- What Seed Vault shows for the mint message: the text, or bytes.
- The error code Seed Vault's Decline gives for `signMessages`. -3 is expected; -1 and "rejected" wording are also mapped.
- What the crop screen looks like on the Seeker, and whether EXIF rotation is right after the decode.
- The keyboard with `KeyboardAvoidingView behavior="height"`, Expo 55's edge-to-edge and `tabBarHideOnKeyboard`.
- Whether the share sheet comes up cleanly right after `router.push`.
- The open tx's size with Seed Vault's Lighthouse instruction and 100k priority (Task 8 Step 3). About 908 bytes before Seed Vault's additions was measured locally with dummy keys, not on the live tx.
- Whether an open's rent comes back to the creator when the presale ends, and how much.
- Whether Seed Vault replaces the open tx's blockhash when it signs. Task 3 saves the coin again once the wallet has signed, so the answer doesn't change what the phone does.
- The opener refusal on the device: production is `*` (anyone), so it's covered by Node tests unless Task 9 is run.
- **`POST /api/mint` and its 10 s.** The API client gives every call but cosign 10 s, and the server pins the picture and the details to IPFS inside that call. Whether pinning ever takes longer wasn't measured. If it does, the phone says the server didn't answer, while the server may still issue the coin. That coin then shows under "Not opened yet", but it takes one of the 3 unopened slots.
- **A second open of the same mint.** The program refuses it with its own `AlreadyExists` (28) before System is called (`create_pda`, `util.rs` lines 107-108); the litesvm test `one_presale_per_mint` expects 28, and `engine/test/opening.test.js` builds the server's answers with `describeTxError`. It wasn't produced on mainnet.
- **A presale that closed.** `close` (`util.rs` lines 142-146) gives the account back to System, so the program would open the same mint again. That is why a retry reads the presale first; the server knows a closed one only once it recorded the open (`markOpened`).
- **The store's `watch` and the room's (verified).** Create stops its watch (the form resets) before it pushes the room, which starts its own. The order can't matter: `engine/src/live.js` `subscribe` (lines 91–108 at `ef2e0f2`: its doc comment 91–95, the function 96–108) keeps a Set of listeners per topic and sends `unsub` only when the last one leaves. Since `0c1cad3` it sends `sub` again for a topic it has, so a listener that comes second gets the snapshot too. Since `874b210` the server answers at most 30 such repeat subs of a held topic a minute per socket, and the doc says a listener must not subscribe again from its own snapshot handler. Create and the room make at most one repeat sub per open, and neither makes it from a handler.
- **What marks a presale as there (verified).** `openLanded` takes a `views[key]` or `presales[key]` with a `state`. `mobile/src/store.js` `onPresale` (lines 125-129 at `ccb0f94`) puts a missing presale only in `missing[key]`, never in `views`. A `"closed"` view needs the server's `markOpened`, which runs only after an open landed (`api.js` lines 327 and 414, `keeper.js` line 67, at `ccb0f94`).
- **The share's "in so far".** The new presale's share says the creator's commit is what's in, from the open itself, not from the feed. Someone joining in the same seconds isn't counted.
- The number of phone tests: it depends on the other pieces' progress, so the plan counts from BEFORE and adds 52 (23 + 29).
- **Not run at `6b9bbfe`, `df9abda`, `e81bb45`, `874b210`, `ef2e0f2` or `ccb0f94`.** The second round's changes (the saved open and the read before a retry, `alreadyOpen`, the 202's unknown outcome, the share only after an open that succeeded here, the Device wording) and the third round's (the save before the wallet is asked, the copy in memory, the read before the commit check with the server's own 404 only, the saved commit, the feed's check before the prompt, one coin at a time, Start over, and the `trying` watch) were not applied to a clean copy or run, and neither were the fourth round's (the coin saved again once the wallet signs and when an unknown is reported, with their tests). Both checks were read-only: the third round counted each anchor at `ef2e0f2`, and the fourth counted all 14 again at `ccb0f94` (a script that reads `git show HEAD:<file>`; each found once). Nothing was run. The counts in "Before this plan" are from `c38e1c4`, before them: a record, not a gate.
