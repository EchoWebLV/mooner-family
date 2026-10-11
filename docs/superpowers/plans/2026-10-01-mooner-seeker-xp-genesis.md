# Mooner on Seeker, piece 6: real XP and the Genesis perk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** The four titles (Dev, KOL, Raider, Diamond Hands), the streak and the leaderboard run on real data: the server keeps an XP ledger fed by chain events it already sees (launches, migrations, confirmed referrals, joins and opens), answers `GET /api/xp/:wallet`, pushes changes on the `profiles` topic, and grants a one-time Genesis perk (the Genesis mark and an XP bonus; the Seeker-only Mooner trait waits on an open question at the end) to a wallet holding a Seeker Genesis Token. The web leaderboard and profile show this data; the phone's Me tab and leaderboard follow in the [phone] half.

**Architecture:**
- **Shared rules, pure, in `engine/src/xp.js`** (no `node:` imports; Vite and Hermes load it): the titles `dev`, `kol`, `raider`, `diamond`; the level curve `LEVEL_XP` (moved here unchanged from `web/src/lib/constants.ts`, which re-exports it, so `xpForLevel` keeps its numbers); the one points table `POINTS`; `levelOf(xp)`; the UTC-day streak `streakOf(days, today)`.
- **The ledger, `engine/server/xp.js`** (`XpLedger`), in the server's SQLite file beside `referrals`: `xp(wallet, title, points, reason, ref, at)` with `UNIQUE (wallet, reason, ref)`, so an event counted once is never counted again (a restart, a catch-up, a second listener); `activity(wallet, day)` for the streak; `genesis(mint PRIMARY KEY, wallet, at)` so one Seeker's token grants the perk once.
- **The rules, `engine/server/xprules.js`** (`XpRules`), fed by events the server already has:
  - the keeper's launch (`onLaunch(presale)`): reads the presale's seats at once (claims close seats after the 3 s snipe tax plus 1 s, so it can't wait) and awards Dev (the creator), KOL (each other seat with SOL in) and Raider (each confirmed referral whose joiner is in a seat with SOL in); it keeps each seat's token share in `xp_seats` for Diamond Hands;
  - the feed's `migrated` event, and a catch-up at start for coins that migrated while the server was down: Dev and KOL again, and Diamond Hands for each seat whose wallet still holds at least its presale share;
  - each confirmed join or open from `POST /api/cosign` (api.js): one `activity` day.
- **The Genesis check, `engine/server/genesis.js`**: the wallet's Token-2022 accounts (`getTokenAccountsByOwner`), zero balances skipped, each mint read (`getMultipleAccountsInfo`), owned by Token-2022, with a MetadataPointer whose metadata address and a TokenGroupMember whose group are both `GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te` (Solana Mobile's docs, "Verifying Seeker Genesis Token ownership"). Parsed from raw bytes (TLV), tested against mainnet bytes saved in this plan.
- **Routes, `engine/server/xproutes.js`**: `GET /api/xp/:wallet` and `POST /api/genesis` (a Mooner sign-in, piece 5's `makeSessions`).
- **Live:** the `profiles` topic keeps its picture snapshot and upserts as they are, and adds one message type, `xp`: after the snapshot, the top 500 rows; after each change, the changed rows. Web and phone already ignore types they don't know.
- **Web:** Dev replaces Shiller in `Title`; the per-title demo stats become real counts from the XP rows; the store merges `xp` rows into users, so the leaderboard and profile show real XP, levels, the streak and the Seeker Genesis mark.

**Order and the other pieces:** HEAD at writing is `544de6c` (piece 4's code tasks in; piece 5 Tasks 1-2 in, its Task 3 onward not yet). Tasks 1-5 touch only new files plus `engine/server/referrals.js`, `engine/server/api.js` and `engine/test/server.test.js`, which piece 5 doesn't edit in the lines these tasks use, so they can be built now. Tasks 6-10 use or edit what piece 5 adds; each one's Step 0 stops until that piece 5 task is committed (see the table under "Two tracks").

**Tech Stack:** Node 22 `node:sqlite` and `node:test` (engine), `@solana/web3.js` 1.x reads (no sends), React + Vite + zustand (web), Expo / React Native (phone half).

---

## Two tracks

Each task is tagged **[server/web]**, **[phone]** or **[web]**. The [server/web] tasks (1-11) are below. Tasks 12-18 are under "Phone tasks", with their own waits table: 12-16 and 18 are [phone], and 17 is [web] (the site takes the streak from the shared rules that Task 12 moves).

| Task | Track | Edits files piece 5 also edits? | Waits for (Step 0 checks it is in HEAD) |
|---|---|---|---|
| 1 Shared XP rules | server/web | no (new `engine/src/xp.js`) | nothing past `87d9f08` |
| 2 Ledger | server/web | no (new `engine/server/xp.js`) | Task 1 |
| 3 Rules (launch, migration, catch-up) | server/web | no (new `engine/server/xprules.js`; `referrals.js`) | Task 2 |
| 4 Streak days from the co-sign | server/web | `engine/test/server.test.js` only: piece 5 Task 7 replaces one `loadConfig` line there, which this task doesn't touch, so either may land first | Task 3 |
| 5 Genesis check | server/web | no (new `engine/server/genesis.js`) | Task 2 |
| 6 XP and Genesis routes | server/web | no (new `engine/server/xproutes.js`), but it imports `makeSessions` | Task 5, **piece 5 Task 3** (`makeSessions` in `social.js`) |
| 7 `xp` rows on `profiles` | server/web | `engine/server/feed.js`, `engine/test/live.test.js` | Task 2, **piece 5 Task 5** |
| 8 The server runs it; the API client | server/web | `engine/server/main.js`, `engine/src/apiclient.js`, `engine/test/apiclient.test.js` | Tasks 3, 4, 6, 7, **piece 5 Task 7** |
| 9 Web titles and real stats | server/web | `web/src/lib/store.ts` | Task 1, Task 8, **piece 5 Task 14** |
| 10 The site's players are the XP rows; streak and Genesis on the profile | server/web | `web/src/lib/store.ts` (piece 5 Task 14's lines stay; this task's anchors are other lines) | Task 9 (and through it, piece 5 Task 14) |
| 11 USER STEP: deploy; then the live checks (curl, the socket, the Browser pane) | server/web | – | Tasks 1-10 |

How each wait is checked (every gate is a commit subject, so it holds after a rebase):

```bash
# piece 5 Task 3 (follows, makeSessions)
git log --format=%s | grep -c '^engine: follows (POST /api/follow'
# piece 5 Task 5 (the feed's listeners, follows:<wallet>)
git log --format=%s | grep -c '^engine: the feed hands its listeners'
# piece 5 Task 7 (the server runs the notifier)
git log --format=%s | grep -c '^engine: the server runs the notifier'
# piece 5 Task 14 (Follow on the web)
git log --format=%s | grep -c '^web: Follow and Unfollow on a'
```

Each prints `1` when that task is in. `0` means it isn't: stop at Step 0 and report; don't start the task. Ordering the waits this way means a clash with piece 5 stops a task before it edits anything, never halfway.

## File map (the whole piece)

- **engine (Tasks 1-8)**
  - Create `src/xp.js`: titles, `LEVEL_XP`, `POINTS`, `levelOf`, `utcDay`, `streakOf`. Shared by server, web and phone.
  - Create `server/xp.js`: `XpLedger` (tables `xp`, `activity`, `genesis`, `xp_seats`).
  - Create `server/xprules.js`: `XpRules` (launch, migration, catch-up).
  - Create `server/genesis.js`: Token-2022 TLV reads and `findGenesis`.
  - Create `server/xproutes.js`: `GET /api/xp/:wallet`, `POST /api/genesis`.
  - Create `test/fixtures/genesis-member-mint.json`, `test/fixtures/genesis-group-mint.json`, `test/fixtures/genesis-holder-account.json` (mainnet bytes, below).
  - Create the tests `test/xp.test.js`, `test/xpledger.test.js`, `test/xprules.test.js`, `test/genesis.test.js`, `test/xproutes.test.js`.
  - Modify `server/referrals.js` (`confirmedIn`, and its header sentence on points), `server/api.js` (a streak day on each confirmed join or open), `server/feed.js` (`xp` rows on `profiles`), `server/main.js` (wiring), `src/apiclient.js` (`xp`, `genesis`).
  - Modify the tests `test/referrals.test.js`, `test/server.test.js`, `test/live.test.js`, `test/apiclient.test.js`.
- **web (Tasks 9-10)**
  - Create `src/lib/xp.ts` (the XP row's shape; merge; titles, counts and XP from a row; the streak as of now).
  - Modify `src/lib/constants.ts` (`LEVEL_XP` re-exported from `engine/src/xp.js`), `src/lib/types.ts` (`Title`, `TitleStats`, `UserXp`, `User.xp`), `src/lib/levels.ts`, `src/lib/leaderboard.ts`, `src/lib/profile.ts`, `src/lib/pfp/traits.ts` (Shiller's traits go to Dev), `src/lib/sim/personas.ts` (`TITLE_LINES` goes), `src/lib/store.ts` (`xp` rows), `src/components/badges/TitleEmblem.tsx` (Dev's rocket), `src/components/badges/BadgesScreen.tsx` (scoring is live), `src/components/leaderboard/LeaderboardScreen.tsx` (the lede), `src/components/leaderboard/LeaderboardTable.tsx` and `src/components/presale/PlayerCard.tsx` (`presalesLaunched`), `src/components/profile/ProfileScreen.tsx` (`presalesLaunched`, the streak, Seeker Genesis).
  - Create the tests `tests/titles.test.mjs` (Task 9) and `tests/xp.test.mjs` (Task 10).
- **mobile ([phone] Tasks 12-18):** the store's `xp` rows and the Genesis check (`src/store.js`), the rows as the phone shows them (new `src/xp/rows.js`), a leaderboard screen (new `app/leaderboard.js`) with piece 5's `src/alerts/FollowButton.js` on each row, Me's XP card (new `src/xp/MyXp.js`, shown in `app/(tabs)/me.js`), and their tests. The streak moves into `engine/src/xp.js` (Task 12), and `web/src/lib/xp.ts` re-exports it (Task 17). "Phone tasks" lists every file.

## Ground rules

Piece 5's "Ground rules for every task" apply here word for word (branch, commits staged by name with `-- <files>`, secrets, dirty files, no servers, no deploys, Seed Vault, the user's phone, copy, real data only, pushed live data, no time estimates, test commands, edit blocks). On top of them:

- **Test counts.** Each task's Step 0 takes the counts it compares against:
  - `BEFORE_E`: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'` (430 at `adba6c1`; take the real one);
  - `BEFORE_W`: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/*.test.mjs 2>&1 | grep -E '^# (tests|fail)'`, run from the repo root (51 at `27ea46f`);
  - `TSC_W`: `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep -c "error TS"` (55 at `27ea46f`). It must not go up.
- **Read-only chain.** Nothing in this plan sends a transaction. The Genesis fixtures below were read with `getAccountInfo` on `https://api.mainnet-beta.solana.com`; an implementer who wants fresh bytes may read them again the same way, and nothing else.
- **Points are product numbers.** They live in `POINTS` (`engine/src/xp.js`) and nowhere else; the tests import them rather than repeat them.

## Server data shapes

Both clients (web now, phone in the [phone] half) read exactly these.

- **An XP row** (`XpLedger.row`), the same everywhere it appears:

```json
{
  "wallet": "<base58>",
  "total": 450,
  "titles": { "dev": 100, "kol": 75, "raider": 25, "diamond": 0 },
  "counts": { "devLaunch": 1, "devMigrate": 0, "kolLaunch": 3, "kolMigrate": 0, "raiderJoin": 1, "diamondMigrate": 0 },
  "streak": { "days": 2, "best": 5, "last": "2026-10-01" },
  "genesis": { "mint": "<base58>", "at": 1790000000000 }
}
```

  - `total` is every point the wallet has, the Genesis bonus included; `titles` are per title, without it.
  - Levels are not sent: a client computes them with `levelOf(xp)` from `engine/src/xp.js`, the curve every screen already uses.
  - `counts` are how many times each event counted (one key per `POINTS` entry except `genesis`).
  - `streak.days` is the run of UTC days with a confirmed join or open ending today or yesterday (0 once a whole UTC day passed with none); `best` the longest run; `last` the latest such day, or `null`.
  - `genesis` is `null` until the wallet's Genesis check passed.
- **`GET /api/xp/:wallet`** → an XP row. A wallet with nothing yet gets zeros, `streak: { days: 0, best: 0, last: null }`, `genesis: null`. 400 for a key that isn't a wallet.
- **`POST /api/genesis` `{ token }`** → `{ wallet, genesis: { mint, at }, fresh, xp }`, where `xp` is the wallet's XP row after the check.
  - `token` is a Mooner sign-in (`POST /api/login`); a bad one is 401 `sign in first` or `your sign-in ran out, sign in again` (piece 5's `makeSessions`).
  - `fresh: true` the first time; asking again answers the same `genesis` with `fresh: false` and reads nothing from the chain.
  - 404 `no Seeker Genesis Token in this wallet`.
  - 409 `this Seeker's Genesis Token was already used by <short wallet>` when every Genesis mint the wallet holds was claimed by another wallet. In the saved fixtures the holder's token account is frozen (its owner can't send it), but the mint has a PermanentDelegate extension, whose authority can still move it; the perk stays with the first wallet that claimed that mint.
  - 503 `couldn't read this wallet's tokens, try again` when the RPC fails.
  - Limits: 10 a minute per IP, 3 a minute per wallet.
- **The `profiles` topic** gains one message type. Pictures are unchanged.
  - On sub: `{ type: "snapshot", data: { <wallet>: <pfp> } }` as now, then `{ type: "xp", data: [<XP row>, …] }`, the top 500 by `total` (ties by wallet).
  - On each change: `{ type: "xp", data: [<XP row>, …] }` with the rows that changed. A client merges rows by `wallet`; a row never disappears.

---

### Task 1 [server/web]: Shared XP rules

The titles, the level curve, the points table and the streak, pure, so the server, the web and the phone use one copy. `LEVEL_XP` is the curve `web/src/lib/constants.ts` has at `87d9f08` (`[0, 100, 300, 800, 2000]`, read by `xpForLevel` in `web/src/lib/levels.ts`); Task 9 makes the web re-export it from here.

**Files:**
- Create: `engine/src/xp.js`
- Test: `engine/test/xp.test.js`

- [ ] **Step 0: Check the base, and take the count.**

Run: `git merge-base --is-ancestor 0a584e5 HEAD && git merge-base --is-ancestor 7f975f7 HEAD && echo base ok; ls engine/src/xp.js engine/test/xp.test.js 2>&1 | grep -c 'No such file'`
Expected: `base ok`, then `2`. If either file exists, another session started this task: stop and report.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# tests N` and `# fail 0`. Note N as BEFORE_E.

- [ ] **Step 1: Write the failing test.**

Create `engine/test/xp.test.js`:

```js
// XP (spec "XP ledger"): the shared rules (src/xp.js) and the server's ledger (server/xp.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, LEVEL_XP, POINTS, TITLES, levelOf, streakOf, utcDay } from "../src/xp.js";

test("xp rules: four titles, the web's curve, one points table", () => {
  assert.deepEqual(TITLES, ["dev", "kol", "raider", "diamond"]);
  assert.deepEqual(LEVEL_XP, [0, 100, 300, 800, 2000], "the curve web/src/lib/constants.ts had");
  for (const [reason, p] of Object.entries(POINTS)) {
    assert.ok(Number.isInteger(p.points) && p.points > 0, `${reason} is worth whole points`);
    assert.ok(p.title === null ? reason === "genesis" : TITLES.includes(p.title), `${reason} counts for a title`);
  }
  assert.deepEqual(Object.keys(POINTS), ["devLaunch", "devMigrate", "kolLaunch", "kolMigrate", "raiderJoin", "diamondMigrate", "genesis"]);
});

test("xp rules: levelOf follows the curve, 1 to 5", () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(99), 1);
  assert.equal(levelOf(100), 2);
  assert.equal(levelOf(299), 2);
  assert.equal(levelOf(300), 3);
  assert.equal(levelOf(800), 4);
  assert.equal(levelOf(1999), 4);
  assert.equal(levelOf(2000), 5);
  assert.equal(levelOf(1e9), 5);
});

test("xp rules: the streak counts UTC days in a row, up to today or yesterday", () => {
  const day = utcDay(Date.UTC(2026, 9, 1, 23, 59)); // 2026-10-01
  assert.equal(utcDay(Date.UTC(2026, 9, 2, 0, 0)), day + 1, "a new UTC day at midnight UTC");
  assert.equal(DAY_MS, 86_400_000);
  assert.deepEqual(streakOf([], day), { days: 0, best: 0, last: null });
  assert.deepEqual(streakOf([day], day), { days: 1, best: 1, last: "2026-10-01" });
  assert.deepEqual(streakOf([day - 2, day - 1, day, day], day), { days: 3, best: 3, last: "2026-10-01" }, "a repeat day counts once");
  assert.deepEqual(streakOf([day - 1, day - 2], day), { days: 2, best: 2, last: "2026-09-30" }, "nothing today yet: yesterday's run still stands");
  assert.deepEqual(streakOf([day - 3, day - 2], day), { days: 0, best: 2, last: "2026-09-29" }, "a whole day with none ends it");
  assert.deepEqual(streakOf([day - 9, day - 8, day - 7, day - 6, day - 1, day], day), { days: 2, best: 4, last: "2026-10-01" });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test test/xp.test.js 2>&1 | grep -E '^# (pass|fail)|Cannot find module'`
Expected: `Cannot find module` naming `src/xp.js`.

- [ ] **Step 3: Write the rules.**

Create `engine/src/xp.js`:

```js
// XP for the four titles (spec "XP ledger"): the titles, the level curve, what each event
// is worth, and the streak. Shared by the server (server/xp.js), the web app and the
// phone, so no node: imports.

/** The four titles, in the order screens list them. */
export const TITLES = ["dev", "kol", "raider", "diamond"];

/** XP each level starts at, levels 1 to 5 (the web's xpForLevel curve, moved here). */
export const LEVEL_XP = [0, 100, 300, 800, 2000];

/** What each event is worth and the title it counts for; `title: null` counts only in the
 *  wallet's total. The one table of points: change them here.
 *   devLaunch      you opened the presale and it launched
 *   devMigrate     ... and the coin migrated
 *   kolLaunch      you put SOL in someone else's presale and it launched
 *   kolMigrate     ... and the coin migrated
 *   raiderJoin     a wallet joined through your link, put SOL in, and the presale launched
 *   diamondMigrate at migration your wallet still held the tokens the presale gave you
 *   genesis        your Seeker Genesis Token, once */
export const POINTS = {
  devLaunch: { title: "dev", points: 100 },
  devMigrate: { title: "dev", points: 200 },
  kolLaunch: { title: "kol", points: 25 },
  kolMigrate: { title: "kol", points: 50 },
  raiderJoin: { title: "raider", points: 25 },
  diamondMigrate: { title: "diamond", points: 100 },
  genesis: { title: null, points: 250 },
};

/** The level `xp` reaches on LEVEL_XP: 1 to 5. */
export function levelOf(xp) {
  let level = 1;
  for (let l = 1; l <= LEVEL_XP.length; l++) if (xp >= LEVEL_XP[l - 1]) level = l;
  return level;
}

export const DAY_MS = 86_400_000;

/** The UTC day number of `ms` (days since 1970-01-01, UTC). */
export const utcDay = (ms) => Math.floor(ms / DAY_MS);

const dayName = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** The streak from `days` (UTC day numbers with a confirmed join or open, any order,
 *  repeats fine) as of UTC day `today`: { days, best, last }. `days` is the run that ends on
 *  the latest day, while that day is today or yesterday, else 0; `best` the longest run;
 *  `last` the latest day as "YYYY-MM-DD", or null. */
export function streakOf(days, today) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of sorted) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  if (prev === null) return { days: 0, best: 0, last: null };
  return { days: prev >= today - 1 ? run : 0, best, last: dayName(prev) };
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `cd engine && node --test test/xp.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 3`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 3, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/xp.js engine/test/xp.test.js && git commit -m "engine: shared XP rules: the four titles (Dev, KOL, Raider, Diamond Hands), the web's level curve, one points table, the UTC-day streak

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/src/xp.js engine/test/xp.test.js
```

---

### Task 2 [server/web]: The XP ledger

The tables beside `referrals` in the server's SQLite file (`store.db`, as `Referrals` does it), and the XP row every client reads (see "Server data shapes"). `node:sqlite` hands rows back with a null prototype, so every method builds plain objects (the tests compare with `deepStrictEqual`, which checks prototypes).

**Files:**
- Create: `engine/server/xp.js`
- Test: `engine/test/xpledger.test.js`

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^engine: shared XP rules'; ls engine/server/xp.js engine/test/xpledger.test.js 2>&1 | grep -c 'No such file'`
Expected: `1` (Task 1 is in), then `2`. Anything else: stop and report.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_E.

- [ ] **Step 1: Write the failing test.**

Create `engine/test/xpledger.test.js`:

```js
// The XP ledger (server/xp.js): each event counts once, the streak's days, the Genesis
// claim, the seats kept at launch, and the rows and the board the clients read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { XpLedger } from "../server/xp.js";
import { DAY_MS, POINTS } from "../src/xp.js";

const wallet = () => Keypair.generate().publicKey.toBase58();
const T = Date.UTC(2026, 9, 1, 12); // 2026-10-01 12:00 UTC
const ZERO_TITLES = { dev: 0, kol: 0, raider: 0, diamond: 0 };
const ZERO_COUNTS = { devLaunch: 0, devMigrate: 0, kolLaunch: 0, kolMigrate: 0, raiderJoin: 0, diamondMigrate: 0 };

test("XpLedger: an event counts once per ref, and the rows stay on a second open of the file", () => {
  const store = new Store(":memory:");
  const xp = new XpLedger(store.db);
  const [a, p1, p2] = [wallet(), wallet(), wallet()];
  assert.equal(xp.award(a, "devLaunch", p1, T), true);
  assert.equal(xp.award(a, "devLaunch", p1, T + 1), false, "the same launch again: nothing");
  assert.equal(xp.award(a, "devLaunch", p2, T), true, "another presale counts");
  assert.equal(xp.award(a, "kolLaunch", p1, T), true, "another reason on the same presale counts");
  assert.throws(() => xp.award(a, "shill", p1, T), /no points for shill/);
  assert.deepEqual(xp.walletsWith("devLaunch", p1), [a], "who got an event for a ref");
  assert.deepEqual(xp.walletsWith("devMigrate", p1), []);
  const row = new XpLedger(store.db).row(a, T);
  assert.equal(row.total, 2 * POINTS.devLaunch.points + POINTS.kolLaunch.points);
  assert.deepEqual(row.titles, { ...ZERO_TITLES, dev: 2 * POINTS.devLaunch.points, kol: POINTS.kolLaunch.points });
  assert.deepEqual(row.counts, { ...ZERO_COUNTS, devLaunch: 2, kolLaunch: 1 });
  store.close();
});

test("XpLedger: a wallet with nothing gets zeros", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const a = wallet();
  assert.deepEqual(xp.row(a, T), { wallet: a, total: 0, titles: ZERO_TITLES, counts: ZERO_COUNTS, streak: { days: 0, best: 0, last: null }, genesis: null });
});

test("XpLedger: one streak day per UTC day with a confirmed join or open, and no points for it", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const a = wallet();
  assert.equal(xp.active(a, T - 2 * DAY_MS), true);
  assert.equal(xp.active(a, T - DAY_MS), true);
  assert.equal(xp.active(a, T), true);
  assert.equal(xp.active(a, T + 60_000), false, "a second one the same day: no new day");
  assert.deepEqual(xp.row(a, T).streak, { days: 3, best: 3, last: "2026-10-01" });
  assert.deepEqual(xp.row(a, T + 2 * DAY_MS).streak, { days: 0, best: 3, last: "2026-10-01" }, "a whole UTC day with none ends it");
  assert.equal(xp.row(a, T).total, 0);
});

test("XpLedger: the Genesis perk once per wallet and once per mint", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const [a, b, m1, m2] = [wallet(), wallet(), wallet(), wallet()];
  assert.deepEqual(xp.claimGenesis(m1, a, T), { mint: m1, at: T, fresh: true });
  assert.deepEqual(xp.claimGenesis(m1, a, T + 5), { mint: m1, at: T, fresh: false }, "asking again: the same answer");
  assert.deepEqual(xp.claimGenesis(m2, a, T + 5), { mint: m1, at: T, fresh: false }, "a second mint gives this wallet nothing more");
  assert.deepEqual(xp.claimGenesis(m1, b, T + 9), { taken: a }, "another wallet with the same mint: taken");
  assert.equal(xp.genesisOf(b), null);
  const row = xp.row(a, T);
  assert.deepEqual(row.genesis, { mint: m1, at: T });
  assert.equal(row.total, POINTS.genesis.points, "the bonus counts in the total");
  assert.deepEqual(row.titles, ZERO_TITLES, "and in no title");
  assert.deepEqual(row.counts, ZERO_COUNTS, "and in no count");
});

test("XpLedger: seats kept at launch are read back at migration; the first keep stays", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const [p, mint, a, b] = [wallet(), wallet(), wallet(), wallet()];
  assert.deepEqual(xp.seatsOf(p), []);
  xp.keepSeats(p, mint, [{ wallet: a, tokens: 1_000_000n }, { wallet: b, tokens: 18_446_744_073_709_551_615n }]);
  xp.keepSeats(p, mint, [{ wallet: a, tokens: 5n }]);
  const want = [{ wallet: a, mint, tokens: 1_000_000n }, { wallet: b, mint, tokens: 18_446_744_073_709_551_615n }];
  assert.deepEqual(xp.seatsOf(p), want.sort((x, y) => (x.wallet < y.wallet ? -1 : 1)), "u64 shares come back whole");
});

test("XpLedger: what was done for a presale", () => {
  const xp = new XpLedger(new Store(":memory:").db);
  const p = wallet();
  assert.equal(xp.done(p, "launch"), false);
  xp.markDone(p, "launch", T);
  xp.markDone(p, "launch", T + 1);
  assert.equal(xp.done(p, "launch"), true);
  assert.equal(xp.done(p, "migrate"), false);
});

test("XpLedger: the board, by total then wallet, streak-only wallets included", () => {
  assert.ok(POINTS.devLaunch.points > POINTS.kolLaunch.points, "this test's order assumes it");
  const xp = new XpLedger(new Store(":memory:").db);
  const [a, b, c, d, p] = [wallet(), wallet(), wallet(), wallet(), wallet()];
  xp.award(a, "kolLaunch", p, T);
  xp.award(b, "devLaunch", p, T);
  xp.award(c, "kolLaunch", p, T);
  xp.active(d, T);
  const [lo, hi] = [a, c].sort();
  assert.deepEqual(xp.board(500, T).map((r) => r.wallet), [b, lo, hi, d]);
  assert.deepEqual(xp.board(500, T)[0], xp.row(b, T));
  assert.deepEqual(xp.board(2, T).map((r) => r.wallet), [b, lo]);
  assert.deepEqual(xp.rows([d, b, d], T), [xp.row(d, T), xp.row(b, T)], "rows: each wallet once, in the order asked");
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test test/xpledger.test.js 2>&1 | grep -E '^# (pass|fail)|Cannot find module'`
Expected: `Cannot find module` naming `server/xp.js`.

- [ ] **Step 3: Write the ledger.**

Create `engine/server/xp.js`:

```js
// The XP ledger (spec "XP ledger"): every point a wallet earned, one row per event, kept
// beside the referrals in the server's SQLite file. `UNIQUE (wallet, reason, ref)` is what
// keeps an event from counting twice (a restart, a catch-up, a repeat), so callers just
// award and let the table say whether it was new. What each event is worth is POINTS
// (src/xp.js); the rules that award them are xprules.js. Nothing here reads the chain.

import { POINTS, TITLES, streakOf, utcDay } from "../src/xp.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS xp (
  wallet TEXT NOT NULL,
  title  TEXT,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref    TEXT NOT NULL,
  at     INTEGER NOT NULL,
  UNIQUE (wallet, reason, ref)
);
CREATE INDEX IF NOT EXISTS xp_wallet ON xp (wallet);
CREATE TABLE IF NOT EXISTS activity (
  wallet TEXT NOT NULL,
  day    INTEGER NOT NULL,
  PRIMARY KEY (wallet, day)
);
CREATE TABLE IF NOT EXISTS genesis (
  mint   TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS genesis_wallet ON genesis (wallet);
CREATE TABLE IF NOT EXISTS xp_seats (
  presale TEXT NOT NULL,
  mint    TEXT NOT NULL,
  wallet  TEXT NOT NULL,
  tokens  TEXT NOT NULL,
  PRIMARY KEY (presale, wallet)
);
CREATE TABLE IF NOT EXISTS xp_events (
  presale TEXT NOT NULL,
  event   TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (presale, event)
);`;

const COUNTED = Object.keys(POINTS).filter((r) => POINTS[r].title !== null);

export class XpLedger {
  /** `db`: the server's node:sqlite database (store.db). */
  constructor(db) {
    this.db = db;
    db.exec(SCHEMA);
  }

  /** `reason` (a POINTS key) for `wallet` (base58), once per `ref` (a presale, or a
   *  presale and a joiner), at `at` (ms). True when it counted, false when it already had. */
  award(wallet, reason, ref, at) {
    const p = POINTS[reason];
    if (!p) throw new Error(`no points for ${reason}`);
    const sql = "INSERT INTO xp (wallet, title, points, reason, ref, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (wallet, reason, ref) DO NOTHING";
    return Number(this.db.prepare(sql).run(wallet, p.title, p.points, reason, ref, at).changes) === 1;
  }

  /** The wallets that got `reason` for `ref`, by wallet. */
  walletsWith(reason, ref) {
    return this.db.prepare("SELECT wallet FROM xp WHERE reason = ? AND ref = ? ORDER BY wallet").all(reason, ref).map((r) => r.wallet);
  }

  /** A confirmed join or open by `wallet` at `at` (ms): its UTC day counts for the streak.
   *  True when the day is new for this wallet. */
  active(wallet, at) {
    const sql = "INSERT INTO activity (wallet, day) VALUES (?, ?) ON CONFLICT (wallet, day) DO NOTHING";
    return Number(this.db.prepare(sql).run(wallet, utcDay(at)).changes) === 1;
  }

  /** The seats of `presale` (base58) at launch, with the coin `mint`: [{ wallet, tokens
   *  (a bigint, the presale's share) }]. The first keep for a seat stays. */
  keepSeats(presale, mint, seats) {
    const st = this.db.prepare("INSERT INTO xp_seats (presale, mint, wallet, tokens) VALUES (?, ?, ?, ?) ON CONFLICT (presale, wallet) DO NOTHING");
    for (const s of seats) st.run(presale, mint, s.wallet, s.tokens.toString());
  }

  /** The seats kept for `presale`: [{ wallet, mint, tokens (a bigint) }], by wallet. */
  seatsOf(presale) {
    const rows = this.db.prepare("SELECT wallet, mint, tokens FROM xp_seats WHERE presale = ? ORDER BY wallet").all(presale);
    return rows.map((r) => ({ wallet: r.wallet, mint: r.mint, tokens: BigInt(r.tokens) }));
  }

  /** `event` ("launch" or "migrate") was fully counted for `presale`. */
  done(presale, event) {
    return !!this.db.prepare("SELECT 1 FROM xp_events WHERE presale = ? AND event = ?").get(presale, event);
  }

  markDone(presale, event, at) {
    this.db.prepare("INSERT INTO xp_events (presale, event, at) VALUES (?, ?, ?) ON CONFLICT (presale, event) DO NOTHING").run(presale, event, at);
  }

  /** The wallet's Genesis claim, { mint, at }, or null. */
  genesisOf(wallet) {
    const r = this.db.prepare("SELECT mint, at FROM genesis WHERE wallet = ? ORDER BY at LIMIT 1").get(wallet);
    return r ? { mint: r.mint, at: r.at } : null;
  }

  /** `wallet` holds the Genesis mint `mint`. The perk goes once per wallet and once per
   *  mint: { mint, at, fresh } (the wallet's claim; fresh when this call made it), or
   *  { taken: <the wallet that has this mint's claim> }. */
  claimGenesis(mint, wallet, at) {
    const mine = this.genesisOf(wallet);
    if (mine) return { ...mine, fresh: false };
    const owner = this.db.prepare("SELECT wallet FROM genesis WHERE mint = ?").get(mint);
    if (owner) return { taken: owner.wallet };
    this.db.prepare("INSERT INTO genesis (mint, wallet, at) VALUES (?, ?, ?)").run(mint, wallet, at);
    this.award(wallet, "genesis", mint, at);
    return { mint, at, fresh: true };
  }

  /** The wallet's XP row (see the plan's "Server data shapes") as of `now` (ms). */
  row(wallet, now) {
    const titles = Object.fromEntries(TITLES.map((t) => [t, 0]));
    const counts = Object.fromEntries(COUNTED.map((r) => [r, 0]));
    let total = 0;
    const sums = this.db.prepare("SELECT reason, title, SUM(points) AS points, COUNT(*) AS n FROM xp WHERE wallet = ? GROUP BY reason, title").all(wallet);
    for (const r of sums) {
      total += r.points;
      if (r.title in titles) titles[r.title] += r.points;
      if (r.reason in counts) counts[r.reason] += r.n;
    }
    const days = this.db.prepare("SELECT day FROM activity WHERE wallet = ?").all(wallet).map((r) => r.day);
    return { wallet, total, titles, counts, streak: streakOf(days, utcDay(now)), genesis: this.genesisOf(wallet) };
  }

  /** The rows of `wallets`, each wallet once, in the order given. */
  rows(wallets, now) {
    return [...new Set(wallets)].map((w) => this.row(w, now));
  }

  /** The top `limit` wallets by total (ties by wallet), wallets with only streak days
   *  included at 0: their rows. */
  board(limit, now) {
    const sql = `SELECT wallet, SUM(points) AS total FROM (SELECT wallet, points FROM xp UNION ALL SELECT wallet, 0 FROM activity)
      GROUP BY wallet ORDER BY total DESC, wallet ASC LIMIT ?`;
    return this.db.prepare(sql).all(limit).map((r) => this.row(r.wallet, now));
  }
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `cd engine && node --test test/xpledger.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 7`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 7, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add engine/server/xp.js engine/test/xpledger.test.js && git commit -m "engine: the XP ledger: each event counts once per wallet, reason and ref; streak days; the Genesis claim once per wallet and per mint; seats kept at launch; rows and the board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/xp.js engine/test/xpledger.test.js
```

---

### Task 3 [server/web]: The rules: launch, migration, catch-up

Who gets what, from the presale account and its seats as the launch left them (`decodePresale`: `creator`, `mint`, `raised`, `totalTokens`, which `launch.rs` sets at launch) and the confirmed referrals. A claim closes its seat (`programs/presale/src/finish.rs`) and claims start once the snipe tax is over, so each seat's token share is kept at launch for the Diamond Hands check at migration. The share is the claim's own formula, `tokenShare(total, 0n, commit, raised, false)` (`engine/src/math.js`): the floor, which the last claim's remainder only adds to. The chain reads are three small exported functions, so `XpRules` itself is tested on fakes.

Raider counts **confirmed** referral rows only (this piece's brief), for joiners who still have a seat with SOL in at launch. `engine/server/referrals.js`'s header says the seat check would also settle unconfirmed rows; that sentence is rewritten here to match (see the open questions).

**Files:**
- Create: `engine/server/xprules.js`
- Modify: `engine/server/referrals.js` (its header sentence on points; a `confirmedIn` method after `referralOf`)
- Test: `engine/test/xprules.test.js` (new), `engine/test/referrals.test.js` (one test appended)

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^engine: the XP ledger'; ls engine/server/xprules.js engine/test/xprules.test.js 2>&1 | grep -c 'No such file'; git diff --quiet HEAD -- engine/server/referrals.js engine/test/referrals.test.js && echo clean`
Expected: `1`, `2`, `clean`. Anything else: stop and report.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_E.

- [ ] **Step 1: Write the failing tests.**

Append to `engine/test/referrals.test.js` (its imports already have `test`, `assert`, `Store`, `Referrals` and `key`):

```js

test("Referrals.confirmedIn: a presale's confirmed rows, by joiner", () => {
  const store = new Store(":memory:");
  const refs = new Referrals(store.db);
  const [presale, other, u1, u2, u3, r] = [key(), key(), key(), key(), key(), key()];
  refs.add(presale, u1, r, "S1", 1, true);
  refs.add(presale, u2, r, "S2", 2, false);
  refs.add(presale, u3, u1, "S3", 3, true);
  refs.add(other, u2, r, "S4", 4, true);
  const want = [{ user: u1.toBase58(), referrer: r.toBase58() }, { user: u3.toBase58(), referrer: u1.toBase58() }];
  assert.deepEqual(refs.confirmedIn(presale.toBase58()), want.sort((x, y) => (x.user < y.user ? -1 : 1)), "unconfirmed rows and other presales left out");
  assert.deepEqual(refs.confirmedIn(key().toBase58()), []);
  store.close();
});
```

Create `engine/test/xprules.test.js`:

```js
// XP rules (server/xprules.js): what a launch, a migration and the catch-up give, with the
// chain read through fakes; and the three chain reads, against fake accounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { Referrals } from "../server/referrals.js";
import { XpLedger } from "../server/xp.js";
import { XpRules, holds, openSeats, readLaunch } from "../server/xprules.js";
import { P, PRESALE_LEN, PRESALE_VERSION } from "../src/layout.js";
import { tokenShare } from "../src/math.js";
import { POINTS } from "../src/xp.js";

const key = () => Keypair.generate().publicKey;
const b58 = () => key().toBase58();
const T = Date.UTC(2026, 9, 1, 12);
const byWallet = (x, y) => (x.wallet < y.wallet ? -1 : 1);

/** A ledger and referrals on one :memory: store, and XpRules on fakes (`over` replaces them). */
function setup(over = {}) {
  const store = new Store(":memory:");
  const ledger = new XpLedger(store.db);
  const referrals = new Referrals(store.db);
  const changes = [];
  const logs = [];
  const rules = new XpRules({
    ledger,
    referrals,
    readLaunch: async () => assert.fail("no launch read in this test"),
    openSeats: async () => [],
    holds: async () => 0n,
    launches: () => [],
    isMigrated: () => false,
    onChange: (wallets) => changes.push(...wallets),
    now: () => T,
    log: (m) => logs.push(m),
    retryMs: 0,
    ...over,
  });
  return { ledger, referrals, rules, changes, logs };
}

/** A launched presale: the creator with 0.1 SOL in, three others, one seat with nothing in. */
function launched() {
  const [presale, mint, creator, a, b, c, empty] = [b58(), b58(), b58(), b58(), b58(), b58(), b58()];
  const seats = [
    { wallet: creator, commit: 100_000_000n },
    { wallet: a, commit: 200_000_000n },
    { wallet: b, commit: 100_000_000n },
    { wallet: c, commit: 100_000_000n },
    { wallet: empty, commit: 0n },
  ];
  const launch = { creator, mint, total: 1_000_000_007n, raised: 500_000_000n, seats };
  const share = (w) => tokenShare(launch.total, 0n, seats.find((s) => s.wallet === w).commit, launch.raised, false);
  return { presale, mint, creator, a, b, c, empty, launch, share };
}

test("XpRules: a launch gives Dev to the creator, KOL to each other seat with SOL in, Raider for each confirmed referral that came in", async () => {
  const L = launched();
  const w = setup({ readLaunch: async (p) => (assert.equal(p, L.presale), L.launch) });
  const [raider, stranger] = [key(), key()];
  const pk = (s) => new PublicKey(s);
  w.referrals.add(pk(L.presale), pk(L.a), raider, "S1", T, true); // counts
  w.referrals.add(pk(L.presale), pk(L.b), raider, "S2", T, false); // unconfirmed: no
  w.referrals.add(pk(L.presale), pk(L.empty), raider, "S3", T, true); // no SOL in: no
  w.referrals.add(pk(L.presale), stranger, raider, "S4", T, true); // no seat at launch: no
  w.referrals.add(pk(L.presale), pk(L.c), pk(L.c), "S5", T, true); // yourself: no
  await w.rules.launched(L.presale);
  const counts = (wallet) => w.ledger.row(wallet, T).counts;
  assert.equal(counts(L.creator).devLaunch, 1);
  assert.equal(counts(L.creator).kolLaunch, 0, "the creator's own seat isn't KOL");
  for (const k of [L.a, L.b, L.c]) assert.equal(counts(k).kolLaunch, 1);
  assert.equal(counts(L.empty).kolLaunch, 0, "a seat with nothing in isn't KOL");
  assert.equal(counts(raider.toBase58()).raiderJoin, 1, "one confirmed referral that came in");
  assert.equal(counts(L.c).raiderJoin, 0, "never yourself");
  assert.equal(w.ledger.row(raider.toBase58(), T).total, POINTS.raiderJoin.points);
  const kept = [L.creator, L.a, L.b, L.c].map((wallet) => ({ wallet, mint: L.mint, tokens: L.share(wallet) }));
  assert.deepEqual(w.ledger.seatsOf(L.presale), kept.sort(byWallet), "each seat with SOL in keeps its claim's share");
  assert.deepEqual(new Set(w.changes), new Set([L.creator, L.a, L.b, L.c, raider.toBase58()]));
  assert.equal(w.ledger.done(L.presale, "launch"), true);
  w.changes.length = 0;
  await w.rules.launched(L.presale);
  assert.deepEqual(w.changes, [], "a second call gives nothing and reads nothing");
});

test("XpRules: seats that can't be read at launch are tried again, then left to the next start; a presale that's gone counts as read", async () => {
  const L = launched();
  let n = 0;
  const down = setup({ readLaunch: async () => (n++, assert.fail("rpc down")), tries: 3 });
  await down.rules.launched(L.presale);
  assert.equal(n, 3, "three tries");
  assert.match(down.logs.join("\n"), /couldn't read .* at launch: rpc down/);
  assert.equal(down.ledger.done(L.presale, "launch"), false, "the next start tries again");
  assert.deepEqual(down.ledger.board(10, T), []);

  let m = 0;
  const blip = setup({ readLaunch: async () => (m++ === 0 ? assert.fail("blip") : L.launch) });
  await blip.rules.launched(L.presale);
  assert.equal(blip.ledger.row(L.creator, T).counts.devLaunch, 1, "the second try counts");

  const gone = setup({ readLaunch: async () => null });
  await gone.rules.launched(L.presale);
  assert.equal(gone.ledger.done(L.presale, "launch"), true, "nothing left to read: not tried again");
  assert.match(gone.logs.join("\n"), /is gone/);
});

test("XpRules: a migration gives Dev and KOL again, and Diamond Hands to each seat still holding its share or not delivered yet", async () => {
  const L = launched();
  const held = { [L.creator]: L.share(L.creator), [L.a]: L.share(L.a) + 5n, [L.b]: L.share(L.b) - 1n, [L.c]: 0n };
  const w = setup({
    readLaunch: async () => L.launch,
    openSeats: async (p) => (assert.equal(p, L.presale), [L.c]),
    holds: async (wallet, mint) => (assert.equal(mint, L.mint), held[wallet]),
  });
  await w.rules.launched(L.presale);
  w.changes.length = 0;
  await w.rules.migrated(L.presale);
  const counts = (wallet) => w.ledger.row(wallet, T).counts;
  assert.equal(counts(L.creator).devMigrate, 1);
  assert.equal(counts(L.creator).diamondMigrate, 1, "exactly the share is enough");
  assert.equal(counts(L.creator).kolMigrate, 0);
  assert.deepEqual([L.a, L.b, L.c].map((k) => counts(k).kolMigrate), [1, 1, 1]);
  assert.equal(counts(L.a).diamondMigrate, 1, "more than the share");
  assert.equal(counts(L.b).diamondMigrate, 0, "sold some");
  assert.equal(counts(L.c).diamondMigrate, 1, "its seat is still open: nothing delivered, nothing sold");
  assert.equal(counts(L.empty).diamondMigrate, 0);
  assert.equal(w.ledger.row(L.creator, T).total, POINTS.devLaunch.points + POINTS.devMigrate.points + POINTS.diamondMigrate.points);
  assert.deepEqual(new Set(w.changes), new Set([L.creator, L.a, L.b, L.c]));
  assert.equal(w.ledger.done(L.presale, "migrate"), true);
  w.changes.length = 0;
  await w.rules.migrated(L.presale);
  assert.deepEqual(w.changes, [], "a second call gives nothing");
});

test("XpRules: holdings that can't be read leave Diamond Hands to the next start; a launch not counted yet is counted first", async () => {
  const L = launched();
  const w = setup({ readLaunch: async () => L.launch, holds: async () => assert.fail("rpc down") });
  await w.rules.migrated(L.presale);
  assert.equal(w.ledger.row(L.creator, T).counts.devLaunch, 1, "the launch counted first");
  assert.equal(w.ledger.row(L.creator, T).counts.devMigrate, 1, "Dev and KOL need no read");
  assert.equal(w.ledger.row(L.creator, T).counts.diamondMigrate, 0);
  assert.match(w.logs.join("\n"), /couldn't read holdings .*: rpc down/);
  assert.equal(w.ledger.done(L.presale, "migrate"), false);
  w.rules.holds = async (wallet) => L.share(wallet);
  await w.rules.migrated(L.presale);
  assert.deepEqual([L.creator, L.a, L.b, L.c].map((k) => w.ledger.row(k, T).counts.diamondMigrate), [1, 1, 1, 1]);
  assert.equal(w.ledger.row(L.creator, T).counts.devMigrate, 1, "still once");
  assert.equal(w.ledger.done(L.presale, "migrate"), true);
});

test("XpRules: the catch-up counts each launch not counted, and each migration the feed knows of", async () => {
  const [A, B, C] = [launched(), launched(), launched()];
  const all = { [A.presale]: A, [B.presale]: B, [C.presale]: C };
  const w = setup({
    readLaunch: async (p) => all[p].launch,
    holds: async (wallet) => A.share(wallet),
    launches: () => [A, B, C].map((x) => ({ presale: x.presale, mint: x.mint })),
    isMigrated: (mint) => (mint === C.mint ? assert.fail("boom") : mint === A.mint),
  });
  await w.rules.catchUp();
  assert.equal(w.ledger.row(A.creator, T).counts.devMigrate, 1, "A migrated while the server was down");
  assert.equal(w.ledger.row(A.a, T).counts.diamondMigrate, 1);
  assert.equal(w.ledger.row(B.creator, T).counts.devLaunch, 1, "B launched");
  assert.equal(w.ledger.done(B.presale, "migrate"), false, "B hasn't migrated");
  assert.equal(w.ledger.row(C.creator, T).counts.devLaunch, 1, "C's launch counted before its error");
  assert.match(w.logs.join("\n"), /catch-up .*: boom/);
});

test("XpRules: a confirmed join or open is a streak day; a new day is a change", () => {
  const w = setup();
  const a = b58();
  w.rules.active(a, T);
  w.rules.active(a, T + 60_000);
  assert.deepEqual(w.changes, [a], "the same UTC day again changes nothing");
  assert.deepEqual(w.ledger.row(a, T).streak, { days: 1, best: 1, last: "2026-10-01" });
});

test("the reads: the presale as launch left it, the seats still open, a wallet's tokens", async () => {
  const [presale, mint, creator, a] = [key(), key(), key(), key()];
  const d = Buffer.alloc(PRESALE_LEN);
  d[0] = PRESALE_VERSION;
  creator.toBuffer().copy(d, P.CREATOR);
  mint.toBuffer().copy(d, P.MINT);
  d.writeBigUInt64LE(500_000_000n, P.RAISED);
  d.writeBigUInt64LE(1_000_000_007n, P.TOTAL_TOKENS);
  const bot = { homeSeats: async (k) => (assert.ok(k.equals(presale)), [{ user: a, commit: 300_000_000n }, { user: creator, commit: 200_000_000n }]) };
  const account = (amount) => {
    const data = Buffer.alloc(165);
    data.writeBigUInt64LE(amount, 64);
    return { pubkey: key(), account: { data } };
  };
  const l1 = {
    getAccountInfo: async (k) => (k.equals(presale) ? { data: d } : null),
    getTokenAccountsByOwner: async (owner, filter) => (assert.ok(owner.equals(a) && filter.mint.equals(mint)), { value: [account(7n), account(5n)] }),
  };
  const [p, m, c, w] = [presale, mint, creator, a].map((k) => k.toBase58());
  assert.deepEqual(await readLaunch(bot, l1, p), { creator: c, mint: m, total: 1_000_000_007n, raised: 500_000_000n, seats: [{ wallet: w, commit: 300_000_000n }, { wallet: c, commit: 200_000_000n }] });
  assert.equal(await readLaunch(bot, { getAccountInfo: async () => null }, p), null, "a presale account that's gone");
  assert.deepEqual(await openSeats(bot, p), [w, c]);
  assert.equal(await holds(l1, w, m), 12n, "every token account of the wallet for that mint");
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd engine && node --test test/xprules.test.js test/referrals.test.js 2>&1 | grep -E '^# (pass|fail)|Cannot find module|confirmedIn is not'`
Expected: `Cannot find module` naming `server/xprules.js`; `refs.confirmedIn is not a function`.

- [ ] **Step 3: Add `confirmedIn` and rewrite the header sentence.**

In `engine/server/referrals.js`, replace:

```js
// can't block the referrer of a later join that did. Points for it (the Raider title) come
// later, from this table, and only for seats still there when the presale launches (piece 6):
// that check also settles an unconfirmed row whose join never landed. Nothing here moves SOL.
```

with:

```js
// can't block the referrer of a later join that did. Points for it (the Raider title,
// xprules.js) come from the confirmed rows only, for joiners who still have a seat with SOL
// in when the presale launches. Nothing here moves SOL.
```

and after the `referralOf` method (before the class's closing `}`), add:

```js

  /** The confirmed rows of `presale` (base58, as XpRules keeps keys): [{ user, referrer }]
   *  (base58), by user. */
  confirmedIn(presale) {
    const rows = this.db.prepare("SELECT user, referrer FROM referrals WHERE presale = ? AND confirmed = 1 ORDER BY user").all(presale);
    return rows.map((r) => ({ user: r.user, referrer: r.referrer }));
  }
```

- [ ] **Step 4: Write the rules.**

Create `engine/server/xprules.js`:

```js
// XP rules (spec "XP ledger"): which events give which points (POINTS, src/xp.js), from
// what the server already sees: the keeper's launch (main.js onLaunch) and the feed's
// "migrated" event call in, and a catch-up at start covers what happened while the server
// was down. Every point goes through XpLedger.award, which counts an event once, so a call
// that runs twice (a retry, the catch-up after a live event) gives nothing twice.
//
//   launch     Dev (the presale's creator), KOL (each other seat with SOL in), Raider (each
//              confirmed referral whose joiner has a seat with SOL in; never yourself)
//   migration  Dev and KOL again (whoever got them at launch), Diamond Hands (each seat whose
//              wallet still holds its presale share, or whose seat is still open: nothing
//              delivered, nothing sold)
//   co-sign    a confirmed join or open (api.js): that UTC day, for the streak
//
// Seats are read right at launch: a claim closes its seat (finish.rs), and claims start once
// the snipe tax is over, so each seat's share is kept then for the check at migration.
// Keys are base58 strings throughout.

import { PublicKey } from "@solana/web3.js";
import { decodePresale, tokenAmount } from "../src/layout.js";
import { tokenShare } from "../src/math.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `presale` as its launch left it: { creator, mint, total, raised, seats: [{ wallet,
 *  commit }] } (bigints), or null when the presale account is gone. `bot`: the keeper's Bot
 *  (homeSeats); `l1`: a Connection. */
export async function readLaunch(bot, l1, presale) {
  const key = new PublicKey(presale);
  const [seats, acc] = await Promise.all([bot.homeSeats(key), l1.getAccountInfo(key)]);
  if (!acc) return null;
  const p = decodePresale(acc.data);
  return {
    creator: p.creator.toBase58(),
    mint: p.mint.toBase58(),
    total: p.totalTokens,
    raised: p.raised,
    seats: seats.map((s) => ({ wallet: s.user.toBase58(), commit: s.commit })),
  };
}

/** The wallets whose seat in `presale` is still open (not claimed: no tokens delivered). */
export async function openSeats(bot, presale) {
  return (await bot.homeSeats(new PublicKey(presale))).map((s) => s.user.toBase58());
}

/** How much of `mint` `wallet` holds, over all its token accounts for it (a bigint). */
export async function holds(l1, wallet, mint) {
  const r = await l1.getTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(mint) });
  return r.value.reduce((n, a) => n + tokenAmount(a.account.data), 0n);
}

export class XpRules {
  /**
   * `ledger`: an XpLedger. `referrals`: Referrals. `readLaunch(presale)`, `openSeats(presale)`,
   * `holds(wallet, mint)`: the reads above, bound to the server's bot and connection.
   * `launches()`: every launch ({ presale, mint }, store.launches). `isMigrated(mint)`: the
   * feed knows the coin's DBC pool migrated. `onChange(wallets)`: their rows changed.
   */
  constructor({ ledger, referrals, readLaunch, openSeats, holds, launches, isMigrated, onChange = () => {}, now = Date.now, log = console.log, tries = 3, retryMs = 500 }) {
    Object.assign(this, { ledger, referrals, readLaunch, openSeats, holds, launches, isMigrated, onChange, now, log, tries, retryMs });
  }

  /** A confirmed join or open by `wallet` at `at` (ms), from api.js: a streak day. */
  active(wallet, at) {
    if (this.ledger.active(wallet, at)) this.onChange([wallet]);
  }

  /** `presale` just launched (or launched while nobody counted it). */
  async launched(presale) {
    if (this.ledger.done(presale, "launch")) return;
    let l;
    for (let i = 1; ; i++) {
      try {
        l = await this.readLaunch(presale);
        break;
      } catch (e) {
        if (i >= this.tries) return this.log(`xp: couldn't read ${presale} at launch: ${e?.message ?? e}`);
        await sleep(this.retryMs);
      }
    }
    const at = this.now();
    if (!l) {
      this.log(`xp: presale ${presale} is gone, nothing to count at launch`);
      return this.ledger.markDone(presale, "launch", at);
    }
    const changed = new Set();
    const give = (wallet, reason, ref) => this.ledger.award(wallet, reason, ref, at) && changed.add(wallet);
    const paid = l.seats.filter((s) => s.commit > 0n);
    give(l.creator, "devLaunch", presale);
    for (const s of paid) if (s.wallet !== l.creator) give(s.wallet, "kolLaunch", presale);
    const seated = new Set(paid.map((s) => s.wallet));
    for (const r of this.referrals.confirmedIn(presale)) {
      if (seated.has(r.user) && r.referrer !== r.user) give(r.referrer, "raiderJoin", `${presale}:${r.user}`);
    }
    this.ledger.keepSeats(presale, l.mint, paid.map((s) => ({ wallet: s.wallet, tokens: tokenShare(l.total, 0n, s.commit, l.raised, false) })));
    this.ledger.markDone(presale, "launch", at);
    if (changed.size) this.onChange([...changed]);
  }

  /** `presale`'s coin migrated. */
  async migrated(presale) {
    if (this.ledger.done(presale, "migrate")) return;
    await this.launched(presale);
    if (!this.ledger.done(presale, "launch")) return; // its seats are still unread: the next start
    const at = this.now();
    const changed = new Set();
    const give = (wallet, reason) => this.ledger.award(wallet, reason, presale, at) && changed.add(wallet);
    for (const w of this.ledger.walletsWith("devLaunch", presale)) give(w, "devMigrate");
    for (const w of this.ledger.walletsWith("kolLaunch", presale)) give(w, "kolMigrate");
    const seats = this.ledger.seatsOf(presale).filter((s) => s.tokens > 0n);
    try {
      const open = new Set(seats.length ? await this.openSeats(presale) : []);
      for (const s of seats) {
        if (open.has(s.wallet) || (await this.holds(s.wallet, s.mint)) >= s.tokens) give(s.wallet, "diamondMigrate");
      }
      this.ledger.markDone(presale, "migrate", at);
    } catch (e) {
      this.log(`xp: couldn't read holdings for ${presale} at migration: ${e?.message ?? e}`);
    }
    if (changed.size) this.onChange([...changed]);
  }

  /** At start, after the feed read its pools: each launch not counted, and each migration. */
  async catchUp() {
    for (const l of this.launches()) {
      try {
        await this.launched(l.presale);
        if (!this.ledger.done(l.presale, "migrate") && this.isMigrated(l.mint)) await this.migrated(l.presale);
      } catch (e) {
        this.log(`xp: catch-up ${l.presale}: ${e?.message ?? e}`);
      }
    }
  }
}
```

- [ ] **Step 5: Run them to see them pass.**

Run: `cd engine && node --test test/xprules.test.js test/referrals.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 9`, `# fail 0` (7 in `xprules.test.js`, 2 in `referrals.test.js`).

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 8, `# fail 0`.

