// Adapted from threejseval: Morning Light in a Mixed Grove (claude-opus-5-5-high).
// CC BY-NC 4.0
import * as THREE from 'three'
import { VegetationLod } from './vegetation-lod'


const V3 = THREE.Vector3
const UP = new V3(0, 1, 0)
const X_AXIS = new V3(1, 0, 0)
const TAU = Math.PI * 2

// ---------------------------------------------------------------- math utils

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function vnoise(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x, y, oct = 4) {
  let s = 0
  let amp = 0.5
  let f = 1
  let n = 0
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f + i * 17.3, y * f - i * 9.1)
    n += amp
    amp *= 0.5
    f *= 2.03
  }
  return s / n
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax
  const dz = bz - az
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1)
  return Math.hypot(px - ax - dx * t, pz - az - dz * t)
}
function mix3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

// ---------------------------------------------------------------- layout

// Fixed simulator layout, distinct from the original gallery seed.
const LAYOUT_SEED = 20261013
const CLEAR_X = 0
const CLEAR_Z = -2
const CAM_XZ = [5.5, 9.5]
const TARGET_XZ = [-0.5, -3]

function pathX(z) {
  return 3 * Math.sin(z * 0.08) + 1.5 * Math.sin(z * 0.21 + 1)
}
function pathDist(x, z) {
  return Math.abs(x - pathX(z))
}

export function groundH(x, z) {
  const d = Math.hypot(x - CLEAR_X, z - CLEAR_Z)
  let h = (fbm(x * 0.025 + 10, z * 0.025 - 4, 4) - 0.5) * 7 + (fbm(x * 0.11 + 3, z * 0.11 + 7, 3) - 0.5) * 0.9
  h *= 0.2 + 0.8 * smoothstep(3, 22, d)
  h += smoothstep(50, 130, d) * 9
  h -= 0.1 * (1 - smoothstep(0.5, 1.5, pathDist(x, z)))
  return h
}

// ---------------------------------------------------------------- geometry builder

class Builder {
  constructor() {
    this.p = []
    this.n = []
    this.uv = []
    this.c = []
    this.i = []
  }
  get count() {
    return this.p.length / 3
  }
  vert(p, n, u, v, c) {
    this.p.push(p.x, p.y, p.z)
    this.n.push(n.x, n.y, n.z)
    this.uv.push(u, v)
    this.c.push(c[0], c[1], c[2])
    return this.p.length / 3 - 1
  }
  tri(a, b, c) {
    this.i.push(a, b, c)
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3))
    g.setIndex(this.i)
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

const _t0 = new V3()
function card(b, p0, L, W, n, c0, c1) {
  const v0 = b.vert(_t0.copy(p0).addScaledVector(W, -0.5), n, 0, 0, c0)
  const v1 = b.vert(_t0.copy(p0).add(L).addScaledVector(W, -0.5), n, 1, 0, c1)
  const v2 = b.vert(_t0.copy(p0).add(L).addScaledVector(W, 0.5), n, 1, 1, c1)
  const v3 = b.vert(_t0.copy(p0).addScaledVector(W, 0.5), n, 0, 1, c0)
  b.tri(v0, v1, v2)
  b.tri(v0, v2, v3)
}

function addTube(b, pts, radii, seg, colorFn) {
  const n = pts.length
  const T = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const c = pts[Math.min(n - 1, i + 1)]
    T.push(new V3().subVectors(c, a).normalize())
  }
  let nrm = new V3().crossVectors(T[0], Math.abs(T[0].y) < 0.95 ? UP : X_AXIS).normalize()
  const Ns = []
  const Bs = []
  for (let i = 0; i < n; i++) {
    if (i > 0) nrm = nrm.clone().addScaledVector(T[i], -nrm.dot(T[i])).normalize()
    Ns.push(nrm)
    Bs.push(new V3().crossVectors(T[i], nrm).normalize())
  }
  const circ = TAU * radii[0]
  const uRep = Math.max(1, Math.round(circ / 0.9))
  const vScale = uRep / (circ * 2)
  const start = b.count
  const pos = new V3()
  const dir = new V3()
  let acc = 0
  for (let i = 0; i < n; i++) {
    if (i > 0) acc += pts[i].distanceTo(pts[i - 1])
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU
      dir.copy(Ns[i]).multiplyScalar(Math.cos(a)).addScaledVector(Bs[i], Math.sin(a))
      pos.copy(pts[i]).addScaledVector(dir, radii[i])
      b.vert(pos, dir, (j / seg) * uRep, acc * vScale, colorFn(pos, dir, i / (n - 1)))
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = start + i * (seg + 1) + j
      const c = a + seg + 1
      b.tri(a, a + 1, c)
      b.tri(a + 1, c + 1, c)
    }
  }
}

// Four-sided, capped woody branches follow the generated centerlines.
// Keep branch geometry separate from the trunk used by distant visual LODs.
function addBranch(builder, pts, radii, probes) {
  const indices = pts.length > 3 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : pts.map((_, i) => i)
  const path = indices.map((i) => pts[i])
  const widths = indices.map((i) => radii[i])
  addTube(builder, path, widths, 4, () => [0.42, 0.38, 0.3])
  const end = path.length - 1
  addDisc(builder, path[end], new V3().subVectors(path[end], path[end - 1]).normalize(), widths[end], 4, [0.42, 0.38, 0.3])
  const center = path[0].clone().lerp(path[1], 0.5)
  const normal = new V3().subVectors(path[1], path[0]).normalize()
  normal.cross(Math.abs(normal.y) < 0.95 ? UP : X_AXIS).normalize()
  probes.push({ center: center.toArray(), normal: normal.toArray(), radius: (widths[0] + widths[1]) / 2 })
}

function branchGeometry(builder, probes) {
  const geometry = builder.build()
  geometry.userData.branchProbes = probes
  return geometry
}

function addDisc(b, center, normal, radius, seg, col) {
  const u = new V3().crossVectors(normal, Math.abs(normal.y) < 0.95 ? UP : X_AXIS).normalize()
  const v = new V3().crossVectors(normal, u).normalize()
  const c = b.vert(center, normal, 0.5, 0.5, col)
  const p = new V3()
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * TAU
    p.copy(center).addScaledVector(u, Math.cos(a) * radius).addScaledVector(v, Math.sin(a) * radius)
    b.vert(p, normal, 0.5 + Math.cos(a) * 0.05, 0.5 + Math.sin(a) * 0.05, col)
  }
  for (let j = 0; j < seg; j++) b.tri(c, c + 1 + j, c + 2 + j)
}

function addGeom(b, geom, matrix, color) {
  const pos = geom.attributes.position
  const nor = geom.attributes.normal
  const uv = geom.attributes.uv
  const nm = new THREE.Matrix3().getNormalMatrix(matrix)
  const base = b.count
  const v = new V3()
  const n = new V3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix)
    n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize()
    const c = typeof color === 'function' ? color(v, n) : color
    b.vert(v, n, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, c)
  }
  if (geom.index) {
    const idx = geom.index.array
    for (let i = 0; i < idx.length; i += 3) b.tri(base + idx[i], base + idx[i + 1], base + idx[i + 2])
  } else {
    for (let i = 0; i < pos.count; i += 3) b.tri(base + i, base + i + 1, base + i + 2)
  }
  geom.dispose()
}

function randUnit(rng) {
  const v = new V3()
  do {
    v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1)
  } while (v.lengthSq() > 1 || v.lengthSq() < 0.01)
  return v.normalize()
}

// ---------------------------------------------------------------- textures

function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function alphaTexture(cv, aniso) {
  const w = cv.width
  const h = cv.height
  const src = cv.getContext('2d').getImageData(0, 0, w, h).data
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] > 200) {
      r += src[i]
      g += src[i + 1]
      b += src[i + 2]
      n++
    }
  }
  r = n ? r / n : 60
  g = n ? g / n : 80
  b = n ? b / n : 40
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y
    for (let x = 0; x < w; x++) {
      const si = (sy * w + x) * 4
      const di = (y * w + x) * 4
      if (src[si + 3] === 0) {
        out[di] = r
        out[di + 1] = g
        out[di + 2] = b
        out[di + 3] = 0
      } else {
        out[di] = src[si]
        out[di + 1] = src[si + 1]
        out[di + 2] = src[si + 2]
        out[di + 3] = src[si + 3]
      }
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.anisotropy = aniso
  t.needsUpdate = true
  return t
}

function opaqueTexture(cv, aniso, repeat = 1) {
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = aniso
  return t
}

