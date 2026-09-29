// Things a Mooner wears: headwear and eyewear sit on the head (head-local, unit sphere at the origin); neck items
// sit on the bust's outer surface; auras float around the whole figure.
import * as THREE from 'three'
import {
  additive, bulge, canvasTexture, cloth, D2R, dir, extrude, glowTexture, gold, heartShape, metal, mix, plastic, quatOf,
  rrect, starShape, taperTube, V,
} from './kit'
import { EYE_SPOTS, SPIKES } from './head'
import { neckRing, frontOf } from './bust'
import type { Look } from './look'
import type { Field } from './sdf'

const { sin, cos, abs, max, PI } = Math

// ---------------- headwear ----------------

/** Hats lean a little back and to the left, off the face. */
const TOP = V(-0.08, 1, -0.06).normalize()

/** A dome cap shell of the given radius, open at the bottom, as a lathe profile. */
function dome(R: number, h: number, lip = 0): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * (PI / 2)
    pts.push(new THREE.Vector2(R * cos(a) + lip * (1 - i / 32) ** 6, h * sin(a)))
  }
  return new THREE.LatheGeometry(pts, 192)
}

function beanie(look: Look): THREE.Group {
  const g = new THREE.Group(), c = look.palette.cloth
  const knit = cloth(c, mix(c, '#ffffff', 0.5))
  const shellGeo = dome(0.87, 0.56)
  const shellPosition = shellGeo.attributes.position
  for (let i = 0; i < shellPosition.count; i++) {
    const x = shellPosition.getX(i), y = shellPosition.getY(i), z = shellPosition.getZ(i)
    const a = Math.atan2(x, z), k = 1 + 0.009 * Math.cos(a * 48) * (1 - (y / 0.56) ** 3)
    shellPosition.setXYZ(i, x * k, y, z * k)
  }
  shellGeo.computeVertexNormals()
  const shell = new THREE.Mesh(shellGeo, knit)
  shell.position.y = 0.14
  g.add(shell)
  // Ribbed cuff: a thick band with vertical ribs.
  const cuffGeo = new THREE.CylinderGeometry(0.885, 0.955, 0.2, 96, 4, true)
  const p = cuffGeo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), a = Math.atan2(x, z), k = 1 + 0.012 * cos(a * 48)
    p.setXYZ(i, x * k, p.getY(i), z * k)
  }
  cuffGeo.computeVertexNormals()
  const cuff = new THREE.Mesh(cuffGeo, cloth(mix(c, '#000000', 0.18), mix(c, '#ffffff', 0.4)))
  cuff.material.side = THREE.DoubleSide
  cuff.position.y = 0.1
  g.add(cuff)
  const badgeTexture = canvasTexture(512, 128, x => {
    x.fillStyle = '#181922'; x.fillRect(0, 0, 512, 128)
    x.strokeStyle = '#5b5a68'; x.lineWidth = 5; x.strokeRect(7, 7, 498, 114)
    x.fillStyle = '#f5f2ed'; x.font = 'bold 70px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('MOONER', 256, 68)
  })
  const badgeGeo = bulge(extrude(rrect(0.5, 0.12, 0.014), 0.006, 0.004), 0.55)
  const badgeUV = badgeGeo.attributes.uv, badgePosition = badgeGeo.attributes.position
  for (let i = 0; i < badgeUV.count; i++) badgeUV.setXY(i, badgePosition.getX(i) / 0.5 + 0.5, badgePosition.getY(i) / 0.12 + 0.5)
  const badge = new THREE.Mesh(badgeGeo, new THREE.MeshStandardMaterial({ map: badgeTexture, roughness: 0.92 }))
  badge.position.set(0, 0.085, 0.959)
  g.add(badge)
  const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 4), cloth(look.palette.accent, '#ffffff'))
  const pp = pom.geometry.attributes.position
  for (let i = 0; i < pp.count; i++) {
    const v = V(pp.getX(i), pp.getY(i), pp.getZ(i)), k = 1 + 0.08 * sin(v.x * 90) * sin(v.y * 83) * sin(v.z * 77)
    pp.setXYZ(i, v.x * k, v.y * k, v.z * k)
  }
  pom.geometry.computeVertexNormals()
  pom.position.y = 0.76
  g.add(pom)
  g.quaternion.setFromUnitVectors(V(0, 1, 0), TOP)
  g.position.copy(TOP).multiplyScalar(0.38)
  return g
}

