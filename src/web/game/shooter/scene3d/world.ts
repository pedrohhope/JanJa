/**
 * Mundo 3D do Tiro na Sala (puro: sem DOM, sem three, sem Math.random). Gera as camadas do contrato em unidades
 * Three: X = tx, Z = ty, Y para cima, 1 tile = 1 unidade.
 *
 * CONVENÇÕES (o motor cria `CanvasTexture` com as configurações padrão do Three, flipY = true):
 *  - 'floor' e 'top': uv = (x / w, 1 - z / h), com (x, z) em unidades e (w, h) o tamanho do mapa. O canvas tem y para
 *    baixo e a linha 0 do canvas é z = 0; com flipY, v = 1 é o topo do canvas, então v = 1 - z / h não espelha.
 *    As duas camadas usam a mesma textura de mapa inteiro (`floorCanvas` / `topCanvas`), sem repetir (ClampToEdge).
 *  - 'water' e 'ceiling': uv = (x, z) em tiles, para a textura repetir (RepeatWrapping).
 *  - `side:<art>`: u em tiles ao longo da face, crescendo da esquerda para a direita vista de fora (norte u = -x,
 *    sul u = x, leste u = -z, oeste u = z; negativo funciona com RepeatWrapping); v = 0 no chão e 1 no topo da peça
 *    (linha 0 do canvas da lateral = topo). Repete só na horizontal; v fica em 0..1.
 *  - 'glow', 'trunk', 'leaves', 'line': sem textura (uv = 0), só `col`. Em 'glow', col é a cor emissiva.
 *  - A camada 'top' tem pixels transparentes (arte '.'): o motor precisa de alphaTest.
 * Triângulos soltos, anti-horários vistos de fora; a normal de cada quad aponta para fora. `col` é sombreado assado:
 * topo 1.0, laterais 0.78 a 0.9 por direção, mais escuro no pé das peças e (AO) no chão encostado em sólidos.
 */
import type { MapDef } from '../../../../shared/games/shooter/types'
import { tileAt } from '../../../../shared/games/shooter/maps/legend'
import { mapLights, tileContext } from '../scene/mapart'
import { rgbOf } from '../scene/palette'
import { noise } from '../scene/tiles'
import { HAS_CEILING, MAX_WORLD_LIGHTS, WALL_H, toUnit, type BuildWorld, type LayerKey, type MeshData, type WorldLight } from './contract3d'
import { PROP_3D, propHeight } from './props3d'

type V3 = [number, number, number]

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** cor 0..1 de uma letra da SPAL */
const letter = (ch: string): V3 => {
  const [r, g, b] = rgbOf(ch)
  return [r / 255, g / 255, b / 255]
}
const hexRgb = (hex: string): V3 => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
const scale = (c: V3, k: number): V3 => [c[0] * k, c[1] * k, c[2] * k]

class Layer {
  pos: number[] = []
  nrm: number[] = []
  uv: number[] = []
  col: number[] = []

  /** quad com 4 cantos (qualquer ordem em volta); a ordem é corrigida para a normal `n` apontar para fora */
  quad(p: V3[], uvs: [number, number][], n: V3, cols: V3[]): void {
    const cr = cross(sub(p[1]!, p[0]!), sub(p[2]!, p[0]!))
    const idx = dot(cr, n) < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3]
    for (const tri of [
      [0, 1, 2],
      [0, 2, 3]
    ]) {
      for (const k of tri) {
        const i = idx[k]!
        this.pos.push(...p[i]!)
        this.nrm.push(...n)
        this.uv.push(...uvs[i]!)
        this.col.push(...cols[i]!)
      }
    }
  }

  data(): MeshData {
    return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), uv: new Float32Array(this.uv), col: new Float32Array(this.col) }
  }
}

