/**
 * Pistas da Corrida na Sala. Cada pista é um TRAÇADO (pontos do meio da pista, em ladrilhos, fechado,
 * no sentido da corrida) mais a largura; a grade de ladrilhos sai disso na carga do módulo, igual em
 * todo lugar (só `+ - * / sqrt`).
 *
 * Grade (células de CELL px): '#' muro, ',' fora da pista (freia), '.' pista, '=' linha de chegada, '>' turbo.
 * A grade é montada na primeira vez que a pista é pedida (`getTrack`), não na carga do módulo: o
 * coordenador no Durable Object nunca precisa dela.
 * O primeiro ponto do traçado é a linha de chegada e precisa ficar numa reta comprida: o grid de
 * largada fica atrás dela. O teste `tests/race/tracks.test.ts` confere que o traçado só passa por
 * pista, que o grid cabe e que um robô completa a volta.
 */
import { CELL, TILE, type Tile, type TrackId } from './types'

type P = readonly [number, number]

export interface TrackDef {
  id: TrackId
  name: string
  /** frase curta para o painel */
  sub: string
  /** tamanho em ladrilhos */
  w: number
  h: number
  /** traçado em ladrilhos (cantos dos ladrilhos), fechado, no sentido da corrida; multiplicado por `scale` */
  path: readonly P[]
  /** escala do traçado e dos turbos (a largura da pista não muda) */
  scale: number
  /** meia largura da pista (ladrilhos) */
  road: number
  /** faixa fora da pista antes do muro (ladrilhos) */
  verge: number
  /** centro de cada turbo (ladrilhos, antes da escala); vira um quadrado de 2x2 */
  boosts: readonly P[]
}

export interface Waypoint {
  x: number
  y: number
  /** direção da corrida neste ponto (unitária) */
  dx: number
  dy: number
}

export interface Track {
  def: TrackDef
  id: TrackId
  /** tamanho da grade em células */
  w: number
  h: number
  /** largura e altura em px */
  pw: number
  ph: number
  grid: Tile[]
  /** traçado suavizado e denso, em px; o 0 é a linha de chegada */
  wps: Waypoint[]
  /** meia largura do "portão" de cada ponto (px): passar por ele fora disso não conta */
  gate: number
}

export const TRACK_DEFS: Record<TrackId, TrackDef> = {
  sala: {
    id: 'sala',
    name: 'A Sala',
    sub: 'Pista no tapete, entre o sofá e a estante',
    w: 60,
    h: 38,
    scale: 1.25,
    road: 2.3,
    verge: 1.2,
    path: [
      [20, 25],
      [40, 25],
      [44, 21],
      [44, 9],
      [40, 5],
      [31, 5],
      [27, 9],
      [27, 14],
      [23, 17],
      [18, 14],
      [18, 9],
      [13, 5],
      [7, 5],
      [4, 9],
      [4, 21],
      [8, 25]
    ],
    boosts: [
      [31, 25],
      [44, 15],
      [4, 15]
    ]
  },
  quintal: {
    id: 'quintal',
    name: 'O Quintal',
    sub: 'Terra batida, grama e a cerca do vizinho',
    w: 60,
    h: 38,
    scale: 1.25,
    road: 2.3,
    verge: 1.2,
    path: [
      [18, 26],
      [36, 26],
      [43, 23],
      [44, 16],
      [40, 12],
      [34, 13],
      [30, 18],
      [24, 18],
      [20, 13],
      [21, 8],
      [17, 4],
      [9, 4],
      [4, 8],
      [4, 22],
      [8, 26]
    ],
    boosts: [
      [28, 26],
      [4, 15],
      [13, 4]
    ]
  }
}

// ---------------------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------------------

/** Chaikin num laço fechado: arredonda as curvas. O primeiro ponto vira o 1/4 do primeiro lado. */
function chaikin(pts: readonly P[]): P[] {
  const out: P[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
  }
  return out
}

/** pontos a cada `step` px (no máximo), laço fechado */
function densify(pts: readonly P[], step: number): P[] {
  const out: P[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.sqrt(dx * dx + dy * dy)
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 0; k < n; k++) out.push([a[0] + (dx * k) / n, a[1] + (dy * k) / n])
  }
  return out
}

/** distância ao quadrado de (px, py) ao segmento ab */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + dx * t - px
  const qy = ay + dy * t - py
  return qx * qx + qy * qy
}

function unit(x: number, y: number): [number, number] {
  const l = Math.sqrt(x * x + y * y)
  return l > 1e-9 ? [x / l, y / l] : [1, 0]
}