function party(look: Look): THREE.Group {
  const g = new THREE.Group(), H = 0.5, R = 0.24
  const tex = canvasTexture(256, 256, (x) => {
    x.fillStyle = look.palette.cloth
    x.fillRect(0, 0, 256, 256)
    // Some palettes choose white cloth and white trim after skin-contrast correction.
    // A festive hat still needs visible stripes in that valid combination.
    const a = new THREE.Color(look.palette.cloth), b = new THREE.Color(look.palette.accent)
    const contrast = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
    x.strokeStyle = contrast < 0.32 ? '#7352df' : look.palette.accent
    x.lineWidth = 22
    for (let i = -256; i < 512; i += 64) {
      x.beginPath()
      x.moveTo(i, 256)
      x.lineTo(i + 256, 0)
      x.stroke()
    }
  })
  const cone = new THREE.Mesh(new THREE.ConeGeometry(R, H, 64, 1, true), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.45, clearcoat: 0.6, side: THREE.DoubleSide }))
  cone.position.y = H / 2
  g.add(cone)
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), cloth('#ffffff'))
  pom.position.y = H + 0.03
  g.add(pom)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.022, 12, 64), cloth('#ffffff'))
  rim.rotation.x = PI / 2
  g.add(rim)
  const d = dir(34, 52)
  g.quaternion.setFromUnitVectors(V(0, 1, 0), d)
  g.rotateY(0.4)
  g.position.copy(d).multiplyScalar(0.94)
  return g
}

function cap(look: Look): THREE.Group {
  const g = new THREE.Group(), c = look.palette.cloth
  const mat = cloth(c, mix(c, '#ffffff', 0.5))
  const crown = new THREE.Mesh(dome(0.92, 0.6), mat)
  g.add(crown)
  const btn = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 12), mat)
  btn.position.y = 0.59
  btn.scale.y = 0.5
  g.add(btn)
  // Seams from the button down.
  const seamMat = cloth(mix(c, '#000000', 0.3))
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * PI * 2, pts: THREE.Vector3[] = []
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * (PI / 2)
      pts.push(V(0.925 * cos(t) * sin(a), 0.605 * sin(t), 0.925 * cos(t) * cos(a)))
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.008, 6), seamMat))
  }
  // Brim: a flat, slightly curved half-disc sticking forward.
  const brim = new THREE.Shape()
  brim.absarc(0, 0, 0.98, PI * 0.08, PI * 0.92, false)
  brim.absarc(0, 0.6, 0.7, PI * 0.88, PI * 0.12, true)
  const bg = extrude(brim, 0.03, 0.012, 48)
  const bp = bg.attributes.position
  for (let i = 0; i < bp.count; i++) bp.setZ(i, bp.getZ(i) - 0.28 * bp.getX(i) ** 2)
  bg.computeVertexNormals()
  const b = new THREE.Mesh(bg, mat)
  b.rotation.x = -PI / 2 + 0.12
  b.rotation.z = PI
  b.position.set(0, 0.04, 0.05)
  const holder = new THREE.Group()
  holder.add(b)
  holder.rotation.y = 12 * D2R
  g.add(holder)
  const d = V(0, 1, -0.02).normalize()
  g.quaternion.setFromUnitVectors(V(0, 1, 0), d)
  g.position.copy(d).multiplyScalar(0.44)
  return g
}

