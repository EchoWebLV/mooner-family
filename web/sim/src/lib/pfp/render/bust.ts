// The Mooner bust: a sculpted body and its outfits, modelled as signed distance fields (see sdf.ts).
// World units; the head is a unit sphere centred at (0, HEAD_Y, 0). The portrait only shows the neck and the tops
// of the shoulders, so only that slab is meshed.
import * as THREE from 'three'
import { cloth, extrude, fabric, facing, metal, mix, rrect, starShape, V } from './kit'
import type { Look } from './look'
import {
  cap, ell, len, meshSDF, norm3, onSurface, paint, smax, smin, ss, surfacePoint, torus, type Field, type V3,
} from './sdf'

const { abs, max, min, sin, cos, atan2, sqrt } = Math

// ---------------- anatomy ----------------
const NECK: [V3, V3, number] = [[0, -0.45, 0], [0, -0.86, 0], 0.2]
const YOKE: [V3, V3, number] = [[0, -0.83, -0.03], [0.47, -0.95, -0.03], 0.19]
const CHEST: [V3, V3] = [[0, -1.05, 0], [0.5, 0.36, 0.34]]
const BELLY: [V3, V3] = [[0, -1.46, 0.03], [0.5, 0.5, 0.4]]
const UP: [V3, V3, number, number] = [[0.5, -0.97, -0.02], [0.74, -1.25, 0], 0.125, 0.11]
const FO: [V3, V3, number, number] = [[0.74, -1.25, 0], [0.5, -1.42, 0.33], 0.11, 0.09]

function torso(x: number, y: number, z: number): number {
  let d = cap(x, y, z, NECK[0], NECK[1], NECK[2])
  d = smin(d, cap(abs(x), y, z, YOKE[0], YOKE[1], YOKE[2]), 0.12)
  d = smin(d, ell(x, y, z, CHEST[0], CHEST[1]), 0.16)
  return smin(d, ell(x, y, z, BELLY[0], BELLY[1]), 0.24)
}
function arm(x: number, y: number, z: number): number {
  const ax = abs(x)
  return smin(cap(ax, y, z, UP[0], UP[1], UP[2], UP[3]), cap(ax, y, z, FO[0], FO[1], FO[2], FO[3]), 0.04)
}
const armK = (y: number) => 0.004 + 0.09 * ss(-1.12, -0.95, y)
const trunk: Field = (x, y, z) => smin(torso(x, y, z), arm(x, y, z), armK(y))

/** Inside a cylinder of radius r around the neck, above y0: cut out of a shell, it makes the neckline. */
const neckHole = (x: number, y: number, z: number, r: number, y0: number) => max(len(x, 0, z + 0.02) - r, -(y - y0))

// Craters: the same bowl and raised rim as the head, pushed into the field.
const CRATERS = (
  [
    [[-0.55, 0.62, 0.7], 0.1, 0.03], [[0.42, -0.05, 0.9], 0.125, 0.036], [[0.72, 0.55, 0.45], 0.07, 0.022],
    [[-0.05, 0.25, 1], 0.05, 0.016], [[-0.15, -0.6, 0.8], 0.07, 0.022],
  ] as [V3, number, number][]
).map(([d, r, depth]) => ({ c: surfacePoint(trunk, [0, -1.3, 0.02], norm3(d)), r, depth }))

function craterAt(x: number, y: number, z: number): [number, number] {
  let dd = 0, m = 0
  for (const C of CRATERS) {
    const rr = len(x - C.c[0], y - C.c[1], z - C.c[2]) / C.r
    if (rr > 1.6) continue
    dd += C.depth * (1 - ss(0.45, 1.0, rr)) - C.depth * 0.38 * Math.exp(-(((rr - 1.0) / 0.16) ** 2))
    m = max(m, 1 - ss(0.78, 1.02, rr))
  }
  return [dd, m]
}
const body: Field = (x, y, z) => trunk(x, y, z) + craterAt(x, y, z)[0]

