import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPixels } from '../src/lib/pfp/render/pixels.ts'
import { DEFAULT_PFP, TRAITS, SLOTS, sanitizePfp, handlePfp } from '../src/lib/pfp/traits.ts'

test('every catalog trait renders distinctly, deterministically, with solid palette pixels', () => {
  let count = 0
  for (const slot of SLOTS) {
    const images = new Set()
    for (const trait of TRAITS[slot]) {
      const pfp = { ...DEFAULT_PFP, [slot]: trait.id }
      const a = renderPixels(pfp)
      assert.equal(a.width, 128)
      assert.equal(a.height, 128)
      assert.equal(a.data.length, 128 * 128 * 4)
      assert.deepEqual(a, renderPixels(pfp))
      for (let i = 3; i < a.data.length; i += 4) assert.equal(a.data[i], 255)
      images.add(Buffer.from(a.data).toString('base64'))
      count++
    }
    assert.equal(images.size, TRAITS[slot].length, `${slot} traits must be visually distinct`)
  }
  assert.equal(count, 89)
})
test('blocked and invalid combinations render exactly as their sanitized equivalents', () => {
  for (const raw of [
    { ...DEFAULT_PFP, eyes: 'laser', face: 'shades' },
    { ...DEFAULT_PFP, outfit: 'suit', neck: 'chain' },
    { ...DEFAULT_PFP, outfit: 'royal', neck: 'scarf' },
    { ...DEFAULT_PFP, skin: 'missing' },
  ]) assert.deepEqual(renderPixels(raw), renderPixels(sanitizePfp(raw)))
})
test('upscaling repeats complete source pixels exactly', () => {
  const source = renderPixels(DEFAULT_PFP)
  for (const size of [256, 512]) {
    const large = renderPixels(DEFAULT_PFP, size)
    assert.equal(large.width, size)
    assert.equal(large.height, size)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const a = (y * size + x) * 4
      const b = (Math.floor(y * 128 / size) * 128 + Math.floor(x * 128 / size)) * 4
      assert.deepEqual(large.data.subarray(a, a + 4), source.data.subarray(b, b + 4))
    }
  }
  assert.throws(() => renderPixels(DEFAULT_PFP, 127), /128|256|512/)
})

test('unblocked neck accessories remain distinct across every outfit', () => {
  for (const outfit of TRAITS.outfit.filter(trait => !trait.blocks?.includes('neck'))) {
    const images = new Set()
    for (const neck of TRAITS.neck) {
      const picture = renderPixels({ ...DEFAULT_PFP, outfit: outfit.id, neck: neck.id })
      // Only inspect the clothing/neck area, where each accessory belongs.
      images.add(Buffer.from(picture.data.subarray(105 * 128 * 4)).toString('base64'))
    }
    assert.equal(images.size, TRAITS.neck.length, `neck accessories must remain visible on ${outfit.id}`)
  }
})

const region = (picture, x, y, w, h) => Buffer.concat(Array.from({length:h}, (_, row) => Buffer.from(picture.data.subarray(((y+row)*128+x)*4, ((y+row)*128+x+w)*4)))).toString('base64')
test('legacy profiles keep their tongue and free rolls explore facial shapes', () => {
  assert.equal(sanitizePfp({eyes:'star'}).mouth, 'tongue')
  const rolls = Array.from({length:200}, (_,i) => handlePfp(`expression-${i}`))
  assert.ok(new Set(rolls.map(p => p.mouth)).size >= 5)
  for (const eyes of ['wink','sleepy','wide','happy']) assert.ok(rolls.some(p => p.eyes === eyes), eyes)
})
test('mouths and eye expressions differ inside their own facial regions', () => {
  for (const [slot, box, count] of [['mouth',[44,86,60,32],10], ['eyes',[46,44,63,41],16]]) {
    assert.equal(TRAITS[slot].length, count)
    const images = TRAITS[slot].map(t => region(renderPixels({...DEFAULT_PFP,[slot]:t.id}), ...box))
    assert.equal(new Set(images).size, count)
  }
})

test('halo and monocle leave the artwork beneath their open centers intact', async () => {
  const { Raster } = await import('../src/lib/pfp/render/raster.ts')
  const { drawHat, drawEyewear } = await import('../src/lib/pfp/render/pixel-gear.ts')
  for (const [draw, pfp, box] of [
    [drawHat, {...DEFAULT_PFP,head:'halo'}, [48,12,18,3]],
    [drawEyewear, {...DEFAULT_PFP,face:'monocle'}, [89,65,7,13]],
  ]) {
    const r = new Raster()
    r.rect(0,0,128,128,'#654321')
    const before = region(r,...box)
    draw(r,pfp)
    assert.equal(region(r,...box),before)
  }
})
