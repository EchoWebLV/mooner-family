# Mooner phone: five screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pulse, Create and Me get a picture header and the approved layout A; Ranks and Chat come to the phone as pushed screens; the lanes become Filling · Live · Mooned; Ranks and Me run on the server's real XP rows.

**Architecture:** One shared look (glass buttons over the existing `Scene`, title tags, chip rows) used by five screens. Pure logic (XP rows, levels, room chips, the unread dot, the Me tab label) lives in plain files with Node tests. XP comes from piece 6 (`docs/superpowers/plans/2026-10-01-mooner-seeker-xp-genesis.md`): its server tasks run on a branch of their own (`feat/xp-server`, in a worktree) and merge in at the end; its phone tasks run here.

**Tech Stack:** Expo SDK 55, React Native 0.83, expo-router 55, zustand 5, react-native-svg, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-10-07-mooner-five-screens-design.md`. **Mockup:** `docs/superpowers/2026-10-07-mooner-five-screens.png`.

---

## Ground rules

- **Branch:** the phone track works on `feat/mooner-wireframe` in the main tree. The server track works on `feat/xp-server` in `../mooner-xp-server` (a worktree made after Task 1), and is merged into `feat/mooner-wireframe` in Task 13.
- **Commit by name only:** `git commit -m "…" -- <files>`. The tree has other people's changes: never `git add -A`, never `git commit -a`. Leave these alone and never commit them: `mobile/app.json`, `mobile/app/_layout.js`, `mobile/package.json`, `mobile/package-lock.json`, `mobile/src/ui/format.js`, `mobile/src/boot.js`, `mobile/src/ui/BootLog.js`, `mobile/test/boot.test.mjs`, `mobile/assets/splash.png`, `.gitignore`, everything under `docs/superpowers/` except this plan and the spec.
- **`mobile/src/store.js` already has one uncommitted hunk** (`loadInfo` added to the final `set({ … })`). The first task that commits `store.js` (Task 6) commits it too; that's fine, it's harmless (the boot screen reads it). Say so in that commit's body.
- **`grouped` in `format.js` is exported only in the uncommitted tree.** Don't import it. XP numbers use `xpNum` (Task 3).
- **No servers, no deploys, no `adb uninstall`.** Deploying the server is the user's step.
- **Real data only, pushed, never polled:** every number on screen comes from the store; no timers that re-read anything.
- **Calm, not gamey:** Pulse only fades and taps. Elsewhere things rise or pop in once and the host types. No count-ups, bursts or bumps.
- **Copy:** plain words. Names are short wallets (`shortWallet`); your own row reads "you".
- **Every commit ends with** a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Test counts:** before each task run `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'` (or `cd engine && npm test …` for engine tasks), note `# tests` as BEFORE, and check the end count is BEFORE plus the tests the task adds, with `# fail 0`. At the time of writing: mobile 297, engine 491.
- **Parse check** for screens (run from `mobile/`):

```bash
node -e 'const b = require("@babel/core"); const fs = require("fs"); for (const f of process.argv.slice(1)) b.parseSync(fs.readFileSync(f, "utf8"), { filename: f, sourceType: "module", configFile: false, babelrc: false, presets: ["@babel/preset-react"] }); console.log("parsed", process.argv.length - 1, "files")' <files>
```

## File map

| File | What it does |
| --- | --- |
| `engine/src/xp.js` (new, Task 1; Task 2 appends) | Shared XP rules: titles, curve, points, streak |
| `mobile/src/xp/rows.js` (new, Task 3) | XP rows as the phone shows them: merge, titles, boards, `xpText`, `xpNum` |
| `mobile/src/xp/look.js` (new, Task 4) | Roman levels, tag text and colours, the next-level bar, podium colours |
| `mobile/src/ui/icons.js` (Task 4) | + Trophy, Settings, Info, Copy, Crown |
| `mobile/src/ui/Glass.js` (new, Task 4) | `Glass` button, `GlassPill`, `BackGlass`, `SceneHeader` |
| `mobile/src/ui/TitleTag.js` (new, Task 4) | The "KOL II" pill |
| `mobile/src/ui/ChipRow.js` (new, Task 4) | A row of choice chips (Chat rooms, Ranks boards) |
| `mobile/src/me.js` (Task 5) | + `meTab` |
| `mobile/app/(tabs)/_layout.js` (Task 5) | Me tab shows face + SOL |
| `mobile/src/store.js` (Tasks 6, 10) | global chat, `chatSeen`, `seeChat`, `watchChat`; XP rows, `profilesLoaded`, `checkGenesis` |
| `mobile/src/chat/rooms.js` (new, Task 6) | `roomsOf`, `unreadOf` |
| `mobile/src/room/ChatPane.js` (new, Task 7) | `useComposer`, `ChatPane` (list + composer) |
| `mobile/src/room/ChatSheet.js` (Task 7) | uses `ChatPane` |
| `mobile/app/chat.js` (new, Task 7) | the Chat screen |
| `mobile/app/(tabs)/index.js` (Task 8) | Pulse: scene header, stat, segmented lanes |
| `mobile/app/(tabs)/create.js` (Task 9) | Create: scene, host, step bar |
| `mobile/app/ranks.js` (new, Task 11) | the Ranks screen |
| `mobile/src/xp/XpCard.js` (new, Task 12) | Me's XP card with the Genesis row |
| `mobile/app/(tabs)/me.js` (Task 12) | Me: scene, you, boxes, XP, your launches, settings sheet |

## Order

Phone track, one task at a time: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13.

Server track, after Task 1 is committed, in `../mooner-xp-server`: S2 → S3 → S4 → S5 → S6 → S7 → S8. It can run while the phone track runs (different files, different tree). Task 13 waits for both.

---

## Phone track

### Task 1: Shared XP rules (piece 6 Task 1)

**As written** in `docs/superpowers/plans/2026-10-01-mooner-seeker-xp-genesis.md`, lines 123–273 (Task 1). Its base check (`0a584e5`, `7f975f7`) passes on this branch.

- [ ] Follow that task's steps 0–5 exactly. Commit subject starts `engine: shared XP rules`.

### Task 2: The streak in the shared rules (piece 6 Task 12)

**As written**, lines 3265–3361 (Task 12).

- [ ] Follow that task's steps 0–5 exactly. Commit subject starts `engine: the streak as screens show it`.

### Task 3: XP rows as the phone shows them (piece 6 Task 13, changed)

Piece 6 Task 13 (lines 3362–3601), with these changes:

1. `boardOf` returns `{ wallet, rank, xp, title, level, mine }` instead of `badge`:
   - Overall: `const main = mainTitleOf(r)`; `title = main?.title ?? null`, `level = main?.level ?? null`.
   - A title's board: `title = board`, `level = levelOf(xp)`.
2. Add, above `xpText`:

```js
/** 1150 as "1,150": thousands by hand (Hermes' Intl may be missing). */
export const xpNum = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");
```

   and `xpText` becomes `export const xpText = (n) => \`${xpNum(n)} XP\`;`.
3. The test file imports `xpNum` too, and three tests change:
   - "XP reads with thousands grouped" adds `assert.equal(xpNum(1234567), "1,234,567");` and `assert.equal(xpNum(950), "950");`.
   - The Overall test's badge lines become:

```js
  assert.deepEqual([b[0].title, b[0].level], ["kol", 2]);
  assert.deepEqual([b[1].title, b[1].level], ["raider", 3]);
  assert.deepEqual([b[3].title, b[3].level], [null, null], "no title XP: no title tag");
```

   and its test name says "the tag is the main title and its level" instead of "the badge is the main title's level".
   - The title's board test becomes:

```js
test("a title's board: by that title's XP, ties by wallet, that title and its level as the tag", () => {
  const rows = { A: row("A", { kol: 25 }), B: row("B", { kol: 300, dev: 800 }), C: row("C", { dev: 900 }), D: row("D", { kol: 25 }) };
  const b = boardOf(rows, "kol", null);
  assert.deepEqual(b.map((r) => [r.wallet, r.xp, r.title, r.level]), [["B", 300, "kol", 3], ["A", 25, "kol", 1], ["D", 25, "kol", 1]]);
  assert.ok(b.every((r) => r.mine === false), "no wallet connected: nothing is yours");
  assert.deepEqual(boardOf({}, "dev", "A"), []);
});
```

4. `boardOf`'s doc comment: `Each: { wallet, rank, xp, title, level, mine }. On Overall the title is the main title (null with no title XP) and its level; on a title's board, that title and its level.`

- [ ] Steps 0–5 of that task with the changes above. Still 9 tests. Commit subject starts `mobile: XP rows as the phone shows them`.

### Task 4: The shared look

**Files:**
- Modify: `mobile/src/ui/icons.js` (5 icons appended; the header comment names them)
- Create: `mobile/src/xp/look.js`, `mobile/src/ui/Glass.js`, `mobile/src/ui/TitleTag.js`, `mobile/src/ui/ChipRow.js`
- Test: `mobile/test/look.test.mjs` (new, 4 tests)

- [ ] **Step 1: Write the failing test.** Create `mobile/test/look.test.mjs`:

```js
// The look's pure parts (src/xp/look.js): Roman levels, the tag's words and colour, the bar to
// the next level, the podium's rings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVEL_XP, TITLES } from "../../engine/src/xp.js";
import { C } from "../src/ui/theme.js";
import { PODIUM, TAG_NAMES, TITLE_COLORS, nextLevelOf, roman, tagText } from "../src/xp/look.js";

test("levels in Roman numerals, I to V", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(roman), ["I", "II", "III", "IV", "V"]);
  assert.equal(roman(LEVEL_XP.length), "V", "the top level has a numeral");
});

