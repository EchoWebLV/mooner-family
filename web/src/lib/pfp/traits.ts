// Mooner PFPs: every player is a sculpted 3D moon built from one trait per slot. Common traits are free; the rest unlock
// with titles, one level per rarity step (Uncommon = level II … Legendary = level V), the same ladder as the badges.
// Pure data and rules; ./render draws the pictures.
import { roman } from '../format'
import { RARITIES, TITLE_NAMES, TITLES, type Rarity } from '../levels'
import { createRng, hashString, type Rng } from '../rng'
import type { Level, Pfp, PfpSlot, Title, TitleProgress } from '../types'

/** The order the customizer shows the slots in. */
export const SLOTS: readonly PfpSlot[] = ['skin', 'eyes', 'mouth', 'head', 'face', 'outfit', 'neck', 'aura', 'bg']

export const SLOT_NAMES: Record<PfpSlot, string> = {
  skin: 'Skin',
  eyes: 'Eyes',
  mouth: 'Mouth',
  head: 'Headwear',
  face: 'Eyewear',
  outfit: 'Outfit',
  neck: 'Neck',
  aura: 'Aura',
  bg: 'Background',
}

export interface Trait {
  slot: PfpSlot
  id: string
  name: string
  rarity: Rarity
  /** The title whose level unlocks it. Unset: Common traits are free, Uncommon ones take any title at level II. */
  title?: Title
  /** Slots this trait leaves empty: the space suit's neck ring leaves no room for a necklace. */
  blocks?: readonly PfpSlot[]
  /** Roll weight, when the rarity's default doesn't fit (the empty "none" options). */
  weight?: number
}

type Row = [id: string, name: string, rarity?: Rarity, title?: Title, extra?: Pick<Trait, 'blocks' | 'weight'>]

