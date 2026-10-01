# Mooner on Seeker, piece 3: share links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A presale's link, `https://app.mooner.family/presale/<key>`, opens the Mooner app on the Seeker (and the site everywhere else). The room has a Share button that sends that link through Android's share sheet, with the sharer's wallet as `?ref=`. A join made from such a link carries the ref to the server, which records who shared it for every join it sends: as confirmed when the join confirms, as unconfirmed when it was sent but not confirmed in time.

**Architecture:**
- One small shared module, `engine/src/refs.js`, holds the ref rules: which ref a device keeps, which one goes with a join, and the link itself. The phone store, the web and the server all use it.
- The ref travels beside the signed tx in `POST /api/cosign`, never inside it, so the gate signs exactly what it signs today.
- The server writes the ref to its own `referrals` table for each join it sends: `confirmed = 1` on a 200, `confirmed = 0` on a 202 from this send. A repeat of a tx that already went out writes nothing; its first send did. A confirmed row is never replaced; an unconfirmed one gives way to a later join of the same seat.
- App Links need `/.well-known/assetlinks.json` with the release key's SHA-256:
  - the server serves that file from a Railway variable;
  - a config plugin lets release builds sign with the user's own key, and only when the Gradle property `MOONER_RELEASE_SIGN=1` is set. Whether the agent's own builds get it is the user's choice, in USER STEP B;
  - until the user makes that key, everything else works through the `mooner://` scheme and a manual link approval on the test phone.
- Task 0 first: every checkout bundles with its own Metro cache, and the bundle check fails when the bundle doesn't hold this checkout's screens. Every install runs that check first.

**Tech Stack:**
- Phone: Expo SDK 55 (expo 55.0.31, @expo/config-plugins 55.0.11), expo-router 55.0.18, React Native 0.83.10 `Share`, zustand 5, expo-secure-store.
- Engine: Node 22 `node --test` and `node:sqlite`.
- Web: React + Vite.
- Android tools: `pm`, `apksigner` (build-tools 36.0.0) and `keytool` (JDK 17).

**Spec:** `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md`:
- the piece 3 row of "Pieces";
- "Server additions": **Referral** and **App Links**;
- "Security": the gate, and Referrals;
- "Testing".

---

## What piece 3 does with `ref`, and what it leaves to piece 6

- **Kept:**
  - The phone keeps the ref in expo-secure-store under `mooner:refs`; the web keeps it in localStorage under `mooner:refs`.
  - A device keeps the newest ref per presale, from links opened with `?ref=<wallet>`, for at most 10 presales.
  - Anything that isn't a base58 wallet (32–44 characters) is ignored.
- **Sent:**
  - The ref goes with the next join of that presale from that device, beside the tx: `POST /api/cosign { tx, ref }`.
  - It is never the joiner's own wallet.
  - It is dropped once the join lands, and kept if the join fails.
