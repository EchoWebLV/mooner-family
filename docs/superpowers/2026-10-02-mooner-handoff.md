# Mooner — Handoff

**Date:** 2026-10-02 · **Branch:** `feat/mooner-wireframe` · **HEAD:** `57472fc`
**Tests at HEAD:** engine 449/449 pass · mobile 258/258 pass
**Blueprint (architecture + wireframes):** https://claude.ai/artifact/Vk4SU7xkuDUt8d27m3WV3V

---

## 1. What Mooner is

- A Solana presale launchpad. A coin's presale fills to 0.5 SOL, then launches on Meteora DBC.
- People join with 0.1–0.5 SOL seats. A full presale launches in one transaction.
- Tokens arrive by themselves (the keeper sends claims). A failed or expired presale refunds.
- Joining, leaving and changing a seat happen inside MagicBlock's Ephemeral Rollup (no fee).
- Three surfaces: web app (app.mooner.family), Android phone app (Solana Mobile hackathon), landing page (mooner.family).

## 2. Where things are

| Folder | What it is |
|---|---|
| `programs/presale/` | Rust presale program (native `solana_program`, 17 instructions) |
| `engine/src/` | Shared JS: transaction builders, flows, rules. Used by server, web and phone |
| `engine/server/` | The Railway server: API, websocket hub, feed, keeper, launch bot, SQLite store |
| `web/` | Vite + React + zustand web app |
| `mobile/` | Expo SDK 55 Android app (Seeker) |
| `site/` | Landing page + waitlist server (not committed, by design) |
| `deploy/` | Railway deploy script and Dockerfiles |
| `docs/superpowers/specs/` | Designs. Main one: `2026-09-29-mooner-seeker-app-design.md` |
| `docs/superpowers/plans/` | One implementation plan per piece |

## 3. State of each piece (phone app spec)

| # | Piece | State | What's left |
|---|---|---|---|
| 1 | Core app (sign-in, Live, room, join, chat, get SOL back, Launched, Me) | Built | — |
| 2 | Trade + coin page | Built | — |
| 3 | Share links (`?ref=`, App Links) | Built, checks left | Railway signing-fingerprint step (you), then phone link checks (Task 11) |
| 4 | Create (picture, details, commit, open) | 7 of 10 tasks | Task 7 device check, then Tasks 8–10 (8 and 9 are your steps) |
| 5 | Push alerts, Follow, Auto-join | 3 of 16 tasks | Task 3 small fixes, then Tasks 4–16. Nothing wired into the server yet |
| 6 | XP + Seeker Genesis | Plan written (18 tasks), not committed | Your answers to the plan's 16 open questions |
| 7 | SKR join | Not started | Plan |
| 8 | Hackathon submission kit (APK, video, deck) | Not started | Plan |

**Hackathon deadline:** submissions close 2026-10-09 09:59 EEST.

## 4. Waiting on you

1. **Release signing key.** Finish `keytool`, then create `~/.gradle/gradle.properties`:
   ```properties
   MOONER_RELEASE_SIGN=1
   MOONER_UPLOAD_STORE_FILE=/Users/yordanlasonov/mooner-keys/mooner-upload.keystore
   MOONER_UPLOAD_STORE_PASSWORD=<pw>
   MOONER_UPLOAD_KEY_ALIAS=mooner-upload
   MOONER_UPLOAD_KEY_PASSWORD=<pw>
   ```
   Then `chmod 600 ~/.gradle/gradle.properties` and back up the keystore. Checked 2026-10-02: the file is missing and `~/mooner-keys` is empty.
2. **The phone.** Plug in the Seeker and allow USB debugging (no device seen 2026-10-02). Then run `adb uninstall family.mooner.app` once, so the release-signed build can install.
3. **Piece 3 Task 10.** Set `MOONER_ANDROID_CERTS` on Railway (fingerprint from `signingReport`), then deploy.
4. **Piece 6 answers.** The XP plan's "Open questions" section (16 items: Genesis trait art, point values, streak XP, level names, and more).
5. **Coming up, piece 5 Task 15:** an Expo account and project; Firebase's `google-services.json`; Firebase's sending key (to Expo only); Expo's enhanced security (optional, recommended); a server deploy.
6. **Production deploy.** The 2026-10-01 web deploy was built from a working tree that had unreviewed create code. `deploy/railway.sh` now ships HEAD only. Whether a redeploy happened since is not known — redeploy with `sh deploy/railway.sh app`.

