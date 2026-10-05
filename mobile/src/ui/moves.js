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