function headphones(look: Look): THREE.Group {
  const g = new THREE.Group()
  const shell = plastic(look.palette.accent)
  const dark = cloth('#1a1622', '#554466')
  const R = 1.2
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.06, 24, 160, PI), shell))
  const pad = new THREE.Mesh(new THREE.TorusGeometry(R - 0.055, 0.045, 16, 120, PI * 0.5), dark)
  pad.rotation.z = PI * 0.25
  g.add(pad)
  const prof: THREE.Vector2[] = [], cupR = 0.3, cupH = 0.2, rr = 0.07
  prof.push(new THREE.Vector2(0.001, -cupH / 2))
  for (let i = 0; i <= 12; i++) {
    const a = -PI / 2 + (i / 12) * (PI / 2)
    prof.push(new THREE.Vector2(cupR - rr + rr * cos(a), -cupH / 2 + rr + rr * sin(a)))
  }
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * (PI / 2)
    prof.push(new THREE.Vector2(cupR - rr + rr * cos(a), cupH / 2 - rr + rr * sin(a)))
  }
  prof.push(new THREE.Vector2(0.001, cupH / 2))
  const cupGeo = new THREE.LatheGeometry(prof, 64)
  for (const s of [-1, 1]) {
    const cup = new THREE.Mesh(cupGeo, shell)
    cup.rotation.z = PI / 2
    cup.position.x = s * (R + 0.02)
    g.add(cup)
    const cush = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 20, 48), dark)
    cush.rotation.y = PI / 2
    cush.position.x = s * (R - 0.1)
    g.add(cush)
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 16), shell)
    arm.position.set(s * R, 0.22, 0)
    g.add(arm)
    const logo = new THREE.Mesh(extrude(starShape(0.1), 0.01, 0.005), metal('#ffffff', 0.2))
    logo.rotation.y = s * (PI / 2)
    logo.position.x = s * (R + 0.13)
    g.add(logo)
  }
  g.rotation.set(-22 * D2R, 12 * D2R, 0, 'YXZ')
  g.position.y = 0.02
  return g
}

function horns(): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshPhysicalMaterial({ color: '#2a0d10', roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.3, sheenColor: new THREE.Color('#ff5a3a') })
  for (const [lon, lat, s] of [[-33, 42, -1], [57, 42, 1]] as const) {
    const base = dir(lon, lat)
    const out = V(s * 0.9, 0.7, 0.1).normalize()
    const pts = [
      base.clone().multiplyScalar(0.9),
      base.clone().multiplyScalar(1.08).addScaledVector(out, 0.08),
      base.clone().multiplyScalar(1.12).addScaledVector(out, 0.22).add(V(0, 0.1, 0)),
      base.clone().multiplyScalar(1.05).addScaledVector(out, 0.3).add(V(-s * 0.02, 0.3, 0.06)),
    ]
    const curve = new THREE.CatmullRomCurve3(pts)
    g.add(new THREE.Mesh(taperTube(curve, 0.13, 0.008, 64, 24), mat))
    // Growth rings near the base.
    for (let k = 1; k <= 3; k++) {
      const t = k * 0.12, p = curve.getPointAt(t), tan = curve.getTangentAt(t)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13 * (1 - t) + 0.006, 0.008, 8, 40), mat)
      ring.position.copy(p)
      ring.quaternion.setFromUnitVectors(V(0, 0, 1), tan)
      g.add(ring)
    }
  }
  return g
}

function halo(): THREE.Group {
  const g = new THREE.Group()
  const m = new THREE.MeshStandardMaterial({ color: '#ffe27a', emissive: '#ffd84a', emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.3 })
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 24, 96), m)
  h.rotation.set(PI / 2 - 0.35, 0, 0.2)
  h.position.set(0.05, 1.24, -0.06)
  g.add(h)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: '#ffd84a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  }))
  glow.scale.set(1.6, 0.9, 1)
  glow.position.copy(h.position)
  g.add(glow)
  return g
}