- **Recorded:**
  - The server writes `referrals(presale, user, referrer, sig, at, confirmed)` when the tx was a join and the server sent it: `confirmed = 1` on a 200 reply, `confirmed = 0` on a 202 from this send (sent, not confirmed in time). A repeat of a tx that already went out gets an early 202 (since `6b9bbfe`: the simulation says `AlreadyProcessed`, or `BlockhashNotFound` with the tx's status found) and writes nothing: its first send did. The 202 case matters: a slow RPC turns a join that lands into a 202, and its referrer would otherwise be lost.
  - There is one row per seat `(presale, user)`. The write is `INSERT … ON CONFLICT(presale, user) DO UPDATE … WHERE referrals.confirmed = 0`:
    - a confirmed row is never replaced;
    - an unconfirmed row gives way to the seat's next join that carries a ref, so a 202 that never landed can't block the referrer of a later join that did.
  - A bad ref never fails the join it came with, and neither does a failed write: it is logged, and the reply is the join's.
- **Not in piece 3:**
  - points, the Raider title, and the rule "only presales that launch";
  - any API that reads referrals.
  - Piece 6 builds all of that from the `referrals` table. It counts a row only if its seat exists at launch: it needs that check anyway, because a seat can take its SOL back before launch, and the same check settles an unconfirmed row whose join never landed.
  - Nothing in piece 3 shows a ref or a count to anyone.

## Ground rules for every task

- **Branch and order:**
  - Branch `feat/mooner-wireframe`.
  - Order: piece 2 (trade + coin info) is committed first, then this plan, then piece 4 (Create, `docs/superpowers/plans/2026-10-01-mooner-seeker-create.md`), which builds on this one.
  - Every edit below is anchored on text at HEAD `6b9bbfe` (2026-10-01). Piece 2's deadline fix (5b: `apiclient.js`, `flows.js`, `tx.js`, `swap.js`, `keeper.js`) and its coin-stats fix (`feed.js`, `coinstats.js`, `store.js`, `market.js`) were both committed by `a552f42`. Since then:
    - `8edc177` changed `mobile/src/store.js` and `mobile/test/store.test.mjs` (a launch seen live, a trade's minimum);
    - `238150c` changed `engine/src/flows.js` (a cosign that fails other than with the server's own 4xx is outcome unknown), `engine/server/api.js` (the cosign simulation answers 503 after 15 s), their tests, and `web/src/lib/store.ts` (web trades);
    - `0ebf9be` split the cosign route: its checks before the send are `cosignChecked`, whose every answer says `sent: false`, and `cosignRoute(req)` sends. Task 3's referral block reads `req.body.ref` because of it;
    - `c38e1c4` changed the server's coin stats, which this plan doesn't touch;
    - `6b9bbfe` changed `engine/src/flows.js`: `openPresale` and `joinPresale` take `waitMs`, and a 202 whose presale or seat doesn't show in time is outcome unknown (`waitSent`). It changed `engine/server/api.js` too: the same signed tx again, after it went out, gets an early 202 with no `sent` marker, and a status the server can't read gets a 503 without one. It also changed their tests. Task 2 Step 4's anchors are small so they keep all of it, and Task 3's referral block sits after the send, which the early 202 never reaches.
    - `df9abda` changed `web/src/lib/store.ts` (an open whose outcome is unknown) and added `engine/src/opening.js`. `0c1cad3` and `e81bb45` changed `engine/src/live.js`, `engine/server/hub.js` and the live tests. At `e81bb45`, Task 9 Step 7's two anchors in `web/src/lib/store.ts` (the `live.js` import and the `joinPresale` call before `readPresale`) were counted against the file: each matches once. The open-unknown fix still in progress edits store.ts, so that count may move; Task 9 Step 7 says what to do. At `e81bb45`, the round 3 reviewer counted every anchor of this plan read-only (52 strings across 19 files), and each matched once. No other anchor of this plan is in a file those three commits changed.
    - At `c38e1c4` every anchor of this plan matched once when applied by script (Self-check, below). That scripted run was not repeated at `6b9bbfe`; there, Task 2 Step 4's `joinPresale` anchors and `signAndCosign` were read against the file by hand. Piece 2 may still commit more fixes in those files before this plan runs.
  - Read each file right before editing it. Each anchor must match exactly once. If one doesn't, stop and adapt to the new code: find the same spot, keep the other change, and say what you changed in the task's report. Don't force a block that doesn't fit, and don't guess.
- **Dirty files:** before a task edits a file, run `git diff --quiet HEAD -- <the task's files>`. If it fails, another session has uncommitted changes in one of them: stop and report which. Never stash, never revert someone else's change, and never commit it. (`git commit -- <file>` commits the whole file, theirs included.)
- **Commits:**
  - One commit per task, staging files by name only: `git add <files> && git commit -m "<message>" -- <files>`.
  - The message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never `git add -A` or `git add .`.
  - Never stage `.claude/`, `launch-test/`, `launch.py`, `site/`, or files another piece has changed but not committed.
- **Files the agent never touches:**
  - Never touch `engine/.mainnet`, keypair files or `.env` files. `web/.env` is read by the web build; never open or print it.
  - Never read `~/.gradle/gradle.properties` once the user has written it (it holds the key passwords), and never read the keystore.
- **USER STEPs:** production deploys (`sh deploy/railway.sh app|site`), Railway variables, mainnet spends and signing keys belong to the user. Each one is marked **USER STEP** below. The agent never runs them.
- **Copy:**
  - Plain words, no game words ("players", "lobby", "match", "game", "level", "quest").
  - Allowed phrases: "Who's in", "Auto-join". Titles: Dev, KOL, Raider, Diamond Hands.
- **Data:**
  - Real pages show only real data.
  - Live data comes over the socket. Nothing in this plan polls.
- **Golden digests:** the golden digests in `engine/src/selftest.js` must not change. The join tx is unchanged; `ref` travels beside it.
- **Tests:**
  - engine: `cd engine && npm test`. Take the pass count it prints before Task 1 as the baseline. Each engine task adds to it, and nothing that passed may fail.
  - phone: `cd mobile && npm test`. Take the count it prints before Task 1 as the baseline (piece 2 changes it). Don't use a number from this plan.
  - bundle: `cd mobile && sh scripts/check-bundle.sh` must end with `web3.js copies: 1; files from engine/node_modules: 0` and an `app/ entries from this checkout:` count above 0 (Task 0 adds that line).
  - web: `cd web && node --test tests/refs.test.mjs` (from Task 9) and `cd web && npm run build`, which must exit 0. These are the web's gates.
  - web type-check, optional: `web/tsconfig.check.json` belongs to another session's work ("Fix the web type-check setup") and points into other sessions' scratchpads, so it is not a gate here. If you run `cd web && npx tsc -p tsconfig.check.json --noEmit`, it passes when it shows the same errors as at HEAD before Task 9.
- **Bundling, Metro's cache, worktrees and parallel sessions:**
  - Bundle (`check-bundle.sh`, `expo export`, `run-android.sh`) only in this repo's own `mobile/`. Never in a copy of `mobile/` that symlinks the repo's `node_modules`, a git worktree, or another session's checkout.
  - Why: by default Metro keeps one transform cache for every checkout on the Mac (`$TMPDIR/metro-cache`), and expo-router's `_ctx` file is the same real file in every copy that shares `node_modules`. Another checkout's export leaves a cached `_ctx` pointing at that checkout's `app/`. This repo's next bundle then has another checkout's screens, or none: on 2026-10-01 the check printed `copies: 0`, and a release build would have installed an empty app.
  - Task 0 adds two guards: a cache per checkout (`mobile/.metro-cache`), and a bundle check that fails unless the bundle holds this checkout's own `app/presale/[key].js`. Before Task 0 lands, if the check fails that way, run `grep -rl '<other checkout path>' "$TMPDIR/metro-cache" | xargs rm -f`, or add `--clear` to the export once.
  - Every install runs `sh scripts/check-bundle.sh` right before `sh scripts/run-android.sh`, in the same `mobile/`. If the check fails, don't install.
- **Device:**
  - `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh` checks the bundle, then builds the release APK and installs it on the Seeker over USB.
  - Screenshots: `adb exec-out screencap -p > <scratchpad>/<name>.png` (1200×2670).
  - The agent never taps Seed Vault, and never picks a target in the share sheet.
  - If an install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (the APK's key differs from the installed app's), stop and bring it to the user. The agent never runs `adb uninstall`: removing the app deletes its data, and that is USER STEP C.
  - From USER STEP B on, the agent's installs follow the choice recorded in Task 10's checklist.
- **Native project:**
  - `mobile/android/` is generated and gitignored (`mobile/.gitignore` line 4).
  - After any `app.json` change, run `cd mobile && npx expo prebuild --platform android --clean`. `expo run:android` prebuilds only when `android/` is missing.
  - A clean prebuild on 2026-10-01 changed only `app/build.gradle` and `AndroidManifest.xml` compared with the current `android/`. It regenerates the same `debug.keystore`, so installs over the current app still work.
- Never write durations or time estimates.

## Facts this plan rests on (checked 2026-10-01)

**Android, App Links:**

1. **The intent filter.** An App Link filter needs `android:autoVerify="true"`, action VIEW, categories DEFAULT and BROWSABLE, and https data.
2. **The site file** (developer.android.com/training/app-links/configure-assetlinks):
   - `/.well-known/assetlinks.json` must be served over HTTPS, with content type `application/json` and no redirects;
   - a statement may list several `sha256_cert_fingerprints`.
3. **Unverified links and testing** (developer.android.com/training/app-links/test-applinks):
   - On Android 12 and later, an unverified https link opens in the browser.
   - The user's own choice, which `pm set-app-links-user-selection` sets, overrides verification.
   - Testing uses `pm get-app-links`, `pm verify-app-links --re-verify`, and Google's statement list `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.mooner.family&relation=delegate_permission/common.handle_all_urls`.
4. **The Seeker** runs Android 16 (SDK 36), user 0. Its `pm` lists `get-app-links`, `verify-app-links`, `set-app-links-user-selection` and `reset-app-links` (`adb shell pm help`).
5. **Today's APK is signed with Expo's template debug key:**
   - Its SHA-256 is `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`, the template's `android/app/debug.keystore`, used by `mobile/scripts/run-android.sh`.
   - `apksigner verify --print-certs` on `mobile/android/app/build/outputs/apk/release/app-release.apk` prints the digest `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
   - The same fingerprint appears in other projects' public issues (for example github.com/stablyai/orca/issues/21808), because the key ships inside Expo's template.
   - If `assetlinks.json` listed it, any app signed with that public key could claim app.mooner.family links. So the file never lists it. Before the release key exists, the device test uses the manual approval from fact 3.
6. **Release signing** (reactnative.dev/docs/signed-apk-android):
   - The command is `keytool -genkeypair -v -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000`.
   - The key's properties go in `~/.gradle/gradle.properties`. That file does not exist on this Mac today.
   - A PKCS12 store uses one password for both the store and the key.
   - The Solana dApp Store wants a key separate from any Google Play key, and the same key for every update.
7. **A new signing key and the installed app:**
   - Android refuses an update signed with a different key.
   - `expo run:android` installs with `adb install -r -d --user` (`mobile/node_modules/expo/node_modules/@expo/cli/build/src/start/platforms/android/adb.js:209`, called from `run/android/runAndroidAsync.js:120`) and never uninstalls. Only the Expo Go installer calls uninstall.
   - So the first build with the new key needs `adb uninstall family.mooner.app`, which is the user's (USER STEP C). That deletes the app's data: the secure-store session keys, the MWA auth token, the Mooner sign-in, the "mine" records and the refs.
   - The one way to change the key and keep the data is APK Signature Scheme v3 key rotation (`apksigner rotate` makes a lineage, `apksigner sign --lineage` signs with it). USER STEP C says why this plan doesn't use it.
8. **Gradle `signingReport`** on a scratch prebuild with an earlier version of the Task 8 plugin, whose switch was "`MOONER_UPLOAD_STORE_FILE` is set":
   - With no `MOONER_UPLOAD_*` properties, `Variant: release` shows `Config: debug` and `SHA-256: FA:C6:…:3B:9C`. AGP accepts the unused, empty release signingConfig.
   - With `-PMOONER_UPLOAD_STORE_FILE=/nonexistent/mooner-test.keystore -PMOONER_UPLOAD_STORE_PASSWORD=x -PMOONER_UPLOAD_KEY_ALIAS=test -PMOONER_UPLOAD_KEY_PASSWORD=x`, it shows `Config: release`, `Store: /nonexistent/mooner-test.keystore` and `Error: Missing keystore`.
   - So the switch can be checked without any real key. The plugin's switch is now `MOONER_RELEASE_SIGN=1` (USER STEP B). Its results were not observed while writing this plan; Task 8 Step 8 checks each case.
8a. **Passing the flag to `run-android.sh`.**
   - `expo run:android` takes only its own options (`--no-build-cache`, `--no-install`, `--no-bundler`, `--variant`, `--binary`, `--app-id`, `--all-arch`, `--port`, `-d`), and its source has a TODO for passing Gradle arguments. So `-PMOONER_RELEASE_SIGN=1` can't go through `run-android.sh`.
   - It spawns Gradle with the shell's environment, and Gradle reads an environment variable `ORG_GRADLE_PROJECT_<name>` as the project property `<name>` (docs.gradle.org, "Project properties"). So a build through `run-android.sh` gets the flag as `ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh`. A direct `./gradlew` call takes `-PMOONER_RELEASE_SIGN=1`. Task 8 Step 8 checks both forms with `signingReport`.

**Expo and React Native:**

9. **Intent filters reach the manifest.** `app.json` `android.intentFilters` becomes manifest XML through `@expo/config-plugins/build/android/IntentFilters.js`: `android:autoVerify` at line 46, the `data-generated` tag at line 22. A scratch prebuild produced exactly the filter shown in Task 7.
10. **The config plugin loads.**
    - A plugin entry `"./plugins/withReleaseSigning"` resolves relative to the project.
    - `withAppBuildGradle` hands over `modResults { path, contents, language }`, with `language` `"groovy"` for `build.gradle` (`@expo/config-plugins/build/android/Paths.js` `getLanguage`).
    - `scripts/check-bundle.sh` loaded `app.json` with the plugin and passed on a scratch copy holding every phone change in this plan. That run was in a copy, which the bundling rule above now forbids; Task 8 Step 7's prebuild in the repo shows the plugin loading again.
11. **Share on Android** passes only `title` and `message` to the native module, plus `dialogTitle` (`react-native/Libraries/Share/Share.js:102-118`). The `url` field is iOS-only, so the link goes inside `message`.
12. **https links route like scheme links.**
    - Expo SDK 55 installs a spec-compliant global `URL` (`expo/src/winter/runtime.native.ts:18`).
    - expo-router turns an https link into its path with `href.replace(origin, '')` (`expo-router/build/fork/extractPathFromURL.js:33`).
    - So `https://app.mooner.family/presale/K?ref=W` routes like `mooner:///presale/K?ref=W`. Task 7 confirms it on the phone.
13. **Storage key names.** Secure-store names pass through `safeName`, which turns anything outside `[A-Za-z0-9._-]` into `_` (`mobile/src/securekeys.js:8`). So `mooner:refs` is stored as `mooner_refs`.

**Server:**

14. **Routing.**
    - The server's router matches path and method before it looks at web files, and a HEAD to a GET route gets 405. So checks use GET: `curl -sS -D - -o /dev/null <url>`.
    - Today `/.well-known/assetlinks.json` returns 404 with `content-type: application/json; charset=utf-8`.
15. **Deploy.**
    - `sh deploy/railway.sh app` builds the web, then stages `engine/src`, `engine/server` and `web/dist` from the working tree, not from a git ref.
    - The container is `node:22-slim`, and the DB is `/data/server.db` (`deploy/app.Dockerfile`).
16. **Railway variables:** `railway variable set KEY --stdin --skip-deploys -p <project> -e <env> -s <service>` (`railway variable set --help`).
17. **Mainnet today:** `/api/presales` and `/api/launched` are both empty on 2026-10-01.

## File map

**Shared (`engine/src`, tested under Node):**
- Create `engine/src/refs.js`: the ref rules and the link (`cleanRef`, `withRef`, `refFor`, `withoutRef`, `shareLink`, `MAX_REFS`).
- Modify `engine/src/flows.js`: `joinPresale({ …, ref })`, and `signAndCosign` passes `ref` beside the tx.
- Modify `engine/src/apiclient.js`: `cosign(tx, { ref })`.

**Server (`engine/server`):**
- Create `engine/server/referrals.js`: the `referrals` table (`Referrals.add`, `Referrals.referralOf`).
- Create `engine/server/applinks.js`: the `GET /.well-known/assetlinks.json` route.
- Modify `engine/server/api.js`: `refOf`, and the cosign route records a sent join's referrer, confirmed (200) or not (202).
- Modify `engine/server/http.js`: a route may set its content type.
- Modify `engine/server/config.js`: `MOONER_ANDROID_CERTS` becomes `androidCerts` and `androidCertsBad`.
- Modify `engine/server/main.js`: mounts the App Links route and logs what it serves.

**Engine tests:**
- Create `engine/test/refs.test.js`, `engine/test/referrals.test.js` and `engine/test/applinks.test.js`.
- Append to `engine/test/apiclient.test.js`, `engine/test/flows.test.js` and `engine/test/server.test.js`.

**Phone (`mobile/`):**
- Modify `mobile/scripts/check-bundle.sh` and `mobile/metro.config.js`, and `mobile/.gitignore` (Task 0): this checkout's own Metro cache, and the check for this checkout's screens.
- Modify `mobile/src/store.js`: `noteRef`; `join` sends and drops the ref.
- Create `mobile/src/room/share.js`: the share text.
- Modify `mobile/src/ui/icons.js` (`ShareIcon`) and `mobile/src/ui/TopBar.js` (`side`).
- Modify `mobile/app/presale/[key].js`: reads `?ref=`, and has the Share button.
- Modify `mobile/app.json`: the App Link intent filter and the signing plugin.
- Create `mobile/plugins/withReleaseSigning.js`.
- Modify `mobile/scripts/run-android.sh`: its comment only (how the flag reaches Gradle).
- Tests: append to `mobile/test/store.test.mjs`; create `mobile/test/share.test.mjs` and `mobile/test/releasesigning.test.mjs`.

**Web (`web/`):**
- Create `web/src/real/refs.js`: localStorage refs over `engine/src/refs.js`.
- Create `web/tests/refs.test.mjs`.
- Modify `web/src/main.tsx`: the presale route keeps `?ref=`.
- Modify `web/src/lib/store.ts`: the join sends the ref and drops it.
- Modify `web/src/components/presale/PresaleHeader.tsx`: the copied link carries the ref.

**Docs:**
- Modify the spec in Task 11: a note under Referral and App Links saying what piece 3 does.

---

### Task 0: Each checkout bundles with its own Metro cache, and the check sees this checkout's screens

**Files:**
- Modify: `mobile/scripts/check-bundle.sh`
- Modify: `mobile/metro.config.js`
- Modify: `mobile/.gitignore`

This comes first because every later install depends on it: see "Bundling, Metro's cache, worktrees and parallel sessions" in the ground rules.

- [ ] **Step 1: Check the files are clean.** Run `git diff --quiet HEAD -- mobile/scripts/check-bundle.sh mobile/metro.config.js mobile/.gitignore && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 2: See the new check catch another checkout's screens.** This runs the check's two greps on a made-up bundle line that names another checkout. Nothing is bundled.

```bash
cd mobile && ROOT=$(pwd -P) && F=$(mktemp) && printf '%s\n' '"/elsewhere/mobile/app/presale/[key].js"' > "$F" && echo "mine: $(grep -oF "\"$ROOT/app/" "$F" | wc -l | tr -d ' ')" && { grep -qF "\"$ROOT/app/presale/[key].js\"" "$F" && echo found || echo missing; }; rm -f "$F"
```

Expected: `mine: 0`, then `missing`.

- [ ] **Step 3: The check requires this checkout's screens.** In `mobile/scripts/check-bundle.sh`, replace:

```sh
echo "web3.js copies: $copies; files from engine/node_modules: $stray"
[ "$copies" = 1 ] && [ "$stray" = 0 ]
```

with:

```sh
echo "web3.js copies: $copies; files from engine/node_modules: $stray"
# The screens must be this checkout's own: a Metro cache shared with another checkout can
# hand back expo-router's list of that checkout's app/ files (see metro.config.js).
ROOT=$(pwd -P)
mine=$(grep -oF "\"$ROOT/app/" "$B" | wc -l | tr -d ' ')
echo "app/ entries from this checkout: $mine"
grep -qF "\"$ROOT/app/presale/[key].js\"" "$B" || { echo "no app/presale/[key].js from $ROOT in the bundle: another checkout's cached screens (see metro.config.js)"; exit 1; }
[ "$copies" = 1 ] && [ "$stray" = 0 ] && [ "$mine" != 0 ]
```

`pwd -P` is the path with symlinks resolved, which is how Metro names files. The script has already done `cd "$(dirname "$0")/.."`, so it is `mobile/`.

- [ ] **Step 4: A cache for this checkout only.** In `mobile/metro.config.js`, replace:

```js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
```

with:

```js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Expo's default store (a FileStore in $TMPDIR/metro-cache) is shared by every checkout
// of this repo; the same class rooted here keeps each checkout's cache its own
config.cacheStores = [new (config.cacheStores[0].constructor)({ root: path.join(__dirname, ".metro-cache") })];
```

- Why the default is a problem: a file every checkout shares through `node_modules` (expo-router's `_ctx`, its list of `app/` files) can come back from that cache with another checkout's screens. `scripts/check-bundle.sh` checks that the bundle has this checkout's.
- Why it works:
  - `getDefaultConfig` sets `cacheStores` to exactly one store: Expo's `FileStore`, rooted in `$TMPDIR/metro-cache` (`mobile/node_modules/expo/node_modules/@expo/metro-config/build/ExpoMetroConfig.js` lines 210 and 250, `@expo/metro-config` 55.0.27).
  - That class extends Metro's `FileStore` and only skips caching CSS marked `skipCache` (`build/file-store.js`). Its constructor is Metro's, which reads `options.root` (`mobile/node_modules/metro-cache/src/stores/FileStore.js`, line 17).
  - Taking the class from the config needs no new import. `@expo/metro` isn't in `mobile/package.json`; it resolves only through npm hoisting.
  - Expo's CLI doesn't set `cacheStores` itself, so this setting is the one used.

In `mobile/.gitignore`, replace:

```
.expo/
```

with:

```
.expo/
.metro-cache/
```

- [ ] **Step 5: The config loads.** Run `cd mobile && node -e 'const c = require("./metro.config.js"); console.log(c.cacheStores.length, c.cacheStores[0].constructor.name)'`. Expected: `1 FileStore`. This only loads the config; nothing is bundled.

- [ ] **Step 6: Bundle in the repo, and see the cache land here.** In this repo's own `mobile/` (never a copy or a worktree), run `cd mobile && sh scripts/check-bundle.sh && ls .metro-cache | head -3 && git status --short .metro-cache`. Expected:
  - `web3.js copies: 1; files from engine/node_modules: 0`;
  - `app/ entries from this checkout: <n>` with `<n>` above 0 (21 in the `dist/` from 2026-10-01);
  - two-letter hex folder names from `.metro-cache`;
  - nothing from `git status` (the folder is ignored).

- [ ] **Step 7: Commit.**

```bash
git add mobile/scripts/check-bundle.sh mobile/metro.config.js mobile/.gitignore && git commit -m "mobile: each checkout bundles with its own Metro cache, and the bundle check fails without this checkout's screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/scripts/check-bundle.sh mobile/metro.config.js mobile/.gitignore
```

---

### Task 1: Shared ref rules and the link (`engine/src/refs.js`)

**Files:**
- Create: `engine/src/refs.js`
- Create: `engine/test/refs.test.js`

- [ ] **Step 1: Take the baselines.** Run `cd engine && npm test 2>&1 | grep -E '^# (pass|fail)'` and `cd mobile && npm test 2>&1 | grep -E '^# (pass|fail)'`, and write both counts down for the final pass.

- [ ] **Step 2: Write the failing test.** Create `engine/test/refs.test.js`:

```js
// The share-link helpers both apps use: which ref a device keeps and sends, and the link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_REFS, cleanRef, refFor, shareLink, withRef, withoutRef } from "../src/refs.js";

const P = "P".repeat(44);
const Q = "Q".repeat(44);
const A = "A".repeat(44);
const B = "B".repeat(44);

test("cleanRef: a base58 wallet, trimmed; anything else is null", () => {
  assert.equal(cleanRef(` ${A}\n`), A);
  assert.equal(cleanRef("11111111111111111111111111111111"), "11111111111111111111111111111111");
  for (const v of [undefined, null, 7, "", "short", "0".repeat(44), "O".repeat(44), "l".repeat(44), "A".repeat(45), [A], { A }]) {
    assert.equal(cleanRef(v), null, String(v));
  }
});

test("withRef: noted per presale, the newest link wins, junk changes nothing", () => {
  const one = withRef({}, P, A, 1);
  assert.deepEqual(one, { [P]: { ref: A, at: 1 } });
  assert.deepEqual(withRef(one, P, B, 2), { [P]: { ref: B, at: 2 } }, "a newer link from someone else");
  assert.equal(withRef(one, P, A, 3), one, "the same ref again: nothing to save");
  assert.equal(withRef(one, P, "nope", 3), one);
  assert.equal(withRef(one, "nope", A, 3), one);
  assert.deepEqual(withRef(undefined, P, A, 1), { [P]: { ref: A, at: 1 } }, "nothing saved yet");
  assert.deepEqual(withRef("junk", P, A, 1), { [P]: { ref: A, at: 1 } }, "a broken save");
});

test("withRef: keeps the newest MAX_REFS presales", () => {
  let refs = {};
  const keys = [..."abcdefghijkm"].map((c) => c.repeat(44)); // base58 letters only
  assert.equal(keys.length, MAX_REFS + 2);
  keys.forEach((k, i) => (refs = withRef(refs, k, A, i)));
  assert.equal(Object.keys(refs).length, MAX_REFS);
  assert.ok(!(keys[0] in refs) && !(keys[1] in refs), "the two oldest went");
  assert.ok(keys.at(-1) in refs);
});

test("refFor: the kept ref, never the joiner's own wallet", () => {
  const refs = { [P]: { ref: A, at: 1 } };
  assert.equal(refFor(refs, P, B), A);
  assert.equal(refFor(refs, P, A), null, "no one refers themselves");
  assert.equal(refFor(refs, Q, B), null, "another presale");
  assert.equal(refFor({ [P]: { ref: "bad", at: 1 } }, P, B), null);
  assert.equal(refFor(undefined, P, B), null);
});

test("withoutRef: drops one presale's ref", () => {
  const refs = { [P]: { ref: A, at: 1 }, [Q]: { ref: B, at: 2 } };
  assert.deepEqual(withoutRef(refs, P), { [Q]: { ref: B, at: 2 } });
  assert.equal(withoutRef(refs, "other"), refs);
  assert.equal(withoutRef(undefined, P), undefined);
});

test("shareLink: the presale's link, with ?ref= only for a real wallet", () => {
  assert.equal(shareLink("https://app.mooner.family", P, A), `https://app.mooner.family/presale/${P}?ref=${A}`);
  assert.equal(shareLink("https://app.mooner.family", P, null), `https://app.mooner.family/presale/${P}`);
  assert.equal(shareLink("", P, "guest"), `/presale/${P}`, "the web's signed-out user");
});
```

- [ ] **Step 3: Run it and confirm it fails.** Run `cd engine && node --test test/refs.test.js`. Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/refs.js`.

- [ ] **Step 4: Write the module.** Create `engine/src/refs.js`:

```js
// Share links and who shared them (spec "Referral"). A presale link may carry
// `?ref=<wallet>`, the wallet that shared it. The app keeps the newest one per presale until
// a join there lands, and sends it with that join's co-sign; the server records it with the
// join it sends (server/referrals.js). No imports: the phone, the web and Node tests all use it.

/** How many presales' refs a device keeps; the oldest go first. */
export const MAX_REFS = 10;

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** `v` as a wallet (base58, trimmed), or null for anything else. */
export function cleanRef(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return WALLET.test(s) ? s : null;
}

/** `refs` ({ presale: { ref, at } }) with `ref` noted for `presale` at `at` (ms). The newest
 *  link wins and only the newest `max` presales stay. Anything that changes nothing (junk,
 *  the same ref again) gives back `refs` itself, so callers can skip the save. */
export function withRef(refs, presale, ref, at, max = MAX_REFS) {
  const r = cleanRef(ref);
  const base = isMap(refs) ? refs : {};
  if (!r || !cleanRef(presale) || base[presale]?.ref === r) return refs;
  const next = Object.entries({ ...base, [presale]: { ref: r, at } })
    .sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
    .slice(0, max);
  return Object.fromEntries(next);
}

/** The wallet that shared `presale` with this device, or null. Never `wallet` itself: no one
 *  refers themselves. */
export function refFor(refs, presale, wallet) {
  const r = isMap(refs) ? cleanRef(refs[presale]?.ref) : null;
  return r && r !== wallet ? r : null;
}

/** `refs` without `presale` (a join there landed); `refs` itself if it had none. */
export function withoutRef(refs, presale) {
  if (!isMap(refs) || !Object.hasOwn(refs, presale)) return refs;
  const { [presale]: _, ...rest } = refs;
  return rest;
}

/** The link that opens presale `key`: `<base>/presale/<key>`, with `?ref=<wallet>` when a
 *  wallet is connected. `base`: an origin ("https://app.mooner.family") or "" for a path. */
export function shareLink(base, key, wallet) {
  const r = cleanRef(wallet);
  return `${base}/presale/${key}${r ? `?ref=${r}` : ""}`;
}
```

- [ ] **Step 5: Run it and confirm it passes.** Run `cd engine && node --test test/refs.test.js`. Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 6: Run the engine suite.** Run `cd engine && npm test`. Expected: the baseline plus 6, and no new failures.

- [ ] **Step 7: Commit.**

```bash
git add engine/src/refs.js engine/test/refs.test.js && git commit -m "engine: share-link refs (refs.js): which ref a device keeps and sends with a join, and the link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/src/refs.js engine/test/refs.test.js
```

---

### Task 2: The join carries `ref` beside the tx (`flows.js`, `apiclient.js`)

The tx the wallet signs and the gate co-signs stays byte for byte the same, so the golden digests don't move. Only the request body gains `ref`.

**Files:**
- Modify: `engine/src/apiclient.js` (the `cosign` entry)
- Modify: `engine/src/flows.js` (`signAndCosign`, `joinPresale`)
- Test: append to `engine/test/apiclient.test.js` and `engine/test/flows.test.js`

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- engine/src/apiclient.js engine/src/flows.js engine/test/apiclient.test.js engine/test/flows.test.js && echo clean`. Expected: `clean`. Piece 2's fixes edit all four and are committed by `6b9bbfe`; if any of them has uncommitted changes again, stop and report, and wait for them to be committed.

- [ ] **Step 1: Write the failing tests.**
  - Append to `engine/test/apiclient.test.js`, which already has `fakeFetch` and `makeApi`:

```js

test("cosign sends the join's ref beside the tx", async () => {
  const f = fakeFetch([[200, { sig: "x", confirmed: true }], [200, { sig: "y", confirmed: true }]]);
  const api = makeApi("", f);
  await api.cosign("AAAA", { ref: "Ref1111" });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { tx: "AAAA", ref: "Ref1111" });
  await api.cosign("BBBB", { ref: null });
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { tx: "BBBB" });
});
```

  - Append to `engine/test/flows.test.js`, which already has `fakeInfo`, `fakeApi`, `flows`, `memoryKeys`, `fakeWallet`, `joinable` and `Keypair`:

```js