- [ ] **Step 6: Commit.**

```bash
git add engine/server/xprules.js engine/server/referrals.js engine/test/xprules.test.js engine/test/referrals.test.js && git commit -m "engine: XP rules: a launch gives Dev, KOL and Raider (confirmed referrals that came in) and keeps each seat's share; a migration gives Dev and KOL again and Diamond Hands to seats still holding it; a catch-up at start

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/xprules.js engine/server/referrals.js engine/test/xprules.test.js engine/test/referrals.test.js
```

---

### Task 4 [server/web]: A streak day from each confirmed join or open

`POST /api/cosign` already knows when a join or an open confirmed (a 200). It hands that wallet and the time to `xp.active(wallet, at)`; in the server that is `XpRules.active` (Task 3), which writes the day and pushes the row. A 202 (sent, not confirmed in time) counts nothing. A streak write that throws is logged and never changes the reply, as the referral write does.

**Files:**
- Modify: `engine/server/api.js` (the `makeRoutes` signature and doc comment; the confirmed block in `cosignRoute`)
- Test: `engine/test/server.test.js` (`startServer` takes `xp`; two tests appended)

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^engine: XP rules'; git diff --quiet HEAD -- engine/server/api.js engine/test/server.test.js && echo clean`
Expected: `1`, `clean`. Anything else: stop and report.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_E.

