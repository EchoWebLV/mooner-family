// The head: a cratered moon with deep eye sockets and two spikes, measured off the Mooner logo (face turned ~12°
// to the viewer's right). Local coordinates: unit sphere at the origin.
import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  additive, canvasTexture, D2R, diamondShape, dir, extrude, frame, glowTexture, heartShape, quatOf, starShape,
  V, type Frame,
} from './kit'
import type { Eyes, Skin } from './look'

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

interface Oval {
  f: Frame
  sa: number
  sb: number
  t: number
}

export interface Eye extends Oval {
  star: number
}

export const EYE_SPOTS: Eye[] = [
  { lon: -8, lat: 1, a: 18, b: 23, tilt: 4, star: 0.11 },
  { lon: 33, lat: -3, a: 16.5, b: 21, tilt: 4, star: 0.095 },
].map((E) => ({
  f: frame(dir(E.lon, E.lat)), sa: Math.sin(E.a * D2R), sb: Math.sin(E.b * D2R), t: E.tilt * D2R, star: E.star,
}))

const CRATERS: Oval[] = [
  [18, 47, 6], [27, 36, 4.5], [-39, 31, 7.5], [-50, 3, 8], [-33, -26, 8.5], [47, -38, 5.5], [-80, 32, 9], [74, 26, 6],
  [-64, -48, 7], [100, -12, 8], [160, 20, 10], [-140, -20, 9], [130, 50, 7], [-110, -55, 8],
].map(([lon, lat, r]) => ({ f: frame(dir(lon, lat)), sa: Math.sin(r * D2R), sb: Math.sin(r * D2R), t: 0 }))

export const SPIKES = [
  { ang: 130, fwd: 0.3, h: 0.36, rb: 0.17 },
  { ang: 99, fwd: 0.16, h: 0.42, rb: 0.17 },
].map((S) => ({ ...S, d: V(Math.cos(S.ang * D2R), Math.sin(S.ang * D2R), S.fwd).normalize() }))

function oval(v: THREE.Vector3, F: Oval): number {
  if (v.dot(F.f.e) <= 0) return -1
  const x = v.dot(F.f.u), y = v.dot(F.f.w), c = Math.cos(F.t), s = Math.sin(F.t)
  return Math.hypot((x * c + y * s) / F.sa, (-x * s + y * c) / F.sb)
}

const SOCKET = 0.15, LENS_Z = 0.09, LENS_AT = 0.875

let shape: THREE.BufferGeometry | undefined
/** The displaced sphere, built once; `glow` holds the crater mask that colours it. */
function headShape(): THREE.BufferGeometry {
  if (shape) return shape
  let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, 320, 224)
  g.deleteAttribute('uv')
  g.deleteAttribute('normal')
  g = mergeVertices(g)
  const pos = g.attributes.position, n = pos.count, mask = new Float32Array(n), v = V(0, 0, 0)
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    let R = 1, cm = 0
    for (const E of EYE_SPOTS) {
      const r = oval(v, E)
      if (r < 0) continue
      R -= SOCKET * (1 - ss(0.72, 1.0, r))
      R += 0.016 * Math.exp(-(((r - 1.06) / 0.07) ** 2))
    }
    for (const C of CRATERS) {
      const r = oval(v, C)
      if (r < 0) continue
      R -= 0.045 * (1 - ss(0.45, 1.0, r))
      R += 0.012 * Math.exp(-(((r - 1.0) / 0.14) ** 2))
      cm = Math.max(cm, 1 - ss(0.78, 1.02, r))
    }
    pos.setXYZ(i, v.x * R, v.y * R, v.z * R)
    mask[i] = cm
  }
  g.setAttribute('glow', new THREE.BufferAttribute(mask, 1))
  g.computeVertexNormals()
  shape = g
  return g
}

