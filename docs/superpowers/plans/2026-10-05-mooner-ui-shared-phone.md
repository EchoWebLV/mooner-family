# Mooner UI, plan 1 of 2: shared code and the phone app

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the approved Terminal UI + cozy art (`docs/superpowers/specs/2026-10-05-mooner-terminal-cozy-ui-design.md`) on the phone app, on real data: Pulse with three lanes, the room with its scene, crowd and chat emojis, the launch moments (pool full, 3-2-1, launching, live) driven by chain state, the 16 sounds and calm motion.

**Architecture:** three pure modules in `engine/src/` (`emoji.js`, `cues.js`, `launchsteps.js`) hold what both apps share and are tested under `node:test`. The phone adds pure helpers next to its screens (`moves.js`, `lanes.js`, new functions in `room.js`), tested the same way, and thin React Native components on top: `motion.js` (core `Animated`, native driver), `sound.js` (`expo-audio`), `Scene`, `Host`, `Cells`, `LaunchMoment`. Plan 2 (`2026-10-05-mooner-ui-web.md`) does the website on the same shared modules.

**Tech Stack:** Node 22 `node:test`; Expo SDK 55, React Native 0.83, expo-router, zustand; `expo-audio` (new); `react-native-svg` (already in the app) for the scene veil.

---

## Before you start

- Branch: `feat/mooner-wireframe`. Repo root: `/Users/yordanlasonov/Documents/GitHub/mooner`. Every command below starts from the repo root unless it says `cd`.
- Baselines (2026-10-05): engine `cd engine && npm test` → **466 pass, 0 fail**; phone `cd mobile && npm test` → **258 pass, 0 fail**.
- The phone's pure modules import with explicit `.js` extensions and never import `react-native`, so Node runs them. Components may import anything.
- No CI exists. The phone has no lint or typecheck: the tests, `npm run bundle:check` and the Seeker build are the checks.
- Rules that hold everywhere: no game words in copy ("wallets", not "players"; no "lobby", "match"); flat look (no shadows, glows, bevels); no bumps, press-scale, shake, bursts or numbers counting up; never `adb uninstall`; never read the release key or its Gradle properties.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (shown in each commit step as a second `-m`).

## Notes against the spec

Where this plan differs from the spec, and why. Task 15 updates the spec's text to match.

1. **Migrated lane order.** The spec says "newest migration first". `launched` rows carry no migration time (`{presale, mint, token, launch:{sig,released,cost,tokens,units,at}, pool:{address,quoteReserve,sqrtPrice,migrated,damm}}`), so the lane sorts by newest launch (`launch.at`).
2. **No "≈ tokens" on the phone's seat card.** The web's estimate (`allocationFor` in `web/src/lib/curve.ts`) uses web-only constants; the engine has no shared curve estimate. The phone shows "Your seat · X SOL" and the real token amount once they arrive (live screen).
3. **No "change" on the phone's Pulse market cards.** The `launched` feed has no price history, and a socket watches at most 4 coins (`coin:<mint>`). Cards show market cap and the curve.
4. **Pulse cards leaving a lane don't fade on the phone.** Core `Animated` can't animate an unmount without a library. New cards and lane counts fade in.
5. **The room keeps the coin's About and links card,** below your seat.
6. **The room's host lines until XP exists:** with a seat, "Share your link. It launches the moment the pool is full."; without one, "Take a seat. It launches the moment the pool is full."
7. **`C.erSoft` and `C.migratedSoft`** use alpha 0.13 (`21` in hex), the web's `--gold-soft` alpha. The web has no er or migrated soft colour to copy.
8. **Live screen timing.** `momentStep` turns "live" when the `launched` row arrives, which is the launch transaction, before any tokens move. The live screen waits for your claim (`claimedOf`) or for all four steps; until then the launching screen shows. This is the spec's rule, made explicit in `momentScreen`.
9. **New chat lines vs the snapshot.** The store marks rows pushed one by one with `live: true`, so the chat sound and floating emojis react to new lines only, never to the snapshot a room opens with.
10. **New Pairs order** uses `openedTs` (seconds, from the presale account) for "newest first".
11. **The phone's `LaunchOverlay.js` is replaced by `LaunchMoment.js`** plus three screen files, because the four screens don't fit one file.
12. **The launch is tested on mainnet.** The Seeker app runs on mainnet only, so the recording needs a mainnet presale (the 0.5 SOL testing pool) that the user fills. Agents never spend from a wallet.
13. **Screen sounds come from the route.** The root layout reports each pathname change (`screens.js`): `whoosh` into a room, `tap` into any other screen, nothing before the first touch. `TopBar` stays unchanged.
14. **Pool full keeps the demo's timing:** the stamp at 0, the coin at 350 ms, the crowd at 650 ms, 3-2-1 from 1500 ms every 820 ms, GO at 3960 ms, launching at 4610 ms. The host's line there is quiet, so `host` doesn't play over the stamp and the count.
15. **Floating emojis** show on the room, launching and live screens; the chat strip on the room and launching screens (spec §3, §4).
16. **No faces on Pulse's launching cards.** List rows carry `users` only while OPEN (`listItem`), so FULL and LAUNCHING cards show the pool without faces. For the same reason the room's "N wallets in · X SOL to go" line waits for the detail view.
17. **Device checks need a release rebuild.** The app on the Seeker is a release build with its JS inside (no Metro), so each phone task with a device check runs `scripts/run-android.sh`.
18. **The host's lines stay in its bubble.** They aren't added to the chat list (the spec said "in the room's chat as Mooner").
19. **Share moved.** With a seat the main button is "Invite"; without one, Share is a round button over the scene.
20. **"+N" in the crowd isn't tappable,** and **a picked emoji is added at the end of the message,** not at the cursor.
21. **The scene's veil is dark at the top too,** so the top row reads without a text shadow.

## File map

