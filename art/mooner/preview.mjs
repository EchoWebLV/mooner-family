/** Run with Node's TS loader; see README.md. Optional output path is argv[2]. */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { renderPixels } from '../../web/src/lib/pfp/render/pixels.ts'
import { DEFAULT_PFP } from '../../web/src/lib/pfp/traits.ts'

const require = createRequire(new URL('../../web/package.json', import.meta.url))
const { PNG } = require('pngjs')
const atlas = PNG.sync.read(fs.readFileSync(new URL('../../web/src/lib/pfp/render/assets/atlas.png', import.meta.url)))
const cases = [
  {},
  { skin: 'lime', mouth: 'grin' },
  { skin: 'rose', eyes: 'wink', mouth: 'bubblegum' },
  { skin: 'sky', face: 'shades', aura: 'glow' },
  { head: 'beanie', eyes: 'sleepy', outfit: 'hoodie', neck: 'scarf', bg: 'sunset' },
  { skin: 'gold', head: 'crown', eyes: 'money', mouth: 'gold', outfit: 'royal', bg: 'vault' },
  { skin: 'lava', head: 'horns', eyes: 'angry', mouth: 'fangs', bg: 'ember' },
  { skin: 'diamond', head: 'headphones', eyes: 'wide', mouth: 'open', outfit: 'suit', bg: 'space' },
  { skin: 'mint', head: 'party', eyes: 'happy', mouth: 'smile', aura: 'sparkles', bg: 'candy' },
  { skin: 'obsidian', eyes: 'cosmic', mouth: 'smirk', aura: 'ring', bg: 'galaxy' },
  { skin: 'chrome', face: 'retro', mouth: 'grin', outfit: 'tux', neck: 'bowtie', bg: 'neon' },
  { skin: 'holo', eyes: 'diamond', mouth: 'smile', head: 'halo', neck: 'icechain', bg: 'dusk' },
]
const cellSize = 256
const columns = 4
const output = new PNG({ width: columns * cellSize, height: 3 * cellSize })
for (const [index, traits] of cases.entries()) {
  const picture = renderPixels({ ...DEFAULT_PFP, ...traits }, cellSize, atlas)
  const left = index % columns * cellSize
  const top = Math.floor(index / columns) * cellSize
  for (let row = 0; row < cellSize; row++) {
    Buffer.from(picture.data.buffer, row * cellSize * 4, cellSize * 4)
      .copy(output.data, ((top + row) * output.width + left) * 4)
  }
}
const outputPath = process.argv[2] || '/tmp/mooner-sprite-preview.png'
fs.writeFileSync(outputPath, PNG.sync.write(output))
console.log(outputPath)
