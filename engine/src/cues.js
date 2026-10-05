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
