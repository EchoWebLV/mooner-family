import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { renderPixels, CHARACTER_FRAMES } from '../src/lib/pfp/render/pixels.ts'
import { SPRITE_MANIFEST } from '../src/lib/pfp/render/sprites.ts'
import { DEFAULT_PFP, TRAITS, SLOTS, sanitizePfp, handlePfp } from '../src/lib/pfp/traits.ts'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
const atlas = PNG.sync.read(fs.readFileSync(new URL('../src/lib/pfp/render/assets/atlas.png', import.meta.url)))
const render = (pfp, size = 256) => renderPixels(pfp, size, atlas)
const digest = (picture) => createHash('sha256').update(picture.data).digest('hex')
const region = (picture, x, y, width, height) => Buffer.concat(
  Array.from({ length: height }, (_, row) => Buffer.from(picture.data.subarray(
    ((y + row) * picture.width + x) * 4,
    ((y + row) * picture.width + x + width) * 4,
  ))),
).toString('base64')

test('production atlas covers every selectable illustrated layer with valid nonempty bounds', () => {
  for (const slot of SLOTS.filter(slot => slot !== 'skin')) {
    for (const trait of TRAITS[slot].filter(trait => trait.id !== 'none')) {
      assert.ok(SPRITE_MANIFEST[`${slot}/${trait.id}`], `${slot}/${trait.id}`)
    }
  }
  assert.ok(SPRITE_MANIFEST.base)
  for (const [id, sprite] of Object.entries(SPRITE_MANIFEST)) {
    const [x, y, width, height] = sprite.source
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0, id)
    assert.ok(x + width <= atlas.width && y + height <= atlas.height, id)
    let opaque = 0
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
      opaque += atlas.data[(row * atlas.width + col) * 4 + 3] > 0 ? 1 : 0
    }
    assert.ok(opaque > 20, id)
  }
})

test('all 89 catalog traits produce distinct deterministic opaque art', () => {
  let count = 0
  for (const slot of SLOTS) {
    const images = new Set()
    for (const trait of TRAITS[slot]) {
      const pfp = { ...DEFAULT_PFP, [slot]: trait.id }
      const picture = render(pfp)
      assert.equal(picture.width, 256)
      assert.equal(picture.height, 256)
      assert.equal(picture.data.length, 256 * 256 * 4)
      assert.equal(digest(picture), digest(render(pfp)))
      for (let index = 3; index < picture.data.length; index += 4) assert.equal(picture.data[index], 255)
      images.add(digest(picture))
      count++
    }
    assert.equal(images.size, TRAITS[slot].length, `${slot} must be visually distinct`)
  }
  assert.equal(count, 89)
})

test('blocked and invalid combinations render as their sanitized equivalents', () => {
  for (const raw of [
    { ...DEFAULT_PFP, eyes: 'laser', face: 'shades' },
    { ...DEFAULT_PFP, outfit: 'suit', neck: 'chain' },
    { ...DEFAULT_PFP, outfit: 'royal', neck: 'scarf' },
    { ...DEFAULT_PFP, skin: 'missing' },
  ]) assert.equal(digest(render(raw)), digest(render(sanitizePfp(raw))))
})

test('512 repeats native256 pixels exactly and128 uses deterministic nearest sampling', () => {
  const source = render(DEFAULT_PFP)
  for (const size of [128, 512]) {
    const picture = render(DEFAULT_PFP, size)
    assert.equal(picture.width, size)
    assert.equal(picture.height, size)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const actual = (y * size + x) * 4
      const expected = (Math.floor((y + 0.5) * 256 / size) * 256 + Math.floor((x + 0.5) * 256 / size)) * 4
      assert.deepEqual(picture.data.subarray(actual, actual + 4), source.data.subarray(expected, expected + 4))
    }
  }
  assert.throws(() => render(DEFAULT_PFP, 127), /128|256|512/)
  assert.throws(() => renderPixels(DEFAULT_PFP), /atlas is required/)
})

test('unblocked neck accessories stay visible across every outfit', () => {
  for (const outfit of TRAITS.outfit.filter(trait => !trait.blocks?.includes('neck'))) {
    const images = new Set(TRAITS.neck.map(neck => region(
      render({ ...DEFAULT_PFP, outfit: outfit.id, neck: neck.id }), 0, 176, 256, 80,
    )))
    assert.equal(images.size, TRAITS.neck.length, `neckwear on ${outfit.id}`)
  }
})

test('legacy profiles keep their tongue and free rolls explore facial shapes', () => {
  assert.equal(sanitizePfp({ eyes: 'star' }).mouth, 'tongue')
  const rolls = Array.from({ length: 200 }, (_, index) => handlePfp(`expression-${index}`))
  assert.ok(new Set(rolls.map(pfp => pfp.mouth)).size >= 5)
  for (const eyes of ['wink', 'sleepy', 'wide', 'happy']) assert.ok(rolls.some(pfp => pfp.eyes === eyes), eyes)
})

test('eyes and mouths differ inside their registered facial regions', () => {
  for (const [slot, box] of [['mouth', [80, 164, 145, 92]], ['eyes', [78, 87, 153, 110]]]) {
    const images = TRAITS[slot].map(trait => region(render({ ...DEFAULT_PFP, [slot]: trait.id }), ...box))
    assert.equal(new Set(images).size, TRAITS[slot].length)
  }
})

test('halo and monocle have real transparent holes and keep underlying art visible', () => {
  for (const [id, u, v, pfp] of [
    ['head/halo', 0.5, 0.5, { ...DEFAULT_PFP, head: 'halo' }],
    ['face/monocle', 0.62, 0.39, { ...DEFAULT_PFP, face: 'monocle' }],
  ]) {
    const sprite = SPRITE_MANIFEST[id]
    const [sx, sy, width, height] = sprite.source
    const [dx, dy] = sprite.dest
    const x = Math.floor(width * u), y = Math.floor(height * v)
    assert.equal(atlas.data[((sy + y) * atlas.width + sx + x) * 4 + 3], 0, id)
    assert.equal(region(render(pfp), dx + x, dy + y, 1, 1), region(render(DEFAULT_PFP), dx + x, dy + y, 1, 1), id)
  }
})

// Hats, spikes, and the full smiley antenna must fit above every portrait crop.
test('head framing keeps complete upper silhouettes inside the export', () => {
  const ids = ['base', 'antenna', 'spikes', 'head/beanie', 'head/party', 'head/cap', 'head/crown', 'head/halo', 'head/horns']
  for (const [name, frame] of Object.entries(CHARACTER_FRAMES)) {
    for (const id of ids) {
      const [x, y, width, height] = SPRITE_MANIFEST[id].dest
      const left = Math.round(x * frame.scale + frame.x)
      const top = Math.round(y * frame.scale + frame.y)
      assert.ok(left >= 0 && top >= 0, `${name}/${id} clips its top or left`)
      assert.ok(left + Math.round(width * frame.scale) <= 256, `${name}/${id} clips right`)
      assert.ok(top + Math.round(height * frame.scale) <= 256, `${name}/${id} clips bottom`)
    }
  }
})
