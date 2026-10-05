// The cue for a move from screen `prev` to screen `path` (expo-router pathnames: "/" is Pulse,
// "/me", "/create", "/presale/<key>", "/coin/<key>", "/connect"). Pure, for Node tests.

/** "whoosh" into a room, "tap" into any other screen; null for the first screen or none. */
export function screenCue(prev, path) {
  if (prev == null || prev === path) return null;
  return path.startsWith("/presale/") ? "whoosh" : "tap";
}