function makeLeafTexture(aniso) {
  const S = 256
  const cv = makeCanvas(S, S)
  const g = cv.getContext('2d')
  const rng = mulberry32(11)
  g.lineCap = 'round'
  for (let i = 0; i < 7; i++) {
    const a = rng() * TAU
    g.strokeStyle = 'rgba(72,58,38,1)'
    g.lineWidth = 1.6
    g.beginPath()
    g.moveTo(S / 2 + (rng() - 0.5) * 20, S / 2 + (rng() - 0.5) * 20)
    g.lineTo(S / 2 + Math.cos(a) * 95, S / 2 + Math.sin(a) * 95)
    g.stroke()
  }
  for (let i = 0; i < 78; i++) {
    const a = rng() * TAU
    const r = Math.sqrt(rng()) * S * 0.36
    const x = S / 2 + Math.cos(a) * r
    const y = S / 2 + Math.sin(a) * r
    const len = 17 + rng() * 16
    const wid = len * (0.38 + rng() * 0.12)
    const rot = a + (rng() - 0.5) * 1.3
    const hue = 82 + rng() * 30
    const sat = 38 + rng() * 26
    const lig = 22 + rng() * 24
    g.save()
    g.translate(x, y)
    g.rotate(rot)
    g.fillStyle = `hsl(${hue},${sat}%,${lig}%)`
    g.beginPath()
    g.moveTo(0, 0)
    g.quadraticCurveTo(len * 0.45, -wid, len, 0)
    g.quadraticCurveTo(len * 0.45, wid, 0, 0)
    g.fill()
    g.fillStyle = `hsla(${hue},${sat}%,${lig + 10}%,0.45)`
    g.beginPath()
    g.moveTo(0, 0)
    g.quadraticCurveTo(len * 0.45, -wid * 0.9, len, 0)
    g.quadraticCurveTo(len * 0.45, -wid * 0.1, 0, 0)
    g.fill()
    g.strokeStyle = `hsla(${hue - 10},${sat}%,${lig + 18}%,0.55)`
    g.lineWidth = 0.8
    g.beginPath()
    g.moveTo(1, 0)
    g.lineTo(len * 0.9, 0)
    g.stroke()
    g.restore()
  }
  return alphaTexture(cv, aniso)
}

function makeSpruceTexture(aniso) {
  const S = 256
  const cv = makeCanvas(S, S)
  const g = cv.getContext('2d')
  const rng = mulberry32(21)
  g.lineCap = 'round'
  for (let x = 6; x < 246; x += 5.5) {
    const t = x / S
    const Lmax = 112 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.75)
    for (const side of [-1, 1]) {
      if (rng() < 0.1) continue
      const a = 0.75 + rng() * 0.35
      const L = Lmax * (0.7 + rng() * 0.3)
      const dx = Math.cos(a)
      const dy = Math.sin(a) * side
      g.strokeStyle = 'rgba(58,46,30,0.95)'
      g.lineWidth = 1.2
      g.beginPath()
      g.moveTo(x, 128)
      g.lineTo(x + dx * L, 128 + dy * L)
      g.stroke()
      const ta = Math.atan2(dy, dx)
      for (let s = 3; s < L; s += 2.6) {
        const px = x + dx * s
        const py = 128 + dy * s
        const young = s > L * 0.78 && t > 0.25
        const hue = young ? 92 + rng() * 16 : 122 + rng() * 26
        const sat = young ? 42 + rng() * 10 : 26 + rng() * 18
        const lig = young ? 30 + rng() * 9 : 12 + rng() * 14
        g.strokeStyle = `hsl(${hue},${sat}%,${lig}%)`
        g.lineWidth = 1.4
        const nl = 5 + rng() * 4 * (1 - (s / L) * 0.4)
        for (const ns of [-1, 1]) {
          const na = ta + ns * (0.7 + rng() * 0.4)
          g.beginPath()
          g.moveTo(px, py)
          g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl)
          g.stroke()
        }
      }
    }
  }
  g.strokeStyle = 'rgb(66,52,34)'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(0, 128)
  g.lineTo(248, 128)
  g.stroke()
  return alphaTexture(cv, aniso)
}

function makeFernTexture(aniso) {
  const W = 128
  const H = 512
  const cv = makeCanvas(W, H)
  const g = cv.getContext('2d')
  const rng = mulberry32(31)
  g.lineCap = 'round'
  for (let y = H - 34; y > 8; y -= 8) {
    const t = (H - y) / H
    const prof = Math.pow(Math.sin(Math.PI * clamp((t - 0.06) / 0.94, 0, 1)), 0.75)
    const lp = 58 * prof * (1 - 0.25 * t)
    if (lp < 3) continue
    for (const side of [-1, 1]) {
      const yy = y + (side > 0 ? 3 : 0)
      const steps = Math.max(2, Math.floor(lp / 3.6))
      const hueBase = 86 + rng() * 16
      for (let s = 0; s < steps; s++) {
        const k = s / steps
        const px = 64 + side * lp * k
        const py = yy - lp * 0.38 * k
        const pw = 4.6 * (1 - k * 0.7)
        g.fillStyle = `hsl(${hueBase + rng() * 6},${48 + rng() * 14}%,${26 + rng() * 13}%)`
        g.beginPath()
        g.ellipse(px, py - pw * 0.25, pw * 0.85, pw, side * 0.6, 0, TAU)
        g.fill()
      }
      g.strokeStyle = 'rgba(88,118,46,0.8)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(64, yy)
      g.lineTo(64 + side * lp * 0.95, yy - lp * 0.36)
      g.stroke()
    }
  }
  g.strokeStyle = 'rgb(78,98,40)'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(64, H)
  g.quadraticCurveTo(66, H * 0.5, 64, 6)
  g.stroke()
  return alphaTexture(cv, aniso)
}

function makeGrassTexture(aniso) {
  const S = 128
  const cv = makeCanvas(S, S)
  const g = cv.getContext('2d')
  const rng = mulberry32(41)
  for (let i = 0; i < 46; i++) {
    const x0 = 10 + rng() * 108
    const h = 55 + rng() * 70
    const bend = (rng() - 0.5) * 44
    const w = 1.4 + rng() * 1.8
    const dry = rng() < 0.18
    const hue = dry ? 42 + rng() * 10 : 72 + rng() * 30
    const sat = dry ? 30 + rng() * 15 : 35 + rng() * 22
    const lig = dry ? 42 + rng() * 12 : 24 + rng() * 20
    g.fillStyle = `hsl(${hue},${sat}%,${lig}%)`
    g.beginPath()
    g.moveTo(x0 - w, S)
    g.quadraticCurveTo(x0 + bend * 0.25 - w * 0.5, S - h * 0.55, x0 + bend, S - h)
    g.quadraticCurveTo(x0 + bend * 0.25 + w * 0.5, S - h * 0.55, x0 + w, S)
    g.fill()
  }
  return alphaTexture(cv, aniso)
}

function makeBarkTexture(aniso) {
  const W = 256
  const H = 512
  const cv = makeCanvas(W, H)
  const g = cv.getContext('2d')
  const rng = mulberry32(51)
  g.fillStyle = 'rgb(128,118,106)'
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 2600; i++) {
    const v = 85 + rng() * 90
    g.fillStyle = `rgba(${v},${v - 8},${v - 18},0.25)`
    g.fillRect(rng() * W, rng() * H, 2 + rng() * 5, 3 + rng() * 9)
  }
  for (let i = 0; i < 300; i++) {
    const v = 150 + rng() * 40
    g.strokeStyle = `rgba(${v},${v - 6},${v - 14},0.35)`
    g.lineWidth = 2 + rng() * 5
    const x = rng() * W
    const y = rng() * H
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (rng() - 0.5) * 4, y + 10 + rng() * 30)
    g.stroke()
  }
  g.lineCap = 'round'
  for (let i = 0; i < 48; i++) {
    let x = rng() * W
    const w = 1.2 + rng() * 4
    const dark = 26 + rng() * 32
    const pts = []
    for (let y = -10; y <= H + 10; y += 14) {
      x += (rng() - 0.5) * 8
      pts.push([x, y])
    }
    g.strokeStyle = `rgba(${dark},${dark * 0.85},${dark * 0.7},0.85)`
    g.lineWidth = w
    for (const off of [-W, 0, W]) {
      g.beginPath()
      pts.forEach(([px, py], k) => (k ? g.lineTo(px + off, py) : g.moveTo(px + off, py)))
      g.stroke()
    }
  }
  for (let i = 0; i < 140; i++) {
    const d = 30 + rng() * 30
    g.strokeStyle = `rgba(${d},${d * 0.85},${d * 0.7},0.7)`
    g.lineWidth = 1 + rng() * 1.5
    const x = rng() * W
    const y = rng() * H
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + 4 + rng() * 10, y + (rng() - 0.5) * 3)
    g.stroke()
  }
  return opaqueTexture(cv, aniso, 1)
}

