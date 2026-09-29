// Lossless PNG adapter for the shared, integer-grid pixel artist.
import type { Pfp } from '../../types'
import { renderPixels } from './pixels'
export { renderPixels } from './pixels'
/** Renders at an exact integer multiple of the 128 × 128 art grid. */
export async function renderPfp(pfp: Pfp, px: number): Promise<Blob> {
  const picture = renderPixels(pfp, px)
  const canvas = document.createElement('canvas')
  canvas.width = picture.width
  canvas.height = picture.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not draw the picture')
  const image = context.createImageData(px, px)
  image.data.set(picture.data)
  context.putImageData(image, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the picture')), 'image/png'),
  )
}
