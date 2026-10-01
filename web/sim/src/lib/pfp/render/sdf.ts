// Signed distance fields and a surface-nets mesher. The bust and its outfits are smooth blends of capsules,
// ellipsoids and tori, meshed once per page and cached by the caller.
import * as THREE from 'three'

export type V3 = readonly [number, number, number]
/** Negative inside, positive outside, roughly the distance to the surface. */
export type Field = (x: number, y: number, z: number) => number

const { sqrt, abs, max, min, sin, cos } = Math

export const smin = (a: number, b: number, k: number) => {
  const h = max(k - abs(a - b), 0) / k
  return min(a, b) - h * h * k * 0.25
}
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k)
export const len = (x: number, y: number, z: number) => sqrt(x * x + y * y + z * z)
export const ss = (a: number, b: number, x: number) => {
  const t = min(1, max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
export const norm3 = (v: V3): V3 => {
  const l = len(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

export function ell(x: number, y: number, z: number, c: V3, r: V3): number {
  const px = x - c[0], py = y - c[1], pz = z - c[2]
  const k0 = len(px / r[0], py / r[1], pz / r[2])
  const k1 = len(px / (r[0] * r[0]), py / (r[1] * r[1]), pz / (r[2] * r[2]))
  return k1 < 1e-9 ? -min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1
}

export function cap(x: number, y: number, z: number, a: V3, b: V3, ra: number, rb = ra): number {
  const pax = x - a[0], pay = y - a[1], paz = z - a[2]
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2]
  const h = min(1, max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)))
  return len(pax - bax * h, pay - bay * h, paz - baz * h) - (ra + (rb - ra) * h)
}

/** A torus around the y axis, tipped forward by `tilt` radians. */
export function torus(x: number, y: number, z: number, c: V3, R: number, r: number, tilt = 0): number {
  const px = x - c[0], py = y - c[1], pz = z - c[2], ct = cos(tilt), st = sin(tilt)
  const yy = py * ct - pz * st, zz = py * st + pz * ct, q = sqrt(px * px + zz * zz) - R
  return sqrt(q * q + yy * yy) - r
}

export function box2(x: number, y: number, hx: number, hy: number): number {
  const qx = abs(x) - hx, qy = abs(y) - hy
  return sqrt(max(qx, 0) ** 2 + max(qy, 0) ** 2) + min(max(qx, qy), 0)
}

/** Bisects from `o` (inside) along `d` to the surface. */
export function surfacePoint(f: Field, o: V3, d: V3): [number, number, number] {
  let a = 0, b = 1.6
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2
    if (f(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m) < 0) a = m
    else b = m
  }
  return [o[0] + d[0] * a, o[1] + d[1] * a, o[2] + d[2] * a]
}

/** The surface point along a ray, lifted `lift` off it, with the outward normal there. */
export function onSurface(f: Field, o: V3, d: V3, lift = 0): { p: THREE.Vector3; n: THREE.Vector3 } {
  const p = surfacePoint(f, o, norm3(d)), e = 0.004
  const n = norm3([
    f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]),
    f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]),
    f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e),
  ])
  return {
    p: new THREE.Vector3(p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift),
    n: new THREE.Vector3(...n),
  }
}

const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const
const ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const

/**
 * Surface nets over the box lo..hi. Vertices are snapped onto the surface and take their normals from the field's
 * gradient, so a coarse grid still shades smoothly.
 */