function crownGeometry(R: number, th: number, hb: number, hp: number, n: number): THREE.BufferGeometry {
  // A solid zigzag band: outer wall, inner wall and top edge; the height peaks n times.
  const A = 300, Hs = 16, pos: number[] = [], idx: number[] = []
  const h = (q: number) => {
    const p = ((q * n) / (PI * 2)) % 1, tri = 1 - abs(2 * p - 1)
    return hb + hp * Math.pow(tri, 1.7)
  }
  const ring = (fn: (q: number, v: number) => [number, number, number]) => {
    const base = pos.length / 3
    for (let i = 0; i <= A; i++) for (let j = 0; j <= Hs; j++) pos.push(...fn((i / A) * PI * 2, j / Hs))
    return base
  }
  const quads = (base: number) => {
    for (let i = 0; i < A; i++) for (let j = 0; j < Hs; j++) {
      const a = base + i * (Hs + 1) + j, b = a + Hs + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  quads(ring((q, v) => [R * sin(q), v * h(q), R * cos(q)]))
  quads(ring((q, v) => [(R - th) * sin(q), v * h(q), (R - th) * cos(q)]))
  quads(ring((q, v) => {
    const r = R - th * v, y = h(q) + 0.012 * sin(v * PI)
    return [r * sin(q), y, r * cos(q)]
  }))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function crown(): THREE.Group {
  const g = new THREE.Group(), R = 0.3, th = 0.03, hb = 0.1, hp = 0.19, N = 5
  const m = gold()
  m.side = THREE.DoubleSide
  g.add(new THREE.Mesh(crownGeometry(R, th, hb, hp, N), m))
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - th / 2, 0.03, 20, 120), m)
  rim.rotation.x = PI / 2
  rim.position.y = 0.012
  g.add(rim)
  const gems = ['#e8174f', '#1e6bff', '#19c27a', '#1e6bff', '#e8174f']
  for (let k = 0; k < N; k++) {
    const q = ((k + 0.5) / N) * PI * 2
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), m)
    ball.position.set((R - th / 2) * sin(q), hb + hp + 0.022, (R - th / 2) * cos(q))
    g.add(ball)
    const gem = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 28, 14, 0, PI * 2, 0, PI / 2),
      new THREE.MeshPhysicalMaterial({ color: gems[k], roughness: 0.04, clearcoat: 1, emissive: gems[k], emissiveIntensity: 0.3 }),
    )
    gem.scale.set(1, 0.55, 1)
    const holder = new THREE.Group()
    holder.rotation.y = q
    g.add(holder)
    gem.rotation.x = PI / 2
    gem.position.set(0, hb * 0.62, R)
    holder.add(gem)
  }
  const d = SPIKES[1].d
  g.quaternion.setFromUnitVectors(V(0, 1, 0), d)
  g.rotateY(0.15)
  g.position.copy(d).multiplyScalar(0.93)
  return g
}

// ---------------- eyewear ----------------

function lensTexture(top: string, bottom: string, h: number): THREE.CanvasTexture {
  const tex = canvasTexture(4, 256, (x) => {
    const gr = x.createLinearGradient(0, 0, 0, 256)
    gr.addColorStop(0, top)
    gr.addColorStop(0.3, top)
    gr.addColorStop(1, bottom)
    x.fillStyle = gr
    x.fillRect(0, 0, 4, 256)
  })
  tex.repeat.set(1, 1 / h)
  tex.offset.set(0, 0.5)
  return tex
}

interface GlassesStyle {
  frame: THREE.Material
  lens: (i: number, w: number, h: number) => THREE.Material
  /** Lens outline for one eye, given the width and height it should fill. */
  shape: (w: number, h: number) => THREE.Shape
  arms?: boolean
}