/** The head for one skin: the shared shape with its own crater colours. */
export function headGeometry(skin: Skin): THREE.BufferGeometry {
  const base = headShape(), mask = base.attributes.glow.array as Float32Array
  const g = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'glow']) g.setAttribute(name, base.attributes[name])
  g.setIndex(base.index)
  const body = new THREE.Color(skin.body), crater = new THREE.Color(skin.crater), c = new THREE.Color()
  const col = new Float32Array(mask.length * 3)
  for (let i = 0; i < mask.length; i++) {
    c.copy(body).lerp(crater, mask[i])
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

export function skinParams(t: Skin): THREE.MeshPhysicalMaterialParameters {
  return {
    roughness: t.rough ?? 0.42,
    metalness: t.metal ?? 0,
    clearcoat: t.clearcoat ?? 0.5,
    clearcoatRoughness: 0.18,
    iridescence: t.irid ?? 0,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [180, 620],
    sheen: t.sheen ?? 0.25,
    sheenColor: new THREE.Color(t.sheenColor ?? '#ffffff'),
    sheenRoughness: 0.5,
    transmission: t.glass ?? 0,
    thickness: t.glass ? 0.9 : 0,
    ior: t.ior ?? 1.3,
    dispersion: t.dispersion ?? 0,
    attenuationColor: new THREE.Color(t.attn ?? '#ffffff'),
    attenuationDistance: t.glass ? 2.2 : Infinity,
    emissive: new THREE.Color(t.selfGlow ?? '#000000'),
    emissiveIntensity: t.selfGlow ? 0.35 : 0,
  }
}

/** The skin, with vertex colours; lava's craters glow through the `glow` attribute. */
export function skinMaterial(t: Skin): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ ...skinParams(t), vertexColors: true })
  if (t.glow) {
    m.emissive = new THREE.Color(t.glow)
    m.emissiveIntensity = t.glowI ?? 2
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow * vGlow;')
    }
    m.customProgramCacheKey = () => 'mooner-glow'
  }
  return m
}

export function spikes(skin: Skin): THREE.Mesh[] {
  const mat = new THREE.MeshPhysicalMaterial({ ...skinParams(skin), color: skin.body })
  return SPIKES.map((S) => {
    const pts: THREE.Vector2[] = []
    for (let i = 0; i <= 48; i++) {
      const y = -0.2 + ((S.h + 0.2) * i) / 48, k = Math.max(0, y) / S.h
      const r = S.rb * Math.pow(Math.max(0, 1 - k), 1.35) + 0.06 * Math.exp(-Math.max(y, 0) / 0.035)
      pts.push(new THREE.Vector2(Math.max(r, 0.0015), y))
    }
    pts.push(new THREE.Vector2(0, S.h + 0.004))
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), mat)
    m.quaternion.setFromUnitVectors(V(0, 1, 0), S.d)
    m.position.copy(S.d).multiplyScalar(0.965)
    return m
  })
}

/** Where each lens's front sits, for things that come out of the eyes. */
export interface EyeFront {
  E: Eye
  p: THREE.Vector3
}

let cosmicTex: THREE.CanvasTexture | undefined
function cosmicTexture(): THREE.CanvasTexture {
  if (cosmicTex) return cosmicTex
  cosmicTex = canvasTexture(256, 256, (x) => {
    const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128)
    gr.addColorStop(0, '#ffffff')
    gr.addColorStop(0.12, '#ff7ad9')
    gr.addColorStop(0.45, '#6b2bd9')
    gr.addColorStop(0.8, '#140a3a')
    gr.addColorStop(1, '#05030f')
    x.fillStyle = gr
    x.fillRect(0, 0, 256, 256)
    // two spiral arms of specks
    let s = 11
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 420; i++) {
      const arm = i % 2, t = rnd(), a = arm * Math.PI + t * 4.2, r = 10 + t * 110 + (rnd() - 0.5) * 16
      x.globalAlpha = 0.25 + rnd() * 0.6
      x.fillStyle = rnd() < 0.3 ? '#9ff3ff' : '#ffffff'
      x.beginPath()
      x.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 0.6 + rnd() * 1.6, 0, Math.PI * 2)
      x.fill()
    }
    x.globalAlpha = 1
  })
  cosmicTex.userData.keep = true
  return cosmicTex
}