type Dir = 'N' | 'S' | 'W' | 'E'
const DIRS: { k: Dir; dx: number; dz: number; n: V3; shade: number }[] = [
  { k: 'N', dx: 0, dz: -1, n: [0, 0, -1], shade: 0.8 },
  { k: 'S', dx: 0, dz: 1, n: [0, 0, 1], shade: 0.9 },
  { k: 'W', dx: -1, dz: 0, n: [-1, 0, 0], shade: 0.78 },
  { k: 'E', dx: 1, dz: 0, n: [1, 0, 0], shade: 0.86 }
]
const FOOT = 0.84 // o pé da peça é um pouco mais escuro

/** u da lateral (cresce para a direita vista de fora) */
const sideU = (k: Dir, a: number): number => (k === 'N' || k === 'E' ? -a : a)

const WALL = 'parede'

export const buildWorld: BuildWorld = (map: MapDef) => {
  const { w, h } = map
  const mapId = map.id
  const wallH = WALL_H[mapId]
  const layers = new Map<LayerKey, Layer>()
  const layer = (k: LayerKey): Layer => {
    let l = layers.get(k)
    if (!l) layers.set(k, (l = new Layer()))
    return l
  }
  const inMap = (tx: number, tz: number): boolean => tx >= 0 && tz >= 0 && tx < w && tz < h
  const propOf = (art: string) => PROP_3D[art] ?? PROP_3D[WALL]!
  const mapUv = (x: number, z: number): [number, number] => [x / w, 1 - z / h]

  /** quad vertical de uma face: `plane` é a coordenada fixa; a0..a1 ao longo da face; y0..y1; v relativo a `vh` */
  const faceQuad = (l: Layer, k: Dir, plane: number, a0: number, a1: number, y0: number, y1: number, vh: number, cols: [V3, V3] | null, flat: V3 | null): void => {
    const d = DIRS.find((q) => q.k === k)!
    const along = k === 'N' || k === 'S'
    const P = (a: number, y: number): V3 => (along ? [a, y, plane] : [plane, y, a])
    const uvs: [number, number][] = flat
      ? [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0]
        ]
      : [
          [sideU(k, a0), y0 / vh],
          [sideU(k, a1), y0 / vh],
          [sideU(k, a1), y1 / vh],
          [sideU(k, a0), y1 / vh]
        ]
    const c = (flat ?? null) as V3 | null
    const lo = cols ? cols[0] : c!
    const hi = cols ? cols[1] : c!
    l.quad([P(a0, y0), P(a1, y0), P(a1, y1), P(a0, y1)], uvs, d.n, [lo, lo, hi, hi])
  }

  /** par de cores (pé, topo) de uma lateral branca com sombreado da direção */
  const sideCols = (shade: number, base: V3 = [1, 1, 1]): [V3, V3] => [scale(base, shade * FOOT), scale(base, shade)]

  /** caixa colorida completa (tronco, voxel, poste), sem textura */
  const cube = (l: Layer, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, base: V3, skip?: (k: Dir | 'U' | 'D') => boolean): void => {
    const z: [number, number] = [0, 0]
    if (!skip?.('U')) l.quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [z, z, z, z], [0, 1, 0], Array(4).fill(base) as V3[])
    if (!skip?.('D')) l.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [z, z, z, z], [0, -1, 0], Array(4).fill(scale(base, 0.55)) as V3[])
    for (const d of DIRS) {
      if (skip?.(d.k)) continue
      const along = d.k === 'N' || d.k === 'S'
      const plane = d.k === 'N' ? z0 : d.k === 'S' ? z1 : d.k === 'W' ? x0 : x1
      const [a0, a1] = along ? [x0, x1] : [z0, z1]
      const [lo, hi] = [scale(base, d.shade * FOOT), scale(base, d.shade)]
      const P = (a: number, y: number): V3 => (along ? [a, y, plane] : [plane, y, a])
      l.quad([P(a0, y0), P(a1, y0), P(a1, y1), P(a0, y1)], [z, z, z, z], d.n, [lo, lo, hi, hi])
    }
  }

  // ---------------------------------------------------------------- chão, água e AO
  const occ = (tx: number, tz: number): boolean => {
    if (!inMap(tx, tz)) return true
    const s = propOf(tileAt(map, tx, tz).art).shape
    return s === 'wall' || s === 'box' || s === 'tree'
  }
  const ao = (tx: number, tz: number, dx: number, dz: number): number => {
    const sx = dx ? 1 : -1
    const sz = dz ? 1 : -1
    const s1 = occ(tx + sx, tz)
    const s2 = occ(tx, tz + sz)
    const c = occ(tx + sx, tz + sz)
    const lvl = s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0)
    return 1 - 0.11 * lvl
  }

  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      const info = tileAt(map, tx, tz)
      const shape = propOf(info.art).shape
      if (shape === 'wall') continue
      if (info.slow) {
        const y = -0.06
        layer('water').quad(
          [[tx, y, tz], [tx, y, tz + 1], [tx + 1, y, tz + 1], [tx + 1, y, tz]],
          [[tx, tz], [tx, tz + 1], [tx + 1, tz + 1], [tx + 1, tz]],
          [0, 1, 0],
          [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]
        )
        continue
      }
      const a = (dx: number, dz: number): V3 => {
        const k = ao(tx, tz, dx, dz)
        return [k, k, k]
      }
      layer('floor').quad(
        [[tx, 0, tz], [tx, 0, tz + 1], [tx + 1, 0, tz + 1], [tx + 1, 0, tz]],
        [mapUv(tx, tz), mapUv(tx, tz + 1), mapUv(tx + 1, tz + 1), mapUv(tx + 1, tz)],
        [0, 1, 0],
        [a(0, 0), a(0, 1), a(1, 1), a(1, 0)]
      )
    }
  }

  // ---------------------------------------------------------------- teto
  if (HAS_CEILING[mapId]) {
    const c: V3 = [0.75, 0.75, 0.75]
    layer('ceiling').quad([[0, wallH, 0], [w, wallH, 0], [w, wallH, h], [0, wallH, h]], [[0, 0], [w, 0], [w, h], [0, h]], [0, -1, 0], [c, c, c, c])
  }

  // ---------------------------------------------------------------- paredes, móveis, árvores e varais
  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      const info = tileAt(map, tx, tz)
      const prop = propOf(info.art)
      const art = prop === PROP_3D[WALL] ? WALL : info.art

      if (prop.shape === 'wall') {
        for (const d of DIRS) {
          const nx = tx + d.dx
          const nz = tz + d.dz
          if (!inMap(nx, nz) || tileAt(map, nx, nz).art === WALL) continue
          const plane = d.k === 'N' ? tz : d.k === 'S' ? tz + 1 : d.k === 'W' ? tx : tx + 1
          const [a0, a1] = d.k === 'N' || d.k === 'S' ? [tx, tx + 1] : [tz, tz + 1]
          faceQuad(layer(`side:${WALL}`), d.k, plane, a0, a1, 0, wallH, wallH, sideCols(d.shade), null)
        }
        if (!HAS_CEILING[mapId]) {
          const c: V3 = [1, 1, 1]
          layer('top').quad([[tx, wallH, tz], [tx, wallH, tz + 1], [tx + 1, wallH, tz + 1], [tx + 1, wallH, tz]], [mapUv(tx, tz), mapUv(tx, tz + 1), mapUv(tx + 1, tz + 1), mapUv(tx + 1, tz)], [0, 1, 0], [c, c, c, c])
        }
        continue
      }

      if (prop.shape === 'box') {
        const bh = prop.height
        const ins = (d: (typeof DIRS)[number]): number => (tileAt(map, tx + d.dx, tz + d.dz).art === art ? 0 : prop.inset / 16)
        const iN = ins(DIRS[0]!)
        const iS = ins(DIRS[1]!)
        const iW = ins(DIRS[2]!)
        const iE = ins(DIRS[3]!)
        const x0 = tx + iW
        const x1 = tx + 1 - iE
        const z0 = tz + iN
        const z1 = tz + 1 - iS
        const sideLayer = layer(`side:${art}`)
        const needCtx = !!prop.glow
        const ctx = needCtx ? tileContext(map, tx, tz).ctx : null

        for (const d of DIRS) {
          const nb = tileAt(map, tx + d.dx, tz + d.dz)
          if (nb.art === art) continue
          const myIns = d.k === 'N' ? iN : d.k === 'S' ? iS : d.k === 'W' ? iW : iE
          const nbProp = propOf(nb.art)
          if (myIns === 0 && (nbProp.shape === 'wall' || nbProp.shape === 'box')) {
            const nbIns = nbProp.shape === 'wall' ? 0 : nbProp.inset / 16
            if (nbIns === 0 && propHeight(nb.art === WALL || nbProp.shape === 'wall' ? WALL : nb.art, mapId) >= bh) continue
          }
          const plane = d.k === 'N' ? z0 : d.k === 'S' ? z1 : d.k === 'W' ? x0 : x1
          const [a0, a1] = d.k === 'N' || d.k === 'S' ? [x0, x1] : [z0, z1]
          faceQuad(sideLayer, d.k, plane, a0, a1, 0, bh, bh, sideCols(d.shade), null)

          // brilho da tela na lateral maior da peça
          if (prop.glow?.face === 'side' && ctx && nbProp.shape !== 'wall') {
            const horizontal = ctx.bw >= ctx.bh
            if ((d.k === 'N' || d.k === 'S') !== horizontal) continue
            // a tela ocupa o meio do móvel (60% do comprimento), não a estante inteira
            const start = horizontal ? tx - ctx.bx : tz - ctx.by
            const len = horizontal ? ctx.bw : ctx.bh
            const g0 = Math.max(a0, start + len * 0.2)
            const g1 = Math.min(a1, start + len * 0.8)
            if (g1 <= g0) continue
            const off = 0.005
            const gp = plane + (d.k === 'N' || d.k === 'W' ? -off : off)
            const gc = hexRgb(prop.glow.color).map((v) => v * 0.78) as V3
            faceQuad(layer('glow'), d.k, gp, g0, g1, bh * 0.45, bh * 0.82, bh, null, gc)
          }
        }

        // tampa
        const c: V3 = [1, 1, 1]
        layer('top').quad([[x0, bh, z0], [x0, bh, z1], [x1, bh, z1], [x1, bh, z0]], [mapUv(x0, z0), mapUv(x0, z1), mapUv(x1, z1), mapUv(x1, z0)], [0, 1, 0], [c, c, c, c])

        // brasa / boca do fogão no topo
        if (prop.glow?.face === 'top' && ctx) {
          const m = 0.2
          const gx0 = Math.max(x0, tx + (ctx.nl ? 0 : m))
          const gx1 = Math.min(x1, tx + 1 - (ctx.nr ? 0 : m))
          const gz0 = Math.max(z0, tz + (ctx.nu ? 0 : m))
          const gz1 = Math.min(z1, tz + 1 - (ctx.nd ? 0 : m))
          if (gx1 > gx0 && gz1 > gz0) {
            const y = bh + 0.005
            const g = hexRgb(prop.glow.color)
            layer('glow').quad([[gx0, y, gz0], [gx0, y, gz1], [gx1, y, gz1], [gx1, y, gz0]], [[0, 0], [0, 0], [0, 0], [0, 0]], [0, 1, 0], [g, g, g, g])
          }
        }
        continue
      }

      if (prop.shape === 'tree') {
        const cx = tx + 0.5
        const cz = tz + 0.5
        const bark = letter('m')
        cube(layer('trunk'), cx - 0.2, 0, cz - 0.2, cx + 0.2, 3.0, cz + 0.2, bark)
        // copa de voxels de 0.6, raio por camada (em voxels)
        const S = 0.6
        const base = prop.height - 8 * S
        const R = [1.3, 1.9, 2.2, 2.3, 2.2, 2.0, 1.5, 0.9]
        const cells = new Set<string>()
        for (let j = 0; j < R.length; j++)
          for (let i = -2; i <= 2; i++)
            for (let k = -2; k <= 2; k++) {
              const r = Math.hypot(i, k)
              if (r > R[j]!) continue
              if (r > R[j]! - 0.6 && noise(tx * 31 + i, tz * 17 + k, j + 7) > 0.7) continue
              cells.add(`${i},${j},${k}`)
            }
        const greens = ['G', 'F', 'h', 'g', 'l']
        const leaves = layer('leaves')
        for (const key of cells) {
          const [i, j, k] = key.split(',').map(Number) as [number, number, number]
          const gx = cx + i * S
          const gz = cz + k * S
          const gy = base + j * S
          const pick = greens[Math.floor(noise(tx * 13 + i, tz * 11 + k, j) * greens.length)]!
          const tint = 0.85 + 0.15 * (j / (R.length - 1))
          cube(leaves, gx - S / 2, gy, gz - S / 2, gx + S / 2, gy + S, gz + S / 2, scale(letter(pick), tint), (f) => {
            const o = f === 'U' ? [0, 1, 0] : f === 'D' ? [0, -1, 0] : f === 'N' ? [0, 0, -1] : f === 'S' ? [0, 0, 1] : f === 'W' ? [-1, 0, 0] : [1, 0, 0]
            return cells.has(`${i + o[0]!},${j + o[1]!},${k + o[2]!}`)
          })
        }
        continue
      }

      if (prop.shape === 'line') {
        const ctx = tileContext(map, tx, tz).ctx
        if (ctx.bx !== 0 || ctx.by !== 0) continue
        const horizontal = ctx.bw >= ctx.bh
        const len = horizontal ? ctx.bw : ctx.bh
        const l = layer('line')
        const post = letter('D')
        const wire = letter('d')
        const t = 0.06
        const hgt = prop.height
        // ponto no eixo da linha (a) e no eixo cruzado (c = centro do tile)
        const box3 = (a0: number, a1: number, y0: number, y1: number, th: number, col: V3): void => {
          if (horizontal) cube(l, tx + a0, y0, tz + 0.5 - th, tx + a1, y1, tz + 0.5 + th, col, (f) => f === 'D')
          else cube(l, tx + 0.5 - th, y0, tz + a0, tx + 0.5 + th, y1, tz + a1, col, (f) => f === 'D')
        }
        box3(0.12, 0.12 + 2 * t, 0, hgt, t, post)
        box3(len - 0.12 - 2 * t, len - 0.12, 0, hgt, t, post)
        box3(0.12, len - 0.12, hgt - 0.3, hgt - 0.3 + 0.04, 0.02, wire)
        const tones = ['o', 'c', 'p', 'y']
        for (let s = 1.0, n = 0; s < len - 1.0; s += 1.4, n++) {
          const col = letter(tones[Math.floor(noise(tx + n, tz, 81) * 4)]!)
          box3(s, s + 0.4, hgt - 0.3 - 0.6, hgt - 0.3, 0.015, col)
        }
        continue
      }
    }
  }

  // ---------------------------------------------------------------- luzes
  const lights = buildLights(map)

  const out: Partial<Record<LayerKey, MeshData>> = {}
  for (const [k, l] of layers) if (l.pos.length > 0) out[k] = l.data()
  return { mapId, w, h, layers: out, lights }
}