/** Two lenses over the eyes, a bridge and arms back to the temples. */
function glasses(s: GlassesStyle): THREE.Group {
  const g = new THREE.Group(), edges: { l: THREE.Vector3; r: THREE.Vector3 }[] = []
  EYE_SPOTS.forEach((E, i) => {
    const w = 2 * E.sa * 1.1, h = 2 * E.sb * 0.9
    const rim = new THREE.Mesh(bulge(extrude(s.shape(w + 0.05, h + 0.05), 0.025, 0.012), 0.35), s.frame)
    const lens = new THREE.Mesh(bulge(extrude(s.shape(w - 0.012, h - 0.012), 0.02, 0.01), 0.35), s.lens(i, w, h))
    const c = E.f.e.clone().multiplyScalar(1.075).addScaledVector(E.f.w, 0.02)
    for (const [m, z] of [[rim, 0], [lens, 0.018]] as const) {
      m.quaternion.copy(quatOf(E.f, -0.05))
      m.position.copy(c).addScaledVector(E.f.e, z)
      g.add(m)
    }
    edges.push({ l: c.clone().addScaledVector(E.f.u, -w / 2), r: c.clone().addScaledVector(E.f.u, w / 2) })
  })
  const tube = (pts: THREE.Vector3[], r: number) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 10), s.frame)
  const mid = edges[0].r.clone().add(edges[1].l).multiplyScalar(0.5).normalize().multiplyScalar(1.11)
  g.add(tube([edges[0].r, mid, edges[1].l], 0.024))
  if (s.arms !== false) {
    g.add(tube([edges[0].l, dir(-45, 4).multiplyScalar(1.07), dir(-72, 5).multiplyScalar(1.03), dir(-95, 5).multiplyScalar(1.0)], 0.02))
    g.add(tube([edges[1].r, dir(62, 0).multiplyScalar(1.05), dir(90, 2).multiplyScalar(1.02), dir(110, 2).multiplyScalar(1.0)], 0.02))
  }
  return g
}

const gradLens = (top: string, bottom: string) => (_i: number, _w: number, h: number) => {
  const tex = lensTexture(top, bottom, h)
  return new THREE.MeshPhysicalMaterial({
    map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.28, metalness: 0.3, roughness: 0.05,
    clearcoat: 1, clearcoatRoughness: 0.02,
  })
}

const shades = (look: Look) =>
  glasses({
    frame: plastic('#0c0c10', 0.22),
    lens: gradLens('#1a0638', look.palette.accent),
    shape: (w, h) => rrect(w, h, 0.2),
  })

const retro = () =>
  glasses({
    frame: plastic('#f4f1ea', 0.35),
    lens: (i) => new THREE.MeshPhysicalMaterial({
      color: i === 0 ? '#cf113c' : '#168fe3', roughness: 0.075, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03,
      emissive: i === 0 ? '#e31539' : '#168fe3', emissiveIntensity: 0.06,
    }),
    shape: (w, h) => rrect(w, h * 0.92, 0.04),
  })

function hearts(): THREE.Group {
  return glasses({
    frame: plastic('#ff2e7e', 0.25),
    lens: gradLens('#ff7ab8', '#ff1f6d'),
    shape: (w, h) => {
      const s = heartShape(max(w, h) * 0.5)
      return s
    },
  })
}

function monocle(): THREE.Group {
  const g = new THREE.Group(), E = EYE_SPOTS[1], m = gold()
  const R = max(E.sa, E.sb) * 1.05
  const c = E.f.e.clone().multiplyScalar(1.07)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.022, 16, 72), m)
  ring.quaternion.copy(quatOf(E.f))
  ring.position.copy(c)
  g.add(ring)
  const glass = new THREE.Mesh(
    bulge(new THREE.CircleGeometry(R, 48), -0.3),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, roughness: 0.02, ior: 1.5, thickness: 0.05, transparent: true, opacity: 0.35 }),
  )
  glass.quaternion.copy(quatOf(E.f))
  glass.position.copy(c).addScaledVector(E.f.e, 0.005)
  g.add(glass)
  // A chain from the bottom of the rim down past the cheek.
  const start = c.clone().addScaledVector(E.f.w, -R).addScaledVector(E.f.u, R * 0.3)
  const pts = [start, dir(44, -38).multiplyScalar(1.06), dir(52, -62).multiplyScalar(1.06), V(0.5, -0.95, 0.55)]
  const curve = new THREE.CatmullRomCurve3(pts), link = new THREE.TorusGeometry(0.014, 0.005, 8, 16)
  for (let i = 0, N = 44; i <= N; i++) {
    const l = new THREE.Mesh(link, m)
    l.position.copy(curve.getPointAt(i / N))
    l.quaternion.setFromUnitVectors(V(1, 0, 0), curve.getTangentAt(i / N))
    l.rotateX(i % 2 ? PI / 2 : 0)
    l.scale.set(1.4, 1, 1)
    g.add(l)
  }
  return g
}

