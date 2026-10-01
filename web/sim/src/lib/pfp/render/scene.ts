// Puts a Mooner together: background, lights, the head with its eyes and gear, the bust, and the camera.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Pfp } from '../../types'
import { buildBust } from './bust'
import { AURAS, EYEWEAR, HEADWEAR, HIDES_SPIKES, NECKWEAR } from './gear'
import { eyes, headGeometry, laser, skinMaterial, spikes, type EyeFront } from './head'
import { canvasTexture } from './kit'
import { lookOf, PALETTES, type Palette } from './look'

/** Where the head sits over the bust. */
const HEAD_Y = 0.36
/** The bust sits a little high, so the face-close camera still shows what it wears. */
const BUST_Y = 0.1

// ---------------- backgrounds ----------------

type Ctx = CanvasRenderingContext2D
const S = 1024

function rng(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function sparkle(x: Ctx, px: number, py: number, r: number) {
  x.beginPath()
  x.moveTo(px, py - r)
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) x.quadraticCurveTo(px, py, px + dx * r, py + dy * r)
  x.fill()
}

function stars(x: Ctx, n: number, seed = 7) {
  const r = rng(seed)
  x.fillStyle = '#ffffff'
  for (let i = 0; i < n; i++) {
    const px = r() * S, py = r() * S, rad = 0.8 + r() * 2.2
    x.globalAlpha = 0.35 + r() * 0.5
    x.beginPath()
    x.arc(px, py, rad, 0, Math.PI * 2)
    x.fill()
  }
  x.globalAlpha = 0.9
  for (const [px, py, rad] of [[150, 190, 16], [880, 150, 12], [900, 820, 14], [120, 860, 10]]) sparkle(x, px, py, rad)
  x.globalAlpha = 1
}

function neon(x: Ctx, p: Palette) {
  // A synthwave floor: a glowing horizon and a grid running toward it.
  const hy = 640
  const sun = x.createLinearGradient(0, 180, 0, hy)
  sun.addColorStop(0, '#ffd23b')
  sun.addColorStop(1, p.accent)
  x.save()
  x.globalAlpha = 0.85
  x.fillStyle = sun
  x.beginPath()
  x.arc(512, hy, 380, Math.PI, 0)
  x.fill()
  x.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 7; i++) x.fillRect(0, hy - 40 - i * 46, S, 8 + i * 2.4)
  x.restore()
  const floor = x.createLinearGradient(0, hy, 0, S)
  floor.addColorStop(0, '#1a0033')
  floor.addColorStop(1, p.bg)
  x.fillStyle = floor
  x.fillRect(0, hy, S, S - hy)
  x.strokeStyle = p.cloth
  x.shadowColor = p.cloth
  x.shadowBlur = 18
  x.lineWidth = 3
  for (let i = -12; i <= 12; i++) {
    x.beginPath()
    x.moveTo(512 + i * 12, hy)
    x.lineTo(512 + i * 150, S)
    x.stroke()
  }
  for (let k = 1; k < 9; k++) {
    const y = hy + (S - hy) * (k / 9) ** 1.8
    x.beginPath()
    x.moveTo(0, y)
    x.lineTo(S, y)
    x.stroke()
  }
  x.shadowBlur = 0
  x.fillStyle = p.accent
  x.fillRect(0, hy - 2, S, 4)
}

