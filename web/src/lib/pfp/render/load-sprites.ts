import type { SpriteAtlas } from './sprites'
let pending: Promise<SpriteAtlas> | undefined
/** One decode for all avatar combinations, shared by the app and simulation. */
export function loadSprites(): Promise<SpriteAtlas> {
  if (!pending) {
    pending = new Promise<SpriteAtlas>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth
          canvas.height = image.naturalHeight
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (!context) throw new Error('Could not load character artwork')
          context.drawImage(image, 0, 0)
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
          resolve({ width: canvas.width, height: canvas.height, data: pixels.data })
        } catch (error) { reject(error) }
      }
      image.onerror = () => reject(new Error('Could not load character artwork'))
      image.src = new URL('./assets/atlas.png', import.meta.url).href
    }).catch(error => { pending = undefined; throw error })
  }
  return pending
}
