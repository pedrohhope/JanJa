/**
 * Geometria das peças do modo realista (puro: sem Three e sem DOM; o teste importa daqui).
 *
 * As peças redondas são torneadas (perfil girado em volta do eixo), como as de madeira de verdade.
 * Cada ponto do perfil diz se é quina (`sharp`): na quina a luz quebra, no resto a superfície é lisa.
 * Medidas em casas (1 = lado da casa); o pé da peça fica em y = 0.
 */
import type { PieceType } from '../../../../shared/games/chess/rules'

export interface Pt {
  r: number
  y: number
  sharp: boolean
}

/** triângulos soltos (sem índice): 3 números por vértice em pos/normal, 2 em uv, 1 em shade */
export interface Part {
  pos: number[]
  normal: number[]
  uv: number[]
  /** 1 = cor da peça; menos que 1 = mais escuro (olho do cavalo) */
  shade: number[]
}

export const emptyPart = (): Part => ({ pos: [], normal: [], uv: [], shade: [] })

export function merge(...parts: Part[]): Part {
  const out = emptyPart()
  for (const p of parts) {
    out.pos.push(...p.pos)
    out.normal.push(...p.normal)
    out.uv.push(...p.uv)
    out.shade.push(...p.shade)
  }
  return out
}

/** Perfil para tornear: de baixo (no eixo) para cima (no eixo). */
export class Path {
  pts: Pt[] = []
  to(r: number, y: number, sharp = true): this {
    this.pts.push({ r, y, sharp })
    return this
  }
  /** curva do último ponto até (r, y) puxada por (cr, cy) */
  q(cr: number, cy: number, r: number, y: number, endSharp = true, n = 8): this {
    const a = this.pts[this.pts.length - 1]
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const u = 1 - t
      this.pts.push({ r: u * u * a.r + 2 * u * t * cr + t * t * r, y: u * u * a.y + 2 * u * t * cy + t * t * y, sharp: i === n && endSharp })
    }
    return this
  }
  /** arco de círculo (graus), sem repetir o ponto inicial se ele já está lá */
  arc(cr: number, cy: number, rad: number, a0: number, a1: number, n = 12, endSharp = true): this {
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180
      const p = { r: Math.max(0, cr + rad * Math.cos(a)), y: cy + rad * Math.sin(a), sharp: i === n ? endSharp : false }
      const last = this.pts[this.pts.length - 1]
      if (i === 0 && last && Math.abs(last.r - p.r) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue
      this.pts.push(p)
    }
    return this
  }
}

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** triângulo plano com a frente para `n` */
function flatTri(out: Part, a: V3, b: V3, c: V3, n: V3, shade: number): void {
  if (dot(cross(sub(b, a), sub(c, a)), n) < 0) [b, c] = [c, b]
  for (const v of [a, b, c]) {
    out.pos.push(...v)
    out.normal.push(...n)
    out.uv.push(v[0] + v[2], v[1])
    out.shade.push(shade)
  }
}
function flatQuad(out: Part, a: V3, b: V3, c: V3, d: V3, n: V3, shade: number): void {
  flatTri(out, a, b, c, n, shade)
  flatTri(out, a, c, d, n, shade)
}

/**
 * Torneia o perfil. `phi0`/`phiLen` em radianos (padrão: volta inteira).
 * Ângulo 0 fica no +z e cresce para o +x (como no LatheGeometry do Three).
 */