function makeLitterTexture(aniso) {
  const S = 512
  const cv = makeCanvas(S, S)
  const g = cv.getContext('2d')
  const rng = mulberry32(61)
  g.fillStyle = 'rgb(126,100,74)'
  g.fillRect(0, 0, S, S)
  const wrap = (x, y, r, fn) => {
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const X = x + ox
        const Y = y + oy
        if (X < -r || X > S + r || Y < -r || Y > S + r) continue
        fn(X, Y)
      }
    }
  }
  for (let i = 0; i < 1800; i++) {
    const v = 70 + rng() * 80
    g.fillStyle = `rgba(${v},${v * 0.8},${v * 0.6},0.3)`
    const x = rng() * S
    const y = rng() * S
    const r = 3 + rng() * 10
    wrap(x, y, r, (X, Y) => {
      g.beginPath()
      g.arc(X, Y, r, 0, TAU)
      g.fill()
    })
  }
  for (let i = 0; i < 1500; i++) {
    const x = rng() * S
    const y = rng() * S
    const len = 7 + rng() * 13
    const wid = len * (0.3 + rng() * 0.2)
    const rot = rng() * TAU
    const hue = 16 + rng() * 28
    const sat = 30 + rng() * 38
    const lig = 20 + rng() * 32
    g.fillStyle = `hsl(${hue},${sat}%,${lig}%)`
    wrap(x, y, len, (X, Y) => {
      g.save()
      g.translate(X, Y)
      g.rotate(rot)
      g.beginPath()
      g.moveTo(-len / 2, 0)
      g.quadraticCurveTo(0, -wid, len / 2, 0)
      g.quadraticCurveTo(0, wid, -len / 2, 0)
      g.fill()
      g.restore()
    })
  }
  g.lineCap = 'round'
  for (let i = 0; i < 380; i++) {
    const x = rng() * S
    const y = rng() * S
    const a = rng() * TAU
    const l = 5 + rng() * 9
    g.strokeStyle = `rgba(${95 + rng() * 40},${60 + rng() * 25},${35 + rng() * 15},0.9)`
    g.lineWidth = 1
    wrap(x, y, l, (X, Y) => {
      g.beginPath()
      g.moveTo(X, Y)
      g.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l)
      g.stroke()
    })
  }
  for (let i = 0; i < 70; i++) {
    const x = rng() * S
    const y = rng() * S
    const a = rng() * TAU
    const l = 20 + rng() * 40
    g.strokeStyle = `rgba(${55 + rng() * 25},${42 + rng() * 15},${28},0.95)`
    g.lineWidth = 1.5 + rng() * 2
    wrap(x, y, l, (X, Y) => {
      g.beginPath()
      g.moveTo(X, Y)
      g.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l)
      g.stroke()
    })
  }
  return opaqueTexture(cv, aniso, 100)
}

