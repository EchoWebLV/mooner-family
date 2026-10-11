// The 16 cues (engine/src/cues.js) on the website, as the phone plays them (mobile/src/ui/sound.js):
// one <audio> per cue from /sfx/<cue>.mp3, each at its volume. Nothing plays before the first
// click or key on the page (browsers block it anyway, and a page opened from a link stays quiet).
// localStorage `mooner:sounds` = "off" mutes them; a missing or blocked sound is skipped.
import { CHAT_SOUND_GAP_MS, CUES, SHEET_CLOSE, allowedOn } from '../../../engine/src/cues.js'

export type Cue = keyof typeof CUES

const players = new Map<Cue, HTMLAudioElement>()
let armed = false

function muted(): boolean {
  try {
    return localStorage.getItem('mooner:sounds') === 'off'
  } catch {
    return false
  }
}

/** Loads every cue and arms them on the first click or key. Call once at start. */
export function loadSounds() {
  if (typeof window === 'undefined' || players.size) return
  for (const cue of Object.keys(CUES) as Cue[]) {
    const a = new Audio(`/sfx/${cue}.mp3`)
    a.preload = 'auto'
    players.set(cue, a)
  }
  const arm = () => {
    armed = true
    window.removeEventListener('pointerdown', arm, true)
    window.removeEventListener('keydown', arm, true)
  }
  window.addEventListener('pointerdown', arm, true)
  window.addEventListener('keydown', arm, true)
}

/** The screen a path is, for the cues' rules: "pulse" for Pulse, else its first segment. */
export const screenOf = (path: string) => (path === '/' ? 'pulse' : path.split('/')[1] || 'pulse')

/** Plays `cue` from its start, at its volume, unless muted, not armed yet, or Pulse's quiet
 *  rule says no. `close`: a sheet closing (faster and lower). */
export function play(cue: Cue, { close = false }: { close?: boolean } = {}) {
  const a = players.get(cue)
  if (!a || !armed || muted() || !allowedOn(cue, screenOf(window.location.pathname))) return
  const closing = close && cue === 'sheet'
  a.volume = CUES[cue] * (closing ? SHEET_CLOSE.volume : 1)
  a.playbackRate = closing ? SHEET_CLOSE.rate : 1
  a.currentTime = 0
  a.play().catch(() => {})
}

/** The cue for a move between pages: "whoosh" into a presale, "tap" anywhere else. */
export function pageCue(prev: string | null, path: string): Cue | null {
  if (prev == null || prev === path) return null
  return path.startsWith('/presale/') ? 'whoosh' : 'tap'
}

/** At most one chat cue every CHAT_SOUND_GAP_MS. */
let lastChat = -Infinity
export function playChat() {
  const now = Date.now()
  if (now - lastChat < CHAT_SOUND_GAP_MS) return
  lastChat = now
  play('chat')
}