export function lathe(pts: readonly Pt[], seg = 40, shade = 1, phi0 = 0, phiLen = Math.PI * 2): Part {
  const out = emptyPart()
  const segs: { a: Pt; b: Pt; n: [number, number]; len: number }[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dr = b.r - a.r
    const dy = b.y - a.y
    const len = Math.sqrt(dr * dr + dy * dy)
    if (len < 1e-9) continue
    segs.push({ a, b, n: [dy / len, -dr / len], len })
  }
  const total = segs.reduce((s, x) => s + x.len, 0) || 1
  const avg = (m: [number, number], k: [number, number]): [number, number] => {
    const x = m[0] + k[0]
    const y = m[1] + k[1]
    const l = Math.sqrt(x * x + y * y) || 1
    return [x / l, y / l]
  }
  let acc = 0
  segs.forEach((s, i) => {
    const na = i > 0 && !s.a.sharp ? avg(segs[i - 1].n, s.n) : s.n
    const nb = i + 1 < segs.length && !s.b.sharp ? avg(s.n, segs[i + 1].n) : s.n
    const v0 = acc / total
    acc += s.len
    const v1 = acc / total
    const ring = (p: Pt, n: [number, number], v: number, j: number) => {
      const t = phi0 + (phiLen * j) / seg
      const sn = Math.sin(t)
      const cs = Math.cos(t)
      return { p: [p.r * sn, p.y, p.r * cs] as V3, n: [n[0] * sn, n[1], n[0] * cs] as V3, uv: [j / seg, v] }
    }
    for (let j = 0; j < seg; j++) {
      const a0 = ring(s.a, na, v0, j)
      const a1 = ring(s.a, na, v0, j + 1)
      const b0 = ring(s.b, nb, v1, j)
      const b1 = ring(s.b, nb, v1, j + 1)
      for (const tri of [
        [a0, a1, b0],
        [b0, a1, b1]
      ]) {
        // pula triângulo degenerado (no eixo)
        const c = cross(sub(tri[1].p, tri[0].p), sub(tri[2].p, tri[0].p))
        if (dot(c, c) < 1e-14) continue
        for (const v of tri) {
          out.pos.push(...v.p)
          out.normal.push(...v.n)
          out.uv.push(v.uv[0], v.uv[1])
          out.shade.push(shade)
        }
      }
    }
  })
  return out
}

/** bloco curvo (pedaço de anel): as ameias da torre */
export function sectorBlock(r0: number, r1: number, y0: number, y1: number, a0: number, a1: number, seg = 6): Part {
  const ring = new Path().to(r0, y0).to(r1, y0).to(r1, y1).to(r0, y1).to(r0, y0)
  const out = lathe(ring.pts, seg, 1, a0, a1 - a0)
  const at = (r: number, y: number, a: number): V3 => [r * Math.sin(a), y, r * Math.cos(a)]
  for (const [a, sign] of [
    [a0, -1],
    [a1, 1]
  ] as const) {
    const n: V3 = [sign * Math.cos(a), 0, -sign * Math.sin(a)]
    flatQuad(out, at(r0, y0, a), at(r1, y0, a), at(r1, y1, a), at(r0, y1, a), n, 1)
  }
  return out
}

/** caixa (cruz do rei) */
export function box(cx: number, cy: number, cz: number, w: number, h: number, d: number, shade = 1): Part {
  const out = emptyPart()
  const x = [cx - w / 2, cx + w / 2]
  const y = [cy - h / 2, cy + h / 2]
  const z = [cz - d / 2, cz + d / 2]
  const P = (i: number, j: number, k: number): V3 => [x[i], y[j], z[k]]
  flatQuad(out, P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1), [1, 0, 0], shade)
  flatQuad(out, P(0, 0, 0), P(0, 1, 0), P(0, 1, 1), P(0, 0, 1), [-1, 0, 0], shade)
  flatQuad(out, P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1), [0, 1, 0], shade)
  flatQuad(out, P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1), [0, -1, 0], shade)
  flatQuad(out, P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), [0, 0, 1], shade)
  flatQuad(out, P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), [0, 0, -1], shade)
  return out
}

export function sphere(rad: number, shade = 1, seg = 16): Part {
  return lathe(new Path().to(0, -rad).arc(0, 0, rad, -90, 90, seg, true).pts, seg, shade)
}