// ---------------- meshing ----------------
const LO: V3 = [-1.12, -1.12, -0.64]
const HI: V3 = [1.12, -0.4, 0.64]
const STEP = 0.011

const meshes = new Map<string, THREE.BufferGeometry>()
/** Each field is meshed once per page load. */
function mesh(key: string, f: Field, lo = LO, hi = HI, step = STEP): THREE.BufferGeometry {
  let g = meshes.get(key)
  if (!g) {
    g = meshSDF(f, lo, hi, step)
    g.userData.keep = true
    meshes.set(key, g)
  }
  return g
}

/** A built outfit, and the outer surface a necklace should sit on. */
interface Outfit {
  group: THREE.Group
  surface: Field
}

/** The point on the front of a surface below (x, y), and its normal. */
const front = (f: Field, x: number, y: number, lift = 0) => onSurface(f, [x * 0.5, y, 0], [x, 0, 1], lift)

// ---------------- outfits ----------------

// Tee: a plain shell with a ribbed crew neck.
const COLLAR_Y = -0.84
function teeSDF(x: number, y: number, z: number): number {
  let d = trunk(x, y, z) - 0.035
  d = smax(d, -neckHole(x, y, z, 0.25, COLLAR_Y - 0.1), 0.02)
  return smin(d, torus(x, y, z, [0, COLLAR_Y, -0.02], 0.255, 0.03, -0.18), 0.02)
}
function tee(look: Look): Outfit {
  const base = new THREE.Color(look.palette.cloth), rib = base.clone().multiplyScalar(0.8)
  const geo = paint(mesh('tee', teeSDF), (x, y, z, c) => {
    c.copy(base)
    if (abs(torus(x, y, z, [0, COLLAR_Y, -0.02], 0.255, 0.03, -0.18)) < 0.012) c.copy(rib)
  })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geo, fabric(mix(look.palette.cloth, '#ffffff', 0.5))))
  const star = front(teeSDF, -0.24, -1.0, 0.004)
  const em = new THREE.Mesh(extrude(starShape(0.05), 0.006, 0.003), new THREE.MeshPhysicalMaterial({ color: look.palette.accent, roughness: 0.5 }))
  em.position.copy(star.p)
  facing(em, star.n)
  group.add(em)
  return { group, surface: teeSDF }
}

// Turtleneck: a tall ribbed collar rolled up to the chin.
function collarTube(x: number, y: number, z: number): number {
  const q1 = len(x, 0, z + 0.01) - 0.262, q2 = y - min(max(y, -0.9), -0.69)
  return sqrt(q1 * q1 + q2 * q2) - 0.05 + 0.006 * sin(atan2(x, z) * 36)
}
function turtleSDF(x: number, y: number, z: number): number {
  let d = trunk(x, y, z) - 0.035
  d = smax(d, -neckHole(x, y, z, 0.26, -0.9), 0.02)
  return smin(d, collarTube(x, y, z), 0.03)
}
function turtleneck(look: Look): Outfit {
  const base = new THREE.Color(look.palette.cloth), shade = base.clone().multiplyScalar(0.86)
  const geo = paint(mesh('turtle', turtleSDF), (x, y, z, c) => {
    c.copy(base)
    if (collarTube(x, y, z) < 0.02 && sin(atan2(x, z) * 36) < 0) c.copy(shade)
  })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geo, fabric(mix(look.palette.cloth, '#ffffff', 0.5))))
  return { group, surface: turtleSDF }
}