function visor(look: Look): THREE.Group {
  // One wraparound band across both eyes, glowing like a HUD.
  const g = new THREE.Group(), c = look.palette.accent
  const geo = new THREE.CylinderGeometry(1.1, 1.1, 0.5, 96, 8, true, -75 * D2R, 150 * D2R)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(x, z)
    // Pinch the band's ends and bow it outward in the middle.
    const k = 1 + 0.05 * cos(y * 5) - 0.04 * (a / (75 * D2R)) ** 4
    p.setXYZ(i, x * k, y * (1 - 0.35 * (a / (75 * D2R)) ** 6), z * k)
  }
  geo.computeVertexNormals()
  const band = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
    color: '#0a0a14', emissive: new THREE.Color(c), emissiveIntensity: 0.45, metalness: 0.4, roughness: 0.06, clearcoat: 1,
    iridescence: 0.8, side: THREE.DoubleSide,
  }))
  g.add(band)
  // Scan lines.
  for (const y of [-0.12, 0, 0.12]) {
    const line = new THREE.Mesh(new THREE.TorusGeometry(1.115, 0.004, 6, 96, 120 * D2R), additive(c, 0.9))
    line.rotation.set(PI / 2, 0, PI / 2 - 60 * D2R)
    line.position.y = y
    g.add(line)
  }
  const edge = metal('#c7ccd6', 0.2)
  for (const y of [-0.25, 0.25]) {
    const e = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.014, 8, 96, 150 * D2R), edge)
    e.rotation.set(PI / 2, 0, PI / 2 - 75 * D2R)
    e.position.y = y
    g.add(e)
  }
  g.rotation.y = 12 * D2R
  g.position.y = 0.02
  return g
}

// ---------------- neck ----------------

function scarf(look: Look, surface: Field): THREE.Group {
  const g = new THREE.Group(), c = look.palette.accent
  const tex = canvasTexture(64, 256, (x) => {
    x.fillStyle = c
    x.fillRect(0, 0, 64, 256)
    x.fillStyle = mix(c, '#ffffff', 0.65)
    for (let i = 0; i < 256; i += 48) x.fillRect(0, i, 64, 16)
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1, 4)
  const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.5 })
  const ring = neckRing(surface, -0.72, -0.82, 0.06)
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 96, 0.085, 20, true), mat))
  // A tail hanging over the chest.
  const a = frontOf(surface, -0.16, -0.82, 0.1).p
  const tail = [a, frontOf(surface, -0.2, -0.92, 0.08).p, frontOf(surface, -0.2, -1.04, 0.06).p, frontOf(surface, -0.18, -1.14, 0.05).p]
  g.add(new THREE.Mesh(taperTube(new THREE.CatmullRomCurve3(tail), 0.085, 0.07, 32, 16), mat))
  return g
}