## 5. Next for the agent (in order)

1. Piece 5 Task 3 small fixes (tests: token sign check, per-IP follow limit, re-follow order, several followers, a throwing listener).
2. Piece 5 Tasks 4–16: Expo push sending, the notifier, the phone's Alerts tab, Follow, Auto-join, Following/Followers, web Follow. Task 15 is yours (see section 4, item 5).
3. Piece 6, once answered: review the plan, commit it, build it.
4. Piece 4 Task 7 device steps 4–11 (needs the phone), then Tasks 8–10.
5. Piece 3 Task 11 (after your Task 10 steps).
6. Plans for pieces 7 and 8.
7. Server fixes from section 6.

## 6. Known issues (from review notes)

**Will be seen by users**
- The web calls `api.mainnet-beta` from the browser and gets 403. Needs a `/api/rpc` proxy on the server.
- Holder counts may not show: public RPCs refuse `getTokenLargestAccounts`. Check which `MOONER_RPC` production uses.
- Web's `claimed` field is always false.
- Unopened mints never expire, and the web can't reopen one (`MAX_UNOPENED`).

**Phone release build**
- The spike's debug screen still ships in the release APK.
- White splash screen; `edgeToEdgeEnabled` to remove; storage permissions to trim.

**Server**
- `store.mintKey` has no `presale IS NULL` filter.
- The feed watches only the 200 newest launches.
- The feed's `migrated` event stops at the first listener that throws.
- The `candles` table is never pruned.
- `follows.js` and `alertrules.js` are built and tested but not wired into `main.js` yet (piece 5 does that).
- The web still uses the old titles (KOL, Diamond Hands, Shiller, Raider). Piece 6 moves it to Dev, KOL, Raider, Diamond Hands.

## 7. Live infrastructure

**Railway project "mooner"**

| Service | Domain | Serves |
|---|---|---|
| app | app.mooner.family | API, websocket `/api/ws`, keeper, launch bot, `web/dist`, `/sim` |
| web | mooner.family (+www) | Landing page, `POST /api/waitlist` |

**Mainnet (public addresses)**

| What | Address |
|---|---|
| Presale program | `6iCH5T57amKEmbxU7sNrfnYC5BYyjGWTW8mayEAz7Lpa` |
| Config PDA | `J2fQhCR9efLmJBBdUsqCeEEvUsD4ffauVgYgEpgyrdvv` |
| Gate | `7NbrfisNvkBWGuf2HzwYWEWPUrUnpHUQ4cwCF3pFiAuT` |
| Launch bot | `BxFMSoCC2yNpgQPfYhfpCdf6hgXmeEaDKas5NZMqZ6BE` |
| DBC config (3 s snipe tax) | `j7j5CfUSa9DGZCzKKxKBbCYvySiM14Hbr8V6uKbA6Be` |
| Launch lookup table | `Fz22iSECPE3EqPhLTgZKtPDUVNLDjCnXZz1BjqpzrCrC` |

- Keys and the deployment record live only in `engine/.mainnet/` (gitignored). Never commit or print them.
- Program upgraded 2026-09-30 (presale target 0.5 SOL, seats 0.1–0.5).

## 8. How to run

```bash
cd engine && npm test
```
```bash
cd mobile && npm test
```
```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/*.test.mjs
```
```bash
cd mobile && sh scripts/check-bundle.sh && sh scripts/run-android.sh
```
```bash
sh deploy/railway.sh app
```
- Add `--dry` to the deploy to list files without uploading.
- `site` instead of `app` deploys the landing page.
- Android tools need `JAVA_HOME=/opt/homebrew/opt/openjdk@17` and `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.

## 9. How the work is done

- Each piece: spec → plan → one implementer per task → spec review → code review → fixes → next task.
- One commit per task, files staged by name. Never `git add -A`, stash, reset or checkout.
- Not committed on purpose: `site/`, `launch-test/`, `launch.py`, `.claude/`.
- You run: production deploys, Railway variables, mainnet spends, program upgrades, `expo prebuild`, `adb uninstall`.
- The agent never signs or approves in Seed Vault, and never presses Join, Get back, Buy or Sell.
- Live data goes over websockets. No polling. Real data only.
- Titles: Dev, KOL, Raider, Diamond Hands. No game words.
- Logo is final: `assets/mooner.svg`.
- Secrets come from `vault` (macOS Keychain), not `.env` files.