const CATALOG: Record<PfpSlot, Row[]> = {
  skin: [
    ['moon', 'Moon'],
    ['lilac', 'Lilac'],
    ['mint', 'Mint'],
    ['peach', 'Peach'],
    ['sky', 'Sky'],
    ['lemon', 'Lemon'],
    ['coral', 'Coral'],
    ['rose', 'Rose'],
    ['lime', 'Lime'],
    ['cocoa', 'Cocoa'],
    ['teal', 'Teal'],
    ['clay', 'Clay', 'uncommon'],
    ['ink', 'Ink', 'uncommon'],
    ['holo', 'Holo', 'rare', 'shiller'],
    ['jelly', 'Jelly', 'rare', 'diamond'],
    ['obsidian', 'Obsidian', 'rare', 'raider'],
    ['chrome', 'Chrome', 'epic', 'diamond'],
    ['gold', 'Gold', 'legendary', 'kol'],
    ['diamond', 'Diamond', 'legendary', 'diamond'],
    ['lava', 'Lava', 'legendary', 'raider'],
  ],
  eyes: [
    ['star', 'Starry'],
    ['ice', 'Ice star'],
    ['wink', 'Wink'],
    ['sleepy', 'Sleepy'],
    ['wide', 'Surprised'],
    ['happy', 'Happy'],
    ['angry', 'Angry', 'uncommon'],
    ['cross', 'Crossed out', 'uncommon'],
    ['money', 'Money', 'rare', 'kol'],
    ['spiral', 'Hypnotized', 'rare', 'shiller'],
    ['pink', 'Pink star'],
    ['gold', 'Gold star', 'uncommon'],
    ['heart', 'Heart', 'uncommon'],
    ['diamond', 'Diamond', 'rare', 'diamond'],
    ['cosmic', 'Cosmic', 'epic', 'shiller'],
    ['laser', 'Laser', 'legendary', 'raider', { blocks: ['face'] }],
  ],
  mouth: [
    ['tongue', 'Tongue out'],
    ['smile', 'Smile'],
    ['grin', 'Toothy grin'],
    ['smirk', 'Smirk'],
    ['open', 'Surprised'],
    ['grimace', 'Grimace'],
    ['bubblegum', 'Bubblegum', 'uncommon'],
    ['fangs', 'Fangs', 'uncommon'],
    ['gold', 'Gold grill', 'rare', 'kol'],
    ['drool', 'Slime drool', 'rare', 'raider'],
  ],
  head: [
    ['none', 'Nothing', 'common', undefined, { weight: 30 }],
    ['beanie', 'Beanie'],
    ['party', 'Party hat'],
    ['cap', 'Cap', 'uncommon'],
    ['headphones', 'Headphones', 'rare', 'shiller'],
    ['horns', 'Horns', 'epic', 'raider'],
    ['halo', 'Halo', 'legendary', 'diamond'],
    ['crown', 'Crown', 'legendary', 'kol'],
  ],
  face: [
    ['none', 'Nothing', 'common', undefined, { weight: 36 }],
    ['shades', 'Shades'],
    ['retro', '3D glasses', 'uncommon'],
    ['hearts', 'Heart shades', 'uncommon'],
    ['monocle', 'Monocle', 'rare', 'kol'],
    ['visor', 'Visor', 'epic', 'shiller'],
  ],
  outfit: [
    ['none', 'Bare', 'common', undefined, { weight: 8 }],
    ['tee', 'Tee'],
    ['turtleneck', 'Turtleneck'],
    ['hoodie', 'Hoodie', 'uncommon'],
    ['tux', 'Tuxedo', 'rare', 'kol'],
    ['suit', 'Space suit', 'epic', 'diamond', { blocks: ['neck'] }],
    ['royal', 'Royal mantle', 'epic', 'kol', { blocks: ['neck'] }],
  ],
  neck: [
    ['none', 'Nothing', 'common', undefined, { weight: 24 }],
    ['scarf', 'Scarf'],
    ['bowtie', 'Bow tie'],
    ['chain', 'Gold chain', 'uncommon'],
    ['bandana', 'Bandana', 'rare', 'raider'],
    ['icechain', 'Ice chain', 'epic', 'diamond'],
  ],
  aura: [
    ['none', 'Nothing', 'common', undefined, { weight: 60 }],
    ['glow', 'Glow', 'uncommon'],
    ['sparkles', 'Sparkles', 'epic', 'shiller'],
    ['ring', 'Planet ring', 'legendary', 'shiller'],
  ],
  bg: [
    ['midnight', 'Midnight'],
    ['space', 'Deep space'],
    ['dusk', 'Dusk'],
    ['ocean', 'Ocean'],
    ['sunset', 'Sunset'],
    ['forest', 'Forest'],
    ['ember', 'Ember', 'uncommon'],
    ['candy', 'Candy', 'uncommon'],
    ['aurora', 'Aurora', 'rare', 'diamond'],
    ['neon', 'Neon', 'rare', 'shiller'],
    ['vault', 'Vault', 'epic', 'kol'],
    ['galaxy', 'Galaxy', 'legendary', 'shiller'],
  ],
}

export const TRAITS = Object.fromEntries(
  SLOTS.map((slot) => [
    slot,
    CATALOG[slot].map(([id, name, rarity = 'common', title, extra]): Trait => ({ slot, id, name, rarity, title, ...extra })),
  ]),
) as unknown as Record<PfpSlot, readonly Trait[]>

/** The plain moon everyone starts as before signing in. */
export const DEFAULT_PFP: Pfp = {
  skin: 'moon',
  eyes: 'star',
  mouth: 'tongue',
  head: 'none',
  face: 'none',
  outfit: 'none',
  neck: 'none',
  aura: 'none',
  bg: 'midnight',
}

/** Rolled first, so a trait that blocks a slot is known before that slot is drawn. */
const ROLL_ORDER: readonly PfpSlot[] = ['skin', 'eyes', 'mouth', 'outfit', 'head', 'face', 'neck', 'aura', 'bg']

const RARITY_WEIGHT: Record<Rarity, number> = { common: 12, uncommon: 5, rare: 2.4, epic: 1.1, legendary: 0.5 }

export function traitOf(slot: PfpSlot, id: string): Trait | undefined {
  return TRAITS[slot].find((t) => t.id === id)
}

/** The level a trait needs: its rarity's step on the ladder. */
export function unlockLevel(t: Trait): Level {
  return (RARITIES.indexOf(t.rarity) + 1) as Level
}