test("a tag reads the short title and its level, in the title's colour", () => {
  assert.deepEqual(Object.keys(TAG_NAMES), TITLES);
  assert.deepEqual(Object.keys(TITLE_COLORS), TITLES);
  assert.equal(tagText("kol", 2), "KOL II");
  assert.equal(tagText("diamond", 5), "Diamond V");
  assert.deepEqual(TITLE_COLORS, { dev: C.up, kol: C.accent, raider: C.down, diamond: C.migrated });
});

test("the bar to the next level: XP over the next level's start; at the top, Max", () => {
  assert.deepEqual(nextLevelOf(0), { level: 1, to: 100, left: 100, max: false, fill: 0 });
  assert.deepEqual(nextLevelOf(1240), { level: 4, to: 2000, left: 760, max: false, fill: 0.62 });
  assert.deepEqual(nextLevelOf(300), { level: 3, to: 800, left: 500, max: false, fill: 0.375 });
  assert.deepEqual(nextLevelOf(2000), { level: 5, to: null, left: 0, max: true, fill: 1 });
  assert.deepEqual(nextLevelOf(9999), { level: 5, to: null, left: 0, max: true, fill: 1 });
});

test("the podium: gold, silver, bronze", () => {
  assert.equal(PODIUM[1], C.gold);
  assert.equal(PODIUM[2], "#c9ced8");
  assert.equal(PODIUM[3], "#d08b5b");
});
```

- [ ] **Step 2: Run it to see it fail.** `cd mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/look.test.mjs 2>&1 | grep -E '^# (pass|fail)|Cannot find module'` → `Cannot find module` naming `src/xp/look.js`.

- [ ] **Step 3: Write `mobile/src/xp/look.js`.**

```js
// How XP looks on the phone: levels as Roman numerals, a title's tag ("KOL II") and colour,
// the bar to the next level, the podium's rings. The curve is engine/src/xp.js's. Pure, so
// Node tests it.
import { LEVEL_XP, levelOf } from "../../../engine/src/xp.js";
import { C } from "../ui/theme.js";

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** 1 -> "I" ... 5 -> "V". */
export const roman = (n) => NUMERALS[n - 1] ?? String(n);

/** A title's short name on a tag. */
export const TAG_NAMES = { dev: "Dev", kol: "KOL", raider: "Raider", diamond: "Diamond" };

/** Each title's colour. */
export const TITLE_COLORS = { dev: C.up, kol: C.accent, raider: C.down, diamond: C.migrated };

/** "KOL II". */
export const tagText = (title, level) => `${TAG_NAMES[title]} ${roman(level)}`;

/** The bar from `xp` to the next level: { level, to, left, max, fill }. `fill` (0..1) is xp
 *  over the next level's start, as "1,240 / 2,000 XP" reads. At the top level: max, fill 1. */
export function nextLevelOf(xp) {
  const level = levelOf(xp);
  if (level >= LEVEL_XP.length) return { level, to: null, left: 0, max: true, fill: 1 };
  const to = LEVEL_XP[level];
  return { level, to, left: to - xp, max: false, fill: xp / to };
}

/** The podium's rings: 1 gold, 2 silver, 3 bronze. */
export const PODIUM = { 1: C.gold, 2: "#c9ced8", 3: "#d08b5b" };
```

- [ ] **Step 4: Run it to see it pass.** Same command → `# pass 4`, `# fail 0`.

- [ ] **Step 5: Append the icons** to `mobile/src/ui/icons.js`, and change its header comment's list to "(back, chat, share, tick, padlock, send, trophy, settings, info, copy, crown)":

```js

/** A cup on a stand: the ranks. */
export function TrophyIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 21 H16 M12 17 V21 M7 4 H17 V9 C17 11.8 14.8 14 12 14 C9.2 14 7 11.8 7 9 Z" stroke={color} {...STROKE} />
      <Path d="M7 6 H5 C3.9 6 3 6.9 3 8 C3 9.7 4.3 11 6 11 H7.3 M17 6 H19 C20.1 6 21 6.9 21 8 C21 9.7 19.7 11 18 11 H16.7" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A gear: settings. */
export function SettingsIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"
        stroke={color}
        {...STROKE}
      />
      <Circle cx={12} cy={12} r={3} stroke={color} {...STROKE} />
    </Svg>
  );
}

/** An i in a circle: how it works. */
export function InfoIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} stroke={color} {...STROKE} />
      <Path d="M12 11 V16 M12 8 V8.01" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** Two sheets, one over the other: copy. */
export function CopyIcon({ color, size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={8} y={8} width={12} height={12} rx={2} stroke={color} {...STROKE} />
      <Path d="M16 8 V6 C16 4.9 15.1 4 14 4 H6 C4.9 4 4 4.9 4 6 V14 C4 15.1 4.9 16 6 16 H8" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A crown: first place. Filled, so it reads at a small size. */
export function CrownIcon({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 18 L3 7 L8.5 11 L12 5 L15.5 11 L21 7 L20 18 Z" fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </Svg>
  );
}
```

- [ ] **Step 6: Write `mobile/src/ui/Glass.js`.**

```js
// The picture header's pieces: round glass buttons over a scene, a glass pill, and the
// scene header itself (a Scene with the status bar's room, a 56 pt row with the title, and
// room under it for the screen's own things).
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { BackIcon } from "./icons";
import { T } from "./kit";
import { Scene } from "./Scene";
import { goBack } from "./TopBar";
import { C, F, R, S } from "./theme";

const GLASS = "#07080b8c";
const GLASS_RIM = "#ffffff24";

/** A 38 pt round glass button: `children` is its 20 pt icon, `label` what a screen reader
 *  says. `dot` puts a small green dot on it (something new). A haptic tick, no sound. */
export function Glass({ label, onPress, children, dot = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dot ? `${label}, new` : label}
      hitSlop={6}
      onPress={(e) => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      style={({ pressed }) => [
        {
          width: 38, height: 38, borderRadius: 19, backgroundColor: GLASS, borderWidth: 1, borderColor: GLASS_RIM,
          alignItems: "center", justifyContent: "center",
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      {children}
      {dot ? (
        <View
          style={{
            position: "absolute", top: 6, right: 7, width: 10, height: 10, borderRadius: 5,
            backgroundColor: C.up, borderWidth: 2, borderColor: C.bg1,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/** Back where the user came from (`fallback` when there's nothing to go back to). */
export function BackGlass({ fallback = "/(tabs)" }) {
  return (
    <Glass label="Back" onPress={() => goBack(fallback)}>
      <BackIcon color={C.text0} size={20} />
    </Glass>
  );
}

/** A small glass pill with mono text ("1 / 4"). */
export function GlassPill({ text, label }) {
  return (
    <View
      accessible
      accessibilityLabel={label ?? text}
      style={{
        height: 30, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: GLASS, borderWidth: 1, borderColor: GLASS_RIM,
        alignItems: "center", justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: F.mono, fontSize: 13, color: C.text0 }}>{text}</Text>
    </View>
  );
}

/** A screen's picture header: the Scene `name` at `height` (the status bar's room included),
 *  a 56 pt row with `left`, the title and `right` (one element or several, 10 pt apart),
 *  then `children` in the room left under the row. */
export function SceneHeader({ name, height, title, left, right, motion = "still", children }) {
  return (
    <Scene name={name} height={height} motion={motion}>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View style={{ height: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: S.gutter }}>
          {left ?? null}
          <T v="title" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>{title}</T>
          {right ? <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>{right}</View> : null}
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaView>
    </Scene>
  );
}
```

- [ ] **Step 7: Write `mobile/src/ui/TitleTag.js`.**