// Hoodie: body shell, rolled collar, the hood bunched behind the neck, drawstrings.
function hoodieSDF(x: number, y: number, z: number): number {
  let d = trunk(x, y, z) - 0.05
  d = smax(d, -neckHole(x, y, z, 0.27, -0.96), 0.03)
  d = smin(d, torus(x, y, z, [0, -0.83, -0.03], 0.27, 0.06, -0.2), 0.04)
  return smin(d, ell(x, y, z, [0, -0.72, -0.3], [0.4, 0.26, 0.2]), 0.09)
}
function hoodie(look: Look): Outfit {
  const base = new THREE.Color(look.palette.cloth), dark = base.clone().multiplyScalar(0.6)
  const geo = paint(mesh('hoodie', hoodieSDF), (x, y, z, c) => {
    c.copy(base)
    // The inside of the hood shows darker above the collar.
    if (z < -0.12 && y > -0.84) c.copy(dark)
  })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geo, fabric(mix(look.palette.cloth, '#ffffff', 0.45))))
  const str = new THREE.MeshPhysicalMaterial({ color: look.palette.accent, roughness: 0.6, sheen: 0.6 })
  for (const s of [-1, 1]) {
    const pts = [-0.86, -0.93, -1.0, -1.07].map((y, i) => front(hoodieSDF, s * (0.1 + i * 0.008), y, 0.018).p)
    const curve = new THREE.CatmullRomCurve3(pts)
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.016, 10), str))
  }
  return { group, surface: hoodieSDF }
}

// Tuxedo: black jacket with satin lapels over a white shirt and its collar points.
const vOpen = (x: number, y: number) => abs(x) - (0.03 + max(0, -(y + 0.8)) * 0.62)
function jacketSDF(x: number, y: number, z: number): number {
  let d = trunk(x, y, z) - 0.05
  d = smax(d, -neckHole(x, y, z, 0.25, -0.95), 0.02)
  return smax(d, -max(vOpen(x, y), -z), 0.012)
}
function lapelSDF(x: number, y: number, z: number): number {
  const shell = trunk(x, y, z) - 0.062
  const band = abs(vOpen(x, y) - 0.05) - 0.05
  return smax(smax(shell, band, 0.008), -neckHole(x, y, z, 0.25, -0.95), 0.01)
}
function shirtSDF(x: number, y: number, z: number): number {
  let d = trunk(x, y, z) - 0.025
  d = smax(d, -neckHole(x, y, z, 0.228, -0.9), 0.015)
  return smin(d, torus(x, y, z, [0, -0.84, -0.01], 0.232, 0.028, -0.2), 0.015)
}
function tux(): Outfit {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(mesh('jacket', jacketSDF), cloth('#17161d', '#5a5870')))
  group.add(new THREE.Mesh(mesh('lapel', lapelSDF), new THREE.MeshPhysicalMaterial({ color: '#0b0b10', roughness: 0.25, clearcoat: 0.6, sheen: 0.4 })))
  group.add(new THREE.Mesh(mesh('shirt', shirtSDF), cloth('#f7f5f0', '#ffffff')))
  // Collar points either side of the throat.
  const white = cloth('#ffffff', '#ffffff')
  for (const s of [-1, 1]) {
    const p = front(shirtSDF, s * 0.1, -0.88, 0.006)
    const tri = new THREE.Shape()
    tri.moveTo(-0.055, 0.03)
    tri.lineTo(0.055, 0.03)
    tri.lineTo(0, -0.07)
    tri.closePath()
    const m = new THREE.Mesh(extrude(tri, 0.008, 0.004), white)
    m.position.copy(p.p)
    facing(m, p.n)
    m.rotateZ(s * 0.35)
    group.add(m)
  }
  const surface: Field = (x, y, z) => min(jacketSDF(x, y, z), shirtSDF(x, y, z))
  return { group, surface }
}