- [ ] **Step 1: Let the test server take `xp`.**

In `engine/test/server.test.js`, in `startServer`, replace:

```js
async function startServer({ openers = [], limits, sendTimeoutMs = 2_000, simMs, pinUri, pinError, web = null } = {}) {
```

with:

```js
async function startServer({ openers = [], limits, sendTimeoutMs = 2_000, simMs, pinUri, pinError, web = null, xp = null } = {}) {
```

and replace:

```js
    ...(simMs && { simMs }),
  });
  const server = createServer(routes, { log: () => {}, web });
```

with:

```js
    ...(simMs && { simMs }),
    ...(xp && { xp }),
  });
  const server = createServer(routes, { log: () => {}, web });
```

- [ ] **Step 2: Write the failing tests.**

Append to `engine/test/server.test.js`:

```js

test("cosign: each confirmed join or open is a streak day for its wallet; a 202 is none", async () => {
  const creator = Keypair.generate();
  const days = [];
  const s = await startServer({ openers: [creator], sendTimeoutMs: 300, xp: { active: (wallet, at) => days.push({ wallet, at }) } });
  try {
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    const presale = presalePda(pid, mint);
    const t0 = Date.now();
    assert.equal((await s.call("POST", "/api/cosign", { tx: entryTx(creator, openIxs(creator.publicKey, mint)) })).status, 200);
    assert.deepEqual(days.map((d) => d.wallet), [creator.publicKey.toBase58()], "an open");
    assert.ok(days[0].at >= t0 && days[0].at <= Date.now(), "at the server's clock");

    const user = Keypair.generate();
    const join = () => s.call("POST", "/api/cosign", { tx: entryTx(user, joinIxs(user.publicKey, presale)) });
    s.l1.confirm = false;
    assert.equal((await join()).status, 202);
    assert.equal(days.length, 1, "sent, not confirmed in time: no day");
    s.l1.confirm = true;
    assert.equal((await join()).status, 200);
    assert.deepEqual(days.map((d) => d.wallet), [creator.publicKey.toBase58(), user.publicKey.toBase58()], "a join");
  } finally {
    await s.close();
  }
});

test("cosign: a streak write that throws is logged once and never changes the reply", async () => {
  const creator = Keypair.generate();
  const s = await startServer({ openers: [creator], xp: { active: () => { throw new Error("disk full"); } } });
  const error = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(" "));
  try {
    const mint = new PublicKey((await s.call("POST", "/api/mint", mintBody(creator))).json.mint);
    const open = await s.call("POST", "/api/cosign", { tx: entryTx(creator, openIxs(creator.publicKey, mint)) });
    assert.deepEqual([open.status, open.json.kind, open.json.confirmed], [200, "open", true]);
    assert.deepEqual(logged.filter((l) => l.startsWith("streak ")), [`streak ${open.json.sig}: disk full`]);
  } finally {
    console.error = error;
    await s.close();
  }
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `cd engine && node --test --test-name-pattern='streak' test/server.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 0`, `# fail 2` (no day is written, nothing is logged).

- [ ] **Step 4: Write the hook.**

In `engine/server/api.js`, replace the doc comment line:

```js
 * `feed` (feed.js) hears about each entry the server sends, before the chain says so.
 */
```

with:

```js
 * `feed` (feed.js) hears about each entry the server sends, before the chain says so.
 * `xp` (xprules.js XpRules) hears of each confirmed join or open: `xp.active(wallet, at)`.
 */
```

In the `makeRoutes` signature, replace `keeper = null, feed = null, limits = DEFAULT_LIMITS` with `keeper = null, feed = null, xp = null, limits = DEFAULT_LIMITS`.

In `cosignRoute`, replace:

```js
    if (confirmed) feed?.touch(out.presale);
```

with:

```js
    if (confirmed) feed?.touch(out.presale);
    // a confirmed join or open: that UTC day counts for the wallet's streak (xprules.js)
    if (confirmed && (out.kind === "join" || out.kind === "open")) {
      try {
        xp?.active(out.user.toBase58(), now());
      } catch (e) {
        console.error(`streak ${sig}: ${e.message}`); // the entry was sent; the reply says so
      }
    }
```

- [ ] **Step 5: Run them to see them pass.**

Run: `cd engine && node --test --test-name-pattern='streak' test/server.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 2`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 2, `# fail 0`.

- [ ] **Step 6: Commit.**

```bash
git add engine/server/api.js engine/test/server.test.js && git commit -m "engine: each confirmed join or open is a streak day (xp.active from the co-sign); a 202 is none, a failed write never changes the reply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/api.js engine/test/server.test.js
```

---

### Task 5 [server/web]: The Genesis check

Solana Mobile's rule for a Seeker Genesis Token (docs.solanamobile.com, "Seeker Genesis Token", the section on verifying ownership): a Token-2022 mint whose MetadataPointer's metadata address and whose TokenGroupMember's group are both the Genesis group mint `GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te`; token accounts with a zero balance are skipped. This task also checks that the mint account is owned by Token-2022 and that the member extension names the mint itself. Only the group's update authority can make a mint a member of the group; anyone can point a mint's metadata anywhere, so the member check is the one that matters.

Token-2022 mint bytes: the 82-byte base mint, padding to 165, the account-type byte at 165 (`1` = mint), then TLV entries from 166 (`u16` type, `u16` length, value). Types used: 18 MetadataPointer (authority 32, metadata address 32); 23 TokenGroupMember (mint 32, group 32, member number `u64`).

**Where the fixtures come from.** Every address below was read on mainnet, read-only, while this plan was written (2026-10-01), on `https://api.mainnet-beta.solana.com`:
- `getSignaturesForAddress(GT22s89n…)` gave the newest finalized Genesis tx then, `4M7Rg5VWLnqvxViDjDob9n7v9r8Y3Tv5RQCkgXELrRLj5rvBPWgP8WkZgZzTRXJyJXMkXuoSZnrFKA67KcZzKSLG` (slot 452360249). It minted the member mint `HAF57K9jMt61dZnQ5pqwNeuBgfguSRNqXqiuNjaF1Vtr` into the token account `HD5kc21cYMU7NK9UoMHjbLMFWixziCTfJPisddUPhYma` of the wallet `sWM5jwoJwR7vVwheHVFp1eFectxQM2ze88cmiFFHp8t`.
- `getAccountInfo` on the member mint and the group mint (slot 452493334) and the token account (slot 452493336) gave the bytes below; `getTokenAccountsByOwner(sWM5…, { programId: Token-2022 })` and `(sWM5…, { mint: HAF57… })` both list that account with amount 1. The account is frozen (state 2) and the mint has a PermanentDelegate.
- The group mint's bytes change as members are added (its TokenGroup size grows); the tests read only what doesn't.

**Files:**
- Create: `engine/server/genesis.js`
- Create: `engine/test/fixtures/genesis-member-mint.json`, `engine/test/fixtures/genesis-group-mint.json`, `engine/test/fixtures/genesis-holder-account.json`
- Test: `engine/test/genesis.test.js`

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^engine: the XP ledger'; ls engine/server/genesis.js engine/test/genesis.test.js engine/test/fixtures/genesis-member-mint.json 2>&1 | grep -c 'No such file'`
Expected: `1`, `3`. Anything else: stop and report.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_E.

- [ ] **Step 1: Save the fixtures.**

Create `engine/test/fixtures/genesis-member-mint.json` (one line):

```json
{"pubkey":"HAF57K9jMt61dZnQ5pqwNeuBgfguSRNqXqiuNjaF1Vtr","owner":"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb","slot":452493334,"data":"AQAAAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGggbQhTCm9AQAAAAAAAAAAAQEAAADliqoXQL8nYdi6Lh6tJSsI62jSZGtIZojRoIG0IUwpvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARIAQADliqoXQL8nYdi6Lh6tJSsI62jSZGtIZojRoIG0IUwpveWJkm0XmBofiHcH5IkGhI6YGUP+gVGTmnUrqnPiEJ7pDAAgAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGggbQhTCm9AwAgAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGggbQhTCm9FgBAAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGggbQhTCm98BkgyDpcx/aCxLS0/jbqn7aPRX5eSOtHfkDJ4tGKbS8XAEgA8BkgyDpcx/aCxLS0/jbqn7aPRX5eSOtHfkDJ4tGKbS/liZJtF5gaH4h3B+SJBoSOmBlD/oFRk5p1K6pz4hCe6enYAQAAAAAA"}

```

Create `engine/test/fixtures/genesis-group-mint.json` (one line):

```json
{"pubkey":"GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te","owner":"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb","slot":452493334,"data":"AQAAAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGggbQhTCm9AAAAAAAAAAAAAQEAAADliqoXQL8nYdi6Lh6tJSsI62jSZGtIZojRoIG0IUwpvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARIAQADliqoXQL8nYdi6Lh6tJSsI62jSZGtIZojRoIG0IUwpveWJkm0XmBofiHcH5IkGhI6YGUP+gVGTmnUrqnPiEJ7pFABAAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGggbQhTCm95YmSbReYGh+IdwfkiQaEjpgZQ/6BUZOadSuqc+IQnukDACAA5YqqF0C/J2HYui4erSUrCOto0mRrSGaI0aCBtCFMKb0TAKYA5YqqF0C/J2HYui4erSUrCOto0mRrSGaI0aCBtCFMKb3liZJtF5gaH4h3B+SJBoSOmBlD/oFRk5p1K6pz4hCe6RQAAABTZWVrZXIgR2VuZXNpcyBUb2tlbggAAABTZWVrZXJHVDoAAABodHRwczovL3IyLnNvbGFuYW1vYmlsZWRhcHBzdG9yZS5jb20vc2tyL3NndC1tZXRhZGF0YS5qc29uAAAAABUAUADliqoXQL8nYdi6Lh6tJSsI62jSZGtIZojRoIG0IUwpveWJkm0XmBofiHcH5IkGhI6YGUP+gVGTmnUrqnPiEJ7p7tgBAAAAAABAQg8AAAAAAA=="}

```

Create `engine/test/fixtures/genesis-holder-account.json` (one line):

```json
{"pubkey":"HD5kc21cYMU7NK9UoMHjbLMFWixziCTfJPisddUPhYma","owner":"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb","slot":452493336,"data":"8BkgyDpcx/aCxLS0/jbqn7aPRX5eSOtHfkDJ4tGKbS8M8Djr5G7PMH4bdJ7zCFskcMN6cvwlxLgWsIqgkXsuxQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgcAAAA="}

```

Check them: `cd engine && for f in member-mint group-mint holder-account; do node -e "const j=require('./test/fixtures/genesis-$f.json');console.log(j.pubkey, Buffer.from(j.data,'base64').length)"; done`
Expected:
```
HAF57K9jMt61dZnQ5pqwNeuBgfguSRNqXqiuNjaF1Vtr 450
GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te 592
HD5kc21cYMU7NK9UoMHjbLMFWixziCTfJPisddUPhYma 170
```

- [ ] **Step 2: Write the failing test.**

Create `engine/test/genesis.test.js`:

```js
// The Seeker Genesis check (server/genesis.js), against mainnet bytes saved in test/fixtures
// (getAccountInfo on api.mainnet-beta.solana.com, slots 452493334 and 452493336): a Genesis
// member mint, the Genesis group mint itself, and a holder's token account. The holder came
// from the newest finalized Genesis mint tx then (getSignaturesForAddress on the group mint:
// 4M7Rg5VW…, slot 452360249). See the plan's Task 5.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { GENESIS_GROUP, TOKEN_2022, findGenesis, isGenesisMint, mintExtensions } from "../server/genesis.js";

function fixture(name) {
  const j = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  return { pubkey: new PublicKey(j.pubkey), account: { owner: new PublicKey(j.owner), data: Buffer.from(j.data, "base64") } };
}
const member = fixture("genesis-member-mint");
const group = fixture("genesis-group-mint");
const holder = fixture("genesis-holder-account");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const WALLET = new PublicKey("sWM5jwoJwR7vVwheHVFp1eFectxQM2ze88cmiFFHp8t");

test("genesis: the fixtures are what they say", () => {
  assert.equal(member.pubkey.toBase58(), "HAF57K9jMt61dZnQ5pqwNeuBgfguSRNqXqiuNjaF1Vtr");
  assert.ok(group.pubkey.equals(GENESIS_GROUP));
  for (const f of [member, group, holder]) assert.ok(f.account.owner.equals(TOKEN_2022));
  assert.ok(new PublicKey(holder.account.data.subarray(0, 32)).equals(member.pubkey), "the holder's account is of the member mint");
  assert.ok(new PublicKey(holder.account.data.subarray(32, 64)).equals(WALLET));
  assert.equal(holder.account.data.readBigUInt64LE(64), 1n);
});

test("genesis: a Token-2022 mint's extensions, read from its TLV", () => {
  const ext = mintExtensions(member.account.data);
  assert.deepEqual([...ext.keys()], [18, 12, 3, 22, 23], "MetadataPointer, PermanentDelegate, MintCloseAuthority, GroupMemberPointer, TokenGroupMember");
  const m = ext.get(23);
  assert.equal(m.length, 72);
  assert.ok(new PublicKey(m.subarray(0, 32)).equals(member.pubkey));
  assert.ok(new PublicKey(m.subarray(32, 64)).equals(GENESIS_GROUP));
  assert.equal(m.readBigUInt64LE(64), 121065n, "its member number");
  assert.ok(new PublicKey(ext.get(18).subarray(32, 64)).equals(GENESIS_GROUP), "metadata at the group");
  assert.deepEqual([...mintExtensions(group.account.data).keys()], [18, 20, 3, 19, 21], "the group mint has no member extension");
  assert.equal(mintExtensions(Buffer.alloc(82)).size, 0, "a mint with no extensions");
  assert.equal(mintExtensions(holder.account.data).size, 0, "a token account isn't a mint");
});

test("genesis: a Genesis mint is Token-2022's, points its metadata at the group, and is a member of it", () => {
  assert.equal(isGenesisMint(member.pubkey, member.account), true);
  assert.equal(isGenesisMint(group.pubkey, group.account), false, "the group mint itself isn't a member");
  assert.equal(isGenesisMint(member.pubkey, { ...member.account, owner: TOKEN }), false, "not Token-2022's");
  assert.equal(isGenesisMint(Keypair.generate().publicKey, member.account), false, "the member extension names another mint");
  assert.equal(isGenesisMint(member.pubkey, null), false, "no account");
  const flip = (at) => {
    const data = Buffer.from(member.account.data);
    data[at] ^= 1;
    return { ...member.account, data };
  };
  // the MetadataPointer's value starts at 170 (metadata address at +32); the member's at 378 (group at +32)
  assert.ok(new PublicKey(member.account.data.subarray(202, 234)).equals(GENESIS_GROUP));
  assert.ok(new PublicKey(member.account.data.subarray(410, 442)).equals(GENESIS_GROUP));
  assert.equal(isGenesisMint(member.pubkey, flip(202)), false, "metadata pointed elsewhere");
  assert.equal(isGenesisMint(member.pubkey, flip(410)), false, "a member of another group");
});

test("genesis: findGenesis reads the wallet's Token-2022 accounts with a balance, then their mints", async () => {
  const other = Keypair.generate().publicKey;
  const tokenAccount = (mint, amount) => {
    const data = Buffer.from(holder.account.data);
    mint.toBuffer().copy(data, 0);
    data.writeBigUInt64LE(amount, 64);
    return { pubkey: Keypair.generate().publicKey, account: { ...holder.account, data } };
  };
  const asked = [];
  const chain = (accounts) => ({
    getTokenAccountsByOwner: async (owner, filter) => (assert.ok(owner.equals(WALLET) && filter.programId.equals(TOKEN_2022)), { value: accounts }),
    getMultipleAccountsInfo: async (keys) => {
      asked.push(keys.map((k) => k.toBase58()));
      return keys.map((k) => (k.equals(member.pubkey) ? member.account : k.equals(other) ? group.account : null));
    },
  });
  assert.deepEqual(await findGenesis(chain([holder, tokenAccount(other, 5n)]), WALLET), [member.pubkey.toBase58()]);
  assert.deepEqual(asked.pop().sort(), [member.pubkey.toBase58(), other.toBase58()].sort(), "each held mint read once");
  assert.deepEqual(await findGenesis(chain([tokenAccount(member.pubkey, 0n)]), WALLET), [], "a zero balance doesn't count");
  assert.equal(asked.length, 0, "and no mint is read");
  assert.deepEqual(await findGenesis(chain([holder, holder]), WALLET), [member.pubkey.toBase58()], "a mint in two accounts, once");
});
```

- [ ] **Step 3: Run it to see it fail.**

Run: `cd engine && node --test test/genesis.test.js 2>&1 | grep -E '^# (pass|fail)|Cannot find module'`
Expected: `Cannot find module` naming `server/genesis.js`.

- [ ] **Step 4: Write the check.**

Create `engine/server/genesis.js`:

```js
// The Seeker Genesis check (spec "Genesis perk"): does a wallet hold a Seeker Genesis Token?
// Solana Mobile's rule (docs.solanamobile.com, "Seeker Genesis Token"): a Token-2022 mint
// whose MetadataPointer's metadata address and whose TokenGroupMember's group are both the
// Genesis group mint; token accounts with a zero balance don't count. On top: the mint is
// Token-2022's, and its member extension names the mint itself. Only the group's update
// authority can make a mint a member, so that is the check that can't be faked. Read from
// raw bytes; nothing here sends.

import { PublicKey } from "@solana/web3.js";
import { tokenAmount } from "../src/layout.js";
import { accountsOf } from "./api.js";

export const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const GENESIS_GROUP = new PublicKey("GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te");

const BASE = 165; // a Token-2022 mint's base, padded to a token account's size
const MINT = 1; // the account-type byte at BASE
const METADATA_POINTER = 18; // authority 32, metadata address 32
const GROUP_MEMBER = 23; // mint 32, group 32, member number u64

/** A Token-2022 mint's extensions: Map type -> value bytes, in account order. Empty for
 *  anything that isn't a mint with extensions. */
export function mintExtensions(data) {
  const d = Buffer.from(data);
  const out = new Map();
  if (d.length <= BASE || d[BASE] !== MINT) return out;
  for (let i = BASE + 1; i + 4 <= d.length; ) {
    const type = d.readUInt16LE(i);
    const len = d.readUInt16LE(i + 2);
    if ((type === 0 && len === 0) || i + 4 + len > d.length) break; // padding, or cut short
    out.set(type, d.subarray(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

/** `acc` (an AccountInfo, or null) is the Seeker Genesis Token mint `mint` (a PublicKey). */
export function isGenesisMint(mint, acc) {
  if (!acc?.owner?.equals(TOKEN_2022)) return false;
  const ext = mintExtensions(acc.data);
  const pointer = ext.get(METADATA_POINTER);
  const member = ext.get(GROUP_MEMBER);
  if (!pointer || pointer.length < 64 || !member || member.length < 64) return false;
  const group = GENESIS_GROUP.toBuffer();
  return group.equals(pointer.subarray(32, 64)) && group.equals(member.subarray(32, 64)) && mint.toBuffer().equals(member.subarray(0, 32));
}

/** The Genesis mints `wallet` (a PublicKey) holds, base58: its Token-2022 accounts with a
 *  balance, each mint read once. */
export async function findGenesis(l1, wallet) {
  const { value } = await l1.getTokenAccountsByOwner(wallet, { programId: TOKEN_2022 });
  const held = value.filter((a) => tokenAmount(a.account.data) > 0n);
  const mints = [...new Set(held.map((a) => new PublicKey(a.account.data.subarray(0, 32)).toBase58()))];
  if (!mints.length) return [];
  const accs = await accountsOf(l1, mints.map((m) => new PublicKey(m)));
  return mints.filter((m, i) => isGenesisMint(new PublicKey(m), accs[i]));
}
```

- [ ] **Step 5: Run it to see it pass.**

Run: `cd engine && node --test test/genesis.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 4`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 4, `# fail 0`.

- [ ] **Step 6: Commit.**

```bash
git add engine/server/genesis.js engine/test/genesis.test.js engine/test/fixtures/genesis-member-mint.json engine/test/fixtures/genesis-group-mint.json engine/test/fixtures/genesis-holder-account.json && git commit -m "engine: the Seeker Genesis check: Token-2022 TLV read from raw bytes, metadata pointer and group member both at the Genesis group, zero balances skipped; tested on mainnet bytes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/genesis.js engine/test/genesis.test.js engine/test/fixtures/genesis-member-mint.json engine/test/fixtures/genesis-group-mint.json engine/test/fixtures/genesis-holder-account.json
```

---

### Task 6 [server/web]: The XP and Genesis routes

`GET /api/xp/<wallet>` and `POST /api/genesis` (shapes under "Server data shapes"). The Genesis route checks a Mooner sign-in with piece 5's `makeSessions(db, now).walletOf` (its Task 3 moves the sign-in code out of `makeSocialRoutes` into that export), so this task waits for it. The chain is read only until a wallet's claim is stored; after that the claim answers. The routes take `walletOf` as a parameter, so `main.js` (Task 8) decides where it comes from.

**Files:**
- Create: `engine/server/xproutes.js`
- Test: `engine/test/xproutes.test.js`

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^engine: the Seeker Genesis check'; git log --format=%s | grep -c '^engine: follows (POST /api/follow'; grep -c '^export function makeSessions' engine/server/social.js; ls engine/server/xproutes.js engine/test/xproutes.test.js 2>&1 | grep -c 'No such file'`
Expected: `1`, `1`, `1`, `2`. A `0` in the second or third line means piece 5 Task 3 isn't in: stop and report; don't start.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_E.

- [ ] **Step 1: Write the failing test.**

Create `engine/test/xproutes.test.js`:

```js
// XP over HTTP (server/xproutes.js): GET /api/xp/<wallet> and POST /api/genesis, on an
// in-memory Store, the server's sign-ins (social.js makeSessions) and a fake chain made of
// the Genesis fixtures (see genesis.test.js for where they come from).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Store } from "../server/store.js";
import { makeSessions } from "../server/social.js";
import { XpLedger } from "../server/xp.js";
import { makeXpRoutes } from "../server/xproutes.js";
import { POINTS } from "../src/xp.js";

const T = Date.UTC(2026, 9, 1, 12);
const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/genesis-${name}.json`, import.meta.url), "utf8"));
const MEMBER = fx("member-mint");
const HOLDER = fx("holder-account");
const wallet = () => Keypair.generate().publicKey;

/** A token account of the Genesis member mint, owned by `owner`, holding `amount`. */
function holding(owner, amount = 1n) {
  const data = Buffer.from(HOLDER.data, "base64");
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return { pubkey: wallet(), account: { owner: new PublicKey(HOLDER.owner), data } };
}

function rig({ held = new Map(), down = false } = {}) {
  const store = new Store(":memory:");
  const ledger = new XpLedger(store.db);
  const sessions = makeSessions(store.db, () => T);
  const heard = [];
  let reads = 0;
  const l1 = {
    getTokenAccountsByOwner: async (owner) => {
      reads++;
      if (down) throw new Error("rpc down");
      return { value: held.get(owner.toBase58()) ?? [] };
    },
    getMultipleAccountsInfo: async (keys) =>
      keys.map((k) => (k.toBase58() === MEMBER.pubkey ? { owner: new PublicKey(MEMBER.owner), data: Buffer.from(MEMBER.data, "base64") } : null)),
  };
  const routes = makeXpRoutes({ ledger, l1, walletOf: sessions.walletOf, onXp: (ws) => heard.push(...ws), now: () => T });
  const call = async (method, path, body = {}, ip = "1.1.1.1") => {
    const r = routes.find((x) => x.method === method && x.path.test(path));
    try {
      return { status: 200, json: (await r.handler({ params: path.match(r.path).groups ?? {}, body, ip })).json };
    } catch (e) {
      return { status: e.status, json: { error: e.message } };
    }
  };
  const token = (w) => sessions.issue(w.toBase58()).token;
  return { ledger, heard, call, token, reads: () => reads };
}

test("GET /api/xp/<wallet>: the wallet's row, zeros for a new one, 400 for a key that isn't a wallet", async () => {
  const r = rig();
  const a = wallet().toBase58();
  assert.deepEqual(await r.call("GET", `/api/xp/${a}`), { status: 200, json: r.ledger.row(a, T) });
  assert.equal((await r.call("GET", `/api/xp/${a}`)).json.total, 0);
  r.ledger.award(a, "kolLaunch", "p", T);
  assert.equal((await r.call("GET", `/api/xp/${a}`)).json.total, POINTS.kolLaunch.points);
  assert.deepEqual(await r.call("GET", `/api/xp/${"1".repeat(44)}`), { status: 400, json: { error: "wallet is not a Solana address" } });
});

test("POST /api/genesis: a holder gets the perk once; asking again reads nothing", async () => {
  const me = wallet();
  const r = rig({ held: new Map([[me.toBase58(), [holding(me)]]]) });
  assert.deepEqual(await r.call("POST", "/api/genesis", {}), { status: 401, json: { error: "sign in first" } });
  const first = await r.call("POST", "/api/genesis", { token: r.token(me) });
  assert.equal(first.status, 200);
  assert.deepEqual({ ...first.json, xp: undefined }, { wallet: me.toBase58(), genesis: { mint: MEMBER.pubkey, at: T }, fresh: true, xp: undefined });
  assert.equal(first.json.xp.total, POINTS.genesis.points);
  assert.deepEqual(first.json.xp.genesis, { mint: MEMBER.pubkey, at: T });
  assert.deepEqual(r.heard, [me.toBase58()], "the change is pushed");
  const again = await r.call("POST", "/api/genesis", { token: r.token(me) });
  assert.deepEqual([again.status, again.json.fresh, again.json.genesis], [200, false, { mint: MEMBER.pubkey, at: T }]);
  assert.equal(r.reads(), 1, "the stored claim answers");
  assert.deepEqual(r.heard, [me.toBase58()], "nothing new to push");
});