function vault(x: Ctx) {
  // Light falling on piles of gold coins.
  const r = rng(29)
  x.save()
  x.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 5; i++) {
    const g = x.createLinearGradient(0, 0, 0, S)
    g.addColorStop(0, 'rgba(255,214,120,0.16)')
    g.addColorStop(1, 'rgba(255,214,120,0)')
    x.fillStyle = g
    const cx = 120 + i * 200
    x.beginPath()
    x.moveTo(cx - 30, 0)
    x.lineTo(cx + 30, 0)
    x.lineTo(cx + 170, S)
    x.lineTo(cx - 10, S)
    x.fill()
  }
  x.restore()
  const coin = (cx: number, cy: number, rad: number, tilt: number) => {
    x.save()
    x.translate(cx, cy)
    x.scale(1, tilt)
    const g = x.createRadialGradient(-rad * 0.3, -rad * 0.3, rad * 0.1, 0, 0, rad)
    g.addColorStop(0, '#fff1b8')
    g.addColorStop(0.5, '#ffc53d')
    g.addColorStop(1, '#a8680a')
    x.fillStyle = g
    x.beginPath()
    x.arc(0, 0, rad, 0, Math.PI * 2)
    x.fill()
    x.strokeStyle = 'rgba(120,70,0,0.6)'
    x.lineWidth = rad * 0.08
    x.beginPath()
    x.arc(0, 0, rad * 0.78, 0, Math.PI * 2)
    x.stroke()
    x.fillStyle = 'rgba(255,245,210,0.8)'
    sparkle(x, 0, 0, rad * 0.45)
    x.restore()
  }
  for (let i = 0; i < 60; i++) {
    const side = i % 2 ? 1 : -1, px = 512 + side * (300 + r() * 260), py = 560 + r() * 480
    coin(px, py, 26 + r() * 30, 0.35 + r() * 0.3)
  }
  for (let i = 0; i < 14; i++) coin(r() * S, r() * 360, 12 + r() * 14, 0.9 + r() * 0.1)
}

function galaxy(x: Ctx, p: Palette) {
  const r = rng(13)
  x.save()
  x.globalCompositeOperation = 'lighter'
  for (const [cx, cy, rad, c] of [[260, 300, 420, '#7a2bd9'], [800, 700, 380, '#ff4fb8'], [700, 220, 300, '#2b6bff']] as const) {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, c + '88')
    g.addColorStop(1, c + '00')
    x.fillStyle = g
    x.fillRect(0, 0, S, S)
  }
  // Two spiral arms of specks around the middle.
  for (let i = 0; i < 2600; i++) {
    const arm = i % 2, t = r(), a = arm * Math.PI + t * 5.2, rad = 30 + t * 620 + (r() - 0.5) * 70
    x.globalAlpha = 0.2 + r() * 0.7
    x.fillStyle = r() < 0.3 ? p.accent : '#ffffff'
    x.beginPath()
    x.arc(512 + Math.cos(a) * rad, 470 + Math.sin(a) * rad * 0.62, 0.6 + r() * 1.8, 0, Math.PI * 2)
    x.fill()
  }
  x.restore()
  stars(x, 90, 17)
}

function aurora(x: Ctx) {
  // Curtains of light hanging over the horizon.
  x.save()
  x.globalCompositeOperation = 'lighter'
  x.filter = 'blur(14px)'
  const bands: [string, number, number][] = [['#3dff9e', 260, 0], ['#39d3ff', 330, 1.7], ['#b36bff', 210, 3.1]]
  for (const [c, top, ph] of bands) {
    for (let px = -20; px < S + 20; px += 6) {
      const wave = Math.sin(px * 0.006 + ph) * 90 + Math.sin(px * 0.017 + ph * 2) * 30
      const y0 = top + wave, h = 260 + Math.sin(px * 0.011 + ph) * 90
      const g = x.createLinearGradient(0, y0, 0, y0 + h)
      g.addColorStop(0, c + '00')
      g.addColorStop(0.7, c + '55')
      g.addColorStop(1, c + '00')
      x.fillStyle = g
      x.fillRect(px, y0, 7, h)
    }
  }
  x.restore()
  stars(x, 60, 23)
}

