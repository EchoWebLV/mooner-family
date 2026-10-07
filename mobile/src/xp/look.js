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