export function meshSDF(f: Field, lo: V3, hi: V3, step: number): THREE.BufferGeometry {
  const nx = Math.ceil((hi[0] - lo[0]) / step) + 1
  const ny = Math.ceil((hi[1] - lo[1]) / step) + 1
  const nz = Math.ceil((hi[2] - lo[2]) / step) + 1
  const F = new Float32Array(nx * ny * nz)
  const I = (i: number, j: number, k: number) => i + nx * (j + ny * k)

  // Blocks far from the surface take their centre's value: no edge that touches them can cross it.
  const B = 4, far = 1.6 * (step * (B - 1) * 0.87 + 2 * step)
  for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
    const ei = min(bi + B, nx), ej = min(bj + B, ny), ek = min(bk + B, nz)
    const c = f(lo[0] + ((bi + ei - 1) / 2) * step, lo[1] + ((bj + ej - 1) / 2) * step, lo[2] + ((bk + ek - 1) / 2) * step)
    const fill = abs(c) > far
    for (let k = bk; k < ek; k++) for (let j = bj; j < ej; j++) for (let i = bi; i < ei; i++) {
      F[I(i, j, k)] = fill ? c : f(lo[0] + i * step, lo[1] + j * step, lo[2] + k * step)
    }
  }

  const cx = nx - 1, cy = ny - 1
  const C = (i: number, j: number, k: number) => i + cx * (j + cy * k)
  const cell = new Int32Array(cx * cy * (nz - 1)).fill(-1)
  const v = new Float32Array(8), pos: number[] = []
  let vc = 0
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0
    for (let c = 0; c < 8; c++) {
      const o = CO[c]
      v[c] = F[I(i + o[0], j + o[1], k + o[2])]
      if (v[c] < 0) neg++
    }
    if (neg === 0 || neg === 8) continue
    let sx = 0, sy = 0, sz = 0, m = 0
    for (const [a, b] of ED) {
      if (v[a] < 0 === v[b] < 0) continue
      const t = v[a] / (v[a] - v[b]), A = CO[a], Bc = CO[b]
      sx += A[0] + (Bc[0] - A[0]) * t
      sy += A[1] + (Bc[1] - A[1]) * t
      sz += A[2] + (Bc[2] - A[2]) * t
      m++
    }
    pos.push(lo[0] + (i + sx / m) * step, lo[1] + (j + sy / m) * step, lo[2] + (k + sz / m) * step)
    cell[C(i, j, k)] = vc++
  }

  const idx: number[] = []
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) idx.push(a, c, b, a, d, c)
    else idx.push(a, b, c, a, c, d)
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const in0 = F[I(i, j, k)] < 0
    if (in0 !== F[I(i + 1, j, k)] < 0) quad(cell[C(i, j - 1, k - 1)], cell[C(i, j, k - 1)], cell[C(i, j, k)], cell[C(i, j - 1, k)], !in0)
    if (in0 !== F[I(i, j + 1, k)] < 0) quad(cell[C(i - 1, j, k - 1)], cell[C(i - 1, j, k)], cell[C(i, j, k)], cell[C(i, j, k - 1)], !in0)
    if (in0 !== F[I(i, j, k + 1)] < 0) quad(cell[C(i - 1, j - 1, k)], cell[C(i, j - 1, k)], cell[C(i, j, k)], cell[C(i - 1, j, k)], !in0)
  }

  const P = new Float32Array(pos), N = new Float32Array(pos.length), e = step * 0.35
  for (let q = 0; q < P.length; q += 3) {
    let x = P[q], y = P[q + 1], z = P[q + 2], gx = 0, gy = 0, gz = 1
    for (let it = 0; it < 3; it++) {
      const d = f(x, y, z)
      gx = (f(x + e, y, z) - f(x - e, y, z)) / (2 * e)
      gy = (f(x, y + e, z) - f(x, y - e, z)) / (2 * e)
      gz = (f(x, y, z + e) - f(x, y, z - e)) / (2 * e)
      const g2 = gx * gx + gy * gy + gz * gz
      if (it < 2 && g2 > 1e-6) {
        const s = max(-step * 0.5, min(step * 0.5, d / g2))
        x -= gx * s
        y -= gy * s
        z -= gz * s
      }
    }
    const gl = sqrt(gx * gx + gy * gy + gz * gz) || 1
    P[q] = x
    P[q + 1] = y
    P[q + 2] = z
    N[q] = gx / gl
    N[q + 1] = gy / gl
    N[q + 2] = gz / gl
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(P, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3))
  g.setIndex(idx)
  return g
}

/**
 * Vertex colours (and a glow weight, for lava) from a function of position. Returns a copy that shares the cached
 * position and normal buffers.
 */
export function paint(
  geo: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number, c: THREE.Color) => number | void,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', geo.attributes.position)
  g.setAttribute('normal', geo.attributes.normal)
  g.setIndex(geo.index)
  const P = geo.attributes.position, n = P.count, col = new Float32Array(n * 3), glow = new Float32Array(n)
  const c = new THREE.Color()
  for (let i = 0; i < n; i++) {
    const w = fn(P.getX(i), P.getY(i), P.getZ(i), c)
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
    glow[i] = w || 0
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 1))
  return g
}
