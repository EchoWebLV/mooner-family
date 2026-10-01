// What each trait looks like: colours and material settings the scene is built from.
import type { Pfp } from '../../types'

export interface Skin {
  body: string
  crater: string
  rough?: number
  metal?: number
  clearcoat?: number
  sheen?: number
  sheenColor?: string
  irid?: number
  /** Transmission, for see-through skins. */
  glass?: number
  attn?: string
  ior?: number
  dispersion?: number
  selfGlow?: string
  /** Craters that glow in this colour (lava). */
  glow?: string
  glowI?: number
  env?: number
  /** The eye sparkle colour that suits this skin, used by the plain star eyes. */
  star?: string
}

export interface Palette {
  bg: string
  bg2: string
  stars: boolean
  /** Trim: drawstrings, stripes, gems. */
  accent: string
  /** Clothes and hats, chosen to stand out from the background. */
  cloth: string
  rim: string
  art?: 'neon' | 'vault' | 'galaxy' | 'aurora'
}

export interface Eyes {
  glint: 'star' | 'heart' | 'diamond' | 'none'
  color: string
  lens?: string
  lensGlow?: string
  cosmic?: boolean
  laser?: boolean
}

export interface Look {
  pfp: Pfp
  skin: Skin
  palette: Palette
  eyes: Eyes
}

export const SKINS: Record<string, Skin> = {
  moon: { body: '#f2efe8', crater: '#bdb7ad' },
  lilac: { body: '#b99dff', crater: '#8866e6' },
  mint: { body: '#7fe3b2', crater: '#44b784' },
  peach: { body: '#ffb488', crater: '#e27f55' },
  sky: { body: '#80b9ff', crater: '#4b86dc' },
  lemon: { body: '#ffe066', crater: '#dcb22c' },
  coral: { body: '#ff8577', crater: '#dc5446' },
  rose: { body: '#ff9fd0', crater: '#e46aa6' },
  lime: { body: '#b8e65c', crater: '#86b52c' },
  cocoa: { body: '#b07a55', crater: '#7f5235' },
  teal: { body: '#45cfc3', crater: '#23998f' },
  clay: { body: '#c0613a', crater: '#8f4024', rough: 0.95, clearcoat: 0, sheen: 0.6, sheenColor: '#ffd9c4' },
  ink: { body: '#34407a', crater: '#1f2754', rough: 0.3, clearcoat: 1, sheen: 0, star: '#ffd23b' },
  holo: { body: '#f5f0ff', crater: '#cdbff5', irid: 1, rough: 0.3 },
  jelly: {
    body: '#d9fdff', crater: '#9eeaf5', glass: 0.85, rough: 0.12, clearcoat: 1, sheen: 0, attn: '#5fe3f2',
    selfGlow: '#2fb8c9',
  },
  obsidian: { body: '#1a1720', crater: '#3a3345', rough: 0.14, clearcoat: 1, irid: 0.45, sheen: 0, env: 1.1 },
  chrome: { body: '#eef2f7', crater: '#b8c2d0', metal: 1, rough: 0.07, clearcoat: 1, sheen: 0, env: 1.3 },
  gold: { body: '#ffcc55', crater: '#d99a1a', metal: 1, rough: 0.18, clearcoat: 0.6, sheen: 0, env: 1.2, star: '#fff2b0' },
  diamond: {
    body: '#f4fbff', crater: '#cfe8ff', glass: 1, ior: 2, dispersion: 4, rough: 0.03, clearcoat: 1, sheen: 0,
    irid: 0.4, attn: '#bfe6ff', env: 1.3,
  },
  lava: { body: '#3a2d33', crater: '#c83200', glow: '#ff4a00', glowI: 0.75, rough: 0.75, clearcoat: 0.15, sheen: 0 },
}

export const PALETTES: Record<string, Palette> = {
  midnight: { bg: '#040406', bg2: '#1c1c26', stars: false, accent: '#ff4f9a', cloth: '#3a4bd8', rim: '#9fb4ff' },
  space: { bg: '#050a18', bg2: '#1d2f5c', stars: true, accent: '#ffd23b', cloth: '#ff7a1a', rim: '#8fb4ff' },
  dusk: { bg: '#170c38', bg2: '#5b2ea3', stars: true, accent: '#ff4f9a', cloth: '#2fd4a3', rim: '#7ff3ff' },
  ocean: { bg: '#03242c', bg2: '#0f7c8a', stars: false, accent: '#ffd23b', cloth: '#ff6b6b', rim: '#9ff7ff' },
  sunset: { bg: '#2a0f22', bg2: '#e0664f', stars: false, accent: '#ffd23b', cloth: '#243a8f', rim: '#ffc59a' },
  forest: { bg: '#06140d', bg2: '#1f6b45', stars: false, accent: '#ff7a59', cloth: '#f2c14e', rim: '#b5ffcf' },
  ember: { bg: '#120303', bg2: '#521009', stars: false, accent: '#ff4a00', cloth: '#26222b', rim: '#ff7a4a' },
  candy: { bg: '#3a1436', bg2: '#ff7fbf', stars: false, accent: '#ffffff', cloth: '#5ad8ff', rim: '#ffd0ec' },
  aurora: { bg: '#020b12', bg2: '#0c3a3f', stars: true, accent: '#7dffb3', cloth: '#e9f2ff', rim: '#8dffd0', art: 'aurora' },
  neon: { bg: '#07000f', bg2: '#3b0a5e', stars: false, accent: '#ff2bd6', cloth: '#00e5ff', rim: '#ff5ce8', art: 'neon' },
  vault: { bg: '#1a1206', bg2: '#5a3c10', stars: false, accent: '#ffc53d', cloth: '#7a0f24', rim: '#ffd98a', art: 'vault' },
  galaxy: { bg: '#04010c', bg2: '#2a1257', stars: true, accent: '#9ff3ff', cloth: '#2a1c5c', rim: '#c9a8ff', art: 'galaxy' },
}

export const EYES: Record<string, Eyes> = {
  star: { glint: 'star', color: '#ffffff' },
  ice: { glint: 'star', color: '#9ff3ff' },
  pink: { glint: 'star', color: '#ff8fc8' },
  gold: { glint: 'star', color: '#ffd23b' },
  heart: { glint: 'heart', color: '#ff4f7a' },
  diamond: { glint: 'diamond', color: '#bfe9ff', lens: '#0a1030' },
  cosmic: { glint: 'star', color: '#ffffff', cosmic: true },
  laser: { glint: 'none', color: '#ffffff', laser: true, lensGlow: '#ff2020' },
}

/** Clothes in the skin's own colour disappear: the first of these far enough from the skin is used instead. */
const CLOTH_FALLBACK = ['#23263a', '#f4f1ea']

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

function distance(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

export function lookOf(pfp: Pfp): Look {
  const skin = SKINS[pfp.skin] ?? SKINS.moon
  const eyes = EYES[pfp.eyes] ?? EYES.star
  const palette = PALETTES[pfp.bg] ?? PALETTES.midnight
  const cloth = [palette.cloth, palette.accent, ...CLOTH_FALLBACK].find((c) => distance(c, skin.body) > 110) ?? palette.cloth
  return {
    pfp,
    skin,
    palette: cloth === palette.cloth ? palette : { ...palette, cloth },
    eyes: pfp.eyes === 'star' && skin.star ? { ...eyes, color: skin.star } : eyes,
  }
}