export function buildTrack(def: TrackDef): Track {
  const pw = def.w * TILE
  const ph = def.h * TILE
  const sc = def.scale * TILE
  const px: P[] = def.path.map(([x, y]) => [x * sc, y * sc])
  const smooth = chaikin(chaikin(px))
  let dense = densify(smooth, 40)
  // o ponto 0 é o mais perto da largada original
  const [sx, sy] = px[0]!
  let best = 0
  let bestD = Infinity
  dense.forEach(([x, y], i) => {
    const d = (x - sx) * (x - sx) + (y - sy) * (y - sy)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  dense = [...dense.slice(best), ...dense.slice(0, best)]
  const n = dense.length
  const wps: Waypoint[] = dense.map(([x, y], i) => {
    const a = dense[(i - 1 + n) % n]!
    const b = dense[(i + 1) % n]!
    const [dx, dy] = unit(b[0] - a[0], b[1] - a[1])
    return { x, y, dx, dy }
  })
  // na largada a direção é a da reta (o ponto seguinte), não a média
  {
    const a = dense[0]!
    const b = dense[1]!
    const [dx, dy] = unit(b[0] - a[0], b[1] - a[1])
    wps[0] = { x: a[0], y: a[1], dx, dy }
  }

  const road = def.road * TILE
  const outer = (def.road + def.verge) * TILE
  const w = Math.round(pw / CELL)
  const h = Math.round(ph / CELL)
  const grid: Tile[] = new Array<Tile>(w * h).fill('#')
  const start = wps[0]!
  // só os segmentos perto de cada linha de células (corta a conta)
  const segs = smooth.map((a, k) => {
    const b = smooth[(k + 1) % smooth.length]!
    return { ax: a[0], ay: a[1], bx: b[0], by: b[1], y0: Math.min(a[1], b[1]) - outer, y1: Math.max(a[1], b[1]) + outer }
  })
  const edge = TILE / CELL
  for (let j = 0; j < h; j++) {
    const cy = (j + 0.5) * CELL
    const near = segs.filter((g) => cy >= g.y0 && cy <= g.y1)
    for (let i = 0; i < w; i++) {
      // a borda do mapa (um ladrilho) é sempre muro
      if (i < edge || j < edge || i >= w - edge || j >= h - edge) continue
      const cx = (i + 0.5) * CELL
      let d2 = Infinity
      for (const g of near) {
        const d = segDist2(cx, cy, g.ax, g.ay, g.bx, g.by)
        if (d < d2) d2 = d
      }
      let t: Tile = '#'
      if (d2 <= road * road) t = '.'
      else if (d2 <= outer * outer) t = ','
      if (t === '.') {
        const along = (cx - start.x) * start.dx + (cy - start.y) * start.dy
        const perp = (cx - start.x) * -start.dy + (cy - start.y) * start.dx
        if (along > -4 && along <= 4 && perp * perp <= road * road) t = '='
        for (const [bx, by] of def.boosts) {
          const ox = cx - bx * sc
          const oy = cy - by * sc
          if (ox > -TILE && ox < TILE && oy > -TILE && oy < TILE) t = '>'
        }
      }
      grid[j * w + i] = t
    }
  }
  return { def, id: def.id, w, h, pw, ph, grid, wps, gate: outer + TILE }
}

const built = new Map<TrackId, Track>()

/** a pista pronta (montada na primeira vez) */
export function getTrack(id: TrackId): Track {
  let t = built.get(id)
  if (!t) {
    t = buildTrack(TRACK_DEFS[id])
    built.set(id, t)
  }
  return t
}

/** as pistas por id; cada uma só é montada quando lida */
export const TRACKS: Readonly<Record<TrackId, Track>> = {
  get sala() {
    return getTrack('sala')
  },
  get quintal() {
    return getTrack('quintal')
  }
}

export const isTrackId = (x: unknown): x is TrackId => x === 'sala' || x === 'quintal'

/** célula em (x, y) px; fora do mapa é muro */
export function tileAt(t: Track, x: number, y: number): Tile {
  const i = Math.floor(x / CELL)
  const j = Math.floor(y / CELL)
  if (i < 0 || j < 0 || i >= t.w || j >= t.h) return '#'
  return t.grid[j * t.w + i]!
}

/** posição de largada do índice `i` (0 = pole): duas filas atrás da linha, desencontradas */
export function gridSpot(t: Track, i: number): { x: number; y: number; hx: number; hy: number } {
  const s = t.wps[0]!
  const row = Math.floor(i / 2)
  const side = i % 2 === 0 ? -1 : 1
  const back = 22 + row * 24 + (i % 2) * 12
  const lat = side * 14
  return { x: s.x - s.dx * back + -s.dy * lat, y: s.y - s.dy * back + s.dx * lat, hx: s.dx, hy: s.dy }
}

/** a grade como texto (testes e depuração) */
export function trackAscii(t: Track): string[] {
  const rows: string[] = []
  for (let j = 0; j < t.h; j++) rows.push(t.grid.slice(j * t.w, (j + 1) * t.w).join(''))
  return rows
}