export function eyes(t: Eyes, fronts: EyeFront[]): THREE.Group {
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: t.lens ?? '#06060b', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03,
    emissive: new THREE.Color(t.lensGlow ?? '#000000'), emissiveIntensity: t.lensGlow ? 0.35 : 0,
  })
  const sparkMat = new THREE.MeshStandardMaterial({ color: t.color, emissive: new THREE.Color(t.color), emissiveIntensity: 0.85, roughness: 0.25 })
  const g = new THREE.Group()
  for (const E of EYE_SPOTS) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), lensMat)
    lens.scale.set(E.sa * 0.9, E.sb * 0.9, LENS_Z)
    lens.quaternion.copy(quatOf(E.f, E.t))
    const center = E.f.e.clone().multiplyScalar(LENS_AT).addScaledVector(E.f.u, -0.1 * E.sa)
    lens.position.copy(center)
    g.add(lens)
    // The glint sits on the lens, or on the galaxy that covers it.
    const front = center.clone().addScaledVector(E.f.e, LENS_Z * (t.cosmic ? 1.06 : 0.93))
    fronts.push({ E, p: front })
    if (t.cosmic) {
      // A galaxy lying on the lens's front, following its curve: rings of points, so no flat face sinks under the lens.
      const geo = new THREE.RingGeometry(0, 1, 48, 12)
      const p = geo.attributes.position
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) * 0.86, y = p.getY(i) * 0.86
        p.setXYZ(i, x * E.sa * 0.9, y * E.sb * 0.9, LENS_Z * 1.015 * Math.sqrt(Math.max(0, 1 - x * x - y * y)))
      }
      geo.computeVertexNormals()
      const disc = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: cosmicTexture(), toneMapped: false }))
      disc.quaternion.copy(quatOf(E.f, E.t))
      disc.position.copy(center)
      g.add(disc)
    }
    if (t.glint === 'none') continue
    const glint = t.glint === 'heart' ? heartShape(E.star * 0.9) : t.glint === 'diamond' ? diamondShape(E.star * 1.05) : starShape(E.star)
    const spark = new THREE.Mesh(extrude(glint, 0.012, 0.008), sparkMat)
    spark.quaternion.copy(quatOf(E.f, E.t))
    spark.position.copy(front)
    g.add(spark)
    // A small round catch-light, upper left of the lens.
    const dot = new THREE.Mesh(new THREE.SphereGeometry(E.star * 0.22, 20, 14), sparkMat)
    dot.position.copy(center).addScaledVector(E.f.u, -E.sa * 0.45).addScaledVector(E.f.w, E.sb * 0.5).addScaledVector(E.f.e, LENS_Z * 0.72)
    dot.scale.set(1, 1, 0.4)
    dot.quaternion.copy(quatOf(E.f))
    g.add(dot)
  }
  return g
}

export function laser(fronts: EyeFront[], color = '#ff2a2a'): THREE.Group {
  const g = new THREE.Group()
  const dirs = [V(-0.8, -0.08, 0.6).normalize(), V(0.88, -0.08, 0.47).normalize()]
  fronts.forEach(({ E, p }, i) => {
    const d = dirs[i], L = 7
    for (const [r0, r1, c, op] of [[0.07, 0.5, color, 0.28], [0.04, 0.22, color, 0.85], [0.016, 0.06, '#ffffff', 1]] as const) {
      const geo = new THREE.CylinderGeometry(r1, r0, L, 24, 1, true)
      geo.translate(0, L / 2, 0)
      const beam = new THREE.Mesh(geo, additive(c, op))
      beam.quaternion.setFromUnitVectors(V(0, 1, 0), d)
      beam.position.copy(p)
      g.add(beam)
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(E.star * 0.75, 24, 16), new THREE.MeshBasicMaterial({ color: '#fff4f0', toneMapped: false }))
    orb.position.copy(p)
    g.add(orb)
    for (const [s, op, c] of [[0.9, 0.9, color], [0.45, 1, '#ffffff']] as const) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false,
        depthTest: false, toneMapped: false,
      }))
      sp.scale.setScalar(s)
      sp.position.copy(p).addScaledVector(E.f.e, 0.05)
      g.add(sp)
    }
  })
  return g
}