test("POST /api/genesis: another wallet with the same token is 409; none, a zero balance, or a chain that's down", async () => {
  const [me, other, none, zero] = [wallet(), wallet(), wallet(), wallet()];
  const held = new Map([[me.toBase58(), [holding(me)]], [other.toBase58(), [holding(other)]], [zero.toBase58(), [holding(zero, 0n)]]]);
  const r = rig({ held });
  assert.equal((await r.call("POST", "/api/genesis", { token: r.token(me) })).status, 200);
  const short = `${me.toBase58().slice(0, 4)}…${me.toBase58().slice(-4)}`;
  assert.deepEqual(await r.call("POST", "/api/genesis", { token: r.token(other) }), { status: 409, json: { error: `this Seeker's Genesis Token was already used by ${short}` } });
  assert.equal(r.ledger.row(other.toBase58(), T).total, 0);
  for (const w of [none, zero]) {
    assert.deepEqual(await r.call("POST", "/api/genesis", { token: r.token(w) }), { status: 404, json: { error: "no Seeker Genesis Token in this wallet" } });
  }
  const d = rig({ down: true });
  assert.deepEqual(await d.call("POST", "/api/genesis", { token: d.token(me) }), { status: 503, json: { error: "couldn't read this wallet's tokens, try again" } });
});

