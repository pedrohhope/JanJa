/**
 * Bola da sinuca "em 3D" de pixel: cada pixel do disco vira um ponto da esfera, que é girado pela
 * orientação da bola e pintado pelo desenho dela (lisa, listrada, a 8, a branca com pinta).
 * Assim a listra e a pinta do número rolam junto com a bola. Sem DOM (o teste importa daqui).
 *
 * Eixos: x para a direita, y para baixo (como a mesa), z para dentro da tela; o lado que a gente vê
 * é z < 0. Só desenho: aqui pode seno e cosseno (a física é que não pode).
 */
import { R } from '../../../../shared/games/pool/physics'
import { ballColor, BALL_PX } from './sprites'

/** matriz 3x3 (linhas), do corpo da bola para o mundo */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9) as Mat3
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  return o
}

/** rotação de `ang` em volta do eixo unitário (x, y, z) */
export function rotation(x: number, y: number, z: number, ang: number): Mat3 {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const t = 1 - c
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]
}

/** Gira a bola que andou (dx, dy) na mesa rolando sem deslizar. */
export function roll(m: Mat3, dx: number, dy: number): Mat3 {
  const d = Math.hypot(dx, dy)
  if (d < 1e-9) return m
  // o topo da bola (z = -1) anda para onde a bola vai
  const r = mul(rotation(dy / d, -dx / d, 0, d / R), m)
  return orthonormal(r)
}

/** corrige o acúmulo de erro (Gram-Schmidt nas colunas) */
function orthonormal(m: Mat3): Mat3 {
  const la = Math.hypot(m[0], m[3], m[6])
  const ax = m[0] / la
  const ay = m[3] / la
  const az = m[6] / la
  const d = ax * m[1] + ay * m[4] + az * m[7]
  const ux = m[1] - d * ax
  const uy = m[4] - d * ay
  const uz = m[7] - d * az
  const lb = Math.hypot(ux, uy, uz)
  const bx = ux / lb
  const by = uy / lb
  const bz = uz / lb
  const cx = ay * bz - az * by
  const cy = az * bx - ax * bz
  const cz = ax * by - ay * bx
  return [ax, bx, cx, ay, by, cy, az, bz, cz]
}

/** orientação inicial de cada bola: a pinta do número virada mais ou menos para cima, cada uma de um jeito */
export function initialOrientation(id: number): Mat3 {
  // eixo da bola meio deitado: a listra atravessa e a pinta aparece na beirada
  const a = rotation(1, 0, 0, Math.PI * 0.62 + ((id * 37) % 11) * 0.05)
  return mul(rotation(0, 0, 1, id * 1.7), a)
}

// ---------- cores ----------
function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const css = ([r, g, b]: [number, number, number]): string => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** três tons (sombra, base, luz) de uma cor */
function tones(h: string): [string, string, string] {
  const c = hex(h)
  return [css(mix(c, [15, 11, 9], 0.38)), css(c), css(mix(c, [255, 255, 255], 0.35))]
}

const WHITE = tones('#F3EBDD')
const OUTLINE = '#120D0B'
const CUE_DOT = tones('#C8483A')
/** tons da cor de cada bola (0..15) */
const PALETTE: ReadonlyArray<[string, string, string]> = Array.from({ length: 16 }, (_, id) => tones(ballColor(id)))

interface Pixel {
  ox: number
  oy: number
  /** normal na visão (lado de fora da esfera, virado para quem olha) */
  n: [number, number, number]
  /** tom de luz: 0 sombra, 1 base, 2 luz */
  light: 0 | 1 | 2
  edge: boolean
  gloss: boolean
}

/** os pixels do disco, calculados uma vez */
export const PIXELS: readonly Pixel[] = (() => {
  const out: Pixel[] = []
  const c = (BALL_PX - 1) / 2
  const rr = 4.6
  const inside = (x: number, y: number) => (x - c) * (x - c) + (y - c) * (y - c) <= rr * rr
  const L = [-0.45, -0.6, -0.66]
  for (let y = 0; y < BALL_PX; y++)
    for (let x = 0; x < BALL_PX; x++) {
      if (!inside(x, y)) continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      const nx = (x - c) / (rr + 0.2)
      const ny = (y - c) / (rr + 0.2)
      const nz = -Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
      const lum = nx * L[0] + ny * L[1] + nz * L[2]
      out.push({ ox: x, oy: y, n: [nx, ny, nz], light: lum > 0.82 ? 2 : lum < 0.3 ? 0 : 1, edge, gloss: x === 3 && y === 2 })
    }
  return out
})()

/** Cor de um pixel da bola `id` com a orientação `m`. */
export function pixelColor(id: number, m: Mat3, p: Pixel): string {
  if (p.edge) return OUTLINE
  if (p.gloss) return '#FFFFFF'
  // ponto no corpo da bola = transposta(m) * n
  const [nx, ny, nz] = p.n
  const bx = m[0] * nx + m[3] * ny + m[6] * nz
  const bz = m[2] * nx + m[5] * ny + m[8] * nz
  let t: [string, string, string]
  if (id === 0) t = Math.abs(bz) > 0.9 ? CUE_DOT : WHITE
  else {
    const base = PALETTE[id]
    if (id >= 9) t = Math.abs(bz) > 0.55 ? WHITE : bx > 0.86 ? WHITE : base
    else t = bz > 0.84 ? WHITE : base
  }
  return t[p.light]
}