// Space suit: padded suit with a quilted rib, an aluminium neck ring and an orange seal ring.
function suitSDF(x: number, y: number, z: number): number {
  const rib = 0.014 * sqrt(abs(sin(y * 14)))
  const d = trunk(x, y, z) - 0.05 - rib
  return smax(d, -neckHole(x, y, z, 0.26, -0.92), 0.03)
}
function spacesuit(): Outfit {
  const group = new THREE.Group(), white = new THREE.Color('#eeeeea'), seam = white.clone().multiplyScalar(0.72)
  const geo = paint(mesh('suit', suitSDF), (x, y, z, c) => {
    c.copy(abs(sin(y * 14)) < 0.12 ? seam : white)
  })
  group.add(new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.7, sheen: 0.8, sheenColor: new THREE.Color('#ffffff'), clearcoat: 0.1 })))
  const alu = metal('#cfd5de', 0.25)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.05, 20, 80), alu)
  ring.position.set(0, -0.8, -0.01)
  ring.rotation.x = Math.PI / 2 + 0.2
  group.add(ring)
  const seal = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 12, 80), metal('#ff7a1a', 0.35))
  seal.position.set(0, -0.855, -0.01)
  seal.rotation.x = Math.PI / 2 + 0.2
  group.add(seal)
  // Bolts around the neck ring.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), alu)
    b.position.set(0.3 * sin(a), -0.8 + 0.3 * cos(a) * -0.2, 0.3 * cos(a) - 0.01)
    group.add(b)
  }
  // Mission patch on the chest.
  const pp = front(suitSDF, -0.3, -0.98, 0.006)
  const patch = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 40), new THREE.MeshPhysicalMaterial({ color: '#1b2a5a', roughness: 0.6, sheen: 1 }))
  patch.position.copy(pp.p)
  patch.quaternion.setFromUnitVectors(V(0, 1, 0), pp.n)
  group.add(patch)
  const ps = new THREE.Mesh(extrude(starShape(0.045), 0.006, 0.003), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.4 }))
  ps.position.copy(pp.p).addScaledVector(pp.n, 0.012)
  facing(ps, pp.n)
  group.add(ps)
  // A flag on the right shoulder.
  const fp = front(suitSDF, 0.34, -0.97, 0.006)
  const flag = new THREE.Mesh(extrude(rrect(0.12, 0.075, 0.01), 0.005, 0.002), new THREE.MeshPhysicalMaterial({ color: '#e8e4da', roughness: 0.5 }))
  flag.position.copy(fp.p)
  facing(flag, fp.n)
  group.add(flag)
  const moon = new THREE.Mesh(new THREE.CircleGeometry(0.022, 24), new THREE.MeshBasicMaterial({ color: '#ffcc55' }))
  moon.position.copy(fp.p).addScaledVector(fp.n, 0.006)
  facing(moon, fp.n)
  group.add(moon)
  return { group, surface: suitSDF }
}

