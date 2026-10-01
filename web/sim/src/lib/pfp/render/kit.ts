// Shared bits for building the Mooner: directions on the head, flat shapes, and common materials.
import * as THREE from 'three'

export const D2R = Math.PI / 180
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Unit vector at a longitude (0 = facing the camera, + = to the viewer's right) and latitude, in degrees. */
export const dir = (lon: number, lat: number) =>
  V(Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R), Math.cos(lat * D2R) * Math.cos(lon * D2R))

/** A frame on the sphere: e = out, u = right, w = up. */
export interface Frame {
  e: THREE.Vector3
  u: THREE.Vector3
  w: THREE.Vector3
}

export function frame(e: THREE.Vector3): Frame {
  const u = V(0, 1, 0).cross(e).normalize()
  return { e, u, w: e.clone().cross(u).normalize() }
}

export const quatOf = (f: Frame, tilt = 0) =>
  new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.u, f.w, f.e))
    .multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), tilt))

/** Turns a mesh's +z toward `n`. */
export const facing = (o: THREE.Object3D, n: THREE.Vector3) => o.quaternion.setFromUnitVectors(V(0, 0, 1), n)

export function starShape(r: number, k = 0.16): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, r)
  s.quadraticCurveTo(r * k, r * k, r, 0)
  s.quadraticCurveTo(r * k, -r * k, 0, -r)
  s.quadraticCurveTo(-r * k, -r * k, -r, 0)
  s.quadraticCurveTo(-r * k, r * k, 0, r)
  return s
}

export function heartShape(r: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, -r)
  s.bezierCurveTo(-r * 1.6, -r * 0.1, -r * 0.9, r * 1.15, 0, r * 0.45)
  s.bezierCurveTo(r * 0.9, r * 1.15, r * 1.6, -r * 0.1, 0, -r)
  return s
}

export function diamondShape(r: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, r)
  s.lineTo(r * 0.66, r * 0.18)
  s.lineTo(0, -r)
  s.lineTo(-r * 0.66, r * 0.18)
  s.closePath()
  return s
}

export function rrect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

export function extrude(shape: THREE.Shape, depth: number, bevel: number, curveSegments = 20): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments,
  })
  g.translate(0, 0, -depth / 2)
  return g
}

/** Curves a flat piece back at its edges, to follow a round surface. */
export function bulge(geo: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - k * (p.getX(i) ** 2 + p.getY(i) ** 2))
  geo.computeVertexNormals()
  return geo
}

/** A tube along `curve` whose radius runs from r0 to r1 (horns, scarf tails). */
export function taperTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, segs = 48, radial = 16) {
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false)
  const p = g.attributes.position, n = g.attributes.normal
  const c = new THREE.Vector3(), q = new THREE.Vector3()
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, r = r0 + (r1 - r0) * t
    curve.getPointAt(t, c)
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j
      q.fromBufferAttribute(n, k)
      p.setXYZ(k, c.x + q.x * r, c.y + q.y * r, c.z + q.z * r)
    }
  }
  g.computeVertexNormals()
  return g
}

export function canvasTexture(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

let glowTex: THREE.CanvasTexture | undefined
/** A soft white dot for additive glows; shared, never disposed. */
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex
  glowTex = canvasTexture(256, 256, (x) => {
    const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = gr
    x.fillRect(0, 0, 256, 256)
  })
  glowTex.colorSpace = THREE.NoColorSpace
  glowTex.userData.keep = true
  return glowTex
}

export const metal = (color = '#d9dde4', roughness = 0.22) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness, clearcoat: 0.3 })
export const gold = () => metal('#ffc53d', 0.2)
export const plastic = (color: string, roughness = 0.28) =>
  new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: 1, clearcoatRoughness: 0.08 })
export const cloth = (color: string, sheen = '#ffffff') =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(sheen), sheenRoughness: 0.5 })
export const fabric = (sheen: string) =>
  new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.88, sheen: 1, sheenColor: new THREE.Color(sheen), sheenRoughness: 0.45,
  })
export const additive = (color: string, opacity: number) =>
  new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  })

/** A colour between two, for sheen tints and shading. */
export const mix = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()