test("POST /api/genesis: 3 a minute per wallet, 10 per IP", async () => {
  const me = wallet();
  const r = rig({ held: new Map([[me.toBase58(), [holding(me)]]]) });
  for (let i = 0; i < 3; i++) assert.equal((await r.call("POST", "/api/genesis", { token: r.token(me) })).status, 200);
  assert.deepEqual(await r.call("POST", "/api/genesis", { token: r.token(me) }), { status: 429, json: { error: "too many Genesis checks from this wallet, try again later" } });
  const ip = "2.2.2.2";
  for (let i = 0; i < 10; i++) await r.call("POST", "/api/genesis", { token: r.token(wallet()) }, ip);
  assert.deepEqual(await r.call("POST", "/api/genesis", { token: r.token(wallet()) }, ip), { status: 429, json: { error: "too many Genesis checks, try again later" } });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test test/xproutes.test.js 2>&1 | grep -E '^# (pass|fail)|Cannot find module'`
Expected: `Cannot find module` naming `server/xproutes.js`.

- [ ] **Step 3: Write the routes.**

Create `engine/server/xproutes.js`:

```js
// XP over HTTP (spec "XP ledger", "Genesis perk"):
//
//   GET  /api/xp/<wallet>   -> the wallet's XP row (xp.js XpLedger.row)
//   POST /api/genesis       { token } -> { wallet, genesis: { mint, at }, fresh, xp }
//
// `token` is a Mooner sign-in (social.js /api/login, makeSessions). The Genesis check reads
// the chain only until the wallet's claim is stored; after that the claim answers. One
// Seeker's token gives the perk to one wallet (XpLedger.claimGenesis). Nothing here sends.

import { PublicKey } from "@solana/web3.js";
import { HttpError, Limiter, limit } from "./http.js";
import { parseKey } from "./api.js";
import { findGenesis } from "./genesis.js";

const KEY = "(?<key>[1-9A-HJ-NP-Za-km-z]{32,44})";

export const XP_LIMITS = {
  genesisPerIp: [10, 60_000],
  genesisPerWallet: [3, 60_000],
};

const short = (w) => `${w.slice(0, 4)}…${w.slice(-4)}`;

/** `ledger`: XpLedger. `l1`: a Connection (reads only). `walletOf(token)`: the wallet of a
 *  Mooner sign-in, or a 401 (makeSessions). `onXp(wallets)`: their rows changed. */
export function makeXpRoutes({ ledger, l1, walletOf, onXp = () => {}, limits = XP_LIMITS, now = Date.now }) {
  const L = Object.fromEntries(Object.entries({ ...XP_LIMITS, ...limits }).map(([k, [max, ms]]) => [k, new Limiter(max, ms, now)]));
  const answer = (wallet, claim) => ({ json: { wallet, genesis: { mint: claim.mint, at: claim.at }, fresh: claim.fresh, xp: ledger.row(wallet, now()) } });

  async function genesis({ body, ip }) {
    limit(L.genesisPerIp, ip, "Genesis checks");
    const wallet = walletOf(body.token);
    limit(L.genesisPerWallet, wallet, "Genesis checks from this wallet");
    const had = ledger.genesisOf(wallet);
    if (had) return answer(wallet, { ...had, fresh: false });
    let mints;
    try {
      mints = await findGenesis(l1, new PublicKey(wallet));
    } catch (e) {
      // the cause goes to the server's log (http.js logs an HttpError's `cause`)
      throw Object.assign(new HttpError(503, "couldn't read this wallet's tokens, try again"), { cause: e });
    }
    if (!mints.length) throw new HttpError(404, "no Seeker Genesis Token in this wallet");
    let taken = null;
    for (const mint of mints) {
      const claim = ledger.claimGenesis(mint, wallet, now());
      if (claim.taken) {
        taken ??= claim.taken;
        continue;
      }
      if (claim.fresh) {
        try {
          onXp([wallet]);
        } catch {
          // the claim is saved; a push that failed reaches clients at their next snapshot
        }
      }
      return answer(wallet, claim);
    }
    throw new HttpError(409, `this Seeker's Genesis Token was already used by ${short(taken)}`);
  }

  return [
    { method: "GET", path: new RegExp(`^/api/xp/${KEY}$`), handler: async ({ params }) => ({ json: ledger.row(parseKey(params.key, "wallet").toBase58(), now()) }) },
    { method: "POST", path: /^\/api\/genesis$/, body: 1_024, handler: genesis },
  ];
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `cd engine && node --test test/xproutes.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 4`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 4, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add engine/server/xproutes.js engine/test/xproutes.test.js && git commit -m "engine: GET /api/xp/<wallet> and POST /api/genesis (a Mooner sign-in; the chain read until the claim is stored; one Seeker's token, one wallet)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/xproutes.js engine/test/xproutes.test.js
```

---

### Task 7 [server/web]: XP rows on `profiles`; the feed says which coins migrated

The `profiles` topic keeps its picture snapshot and upserts as they are, and adds the `xp` type (shapes under "Server data shapes"). The feed gets the board from a function it is handed (`xpBoard`, `XpLedger.board` in `main.js`), so it needs no ledger of its own; with none (every existing test), nothing changes. `isMigrated(mint)` tells the XP catch-up (Task 3, wired in Task 8) what the feed read of each coin's DBC pool at start, so the catch-up reads nothing itself.

Piece 5 Task 5 edits `feed.js` and `live.test.js` too. This task waits for it and anchors only on text that task leaves as it is, plus one line it adds (the `follows:<wallet>` header line).

**Files:**
- Modify: `engine/server/feed.js` (the header, the constructor, `snapshot`, two methods before `status`)
- Test: `engine/test/live.test.js` (three tests appended at the end)

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^engine: the feed hands its listeners'; git log --format=%s | grep -c '^engine: the XP ledger'; git diff --quiet HEAD -- engine/server/feed.js engine/test/live.test.js && echo clean`
Expected: `1`, `1`, `clean`. A `0` in the first line means piece 5 Task 5 isn't in: stop and report; don't start.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_E.

- [ ] **Step 1: Write the failing tests.**

Append to `engine/test/live.test.js` (`startLive`, `launchedCoin`, `dbcPool`, `on`, `until`, `wait`, `DBC` and `Keypair` are already in the file):

```js

test("profiles: XP rows after the pictures, the board on sub, then the rows that change", async () => {
  const board = [{ wallet: "A", total: 100 }];
  const s = await startLive({ feed: { xpBoard: () => board } });
  const c = await s.client();
  try {
    c.sub("profiles");
    assert.deepEqual((await c.next(on("profiles", "xp"))).data, board);
    assert.deepEqual((await c.next(on("profiles", "snapshot"))).data, {}, "the pictures came first, as before");
    s.feed.xpChanged([{ wallet: "B", total: 25 }]);
    assert.deepEqual((await c.next(on("profiles", "xp"))).data, [{ wallet: "B", total: 25 }]);
    s.feed.xpChanged([]);
    await wait(50);
    assert.equal(c.got.filter(on("profiles", "xp")).length, 0, "no rows, no message");
  } finally {
    c.close();
    await s.close();
  }
});

test("profiles: a feed with no XP board sends the pictures only", async () => {
  const s = await startLive();
  const c = await s.client();
  try {
    c.sub("profiles");
    await c.next(on("profiles", "snapshot"));
    await wait(50);
    assert.equal(c.got.filter(on("profiles", "xp")).length, 0);
  } finally {
    c.close();
    await s.close();
  }
});

test("isMigrated: what the feed read of each coin's DBC pool at start, then each flip", async () => {
  let old;
  let fresh;
  const s = await startLive({
    before: ({ l1, store }) => {
      old = launchedCoin(l1, store, { migrated: true });
      fresh = launchedCoin(l1, store);
    },
  });
  try {
    assert.equal(s.feed.isMigrated(old.mint.toBase58()), true, "migrated while the server was down");
    assert.equal(s.feed.isMigrated(fresh.mint.toBase58()), false);
    assert.equal(s.feed.isMigrated(Keypair.generate().publicKey.toBase58()), false, "not a coin of ours");
    s.l1.write(fresh.pool, DBC, dbcPool(true));
    await until(() => s.feed.isMigrated(fresh.mint.toBase58()));
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd engine && node --test --test-name-pattern='XP rows|no XP board|isMigrated' test/live.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 1`, `# fail 2` (the no-board test already passes; the others find no `xp` message and no `isMigrated`).

- [ ] **Step 3: Change the feed.**

Apply these 5 blocks to `engine/server/feed.js`, in order.

Replace (the line piece 5 Task 5 added to the header):

```js
//   - who a wallet follows and who follows it, as that changes: `follows:<wallet>`
```

with:

```js
//   - who a wallet follows and who follows it, as that changes: `follows:<wallet>`
//   - XP rows (xp.js) on `profiles` too, type "xp": the board after the pictures, then the
//     rows that change (xpChanged)
```

In the constructor, replace this text, which starts mid-line (keep the start of that line as it is):

```js
statsConn, now = Date.now, log = console.log }) {
    super({ captureRejections: true });
    Object.assign(this, { reads, l1, ers, pid, dbcConfig, store, db, solFeed, paceMs, poolPaceMs, retryMs, maxWallets, statsMs, dammTries, fetch, now, log });
```

with:

```js
statsConn, xpBoard = null, now = Date.now, log = console.log }) {
    super({ captureRejections: true });
    Object.assign(this, { reads, l1, ers, pid, dbcConfig, store, db, solFeed, paceMs, poolPaceMs, retryMs, maxWallets, statsMs, dammTries, fetch, xpBoard, now, log });
```

and, at the end of the constructor's doc comment, replace:

```js
   * again the next time the DBC pool changes (or at the next start).
   */
```

with:

```js
   * again the next time the DBC pool changes (or at the next start). `xpBoard()`: the XP
   * rows sent after the pictures on `profiles` (XpLedger.board), or null for none.
   */
```

In `snapshot`, replace:

```js
      if (topic === "profiles") return send({ type: "snapshot", data: allProfiles(this.db) });
```

with:

```js
      if (topic === "profiles") {
        send({ type: "snapshot", data: allProfiles(this.db) });
        if (this.xpBoard) send({ type: "xp", data: this.xpBoard() });
        return;
      }
```

Replace:

```js
  /** What the feed is watching and what it heard, for /api/health. */
```

with:

```js
  /** Wallets' XP rows changed (xprules.js, xproutes.js): to everyone on `profiles`. */
  xpChanged(rows) {
    if (rows.length) this.publish("profiles", { type: "xp", data: rows });
  }

  /** The feed read `mint`'s DBC pool as migrated (at start, or a flip since). */
  isMigrated(mint) {
    return this.pools.get(mint)?.migrated === true;
  }

  /** What the feed is watching and what it heard, for /api/health. */
```

- [ ] **Step 4: Run them to see them pass.**

Run: `cd engine && node --test --test-name-pattern='XP rows|no XP board|isMigrated' test/live.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 3`, `# fail 0`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 3, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git add engine/server/feed.js engine/test/live.test.js && git commit -m "engine: XP rows ride profiles (type xp: the board after the pictures, then the rows that change); the feed says which coins migrated

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/feed.js engine/test/live.test.js
```


---

### Task 8 [server/web]: The server runs it; the API client

`main.js` makes the ledger, hands the feed its board, and starts the rules. A launch comes from the keeper, a migration from the feed's `migrated` event, and the catch-up runs once the feed has read its pools. `main.js` also hands the co-sign route the rules (Task 4) and serves the XP and Genesis routes with the same Mooner sign-in as chat and follows. The API client gets `xp(wallet)` and `genesis(token)`, which both the web and the phone use.

Piece 5 Task 7 edits `main.js`, `apiclient.js` and `apiclient.test.js` too, so this task waits for it. Its anchors here are lines that task leaves as they are (the `social.js` import, the `Feed` line, the keeper's `onLaunch`, `keeper, feed, reads,`, the `makeAppLinkRoutes` line, `await feed.start(hub);`), plus one line it adds (`unfollow:` in `apiclient.js`).

**Files:**
- Modify: `engine/server/main.js` (imports, the ledger and rules after the `Feed` line, the keeper's `onLaunch`, `makeRoutes`' `xp`, the routes chain, the catch-up after the feed starts)
- Modify: `engine/src/apiclient.js` (two calls after `unfollow:`)
- Test: `engine/test/apiclient.test.js` (one test appended at the end)

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^engine: the server runs the notifier'; git log --format=%s | grep -c '^engine: XP rules: a launch gives'; git log --format=%s | grep -c '^engine: each confirmed join or open is a streak day'; git log --format=%s | grep -c '^engine: GET /api/xp/<wallet> and POST /api/genesis'; git log --format=%s | grep -c '^engine: XP rows ride profiles'; git diff --quiet HEAD -- engine/server/main.js engine/src/apiclient.js engine/test/apiclient.test.js && echo clean`
Expected: `1` five times, then `clean`. A `0` in the first line means piece 5 Task 7 isn't in: stop and report; don't start.

Run: `cd engine && grep -c 'unfollow: async (token, wallet)' src/apiclient.js; grep -c '^import { makeSocialRoutes } from "./social.js";$' server/main.js`
Expected: `1`, `1`.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_E.

- [ ] **Step 1: Write the failing test.**

Append to `engine/test/apiclient.test.js` (`fakeFetch`, `makeApi`, `test` and `assert` are already in the file):

```js

test("xp reads a wallet's row with a GET; genesis posts the sign-in", async () => {
  const row = { wallet: "W", total: 250, genesis: { mint: "M", at: 1 } };
  const f = fakeFetch([[200, row], [200, { wallet: "W", genesis: { mint: "M", at: 1 }, fresh: true, xp: row }]]);
  const api = makeApi("https://app.mooner.family", f);
  assert.deepEqual(await api.xp("W"), row);
  assert.equal(f.calls[0].url, "https://app.mooner.family/api/xp/W");
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.body, undefined);
  assert.deepEqual(await api.genesis("T"), { wallet: "W", genesis: { mint: "M", at: 1 }, fresh: true, xp: row });
  assert.equal(f.calls[1].url, "https://app.mooner.family/api/genesis");
  assert.equal(f.calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { token: "T" });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test --test-name-pattern='xp reads a wallet' test/apiclient.test.js 2>&1 | grep -E '^# (pass|fail)|is not a function'`
Expected: `# fail 1`, with `api.xp is not a function`.

- [ ] **Step 3: Add the client calls.**

Apply this block to `engine/src/apiclient.js`.

Replace:

```js
    unfollow: async (token, wallet) => (await call("POST", "/api/unfollow", { token, wallet })).json,
```

with:

```js
    unfollow: async (token, wallet) => (await call("POST", "/api/unfollow", { token, wallet })).json,
    // XP and the Seeker Genesis check (server/xproutes.js)
    xp: async (wallet) => (await call("GET", `/api/xp/${wallet}`)).json,
    genesis: async (token) => (await call("POST", "/api/genesis", { token })).json,
```

- [ ] **Step 4: Run it to see it pass.**

Run: `cd engine && node --test test/apiclient.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 0`.

- [ ] **Step 5: Run the rules and the routes in the server.**

Apply these 6 blocks to `engine/server/main.js`, in order. The second block replaces the whole `const feed = new Feed({ … });` line. The third, fourth and fifth start and end inside a line (keep the rest of that line as it is). Piece 5 Task 7's notifier sits between the `Feed` line and `const keeper = new Keeper({`; it stays there, after the rules.

Replace:

```js
import { makeSocialRoutes } from "./social.js";
```

with:

```js
import { makeSessions, makeSocialRoutes } from "./social.js";
import { Referrals } from "./referrals.js";
import { XpLedger } from "./xp.js";
import { XpRules, holds, openSeats, readLaunch } from "./xprules.js";
import { makeXpRoutes } from "./xproutes.js";
```

Replace:

```js
const feed = new Feed({ reads, l1: ctx.l1, ers: ctx.bot.ers, pid: cfg.pid, dbcConfig: cfg.dbcConfig, store: ctx.store, db: ctx.store.db, log: (m) => log(`live ${m}`) });
```

with:

```js
// XP (xp.js, xprules.js): the ledger in the server's db, the board on `profiles`
const ledger = new XpLedger(ctx.store.db);
const feed = new Feed({
  reads, l1: ctx.l1, ers: ctx.bot.ers, pid: cfg.pid, dbcConfig: cfg.dbcConfig, store: ctx.store, db: ctx.store.db,
  xpBoard: () => ledger.board(500, Date.now()), log: (m) => log(`live ${m}`),
});
const xpPush = (wallets) => feed.xpChanged(ledger.rows(wallets, Date.now()));
const rules = new XpRules({
  ledger, referrals: new Referrals(ctx.store.db),
  readLaunch: (presale) => readLaunch(ctx.bot, ctx.l1, presale),
  openSeats: (presale) => openSeats(ctx.bot, presale),
  holds: (wallet, mint) => holds(ctx.l1, wallet, mint),
  launches: () => ctx.store.launches(100_000), isMigrated: (mint) => feed.isMigrated(mint),
  onChange: xpPush, log: (m) => log(`xp ${m}`),
});
feed.on("migrated", (row) => rules.migrated(row.presale).catch((e) => log(`xp: migrated ${row.presale}: ${e?.message ?? e}`)));
```

Replace this text, which sits inside a line:

```js
onLaunch: (presale) => feed.launched(presale),
```

with:

```js
onLaunch: (presale) => {
    feed.launched(presale);
    rules.launched(presale.toBase58()).catch((e) => log(`xp: launched ${presale.toBase58()}: ${e?.message ?? e}`));
  },
```

Replace this text, which sits inside a line:

```js
keeper, feed, reads,
```

with:

```js
keeper, feed, xp: rules, reads,
```

Replace this text, which sits inside a line:

```js
.concat(makeAppLinkRoutes({ certs: cfg.androidCerts }))
```

with:

```js
.concat(makeAppLinkRoutes({ certs: cfg.androidCerts })).concat(makeXpRoutes({
  ledger, l1: ctx.l1, walletOf: makeSessions(ctx.store.db).walletOf, onXp: xpPush,
}))
```

Replace:

```js
await feed.start(hub);
```

with:

```js
await feed.start(hub);
// what launched or migrated while the server was down (the feed has read its pools)
rules.catchUp().catch((e) => log(`xp: catch-up: ${e?.message ?? e}`));
```

- [ ] **Step 6: Check it.**

Run: `cd engine && node --check server/main.js && echo ok`
Expected: `ok`.

Run: `cd engine && grep -c 'concat(makeXpRoutes' server/main.js; grep -c 'xp: rules' server/main.js; grep -c 'rules.catchUp()' server/main.js`
Expected: `1`, `1`, `1`.

Run: `cd engine && node -e 'Promise.all(["./server/social.js","./server/referrals.js","./server/xp.js","./server/xprules.js","./server/xproutes.js"].map((f)=>import(f))).then(([s,r,x,xr,xo])=>console.log([s.makeSessions,s.makeSocialRoutes,r.Referrals,x.XpLedger,xr.XpRules,xr.holds,xr.openSeats,xr.readLaunch,xo.makeXpRoutes].map((f)=>typeof f).join(" ")))'`
Expected: `function` nine times (every name `main.js` now imports exists).

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 1, `# fail 0`.

The server isn't started here (no servers from this plan's steps); Task 11 deploys it, and its check reads `GET /api/xp/<wallet>` on the live server.

- [ ] **Step 7: Commit.**

```bash
git add engine/server/main.js engine/src/apiclient.js engine/test/apiclient.test.js && git commit -m "engine: the server runs XP: a launch from the keeper, a migration from the feed, a catch-up at start, streak days from the co-sign, the board on profiles, GET /api/xp and POST /api/genesis on the shared sign-in; the API client's xp and genesis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/server/main.js engine/src/apiclient.js engine/test/apiclient.test.js
```

---

### Task 9 [server/web]: Web titles: Dev in, Shiller out; the server's curve and counts

The site gets the server's four titles in the server's order: Dev, KOL, Raider, Diamond Hands. Shiller is gone. Its emblem's rocket goes to Dev and its nine unlockable traits too; Raider keeps the crossed swords and its own traits. `LEVEL_XP` moves to `engine/src/xp.js` (Task 1), and the site's `constants.ts` re-exports it, so there's one curve. The stats behind each title stop being demo numbers (followers, impressions, raids): they become the server's counts. Overall becomes the server's total, Genesis bonus included. "Presales joined" becomes "Presales launched", because that's what the counts know. Every user starts at zero here; Task 10 fills them from the `profiles` topic.

Piece 5 Task 14 edits `store.ts` and `PlayerCard.tsx`. This task waits for it and anchors only on lines it leaves as they are.

**Files:**
- Modify: `web/src/lib/types.ts` (`Title`, `TitleStats`, the new `UserXp`, `User.xp`)
- Modify: `web/src/lib/constants.ts` (`LEVEL_XP` from `engine/src/xp.js`; `XP_LIVE` and `XP_MIGRATION` out, nothing reads them)
- Modify: `web/src/lib/levels.ts` (the titles, names, measures, how-to, level names; `X_TITLES` out)
- Modify: `web/src/lib/leaderboard.ts` (`boardXp`, `presalesLaunched`, `migratedPct`, the key stats)
- Modify: `web/src/lib/profile.ts` (`titleStats`)
- Modify: `web/src/lib/pfp/traits.ts` (nine rows: `'shiller'` to `'dev'`)
- Modify: `web/src/lib/sim/personas.ts` (`TITLE_LINES` out: nothing in `web/src` reads it; `web/sim/` has its own copy and is left alone)
- Modify: `web/src/lib/store.ts` (`NO_STATS`, `NO_XP`, `person`)
- Modify: `web/src/components/badges/TitleEmblem.tsx` (Dev: the rocket)
- Modify: `web/src/components/badges/BadgesScreen.tsx` (the line saying scoring isn't live)
- Modify: `web/src/components/leaderboard/LeaderboardScreen.tsx` (the lede)
- Modify: `web/src/components/leaderboard/LeaderboardTable.tsx`, `web/src/components/profile/ProfileScreen.tsx`, `web/src/components/presale/PlayerCard.tsx` (`presalesLaunched`)
- Test: `web/tests/titles.test.mjs` (new, 4 tests)

- [ ] **Step 0: Check the base, and take the counts.**

Run: `git log --format=%s | grep -c '^engine: shared XP rules'; git log --format=%s | grep -c '^engine: the server runs XP'; git log --format=%s | grep -c '^web: Follow and Unfollow on a'; git diff --quiet HEAD -- web/src/lib web/src/components web/tests && echo clean`
Expected: `1`, `1`, `1`, `clean`. A `0` in the third line means piece 5 Task 14 isn't in: stop and report; don't start.

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/*.test.mjs 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_W.

Run (`$SCRATCH` is your scratchpad directory): `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep "error TS" > "$SCRATCH/p6-tsc-before.txt"; wc -l < "$SCRATCH/p6-tsc-before.txt"`
Expected: `55` (TSC_W). 54 are `TS2307` for a `.module.css` import and one is `TS2339` for `import.meta.env` in `src/main.tsx`.

- [ ] **Step 1: Write the failing tests.**

Create `web/tests/titles.test.mjs`:

```js
// The site's titles, level curve and stats are the server's (engine/src/xp.js): Dev, KOL,
// Raider, Diamond Hands; one curve; the counts behind each title; Overall is the total.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LEVEL_XP as ENGINE_LEVEL_XP, levelOf, POINTS, TITLES as ENGINE_TITLES } from '../../engine/src/xp.js'
import { LEVEL_XP } from '../src/lib/constants.ts'
import { boardXp, BOARDS, keyStat, migratedPct, presalesLaunched } from '../src/lib/leaderboard.ts'
import { levelForXp, TITLE_NAMES, TITLE_XP_HOWTO, TITLES } from '../src/lib/levels.ts'
import { titleStats } from '../src/lib/profile.ts'
import { DEFAULT_PFP, SLOTS, TRAITS, unlocksAt } from '../src/lib/pfp/traits.ts'

/** A player with these counts and XP (the shape the store builds from an XP row). */
function player({ counts, titles, total, genesis = null }) {
  return {
    id: 'W'.repeat(44),
    handle: 'WWWWWWWW',
    isBot: false,
    pfp: DEFAULT_PFP,
    titles: Object.fromEntries(TITLES.map((t) => [t, { xp: titles[t], level: levelForXp(titles[t]) }])),
    stats: {
      dev: { launched: counts.devLaunch, migrated: counts.devMigrate },
      kol: { launched: counts.kolLaunch, migrated: counts.kolMigrate },
      raider: { joins: counts.raiderJoin },
      diamond: { held: counts.diamondMigrate },
    },
    xp: { total, streak: { days: 0, best: 0, last: null }, genesis },
    history: [],
  }
}

test("the site's titles and level curve are the server's", () => {
  assert.deepEqual([...TITLES], ENGINE_TITLES)
  assert.deepEqual([...LEVEL_XP], ENGINE_LEVEL_XP)
  for (const xp of [0, 99, 100, 299, 300, 799, 800, 1999, 2000, 50_000]) assert.equal(levelForXp(xp), levelOf(xp), `${xp} XP`)
  assert.deepEqual(TITLES.map((t) => TITLE_NAMES[t]), ['Dev', 'KOL', 'Raider', 'Diamond Hands'])
  assert.deepEqual(BOARDS, ['overall', 'dev', 'kol', 'raider', 'diamond'])
})

test('how each title earns XP says the points the server gives', () => {
  const says = (t, ...reasons) => {
    for (const r of reasons) assert.ok(TITLE_XP_HOWTO[t].includes(`${POINTS[r].points} XP`), `${t}: ${r} (${POINTS[r].points} XP)`)
    assert.ok(!/coming later/i.test(TITLE_XP_HOWTO[t]), `${t} is live`)
  }
  says('dev', 'devLaunch', 'devMigrate')
  says('kol', 'kolLaunch', 'kolMigrate')
  says('raider', 'raiderJoin')
  says('diamond', 'diamondMigrate')
})

test('the stats are the counts; Overall is the total, the Genesis bonus included', () => {
  const u = player({
    counts: { devLaunch: 2, devMigrate: 1, kolLaunch: 3, kolMigrate: 1, raiderJoin: 4, diamondMigrate: 1 },
    titles: { dev: 400, kol: 125, raider: 100, diamond: 100 },
    total: 975,
    genesis: { mint: 'M'.repeat(44), at: 1 },
  })
  assert.equal(boardXp(u, 'overall'), 975)
  assert.equal(boardXp(u, 'dev'), 400)
  assert.equal(presalesLaunched(u), 5)
  assert.equal(migratedPct(u), 2 / 5)
  assert.deepEqual(
    BOARDS.filter((b) => b !== 'overall').map((b) => [keyStat(u, b).label, keyStat(u, b).value]),
    [['Launched', '2'], ['Backed', '3'], ['Link joins', '4'], ['Held to migration', '1']],
  )
  assert.deepEqual(titleStats(u, 'dev'), [
    { label: 'Presales launched', value: '2' },
    { label: 'Coins migrated', value: '1' },
  ])
  assert.deepEqual(titleStats(u, 'kol'), [
    { label: 'Presales backed', value: '3' },
    { label: 'Coins migrated', value: '1' },
  ])
  assert.deepEqual(titleStats(u, 'raider'), [{ label: 'Link joins', value: '4' }])
  assert.deepEqual(titleStats(u, 'diamond'), [{ label: 'Held to migration', value: '1' }])
  const none = player({
    counts: { devLaunch: 0, devMigrate: 0, kolLaunch: 0, kolMigrate: 0, raiderJoin: 0, diamondMigrate: 0 },
    titles: { dev: 0, kol: 0, raider: 0, diamond: 0 },
    total: 0,
  })
  assert.equal(presalesLaunched(none), 0)
  assert.equal(migratedPct(none), null)
})

test('every locked trait belongs to one of the four titles; Dev unlocks what Shiller did', () => {
  for (const slot of SLOTS) {
    for (const t of TRAITS[slot]) if (t.title) assert.ok(TITLES.includes(t.title), `${slot}.${t.id}: ${t.title}`)
  }
  const dev = [2, 3, 4, 5].flatMap((l) => unlocksAt('dev', l).map((t) => `${t.slot}.${t.id}`))
  assert.equal(dev.length, 9)
})
```

- [ ] **Step 2: Run them to see them fail.**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/titles.test.mjs 2>&1 | grep -E '^# (pass|fail)|does not provide'`
Expected: `# fail 1`, with `does not provide an export named 'presalesLaunched'` (the file doesn't load, so it counts as one failure).

- [ ] **Step 3: The types, the curve and the titles.**

Apply these 3 blocks to `web/src/lib/types.ts`, in order.

Replace:

```ts
export type Title = 'kol' | 'diamond' | 'shiller' | 'raider'
```

with:

```ts
export type Title = 'dev' | 'kol' | 'raider' | 'diamond'
```

Replace:

```ts
/** Demo stats per title (spec §4.1); later they come from X and on-chain data. */
export interface TitleStats {
  kol: { followers: number; engagementPct: number; callWinPct: number }
  diamond: { avgHoldHours: number; heldToMigrationPct: number; earlyDumps: number }
  shiller: { posts: number; impressions: number; topPostViews: number }
  raider: { raids: number; actionsPerRaid: number; replySpeedSec: number }
}
```

with:

```ts
/** What each title counted: the server's XP row `counts` (engine/server/xp.js). */
export interface TitleStats {
  /** Presales you opened that launched; their coins that migrated. */
  dev: { launched: number; migrated: number }
  /** Others' presales you put SOL in that launched; their coins that migrated. */
  kol: { launched: number; migrated: number }
  /** Wallets that joined through your link, put SOL in, and saw the presale launch. */
  raider: { joins: number }
  /** Coins that migrated while your wallet still held what their presale gave you. */
  diamond: { held: number }
}

/** A wallet's XP beyond its titles, from the server's XP row. */
export interface UserXp {
  /** Every point, the Genesis bonus included: the Overall board. */
  total: number
  /** UTC days in a row with a confirmed join or open; `last` is "YYYY-MM-DD", or null. */
  streak: { days: number; best: number; last: string | null }
  /** The wallet's Seeker Genesis Token, once its check passed. */
  genesis: { mint: string; at: number } | null
}
```

Replace:

```ts
  stats: TitleStats
  history: LaunchRecord[]
```

with:

```ts
  stats: TitleStats
  xp: UserXp
  history: LaunchRecord[]
```

Apply this block to `web/src/lib/constants.ts`.

Replace:

```ts
// Levels and XP (spec §4.2)
export const LEVEL_XP = [0, 100, 300, 800, 2000] as const
/** Diamond Hands XP when a presale you're in goes live. */
export const XP_LIVE = 80
/** Diamond Hands XP when a token you still hold migrates. */
export const XP_MIGRATION = 150
```

with:

```ts
// Levels and XP (spec §4.2): the curve the server and the phone use (engine/src/xp.js)
export { LEVEL_XP } from '../../../engine/src/xp.js'
```

Apply this block to `web/src/lib/levels.ts`. It replaces everything from the first line through the end of `LEVEL_NAMES`; the rest of the file (rarities, levels, `xpProgress`, `mainTitle`) stays as it is.

Replace:

```ts
// Titles, levels, XP and badge names (spec §4).
import { LEVEL_XP } from './constants'
import type { Level, Title, TitleProgress } from './types'

export const TITLES: readonly Title[] = ['kol', 'diamond', 'shiller', 'raider']

/** Titles that will be scored from X. */
export const X_TITLES: readonly Title[] = ['kol', 'shiller', 'raider']

export const TITLE_NAMES: Record<Title, string> = {
  kol: 'KOL',
  diamond: 'Diamond Hands',
  shiller: 'Shiller',
  raider: 'Raider',
}

export const TITLE_MEASURES: Record<Title, string> = {
  kol: 'Reach and how their calls perform',
  diamond: 'Conviction',
  shiller: 'Original content',
  raider: 'Coordinated engagement',
}

export const TITLE_XP_HOWTO: Record<Title, string> = {
  kol: 'Coming later: follower reach and call win rate from X, plus your Mooner launch history.',
  diamond: 'Coming later: XP when a presale you are in goes live, and more when a coin you still hold migrates.',
  shiller: 'Coming later: posts, impressions and top posts from X.',
  raider: 'Coming later: raids joined, actions per raid and reply speed from X.',
}

export const LEVEL_NAMES: Record<Title, readonly [string, string, string, string, string]> = {
  kol: ['Caller', 'Voice', 'Signal', 'Oracle', 'Prophet'],
  diamond: ['Stone', 'Iron', 'Steel', 'Diamond', 'Moon'],
  shiller: ['Poster', 'Hypeman', 'Memelord', 'Storyteller', 'Mythmaker'],
  raider: ['Scout', 'Raider', 'Vanguard', 'Warlord', 'Legion'],
}
```

with:

```ts
// Titles, levels, XP and badge names (spec §4). The titles, the curve and the points are the
// server's (engine/src/xp.js); this file names them.
import { POINTS } from '../../../engine/src/xp.js'
import { LEVEL_XP } from './constants'
import type { Level, Title, TitleProgress } from './types'

/** The server's order (engine/src/xp.js TITLES): boards, badges and ties go by it. */
export const TITLES: readonly Title[] = ['dev', 'kol', 'raider', 'diamond']

export const TITLE_NAMES: Record<Title, string> = {
  dev: 'Dev',
  kol: 'KOL',
  raider: 'Raider',
  diamond: 'Diamond Hands',
}

export const TITLE_MEASURES: Record<Title, string> = {
  dev: 'Presales opened that launch and migrate',
  kol: 'Backing presales that launch and migrate',
  raider: 'Joins through your link',
  diamond: 'Holding to migration',
}

export const TITLE_XP_HOWTO: Record<Title, string> = {
  dev: `${POINTS.devLaunch.points} XP when a presale you opened launches, and ${POINTS.devMigrate.points} XP more when its coin migrates.`,
  kol: `${POINTS.kolLaunch.points} XP when someone else's presale you put SOL in launches, and ${POINTS.kolMigrate.points} XP more when its coin migrates.`,
  raider: `${POINTS.raiderJoin.points} XP for each wallet that joins through your link, puts SOL in, and sees the presale launch.`,
  diamond: `${POINTS.diamondMigrate.points} XP when a coin migrates and your wallet still holds the tokens its presale gave you.`,
}

export const LEVEL_NAMES: Record<Title, readonly [string, string, string, string, string]> = {
  dev: ['Builder', 'Shipper', 'Founder', 'Launcher', 'Moonmaker'],
  kol: ['Caller', 'Voice', 'Signal', 'Oracle', 'Prophet'],
  raider: ['Scout', 'Raider', 'Vanguard', 'Warlord', 'Legion'],
  diamond: ['Stone', 'Iron', 'Steel', 'Diamond', 'Moon'],
}
```

- [ ] **Step 4: The boards and the title cards read the counts.**

Apply these 5 blocks to `web/src/lib/leaderboard.ts`, in order.

Replace:

```ts
import { fmtCompact, roman } from './format'
```

with:

```ts
import { fmtNumber, roman } from './format'
```

Replace:

```ts
/** XP on a board: one title's XP, or the sum of all four for Overall. */
export function boardXp(u: User, board: Board): number {
  if (board !== 'overall') return u.titles[board].xp
  let sum = 0
  for (const t of TITLES) sum += u.titles[t].xp
  return sum
}
```

with:

```ts
/** XP on a board: one title's XP, or every point for Overall (the server's total, which
 *  counts the Genesis bonus too). */
export function boardXp(u: User, board: Board): number {
  return board === 'overall' ? u.xp.total : u.titles[board].xp
}
```

Replace:

```ts
/** Presales the user was in that launched or expired. */
export function presalesJoined(u: User): number {
  return u.history.length
}

/** Migrated ÷ launched, or null when nothing the user joined has launched yet. */
export function migratedPct(u: User): number | null {
  let launched = 0
  let migrated = 0
  for (const h of u.history) {
    if (h.outcome === 'expired') continue
    launched++
    if (h.outcome === 'migrated') migrated++
  }
  return launched === 0 ? null : migrated / launched
}
```

with:

```ts
/** Presales the user opened or backed that launched (the server's counts). */
export function presalesLaunched(u: User): number {
  return u.stats.dev.launched + u.stats.kol.launched
}

/** Of those, the share whose coin migrated; null while none launched. */
export function migratedPct(u: User): number | null {
  const launched = presalesLaunched(u)
  return launched === 0 ? null : (u.stats.dev.migrated + u.stats.kol.migrated) / launched
}
```

Replace:

```ts
export const KEY_STAT_LABELS: Record<Board, string> = {
  overall: 'Main title',
  kol: 'Followers',
  diamond: 'Held to migration',
  shiller: 'Impressions',
  raider: 'Raids joined',
}
```

with:

```ts
export const KEY_STAT_LABELS: Record<Board, string> = {
  overall: 'Main title',
  dev: 'Launched',
  kol: 'Backed',
  raider: 'Link joins',
  diamond: 'Held to migration',
}
```

Replace:

```ts
    case 'kol':
      return fmtCompact(u.stats.kol.followers, 1)
    case 'diamond':
      return `${u.stats.diamond.heldToMigrationPct}%`
    case 'shiller':
      return fmtCompact(u.stats.shiller.impressions, 1)
    case 'raider':
      return String(u.stats.raider.raids)
```

with:

```ts
    case 'dev':
      return fmtNumber(u.stats.dev.launched, 0)
    case 'kol':
      return fmtNumber(u.stats.kol.launched, 0)
    case 'raider':
      return fmtNumber(u.stats.raider.joins, 0)
    case 'diamond':
      return fmtNumber(u.stats.diamond.held, 0)
```

Apply these 2 blocks to `web/src/lib/profile.ts`, in order. The second replaces the whole of `titleStats`.

Replace:

```ts
import { fmtCompact, fmtNumber } from './format'
```

with:

```ts
import { fmtNumber } from './format'
```

Replace:

```ts
/** The three demo stats on each title card (spec §4.1). */
export function titleStats(u: User, title: Title): KeyStat[] {
  switch (title) {
    case 'kol': {
      const s = u.stats.kol
      return [
        { label: 'Followers', value: fmtCompact(s.followers, 1) },
        { label: 'Engagement', value: `${s.engagementPct}%` },
        { label: 'Call win rate', value: `${s.callWinPct}%` },
      ]
    }
    case 'diamond': {
      const s = u.stats.diamond
      return [
        { label: 'Average hold', value: `${s.avgHoldHours}h` },
        { label: 'Held to migration', value: `${s.heldToMigrationPct}%` },
        { label: 'Early dumps', value: String(s.earlyDumps) },
      ]
    }
    case 'shiller': {
      const s = u.stats.shiller
      return [
        { label: 'Posts', value: fmtNumber(s.posts, 0) },
        { label: 'Impressions', value: fmtCompact(s.impressions, 1) },
        { label: 'Top post', value: `${fmtCompact(s.topPostViews, 1)} views` },
      ]
    }
    case 'raider': {
      const s = u.stats.raider
      return [
        { label: 'Raids joined', value: fmtNumber(s.raids, 0) },
        { label: 'Actions per raid', value: String(s.actionsPerRaid) },
        { label: 'Reply speed', value: `${s.replySpeedSec}s` },
      ]
    }
  }
}

```

with:

```ts
/** What each title card counts (the server's XP counts). */
export function titleStats(u: User, title: Title): KeyStat[] {
  const n = (v: number) => fmtNumber(v, 0)
  switch (title) {
    case 'dev':
      return [
        { label: 'Presales launched', value: n(u.stats.dev.launched) },
        { label: 'Coins migrated', value: n(u.stats.dev.migrated) },
      ]
    case 'kol':
      return [
        { label: 'Presales backed', value: n(u.stats.kol.launched) },
        { label: 'Coins migrated', value: n(u.stats.kol.migrated) },
      ]
    case 'raider':
      return [{ label: 'Link joins', value: n(u.stats.raider.joins) }]
    case 'diamond':
      return [{ label: 'Held to migration', value: n(u.stats.diamond.held) }]
  }
}
```

Shiller's nine traits go to Dev. Every one of those rows ends `'shiller'],`, so one substitution does them all:

Run: `perl -pi -e "s/, 'shiller'\],/, 'dev'],/" web/src/lib/pfp/traits.ts && grep -c "'shiller'" web/src/lib/pfp/traits.ts; grep -c ", 'dev'\]," web/src/lib/pfp/traits.ts`
Expected: `0`, then `9`.

Apply these 2 blocks to `web/src/lib/sim/personas.ts`, in order (`TITLE_LINES` and its `Title` import go).

Replace:

```ts
// Content banks for the simulator: bot handles, token ideas, and chat lines.
import type { Title } from '../types'
```

with:

```ts
// Content banks for the simulator: bot handles, token ideas, and chat lines.
```

Replace:

```ts
export const TITLE_LINES: Record<Title, readonly string[]> = {
  kol: [
    'calling it now: {t} migrates within the hour',
    'my timeline keeps asking about {t}',
    '{t} is my call of the day',
  ],
  diamond: [
    'not selling {t} till migration',
    'held {t} through the dip, still here',
    'paper hands left {t} early lol',
  ],
  shiller: [
    'new {t} meme dropping in 5',
    'wrote a thread on {t}, go like it',
    '{t} content is writing itself',
  ],
  raider: [
    'raid on {t} starts now, drop links',
    '{n} replies in 2 min on the {t} post',
    'raiders to {t}',
  ],
}

export const PRESALE_LINES: readonly string[] = [
```

with:

```ts
export const PRESALE_LINES: readonly string[] = [
```

Apply these 3 blocks to `web/src/lib/store.ts`, in order.

Replace:

```ts
  User, World,
} from './types'
```

with:

```ts
  User, UserXp, World,
} from './types'
```

Replace:

```ts
const NO_STATS: TitleStats = {
  kol: { followers: 0, engagementPct: 0, callWinPct: 0 },
  diamond: { avgHoldHours: 0, heldToMigrationPct: 0, earlyDumps: 0 },
  shiller: { posts: 0, impressions: 0, topPostViews: 0 },
  raider: { raids: 0, actionsPerRaid: 0, replySpeedSec: 0 },
}
```

with:

```ts
const NO_STATS: TitleStats = {
  dev: { launched: 0, migrated: 0 },
  kol: { launched: 0, migrated: 0 },
  raider: { joins: 0 },
  diamond: { held: 0 },
}
const NO_XP: UserXp = { total: 0, streak: { days: 0, best: 0, last: null }, genesis: null }
```

Replace:

```ts
    stats: NO_STATS,
    history: [],
```

with:

```ts
    stats: NO_STATS,
    xp: NO_XP,
    history: [],
```

The three screens that showed "Presales joined" read the new name; the profile and the player card say "Presales launched":

Run: `perl -pi -e 's/presalesJoined/presalesLaunched/g; s/label="Presales joined"/label="Presales launched"/' web/src/components/leaderboard/LeaderboardTable.tsx web/src/components/profile/ProfileScreen.tsx web/src/components/presale/PlayerCard.tsx && grep -c presalesLaunched web/src/components/leaderboard/LeaderboardTable.tsx web/src/components/profile/ProfileScreen.tsx web/src/components/presale/PlayerCard.tsx; grep -rn 'presalesJoined\|Presales joined' web/src`
Expected: `…LeaderboardTable.tsx:2`, `…ProfileScreen.tsx:2`, `…PlayerCard.tsx:2`; the second command prints nothing.

- [ ] **Step 5: The emblem and the copy.**

Apply this block to `web/src/components/badges/TitleEmblem.tsx`. Shiller's rocket-in-a-speech-bubble becomes Dev's rocket on its own, bigger, with two puffs behind it; Raider keeps the crossed swords.

Replace:

```tsx
    case 'shiller':
      // A rocket inside a speech bubble.
      return (
        <g>
          <path
            d="M6 4 H34 A4 4 0 0 1 38 8 V25 A4 4 0 0 1 34 29 H17 L9 36.5 V29 H6 A4 4 0 0 1 2 25 V8 A4 4 0 0 1 6 4 Z"
            fill={deep}
            fillOpacity="0.35"
            stroke={light}
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <g transform="rotate(40 20 16.5)">
            <path d="M20 6.5 C24 9.5 25 14.5 24 21 H16 C15 14.5 16 9.5 20 6.5 Z" fill={light} />
            <path d="M16 16.5 L12.5 22.5 L16 21 Z M24 16.5 L27.5 22.5 L24 21 Z" fill={light} />
            <path d="M17.5 21.5 L20 26.5 L22.5 21.5 Z" fill={base} />
            {!simple && <circle cx="20" cy="13" r="1.9" fill={deep} />}
          </g>
        </g>
      )
```

with:

```tsx
    case 'dev':
      // A rocket taking off.
      return (
        <g>
          <g transform="translate(20 20) rotate(40) scale(1.5) translate(-20 -16.5)">
            <path d="M20 6.5 C24 9.5 25 14.5 24 21 H16 C15 14.5 16 9.5 20 6.5 Z" fill={light} />
            <path d="M16 16.5 L12.5 22.5 L16 21 Z M24 16.5 L27.5 22.5 L24 21 Z" fill={light} />
            <path d="M17.5 21.5 L20 26.5 L22.5 21.5 Z" fill={base} />
            {!simple && <circle cx="20" cy="13" r="1.9" fill={deep} />}
          </g>
          {!simple && (
            <g fill={light} opacity="0.6">
              <circle cx="7" cy="34.5" r="2.4" />
              <circle cx="3.8" cy="37.2" r="1.6" />
            </g>
          )}
        </g>
      )
```

Apply this block to `web/src/components/badges/BadgesScreen.tsx`.

Replace:

```tsx
          Scoring isn&apos;t live yet: XP starts counting in a later update.
```

with:

```tsx
          XP counts from the chain as it happens: launches, migrations and joins through your link.
```

Apply this block to `web/src/components/leaderboard/LeaderboardScreen.tsx`.

Replace:

```tsx
          Everyone, ranked in public by XP. Before you join a presale, see who&apos;s behind it: KOLs who call
          winners, Diamond Hands who hold to migration, Shillers and Raiders who bring the crowd.
```

with:

```tsx
          Everyone, ranked in public by XP. Before you join a presale, see who&apos;s behind it: Devs whose presales
          launch, KOLs who back them, Raiders who bring the crowd, Diamond Hands who hold to migration.
```

- [ ] **Step 6: Run the tests and the type-check.**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/titles.test.mjs 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 4`, `# fail 0`.

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/*.test.mjs 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_W + 4, `# fail 0`. `pfp-pixels.test.mjs` still passes: a handle's Mooner is rolled from free traits only, which no title owns.

Run: `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep "error TS" > "$SCRATCH/p6-tsc-after.txt"; wc -l < "$SCRATCH/p6-tsc-after.txt"; diff <(sed -E 's/\([0-9]+,[0-9]+\)//' "$SCRATCH/p6-tsc-before.txt") <(sed -E 's/\([0-9]+,[0-9]+\)//' "$SCRATCH/p6-tsc-after.txt") && echo same`
Expected: `55` (TSC_W), then `same` (the `sed` drops line numbers, which move when a file gains lines). A new error naming `shiller`, `TitleStats`, `xp` or `presalesJoined` means a block above was missed.

Run: `grep -rn "shiller\|Shiller\|X_TITLES\|XP_LIVE\|XP_MIGRATION\|TITLE_LINES" web/src`
Expected: no output.

- [ ] **Step 7: Commit.**

```bash
git add web/src/lib/types.ts web/src/lib/constants.ts web/src/lib/levels.ts web/src/lib/leaderboard.ts web/src/lib/profile.ts web/src/lib/pfp/traits.ts web/src/lib/sim/personas.ts web/src/lib/store.ts web/src/components/badges/TitleEmblem.tsx web/src/components/badges/BadgesScreen.tsx web/src/components/leaderboard/LeaderboardScreen.tsx web/src/components/leaderboard/LeaderboardTable.tsx web/src/components/profile/ProfileScreen.tsx web/src/components/presale/PlayerCard.tsx web/tests/titles.test.mjs && git commit -m "web: the server's titles (Dev in, Shiller out: its rocket and traits go to Dev), its level curve and points; the stats are the server's counts, Overall its total, Presales launched

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- web/src/lib/types.ts web/src/lib/constants.ts web/src/lib/levels.ts web/src/lib/leaderboard.ts web/src/lib/profile.ts web/src/lib/pfp/traits.ts web/src/lib/sim/personas.ts web/src/lib/store.ts web/src/components/badges/TitleEmblem.tsx web/src/components/badges/BadgesScreen.tsx web/src/components/leaderboard/LeaderboardScreen.tsx web/src/components/leaderboard/LeaderboardTable.tsx web/src/components/profile/ProfileScreen.tsx web/src/components/presale/PlayerCard.tsx web/tests/titles.test.mjs
```

---

### Task 10 [server/web]: The site's players are the server's XP rows; the profile shows the streak and Genesis

The store keeps the XP rows the server pushes on `profiles` (the top 500 when the socket subscribes, then each change) and reads your own row once when your wallet comes, so your profile is right when you're outside the top 500. Every wallet with a row becomes a player, so the leaderboard is the server's board. A player's titles, counts and XP come from their row through one file, `web/src/lib/xp.ts`. The profile header loses "Connected to X" (there's no X link) and shows the streak, plus a Seeker Genesis mark for a wallet that passed the check.

The streak row says the run as of its last day. A row can be a day old when nobody acted since, so the site works out today's run itself: the row's run holds while its last day is today or yesterday (UTC), and is 0 after that.

**Files:**
- Create: `web/src/lib/xp.ts` (the row's shape; merge by wallet; titles, counts and XP from a row; the streak as of now)
- Modify: `web/src/lib/store.ts` (the `xp` push, the rows by wallet, `person` from a row, every row a player, your own row once)
- Modify: `web/src/components/profile/ProfileScreen.tsx` (the streak and Seeker Genesis instead of "Connected to X")
- Test: `web/tests/xp.test.mjs` (new, 3 tests)

- [ ] **Step 0: Check the base, and take the counts.**

Run: `git log --format=%s | grep -c "^web: the server's titles"; git log --format=%s | grep -c '^engine: the server runs XP'; ls web/src/lib/xp.ts web/tests/xp.test.mjs 2>&1 | grep -c 'No such file'; git diff --quiet HEAD -- web/src/lib/store.ts web/src/components/profile/ProfileScreen.tsx && echo clean`
Expected: `1`, `1`, `2`, `clean`. A `0` in either of the first two means Task 9 or Task 8 isn't in: stop and report; don't start.

Run: `cd web && grep -c "^        followOpening(now)$" src/lib/store.ts; grep -c 'Connected to X' src/components/profile/ProfileScreen.tsx; grep -c "xp: NO_XP," src/lib/store.ts`
Expected: `1`, `1`, `1`.

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/*.test.mjs 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_W.

Run (`$SCRATCH` is your scratchpad directory): `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep "error TS" > "$SCRATCH/p6-tsc-before10.txt"; wc -l < "$SCRATCH/p6-tsc-before10.txt"`
Expected: `55` (Task 9 left it there).

- [ ] **Step 1: Write the failing test.**

Create `web/tests/xp.test.mjs`:

```js
// The server's XP rows as the site reads them (src/lib/xp.ts): merged by wallet, turned into
// titles on the shared curve, counts and XP; the streak as of now.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeXp, statsOf, streakDays, streakLine, titlesOf, xpOf } from '../src/lib/xp.ts'

const A = 'A'.repeat(44)
const B = 'B'.repeat(44)
const DAY = 86_400_000
const at = (iso) => Date.parse(iso)

function row(wallet, over = {}) {
  return {
    wallet,
    total: 0,
    titles: { dev: 0, kol: 0, raider: 0, diamond: 0 },
    counts: { devLaunch: 0, devMigrate: 0, kolLaunch: 0, kolMigrate: 0, raiderJoin: 0, diamondMigrate: 0 },
    streak: { days: 0, best: 0, last: null },
    genesis: null,
    ...over,
  }
}

test('rows merge by wallet: a newer row replaces, none goes, junk is skipped; a one-off read keeps what pushes brought', () => {
  let m = mergeXp(new Map(), [row(A, { total: 100 }), row(B, { total: 25 })])
  m = mergeXp(m, [row(A, { total: 300 }), null, { total: 9 }, 'x'])
  assert.deepEqual([...m.keys()].sort(), [A, B])
  assert.equal(m.get(A).total, 300)
  assert.equal(m.get(B).total, 25)
  assert.equal(mergeXp(m, 'not a list').size, 2)
  const kept = mergeXp(m, [row(A, { total: 1 }), row('C'.repeat(44), { total: 5 })], true)
  assert.equal(kept.get(A).total, 300, 'the pushed row stays')
  assert.equal(kept.get('C'.repeat(44)).total, 5, 'a wallet it had no row for comes in')
})

test('a row is titles on the shared curve, the counts, and its total, streak and Genesis', () => {
  const r = row(A, {
    total: 1_150,
    titles: { dev: 300, kol: 99, raider: 2_000, diamond: 0 },
    counts: { devLaunch: 1, devMigrate: 1, kolLaunch: 3, kolMigrate: 0, raiderJoin: 80, diamondMigrate: 0 },
    streak: { days: 2, best: 4, last: '2026-10-01' },
    genesis: { mint: 'M'.repeat(44), at: 7 },
  })
  assert.deepEqual(titlesOf(r), {
    dev: { xp: 300, level: 3 },
    kol: { xp: 99, level: 1 },
    raider: { xp: 2_000, level: 5 },
    diamond: { xp: 0, level: 1 },
  })
  assert.deepEqual(statsOf(r), {
    dev: { launched: 1, migrated: 1 },
    kol: { launched: 3, migrated: 0 },
    raider: { joins: 80 },
    diamond: { held: 0 },
  })
  assert.deepEqual(xpOf(r), { total: 1_150, streak: { days: 2, best: 4, last: '2026-10-01' }, genesis: { mint: 'M'.repeat(44), at: 7 } })
})

test('the streak holds through the next UTC day and is gone the day after; the line says so', () => {
  const s = { days: 3, best: 5, last: '2026-10-01' }
  assert.equal(streakDays(s, at('2026-10-01T23:59:59Z')), 3)
  assert.equal(streakDays(s, at('2026-10-02T23:59:59Z')), 3, 'yesterday: still on')
  assert.equal(streakDays(s, at('2026-10-03T00:00:00Z')), 0, 'a whole day with none')
  assert.equal(streakLine(s, at('2026-10-02T12:00:00Z')), '3-day streak')
  assert.equal(streakLine(s, at('2026-10-04T00:00:00Z')), 'Best streak: 5 days')
  assert.equal(streakLine({ days: 0, best: 1, last: '2026-09-01' }, at('2026-10-04T00:00:00Z')), 'Best streak: 1 day')
  assert.equal(streakLine({ days: 0, best: 0, last: null }, 5 * DAY), 'No streak yet')
})
```

- [ ] **Step 2: Run it to see it fail.**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/xp.test.mjs 2>&1 | grep -E '^# (pass|fail)|ERR_MODULE_NOT_FOUND' | head -3`
Expected: a line with `ERR_MODULE_NOT_FOUND` for `web/src/lib/xp.ts`, and `# pass 0`.

- [ ] **Step 3: Write `web/src/lib/xp.ts`.**

Create `web/src/lib/xp.ts`:

```ts
// The server's XP rows (engine/server/xp.js; the `profiles` topic's "xp" messages and
// GET /api/xp/<wallet>) as the site's titles, stats and XP. One place reads the row's shape.
import { utcDay } from '../../../engine/src/xp.js'
import { levelForXp, TITLES } from './levels'
import type { Title, TitleProgress, TitleStats, UserXp } from './types'

/** One wallet's XP row, as the server sends it. */
export interface XpRow {
  wallet: string
  total: number
  titles: Record<Title, number>
  counts: { devLaunch: number; devMigrate: number; kolLaunch: number; kolMigrate: number; raiderJoin: number; diamondMigrate: number }
  streak: UserXp['streak']
  genesis: UserXp['genesis']
}

/** `rows` merged into `prev` by wallet: a row replaces that wallet's older one; no row goes.
 *  Anything without a wallet is skipped. `onlyNew`: keep the rows `prev` has (a one-off read
 *  must not undo a push that came while it was on its way). */
export function mergeXp(prev: ReadonlyMap<string, XpRow>, rows: unknown, onlyNew = false): Map<string, XpRow> {
  const next = new Map(prev)
  if (!Array.isArray(rows)) return next
  for (const r of rows) {
    if (!r || typeof r.wallet !== 'string' || (onlyNew && next.has(r.wallet))) continue
    next.set(r.wallet, r as XpRow)
  }
  return next
}

/** Each title's XP and its level on the shared curve. */
export function titlesOf(row: XpRow): Record<Title, TitleProgress> {
  return Object.fromEntries(
    TITLES.map((t) => {
      const xp = row.titles?.[t] ?? 0
      return [t, { xp, level: levelForXp(xp) }]
    }),
  ) as Record<Title, TitleProgress>
}

/** What each title counted. */
export function statsOf(row: XpRow): TitleStats {
  const c = row.counts
  return {
    dev: { launched: c.devLaunch, migrated: c.devMigrate },
    kol: { launched: c.kolLaunch, migrated: c.kolMigrate },
    raider: { joins: c.raiderJoin },
    diamond: { held: c.diamondMigrate },
  }
}

export function xpOf(row: XpRow): UserXp {
  return { total: row.total, streak: row.streak, genesis: row.genesis }
}

/** The run as of `now` (ms): the row's days while its last day is today or yesterday (UTC),
 *  else 0. A row the server sent before midnight can be a day behind. */
export function streakDays(s: UserXp['streak'], now: number): number {
  if (!s.last || s.days === 0) return 0
  return utcDay(now) - utcDay(Date.parse(`${s.last}T00:00:00Z`)) <= 1 ? s.days : 0
}

/** "3-day streak"; "Best streak: 5 days"; "No streak yet". */
export function streakLine(s: UserXp['streak'], now: number): string {
  const days = streakDays(s, now)
  if (days > 0) return `${days}-day streak`
  if (s.best > 0) return `Best streak: ${s.best} ${s.best === 1 ? 'day' : 'days'}`
  return 'No streak yet'
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/xp.test.mjs 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: The store keeps the rows; the profile shows the streak.**

The fourth block below starts and ends inside a line (keep the rest of it). Piece 5 Task 14's lines (`followFollows`, `followsOff`, `following`) sit near these and stay as they are. `api.xp` is Task 8's call in `engine/src/apiclient.js`; `readMyXp` reads once per wallet change and never on a timer (the rows after that come as pushes).

Apply these 8 blocks to `web/src/lib/store.ts`, in order.

Replace:

```ts
import { DEFAULT_PFP, handlePfp, sanitizePfp } from './pfp/traits'
```

with:

```ts
import { DEFAULT_PFP, handlePfp, sanitizePfp } from './pfp/traits'
import { mergeXp, statsOf, titlesOf, xpOf, type XpRow } from './xp'
```

Replace:

```ts
function person(id: string, pfp?: Pfp): User {
```

with:

```ts
/** A player: their Mooner, and their XP row's titles, counts and XP when the server sent one. */
function person(id: string, pfp?: Pfp, row?: XpRow): User {
```

Replace:

```ts
    titles: NO_TITLES,
    stats: NO_STATS,
    xp: NO_XP,
```

with:

```ts
    titles: row ? titlesOf(row) : NO_TITLES,
    stats: row ? statsOf(row) : NO_STATS,
    xp: row ? xpOf(row) : NO_XP,
```

Replace this text, which sits inside a line:

```ts
'snapshot' | 'upsert' | 'remove' | 'message' | 'missing' | 'error'
```

with:

```ts
'snapshot' | 'upsert' | 'remove' | 'message' | 'missing' | 'error' | 'xp'
```

Replace:

```ts
  let profiles: Record<string, Pfp> = {}
```

with:

```ts
  let profiles: Record<string, Pfp> = {}
  // XP rows by wallet: the board on `profiles`, its "xp" changes, and your own row
  let xpRows = new Map<string, XpRow>()
```

Replace:

```ts
      const user = (id: string) => (users[id] ??= person(id, profiles[id] && sanitizePfp(profiles[id])))
      user(meId)
```

with:

```ts
      const user = (id: string) => (users[id] ??= person(id, profiles[id] && sanitizePfp(profiles[id]), xpRows.get(id)))
      user(meId)
      for (const w of xpRows.keys()) user(w) // the leaderboard: everyone with XP
```

Replace:

```ts
        profiles = { ...profiles, [wallet]: pfp }
      } else return
      rebuild()
    }
```

with:

```ts
        profiles = { ...profiles, [wallet]: pfp }
      } else if (m.type === 'xp') xpRows = mergeXp(xpRows, m.data)
      else return
      rebuild()
    }

    /** Your XP row, read once when the wallet comes (the board on `profiles` holds the top
     *  500 only); pushes after that keep it. A row a push brought first stays. */
    function readMyXp(wallet: string | null) {
      if (!wallet) return
      api.xp(wallet).then(
        (row: XpRow) => {
          xpRows = mergeXp(xpRows, [row], true)
          if (me() === wallet) rebuild()
        },
        () => {},
      )
    }
```

Replace:

```ts
        followOpening(now)
```

with:

```ts
        followOpening(now)
        readMyXp(now)
```

Apply these 4 blocks to `web/src/components/profile/ProfileScreen.tsx`, in order.

Replace:

```tsx
import { userByHandle } from '@/lib/selectors'
```

with:

```tsx
import { userByHandle } from '@/lib/selectors'
import { streakLine } from '@/lib/xp'
```

Replace:

```tsx
      <ProfileHeader u={u} me={me} rank={ranks.overall.get(u.id)} players={ranks.overall.size} />
```

with:

```tsx
      <ProfileHeader u={u} me={me} rank={ranks.overall.get(u.id)} players={ranks.overall.size} now={world.now} />
```

Replace:

```tsx
  players: number
}

function ProfileHeader({ u, me, rank, players }: ProfileHeaderProps) {
```

with:

```tsx
  players: number
  now: number
}

function ProfileHeader({ u, me, rank, players, now }: ProfileHeaderProps) {
```

Replace:

```tsx
          <span className={styles.fact}>
            <Icon name="x" size={12} />
            Connected to X
          </span>
```

with:

```tsx
          <span className={styles.fact}>
            <Icon name="clock" size={12} />
            {streakLine(u.xp.streak, now)}
          </span>
          {u.xp.genesis && (
            <span className={styles.fact} title="Holds a Seeker Genesis token, checked on chain">
              <Icon name="check" size={12} />
              Seeker Genesis
            </span>
          )}
```

- [ ] **Step 6: Run the tests, the type-check and a build.**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/*.test.mjs 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_W + 3, `# fail 0`.

Run: `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep "error TS" > "$SCRATCH/p6-tsc-after10.txt"; wc -l < "$SCRATCH/p6-tsc-after10.txt"; diff <(sed -E 's/\([0-9]+,[0-9]+\)//' "$SCRATCH/p6-tsc-before10.txt") <(sed -E 's/\([0-9]+,[0-9]+\)//' "$SCRATCH/p6-tsc-after10.txt") && echo same`
Expected: `55`, then `same`. (`ProfileScreen.tsx`'s `.module.css` error moves down a line with the new import; the `sed` drops line numbers.)

Build the site into your scratchpad, not `web/dist`. Vite reads `web/.env` for the Privy id itself; don't open that file.

Run: `cd web && npx vite build --outDir "$SCRATCH/p6-dist" --emptyOutDir 2>&1 | tail -1; grep -l 'Seeker Genesis' "$SCRATCH"/p6-dist/assets/*.js | wc -l; grep -l 'Connected to X' "$SCRATCH"/p6-dist/assets/*.js | wc -l`
Expected: a line starting `✓ built in`, then `1`, then `0`. If the build throws `VITE_PRIVY_APP_ID is missing`, this checkout has no `web/.env`: skip the build, say so in your report, and go on (the tests and the type-check above stand).

Run: `rm -rf "$SCRATCH/p6-dist"`

- [ ] **Step 7: Commit.**

```bash
git add web/src/lib/xp.ts web/src/lib/store.ts web/src/components/profile/ProfileScreen.tsx web/tests/xp.test.mjs && git commit -m "web: the players are the server's XP rows (the board on profiles, each change, your own row once when the wallet comes); the profile shows the streak and Seeker Genesis instead of Connected to X

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- web/src/lib/xp.ts web/src/lib/store.ts web/src/components/profile/ProfileScreen.tsx web/tests/xp.test.mjs
```

---

### Task 11 [server/web] (USER STEP): Deploy; then the agent checks the live server and site

The deploy ships HEAD: the server (`engine/src`, `engine/server`) and a `web/dist` built from the committed `web/`. So app.mooner.family serves the new XP routes, the `profiles` board and the new site together. There's no new Railway variable. The ledger lives in the server's database, and the Genesis check reads the chain through the server's existing RPC connection (`ctx.l1`); the Genesis group's address is a constant in `engine/server/genesis.js` (Task 5).

The deploy also ships any piece 5 server tasks that are committed by then. Piece 5's own deploy step (its Task 15, USER STEP E) and its check still apply as written.

- [ ] **Step 0 (agent): Check what the deploy will ship.**

Run: `git log --format=%s | grep -c '^engine: the server runs XP'; git log --format=%s | grep -c "^web: the players are the server's XP rows"; git status --porcelain -- engine/src engine/server web/src web/tests | grep -c .`
Expected: `1`, `1`, `0`. A `0` in either of the first two means Task 8 or Task 10 isn't committed: stop and tell the user, since a deploy now would ship without it. A last number above `0` means uncommitted changes in those folders, which the deploy won't ship (it ships HEAD): list them for the user (`git status --short -- engine/src engine/server web/src web/tests`).

Run: `curl -s -m 15 -w ' %{http_code}\n' https://app.mooner.family/api/xp/11111111111111111111111111111111`
Expected, before the deploy: `{"error":"not found"} 404` (the live server doesn't have the route yet; checked on 2026-10-02 while writing this plan).

- [ ] **USER STEP: deploy the server.** Run `sh deploy/railway.sh app`.

- [ ] **Step 1 (agent): The XP routes are live.**

`11111111111111111111111111111111` is the System Program's address: a valid key that never has XP, so its row is all zeros.

Run: `curl -s -m 15 -w ' %{http_code}\n' https://app.mooner.family/api/xp/11111111111111111111111111111111`
Expected: `{"wallet":"11111111111111111111111111111111","total":0,"titles":{"dev":0,"kol":0,"raider":0,"diamond":0},"counts":{"devLaunch":0,"devMigrate":0,"kolLaunch":0,"kolMigrate":0,"raiderJoin":0,"diamondMigrate":0},"streak":{"days":0,"best":0,"last":null},"genesis":null} 200`. `{"error":"not found"} 404` means the deploy doesn't have Task 8: tell the user.

Run: `curl -s -m 15 -w ' %{http_code}\n' -X POST https://app.mooner.family/api/genesis -H 'content-type: application/json' -d '{}'`
Expected: `{"error":"sign in first"} 401`. Nothing is read from the chain without a sign-in.

- [ ] **Step 2 (agent): The board rides `profiles`.**

Run: `node -e 'const ws=new WebSocket("wss://app.mooner.family/api/ws");ws.onopen=()=>ws.send(JSON.stringify({op:"sub",topics:["profiles"]}));ws.onmessage=(e)=>{const m=JSON.parse(e.data);console.log(m.topic,m.type,Array.isArray(m.data)?m.data.length:"");if(m.type==="xp"){ws.close();process.exit(0)}};setTimeout(()=>{console.log("no xp message");process.exit(1)},15000)'`
Expected: `profiles snapshot`, then `profiles xp N`, where N is the number of wallets with XP (at most 500). After the deploy, the catch-up gives XP for past launches that still have their presale, so N is usually above 0; `0` is still a pass. `no xp message` means the deploy doesn't have Task 7: tell the user.

- [ ] **Step 3 (agent): The site, in the Browser pane.** Use the Browser pane tools (`navigate`, `get_page_text`). Don't sign in or click anything that sends.
  - `https://app.mooner.family/leaderboard`: the tabs read Overall, Dev, KOL, Raider, Diamond Hands; the page has no "Shiller"; the lede says "Devs whose presales launch".
  - `https://app.mooner.family/badges`: four titles, each with its XP points ("… XP"), and the line "XP counts from the chain as it happens"; no "coming later".
  - `https://app.mooner.family/profile/guest`: "No streak yet", no "Connected to X". With rows on the board, also open one player's profile from the leaderboard: the stats read "Presales launched" and "Migrated", and the streak line is one of "N-day streak", "Best streak: …" or "No streak yet".

  A page that still says "Shiller" or "Connected to X" is an old build: ask the user to hard-reload; if it stays, the deploy didn't ship Task 9 or Task 10.

Report what each step printed. Nothing to commit in this task.

---

## Phone tasks

Tasks 12-18 put XP on the phone. The store keeps the server's XP rows. Me shows your total, your four titles with their levels, your streak, and the Seeker Genesis check. A leaderboard screen lists the board with Follow on each row except your own. One task each touches the engine and the web: Task 12 moves the streak's screen rule into `engine/src/xp.js`, and Task 17 points the web at it.

Two choices, settled here:

- **The streak lives in `engine/src/xp.js` (Task 12), not in a phone copy.**
  - `streakDays` and `streakLine` move from `web/src/lib/xp.ts` (Task 10) into the shared file.
  - The phone imports them in Task 13. The web re-exports them in Task 17, so its imports and its tests stay as they are.
  - Why: one rule and one set of words, like the curve and the points. A copy would drift.
  - Task 17 is [web] and only re-points an import. Nothing on the phone waits for it.
- **The Genesis check shows for every connected wallet, and the server decides (Task 16).**
  - The app has no reliable way to know it runs on a Seeker:
    - `expo-device` isn't installed (`mobile/package.json`);
    - Mobile Wallet Adapter's answers carry no device details;
    - React Native's `Platform.constants` gives only Android's `Build.MODEL`, `BRAND` and `MANUFACTURER`. Their Seeker values are unknown, and any app can set them.
  - What counts is the token anyway. `POST /api/genesis` answers 404 `no Seeker Genesis Token in this wallet` for any wallet without one, and the phone shows that as it is.
  - Task 18 records the phone's `ro.product.model`, `ro.product.brand` and `ro.product.manufacturer`, for the open question at the end.

| Task | Track | Edits files piece 5 also edits? | Waits for (Step 0 checks it is in HEAD) |
|---|---|---|---|
| 12 The streak in the shared rules | phone (engine file) | no (`engine/src/xp.js`, appended; new `engine/test/xpstreak.test.js`) | Task 1 |
| 13 XP rows as the phone shows them | phone | no (new `mobile/src/xp/rows.js`, `mobile/test/xp.test.mjs`) | Task 12 |
| 14 The store keeps XP rows; the Genesis check | phone | `mobile/src/store.js`: piece 5 Task 8 changes its `loginName` line, which no block here touches, so either may land first | Task 13, Task 8 |
| 15 The leaderboard screen | phone | no (new `mobile/app/leaderboard.js`) | Task 14, **piece 5 Task 10** (`FollowButton`) |
| 16 XP and the Genesis check on Me | phone | `mobile/app/(tabs)/me.js` | Task 15, **piece 5 Task 13** (its `me.js` lines are this task's anchors) |
| 17 The web's streak from the shared rules | web | no (`web/src/lib/xp.ts`) | Task 10, Task 12 |
| 18 On the phone (the user present) | phone | – | Tasks 11, 16 |

How the phone half's waits are checked (each prints `1` when that task is in):

```bash
# this plan's Task 1, Task 8, Task 10
git log --format=%s | grep -c '^engine: shared XP rules'
git log --format=%s | grep -c '^engine: the server runs XP'
git log --format=%s | grep -c "^web: the players are the server's XP rows"
# piece 5 Task 10 (FollowButton), Task 13 (Following and Followers on Me)
git log --format=%s | grep -c "^mobile: Follow on a Mooner's card in the room"
git log --format=%s | grep -c '^mobile: who you follow and who follows you'
# this half's own tasks
git log --format=%s | grep -c '^engine: the streak as screens show it'
git log --format=%s | grep -c '^mobile: XP rows as the phone shows them'
git log --format=%s | grep -c '^mobile: the store keeps XP rows'
git log --format=%s | grep -c '^mobile: the leaderboard'
git log --format=%s | grep -c '^mobile: XP on Me'
```

A `0` means it isn't in: stop at Step 0 and report; don't start the task.

**Phone counts.** `BEFORE_M`: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`, taken at each phone task's Step 0 (`# fail 0` expected; take the real `# tests`). Screen files get piece 5's parse check (its ground rules, "Parse check"), run from `mobile/`.

**Phone files (the whole half):**
- `engine/src/xp.js`: append `streakDays`, `streakLine` (Task 12); test `engine/test/xpstreak.test.js` (new).
- `mobile/src/xp/rows.js` (new, Task 13): title names, the boards, merge by wallet, a row's titles, Me's numbers, a board's rows. Test `mobile/test/xp.test.mjs` (new).
- `mobile/src/store.js` (Task 14): `xp`, `xpLoaded`, `xpFailed`; the `xp` branch of `onProfiles`; `readXp` on a wallet change; `checkGenesis`; `forgetSignIn` (shared with `sendChat`). Tests appended to `mobile/test/store.test.mjs`.
- `mobile/app/leaderboard.js` (new, Task 15).
- `mobile/src/xp/MyXp.js` (new, Task 16): Me's XP card, its Leaderboard button and the Genesis check; `mobile/app/(tabs)/me.js` shows it.
- `web/src/lib/xp.ts` (Task 17): the streak re-exported from `engine/src/xp.js`.

---

### Task 12 [phone]: The streak in the shared rules

`streakDays` and `streakLine` as Task 10 wrote them in `web/src/lib/xp.ts`, moved into `engine/src/xp.js` so the phone and the web use one copy. They take the row's `streak` and `now`. A row's run holds while its last day is today or yesterday (UTC), else it's 0. The line reads "N-day streak", else "Best streak: N day(s)", else "No streak yet". Unlike the web's copy, they also take a row with no `streak` (a row cut short): that reads as none.

**Files:**
- Modify: `engine/src/xp.js` (appended)
- Test: `engine/test/xpstreak.test.js` (new, 2 tests)

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^engine: shared XP rules'; ls engine/test/xpstreak.test.js 2>&1 | grep -c 'No such file'; grep -c 'export function streakDays' engine/src/xp.js; git diff --quiet HEAD -- engine/src/xp.js && echo clean`
Expected: `1`, `1`, `0`, `clean`. A first `0` means Task 1 isn't in: stop and report. A last line other than `clean`, or a `1` from the third command, means someone is mid-way through this file: stop and report.

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_E.

- [ ] **Step 1: Write the failing test.**

Create `engine/test/xpstreak.test.js`:

```js
// The streak as a screen shows it (src/xp.js streakDays, streakLine): the web and the phone
// read the row's `streak` the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, streakDays, streakLine } from "../src/xp.js";

const at = (iso) => Date.parse(iso);

test("the streak holds through the next UTC day and is gone the day after; the line says so", () => {
  const s = { days: 3, best: 5, last: "2026-10-01" };
  assert.equal(streakDays(s, at("2026-10-01T23:59:59Z")), 3);
  assert.equal(streakDays(s, at("2026-10-02T23:59:59Z")), 3, "yesterday: still on");
  assert.equal(streakDays(s, at("2026-10-03T00:00:00Z")), 0, "a whole day with none");
  assert.equal(streakLine(s, at("2026-10-02T12:00:00Z")), "3-day streak");
  assert.equal(streakLine(s, at("2026-10-04T00:00:00Z")), "Best streak: 5 days");
  assert.equal(streakLine({ days: 0, best: 1, last: "2026-09-01" }, at("2026-10-04T00:00:00Z")), "Best streak: 1 day");
  assert.equal(streakLine({ days: 0, best: 0, last: null }, 5 * DAY_MS), "No streak yet");
});

test("a row without a streak (an old server, a cut-off row) reads as none", () => {
  assert.equal(streakDays(undefined, 5 * DAY_MS), 0);
  assert.equal(streakDays({ days: 2, best: 2, last: null }, 5 * DAY_MS), 0);
  assert.equal(streakLine(undefined, 5 * DAY_MS), "No streak yet");
  assert.equal(streakLine({ days: 0, best: 0 }, 5 * DAY_MS), "No streak yet");
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd engine && node --test test/xpstreak.test.js 2>&1 | grep -E '^# (pass|fail)|does not provide'`
Expected: `does not provide an export named 'streakDays'`, `# pass 0`, `# fail 1` (the file doesn't load, so it counts as one failure).

- [ ] **Step 3: Write the code.**

Append to `engine/src/xp.js`:

```js

/** The run as of `now` (ms) from a row's `streak` ({ days, best, last }): its days while
 *  `last` is today or yesterday (UTC), else 0. A row the server sent before midnight can be
 *  a day behind, so screens work this out when they draw, not from `days` alone. */
export function streakDays(streak, now) {
  if (!streak?.last || !streak.days) return 0;
  return utcDay(now) - utcDay(Date.parse(`${streak.last}T00:00:00Z`)) <= 1 ? streak.days : 0;
}

/** "3-day streak"; "Best streak: 5 days"; "No streak yet". */
export function streakLine(streak, now) {
  const days = streakDays(streak, now);
  if (days > 0) return `${days}-day streak`;
  const best = streak?.best ?? 0;
  if (best > 0) return `Best streak: ${best} ${best === 1 ? "day" : "days"}`;
  return "No streak yet";
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `cd engine && node --test test/xpstreak.test.js test/xp.test.js 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 0`, and `# pass` is 2 more than `test/xp.test.js` alone has (5 with Task 1's 3).

Run: `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_E + 2, `# fail 0`.

Run: `grep -c "^import" engine/src/xp.js`
Expected: `0`. Hermes loads this file on the phone, so it takes no imports at all (no `node:` ones in particular).

- [ ] **Step 5: Commit.**

```bash
git add engine/src/xp.js engine/test/xpstreak.test.js && git commit -m "engine: the streak as screens show it (streakDays, streakLine) in the shared XP rules, so the phone and the web say the same words

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- engine/src/xp.js engine/test/xpstreak.test.js
```

---
### Task 13 [phone]: XP rows as the phone shows them

One pure file turns XP rows into what the screens show, so Node tests it and the screens stay thin. It covers:
- merging pushed rows by wallet (the web's `mergeXp` rule, on a plain object, since zustand state is plain);
- a row's four titles with their names, XP and level (`levelOf`);
- Me's numbers (total, titles, the streak line, Genesis);
- a board's rows: Overall by `total` and one per title by that title's XP, ties by wallet.

The titles, the curve, the points and the streak's rule come from `engine/src/xp.js`; this file only names them.

A wallet with no XP on a board isn't listed on it (a row of zeros says nothing). On Overall, a row's badge is its main title (the one with the most XP; a tie goes to the earlier title in `TITLES`) and that title's level, e.g. "KOL · Level 2". A wallet whose only XP is the Genesis bonus has no title badge. On a title's tab the badge is that title's level.

**Files:**
- Create: `mobile/src/xp/rows.js`
- Test: `mobile/test/xp.test.mjs` (new, 9 tests)

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^engine: the streak as screens show it'; ls mobile/src/xp/rows.js mobile/test/xp.test.mjs 2>&1 | grep -c 'No such file'`
Expected: `1`, `2`. A `0` first means Task 12 isn't in: stop and report. Less than `2` means another session started this task: stop and report.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_M.

- [ ] **Step 1: Write the failing test.**

Create `mobile/test/xp.test.mjs`:

```js
// XP rows as the phone shows them (src/xp/rows.js): merged by wallet, titles on the shared
// curve, the streak line, and the leaderboard's rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_MS, LEVEL_XP, POINTS, TITLES, levelOf } from "../../engine/src/xp.js";
import { BOARDS, GENESIS_XP, TITLE_NAMES, boardOf, mainTitleOf, meOf, mergeXp, titlesOf, xpText } from "../src/xp/rows.js";

const row = (wallet, titles = {}, more = {}) => {
  const t = { dev: 0, kol: 0, raider: 0, diamond: 0, ...titles };
  return { wallet, total: Object.values(t).reduce((a, b) => a + b, 0), titles: t, streak: { days: 0, best: 0, last: null }, genesis: null, ...more };
};

test("rows merge by wallet: a newer row replaces, none goes, junk is skipped", () => {
  const a = row("A", { dev: 100 });
  const b = row("B", { kol: 25 });
  const one = mergeXp({}, [a, b]);
  assert.deepEqual(Object.keys(one).sort(), ["A", "B"]);
  const a2 = row("A", { dev: 300 });
  const two = mergeXp(one, [a2, null, { total: 5 }, { wallet: 7 }]);
  assert.equal(two.A, a2);
  assert.equal(one.A, a, "the old object is never changed");
  assert.equal(two.B, b, "a row not in the message stays");
  assert.equal(Object.keys(two).length, 2);
  assert.equal(mergeXp(two, "nope"), two, "not a list: nothing changes");
  assert.equal(mergeXp(two, []), two, "no rows: the same object, so screens don't redraw");
});

test("onlyNew: a one-off read never replaces a row a push brought", () => {
  const pushed = row("A", { dev: 300 });
  const read = row("A", { dev: 100 });
  const s = mergeXp({ A: pushed }, [read], true);
  assert.equal(s.A, pushed);
  assert.equal(mergeXp({}, [read], true).A, read, "no row yet: the read's goes in");
});

test("titles in TITLES order, with their names, XP and level on the shared curve", () => {
  const r = row("A", { dev: LEVEL_XP[2], kol: LEVEL_XP[1] - 1, raider: 0, diamond: LEVEL_XP[4] });
  const t = titlesOf(r);
  assert.deepEqual(t.map((x) => x.title), TITLES);
  assert.deepEqual(t.map((x) => x.name), ["Dev", "KOL", "Raider", "Diamond Hands"]);
  assert.deepEqual(t.map((x) => x.level), [3, 1, 1, 5]);
  assert.deepEqual(t.map((x) => x.level), t.map((x) => levelOf(x.xp)));
  assert.deepEqual(Object.keys(TITLE_NAMES), TITLES);
  assert.deepEqual(titlesOf({ wallet: "B" }).map((x) => x.xp), [0, 0, 0, 0], "a row cut short reads as zeros");
});

test("the main title is the one with the most XP; ties go to the earlier title; none with no XP", () => {
  assert.equal(mainTitleOf(row("A", { kol: 50, raider: 75 })).title, "raider");
  assert.equal(mainTitleOf(row("A", { dev: 100, diamond: 100 })).title, "dev");
  assert.equal(mainTitleOf(row("A")), null);
  assert.equal(mainTitleOf(undefined), null);
});

test("Me: the total, the four titles, the streak line as of now, and Genesis", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const r = row("A", { dev: 100 }, { total: 100 + GENESIS_XP, streak: { days: 3, best: 5, last: "2026-10-01" }, genesis: { mint: "M", at: 1 } });
  const me = meOf(r, now);
  assert.equal(me.total, 100 + GENESIS_XP);
  assert.equal(me.titles.length, 4);
  assert.equal(me.streak, "3-day streak");
  assert.deepEqual(me.genesis, { mint: "M", at: 1 });
  assert.equal(meOf(r, now + 2 * DAY_MS).streak, "Best streak: 5 days");
  assert.equal(meOf(row("B"), now).streak, "No streak yet");
  assert.equal(meOf(row("B"), now).genesis, null);
  assert.equal(meOf(undefined, now), null, "no row yet: nothing to show (a spinner)");
  assert.equal(GENESIS_XP, POINTS.genesis.points);
});

test("XP reads with thousands grouped", () => {
  assert.equal(xpText(0), "0 XP");
  assert.equal(xpText(950), "950 XP");
  assert.equal(xpText(1150), "1,150 XP");
  assert.equal(xpText(1234567), "1,234,567 XP");
});

test("the boards: Overall, then one per title in TITLES order", () => {
  assert.deepEqual(BOARDS.map((b) => b.key), ["overall", ...TITLES]);
  assert.deepEqual(BOARDS.map((b) => b.name), ["Overall", "Dev", "KOL", "Raider", "Diamond Hands"]);
});

test("Overall: by total, ties by wallet; the badge is the main title's level; yours is marked", () => {
  const rows = {
    C: row("C", { kol: 300 }),
    A: row("A", { dev: 100, kol: 200 }),
    B: row("B", { raider: 300 }),
    Z: row("Z"),
    G: row("G", {}, { total: GENESIS_XP, genesis: { mint: "M", at: 1 } }),
  };
  const b = boardOf(rows, "overall", "B");
  assert.deepEqual(b.map((r) => r.wallet), ["A", "B", "C", "G"], "300 x3 by wallet, then Genesis only; no XP: not on the board");
  assert.deepEqual(b.map((r) => r.rank), [1, 2, 3, 4]);
  assert.deepEqual(b.map((r) => r.xp), [300, 300, 300, GENESIS_XP]);
  assert.equal(b[0].badge, "KOL · Level 2");
  assert.equal(b[1].badge, "Raider · Level 3");
  assert.equal(b[3].badge, null, "no title XP: no title badge");
  assert.deepEqual(b.map((r) => r.mine), [false, true, false, false]);
});

test("a title's board: by that title's XP, ties by wallet, its level as the badge", () => {
  const rows = { A: row("A", { kol: 25 }), B: row("B", { kol: 300, dev: 800 }), C: row("C", { dev: 900 }), D: row("D", { kol: 25 }) };
  const b = boardOf(rows, "kol", null);
  assert.deepEqual(b.map((r) => [r.wallet, r.xp, r.badge]), [["B", 300, "Level 3"], ["A", 25, "Level 1"], ["D", 25, "Level 1"]]);
  assert.ok(b.every((r) => r.mine === false), "no wallet connected: nothing is yours");
  assert.deepEqual(boardOf({}, "dev", "A"), []);
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/xp.test.mjs 2>&1 | grep -E '^# (pass|fail)|Cannot find module'`
Expected: a `Cannot find module` line naming `src/xp/rows.js`, then `# pass 0`, `# fail 1`.

- [ ] **Step 3: Write the code.**

Create `mobile/src/xp/rows.js`:

```js
// XP rows (the server's, engine/server/xp.js: pushed on `profiles` as "xp", and GET
// /api/xp/<wallet>) as the phone shows them. The titles, the level curve, the points and the
// streak's rule are engine/src/xp.js's; nothing here keeps a copy. Pure, so Node tests it.
import { POINTS, TITLES, levelOf, streakLine } from "../../../engine/src/xp.js";

/** What each title is called on screen. */
export const TITLE_NAMES = { dev: "Dev", kol: "KOL", raider: "Raider", diamond: "Diamond Hands" };

/** The leaderboard's tabs: Overall (by total), then one per title (by that title's XP). */
export const BOARDS = [{ key: "overall", name: "Overall" }, ...TITLES.map((t) => ({ key: t, name: TITLE_NAMES[t] }))];

/** What the Seeker Genesis check adds, once. */
export const GENESIS_XP = POINTS.genesis.points;

/** "1,150 XP": thousands by hand (Hermes' Intl may be missing). */
export const xpText = (n) => `${String(n).replace(/\B(?=(\d{3})+$)/g, ",")} XP`;

/** `rows` merged into `prev` (wallet -> row): a row replaces that wallet's older one; no row
 *  goes; anything without a wallet is skipped. `onlyNew`: keep the rows `prev` has (a one-off
 *  read must not undo a push that came while it was on its way). Nothing new: `prev` itself. */
export function mergeXp(prev, rows, onlyNew = false) {
  if (!Array.isArray(rows)) return prev;
  let next = prev;
  for (const r of rows) {
    if (!r || typeof r.wallet !== "string" || (onlyNew && Object.hasOwn(next, r.wallet))) continue;
    if (next === prev) next = { ...prev };
    next[r.wallet] = r;
  }
  return next;
}

/** The four titles in TITLES order: { title, name, xp, level }. */
export function titlesOf(row) {
  return TITLES.map((title) => {
    const xp = row?.titles?.[title] ?? 0;
    return { title, name: TITLE_NAMES[title], xp, level: levelOf(xp) };
  });
}

/** The title with the most XP (a tie goes to the earlier title), or null with none. */
export function mainTitleOf(row) {
  let best = null;
  for (const t of titlesOf(row)) if (t.xp > 0 && (!best || t.xp > best.xp)) best = t;
  return best;
}

/** What Me shows from your row as of `now` (ms), or null while there's no row. */
export function meOf(row, now) {
  if (!row) return null;
  return { total: row.total ?? 0, titles: titlesOf(row), streak: streakLine(row.streak, now), genesis: row.genesis ?? null };
}

/** One board's rows, most XP first, ties by wallet; a wallet with no XP on it isn't listed.
 *  `board`: "overall" or a title. `me`: the connected wallet, or null.
 *  Each: { wallet, rank, xp, badge, mine }. The badge is the main title and its level on
 *  Overall (null with no title XP), else that title's level. */
export function boardOf(rows, board, me) {
  const xpOf = board === "overall" ? (r) => r.total ?? 0 : (r) => r.titles?.[board] ?? 0;
  return Object.values(rows)
    .filter((r) => xpOf(r) > 0)
    .sort((a, b) => xpOf(b) - xpOf(a) || (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0))
    .map((r, i) => {
      const xp = xpOf(r);
      let badge;
      if (board === "overall") {
        const main = mainTitleOf(r);
        badge = main ? `${main.name} · Level ${main.level}` : null;
      } else badge = `Level ${levelOf(xp)}`;
      return { wallet: r.wallet, rank: i + 1, xp, badge, mine: r.wallet === me };
    });
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/xp.test.mjs 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 9`, `# fail 0`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M + 9, `# fail 0`.

Run: `grep -nE '\b(100|300|800|2000|250)\b' mobile/src/xp/rows.js`
Expected: no output. The curve and the points are `engine/src/xp.js`'s; this file keeps no copy.

- [ ] **Step 5: Commit.**

```bash
git add mobile/src/xp/rows.js mobile/test/xp.test.mjs && git commit -m "mobile: XP rows as the phone shows them: merged by wallet, titles on the shared curve, the streak line, the leaderboard's rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/xp/rows.js mobile/test/xp.test.mjs
```

---

### Task 14 [phone]: The store keeps XP rows; the Genesis check

The store keeps every XP row the server pushes on `profiles` (the board right after the pictures, then the rows that change), merged by wallet. When a wallet connects, it reads that wallet's own row once with `api.xp(wallet)`, since the board holds only the top 500. That read never replaces a row a push already brought. Nothing reads again after that, and there's no timer: rows come only as pushes (the user's rule on live data).

`checkGenesis(signer)` is the Genesis button's work:
- it uses the store's `session`, or signs in first, exactly as `sendChat` does (`signIn(signer)`: one wallet signature, kept 7 days);
- then `api.genesis(session.token)`; the answer's `xp` row merges like a pushed one;
- errors come back as the server says them (`explain` passes these through unchanged): 404 `no Seeker Genesis Token in this wallet`, 409 `this Seeker's Genesis Token was already used by …`, 503 `couldn't read this wallet's tokens, try again`, 429 `too many Genesis checks…`;
- a 401 forgets the sign-in in memory and on disk, as `sendChat` does. Both now call one `forgetSignIn`, so the next press signs in again.

`xpLoaded` is its own flag. `loaded` stays `{ presales, launched }`, because an existing test compares it whole.

**Files:**
- Modify: `mobile/src/store.js` (the import, three state fields, `onProfiles`, `setWallet`, `forgetSignIn`, `readXp`, `checkGenesis`)
- Test: `mobile/test/store.test.mjs` (appended, 8 tests)

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^mobile: XP rows as the phone shows them'; git log --format=%s | grep -c '^engine: the server runs XP'; git diff --quiet HEAD -- mobile/src/store.js mobile/test/store.test.mjs && echo clean; grep -c 'checkGenesis\|readXp' mobile/src/store.js`
Expected: `1`, `1`, `clean`, `0`. A `0` in either of the first two means Task 13 or Task 8 isn't in: stop and report. Task 8 gives `api.xp` and `api.genesis` in `engine/src/apiclient.js`; this task's tests stub them, but the app calls them.

Run: `grep -c '^  set({ start, watch, watchCoin, setWallet, signIn, signOut, join, getBack, joinCost, sendChat, noteRef, preview, trade, openCost, mintCoin, openCoin, forgetOpening });$' mobile/src/store.js; grep -c 'if (e.status === 401) {' mobile/src/store.js`
Expected: `1`, `1`. Otherwise the file changed since this plan was written: stop and report.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_M.

- [ ] **Step 1: Write the failing tests.**

The rig at the top of the file takes `api` overrides; `tick`, `W` and `signer` are the file's own.

Append to `mobile/test/store.test.mjs`:

```js

// ---- XP ----

const xpRow = (wallet, total, more = {}) => ({
  wallet,
  total,
  titles: { dev: total, kol: 0, raider: 0, diamond: 0 },
  streak: { days: 0, best: 0, last: null },
  genesis: null,
  ...more,
});
const apiError = (status, message) => Object.assign(new Error(message), { status });

test("xp: pushed rows merge by wallet, none goes, junk is skipped; loaded from the first message", () => {
  const { store, push } = rig();
  store.getState().start();
  assert.equal(store.getState().xpLoaded, false);
  push("profiles", "xp", [xpRow("A", 100), xpRow("B", 50)]);
  push("profiles", "xp", [xpRow("A", 300), { total: 1 }, null]);
  const s = store.getState();
  assert.equal(s.xpLoaded, true);
  assert.deepEqual(Object.keys(s.xp).sort(), ["A", "B"]);
  assert.equal(s.xp.A.total, 300);
  assert.equal(s.xp.B.total, 50, "a row not in the message stays");
  push("profiles", "xp", []);
  assert.equal(store.getState().xp, s.xp, "no rows: the same object");
  push("profiles", "snapshot", { X: { skin: 1 } });
  assert.equal(store.getState().xp, s.xp, "the pictures' snapshot leaves the rows alone");
});

test("xp: your own row is read once when the wallet comes; after that rows come only as pushes", async () => {
  const reads = [];
  const { store, push } = rig({ api: { xp: async (w) => (reads.push(w), xpRow(w, 25)) } });
  store.getState().start();
  await store.getState().setWallet(W);
  await tick();
  assert.deepEqual(reads, [W]);
  assert.equal(store.getState().xp[W].total, 25);
  push("profiles", "xp", [xpRow(W, 125)]);
  push("profiles", "xp", [xpRow("B", 5)]);
  await tick();
  assert.deepEqual(reads, [W], "pushes never read again");
  assert.equal(store.getState().xp[W].total, 125);
  await store.getState().setWallet(null);
  assert.deepEqual(reads, [W], "no wallet: nothing to read");
});

test("xp: a push that lands while your row's read is on its way isn't undone by the read", async () => {
  let answer;
  const { store, push } = rig({ api: { xp: () => new Promise((r) => (answer = r)) } });
  store.getState().start();
  await store.getState().setWallet(W);
  push("profiles", "xp", [xpRow(W, 300)]);
  answer(xpRow(W, 100));
  await tick();
  assert.equal(store.getState().xp[W].total, 300);
});

test("xp: a failed read says so for that wallet only; a push still fills the row", async () => {
  const fail = [];
  const { store, push } = rig({ api: { xp: (w) => new Promise((_, no) => fail.push([w, no])) } });
  store.getState().start();
  await store.getState().setWallet(W);
  fail[0][1](apiError(429, "too many requests, try again later"));
  await tick();
  assert.equal(store.getState().xpFailed, true);
  push("profiles", "xp", [xpRow(W, 40)]);
  assert.equal(store.getState().xp[W].total, 40);
  await store.getState().setWallet("Other");
  assert.equal(store.getState().xpFailed, false, "a wallet change starts over");
  await store.getState().setWallet(W);
  await store.getState().setWallet("Other");
  fail[2][1](apiError(503, "down")); // W's second read fails after the switch
  await tick();
  assert.equal(store.getState().xpFailed, false, "an old wallet's failure isn't the new one's");
});

test("checkGenesis signs in when the sign-in ran out, posts the token, and the answer's row goes in", async () => {
  const posted = [];
  const row = xpRow(W, 250, { genesis: { mint: "M", at: 7 } });
  const { store } = rig({
    now: 1_790_000_000_000,
    api: {
      xp: async (w) => xpRow(w, 0),
      genesis: async (token) => (posted.push(token), { wallet: W, genesis: row.genesis, fresh: posted.length === 1, xp: row }),
    },
  });
  await store.getState().setWallet(W);
  await tick();
  store.setState({ session: { token: "old", exp: 1_790_000_000_000 } }); // runs out right now
  const signed = [];
  const r = await store.getState().checkGenesis(signer, { signIn: async () => (signed.push(1), { token: "fresh", exp: 1_790_000_100_000 }) });
  assert.deepEqual(r, { ok: true, fresh: true, genesis: { mint: "M", at: 7 } });
  assert.deepEqual(signed, [1]);
  assert.deepEqual(posted, ["fresh"]);
  assert.equal(store.getState().xp[W], row, "the answer's row replaces the one read before");
  const again = await store.getState().checkGenesis(signer, { signIn: async () => assert.fail("still signed in") });
  assert.deepEqual(again, { ok: true, fresh: false, genesis: { mint: "M", at: 7 } });
  assert.deepEqual(posted, ["fresh", "fresh"]);
});

test("checkGenesis: a sign-in that fails stops there", async () => {
  const { store } = rig({ api: { genesis: async () => assert.fail("no token to post") } });
  await store.getState().setWallet(W);
  const r = await store.getState().checkGenesis(signer, { signIn: async () => { throw new Error("User rejected the request."); } });
  assert.deepEqual(r, { ok: false, error: "You cancelled it in your wallet." });
});

test("checkGenesis: the server's words as they are; the sign-in stays", async () => {
  const cases = [
    [404, "no Seeker Genesis Token in this wallet"],
    [409, "this Seeker's Genesis Token was already used by Abcd…wxyz"],
    [503, "couldn't read this wallet's tokens, try again"],
    [429, "too many Genesis checks from this wallet, try again later"],
  ];
  for (const [status, error] of cases) {
    const { store } = rig({ api: { xp: async (w) => xpRow(w, 0), genesis: async () => { throw apiError(status, error); } } });
    await store.getState().setWallet(W);
    await tick();
    store.setState({ session: { token: "t", exp: 9e15 } });
    const before = store.getState().xp;
    assert.deepEqual(await store.getState().checkGenesis(signer), { ok: false, error }, String(status));
    assert.deepEqual(store.getState().session, { token: "t", exp: 9e15 }, `${status} keeps the sign-in`);
    assert.equal(store.getState().xp, before, `${status} changes no row`);
  }
});

test("checkGenesis: a 401 forgets the sign-in here and on disk; the next press signs in again", async () => {
  let first = true;
  const { store, disk } = rig({
    now: 1_790_000_000_000,
    api: {
      genesis: async () => {
        if (first) {
          first = false;
          throw apiError(401, "your sign-in ran out, sign in again");
        }
        return { wallet: W, genesis: { mint: "M", at: 1 }, fresh: false, xp: xpRow(W, 250) };
      },
    },
  });
  await store.getState().setWallet(W);
  await store.getState().signIn(signer, { signIn: async () => ({ token: "old", exp: 1_790_000_100_000 }) });
  assert.ok(disk.has(`mooner:login:${W}`));
  const r = await store.getState().checkGenesis(signer);
  assert.deepEqual(r, { ok: false, error: "your sign-in ran out, sign in again" });
  assert.equal(store.getState().session, null);
  assert.equal(disk.has(`mooner:login:${W}`), false);
  const signed = [];
  const again = await store.getState().checkGenesis(signer, { signIn: async () => (signed.push(1), { token: "new", exp: 1_790_000_100_000 }) });
  assert.equal(again.ok, true);
  assert.deepEqual(signed, [1]);
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/store.test.mjs 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 8` (the eight new tests; the others pass).

- [ ] **Step 3: Write the code.**

Apply these 5 blocks to `mobile/src/store.js`, in order.

Replace:

```js
} from "./create/rules.js";
```

with:

```js
} from "./create/rules.js";
import { mergeXp } from "./xp/rows.js";
```

Replace:

```js
    profiles: {}, // wallet -> Mooner picture traits
```

with:

```js
    profiles: {}, // wallet -> Mooner picture traits
    // wallet -> XP row (engine/server/xp.js): the board's top 500 and its changes, pushed on
    // `profiles`; the connected wallet's own row, read once; a Genesis answer's row
    xp: {},
    xpLoaded: false, // true from the first "xp" message: {} before that is "not here yet"
    xpFailed: false, // the read of the connected wallet's own row failed (a push of it still fills it)
```

Replace:

```js
    else if (m.type === "upsert") patch("profiles", (p) => ({ ...p, [m.data.wallet]: m.data.pfp }));
  }
```

with:

```js
    else if (m.type === "upsert") patch("profiles", (p) => ({ ...p, [m.data.wallet]: m.data.pfp }));
    // XP rows: the board right after the pictures, then the rows that changed
    else if (m.type === "xp") set((s) => ({ xp: mergeXp(s.xp, m.data), xpLoaded: true }));
  }
```

Replace:

```js
    set({ wallet, lamports: null, session: null, mine: {}, holdings: {}, opening: undefined });
    if (!wallet) return;
```

with:

```js
    set({ wallet, lamports: null, session: null, mine: {}, holdings: {}, opening: undefined, xpFailed: false });
    if (!wallet) return;
    readXp(wallet);
```

Replace:

```js
      if (e.status === 401) {
        const wallet = signer.publicKey.toBase58();
        if (get().wallet === wallet) set({ session: null });
        await keep(() => saved(loginName(wallet)).clear());
      }
      return { ok: false, error: explain(e) };
    }
  }

  set({ start, watch, watchCoin, setWallet, signIn, signOut, join, getBack, joinCost, sendChat, noteRef, preview, trade, openCost, mintCoin, openCoin, forgetOpening });
```

with:

```js
      if (e.status === 401) await forgetSignIn(signer.publicKey.toBase58());
      return { ok: false, error: explain(e) };
    }
  }

  /** A 401: the sign-in this phone kept for `wallet` is no good. Forget it, so the next press
   *  signs in again. */
  async function forgetSignIn(wallet) {
    if (get().wallet === wallet) set({ session: null });
    await keep(() => saved(loginName(wallet)).clear());
  }

  // ---- XP ----

  /** The connected wallet's own XP row, read once when the wallet comes: the board on
   *  `profiles` holds the top 500 only. Pushes keep it after that; nothing reads it again. A
   *  row a push brought while this read was on its way stays. */
  async function readXp(wallet) {
    try {
      const row = await api.xp(wallet);
      patch("xp", (x) => mergeXp(x, [row], true));
    } catch {
      if (get().wallet === wallet) set({ xpFailed: true });
    }
  }

  /** The Seeker Genesis check for the signer's wallet, signing in first if needed (as
   *  sendChat does). The server reads the wallet's tokens and decides. Returns { ok: true,
   *  fresh, genesis } (`fresh`: the first time), or { ok: false, error } with the server's
   *  words. The answer's row goes into `xp` like a pushed one. `opts.signIn` is for tests. */
  async function checkGenesis(signer, opts) {
    let session = get().session;
    if (!session || session.exp <= now()) {
      const r = await signIn(signer, opts);
      if (!r.ok) return r;
      session = r.session;
    }
    try {
      const r = await api.genesis(session.token);
      patch("xp", (x) => mergeXp(x, [r.xp]));
      return { ok: true, fresh: r.fresh === true, genesis: r.genesis };
    } catch (e) {
      if (e.status === 401) await forgetSignIn(signer.publicKey.toBase58());
      return { ok: false, error: explain(e) };
    }
  }

  set({ start, watch, watchCoin, setWallet, signIn, signOut, join, getBack, joinCost, sendChat, noteRef, preview, trade, openCost, mintCoin, openCoin, forgetOpening, checkGenesis });
```

- [ ] **Step 4: Run them to see them pass.**

Run: `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/store.test.mjs 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# fail 0`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M + 8, `# fail 0`.

Run: `grep -c 'api\.xp(' mobile/src/store.js; grep -cE 'setInterval|setTimeout' mobile/src/store.js`
Expected: `1` (only `readXp` reads a row), then the same number as before this task (`git show HEAD:mobile/src/store.js | grep -cE 'setInterval|setTimeout'`): this task adds no timer.

- [ ] **Step 5: Commit.**

```bash
git add mobile/src/store.js mobile/test/store.test.mjs && git commit -m "mobile: the store keeps XP rows (pushed on profiles; your own row read once per wallet, never over a pushed one) and checks Seeker Genesis with the chat sign-in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/store.js mobile/test/store.test.mjs
```

---

### Task 15 [phone]: The leaderboard screen

A pushed screen, `/leaderboard`, opened from Me (Task 16). Its tabs are Overall and one per title, as chips in two rows so "Diamond Hands" fits.
- The rows are `boardOf` (Task 13) over the store's XP rows: place, face, short wallet ("· You" on yours), badge and XP.
- Every row but yours has piece 5's `FollowButton` under it. `FollowButton` also hides itself with no wallet connected; the row skips it for yours anyway.
- Until the server's first `xp` message the list is a spinner, since `{}` then means "not here yet". After it, a tab with no rows says so.
- No timer and no fetch: the rows change as the store's do.

**Files:**
- Create: `mobile/app/leaderboard.js`

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^mobile: the store keeps XP rows'; git log --format=%s | grep -c "^mobile: Follow on a Mooner's card in the room"; ls mobile/app/leaderboard.js 2>&1 | grep -c 'No such file'; grep -c '^export function FollowButton({ wallet })' mobile/src/alerts/FollowButton.js`
Expected: `1`, `1`, `1`, `1`. A `0` in either of the first two means Task 14 or piece 5 Task 10 isn't in: stop and report. A last `0` means `FollowButton` changed its props since this plan was written: stop and report.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_M.

- [ ] **Step 1: Write the screen.**

Create `mobile/app/leaderboard.js`:

```js
// The leaderboard: the server's XP rows (the board pushed on `profiles`, plus your own row),
// Overall by total and a tab per title by that title's XP. Follow on each row but yours.
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { useStore } from "zustand";
import { store } from "../src/app";
import { FollowButton } from "../src/alerts/FollowButton";
import { BOARDS, boardOf, xpText } from "../src/xp/rows";
import { Chip } from "../src/ui/Chip";
import { Face } from "../src/ui/Face";
import { TopBar } from "../src/ui/TopBar";
import { shortWallet } from "../src/ui/format";
import { Card, Empty, Pill, Screen, T } from "../src/ui/kit";
import { C, S } from "../src/ui/theme";

/** Where Back goes with nothing to go back to (a deep link). */
const ME = "/(tabs)/me";

/** The tabs in two rows, so "Diamond Hands" fits on a phone. */
const TAB_ROWS = [BOARDS.slice(0, 3), BOARDS.slice(3)];

export default function Leaderboard() {
  const [board, setBoard] = useState("overall");
  const xp = useStore(store, (s) => s.xp);
  const loaded = useStore(store, (s) => s.xpLoaded);
  const me = useStore(store, (s) => s.wallet);
  const rows = useMemo(() => boardOf(xp, board, me), [xp, board, me]);
  const name = BOARDS.find((b) => b.key === board).name;
  const renderItem = useCallback(({ item }) => <Row row={item} />, []);

  return (
    <Screen padded={false}>
      <TopBar title="Leaderboard" fallback={ME} />
      <View style={{ paddingHorizontal: S.gutter, gap: 8, paddingBottom: 12 }}>
        {TAB_ROWS.map((tabs) => (
          <View key={tabs[0].key} style={{ flexDirection: "row", gap: 8 }}>
            {tabs.map((b) => (
              <Chip key={b.key} text={b.name} on={board === b.key} onPress={() => setBoard(b.key)} />
            ))}
          </View>
        ))}
      </View>
      {loaded ? (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.wallet}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: S.gutter, paddingBottom: 32 }}
          ItemSeparatorComponent={Gap}
          ListEmptyComponent={
            <Empty title={board === "overall" ? "No XP yet" : `No ${name} XP yet`} body="XP counts from the chain as it happens." />
          }
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.text1} />
        </View>
      )}
    </Screen>
  );
}

const Gap = () => <View style={{ height: 12 }} />;

/** One wallet: its place, face, short address (yours says so), badge and XP; Follow under it
 *  on everyone else's row. */
function Row({ row }) {
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <T v="num" color={C.text2} style={{ minWidth: 36 }}>{`#${row.rank}`}</T>
        <Face wallet={row.wallet} size={36} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <T v="num" numberOfLines={1}>{row.mine ? `${shortWallet(row.wallet)} · You` : shortWallet(row.wallet)}</T>
          {row.badge ? <Pill text={row.badge} color={C.accent} /> : null}
        </View>
        <T v="num">{xpText(row.xp)}</T>
      </View>
      {row.mine ? null : <FollowButton wallet={row.wallet} />}
    </Card>
  );
}
```

- [ ] **Step 2: Check.**

Run (from `mobile/`): the parse check with `app/leaderboard.js`:

```bash
node -e 'const b = require("@babel/core"); const fs = require("fs"); for (const f of process.argv.slice(1)) b.parseSync(fs.readFileSync(f, "utf8"), { filename: f, sourceType: "module", configFile: false, babelrc: false, presets: ["@babel/preset-react"] }); console.log("parsed", process.argv.length - 1, "files")' app/leaderboard.js
```

Expected: `parsed 1 files`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M (no test changes), `# fail 0`.

Run: `grep -niE 'player|lobby|match|shiller' mobile/app/leaderboard.js`
Expected: no output (piece 5's copy rule).

- [ ] **Step 3: Commit.**

```bash
git add mobile/app/leaderboard.js && git commit -m "mobile: the leaderboard: Overall and a tab per title from the server's XP rows, Follow on each row but yours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/app/leaderboard.js
```

---

### Task 16 [phone]: XP and the Genesis check on Me

Me gets an XP card above Following and Followers. The card shows:
- your total, with a gold "Seeker Genesis" pill once your row has `genesis`;
- the streak line (`streakLine` as of now);
- the four titles in `TITLES` order, each with a "Level N" pill and its XP;
- a "Leaderboard" button that opens Task 15's screen.

A spinner shows until your row is here. If the read failed and no push brought the row, the card says so.

Under it, while the row has no Genesis mark, is the Seeker Genesis card with "Check this wallet". It shows for every connected wallet: the server reads the wallet's tokens and decides (see "Two choices" above).
- Before the first sign-in, a line says the wallet signs in to Mooner first and no SOL moves. The press then shows Seed Vault's sign-message prompt, which the user answers.
- An error shows as the server words it (404, 409, 503, 429). After a 401, the next press signs in again (Task 14).
- The first pass (`fresh: true`) gives a success tick and a sheet: "+250 XP", "Your Mooner has the Seeker Genesis mark.", Done. 250 is `GENESIS_XP`, i.e. `POINTS.genesis.points`.
- The sheet lives outside the card, so it stays up when the new row hides the card.
- A pass that isn't fresh just shows the pill.

**Files:**
- Create: `mobile/src/xp/MyXp.js`
- Modify: `mobile/app/(tabs)/me.js` (an import; `<MyXp wallet={wallet} />` above `<FollowLists />`)

- [ ] **Step 0: Check the base, and take the count.**

Run: `git log --format=%s | grep -c '^mobile: the leaderboard'; git log --format=%s | grep -c '^mobile: who you follow and who follows you'; ls mobile/src/xp/MyXp.js 2>&1 | grep -c 'No such file'; git diff --quiet HEAD -- "mobile/app/(tabs)/me.js" && echo clean`
Expected: `1`, `1`, `1`, `clean`. A `0` in either of the first two means Task 15 or piece 5 Task 13 isn't in: stop and report. Piece 5 Task 13 adds the two lines this task's blocks anchor on.

Run: `grep -c '^import { FollowLists } from "../../src/alerts/FollowLists";$' "mobile/app/(tabs)/me.js"; grep -c '^      <FollowLists />$' "mobile/app/(tabs)/me.js"`
Expected: `1`, `1`. Otherwise stop and report.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_M.

- [ ] **Step 1: Write the card.**

Create `mobile/src/xp/MyXp.js`:

```js
// Me: your XP from the server's row (the store's `xp`): the total, the Seeker Genesis mark,
// the streak, the four titles with their levels, and a Leaderboard button. Under it, the
// Seeker Genesis check while the wallet hasn't passed it.
import { useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../app";
import { useSigner } from "../wallet";
import { GENESIS_XP, meOf, xpText } from "./rows";
import { Button, Card, Pill, PillButton, Sheet, T } from "../ui/kit";
import { C } from "../ui/theme";

/** `wallet`: the connected one. A spinner until its row is here (the read on connect, or a
 *  push); the server's rows are the only numbers shown. */
export function MyXp({ wallet }) {
  const row = useStore(store, (s) => s.xp[wallet]);
  const failed = useStore(store, (s) => s.xpFailed);
  const me = meOf(row, Date.now());
  let body;
  if (me) body = <Numbers me={me} />;
  else if (failed) body = <T v="small" color={C.text2}>Couldn't read your XP right now. It shows here when the server sends it.</T>;
  else body = <ActivityIndicator color={C.text1} style={{ alignSelf: "flex-start" }} />;
  return (
    <View style={{ gap: 12, marginBottom: 28 }}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T v="label">XP</T>
          <PillButton title="Leaderboard" onPress={() => router.push("/leaderboard")} />
        </View>
        {body}
      </Card>
      <GenesisCheck show={me ? !me.genesis : failed} />
    </View>
  );
}

function Numbers({ me }) {
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <T v="bigNum">{xpText(me.total)}</T>
        {me.genesis ? <Pill text="Seeker Genesis" color={C.gold} /> : null}
      </View>
      <T v="small">{me.streak}</T>
      {me.titles.map((t) => (
        <View key={t.title} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <T v="body" style={{ flex: 1 }}>{t.name}</T>
          <Pill text={`Level ${t.level}`} color={t.xp > 0 ? C.accent : C.text2} />
          <T v="num" color={C.text1} style={{ minWidth: 80, textAlign: "right" }}>{xpText(t.xp)}</T>
        </View>
      ))}
    </>
  );
}

/** The Seeker Genesis check, while `show` (the wallet's row has no mark yet). The server reads
 *  the wallet's tokens and decides; the phone doesn't guess whether it's a Seeker. The first
 *  pass opens a sheet, which stays up after the card goes (the new row has the mark). */
function GenesisCheck({ show }) {
  const signer = useSigner();
  const signedIn = useStore(store, (s) => s.session != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [passed, setPassed] = useState(false);
  const pressing = useRef(false); // set at once, so a second tap before the re-render does nothing

  async function check() {
    if (pressing.current || !signer) return;
    pressing.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await store.getState().checkGenesis(signer);
      if (r.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (r.fresh) setPassed(true);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setError(r.error);
      }
    } finally {
      pressing.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {show ? (
        <Card style={{ gap: 10 }}>
          <T v="label">Seeker Genesis</T>
          <T v="body" color={C.text1}>
            {`Got a Seeker Genesis Token in this wallet? Check it once for the Seeker Genesis mark and ${xpText(GENESIS_XP)}.`}
          </T>
          {signedIn ? null : <T v="small" color={C.text2}>Your wallet signs you in to Mooner first. No SOL moves.</T>}
          {error ? <T v="small" color={C.down}>{error}</T> : null}
          <Button title="Check this wallet" kind="quiet" busy={busy} disabled={!signer} onPress={check} />
        </Card>
      ) : null}
      <Sheet open={passed} onClose={() => setPassed(false)} title="Seeker Genesis">
        <View style={{ gap: 16 }}>
          <T v="bigNum" color={C.gold}>{`+${xpText(GENESIS_XP)}`}</T>
          <T v="body" color={C.text1}>Your Mooner has the Seeker Genesis mark.</T>
          <Button title="Done" kind="gold" onPress={() => setPassed(false)} />
        </View>
      </Sheet>
    </>
  );
}
```

- [ ] **Step 2: Show it on Me.**

Apply these 2 blocks to `mobile/app/(tabs)/me.js`, in order.

Replace:

```js
import { FollowLists } from "../../src/alerts/FollowLists";
```

with:

```js
import { FollowLists } from "../../src/alerts/FollowLists";
import { MyXp } from "../../src/xp/MyXp";
```

Replace:

```js
      <FollowLists />
```

with:

```js
      <MyXp wallet={wallet} />
      <FollowLists />
```

- [ ] **Step 3: Check.**

Run (from `mobile/`): the parse check with `"app/(tabs)/me.js" src/xp/MyXp.js`:

```bash
node -e 'const b = require("@babel/core"); const fs = require("fs"); for (const f of process.argv.slice(1)) b.parseSync(fs.readFileSync(f, "utf8"), { filename: f, sourceType: "module", configFile: false, babelrc: false, presets: ["@babel/preset-react"] }); console.log("parsed", process.argv.length - 1, "files")' "app/(tabs)/me.js" src/xp/MyXp.js
```

Expected: `parsed 2 files`.

Run: `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_M (no test changes), `# fail 0`.

Run: `grep -niE 'player|lobby|match|shiller' mobile/src/xp/MyXp.js; grep -nE '\b(250|100|300|800|2000)\b' mobile/src/xp/MyXp.js`
Expected: no output. The Genesis points come from `GENESIS_XP`, the levels from `levelOf`.

- [ ] **Step 4: Commit.**

```bash
git add mobile/src/xp/MyXp.js "mobile/app/(tabs)/me.js" && git commit -m "mobile: XP on Me: your total, titles, levels and streak from the server's row, the Leaderboard button, and the Seeker Genesis check (the server decides)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/xp/MyXp.js "mobile/app/(tabs)/me.js"
```

---

### Task 17 [web]: The web's streak from the shared rules

Task 12 moved `streakDays` and `streakLine` into `engine/src/xp.js`. The web re-exports them from `web/src/lib/xp.ts`, so `ProfileScreen.tsx` and `web/tests/xp.test.mjs` keep importing them from there unchanged. Task 10's streak test now runs against the shared copy. The functions behave the same on every row the web gets: Task 12's tests are Task 10's cases plus a row with no `streak`.

**Files:**
- Modify: `web/src/lib/xp.ts` (the import becomes the re-export; the two functions go)

- [ ] **Step 0: Check the base, and take the counts.**

Run: `git log --format=%s | grep -c "^web: the players are the server's XP rows"; git log --format=%s | grep -c '^engine: the streak as screens show it'; git diff --quiet HEAD -- web/src/lib/xp.ts && echo clean; grep -c "^import { utcDay } from '../../../engine/src/xp.js'$" web/src/lib/xp.ts; grep -c '^export function streak' web/src/lib/xp.ts`
Expected: `1`, `1`, `clean`, `1`, `2`. A `0` in either of the first two means Task 10 or Task 12 isn't in: stop and report.

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/*.test.mjs 2>&1 | grep -E '^# (tests|fail)'`
Expected: `# fail 0`. Note `# tests` as BEFORE_W.

Run (`$SCRATCH` is your scratchpad directory): `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep "error TS" > "$SCRATCH/p6-tsc-before17.txt"; wc -l < "$SCRATCH/p6-tsc-before17.txt"`
Note the number.

- [ ] **Step 1: Point the web at the shared streak.**

Apply these 2 blocks to `web/src/lib/xp.ts`, in order.

Replace:

```ts
import { utcDay } from '../../../engine/src/xp.js'
```

with:

```ts
// The streak line is the shared rules' (engine/src/xp.js), so the phone says the same words.
export { streakDays, streakLine } from '../../../engine/src/xp.js'
```

Replace:

```ts
export function xpOf(row: XpRow): UserXp {
  return { total: row.total, streak: row.streak, genesis: row.genesis }
}

/** The run as of `now` (ms): the row's days while its last day is today or yesterday (UTC),
 *  else 0. A row the server sent before midnight can be a day behind. */
export function streakDays(s: UserXp['streak'], now: number): number {
  if (!s.last || s.days === 0) return 0
  return utcDay(now) - utcDay(Date.parse(`${s.last}T00:00:00Z`)) <= 1 ? s.days : 0
}

/** "3-day streak"; "Best streak: 5 days"; "No streak yet". */
export function streakLine(s: UserXp['streak'], now: number): string {
  const days = streakDays(s, now)
  if (days > 0) return `${days}-day streak`
  if (s.best > 0) return `Best streak: ${s.best} ${s.best === 1 ? 'day' : 'days'}`
  return 'No streak yet'
}
```

with:

```ts
export function xpOf(row: XpRow): UserXp {
  return { total: row.total, streak: row.streak, genesis: row.genesis }
}
```

- [ ] **Step 2: Check.**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/xp.test.mjs 2>&1 | grep -E '^# (pass|fail)'`
Expected: `# pass 3`, `# fail 0`.

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/*.test.mjs 2>&1 | grep -E '^# (tests|fail)'`
Expected: BEFORE_W, `# fail 0`.

Run: `cd web && npx tsc -p tsconfig.check.json --noEmit 2>&1 | grep "error TS" > "$SCRATCH/p6-tsc-after17.txt"; wc -l < "$SCRATCH/p6-tsc-after17.txt"; diff <(sed -E 's/\([0-9]+,[0-9]+\)//' "$SCRATCH/p6-tsc-before17.txt") <(sed -E 's/\([0-9]+,[0-9]+\)//' "$SCRATCH/p6-tsc-after17.txt") && echo same`
Expected: the number from Step 0, then `same`.

Build the site into your scratchpad, not `web/dist`. Vite reads `web/.env` for the Privy id itself; don't open that file.

Run: `cd web && npx vite build --outDir "$SCRATCH/p6-dist" --emptyOutDir 2>&1 | tail -1; grep -l 'Best streak: ' "$SCRATCH"/p6-dist/assets/*.js | wc -l; rm -rf "$SCRATCH/p6-dist"`
Expected: a line starting `✓ built in`, then `1`. If the build throws `VITE_PRIVY_APP_ID is missing`, skip it and say so in your report (as Task 10 does).

- [ ] **Step 3: Commit.**

```bash
git add web/src/lib/xp.ts && git commit -m "web: the streak line from the shared XP rules (engine/src/xp.js), the same words as the phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- web/src/lib/xp.ts
```

---

### Task 18 [phone] (USER PRESENT): On the phone: XP on Me, the leaderboard, the Genesis check

The user must be at the phone. The Genesis check needs a Mooner sign-in: Seed Vault asks the user to sign a message (no SOL moves). The user answers it, and the agent never taps, approves or declines anything in Seed Vault (piece 5's ground rules, "Seed Vault is the user's"). Everything else here is reading the screen.

This runs against production (`mobile/src/config.js`: `https://app.mooner.family`), so it waits for Task 11's deploy. Piece 5's "Device" ground rules apply as written: signing, no `adb uninstall`, screenshots into the scratchpad, taps read from the latest screenshot.

- [ ] **Step 0 (agent): Check the base and the server.**

Run: `git log --format=%s | grep -c '^mobile: XP on Me'; git log --format=%s | grep -c '^mobile: the leaderboard'; git status --porcelain -- mobile | grep -c .`
Expected: `1`, `1`, `0`. A `0` in either of the first two means Task 16 or Task 15 isn't in: stop and report. A last number above `0` means uncommitted changes in `mobile/`: list them for the user (`git status --short -- mobile`) and ask before building.

Run: `curl -s -m 15 -w ' %{http_code}\n' https://app.mooner.family/api/xp/11111111111111111111111111111111`
Expected: the all-zero row and `200`, as in Task 11 Step 1. `{"error":"not found"} 404` means Task 11's deploy hasn't happened: stop and tell the user.

- [ ] **Step 1 (agent): Build and install.**

Run: `cd mobile && sh scripts/check-bundle.sh && grep -cF "\"$(pwd -P)/app/leaderboard.js\"" dist/_expo/static/js/android/*.js && sh scripts/run-android.sh`
Expected:
- `web3.js copies: 1; files from engine/node_modules: 0`;
- `app/ entries from this checkout: N`, with N above 0;
- a number of at least `1` (the new screen is in the bundle);
- then the install.

If the check fails, don't install.

- [ ] **Step 2 (agent): Me.** Open the Me tab with the user's wallet connected. Screenshot `p6-18-me.png`.

Ask the user for the connected wallet's address (it's public) if it isn't known yet, then run: `curl -s -m 15 https://app.mooner.family/api/xp/<WALLET>`.

Expected on screen, matching that row:
- the "XP" card, above Following and Followers, with a "Leaderboard" button;
- the total, as "N XP" with thousands grouped;
- the streak line, one of "N-day streak", "Best streak: …" or "No streak yet";
- Dev, KOL, Raider and Diamond Hands in that order, each with "Level N" and its XP. The levels follow `LEVEL_XP` (`[0, 100, 300, 800, 2000]`): 0-99 XP is Level 1, and 2000 or more is Level 5;
- while the row's `genesis` is `null`, the "Seeker Genesis" card with "Check this wallet". While it isn't `null`, a gold "Seeker Genesis" pill by the total and no card.

The card should come up within a few seconds of opening Me, with no tap. A spinner that never goes means neither the read nor a push arrived: take a screenshot and report.

- [ ] **Step 3 (agent): The leaderboard.** Tap "Leaderboard". Screenshot `p6-18-board.png`.

Expected:
- the chips Overall, Dev, KOL on the first row and Raider, Diamond Hands on the second, Overall on;
- the rows from the server's board, most XP first (ties by wallet). Compare the first five with what the server sends, sorted the same way (Task 11 Step 2's socket, printing rows instead of the count):

  Run: `node -e 'const ws=new WebSocket("wss://app.mooner.family/api/ws");ws.onopen=()=>ws.send(JSON.stringify({op:"sub",topics:["profiles"]}));ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.type!=="xp")return;const r=m.data.filter((x)=>x.total>0).sort((x,y)=>y.total-x.total||(x.wallet<y.wallet?-1:x.wallet>y.wallet?1:0)).slice(0,5);for(const x of r)console.log(x.wallet.slice(0,4)+"…"+x.wallet.slice(-4),x.total);ws.close();process.exit(0)};setTimeout(()=>{console.log("no xp message");process.exit(1)},15000)'`
  Expected: up to five lines, each a short wallet as the phone writes it and its total, in the screen's order;
- your wallet's row reads "· You" and has no Follow button. Every other row has "Follow" or "Unfollow" under it;
- with no XP on the server at all, "No XP yet" instead (still a pass; say so).

Tap "Dev". Screenshot `p6-18-board-dev.png`. Expected: only wallets with Dev XP, by Dev XP, each badge "Level N". Don't press Follow: it signs in, and follows are piece 5's to check.

Press Back. Expected: Me again.

- [ ] **Step 4 (USER STEP): The Genesis check.** Only while the wallet has no mark (Step 2). The checks count toward the server's limit, 3 a minute per wallet, so one press is enough.

The user taps "Check this wallet". Without a sign-in kept from chat or alerts, Seed Vault asks to sign a message first, and the user approves it. Then the agent takes a screenshot `p6-18-genesis.png`. One of:
- **The wallet holds a Genesis token, checked for the first time:** a success buzz and a sheet with "+250 XP", "Your Mooner has the Seeker Genesis mark." and Done. After Done, the XP card shows the gold "Seeker Genesis" pill, the total is 250 more, and the Genesis card is gone. Rerun Step 2's `curl`: `genesis` is `{ "mint": …, "at": … }`.
- **No token:** the red line `no Seeker Genesis Token in this wallet`, and the card stays.
- **Token used by another wallet:** `this Seeker's Genesis Token was already used by <short wallet>`.
- **The server couldn't read the chain:** `couldn't read this wallet's tokens, try again`. Try once more after a minute.
- **The user declined in Seed Vault:** `You cancelled it in your wallet.` (from `explain` in `engine/src/flows.js`, when the wallet's error says rejected, declined or cancel; otherwise the wallet's own words, which this plan hasn't seen). Record which.

- [ ] **Step 5 (agent): What Android says the phone is**, for the open question on spotting a Seeker.

Run: `adb shell getprop ro.product.model; adb shell getprop ro.product.brand; adb shell getprop ro.product.manufacturer`
Record the three values in the report. They are what React Native's `Platform.constants` (`Model`, `Brand`, `Manufacturer`) would read.

Report what each step printed and the screenshots' names. Nothing to commit in this task.

---

## Known limits

- **Seats are read once, at launch.** If the read fails three times, the launch isn't marked counted, and the next start's catch-up reads it again. By then claims have closed most seats, so KOL, Raider and the Diamond Hands shares cover only the seats still open.
- **Launches from before the deploy.** The first start counts each launch in the server's store (up to 100,000):
  - Dev, only if the presale account still exists (the creator is read from it);
  - KOL, only for seats still open;
  - Raider, only for confirmed referrals whose joiner still has a seat.
  - A presale whose account is gone is marked counted with nothing given.
- **Diamond Hands for a coin that migrated while the server was down** is checked when the catch-up runs, not at the migration. A wallet that sold in between misses it, and one that bought back gets it.
- **A holdings read that fails at migration** leaves the migration uncounted. The next start tries again; Dev and KOL migration points aren't given twice.
- **The streak counts confirmed co-signs only.** A 202 (sent, not confirmed in time) that lands later gives no streak day. The streak gives no XP of its own.
- **The board is read on each `profiles` subscription:** up to 500 rows, each a few small SQLite reads. That's fine at today's numbers; with many sockets it would want a cached board.
- **The web knows the top 500, each pushed change, and your own row.** Someone else's profile outside the top 500 shows zeros until a push brings their row.
- **A pushed streak row can be a day old** when nobody acted since. The site and the phone work out today's run from `last` (`streakDays`), so what they show is right; the row itself isn't rewritten.
- **The Seeker-only Mooner trait isn't built** (open question 1). Genesis gives the mark and the bonus only.
- **The Browser pane check runs on the live site after the deploy** (Task 11). Before that, Task 10 checks the site with its tests, the type-check and a build.
- **The phone reads your own row once per wallet change** (`readXp`, Task 14). If that read fails, Me says so and only a push fills the row in; nothing reads it again until the wallet changes or the app restarts. There's no polling (the house rule: live data over sockets).
- **The phone's streak line is worked out when Me draws** (`meOf(row, Date.now())` in `MyXp`, which calls `streakLine`). A Me screen left open across UTC midnight shows the old line until something redraws it.
- **The phone's leaderboard spins until the server's first `xp` message.** Against a server without Task 7 (before Task 11's deploy) it spins for good. Me doesn't wait on it: your own row comes from the read.
- **Places on the phone count only the rows it has:** the top 500 by total, the rows pushed since, and your own. Below 500, and on a title's tab (whose top 500 by that title can differ from the top 500 by total), a place can read better than the true one.
- **The Genesis check shows on every phone** for a wallet without the mark, Seeker or not; the server decides by the token (Task 16's choice). A wallet without one gets the server's 404 line. Each check counts toward the server's limit (3 a minute per wallet).
- **Follow sits under each leaderboard row** (piece 5's `FollowButton`), so rows are taller than the web's. How it looks on the Seeker's screen is checked only in Task 18.
- **The phone keeps every XP row it is sent** for as long as the app runs (the top 500 plus pushes). There's no trimming.

## Open questions (for the controller and the user)

1. **The Seeker-only Mooner trait.** The spec's perk includes one; this plan doesn't draw art. Options:
   - (a) new trait art from the user or a designer, then a small task to add it to `web/src/lib/pfp/traits.ts`, locked to `genesis`;
   - (b) an existing trait made Genesis-only;
   - (c) no trait: the mark and the bonus only.
   Until there's an answer, the plan ships (c).
2. **Point values** (`POINTS` in `engine/src/xp.js`): Dev 100 at launch and 200 at migration; KOL 25 and 50; Raider 25 per confirmed join; Diamond Hands 100; Genesis 250. They sit on the existing curve (`LEVEL_XP` 0/100/300/800/2000). They're product numbers for the user to confirm; the tests read them from the table, so changing them is a one-file change.
3. **The streak gives no XP** and shows as a line on the profile and Me. Should a run of days give points or a badge?
4. **Raider counts confirmed referrals only.** `referrals.js`'s header said the seat check would also settle unconfirmed rows; Task 3 rewrites that sentence to match this. Is that the intent?
5. **The Genesis bonus counts in the total (Overall) only,** not in any title's XP or level.
6. **Diamond Hands' threshold** is the seat's floor share (`tokenShare`, as the claim pays it). A wallet holding even one base unit less misses it.
7. **A moved Genesis token.** The perk stays with the first wallet that claimed the mint; a second wallet holding it later gets 409. Is that the rule the user wants?
8. **Dev's level names** (Builder, Shipper, Founder, Launcher, Moonmaker) are new copy for the user to approve.
9. **Shiller's rocket and nine traits go to Dev** (Raider keeps the crossed swords and its own traits, per the merge). The alternatives are new art for Dev, or Shiller's traits merged into Raider.
10. **A wallet with no XP shows Dev I as its main title,** because `mainTitle` breaks ties by `TITLES` order and Dev is first.
11. **The creator's own seat gives Dev only, not KOL** (KOL is for backing someone else's presale).
12. **Showing the Genesis check only on a Seeker.** The phone half shows it on every phone, and the server decides (Task 16). Task 18 records what Android reports for `ro.product.model`, `ro.product.brand` and `ro.product.manufacturer` on the Seeker. With those values, the card could show only when they match. Any phone can report any values, so the server's check stays either way. Keep it for all, or hide it off-Seeker?
13. **Level names on the phone.** `LEVEL_NAMES` (Dev's Builder … Moonmaker and the others) live in `web/src/lib/levels.ts`, which the phone can't import. The phone shows "Level N". Move the names into `engine/src/xp.js` (one more small task, like Task 12) so the phone can say them?
14. **A button, not a check at sign-in.** The spec says a Genesis holder "sees its perk right after sign-in". The phone checks only when the user presses "Check this wallet" (a sign-in costs a Seed Vault prompt, and a check costs one of the server's 3 a minute). Should it check by itself right after the first sign-in on a Seeker?
15. **Wallets with no XP aren't on the phone's board** (`boardOf` keeps rows above 0). Whether the web's board matches isn't checked here. Should both show zero rows, or neither?
16. **Places past 500.** The phone numbers every row it has, so a place past the top 500 can be off (see Known limits). Hide places past 500, or show them as they are?

## Self-review

**Spec coverage** (spec "XP ledger", "Genesis perk", "Where it shows"; brief items):

| Spec item | Where |
|---|---|
| `xp(wallet, title, points, reason, ref, at)`, nothing counted twice | Task 2 (`UNIQUE (wallet, reason, ref)`) |
| Dev, KOL, Raider (confirmed, not yourself, one referrer per join), Diamond Hands | Task 3 |
| Streak: consecutive UTC days with a confirmed join or open | Task 1 (`streakOf`), Task 2 (`activity`), Task 4 (the co-sign) |
| Points in one table; the existing `xpForLevel` curve | Task 1 (`POINTS`; `LEVEL_XP` moved unchanged), Task 9 (the web re-exports it) |
| `GET /api/xp/:wallet`, the `profiles` topic | Task 6, Task 7, wired in Task 8 |
| Genesis check against real mainnet bytes; one token, one perk | Task 5 (fixtures), Task 2 (`claimGenesis`), Task 6 (`POST /api/genesis`) |
| Perk: badge, XP bonus | bonus: Tasks 1-2; web mark: Task 10; phone mark: Task 16 (the gold "Seeker Genesis" pill) |
| Perk: Seeker-only trait | not built: open question 1 |
| `levels.ts`: Dev in, Shiller out | Task 9 |
| Web leaderboard and profile on real data, checked in the browser pane | Tasks 9-10; the browser pane check in Task 11, after the deploy |
| Phone Me tab and leaderboard with `FollowButton` | Me: Task 16 (`MyXp`); the leaderboard: Task 15, `FollowButton` on each row but yours |
| Phone: the store's `onProfiles` takes `xp` rows, merged by wallet | Task 14 (`mergeXp` from Task 13) |
| Phone: one `api.xp(wallet)` read that never overwrites a pushed row; no polling | Task 14 (`readXp`, `mergeXp(…, true)`; tested with a push arriving mid-read) |
| Phone: titles, levels and points from `engine/src/xp.js` only | Task 13 (`rows.js` imports the shared rules; no numbers of its own) |
| Phone: the streak with the web's rule and words | Task 12 moves `streakDays`/`streakLine` into `engine/src/xp.js`; Task 13 uses them; Task 17 points the web at them |
| Phone: Genesis via the kept sign-in or `signIn(signer)`, then `api.genesis(token)`; a 401 clears the sign-in like chat | Task 14 (`checkGenesis`, `forgetSignIn` shared with `sendChat`) |
| Phone: who sees the Genesis check | every wallet without the mark; the server decides (Task 16; open question 12) |
| Phone: on the Seeker itself | Task 18, with the user present |

**Placeholders:** none. Every code step has its code, and every check has its command and expected output. A search for TBD, TODO, "implement later", "fill in", "similar to Task", "appropriate error" and "edge cases" finds nothing.

**Type consistency (checked across tasks):**
- The XP row's fields (`wallet`, `total`, `titles`, `counts`, `streak`, `genesis`) are the same in `XpLedger.row` (Task 2), the data shapes above, the web's `XpRow` (Task 10) and every test fixture.
- `XpRules`' constructor keys (Task 3) are what `main.js` passes (Task 8).
- `xp.active(wallet, at)` is `api.js`'s call (Task 4) and `XpRules.active` (Task 3).
- `xpBoard`, `xpChanged` and `isMigrated` (Task 7) are what Task 8 uses.
- `makeXpRoutes({ ledger, l1, walletOf, onXp })` (Task 6) matches Task 8.
- `api.xp` and `api.genesis` (Task 8) are what the web store (Task 10) and the phone half call.
- `Title`, `TitleStats`, `UserXp` (Task 9) are what `xp.ts` (Task 10) returns.
- `streakDays(streak, now)` and `streakLine(streak, now)` (Task 12) are what `rows.js` (Task 13) calls and what `xp.ts` re-exports (Task 17), with the web's names and arguments unchanged.
- `mergeXp(prev, rows, onlyNew)`, `meOf(row, now)`, `boardOf(rows, board, me)`, `BOARDS`, `GENESIS_XP` and `xpText` (Task 13) are what the store (Task 14), the leaderboard (Task 15) and `MyXp` (Task 16) use.
- The store's `xp`, `xpLoaded`, `xpFailed` and `checkGenesis(signer)` (Task 14) are what Tasks 15 and 16 read. `checkGenesis` returns `{ ok: true, fresh, genesis }` or `{ ok: false, error }`, which is what `MyXp` reads.
- `FollowButton` (piece 5 Task 10, `src/alerts/FollowButton.js`) is used in Task 15 only.

**Verified while writing:** each task's blocks were applied to scratch copies of `engine/` and `web/`, and their tests, type-check and build ran there:
- engine: Tasks 1-8, 32 new tests;
- web: Tasks 9-10, 7 new tests;
- web type-check: 55 errors before and after, the same list;
- `vite build`: passes, with a dummy Privy id in the scratch copy.

The phone half was checked the same way, in its own scratch copies of `engine/`, `mobile/` and `web/`, with Tasks 12-17 applied in order:
- engine: Task 12, 2 new tests (run with `xp.test.js`; the whole engine suite wasn't run there);
- mobile: Task 13 took `npm test` from 258 to 267, and Task 14 to 275, `# fail 0`. Task 14's 8 tests failed before its code;
- mutants, each applied alone, each failing at least one test: in `rows.js`, a merge that edits `prev` in place, a merge that lets the read overwrite a row, and a board that keeps zero rows; in the store, `checkGenesis` using an expired sign-in, a 401 that keeps the sign-in, and the answer's row not kept;
- Tasks 15-16: the parse check passes on `app/leaderboard.js`, `src/xp/MyXp.js` and `app/(tabs)/me.js`, and every named import exists in its module;
- web: Task 17 left the web tests at 58 passing, the type-check list unchanged, and `vite build` passing.

Not run while writing (the rules for writing it): `sh scripts/check-bundle.sh` (Metro), anything on the phone, and the whole engine suite. Tasks 15 and 16 have no render tests, so how the screens look is first seen in Task 18.

No code in the repo was changed.