/** move e gira (em volta de y, depois de z) */
export function transform(p: Part, o: { x?: number; y?: number; z?: number; rotY?: number; rotZ?: number }): Part {
  const out: Part = { pos: [], normal: [], uv: p.uv.slice(), shade: p.shade.slice() }
  const cz = Math.cos(o.rotZ ?? 0)
  const sz = Math.sin(o.rotZ ?? 0)
  const cy = Math.cos(o.rotY ?? 0)
  const sy = Math.sin(o.rotY ?? 0)
  const rot = (v: V3): V3 => {
    const a: V3 = [v[0] * cz - v[1] * sz, v[0] * sz + v[1] * cz, v[2]]
    return [a[0] * cy + a[2] * sy, a[1], -a[0] * sy + a[2] * cy]
  }
  for (let i = 0; i < p.pos.length; i += 3) {
    const v = rot([p.pos[i], p.pos[i + 1], p.pos[i + 2]])
    out.pos.push(v[0] + (o.x ?? 0), v[1] + (o.y ?? 0), v[2] + (o.z ?? 0))
    out.normal.push(...rot([p.normal[i], p.normal[i + 1], p.normal[i + 2]]))
  }
  return out
}

/** pé torneado de todas as peças: degrau com quina boleada, gola e um anel. Termina em (top.r, top.y). */
function foot(R: number): Path {
  return new Path()
    .to(0, 0)
    .to(R, 0)
    .q(R + 0.012, 0.025, R - 0.004, 0.048, false, 6)
    .q(R - 0.01, 0.062, R - 0.035, 0.062, true, 4)
    .to(R - 0.05, 0.068)
    .q(R - 0.085, 0.072, R - 0.06, 0.092, false, 5)
    .q(R - 0.04, 0.11, R - 0.075, 0.118, true, 6)
    .to(R - 0.1, 0.12)
}

/** gola entre o corpo e a cabeça (um disco boleado e um aro fino) */
function collar(p: Path, neck: number, y: number, w: number): Path {
  return p
    .to(w, y)
    .q(w + 0.02, y + 0.018, w, y + 0.036, false, 5)
    .to(neck + 0.005, y + 0.042)
    .to(neck + 0.03, y + 0.05)
    .to(neck + 0.03, y + 0.064)
    .to(neck - 0.005, y + 0.07)
}

export const PIECE_HEIGHT: Record<PieceType, number> = { p: 0.6, r: 0.77, n: 0.86, b: 0.92, q: 1.09, k: 1.26 }

/** perfil torneado de cada peça (o cavalo tem só o pé: a cabeça é extrudada no Three) */
export function profile(type: PieceType): Pt[] {
  switch (type) {
    case 'p': {
      const p = foot(0.25).q(0.08, 0.2, 0.072, 0.33, true, 8)
      collar(p, 0.07, 0.33, 0.135)
      return p.arc(0, 0.485, 0.11, -62, 90, 16).pts
    }
    case 'r':
      return foot(0.29).q(0.16, 0.3, 0.165, 0.49, true, 8).to(0.19, 0.495).to(0.19, 0.52).to(0.17, 0.53).q(0.17, 0.6, 0.232, 0.64, true, 8).to(0.232, 0.7).to(0.168, 0.7).to(0.168, 0.665).to(0, 0.665)
        .pts
    case 'n':
      return foot(0.29).to(0.18, 0.15).to(0, 0.15).pts
    case 'b': {
      const p = foot(0.28).q(0.085, 0.26, 0.072, 0.48, true, 10)
      collar(p, 0.07, 0.48, 0.145)
      return p.q(0.155, 0.62, 0.118, 0.72, false, 10).q(0.085, 0.8, 0.022, 0.845, true, 8).arc(0, 0.877, 0.036, -52, 90, 10).pts
    }
    case 'q': {
      const p = foot(0.32).q(0.095, 0.36, 0.083, 0.66, true, 10)
      collar(p, 0.08, 0.66, 0.165)
      return p.q(0.1, 0.84, 0.172, 0.93, true, 8).to(0.172, 0.948).to(0.135, 0.95).q(0.075, 0.95, 0.055, 0.985, true, 6).arc(0, 1.045, 0.045, -55, 90, 12).pts
    }
    case 'k': {
      const p = foot(0.33).q(0.1, 0.38, 0.088, 0.71, true, 10)
      collar(p, 0.085, 0.71, 0.17)
      return p.q(0.1, 0.89, 0.155, 0.965, true, 8).to(0.155, 0.985).q(0.09, 0.99, 0.05, 1.035, true, 6).to(0.05, 1.055).to(0, 1.055).pts
    }
  }
}

