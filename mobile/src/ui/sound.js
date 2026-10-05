// The 16 cues (engine/src/cues.js) through expo-audio: one player per cue, loaded once at
// start, mixed with other apps' audio and quiet when the phone is on silent. A missing sound
// is skipped, never an error. The Sounds switch (Me) is kept in expo-secure-store.
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
const listeners = new Set();
let loading = null;

/** Loads every player and the saved switch, once. Call at start. */
export function loadSounds() {
  loading ??= (async () => {
    try {
      await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" });
    } catch {
      // the default mode still plays
    }
    for (const [cue, file] of Object.entries(FILES)) {
      try {
        players.set(cue, createAudioPlayer(file));
      } catch {
        // that cue stays quiet
      }
    }
    const saved = await pref.get().catch(() => undefined);
    setOn(saved?.on !== false);
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

let armed = false; // the first touch arms them: opening the app, or a link, is quiet
let nextCue = null;

/** The first touch anywhere: screen changes may play from now on. */
export function arm() {
  armed = true;
}

/** The next screen change plays `cue` instead of its own (live's Trade whooshes to the coin). */
export function nextScreen(cue) {
  nextCue = cue;
}

/** A move from `prev` to `path`: whoosh into a room, tap anywhere else (screens.js). */
export function screenChange(prev, path) {
  const own = screenCue(prev, path);
  if (!own) return;
  const cue = nextCue ?? own;
  nextCue = null;
  if (armed) play(cue);
}