// =====================================================================================
// Luzes
// =====================================================================================

const LAMP_COLOR = '#FFC94A'
const MOON_COLOR = '#7FB7E6'

function buildLights(map: MapDef): WorldLight[] {
  const { w, h } = map
  const wallH = WALL_H[map.id]
  const open = (tx: number, tz: number): boolean => {
    if (tx < 0 || tz < 0 || tx >= w || tz >= h) return false
    const i = tileAt(map, tx, tz)
    return !i.solid && !i.slow
  }
  const roomy = (tx: number, tz: number): boolean => {
    if (!open(tx, tz)) return false
    let n = 0
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (open(tx + dx, tz + dz)) n++
    return n >= 18
  }

  // móveis acesos (mapLights em px -> unidades)
  const furniture: WorldLight[] = mapLights(map).map((s) => {
    let x = toUnit(s.x)
    let z = toUnit(s.y)
    const color = s.tint ?? '#F3EBDD'
    let y = 2.0
    let push = true
    if (color === '#7FB7E6') y = 2.6
    else if (color === '#FF7A6B') {
      y = 2.9 // acima do fogão (2.6)
      push = false
    } else if (color === '#FFC94A') {
      y = 3.3 // acima da churrasqueira (3.0)
      push = false
    }
    if (push) {
      // tira a luz de dentro da caixa: 0.8 para o lado aberto mais próximo
      const tx = Math.min(w - 1, Math.floor(x))
      const tz = Math.min(h - 1, Math.floor(z))
      for (const d of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0]
      ] as const) {
        let k = 1
        while (inMapSolid(map, tx + d[0] * k, tz + d[1] * k) && k < 4) k++
        if (open(tx + d[0] * k, tz + d[1] * k)) {
          x += d[0] * (k - 0.5 + 0.8)
          z += d[1] * (k - 0.5 + 0.8)
          break
        }
      }
    }
    return { x, y, z, color, power: s.power, range: (s.r / 16) * 2 }
  })

  // abajures de teto (casa) ou luar fraco (quintal): grade de células, uma luz onde o centro é piso aberto
  const casa = map.id === 'casa'
  const cell = casa ? 12 : 18
  const nx = Math.max(1, Math.round(w / cell))
  const nz = Math.max(1, Math.round(h / cell))
  const lamps: WorldLight[] = []
  for (let cz = 0; cz < nz; cz++)
    for (let cx = 0; cx < nx; cx++) {
      const mx = Math.floor(((cx + 0.5) * w) / nx)
      const mz = Math.floor(((cz + 0.5) * h) / nz)
      let spot: [number, number] | null = null
      for (let r = 0; r <= 3 && !spot; r++)
        for (let dz = -r; dz <= r && !spot; dz++)
          for (let dx = -r; dx <= r && !spot; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r && roomy(mx + dx, mz + dz)) spot = [mx + dx, mz + dz]
      if (!spot) continue
      lamps.push(
        casa
          ? { x: spot[0] + 0.5, y: wallH - 0.5, z: spot[1] + 0.5, color: LAMP_COLOR, power: 0.7, range: 14 }
          : { x: spot[0] + 0.5, y: 4.2, z: spot[1] + 0.5, color: MOON_COLOR, power: 0.25, range: 16 }
      )
    }

  const strong = furniture.filter((l) => l.power >= 0.5).sort((a, b) => b.power - a.power)
  const weak = furniture.filter((l) => l.power < 0.5)
  const budget = Math.max(0, MAX_WORLD_LIGHTS - strong.length)
  let picked = lamps
  if (lamps.length > budget) picked = Array.from({ length: budget }, (_, i) => lamps[Math.floor(((i + 0.5) * lamps.length) / budget)]!)
  const all = [...strong, ...picked, ...weak]
  // as mais fortes primeiro (estável), e nunca mais que o limite
  return all
    .map((l, i) => ({ l, i }))
    .sort((a, b) => b.l.power - a.l.power || a.i - b.i)
    .slice(0, MAX_WORLD_LIGHTS)
    .map((e) => e.l)
}

function inMapSolid(map: MapDef, tx: number, tz: number): boolean {
  if (tx < 0 || tz < 0 || tx >= map.w || tz >= map.h) return false
  return tileAt(map, tx, tz).solid
}