export function isUnlocked(t: Trait, titles: Record<Title, TitleProgress>): boolean {
  const need = unlockLevel(t)
  if (need === 1) return true
  if (t.title) return titles[t.title].level >= need
  return TITLES.some((title) => titles[title].level >= need)
}

/** "Diamond Hands IV", or "Any title at II". Empty for free traits. */
export function unlockText(t: Trait): string {
  const need = unlockLevel(t)
  if (need === 1) return ''
  return t.title ? `${TITLE_NAMES[t.title]} ${roman(need)}` : `Any title at ${roman(need)}`
}

/** The trait in this PFP that leaves `slot` empty, if any. */
export function blockerOf(pfp: Pfp, slot: PfpSlot): Trait | undefined {
  for (const s of SLOTS) {
    const t = traitOf(s, pfp[s])
    if (t?.blocks?.includes(slot)) return t
  }
  return undefined
}

/** Swaps one trait; slots the new trait blocks go back to empty. */
export function withTrait(pfp: Pfp, slot: PfpSlot, id: string): Pfp {
  const next = { ...pfp, [slot]: id }
  for (const s of traitOf(slot, id)?.blocks ?? []) next[s] = 'none'
  return next
}

/** A random Mooner from the traits these titles have unlocked, rarer traits drawn less often. */
export function rollPfp(rng: Rng, titles: Record<Title, TitleProgress>): Pfp {
  const pfp = { ...DEFAULT_PFP }
  const blocked = new Set<PfpSlot>()
  for (const slot of ROLL_ORDER) {
    if (blocked.has(slot)) continue
    const pool = TRAITS[slot].filter((t) => isUnlocked(t, titles))
    let r = rng.next() * pool.reduce((sum, t) => sum + weightOf(t), 0)
    let pick = pool[pool.length - 1]
    for (const t of pool) {
      r -= weightOf(t)
      if (r < 0) {
        pick = t
        break
      }
    }
    pfp[slot] = pick.id
    for (const s of pick.blocks ?? []) blocked.add(s)
  }
  return pfp
}

function weightOf(t: Trait): number {
  return t.weight ?? RARITY_WEIGHT[t.rarity]
}

/** Makes stored data a valid PFP: unknown traits go back to the default, blocked slots to empty. */
export function sanitizePfp(raw: unknown): Pfp {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  let pfp = { ...DEFAULT_PFP }
  for (const slot of ROLL_ORDER) {
    const id = src[slot]
    if (typeof id === 'string' && traitOf(slot, id) && !blockerOf(pfp, slot)) pfp = withTrait(pfp, slot, id)
  }
  return pfp
}

/** The traits in this PFP the titles haven't unlocked. */
export function lockedTraits(pfp: Pfp, titles: Record<Title, TitleProgress>): Trait[] {
  return SLOTS.map((s) => traitOf(s, pfp[s])).filter((t): t is Trait => !!t && !isUnlocked(t, titles))
}

/** The PFP with every trait these titles haven't unlocked put back to the default. */
export function keepUnlocked(pfp: Pfp, titles: Record<Title, TitleProgress>): Pfp {
  const next = { ...pfp }
  for (const t of lockedTraits(pfp, titles)) next[t.slot] = DEFAULT_PFP[t.slot]
  return next
}

/** The traits that reaching `level` in `title` unlocks. */
export function unlocksAt(title: Title, level: Level): Trait[] {
  return SLOTS.flatMap((s) => TRAITS[s].filter((t) => t.title === title && unlockLevel(t) === level))
}

/** One string per look, for caching pictures. */
export function pfpKey(pfp: Pfp): string {
  return SLOTS.map((s) => pfp[s]).join('.')
}

const NO_TITLES = Object.fromEntries(TITLES.map((t) => [t, { xp: 0, level: 1 }])) as Record<Title, TitleProgress>
const byHandle = new Map<string, Pfp>()

/** The Mooner for a handle with no player behind it: the same free traits every time. */
export function handlePfp(handle: string): Pfp {
  let pfp = byHandle.get(handle)
  if (!pfp) {
    pfp = rollPfp(createRng(hashString('pfp:' + handle)), NO_TITLES)
    byHandle.set(handle, pfp)
  }
  return pfp
}
