// Shared studio renderer. A private queue also protects direct callers outside the picture cache.
import type { Pfp } from '../../types'
import { sanitizePfp } from '../traits'
import { buildScene, disposeScene, makeStage, type Stage } from './scene'
let stage: Stage | undefined
let stageInvalid = false
let pending: Promise<unknown> = Promise.resolve()
export function renderPfp(pfp: Pfp, px: number): Promise<Blob> {
  if (![128, 256, 512].includes(px)) return Promise.reject(new RangeError('Unsupported portrait size'))
  const choice = sanitizePfp(pfp)
  const next = pending.then(() => draw(choice, px))
  pending = next.catch(() => {})
  return next
}
async function draw(pfp: Pfp, px: number): Promise<Blob> {
  const resolution = Math.max(512, px * 2)
  if (!stage || stageInvalid || stage.renderer.getContext().isContextLost()) {
    if (stage) { stage.environmentTarget.dispose(); stage.renderer.dispose() }
    stage = makeStage(resolution)
    stageInvalid = false
    const currentStage = stage
    stage.renderer.domElement.addEventListener('webglcontextlost', () => {
      if (stage === currentStage) stageInvalid = true
    })
  }
  stage.renderer.setSize(resolution, resolution, false)
  const {scene, cam} = buildScene(stage, pfp)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const context = canvas.getContext('2d')
  if (!context) { disposeScene(scene); throw new Error('Could not draw the picture') }
  try {
    stage.renderer.render(scene, cam)
    if (stageInvalid || stage.renderer.getContext().isContextLost()) {
      stageInvalid = true
      throw new Error('The graphics context was interrupted. Please try the picture again.')
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(stage.renderer.domElement, 0, 0, px, px)
  } finally { disposeScene(scene) }
  return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the picture')), 'image/png'))
}