| File | New / changed | What it holds |
|---|---|---|
| `engine/src/emoji.js` | new | `EMOJI`, `CHAT_MAX`, `chatParts`, `emojiOnly`, `emojisIn`, `codePoints`, `clipChat` |
| `engine/src/cues.js` | new | `CUES` (name → volume), `QUIET_ON_PULSE`, `allowedOn`, `SHEET_CLOSE`, `CHAT_SOUND_GAP_MS`, `chatGate`, `FLOAT_MAX`, `FLOAT_GAP_MS` |
| `engine/src/launchsteps.js` | new | `STEP_LABELS`, `launchSteps(view, row)` |
| `engine/test/{emoji,cues,launchsteps}.test.js` | new | their tests (`cues` also checks both apps' asset folders) |
| `mobile/assets/{scenes,emoji,sfx}/`, `mobile/assets/host.png` | new | art and sounds, copied from the mockup |
| `web/public/{scenes,emoji,sfx}/`, `web/public/host.png` | new | the same for the web (used in plan 2; copied here so the engine test checks both) |
| `mobile/src/ui/moves.js` | new, pure | `MOVES`, `moveFor`, `TYPE_MS`, `typedText` |
| `mobile/src/ui/motion.js` | new | `useReducedMotion`, `Move`, `FadeOnce` |
| `mobile/src/ui/sound.js` | new | `loadSounds`, `play`, `soundsOn`, `setSoundsOn`, `useSoundsOn`; screen sounds: `arm`, `nextScreen`, `screenChange` |
| `mobile/src/ui/screens.js` | new, pure | `screenCue`: `whoosh` into a room, `tap` into any other screen |
| `mobile/package.json`, `package-lock.json`, `app.json` | changed | `expo-audio`, with the microphone blocked and no background playback |
| `mobile/src/ui/Scene.js`, `Host.js`, `Cells.js`, `emojis.js` | new | scene with veil, talking host, pool cells, emoji picture map |
| `mobile/src/ui/theme.js`, `kit.js` | changed | soft colours; `up` button, no press scale, sheet sound (`TopBar.js` unchanged: back's `tap` comes from the route) |
| `mobile/src/ui/icons.js`, `mobile/app/connect.js` | changed | `LaunchedIcon` gone; words that named the old tabs |
| `mobile/src/live/lanes.js` | new, pure | `newPairs`, `finalStretch`, `migrated`, `filling`, `EXPIRED_STAYS_MS` |
| `mobile/src/live/PresaleCard.js` | rewritten | Pulse presale card |
| `mobile/src/launched/MarketCard.js` | new | Pulse market card (replaces `CoinRow.js`) |
| `mobile/app/(tabs)/index.js`, `_layout.js` | rewritten / changed | Pulse with three lanes; tabs Pulse · Create · Me |
| `mobile/app/(tabs)/launched.js`, `mobile/src/launched/CoinRow.js` | deleted | replaced by Pulse |
| `mobile/src/store.js` | changed | chat rows pushed live get `live: true`; `liveList` and `launchedList` removed |
| `mobile/src/room/room.js` | changed, pure | `cellsOf`, `poolLine`, `newLines`, `joinedSince`, `momentScreen`; the seat's title; `momentStep`'s late case |
| `mobile/src/room/ChatText.js`, `EmojiRow.js`, `FloatingEmojis.js`, `useNewLines.js`, `ChatLines.js` | new | emoji chat pieces |
| `mobile/src/room/ChatSheet.js` | changed | emoji row, `ChatText`, code-point clipping |
| `mobile/src/room/YourSeat.js` | rewritten | `SeatCard` and `GetBack` (was `YourSeat`), `Line` |
| `mobile/src/room/Crowd.js` | new | the crowd grid |
| `mobile/app/presale/[key].js` | rewritten | the room |
| `mobile/src/room/LaunchMoment.js`, `MomentFull.js`, `MomentLaunching.js`, `MomentLive.js` | new | the launch moments: `useMoment` and `LaunchMoment`; pool full and failed; launching; live |
| `mobile/src/room/LaunchOverlay.js`, `mobile/src/ui/Ring.js` | deleted | replaced by the launch moments and the pool cells |
| `mobile/app/coin/[key].js`, `mobile/src/launched/TradeSheet.js` | changed | back goes to Pulse; "Bought" + `coins`; `tick` on a quote; values and cards rise in |
| `mobile/app/(tabs)/me.js` | changed | Sounds switch; "Join one from Pulse." |
| `mobile/app/_layout.js` | changed | loads the sounds at start; screen sounds by pathname, armed by the first touch |
| `mobile/test/{moves,lanes,screens}.test.mjs` | new | their tests |
| `mobile/test/room.test.mjs`, `store.test.mjs` | changed | new cases; removed selectors |

---

### Task 1: Chat emojis and the 280 code-point limit (engine)

**Files:**
- Create: `engine/src/emoji.js`
- Test: `engine/test/emoji.test.js`

- [ ] **Step 1: Write the failing test**

Create `engine/test/emoji.test.js`:

```js
// The 12 Mooner chat emojis, `$TICKER` links and the 280 code-point limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_MAX, EMOJI, chatParts, clipChat, codePoints, emojiOnly, emojisIn } from "../src/emoji.js";

test("EMOJI: the 12 names", () => {
  assert.deepEqual([...EMOJI].sort(), ["diamond", "fire", "gg", "gm", "jeet", "lfg", "moon", "ngmi", "pump", "rug", "ser", "wen"]);
});

test("chatParts: a known :name: is an emoji, an unknown one stays text", () => {
  assert.deepEqual(chatParts("gm :lfg: all"), [
    { kind: "text", text: "gm " },
    { kind: "emoji", name: "lfg", text: ":lfg:" },
    { kind: "text", text: " all" },
  ]);
  assert.deepEqual(chatParts(":nope: hi"), [{ kind: "text", text: ":nope: hi" }]);
  assert.deepEqual(chatParts(":LFG:"), [{ kind: "text", text: ":LFG:" }]);
  assert.deepEqual(chatParts(""), []);
  assert.deepEqual(chatParts(undefined), []);
});

test("chatParts: an unknown name doesn't swallow the known one after it", () => {
  assert.deepEqual(chatParts("a :foo:moon: b"), [
    { kind: "text", text: "a :foo" },
    { kind: "emoji", name: "moon", text: ":moon:" },
    { kind: "text", text: " b" },
  ]);
});

test("chatParts: $TICKER links only for coins in the map, next to emojis", () => {
  const tickers = new Map([["MOON", "mint1"]]);
  assert.deepEqual(chatParts("buy $moon :fire:", tickers), [
    { kind: "text", text: "buy " },
    { kind: "ticker", text: "$moon", tokenId: "mint1" },
    { kind: "text", text: " " },
    { kind: "emoji", name: "fire", text: ":fire:" },
  ]);
  assert.deepEqual(chatParts("buy $NOPE", tickers), [{ kind: "text", text: "buy $NOPE" }]);
  assert.deepEqual(chatParts("buy $MOON"), [{ kind: "text", text: "buy $MOON" }]);
});

test("chatParts: a ticker is 1 to 10 letters or digits and ends at a word boundary", () => {
  const tickers = new Map([["X", "mintX"], ["MOON", "mint1"], ["ABCDEFGHIJK", "mintK"]]);
  assert.deepEqual(chatParts("$x", tickers), [{ kind: "ticker", text: "$x", tokenId: "mintX" }]);
  assert.deepEqual(chatParts("$MOON_X", tickers), [{ kind: "text", text: "$MOON_X" }]);
  assert.deepEqual(chatParts("$ABCDEFGHIJK", tickers), [{ kind: "text", text: "$ABCDEFGHIJK" }]);
});

test("emojiOnly: only emojis and spaces", () => {
  assert.equal(emojiOnly(chatParts(":lfg: :moon:")), true);
  assert.equal(emojiOnly(chatParts(":lfg:")), true);
  assert.equal(emojiOnly(chatParts(":lfg: gm")), false);
  assert.equal(emojiOnly(chatParts("gm")), false);
  assert.equal(emojiOnly(chatParts("")), false);
});

test("emojisIn: the emojis in order, at most `max`", () => {
  assert.deepEqual(emojisIn(":lfg: x :moon::fire: :gg: :gm:", 4), ["lfg", "moon", "fire", "gg"]);
  assert.deepEqual(emojisIn("no emojis :nope:"), []);
});

test("280 code points: a one-code-point emoji counts once, as the server counts", () => {
  const rockets = "🚀".repeat(280);
  assert.equal(rockets.length, 560); // UTF-16 units, what maxLength counted
  assert.equal(codePoints(rockets), CHAT_MAX);
  assert.equal(clipChat(rockets), rockets);
  assert.equal(clipChat(rockets + "🚀"), rockets);
  assert.equal(clipChat("a".repeat(281)), "a".repeat(280));
  assert.equal(codePoints(null), 0);
  assert.equal(clipChat(null), "");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd engine && node --test test/emoji.test.js`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `../src/emoji.js`.

- [ ] **Step 3: Write the module**

Create `engine/src/emoji.js`:

```js
// Chat text, read the same way in both apps (spec §3): the 12 Mooner emojis typed as
// `:name:`, `$TICKER` links, and the server's 280 code-point limit (engine/server/social.js
// counts `[...text].length`). The text stays plain on the wire; each app draws the parts.

/** The 12 Mooner emojis. Each is a picture at <app assets>/emoji/<name>.png. */
export const EMOJI = ["lfg", "moon", "gm", "diamond", "jeet", "rug", "wen", "ngmi", "pump", "ser", "fire", "gg"];
const KNOWN = new Set(EMOJI);

/** The longest chat line, in code points (the server's limit). */
export const CHAT_MAX = 280;

const TOKEN = /:([a-z]+):|\$([A-Za-z0-9]{1,10})\b/g; // tickers: 1 to 10 letters or digits (engine/server/api.js)

/** `text` in parts, in order: { kind: "text", text } | { kind: "emoji", name, text } |
 *  { kind: "ticker", text, tokenId }. A `$TICKER` is a part only when `tickers` (a Map of
 *  upper-case ticker to token id) has it. An unknown `:name:` stays text, and its closing
 *  colon can still open a known one (":foo:moon:"). */
export function chatParts(text, tickers = null) {
  const s = text ?? "";
  const re = new RegExp(TOKEN);
  const parts = [];
  let last = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    const name = m[1];
    const tokenId = m[2] ? tickers?.get(m[2].toUpperCase()) : undefined;
    if (name ? !KNOWN.has(name) : !tokenId) {
      re.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) parts.push({ kind: "text", text: s.slice(last, m.index) });
    parts.push(name ? { kind: "emoji", name, text: m[0] } : { kind: "ticker", text: m[0], tokenId });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ kind: "text", text: s.slice(last) });
  return parts;
}

/** Whether a line is only emojis (and spaces): the apps draw those larger. */
export const emojiOnly = (parts) =>
  parts.some((p) => p.kind === "emoji") && parts.every((p) => p.kind === "emoji" || (p.kind === "text" && !p.text.trim()));

/** The emoji names in `text`, in order, at most `max`: the ones that float up. */
export const emojisIn = (text, max = Infinity) =>
  chatParts(text).filter((p) => p.kind === "emoji").slice(0, max).map((p) => p.name);

/** The length the server counts: code points, so a one-code-point emoji counts once (a skin
 *  tone or a flag counts each of its code points, as the server does). */
export const codePoints = (text) => Array.from(text ?? "").length;

/** `text` cut to `max` code points (never in the middle of a surrogate pair; a skin tone or
 *  flag at the very end can still be cut, which the server accepts). */
export function clipChat(text, max = CHAT_MAX) {
  const s = text ?? "";
  const cps = Array.from(s);
  return cps.length > max ? cps.slice(0, max).join("") : s;
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `cd engine && node --test test/emoji.test.js`
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add engine/src/emoji.js engine/test/emoji.test.js
git commit -m "engine: chat emojis (:name:) next to \$TICKER links, and the 280 code-point limit, for both apps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Assets in both apps, and the cue table (engine)

**Files:**
- Create: `mobile/assets/host.png`, `mobile/assets/scenes/{room,launching,live}.jpg`, `mobile/assets/emoji/<12>.png`, `mobile/assets/sfx/<16>.mp3`, and the same under `web/public/`
- Create: `engine/src/cues.js`
- Test: `engine/test/cues.test.js`

- [ ] **Step 1: Write the failing test**

Create `engine/test/cues.test.js`:

```js
// The cue table, and the sounds, emojis, scenes and host both apps ship.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { CHAT_SOUND_GAP_MS, CUES, FLOAT_GAP_MS, FLOAT_MAX, QUIET_ON_PULSE, SHEET_CLOSE, allowedOn, chatGate } from "../src/cues.js";
import { EMOJI } from "../src/emoji.js";

const APPS = ["../../mobile/assets/", "../../web/public/"];
const filesIn = (dir) => new Set(readdirSync(new URL(dir, import.meta.url)));

test("16 cues, each with a volume above 0 and at most 1", () => {
  assert.equal(Object.keys(CUES).length, 16);
  for (const [cue, v] of Object.entries(CUES)) assert.ok(v > 0 && v <= 1, cue);
  assert.equal(CUES.tap, 0.5);
  assert.equal(CUES.tick, 0.3);
  assert.equal(CUES.stamp, 0.75);
});

test("every cue has its sound in both apps", () => {
  for (const app of APPS) {
    const have = filesIn(`${app}sfx/`);
    for (const cue of Object.keys(CUES)) assert.ok(have.has(`${cue}.mp3`), `${app}sfx/${cue}.mp3`);
  }
});

test("every emoji has its picture in both apps", () => {
  for (const app of APPS) {
    const have = filesIn(`${app}emoji/`);
    for (const name of EMOJI) assert.ok(have.has(`${name}.png`), `${app}emoji/${name}.png`);
  }
});

test("the three scenes and the host are in both apps", () => {
  for (const app of APPS) {
    const scenes = filesIn(`${app}scenes/`);
    for (const s of ["room", "launching", "live"]) assert.ok(scenes.has(`${s}.jpg`), `${app}scenes/${s}.jpg`);
    assert.ok(filesIn(app).has("host.png"), `${app}host.png`);
  }
});

test("Pulse plays only tap", () => {
  assert.deepEqual(QUIET_ON_PULSE, ["tap"]);
  assert.equal(allowedOn("tap", "pulse"), true);
  assert.equal(allowedOn("chat", "pulse"), false);
  assert.equal(allowedOn("chat", "room"), true);
});

test("chatGate: at most one chat sound every 400 ms", () => {
  assert.equal(CHAT_SOUND_GAP_MS, 400);
  const gate = chatGate();
  assert.equal(gate(1000), true);
  assert.equal(gate(1399), false);
  assert.equal(gate(1400), true);
  assert.equal(gate(1500), false);
});

test("a closing sheet plays faster and lower; floats are 4 at most, 260 ms apart", () => {
  assert.deepEqual(SHEET_CLOSE, { rate: 1.15, volume: 0.8 });
  assert.equal(FLOAT_MAX, 4);
  assert.equal(FLOAT_GAP_MS, 260);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd engine && node --test test/cues.test.js`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `../src/cues.js`.

- [ ] **Step 3: Copy the assets**

The mockup folder is gitignored and exists only in the main checkout, so the source path is absolute. Scenes map lobby → room, loading → launching, victory → live; tall ones go to the phone, wide ones to the web.

```bash
SRC=/Users/yordanlasonov/Documents/GitHub/mooner/.superpowers/brainstorm/49580-1791193657/content
mkdir -p mobile/assets/scenes mobile/assets/emoji mobile/assets/sfx web/public/scenes web/public/emoji web/public/sfx
cp "$SRC/cz-host.png" mobile/assets/host.png
cp "$SRC/cz-host.png" web/public/host.png
for pair in lobby:room loading:launching victory:live; do from=${pair%%:*}; to=${pair##*:}; cp "$SRC/cz-$from-tall.jpg" "mobile/assets/scenes/$to.jpg"; cp "$SRC/cz-$from-wide.jpg" "web/public/scenes/$to.jpg"; done
for f in "$SRC"/emo-*.png; do n=$(basename "$f" .png); n=${n#emo-}; cp "$f" "mobile/assets/emoji/$n.png"; cp "$f" "web/public/emoji/$n.png"; done
for f in "$SRC"/sfx-*.mp3; do n=$(basename "$f" .mp3); n=${n#sfx-}; cp "$f" "mobile/assets/sfx/$n.mp3"; cp "$f" "web/public/sfx/$n.mp3"; done
ls mobile/assets/scenes mobile/assets/emoji mobile/assets/sfx | wc -l
```

Expected: the last line prints `36` (3 scenes + 12 emojis + 16 sounds, plus 3 folder header lines and 2 blank lines from `ls`). `ls web/public/sfx | wc -l` prints `16`.

- [ ] **Step 4: Write the cue table**

Create `engine/src/cues.js`:

```js
// The sounds both apps play (spec, Sound): each cue's name and volume (0..1), and the rules
// on when they may play. The files are mobile/assets/sfx/<cue>.mp3 and
// web/public/sfx/<cue>.mp3 (engine/test/cues.test.js checks both). Pure: each app plays them
// its own way (mobile/src/ui/sound.js, web/src/lib/sound.ts).

export const CUES = {
  tap: 0.5,
  join: 0.55,
  tick: 0.3,
  poolfull: 0.7,
  count: 0.6,
  go: 0.7,
  liftoff: 0.75,
  step: 0.5,
  coins: 0.6,
  xp: 0.55,
  host: 0.45,
  whoosh: 0.45,
  stamp: 0.75,
  chat: 0.4,
  emoji: 0.5,
  sheet: 0.45,
};

/** The only cues Pulse plays: it's quiet but for switching lanes and opening a coin. */
export const QUIET_ON_PULSE = ["tap"];

/** Whether `cue` may play on `screen` ("pulse", or any other screen's name). */
export const allowedOn = (cue, screen) => screen !== "pulse" || QUIET_ON_PULSE.includes(cue);

/** A sheet closing plays `sheet` faster and lower than opening. */
export const SHEET_CLOSE = { rate: 1.15, volume: 0.8 };

/** At most one `chat` cue this often (ms). */
export const CHAT_SOUND_GAP_MS = 400;

/** A gate for the chat cue: gate(nowMs) is true when a chat sound may play now, and then
 *  counts it. One gate per screen. */
export function chatGate(gapMs = CHAT_SOUND_GAP_MS) {
  let last = -Infinity;
  return (nowMs) => {
    if (nowMs - last < gapMs) return false;
    last = nowMs;
    return true;
  };
}

/** Floating emojis: at most this many per chat line, this many ms apart. */
export const FLOAT_MAX = 4;
export const FLOAT_GAP_MS = 260;
```

- [ ] **Step 5: Run it to make sure it passes**

Run: `cd engine && node --test test/cues.test.js`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add engine/src/cues.js engine/test/cues.test.js mobile/assets/host.png mobile/assets/scenes mobile/assets/emoji mobile/assets/sfx web/public/host.png web/public/scenes web/public/emoji web/public/sfx
git commit -m "engine+mobile+web: the 16 cues and their volumes, and the scenes, host, emojis and sounds in both apps (a test checks every file is there)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The launch's four steps from chain state (engine)

**Files:**
- Create: `engine/src/launchsteps.js`
- Test: `engine/test/launchsteps.test.js`

- [ ] **Step 1: Write the failing test**

Create `engine/test/launchsteps.test.js`:

```js
// The launch's four steps, from the presale's state and its launched row: never a timer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP_LABELS, launchSteps } from "../src/launchsteps.js";

const seat = (user, commit) => ({ user, commit: String(commit), deposit: String(commit), creator: false });
const states = (r) => r.steps.map((s) => s.state);
const ROW = { presale: "P", mint: "M", launch: { at: 1 } };

test("the four labels", () => {
  assert.deepEqual(STEP_LABELS, ["Pool full", "Meteora pool created", "One buy, one price for everyone", "Sending everyone their tokens"]);
});

test("FULL with no launched row yet: the pool is being made", () => {
  const r = launchSteps({ state: "FULL", seats: [seat("a", 5)] }, undefined);
  assert.deepEqual(states(r), ["done", "now", "todo", "todo"]);
  assert.equal(r.toGo, null);
  assert.equal(r.done, false);
  assert.equal(r.failed, false);
  assert.equal(r.steps[3].label, "Sending everyone their tokens");
});

test("the launched row ticks the pool and the buy together; committed seats left are to go", () => {
  const r = launchSteps({ state: "LAUNCHING", seats: [seat("a", 5), seat("b", 3), seat("c", 0)] }, ROW);
  assert.deepEqual(states(r), ["done", "done", "done", "now"]);
  assert.equal(r.toGo, 2); // c has nothing in the pool
  assert.deepEqual(r.steps.map((s) => s.label), [...STEP_LABELS.slice(0, 3), "Sending everyone their tokens · 2 to go"]);
  assert.equal(r.done, false);
});

test("every seat claimed: all four done", () => {
  const r = launchSteps({ state: "SETTLED", seats: [] }, ROW);
  assert.deepEqual(states(r), ["done", "done", "done", "done"]);
  assert.equal(r.toGo, 0);
  assert.equal(r.done, true);
  assert.equal(r.steps[3].label, "Sending everyone their tokens");
});

test("SETTLED counts as launched before its row comes", () => {
  const r = launchSteps({ state: "SETTLED", seats: [seat("a", 1)] }, undefined);
  assert.deepEqual(states(r), ["done", "done", "done", "now"]);
  assert.equal(r.toGo, 1);
});

test("a closed record with its launch is done", () => {
  const r = launchSteps({ state: "CLOSED", launch: { sig: "S" }, seats: [] }, undefined);
  assert.equal(r.done, true);
  assert.equal(r.failed, false);
});

test("closed after its launch: done, even with seats a client still holds", () => {
  for (const view of [{ state: "CLOSED", launch: { sig: "S" }, seats: [seat("a", 5)] }, { state: "CLOSED", launch: { sig: "S" } }]) {
    const r = launchSteps(view, undefined);
    assert.equal(r.toGo, 0);
    assert.equal(r.done, true);
    assert.equal(r.steps[3].label, "Sending everyone their tokens");
  }
  assert.equal(launchSteps({ state: "CLOSED", seats: [seat("a", 5)] }, ROW).done, true);
});

test("a view with no seats (the list's) never says the tokens went out", () => {
  const r = launchSteps({ state: "SETTLED" }, ROW);
  assert.equal(r.toGo, null);
  assert.deepEqual(states(r), ["done", "done", "done", "now"]);
  assert.equal(r.done, false);
});

test("FAILED, EXPIRED, or CLOSED without a launch: failed, and no step is now", () => {
  for (const state of ["FAILED", "EXPIRED", "CLOSED"]) {
    const r = launchSteps({ state, seats: [] }, undefined);
    assert.deepEqual(states(r), ["done", "todo", "todo", "todo"], state);
    assert.equal(r.failed, true, state);
    assert.equal(r.done, false, state);
  }
});

test("no view yet: only the pool step", () => {
  const r = launchSteps(undefined, undefined);
  assert.deepEqual(states(r), ["done", "now", "todo", "todo"]);
  assert.equal(r.failed, false);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd engine && node --test test/launchsteps.test.js`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `../src/launchsteps.js`.

- [ ] **Step 3: Write the module**

Create `engine/src/launchsteps.js`:

```js
// The launch's four steps on the screen after POOL FULL, from what the chain says (spec §4),
// never from a timer. The phone (mobile/src/room/MomentLaunching.js) and the website
// (web/src/components/presale/LaunchSequence.tsx) both draw these.
import { whoIsIn } from "./views.js";

export const STEP_LABELS = ["Pool full", "Meteora pool created", "One buy, one price for everyone", "Sending everyone their tokens"];

/**
 * `view`: the presale's detail view (with `seats`), or undefined; `row`: its `launched` row,
 * or undefined. Returns { steps: [{ label, state: "done" | "now" | "todo" }], toGo, done,
 * failed }.
 * - The pool and the pot's one buy are one transaction (programs/presale/src/launch.rs), so
 *   both tick when the row, or a launched state, is seen.
 * - toGo: the committed seats still in the room once launched (a claim closes a seat), or
 *   null before launch or when the view has no seats (a list view). Only a known 0 finishes.
 *   A launched presale that is CLOSED has 0 to go whatever seats a client still holds: the
 *   program closes a settled presale only once every seat has claimed (finish.rs).
 * - "Pool full" is always done: this is for the screens after POOL FULL; callers don't ask
 *   for an OPEN presale. LAUNCHING never outlives its transaction (release and settle are in
 *   the same one), so a LAUNCHING view counts as launched only with its row.
 * - failed: the presale ended without a launch; then no step is "now".
 */
export function launchSteps(view, row) {
  const state = view?.state;
  const launched = !!row || state === "SETTLED" || (state === "CLOSED" && !!view?.launch);
  const failed = !launched && (state === "FAILED" || state === "EXPIRED" || state === "CLOSED");
  const toGo = launched && state === "CLOSED" ? 0 : launched && Array.isArray(view?.seats) ? whoIsIn(view).length : null;
  const done = [true, launched, launched, toGo === 0];
  const now = failed ? -1 : done.indexOf(false);
  const steps = STEP_LABELS.map((label, i) => ({
    label: i === 3 && toGo > 0 ? `${label} · ${toGo} to go` : label,
    state: done[i] ? "done" : i === now ? "now" : "todo",
  }));
  return { steps, toGo, done: done.every(Boolean), failed };
}
```

- [ ] **Step 4: Run it, then the whole engine suite**

Run: `cd engine && node --test test/launchsteps.test.js`
Expected: `# pass 10`, `# fail 0`.

Run: `cd engine && npm test`
Expected: `# pass 491`, `# fail 0` (466 + 8 + 7 + 10).

- [ ] **Step 5: Commit**

```bash
git add engine/src/launchsteps.js engine/test/launchsteps.test.js
git commit -m "engine: the launch's four steps from the presale's state, its launched row and the seats left, for both apps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Motion, soft colours, the `up` button, no press scale (phone)

**Files:**
- Create: `mobile/src/ui/moves.js`, `mobile/src/ui/motion.js`
- Test: `mobile/test/moves.test.mjs`
- Modify: `mobile/src/ui/theme.js`, `mobile/src/ui/kit.js`

- [ ] **Step 1: Write the failing test**

Create `mobile/test/moves.test.mjs`:

```js
// The phone's moves as numbers: entrances, the scenes' slow moves, Reduce motion, typing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVES, TYPE_MS, moveFor, typedText } from "../src/ui/moves.js";

test("entrances: each end has opacity, y and scale", () => {
  assert.deepEqual(moveFor("rise"), { ms: 450, ease: [0, 0, 0.58, 1], from: { opacity: 0, y: 16, scale: 1 }, to: { opacity: 1, y: 0, scale: 1 } });
  const pop = moveFor("pop");
  assert.deepEqual(pop.ease, [0.3, 1.6, 0.5, 1]);
  assert.deepEqual(pop.from, { opacity: 0, y: 0, scale: 0.3 });
  const stamp = moveFor("stamp");
  assert.equal(stamp.from.scale, 2.4);
  assert.equal(stamp.ms, 500);
  assert.equal(moveFor("fade").ms, 250);
  assert.equal(moveFor("slideUp").from.y, 40);
});

test("the scenes: a slow zoom out, and a lift into place", () => {
  const kb = moveFor("kenBurns");
  assert.equal(kb.ms, 9000);
  assert.equal(kb.from.scale, 1.14);
  assert.equal(kb.to.scale, 1.02);
  const lift = moveFor("lift");
  assert.deepEqual(lift.from, { opacity: 1, y: 90, scale: 1.12 });
  assert.equal(lift.ms, 1500);
});

test("Reduce motion: entrances fade, scenes hold still at their end", () => {
  assert.deepEqual(moveFor("pop", true), moveFor("fade"));
  assert.deepEqual(moveFor("stamp", true), moveFor("fade"));
  const kb = moveFor("kenBurns", true);
  assert.equal(kb.ms, 0);
  assert.deepEqual(kb.from, kb.to);
  assert.equal(kb.to.scale, 1.02);
  assert.equal(moveFor("lift", true).ms, 0);
});

test("only the seven moves; a bump isn't one", () => {
  assert.throws(() => moveFor("bump"), /unknown move: bump/);
  assert.equal(Object.keys(MOVES).length, 7);
});

test("typedText: one code point every 18 ms", () => {
  assert.equal(TYPE_MS, 18);
  assert.equal(typedText("gm 🚀", 0), "");
  assert.equal(typedText("gm 🚀", 17), "");
  assert.equal(typedText("gm 🚀", 18), "g");
  assert.equal(typedText("gm 🚀", 54), "gm ");
  assert.equal(typedText("gm 🚀", 72), "gm 🚀");
  assert.equal(typedText("gm 🚀", 10_000), "gm 🚀");
  assert.equal(typedText(null, 100), "");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd mobile && node --test test/moves.test.mjs`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `../src/ui/moves.js`.

- [ ] **Step 3: Write the moves**

Create `mobile/src/ui/moves.js`:

```js
// The phone's motion (spec, Motion) as plain numbers, so Node tests check them: how each kind
// of entrance moves, the scenes' slow moves, and the host's typing. motion.js plays them with
// core Animated. Entrances only: no bumps, press scale, shake, bursts or count-ups.

/** Each move: its length (ms), its cubic-bezier ease, where it starts (`from`) and, when it
 *  doesn't end at rest, where it ends (`to`). Values: opacity, y (points, down) and scale. */
export const MOVES = {
  fade: { ms: 250, ease: [0, 0, 0.58, 1], from: { opacity: 0 } },
  rise: { ms: 450, ease: [0, 0, 0.58, 1], from: { opacity: 0, y: 16 } },
  pop: { ms: 450, ease: [0.3, 1.6, 0.5, 1], from: { opacity: 0, scale: 0.3 } },
  stamp: { ms: 500, ease: [0.2, 1.4, 0.4, 1], from: { opacity: 0, scale: 2.4 } },
  slideUp: { ms: 550, ease: [0.2, 0.8, 0.2, 1], from: { opacity: 0, y: 40 } },
  kenBurns: { ms: 9000, ease: [0, 0, 0.58, 1], from: { scale: 1.14 }, to: { scale: 1.02 } },
  lift: { ms: 1500, ease: [0.2, 0.8, 0.2, 1], from: { y: 90, scale: 1.12 } },
};

/** Where every move ends unless it says otherwise. */
export const REST = { opacity: 1, y: 0, scale: 1 };

/** A move ready to play: { ms, ease, from, to }, both ends with all three values. With
 *  `reduced` (Android's Reduce motion), an entrance is a plain fade and a scene's slow move
 *  holds still at its end (ms 0). */
export function moveFor(kind, reduced = false) {
  const m = MOVES[kind];
  if (!m) throw new Error(`unknown move: ${kind}`);
  const to = { ...REST, ...m.to };
  if (reduced) {
    if (kind === "kenBurns" || kind === "lift") return { ms: 0, ease: m.ease, from: to, to };
    return moveFor("fade");
  }
  return { ms: m.ms, ease: m.ease, from: { ...to, ...m.from }, to };
}

/** The host types one code point this often (ms). */
export const TYPE_MS = 18;

/** What the host has typed of `line` after `elapsedMs`: whole code points, so an emoji
 *  never shows half. */
export const typedText = (line, elapsedMs) =>
  Array.from(line ?? "").slice(0, Math.max(0, Math.floor(elapsedMs / TYPE_MS))).join("");
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `cd mobile && node --test test/moves.test.mjs`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Write the components that play them**

Create `mobile/src/ui/motion.js`:

```js
// Plays moves.js with core Animated on the native driver (opacity and transform only).
// `Move` runs its move once, when it mounts or its `kind` changes; give it a new `key` to
// run it again for new content. Reduce motion turns every entrance into a fade. A change to
// Reduce motion never replays a move: it applies to moves that start after it (a finished
// move ends in the same place either way).
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { moveFor } from "./moves";

let reducedNow = false;
const listeners = new Set();
let watching = false;

function setReduced(v) {
  reducedNow = !!v;
  listeners.forEach((l) => l(reducedNow));
}

function startWatching() {
  if (watching) return;
  watching = true;
  AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => {});
  AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
}

/** Whether Android's Reduce motion is on, kept up to date. */
export function useReducedMotion() {
  const [reduced, setLocal] = useState(reducedNow);
  useEffect(() => {
    startWatching();
    listeners.add(setLocal);
    setLocal(reducedNow);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);
  return reduced;
}

/** Its children, moving in once: `kind` is fade, rise, pop, stamp, slideUp, kenBurns or lift
 *  (moves.js); `delay` in ms. */
export function Move({ kind = "rise", delay = 0, style, children, pointerEvents }) {
  const reduced = useReducedMotion();
  const m = moveFor(kind, reduced);
  const tRef = useRef(null);
  if (!tRef.current) tRef.current = new Animated.Value(m.ms === 0 ? 1 : 0);
  const t = tRef.current;

  useEffect(() => {
    if (m.ms === 0) {
      t.setValue(1);
      return;
    }
    t.setValue(0);
    const run = Animated.timing(t, {
      toValue: 1,
      duration: m.ms,
      delay,
      easing: Easing.bezier(...m.ease),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, kind, delay]);

  const range = (a, b, clamp) =>
    t.interpolate({ inputRange: [0, 1], outputRange: [a, b], extrapolate: clamp ? "clamp" : "extend" });
  const moving = {
    opacity: range(m.from.opacity, m.to.opacity, true),
    transform: [{ translateY: range(m.from.y, m.to.y, false) }, { scale: range(m.from.scale, m.to.scale, false) }],
  };
  return (
    <Animated.View pointerEvents={pointerEvents} style={[style, moving]}>
      {children}
    </Animated.View>
  );
}

const faded = new Set();

/** Fades in the first time `id` shows while the app runs, and never again: Pulse's cards
 *  fade in once, not each time a list re-renders or the lane is swiped back to. */
export function FadeOnce({ id, style, children }) {
  const [fresh] = useState(() => !faded.has(id));
  useEffect(() => {
    faded.add(id);
  }, [id]);
  if (!fresh) return <View style={style}>{children}</View>;
  return (
    <Move kind="fade" style={style}>
      {children}
    </Move>
  );
}
```

- [ ] **Step 6: Soft colours, the `up` button, and no press scale**

In `mobile/src/ui/theme.js`, replace the line

```js
  er: "#3bd4ff", migrated: "#9d8cff",
```

with

```js
  er: "#3bd4ff", migrated: "#9d8cff",
  // soft fills for tags and cards, at the web's --gold-soft alpha (0.13)
  erSoft: "#3bd4ff21", migratedSoft: "#9d8cff21", goldSoft: "#ffb23e21",
```

In `mobile/src/ui/kit.js`:

1. In `BUTTONS`, after `gold: { bg: C.gold, ink: C.goldInk, rim: C.gold },` add:

```js
  up: { bg: C.up, ink: C.bg0, rim: C.up },
```

2. Replace the Button's doc line

```js
/** An oval, full-width button. kind is primary, quiet, danger or gold; busy swaps the title for a spinner. */
```

with

```js
/** An oval, full-width button. kind is primary, quiet, danger, gold or up; busy swaps the title for a spinner. */
```

3. Replace

```js
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
```

with

```js
        pressed && { opacity: 0.85 },
```

- [ ] **Step 7: Run the phone suite**

Run: `cd mobile && npm test`
Expected: `# pass 263`, `# fail 0` (258 + 5).

- [ ] **Step 8: Commit**

```bash
git add mobile/src/ui/moves.js mobile/src/ui/motion.js mobile/test/moves.test.mjs mobile/src/ui/theme.js mobile/src/ui/kit.js
git commit -m "mobile: calm motion (fade, rise, pop, stamp, slide up, the scenes' slow moves) on the native driver, Reduce motion as fades, the host's 18 ms typing; soft colours, an up button, and buttons no longer shrink when pressed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sounds, the screen clicks and the Sounds switch (phone)

**Files:**
- Create: `mobile/src/ui/screens.js`, `mobile/src/ui/sound.js`
- Test: `mobile/test/screens.test.mjs`
- Modify: `mobile/package.json` and `mobile/package-lock.json` (by `expo install`), `mobile/app.json`, `mobile/app/_layout.js`, `mobile/src/ui/kit.js` (Sheet), `mobile/app/(tabs)/me.js`

- [ ] **Step 1: Write the failing test**

Create `mobile/test/screens.test.mjs`:

```js
// Which cue a move between screens plays: the room whooshes, any other screen taps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { screenCue } from "../src/ui/screens.js";

test("screenCue: whoosh into a room, tap anywhere else, nothing on the first screen", () => {
  assert.equal(screenCue(null, "/"), null);
  assert.equal(screenCue("/", "/"), null);
  assert.equal(screenCue("/", "/presale/K"), "whoosh");
  assert.equal(screenCue("/presale/K", "/coin/K"), "tap");
  assert.equal(screenCue("/coin/K", "/"), "tap");
  assert.equal(screenCue("/", "/me"), "tap");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd mobile && node --test test/screens.test.mjs`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `../src/ui/screens.js`.

- [ ] **Step 3: Write it**

Create `mobile/src/ui/screens.js`:

```js
// The cue for a move from screen `prev` to screen `path` (expo-router pathnames: "/" is Pulse,
// "/me", "/create", "/presale/<key>", "/coin/<key>", "/connect"). Pure, for Node tests.

/** "whoosh" into a room, "tap" into any other screen; null for the first screen or none. */
export function screenCue(prev, path) {
  if (prev == null || prev === path) return null;
  return path.startsWith("/presale/") ? "whoosh" : "tap";
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `cd mobile && node --test test/screens.test.mjs`
Expected: `# pass 1`, `# fail 0`.

- [ ] **Step 5: Install expo-audio, with no microphone and no background playback**

Run: `cd mobile && npx expo install expo-audio`
Expected: `package.json` gets `"expo-audio": "~55.x.x"` (the version SDK 55 pins).

In `mobile/app.json`, inside `"android"`, after the `"package": "family.mooner.app",` line add:

```json
      "blockedPermissions": ["android.permission.RECORD_AUDIO"],
```

and in `"plugins"`, after `"expo-font",` add:

```json
      [
        "expo-audio",
        {
          "microphonePermission": false,
          "recordAudioAndroid": false,
          "enableBackgroundPlayback": false
        }
      ],
```

- [ ] **Step 6: Write the player**

Create `mobile/src/ui/sound.js`:

```js
// The 16 cues (engine/src/cues.js) through expo-audio: one player per cue, loaded once at
// start and mixed with other apps' audio. They follow the media volume: Android has no
// silent-mode option for them (expo-audio drops playsInSilentMode there), so the Sounds
// switch in Me is the mute, kept in expo-secure-store. A missing sound is skipped, never an
// error, and if the audio mode can't be set no player is loaded, so the app stays quiet
// rather than taking audio focus from the user's music.
import { useEffect, useState } from "react";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as SecureStore from "expo-secure-store";
import { CUES, SHEET_CLOSE } from "../../../engine/src/cues.js";
import { secureJson } from "../securekeys";
import { screenCue } from "./screens";

const FILES = {
  tap: require("../../assets/sfx/tap.mp3"),
  join: require("../../assets/sfx/join.mp3"),
  tick: require("../../assets/sfx/tick.mp3"),
  poolfull: require("../../assets/sfx/poolfull.mp3"),
  count: require("../../assets/sfx/count.mp3"),
  go: require("../../assets/sfx/go.mp3"),
  liftoff: require("../../assets/sfx/liftoff.mp3"),
  step: require("../../assets/sfx/step.mp3"),
  coins: require("../../assets/sfx/coins.mp3"),
  xp: require("../../assets/sfx/xp.mp3"),
  host: require("../../assets/sfx/host.mp3"),
  whoosh: require("../../assets/sfx/whoosh.mp3"),
  stamp: require("../../assets/sfx/stamp.mp3"),
  chat: require("../../assets/sfx/chat.mp3"),
  emoji: require("../../assets/sfx/emoji.mp3"),
  sheet: require("../../assets/sfx/sheet.mp3"),
};

const pref = secureJson(SecureStore, "mooner:sounds");
const players = new Map();
let on = false; // off until the saved switch is read
let toggled = false; // the user flipped the switch: the saved value no longer applies
const listeners = new Set();
let loading = null;

// Status updates are only for progress bars; these short cues need none. updateInterval is
// in milliseconds (expo-audio AudioPlayerOptions): a day keeps each player's update loop idle.
const PLAYER = { updateInterval: 24 * 60 * 60 * 1000 };

/** Loads every player and the saved switch, once. Call at start. */
export function loadSounds() {
  loading ??= (async () => {
    let mixing = true;
    try {
      // playsInSilentMode is read on iOS only; Android drops it
      await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" });
    } catch {
      // without mixWithOthers every play would take audio focus and pause the user's music
      mixing = false;
    }
    if (mixing) {
      for (const [cue, file] of Object.entries(FILES)) {
        try {
          players.set(cue, createAudioPlayer(file, PLAYER));
        } catch {
          // that cue stays quiet
        }
      }
    }
    const saved = await pref.get().catch(() => undefined);
    if (!toggled) setOn(saved?.on !== false);
  })();
  return loading;
}

/** Plays `cue` from its start, at its volume. `close`: a sheet closing (faster and lower). */
export function play(cue, { close = false } = {}) {
  const p = players.get(cue);
  if (!on || !p) return;
  try {
    const closing = close && cue === "sheet";
    p.volume = CUES[cue] * (closing ? SHEET_CLOSE.volume : 1);
    if (cue === "sheet") p.setPlaybackRate(closing ? SHEET_CLOSE.rate : 1);
    p.seekTo(0).catch(() => {});
    p.play();
  } catch {
    // a sound that won't play is skipped
  }
}

function setOn(v) {
  on = !!v;
  listeners.forEach((l) => l(on));
}

export const soundsOn = () => on;

/** The Sounds switch: applies now and is kept on the phone. */
export function setSoundsOn(v) {
  toggled = true;
  setOn(v);
  pref.set({ on: !!v }).catch(() => {});
}

/** Whether sounds are on, kept up to date. */
export function useSoundsOn() {
  const [v, setV] = useState(on);
  useEffect(() => {
    listeners.add(setV);
    setV(on);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

// ---- screen sounds: the root layout reports each pathname change ----

// Screen changes before the first touch are quiet (opening the app, or a link that opens it);
// once the app is touched every screen change plays, a link's included.
let armed = false;
let nextCue = null;

/** The first touch anywhere: screen changes may play from now on. */
export function arm() {
  armed = true;
}

/** The next screen change plays `cue` instead of its own (a Trade that whooshes to the coin).
 *  It's used by that one change only: a change with no cue of its own drops it too. */
export function nextScreen(cue) {
  nextCue = cue;
}

/** A move from `prev` to `path`: whoosh into a room, tap anywhere else (screens.js). */
export function screenChange(prev, path) {
  const own = screenCue(prev, path);
  const cue = nextCue ?? own;
  if (prev !== path) nextCue = null;
  if (own && armed) play(cue);
}
```

- [ ] **Step 7: Load them at start and report each screen**

In `mobile/app/_layout.js`:

1. Replace `import { useEffect, useState } from "react";` with `import { useEffect, useRef, useState } from "react";`.
2. Replace `import { Stack } from "expo-router";` with `import { Stack, usePathname } from "expo-router";`.
3. After `import { Banner } from "../src/ui/kit";` add `import { arm, loadSounds, screenChange } from "../src/ui/sound";`.
4. After the line `useEffect(() => store.getState().start(), []);` add:

```js
  useEffect(() => {
    loadSounds();
  }, []);
```

5. Replace

```js
        <View style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg0 }, animation: "slide_from_right" }} />
        </View>
```

with

```js
        <View style={{ flex: 1 }} onTouchStart={arm}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg0 }, animation: "slide_from_right" }} />
          <ScreenSounds />
        </View>
```

6. At the end of the file add:

```js
/** Plays the cue for each new screen (sound.js screenChange). Draws nothing. */
function ScreenSounds() {
  const path = usePathname();
  const prev = useRef(null);
  useEffect(() => {
    screenChange(prev.current, path);
    prev.current = path;
  }, [path]);
  return null;
}
```

- [ ] **Step 8: Sheets play `sheet` when they open and close**

In `mobile/src/ui/kit.js`:

1. After the `import * as Haptics from "expo-haptics";` line add:

```js
import { useEffect, useRef } from "react";
import { play } from "./sound";
```

2. Replace the Sheet's doc line and first line

```js
/** A panel that slides up from the bottom; a tap on the dimmed backdrop closes it. */
export function Sheet({ open, onClose, children, title }) {
  const insets = useSafeAreaInsets();
```

with

```js
/** A panel that slides up from the bottom; a tap on the dimmed backdrop closes it. It plays
 *  `sheet` when it opens, lower and faster when it closes. */
export function Sheet({ open, onClose, children, title }) {
  const insets = useSafeAreaInsets();
  const was = useRef(!!open);
  useEffect(() => {
    if (was.current === !!open) return;
    was.current = !!open;
    play("sheet", { close: !open });
  }, [open]);
```

- [ ] **Step 9: The Sounds switch in Me**

In `mobile/app/(tabs)/me.js`:

1. Replace `import { ActivityIndicator, FlatList, Pressable, View } from "react-native";` with `import { ActivityIndicator, FlatList, Pressable, Switch, View } from "react-native";`.
2. After `import { Logo } from "../../src/ui/Logo";` add `import { setSoundsOn, useSoundsOn } from "../../src/ui/sound";`.
3. In `SignedOut`, after `<Button title="Connect Seed Vault" onPress={connect} busy={busy} />` add:

```js
      <View style={{ alignSelf: "stretch" }}>
        <SoundsRow />
      </View>
```

4. Replace

```js
      ListFooterComponent={
        <View style={{ marginTop: 32 }}>
          <Button title="Disconnect" kind="quiet" busy={leaving} onPress={onDisconnect} />
        </View>
      }
```

with

```js
      ListFooterComponent={
        <View style={{ marginTop: 32, gap: 16 }}>
          <SoundsRow />
          <Button title="Disconnect" kind="quiet" busy={leaving} onPress={onDisconnect} />
        </View>
      }
```

5. At the end of the file add:

```js
/** "Sounds" and its switch, on by default and kept on the phone (sound.js). */
function SoundsRow() {
  const on = useSoundsOn();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
      <T v="body">Sounds</T>
      <Switch
        accessibilityLabel="Sounds"
        value={on}
        onValueChange={setSoundsOn}
        trackColor={{ false: C.bg3, true: C.accent }}
        thumbColor={C.text0}
      />
    </View>
  );
}
```

- [ ] **Step 10: Run the tests and the bundle check**

Run: `cd mobile && npm test`
Expected: `# pass 264`, `# fail 0`.

Run: `cd mobile && npm run bundle:check`
Expected: it prints `web3.js copies: 1; files from engine/node_modules: 0` and exits 0.

- [ ] **Step 11: Build for the Seeker and check the permissions**

The new native module needs a new build (`mobile/android/` is generated and gitignored, so `--clean` loses nothing). Run from the repo root:

```bash
(cd mobile && CI=1 npx expo prebuild --platform android --clean --no-install)
(cd mobile && ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh)
find mobile/android/app/build/outputs/apk -name "*.apk"
/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0/aapt2 dump permissions <the apk the find printed>
```

Expected: the app installs on the Seeker. The permission dump lists neither `android.permission.RECORD_AUDIO` nor `android.permission.FOREGROUND_SERVICE` nor `FOREGROUND_SERVICE_MEDIA_PLAYBACK`. If the install fails on a signature mismatch, stop and tell the user (never `adb uninstall`).

On the Seeker:
- opening the app plays nothing;
- after a first touch, switching tabs taps, opening a room whooshes, going back taps;
- a sheet (join, chat) plays `sheet` on open and, lower, on close;
- turning Sounds off in Me silences all of it, and it stays off after the app is closed and opened again.

- [ ] **Step 12: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/src/ui/screens.js mobile/test/screens.test.mjs mobile/src/ui/sound.js mobile/app/_layout.js mobile/src/ui/kit.js "mobile/app/(tabs)/me.js"
git commit -m "mobile: the 16 sounds through expo-audio (no microphone, no background playback): a tap for each new screen and a whoosh into a room once the app is touched, sheets open and close with a sound, and a Sounds switch in Me kept on the phone" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The scene, the host, the pool cells and the emoji pictures (phone)

**Files:**
- Create: `mobile/src/ui/Scene.js`, `mobile/src/ui/Host.js`, `mobile/src/ui/Cells.js`, `mobile/src/ui/emojis.js`
- Modify: `mobile/src/room/room.js` (`cellsOf`, `poolLine`)
- Test: `mobile/test/room.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `mobile/test/room.test.mjs`, replace line 4

```js
import { bottomOf, claimedOf, heroOf, hhmm, isKey, lockedCommit, momentStep, pickOf, refToNote, seatPlan, shortOf } from "../src/room/room.js";
```

with

```js
import { bottomOf, cellsOf, claimedOf, heroOf, hhmm, isKey, lockedCommit, momentStep, pickOf, poolLine, refToNote, seatPlan, shortOf } from "../src/room/room.js";
```

and add at the end of the file:

```js
test("cellsOf: ten cells, each a tenth of the pool, filled by the SOL in", () => {
  assert.deepEqual(cellsOf(250n, 1000n), [1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(cellsOf("1000", "1000"), Array(10).fill(1));
  assert.deepEqual(cellsOf(2000n, 1000n), Array(10).fill(1));
  assert.deepEqual(cellsOf(5n, 0n), Array(10).fill(0));
  assert.deepEqual(cellsOf(undefined, undefined), Array(10).fill(0));
});

test("poolLine: the wallets in, and the SOL to go or full", () => {
  const N = { TARGET: "1000000000" };
  const users = (n) => Array.from({ length: n }, (_, i) => ({ user: `w${i}`, commit: "100000000" }));
  assert.equal(poolLine({ raised: "250000000", users: users(1) }, N), "1 wallet in · 0.75 SOL to go");
  assert.equal(poolLine({ raised: "1000000000", users: users(10) }, N), "10 wallets in · full");
  assert.equal(poolLine({ raised: "0", users: [] }, N), "0 wallets in · 1 SOL to go");
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd mobile && node --test test/room.test.mjs`
Expected: FAIL, `SyntaxError: The requested module '../src/room/room.js' does not provide an export named 'cellsOf'`.

- [ ] **Step 3: Write them**

In `mobile/src/room/room.js`, replace

```js
import { canGetBack, clock, fillOf, joinAmounts, joinCheck, seatOf, secondsLeft, stageOf } from "../../../engine/src/views.js";
```

with

```js
import { canGetBack, clock, fillOf, joinAmounts, joinCheck, roomOf, seatOf, secondsLeft, stageOf, whoIsIn } from "../../../engine/src/views.js";
```

and add after `heroOf`:

```js
/** The pool as `n` cells, each a tenth (with n 10) of `target`, filled 0..1 by `raised`
 *  (lamports: BigInt, string or number). */
export function cellsOf(raised, target, n = 10) {
  const t = Number(BigInt(target ?? 0));
  const r = Number(BigInt(raised ?? 0));
  const f = t > 0 ? Math.min(1, Math.max(0, r / t)) : 0;
  return Array.from({ length: n }, (_, i) => Math.min(1, Math.max(0, f * n - i)));
}

/** Under the pool's cells: "3 wallets in · 1.25 SOL to go", or "… · full". */
export function poolLine(view, N) {
  const n = whoIsIn(view).length;
  const left = roomOf(view, N);
  const wallets = `${n} wallet${n === 1 ? "" : "s"} in`;
  return left > 0n ? `${wallets} · ${solText(left)} SOL to go` : `${wallets} · full`;
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `cd mobile && node --test test/room.test.mjs`
Expected: every test passes, `# fail 0`.

- [ ] **Step 5: Write the components**

Create `mobile/src/ui/Cells.js`:

```js
// The pool as 10 cells (room.js cellsOf), all in C.up once it's full.
import { View } from "react-native";
import { cellsOf } from "../room/room";
import { C } from "./theme";

/** `raised`, `target`: lamports. `color`: the cells' fill until the pool is full. */
export function Cells({ raised, target, color = C.er, height = 8 }) {
  const cells = cellsOf(raised, target);
  const fill = cells.every((f) => f === 1) ? C.up : color;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", gap: 3 }}>
      {cells.map((f, i) => (
        <View
          key={i}
          style={{
            flex: 1, height, borderRadius: 2, backgroundColor: C.well, borderWidth: 1, borderColor: C.wellLine,
            overflow: "hidden",
          }}
        >
          <View style={{ width: `${f * 100}%`, height: "100%", backgroundColor: fill }} />
        </View>
      ))}
    </View>
  );
}
```

Create `mobile/src/ui/Scene.js`:

```js
// A screen's scene: one cozy picture cropped to fill, a veil (darker at the top for the top
// row, bg0 at the bottom) so text over it reads (never a text shadow), and its slow move. A
// picture that won't load leaves bg0 and the screen goes on.
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Move } from "./motion";
import { C } from "./theme";

const SCENES = {
  room: require("../../assets/scenes/room.jpg"),
  launching: require("../../assets/scenes/launching.jpg"),
  live: require("../../assets/scenes/live.jpg"),
};

/** `name`: room, launching or live. `height`: fixed, else it fills its parent. `motion`:
 *  "still", "kenBurns" (launching) or "lift" (live). `dim` (0..1) darkens it under a
 *  moment's text. Children draw on top. */
export function Scene({ name, height, motion = "still", dim = 0, style, children }) {
  const [bad, setBad] = useState(false);
  const picture = bad ? null : (
    <Image source={SCENES[name]} resizeMode="cover" onError={() => setBad(true)} style={StyleSheet.absoluteFill} />
  );
  return (
    <View style={[{ overflow: "hidden", backgroundColor: C.bg0 }, height != null ? { height } : { flex: 1 }, style]}>
      {motion === "still" ? picture : <Move kind={motion} style={StyleSheet.absoluteFill}>{picture}</Move>}
      {dim > 0 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.bg0, opacity: dim }]} /> : null}
      <Veil />
      {children}
    </View>
  );
}

/** Dark at the top (under the top row), clear through the middle, bg0 at the bottom. */
function Veil() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.bg0} stopOpacity="0.6" />
            <Stop offset="0.22" stopColor={C.bg0} stopOpacity="0" />
            <Stop offset="0.45" stopColor={C.bg0} stopOpacity="0" />
            <Stop offset="1" stopColor={C.bg0} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill="url(#veil)" />
      </Svg>
    </View>
  );
}
```

Create `mobile/src/ui/Host.js`:

```js
// The Mooner host: its picture and a light bubble that pops in and types its line, 18 ms a
// character (moves.js). A new line pops and types again, and plays `host` once. Only a new
// line types: a change to Reduce motion or `sound` never retypes the line on screen.
import { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { T } from "./kit";
import { Move, useReducedMotion } from "./motion";
import { TYPE_MS, typedText } from "./moves";
import { play } from "./sound";
import { C, F } from "./theme";

const HOST = require("../../assets/host.png");

/** `line`: what the host says (nothing draws without one). `sound`: false keeps it quiet,
 *  for a screen whose own cues are playing. */
export function Host({ line, sound = true }) {
  const full = line ?? "";
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? full : "");
  const said = useRef(null);
  // read when a line starts, so a change to either doesn't start it again
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    if (soundRef.current && full && said.current !== full) {
      said.current = full;
      play("host");
    }
    if (reducedRef.current) {
      setShown(full);
      return;
    }
    const start = Date.now();
    setShown("");
    const t = setInterval(() => {
      const next = typedText(full, Date.now() - start);
      setShown(next);
      if (next === full) clearInterval(t);
    }, TYPE_MS);
    return () => clearInterval(t);
  }, [full]);

  if (!full) return null;
  // for the render before a new line's effect resets `shown`, the old line's text never shows
  const typed = full.startsWith(shown) ? shown : "";
  const text = { fontFamily: F.bold, fontSize: 13, lineHeight: 17 };
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
      <Image source={HOST} resizeMode="contain" style={{ width: 40, height: 48 }} />
      <Move kind="pop" key={full} style={{ flex: 1, transformOrigin: "left bottom" }}>
        <View
          accessible
          accessibilityLabel={full}
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: C.text0, paddingHorizontal: 13, paddingVertical: 9,
            borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 4,
          }}
        >
          {/* the whole line is laid out from the start, its untyped rest unseen, so the
              bubble keeps its size and no word jumps to the next line as it types */}
          <T color={C.bg0} style={text}>
            {typed}
            <Text style={{ color: "transparent" }}>{full.slice(typed.length)}</Text>
          </T>
        </View>
      </Move>
    </View>
  );
}
```

Create `mobile/src/ui/emojis.js`:

```js
// The 12 chat emojis' pictures (engine/src/emoji.js EMOJI), by name.
export const EMOJI_FILES = {
  diamond: require("../../assets/emoji/diamond.png"),
  fire: require("../../assets/emoji/fire.png"),
  gg: require("../../assets/emoji/gg.png"),
  gm: require("../../assets/emoji/gm.png"),
  jeet: require("../../assets/emoji/jeet.png"),
  lfg: require("../../assets/emoji/lfg.png"),
  moon: require("../../assets/emoji/moon.png"),
  ngmi: require("../../assets/emoji/ngmi.png"),
  pump: require("../../assets/emoji/pump.png"),
  rug: require("../../assets/emoji/rug.png"),
  ser: require("../../assets/emoji/ser.png"),
  wen: require("../../assets/emoji/wen.png"),
};
```

- [ ] **Step 6: Run the phone suite and the bundle check**

Run: `cd mobile && npm test`
Expected: `# pass 266`, `# fail 0` (264 + 2).

Run: `cd mobile && npm run bundle:check`
Expected: it prints `web3.js copies: 1; files from engine/node_modules: 0` and exits 0 (every `require` above resolves).

- [ ] **Step 7: Commit**

```bash
git add mobile/src/room/room.js mobile/test/room.test.mjs mobile/src/ui/Cells.js mobile/src/ui/Scene.js mobile/src/ui/Host.js mobile/src/ui/emojis.js
git commit -m "mobile: the scene with its veil and slow move, the host who types its line, the pool as 10 cells with its wallets-in line, and the emoji pictures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pulse's lanes, and new chat lines marked live (phone)

**Files:**
- Create: `mobile/src/live/lanes.js`
- Test: `mobile/test/lanes.test.mjs`
- Modify: `mobile/src/store.js:158`, `mobile/test/store.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/lanes.test.mjs`:

```js
// Pulse's three lanes from the server's feeds: presales filling, coins on the curve, migrated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPIRED_STAYS_MS, expiredSeen, filling, finalStretch, migrated, newPairs, pairStage, settledLane } from "../src/live/lanes.js";

const token = { symbol: "T", name: "T", image: "" };
const P = (presale, state, openedTs, over = {}) => ({ presale, state, openedTs, raised: "0", token, ...over });
const pool = (sol, isMigrated = false) => ({ quoteReserve: String(sol * 1e9), sqrtPrice: "1", migrated: isMigrated });
const R = (presale, at, p, t = token) => ({ presale, mint: `m${presale}`, token: t, launch: { at }, pool: p });
const byKey = (...rows) => Object.fromEntries(rows.map((r) => [r.presale, r]));
const keys = (rows) => rows.map((r) => r.presale);

test("newPairs: open, full and launching presales with a coin, newest first", () => {
  const presales = byKey(
    P("A", "OPEN", 100),
    P("B", "FULL", 300),
    P("C", "OPEN", 50),
    P("D", "LAUNCHING", 400),
    P("E", "OPEN", 500, { token: undefined }),
    P("F", "SETTLED", 600),
  );
  const launched = byKey(R("F", 1, pool(1)));
  assert.deepEqual(keys(newPairs(presales, launched, 0, {})), ["D", "B", "A", "C"]);
});

test("newPairs: a launched presale whose launched row hasn't arrived stays, launching, until the row does", () => {
  const presales = byKey(P("S", "SETTLED", 1), P("C", "CLOSED", 2, { launch: { at: 5 } }), P("X", "CLOSED", 3));
  // no row yet: not in Final Stretch, so New Pairs keeps it (X closed without a launch: expired)
  assert.deepEqual(keys(newPairs(presales, {}, 0, { X: -Infinity })), ["C", "S"]);
  assert.deepEqual(keys(finalStretch({})), []);
  assert.equal(pairStage(presales.S, undefined), "launching");
  assert.equal(pairStage(presales.C, undefined), "launching");
  // the rows arrive: they leave New Pairs for Final Stretch
  const launched = byKey(R("S", 1, pool(1)), R("C", 2, null));
  assert.deepEqual(keys(newPairs(presales, launched, 0, { X: -Infinity })), []);
  assert.deepEqual(keys(finalStretch(launched)), ["S", "C"]);
  assert.equal(pairStage(presales.S, launched.S), "live");
  assert.equal(pairStage(P("O", "OPEN", 1), undefined), "presale");
  assert.equal(pairStage(P("F", "FULL", 1), undefined), "launching");
  assert.equal(pairStage(presales.X, undefined), "expired");
});

test("newPairs: each item carries its presales row as is and its pairStage", () => {
  const presales = byKey(P("O", "OPEN", 1), P("F", "FULL", 2), P("S", "SETTLED", 3), P("X", "EXPIRED", 4));
  const items = newPairs(presales, {}, 0, {});
  assert.deepEqual(
    items.map((r) => [r.presale, r.stage]),
    [["X", "expired"], ["S", "launching"], ["F", "launching"], ["O", "presale"]],
  );
  for (const r of items) assert.equal(r.view, presales[r.presale], "the feed's own object, so a memoized card can skip it");
});

test("newPairs: an expired presale stays 3 s from when Pulse first saw it so", () => {
  assert.equal(EXPIRED_STAYS_MS, 3000);
  const presales = byKey(P("X", "EXPIRED", 1), P("Y", "FAILED", 2));
  const seen = { X: 10_000, Y: 10_000 };
  assert.deepEqual(keys(newPairs(presales, {}, 12_999, seen)), ["Y", "X"]);
  assert.deepEqual(keys(newPairs(presales, {}, 13_000, seen)), []);
  // not seen yet: it has just expired
  assert.deepEqual(keys(newPairs(presales, {}, 50_000, {})), ["Y", "X"]);
});

test("expiredSeen: when each presale was first seen expired; the ones there at the start never show", () => {
  const presales = byKey(P("X", "EXPIRED", 1), P("O", "OPEN", 2));
  const first = expiredSeen({}, presales, {}, -Infinity);
  assert.deepEqual(first, { X: -Infinity });
  assert.deepEqual(keys(newPairs(presales, {}, 5000, first)), ["O"]);
  assert.equal(expiredSeen(first, presales, {}, 5000), first, "nothing new: the same object");
  const second = expiredSeen(first, byKey(P("X", "EXPIRED", 1), P("O", "EXPIRED", 2)), {}, 5000);
  assert.deepEqual(second, { X: -Infinity, O: 5000 });
  assert.deepEqual(expiredSeen(second, byKey(P("O", "EXPIRED", 2)), {}, 6000), { O: 5000 }, "a presale gone from the feed is forgotten");
});

test("finalStretch: coins on the curve, closest to migrating first, then newest", () => {
  const launched = byKey(
    R("A", 1, pool(10)),
    R("B", 2, pool(60)),
    R("C", 3, null),
    R("D", 4, pool(80, true)),
    R("E", 5, pool(10)),
    R("F", 6, pool(5), null),
  );
  assert.deepEqual(keys(finalStretch(launched)), ["B", "E", "A", "C"]);
});

test("migrated: migrated coins, newest launch first", () => {
  const launched = byKey(R("A", 1, pool(80, true)), R("B", 2, pool(80, true)), R("C", 3, pool(10)), R("D", 4, pool(80, true), null));
  assert.deepEqual(keys(migrated(launched)), ["B", "A"]);
});

test("filling: the open presales with a coin, and the SOL in them", () => {
  const presales = byKey(
    P("A", "OPEN", 1, { raised: "200" }),
    P("B", "OPEN", 2, { raised: "300" }),
    P("C", "FULL", 3, { raised: "1000" }),
    P("D", "OPEN", 4, { raised: "50", token: undefined }),
  );
  assert.deepEqual(filling(presales, {}), { count: 2, lamports: 500n });
});

test("settledLane: a momentum end is a lane only on a page boundary, and on the tapped lane while a tap scrolls", () => {
  const W = 392.7272;
  // swipes (no tap target): the page it landed on, within a pixel's rounding
  assert.equal(settledLane(0, W, null), 0);
  assert.equal(settledLane(W + 0.4, W, null), 1);
  assert.equal(settledLane(2 * W - 0.6, W, null), 2);
  // a cancelled animated scroll stops part-way: ignored
  assert.equal(settledLane(0.6 * W, W, null), null);
  assert.equal(settledLane(W + 2, W, 1), null);
  // tapped 2 then 0: the first scroll, cancelled right on page 1, is ignored; page 0 counts
  assert.equal(settledLane(W, W, 0), null);
  assert.equal(settledLane(0, W, 0), 0);
  // no width yet: nothing
  assert.equal(settledLane(0, 0, null), null);
});
```

In `mobile/test/store.test.mjs`, after the test `"chat keeps the last 200"`, add:

```js
test("chat: lines pushed one by one are marked live, the snapshot's aren't", () => {
  const { store, push } = rig();
  store.getState().watch("A");
  push("chat:A", "snapshot", [{ id: 1, text: "gm" }]);
  push("chat:A", "message", { id: 2, text: ":lfg:" });
  const rows = store.getState().chats.A;
  assert.equal(rows[0].live, undefined);
  assert.equal(rows[1].live, true);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd mobile && node --test test/lanes.test.mjs test/store.test.mjs`
Expected: FAIL: `ERR_MODULE_NOT_FOUND` for `../src/live/lanes.js`, and the new store test fails at `assert.equal(rows[1].live, true)` (`undefined !== true`).

- [ ] **Step 3: Write the lanes**

Create `mobile/src/live/lanes.js`:

```js
// Pulse's three lanes (spec §1), as plain functions of the server's `presales` and `launched`
// feeds (each keyed by presale), so Node tests run them.
import { stageOf } from "../../../engine/src/views.js";
import { curveOf } from "../launched/coin.js";

/** How long an expired presale stays in New Pairs (ms), as on the web. */
export const EXPIRED_STAYS_MS = 3_000;

/** `seen` (presale -> when Pulse first saw it expired, ms) after this read: new expired
 *  presales get `nowMs`, presales gone from the feed are dropped. Pass -Infinity as `nowMs`
 *  for the first read, so presales already expired then never show. Returns `seen` itself
 *  when nothing changed. */
export function expiredSeen(seen, presales, launched, nowMs) {
  const next = { ...seen };
  let changed = false;
  for (const v of Object.values(presales)) {
    if (next[v.presale] == null && stageOf(v, launched[v.presale]) === "expired") {
      next[v.presale] = nowMs;
      changed = true;
    }
  }
  for (const k of Object.keys(next)) {
    if (!presales[k]) {
      delete next[k];
      changed = true;
    }
  }
  return changed ? next : seen;
}

/** The stage a presale shows at in New Pairs: stageOf's, but a launched presale (SETTLED, or
 *  CLOSED with its launch) whose `launched` row hasn't arrived yet is "launching", not
 *  "live": Final Stretch, built from the launched feed, doesn't have it yet. */
export function pairStage(view, row) {
  const stage = stageOf(view, row);
  return stage === "live" && !row ? "launching" : stage;
}

/** New Pairs: presales with a coin that are filling or launching (pairStage: a launched one
 *  stays until its `launched` row arrives, so its card never vanishes in between), and
 *  expired ones for EXPIRED_STAYS_MS after `seen` says they expired (one not in `seen` yet
 *  has just expired). Newest opened first. Each item is { presale, view, stage }: `view` the
 *  presales row itself (the same object while the feed doesn't change it), `stage` its
 *  pairStage, so a card needs nothing from the launched feed. */
export function newPairs(presales, launched, nowMs, seen) {
  const items = [];
  for (const v of Object.values(presales)) {
    if (!v.token) continue;
    const stage = pairStage(v, launched[v.presale]);
    const shows =
      stage === "presale" || stage === "launching" || (stage === "expired" && nowMs - (seen[v.presale] ?? nowMs) < EXPIRED_STAYS_MS);
    if (shows) items.push({ presale: v.presale, view: v, stage });
  }
  return items.sort(
    (a, b) =>
      Number(b.view.openedTs ?? 0) - Number(a.view.openedTs ?? 0) || (a.presale < b.presale ? -1 : a.presale > b.presale ? 1 : 0),
  );
}

const curveFill = (r) => (r.pool ? curveOf(r.pool).fill : -1);
const newest = (a, b) => Number(b.launch?.at ?? 0) - Number(a.launch?.at ?? 0);

/** Final Stretch: launched coins on the curve, closest to migrating first, then the newest.
 *  A coin whose pool isn't read yet goes last. */
export function finalStretch(launched) {
  return Object.values(launched)
    .filter((r) => r.token && !r.pool?.migrated)
    .sort((a, b) => curveFill(b) - curveFill(a) || newest(a, b));
}

/** Migrated: coins whose curve filled and moved to Meteora DAMM v2, newest launch first (the
 *  rows carry no migration time). */
export function migrated(launched) {
  return Object.values(launched)
    .filter((r) => r.token && r.pool?.migrated)
    .sort(newest);
}

/** The header's "X SOL filling N pools": open presales with a coin, and their SOL (BigInt). */
export function filling(presales, launched) {
  let count = 0;
  let lamports = 0n;
  for (const v of Object.values(presales)) {
    if (!v.token || stageOf(v, launched[v.presale]) !== "presale") continue;
    count++;
    lamports += BigInt(v.raised ?? 0);
  }
  return { count, lamports };
}

/** The lane the pager settled on from a momentum end at offset `x` (pages `pageW` wide), or
 *  null to ignore it. On Android a cancelled animated scroll (a second tab tap, a drag, a
 *  scrollTo) still sends a momentum end, wherever it stopped: one off a page boundary, or
 *  on a page other than `target` (the lane a tab tap is scrolling to, null with none), is
 *  ignored, so it neither plays a tap nor moves the underline. */
export function settledLane(x, pageW, target) {
  if (!(pageW > 0)) return null;
  const i = Math.round(x / pageW);
  if (Math.abs(x - i * pageW) > 1) return null;
  if (target != null && i !== target) return null;
  return i;
}
```

- [ ] **Step 4: Mark chat lines pushed one by one**

In `mobile/src/store.js`, in `onChat`, replace

```js
      rows = [...had, m.data].sort((a, b) => a.id - b.id);
```

with

```js
      // live: pushed while the room is open (the snapshot's lines aren't), so a screen can
      // react to new lines only (chat sound, floating emojis)
      rows = [...had, { ...m.data, live: true }].sort((a, b) => a.id - b.id);
```

- [ ] **Step 5: Run them to make sure they pass**

Run: `cd mobile && npm test`
Expected: `# pass 273`, `# fail 0` (266 + 6 + 1).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/live/lanes.js mobile/test/lanes.test.mjs mobile/src/store.js mobile/test/store.test.mjs
git commit -m "mobile: Pulse's lanes (New Pairs newest first with expired presales for 3 s, Final Stretch by curve, Migrated newest first) and the SOL filling; chat lines pushed live are marked so screens react to new lines only" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Pulse replaces Live and Launched (phone)

**Files:**
- Rewrite: `mobile/app/(tabs)/index.js`, `mobile/src/live/PresaleCard.js`
- Create: `mobile/src/launched/MarketCard.js`
- Modify: `mobile/app/(tabs)/_layout.js`, `mobile/src/store.js:625-642`, `mobile/test/store.test.mjs:4,296-311`, `mobile/app/coin/[key].js:29-30,67`, `mobile/app/(tabs)/me.js:114`, `mobile/app/connect.js:2`, `mobile/src/ui/icons.js:17-24`
- Delete: `mobile/app/(tabs)/launched.js`, `mobile/src/launched/CoinRow.js`

The lanes' logic is tested (Task 7). This task is the screen on top of it, so its checks are the suite, the bundle and the Seeker.

- [ ] **Step 1: Remove the old selectors and their test**

In `mobile/src/store.js`, delete these lines (from `const raisedOf` through the end of `launchedList`), keeping the selectors comment above them and `myPresales` below:

```js
const raisedOf = (v) => BigInt(v.raised ?? 0);

/** Open presales, fullest first (they fill soonest), then the nearest deadline. */
export function liveList(s) {
  return Object.values(s.presales)
    .filter((v) => v.state === "OPEN")
    .sort((a, b) => {
      const d = raisedOf(b) - raisedOf(a);
      return d !== 0n ? (d > 0n ? 1 : -1) : Number(a.deadlineTs ?? 0) - Number(b.deadlineTs ?? 0);
    });
}

/** Launched coins, newest first. */
export function launchedList(s) {
  return Object.values(s.launched).sort((a, b) => (b.launch?.at ?? 0) - (a.launch?.at ?? 0));
}

```

In `mobile/test/store.test.mjs`, replace line 4

```js
import { createMoonerStore, launchedList, liveList, myPresales } from "../src/store.js";
```

with

```js
import { createMoonerStore, myPresales } from "../src/store.js";
```

and replace

```js
test("selectors: Live fullest first, Launched newest first, my presales", () => {
```

with

```js
test("selectors: my presales", () => {
```

and in that test delete these two lines:

```js
  assert.deepEqual(liveList(s).map((v) => v.presale), ["B", "A"]);
  assert.deepEqual(launchedList(s).map((r) => r.presale), ["L2", "L1"]);
```

- [ ] **Step 2: Two tabs become Pulse**

Replace the whole of `mobile/app/(tabs)/_layout.js` with:

```js
// The tabs: Pulse (presales filling, coins on the curve, migrated coins), Create (a new coin
// and its presale), Me.
import { Tabs } from "expo-router";
import { LiveIcon, MeIcon, PlusIcon } from "../../src/ui/icons";
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
      <Tabs.Screen name="index" options={{ title: "Pulse", tabBarIcon: ({ color }) => <LiveIcon color={color} /> }} />
      <Tabs.Screen
        name="create"
        options={{ title: "Create", tabBarHideOnKeyboard: true, tabBarIcon: ({ color }) => <PlusIcon color={color} /> }}
      />
      <Tabs.Screen name="me" options={{ title: "Me", tabBarIcon: ({ color }) => <MeIcon color={color} /> }} />
    </Tabs>
  );
}
```

Delete the Launched tab, its row and its icon:

```bash
git rm "mobile/app/(tabs)/launched.js" mobile/src/launched/CoinRow.js
```

In `mobile/src/ui/icons.js`, delete the `LaunchedIcon` block and the blank line after it:

```js
/** An arrow up and to the right. */
export function LaunchedIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 18 L18 6 M8 6 H18 V16" stroke={color} {...STROKE} />
    </Svg>
  );
}

```

- [ ] **Step 3: Words that named the old tabs**

In `mobile/app/coin/[key].js`, replace

```js
/** Where back goes when the coin was opened from a link: the Launched tab. */
const LAUNCHED = "/(tabs)/launched";
```

with

```js
/** Where back goes when the coin was opened from a link: Pulse. */
const HOME = "/(tabs)";
```

and replace `fallback={LAUNCHED}` with `fallback={HOME}`.

In `mobile/app/(tabs)/me.js`, replace `body="Join one from Live."` with `body="Join one from Pulse."`.

In `mobile/app/connect.js` line 2, replace `(Live's` with `(Pulse's`.

- [ ] **Step 4: The presale card**

Replace the whole of `mobile/src/live/PresaleCard.js` with:

```js
// One presale in Pulse's New Pairs: its coin, the time left (or Launching, Expired), the pool
// as 10 cells, the SOL in, the wallets in, and "You're in · X SOL" or Join.
import { memo, useState } from "react";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { whoIsIn } from "../../../engine/src/views.js";
import { Cells } from "../ui/Cells";
import { CoinImage } from "../ui/CoinImage";
import { Faces } from "../ui/Face";
import { solText } from "../ui/format";
import { Card, Pill, T } from "../ui/kit";
import { C, F, R } from "../ui/theme";
import { Countdown, timeUp } from "./Countdown";

/** `view`: a `presales` list item; `info`: store.info (numbers in info.N); `wallet`: the
 *  connected wallet or null; `stage`: lanes.js pairStage for it (presale, launching or
 *  expired; a launched presale whose launched row hasn't arrived yet is launching). Any
 *  stage but presale and expired shows as launching. `onPress(presale)` gets the presale's
 *  key, so one stable function serves every card: the card is memoized and skips a render
 *  when none of its props changed.
 *  The list item names who's in only while it's OPEN, so a launching card shows no faces.
 *  Expired, or past its deadline, the card dims and stays tappable: the room says why it
 *  can't be joined, and TalkBack hears "time's up". Join opens the room, like the rest of the
 *  card. A view with no coin draws nothing. */
export const PresaleCard = memo(function PresaleCard({ view, info, wallet, stage, onPress }) {
  const [up, setUp] = useState(() => timeUp(view.deadlineTs, Date.now()));
  const token = view.token;
  if (!token) return null;
  const who = whoIsIn(view);
  const mine = wallet ? who.find((r) => r.user === wallet) : null;
  const open = stage === "presale";
  const expired = stage === "expired";
  const dim = expired || (open && up);
  const target = info.N.TARGET;
  const label =
    `$${token.symbol}, ${solText(view.raised)} of ${solText(target)} SOL` +
    (open ? (up ? ", time's up" : "") : expired ? ", expired" : ", launching") +
    (mine ? `, you're in with ${solText(mine.commit)} SOL` : "");
  return (
    <View style={dim ? { opacity: 0.5 } : null}>
      <Card
        accessibilityLabel={label}
        style={{ padding: 12 }}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress?.(view.presale);
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <CoinImage uri={token.image} size={42} ticker={token.symbol} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <T v="body" numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.semi }}>{token.name}</T>
              {open ? (
                <Countdown deadlineTs={view.deadlineTs} onTimeUp={setUp} />
              ) : expired ? (
                <Pill text="Expired" color={C.text2} />
              ) : (
                <Pill text="Launching" color={C.up} />
              )}
            </View>
            <T v="small" numberOfLines={1} style={{ fontFamily: F.mono }}>{`$${token.symbol}`}</T>
          </View>
        </View>
        <View style={{ marginTop: 10, marginBottom: 8 }}>
          <Cells raised={view.raised} target={target} height={6} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
            <T v="small" numberOfLines={1} style={{ fontFamily: F.mono, flexShrink: 1 }}>
              <T v="small" color={C.er} style={{ fontFamily: F.mono }}>{solText(view.raised)}</T>
              {` / ${solText(target)} SOL${who.length ? ` · ${who.length} in` : ""}`}
            </T>
            {who.length ? <Faces wallets={who.map((r) => r.user)} size={20} max={3} /> : null}
          </View>
          {mine ? <Pill text={`You're in · ${solText(mine.commit)} SOL`} color={C.gold} /> : open && !up ? <JoinTag /> : null}
        </View>
      </Card>
    </View>
  );
});

/** "Join", drawn as a small accent button: the whole card is the tap target. */
function JoinTag() {
  return (
    <View style={{ backgroundColor: C.accent, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 4 }}>
      <T v="small" color={C.accentInk} style={{ fontFamily: F.semi }}>Join</T>
    </View>
  );
}
```

- [ ] **Step 5: The market card**

Create `mobile/src/launched/MarketCard.js`:

```js
// One launched coin in Pulse's Final Stretch or Migrated lane: its coin, market cap and price,
// and its curve to migration, or Migrated.
import { memo } from "react";
import { View } from "react-native";
import * as Haptics from "expo-haptics";
import { CoinImage } from "../ui/CoinImage";
import { FillBar } from "../ui/FillBar";
import { Card, Pill, T } from "../ui/kit";
import { C, F } from "../ui/theme";
import { atMigration, capText, curveOf, priceText } from "./coin";

/** `row`: a `launched` row; `solUsd`: store.solUsd (0 until known). Until its pool is read
 *  (`pool` null) it says "Pool loading" instead of numbers. Once migrated, the numbers are
 *  the ones at migration until the server has found the coin's DAMM v2 pool (coin.js
 *  atMigration), and the card says so. A row with no coin draws nothing. `onPress(presale)`
 *  gets the row's key, so one stable function serves every card: the card is memoized and
 *  skips a render when none of its props changed (the store replaces only the rows a push
 *  changes). */
export const MarketCard = memo(function MarketCard({ row, solUsd, onPress }) {
  const token = row.token;
  if (!token) return null;
  const pool = row.pool;
  const sqrt = pool?.sqrtPrice;
  const old = atMigration(pool);
  const cap = sqrt ? capText(sqrt, solUsd) : null;
  const curve = pool && !pool.migrated ? curveOf(pool) : null;
  const label =
    `$${token.symbol}, ${cap ? `market cap ${cap}${old ? " at migration" : ""}` : "pool loading"}` +
    (curve ? `, ${curve.text}` : pool?.migrated ? ", migrated" : "");
  return (
    <Card
      accessibilityLabel={label}
      style={{ padding: 12 }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.(row.presale);
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <CoinImage uri={token.image} size={40} ticker={token.symbol} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <T v="body" numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.semi }}>{token.name}</T>
            {cap ? <T v="num" style={{ fontSize: 14 }}>{cap}</T> : <T v="small" color={C.text2}>Pool loading</T>}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <T v="small" numberOfLines={1} style={{ fontFamily: F.mono, flexShrink: 1 }}>{`$${token.symbol}`}</T>
            {sqrt ? <T v="small" style={{ fontFamily: F.mono }}>{priceText(sqrt)}</T> : null}
          </View>
        </View>
      </View>
      {pool?.migrated ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <Pill text="Migrated · DAMM v2" color={C.migrated} />
          {old ? <T v="small" color={C.text2}>At migration</T> : null}
        </View>
      ) : curve ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <FillBar fill={curve.fill} color={C.migrated} />
          </View>
          <T v="small" color={C.migrated} style={{ fontFamily: F.mono }}>{curve.text}</T>
        </View>
      ) : null}
    </Card>
  );
});
```

- [ ] **Step 6: Pulse**

Replace the whole of `mobile/app/(tabs)/index.js` with:

```js
// Pulse: three lanes you swipe between (New Pairs, Final Stretch, Migrated), from the presales
// and launched feeds the server pushes. Quiet but for a tap when the lane changes; cards and
// lane counts only fade in, once.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useStore } from "zustand";
import { GRAD_SOL } from "../../../engine/src/views.js";
import { store } from "../../src/app";
import { MarketCard } from "../../src/launched/MarketCard";
import { EXPIRED_STAYS_MS, expiredSeen, filling, finalStretch, migrated, newPairs, settledLane } from "../../src/live/lanes";
import { PresaleCard } from "../../src/live/PresaleCard";
import { solText } from "../../src/ui/format";
import { Empty, PillButton, Screen, T } from "../../src/ui/kit";
import { FadeOnce, Move } from "../../src/ui/motion";
import { play } from "../../src/ui/sound";
import { C, F, S } from "../../src/ui/theme";

const LANES = [
  { id: "new", title: "New Pairs", empty: "No presales right now", body: "New ones show up here the moment they open." },
  { id: "final", title: "Final Stretch", empty: "No coins on the curve", body: "Coins land here the moment their presale fills." },
  { id: "migrated", title: "Migrated", empty: "Nothing migrated yet", body: `Coins move here when their curve reaches ${GRAD_SOL} SOL.` },
];

export default function Pulse() {
  const presales = useStore(store, (s) => s.presales);
  const launched = useStore(store, (s) => s.launched);
  const info = useStore(store, (s) => s.info);
  const infoError = useStore(store, (s) => s.infoError);
  const presalesLoaded = useStore(store, (s) => s.loaded.presales);
  const launchedLoaded = useStore(store, (s) => s.loaded.launched);
  const presalesError = useStore(store, (s) => s.feedError.presales);
  const launchedError = useStore(store, (s) => s.feedError.launched);
  const wallet = useStore(store, (s) => s.wallet);
  const solUsd = useStore(store, (s) => s.solUsd);

  // When each presale was first seen expired (lanes.js expiredSeen). Set before paint, so an
  // expired card never shows for a frame; the ones expired at the first read never show.
  const [seen, setSeen] = useState({});
  const primed = useRef(false);
  useLayoutEffect(() => {
    if (!presalesLoaded) return;
    const at = primed.current ? Date.now() : -Infinity;
    primed.current = true;
    setSeen((s) => expiredSeen(s, presales, launched, at));
  }, [presales, launched, presalesLoaded]);

  // Reads the lanes again when the next expired card's time is up; nothing ticks otherwise.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t0 = Date.now();
    const due = Object.values(seen)
      .filter(Number.isFinite)
      .map((t) => t + EXPIRED_STAYS_MS - t0)
      .filter((ms) => ms > 0);
    if (!due.length) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(...due));
    return () => clearTimeout(t);
  }, [seen, now]);

  // final and migrated read only the launched feed; each card gets its row (New Pairs: the
  // presales row and its stage), so a push re-renders only the cards whose rows it changed
  const pairs = useMemo(() => newPairs(presales, launched, now, seen), [presales, launched, now, seen]);
  const onCurve = useMemo(() => finalStretch(launched), [launched]);
  const moved = useMemo(() => migrated(launched), [launched]);
  const pool = useMemo(() => filling(presales, launched), [presales, launched]);
  // counts and the SOL filling read both feeds (stageOf takes the launched row): nothing until
  // they're in, so no 0 shows and then jumps
  const bothLoaded = presalesLoaded && launchedLoaded;
  const counts = useMemo(
    () => ({
      new: bothLoaded ? pairs.length : null,
      final: launchedLoaded ? onCurve.length : null,
      migrated: launchedLoaded ? moved.length : null,
    }),
    [bothLoaded, launchedLoaded, pairs.length, onCurve.length, moved.length],
  );

  // the lanes: a horizontal pager, one page per lane; one tap when the lane changes
  const [lane, setLane] = useState(0);
  const laneNow = useRef(0);
  const pager = useRef(null);
  // The lane a tab tap is scrolling to, until the scroll lands there or the user drags: a
  // cancelled scroll's momentum end isn't a lane change (lanes.js settledLane).
  const target = useRef(null);
  const [pageW, setPageW] = useState(0);
  const show = useCallback((i) => {
    if (i === laneNow.current) return;
    laneNow.current = i;
    setLane(i);
    play("tap");
  }, []);
  const goTo = useCallback(
    (i) => {
      target.current = i;
      show(i);
      pager.current?.scrollTo({ x: i * pageW, animated: true });
    },
    [show, pageW],
  );
  const onDrag = useCallback(() => {
    target.current = null;
  }, []);
  const onSettle = useCallback(
    (e) => {
      const i = settledLane(e.nativeEvent.contentOffset.x, pageW, target.current);
      if (i == null) return;
      target.current = null;
      show(i);
    },
    [show, pageW],
  );
  // a new width (split screen, rotation) keeps the lane shown, without a sound
  useEffect(() => {
    if (pageW <= 0) return;
    target.current = null;
    pager.current?.scrollTo({ x: laneNow.current * pageW, animated: false });
  }, [pageW]);

  const presaleItem = useCallback(
    ({ item }) => (
      <FadeOnce id={`new:${item.presale}`}>
        <PresaleCard view={item.view} info={info} wallet={wallet} stage={item.stage} onPress={openPresale} />
      </FadeOnce>
    ),
    [info, wallet],
  );
  const finalItem = useMemo(() => marketItem("final", solUsd), [solUsd]);
  const migratedItem = useMemo(() => marketItem("migrated", solUsd), [solUsd]);

  // Lane is memoized and gets these spread as props: each stays the same until its lane's
  // data, feed state or the solUsd its cards show changes
  const pages = [
    { lane: LANES[0], data: pairs, renderItem: presaleItem, ready: !!info && presalesLoaded, error: infoError || presalesError },
    { lane: LANES[1], data: onCurve, renderItem: finalItem, ready: launchedLoaded, error: launchedError },
    { lane: LANES[2], data: moved, renderItem: migratedItem, ready: launchedLoaded, error: launchedError },
  ];

  return (
    <Screen padded={false}>
      <Header count={bothLoaded ? pool.count : null} lamports={pool.lamports} />
      <LaneTabs lane={lane} counts={counts} onPick={goTo} />
      <View style={{ flex: 1 }} onLayout={(e) => setPageW(e.nativeEvent.layout.width)}>
        {pageW > 0 ? (
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={onDrag}
            onMomentumScrollEnd={onSettle}
          >
            {pages.map((p, i) => (
              <Lane key={p.lane.id} width={pageW} current={i === lane} {...p} />
            ))}
          </ScrollView>
        ) : null}
      </View>
    </Screen>
  );
}

const openPresale = (key) => router.push(`/presale/${key}`);
const openCoin = (key) => router.push(`/coin/${key}`);

/** Final Stretch's or Migrated's renderItem. */
const marketItem = (laneId, solUsd) =>
  function renderMarket({ item }) {
    return (
      <FadeOnce id={`${laneId}:${item.presale}`}>
        <MarketCard row={item} solUsd={solUsd} onPress={openCoin} />
      </FadeOnce>
    );
  };

const Gap = () => <View style={{ height: 10 }} />;

const LIST_PAD = { paddingHorizontal: S.gutter, paddingTop: 12, paddingBottom: S.gutter };
const keyOf = (r) => r.presale;

/** One lane's list, or a spinner until its feed (and, for New Pairs, the pool size) is in.
 *  A lane not shown is hidden from TalkBack, so it reads only the lane on screen. */
const Lane = memo(function Lane({ lane, data, renderItem, ready, error, width, current }) {
  const some = data.length > 0;
  const header = useMemo(
    () => (error && some ? <T v="small" color={C.down} style={{ marginBottom: 10 }}>{error}</T> : null),
    [error, some],
  );
  const empty = useMemo(
    () => <Empty title={lane.empty} body={error ? <T v="small" color={C.down}>{error}</T> : lane.body} />,
    [lane, error],
  );
  return (
    <View
      style={{ width }}
      importantForAccessibility={current ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!current}
    >
      {ready ? (
        <FlatList
          data={data}
          keyExtractor={keyOf}
          renderItem={renderItem}
          contentContainerStyle={LIST_PAD}
          ItemSeparatorComponent={Gap}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
        </View>
      )}
    </View>
  );
});

/** The three lanes' names and counts; the one shown is underlined in the ER colour. A new
 *  count fades in; a null count (its feeds not in yet) isn't drawn. */
const LaneTabs = memo(function LaneTabs({ lane, counts, onPick }) {
  return (
    <View style={{ flexDirection: "row", marginHorizontal: S.gutter, borderBottomWidth: 1, borderColor: C.line }}>
      {LANES.map((l, i) => {
        const on = i === lane;
        const n = counts[l.id];
        return (
          <Pressable
            key={l.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={n == null ? l.title : `${l.title}, ${n}`}
            onPress={() => onPick(i)}
            style={{
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
              paddingVertical: 10, marginBottom: -1, borderBottomWidth: 2, borderColor: on ? C.er : "transparent",
            }}
          >
            <T v="small" color={on ? C.text0 : C.text2} style={{ fontFamily: F.semi }}>{l.title}</T>
            {n == null ? null : (
              <Move kind="fade" key={n}>
                <T v="small" color={C.text2} style={{ fontFamily: F.mono, fontSize: 11 }}>{String(n)}</T>
              </Move>
            )}
          </Pressable>
        );
      })}
    </View>
  );
});

/** "Pulse" over "X SOL filling N pools" (`count` null: the feeds aren't in yet, and the line
 *  is blank, keeping its height), and on the right the wallet's SOL, or a small "Connect"
 *  with no wallet. */
const Header = memo(function Header({ count, lamports: filled }) {
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: S.gutter, paddingTop: 12, paddingBottom: 10, minHeight: 56,
      }}
    >
      <View style={{ gap: 2, flexShrink: 1 }}>
        <T v="title">Pulse</T>
        {count == null ? (
          <T v="small" importantForAccessibility="no" accessibilityElementsHidden>{" "}</T>
        ) : (
          <T v="small" numberOfLines={1}>
            <T v="small" color={C.er} style={{ fontFamily: F.mono }}>{`${solText(filled)} SOL`}</T>
            {` filling ${count} pool${count === 1 ? "" : "s"}`}
          </T>
        )}
      </View>
      {!wallet ? (
        <PillButton title="Connect" onPress={() => router.push("/connect")} />
      ) : lamports == null ? (
        <ActivityIndicator size="small" color={C.text1} />
      ) : (
        <T v="num">{`${solText(lamports)} SOL`}</T>
      )}
    </View>
  );
});
```

- [ ] **Step 7: Check nothing names the old tabs, then run the suite and the bundle check**

Run: `grep -rn "liveList\|launchedList\|CoinRow\|LaunchedIcon\|(tabs)/launched" mobile/app mobile/src mobile/test`
Expected: no output.

Run: `cd mobile && npm test`
Expected: `# pass 273`, `# fail 0` (the selectors test keeps its name's last part and its myPresales assert).

Run: `cd mobile && npm run bundle:check`
Expected: it prints `web3.js copies: 1; files from engine/node_modules: 0` and exits 0.

- [ ] **Step 8: Try it on the Seeker**

The app is a release build with its JS inside the APK (no Metro), so build and install again. Nothing native changed since Task 5, so no prebuild:

```bash
(cd mobile && ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh)
```

Check:
- the tabs read Pulse · Create · Me;
- the header shows "X SOL filling N pools" and the counts match the cards in each lane;
- swiping between lanes, or tapping a lane's name, taps once per change and never on the same lane;
- cards fade in the first time only (swipe away and back: no fade);
- a presale card opens its room (whoosh); a market card opens its coin (tap);
- with no wallet, "Connect" opens the sign-in.

- [ ] **Step 9: Commit**

```bash
git add "mobile/app/(tabs)/index.js" "mobile/app/(tabs)/_layout.js" "mobile/app/(tabs)/me.js" "mobile/app/coin/[key].js" mobile/app/connect.js mobile/src/live/PresaleCard.js mobile/src/launched/MarketCard.js mobile/src/store.js mobile/test/store.test.mjs mobile/src/ui/icons.js
git commit -m "mobile: Pulse takes the place of Live and Launched: New Pairs, Final Stretch and Migrated lanes you swipe between, with counts, the SOL filling the pools, presale cards with the pool's cells and your seat or Join, and market cards with the curve to migration" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git rm` in Step 2 already staged the two deleted files.)

---

### Task 9: Chat emojis, new lines, floating emojis and the chat strip (phone)

**Files:**
- Create: `mobile/src/room/ChatText.js`, `mobile/src/room/EmojiRow.js`, `mobile/src/room/useNewLines.js`, `mobile/src/room/FloatingEmojis.js`, `mobile/src/room/ChatLines.js`
- Modify: `mobile/src/room/room.js` (`newLines`), `mobile/src/room/ChatSheet.js`
- Test: `mobile/test/room.test.mjs`

- [ ] **Step 1: Write the failing test**

In `mobile/test/room.test.mjs`, replace line 4

```js
import { bottomOf, cellsOf, claimedOf, heroOf, hhmm, isKey, lockedCommit, momentStep, pickOf, poolLine, refToNote, seatPlan, shortOf } from "../src/room/room.js";
```

with

```js
import { bottomOf, cellsOf, claimedOf, heroOf, hhmm, isKey, lockedCommit, momentStep, newLines, pickOf, poolLine, refToNote, seatPlan, shortOf } from "../src/room/room.js";
```

and add at the end of the file:

```js
test("newLines: only lines pushed live since the last read; the first read is never new", () => {
  const rows = [{ id: 1, text: "gm" }, { id: 2, text: ":lfg:", live: true }];
  assert.deepEqual(newLines(rows, null), { lines: [], lastId: 2 }, "the first read: nothing is new");
  const more = [...rows, { id: 3, text: ":moon:", live: true }, { id: 4, text: "from a snapshot" }];
  assert.deepEqual(newLines(more, 2), { lines: [more[2]], lastId: 4 }, "a snapshot's rows never count");
  assert.deepEqual(newLines(more, 4), { lines: [], lastId: 4 });
  assert.deepEqual(newLines([], null), { lines: [], lastId: -Infinity });
  assert.equal(newLines([{ id: 1, text: ":gm:", live: true }], -Infinity).lines.length, 1, "the chat was empty when the screen opened");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd mobile && node --test test/room.test.mjs`
Expected: FAIL, `SyntaxError: The requested module '../src/room/room.js' does not provide an export named 'newLines'`.

- [ ] **Step 3: Write `newLines`**

In `mobile/src/room/room.js`, add after `poolLine`:

```js
/** The chat lines that arrived since `lastId` (rows the store marked `live`: pushed one by
 *  one, never a snapshot's), and the newest id now: { lines, lastId }. `lastId` null is the
 *  first read, when nothing is new. */
export function newLines(rows, lastId) {
  const newest = rows.reduce((m, r) => Math.max(m, r.id), lastId ?? -Infinity);
  if (lastId == null) return { lines: [], lastId: newest };
  return { lines: rows.filter((r) => r.live && r.id > lastId), lastId: newest };
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `cd mobile && node --test test/room.test.mjs`
Expected: every test passes, `# fail 0`.

- [ ] **Step 5: Draw emojis in chat text**

Create `mobile/src/room/ChatText.js`:

```js
// A chat line's text with the Mooner emojis drawn inline (engine/src/emoji.js chatParts). A
// line of only emojis draws them larger, in a row of their own. TalkBack reads each emoji by
// its name (chat.js readableChat).
import { Image, View, useWindowDimensions } from "react-native";
import { chatParts, emojiOnly } from "../../../engine/src/emoji.js";
import { EMOJI_FILES } from "../ui/emojis";
import { T } from "../ui/kit";
import { readableChat } from "./chat";

const GAP = 4;

/** `v`, `color`, `numberOfLines`, `style`: the text's. `size`: an emoji in a line with text;
 *  `big`: an emoji in a line of only emojis. With `numberOfLines` set, a line of only emojis
 *  keeps to one row: it never wraps, and draws no more emojis than the screen's width holds. */
export function ChatText({ text, v = "body", color, numberOfLines, style, size = 18, big = 36 }) {
  const { width } = useWindowDimensions();
  const parts = chatParts(text);
  const hasEmoji = parts.some((p) => p.kind === "emoji");
  const label = hasEmoji ? readableChat(text) : undefined;
  if (emojiOnly(parts)) {
    let emojis = parts.filter((p) => p.kind === "emoji");
    if (numberOfLines) emojis = emojis.slice(0, Math.ceil(width / (big + GAP)));
    return (
      <View
        accessible
        accessibilityLabel={label}
        style={[
          { flexDirection: "row", flexWrap: numberOfLines ? "nowrap" : "wrap", gap: GAP },
          numberOfLines ? { overflow: "hidden" } : null,
          style,
        ]}
      >
        {emojis.map((p, i) => (
          <Image key={i} source={EMOJI_FILES[p.name]} style={{ width: big, height: big }} />
        ))}
      </View>
    );
  }
  // An inline emoji sits on the baseline and rises its full height (Fabric), so the line
  // height is set past it: lines with and without emojis are the same height.
  return (
    <T v={v} color={color} numberOfLines={numberOfLines} accessibilityLabel={label} style={[{ lineHeight: size + 4 }, style]}>
      {parts.map((p, i) =>
        p.kind === "emoji" ? (
          <Image key={i} source={EMOJI_FILES[p.name]} style={{ width: size, height: size }} />
        ) : (
          p.text
        ),
      )}
    </T>
  );
}
```

Create `mobile/src/room/EmojiRow.js`:

```js
// The 12 Mooner emojis in a row above the chat input; a tap adds `:name:`.
import { Image, Pressable, ScrollView } from "react-native";
import { EMOJI } from "../../../engine/src/emoji.js";
import { EMOJI_FILES } from "../ui/emojis";

/** `onPick(name)`: a tap on an emoji. It scrolls sideways; taps work with the keyboard up. */
export function EmojiRow({ onPick, disabled }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 2 }}>
      {EMOJI.map((name) => (
        <Pressable
          key={name}
          accessibilityRole="button"
          accessibilityLabel={name}
          disabled={disabled}
          onPress={() => onPick(name)}
          style={({ pressed }) => [
            { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
            disabled && { opacity: 0.45 },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Image source={EMOJI_FILES[name]} style={{ width: 30, height: 30 }} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 6: The chat sheet: the emoji row, code-point clipping, emojis in each line**

In `mobile/src/room/ChatSheet.js`:

1. After `import { router } from "expo-router";` add:

```js
import { CHAT_MAX, clipChat, codePoints } from "../../../engine/src/emoji.js";
```

2. Replace `import { C, F, R } from "../ui/theme";` with:

```js
import { play } from "../ui/sound";
import { C, F, R } from "../ui/theme";
import { ChatText } from "./ChatText";
import { EmojiRow } from "./EmojiRow";
```

3. Replace

```js
const EMPTY = [];
const MAX = 280;
```

with

```js
const EMPTY = [];
```

4. After the `send` function's closing brace, add:

```js
  // an emoji goes on the end, when it fits in the server's 280 code points
  function pick(name) {
    const add = `:${name}:`;
    if (codePoints(text) + codePoints(add) > CHAT_MAX) return;
    setText(text + add);
    play("emoji");
  }
```

5. Replace

```js
          {wallet ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TextInput
                value={text}
                onChangeText={setText}
                maxLength={MAX}
```

with

```js
          {wallet ? <EmojiRow onPick={pick} disabled={sending} /> : null}
          {wallet ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TextInput
                value={text}
                onChangeText={(t) => setText(clipChat(t))}
```

(`maxLength` counted UTF-16 units, so an emoji counted twice; `clipChat` counts code points, as the server does.)

6. In `Row`, replace

```js
        <T v="body">{row.text}</T>
```

with

```js
        <ChatText text={row.text} />
```

- [ ] **Step 7: New lines, floating emojis and the chat strip**

Create `mobile/src/room/useNewLines.js`:

```js
// Calls `onLine(row)` for each chat line that arrives on `channel` while the screen is up
// (room.js newLinesOn): never for the lines already there when it opened, nor for a channel's
// lines when the channel changes (chat ids count across every channel).
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { store } from "../app";
import { newLinesOn } from "./room";

const EMPTY = [];

export function useNewLines(channel, onLine) {
  const rows = useStore(store, (s) => s.chats[channel]) ?? EMPTY;
  const last = useRef(null); // { channel, lastId } of the last read
  const cb = useRef(onLine);
  useEffect(() => {
    cb.current = onLine;
  });
  useEffect(() => {
    const r = newLinesOn(rows, channel, last.current);
    last.current = r.last;
    r.lines.forEach((row) => cb.current(row));
  }, [rows, channel]);
}
```

Create `mobile/src/room/FloatingEmojis.js`:

```js
// Emojis from chat lines that arrive float up over a scene (spec §3): up to FLOAT_MAX from a
// line, all lines' emojis in one queue (chat.js floatStep), so they start one at a time
// FLOAT_GAP_MS apart, at most FLOATS_FLYING in flight and FLOATS_WAITING waiting (the oldest
// waiting are dropped). Each start plays the `emoji` cue, at most one every
// CHAT_SOUND_GAP_MS. With Reduce motion they fade in and out where they start.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { CHAT_SOUND_GAP_MS, chatGate } from "../../../engine/src/cues.js";
import { EMOJI_FILES } from "../ui/emojis";
import { useReducedMotion } from "../ui/motion";
import { play } from "../ui/sound";
import { floatStep, queueFloats } from "./chat";
import { useNewLines } from "./useNewLines";

const FLOAT_MS = 2200;
const RISE = 160;
const SIZE = 40;

/** Fills its parent; touches pass through. `channel`: the presale's chat. `on`: false while
 *  the scene is covered (a sheet, the launch moment), so nothing floats unseen: lines then are
 *  skipped and the waiting emojis dropped. */
export function FloatingEmojis({ channel, on = true }) {
  const reduced = useReducedMotion();
  const [floats, setFloats] = useState([]);
  const nextId = useRef(0);
  const q = useRef({ queue: [], last: -Infinity });
  const timer = useRef(null);
  const flying = useRef(0);
  const [gate] = useState(() => chatGate(CHAT_SOUND_GAP_MS)); // the emoji cue's own gate

  const step = useCallback(() => {
    timer.current = null;
    const now = Date.now();
    const r = floatStep(q.current, now, flying.current);
    q.current = { queue: r.queue, last: r.last };
    if (r.start) {
      flying.current += 1;
      const id = nextId.current++;
      const name = r.start;
      setFloats((f) => [...f, { id, name, x: 0.15 + Math.random() * 0.7 }]);
      if (gate(now)) play("emoji");
    }
    if (r.wait != null) timer.current = setTimeout(step, r.wait);
  }, [gate]);

  // `on` turning false (or a new channel, or leaving) drops what waits, so nothing starts
  // under a sheet; floats already in flight finish.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      timer.current = null;
      q.current = { queue: [], last: q.current.last };
    },
    [on, channel],
  );

  const onLine = useCallback(
    (row) => {
      if (!on) return;
      q.current = { ...q.current, queue: queueFloats(q.current.queue, row.text) };
      if (!timer.current) step();
    },
    [on, step],
  );
  useNewLines(channel, onLine);
  const done = useCallback((id) => {
    flying.current -= 1;
    setFloats((f) => f.filter((x) => x.id !== id));
  }, []);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {floats.map((f) => (
        <Float key={f.id} id={f.id} name={f.name} x={f.x} rise={reduced ? 0 : RISE} onDone={done} />
      ))}
    </View>
  );
}

/** Memo: a float that starts or ends re-renders only itself. */
const Float = memo(function Float({ id, name, x, rise, onDone }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(t, { toValue: 1, duration: FLOAT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
    run.start(({ finished }) => {
      if (finished) onDone(id);
    });
    return () => run.stop();
  }, [t, id, onDone]);
  const style = useMemo(
    () => ({
      position: "absolute", bottom: 12, left: `${x * 100}%`, marginLeft: -SIZE / 2, width: SIZE, height: SIZE,
      opacity: t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
      transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) }],
    }),
    [t, x, rise],
  );
  return <Animated.Image source={EMOJI_FILES[name]} style={style} />;
});
```

Create `mobile/src/room/ChatLines.js`:

```js
// The last 3 chat lines over the bottom of a scene, each on a dark veil; a new one rises in.
// With `onPress` a tap opens the chat (a button, "Open the chat"); without it the lines are
// plain text TalkBack reads.
import { Pressable, View } from "react-native";
import { useStore } from "zustand";
import { store } from "../app";
import { Face } from "../ui/Face";
import { Move } from "../ui/motion";
import { C } from "../ui/theme";
import { ChatText } from "./ChatText";

const EMPTY = [];
const SHOWN = 3;
/** bg0 at 74%, the mockup's chat veil. */
const VEIL = `${C.bg0}bd`;
const BOX = { gap: 4, alignItems: "flex-start" };

export function ChatLines({ channel, onPress }) {
  const rows = useStore(store, (s) => s.chats[channel]) ?? EMPTY;
  const last = rows.slice(-SHOWN);
  if (!last.length) return null;
  const lines = last.map((r) => (
    <Move key={r.id} kind="rise">
      <View
        style={{
          flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 300,
          backgroundColor: VEIL, borderRadius: 14, paddingVertical: 3, paddingLeft: 3, paddingRight: 9,
        }}
      >
        <Face wallet={r.wallet} size={20} />
        <ChatText text={r.text} v="small" color={C.text0} numberOfLines={1} size={16} big={22} style={{ flexShrink: 1 }} />
      </View>
    </Move>
  ));
  if (!onPress) return <View style={BOX}>{lines}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Open the chat" onPress={onPress} style={BOX}>
      {lines}
    </Pressable>
  );
}
```

- [ ] **Step 8: Run the phone suite and the bundle check**

Run: `cd mobile && npm test`
Expected: `# pass 274`, `# fail 0` (273 + 1).

Run: `cd mobile && npm run bundle:check`
Expected: it prints `web3.js copies: 1; files from engine/node_modules: 0` and exits 0.

The strip and the floats go on screen in Task 10; the chat sheet's changes are checked on the Seeker there too.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/room/room.js mobile/test/room.test.mjs mobile/src/room/ChatText.js mobile/src/room/EmojiRow.js mobile/src/room/ChatSheet.js mobile/src/room/useNewLines.js mobile/src/room/FloatingEmojis.js mobile/src/room/ChatLines.js
git commit -m "mobile: the 12 Mooner emojis in chat (a row above the input, drawn inline, larger alone), 280 code points as the server counts, new lines told apart from the snapshot, emojis that float up from new lines, and the last 3 lines as a strip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The room: scene, pool cells, crowd, your seat, host and chat (phone)

**Files:**
- Create: `mobile/src/room/Crowd.js`
- Rewrite: `mobile/src/room/YourSeat.js` (`SeatCard`, `GetBack`, `Line`), `mobile/app/presale/[key].js`
- Modify: `mobile/src/room/room.js` (`joinedSince`; the seat's title)
- Test: `mobile/test/room.test.mjs`

The room keeps `LaunchOverlay` until Task 12 replaces it.

- [ ] **Step 1: Write the failing test, and the seat's new title**

In `mobile/test/room.test.mjs`, replace line 4

```js
import { bottomOf, cellsOf, claimedOf, heroOf, hhmm, isKey, lockedCommit, momentStep, newLines, pickOf, poolLine, refToNote, seatPlan, shortOf } from "../src/room/room.js";
```

with

```js
import { bottomOf, cellsOf, claimedOf, heroOf, hhmm, isKey, joinedSince, lockedCommit, momentStep, newLines, pickOf, poolLine, refToNote, seatPlan, shortOf } from "../src/room/room.js";
```

The seat card says "Your seat · X SOL" (spec §2). Change the four expected titles in the `seatPlan` test:

```bash
sed -i '' "s/title: \"You're in · 0.25 SOL\"/title: \"Your seat · 0.25 SOL\"/g" mobile/test/room.test.mjs
grep -c "Your seat · 0.25 SOL" mobile/test/room.test.mjs
```

Expected: `4`.

Add at the end of the file:

```js
test("joinedSince: the wallets new since the last read; nobody on the first", () => {
  const who = [{ user: "a" }, { user: "b" }, { user: "c" }];
  assert.deepEqual(joinedSince(null, who), []);
  assert.deepEqual(joinedSince(new Set(["a"]), who), ["b", "c"]);
  assert.deepEqual(joinedSince(new Set(["a", "b", "c", "d"]), who), [], "a wallet that left joins nothing");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd mobile && node --test test/room.test.mjs`
Expected: FAIL, `SyntaxError: The requested module '../src/room/room.js' does not provide an export named 'joinedSince'`.

- [ ] **Step 3: Write `joinedSince` and the new title**

In `mobile/src/room/room.js`, add after `newLines`:

```js
/** The wallets in `who` (whoIsIn rows) that `before` (a Set of wallets from the last read)
 *  hadn't. `before` null is the first read: nobody is new. */
export function joinedSince(before, who) {
  if (before == null) return [];
  return who.filter((w) => !before.has(w.user)).map((w) => w.user);
}
```

and in `seatPlan` replace

```js
    : `You're in · ${solText(seat.commit)} SOL`;
```

with

```js
    : `Your seat · ${solText(seat.commit)} SOL`;
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `cd mobile && node --test test/room.test.mjs`
Expected: every test passes, `# fail 0`.

- [ ] **Step 5: The crowd**

Create `mobile/src/room/Crowd.js`:

```js
// Who's in, as a grid: each wallet's face and its SOL, biggest first. Past 10 wallets, the
// first 9 and "+N". A wallet that joins while the grid is on screen pops in, once: one that
// drops into "+N" and comes back shows without popping.
import { memo, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Face } from "../ui/Face";
import { shortWallet, solText } from "../ui/format";
import { CheckIcon } from "../ui/icons";
import { T } from "../ui/kit";
import { Move } from "../ui/motion";
import { C, F, R } from "../ui/theme";

const CELLS = 10;
const SIZE = 42;

/** `who`: whoIsIn(view) rows. `me`: the connected wallet, ringed in gold. `onFace(row)`: a tap
 *  on a face (not tappable without it). `ticks`: a tick on every face (the pool is full).
 *  `ready`: `who` is this visit's (the room's first snapshot since it opened). Until then
 *  nothing pops: the wallets already here are the ones `who` holds once it's ready. */
export const Crowd = memo(function Crowd({ who, me, onFace, ticks = false, ready = true }) {
  // the wallets that show without popping: those here when `who` turned ready, and each that
  // has shown since (a Set kept for the screen's life; null until ready)
  const here = useRef(null);
  if (ready) here.current ??= new Set(who.map((w) => w.user));
  if (!who.length) {
    return <T v="small" color={C.text2} style={{ textAlign: "center", paddingVertical: 8 }}>Nobody yet</T>;
  }
  const shown = who.length > CELLS ? who.slice(0, CELLS - 1) : who;
  const more = who.length - shown.length;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}>
      {shown.map((w) => (
        <Spot key={w.user} wallet={w.user} here={here} pop={!!here.current && !here.current.has(w.user)}>
          <Cell row={w} me={w.user === me} onFace={onFace} tick={ticks} />
        </Spot>
      ))}
      {more > 0 ? (
        <View accessible accessibilityLabel={`${more} more`} style={{ width: "20%", alignItems: "center", gap: 4 }}>
          <View
            style={{
              width: SIZE, height: SIZE, borderRadius: R.pill, backgroundColor: C.bg3,
              borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center",
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: C.text1 }}>{`+${more}`}</Text>
          </View>
          <T v="small" color={C.text2} style={{ fontSize: 11 }}>more</T>
        </View>
      ) : null}
    </View>
  );
});

/** One grid spot. Whether it pops is settled when it mounts, so a wallet already on screen
 *  never pops later; once mounted its wallet joins `here`, so it never pops again. */
function Spot({ wallet, here, pop, children }) {
  const [popping] = useState(pop);
  useEffect(() => {
    here.current?.add(wallet);
  }, [here, wallet]);
  if (!popping) return <View style={{ width: "20%" }}>{children}</View>;
  return (
    <Move kind="pop" style={{ width: "20%" }}>
      {children}
    </Move>
  );
}

function Cell({ row, me, onFace, tick }) {
  const body = (
    <View style={{ alignItems: "center", gap: 4 }}>
      <View>
        <Face wallet={row.user} size={SIZE} ring={me ? C.gold : undefined} />
        {tick ? (
          <View
            style={{
              position: "absolute", right: -2, bottom: -2, width: 16, height: 16, borderRadius: 8,
              backgroundColor: C.up, borderWidth: 2, borderColor: C.bg1, alignItems: "center", justifyContent: "center",
            }}
          >
            <CheckIcon color={C.bg0} size={9} />
          </View>
        ) : null}
      </View>
      <T v="num" color={me ? C.gold : C.text1} style={{ fontSize: 11 }}>{solText(row.commit)}</T>
    </View>
  );
  const label = `${shortWallet(row.user)}, ${solText(row.commit)} SOL${me ? ", you" : ""}`;
  if (!onFace) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onFace(row);
      }}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      {body}
    </Pressable>
  );
}
```

- [ ] **Step 6: Your seat as a gold card, and "Get my X SOL back" on its own**

Replace all of `mobile/src/room/YourSeat.js` with:

```js
// Your seat in the room: the gold card with what you have in (SeatCard), and the small quiet
// line under the buttons that takes it back (GetBack).
import { useState } from "react";
import { Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { store } from "../app";
import { Face } from "../ui/Face";
import { solText } from "../ui/format";
import { LockIcon } from "../ui/icons";
import { Steps, T } from "../ui/kit";
import { C, F } from "../ui/theme";
import { seatPlan } from "./room";

/** The gold at 45%: the card's rim, as in the mockup. */
const GOLD_RIM = `${C.gold}73`;

/** `seat`: seatOf(view, wallet); `launched`: the launched row or undefined. */
export function SeatCard({ view, launched, seat, wallet, now }) {
  const busy = useStore(store, (s) => s.busy);
  const plan = seatPlan(view, launched, seat, wallet, now);
  // the seat can show up while its join is still going: the join's steps until it's done
  if (busy?.kind === "join" && busy.key === view.presale) return <Steps step={busy.step} />;
  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 11,
        borderRadius: 12, borderWidth: 1, borderColor: GOLD_RIM, backgroundColor: C.goldSoft,
      }}
    >
      <Face wallet={wallet} size={32} ring={C.gold} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <T v="body" color={C.gold} style={{ fontFamily: F.semi }}>{plan.title}</T>
        {plan.note === "creator" ? (
          <Line icon={<LockIcon color={C.text1} />}>
            As the creator, your SOL stays in until launch. If the pool doesn't fill in time, it comes back by itself.
          </Line>
        ) : null}
        {plan.note === "locked" ? (
          <Line icon={<LockIcon color={C.text1} />}>Locked in. Your tokens come to your wallet right after launch.</Line>
        ) : null}
      </View>
    </View>
  );
}

/** "Get my X SOL back", when the seat can be taken back. `onBack(deposit)` runs when the SOL
 *  is back (the seat then leaves the view, and this with it). */
export function GetBack({ view, launched, seat, wallet, now, signer, onBack }) {
  const busy = useStore(store, (s) => s.busy);
  const [error, setError] = useState(null);
  const plan = seatPlan(view, launched, seat, wallet, now);
  const backing = busy?.kind === "back" && busy.key === view.presale;
  const joining = busy?.kind === "join" && busy.key === view.presale;

  async function getBack() {
    if (store.getState().busy) return;
    if (!signer) return;
    setError(null);
    const r = await store.getState().getBack(view.presale, signer);
    Haptics.notificationAsync(r.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
    if (r.ok) onBack?.(seat.deposit);
    else setError(r.error);
  }

  if (joining || !plan.back) return null;
  const off = !signer || !!busy;
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      {backing ? <Steps step={busy.step} /> : null}
      {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: off, busy: backing }}
        disabled={off}
        hitSlop={8}
        onPress={getBack}
        style={({ pressed }) => [
          { minHeight: 32, justifyContent: "center", paddingHorizontal: 12 },
          off && !backing && { opacity: 0.45 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <T v="small" color={C.text2}>{`Get my ${solText(seat.deposit)} SOL back`}</T>
      </Pressable>
    </View>
  );
}

/** A small line of text after an icon. */
export function Line({ icon, color = C.text1, children }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <T v="small" color={color} style={{ flex: 1 }}>{children}</T>
    </View>
  );
}
```

- [ ] **Step 7: The room**

Replace all of `mobile/app/presale/[key].js` with:

```js
// The presale room: its scene with the coin, time left and the last chat lines; the pool as
// cells; who's in; your seat; the coin. The host, your button and the chat sit at the bottom.
// The chat slides up; the launch plays full screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { chatGate } from "../../../engine/src/cues.js";
import { seatOf, whoIsIn } from "../../../engine/src/views.js";
import { store } from "../../src/app";
import { useAccount, useSigner } from "../../src/wallet";
import { stillIn } from "../../src/launched/coin";
import { ChatLines } from "../../src/room/ChatLines";
import { ChatSheet } from "../../src/room/ChatSheet";
import { Crowd } from "../../src/room/Crowd";
import { FloatingEmojis } from "../../src/room/FloatingEmojis";
import { JoinSheet } from "../../src/room/JoinSheet";
import { LaunchOverlay } from "../../src/room/LaunchOverlay";
import { GetBack, Line, SeatCard } from "../../src/room/YourSeat";
import { useNewLines } from "../../src/room/useNewLines";
import { bottomOf, claimedOf, heroOf, isKey, joinedSince, lockedCommit, poolLine, refToNote } from "../../src/room/room";
import { shareOf } from "../../src/room/share";
import { BASE } from "../../src/config";
import { Cells } from "../../src/ui/Cells";
import { CoinImage } from "../../src/ui/CoinImage";
import { Face } from "../../src/ui/Face";
import { shortWallet, solText } from "../../src/ui/format";
import { BackIcon, ChatIcon, CheckIcon, ShareIcon } from "../../src/ui/icons";
import { Host } from "../../src/ui/Host";
import { Button, Card, Empty, Pill, Screen, Sheet, Steps, T } from "../../src/ui/kit";
import { LinkPills } from "../../src/ui/LinkPills";
import { Move } from "../../src/ui/motion";
import { Scene } from "../../src/ui/Scene";
import { play } from "../../src/ui/sound";
import { TopBar, goBack } from "../../src/ui/TopBar";
import { useNow } from "../../src/ui/useNow";
import { C, F, R, S } from "../../src/ui/theme";

/** How long "X SOL is back in your wallet" stays. */
const BACK_NOTE_MS = 4_000;
/** Where back goes when the room was opened from a link. */
const HOME = "/(tabs)";
/** The scene's height; the top row, the chat strip and the pool sit over it. */
const SCENE_H = 300;
/** bg0 at 60%: the round buttons over the scene. */
const SCENE_BUTTON = `${C.bg0}99`;
const WITH_SEAT = "Share your link. It launches the moment the pool is full.";
const WITHOUT_SEAT = "Take a seat. It launches the moment the pool is full.";

const tap = () => Haptics.selectionAsync().catch(() => {});

export default function Room() {
  const params = useLocalSearchParams();
  const key = Array.isArray(params.key) ? params.key[0] : params.key;
  const valid = isKey(key);

  useEffect(() => (valid ? store.getState().watch(key) : undefined), [key, valid]);

  const ref = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  // A link someone shared (`?ref=<their wallet>`): kept until a join from this phone lands here.
  // Noted once the saved wallet is read (refToNote). When it was there, FollowWallet's effect
  // has set store.wallet first: it runs before this one in the same commit (it's an earlier
  // sibling of the screens) and setWallet sets `wallet` before its first await.
  const account = useAccount();
  const toNote = refToNote(valid, ref, account);
  useEffect(() => {
    if (toNote) store.getState().noteRef(key, toNote);
  }, [key, toNote]);

  const view = useStore(store, (s) => s.views[key] ?? s.presales[key]);
  const detail = useStore(store, (s) => s.views[key]);
  const missing = useStore(store, (s) => !!s.missing[key]);
  const viewError = useStore(store, (s) => s.viewError[key] ?? null);
  const info = useStore(store, (s) => s.info);
  const infoError = useStore(store, (s) => s.infoError);
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  const launched = useStore(store, (s) => s.launched[key]);
  const chatCount = useStore(store, (s) => s.chats[key]?.length ?? 0);
  const busy = useStore(store, (s) => s.busy);
  const mineEntry = useStore(store, (s) => s.mine[key]);
  const focused = useIsFocused();
  const now = useNow(1000, focused);
  const signer = useSigner();
  const insets = useSafeAreaInsets();

  // A detail view kept from an earlier visit isn't this visit's: the launch moment waits for
  // the first snapshot since the room opened.
  const [kept] = useState(() => store.getState().views[key]);
  const ready = !!detail && detail !== kept;

  const [joinOpen, setJoinOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [face, setFace] = useState(null); // a whoIsIn row
  const [backNote, setBackNote] = useState(null);
  const openJoin = useCallback(() => setJoinOpen(true), []);
  const closeJoin = useCallback(() => setJoinOpen(false), []);
  const openChat = useCallback(() => setChatOpen(true), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const onBack = useCallback((deposit) => setBackNote(`${solText(deposit)} SOL is back in your wallet`), []);

  useEffect(() => {
    if (!backNote) return;
    const t = setTimeout(() => setBackNote(null), BACK_NOTE_MS);
    return () => clearTimeout(t);
  }, [backNote]);

  const who = useMemo(() => (view ? whoIsIn(view) : []), [view]);
  const seat = useMemo(() => (view && wallet ? seatOf(view, wallet) : null), [view, wallet]);
  const ticker = view?.token?.symbol;

  // `join` when a wallet takes a seat, from this visit's first snapshot on
  const before = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const joined = joinedSince(before.current, who);
    before.current = new Set(who.map((w) => w.user));
    if (joined.length && focused) play("join");
  }, [ready, who, focused]);

  // `chat` when a line arrives, at most one every 400 ms
  const [chatSound] = useState(() => chatGate());
  const onLine = useCallback(() => {
    if (focused && chatSound(Date.now())) play("chat");
  }, [focused, chatSound]);
  useNewLines(key, onLine);

  // Whether this wallet's tokens arrived: its seat's commit last seen after OPEN (kept here,
  // per presale and wallet), else a join from this phone not taken back (the keeper delivers
  // the tokens by itself, so the room may never see the seat after OPEN).
  const [lock, setLock] = useState({ key: null, wallet: null, commit: null });
  const same = lock.key === key && lock.wallet === wallet;
  const locked = lockedCommit(detail, wallet, same ? lock.commit : null);
  if (!same || lock.commit !== locked) setLock({ key, wallet, commit: locked });
  const claimed = claimedOf(detail, wallet, locked ?? (stillIn(mineEntry) ? 1n : null));

  if (!valid || missing) {
    return (
      <Screen padded={false}>
        <TopBar title="" fallback={HOME} />
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: S.gutter }}>
          <Empty title="This presale isn't here" body="It may have closed." />
          <Button kind="quiet" title="Back" onPress={() => goBack(HOME)} />
        </View>
      </Screen>
    );
  }

  if (!view || !info) {
    const error = infoError || viewError;
    return (
      <Screen padded={false}>
        <TopBar title="" fallback={HOME} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: S.gutter }}>
          <ActivityIndicator color={C.text1} />
          {error ? <T v="small" color={C.down} style={{ textAlign: "center" }}>{error}</T> : null}
        </View>
      </Screen>
    );
  }

  const hero = heroOf(view, launched, info.N, now);
  const bottom = bottomOf(view, wallet, info.N, now, claimed);
  // A join going on with its sheet closed (by a tap outside it, or back): its steps show here.
  const joinBusy = busy?.kind === "join" && busy.key === key && !joinOpen && bottom.kind !== "seat";
  // null while the presale is OPEN past its deadline: no Share or Invite then (src/room/share.js)
  const shareText = shareOf({ view, launched, wallet, N: info.N, base: BASE, now });
  const onShare = () => {
    if (shareText) Share.share(shareText, { dialogTitle: "Share this presale" }).catch(() => {});
  };
  const hostLine =
    hero.stage !== "presale" ? null
    : bottom.kind === "seat" ? WITH_SEAT
    : bottom.kind === "join" || bottom.kind === "connect" ? WITHOUT_SEAT
    : null;
  const main =
    bottom.kind === "connect" ? <Button title="Connect to join" onPress={() => router.push("/connect")} />
    : bottom.kind === "seat" ? (shareText ? <Button title="Invite" onPress={onShare} /> : null)
    : bottom.kind === "claimed" ? <Button title={ticker ? `See $${ticker}` : "See the coin"} onPress={() => router.push(`/coin/${key}`)} />
    : joinBusy ? <Button title="Join" onPress={openJoin} busy />
    : bottom.kind === "join" ? <Button title="Join" onPress={openJoin} />
    : null;
  const timeColor = hero.stage === "presale" ? C.text0 : hero.color === C.text2 ? C.text1 : hero.color;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <Scene name="room" height={SCENE_H} style={{ position: "absolute", top: 0, left: 0, right: 0 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: S.gutter, paddingTop: 6 }}>
          <SceneButton label="Back" onPress={() => goBack(HOME)}>
            <BackIcon color={C.text0} />
          </SceneButton>
          {view.token ? <CoinImage uri={view.token.image} size={42} ticker={view.token.symbol} /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T v="h2" numberOfLines={1}>{ticker ? `$${ticker}` : "Presale"}</T>
            {view.token?.name ? <T v="small" color={C.text0} numberOfLines={1}>{`Presale · ${view.token.name}`}</T> : null}
          </View>
          <T v="num" color={timeColor} style={{ fontSize: 16 }}>{hero.under}</T>
          {shareText && bottom.kind !== "seat" ? (
            <SceneButton label="Share" onPress={onShare}>
              <ShareIcon color={C.text0} size={20} />
            </SceneButton>
          ) : null}
        </View>
        <View style={{ height: 100, justifyContent: "flex-end", paddingHorizontal: S.gutter, paddingBottom: 6 }}>
          <ChatLines channel={key} onPress={openChat} />
        </View>
        <View style={{ paddingHorizontal: S.gutter, gap: 12 }}>
          <Move kind="rise">
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <T v="label">Pool</T>
                <T v="num" color={C.text2} style={{ fontSize: 13 }}>
                  <T v="num" color={hero.color} style={{ fontSize: 13 }}>{solText(view.raised)}</T>
                  {` / ${solText(info.N.TARGET)} SOL`}
                </T>
              </View>
              <Cells raised={view.raised} target={info.N.TARGET} color={hero.stage === "expired" ? C.text2 : C.er} />
              {detail ? <T v="small">{poolLine(detail, info.N)}</T> : null}
            </View>
          </Move>
          <Move kind="rise" delay={90}>
            <Card style={{ gap: 12, paddingHorizontal: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6 }}>
                <T v="label">Who's in</T>
                <T v="num" color={C.text2} style={{ fontSize: 12 }}>{who.length}</T>
              </View>
              <Crowd who={who} me={wallet} onFace={setFace} />
            </Card>
          </Move>
          {bottom.kind === "seat" ? (
            <Move kind="rise" delay={180}>
              <SeatCard view={view} launched={launched} seat={bottom.seat} wallet={wallet} now={now} />
            </Move>
          ) : null}
          {view.token ? (
            <Move kind="rise" delay={270}>
              <Coin token={view.token} />
            </Move>
          ) : null}
        </View>
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: SCENE_H - 40 }}>
          <FloatingEmojis channel={key} on={focused && !chatOpen} />
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: S.gutter, paddingTop: 10, paddingBottom: insets.bottom + 10, gap: 10, backgroundColor: C.bg0 }}>
        {hostLine ? <Host line={hostLine} /> : null}
        {backNote ? <T v="small" color={C.up} style={{ textAlign: "center" }}>{backNote}</T> : null}
        {bottom.kind === "claimed" ? (
          <Line icon={<CheckIcon color={C.gold} />} color={C.gold}>Your tokens arrived</Line>
        ) : null}
        {joinBusy ? <Steps step={busy.step} /> : null}
        {bottom.kind === "why" && !joinBusy ? <T v="small" color={C.text2} style={{ textAlign: "center" }}>{bottom.why}</T> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>{main}</View>
          <ChatButton count={chatCount} onPress={openChat} />
        </View>
        {bottom.kind === "seat" ? (
          <GetBack view={view} launched={launched} seat={bottom.seat} wallet={wallet} now={now} signer={signer} onBack={onBack} />
        ) : null}
      </View>

      <JoinSheet
        open={joinOpen}
        onClose={closeJoin}
        onFailed={openJoin}
        view={view}
        info={info}
        lamports={lamports}
        signer={signer}
        why={bottom.kind === "why" ? bottom.why : bottom.kind === "seat" ? "You're already in." : null}
      />
      <ChatSheet open={chatOpen} onClose={closeChat} channel={key} wallet={wallet} signer={signer} />
      <FaceSheet row={face} onClose={() => setFace(null)} />
      <LaunchOverlay view={view} launched={launched} seat={seat} claimed={claimed} ready={ready} focused={focused} />
    </Screen>
  );
}

/** A round button over the scene, on a dark veil. */
function SceneButton({ label, onPress, children }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        { width: 40, height: 40, borderRadius: 20, backgroundColor: SCENE_BUTTON, alignItems: "center", justifyContent: "center" },
        pressed && { opacity: 0.6 },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** The chat, with its message count, next to the main button. */
function ChatButton({ count, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Chat, ${count} messages` : "Chat"}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        {
          minWidth: 52, height: 52, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: 1, borderColor: C.lineStrong,
          backgroundColor: C.bg2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <ChatIcon color={C.text0} />
      {count > 0 ? <T v="num" color={C.text1} style={{ fontSize: 13 }}>{count}</T> : null}
    </Pressable>
  );
}

/** One person in the pool: their face, wallet, what they put in, and whether they made it.
 *  It keeps the last person while it slides out, so it doesn't go blank on the way down. */
function FaceSheet({ row, onClose }) {
  const last = useRef(row);
  if (row) last.current = row;
  const shown = last.current;
  return (
    <Sheet open={!!row} onClose={onClose}>
      {shown ? (
        <View style={{ alignItems: "center", gap: 10, paddingBottom: 8 }}>
          <Face wallet={shown.user} size={64} />
          <T v="num">{shortWallet(shown.user)}</T>
          <T v="h2">{`${solText(shown.commit)} SOL`}</T>
          {shown.creator ? <Pill text="Creator" color={C.gold} /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

/** The coin: picture, name, ticker, what it's about (3 lines, "More" shows the rest), links. */
function Coin({ token }) {
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <CoinImage uri={token.image} size={56} ticker={token.symbol} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="h2" numberOfLines={1}>{token.name}</T>
          <T v="small" numberOfLines={1}>{`$${token.symbol}`}</T>
        </View>
      </View>
      {token.description ? <About text={token.description} /> : null}
      <LinkPills token={token} />
    </Card>
  );
}

/** Three lines, and "More" when there are more. A hidden copy with no line limit counts them. */
function About({ text }) {
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <View>
      <T v="small" numberOfLines={open ? undefined : 3}>{text}</T>
      <T
        v="small"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        onTextLayout={(e) => setLong(e.nativeEvent.lines.length > 3)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, opacity: 0 }}
      >
        {text}
      </T>
      {long && !open ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setOpen(true)} style={{ alignSelf: "flex-start", paddingTop: 4 }}>
          <T v="small" color={C.accent} style={{ fontFamily: F.medium }}>More</T>
        </Pressable>
      ) : null}
    </View>
  );
}
```

What moved: the ring is gone (the pool cells replace it; `Ring.js` is deleted in Task 12 with `LaunchOverlay.js`, its other user). Share moved from the top bar to "Invite" for a seat, and to a round button over the scene for everyone else. The chat button moved next to the main button. `FACES` and `WhoIsIn` are gone (the crowd replaces them).

- [ ] **Step 8: Run the phone suite and the bundle check**

Run: `cd mobile && npm test`
Expected: `# pass 275`, `# fail 0` (274 + 1).

Run: `cd mobile && npm run bundle:check`
Expected: it prints `web3.js copies: 1; files from engine/node_modules: 0` and exits 0.

Run: `grep -rn "ui/Ring\|WhoIsIn\|{ YourSeat" mobile/app mobile/src`
Expected: one line, `mobile/src/room/LaunchOverlay.js` importing `Ring` (both go in Task 12).

- [ ] **Step 9: Build for the Seeker and check the room**

Nothing native changed, so no prebuild. Run from the repo root:

```bash
(cd mobile && ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh)
```

Expected: the release build installs on the Seeker (the JS is bundled into it; there's no Metro). If the install fails on a signature mismatch, stop and tell the user (never `adb uninstall`).

On the Seeker, open an OPEN presale from Pulse:
- the room's scene is at the top with the round back button, the coin, `$TICKER`, "Presale · Name" and the time left over it, readable without a text shadow;
- the last 3 chat lines sit over the scene's bottom edge; a tap opens the chat;
- Pool shows `X / Y SOL`, 10 cells filled to match, and "N wallets in · X SOL to go";
- the pool, the crowd, your seat and the coin rise in one after another;
- the crowd shows each wallet's face and SOL, 5 across; a tap on a face opens its card;
- the host's bubble pops and types its line, with the `host` sound;
- the chat sheet has the emoji row: a tap adds `:name:` and plays `emoji`; a line of only emojis shows them large; emojis show inline in mixed lines; 280 rockets fit, the 281st doesn't;
- a chat line with emojis sent while the room is up floats up to 4 of them over the scene, and plays `chat`;
- after a join, the gold "Your seat · X SOL" card rises in, the main button reads "Invite" (opens Android's share sheet), and "Get my X SOL back" sits under it and works;
- a second wallet joining (from another device or the web) pops its face into the grid and plays `join`; if no second wallet is at hand, say this check wasn't done.

- [ ] **Step 10: Commit**

```bash
git add mobile/src/room/room.js mobile/test/room.test.mjs mobile/src/room/Crowd.js mobile/src/room/YourSeat.js "mobile/app/presale/[key].js"
git commit -m "mobile: the room in the cozy look: the scene with the coin, time left and the last chat lines over it, the pool as cells, the crowd as a grid where new wallets pop in (with join), the gold seat card, the host's line, Invite and the chat button at the bottom, chat with its sound and floating emojis" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Which launch screen shows, and opening the room late

**Files:**
- Modify: `mobile/src/room/room.js` (`momentStep`; add `momentScreen`)
- Test: `mobile/test/room.test.mjs`

The launch has four screens (spec §4): pool full with its 3-2-1, launching, live, failed. `momentStep` says which phase the launch is in, from the stages the room sees. `momentScreen` picks the screen from that phase and three facts: whether the 3-2-1 has finished, whether the steps are all done, and whether this wallet's tokens arrived. The one new case in `momentStep` is a room opened while the pool is already full or launching: it starts the moment straight onto the launching screen (`late`), with no POOL FULL and no countdown.

- [ ] **Step 1: Write the failing tests**

In `mobile/test/room.test.mjs`, replace the import line

```js
import { bottomOf, cellsOf, claimedOf, heroOf, hhmm, isKey, joinedSince, lockedCommit, momentStep, newLines, pickOf, poolLine, refToNote, seatPlan, shortOf } from "../src/room/room.js";
```

with

```js
import { bottomOf, cellsOf, claimedOf, heroOf, hhmm, isKey, joinedSince, lockedCommit, momentScreen, momentStep, newLines, pickOf, poolLine, refToNote, seatPlan, shortOf } from "../src/room/room.js";
```

Replace the first four lines of the `momentStep` test

```js
test("momentStep: plays only for a change seen live", () => {
  // first sight of an already launching or live presale: nothing
  assert.equal(momentStep(null, null, "launching"), null);
  assert.equal(momentStep(null, null, "live"), null);
```

with

```js
test("momentStep: plays for a change seen live, or a room opened while launching", () => {
  // first sight: a presale already launching opens on the launching screen; one already live
  // (or expired) starts nothing
  assert.equal(momentStep(null, null, "launching"), "launching");
  assert.equal(momentStep(null, null, "live"), null);
  assert.equal(momentStep(null, null, "expired"), null);
  assert.equal(momentStep(null, null, "presale"), null);
```

(the rest of that test stays as it is), and after the whole `momentStep` test add:

```js
test("momentScreen: pool full until the 3-2-1 is done, then launching until your tokens arrive or every seat is served", () => {
  const at = (o) => momentScreen({ late: false, counted: false, stepsDone: false, claimed: false, ...o });
  assert.equal(at({ phase: null }), null);
  assert.equal(at({ phase: "done" }), null);
  // seen filling: POOL FULL and the 3-2-1 first, whatever the chain does meanwhile
  assert.equal(at({ phase: "launching" }), "full");
  assert.equal(at({ phase: "live", claimed: true }), "full");
  // after the 3-2-1
  assert.equal(at({ phase: "launching", counted: true }), "launching");
  assert.equal(at({ phase: "live", counted: true }), "launching", "the pool is up, tokens still on the way");
  assert.equal(at({ phase: "live", counted: true, claimed: true }), "live");
  assert.equal(at({ phase: "live", counted: true, stepsDone: true }), "live", "not in it: live once every seat is served");
  // opened late: straight onto launching, then live
  assert.equal(at({ phase: "launching", late: true }), "launching");
  assert.equal(at({ phase: "live", late: true, claimed: true }), "live");
  // a failed launch says so at once, mid-countdown too
  assert.equal(at({ phase: "failed" }), "failed");
  assert.equal(at({ phase: "failed", counted: true }), "failed");
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd mobile && node --test test/room.test.mjs`
Expected: FAIL: `momentScreen` isn't exported (`SyntaxError: The requested module '../src/room/room.js' does not provide an export named 'momentScreen'`).

- [ ] **Step 3: Write the late case and `momentScreen`**

In `mobile/src/room/room.js`, replace

```js
 *  "done" (closed). It starts only on a change seen while the room is open: `prev` null is
 *  the first sight and starts nothing. */
export function momentStep(phase, prev, stage) {
  if (phase === "done" || prev == null || prev === stage) return phase;
```

with

```js
 *  "done" (closed). It starts on a change seen while the room is open, or on first sight
 *  (`prev` null) of a presale already launching: the room opened late, onto the launching
 *  screen. A first sight of one already live or expired starts nothing. */
export function momentStep(phase, prev, stage) {
  if (phase === "done" || prev === stage) return phase;
  if (prev == null) return phase == null && stage === "launching" ? "launching" : phase;
```

Then, right after the whole `momentStep` function, add:

```js
/** The launch screen to show: null (none), "full" (POOL FULL and the 3-2-1), "launching",
 *  "live" or "failed". `phase`: momentStep's. `late`: the moment started on first sight
 *  (no POOL FULL then). `counted`: the 3-2-1 has finished. `stepsDone`: launchSteps' done,
 *  every committed seat served. `claimed`: this wallet's tokens arrived (claimedOf). The
 *  3-2-1 always plays to the end; the steps behind it don't wait for it. */
export function momentScreen({ phase, late, counted, stepsDone, claimed }) {
  if (phase == null || phase === "done") return null;
  if (phase === "failed") return "failed";
  if (!late && !counted) return "full";
  return claimed || stepsDone ? "live" : "launching";
}
```

- [ ] **Step 4: Run them to make sure they pass, then the phone suite**

Run: `cd mobile && node --test test/room.test.mjs`
Expected: `# fail 0`.

Run: `cd mobile && npm test`
Expected: `# pass 276`, `# fail 0` (275 + 1).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/room/room.js mobile/test/room.test.mjs
git commit -m "mobile: which launch screen shows (momentScreen: pool full until the 3-2-1 ends, launching until your tokens arrive or every seat is served, failed at once), and a room opened while the pool is full or launching starts on the launching screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The launch moments: pool full, 3-2-1, launching, live

**Files:**
- Create: `mobile/src/room/LaunchMoment.js` (`useMoment`, `LaunchMoment`)
- Create: `mobile/src/room/MomentFull.js` (`MomentFull`, `MomentFailed`)
- Create: `mobile/src/room/MomentLaunching.js`
- Create: `mobile/src/room/MomentLive.js`
- Modify: `mobile/app/presale/[key].js`
- Delete: `mobile/src/room/LaunchOverlay.js`, `mobile/src/ui/Ring.js`

These replace `LaunchOverlay` (a ring and a line of text). They follow real state: `momentStep` and `momentScreen` (Task 11) pick the screen, and `launchSteps` (Task 3) ticks the steps. The timings on the pool-full screen are the approved demo's: POOL FULL stamps at 0, the coin pops at 350 ms, the crowd rises at 650 ms, 3-2-1 from 1500 ms, 820 ms apart, GO at 3960 ms, and the launching screen at 4610 ms. The host is quiet there, because the stamp and the count are playing. The screens show only while the room is the screen in front, as the overlay did: leaving the room pauses the moment, and coming back shows it again. Pool full's 3-2-1 starts over then.

- [ ] **Step 1: The moment and its screen**

Create `mobile/src/room/LaunchMoment.js`:

```js
// The launch, full screen, while the room is in front: POOL FULL and its 3-2-1, launching
// with its steps, live with your tokens, or failed. Real state picks the screen (room.js
// momentStep and momentScreen, engine launchsteps.js); the 3-2-1 never holds a step back.
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Modal, View } from "react-native";
import { launchSteps } from "../../../engine/src/launchsteps.js";
import { stageOf } from "../../../engine/src/views.js";
import { C } from "../ui/theme";
import { MomentFailed, MomentFull } from "./MomentFull";
import { MomentLaunching } from "./MomentLaunching";
import { MomentLive } from "./MomentLive";
import { momentNews, momentScreen, momentStep } from "./room";

/** The moment's phase (momentStep), whether it started on first sight (`late`: the room
 *  opened while the pool was full or launching), the launch steps (launchSteps), the screen
 *  to show (momentScreen: null for none), `onCounted` for the end of the 3-2-1, and `close`.
 *  `ready`: the view is this visit's own (the first snapshot since the room opened has come);
 *  until then nothing counts, so a view kept from an earlier visit can't start it. `detail`:
 *  the detail view (with seats) or undefined; `claimed`: claimedOf(...). */
export function useMoment({ view, detail, launched, ready, claimed }) {
  const stage = ready && view ? stageOf(view, launched) : null;
  const seen = useRef(null); // the stage last seen
  const [m, setM] = useState({ phase: null, late: false });
  useEffect(() => {
    if (stage == null) return;
    const prev = seen.current;
    seen.current = stage;
    setM((was) => {
      const phase = momentStep(was.phase, prev, stage);
      if (phase === was.phase) return was;
      return { phase, late: was.phase == null ? prev == null : was.late };
    });
  }, [stage]);
  const close = useCallback(() => setM((was) => ({ ...was, phase: "done" })), []);
  const [counted, setCounted] = useState(false);
  const onCounted = useCallback(() => setCounted(true), []);
  const steps = launchSteps(detail ?? view, launched);
  const screen = momentScreen({ phase: m.phase, late: m.late, counted, stepsDone: steps.done, claimed });
  return { phase: m.phase, late: m.late, steps, screen, onCounted, close };
}

/**
 * `moment`: useMoment's. `view`: the room's view; `launched`: the launched row or undefined;
 * `who`: whoIsIn(view). `seat`: seatOf(view, wallet) or null; `commit`: the seat's commit
 * last seen after OPEN (room.js lockedCommit) or null; `claimed`: claimedOf(...). `focused`:
 * the room is the screen in front and the app is in front; off, the moment hides and its
 * timers stop, so the 3-2-1 starts again on return. `N`: info.N. `onShare`: shares the coin,
 * or null when there's nothing to share.
 */
export function LaunchMoment({ moment, view, launched, who, seat, commit, claimed, focused, wallet, N, onShare }) {
  const { phase, late, steps, screen, onCounted, close } = moment;

  // The crowd that launched it: who was in when the moment started. Claims close seats, so
  // whoIsIn shrinks to nothing while the tokens go out.
  const [crowd, setCrowd] = useState(null);
  const started = phase != null && phase !== "done";
  if (started && crowd == null && who.length) setCrowd(who);

  // Whether this wallet had a seat while it launched: a failed launch refunds every seat, so
  // the seat may be gone by the time the failure shows.
  const hadSeat = useRef(false);
  useEffect(() => {
    if ((phase === "launching" || phase === "live") && seat) hadSeat.current = true;
  }, [phase, seat]);

  // The screens shown so far, and the lines a screen reader has heard: a screen shown again
  // (the room back in front) doesn't replay its entrance or say itself again.
  const shownBefore = useRef(new Set());
  const said = useRef(new Set());
  const up = focused ? screen : null;
  const ticker = view.token?.symbol ?? "";
  const refund = hadSeat.current || !!seat;
  useEffect(() => {
    if (!up) return;
    shownBefore.current.add(up);
    const fresh = momentNews(up, { ticker, claimed, refund }, said.current);
    if (!fresh.length) return;
    fresh.forEach((l) => said.current.add(l));
    AccessibilityInfo.announceForAccessibility(fresh.join(" "));
  }, [up, ticker, claimed, refund]);

  if (!up) return null;
  const shown = crowd ?? who;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: C.bg0 }}>
        {up === "full" ? (
          <MomentFull view={view} who={shown} wallet={wallet} N={N} onCounted={onCounted} />
        ) : up === "failed" ? (
          <MomentFailed refund={refund} onClose={close} />
        ) : up === "launching" ? (
          <MomentLaunching view={view} steps={steps} late={late} again={shownBefore.current.has("launching")} onClose={close} />
        ) : (
          <MomentLive
            view={view}
            launched={launched}
            who={shown}
            wallet={wallet}
            claimed={claimed}
            commit={commit ?? seat?.commit ?? null}
            again={shownBefore.current.has("live")}
            onShare={onShare}
            onClose={close}
          />
        )}
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: Pool full, its 3-2-1, and failed**

Create `mobile/src/room/MomentFull.js`:

```js
// POOL FULL: the room's scene dimmed, the stamp, the coin, the pool and the crowd with a tick
// on each face, then 3-2-1 and GO (a haptic each), timed as in the approved demo. Failed: the
// same scene, the copy and Close, quiet.
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CoinImage } from "../ui/CoinImage";
import { solText } from "../ui/format";
import { Host } from "../ui/Host";
import { Button, T } from "../ui/kit";
import { Move } from "../ui/motion";
import { Scene } from "../ui/Scene";
import { isArmed, play } from "../ui/sound";
import { C, F, R, S } from "../ui/theme";
import { Crowd } from "./Crowd";

/** When 3 shows (ms after POOL FULL), the gap to 2 and to 1, GO, and the launching screen. */
const COUNT_AT = 1500;
const COUNT_GAP_MS = 820;
const GO_AT = COUNT_AT + 3 * COUNT_GAP_MS; // 3960
const COUNTED_AT = GO_AT + 650; // 4610
const HOST_LINE = "Nothing to do. I'll bring your tokens to you.";
/** The moment's own cues stay quiet until the app is touched (a room opened by a link). */
const cue = (name) => {
  if (isArmed()) play(name);
};

/** `who`: the crowd. `onCounted`: GO has shown; the launching screen comes next. */
export function MomentFull({ view, who, wallet, N, onCounted }) {
  const insets = useSafeAreaInsets();
  const [count, setCount] = useState(null); // null, then 3, 2, 1, then 0 for GO
  const counted = useRef(onCounted);
  counted.current = onCounted;

  useEffect(() => {
    cue("stamp");
    cue("poolfull");
    const timers = [3, 2, 1].map((n, i) =>
      setTimeout(() => {
        setCount(n);
        cue("count");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      }, COUNT_AT + i * COUNT_GAP_MS),
    );
    timers.push(
      setTimeout(() => {
        setCount(0);
        cue("go");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }, GO_AT),
      setTimeout(() => counted.current(), COUNTED_AT),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const ticker = view.token?.symbol ?? "";
  return (
    <View style={{ flex: 1 }}>
      <Scene name="room" dim={0.55} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, paddingTop: insets.top + 32, paddingHorizontal: S.gutter, alignItems: "center", gap: 18 }}>
        <Move kind="stamp">
          <View style={{ borderWidth: 2, borderColor: C.up, borderRadius: R.m, paddingHorizontal: 16, paddingVertical: 6 }}>
            <T style={{ fontFamily: F.bold, fontSize: 30, letterSpacing: 3 }} color={C.up}>POOL FULL</T>
          </View>
        </Move>
        <Move kind="pop" delay={350}>
          <CoinImage uri={view.token?.image} size={88} ticker={ticker} />
        </Move>
        <Move kind="rise" delay={500} style={{ alignItems: "center", gap: 4 }}>
          {ticker ? <T v="h2">{`$${ticker}`}</T> : null}
          <T v="num" color={C.text1} style={{ fontSize: 13 }}>
            {`${solText(view.raised)} / ${solText(N.TARGET)} SOL · ${who.length === 1 ? "1 wallet" : `${who.length} wallets`}`}
          </T>
        </Move>
        <Move kind="rise" delay={650} style={{ alignSelf: "stretch" }}>
          <Crowd who={who} me={wallet} ticks />
        </Move>
        <View style={{ height: 96, alignItems: "center", justifyContent: "center" }}>
          {count == null ? null : (
            <Move kind="pop" key={count}>
              <T v="bigNum" color={count === 0 ? C.up : C.text0} style={{ fontSize: 72, lineHeight: 84 }}>
                {count === 0 ? "GO" : String(count)}
              </T>
            </Move>
          )}
        </View>
        {count === 0 ? (
          <Move kind="rise">
            <T v="label" color={C.text0}>Launching on Meteora</T>
          </Move>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: S.gutter, paddingBottom: insets.bottom + 24 }}>
        <Host line={HOST_LINE} sound={false} />
      </View>
    </View>
  );
}

/** The launch didn't go through: the copy, the refund line for a seat that was in, Close. */
export function MomentFailed({ refund, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <Scene name="room" dim={0.6} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: S.gutter, gap: 8 }}>
        <Move kind="rise">
          <T v="title" style={{ textAlign: "center" }}>The launch didn't go through.</T>
        </Move>
        {refund ? (
          <Move kind="rise" delay={90}>
            <T v="body" color={C.text1} style={{ textAlign: "center" }}>Your SOL comes back by itself.</T>
          </Move>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: S.gutter, paddingBottom: insets.bottom + 24 }}>
        <Button kind="quiet" title="Close" onPress={onClose} />
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Launching**

Create `mobile/src/room/MomentLaunching.js`:

```js
// Launching: it slides up after the 3-2-1 with `whoosh` (or opens here when the room opened
// late, the room's own whoosh already played). The launching scene zooms out slowly, the coin
// chip, the room's chat over the scene, and the four steps: `step` as each ticks done, `tick`
// as "N to go" goes down.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CoinImage } from "../ui/CoinImage";
import { Host } from "../ui/Host";
import { CheckIcon } from "../ui/icons";
import { Button, Card, T } from "../ui/kit";
import { Move } from "../ui/motion";
import { Scene } from "../ui/Scene";
import { isArmed, play } from "../ui/sound";
import { C, F, R, S } from "../ui/theme";
import { ChatLines } from "./ChatLines";
import { FloatingEmojis } from "./FloatingEmojis";

const SCENE_H = 340;
/** One step ticks at a time: the pool and the one buy land in one transaction, and the buy
 *  ticks right after the pool. */
const STEP_GAP_MS = 350;
const HOST_LINE = "Your tokens come to you. Nothing to sign.";
const CHIP = `${C.bg0}bd`;
/** The moment's own cues stay quiet until the app is touched (a room opened by a link). */
const cue = (name) => {
  if (isArmed()) play(name);
};

/** How many steps from the top are done. */
const doneFromTop = (steps) => {
  const i = steps.findIndex((s) => s.state !== "done");
  return i === -1 ? steps.length : i;
};

/** `steps`: launchSteps(...) for the presale. `late`: the room opened while it was already
 *  launching; the steps done by then show ticked at once. After the 3-2-1, the steps that
 *  landed during it tick in one by one. `again`: this screen showed before (the room is back
 *  in front): the steps done show ticked at once, and no whoosh or host sound. Read once, as
 *  it opens. */
export function MomentLaunching({ view, steps, late, again, onClose }) {
  const insets = useSafeAreaInsets();
  const [first] = useState(() => !late && !again); // straight from the 3-2-1
  const [quietHost] = useState(() => !!again);
  const target = doneFromTop(steps.steps);
  // the steps shown done; then one more every STEP_GAP_MS until they match the chain
  const [shown, setShown] = useState(() => (first ? Math.min(target, 1) : target));
  useEffect(() => {
    if (shown > target) {
      setShown(target);
      return;
    }
    if (shown === target) return;
    const t = setTimeout(() => {
      setShown((n) => n + 1);
      cue("step");
    }, STEP_GAP_MS);
    return () => clearTimeout(t);
  }, [shown, target]);

  useEffect(() => {
    if (first) cue("whoosh");
  }, [first]);

  // `tick` when "N to go" goes down and some are still to go (the last one ticks the step)
  const toGo = useRef(steps.toGo);
  useEffect(() => {
    const was = toGo.current;
    toGo.current = steps.toGo;
    if (was != null && steps.toGo != null && steps.toGo < was && steps.toGo > 0) cue("tick");
  }, [steps.toGo]);

  const ticker = view.token?.symbol ?? "";
  return (
    <Move kind="slideUp" style={{ flex: 1 }}>
      <Scene name="launching" motion="kenBurns" height={SCENE_H}>
        <View style={{ flex: 1, paddingTop: insets.top + 12, paddingHorizontal: S.gutter, paddingBottom: 10, justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View
              style={{
                flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: CHIP,
                borderRadius: R.pill, paddingVertical: 4, paddingLeft: 4, paddingRight: 12,
              }}
            >
              <CoinImage uri={view.token?.image} size={28} ticker={ticker} />
              <T v="num" style={{ fontSize: 14 }}>{ticker ? `$${ticker}` : "Presale"}</T>
            </View>
            <T v="label" color={C.text0}>Launching on Meteora</T>
          </View>
          <ChatLines channel={view.presale} />
        </View>
        <FloatingEmojis channel={view.presale} />
      </Scene>
      <View style={{ flex: 1, paddingHorizontal: S.gutter, paddingTop: 12, gap: 12 }}>
        <Card style={{ gap: 12 }}>
          {steps.steps.map((s, i) => (
            <Move key={i} kind="rise" delay={i * 90}>
              <StepRow label={s.label} state={i < shown ? "done" : i === shown && !steps.failed ? "now" : "todo"} />
            </Move>
          ))}
        </Card>
      </View>
      <View style={{ paddingHorizontal: S.gutter, paddingBottom: insets.bottom + 16, gap: 12 }}>
        <Host line={HOST_LINE} sound={!quietHost && isArmed()} />
        <Button kind="quiet" title="Close" onPress={onClose} />
      </View>
    </Move>
  );
}

/** A step's state as a screen reader says it. */
const STATE_SAID = { done: "done", now: "in progress", todo: "to do" };

/** A step: a tick that pops in when done, a spinner while it's the one going on, else a dot. */
function StepRow({ label, state }) {
  const color = state === "todo" ? C.text2 : C.text0;
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${STATE_SAID[state]}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 24 }}
    >
      <View style={{ width: 20, alignItems: "center" }}>
        {state === "done" ? (
          <Move kind="pop">
            <CheckIcon color={C.up} size={16} />
          </Move>
        ) : state === "now" ? (
          <ActivityIndicator size="small" color={C.text1} />
        ) : (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.lineStrong }} />
        )}
      </View>
      <T v="body" color={color} style={{ flex: 1, fontFamily: state === "now" ? F.medium : F.regular }}>{label}</T>
    </View>
  );
}
```

- [ ] **Step 4: Live**

Create `mobile/src/room/MomentLive.js`:

```js
// Live: the live scene lifts into place, LIVE ON METEORA pops, the ticker stamps, and your
// tokens' card rises with the amount from the chain (set, not counted up). The crowd that
// launched it. Trade opens the coin page once the snipe tax is over; Share the win shares it.
// Shown again (the room back in front), it opens settled and quiet.
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { store } from "../app";
import { positionOf } from "../launched/coin";
import { lockEnds, secondsTo } from "../launched/trade";
import { CoinImage } from "../ui/CoinImage";
import { Face } from "../ui/Face";
import { solText } from "../ui/format";
import { CheckIcon } from "../ui/icons";
import { Button, Card, T } from "../ui/kit";
import { Move } from "../ui/motion";
import { Scene } from "../ui/Scene";
import { isArmed, nextScreen, play } from "../ui/sound";
import { useNow } from "../ui/useNow";
import { C, F, R, S } from "../ui/theme";
import { Crowd } from "./Crowd";
import { FloatingEmojis } from "./FloatingEmojis";

const SCENE_H = 360;
/** When the ticker stamps and your tokens' card rises (ms after the screen opens). */
const STAMP_AT = 1100;
const CARD_AT = 1400;
/** The moment's own cues stay quiet until the app is touched (a room opened by a link). */
const cue = (name) => {
  if (isArmed()) play(name);
};

/** Its children moving in (Move), or already in place when `settled`. */
function In({ settled, style, children, ...move }) {
  if (settled) return <View style={style}>{children}</View>;
  return (
    <Move {...move} style={style}>
      {children}
    </Move>
  );
}

/** `commit`: what this wallet put in (lamports, BigInt) or null. `claimed`: its tokens arrived.
 *  `again`: this screen showed before (the room is back in front): no liftoff, stamp or
 *  coins, and what moved in shows in place; tokens that arrive after it opens still rise in
 *  with `coins`. Read once, as it opens. */
export function MomentLive({ view, launched, who, wallet, claimed, commit, again, onShare, onClose }) {
  const insets = useSafeAreaInsets();
  const [settled] = useState(() => !!again);
  // your tokens' card shown already: in place and quiet
  const [cardSettled] = useState(() => !!again && claimed);
  const now = useNow(1000);
  const mint = launched?.mint;
  const holding = useStore(store, (s) => (mint ? s.holdings[mint] : undefined));
  const seenAt = useStore(store, (s) => (mint ? s.launchSeen[mint] : undefined));
  // this wallet's balance of the coin, while this screen is up
  useEffect(() => (mint ? store.getState().watchCoin(mint) : undefined), [mint]);

  const opened = useRef(Date.now());
  useEffect(() => {
    if (settled) return;
    cue("liftoff");
    const t = setTimeout(() => cue("stamp"), STAMP_AT);
    return () => clearTimeout(t);
  }, [settled]);
  useEffect(() => {
    if (!claimed || cardSettled) return;
    const t = setTimeout(() => cue("coins"), Math.max(0, opened.current + CARD_AT - Date.now()));
    return () => clearTimeout(t);
  }, [claimed, cardSettled]);

  const ticker = view.token?.symbol ?? "";
  const amount = positionOf(holding)?.tokens;
  const secs = secondsTo(lockEnds(launched, seenAt), now);
  const trade = () => {
    onClose();
    nextScreen("whoosh");
    router.push(`/coin/${view.presale}`);
  };

  return (
    <View style={{ flex: 1 }}>
      <Scene name="live" motion={settled ? "still" : "lift"} height={SCENE_H}>
        <View style={{ flex: 1, paddingTop: insets.top + 28, alignItems: "center", gap: 14 }}>
          <In settled={settled} kind="pop" delay={600}>
            <View style={{ backgroundColor: C.up, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 4 }}>
              <T style={{ fontFamily: F.bold, fontSize: 12, letterSpacing: 1.2 }} color={C.bg0}>LIVE ON METEORA</T>
            </View>
          </In>
          <In settled={settled} kind="pop" delay={300}>
            <CoinImage uri={view.token?.image} size={88} ticker={ticker} />
          </In>
          <In settled={settled} kind="stamp" delay={STAMP_AT}>
            <T style={{ fontFamily: F.bold, fontSize: 40 }}>{ticker ? `$${ticker}` : "Live"}</T>
          </In>
        </View>
        <FloatingEmojis channel={view.presale} />
      </Scene>
      <ScrollView contentContainerStyle={{ paddingHorizontal: S.gutter, paddingTop: 4, gap: 12 }}>
        {claimed ? (
          <In settled={cardSettled} kind="rise" delay={CARD_AT}>
            <View
              style={{
                flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                borderRadius: 12, borderWidth: 1, borderColor: `${C.gold}73`, backgroundColor: C.goldSoft,
              }}
            >
              <Face wallet={wallet} size={36} ring={C.gold} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <CheckIcon color={C.gold} />
                  <T v="body" color={C.gold} style={{ fontFamily: F.semi }}>
                    {commit != null ? `Your tokens arrived · for ${solText(commit)} SOL` : "Your tokens arrived"}
                  </T>
                </View>
                {amount ? <T v="num" style={{ fontSize: 20 }}>{`${amount} $${ticker}`}</T> : null}
              </View>
            </View>
          </In>
        ) : null}
        <In settled={settled} kind="rise" delay={CARD_AT + 150}>
          <Card style={{ gap: 12, paddingHorizontal: 8 }}>
            <T v="label" style={{ paddingHorizontal: 6 }}>Launched by</T>
            <Crowd who={who} me={wallet} />
          </Card>
        </In>
      </ScrollView>
      <View style={{ paddingHorizontal: S.gutter, paddingTop: 10, paddingBottom: insets.bottom + 16, gap: 10 }}>
        <Button kind="up" title={secs > 0 ? `Trade in ${secs} s` : "Trade"} disabled={!launched || secs > 0} onPress={trade} />
        {onShare ? <Button kind="quiet" title="Share the win" onPress={onShare} /> : null}
        <Button kind="quiet" title="Close" onPress={onClose} />
      </View>
    </View>
  );
}
```

- [ ] **Step 5: The room plays the moment instead of the overlay**

In `mobile/app/presale/[key].js`:

1. Replace `import { LaunchOverlay } from "../../src/room/LaunchOverlay";` with `import { LaunchMoment, useMoment } from "../../src/room/LaunchMoment";`.
2. Replace

```js
  const claimed = claimedOf(detail, wallet, locked ?? (stillIn(mineEntry) ? 1n : null));
```

with

```js
  const claimed = claimedOf(detail, wallet, locked ?? (stillIn(mineEntry) ? 1n : null));
  const moment = useMoment({ view, launched, ready });
  const momentOn = moment.phase != null && moment.phase !== "done";
```

3. Replace `<FloatingEmojis channel={key} on={focused && !chatOpen} />` with `<FloatingEmojis channel={key} on={focused && !chatOpen && !momentOn} />`.
4. Replace

```js
      <LaunchOverlay view={view} launched={launched} seat={seat} claimed={claimed} ready={ready} focused={focused} />
```

with

```js
      <LaunchMoment
        moment={moment}
        view={view}
        detail={detail}
        launched={launched}
        who={who}
        seat={seat}
        commit={locked}
        claimed={claimed}
        focused={focused}
        wallet={wallet}
        N={info.N}
        onShare={shareText ? onShare : null}
      />
```

- [ ] **Step 6: Delete the overlay and the ring**

```bash
git rm mobile/src/room/LaunchOverlay.js mobile/src/ui/Ring.js
```

Run: `grep -rn "LaunchOverlay\|ui/Ring" mobile/app mobile/src mobile/test`
Expected: no output.

- [ ] **Step 7: Run the phone suite and the bundle check**

Run: `cd mobile && npm test`
Expected: `# pass 276`, `# fail 0` (no new tests: the screens are checked on the Seeker).

Run: `cd mobile && npm run bundle:check`
Expected: it prints `web3.js copies: 1; files from engine/node_modules: 0` and exits 0.

- [ ] **Step 8: Build for the Seeker and check the moments**

Nothing native changed, so no prebuild. Run from the repo root:

```bash
(cd mobile && ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh)
```

Expected: the release build installs on the Seeker. If the install fails on a signature mismatch, stop and tell the user (never `adb uninstall`).

The phone runs on mainnet only, so this needs a mainnet presale that fills while its room is open on the Seeker. Ask the user to fill one (the 0.5 SOL testing pool); don't spend from any wallet yourself. With the room open as it fills:
- POOL FULL stamps with `stamp` and `poolfull`; the coin pops; `$TICKER` and "X / X SOL · N wallets" rise; the crowd rises with a tick on each face;
- 3, 2, 1 pop in one after another, each with `count` and a heavy buzz; GO in green with `go`; "Launching on Meteora" rises; the host's line types with no `host` sound;
- the launching screen slides up with `whoosh`; the scene zooms out slowly; the coin chip and the room's last chat lines sit over it; "Pool full" is ticked;
- "Meteora pool created" and then "One buy, one price for everyone" tick one after the other, each with `step` (right after the slide if they landed during the 3-2-1); "Sending everyone their tokens · N to go" counts down with `tick`;
- a chat line with emojis sent from another device floats them over the launching scene;
- once your tokens arrive (or, without a seat, every seat is served), the live screen: the scene lifts in with `liftoff`; LIVE ON METEORA pops; `$TICKER` stamps with `stamp`; with a seat, the gold "Your tokens arrived · for X SOL" card rises with `coins` and your token amount (if the amount doesn't show, report it: the balance is read once, when the live screen opens); "Launched by" shows the crowd;
- Trade reads "Trade in N s" until the snipe tax ends, then opens the coin page with `whoosh`; Share the win opens Android's share sheet; Close shows the room;
- leave the room and open it again while it's still launching: it opens on the launching screen with the done steps ticked, with no POOL FULL and no countdown.

A failed launch can't be made on purpose on mainnet; the failed screen is checked by reading `MomentFailed` against spec §4.4. Say so in the report.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/room/LaunchMoment.js mobile/src/room/MomentFull.js mobile/src/room/MomentLaunching.js mobile/src/room/MomentLive.js "mobile/app/presale/[key].js"
git commit -m "mobile: the launch moments on real presale state: POOL FULL with its stamp, the crowd ticked and a 3-2-1 with a buzz per count; launching sliding up with its zooming scene, the chat and the four steps ticking with step and tick; live lifting in with LIVE ON METEORA, the ticker's stamp, your tokens' card and the crowd, Trade once the snipe tax ends and Share the win; failed on the room's scene. LaunchOverlay and Ring are gone" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The coin page and the trade sheet: Bought with coins, quote values rising in (phone)

**Files:**
- Modify: `mobile/src/launched/TradeSheet.js`
- Modify: `mobile/app/coin/[key].js`

The coin page keeps its layout (spec §5). The trade sheet already shows You get, At least, Price impact and Fee. What changes: a quote arriving plays `tick` and its values rise in; a confirmed buy plays `coins`, and the page's "Bought about X $TICKER" card rises in; your position card rises in when it first shows. Sells stay quiet apart from the haptic (the cue table gives `coins` to a buy only).

- [ ] **Step 1: `tick` when a quote arrives, `coins` when a buy lands**

In `mobile/src/launched/TradeSheet.js`:

1. After `import { Button, PillButton, Sheet, Steps, T } from "../ui/kit";` add:

```js
import { Move } from "../ui/motion";
import { play } from "../ui/sound";
```

2. Replace

```js
    store.getState().preview(side, mint, a).then((r) => n === asked.current && setPriced({ amount: a, ...r }));
```

with

```js
    store.getState().preview(side, mint, a).then((r) => {
      if (n !== asked.current) return;
      setPriced({ amount: a, ...r });
      if (r.ok) play("tick");
    });
```

3. Replace

```js
    if (!r.ok) return setError(r.error);
    const got = r.value.quote.outAmount;
```

with

```js
    if (!r.ok) return setError(r.error);
    if (buying) play("coins");
    const got = r.value.quote.outAmount;
```

4. Replace the whole `Line` function

```js
/** A label on the left, its value on the right. */
function Line({ label, value, color }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <T v="small">{label}</T>
      <T v="num" color={color} style={{ flexShrink: 1, textAlign: "right" }}>{value}</T>
    </View>
  );
}
```

with

```js
/** A label on the left, its value on the right. A new value rises in; "…" (waiting) doesn't. */
function Line({ label, value, color }) {
  const text = <T v="num" color={color} style={{ textAlign: "right" }}>{value}</T>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <T v="small">{label}</T>
      {value === "…" ? (
        <View style={{ flexShrink: 1 }}>{text}</View>
      ) : (
        <Move kind="rise" key={value} style={{ flexShrink: 1 }}>
          {text}
        </Move>
      )}
    </View>
  );
}
```

- [ ] **Step 2: The coin page's cards rise in**

In `mobile/app/coin/[key].js`:

1. After `import { TopBar } from "../../src/ui/TopBar";` add `import { Move } from "../../src/ui/motion";`.
2. Replace

```js
          {done ? (
            <View accessibilityLiveRegion="polite">
              <Card>
                <T color={C.up}>{done}</T>
              </Card>
            </View>
          ) : null}
          {position ? (
            <Card style={{ gap: 6 }}>
              <T v="label">{`Your $${token.symbol}`}</T>
              <T v="num">{position.tokens}</T>
              {position.sol ? <T v="small">{position.usd ? `${position.sol} · ${position.usd}` : position.sol}</T> : null}
              {position.sol && atMigration(row.pool) ? <T v="small" color={C.text2}>At migration</T> : null}
            </Card>
          ) : null}
```

with

```js
          {done ? (
            <Move kind="rise" key={done}>
              <View accessibilityLiveRegion="polite">
                <Card>
                  <T color={C.up}>{done}</T>
                </Card>
              </View>
            </Move>
          ) : null}
          {position ? (
            <Move kind="rise">
              <Card style={{ gap: 6 }}>
                <T v="label">{`Your $${token.symbol}`}</T>
                <T v="num">{position.tokens}</T>
                {position.sol ? <T v="small">{position.usd ? `${position.sol} · ${position.usd}` : position.sol}</T> : null}
                {position.sol && atMigration(row.pool) ? <T v="small" color={C.text2}>At migration</T> : null}
              </Card>
            </Move>
          ) : null}
```

`Move` runs once when it mounts: the position card rises when it first shows, not when its numbers change; a new "Bought" text (a new `key`) rises again.

- [ ] **Step 3: Run the phone suite and the bundle check**

Run: `cd mobile && npm test`
Expected: `# pass 276`, `# fail 0` (no new tests: these are sounds and moves, checked on the Seeker).

Run: `cd mobile && npm run bundle:check`
Expected: it prints `web3.js copies: 1; files from engine/node_modules: 0` and exits 0.

- [ ] **Step 4: Build for the Seeker and check a buy**

Nothing native changed, so no prebuild:

```bash
(cd mobile && ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh)
```

Expected: the release build installs on the Seeker. If the install fails on a signature mismatch, stop and tell the user (never `adb uninstall`).

On a live coin's page:
- opening Buy plays `sheet`; each chip tap brings a new quote, and its You get, At least, Price impact and Fee values rise in with one `tick`;
- a buy is real money on mainnet: ask the user to make a small one and watch; don't press Buy yourself. When it lands: one `coins`, the sheet closes, and the "Bought about X $TICKER" card rises in. If the user doesn't make one, say this check wasn't done;
- your position card rises in the first time it shows, and not again when its numbers change.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/launched/TradeSheet.js "mobile/app/coin/[key].js"
git commit -m "mobile: the trade sheet ticks when a quote arrives and its values rise in; a confirmed buy plays coins and its Bought card rises in; the position card rises in once" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Check everything together (phone)

**Files:** none changed, unless a check fails (then fix it in the task it belongs to, and run this again).

- [ ] **Step 1: The suites**

Run: `cd engine && npm test`
Expected: `# pass 491`, `# fail 0`.

Run: `cd mobile && npm test`
Expected: `# pass 276`, `# fail 0`.

Run: `cd mobile && npm run bundle:check`
Expected: it prints `web3.js copies: 1; files from engine/node_modules: 0` and exits 0.

- [ ] **Step 2: Nothing left from the old screens**

Run: `grep -rn "LaunchOverlay\|ui/Ring\|liveList\|launchedList\|CoinRow\|WhoIsIn\|(tabs)/launched" mobile/app mobile/src mobile/test`
Expected: no output.

- [ ] **Step 3: A clean build, and its permissions**

Run from the repo root:

```bash
(cd mobile && CI=1 npx expo prebuild --platform android --clean --no-install)
(cd mobile && ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh)
find mobile/android/app/build/outputs/apk -name "*.apk"
/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0/aapt2 dump permissions <the apk the find printed>
```

Expected: the app installs on the Seeker. The permission dump lists neither `android.permission.RECORD_AUDIO` nor `android.permission.FOREGROUND_SERVICE` nor `FOREGROUND_SERVICE_MEDIA_PLAYBACK`. If the install fails on a signature mismatch, stop and tell the user (never `adb uninstall`).

- [ ] **Step 4: The whole app on the Seeker, against the spec**

Go through each line and note pass or fail; anything not checked is reported as not checked, never as passed.
- Cold start: no sound until the first touch; the tabs read Pulse · Create · Me.
- Pulse: three lanes with their counts; swiping or tapping a lane plays `tap` and nothing else plays on Pulse (chat lines, joins, new cards are silent); new cards fade in once.
- A presale card opens its room with `whoosh`; a market card opens its coin page with `tap`; back plays `tap`.
- The room (Task 10's list): scene, chat strip, pool cells, crowd, seat card, host typing with `host`, Invite, chat button, Get my X SOL back.
- Chat: the emoji row, `emoji` on a pick, inline and large emojis, floats with `chat`, at most one `chat` every 400 ms when several lines land together.
- Sheets: `sheet` on open, lower on close.
- Reduce motion on (Android Settings → Accessibility): every entrance is a fade, the scenes hold still, floating emojis fade in place.
- Me: the Sounds switch silences everything and stays off after a restart.
- The launch, recorded: ask the user to fill a mainnet presale (the 0.5 SOL testing pool) while its room is open on the Seeker, and screen-record it with sound (`adb shell screenrecord` records no audio, so the user records with the phone's own recorder). Check Task 12's list against the recording, and compare it with the approved demo (`docs/superpowers/2026-10-05-mooner-launch-terminal-cozy.mp4`): the same order of screens and sounds, on real state.

- [ ] **Step 5: Report**

Tell the user, in a few plain lines: the three suite counts, the permission result, which device checks passed, and which weren't done and why. No commit unless a fix was made.

---

### Task 15: Bring the spec in line with the plan

**Files:**
- Modify: `docs/superpowers/specs/2026-10-05-mooner-terminal-cozy-ui-design.md`

The plan's "Notes against the spec" list what was decided while planning. The spec says what was built, so it changes to match.

- [ ] **Step 1: Make the edits**

Run from the repo root (each old text must be found exactly once, or the script stops and changes nothing):

```bash
python3 - <<'EOF'
p = "docs/superpowers/specs/2026-10-05-mooner-terminal-cozy-ui-design.md"
s = open(p).read()
edits = [
    ("**Status:** approved in conversation, spec under review",
     "**Status:** approved (\"go\", 2026-10-05). Plans: `docs/superpowers/plans/2026-10-05-mooner-ui-shared-phone.md` (shared code and the phone), `docs/superpowers/plans/2026-10-05-mooner-ui-web.md` (the website)"),
    ("  - text over a scene gets a dark veil (a gradient to `bg-0`), not a text shadow.",
     "  - text over a scene gets a dark veil, not a text shadow: `bg-0` at 60% at the top (under the top row) fading out a fifth of the way down, clear through the middle, and `bg-0` at the bottom."),
    ("  - the host (`host.png`) speaks in a bubble on those three screens and in the room's chat as \"Mooner\".",
     "  - the host (`host.png`) speaks in a bubble on those three screens. Its lines stay in the bubble; they aren't added to the chat."),
    ("  - **Migrated:** coins with `pool.migrated`, newest migration first.",
     "  - **Migrated:** coins with `pool.migrated`, newest launch first (`launch.at`): `launched` rows carry no migration time."),
    ("  - market cards: market cap, curve bar, change.",
     "  - market cards: market cap and curve bar. No change figure: the `launched` feed has no price history, and a socket watches at most 4 coins."),
    ("4. **Who's in:** a grid of PFPs with each wallet's SOL, then \"+N\".",
     "4. **Who's in:** a grid of PFPs with each wallet's SOL, then \"+N\" (not tappable)."),
    ("5. **Your seat,** in gold: your PFP, \"Your seat · X SOL\", ≈ tokens.",
     "5. **Your seat,** in gold: your PFP and \"Your seat · X SOL\". No ≈ tokens: the engine has no shared curve estimate (the web's `allocationFor` uses web-only constants); the real amount shows on the live screen."),
    ("6. The host's line, Invite, the chat button, and \"Get my X SOL back\".",
     "6. The host's line, Invite (with a seat; without one, Share is a round button over the scene), the chat button, and \"Get my X SOL back\"."),
    ("- An emoji row sits above the input. Tapping an emoji inserts `:name:`.",
     "- An emoji row sits above the input. Tapping an emoji adds `:name:` at the end of the message, not at the cursor."),
    ("This is the one new case in `momentStep`, which today starts nothing on first sight.",
     "This is the one new case in `momentStep`, which today starts nothing on first sight. On the phone, `momentScreen` (`room.js`) picks the screen from the phase, whether the moment started late, whether the 3-2-1 has finished, whether every step is done, and whether your tokens arrived."),
    ("- **Pulse is quiet.** On Pulse only `tap` plays. That covers its global chat on the web.",
     "- **Pulse is quiet.** On Pulse only `tap` plays. That covers its global chat on the web.\n- **Screen sounds on the phone** come from the route: `whoosh` into a room (`/presale/…`), `tap` into any other screen, and live's Trade whooshes into the coin page. Nothing plays before the first touch, so opening the app or a link is quiet."),
    ("**On Pulse, the interface only fades.** That covers new cards, a card leaving its lane, and lane counts.",
     "**On Pulse, the interface only fades.** That covers new cards and lane counts, and on the web a card leaving its lane. On the phone a card leaving its lane just goes: core `Animated` can't animate an unmount without a library."),
    ("  - `npm run bundle:check`, then a dev build on the Seeker;\n  - a devnet-sized presale run through pool full to live, screen-recorded with sound;",
     "  - `npm run bundle:check`, then a release build on the Seeker (the JS is bundled in; no Metro);\n  - the phone runs on mainnet only, so a mainnet presale (the 0.5 SOL testing pool), filled by the user, is run through pool full to live, screen-recorded with sound;"),
]
for old, new in edits:
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"found {n} times, nothing changed: {old[:70]}")
for old, new in edits:
    s = s.replace(old, new)
open(p, "w").write(s)
print(f"{len(edits)} edits")
EOF
```

Expected: `13 edits`.

- [ ] **Step 2: Read the changed lines once**

Run: `git diff --stat docs/superpowers/specs/2026-10-05-mooner-terminal-cozy-ui-design.md`
Expected: `1 file changed`, about 14 lines in and 13 out.

Run: `git diff docs/superpowers/specs/2026-10-05-mooner-terminal-cozy-ui-design.md`
Expected: only the 13 edits above; each sentence still reads on its own.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-05-mooner-terminal-cozy-ui-design.md
git commit -m "docs: the UI spec matches what plan 1 builds: the scene's veil, the host's lines in its bubble only, Migrated by newest launch, no change on market cards, no ≈ tokens on the seat, Share without a seat, +N not tappable, emojis added at the end, momentScreen, screen sounds by route, Pulse cards that leave don't fade on the phone, the mainnet release-build test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