function bowtie(look: Look, surface: Field): THREE.Group {
  const g = new THREE.Group(), f = frontOf(surface, 0, -0.84, 0.03)
  const mat = new THREE.MeshPhysicalMaterial({ color: look.palette.accent, roughness: 0.35, sheen: 1, sheenColor: new THREE.Color('#ffffff'), clearcoat: 0.4 })
  const wing = new THREE.Shape()
  wing.moveTo(0, 0)
  wing.bezierCurveTo(0.04, 0.05, 0.1, 0.08, 0.14, 0.06)
  wing.bezierCurveTo(0.16, 0.02, 0.16, -0.02, 0.14, -0.06)
  wing.bezierCurveTo(0.1, -0.08, 0.04, -0.05, 0, 0)
  const holder = new THREE.Group()
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(extrude(wing, 0.03, 0.015), mat)
    w.scale.x = s
    holder.add(w)
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 14), mat)
  knot.scale.set(1, 1.3, 0.8)
  holder.add(knot)
  holder.position.copy(f.p)
  holder.quaternion.setFromUnitVectors(V(0, 0, 1), f.n)
  g.add(holder)
  return g
}

function linkChain(pts: THREE.Vector3[], closed: boolean, mat: THREE.Material, size: number, n: number): THREE.Group {
  const g = new THREE.Group(), curve = new THREE.CatmullRomCurve3(pts, closed), geo = new THREE.TorusGeometry(size, size * 0.38, 8, 18)
  for (let i = 0; i < n; i++) {
    const t = i / n, l = new THREE.Mesh(geo, mat)
    l.position.copy(curve.getPointAt(t))
    l.quaternion.setFromUnitVectors(V(1, 0, 0), curve.getTangentAt(t))
    l.rotateX(i % 2 ? PI / 2 : 0)
    l.scale.set(1.35, 1, 1)
    g.add(l)
  }
  return g
}

function chain(_look: Look, surface: Field): THREE.Group {
  return linkChain(neckRing(surface, -0.74, -0.9, 0.022), true, gold(), 0.024, 64)
}

function icechain(_look: Look, surface: Field): THREE.Group {
  const g = new THREE.Group()
  const ring = neckRing(surface, -0.74, -0.9, 0.026, 56)
  const setting = metal('#e9eef5', 0.12)
  const stone = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', transmission: 1, ior: 2.2, dispersion: 5, roughness: 0, thickness: 0.05, iridescence: 0.6,
    clearcoat: 1, attenuationColor: new THREE.Color('#dff4ff'), attenuationDistance: 0.4,
  })
  const curve = new THREE.CatmullRomCurve3(ring, true), gem = new THREE.OctahedronGeometry(0.022, 0), cup = new THREE.CylinderGeometry(0.027, 0.02, 0.018, 12)
  for (let i = 0, N = 44; i < N; i++) {
    const t = i / N, p = curve.getPointAt(t), n = p.clone().setY(0).normalize()
    const c = new THREE.Mesh(cup, setting)
    c.position.copy(p)
    c.quaternion.setFromUnitVectors(V(0, 1, 0), n)
    g.add(c)
    const s = new THREE.Mesh(gem, stone)
    s.position.copy(p).addScaledVector(n, 0.016)
    s.quaternion.setFromUnitVectors(V(0, 1, 0), n)
    s.scale.set(1, 0.6, 1)
    g.add(s)
  }
  return g
}

function bandana(_look: Look, surface: Field): THREE.Group {
  const g = new THREE.Group()
  const tex = canvasTexture(256, 256, (x) => {
    x.fillStyle = '#c8102e'
    x.fillRect(0, 0, 256, 256)
    x.strokeStyle = '#ffffff'
    x.fillStyle = '#ffffff'
    x.lineWidth = 3
    let s = 5
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 26; i++) {
      const px = rnd() * 256, py = rnd() * 256, r = 6 + rnd() * 8
      x.beginPath()
      x.arc(px, py, r, 0, PI * 2)
      x.stroke()
      x.beginPath()
      x.arc(px, py, 2, 0, PI * 2)
      x.fill()
    }
    x.strokeRect(10, 10, 236, 236)
  })
  const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color('#ffd0d0'), side: THREE.DoubleSide })
  const ring = neckRing(surface, -0.7, -0.78, 0.035)
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 96, 0.05, 14, true), mat))
  // The triangle hanging over the chest, bent to the surface.
  const tri = new THREE.BufferGeometry(), pos: number[] = [], uv: number[] = [], idx: number[] = []
  const R = 12
  for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
    const u = i / R, v = j / R, w = (1 - v) * 0.3
    const x = (u - 0.5) * 2 * w, y = -0.8 - v * 0.26
    const q = frontOf(surface, x, y, 0.03 + 0.012 * (1 - v)).p
    pos.push(q.x, q.y, q.z)
    uv.push(u, 1 - v)
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const a = j * (R + 1) + i, b = a + R + 1
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  tri.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  tri.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  tri.setIndex(idx)
  tri.computeVertexNormals()
  g.add(new THREE.Mesh(tri, mat))
  return g
}