const bgCache = new Map<string, THREE.CanvasTexture>()
function background(id: string, p: Palette): THREE.CanvasTexture {
  let tex = bgCache.get(id)
  if (tex) return tex
  tex = canvasTexture(S, S, (x) => {
    const g = x.createRadialGradient(512, 470, 40, 512, 512, 760)
    g.addColorStop(0, p.bg2)
    g.addColorStop(1, p.bg)
    x.fillStyle = g
    x.fillRect(0, 0, S, S)
    if (p.art === 'neon') neon(x, p)
    else if (p.art === 'vault') vault(x)
    else if (p.art === 'galaxy') galaxy(x, p)
    else if (p.art === 'aurora') aurora(x)
    else if (p.stars) stars(x, 70)
  })
  tex.userData.keep = true
  bgCache.set(id, tex)
  return tex
}

// ---------------- renderer ----------------

export interface Stage {
  renderer: THREE.WebGLRenderer
  env: THREE.Texture
}

/** One renderer for every picture; the canvas is drawn at `px` and read back from. */
export function makeStage(px: number): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
  renderer.setPixelRatio(1)
  renderer.setSize(px, px, false)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  const pm = new THREE.PMREMGenerator(renderer)
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
  pm.dispose()
  return { renderer, env }
}

export function buildScene(stage: Stage, pfp: Pfp): { scene: THREE.Scene; cam: THREE.PerspectiveCamera } {
  const look = lookOf(pfp), p = look.palette
  const scene = new THREE.Scene()
  // The background's own palette: `p.cloth` may have moved off the skin colour, and backgrounds are cached per id.
  scene.background = background(pfp.bg, PALETTES[pfp.bg] ?? p)
  scene.environment = stage.env
  scene.environmentIntensity = look.skin.env ?? 0.75

  const key = new THREE.DirectionalLight('#fff6ea', 2.4)
  key.position.set(-3.2, 4, 5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.02
  Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 1, far: 15 })
  scene.add(key)
  const rim = new THREE.DirectionalLight(p.rim, 2.2)
  rim.position.set(4, 2.5, -4)
  scene.add(rim)
  const fill = new THREE.DirectionalLight('#ffffff', 0.5)
  fill.position.set(3, -2, 4)
  scene.add(fill)

  const head = new THREE.Group()
  const skin = skinMaterial(look.skin)
  head.add(new THREE.Mesh(headGeometry(look.skin), skin))
  if (!HIDES_SPIKES.has(pfp.head)) head.add(...spikes(look.skin))
  const fronts: EyeFront[] = []
  head.add(eyes(look.eyes, fronts))
  if (look.eyes.laser) head.add(laser(fronts))
  const hat = HEADWEAR[pfp.head]
  if (hat) head.add(hat(look))
  const glasses = EYEWEAR[pfp.face]
  if (glasses) head.add(glasses(look))
  head.position.y = HEAD_Y

  const bust = buildBust(look, skin)
  bust.group.position.y = BUST_Y
  const neck = NECKWEAR[pfp.neck]
  if (neck) bust.group.add(neck(look, bust.surface))

  const char = new THREE.Group()
  char.add(head, bust.group)
  char.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o.material as THREE.Material).transparent) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  const aura = AURAS[pfp.aura]
  if (aura) char.add(aura(look))
  scene.add(char)

  const cam = new THREE.PerspectiveCamera(27, 1, 0.1, 100)
  cam.position.set(0, 0.5, 5.95)
  cam.lookAt(0, 0.42, 0)
  return { scene, cam }
}

/** Frees what one picture made, keeping the shared caches (marked `userData.keep`). Materials are left for the
 *  garbage collector so their compiled shaders stay warm for the next picture. */
export function disposeScene(scene: THREE.Scene) {
  const seen = new Set<unknown>()
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry && !m.geometry.userData.keep && !seen.has(m.geometry)) {
      seen.add(m.geometry)
      m.geometry.dispose()
    }
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []
    for (const mat of mats) {
      for (const v of Object.values(mat)) {
        if (v instanceof THREE.Texture && !v.userData.keep && !seen.has(v)) {
          seen.add(v)
          v.dispose()
        }
      }
    }
  })
}
