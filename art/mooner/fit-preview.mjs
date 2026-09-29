/** Neutral-background fit review. Use the TS loader documented in README.md. */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { renderPixels } from '../../web/src/lib/pfp/render/pixels.ts'
import { SPRITE_MANIFEST } from '../../web/src/lib/pfp/render/sprites.ts'
import { DEFAULT_PFP, TRAITS } from '../../web/src/lib/pfp/traits.ts'

const require = createRequire(new URL('../../web/package.json', import.meta.url))
const { PNG } = require('pngjs')
const atlas = PNG.sync.read(fs.readFileSync(new URL('../../web/src/lib/pfp/render/assets/atlas.png', import.meta.url)))
const background = [18, 19, 26, 255]
// Only this diagnostic copy gets a flat backdrop; production artwork is untouched.
for (const [id, sprite] of Object.entries(SPRITE_MANIFEST)) {
  if (!id.startsWith('bg/')) continue
  const [x, y, width, height] = sprite.source
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    atlas.data.set(background, ((y + row) * atlas.width + x + column) * 4)
  }
}
const groups = [
  TRAITS.head.map(trait => ({ head: trait.id })),
  TRAITS.mouth.map(trait => ({ mouth: trait.id })),
  TRAITS.mouth.map(trait => ({ mouth: trait.id, skin: 'obsidian' })),
  TRAITS.outfit.map(trait => ({ outfit: trait.id, mouth: 'open' })),
  TRAITS.neck.map(trait => ({ neck: trait.id })),
  TRAITS.neck.map(trait => ({ neck: trait.id, outfit: 'hoodie' })),
  TRAITS.eyes.slice(0, 8).map(trait => ({ eyes: trait.id, skin: 'obsidian' })),
  TRAITS.eyes.slice(8).map(trait => ({ eyes: trait.id, skin: 'obsidian' })),
]
const output = new PNG({ width: 2560, height: groups.length * 256 })
for (let index = 0; index < output.data.length; index += 4) output.data.set(background, index)
for (const [row, cases] of groups.entries()) {
  for (const [column, traits] of cases.entries()) {
    const picture = renderPixels({ ...DEFAULT_PFP, ...traits }, 256, atlas)
    for (let y = 0; y < 256; y++) {
      Buffer.from(picture.data.buffer, y * 256 * 4, 256 * 4)
        .copy(output.data, ((row * 256 + y) * output.width + column * 256) * 4)
    }
  }
}
const outputPath = process.argv[2] || '/tmp/mooner-fit-stress.png'
fs.writeFileSync(outputPath, PNG.sync.write(output))
console.log(outputPath)
