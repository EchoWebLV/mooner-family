/** Rebuild with: node art/mooner/prepare.mjs. See README.md for registration rules. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../web/package.json', import.meta.url))
const { PNG } = require('pngjs')
const root = path.dirname(fileURLToPath(import.meta.url))
const target = path.resolve(root, '../../web/src/lib/pfp/render')
const specs = JSON.parse(fs.readFileSync(path.join(root, 'sprites.json'), 'utf8'))
const sources = new Map()
const CELL_SIZE = 256
const ATLAS_COLUMNS = 4

for (const spec of specs) {
  if (sources.has(spec.file)) continue
  const picture = PNG.sync.read(fs.readFileSync(path.join(root, 'source', spec.file + '.png')))
  const hasTransparency = picture.data.some((value, index) => index % 4 === 3 && value === 0)
  if (!spec.opaque && !hasTransparency) throw new Error(spec.file + ' must have real transparency')
  sources.set(spec.file, picture)
}

/** Remove small disconnected fragments from adjacent generated sheet cells. */
function componentMask(picture, bounds, exclusions, polygon = []) {
  const [left, top, right, bottom] = bounds
  const mask = new Uint8Array(picture.width * picture.height)
  const components = []
  const isExcluded = (x, y) => {
    if (exclusions.some(([l, t, r, b]) => x >= l && x < r && y >= t && y < b)) return true
    if (!polygon.length) return false
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j]
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
    }
    return !inside
  }

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const start = y * picture.width + x
      if (mask[start] || isExcluded(x, y) || picture.data[start * 4 + 3] <= 8) continue
      const queue = [start]
      mask[start] = 1
      for (let current = 0; current < queue.length; current++) {
        const position = queue[current]
        const currentX = position % picture.width
        const currentY = Math.floor(position / picture.width)
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            const nextX = currentX + offsetX
            const nextY = currentY + offsetY
            const next = nextY * picture.width + nextX
            if (nextX < left || nextX >= right || nextY < top || nextY >= bottom) continue
            if (mask[next] || isExcluded(nextX, nextY) || picture.data[next * 4 + 3] <= 8) continue
            mask[next] = 1
            queue.push(next)
          }
        }
      }
      components.push(queue)
    }
  }
  const largestArea = Math.max(0, ...components.map(component => component.length))
  mask.fill(0)
  for (const component of components) {
    if (component.length >= largestArea * 0.012) {
      for (const index of component) mask[index] = 1
    }
  }
  return mask
}

const atlas = new PNG({
  width: ATLAS_COLUMNS * CELL_SIZE,
  height: Math.ceil(specs.length / ATLAS_COLUMNS) * CELL_SIZE,
})
const manifest = {}

// Neutral outer socket pixels belong to the moon, while the pupil and sclera
// inside the paired anatomical eye ellipses retain their authored colors.
function skinRimRuns(atlasX, atlasY, width, height, id) {
  const selected = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = ((atlasY + y) * atlas.width + atlasX + x) * 4
    const channels = atlas.data.subarray(i, i + 3)
    const low = Math.min(...channels), high = Math.max(...channels)
    const u = x / width, v = y / height
    const nearEye = ((u - 0.29) / 0.29) ** 2 + ((v - 0.45) / 0.49) ** 2
    const farEye = ((u - 0.80) / 0.205) ** 2 + ((v - 0.665) / 0.335) ** 2
    const isOuterSocket = nearEye > 0.48 && farEye > 0.48
    const isLid = ['eyes/sleepy', 'eyes/angry'].includes(id) && high < 232
    if (atlas.data[i + 3] > 8 && low > 65 && high - low < 22 && (isOuterSocket || isLid)) selected[y * width + x] = 1
  }
  const runs = []
  for (let i = 0; i < selected.length; i++) {
    if (!selected[i]) continue
    const start = i
    while (selected[i + 1]) i++
    runs.push([start, i - start + 1])
  }
  return runs
}

for (const [index, spec] of specs.entries()) {
  if (manifest[spec.id]) throw new Error('Duplicate sprite: ' + spec.id)
  const picture = sources.get(spec.file)
  const sourceScale = picture.width / 1280
  const bounds = spec.crop.map(value => Math.round(value * sourceScale))
  const exclusions = (spec.exclude || []).map(rectangle => rectangle.map(value => Math.round(value * sourceScale)))
  const [left, top, right, bottom] = bounds
  if (left < 0 || top < 0 || right > picture.width || bottom > picture.height) {
    throw new Error('Source rectangle outside picture: ' + spec.id)
  }
  const polygon = (spec.includePolygon || []).map(point => point.map(value => Math.round(value * sourceScale)))
  const allowed = componentMask(picture, bounds, exclusions, polygon)
  let minX = right, minY = bottom, maxX = left, maxY = top
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (!allowed[y * picture.width + x]) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('Empty sprite: ' + spec.id)
  const sourceWidth = maxX - minX + 1
  const sourceHeight = maxY - minY + 1
  let [destinationX, destinationY, width, height] = spec.dest
  if (!spec.stretch) {
    const ratio = Math.min(width / sourceWidth, height / sourceHeight)
    width = Math.max(1, Math.round(sourceWidth * ratio))
    height = Math.max(1, Math.round(sourceHeight * ratio))
  }
  if (width > CELL_SIZE || height > CELL_SIZE) throw new Error('Sprite exceeds atlas cell: ' + spec.id)
  if (spec.align === 'bottom') destinationY += spec.dest[3] - height
  if (spec.centerX) destinationX += Math.round((spec.dest[2] - width) / 2)
  const atlasX = index % ATLAS_COLUMNS * CELL_SIZE
  const atlasY = Math.floor(index / ATLAS_COLUMNS) * CELL_SIZE

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = minX + Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / width))
      const sourceY = minY + Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / height))
      if (!allowed[sourceY * picture.width + sourceX]) continue
      const sourceIndex = (sourceY * picture.width + sourceX) * 4
      const atlasIndex = ((atlasY + y) * atlas.width + atlasX + x) * 4
      picture.data.copy(atlas.data, atlasIndex, sourceIndex, sourceIndex + 4)
    }
  }
  manifest[spec.id] = {
    source: [atlasX, atlasY, width, height],
    dest: [destinationX, destinationY, width, height],
    crop: [minX, minY, sourceWidth, sourceHeight],
    ...(spec.skinRim ? { skinMask: skinRimRuns(atlasX, atlasY, width, height, spec.id) } : {}),
  }
}

fs.mkdirSync(path.join(target, 'assets'), { recursive: true })
fs.writeFileSync(path.join(target, 'assets/atlas.png'), PNG.sync.write(atlas))
fs.writeFileSync(path.join(target, 'sprite-manifest.ts'),
  '// Generated by art/mooner/prepare.mjs. Edit art/mooner/sprites.json.\n' +
  'export const SPRITE_MANIFEST = ' + JSON.stringify(manifest, null, 2) + ' as const\n',
)
console.log(`Prepared ${specs.length} sprites into ${atlas.width}×${atlas.height} atlas`)
