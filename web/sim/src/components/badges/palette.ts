import type { Rarity } from '@/lib/levels'

export interface RarityColors {
  base: string
  light: string
  dark: string
  deep: string
}

/** Rarity colours (spec §4.3); the same values as the --r-* tokens in globals.css. */
export const RARITY_COLORS: Record<Rarity, RarityColors> = {
  common: { base: '#9aa4b8', light: '#dfe4ee', dark: '#3b4354', deep: '#161a22' },
  uncommon: { base: '#3ddc84', light: '#b4f7d0', dark: '#14573a', deep: '#08170f' },
  rare: { base: '#4da3ff', light: '#c0dcff', dark: '#173e6e', deep: '#081322' },
  epic: { base: '#b26bff', light: '#e2c7ff', dark: '#44206e', deep: '#140a22' },
  legendary: { base: '#ffc23d', light: '#fff0bf', dark: '#7a5200', deep: '#1f1500' },
}