test("joinPresale: a share link's ref goes to the server beside the join, and none without one", async () => {
  const info = fakeInfo();
  const api = fakeApi(info);
  const cosign = api.cosign;
  const sent = [];
  api.cosign = (b64, opts) => (sent.push(opts), cosign(b64));
  const f = flows({ api, keys: memoryKeys() });
  const sharer = Keypair.generate().publicKey.toBase58();
  for (const ref of [sharer, undefined]) {
    const w = fakeWallet();
    const { view } = joinable(info);
    await f.joinPresale({ info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: 200_000_000n, ...(ref && { ref }) });
  }
  assert.deepEqual(sent, [{ ref: sharer }, { ref: null }]);
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `cd engine && node --test test/apiclient.test.js test/flows.test.js`. Expected: the two new tests FAIL. The apiclient body has no `ref`, and `sent` is `[undefined, undefined]`.

Piece 2's fixes touched the same spots:
- `cosign` has a deadline (`…, { tx }, cosignMs),`, at `a552f42`);
- a cosign that fails other than with the server's own 4xx, or an answer that says `sent: false`, becomes "outcome unknown" (`api.cosign(…).catch(…)`, at `0ebf9be`);
- since `6b9bbfe`, `joinPresale` takes `waitMs` (its doc comment says so), and a 202 waits through `waitSent(r, "join", …)`, not `waitFor`.

Steps 3 and 4 anchor only on text none of these changed: a line's start, a line's end, or a whole line that is the same at `c38e1c4` and at `6b9bbfe`. Each anchor matches once at both. Each edit adds `ref` and nothing else; everything else on those lines, `waitMs` and `waitSent` included, stays as it is.

- [ ] **Step 3: Change `engine/src/apiclient.js`.** In the `cosign` entry, replace the start of the line (it then ends `),` at HEAD, or `, cosignMs),` after piece 2's deadline fix; leave the end as it is):

```js
    cosign: (tx) => call("POST", "/api/cosign", { tx }
```

with:

```js
    // ref: the wallet whose share link this join came from (refs.js), beside the tx
    cosign: (tx, { ref = null } = {}) => call("POST", "/api/cosign", ref ? { tx, ref } : { tx }
```

- [ ] **Step 4: Change `engine/src/flows.js`.**
  - Replace the line:

```js
  async function signAndCosign(signTransaction, payer, ixs) {
```

  with:

```js
  async function signAndCosign(signTransaction, payer, ixs, { ref = null } = {}) {
    // `ref` goes beside the tx, never in it: the gate signs the same tx either way
```

  - In the same function, replace the text (at HEAD it ends the line with `;`; after piece 2's deadline fix, `.catch((e) => {` follows it):

```js
api.cosign(b64(signed.serialize()))
```

  with:

```js
api.cosign(b64(signed.serialize()), { ref })
```

  - In `joinPresale`'s doc comment, replace the start of the line (at `6b9bbfe` the line goes on with `` `waitMs`: how long a``, and at `c38e1c4` with `*/`; leave the rest as it is):

```js
  /** join + delegate(seat), then commit the whole deposit in the ER.
```

  with:

```js
  /** join + delegate(seat), then commit the whole deposit in the ER. `ref`: the wallet whose
   *  share link brought this join (refs.js refFor), or null.
```

  - In `joinPresale`'s signature, replace the start of the line (it goes on with ` onStep = (_what) => {}`, and at `6b9bbfe` then `, waitMs = 90_000 }) {`; leave the rest as it is):

```js
  async function joinPresale({ info, wallet, signTransaction, view, amount,
```

  with the text below. The `@type` cast keeps the web's TypeScript check from typing `ref` as `null`. Without it, Task 9's `store.ts` gets error TS2322 (checked on a scratch copy).

```js
  async function joinPresale({ info, wallet, signTransaction, view, amount, ref = /** @type {string | null} */ (null),
```

  - The line `const r = await signAndCosign(signTransaction, wallet, ixs);` appears twice in the file: once in `openPresale` and once in `joinPresale`. Change only the one in `joinPresale`. Anchor on it together with the end of the line before it, which builds `joinPresale`'s `ixs`; the pair is unique. Replace:

```js
validator: new PublicKey(view.validator) });
    const r = await signAndCosign(signTransaction, wallet, ixs);
```

  with:

```js
validator: new PublicKey(view.validator) });
    const r = await signAndCosign(signTransaction, wallet, ixs, { ref });
```

  The line after it, the 202's wait (`waitSent(r, "join", …, { what: "your seat", timeoutMs: waitMs })` at `6b9bbfe`), stays as it is. `openPresale`'s call stays as it is too: it passes no options, so an open sends no `ref`.

- [ ] **Step 5: Run them and confirm they pass.** Run `cd engine && node --test test/apiclient.test.js test/flows.test.js test/selftest.test.js 2>&1 | grep -E '^# (pass|fail)'`. Expected: `# fail 0`. `test/selftest.test.js` holds the golden digests, which must still match.

- [ ] **Step 6: Run the engine suite.** Run `cd engine && npm test`. Expected: the Task 1 count plus 2, and no new failures.

- [ ] **Step 7: Commit.**

```bash
git add engine/src/apiclient.js engine/src/flows.js engine/test/apiclient.test.js engine/test/flows.test.js && git commit -m "engine: a join from a share link sends its ref beside the tx; the tx is unchanged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/src/apiclient.js engine/src/flows.js engine/test/apiclient.test.js engine/test/flows.test.js
```

---

### Task 3: The server records a sent join's referrer (`referrals.js`, `api.js`)

The referrals live in their own table and module, like `social.js`, so `store.js` (which another session edits) stays untouched.

How a row is written:
- A cosigned join with a good `ref` writes a row: `confirmed = 1` when the reply is 200, `confirmed = 0` when it is a 202 from this send (sent, not confirmed in time).
- A repeat of a tx that already went out gets an early 202 (`before === "out"` in `cosignRoute`, since `6b9bbfe`). It returns before the referral block and writes nothing: its first send did.
- One row per seat `(presale, user)`, written with `INSERT … ON CONFLICT(presale, user) DO UPDATE … WHERE referrals.confirmed = 0`. A confirmed row is never replaced. An unconfirmed row takes the seat's next join that carries a ref, so a 202 that never landed can't block a later join's referrer.
- A bad ref writes nothing, and a write that throws is logged: neither changes the join's reply.

**Files:**
- Create: `engine/server/referrals.js`
- Create: `engine/test/referrals.test.js`
- Modify: `engine/server/api.js` (the header comment, imports, a new `refOf`, the cosign route)
- Test: append to `engine/test/server.test.js`

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- engine/server/api.js engine/test/server.test.js && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the failing tests.**
  - Create `engine/test/referrals.test.js`:

```js
// The referrals table: one row per seat. A join that confirmed keeps its referrer; one sent
// but not confirmed in time is noted unconfirmed and gives way to the seat's next join.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { Referrals } from "../server/referrals.js";

const key = () => Keypair.generate().publicKey;

test("Referrals: an unconfirmed row gives way, a confirmed one stays; kept beside the server's other records", () => {
  const store = new Store(":memory:");
  const refs = new Referrals(store.db);
  const [presale, user, a, b, c] = [key(), key(), key(), key(), key()];
  assert.equal(refs.referralOf(presale, user), null);

  refs.add(presale, user, a, "SIG1", 1, false);
  assert.deepEqual(refs.referralOf(presale, user), { referrer: a.toBase58(), sig: "SIG1", at: 1, confirmed: false }, "a 202: noted, unconfirmed");
  refs.add(presale, user, b, "SIG2", 2, false);
  assert.deepEqual(refs.referralOf(presale, user), { referrer: b.toBase58(), sig: "SIG2", at: 2, confirmed: false }, "another 202 replaces it");
  refs.add(presale, user, c, "SIG3", 3, true);
  assert.deepEqual(refs.referralOf(presale, user), { referrer: c.toBase58(), sig: "SIG3", at: 3, confirmed: true }, "a 200 replaces an unconfirmed row");
  refs.add(presale, user, a, "SIG4", 4, true);
  refs.add(presale, user, b, "SIG5", 5, false);
  assert.deepEqual(refs.referralOf(presale, user), { referrer: c.toBase58(), sig: "SIG3", at: 3, confirmed: true }, "a confirmed row is never replaced");

  const other = key();
  refs.add(other, user, b, "SIG6", 6, true);
  assert.equal(refs.referralOf(other, user).referrer, b.toBase58(), "another presale is another seat");
  assert.equal(new Referrals(store.db).referralOf(presale, user).referrer, c.toBase58(), "a second open of the same file keeps the rows");
  store.close();
});
```

  - In `engine/test/server.test.js`, replace the import line:

```js
import { makeRoutes, sniffImage } from "../server/api.js";
```

  with:

```js
import { makeRoutes, refOf, sniffImage } from "../server/api.js";
import { Referrals } from "../server/referrals.js";
```

  - Append to `engine/test/server.test.js`. It already has `startServer`, `mintBody`, `entryTx`, `openIxs`, `joinIxs`, `presalePda`, `pid`, `Keypair` and `PublicKey`. Its fake chain answers every send, and confirms it only while `s.l1.confirm` is true; with `sendTimeoutMs: 300` an unconfirmed send gives a 202.

```js

/** The seat's referral row without its time, or null. */
function referral(refs, presale, user) {
  const r = refs.referralOf(presale, user);
  return r && { referrer: r.referrer, sig: r.sig, confirmed: r.confirmed };
}

test("cosign: a join from a shared link records who shared it; an open, a bad ref or the joiner's own wallet records nothing", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator], sendTimeoutMs: 300 });
  try {
    const refs = new Referrals(s.store.db);
    const sharer = Keypair.generate().publicKey;
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    const presale = presalePda(pid, mint);
    const open = await s.call("POST", "/api/cosign", { tx: entryTx(creator, openIxs(creator.publicKey, mint)), ref: sharer.toBase58() });
    assert.equal(open.status, 200);
    assert.equal(refs.referralOf(presale, creator.publicKey), null, "an open isn't a join");

    const user = Keypair.generate();
    const j = await s.call("POST", "/api/cosign", { tx: entryTx(user, joinIxs(user.publicKey, presale)), ref: sharer.toBase58() });
    assert.deepEqual([j.status, j.json.kind], [200, "join"]);
    assert.deepEqual(referral(refs, presale, user.publicKey), { referrer: sharer.toBase58(), sig: j.json.sig, confirmed: true });

    const u2 = Keypair.generate();
    const bad = await s.call("POST", "/api/cosign", { tx: entryTx(u2, joinIxs(u2.publicKey, presale)), ref: "not a wallet" });
    assert.deepEqual([bad.status, bad.json.kind], [200, "join"], "a bad ref never fails the join");
    assert.equal(refs.referralOf(presale, u2.publicKey), null, "and writes nothing");

    const u3 = Keypair.generate();
    await s.call("POST", "/api/cosign", { tx: entryTx(u3, joinIxs(u3.publicKey, presale)), ref: u3.publicKey.toBase58() });
    assert.equal(refs.referralOf(presale, u3.publicKey), null, "no one refers themselves");
  } finally {
    await s.close();
  }
});

test("cosign: a 202 join notes its referrer unconfirmed, a later 200 replaces it, and a confirmed one is never replaced", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator], sendTimeoutMs: 300 });
  try {
    const refs = new Referrals(s.store.db);
    const [a, b, c] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    const presale = presalePda(pid, mint);
    assert.equal((await s.call("POST", "/api/cosign", { tx: entryTx(creator, openIxs(creator.publicKey, mint)) })).status, 200);
    const user = Keypair.generate();
    const join = (ref) => s.call("POST", "/api/cosign", { tx: entryTx(user, joinIxs(user.publicKey, presale)), ref: ref.toBase58() });

    s.l1.confirm = false;
    const slow = await join(a);
    assert.equal(slow.status, 202);
    assert.deepEqual(referral(refs, presale, user.publicKey), { referrer: a.toBase58(), sig: slow.json.sig, confirmed: false }, "sent, not confirmed in time: noted, unconfirmed");

    s.l1.confirm = true;
    const ok = await join(b);
    assert.equal(ok.status, 200);
    assert.deepEqual(referral(refs, presale, user.publicKey), { referrer: b.toBase58(), sig: ok.json.sig, confirmed: true }, "the join that confirmed replaces it");

    s.l1.confirm = false;
    assert.equal((await join(c)).status, 202);
    s.l1.confirm = true;
    assert.equal((await join(c)).status, 200);
    assert.deepEqual(referral(refs, presale, user.publicKey), { referrer: b.toBase58(), sig: ok.json.sig, confirmed: true }, "a confirmed row is never replaced");
  } finally {
    await s.close();
  }
});

test("cosign: a repeat of a join tx that already went out gets the early 202 and writes no row; its first send did", async () => {
  const s = await startServer({ sendTimeoutMs: 300 });
  try {
    const refs = new Referrals(s.store.db);
    const presale = presalePda(pid, Keypair.generate().publicKey);
    const user = Keypair.generate();
    s.l1.simErr = "AlreadyProcessed"; // a real RPC's answer to a tx it has seen
    const again = await s.call("POST", "/api/cosign", { tx: entryTx(user, joinIxs(user.publicKey, presale)), ref: Keypair.generate().publicKey.toBase58() });
    assert.deepEqual([again.status, again.json.kind, again.json.confirmed], [202, "join", false]);
    assert.equal(refs.referralOf(presale, user.publicKey), null, "the early 202 returns before the referral block");
  } finally {
    await s.close();
  }
});

test("refOf: a wallet that isn't the joiner's, else null", () => {
  const user = Keypair.generate().publicKey;
  const other = Keypair.generate().publicKey;
  assert.ok(refOf(other.toBase58(), user).equals(other));
  assert.equal(refOf(user.toBase58(), user), null);
  for (const v of [undefined, null, 5, "", "nope", "0".repeat(44), "1".repeat(45), "z".repeat(44), { ref: other.toBase58() }]) {
    assert.equal(refOf(v, user), null, String(v));
  }
});
```

  `"z".repeat(44)` passes the base58 pattern but isn't 32 bytes, so `new PublicKey` throws inside `refOf`, which then returns null. The second test sends the same user's join tx five times (the fake chain's blockhash is fixed, so the bytes are the same). Each repeat stands in for a later, different join tx from the same wallet. The server has no replay check on cosign, and the fake chain simulates and sends each one. A real RPC would answer a repeat of the very same tx with `AlreadyProcessed`, which the server turns into the early 202 that writes nothing (the third test).

- [ ] **Step 2: Run them and confirm they fail.** Run `cd engine && node --test test/referrals.test.js test/server.test.js`. Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../server/referrals.js`.

- [ ] **Step 3: Write `engine/server/referrals.js`:**

```js
// Who brought whom (spec "Referral"): a join made from a shared link names the wallet that
// shared it, and the server keeps that here for each join it sends (api.js cosignRoute):
// confirmed = 1 when the join confirmed (a 200), 0 when this send went out but didn't confirm
// in time (a 202). A repeat of a tx that already went out gets an early 202 and writes
// nothing: its first send did. One row per seat (presale, joiner). A confirmed row is never
// replaced; an unconfirmed one gives way to the seat's next join, so a 202 that never landed
// can't block the referrer of a later join that did. Points for it (the Raider title) come
// later, from this table, and only for seats still there when the presale launches (piece 6):
// that check also settles an unconfirmed row whose join never landed. Nothing here moves SOL.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS referrals (
  presale   TEXT NOT NULL,
  user      TEXT NOT NULL,
  referrer  TEXT NOT NULL,
  sig       TEXT NOT NULL,
  at        INTEGER NOT NULL,
  confirmed INTEGER NOT NULL,
  PRIMARY KEY (presale, user)
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer);`;

const ADD = `
INSERT INTO referrals (presale, user, referrer, sig, at, confirmed) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (presale, user) DO UPDATE SET
  referrer = excluded.referrer, sig = excluded.sig, at = excluded.at, confirmed = excluded.confirmed
WHERE referrals.confirmed = 0`;

export class Referrals {
  /** `db`: the server's node:sqlite database (store.db). */
  constructor(db) {
    this.db = db;
    db.exec(SCHEMA);
  }

  /** `referrer` brought `user` into `presale` with the join tx `sig` (PublicKeys in), at `at`
   *  (ms). `confirmed`: the join confirmed (a 200); false when it was sent but not confirmed
   *  in time (a 202). A confirmed row stays; an unconfirmed one takes this join's. */
  add(presale, user, referrer, sig, at, confirmed) {
    this.db.prepare(ADD).run(presale.toBase58(), user.toBase58(), referrer.toBase58(), sig, at, confirmed ? 1 : 0);
  }

  /** The seat's row: { referrer (base58), sig, at, confirmed (a boolean) }, or null. */
  referralOf(presale, user) {
    const r = this.db.prepare("SELECT referrer, sig, at, confirmed FROM referrals WHERE presale = ? AND user = ?").get(presale.toBase58(), user.toBase58());
    return r ? { referrer: r.referrer, sig: r.sig, at: r.at, confirmed: r.confirmed === 1 } : null;
  }
}
```

- [ ] **Step 4: Change `engine/server/api.js`.** Read the file first; piece 2 edits it too.
  - In the header comment, replace the cosign line:

```js
//   POST /api/cosign                 { tx }  (base64, signed by the user) -> sent, { sig, confirmed }
```

  with:

```js
//   POST /api/cosign                 { tx, ref? }  (base64, signed by the user) -> sent, { sig, confirmed };
//                                    ref: the wallet whose link the joiner came from, kept with
//                                    a sent join (referrals.js)
```

  - After the line `import { HttpError, Limiter, limit } from "./http.js";`, add:

```js
import { Referrals } from "./referrals.js";
```

  - Right before `export function parseKey(v, what) {`, add:

```js
/** A join's referrer from the body's `ref`: a wallet that isn't the joiner (`user`), else
 *  null. A bad ref never fails the join it came with. */
export function refOf(v, user) {
  if (typeof v !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return null;
  try {
    const k = new PublicKey(v);
    return k.equals(user) ? null : k;
  } catch {
    return null;
  }
}

```

  - After the line `  const usedSigs = new Map(); // signature -> when, for the replay window`, add:

```js
  const referrals = new Referrals(store.db);
```

  - In the cosign route, after the line `    if (confirmed) feed?.touch(out.presale);`, add:

```js
    // a join from a shared link: who shared it. A 202 from this send (sent, not confirmed in
    // time) is noted unconfirmed and gives way to the seat's next join; a confirmed one stays
    // (referrals.js). A repeat of a tx that already went out returned above, with no row.
    const ref = out.kind === "join" ? refOf(req.body.ref, out.user) : null;
    if (ref) {
      try {
        referrals.add(out.presale, out.user, ref, sig, now(), confirmed);
      } catch (e) {
        console.error(`referral ${sig}: ${e.message}`); // the join was sent; the reply says so
      }
    }
```

  `api.js` has no logger of its own, so it uses `console.error`. `sig`, `confirmed`, `out`, `req` and `now` are already in scope at that point. Since `0ebf9be` the route is `cosignRoute(req)`, and its checks before the send are in `cosignChecked`; this block goes after the send, in `cosignRoute`. Answers from `cosignChecked` say `sent: false`, and answers after the send must not. `refOf` never throws and `referrals.add` is caught, so a referral can't turn a sent join's reply into an error. On a 202 from this send, `sig` is the sent tx's signature (the route takes it from the `TxError`). Since `6b9bbfe` there is a second kind of 202: the same signed tx again, after it went out (`before === "out"`), answered before any send. It returns above this block, so it writes no row; the first send wrote it.

- [ ] **Step 5: Run them and confirm they pass.** Run `cd engine && node --test test/referrals.test.js test/server.test.js 2>&1 | grep -E '^not ok|^# (pass|fail)'`. Expected: `# fail 0`.

- [ ] **Step 6: Run the engine suite.** Run `cd engine && npm test`. Expected: the Task 2 count plus 5, and no new failures.

- [ ] **Step 7: Commit.**

```bash
git add engine/server/referrals.js engine/test/referrals.test.js engine/server/api.js engine/test/server.test.js && git commit -m "server: a join from a share link records who shared it, confirmed on a 200 and unconfirmed on a 202; a confirmed row is never replaced

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/referrals.js engine/test/referrals.test.js engine/server/api.js engine/test/server.test.js
```

---

### Task 4: The server serves `assetlinks.json` from `MOONER_ANDROID_CERTS`

The file exists only while the Railway variable holds at least one fingerprint. Until then the route returns 404, which is today's behaviour. A typo in the variable is logged and left out, and so is Expo's public debug key (fact 5); neither stops the server, because that would stop the mainnet keeper.

**Files:**
- Create: `engine/server/applinks.js`
- Create: `engine/test/applinks.test.js`
- Modify: `engine/server/http.js` (a route may set its content type)
- Modify: `engine/server/config.js` (`MOONER_ANDROID_CERTS`)
- Modify: `engine/server/main.js` (mount the route, log it)

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- engine/server/http.js engine/server/config.js engine/server/main.js && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the failing test.** Create `engine/test/applinks.test.js`:

```js
// /.well-known/assetlinks.json (Android App Links) and the MOONER_ANDROID_CERTS setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { ANDROID_PACKAGE, assetLinks, makeAppLinkRoutes } from "../server/applinks.js";
import { androidCertsFrom, loadConfig } from "../server/config.js";
import { createServer } from "../server/http.js";

const CERT = `${"AB:".repeat(31)}CD`;
const CERT2 = `${"12:".repeat(31)}EF`;

async function serve(certs) {
  const server = createServer(makeAppLinkRoutes({ certs }), { log: () => {} });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { get: (p) => fetch(base + p), close: () => new Promise((r) => server.close(r)) };
}

test("assetlinks.json: the app and its keys, as plain application/json", async () => {
  const s = await serve([CERT, CERT2]);
  try {
    const r = await s.get("/.well-known/assetlinks.json");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/json");
    assert.deepEqual(await r.json(), [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "family.mooner.app", sha256_cert_fingerprints: [CERT, CERT2] },
      },
    ]);
    assert.equal(ANDROID_PACKAGE, "family.mooner.app");
    assert.deepEqual(assetLinks([CERT]), [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [CERT] } }]);
  } finally {
    await s.close();
  }
});

test("assetlinks.json: no keys set, no file; other replies keep their JSON type", async () => {
  const s = await serve([]);
  try {
    const r = await s.get("/.well-known/assetlinks.json");
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal((await s.get("/.well-known/other.json")).status, 404);
  } finally {
    await s.close();
  }
});

test("MOONER_ANDROID_CERTS: fingerprints, comma or space separated, uppercased; others and Expo's debug key left out and named", () => {
  assert.deepEqual(androidCertsFrom(""), { androidCerts: [], androidCertsBad: [] });
  assert.deepEqual(androidCertsFrom(` ${CERT.toLowerCase()},\n${CERT2} ${CERT}`), { androidCerts: [CERT, CERT2], androidCertsBad: [] });
  assert.deepEqual(androidCertsFrom(`${CERT}, AB:CD, sha256`), { androidCerts: [CERT], androidCertsBad: ["AB:CD", "sha256"] });
  // the key in Expo's template: public, so any app signed with it could claim the links
  const expoDebug = "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C";
  assert.deepEqual(androidCertsFrom(`${CERT} ${expoDebug.toLowerCase()}`), { androidCerts: [CERT], androidCertsBad: [expoDebug.toLowerCase()] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mooner-"));
  try {
    const k = () => Keypair.generate().publicKey.toBase58();
    fs.writeFileSync(`${dir}/deployment.json`, JSON.stringify({ programId: k(), dbcConfig: k(), alt: k() }));
    assert.deepEqual(loadConfig({ MOONER_DIR: dir }).androidCerts, []);
    const cfg = loadConfig({ MOONER_DIR: dir, MOONER_ANDROID_CERTS: `${CERT} nope` });
    assert.deepEqual([cfg.androidCerts, cfg.androidCertsBad], [[CERT], ["nope"]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `cd engine && node --test test/applinks.test.js`. Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../server/applinks.js`.

- [ ] **Step 3: Write `engine/server/applinks.js`:**

```js
// Android App Links (spec "Server additions"): /.well-known/assetlinks.json names the signing
// keys whose family.mooner.app may open app.mooner.family links. Android reads it after the
// app is installed; once it checks out, those links open the app instead of the browser
// (developer.android.com/training/app-links/configure-assetlinks). The keys come from
// MOONER_ANDROID_CERTS (config.js); with none set there's no file, and links open the site.

import { HttpError } from "./http.js";

export const ANDROID_PACKAGE = "family.mooner.app";

/** The statement list for `certs` (SHA-256 fingerprints, "AB:CD:…"). */
export function assetLinks(certs, pkg = ANDROID_PACKAGE) {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: certs },
    },
  ];
}

/** GET /.well-known/assetlinks.json as plain application/json (Android's docs ask for that
 *  type); 404 while no key is set. */
export function makeAppLinkRoutes({ certs = [] } = {}) {
  return [
    {
      method: "GET",
      path: /^\/\.well-known\/assetlinks\.json$/,
      handler: async () => {
        if (certs.length === 0) throw new HttpError(404, "not found");
        return { json: assetLinks(certs), type: "application/json" };
      },
    },
  ];
}
```

- [ ] **Step 4: Change `engine/server/http.js`.**
  - Replace the doc line:

```js
 * A handler gets { params, body, ip, url } and returns { status?, json }.
```

  with:

```js
 * A handler gets { params, body, ip, url } and returns { status?, json, type? } (type: the
 * content-type; JSON in UTF-8 by default).
```

  - Replace:

```js
    const reply = (status, json) => {
```

  with:

```js
    const reply = (status, json, type = "application/json; charset=utf-8") => {
```

  - In the same `reply`, replace `        "content-type": "application/json; charset=utf-8",` with:

```js
        "content-type": type,
```

  - Replace:

```js
      reply(out.status ?? 200, out.json);
```

  with:

```js
      reply(out.status ?? 200, out.json, out.type);
```

  Error replies keep calling `reply(status, json)`, so they keep the UTF-8 JSON type.

- [ ] **Step 5: Change `engine/server/config.js`.**
  - In the header's list of variables, after the `MOONER_IPFS_GATEWAY` line, add:

```js
//   MOONER_ANDROID_CERTS SHA-256 fingerprints of the Android app's signing keys, comma or space
//                        separated, for /.well-known/assetlinks.json (none: no such file)
```

  - In `loadConfig`'s returned object, after the line `    gateway: env.MOONER_IPFS_GATEWAY ?? IPFS_GATEWAY,`, add:

```js
    ...androidCertsFrom(env.MOONER_ANDROID_CERTS ?? ""),
```

  - Right after `loadConfig`'s closing `}`, add:

```js

const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
// The debug key in Expo's project template: public (it ships in every new project), so any app
// signed with it could claim app.mooner.family links. Never listed.
const EXPO_DEBUG_KEY = "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C";

/** The App Links signing keys from a list of SHA-256 fingerprints ("AB:CD:…", 32 bytes),
 *  comma or space separated: { androidCerts, androidCertsBad }. A word that isn't one, or
 *  is Expo's public debug key, is left out and listed in androidCertsBad for main.js to log:
 *  a typo there costs links that open the site, not the server. */
export function androidCertsFrom(text) {
  const words = text.split(/[\s,]+/).filter(Boolean);
  const ok = (w) => FINGERPRINT.test(w.toUpperCase()) && w.toUpperCase() !== EXPO_DEBUG_KEY;
  return { androidCerts: [...new Set(words.filter(ok).map((w) => w.toUpperCase()))], androidCertsBad: words.filter((w) => !ok(w)) };
}
```

- [ ] **Step 6: Change `engine/server/main.js`.** Read it first; piece 2 edits it too.
  - After `import { makeSocialRoutes } from "./social.js";`, add:

```js
import { makeAppLinkRoutes } from "./applinks.js";
```

  - Replace the end of the routes chain:

```js
  onChat: (row) => feed.chat(row), onProfile: (wallet, pfp) => feed.profile(wallet, pfp),
}));
```

  with:

```js
  onChat: (row) => feed.chat(row), onProfile: (wallet, pfp) => feed.profile(wallet, pfp),
})).concat(makeAppLinkRoutes({ certs: cfg.androidCerts }));
log(cfg.androidCerts.length ? `App Links for ${cfg.androidCerts.length} Android signing key(s)` : "no MOONER_ANDROID_CERTS: no assetlinks.json, app links open the site");
if (cfg.androidCertsBad.length) log(`MOONER_ANDROID_CERTS: left out (not a SHA-256 fingerprint, or Expo's public debug key): ${cfg.androidCertsBad.join(" ")}`);
```

- [ ] **Step 7: Run the checks.**
  - Run `cd engine && node --test test/applinks.test.js && node --check server/main.js`. Expected: `# pass 3`, `# fail 0`, and no output from `--check`.
  - Run `cd engine && npm test`. Expected: the Task 3 count plus 3, and no new failures.

- [ ] **Step 8: Commit.**

```bash
git add engine/server/applinks.js engine/test/applinks.test.js engine/server/http.js engine/server/config.js engine/server/main.js && git commit -m "server: /.well-known/assetlinks.json for the Android app's signing keys (MOONER_ANDROID_CERTS)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/applinks.js engine/test/applinks.test.js engine/server/http.js engine/server/config.js engine/server/main.js
```

---

### Task 5: The phone keeps a link's ref and sends it with the join (`mobile/src/store.js`)

**Files:**
- Modify: `mobile/src/store.js` (an import, a constant, a share-links section, two lines of `join`, the action list)
- Test: append to `mobile/test/store.test.mjs`

Read both files first; piece 2 edits them, and piece 4 edits `store.js` after this. The anchors are small on purpose, so a change elsewhere in `join` doesn't break them:
- the `flows.js` import line;
- the `mineName` line;
- the line `  /** Join presale \`key\` with \`amount\` (BigInt lamports, a valid seat). */` (the new section goes above it);
- inside `join`, the `await flows.joinPresale({ … onStep });` line and the `await remember(signer.publicKey.toBase58(), key, …);` line, each replaced on its own;
- the substring `joinCost, sendChat` in the final `set({ … })`.

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- mobile/src/store.js mobile/test/store.test.mjs && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the failing tests.** Append to `mobile/test/store.test.mjs`. At `6b9bbfe` the file already has:
  - `rig({ flows, api, market, now, wrapSaved })`, which returns `{ store, push, pushRaw, listening, disk, calls, info, goUp, status }`. Its default `now` is `1_000_000`, its fake `flows.joinPresale` pushes `["join", args]` to `calls`, and `disk` is the fake secure store (a `Map` by name);
  - `signer` (wallet `W = "Wallet1111"`), `assert` and `test`;
  - top-level `OTHER` and `MINT`, and no top-level `KEY`, `SHARER`, `ME` or `me`.

```js

// ---- share links ----

const KEY = "K".repeat(44);
const SHARER = "S".repeat(44);
const ME = "M".repeat(44);
const me = { ...signer, publicKey: { toBase58: () => ME } };

test("noteRef: a link's ref goes with the next join there, once", async () => {
  const { store, calls, disk } = rig();
  await store.getState().noteRef(KEY, SHARER);
  assert.deepEqual(disk.get("mooner:refs"), { [KEY]: { ref: SHARER, at: 1_000_000 } }, "kept on the phone");
  assert.equal((await store.getState().join(KEY, 100_000_000n, me)).ok, true);
  assert.equal(calls.find((c) => c[0] === "join")[1].ref, SHARER);
  assert.deepEqual(disk.get("mooner:refs"), {}, "dropped once the join landed");
  await store.getState().join(KEY, 100_000_000n, me);
  assert.equal("ref" in calls.filter((c) => c[0] === "join")[1][1], false, "the next join sends none");
});

test("noteRef: never your own wallet, another presale's, or junk", async () => {
  const { store, calls } = rig();
  await store.getState().noteRef(KEY, ME);
  await store.getState().noteRef("P".repeat(44), SHARER);
  await store.getState().noteRef(KEY, "not a wallet");
  await store.getState().join(KEY, 100_000_000n, me);
  assert.equal("ref" in calls.find((c) => c[0] === "join")[1], false);
});

test("noteRef: a join that fails keeps the ref for the next try", async () => {
  let fail = true;
  const { store, calls, disk } = rig({
    flows: {
      joinPresale: async (a) => {
        calls.push(["join", a]);
        if (fail) throw new Error("User rejected the request");
      },
    },
  });
  await store.getState().noteRef(KEY, SHARER);
  assert.equal((await store.getState().join(KEY, 100_000_000n, me)).ok, false);
  assert.equal(disk.get("mooner:refs")[KEY].ref, SHARER);
  fail = false;
  await store.getState().join(KEY, 100_000_000n, me);
  assert.deepEqual(calls.map((c) => c[1].ref), [SHARER, SHARER]);
});

test("noteRef: a ref saved before the app restarted still goes with the join", async () => {
  const wrapSaved = (base) => (name) => {
    const s = base(name);
    if (name === "mooner:refs") s.get = async () => ({ [KEY]: { ref: SHARER, at: 1 } });
    return s;
  };
  const { store, calls } = rig({ wrapSaved });
  await store.getState().join(KEY, 100_000_000n, me);
  assert.equal(calls.find((c) => c[0] === "join")[1].ref, SHARER);
});

test("noteRef: storage that throws still keeps the ref for this session", async () => {
  const wrapSaved = () => () => ({ get: () => { throw new Error("storage is gone"); }, set: () => { throw new Error("storage is gone"); }, clear: async () => {} });
  const { store, calls } = rig({ wrapSaved });
  await store.getState().noteRef(KEY, SHARER);
  assert.equal((await store.getState().join(KEY, 100_000_000n, me)).ok, true);
  assert.equal(calls.find((c) => c[0] === "join")[1].ref, SHARER);
});

test("noteRef: two links noted at once both stay", async () => {
  const { store, disk } = rig();
  const OTHER = "P".repeat(44);
  await Promise.all([store.getState().noteRef(KEY, SHARER), store.getState().noteRef(OTHER, SHARER)]);
  assert.deepEqual(Object.keys(disk.get("mooner:refs")).sort(), [KEY, OTHER].sort());
});
```

  `OTHER` inside the last test shadows the file's top-level `OTHER`. That's fine, because it's block-scoped. If a top-level `KEY`, `SHARER`, `ME` or `me` already exists by then, rename the new ones (for example `REF_KEY`) instead of redeclaring.

- [ ] **Step 2: Run them and confirm they fail.** Run `cd mobile && node --test test/store.test.mjs 2>&1 | grep -E '^not ok|^# (pass|fail)'`. Expected: five `noteRef` tests FAIL with `store.getState(...).noteRef is not a function`. The fourth ("a ref saved before the app restarted") fails on its `assert.equal`, as the join sends no `ref` yet.

- [ ] **Step 3: Change `mobile/src/store.js`.**
  - After the line `import { explain } from "../../engine/src/flows.js";`, add:

```js
import { refFor, withRef, withoutRef } from "../../engine/src/refs.js";
```

  - After the line ``const mineName = (w) => `mooner:mine:${w}`;``, add:

```js
/** Share-link refs, { presale: { ref, at } } (engine/src/refs.js), one record per phone. */
const REFS = "mooner:refs";
```

  - Right above the line:

```js
  /** Join presale `key` with `amount` (BigInt lamports, a valid seat). */
```

  insert:

```js
  // ---- share links ----

  let refs = {}; // the saved refs once read, and every change since
  let refsRead = null; // the one read of the saved refs, shared by whoever asks first
  const loadRefs = () => (refsRead ??= keep(() => saved(REFS).get()).then((v) => void (refs = v ?? {})));

  /** Applies `change` to the refs and saves them. Reads and writes `refs` with no await in
   *  between, so two at once can't lose one. */
  async function changeRefs(change) {
    await loadRefs();
    const next = change(refs);
    if (next === refs) return;
    refs = next;
    await keep(() => saved(REFS).set(next));
  }

  /** A presale opened from a link that carries `?ref=<wallet>`: kept until a join there lands,
   *  and `join` sends it (never the joiner's own wallet). The newest link wins; junk is ignored. */
  const noteRef = (key, ref) => changeRefs((r) => withRef(r, key, ref, now()));

  /** The join landed: its ref went with it. */
  const dropRef = (key) => changeRefs((r) => withoutRef(r, key));

```

  - Inside `join`, replace the line:

```js
      await flows.joinPresale({ info, wallet: signer.publicKey, signTransaction: signer.signTransaction, view, amount, onStep });
```

  with:

```js
      await loadRefs();
      const ref = refFor(refs, key, signer.publicKey.toBase58()); // a share link's, if one is kept
      await flows.joinPresale({ info, wallet: signer.publicKey, signTransaction: signer.signTransaction, view, amount, onStep, ...(ref && { ref }) });
```

  - Inside `join`, replace the line:

```js
      await remember(signer.publicKey.toBase58(), key, { deposit: String(amount), at: now(), back: null });
```

  with:

```js
      await remember(signer.publicKey.toBase58(), key, { deposit: String(amount), at: now(), back: null });
      await dropRef(key); // the join landed: its ref went with it
```

  Leave the rest of `join` as it is. A join that throws never reaches `dropRef`, so its ref stays for the next try.

  - In the final `set({ … })` that lists the actions, replace the substring `joinCost, sendChat` with `joinCost, sendChat, noteRef`.

  `keep` and `saved` already exist in `store.js`. `keep` turns a throw from storage into `undefined`, which is why the "storage that throws" test passes.

- [ ] **Step 4: Run them and confirm they pass.** Run `cd mobile && node --test test/store.test.mjs 2>&1 | grep -E '^not ok|^# (pass|fail)'`. Expected: `# fail 0`, and `# pass` is the file's count before Step 1 plus 6.

- [ ] **Step 5: Run the phone suite.** Run `cd mobile && npm test`. Expected: the baseline plus 6, and no new failures.

- [ ] **Step 6: Commit.**

```bash
git add mobile/src/store.js mobile/test/store.test.mjs && git commit -m "mobile: a share link's ref is kept per presale and goes with the join there

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/store.js mobile/test/store.test.mjs
```

  Step 0 checked that no one else had changes in these files. If someone does now, stop and report: a path commit takes the whole file, including their lines.

---

### Task 6: The room's Share button

**Files:**
- Create: `mobile/src/room/share.js`
- Create: `mobile/test/share.test.mjs`
- Modify: `mobile/src/ui/icons.js` (`ShareIcon`)
- Modify: `mobile/src/ui/TopBar.js` (`side`)
- Modify: `mobile/app/presale/[key].js` (reads `?ref=`, the Share button)

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- mobile/src/ui/icons.js mobile/src/ui/TopBar.js "mobile/app/presale/[key].js" && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Write the failing test.** Create `mobile/test/share.test.mjs`:

```js
// The room's share text: plain words, the stage, what's in so far, and the link with the
// sharer's wallet as ref. None for a presale still OPEN past its deadline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shareOf } from "../src/room/share.js";

const KEY = "11111111111111111111111111111111";
const ME = "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D";
const CREATOR = "C".repeat(44);
const N = { TARGET: 500_000_000n };
const BASE = "https://app.mooner.family";
const LINK = `${BASE}/presale/${KEY}?ref=${ME}`;
const NOW = 1_790_000_000_000; // ms
const open = (over = {}) => ({ presale: KEY, state: "OPEN", creator: CREATOR, raised: "120000000", token: { symbol: "MOON" }, users: [], deadlineTs: NOW / 1000 + 600, ...over });
const share = (view, wallet = ME, launched = undefined, now = NOW) => shareOf({ view, launched, wallet, N, base: BASE, now });

test("an open presale: the coin, what's in so far, and the link with my wallet as ref", () => {
  assert.deepEqual(share(open()), {
    title: "$MOON on Mooner",
    message: `The $MOON presale is open on Mooner.\n0.12 of 0.5 SOL in so far.\n${LINK}`,
  });
});

test("who shares: the creator, someone in it (detail or list view), nobody signed in", () => {
  assert.equal(share(open(), CREATOR).message.split("\n")[0], "My $MOON presale is open on Mooner.");
  assert.equal(share(open({ users: [{ user: ME }] })).message.split("\n")[0], "I'm in the $MOON presale on Mooner.");
  assert.equal(share(open({ seats: [{ user: ME, deposit: "100000000", commit: "100000000" }] })).message.split("\n")[0], "I'm in the $MOON presale on Mooner.");
  assert.equal(share(open(), null).message, `The $MOON presale is open on Mooner.\n0.12 of 0.5 SOL in so far.\n${BASE}/presale/${KEY}`, "no wallet: no ref");
});

test("no token details yet: plain words, still the link", () => {
  assert.deepEqual(share(open({ token: null })), {
    title: "A presale on Mooner",
    message: `This presale is open on Mooner.\n0.12 of 0.5 SOL in so far.\n${LINK}`,
  });
});

test("after the presale: launching, live, migrated, closed", () => {
  assert.equal(share(open({ state: "LAUNCHING" })).message, `$MOON is launching on Mooner.\n${LINK}`);
  assert.equal(share(open({ state: "CLOSED" }), ME, { pool: { migrated: false } }).message, `$MOON is live on Mooner.\n${LINK}`);
  assert.equal(share(open({ state: "CLOSED" }), ME, { pool: { migrated: true } }).message, `$MOON is live on Mooner.\n${LINK}`);
  assert.equal(share(open({ state: "EXPIRED" })).message, `The $MOON presale on Mooner has closed.\n${LINK}`);
});

test("no game words in any of it", () => {
  const views = [open(), open({ token: null }), open({ state: "LAUNCHING" }), open({ state: "EXPIRED" }), open({ users: [{ user: ME }] })];
  for (const v of views) for (const w of [ME, CREATOR, null]) {
    const { title, message } = share(v, w);
    assert.doesNotMatch(`${title}\n${message}`, /player|lobby|match|game|level|quest/i);
  }
});

test("past deadline gets no Share: an OPEN presale whose time is up has nothing to join yet", () => {
  assert.equal(share(open({ deadlineTs: NOW / 1000 - 1 })), null);
  assert.equal(share(open(), ME, undefined, NOW + 600_000), null, "the deadline itself");
  assert.equal(share(open({ deadlineTs: undefined })), null, "no deadline known");
  assert.equal(share(open({ state: "LAUNCHING", deadlineTs: NOW / 1000 - 1 })).message, `$MOON is launching on Mooner.\n${LINK}`, "after OPEN the deadline doesn't matter");
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `cd mobile && node --test test/share.test.mjs`. Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/room/share.js`.

- [ ] **Step 3: Write `mobile/src/room/share.js`:**

```js
// What the room's share button sends: a line about the presale, how much is in, and its link.
// Android's share sheet takes text only (react-native Share.js passes `title` and `message`,
// not `url`), so the link ends the message. Plain functions, so Node tests run them.
import { shareLink } from "../../../engine/src/refs.js";
import { seatOf, secondsLeft, stageOf } from "../../../engine/src/views.js";
import { solText } from "../ui/format.js";

/** The first line, by stage and by who shares: the creator, someone in it, anyone else. */
function headline(stage, coin, who) {
  if (stage === "presale") {
    if (who === "creator") return coin ? `My ${coin} presale is open on Mooner.` : "My presale is open on Mooner.";
    if (who === "in") return coin ? `I'm in the ${coin} presale on Mooner.` : "I'm in this presale on Mooner.";
    return coin ? `The ${coin} presale is open on Mooner.` : "This presale is open on Mooner.";
  }
  if (stage === "launching") return coin ? `${coin} is launching on Mooner.` : "This presale is launching on Mooner.";
  if (stage === "live" || stage === "migrated") return coin ? `${coin} is live on Mooner.` : "This coin is live on Mooner.";
  return coin ? `The ${coin} presale on Mooner has closed.` : "This presale on Mooner has closed.";
}

/** { title, message } for sharing presale `view` (a list or a detail view). `launched`: its
 *  launched row or undefined. `wallet`: the connected wallet (base58) or null; the link then
 *  carries `?ref=<wallet>`. `N`: info.N. `base`: config.js BASE. `now`: ms. null while the
 *  presale is OPEN past its deadline: no one can join it, and it hasn't launched or closed
 *  yet, so there is nothing true to say; the room shows no Share button then. */
export function shareOf({ view, launched, wallet, N, base, now }) {
  const coin = view.token?.symbol ? `$${view.token.symbol}` : null;
  const stage = stageOf(view, launched);
  if (stage === "presale" && secondsLeft(view, now) <= 0) return null;
  const who = !wallet ? null
    : view.creator === wallet ? "creator"
    : seatOf(view, wallet) || view.users?.some((u) => u.user === wallet) ? "in"
    : null;
  const lines = [headline(stage, coin, who)];
  if (stage === "presale") lines.push(`${solText(view.raised)} of ${solText(N.TARGET)} SOL in so far.`);
  lines.push(shareLink(base, view.presale, wallet));
  return { title: coin ? `${coin} on Mooner` : "A presale on Mooner", message: lines.join("\n") };
}
```

- [ ] **Step 4: Run it and confirm it passes.** Run `cd mobile && node --test test/share.test.mjs`. Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Add `ShareIcon` to `mobile/src/ui/icons.js`.**
  - In the header comment, replace `the small ones the screens use (back, chat, tick, padlock, send).` with `the small ones the screens use (back, chat, share, tick, padlock, send).`.
  - Right before `export function CheckIcon(`, add:

```js
/** Three dots joined by two lines: share. */
export function ShareIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={18} cy={5.5} r={2.5} stroke={color} {...STROKE} />
      <Circle cx={6} cy={12} r={2.5} stroke={color} {...STROKE} />
      <Circle cx={18} cy={18.5} r={2.5} stroke={color} {...STROKE} />
      <Path d="M8.2 10.8 L15.8 6.7 M8.2 13.2 L15.8 17.3" stroke={color} {...STROKE} />
    </Svg>
  );
}

```

  `Circle`, `Path` and `STROKE` are already imported or defined in that file.

- [ ] **Step 6: Give `TopBar` a `side` width.** In `mobile/src/ui/TopBar.js`, replace:

```js
/** `fallback`: the href back opens when there's nothing to go back to. `right`: an element
 *  for the right side, up to SIDE wide. */
export function TopBar({ title, right, fallback }) {
```

with:

```js
/** `fallback`: the href back opens when there's nothing to go back to. `right`: an element
 *  for the right side, up to `side` wide. `side`: each side's width, wider when `right` holds
 *  two buttons. */
export function TopBar({ title, right, fallback, side = SIDE }) {
```

  Then, in the same function, replace `[{ width: SIDE, height: 44,` with `[{ width: side, height: 44,`, and `<View style={{ width: SIDE, alignItems: "flex-end" }}>` with `<View style={{ width: side, alignItems: "flex-end" }}>`. Both sides must stay the same width, so the title stays centred.

- [ ] **Step 7: Change the room, `mobile/app/presale/[key].js`.** Read it first; piece 2 may have changed it.
  - Replace the react-native import:

```js
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
```

  with:

```js
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
```

  - Replace:

```js
import { ChatIcon, CheckIcon } from "../../src/ui/icons";
```

  with:

```js
import { ChatIcon, CheckIcon, ShareIcon } from "../../src/ui/icons";
```

  If piece 2 has added names to this import, add `ShareIcon` to the list instead.

  - After the line `import { bottomOf, claimedOf, heroOf, isKey, lockedCommit } from "../../src/room/room";`, add:

```js
import { shareOf } from "../../src/room/share";
import { BASE } from "../../src/config";
```

  - After the watch effect line `  useEffect(() => (valid ? store.getState().watch(key) : undefined), [key, valid]);`, add the block below. It has to stay above the early returns, because hooks can't come after them.

```js

  const ref = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  // A link someone shared (`?ref=<their wallet>`): kept until a join from this phone lands here.
  useEffect(() => {
    if (valid && ref) store.getState().noteRef(key, ref);
  }, [key, ref, valid]);
```

  - After the line that starts `  const joinBusy = busy?.kind === "join"`, add:

```js
  // null while the presale is OPEN past its deadline: no Share button then (src/room/share.js)
  const shareText = shareOf({ view, launched, wallet, N: info.N, base: BASE, now });
  const onShare = () => {
    if (shareText) Share.share(shareText, { dialogTitle: "Share this presale" }).catch(() => {});
  };
```

  - In the main `TopBar` (the one with `title={ticker ? …}`), replace:

```js
        fallback={HOME}
        right={<ChatButton count={chatCount} onPress={() => setChatOpen(true)} />}
      />
```

  with:

```js
        fallback={HOME}
        side={100}
        right={
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {shareText ? <ShareButton onPress={onShare} /> : null}
            <ChatButton count={chatCount} onPress={() => setChatOpen(true)} />
          </View>
        }
      />
```

  The width is 100 because `ShareButton` is 44 wide and `ChatButton` is 56. It stays 100 when the Share button is hidden, so the title doesn't move when the deadline passes.

  - Right above ChatButton's doc comment, the line:

```js
/** The chat, with its message count, for the top bar's right side. */
```

  add:

```js
/** Opens Android's share sheet with the presale's link (src/room/share.js). */
function ShareButton({ onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Share"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.6 }]}
    >
      <ShareIcon color={C.text0} />
    </Pressable>
  );
}

```

  `tap` and `C` already exist in the room file.

- [ ] **Step 8: Run the tests and the bundle check.**
  - Run `cd mobile && npm test`. Expected: the Task 5 count plus 6, and no new failures.
  - Run `cd mobile && sh scripts/check-bundle.sh`. Expected: `web3.js copies: 1; files from engine/node_modules: 0`, then `app/ entries from this checkout:` with a count above 0, and exit 0.

- [ ] **Step 9: Check on the phone.**
  - Run `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh`. If the check fails, don't install; see the ground rule on Metro's cache.
  - Open a link with a ref to a presale the server doesn't know:

```bash
adb shell "am start -W -a android.intent.action.VIEW -d 'mooner:///presale/11111111111111111111111111111111?ref=SysvarC1ock11111111111111111111111111111111' family.mooner.app"
adb exec-out screencap -p > <scratchpad>/p3-room-missing.png
```

  - Expected: "This presale isn't here" with a Back button, and no crash. `noteRef` ran with secure-store; there is no visible output for it by design.
  - To see the Share button, the room needs a presale the server serves. Run `curl -sS https://app.mooner.family/api/presales` and `curl -sS https://app.mooner.family/api/launched`.
  - If either lists a presale, open its key the same way, then find and tap the button:

```bash
adb shell uiautomator dump /sdcard/p3.xml && adb pull /sdcard/p3.xml <scratchpad>/p3.xml
grep -o 'content-desc="Share"[^>]*bounds="[^"]*"' <scratchpad>/p3.xml
adb shell input tap <x> <y>    # the centre of those bounds
adb exec-out screencap -p > <scratchpad>/p3-share-sheet.png
adb shell input keyevent KEYCODE_BACK
```

  - Expected: Android's share sheet, titled "Share this presale", with the text preview. The agent picks no target.
  - A presale still OPEN past its deadline shows no Share button, by design. If that's the only one served, record it and go on.
  - If no presale is served, record "share sheet: waits for USER STEP G" and go on.

- [ ] **Step 10: Commit.**

```bash
git add mobile/src/room/share.js mobile/test/share.test.mjs mobile/src/ui/icons.js mobile/src/ui/TopBar.js "mobile/app/presale/[key].js" && git commit -m "mobile: the room's Share button (Android share sheet, the link with your wallet as ref); a link's ref is noted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/room/share.js mobile/test/share.test.mjs mobile/src/ui/icons.js mobile/src/ui/TopBar.js "mobile/app/presale/[key].js"
```

---

### Task 7: https links open the app (the App Link intent filter)

Until the server serves `assetlinks.json` with the release key (USER STEPs A–E), Android leaves the filter unverified. On this Android version, https links then open the browser. The custom scheme keeps working throughout. On the test phone, the manual approval stands in for verification.

**Files:**
- Modify: `mobile/app.json`

- [ ] **Step 0: Check the file is clean.** Run `git diff --quiet HEAD -- mobile/app.json && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Add the filter.** Edit `mobile/app.json` as JSON, not as text, so whatever else is in it stays:

```bash
cd mobile && node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("app.json", "utf8"));
j.expo.android.intentFilters = [
  {
    action: "VIEW",
    autoVerify: true,
    data: [{ scheme: "https", host: "app.mooner.family", pathPrefix: "/presale/" }],
    category: ["BROWSABLE", "DEFAULT"],
  },
];
fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");
console.log(JSON.stringify(j.expo.android));
'
```

  - Expected print, at `6b9bbfe`: `{"package":"family.mooner.app","intentFilters":[{"action":"VIEW","autoVerify":true,"data":[{"scheme":"https","host":"app.mooner.family","pathPrefix":"/presale/"}],"category":["BROWSABLE","DEFAULT"]}]}`. If another `android` key has been added since, it is kept and printed too.
  - The file is rewritten with 2-space indents, so `git diff` also shows the `plugins` and `experiments` lines reflowed onto several lines. Their content doesn't change. Task 8 and piece 4 edit `app.json` with the same kind of script, so the reflow happens once, here.
  - Only `/presale/` links open the app. The rest of the site stays in the browser.

- [ ] **Step 2: Regenerate the native project and check the manifest.**
  - Run `cd mobile && npx expo prebuild --platform android --clean`.
  - Then run `grep -n -B1 -A5 'autoVerify' android/app/src/main/AndroidManifest.xml`. Expected, inside `.MainActivity`, next to the existing `mooner` scheme filter:

```xml
      <intent-filter android:autoVerify="true" data-generated="true">
        <action android:name="android.intent.action.VIEW"/>
        <data android:scheme="https" android:host="app.mooner.family" android:pathPrefix="/presale/"/>
        <category android:name="android.intent.category.BROWSABLE"/>
        <category android:name="android.intent.category.DEFAULT"/>
      </intent-filter>
```

  Also confirm that `grep -c 'android:scheme="mooner"' android/app/src/main/AndroidManifest.xml` is at least 1.

- [ ] **Step 3: Install it.**
  - Run `cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh`. Expected: the check passes, then the build installs over the current app. The key is the same debug key, so there's no signature error. If the check fails, don't install.
  - Then run `cd mobile && npm test`. Its count must be unchanged.

- [ ] **Step 4: Check that the domain is not verified yet.** Run `adb shell pm get-app-links family.mooner.app`. Expected: `app.mooner.family` is listed with a state other than `verified`, because there's no `assetlinks.json` yet. Record the exact state word.

- [ ] **Step 5: The scheme link with a ref still opens the room.**

```bash
adb shell "am start -W -a android.intent.action.VIEW -d 'mooner:///presale/11111111111111111111111111111111?ref=SysvarC1ock11111111111111111111111111111111' family.mooner.app"
adb exec-out screencap -p > <scratchpad>/p3-scheme.png
```

  Expected: the room's "This presale isn't here" screen.

- [ ] **Step 6: Unverified, the https link opens the browser.**

```bash
adb shell "am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'https://app.mooner.family/presale/11111111111111111111111111111111?ref=SysvarC1ock11111111111111111111111111111111'"
adb exec-out screencap -p > <scratchpad>/p3-https-unverified.png
```

  Expected: `am start -W` reports an `Activity:` that is not `family.mooner.app`, and the screenshot shows a browser or Android's app chooser. Press `adb shell input keyevent KEYCODE_HOME` after.

- [ ] **Step 7: With the manual approval, the https link opens the app.** The approval is a setting on the test phone only, and Step 8 undoes it.

```bash
adb shell pm set-app-links-user-selection --user 0 --package family.mooner.app true app.mooner.family
adb shell pm get-app-links --user 0 family.mooner.app
adb shell "am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'https://app.mooner.family/presale/11111111111111111111111111111111?ref=SysvarC1ock11111111111111111111111111111111'"
adb exec-out screencap -p > <scratchpad>/p3-https-selected.png
```

  - Expected: `get-app-links --user 0` shows the user selection for `app.mooner.family`. `am start` reports `family.mooner.app/.MainActivity`, and the screenshot shows the room for that key ("This presale isn't here"), not the Live tab. That confirms fact 12 on the device.
  - If `set-app-links-user-selection` is refused (a permission error from shell), record the exact message, skip Step 8, and leave the https check to USER STEP E's checks.

- [ ] **Step 8: Undo the approval.**

```bash
adb shell pm set-app-links-user-selection --user 0 --package family.mooner.app false app.mooner.family
adb shell pm get-app-links --user 0 family.mooner.app
```

  Expected: the user selection for `app.mooner.family` is gone or off.

- [ ] **Step 9: Commit.**

```bash
git add mobile/app.json && git commit -m "mobile: app.mooner.family/presale/<key> links open the app once Android verifies them (App Link filter)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/app.json
```

---

### Task 8: Release builds can sign with the user's key, behind a flag (config plugin)

`android/` is regenerated by `prebuild --clean`, so the signing setup lives in a config plugin. The plugin signs a release build with the user's key only when the Gradle property `MOONER_RELEASE_SIGN` is `1`; the key's four `MOONER_UPLOAD_*` properties live only on the user's machine (USER STEP B). Without the flag, release builds stay on the debug key exactly as today, even on a machine that has the key. Where the flag is set is the user's choice in USER STEP B:
- in `~/.gradle/gradle.properties`: every release build signs with the key, the agent's `run-android.sh` builds included (choice (a));
- per build only, on the user's own command line: the agent's builds stay debug-signed (choice (b)).

**Files:**
- Create: `mobile/plugins/withReleaseSigning.js`
- Create: `mobile/test/releasesigning.test.mjs`
- Modify: `mobile/app.json` (`plugins`)
- Modify: `mobile/scripts/run-android.sh` (its comment)

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- mobile/app.json mobile/scripts/run-android.sh && echo clean`. Expected: `clean` (Task 7's commit included `app.json`). If not, stop and report.

- [ ] **Step 1: Write the failing test.** Create `mobile/test/releasesigning.test.mjs`:

```js
// The config plugin that signs release builds with Mooner's upload key only when the Gradle
// property MOONER_RELEASE_SIGN is 1: what it does to the template's app/build.gradle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const withReleaseSigning = require("../plugins/withReleaseSigning.js");
const { addReleaseSigning } = withReleaseSigning;

// android/app/build.gradle as `expo prebuild` writes it (Expo SDK 55 template), the part
// the plugin changes
const TEMPLATE = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
        }
    }
`;

test("release builds use the upload key only with MOONER_RELEASE_SIGN=1, else the debug key; debug builds don't change", () => {
  const out = addReleaseSigning(`android {\n${TEMPLATE}}\n`);
  assert.match(out, /signingConfigs \{\n {8}release \{\n {12}\/\/ mooner: release signing\n {12}if \(project\.findProperty\('MOONER_RELEASE_SIGN'\) == '1'\) \{\n {16}storeFile file\(MOONER_UPLOAD_STORE_FILE\)\n {16}storePassword MOONER_UPLOAD_STORE_PASSWORD\n {16}keyAlias MOONER_UPLOAD_KEY_ALIAS\n {16}keyPassword MOONER_UPLOAD_KEY_PASSWORD\n {12}\}\n {8}\}\n {8}debug \{/);
  assert.match(out, /\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n {12}signingConfig\(project\.findProperty\('MOONER_RELEASE_SIGN'\) == '1' \? signingConfigs\.release : signingConfigs\.debug\)\n/);
  assert.match(out, /debug \{\n {12}signingConfig signingConfigs\.debug\n {8}\}/, "the debug build type keeps the debug key");
  assert.equal(out.match(/signingConfigs\.release/g).length, 1);
  assert.doesNotMatch(out, /hasProperty\('MOONER_UPLOAD/, "having the key isn't enough: only the flag switches");
});

test("twice changes nothing; a file it doesn't know stops the build", () => {
  const once = addReleaseSigning(`android {\n${TEMPLATE}}\n`);
  assert.equal(addReleaseSigning(once), once);
  assert.throws(() => addReleaseSigning("android {\n}\n"), /isn't the template/);
});

test("it's a config plugin: a function Expo can load", () => {
  assert.equal(typeof withReleaseSigning, "function");
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `cd mobile && node --test test/releasesigning.test.mjs`. Expected: FAIL with `Cannot find module '../plugins/withReleaseSigning.js'`.

- [ ] **Step 3: Write `mobile/plugins/withReleaseSigning.js`.** It is CommonJS; `mobile/package.json` has no `"type": "module"`. In `RELEASE_CONFIG`, `release {` is indented 8 spaces, its inner lines 12, and the `if` body 16, which matches the test. The build type line calls `signingConfig(…)` with parentheses, so Groovy can't read the `==` and `? :` any other way.

```js
// Expo config plugin: release builds signed with Mooner's own upload key, only when the
// Gradle property MOONER_RELEASE_SIGN is 1; otherwise with the debug key as before.
// android/ is generated (expo prebuild --clean deletes it), so the key and its passwords live
// outside the repo, in Gradle properties, usually ~/.gradle/gradle.properties
// (reactnative.dev/docs/signed-apk-android):
//   MOONER_UPLOAD_STORE_FILE=/absolute/path/to/mooner-upload.keystore
//   MOONER_UPLOAD_STORE_PASSWORD=...
//   MOONER_UPLOAD_KEY_ALIAS=mooner-upload
//   MOONER_UPLOAD_KEY_PASSWORD=...
// Where the flag is set is the user's choice (the share-links plan, USER STEP B):
// MOONER_RELEASE_SIGN=1 in that file signs every release build on the machine; passed for one
// build (`./gradlew … -PMOONER_RELEASE_SIGN=1`, or
// `ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh`), only that build.
// With the flag and no MOONER_UPLOAD_* properties Gradle stops: it never falls back to the
// debug key quietly.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// mooner: release signing";
const SIGN = "project.findProperty('MOONER_RELEASE_SIGN') == '1'";

const RELEASE_CONFIG = `        release {
            ${MARK}
            if (${SIGN}) {
                storeFile file(MOONER_UPLOAD_STORE_FILE)
                storePassword MOONER_UPLOAD_STORE_PASSWORD
                keyAlias MOONER_UPLOAD_KEY_ALIAS
                keyPassword MOONER_UPLOAD_KEY_PASSWORD
            }
        }
`;

const SIGNING_CONFIGS = /\n[ \t]*signingConfigs \{\n/;
// the release build type's signingConfig line, after the template's comments
const RELEASE_LINE = /(release \{\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*)signingConfig signingConfigs\.debug/;

/** app/build.gradle's text with the release signing above. Running it twice changes nothing;
 *  a file that isn't Expo's template throws, rather than build with the wrong key. */
function addReleaseSigning(src) {
  if (src.includes(MARK)) return src;
  if (!SIGNING_CONFIGS.test(src) || !RELEASE_LINE.test(src)) {
    throw new Error("withReleaseSigning: android/app/build.gradle isn't the template it knows; sign release builds by hand");
  }
  return src
    .replace(SIGNING_CONFIGS, (m) => m + RELEASE_CONFIG)
    .replace(RELEASE_LINE, `$1signingConfig(${SIGN} ? signingConfigs.release : signingConfigs.debug)`);
}

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") throw new Error("withReleaseSigning: app/build.gradle must be Groovy");
    c.modResults.contents = addReleaseSigning(c.modResults.contents);
    return c;
  });

module.exports = withReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
```

- [ ] **Step 4: Run it and confirm it passes.** Run `cd mobile && node --test test/releasesigning.test.mjs`. Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Register the plugin.** Edit `mobile/app.json` as JSON, adding the plugin only if it isn't there:

```bash
cd mobile && node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("app.json", "utf8"));
const p = "./plugins/withReleaseSigning";
if (!j.expo.plugins.includes(p)) j.expo.plugins.push(p);
fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");
console.log(JSON.stringify(j.expo.plugins));
'
```

  - Expected print, if no one has added plugins since `6b9bbfe`: `[["expo-router",{"sitemap":false}],"expo-secure-store","expo-font","./plugins/withReleaseSigning"]`. Plugins added by others stay where they are.
  - `git diff mobile/app.json` then shows only `"expo-font"` gaining a comma and the new line: Task 7 already reflowed the file.

- [ ] **Step 6: Update the comment in `mobile/scripts/run-android.sh`.** Replace:

```sh
# it on the phone plugged in over USB (adb devices). It signs with the debug keystore.
```

with:

```sh
# it on the phone plugged in over USB (adb devices). It signs with the debug keystore unless
# the Gradle property MOONER_RELEASE_SIGN is 1 (plugins/withReleaseSigning.js); then with
# Mooner's upload key, named by MOONER_UPLOAD_* in ~/.gradle/gradle.properties. Whether this
# script's builds get the flag is the user's choice. `expo run:android` passes no -P to
# Gradle, so for one build it goes in the environment (how the flag reaches Gradle):
#   ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh
# A build signed with another key than the installed app's won't install over it. That
# needs `adb uninstall family.mooner.app` first, which deletes the app's data (sign-in,
# session keys), and is the user's to run.
```

- [ ] **Step 7: Prebuild and check `build.gradle`.**
  - Run `cd mobile && npx expo prebuild --platform android --clean`.
  - Then run `grep -n "mooner: release signing\|MOONER_RELEASE_SIGN" android/app/build.gradle`. Expected three lines: the mark, `if (project.findProperty('MOONER_RELEASE_SIGN') == '1') {`, and the release build type's `signingConfig(project.findProperty('MOONER_RELEASE_SIGN') == '1' ? signingConfigs.release : signingConfigs.debug)`.

- [ ] **Step 8: Check the switch with Gradle, using no real key.** These runs use made-up paths and passwords, never the user's.

```bash
cd mobile/android
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
FAKE="-PMOONER_UPLOAD_STORE_FILE=/nonexistent/mooner-test.keystore -PMOONER_UPLOAD_STORE_PASSWORD=x -PMOONER_UPLOAD_KEY_ALIAS=test -PMOONER_UPLOAD_KEY_PASSWORD=x"
echo "== 1: nothing set";              ./gradlew -q :app:signingReport | grep -A6 '^Variant: release$'
echo "== 2: key, no flag";             ./gradlew -q :app:signingReport $FAKE | grep -A4 '^Variant: release$'
echo "== 3: key and -P flag";          ./gradlew -q :app:signingReport $FAKE -PMOONER_RELEASE_SIGN=1 | grep -A4 '^Variant: release$'
echo "== 4: key and the flag in env";  ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 ./gradlew -q :app:signingReport $FAKE | grep -A4 '^Variant: release$'
echo "== 5: flag, no key";             ./gradlew -q :app:signingReport -PMOONER_RELEASE_SIGN=1 2>&1 | grep -m3 -i 'MOONER_UPLOAD\|error\|wrong'
```

  - 1, expected: `Config: debug` and `SHA-256: FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`.
  - 2, expected: `Config: debug`. Having the key isn't enough.
  - 3 and 4, expected: `Config: release`, `Store: /nonexistent/mooner-test.keystore`, `Alias: test`, `Error: Missing keystore`. Case 4 is the form `run-android.sh` uses (fact 8a).
  - 5, expected: Gradle stops with an error that names `MOONER_UPLOAD_STORE_FILE`. Record its exact text.
  - Fact 8 shows how an earlier version of this switch behaved; these exact cases weren't run while writing this plan. If any result differs, stop and report it before installing anything.
  - If case 1 already shows `Config: release`, this machine already has `MOONER_RELEASE_SIGN=1` in `~/.gradle/gradle.properties` (USER STEP B done early, choice (a)). Stop: USER STEP C must come before any install.

- [ ] **Step 9: Install, and check the APK is still on the debug key.**

```bash
cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh
/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0/apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk | grep 'SHA-256 digest'
```

  - Expected: the check passes, then `Signer #1 certificate SHA-256 digest: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, and the app opens as before. If the check fails, don't install.
  - Then run `cd mobile && npm test`. Expected: the Task 6 count plus 3.

- [ ] **Step 10: Commit.**

```bash
git add mobile/plugins/withReleaseSigning.js mobile/test/releasesigning.test.mjs mobile/app.json mobile/scripts/run-android.sh && git commit -m "mobile: release builds sign with Mooner's upload key only when MOONER_RELEASE_SIGN=1 (config plugin), else the debug key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/plugins/withReleaseSigning.js mobile/test/releasesigning.test.mjs mobile/app.json mobile/scripts/run-android.sh
```

---

### Task 9: The web keeps `?ref=`, sends it, and copies links with it

The site at app.mooner.family is where the link lands on a computer, or on a phone without the app. It follows the same rules as the phone app, through `engine/src/refs.js`. In private mode localStorage may throw; then nothing is kept and joins send no ref.

**Files:**
- Create: `web/src/real/refs.js`
- Create: `web/tests/refs.test.mjs`
- Modify: `web/src/main.tsx` (the `Presale` route)
- Modify: `web/src/lib/store.ts` (`join`)
- Modify: `web/src/components/presale/PresaleHeader.tsx` (the Share copy button)

- [ ] **Step 0: Check the files are clean.** Run `git diff --quiet HEAD -- web/src/main.tsx web/src/lib/store.ts web/src/components/presale/PresaleHeader.tsx && echo clean`. Expected: `clean`. If not, stop and report.

- [ ] **Step 1: Take the web baseline.** Run `cd web && npm run build`. Expected: exit 0. If it already fails at HEAD, stop and report.
  - Optional: `web/tsconfig.check.json` belongs to another session ("Fix the web type-check setup") and points into other sessions' scratchpads, so the type-check is not a gate here. If you want it, run `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep 'error TS' | sed -E 's/\([0-9]+,[0-9]+\)//' | sort > <scratchpad>/p3-tsc-before.txt` now (line numbers stripped, as this task moves lines) and compare in Step 9.

- [ ] **Step 2: Write the failing test.** Create `web/tests/refs.test.mjs`:

```js
// The web's share-link refs (src/real/refs.js) over a fake localStorage: kept per presale,
// sent with a join, dropped after it; storage that throws keeps nothing and breaks nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dropRef, noteRef, refFor, shareLink } from '../src/real/refs.js'

const KEY = 'K'.repeat(44)
const SHARER = 'S'.repeat(44)
const ME = 'M'.repeat(44)

function fakeStorage() {
  const m = new Map()
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) }
}

test("a link's ref is kept for its presale, sent with my join, then dropped", () => {
  const s = (globalThis.localStorage = fakeStorage())
  noteRef(KEY, SHARER)
  assert.equal(JSON.parse(s.m.get('mooner:refs'))[KEY].ref, SHARER)
  assert.equal(refFor(KEY, ME), SHARER)
  assert.equal(refFor(KEY, SHARER), null, 'never my own wallet')
  assert.equal(refFor('P'.repeat(44), ME), null, 'another presale')
  dropRef(KEY)
  assert.deepEqual(JSON.parse(s.m.get('mooner:refs')), {})
  assert.equal(refFor(KEY, ME), null)
})

test('junk refs and a broken save change nothing', () => {
  const s = (globalThis.localStorage = fakeStorage())
  noteRef(KEY, 'not a wallet')
  assert.equal(s.m.has('mooner:refs'), false)
  s.m.set('mooner:refs', '{broken')
  assert.equal(refFor(KEY, ME), null)
  noteRef(KEY, SHARER)
  assert.equal(refFor(KEY, ME), SHARER, 'a broken save is replaced')
})

test('storage that throws (private mode): nothing kept, nothing thrown', () => {
  const boom = () => {
    throw new Error('denied')
  }
  globalThis.localStorage = { getItem: boom, setItem: boom }
  assert.doesNotThrow(() => noteRef(KEY, SHARER))
  assert.equal(refFor(KEY, ME), null)
  assert.doesNotThrow(() => dropRef(KEY))
})

test("the copied link carries my wallet; a guest's carries none", () => {
  assert.equal(shareLink('', KEY, ME), `/presale/${KEY}?ref=${ME}`)
  assert.equal(shareLink('', KEY, 'guest'), `/presale/${KEY}`)
})
```

- [ ] **Step 3: Run it and confirm it fails.** Run `cd web && node --test tests/refs.test.mjs`. Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/real/refs.js`.

- [ ] **Step 4: Write `web/src/real/refs.js`:**

```js
// Share-link refs in this browser (engine/src/refs.js): a presale page opened with
// `?ref=<wallet>` keeps it until a join there lands, and the join sends it with the co-sign.
// localStorage may throw (private mode); then nothing is kept and joins send no ref.
import { refFor as pick, withRef, withoutRef } from "../../../engine/src/refs.js";

export { shareLink } from "../../../engine/src/refs.js";

const NAME = "mooner:refs";

function read() {
  try {
    return JSON.parse(localStorage.getItem(NAME) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function write(refs) {
  try {
    localStorage.setItem(NAME, JSON.stringify(refs));
  } catch {
    // private mode: the ref isn't kept
  }
}

/** Keeps `ref` for presale `key` (junk and repeats change nothing). */
export function noteRef(key, ref) {
  const had = read();
  const next = withRef(had, key, ref, Date.now());
  if (next !== had) write(next);
}

/** The ref to send with `wallet`'s join of presale `key`, or null. */
export const refFor = (key, wallet) => pick(read(), key, wallet);

/** A join of presale `key` landed: its ref went with it. */
export function dropRef(key) {
  const had = read();
  const next = withoutRef(had, key);
  if (next !== had) write(next);
}
```

- [ ] **Step 5: Run it and confirm it passes.** Run `cd web && node --test tests/refs.test.mjs`. Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 6: Keep `?ref=` on the presale page.** In `web/src/main.tsx`:
  - After `import { PUBLIC_RPC } from '@/real/chain.js'`, add:

```tsx
import { noteRef } from '@/real/refs.js'
```

  - Replace:

```tsx
function Presale() {
  const { id = '' } = useParams()
  const [q] = useSearchParams()
  return <PresaleScreen key={id} id={id} invite={q.get('invite') ?? undefined} />
}
```

  with:

```tsx
function Presale() {
  const { id = '' } = useParams()
  const [q] = useSearchParams()
  const ref = q.get('ref')
  // a shared link's `?ref=<wallet>`: kept until a join here lands (real/refs.js)
  useEffect(() => {
    if (ref) noteRef(id, ref)
  }, [id, ref])
  return <PresaleScreen key={id} id={id} invite={q.get('invite') ?? undefined} />
}
```

  `useEffect` is already imported from `react` in this file.

- [ ] **Step 7: Send the ref with the join.** In `web/src/lib/store.ts`:
  - Read store.ts first: the open-unknown fix edits it after `e81bb45`. Count both anchors: `grep -c -F "import * as live from '@/real/live.js'" web/src/lib/store.ts`, and, for the `join` block, a node `split(…).length - 1`. If one isn't 1, put `ref: refFor(tokenId, w.publicKey.toBase58())` inside the `chain.joinPresale({…})` call. Call `dropRef(tokenId)` only where the join is known to have landed: after `withSteps` returns and before `readPresale`. Never call it in a catch or an unknown-outcome path.
  - After `import * as live from '@/real/live.js'`, add:

```ts
import { dropRef, refFor } from '@/real/refs.js'
```

  - In `join`, replace:

```ts
          await chain.joinPresale({
            info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: BigInt(deposit), onStep,
          })
        })
        await readPresale(tokenId).catch(() => {})
```

  with:

```ts
          await chain.joinPresale({
            info, wallet: w.publicKey, signTransaction: w.signTransaction, view, amount: BigInt(deposit), onStep,
            ref: refFor(tokenId, w.publicKey.toBase58()),
          })
        })
        dropRef(tokenId)
        await readPresale(tokenId).catch(() => {})
```

  A failed join throws before `dropRef`, so its ref stays for the next try.

- [ ] **Step 8: The copied link carries the ref.** In `web/src/components/presale/PresaleHeader.tsx`:
  - After `import { participantOf } from '@/lib/presale'`, add:

```tsx
import { shareLink } from '@/real/refs.js'
```

  - Replace:

```tsx
            <CopyButton value={`/presale/${t.id}`} label="Copy presale link" className="btn btn-sm">
```

  with:

```tsx
            <CopyButton value={shareLink('', t.id, world.meId)} label="Copy presale link" className="btn btn-sm">
```

  `world.meId` is the connected wallet, or `'guest'`, which gives no ref. `CopyButton` turns a path starting with `/` into a full URL on the current origin.

- [ ] **Step 9: Build and test.**
  - Run `cd web && node --test tests/refs.test.mjs`. Expected: `# pass 4`, `# fail 0`.
  - Run `cd web && npm run build`. Expected: exit 0.
  - Optional, if you saved the list in Step 1: run `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep 'error TS' | sed -E 's/\([0-9]+,[0-9]+\)//' | sort > <scratchpad>/p3-tsc-after.txt && diff <scratchpad>/p3-tsc-before.txt <scratchpad>/p3-tsc-after.txt`. It passes when it shows the same errors as at HEAD, so `diff` prints nothing. A new TS2322 in `store.ts` (the `ref:` line) means Task 2's `@type` cast on `joinPresale` is missing.
  - Run `cd engine && npm test`. The engine suite reads web files; it must be unchanged.

- [ ] **Step 10: Commit.**

```bash
git add web/src/real/refs.js web/tests/refs.test.mjs web/src/main.tsx web/src/lib/store.ts web/src/components/presale/PresaleHeader.tsx && git commit -m "web: a presale link's ?ref= is kept until a join there and sent with it; the copied link carries your wallet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- web/src/real/refs.js web/tests/refs.test.mjs web/src/main.tsx web/src/lib/store.ts web/src/components/presale/PresaleHeader.tsx
```

---

### Task 10: Hand-off — the USER STEPs and the agent's checks after each

The agent writes each USER STEP to the user as written here, waits for the user to say it's done, then runs the checks under it. Run the steps in order. B and C go together: between them, a build signed with the other key fails to install with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.

**Before Task 10 starts: the user's choice for USER STEP B.** The controller asks the user the question below, writes the answer into this checklist line, and only then starts Task 10. Agents never fill in this line, and never pick a choice for the user.

> For USER STEP B: should the agent's own builds sign with the release key? (a) Yes: you add `MOONER_RELEASE_SIGN=1` to `~/.gradle/gradle.properties`, and the agent's `run-android.sh` builds sign through Gradle; the agent never opens that file or the keystore. (b) No: the agent's builds stay debug-signed, you build release-signed ones yourself, and the agent stops installing on the Seeker after USER STEP C.

- [x] USER STEP B choice: **(a)**. The user answered "Yes, builds use it" on 2026-10-01, recorded by the controller.

**USER STEP A — create the release (upload) key.** On the Mac, outside the repo:

```bash
mkdir -p ~/mooner-keys && chmod 700 ~/mooner-keys
/opt/homebrew/opt/openjdk@17/bin/keytool -genkeypair -v -storetype PKCS12 -keystore ~/mooner-keys/mooner-upload.keystore -alias mooner-upload -keyalg RSA -keysize 2048 -validity 10000
```

- keytool asks for one password, which PKCS12 uses for both the store and the key, and for a name and organisation.
- Back up the keystore file and its password outside this Mac.
- The Solana dApp Store needs every update signed with this same key, and it must not be a Google Play key.
- The agent doesn't see or store the password.

**USER STEP B — tell Gradle where the key is, and who builds with it.** The choice was made before Task 10 started (the checklist line above).
- Create `~/.gradle/gradle.properties` (it doesn't exist yet) with the lines below, then `chmod 600 ~/.gradle/gradle.properties`. Use the absolute path, as here.

```properties
MOONER_UPLOAD_STORE_FILE=/Users/yordanlasonov/mooner-keys/mooner-upload.keystore
MOONER_UPLOAD_STORE_PASSWORD=<the keystore password>
MOONER_UPLOAD_KEY_ALIAS=mooner-upload
MOONER_UPLOAD_KEY_PASSWORD=<the same password>
```

- **Choice (a), the agent's builds sign with the key:** also add the line `MOONER_RELEASE_SIGN=1` to that file. Every release build on this Mac then signs with the key, the agent's `sh scripts/run-android.sh` included. Gradle reads the key; the agent never opens the file or the keystore.
- **Choice (b), only your builds sign with the key:** leave `MOONER_RELEASE_SIGN` out of the file. The agent's builds stay debug-signed. After USER STEP C the phone holds a release-signed app, and a debug-signed one can't install over it (fact 7), so the agent installs nothing more on the Seeker. You build and install with:

```bash
cd mobile && sh scripts/check-bundle.sh && ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh
```

  (`expo run:android` passes no `-P` to Gradle, so the flag goes in the environment; fact 8a. For `./gradlew` directly, it's `-PMOONER_RELEASE_SIGN=1`.)
- Do USER STEP C right after this one.

**USER STEP C — remove the debug-signed app from the Seeker.**
- Run `adb uninstall family.mooner.app`. The agent never runs it.
- Uninstalling deletes the app's data: the Mooner sign-in, the MWA authorization, the session keys, the "mine" records and any kept refs. The user signs in again with Seed Vault afterwards.
- Do it with no open seat on this phone, or after getting that SOL back.
- A seat forgotten this way should still be recoverable, because the seat is on chain and tied to the wallet, not the phone:
  - the room finds the seat by wallet in the server's view (`bottomOf` → `seatOf` in `mobile/src/room/room.js`);
  - without the session key, "Get my SOL back" has the wallet sign the leave itself (`leaveEr` in `engine/src/flows.js`, lines 455–468 at `6b9bbfe`);
  - changing a commit has the wallet sign a `rotate_key` for a new session key (`usableKey`, lines 401–424).
  - This path has not been run on the Seeker. The 2026-10-01 spike only had Seed Vault sign a `rotate_key` ER tx (`erCheck` in `mobile/src/checks.js`), signed and never sent.
- Why not keep the data: APK Signature Scheme v3 key rotation is the one way to change the key and keep it. `apksigner rotate` makes a lineage from the old key to the new one, and `apksigner sign --lineage` signs updates with it, so Android accepts them over the old app. This plan doesn't use it:
  - the lineage would start at Expo's public debug key (fact 5), and with v1 or v2 signing on, `apksigner sign --help` says the oldest signer in the lineage signs those schemes, so every APK would still carry the public key;
  - it is a by-hand step after every build, outside Gradle and `expo run:android`;
  - the data at stake is one test phone's sign-in, MWA authorization, "mine" records and refs, which signing in again rebuilds, apart from the refs;
  - whether the Solana dApp Store accepts a lineage-signed APK was not checked.

Agent checks after C. Under choice (a), the agent builds and installs:

```bash
cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh
/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0/apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk | sed -n 's/.*SHA-256 digest: //p' | tr a-f A-F | sed 's/../&:/g; s/:$//'
(cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew -q :app:signingReport | grep -A6 '^Variant: release$')
```

Under choice (b), the user runs USER STEP B's build-and-install command, and the agent runs only the `apksigner` line, on the APK the user's build left. It runs no Gradle with the flag.

- Expected:
  - The install succeeds.
  - The fingerprint line is 32 colon-separated pairs and is not `FA:C6:17:…:3B:9C`.
  - Under (a), `signingReport` shows `Config: release`, `Store: /Users/yordanlasonov/mooner-keys/mooner-upload.keystore`, `Alias: mooner-upload`, and the same SHA-256.
- The agent gives the user that fingerprint for USER STEP D. The user may compare it with `keytool -list -v -keystore ~/mooner-keys/mooner-upload.keystore -alias mooner-upload`, which asks for the password.
- The app opens to sign-in.
- From here on, under choice (b), the agent installs nothing on the Seeker; any later step that needs a new build on the phone asks the user to run USER STEP B's command. The `adb` checks below don't install anything, so the agent still runs them.

**USER STEP D — the Railway variable.** Use the fingerprint from C:

```bash
printf %s "<FINGERPRINT FROM C>" | railway variable set MOONER_ANDROID_CERTS --stdin --skip-deploys --project 14215b7b-adff-430c-81f8-71e01298c7c3 --environment production --service app
```

`--skip-deploys` keeps it from going live until USER STEP E.

**USER STEP E — deploy the app service.**
- Run `sh deploy/railway.sh app`, with Tasks 1–9 committed and Task 11's tests green.
- Before the hand-off, read `deploy/railway.sh`'s header to see what it ships:
  - **Working tree:** it ships `engine/src`, `engine/server` and a fresh `web/dist` from the working tree, uncommitted changes included. So deploy from a tree whose contents should go live.
  - **HEAD (`git archive`):** a change in progress makes it ship committed code only. Then Tasks 1–9 must be committed, and nothing uncommitted ships.

Agent checks after E:

```bash
curl -sS -D - -o /dev/null https://app.mooner.family/.well-known/assetlinks.json
curl -sS https://app.mooner.family/.well-known/assetlinks.json
curl -sS 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.mooner.family&relation=delegate_permission/common.handle_all_urls'
curl -sS -o /dev/null -w '%{http_code}\n' https://app.mooner.family/api/health
```

- Expected:
  - `HTTP/2 200` with `content-type: application/json`, and no redirect.
  - The body: one statement for `family.mooner.app` with exactly the fingerprint from C.
  - Google's list shows that statement. It may lag the deploy; re-run it rather than guess.
  - `/api/health` returns 200.
- If the content type comes back different (for example Railway's edge adds a charset), record it as an open fact; Android's docs ask for `application/json`.

Then on the phone:

```bash
adb shell pm verify-app-links --re-verify family.mooner.app
adb shell pm get-app-links family.mooner.app
```

- Repeat `get-app-links` until `app.mooner.family` shows `verified`. If it settles on another state, record it and stop.
- Then check that the user selection from Task 7 is off (`pm get-app-links --user 0 family.mooner.app`) and open the https link:

```bash
adb shell "am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'https://app.mooner.family/presale/11111111111111111111111111111111'"
adb exec-out screencap -p > <scratchpad>/p3-https-verified.png
```

Expected: Mooner opens on the room's "This presale isn't here" screen, with no browser and no chooser.

**USER STEP F — a mainnet join from a shared link (real SOL, Seed Vault).**
- This needs an open presale, and a wallet for the ref that is not the Seeker's wallet (for example the user's web wallet), because self-referral is ignored.
- The agent opens the link on the phone:

```bash
adb shell "am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'https://app.mooner.family/presale/<OPEN PRESALE KEY>?ref=<THE OTHER WALLET>'"
```

- The user joins in the app with Seed Vault. The minimum seat is 0.1 SOL, and the user can get it back later.
- The agent screenshots the seat after the join.
- To see the recorded row, the user runs `railway ssh --project 14215b7b-adff-430c-81f8-71e01298c7c3 --environment production --service app`, then inside it:

```bash
node --disable-warning=ExperimentalWarning -e 'const { DatabaseSync } = require("node:sqlite"); console.log(new DatabaseSync("/data/server.db", { readOnly: true }).prepare("SELECT presale, user, referrer, sig, at, confirmed FROM referrals").all())'
```

- Expected: one row with that presale, the Seeker's wallet as `user`, the other wallet as `referrer`, and the join's signature. `confirmed` is 1 when the app showed the seat at once; 0 if the join came back as "sent, not confirmed yet" (a 202).
- `readOnly` opens the database without write access. That was checked on Node 22.22.3 here; the container's exact 22.x was not checked.

**USER STEP G — the share sheet on a real presale** (only if Task 6 Step 9 found none). When a presale is open, the agent opens its room through the scheme link, taps Share as in Task 6 Step 9, screenshots the sheet, and presses Back without choosing a target.

---

### Task 11: Final pass and the spec note

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md` (two notes)

- [ ] **Step 1: Run everything.**

```bash
cd engine && npm test
cd mobile && npm test && sh scripts/check-bundle.sh
cd web && node --test tests/refs.test.mjs && npm run build
```

Expected:
- engine is the Task 1 baseline plus 16 (Task 1: 6, Task 2: 2, Task 3: 5, Task 4: 3);
- mobile is its baseline plus 15 (Task 5: 6, Task 6: 6, Task 8: 3);
- `web3.js copies: 1; files from engine/node_modules: 0`, then `app/ entries from this checkout:` above 0;
- web refs `# pass 4`, and the build exits 0;
- no failures that weren't failing at the baselines.
- The web type-check is optional, as in Task 9: it passes when it shows the same errors as at HEAD before Task 9.

- [ ] **Step 2: Review.** Dispatch `superpowers:code-reviewer` over the piece 3 commits, against this plan and the spec sections it names. Fix what it finds, as separate commits by name.

- [ ] **Step 3: The spec notes.** In the spec, under **Referral**, after the line `  - The server records it only when the join confirms.`, add:

```markdown
  - Piece 3 (share links): the phone and the web keep the newest `?ref=` per presale (at most 10, never the joiner's own wallet) until a join there lands, and send it beside the tx. The server keeps it with every join it sends, not only confirmed ones: `referrals(presale, user, referrer, sig, at, confirmed)` (`engine/server/referrals.js`), `confirmed = 1` on a 200 and `confirmed = 0` on a 202 from that send (sent, not confirmed in time); a repeat of a tx that already went out writes nothing, since its first send did. A slow RPC turns a join that lands into a 202, and its referrer would otherwise be lost. One row per seat: a confirmed row is never replaced, and an unconfirmed one gives way to the seat's next join. No points yet: piece 6 reads the table for Raider and counts a row only if its seat exists when the presale launches. It needs that check anyway, since a seat can take its SOL back before launch, and the same check settles an unconfirmed row whose join never landed.
```

  Under **App Links**, after the `assetlinks.json` line, add:

```markdown
- The server serves it only while the Railway variable `MOONER_ANDROID_CERTS` holds the release key's SHA-256 (`engine/server/applinks.js`), and never lists Expo's public debug key. The release key is the user's: `mobile/plugins/withReleaseSigning.js` signs a release build with it, named in `~/.gradle/gradle.properties`, only when the Gradle property `MOONER_RELEASE_SIGN` is 1. Without the flag, release builds use Expo's public debug key.
```

- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md && git commit -m "spec: what piece 3 does with ref, and where the App Links key comes from

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/superpowers/specs/2026-09-29-mooner-seeker-app-design.md
```

---

## Open questions and facts not verified

- **Content type through Railway:** the server sends exactly `application/json`. Whether Railway's edge keeps that header is checked only after USER STEP E.
- **Verification on the Seeker:**
  - Which verifier the Seeker uses, Google's or the platform's own, is not known.
  - How fast Google's statement list picks up a new file is not known.
  - Task 10 re-checks rather than waits a fixed amount.
- **The manual approval from shell:** whether `adb shell pm set-app-links-user-selection` is allowed for shell on the Seeker is not tested; the command is listed in its `pm help`. Task 7 Step 7 says what to do if it's refused.
- **Routing on the device:** that an https link with `?ref=` routes into the room with `params.ref` set is read from the expo-router and Expo sources (fact 12). The device confirms only the room; the ref itself shows only through USER STEP F's row.
- **Referral rules for piece 6:**
  - A join whose own send got a 202 (sent, not confirmed in time) is recorded with `confirmed = 0`; a repeat of a tx that already went out writes nothing. The row says nothing about whether that join landed later. Piece 6 counts a row only if its seat exists when the presale launches, which settles it.
  - An unconfirmed row gives way to the seat's next join that carries a ref. A confirmed row stays, even after a get-back and a later rejoin through another link.
  - Piece 6 decides whether those cases count, and handles sybil checks. Nothing in piece 3 awards anything.
- **Other share entry points:** the spec's coin-screen share (Screens, line 191) is not in piece 3; it can reuse `shareOf` and `shareLink`. Piece 4's new presale, which opens with the share sheet up, shares through `shareOf` (its `src/create/share.js`).
- **The agent's builds after USER STEP B:** the user's choice, asked before Task 10 and recorded in its checklist. Under (a) the agent's release builds sign with the user's key through Gradle; under (b) they stay debug-signed and the agent stops installing on the Seeker after USER STEP C. Either way the agent never reads `~/.gradle/gradle.properties` or the keystore.
- **The signing flag in Gradle:** the plugin's `findProperty('MOONER_RELEASE_SIGN') == '1'` and the parenthesised `signingConfig(…)` line weren't run through Gradle while writing this plan; an earlier switch was (fact 8). Task 8 Step 8 checks all five cases before anything is installed.
- **The Metro cache guard:** at `e81bb45`, the reviewer checked read-only that `getDefaultConfig` gives one store, of the class named `FileStore` (Expo's subclass of Metro's), and that Metro's constructor reads only `options.root`. The new block, which builds the store from the config's class, was not run while writing this plan. A real bundle with it runs first in Task 0 Step 6, in the repo's own `mobile/`.
- **Concurrent saves on the phone:** two quick ref changes on the phone save in order in memory. Their secure-store writes are not awaited one after the other, so the last two writes could land in either order. A wrong order costs at most one stale ref.
- **Web private mode:** in private browsing, or when storage is blocked, the web keeps no ref. The join then just sends none.
- **The `readOnly` option** in the USER STEP F command was checked on local Node 22.22.3, not inside the container.
- **The Vercel MCP server** (`plugin:vercel:vercel`) needs authentication through `/mcp`. Nothing in this plan uses it.

## Self-review (done while writing)

- **Spec coverage:**
  - Piece 3 row: the https link opens the app (Tasks 7 and 10), and the room has a share sheet (Task 6). The server's `assetlinks.json` is Task 4.
  - Referral: `?ref=<wallet>` (Tasks 1, 6, 9); kept until the join (Tasks 5 and 9); sent with `POST /api/cosign` (Task 2); recorded on 200 as confirmed and on a 202 from that send as unconfirmed (Task 3), a change from the spec's "only when the join confirms" that Task 11 writes into the spec.
  - Security: the gate signs the same tx (Task 2, golden digests); self-referral ignored (Tasks 1 and 3); "only joins that confirm, in presales that launch" left to piece 6, which counts a row only if its seat exists at launch.
  - Every install checks the bundle first and every checkout has its own Metro cache (Task 0).
  - Testing: referral attribution is tested in `server.test.js`; web `vite build` runs in Task 9; device `adb` screenshots run in Tasks 6, 7 and 10; the user does the Seed Vault approvals in USER STEP F.
- **Placeholders:** every code step holds the full code. The only angle-bracket values are things the plan can't know in advance: screenshot paths in the scratchpad, tap coordinates from the dump, the user's fingerprint, the open presale's key, and the other wallet.
- **Names:**
  - `noteRef`, `refFor`, `withRef`, `withoutRef`, `cleanRef`, `shareLink` and `MAX_REFS` are the same in every task.
  - `Referrals.add(presale, user, referrer, sig, at, confirmed)` and `Referrals.referralOf`, `refOf`, `makeAppLinkRoutes`, `assetLinks`, `ANDROID_PACKAGE`, `androidCertsFrom`, `cfg.androidCerts` and `cfg.androidCertsBad` match between code and tests.
  - The phone store exposes `noteRef`; `shareOf({ view, launched, wallet, N, base, now })` returns `{ title, message }` or null. The web module exports `noteRef`, `refFor`, `dropRef` and `shareLink`. Note that the web's `refFor(key, wallet)` has a different signature from the engine's `refFor(refs, key, wallet)`; it is imported in `store.ts` from `@/real/refs.js` only.
  - `MOONER_RELEASE_SIGN` and `MOONER_UPLOAD_*` are spelled the same in the plugin, its test, `run-android.sh`, Task 8 Step 8 and USER STEP B.
  - Piece 4's `src/create/share.js` calls `shareOf` with a view made from the open, and `shareOf` builds the link with `shareLink(base, key, wallet)`. Both names and signatures must stay as they are.
- **Not re-run at `6b9bbfe`.** The second-round changes (the `joinPresale` blocks split so they keep `waitSent` and `waitMs`, the new server test for a repeat's early 202, the `metro.config.js` block that takes the store's class from the config) were not applied to a clean copy or run: the counts below are from `c38e1c4`, before them. They are a record, not a gate. Each task's own steps give what to expect.
- **Self-check (2026-10-01, at HEAD `c38e1c4`), in a clean `git archive` of `c38e1c4` in the scratchpad.** It was run first at `8edc177` and `238150c`, with the same results except the engine count (360 and 364 before there). At `c38e1c4` every anchor still matched, but five cosign tests in `server.test.js` failed until Task 3's referral block read `req.body.ref`: since `0ebf9be` the route takes `req`, and `body` was no longer in scope.
  - Every block of this plan was applied by script, in task order: 68 edits (replacements, insertions, new files, appends, and Tasks 7 and 8's `node -e` scripts on `app.json`). Each anchor matched exactly once.
  - `cd engine && npm test`: `# pass 384`, `# fail 0` (369 before, plus 15). `cd mobile && npm test`: `# pass 187`, `# fail 0` (172 before, plus 15). `cd web && node --test tests/refs.test.mjs`: `# pass 4`, `# fail 0`.
  - One file at a time: `refs.test.js` 6, `applinks.test.js` 3, `referrals.test.js` 1, `share.test.mjs` 6, `releasesigning.test.mjs` 3, all passing.
  - The failing-first steps fail as written: Task 2 the two new tests; Task 5 five `noteRef is not a function` and the fourth on its `assert.equal`; Tasks 4, 6 and 8 the missing module.
  - `metro.config.js` loads with `1 FileStore`. Babel parses `TopBar.js`, `icons.js`, `app/presale/[key].js`, `store.js`, `withReleaseSigning.js` and `metro.config.js`. TypeScript parses `main.tsx`, `store.ts` and `PresaleHeader.tsx` with no syntax errors. `sh -n` passes on both scripts.
  - Task 7's print and Task 8's print are exactly the expected ones above.
  - Not run in the copy: Metro bundles, `expo export`, `vite build` and the device steps. The `node_modules` were symlinks from the repo, used only by `node --test`, and removed afterwards.