```js
// A title's tag: "KOL II" in the title's colour on a soft fill of it.
import { Text, View } from "react-native";
import { TITLE_COLORS, tagText } from "../xp/look";
import { F, R } from "./theme";

/** Nothing without a title (a wallet with no title XP). */
export function TitleTag({ title, level }) {
  if (!title) return null;
  const color = TITLE_COLORS[title];
  return (
    <View style={{ flexDirection: "row" }}>
      <View style={{ borderRadius: R.pill, backgroundColor: `${color}1f`, paddingHorizontal: 7, paddingVertical: 2 }}>
        <Text style={{ fontFamily: F.semi, fontSize: 11, color }}>{tagText(title, level)}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 8: Write `mobile/src/ui/ChipRow.js`.**

```js
// A row of choice chips that scrolls sideways (Chat's rooms, Ranks' boards). The chosen one
// is a white pill. A change plays a tap.
import { Pressable, ScrollView, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { CoinImage } from "./CoinImage";
import { play } from "./sound";
import { C, F, R, S } from "./theme";

/** `items`: [{ key, label, image? }]; `value`: the chosen key; `onPick(key)`. An item with
 *  `image` shows its coin picture (18 pt) before the label. */
export function ChipRow({ items, value, onPick }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: S.gutter, paddingVertical: 10, gap: 8 }}
      style={{ flexGrow: 0 }}
    >
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.label}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync().catch(() => {});
              play("tap");
              onPick(it.key);
            }}
            style={({ pressed }) => [
              {
                height: 34, paddingHorizontal: 14, borderRadius: R.pill, flexDirection: "row", alignItems: "center", gap: 6,
                backgroundColor: on ? C.text0 : C.bg2, borderWidth: 1, borderColor: on ? C.text0 : C.lineStrong,
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            {it.image !== undefined ? <CoinImage uri={it.image} size={18} ticker={it.label.replace(/^\$/, "")} /> : null}
            <Text style={{ fontFamily: F.semi, fontSize: 14, color: on ? C.bg0 : C.text1 }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
```

- [ ] **Step 9: Check.** From `mobile/`: the parse check with `src/ui/icons.js src/ui/Glass.js src/ui/TitleTag.js src/ui/ChipRow.js src/xp/look.js` → `parsed 5 files`. `npm test` → BEFORE + 4, `# fail 0`. `grep -nE '\b(100|300|800|2000)\b' src/xp/look.js` → no output.

- [ ] **Step 10: Commit.**

```bash
git commit -m "mobile: the five screens' shared look: glass buttons and the scene header over a Scene, the title tag (KOL II), a chip row, five icons, and the pure parts (Roman levels, tag colours, the bar to the next level, podium rings)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- mobile/src/ui/icons.js mobile/src/ui/Glass.js mobile/src/ui/TitleTag.js mobile/src/ui/ChipRow.js mobile/src/xp/look.js mobile/test/look.test.mjs
```

(New files need `git add` first: `git add mobile/src/ui/Glass.js mobile/src/ui/TitleTag.js mobile/src/ui/ChipRow.js mobile/src/xp/look.js mobile/test/look.test.mjs`.)

### Task 5: The Me tab shows your face and SOL

**Files:**
- Modify: `mobile/src/me.js` (append `meTab`), `mobile/app/(tabs)/_layout.js`
- Test: `mobile/test/me.test.mjs` (1 test appended)

- [ ] **Step 1: Failing test.** Add `meTab` to the import in `mobile/test/me.test.mjs` and append:

```js

test("meTab: your face and SOL once both are known, else the Me icon and Me", () => {
  assert.deepEqual(meTab(ME, 2410000000), { face: ME, label: "2.41 SOL", mono: true });
  assert.deepEqual(meTab(ME, 0), { face: ME, label: "0 SOL", mono: true });
  assert.deepEqual(meTab(ME, null), { face: null, label: "Me", mono: false }, "balance not in yet");
  assert.deepEqual(meTab(null, 5), { face: null, label: "Me", mono: false }, "no wallet");
});
```

- [ ] **Step 2:** `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/me.test.mjs` fails (`meTab` not exported). (The store keeps `lamports` as a Number; `solText(0)` is `"0"`, `solText(2410000000)` is `"2.41"`.)

- [ ] **Step 3: Append to `mobile/src/me.js`:**

```js

/** The Me tab: your face and SOL ("2.41 SOL", mono) once the wallet and its balance are both
 *  known; else the Me icon and "Me". */
export function meTab(wallet, lamports) {
  if (!wallet || lamports == null) return { face: null, label: "Me", mono: false };
  return { face: wallet, label: `${solText(lamports)} SOL`, mono: true };
}
```

- [ ] **Step 4: The tabs.** In `mobile/app/(tabs)/_layout.js`: import `{ Text }` from react-native, `{ useStore }` from zustand, `{ store }` from `../../src/app`, `{ meTab }` from `../../src/me`, `{ Face }` from `../../src/ui/Face`. Add:

```js
/** Me's icon: your face once your SOL is known, else the outline. */
function MeTabIcon({ color }) {
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  const tab = meTab(wallet, lamports);
  return tab.face ? <Face wallet={tab.face} size={24} /> : <MeIcon color={color} />;
}

/** Me's label: your SOL in mono, else "Me". */
function MeTabLabel({ color }) {
  const wallet = useStore(store, (s) => s.wallet);
  const lamports = useStore(store, (s) => s.lamports);
  const tab = meTab(wallet, lamports);
  return (
    <Text numberOfLines={1} style={{ fontFamily: tab.mono ? F.mono : F.medium, fontSize: tab.mono ? 11 : 12, color }}>
      {tab.label}
    </Text>
  );
}
```

and the Me screen becomes:

```js
      <Tabs.Screen
        name="me"
        options={{
          title: "Me",
          tabBarAccessibilityLabel: "Me",
          tabBarIcon: ({ color }) => <MeTabIcon color={color} />,
          tabBarLabel: ({ color }) => <MeTabLabel color={color} />,
        }}
      />
```

Update the file's header comment: "Me (your face and SOL on its tab once known)".

- [ ] **Step 5: Check.** Parse check on `"app/(tabs)/_layout.js" src/me.js` → `parsed 2 files`. `npm test` → BEFORE + 1.

- [ ] **Step 6: Commit** `-- mobile/src/me.js mobile/test/me.test.mjs "mobile/app/(tabs)/_layout.js"` with subject `mobile: the Me tab shows your face and SOL once both are known, else the Me icon`.

### Task 6: Global chat in the store; room chips and the unread dot

**Files:**
- Modify: `mobile/src/store.js` (state `chatSeen`; `start()` subscribes `chat:global`; `seeChat`; `watchChat`; the final `set`)
- Create: `mobile/src/chat/rooms.js`
- Test: `mobile/test/store.test.mjs` (2 tests changed, 2 appended), `mobile/test/rooms.test.mjs` (new, 3 tests)

- [ ] **Step 1: Failing tests.**

In `mobile/test/store.test.mjs`:
- the "start: listens to the public topics…" test's list becomes `["presales", "launched", "profiles", "sol", "chat:global"]`;
- the "start twice shares nothing…" test's let-go list becomes `["presales", "launched", "profiles", "sol", "chat:global"]`.

Append:

```js

test("global chat: kept for the app's run; seeChat marks its newest line seen", () => {
  const { store, push } = rig();
  const stop = store.getState().start();
  push("chat:global", "snapshot", [{ id: 4, text: "gm" }]);
  push("chat:global", "message", { id: 9, text: "wagmi" });
  assert.deepEqual(store.getState().chats.global.map((r) => r.id), [4, 9]);
  assert.equal(store.getState().chatSeen, 0);
  store.getState().seeChat();
  assert.equal(store.getState().chatSeen, 9);
  push("chat:global", "message", { id: 12, text: "lfg" });
  assert.equal(store.getState().chatSeen, 9, "only seeChat moves it");
  store.getState().seeChat();
  store.getState().seeChat();
  assert.equal(store.getState().chatSeen, 12);
  stop();
});

test("watchChat: a presale room's chat while Chat shows it; global needs none", () => {
  const { store, push, listening } = rig();
  const off = store.getState().watchChat("K");
  assert.ok(listening("chat:K"));
  push("chat:K", "message", { id: 1, text: "hi" });
  assert.deepEqual(store.getState().chats.K.map((r) => r.id), [1]);
  const room = store.getState().watch("K"); // the room open too: each lets go of its own
  off();
  assert.ok(listening("chat:K"), "the room still listens");
  room();
  assert.equal(listening("chat:K"), false);
  const none = store.getState().watchChat("global");
  assert.equal(listening("chat:global"), false, "start() owns global");
  none();
});
```

Create `mobile/test/rooms.test.mjs`:

```js
// Chat's rooms (src/chat/rooms.js): Everyone, then each of your presales whose coin is known;
// and the dot for a global line that came live since Everyone was last shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomsOf, unreadOf } from "../src/chat/rooms.js";

const ME = "HgZ9KPJhH9aQ7NG7k7xrxzTJkP7LkBZygRTnBGZQ5u8D";
const K1 = "11111111111111111111111111111111";
const K2 = "So11111111111111111111111111111111111111112";
const token = (symbol, image = `https://x.test/${symbol}.png`) => ({ symbol, image });
const state = (over = {}) => ({ wallet: ME, presales: {}, views: {}, launched: {}, mine: {}, ...over });

test("rooms: Everyone first, then your presales with a known coin, in your list's order", () => {
  const s = state({
    mine: { [K1]: { deposit: "1", at: 1 }, [K2]: { deposit: "1", at: 2 } },
    presales: { [K1]: { presale: K1, users: [{ user: ME }], token: token("MOON") } },
  });
  assert.deepEqual(roomsOf(s), [
    { channel: "global", label: "Everyone" },
    { channel: K1, label: "$MOON", image: "https://x.test/MOON.png" },
  ], "K2's coin isn't known: no room for it yet");
});

test("rooms: no wallet, Everyone only; a coin without a picture keeps its chip", () => {
  assert.deepEqual(roomsOf(state({ wallet: null, mine: { [K1]: { deposit: "1", at: 1 } } })), [{ channel: "global", label: "Everyone" }]);
  const s = state({ mine: { [K1]: { deposit: "1", at: 1 } }, launched: { [K1]: { presale: K1, token: token("PIC", null) } } });
  assert.deepEqual(roomsOf(s)[1], { channel: K1, label: "$PIC", image: null });
});

test("unread: a live line newer than the one last seen", () => {
  assert.equal(unreadOf(undefined, 0), false);
  assert.equal(unreadOf([{ id: 3 }, { id: 4 }], 0), false, "the snapshot's lines aren't news");
  assert.equal(unreadOf([{ id: 3 }, { id: 5, live: true }], 4), true);
  assert.equal(unreadOf([{ id: 3 }, { id: 5, live: true }], 5), false);
});
```

- [ ] **Step 2:** run both files: the store's 4 tests and the new file fail.

- [ ] **Step 3: `mobile/src/chat/rooms.js`.**

```js
// Chat's rooms and the unread dot, from the store's state. Pure, so Node tests it.
import { tokenOf } from "../me.js";
import { myPresales } from "../store.js";

/** [{ channel, label, image? }]: Everyone (the server's `global` channel), then one room per
 *  presale you're in or were in whose coin is known ($TICKER and its picture), in
 *  myPresales' order. */
export function roomsOf(s) {
  const rooms = [{ channel: "global", label: "Everyone" }];
  for (const key of myPresales(s)) {
    const token = tokenOf({ ...s, key });
    if (token) rooms.push({ channel: key, label: `$${token.symbol}`, image: token.image ?? null });
  }
  return rooms;
}

/** Whether `rows` (a channel's lines, oldest first) has a line pushed live after the line
 *  `seen` (an id). The snapshot's lines never count. */
export const unreadOf = (rows, seen) => (rows ?? []).some((r) => r.live && r.id > seen);
```

- [ ] **Step 4: `mobile/src/store.js`.** Four blocks:

After `    chats: {}, // channel -> rows, oldest first` add:

```js
    chatSeen: 0, // the newest global chat line's id when Chat last showed Everyone (the unread dot)
```

In `start()`, after `          live.subscribe("sol", onSol),` add:

```js
          // the global chat, for the whole run: Chat's Everyone room and Pulse's unread dot
          live.subscribe("chat:global", onChat("global")),
```

After the `watch(key)` function add:

```js

  /** A chat room while Chat shows it: a presale key's chat. `global` is start()'s for the
   *  whole run, so it needs nothing here. Returns off(). */
  function watchChat(channel) {
    if (channel === "global") return () => {};
    return live.subscribe(`chat:${channel}`, onChat(channel));
  }

  /** Chat shows Everyone: every global line so far is seen. */
  function seeChat() {
    const rows = get().chats.global;
    const last = rows?.length ? rows[rows.length - 1].id : 0;
    if (last > get().chatSeen) set({ chatSeen: last });
  }
```

In the final `set({ … })`, add `watchChat, seeChat` after `watchCoin,`. (The line also has the uncommitted `loadInfo`: keep it.)

Update `start()`'s doc comment: "The public topics (and the global chat), for the whole app."

- [ ] **Step 5:** `npm test` → BEFORE + 5, `# fail 0`.

- [ ] **Step 6: Commit** `-- mobile/src/store.js mobile/src/chat/rooms.js mobile/test/store.test.mjs mobile/test/rooms.test.mjs`, subject `mobile: the store keeps the global chat for the app's run, with seeChat for the unread dot and watchChat for a presale room; Chat's rooms (Everyone, then your presales' coins)`, and in the body: `It also commits the store's loadInfo export, which was already in the tree for the boot screen.`

### Task 7: The chat pane, and the Chat screen

**Files:**
- Create: `mobile/src/room/ChatPane.js`, `mobile/app/chat.js`
- Modify: `mobile/src/room/ChatSheet.js` (uses the pane; looks and works as before)

- [ ] **Step 1: `mobile/src/room/ChatPane.js`.** Move the composer's state and the list out of `ChatSheet` without changing what they do:

```js
// A chat room's lines and its composer, shared by the room's sheet (ChatSheet) and the Chat
// screen. The composer's state lives in useComposer, which its owner calls outside any Sheet,
// so a typed line survives the sheet closing.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import { CHAT_MAX, codePoints } from "../../../engine/src/emoji.js";
import { useStore } from "zustand";
import { store } from "../app";
import { Face } from "../ui/Face";
import { shortWallet } from "../ui/format";
import { SendIcon } from "../ui/icons";
import { Button, T } from "../ui/kit";
import { play } from "../ui/sound";
import { TitleTag } from "../ui/TitleTag";
import { C, F, R } from "../ui/theme";
import { mainTitleOf } from "../xp/rows";
import { typedChat } from "./chat";
import { ChatText } from "./ChatText";
import { EmojiRow } from "./EmojiRow";
import { hhmm } from "./room";

const EMPTY = [];

/** The composer for `channel`: { text, setText, sending, signing, error, send, pick, canSend }.
 *  The first send signs in (one message in the wallet). A new channel clears the error. */
export function useComposer(channel, signer) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState(null);
  // `sending` is state, so it lags a render: two fast sends would both see false and both
  // ask the wallet to sign in. This one holds from the first tap.
  const inFlight = useRef(false);
  useEffect(() => setError(null), [channel]);

  async function send() {
    const body = text.trim();
    if (!body || inFlight.current || !signer) return;
    inFlight.current = true;
    try {
      const s = store.getState().session;
      setSigning(!s || s.exp <= Date.now());
      setSending(true);
      setError(null);
      const r = await store.getState().sendChat(channel, body, signer);
      if (r.ok) setText((t) => (t.trim() === body ? "" : t)); // keep anything typed meanwhile
      else setError(r.error);
    } finally {
      inFlight.current = false;
      setSending(false);
      setSigning(false);
    }
  }

  // an emoji goes on the end, when it fits in the server's 280 code points
  function pick(name) {
    const add = `:${name}:`;
    if (codePoints(text) + codePoints(add) > CHAT_MAX) return;
    setText(text + add);
    play("emoji");
  }

  const canSend = !sending && !!text.trim() && !!signer;
  return { text, setText, sending, signing, error, send, pick, canSend };
}

/** `channel`'s lines, newest at the bottom, live from the store, and the composer under them
 *  (`composer`: useComposer's). It fills its parent. `wallet`: the connected one, or null
 *  (then "Connect to chat", which calls `onConnect`). `faceSize`: each line's face. `tags`:
 *  each sender's title tag, once XP rows know them. */
export const ChatPane = memo(function ChatPane({ channel, wallet, composer, onConnect, faceSize = 24, tags = false }) {
  const rows = useStore(store, (s) => s.chats[channel]) ?? EMPTY;
  const newestFirst = useMemo(() => [...rows].reverse(), [rows]);
  const renderItem = useCallback(
    ({ item }) => <Row row={item} me={item.wallet === wallet} size={faceSize} tags={tags} />,
    [wallet, faceSize, tags],
  );
  const { text, setText, sending, signing, error, send, pick, canSend } = composer;
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        inverted
        style={{ flex: 1 }}
        data={newestFirst}
        keyExtractor={(r) => String(r.id)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical: 8 }}
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={
          <View style={{ paddingVertical: 32 }}>
            <T v="small" color={C.text2} style={{ textAlign: "center" }}>No messages yet.</T>
          </View>
        }
        keyboardShouldPersistTaps="handled"
      />
      <View style={{ paddingTop: 10, gap: 6 }}>
        {wallet ? <EmojiRow onPick={pick} disabled={sending} /> : null}
        {wallet ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <TextInput
              value={text}
              onChangeText={(t) => setText((prev) => typedChat(prev, t))}
              placeholder="Say something"
              placeholderTextColor={C.text2}
              returnKeyType="send"
              onSubmitEditing={send}
              style={{
                flex: 1, height: 44, paddingHorizontal: 16, borderRadius: R.pill, backgroundColor: C.well,
                borderWidth: 1, borderColor: C.wellLine, color: C.text0, fontFamily: F.regular, fontSize: 15,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={!canSend}
              onPress={send}
              style={({ pressed }) => [
                { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
                !canSend && { opacity: 0.45 },
                pressed && { opacity: 0.85 },
              ]}
            >
              {sending ? <ActivityIndicator size="small" color={C.accentInk} /> : <SendIcon color={C.accentInk} />}
            </Pressable>
          </View>
        ) : (
          <Button kind="quiet" title="Connect to chat" onPress={onConnect} />
        )}
        {signing ? <T v="small">Sign once to chat</T> : null}
        {error ? <T v="small" color={C.down}>{error}</T> : null}
      </View>
    </View>
  );
});

const Gap = () => <View style={{ height: 14 }} />;

function Row({ row, me, size, tags }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Face wallet={row.wallet} size={size} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T v="small" color={me ? C.gold : C.text1} style={{ fontFamily: F.medium }}>{shortWallet(row.wallet)}</T>
          {tags ? <SenderTag wallet={row.wallet} /> : null}
          <T v="small" color={C.text2}>{hhmm(row.at)}</T>
        </View>
        <ChatText text={row.text} />
      </View>
    </View>
  );
}

/** The sender's top title tag, once the store has their XP row. */
function SenderTag({ wallet }) {
  const row = useStore(store, (s) => s.xp?.[wallet]);
  const main = mainTitleOf(row);
  return main ? <TitleTag title={main.title} level={main.level} /> : null;
}
```

(`s.xp` arrives in Task 10; until then `s.xp?.[wallet]` is undefined and no tag shows.)

- [ ] **Step 2: `ChatSheet` uses the pane.** Replace the body of `mobile/src/room/ChatSheet.js` so it keeps its signature, its comment and its look:

```js
// The room's chat: slides up from the bottom, newest at the bottom, live from the socket.
import { memo, useCallback } from "react";
import { View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Sheet } from "../ui/kit";
import { ChatPane, useComposer } from "./ChatPane";

/** `channel`: the presale key; `wallet`: the connected wallet (base58) or null. Memo: the
 *  room re-renders every second for its clock, the chat needn't. */
export const ChatSheet = memo(function ChatSheet({ open, onClose, channel, wallet, signer }) {
  const { height } = useWindowDimensions();
  const composer = useComposer(channel, signer);
  const connect = useCallback(() => {
    onClose();
    router.push("/connect");
  }, [onClose]);
  return (
    <Sheet open={open} onClose={onClose} title="Chat">
      <View style={{ height: Math.round(height * 0.8) - 110, flexShrink: 1, minHeight: 160 }}>
        <ChatPane channel={channel} wallet={wallet} composer={composer} onConnect={connect} />
      </View>
    </Sheet>
  );
});
```

- [ ] **Step 3: `mobile/app/chat.js`.**

```js
// Chat: Everyone (the server's global channel) and a room for each of your presales whose
// coin is known. Showing Everyone clears Pulse's unread dot. `chat` plays for a new line, at
// most one every 400 ms, while this screen is in front.
import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { chatGate } from "../../engine/src/cues.js";
import { store } from "../src/app";
import { roomsOf } from "../src/chat/rooms";
import { ChatPane, useComposer } from "../src/room/ChatPane";
import { useNewLines } from "../src/room/useNewLines";
import { ChipRow } from "../src/ui/ChipRow";
import { BackGlass, SceneHeader } from "../src/ui/Glass";
import { play } from "../src/ui/sound";
import { C, S } from "../src/ui/theme";
import { useAppActive } from "../src/ui/useAppActive";
import { useSigner } from "../src/wallet";

export default function Chat() {
  const wallet = useStore(store, (s) => s.wallet);
  const presales = useStore(store, (s) => s.presales);
  const views = useStore(store, (s) => s.views);
  const launched = useStore(store, (s) => s.launched);
  const mine = useStore(store, (s) => s.mine);
  const globalRows = useStore(store, (s) => s.chats.global);
  const signer = useSigner();
  const insets = useSafeAreaInsets();
  const rooms = useMemo(() => roomsOf({ wallet, presales, views, launched, mine }), [wallet, presales, views, launched, mine]);
  const chips = useMemo(() => rooms.map((r) => ({ key: r.channel, label: r.label, image: r.image })), [rooms]);

  // a room that leaves the list (another wallet, a presale gone) falls back to Everyone
  const [picked, setPicked] = useState("global");
  const channel = rooms.some((r) => r.channel === picked) ? picked : "global";
  useEffect(() => store.getState().watchChat(channel), [channel]);

  const focused = useIsFocused();
  const active = useAppActive();
  const heard = focused && active;
  // Everyone in front: every line in it is seen
  useEffect(() => {
    if (channel === "global" && heard) store.getState().seeChat();
  }, [channel, heard, globalRows]);

  const [chatSound] = useState(() => chatGate());
  const onLine = useCallback(() => {
    if (heard && chatSound(Date.now())) play("chat");
  }, [heard, chatSound]);
  useNewLines(channel, onLine);

  const composer = useComposer(channel, signer);
  const connect = useCallback(() => router.push("/connect"), []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <SceneHeader name="room" height={150} title="Chat" left={<BackGlass />} />
      <ChipRow items={chips} value={channel} onPick={setPicked} />
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: S.gutter, paddingBottom: insets.bottom + 12 }}>
          <ChatPane channel={channel} wallet={wallet} composer={composer} onConnect={connect} faceSize={32} tags />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
```

Everyone has no picture: `ChipRow` draws a coin only for items whose `image` is not `undefined`. `roomsOf` gives Everyone no `image` key, so `r.image` is `undefined` for it. Keep it that way.

- [ ] **Step 4: Check.** Parse check on `src/room/ChatPane.js src/room/ChatSheet.js app/chat.js` → `parsed 3 files`. `npm test` → BEFORE, `# fail 0`. `npm run bundle:check` passes.

- [ ] **Step 5: Commit** `-- mobile/src/room/ChatPane.js mobile/src/room/ChatSheet.js mobile/app/chat.js` (add the new files first), subject `mobile: Chat as its own screen (Everyone and your presales' rooms, faces, title tags) on a chat pane the room's sheet shares, unchanged there`.

### Task 8: Pulse

**Files:** Modify `mobile/app/(tabs)/index.js`.

- [ ] **Step 1: The copy.** `LANES` becomes:

```js
const LANES = [
  { id: "new", title: "Filling", empty: "No pools filling right now", body: "New ones show up here the moment they open." },
  { id: "final", title: "Live", empty: "Nothing live yet", body: "Coins land here the moment their pool fills." },
  { id: "migrated", title: "Mooned", empty: "Nothing mooned yet", body: `Coins move here when their curve reaches ${GRAD_SOL} SOL.` },
];
```

The header comment: "Pulse: the room's picture with Ranks and Chat on it and the SOL filling the pools; then three lanes you swipe between (Filling, Live, Mooned)…". `marketItem`'s comment says "Live's or Mooned's renderItem". `Lane`'s comment says "(and, for Filling, the pool size)". The lane ids and `live/lanes.js` don't change.

- [ ] **Step 2: The header.** Delete `Header`. The returned tree becomes:

```js
  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <SceneHeader
        name="room"
        height={236}
        title="Pulse"
        right={[
          <Glass key="ranks" label="Ranks" onPress={openRanks}>
            <TrophyIcon color={C.text0} size={20} />
          </Glass>,
          <ChatGlass key="chat" />,
        ]}
      >
        <Stat count={bothLoaded ? pool.count : null} lamports={pool.lamports} />
      </SceneHeader>
      <LaneTabs lane={lane} counts={counts} onPick={goTo} />
      {/* the pager, exactly as it is today */}
    </View>
  );
```

and add, next to `openPresale`:

```js
const openRanks = () => router.push("/ranks");
const openChat = () => router.push("/chat");

/** Chat's glass button, with the dot while a global line came live since Everyone was last
 *  shown (store chatSeen). */
const ChatGlass = memo(function ChatGlass() {
  const unread = useStore(store, (s) => unreadOf(s.chats.global, s.chatSeen));
  return (
    <Glass label="Chat" onPress={openChat} dot={unread}>
      <ChatIcon color={C.text0} size={20} />
    </Glass>
  );
});

/** The SOL filling the pools, big and green, over "filling N pools right now", at the
 *  scene's bottom left. `count` null (the feeds aren't in yet): blank, keeping its height. */
const Stat = memo(function Stat({ count, lamports }) {
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: S.gutter, paddingBottom: 12 }}>
      {count == null ? (
        <View style={{ height: 52 }} />
      ) : (
        <View style={{ height: 52, justifyContent: "flex-end" }}>
          <T style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: -0.5, color: C.up }}>{`${solText(lamports)} SOL`}</T>
          <T v="small" numberOfLines={1}>{`filling ${count} pool${count === 1 ? "" : "s"} right now`}</T>
        </View>
      )}
    </View>
  );
});
```

Imports: add `SceneHeader, Glass` from `../../src/ui/Glass`, `TrophyIcon, ChatIcon` from `../../src/ui/icons`, `unreadOf` from `../../src/chat/rooms`; drop `PillButton` and `Screen` from the kit import. `wallet` stays (the cards use it); the header's own `lamports` read goes with `Header`.

- [ ] **Step 3: The segmented lanes.** `LaneTabs` becomes:

```js
/** The three lanes as one segmented control: the shown lane on a raised pill, its count in
 *  green. A new count fades in; a null count (its feeds not in yet) isn't drawn. */
const LaneTabs = memo(function LaneTabs({ lane, counts, onPick }) {
  return (
    <View
      style={{
        flexDirection: "row", marginHorizontal: S.gutter, marginTop: 12, padding: 3,
        backgroundColor: C.bg1, borderWidth: 1, borderColor: C.line, borderRadius: 12,
      }}
    >
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
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
              paddingVertical: 8, borderRadius: 9, backgroundColor: on ? C.bg3 : "transparent",
            }}
          >
            <T style={{ fontFamily: F.medium, fontSize: 14, color: on ? C.text0 : C.text2 }}>{l.title}</T>
            {n == null ? null : (
              <Move kind="fade" key={n}>
                <T style={{ fontFamily: F.mono, fontSize: 12, color: on ? C.up : C.text2, opacity: on ? 1 : 0.7 }}>{String(n)}</T>
              </Move>
            )}
          </Pressable>
        );
      })}
    </View>
  );
});
```

`LIST_PAD`'s `paddingTop` stays 12.

- [ ] **Step 4: Check.** Parse check on `"app/(tabs)/index.js"`; `npm test` → BEFORE; `npm run bundle:check`. `grep -n "New Pairs\|Final Stretch\|PillButton\|Connect" "app/(tabs)/index.js"` → no output.

- [ ] **Step 5: Commit** `-- "mobile/app/(tabs)/index.js"`, subject `mobile: Pulse on the room's picture: Ranks and Chat (with its unread dot) on glass, the SOL filling the pools over it, the lanes as Filling · Live · Mooned in a segmented control; no wallet SOL or Connect up top`.

### Task 9: Create

**Files:** Modify `mobile/app/(tabs)/create.js`.

- [ ] **Step 1: The scene and the host.** Replace `Header` and `TITLES` with:

```js
/** The step bar's names, one per STEPS entry. */
const STEP_NAMES = ["Picture", "Details", "Your seat", "Launch"];

/** What the host says on each step. */
const HOST_LINES = {
  picture: "Start with a picture. Square works best.",
  details: "Name it, and give it a ticker.",
  commit: "Pick your seat. You're the first one in.",
  review: "Last look. Then open the pool.",
};

/** The launching picture with "Create": Back (not while `locked`) past the first step, the
 *  step as "n / 4", and the host saying the step's line. Without `step` (signed out, loading):
 *  the picture and the title only. */
function CreateScene({ step, locked = false, onBack }) {
  const at = step ? STEPS.indexOf(step) : -1;
  const focused = useIsFocused();
  const active = useAppActive();
  return (
    <SceneHeader
      name="launching"
      height={210}
      motion="kenBurns"
      title="Create"
      left={at > 0 && !locked ? <Glass label="Back" onPress={onBack}><BackIcon color={C.text0} size={20} /></Glass> : null}
      right={step ? <GlassPill text={`${at + 1} / ${STEPS.length}`} label={`Step ${at + 1} of ${STEPS.length}`} /> : null}
    >
      {step ? (
        <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: S.gutter, paddingBottom: 10 }}>
          <View style={{ maxWidth: 300 }}>
            <Host line={HOST_LINES[step]} sound={focused && active && isArmed()} />
          </View>
        </View>
      ) : null}
    </SceneHeader>
  );
}

/** Four 4 pt segments under the picture, Picture · Details · Your seat · Launch: done and
 *  current in green, the current name in white. */
function StepBar({ at }) {
  return (
    <View
      accessible
      accessibilityLabel={`Step ${at + 1} of ${STEPS.length}: ${STEP_NAMES[at]}`}
      style={{ flexDirection: "row", gap: 6, paddingHorizontal: S.gutter, paddingTop: 4 }}
    >
      {STEP_NAMES.map((name, i) => (
        <View key={name} style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= at ? C.up : C.bg3 }} />
          <T numberOfLines={1} style={{ fontFamily: F.medium, fontSize: 11, color: i === at ? C.text0 : C.text2 }}>{name}</T>
        </View>
      ))}
    </View>
  );
}
```

Imports: add `useIsFocused` to the expo-router import; `useAppActive` from `../../src/ui/useAppActive`; `Host` from `../../src/ui/Host`; `Glass, GlassPill, SceneHeader` from `../../src/ui/Glass`; `isArmed` from `../../src/ui/sound`; `F` from the theme. Drop `Pressable` and `Screen` if nothing else uses them (`Pressable` isn't used elsewhere in this file; check with grep). `BackIcon` stays.

- [ ] **Step 2: `Create`'s signed-out and loading path:**

```js
  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <CreateScene />
      {account === undefined || wallet ? <Loading /> : <SignedOut />}
    </View>
  );
```

- [ ] **Step 3: `Creator`'s render:**

```js
  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <CreateScene step={step} locked={locked} onBack={back} />
          <StepBar at={at} />
          <View style={{ padding: S.gutter, gap: 16 }}>
            {showUnopened ? <Unopened tokens={unopened} onOpen={resume} /> : null}
            {body}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
```

The header comment of the file adds: "The launching picture sits on top with the host saying each step's line, and a step bar under it."

- [ ] **Step 4: Check.** Parse check on `"app/(tabs)/create.js"`; `npm test` → BEFORE; `npm run bundle:check`. `grep -n "TITLES\|Step \${at + 1} of" "app/(tabs)/create.js"` shows only the `StepBar`/`GlassPill` labels.

- [ ] **Step 5: Commit** `-- "mobile/app/(tabs)/create.js"`, subject `mobile: Create on the launching picture: the host says each step's line, Back and the step (n / 4) on glass, a step bar (Picture · Details · Your seat · Launch); the steps and their rules as they were`.

### Task 10: The store keeps XP rows; the Genesis check (piece 6 Task 14, changed)

Piece 6 Task 14 (lines 3602–3949), with these changes:

1. **Step 0:** drop the `engine: the server runs XP` check (the server track merges at the end; `api.xp` is missing until then and the store treats that as a failed read: `api.xp` is undefined, the call throws a TypeError inside `readXp`'s `try`, so `xpFailed` goes true). Drop the exact-line check of the final `set({ … })`: after Task 6 it reads `set({ start, loadInfo, watch, watchCoin, watchChat, seeChat, setWallet, …, forgetOpening });`. Check instead that `grep -c 'if (e.status === 401) {' mobile/src/store.js` is `1` and `git diff --quiet HEAD -- mobile/src/store.js mobile/test/store.test.mjs && echo clean` says `clean`.
2. **Step 3's fifth block** splits in two: (a) replace the 401 block inside `sendChat` and add `forgetSignIn`, `readXp`, `checkGenesis` after `sendChat`'s closing `}` as written; (b) in the final `set({ … })` line, as it is now, append `, checkGenesis` before ` });`.
3. **`profilesLoaded`:** add a state field after `xpFailed`:

```js
    profilesLoaded: false, // true from the profiles topic's first snapshot (Ranks: before it, a spinner)
```

   and the snapshot line in `onProfiles` becomes `if (m.type === "snapshot") set({ profiles: m.data ?? {}, profilesLoaded: true });`. Append one more test:

```js

test("profilesLoaded: from the pictures' first snapshot", () => {
  const { store, push } = rig();
  store.getState().start();
  assert.equal(store.getState().profilesLoaded, false);
  push("profiles", "upsert", { wallet: "Y", pfp: { skin: 2 } });
  assert.equal(store.getState().profilesLoaded, false, "an upsert isn't the snapshot");
  push("profiles", "snapshot", {});
  assert.equal(store.getState().profilesLoaded, true);
});
```

4. Test count: BEFORE + 9. Commit subject starts `mobile: the store keeps XP rows`.

### Task 11: Ranks

**Files:** Create `mobile/app/ranks.js`.

- [ ] **Step 1: Write the screen.**

```js
// Ranks: the server's XP rows as boards (Overall, then one per title). The top three stand on
// the live picture; the rest are rows under the board chips; yours is pinned at the bottom.
// Before the pictures' first snapshot, a spinner; after it, with no XP rows, "No ranks yet"
// (a server without XP never sends any).
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";
import { LEVEL_XP, POINTS } from "../../engine/src/xp.js";
import { store } from "../src/app";
import { ChipRow } from "../src/ui/ChipRow";
import { Face } from "../src/ui/Face";
import { shortWallet } from "../src/ui/format";
import { BackGlass, Glass, SceneHeader } from "../src/ui/Glass";
import { CrownIcon, InfoIcon } from "../src/ui/icons";
import { Empty, Sheet, T } from "../src/ui/kit";
import { Move } from "../src/ui/motion";
import { TitleTag } from "../src/ui/TitleTag";
import { C, F, R, S } from "../src/ui/theme";
import { PODIUM, TITLE_COLORS } from "../src/xp/look";
import { BOARDS, GENESIS_XP, TITLE_NAMES, boardOf, xpNum, xpText } from "../src/xp/rows";

const CHIPS = BOARDS.map((b) => ({ key: b.key, label: b.name }));

export default function Ranks() {
  const xp = useStore(store, (s) => s.xp);
  const xpLoaded = useStore(store, (s) => s.xpLoaded);
  const profilesLoaded = useStore(store, (s) => s.profilesLoaded);
  const wallet = useStore(store, (s) => s.wallet);
  const [board, setBoard] = useState("overall");
  const [info, setInfo] = useState(false);
  const rows = useMemo(() => boardOf(xp, board, wallet), [xp, board, wallet]);
  const ready = profilesLoaded && xpLoaded && Object.keys(xp).length > 0;
  const top = rows.slice(0, 3);
  const rest = useMemo(() => rows.slice(3), [rows]);
  const mine = rows.find((r) => r.mine) ?? null;

  let list;
  if (!profilesLoaded) {
    list = (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.text1} />
      </View>
    );
  } else if (!ready || rows.length === 0) {
    list = <Empty title="No ranks yet" body="XP comes from launches: open one, chip in, bring friends, hold." />;
  } else {
    list = (
      <FlatList
        data={rest}
        keyExtractor={(r) => r.wallet}
        renderItem={({ item }) => <RankRow row={item} />}
        contentContainerStyle={{ paddingBottom: 16 }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      <SceneHeader
        name="live"
        height={300}
        motion="lift"
        title="Ranks"
        left={<BackGlass />}
        right={
          <Glass label="How XP works" onPress={() => setInfo(true)}>
            <InfoIcon color={C.text0} size={20} />
          </Glass>
        }
      >
        {ready && top.length ? <Podium top={top} /> : null}
      </SceneHeader>
      {ready ? <ChipRow items={CHIPS} value={board} onPick={setBoard} /> : null}
      <View style={{ flex: 1 }}>{list}</View>
      {wallet && ready ? <MyRow wallet={wallet} row={mine} /> : null}
      <HowSheet open={info} onClose={() => setInfo(false)} />
    </View>
  );
}

/** The top three over the picture's bottom: #2 left, #1 raised in the middle, #3 right. It
 *  rises in once. */
function Podium({ top }) {
  const [first, second, third] = top;
  return (
    <Move kind="rise" style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 14, paddingBottom: 6 }}>
      <Spot row={second} place={2} />
      <Spot row={first} place={1} />
      <Spot row={third} place={3} />
    </Move>
  );
}

/** One podium place: the face in its ring (with a crown and a glow for #1), the place on a
 *  badge, the name and the XP. An empty place keeps its width. */
function Spot({ row, place }) {
  if (!row) return <View style={{ width: 96 }} />;
  const size = place === 1 ? 76 : 58;
  const ring = PODIUM[place];
  return (
    <View style={{ width: 96, alignItems: "center", marginBottom: place === 1 ? 14 : 0 }}>
      {place === 1 ? <CrownIcon color={C.gold} size={22} /> : null}
      <View style={{ width: size, height: size, marginTop: place === 1 ? 2 : 0 }}>
        {place === 1 ? (
          <View style={{ position: "absolute", top: -8, left: -8, right: -8, bottom: -8, borderRadius: (size + 16) / 2, backgroundColor: C.goldSoft }} />
        ) : null}
        <Face wallet={row.wallet} size={size} ring={ring} />
        <View
          style={{
            position: "absolute", bottom: -8, left: (size - 22) / 2, width: 22, height: 22, borderRadius: 11,
            backgroundColor: ring, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.bg0,
          }}
        >
          <T style={{ fontFamily: F.bold, fontSize: 11, color: C.bg0 }}>{String(place)}</T>
        </View>
      </View>
      <T numberOfLines={1} style={{ marginTop: 12, fontFamily: F.semi, fontSize: 13 }}>{row.mine ? "you" : shortWallet(row.wallet)}</T>
      <T style={{ fontFamily: F.mono, fontSize: 12, color: C.up }}>{xpText(row.xp)}</T>
    </View>
  );
}

/** A row from #4 down: rank, face, name, title tag, XP. */
function RankRow({ row }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, paddingHorizontal: S.gutter }}>
      <T style={{ fontFamily: F.mono, fontSize: 13, color: C.text2, minWidth: 30 }}>{`#${row.rank}`}</T>
      <Face wallet={row.wallet} size={34} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T numberOfLines={1} style={{ fontFamily: F.medium, fontSize: 15, flexShrink: 1 }}>{row.mine ? "you" : shortWallet(row.wallet)}</T>
        <TitleTag title={row.title} level={row.level} />
      </View>
      <T style={{ fontFamily: F.mono, fontSize: 14 }}>{xpNum(row.xp)}</T>
    </View>
  );
}

/** Your place on this board, pinned with the accent rim; off the board, how to get on it. */
function MyRow({ wallet, row }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: S.gutter, paddingTop: 8, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg0 }}>
      <View
        style={{
          flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 12,
          borderRadius: R.l, borderWidth: 1, borderColor: C.accent, backgroundColor: C.accentSoft,
        }}
      >
        {row ? <T style={{ fontFamily: F.mono, fontSize: 13, color: C.text0, minWidth: 30 }}>{`#${row.rank}`}</T> : null}
        <Face wallet={wallet} size={34} />
        {row ? (
          <>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T style={{ fontFamily: F.semi, fontSize: 15 }}>you</T>
              <TitleTag title={row.title} level={row.level} />
            </View>
            <T style={{ fontFamily: F.mono, fontSize: 14 }}>{xpNum(row.xp)}</T>
          </>
        ) : (
          <T v="small" color={C.text1} style={{ flex: 1 }}>Not ranked yet: chip in to a launch</T>
        )}
      </View>
    </View>
  );
}

/** What earns XP, read from the shared points table. */
const EARN = [
  { title: "dev", text: `Open a launch: +${xpText(POINTS.devLaunch.points)} when it launches, +${xpText(POINTS.devMigrate.points)} more when it moons` },
  { title: "kol", text: `Chip in to someone else's launch: +${xpText(POINTS.kolLaunch.points)}, +${xpText(POINTS.kolMigrate.points)} more when it moons` },
  { title: "raider", text: `+${xpText(POINTS.raiderJoin.points)} for each friend your link brings who chips in, once it launches` },
  { title: "diamond", text: `Still holding when it moons: +${xpText(POINTS.diamondMigrate.points)}` },
];

function HowSheet({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="How XP works">
      <View style={{ gap: 14 }}>
        {EARN.map((e) => (
          <View key={e.title} style={{ gap: 4 }}>
            <T style={{ fontFamily: F.semi, fontSize: 15, color: TITLE_COLORS[e.title] }}>{TITLE_NAMES[e.title]}</T>
            <T v="small">{e.text}</T>
          </View>
        ))}
        <View style={{ gap: 4 }}>
          <T style={{ fontFamily: F.semi, fontSize: 15, color: C.gold }}>Seeker Genesis</T>
          <T v="small">{`+${xpText(GENESIS_XP)} once, for a Seeker Genesis Token in your wallet`}</T>
        </View>
        <T v="small" color={C.text2}>{`Levels I to V start at ${LEVEL_XP.map(xpNum).join(", ")} XP.`}</T>
      </View>
    </Sheet>
  );
}
```

- [ ] **Step 2: Check.** Parse check on `app/ranks.js`; `npm test` → BEFORE; `npm run bundle:check`. `grep -nE '\b(25|50|100|200|250|300|800|2000)\b' app/ranks.js` → no output.

- [ ] **Step 3: Commit** `-- mobile/app/ranks.js` (add it first), subject `mobile: Ranks on the server's XP rows: the top three on the live picture, Overall and a board per title, rows with title tags, your place pinned, and how XP works from the shared points`.

### Task 12: Me

**Files:**
- Create: `mobile/src/xp/XpCard.js`
- Modify: `mobile/app/(tabs)/me.js`

- [ ] **Step 1: `mobile/src/xp/XpCard.js`.**

```js
// Me's XP card from your row (the store's `xp`): your top title and level, the streak, the bar
// to the next level, the four title tags, and the Seeker Genesis row (Check, or the mark).
import { useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useStore } from "zustand";
import { streakDays } from "../../../engine/src/xp.js";
import { store } from "../app";
import { CheckIcon } from "../ui/icons";
import { Button, Card, PillButton, Sheet, T } from "../ui/kit";
import { TitleTag } from "../ui/TitleTag";
import { C, F } from "../ui/theme";
import { useSigner } from "../wallet";
import { TITLE_COLORS, nextLevelOf, tagText } from "./look";
import { GENESIS_XP, mainTitleOf, titlesOf, xpNum, xpText } from "./rows";

/** `wallet`: the connected one. A spinner until its row is here (the read on connect, or a
 *  push); the server's rows are the only numbers shown. */
export function XpCard({ wallet }) {
  const row = useStore(store, (s) => s.xp[wallet]);
  const failed = useStore(store, (s) => s.xpFailed);
  const [passed, setPassed] = useState(false);
  let body;
  if (row) body = <Progress row={row} />;
  else if (failed) body = <T v="small" color={C.text2}>Couldn't read your XP right now.</T>;
  else body = <ActivityIndicator color={C.text1} style={{ alignSelf: "flex-start" }} />;
  return (
    <>
      <Card style={{ gap: 12 }}>
        {body}
        {row || failed ? <GenesisRow has={!!row?.genesis} onPassed={() => setPassed(true)} /> : null}
      </Card>
      {/* outside the card, so it stays up when the new row redraws the card */}
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

/** Your top title and level, the streak, the bar to the next level, the four tags. */
function Progress({ row }) {
  const main = mainTitleOf(row);
  if (!main) {
    if (!row.total) return <T v="small" color={C.text1}>No XP yet. Chip in to a launch to start.</T>;
    return (
      <>
        <T style={{ fontFamily: F.semi, fontSize: 22 }}>{xpText(row.total)}</T>
        <T v="small">Chip in to a launch to earn a title.</T>
        <Tags row={row} />
      </>
    );
  }
  const next = nextLevelOf(main.xp);
  const streak = streakDays(row.streak, Date.now());
  const color = TITLE_COLORS[main.title];
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T style={{ fontFamily: F.semi, fontSize: 22, color }}>{tagText(main.title, main.level)}</T>
        {streak > 0 ? <T v="small" color={C.text0}>{`🔥 ${streak} ${streak === 1 ? "day" : "days"}`}</T> : null}
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: C.bg3, overflow: "hidden" }}>
        <View style={{ width: `${Math.round(next.fill * 100)}%`, height: "100%", borderRadius: 4, backgroundColor: color }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <T v="small" style={{ fontFamily: F.mono }}>{next.max ? xpText(main.xp) : `${xpNum(main.xp)} / ${xpText(next.to)}`}</T>
        <T v="small">{next.max ? "Max level" : `${xpNum(next.left)} to ${tagText(main.title, next.level + 1)}`}</T>
      </View>
      <Tags row={row} />
    </>
  );
}

/** The four title tags; a title with no XP is dimmed. */
function Tags({ row }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {titlesOf(row).map((t) => (
        <View key={t.title} style={{ opacity: t.xp > 0 ? 1 : 0.35 }}>
          <TitleTag title={t.title} level={t.level} />
        </View>
      ))}
    </View>
  );
}

/** "Seeker Genesis": Check (the server reads the wallet's tokens and decides), or the mark
 *  once your row has it. The first pass calls `onPassed` (the sheet). */
function GenesisRow({ has, onPassed }) {
  const signer = useSigner();
  const signedIn = useStore(store, (s) => s.session != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
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
        if (r.fresh) onPassed();
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
    <View style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: 12, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: F.semi, fontSize: 15 }}>Seeker Genesis</T>
          <T v="small">
            {has
              ? "Your Mooner has the Seeker Genesis mark."
              : `Got a Seeker Genesis Token in this wallet? Check it once for the mark and +${xpText(GENESIS_XP)}.`}
          </T>
        </View>
        {has ? (
          <View
            accessible
            accessibilityLabel="Seeker Genesis mark"
            style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.goldSoft, alignItems: "center", justifyContent: "center" }}
          >
            <CheckIcon color={C.gold} size={16} />
          </View>
        ) : busy ? (
          <ActivityIndicator color={C.text1} />
        ) : (
          <PillButton title="Check" onPress={check} accessibilityLabel="Check this wallet for a Seeker Genesis Token" />
        )}
      </View>
      {!has && !signedIn ? <T v="small" color={C.text2}>Your wallet signs you in to Mooner first. No SOL moves.</T> : null}
      {error ? <T v="small" color={C.down}>{error}</T> : null}
    </View>
  );
}
```

- [ ] **Step 2: `mobile/app/(tabs)/me.js`.** The page becomes the scene with the gear, you (face, short wallet, copy), two boxes, the XP card and your launches; Sounds and Disconnect move to a settings sheet. Keep `signOut`, `Loading`, `SignedOut`'s connect flow, `PresaleRow`, `SoundsRow` and `PILL` as they are. Replace the rest:

```js
export default function Me() {
  const wallet = useStore(store, (s) => s.wallet);
  const account = useAccount();
  const { disconnect } = useWalletActions();
  const [leaving, setLeaving] = useState(false);
  const leavingNow = useRef(false); // set at once, so a second tap before the re-render does nothing
  const [settings, setSettings] = useState(false);

  // signOut: unchanged

  return (
    <View style={{ flex: 1, backgroundColor: C.bg0 }}>
      {wallet ? (
        <Wallet wallet={wallet} onSettings={() => setSettings(true)} />
      ) : (
        <>
          <SceneHeader name="live" height={150} motion="lift" title="Me" />
          {account === undefined || leaving ? <Loading /> : <SignedOut />}
        </>
      )}
      <Sheet open={settings && !!wallet} onClose={() => setSettings(false)} title="Settings">
        <View style={{ gap: 16 }}>
          <SoundsRow />
          <Button title="Disconnect" kind="quiet" busy={leaving} onPress={signOut} />
        </View>
      </Sheet>
    </View>
  );
}
```

`SignedOut`'s line becomes "Connect your wallet to see your launches"; it keeps the logo, Connect Seed Vault and `SoundsRow`.

```js
/** The wallet's page, all in one list so it scrolls: the scene with the gear, you, your
 *  balance and rank, your XP, then your launches. */
function Wallet({ wallet, onSettings }) {
  const presales = useStore(store, (s) => s.presales);
  const views = useStore(store, (s) => s.views);
  const launched = useStore(store, (s) => s.launched);
  const mine = useStore(store, (s) => s.mine);
  const presalesLoaded = useStore(store, (s) => s.loaded.presales);
  const launchedLoaded = useStore(store, (s) => s.loaded.launched);
  const ready = presalesLoaded && launchedLoaded;
  const rows = useMemo(() => rowsOf({ wallet, presales, views, launched, mine }), [wallet, presales, views, launched, mine]);
  const renderItem = useCallback(
    ({ item }) => (
      <View style={{ paddingHorizontal: S.gutter }}>
        <PresaleRow row={item} ready={ready} />
      </View>
    ),
    [ready],
  );
  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.key}
      renderItem={renderItem}
      contentContainerStyle={{ paddingBottom: 32 }}
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={
        <View>
          <SceneHeader
            name="live"
            height={150}
            motion="lift"
            title="Me"
            right={
              <Glass label="Settings" onPress={onSettings}>
                <SettingsIcon color={C.text0} size={20} />
              </Glass>
            }
          />
          <View style={{ paddingHorizontal: S.gutter, gap: 12 }}>
            <You wallet={wallet} />
            <Boxes wallet={wallet} />
            <XpCard wallet={wallet} />
            <T v="label" style={{ marginTop: 12, marginBottom: 0 }}>Your launches</T>
          </View>
          <View style={{ height: 12 }} />
        </View>
      }
      ListEmptyComponent={<Empty title="You're not in any launch yet" body="Chip in to one from Pulse." />}
    />
  );
}

/** Your face (92 pt, gold ring) over the scene's bottom edge, your short wallet and Copy. */
function You({ wallet }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 14, marginTop: -46 }}>
      <Face wallet={wallet} size={92} ring={C.gold} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 }}>
        <T v="num" style={{ fontSize: 17 }}>{shortWallet(wallet)}</T>
        <CopyButton text={wallet} label="Copy the wallet address" />
      </View>
    </View>
  );
}

/** Balance ("2.41 SOL", ≈ dollars when the price is known) and Rank on Overall ("#14", "of
 *  N"; "–" until the XP rows come; "Not ranked" without a row there). Rank opens Ranks. */
function Boxes({ wallet }) {
  const lamports = useStore(store, (s) => s.lamports);
  const solUsd = useStore(store, (s) => s.solUsd);
  const xp = useStore(store, (s) => s.xp);
  const xpLoaded = useStore(store, (s) => s.xpLoaded);
  const board = useMemo(() => boardOf(xp, "overall", wallet), [xp, wallet]);
  const mine = board.find((r) => r.mine);
  const known = lamports != null;
  let rank = "–";
  let of = null;
  if (xpLoaded) {
    rank = mine ? `#${mine.rank}` : "Not ranked";
    of = mine ? `of ${board.length}` : null;
  }
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <Card style={{ flex: 1, gap: 4 }}>
        <T v="label">Balance</T>
        <T style={{ fontFamily: F.mono, fontSize: 20 }}>{known ? `${solText(lamports)} SOL` : "–"}</T>
        {known && solUsd > 0 ? <T v="small">{`≈ ${usd((lamports / 1e9) * solUsd)}`}</T> : null}
      </Card>
      <Card style={{ flex: 1, gap: 4 }} onPress={() => router.push("/ranks")} accessibilityLabel={of ? `Rank ${rank} ${of}` : `Rank ${rank}`}>
        <T v="label">Rank</T>
        <T style={{ fontFamily: F.mono, fontSize: 20 }}>{rank}</T>
        {of ? <T v="small">{of}</T> : null}
      </Card>
    </View>
  );
}
```

The store keeps `lamports` as a Number (`set({ lamports: Number(m.data.lamports) })`), so `(lamports / 1e9) * solUsd` is the dollar value, as the old `Profile` had it.

`CopyButton` becomes an icon button: a 32 pt round `bg2` button with `CopyIcon` (16, `text1`); after a copy, `CheckIcon` (14, `up`) for `COPIED_MS`, and `accessibilityLabel` "Copied". The clipboard and timer code stay as they are.

Delete `Profile`. Imports: add `Sheet` to the kit import; `SceneHeader, Glass` from `../../src/ui/Glass`; `SettingsIcon, CopyIcon, CheckIcon` from `../../src/ui/icons`; `XpCard` from `../../src/xp/XpCard`; `boardOf` from `../../src/xp/rows`. Remove imports nothing uses any more (check each with grep). The header comment: "Me: the live picture with Settings (Sounds, Disconnect) on glass; your face, wallet and Copy; your balance and rank; your XP and the Seeker Genesis check; and your launches. With no wallet, the same Connect Seed Vault as the Connect screen."

- [ ] **Step 3: Check.** Parse check on `"app/(tabs)/me.js" src/xp/XpCard.js`; `npm test` → BEFORE; `npm run bundle:check`. `grep -nE '\b(250|100|300|800|2000)\b' src/xp/XpCard.js` → no output.

- [ ] **Step 4: Commit** `-- mobile/src/xp/XpCard.js "mobile/app/(tabs)/me.js"` (add the new file first), subject `mobile: Me on the live picture: your face over it, wallet and Copy, balance and rank boxes, the XP card (title and level, streak, the bar to the next level, title tags, Seeker Genesis), your launches; Sounds and Disconnect in a settings sheet`.

### Task 13: Merge the server, check everything, put it on the phone

- [ ] **Step 1:** In the main tree: `git merge --no-ff feat/xp-server -m "Merge feat/xp-server: the server runs XP (ledger, rules, routes, rows on profiles)"`. If git refuses because a dirty file would be overwritten, stop and report (the server track touches only `engine/`).
- [ ] **Step 2:** `cd engine && npm test 2>&1 | grep -E '^# (tests|fail)'` → `# fail 0`. `cd mobile && npm test 2>&1 | grep -E '^# (tests|fail)'` → `# fail 0`. `cd mobile && npm run bundle:check` passes.
- [ ] **Step 3:** Release build and install on the test phone (`SM02E4072816959`), signed with the user's key: `ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh mobile/scripts/run-android.sh` (never `adb uninstall`).
- [ ] **Step 4:** On the phone, screenshot Pulse, Ranks, Create, Chat and Me (`adb -s SM02E4072816959 exec-out screencap -p > shot.png`), compare each with the mockup, and send them to the user.