// ---------------- auras ----------------

function auraGlow(look: Look): THREE.Group {
  const g = new THREE.Group()
  for (const [s, op, c] of [[3.6, 0.5, look.palette.rim], [2.7, 0.35, look.palette.accent]] as const) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false,
    }))
    sp.scale.setScalar(s)
    sp.position.set(0, 0.4, -1.4)
    g.add(sp)
  }
  return g
}

function sparkles(look: Look): THREE.Group {
  const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
  const spots: [number, number, number, number][] = [
    [-1.2, 1.35, 0.3, 0.11], [1.22, 1.1, 0.2, 0.09], [-1.3, 0.25, 0.5, 0.07], [1.35, 0.05, 0.4, 0.12], [0.9, 1.7, -0.2, 0.06],
    [-0.8, 1.72, 0, 0.07], [-1.15, -0.6, 0.4, 0.06], [1.12, -0.7, 0.3, 0.08],
  ]
  for (const [x, y, z, r] of spots) {
    const s = new THREE.Mesh(extrude(starShape(r, 0.12), 0.006, 0.002), mat)
    s.position.set(x, y, z)
    s.rotation.z = (x * 3 + y) % 0.6
    g.add(s)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: look.palette.accent, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }))
    glow.scale.setScalar(r * 5)
    glow.position.set(x, y, z - 0.01)
    g.add(glow)
  }
  return g
}

function planetRing(look: Look): THREE.Group {
  // A banded ring around the head, like a planet's, tilted and passing behind it.
  const g = new THREE.Group()
  const tex = canvasTexture(512, 8, (x) => {
    const bands = [look.palette.rim, '#ffffff', look.palette.accent, look.palette.rim, '#ffffff']
    for (let i = 0; i < 512; i++) {
      const b = bands[Math.floor((i / 512) * bands.length)]
      x.globalAlpha = 0.35 + 0.6 * abs(sin(i * 0.09)) * (0.6 + 0.4 * sin(i * 0.013))
      x.fillStyle = b
      x.fillRect(i, 0, 1, 8)
    }
  })
  const geo = new THREE.RingGeometry(1.14, 1.5, 160, 1)
  const p = geo.attributes.position, uv = geo.attributes.uv
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i))
    uv.setXY(i, (r - 1.14) / 0.36, 0.5)
  }
  const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }))
  ring.rotation.set(PI / 2 - 0.3, 0.32, 0)
  ring.position.y = 0.36
  g.add(ring)
  return g
}

// ---------------- lookup ----------------

export const HEADWEAR: Record<string, (look: Look) => THREE.Object3D> = { beanie, party, cap, headphones, horns, halo, crown }
export const EYEWEAR: Record<string, (look: Look) => THREE.Object3D> = { shades, retro, hearts, monocle, visor }
export const NECKWEAR: Record<string, (look: Look, surface: Field) => THREE.Object3D> = { scarf, bowtie, chain, icechain, bandana }
export const AURAS: Record<string, (look: Look) => THREE.Object3D> = { glow: auraGlow, sparkles, ring: planetRing }

/** Headwear that covers the spikes' spot; the spikes are left off under it. */
export const HIDES_SPIKES = new Set(['beanie', 'cap', 'horns', 'crown'])