// Royal: velvet capelet with gold trim and a white ermine collar, a gold chain across the chest.
const hem = (x: number, y: number, z: number) => y + 1.3 + 0.03 * cos(atan2(x, z) * 11)
const capeOpen = (x: number, y: number) => abs(x) - (0.04 + max(0, -(y + 0.86)) * 0.5)
function capeShell(x: number, y: number, z: number, grow: number): number {
  const b = trunk(x, y, z), flare = max(0, -(y + 0.95)) * 0.3
  const d = smax(b - (0.09 + flare + grow), -(b - 0.03), 0.01)
  return smax(d, -neckHole(x, y, z, 0.26, -0.93), 0.03)
}
function mantleSDF(x: number, y: number, z: number): number {
  const d = smax(capeShell(x, y, z, 0), -hem(x, y, z), 0.012)
  return smax(d, -max(capeOpen(x, y), 0.02 - z), 0.015)
}
function trimSDF(x: number, y: number, z: number): number {
  const s = capeShell(x, y, z, 0.012)
  const band = z > 0 ? abs(capeOpen(x, y) - 0.018) - 0.02 : 9
  return smax(smax(s, band, 0.006), -max(capeOpen(x, y) - 0.002, 0.02 - z), 0.006)
}
function ermineSDF(x: number, y: number, z: number): number {
  const th = atan2(x, z), fuzz = 0.01 * sin(th * 37 + y * 45) * sin(y * 61 - th * 17) + 0.005 * sin(th * 83 + z * 70)
  return torus(x, y, z, [0, -0.74, -0.03], 0.3, 0.1, -0.22) + fuzz
}
function royal(): Outfit {
  const group = new THREE.Group(), gold = metal('#ffc53d', 0.2)
  const vel = new THREE.MeshPhysicalMaterial({ color: '#8e0c26', roughness: 0.72, sheen: 1, sheenColor: new THREE.Color('#ff8fa3'), sheenRoughness: 0.35 })
  group.add(new THREE.Mesh(mesh('mantle', mantleSDF), vel))
  group.add(new THREE.Mesh(mesh('trim', trimSDF, LO, HI, 0.008), gold))
  const cream = new THREE.Color('#fbf6ea'), spot = new THREE.Color('#141014')
  const eg = paint(mesh('ermine', ermineSDF, [-0.52, -0.95, -0.52], [0.52, -0.52, 0.52], 0.008), (x, y, z, c) => {
    const k = atan2(x, z) * 5.2 + 0.4, fk = k - Math.round(k)
    c.copy(abs(fk) < 0.05 && abs(y + 0.8) < 0.04 && z > -0.1 ? spot : cream)
  })
  group.add(new THREE.Mesh(eg, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.8 })))
  const surface: Field = (x, y, z) => min(mantleSDF(x, y, z), ermineSDF(x, y, z), body(x, y, z))
  const chainPts = ([[-0.3, -0.86], [-0.2, -0.93], [-0.1, -0.97], [0, -0.985], [0.1, -0.97], [0.2, -0.93], [0.3, -0.86]] as const)
    .map(([x, y]) => onSurface(surface, [x * 0.4, y, 0], [x * 0.3, 0, 1], 0.022).p)
  const curve = new THREE.CatmullRomCurve3(chainPts), linkGeo = new THREE.TorusGeometry(0.02, 0.0075, 8, 18)
  for (let i = 0, N = 24; i <= N; i++) {
    const link = new THREE.Mesh(linkGeo, gold)
    link.position.copy(curve.getPointAt(i / N))
    link.quaternion.setFromUnitVectors(V(1, 0, 0), curve.getTangentAt(i / N))
    link.rotateX(i % 2 ? Math.PI / 2 : 0)
    link.scale.set(1.3, 1, 1)
    group.add(link)
  }
  return { group, surface }
}

const OUTFITS: Record<string, (look: Look) => Outfit> = { tee, turtleneck, hoodie, tux, suit: spacesuit, royal }

/** Rotates the bust a little toward the face's turn. */
export const BUST_TURN = 8 * (Math.PI / 180)

/** The body in the skin's material, the outfit over it, and the surface the neck item should sit on. */
export function buildBust(look: Look, skin: THREE.Material): { group: THREE.Group; surface: Field } {
  const group = new THREE.Group()
  const b = new THREE.Color(look.skin.body), cr = new THREE.Color(look.skin.crater)
  const geo = paint(mesh('body', body), (x, y, z, c) => {
    const m = craterAt(x, y, z)[1]
    c.copy(b).lerp(cr, m)
    return m
  })
  group.add(new THREE.Mesh(geo, skin))
  let surface: Field = body
  const make = OUTFITS[look.pfp.outfit]
  if (make) {
    const o = make(look)
    group.add(o.group)
    surface = (x, y, z) => min(o.surface(x, y, z), body(x, y, z))
  }
  group.rotation.y = BUST_TURN
  return { group, surface }
}

/** Grid point helper for neck items: a ring around the neck on `surface`, dipping at the front. */
export function neckRing(surface: Field, yBack: number, yFront: number, lift: number, n = 48): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, y = yBack + (yFront - yBack) * (1 + cos(a)) / 2
    pts.push(onSurface(surface, [0, y, -0.02], [sin(a), 0, cos(a)], lift).p)
  }
  return pts
}

export { front as frontOf }