---

## Server track (worktree `../mooner-xp-server`, branch `feat/xp-server`)

Set up after Task 1 is committed: `git worktree add ../mooner-xp-server -b feat/xp-server` from the main tree, then `ln -s "$PWD/engine/node_modules" ../mooner-xp-server/engine/node_modules` (or `npm ci` in its `engine/`). The XP plan file is untracked: read it from the main tree's path. Run every command from the worktree.

### S2–S5: piece 6 Tasks 2–5, as written

Lines 274–568 (Task 2), 569–1008 (Task 3), 1009–1166 (Task 4), 1167–1399 (Task 5).

### S6: piece 6 Task 6, without piece 5's gate

Lines 1400–1624. In Step 0, drop the `engine: follows (POST /api/follow` check: the expected output is `1`, `1`, `2` for the other three commands. `makeSessions` is already exported from `engine/server/social.js`.

### S7: piece 6 Task 7, anchored on today's feed.js

Lines 1625–1813, with these changes:
- **Step 0:** drop the `engine: the feed hands its listeners` check.
- **The header block:** anchor on the line that's there today, `//   - chat messages and pictures as the server saves them: \`chat:<channel>\`, \`profiles\``, and put after it:

```js
//   - XP rows (xp.js) on `profiles` too, type "xp": the board after the pictures, then the
//     rows that change (xpChanged)
```

