import type { Pfp } from '../../types'
import { sanitizePfp } from '../traits'
import { palette } from './palette'
import { SPRITE_MANIFEST, type SpriteAtlas, type SpriteId } from './sprites'

export interface PixelPicture {
  width: number
  height: number
  data: Uint8ClampedArray
}

export const CHARACTER_FRAMES = {
  bare: { scale: 1, x: 0, y: 0 },
  outfit: { scale: 0.84, x: 20, y: 0 },
  neckwear: { scale: 1, x: 0, y: 0 },
} as const

const NATIVE_SIZE = 256
const MATERIAL_STOPS = [0, 100, 157, 203, 238, 255]
const skinMasks = new Map<string, Uint8Array>()
const parseColor = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

/** Compose independent illustrated layers on a single 256px grid. */
export function renderPixels(raw: Pfp, size = NATIVE_SIZE, atlas: SpriteAtlas): PixelPicture {
  if (![128, 256, 512].includes(size)) throw new Error('Picture size must be 128, 256 or 512')
  if (!atlas) throw new Error('Character sprite atlas is required')

  const pfp = sanitizePfp(raw)
  const data = new Uint8ClampedArray(NATIVE_SIZE * NATIVE_SIZE * 4)
  for (let index = 3; index < data.length; index += 4) data[index] = 255
  const colors = palette(pfp.skin).map(parseColor)

  function blend(x: number, y: number, red: number, green: number, blue: number, alpha: number) {
    if (x < 0 || y < 0 || x >= NATIVE_SIZE || y >= NATIVE_SIZE || alpha === 0) return
    const index = (y * NATIVE_SIZE + x) * 4
    const opacity = alpha / 255
    data[index] = Math.round(red * opacity + data[index] * (1 - opacity))
    data[index + 1] = Math.round(green * opacity + data[index + 1] * (1 - opacity))
    data[index + 2] = Math.round(blue * opacity + data[index + 2] * (1 - opacity))
  }

  function sprite(id: string, tint = false, phase?: 'back' | 'front') {
    const entry = SPRITE_MANIFEST[id as SpriteId]
    if (!entry) throw new Error('Missing character sprite: ' + id)
    const [sourceX, sourceY, width, height] = entry.source
    const [destinationX, destinationY] = entry.dest
    let skinMask = skinMasks.get(id)
    if (!skinMask && 'skinMask' in entry) {
      skinMask = new Uint8Array(width * height)
      for (const [start, length] of entry.skinMask) skinMask.fill(1, start, start + length)
      skinMasks.set(id, skinMask)
    }
    const isCharacter = id !== 'suit-collar-front' && !['outfit/', 'bg/', 'aura/'].some(prefix => id.startsWith(prefix))
    const hasOutfit = pfp.outfit !== 'none'
    const hasNeckwear = pfp.neck !== 'none'
    const frame = isCharacter ? (hasOutfit ? CHARACTER_FRAMES.outfit : hasNeckwear ? CHARACTER_FRAMES.neckwear : CHARACTER_FRAMES.bare) : CHARACTER_FRAMES.bare
    const { scale, x: offsetX, y: offsetY } = frame
    const outputWidth = Math.round(width * scale)
    const outputHeight = Math.round(height * scale)
    const left = Math.round(destinationX * scale + offsetX)
    const top = Math.round(destinationY * scale + offsetY)

    // Inverse nearest-neighbor sampling visits each destination pixel once.
    for (let y = 0; y < outputHeight; y++) {
      const sourceRow = Math.min(height - 1, Math.floor((y + 0.5) * height / outputHeight))
      for (let x = 0; x < outputWidth; x++) {
        const sourceColumn = Math.min(width - 1, Math.floor((x + 0.5) * width / outputWidth))
        // The illustrated orbit tilts from bottom left to top right.
        const frontOfOrbit = sourceRow / height + sourceColumn / width >= 1
        if (phase === 'back' && frontOfOrbit || phase === 'front' && !frontOfOrbit) continue
        const index = ((sourceY + sourceRow) * atlas.width + sourceX + sourceColumn) * 4
        let red = atlas.data[index]
        let green = atlas.data[index + 1]
        let blue = atlas.data[index + 2]
        if ((tint || skinMask?.[sourceRow * width + sourceColumn]) && pfp.skin !== 'moon') {
          const luminance = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722)
          let band = 0
          while (band < 4 && luminance > MATERIAL_STOPS[band + 1]) band++
          const fraction = Math.max(0, Math.min(1,
            (luminance - MATERIAL_STOPS[band]) / (MATERIAL_STOPS[band + 1] - MATERIAL_STOPS[band]),
          ))
          const mapped = colors[band].map((channel, component) =>
            Math.round(channel + (colors[band + 1][component] - channel) * fraction),
          )
          ;[red, green, blue] = mapped
        }
        blend(left + x, top + y, red, green, blue, atlas.data[index + 3])
      }
    }
  }

  sprite('bg/' + pfp.bg)
  if (pfp.aura === 'glow' || pfp.aura === 'sparkles') sprite('aura/' + pfp.aura)
  if (pfp.aura === 'ring') sprite('aura/ring', false, 'back')
  if (pfp.head === 'headphones') sprite('head/headphones')

  if (pfp.outfit !== 'none') sprite('outfit/' + pfp.outfit)
  if (['none', 'halo', 'headphones'].includes(pfp.head)) { sprite('spikes', true); sprite('spike-right', true) }
  if (pfp.head === 'horns') { sprite('head/horns'); sprite('horn-right') }
  const materialId = 'skin/' + pfp.skin
  sprite(materialId in SPRITE_MANIFEST ? materialId : 'base', !(materialId in SPRITE_MANIFEST))
  if (pfp.outfit === 'suit') sprite('suit-collar-front')
  if (pfp.head !== 'party') sprite('antenna')
  // Opaque lenses cover sockets completely; the monocle retains the chosen eyes.
  if (pfp.face === 'none' || pfp.face === 'monocle') sprite('eyes/' + pfp.eyes)
  if (pfp.neck !== 'none') sprite('neck/' + pfp.neck)
  if (pfp.neck === 'chain' || pfp.neck === 'icechain') sprite(pfp.neck + '-pendant')
  sprite('mouth/' + pfp.mouth)
  if (pfp.head === 'headphones') {
    sprite('headphones-left')
    sprite('headphones-right')
  } else if (pfp.head !== 'none' && pfp.head !== 'horns') {
    sprite('head/' + pfp.head)
  }
  if (pfp.face !== 'none') sprite('face/' + pfp.face)
  if (pfp.aura === 'ring') sprite('aura/ring', false, 'front')

  if (size === NATIVE_SIZE) return { width: size, height: size, data }
  const output = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sourceX = Math.floor((x + 0.5) * NATIVE_SIZE / size)
      const sourceY = Math.floor((y + 0.5) * NATIVE_SIZE / size)
      const sourceIndex = (sourceY * NATIVE_SIZE + sourceX) * 4
      output.set(data.subarray(sourceIndex, sourceIndex + 4), (y * size + x) * 4)
    }
  }
  return { width: size, height: size, data: output }
}