/** contorno da cabeça do cavalo, de lado (focinho para +x). Comandos: m/l ponto, q curva (controle, ponto). */
export const KNIGHT_OUTLINE: Array<['m' | 'l', number, number] | ['q', number, number, number, number]> = [
  ['m', -0.17, 0],
  ['l', 0.16, 0],
  ['q', 0.2, 0.1, 0.12, 0.2],
  ['q', 0.06, 0.25, 0.055, 0.33],
  ['q', 0.15, 0.3, 0.265, 0.36],
  ['q', 0.315, 0.405, 0.28, 0.465],
  ['q', 0.19, 0.56, 0.085, 0.625],
  ['l', 0.075, 0.75],
  ['l', 0.0, 0.66],
  ['q', -0.07, 0.665, -0.125, 0.55],
  ['q', -0.205, 0.45, -0.205, 0.25],
  ['q', -0.215, 0.1, -0.17, 0]
]
/** espessura da cabeça (sem a borda boleada) e onde ela começa */
export const KNIGHT_DEPTH = 0.16
export const KNIGHT_BEVEL = 0.05
export const KNIGHT_HEAD_Y = 0.14

/** peça torneada inteira (o que não depende do Three) */
export function piecePart(type: PieceType, seg = 40): Part {
  const body = lathe(profile(type), seg)
  if (type === 'r') {
    // seis ameias em volta do topo
    const parts = [body]
    const n = 6
    const gap = 0.36
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI * 2) / n + gap / 2
      parts.push(sectorBlock(0.168, 0.232, 0.699, 0.775, a, a + (Math.PI * 2) / n - gap))
    }
    return merge(...parts)
  }
  if (type === 'k') {
    return merge(body, box(0, 1.15, 0, 0.05, 0.2, 0.05), box(0, 1.17, 0, 0.15, 0.05, 0.05))
  }
  if (type === 'q') {
    // coroa: bolinhas em volta da borda
    const parts = [body]
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4
      parts.push(transform(sphere(0.027, 1, 10), { x: 0.168 * Math.sin(a), y: 0.958, z: 0.168 * Math.cos(a) }))
    }
    return merge(...parts)
  }
  if (type === 'n') {
    // olhos dos dois lados (a cabeça vem do Three)
    const z = KNIGHT_DEPTH / 2 + KNIGHT_BEVEL - 0.008
    return merge(body, transform(sphere(0.022, 0.15, 8), { x: 0.14, y: KNIGHT_HEAD_Y + 0.53, z }), transform(sphere(0.022, 0.15, 8), { x: 0.14, y: KNIGHT_HEAD_Y + 0.53, z: -z }))
  }
  return body
}

/** volume com sinal (positivo = faces viradas para fora); para o teste */
export function signedVolume(p: Part): number {
  let v = 0
  for (let i = 0; i < p.pos.length; i += 9) {
    const a: V3 = [p.pos[i], p.pos[i + 1], p.pos[i + 2]]
    const b: V3 = [p.pos[i + 3], p.pos[i + 4], p.pos[i + 5]]
    const c: V3 = [p.pos[i + 6], p.pos[i + 7], p.pos[i + 8]]
    v += dot(a, cross(b, c)) / 6
  }
  return v
}