function makeRockTexture(aniso) {
  const S = 256
  const cv = makeCanvas(S, S)
  const g = cv.getContext('2d')
  const rng = mulberry32(71)
  g.fillStyle = 'rgb(150,148,142)'
  g.fillRect(0, 0, S, S)
  for (let i = 0; i < 3500; i++) {
    const v = 90 + rng() * 120
    g.fillStyle = `rgba(${v},${v},${v - 6},0.35)`
    g.fillRect(rng() * S, rng() * S, 1 + rng() * 4, 1 + rng() * 4)
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${170 + rng() * 40},${180 + rng() * 30},${120 + rng() * 30},0.35)`
    g.beginPath()
    g.arc(rng() * S, rng() * S, 2 + rng() * 7, 0, TAU)
    g.fill()
  }
  return opaqueTexture(cv, aniso, 2)
}

function makeMoteTexture() {
  const S = 64
  const cv = makeCanvas(S, S)
  const g = cv.getContext('2d')
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.35, 'rgba(255,255,255,0.5)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ---------------------------------------------------------------- tree generators

function barkColorFn(tint, mossDir, mossAmt) {
  return (p, n) => {
    const m = mossAmt * smoothstep(1.8, 0.0, p.y) * smoothstep(-0.3, 0.8, n.x * mossDir.x + n.z * mossDir.z)
    const dk = 0.72 + 0.28 * smoothstep(-0.3, 1.6, p.y)
    return [lerp(tint[0], 0.22, m) * dk, lerp(tint[1], 0.34, m) * dk, lerp(tint[2], 0.09, m) * dk]
  }
}

function makeConifer(seed) {
  const rng = mulberry32(seed)
  const bark = new Builder()
  const fol = new Builder()
  const branches = new Builder()
  const branchProbes = []
  const H = 15 + rng() * 7
  const r0 = 0.18 + H * 0.011
  const lx = (rng() - 0.5) * 0.04
  const lz = (rng() - 0.5) * 0.04
  const trunkAt = (y) =>
    new V3(lx * y + Math.sin(y * 0.7 + seed) * 0.04, y, lz * y + Math.cos(y * 0.5 + seed) * 0.04)
  const mossDir = new V3(Math.cos(seed), 0, Math.sin(seed))
  const tint = [0.5, 0.38, 0.3]
  const colorFn = barkColorFn(tint, mossDir, 0.7)

  const pts = []
  const radii = []
  const N = 14
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const y = -0.4 + t * (H + 0.4)
    pts.push(trunkAt(y))
    const base = r0 * Math.pow(1 - t * 0.97, 1.1) + 0.015
    radii.push(base * (1 + 0.6 * Math.exp(-Math.max(0, y + 0.4) * 2.2)))
  }
  const solid = new Builder()
  addTube(solid, pts, radii, 6, colorFn)
  addTube(bark, pts, radii, 9, colorFn)

  const crownBase = H * (0.2 + rng() * 0.14)
  const Rmax = H * (0.16 + rng() * 0.05)

  const deadCol = () => [0.42, 0.38, 0.34]
  const nDead = 5 + Math.floor(rng() * 6)
  for (let i = 0; i < nDead; i++) {
    const y = 1.3 + rng() * Math.max(0.2, crownBase - 1.3)
    const az = rng() * TAU
    const len = 0.4 + rng() * 1.1
    const dir = new V3(Math.cos(az), -0.15 - rng() * 0.3, Math.sin(az)).normalize()
    const p = trunkAt(y)
    const deadPath = [p, p.clone().addScaledVector(dir, len * 0.5), p.clone().addScaledVector(dir, len)]
    addTube(bark, deadPath, [0.035, 0.022, 0.008], 4, deadCol)
    addBranch(branches, deadPath, [0.035, 0.022, 0.008], branchProbes)
  }

  let y = crownBase
  let az0 = rng() * TAU
  while (y < H - 0.5) {
    const t = (y - crownBase) / (H - crownBase)
    const R = Rmax * Math.pow(1 - t, 0.9) * (0.85 + 0.3 * rng()) + 0.3
    const count = (t < 0.35 ? 6 : t < 0.7 ? 5 : 4) + Math.floor(rng() * 2)
    az0 += 0.9 + rng() * 0.6
    const layerShade = 0.55 + 0.5 * t
    for (let k = 0; k < count; k++) {
      const az = az0 + (k / count) * TAU + (rng() - 0.5) * 0.5
      const droop = lerp(0.42, 0.05, t) + (rng() - 0.5) * 0.2
      const dir = new V3(Math.cos(az) * Math.cos(droop), -Math.sin(droop), Math.sin(az) * Math.cos(droop))
      const len = R * (0.8 + 0.35 * rng())
      const base = trunkAt(y + (rng() - 0.5) * 0.15)
      const side = new V3().crossVectors(dir, UP).normalize()
      const wid = len * 0.62 + 0.22
      const nrm = new V3(dir.x, 0.7, dir.z).normalize()
      const sh = layerShade * (0.9 + rng() * 0.2)
      const hueJ = (rng() - 0.5) * 0.08
      const c0 = [0.4 * sh, 0.42 * sh, 0.4 * sh]
      const c1 = [(1.05 + hueJ) * sh, 1.1 * sh, (0.95 - hueJ) * sh]
      // The original needle cards imply live branches but contain no woody spine.
      // Give substantial boughs matching visible wood and physical geometry.
      if (len >= 1.2 && k % 2 === 0) {
        const radius = Math.max(0.018, len * 0.025)
        const branchPath = [base, base.clone().addScaledVector(dir, len * 0.9)]
        addTube(bark, branchPath, [radius, radius * 0.25], 4, deadCol)
        addBranch(branches, branchPath, [radius, radius * 0.25], branchProbes)
      }
      const L = dir.clone().multiplyScalar(len)
      for (const roll of [-0.42, 0.42]) {
        const W = side.clone().applyAxisAngle(dir, roll + (rng() - 0.5) * 0.2).multiplyScalar(wid)
        card(fol, base, L, W, nrm, c0, c1)
      }
    }
    y += (0.42 + rng() * 0.18) * (1 - 0.35 * t)
  }
  const top = trunkAt(H - 1.1)
  for (const roll of [0, Math.PI / 2]) {
    const W = new V3(Math.cos(roll), 0, Math.sin(roll)).multiplyScalar(0.7)
    card(fol, top, new V3(0, 1.6, 0), W, UP, [0.9, 0.95, 0.85], [1.2, 1.25, 1.0])
  }
  return { branches: branchGeometry(branches, branchProbes), solid: solid.build(), bark: bark.build(), fol: fol.build(), meta: { type: 'c', H, y0: crownBase, R: Rmax } }
}

function makeDeciduous(seed, barkTint, leafTint) {
  const rng = mulberry32(seed)
  const bark = new Builder()
  const fol = new Builder()
  const branches = new Builder()
  const branchProbes = []
  const H = 14 + rng() * 5
  const trunkH = H * (0.36 + rng() * 0.12)
  const r0 = 0.26 + rng() * 0.12
  const lean = new V3((rng() - 0.5) * 0.12, 1, (rng() - 0.5) * 0.12).normalize()
  const mossDir = new V3(Math.cos(seed * 1.7), 0, Math.sin(seed * 1.7))
  const colorFn = barkColorFn(barkTint, mossDir, 0.85)

  const pts = []
  const radii = []
  const NS = 9
  for (let i = 0; i <= NS; i++) {
    const t = i / NS
    const y = -0.4 + t * (trunkH + 0.4)
    const p = lean.clone().multiplyScalar(y)
    p.x += Math.sin(t * 3 + seed) * 0.08
    p.z += Math.cos(t * 2.5 + seed) * 0.08
    pts.push(p)
    radii.push(r0 * (1 - 0.3 * t) * (1 + 0.75 * Math.exp(-Math.max(0, y + 0.4) * 2.5)))
  }
  const solid = new Builder()
  addTube(solid, pts, radii, 6, colorFn)
  addTube(bark, pts, radii, 11, colorFn)

  const clusters = []
  const branch = (start, dir, len, rad, depth) => {
    const bp = [start.clone()]
    const br = [rad]
    const d = dir.clone()
    const p = start.clone()
    const n = 4
    for (let i = 1; i <= n; i++) {
      d.x += (rng() - 0.5) * 0.25
      d.y += (rng() - 0.5) * 0.25 + 0.05
      d.z += (rng() - 0.5) * 0.25
      d.normalize()
      p.addScaledVector(d, len / n)
      bp.push(p.clone())
      br.push(rad * (1 - (0.55 * i) / n))
    }
    addTube(bark, bp, br, depth === 0 ? 7 : 5, colorFn)
    addBranch(branches, bp, br, branchProbes)
    const end = bp[n]
    if (depth >= 2) {
      clusters.push({ c: end.clone(), r: 1.25 + rng() * 0.75 })
      return
    }
    if (depth >= 1) clusters.push({ c: bp[2].clone(), r: 0.9 + rng() * 0.5 })
    const k = 2 + (rng() < 0.55 ? 1 : 0)
    for (let j = 0; j < k; j++) {
      const axis = new V3().crossVectors(d, randUnit(rng)).normalize()
      const nd = d.clone().applyAxisAngle(axis, 0.35 + rng() * 0.45)
      nd.y += 0.1
      nd.normalize()
      branch(end, nd, len * (0.62 + rng() * 0.14), br[n] * 0.95, depth + 1)
    }
  }

  const topR = radii[NS]
  const m = 3 + Math.floor(rng() * 2)
  const az0 = rng() * TAU
  for (let i = 0; i < m; i++) {
    const az = az0 + (i / m) * TAU + (rng() - 0.5) * 0.6
    const a = 0.4 + rng() * 0.4
    const dir = new V3(Math.cos(az) * Math.sin(a), Math.cos(a), Math.sin(az) * Math.sin(a))
    const start = pts[NS - Math.floor(rng() * 2)]
    branch(start, dir, H * (0.26 + rng() * 0.06), topR * 0.72, 0)
  }
  branch(pts[NS], lean.clone().add(new V3((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3)).normalize(), H * 0.24, topR * 0.6, 0)
  for (let i = 0; i < 2; i++) {
    const idx = NS - 2 - i
    const az = rng() * TAU
    const a = 0.9 + rng() * 0.3
    const dir = new V3(Math.cos(az) * Math.sin(a), Math.cos(a), Math.sin(az) * Math.sin(a))
    branch(pts[idx], dir, H * 0.18, radii[idx] * 0.4, 1)
  }

  let minY = Infinity
  let maxY = -Infinity
  const C = new V3()
  for (const cl of clusters) {
    C.add(cl.c)
    minY = Math.min(minY, cl.c.y - cl.r)
    maxY = Math.max(maxY, cl.c.y + cl.r)
  }
  C.divideScalar(clusters.length)
  const cy = (minY + maxY) / 2
  C.y = cy
  const rv = (maxY - minY) / 2
  let rh = 0
  for (const cl of clusters) rh = Math.max(rh, Math.hypot(cl.c.x - C.x, cl.c.z - C.z) + cl.r)
  const crownR = Math.max(rh, rv)

  const q = new V3()
  for (const cl of clusters) {
    const nCards = 11 + Math.floor(rng() * 5)
    for (let i = 0; i < nCards; i++) {
      const dir = randUnit(rng)
      q.copy(cl.c).addScaledVector(dir, cl.r * (0.35 + 0.65 * Math.sqrt(rng())))
      q.y = cl.c.y + (q.y - cl.c.y) * 0.8
      const f = randUnit(rng).addScaledVector(dir, 0.8).addScaledVector(UP, 0.3).normalize()
      const a1 = new V3().crossVectors(f, randUnit(rng)).normalize()
      const a2 = new V3().crossVectors(f, a1).normalize()
      const s = 0.9 + rng() * 0.5
      const L = a1.multiplyScalar(s)
      const W = a2.multiplyScalar(s)
      const p0 = q.clone().addScaledVector(L, -0.5)
      const nrm = new V3()
        .subVectors(q, C)
        .divideScalar(crownR)
        .addScaledVector(new V3().subVectors(q, cl.c).divideScalar(cl.r), 0.6)
        .addScaledVector(UP, 0.35)
        .normalize()
      const rel = clamp(q.distanceTo(C) / crownR, 0, 1)
      const hf = clamp((q.y - (cy - rv)) / (2 * rv), 0, 1)
      const sh = (0.3 + 0.55 * rel * rel + 0.3 * hf) * (0.9 + rng() * 0.2)
      const hj = (rng() - 0.5) * 0.12
      const col = [leafTint[0] * sh * (1 + hj), leafTint[1] * sh, leafTint[2] * sh * (1 - hj)]
      card(fol, p0, L, W, nrm, col, col)
    }
  }
  return {
    bark: bark.build(),
    fol: fol.build(),
    solid: solid.build(),
    branches: branchGeometry(branches, branchProbes),
    meta: { type: 'd', H: maxY, cy, rv, rh },
  }
}

function makeBush(seed, leafTint) {
  const rng = mulberry32(seed)
  const bark = new Builder()
  const fol = new Builder()
  const colorFn = () => [0.42, 0.36, 0.3]
  const clusters = []
  const nStems = 3 + Math.floor(rng() * 2)
  for (let s = 0; s < nStems; s++) {
    const az = rng() * TAU
    const h = 1.0 + rng() * 0.9
    const lean = 0.15 + rng() * 0.3
    const pts = []
    for (let i = 0; i <= 4; i++) {
      const t = i / 4
      pts.push(new V3(Math.cos(az) * lean * t * h, -0.1 + t * h, Math.sin(az) * lean * t * h))
    }
    addTube(bark, pts, [0.03, 0.026, 0.02, 0.014, 0.008], 4, colorFn)
    clusters.push({ c: pts[4].clone(), r: 0.45 + rng() * 0.25 })
    clusters.push({ c: pts[2].clone().add(new V3(Math.cos(az + 1) * 0.25, 0, Math.sin(az + 1) * 0.25)), r: 0.35 + rng() * 0.2 })
  }
  const C = new V3()
  clusters.forEach((c) => C.add(c.c))
  C.divideScalar(clusters.length)
  const q = new V3()
  for (const cl of clusters) {
    for (let i = 0; i < 10; i++) {
      const dir = randUnit(rng)
      q.copy(cl.c).addScaledVector(dir, cl.r * (0.3 + 0.7 * Math.sqrt(rng())))
      const f = randUnit(rng).addScaledVector(dir, 0.7).normalize()
      const a1 = new V3().crossVectors(f, randUnit(rng)).normalize()
      const a2 = new V3().crossVectors(f, a1).normalize()
      const s = 0.5 + rng() * 0.3
      const L = a1.multiplyScalar(s)
      const W = a2.multiplyScalar(s)
      const nrm = new V3().subVectors(q, C).normalize().addScaledVector(UP, 0.5).normalize()
      const sh = (0.45 + 0.5 * clamp(q.y / 2, 0, 1)) * (0.9 + rng() * 0.2)
      const col = [leafTint[0] * sh, leafTint[1] * sh, leafTint[2] * sh]
      card(fol, q.clone().addScaledVector(L, -0.5), L, W, nrm, col, col)
    }
  }
  return { bark: bark.build(), fol: fol.build() }
}

function makeFern(seed) {
  const rng = mulberry32(seed)
  const b = new Builder()
  const nF = 9 + Math.floor(rng() * 5)
  const segs = 7
  for (let f = 0; f < nF; f++) {
    const az = (f / nF) * TAU + (rng() - 0.5) * 0.5
    const L = 0.7 + rng() * 0.6
    const elev0 = 0.95 + rng() * 0.4
    const elevEnd = -0.25 - rng() * 0.45
    const width = L * 0.42
    const out = new V3(Math.cos(az), 0, Math.sin(az))
    const side = new V3(-Math.sin(az), 0, Math.cos(az)).applyAxisAngle(out, (rng() - 0.5) * 0.5)
    const nrm = new V3().copy(UP).addScaledVector(out, 0.3).normalize()
    const p = new V3(out.x * 0.03, 0.0, out.z * 0.03)
    const start = b.count
    const q = new V3()
    const tone = 0.85 + rng() * 0.25
    for (let s = 0; s <= segs; s++) {
      const t = s / segs
      const sh = (0.45 + 0.6 * t) * tone
      const col = [sh, sh * 1.02, sh * 0.9]
      b.vert(q.copy(p).addScaledVector(side, -width / 2), nrm, 0, t, col)
      b.vert(q.copy(p).addScaledVector(side, width / 2), nrm, 1, t, col)
      const elev = lerp(elev0, elevEnd, t)
      const dir = out.clone().multiplyScalar(Math.cos(elev)).addScaledVector(UP, Math.sin(elev))
      p.addScaledVector(dir, L / segs)
    }
    for (let s = 0; s < segs; s++) {
      const a = start + s * 2
      b.tri(a, a + 1, a + 3)
      b.tri(a, a + 3, a + 2)
    }
  }
  return b.build()
}

function makeGrassTuft(seed) {
  const rng = mulberry32(seed)
  const b = new Builder()
  for (let i = 0; i < 3; i++) {
    const az = (i / 3) * Math.PI + (rng() - 0.5) * 0.4
    const W = new V3(Math.cos(az), 0, Math.sin(az)).multiplyScalar(0.55)
    const tilt = new V3(-Math.sin(az), 0, Math.cos(az)).multiplyScalar((rng() - 0.5) * 0.25)
    const L = new V3(0, 0.42 + rng() * 0.18, 0).add(tilt)
    const p0 = new V3(0, -0.02, 0)
    const v0 = b.vert(p0.clone().addScaledVector(W, -0.5), UP, 0, 0, [0.35, 0.35, 0.3])
    const v1 = b.vert(p0.clone().addScaledVector(W, 0.5), UP, 1, 0, [0.35, 0.35, 0.3])
    const v2 = b.vert(p0.clone().add(L).addScaledVector(W, 0.5), UP, 1, 1, [1.05, 1.05, 0.95])
    const v3 = b.vert(p0.clone().add(L).addScaledVector(W, -0.5), UP, 0, 1, [1.05, 1.05, 0.95])
    b.tri(v0, v1, v2)
    b.tri(v0, v2, v3)
  }
  return b.build()
}

function makeRockGeom(seed) {
  const g = new THREE.SphereGeometry(1, 22, 16)
  const pos = g.attributes.position
  const v = new V3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const n1 = fbm(v.x * 1.1 + seed * 7.1, v.y * 1.1 + v.z * 0.9 + seed, 4)
    const n2 = vnoise(v.z * 3 + seed, v.x * 3 - v.y * 2)
    v.multiplyScalar(0.75 + n1 * 0.55 + n2 * 0.08)
    v.y *= 0.62
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.3
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  const nor = g.attributes.normal
  const colors = new Float32Array(pos.count * 3)
  const col = new THREE.BufferAttribute(colors, 3)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const ny = nor.getY(i)
    const moss = smoothstep(0.3, 0.8, ny + (vnoise(v.x * 2.5 + seed, v.z * 2.5) - 0.5) * 0.5)
    const gray = 0.38 + vnoise(v.x * 4 + 3, v.y * 4 + v.z * 3) * 0.14
    const c = mix3([gray, gray * 0.98, gray * 0.93], [0.2, 0.3, 0.09], moss)
    col.setXYZ(i, c[0], c[1], c[2])
  }
  g.setAttribute('color', col)
  return g
}

// ---------------------------------------------------------------- materials

function foliageMaterial(map, shared, amp, trans) {
  const m = new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
  })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime
    shader.uniforms.uSunView = shared.uSunView
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPos = instanceMatrix[3].xyz;
        #else
          vec3 iPos = vec3(0.0);
        #endif
        float hgt = max(position.y, 0.0);
        float sw = sin(uTime * 0.8 + iPos.x * 0.23 + iPos.z * 0.19) + 0.35 * sin(uTime * 2.1 + position.x * 1.9 + position.z * 1.6 + iPos.x);
        transformed.x += sw * ${amp.toFixed(4)} * hgt;
        transformed.z += 0.6 * sw * ${amp.toFixed(4)} * hgt;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView;')
      .replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.split('normal *= faceDirection;').join('')
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float backLit = pow(max(dot(normalize(-vViewPosition), uSunView), 0.0), 4.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.95, 0.55) * backLit * ${trans.toFixed(3)};`
      )
  }
  m.customProgramCacheKey = () => `forest-foliage-${amp}-${trans}`
  return m
}