- The other four blocks (the constructor, its doc comment, `snapshot`, the two methods) and the three tests as written; if an anchor doesn't match today's text exactly, stop and report it rather than guessing.

### S8: piece 6 Task 8, anchored on today's main.js and apiclient.js

Lines 1814–2013, with these changes:
- **Step 0:** drop the piece 5 Task 7 check and the `unfollow:` grep.
- **apiclient.js:** anchor after the line `    saveProfile: async (token, pfp) => (await call("POST", "/api/profile", { token, pfp })).json,` and add:

```js
    // XP and the Seeker Genesis check (server/xproutes.js)
    xp: async (wallet) => (await call("GET", `/api/xp/${wallet}`)).json,
    genesis: async (token) => (await call("POST", "/api/genesis", { token })).json,
```

- **main.js:** the six blocks as written. The fifth ends mid-line: today's line ends `})).concat(makeAppLinkRoutes({ certs: cfg.androidCerts })).concat(makeRpcRoutes({ url: cfg.appRpc, log }));`, so the replacement covers `makeAppLinkRoutes({ certs: cfg.androidCerts }))` and leaves `.concat(makeRpcRoutes({ url: cfg.appRpc, log }));` after it. If any anchor doesn't match today's text exactly, stop and report.
- The apiclient test as written.
