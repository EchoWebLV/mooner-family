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

/** Whether the app has been touched yet: a screen's own sounds (the host's line) wait for it
 *  too, so a room opened by a link stays quiet until the first touch. */
export const isArmed = () => armed;

/** The next screen change plays `cue` instead of its own. Nothing calls it today: the coin
 *  page's Trade opens a sheet there, not a new screen. It's used by that one change only: a
 *  change with no cue of its own drops it too. */
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