// ---------------------------------------------------------------- mount

export function createForest(renderer) {
  const collision = new THREE.Group()
  collision.name = 'Forest collision'
  const collisionMaterial = new THREE.MeshBasicMaterial()
  const scene = new THREE.Group()
  scene.name = 'Morning Light in a Mixed Grove'
  const addCollider = (geometry, transform) => {
    const mesh = new THREE.Mesh(geometry, collisionMaterial)
    if (transform) {
      mesh.position.set(transform.x, transform.y, transform.z)
      mesh.rotation.set(transform.rx || 0, transform.ry || 0, transform.rz || 0)
      mesh.scale.setScalar(transform.s)
    }
    collision.add(mesh)
  }
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const textures = []
  const tex = (t) => (textures.push(t), t)

  const fogColor = new THREE.Color(0xa7b7a6)
  const fog = new THREE.FogExp2(fogColor, 0.021)

  const target = new V3(TARGET_XZ[0], groundH(...TARGET_XZ) + 4.2, TARGET_XZ[1])

  const shared = { uTime: { value: 0 }, uSunView: { value: new V3(0, 1, 0) } }

  // -------------------------------------------------- lights & sky
  const sunDir = new V3(-0.66, 0.68, -0.32).normalize()
  const sun = new THREE.DirectionalLight(0xffe1b8, 3.4)
  sun.position.copy(target).addScaledVector(sunDir, 90)
  sun.target.position.copy(target)
  scene.add(sun, sun.target)
  sun.castShadow = true
  // Shadow shaders do not animate foliage; reuse the map until a caster changes.
  sun.shadow.autoUpdate = false
  sun.shadow.needsUpdate = true
  // 4096 stalls headless SwiftShader past the smoke harness timeout.
  const sm = 1024
  sun.shadow.mapSize.set(sm, sm)
  const sc = sun.shadow.camera
  sc.left = -48
  sc.right = 48
  sc.top = 48
  sc.bottom = -48
  sc.near = 5
  sc.far = 200
  sc.updateProjectionMatrix()
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  sun.shadow.radius = 2

  const hemi = new THREE.HemisphereLight(0xc2d6e6, 0x4a4028, 1.15)
  scene.add(hemi)

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x8db4d6) },
        horizon: { value: fogColor.clone() },
        sunDir: { value: sunDir },
        sunCol: { value: new THREE.Color(0xfff0d2) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 sunDir;
        uniform vec3 sunCol;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 c = mix(horizon, top, pow(h, 0.6));
          float s = max(dot(d, sunDir), 0.0);
          c += sunCol * (pow(s, 10.0) * 0.5 + pow(s, 400.0) * 5.0);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  )
  sky.frustumCulled = false
  sky.renderOrder = -1
  scene.add(sky)

  // -------------------------------------------------- textures & materials
  const leafTex = tex(makeLeafTexture(aniso))
  const spruceTex = tex(makeSpruceTexture(aniso))
  const fernTex = tex(makeFernTexture(aniso))
  const grassTex = tex(makeGrassTexture(aniso))
  const barkTex = tex(makeBarkTexture(aniso))
  const litterTex = tex(makeLitterTexture(aniso))
  const rockTex = tex(makeRockTexture(aniso))
  const moteTex = tex(makeMoteTexture())

  const barkMat = new THREE.MeshStandardMaterial({
    map: barkTex,
    bumpMap: barkTex,
    bumpScale: 2,
    roughness: 0.95,
    vertexColors: true,
  })
  const leafMat = foliageMaterial(leafTex, shared, 0.004, 0.55)
  const spruceMat = foliageMaterial(spruceTex, shared, 0.003, 0.3)
  const fernMat = foliageMaterial(fernTex, shared, 0.035, 0.5)
  const grassMat = foliageMaterial(grassTex, shared, 0.06, 0.45)
  const rockMat = new THREE.MeshStandardMaterial({
    map: rockTex,
    bumpMap: rockTex,
    bumpScale: 1.2,
    roughness: 0.92,
    vertexColors: true,
  })
  const groundMat = new THREE.MeshStandardMaterial({
    map: litterTex,
    bumpMap: litterTex,
    bumpScale: 1.4,
    roughness: 1,
    vertexColors: true,
  })
  const mushMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })

  // -------------------------------------------------- variants
  const conifers = [101, 202, 303, 404, 505].map((s) => makeConifer(s))
  const decids = [
    makeDeciduous(611, [0.62, 0.6, 0.56], [1.08, 1.12, 0.78]),
    makeDeciduous(722, [0.47, 0.41, 0.34], [0.82, 0.92, 0.7]),
    makeDeciduous(833, [0.6, 0.58, 0.54], [1.12, 1.15, 0.72]),
    makeDeciduous(944, [0.45, 0.4, 0.33], [0.9, 0.98, 0.74]),
  ]
  const bushes = [makeBush(1201, [0.95, 1.05, 0.75]), makeBush(1302, [0.85, 0.98, 0.7])]
  const ferns = [makeFern(1401), makeFern(1502)]
  const grassGeo = makeGrassTuft(1601)
  const rockGeos = [makeRockGeom(3), makeRockGeom(7), makeRockGeom(12)]

  // -------------------------------------------------- props layout (logs/stumps first so trees avoid them)
  const propRng = mulberry32(LAYOUT_SEED ^ 0x51a7)
  const propCenters = []
  const placeProp = (radius) => {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const angle = propRng() * TAU
      const distance = 9 + propRng() * 22
      const x = CLEAR_X + Math.cos(angle) * distance
      const z = CLEAR_Z + Math.sin(angle) * distance
      if (pathDist(x, z) < radius + 1.8) continue
      if (propCenters.some((p) => Math.hypot(x - p.x, z - p.z) < radius + p.radius + 2)) continue
      propCenters.push({ x, z, radius })
      return { x, z }
    }
    throw new Error('Could not place forest props with adequate clearance')
  }
  const logs = Array.from({ length: 4 }, () => {
    const length = 3.2 + propRng() * 2.8
    const center = placeProp(length / 2)
    const angle = propRng() * TAU
    const dx = Math.cos(angle) * length / 2
    const dz = Math.sin(angle) * length / 2
    return { a: [center.x - dx, center.z - dz], b: [center.x + dx, center.z + dz], r: 0.27 + propRng() * 0.1 }
  })
  const stumps = Array.from({ length: 3 }, () => {
    const radius = 0.3 + propRng() * 0.14
    return { ...placeProp(radius), r: radius }
  })

  // -------------------------------------------------- tree placement
  const rng = mulberry32(LAYOUT_SEED)
  const trees = []
  const tooClose = (x, z, md) => {
    for (const t of trees) {
      const dx = t.x - x
      const dz = t.z - z
      if (dx * dx + dz * dz < md * md) return true
    }
    return false
  }
  const nearProps = (x, z, pad) => {
    for (const l of logs) if (distSeg(x, z, l.a[0], l.a[1], l.b[0], l.b[1]) < pad) return true
    for (const s of stumps) if (Math.hypot(x - s.x, z - s.z) < pad) return true
    return false
  }
  const treeExcluded = (x, z, shrink = 0) => {
    const dC = Math.hypot(x - CLEAR_X, z - CLEAR_Z)
    const edge = 7.5 - shrink + (fbm(x * 0.2 + 3, z * 0.2 - 5, 2) - 0.5) * 4
    if (dC < edge) return true
    if (distSeg(x, z, CAM_XZ[0], CAM_XZ[1], TARGET_XZ[0], TARGET_XZ[1]) < 3.4 - shrink * 0.4) return true
    if (pathDist(x, z) < 1.8) return true
    if (nearProps(x, z, 1.2)) return true
    return false
  }
  const species = (x, z, d) => {
    const v = fbm(x * 0.045 + 40, z * 0.045 - 13, 3) + (rng() - 0.5) * 0.35 + smoothstep(15, 60, d) * 0.15
    return v > 0.5 ? 'c' : 'd'
  }
  const addTree = (x, z, type, s, variant) => {
    const list = type === 'c' ? conifers : decids
    const vi = variant ?? Math.floor(rng() * list.length)
    trees.push({ x, z, type, v: vi, s, ry: rng() * TAU, meta: list[vi].meta })
  }

  let placed = 0
  for (let i = 0; i < 8000 && placed < 200; i++) {
    const a = rng() * TAU
    const r = Math.sqrt(rng()) * 48
    const x = CLEAR_X + Math.cos(a) * r
    const z = CLEAR_Z + Math.sin(a) * r
    if (treeExcluded(x, z)) continue
    if (tooClose(x, z, 2.6 + rng() * 1.6)) continue
    addTree(x, z, species(x, z, r), 0.8 + rng() * 0.45)
    placed++
  }
  placed = 0
  for (let i = 0; i < 6000 && placed < 140; i++) {
    const a = rng() * TAU
    const r = 46 + rng() * 70
    const x = CLEAR_X + Math.cos(a) * r
    const z = CLEAR_Z + Math.sin(a) * r
    if (pathDist(x, z) < 1.8) continue
    if (tooClose(x, z, 4.6 + rng() * 1.5)) continue
    addTree(x, z, species(x, z, r), 0.85 + rng() * 0.4)
    placed++
  }
  const bigTrees = trees.slice()

  const saplings = []
  for (let i = 0; i < 900 && saplings.length < 70; i++) {
    const a = rng() * TAU
    const r = 6 + Math.sqrt(rng()) * 38
    const x = CLEAR_X + Math.cos(a) * r
    const z = CLEAR_Z + Math.sin(a) * r
    if (treeExcluded(x, z, 2)) continue
    if (tooClose(x, z, 1.8)) continue
    const s = 0.14 + rng() * 0.2
    addTree(x, z, 'c', s)
    saplings.push(trees[trees.length - 1])
  }
  const bushList = []
  for (let i = 0; i < 900 && bushList.length < 90; i++) {
    const a = rng() * TAU
    const r = 6 + Math.sqrt(rng()) * 40
    const x = CLEAR_X + Math.cos(a) * r
    const z = CLEAR_Z + Math.sin(a) * r
    if (treeExcluded(x, z, 2.5)) continue
    if (tooClose(x, z, 1.4)) continue
    bushList.push({ x, z, v: Math.floor(rng() * bushes.length), s: 0.8 + rng() * 0.6, ry: rng() * TAU })
  }

  // spatial grid for undergrowth / ground tint
  const CELL = 6
  const grid = new Map()
  const key = (cx, cz) => (cx + 1000) * 4000 + (cz + 1000)
  for (const t of trees) {
    const k = key(Math.floor(t.x / CELL), Math.floor(t.z / CELL))
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(t)
  }
  const eachNear = (x, z, fn) => {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get(key(cx + dx, cz + dz))
        if (arr) for (const t of arr) fn(t)
      }
    }
  }

  // -------------------------------------------------- ground
  {
    const g = new THREE.PlaneGeometry(300, 300, 150, 150)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    const colors = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3)
    const litter = [0.3, 0.2, 0.12]
    const mossC = [0.13, 0.19, 0.06]
    const soil = [0.15, 0.1, 0.065]
    const pathC = [0.3, 0.24, 0.17]
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = groundH(x, z)
      pos.setXYZ(i, x, y, z)
      let c = litter
      const nMoss = fbm(x * 0.07 + 3, z * 0.07 - 8, 4)
      const nSoil = fbm(x * 0.23 - 20, z * 0.23 + 5, 3)
      c = mix3(c, mossC, smoothstep(0.5, 0.68, nMoss) * 0.85)
      c = mix3(c, soil, smoothstep(0.55, 0.75, nSoil) * 0.7)
      let near = 0
      let dens = 0
      eachNear(x, z, (t) => {
        const d = Math.hypot(x - t.x, z - t.z)
        near = Math.max(near, 1 - smoothstep(0.2, 2.4 * t.s, d))
        dens += 1 - smoothstep(0, 6, d)
      })
      c = mix3(c, mossC, near * 0.55)
      const pw = 1 - smoothstep(0.55, 1.25, pathDist(x, z) + (vnoise(x * 1.5, z * 1.5) - 0.5) * 0.4)
      c = mix3(c, pathC, pw * 0.9)
      const k = 1 - 0.22 * Math.min(1, dens * 0.4)
      colors.setXYZ(i, c[0] * k, c[1] * k, c[2] * k)
    }
    g.setAttribute('color', colors)
    g.computeVertexNormals()
    const ground = new THREE.Mesh(g, groundMat)
    ground.receiveShadow = true
    scene.add(ground)
    addCollider(g.clone())
  }

  // -------------------------------------------------- instancing helper
  const vegetation = new VegetationLod(scene)
  const addInstanced = (geom, mat, list, opts = {}) => vegetation.add(geom, mat, list, opts)

  for (const t of trees) {
    t.y = groundH(t.x, t.z) - 0.05
    t.rx = (rng() - 0.5) * 0.05
    t.rz = (rng() - 0.5) * 0.05
    t.tint = new THREE.Color(
      (0.88 + rng() * 0.22) * (1 + (rng() - 0.5) * 0.12),
      0.88 + rng() * 0.22,
      (0.88 + rng() * 0.22) * (1 + (rng() - 0.5) * 0.2)
    )
  }
  const tintOf = (it) => it.tint
  conifers.forEach((c, vi) => {
    const list = trees.filter((t) => t.type === 'c' && t.v === vi)
    list.forEach((t) => {
      addCollider(c.solid, t)
      addCollider(c.branches, t)
      collision.children[collision.children.length - 1].name = 'Conifer branches'
    })
    addInstanced(c.bark, barkMat, list, { farGeometry: c.solid })
    addInstanced(c.fol, spruceMat, list, { color: tintOf, foliage: true })
  })
  decids.forEach((d, vi) => {
    const list = trees.filter((t) => t.type === 'd' && t.v === vi)
    list.forEach((t) => {
      addCollider(d.solid, t)
      addCollider(d.branches, t)
      collision.children[collision.children.length - 1].name = 'Deciduous branches'
    })
    addInstanced(d.bark, barkMat, list, { farGeometry: d.solid })
    addInstanced(d.fol, leafMat, list, { color: tintOf, foliage: true })
  })
  bushes.forEach((bsh, vi) => {
    const list = bushList
      .filter((b) => b.v === vi)
      .map((b) => ({ ...b, y: groundH(b.x, b.z) - 0.05, tint: new THREE.Color(0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 0.85 + rng() * 0.2) }))
    addInstanced(bsh.bark, barkMat, list, { cast: false, undergrowth: true })
    addInstanced(bsh.fol, leafMat, list, { color: tintOf, foliage: true, undergrowth: true, cast: false })
  })

  // -------------------------------------------------- undergrowth
  const nearTrunk = (x, z, pad) => {
    let hit = false
    eachNear(x, z, (t) => {
      if (Math.hypot(x - t.x, z - t.z) < pad * Math.max(0.5, t.s)) hit = true
    })
    return hit
  }
  const treeDensity = (x, z) => {
    let dens = 0
    eachNear(x, z, (t) => {
      dens += 1 - smoothstep(0, 5, Math.hypot(x - t.x, z - t.z))
    })
    return dens
  }
  const camFoot = (x, z) => Math.hypot(x - CAM_XZ[0], z - CAM_XZ[1]) < 1.6
    || Math.hypot(x - CLEAR_X, z - CLEAR_Z) < 2

  const fernLists = [[], []]
  for (let i = 0; i < 2600; i++) {
    const a = rng() * TAU
    const r = Math.sqrt(rng()) * 44
    const x = CLEAR_X + Math.cos(a) * r
    const z = CLEAR_Z + Math.sin(a) * r
    if (pathDist(x, z) < 1.1 || camFoot(x, z) || nearTrunk(x, z, 0.6) || nearProps(x, z, 0.5)) continue
    const mask = fbm(x * 0.09 + 5, z * 0.09 + 9, 3) + treeDensity(x, z) * 0.06
    if (mask < 0.5 + rng() * 0.12) continue
    const list = fernLists[Math.floor(rng() * 2)]
    const shade = 0.8 + rng() * 0.3
    list.push({
      x,
      z,
      y: groundH(x, z) - 0.03,
      s: 0.7 + rng() * 0.7,
      ry: rng() * TAU,
      tint: new THREE.Color(shade * (0.95 + rng() * 0.1), shade, shade * (0.85 + rng() * 0.15)),
    })
  }
  ferns.forEach((g, vi) => addInstanced(g, fernMat, fernLists[vi], { color: tintOf, undergrowth: true, cast: false }))

  const grassList = []
  for (let i = 0; i < 9000 && grassList.length < 2600; i++) {
    const a = rng() * TAU
    const r = Math.sqrt(rng()) * 30
    const x = CLEAR_X + Math.cos(a) * r
    const z = CLEAR_Z + Math.sin(a) * r
    const pd = pathDist(x, z)
    if (pd < 0.75 && rng() < 0.9) continue
    if (camFoot(x, z) || nearTrunk(x, z, 0.5) || nearProps(x, z, 0.35)) continue
    const p = (1 - smoothstep(5, 13, r)) * 0.9 + smoothstep(0.7, 1.4, pd) * (1 - smoothstep(1.4, 2.6, pd)) * 0.6 + 0.05
    if (rng() > p) continue
    const shade = 0.75 + rng() * 0.35
    grassList.push({
      x,
      z,
      y: groundH(x, z),
      s: 0.6 + rng() * 0.8,
      ry: rng() * TAU,
      tint: new THREE.Color(shade * (1 + (rng() - 0.3) * 0.2), shade, shade * 0.85),
    })
  }
  addInstanced(grassGeo, grassMat, grassList, { color: tintOf, cast: false, undergrowth: true })

  const rockLists = [[], [], []]
  for (let i = 0; i < 400 && rockLists.flat().length < 36; i++) {
    const a = rng() * TAU
    const r = 3 + Math.sqrt(rng()) * 36
    const x = CLEAR_X + Math.cos(a) * r
    const z = CLEAR_Z + Math.sin(a) * r
    if (pathDist(x, z) < 1.3 || camFoot(x, z) || nearTrunk(x, z, 1.0)) continue
    const s = rng() < 0.2 ? 0.7 + rng() * 0.6 : 0.2 + rng() * 0.35
    rockLists[Math.floor(rng() * 3)].push({
      x,
      z,
      y: groundH(x, z) - 0.12 * s,
      s,
      ry: rng() * TAU,
      rx: (rng() - 0.5) * 0.3,
      rz: (rng() - 0.5) * 0.3,
    })
  }
  rockGeos.forEach((g, vi) => {
    addInstanced(g, rockMat, rockLists[vi])
    rockLists[vi].forEach((t) => addCollider(g, t))
  })

  // -------------------------------------------------- logs, stumps, mushrooms
  {
    const b = new Builder()
    const wood = [0.72, 0.56, 0.38]
    const logColor = (tint) => (p, n) => {
      const m = smoothstep(0.1, 0.75, n.y + (vnoise(p.x * 3, p.z * 3) - 0.5) * 0.5)
      return mix3(tint, [0.33, 0.48, 0.13], m * 0.9)
    }
    for (const l of logs) {
      const pts = []
      const radii = []
      const n = 10
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const x = lerp(l.a[0], l.b[0], t)
        const z = lerp(l.a[1], l.b[1], t)
        pts.push(new V3(x, groundH(x, z) + l.r * 0.72, z))
        radii.push(l.r * (1 - 0.18 * t) * (0.95 + vnoise(t * 8, l.r * 10) * 0.1))
      }
      addTube(b, pts, radii, 12, logColor([0.44, 0.37, 0.3]))
      const t0 = new V3().subVectors(pts[0], pts[1]).normalize()
      const t1 = new V3().subVectors(pts[n], pts[n - 1]).normalize()
      addDisc(b, pts[0], t0, radii[0] * 0.98, 12, wood)
      addDisc(b, pts[n], t1, radii[n] * 0.98, 12, wood)
    }
    for (const s of stumps) {
      const gy = groundH(s.x, s.z)
      const h = 0.45 + s.r * 0.4
      const pts = []
      const radii = []
      for (let i = 0; i <= 4; i++) {
        const t = i / 4
        pts.push(new V3(s.x, gy - 0.2 + t * (h + 0.2), s.z))
        radii.push(s.r * (1 + 0.45 * Math.exp(-t * 4)))
      }
      addTube(b, pts, radii, 12, (p, n) => {
        const m = smoothstep(gy + 0.4, gy, p.y) * 0.7
        return mix3([0.46, 0.38, 0.3], [0.24, 0.36, 0.1], m)
      })
      addDisc(b, pts[4], UP, radii[4] * 0.98, 12, [0.6, 0.47, 0.32])
    }
    const props = new THREE.Mesh(b.build(), barkMat)
    props.castShadow = true
    props.receiveShadow = true
    scene.add(props)
    addCollider(props.geometry)

    const mb = new Builder()
    const mrng = mulberry32(LAYOUT_SEED ^ 0x777)
    const spots = []
    for (let attempt = 0; attempt < 1000 && spots.length < 8; attempt++) {
      const angle = mrng() * TAU
      const distance = 5 + mrng() * 27
      const x = CLEAR_X + Math.cos(angle) * distance
      const z = CLEAR_Z + Math.sin(angle) * distance
      if (pathDist(x, z) < 1.1 || nearTrunk(x, z, 0.8) || nearProps(x, z, 0.7)) continue
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 2)) continue
      spots.push([x, z])
    }
    const mtx = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const sc3 = new V3()
    for (const [sx, sz] of spots) {
      const n = 3 + Math.floor(mrng() * 5)
      const capCol = mrng() < 0.5 ? [0.55, 0.3, 0.14] : [0.7, 0.55, 0.36]
      for (let i = 0; i < n; i++) {
        const x = sx + (mrng() - 0.5) * 0.6
        const z = sz + (mrng() - 0.5) * 0.6
        const y = groundH(x, z)
        const hgt = 0.05 + mrng() * 0.08
        const cr = 0.035 + mrng() * 0.05
        q.setFromEuler(new THREE.Euler((mrng() - 0.5) * 0.3, 0, (mrng() - 0.5) * 0.3))
        mtx.compose(new V3(x, y + hgt / 2 - 0.01, z), q, sc3.set(1, 1, 1))
        addGeom(mb, new THREE.CylinderGeometry(cr * 0.28, cr * 0.36, hgt, 6), mtx, [0.78, 0.74, 0.64])
        mtx.compose(new V3(x, y + hgt - 0.015, z), q, sc3.set(1, 0.62, 1))
        addGeom(mb, new THREE.SphereGeometry(cr, 10, 5, 0, TAU, 0, Math.PI / 2), mtx, capCol)
      }
    }
    const mush = new THREE.Mesh(mb.build(), mushMat)
    mush.castShadow = true
    mush.receiveShadow = true
    scene.add(mush)
  }

  // -------------------------------------------------- sun shafts
  const occlusion = (px, py, pz) => {
    let near = 0
    for (const t of bigTrees) {
      if (Math.abs(t.x - px) > 45 || Math.abs(t.z - pz) > 45) continue
      const m = t.meta
      const gy = t.y
      let y0
      let y1
      let radAt
      if (m.type === 'c') {
        y0 = gy + m.y0 * t.s
        y1 = gy + m.H * t.s
        const R = m.R * t.s
        radAt = (y) => R * (1 - (y - y0) / (y1 - y0)) + 0.3
      } else {
        const cy = gy + m.cy * t.s
        const rv = m.rv * t.s
        const rh = m.rh * t.s
        y0 = cy - rv
        y1 = cy + rv
        radAt = (y) => rh * Math.sqrt(Math.max(0, 1 - ((y - cy) / rv) ** 2))
      }
      for (let y = Math.max(y0, py + 0.5); y < y1; y += 1.2) {
        const k = (y - py) / sunDir.y
        const d = Math.hypot(px + sunDir.x * k - t.x, pz + sunDir.z * k - t.z)
        const rad = radAt(y)
        if (d < rad * 0.85) return { blocked: true, near }
        if (d < rad + 2.5) near++
      }
    }
    return { blocked: false, near }
  }
  const beamSpots = []
  const brng = mulberry32(LAYOUT_SEED ^ 0x99)
  for (let i = 0; i < 500 && beamSpots.length < 7; i++) {
    const a = brng() * TAU
    const r = Math.sqrt(brng()) * 20
    const x = CLEAR_X + Math.cos(a) * r
    const z = CLEAR_Z + Math.sin(a) * r
    const y = groundH(x, z)
    const o = occlusion(x, y, z)
    if (o.blocked || o.near < 2) continue
    if (beamSpots.some((b) => Math.hypot(b.x - x, b.z - z) < 3.2)) continue
    beamSpots.push({ x, y, z, r: 0.5 + brng() * 0.9 })
  }
  if (beamSpots.length < 3) {
    for (let i = 0; i < 3; i++) {
      const angle = brng() * TAU
      const radius = 2 + brng() * 3
      const x = CLEAR_X + Math.cos(angle) * radius
      const z = CLEAR_Z + Math.sin(angle) * radius
      beamSpots.push({ x, y: groundH(x, z), z, r: 0.8 })
    }
  }

  const BEAM_LEN = 42
  const beamGeo = new THREE.CylinderGeometry(1.12, 1, 1, 24, 1, true)
  const beamMats = []
  const beamQuat = new THREE.Quaternion().setFromUnitVectors(UP, sunDir)
  for (const bs of beamSpots) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(1.0, 0.86, 0.62) },
        uOpacity: { value: 0.07 + brng() * 0.06 },
        uTime: shared.uTime,
        uPhase: { value: brng() * 10 },
      },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        varying float vY;
        void main() {
          vY = uv.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = -mv.xyz;
          vN = normalMatrix * normal;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        uniform float uPhase;
        varying vec3 vN;
        varying vec3 vV;
        varying float vY;
        void main() {
          float f = abs(dot(normalize(vN), normalize(vV)));
          float edge = pow(f, 2.5);
          float along = smoothstep(0.0, 0.035, vY) * (1.0 - smoothstep(0.3, 0.75, vY));
          float breathe = 0.85 + 0.15 * sin(uTime * 0.35 + uPhase);
          gl_FragColor = vec4(uColor * edge * along * uOpacity * breathe, 1.0);
        }`,
    })
    beamMats.push(mat)
    const beam = new THREE.Mesh(beamGeo, mat)
    beam.scale.set(bs.r, BEAM_LEN, bs.r)
    beam.quaternion.copy(beamQuat)
    beam.position.set(bs.x, bs.y, bs.z).addScaledVector(sunDir, BEAM_LEN / 2 - 0.6)
    beam.renderOrder = 2
    scene.add(beam)
  }

  // dust motes drifting inside the shafts
  const MOTES = 520
  const moteBase = new Float32Array(MOTES * 3)
  const motePhase = new Float32Array(MOTES)
  {
    const perpA = new V3().crossVectors(sunDir, UP).normalize()
    const perpB = new V3().crossVectors(sunDir, perpA).normalize()
    const p = new V3()
    for (let i = 0; i < MOTES; i++) {
      const bs = beamSpots[i % beamSpots.length]
      const t = 0.3 + brng() * 9
      const a = brng() * TAU
      const rr = Math.sqrt(brng()) * bs.r * 0.85
      p.set(bs.x, bs.y, bs.z)
        .addScaledVector(sunDir, t)
        .addScaledVector(perpA, Math.cos(a) * rr)
        .addScaledVector(perpB, Math.sin(a) * rr)
      moteBase[i * 3] = p.x
      moteBase[i * 3 + 1] = p.y
      moteBase[i * 3 + 2] = p.z
      motePhase[i] = brng() * TAU
    }
  }
  const moteGeo = new THREE.BufferGeometry()
  const motePos = new THREE.BufferAttribute(new Float32Array(moteBase), 3)
  motePos.setUsage(THREE.DynamicDrawUsage)
  moteGeo.setAttribute('position', motePos)
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({
      map: moteTex,
      color: 0xfff0cc,
      size: 0.045,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  motes.frustumCulled = false
  scene.add(motes)

  // Both roots convert the source Y-up scene to the simulator's Z-up frame.
  scene.rotation.x = Math.PI / 2
  collision.rotation.x = Math.PI / 2
  collision.visible = false
  // Objects have fixed local transforms. Keep the roots mutable for map scaling.
  for (const root of [scene, collision]) root.traverse((object) => {
    if (object !== root) {
      object.updateMatrix()
      object.matrixAutoUpdate = false
    }
  })
  const worldSun = sunDir.clone().applyAxisAngle(new V3(1, 0, 0), Math.PI / 2)
  // Material lighting follows the actual render camera, including the VR feed.
  scene.traverse((object) => {
    if (object.isMesh && [leafMat, spruceMat, fernMat, grassMat].includes(object.material)) {
      object.onBeforeRender = (_renderer, _scene, camera) => {
        shared.uSunView.value.copy(worldSun).transformDirection(camera.matrixWorldInverse)
      }
    }
  })
  const start = performance.now()
  return {
    root: scene,
    collision,
    fog,
    background: fogColor,
    update(camera) {
      if (vegetation.update(camera)) sun.shadow.needsUpdate = true
      const t = (performance.now() - start) / 1000
      shared.uTime.value = t
      if (motes.visible) for (let i = 0; i < MOTES; i++) {
        const ph = motePhase[i]
        motePos.setXYZ(i,
          moteBase[i * 3] + Math.sin(t * 0.13 + ph) * 0.22,
          moteBase[i * 3 + 1] + Math.sin(t * 0.09 + ph * 1.7) * 0.28,
          moteBase[i * 3 + 2] + Math.cos(t * 0.11 + ph * 1.3) * 0.22)
      }
      motePos.needsUpdate = true
    },
    setQuality(name) {
      vegetation.setQuality(name)
      sun.castShadow = name !== 'performance'
      sun.shadow.needsUpdate = true
      renderer.shadowMap.enabled = name !== 'performance'
      beamMats.forEach((m) => { m.visible = name !== 'performance' })
      motes.visible = name !== 'performance'
    },
    dispose() {
      vegetation.dispose()
      scene.removeFromParent()
      collision.removeFromParent()
      const geos = new Set()
      const mats = new Set([collisionMaterial])
      for (const root of [scene, collision]) root.traverse((o) => {
        if (o.geometry) geos.add(o.geometry)
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m))
        if (o.isInstancedMesh) o.dispose()
      })
      // Include unused source variants as well as meshes placed in the scene.
      for (const variant of [...conifers, ...decids, ...bushes]) {
        for (const key of ['bark', 'fol', 'solid', 'branches']) if (variant[key]) geos.add(variant[key])
      }
      ferns.forEach((g) => geos.add(g))
      rockGeos.forEach((g) => geos.add(g))
      geos.add(grassGeo)
      geos.add(beamGeo)
      beamMats.forEach((m) => mats.add(m))
      geos.forEach((g) => g.dispose())
      mats.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
      sun.shadow.map?.dispose()
    },
  }
}
