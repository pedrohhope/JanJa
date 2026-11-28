/**
 * Pixel art da Corrida na Sala, toda gerada por código: o carrinho (linhas de texto, como o resto da
 * arte do JanJa), as versões giradas dele e o desenho da pista a partir da grade de ladrilhos.
 * As funções de linha são puras; as que devolvem canvas precisam do DOM.
 */
import { TILE, type Tile, type TrackId } from '../../../../shared/games/race/types'
import { tileAt, type Track } from '../../../../shared/games/race/tracks'

// ---------------------------------------------------------------------------------------
// Carrinho (de frente para a direita)
// ---------------------------------------------------------------------------------------

/**
 * k pneu, b lataria escura, B lataria, g vidro de trás, w para-brisa, r lanterna, h farol, s faixa.
 * 14x8, a frente fica à direita (x cresce).
 */
export const CAR_ROWS: readonly string[] = [
  '..kkk....kkk..',
  '.bbbbbbbbbbbb.',
  'rbBBgBBBBwwBbh',
  'rbssgsssswwsbh',
  'rbssgsssswwsbh',
  'rbBBgBBBBwwBbh',
  '.bbbbbbbbbbbb.',
  '..kkk....kkk..'
]
export const CAR_W = 14
export const CAR_H = 8
/** quantas direções o carro tem pré-desenhadas */
export const CAR_DIRS = 32
/** lado do quadro de cada direção */
export const CAR_BOX = 18

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)))
  const r = f((n >> 16) & 255)
  const g = f((n >> 8) & 255)
  const b = f(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

export function carPalette(body: string, braking: boolean): Record<string, string> {
  return {
    k: '#1A1412',
    b: shade(body, -0.35),
    B: body,
    s: '#F3EBDD',
    g: '#3B4A57',
    w: '#9FC3D6',
    r: braking ? '#FF4A3D' : '#8E2A22',
    h: '#FFE7A3'
  }
}

/** índice da direção mais perto do vetor (hx, hy) */
export function dirIndex(hx: number, hy: number): number {
  const a = Math.atan2(hy, hx)
  const i = Math.round((a / (Math.PI * 2)) * CAR_DIRS)
  return ((i % CAR_DIRS) + CAR_DIRS) % CAR_DIRS
}

/**
 * Gira as linhas do carro por amostragem do vizinho mais perto (fica pixelado de propósito).
 * Devolve uma grade CAR_BOX x CAR_BOX de letras ('.' = vazio).
 */
export function rotateRows(rows: readonly string[], angle: number, box = CAR_BOX): string[] {
  const h = rows.length
  const w = rows[0]!.length
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const out: string[] = []
  for (let y = 0; y < box; y++) {
    let line = ''
    for (let x = 0; x < box; x++) {
      const dx = x + 0.5 - box / 2
      const dy = y + 0.5 - box / 2
      // gira para trás para achar o pixel de origem
      const sx = Math.floor(dx * c + dy * s + w / 2)
      const sy = Math.floor(-dx * s + dy * c + h / 2)
      line += sx >= 0 && sy >= 0 && sx < w && sy < h ? rows[sy]![sx]! : '.'
    }
    out.push(line)
  }
  return out
}

function rowsCanvas(rows: readonly string[], pal: Record<string, string>): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = rows[0]!.length
  cv.height = rows.length
  const ctx = cv.getContext('2d')!
  rows.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const col = pal[line[x]!]
      if (!col) continue
      ctx.fillStyle = col
      ctx.fillRect(x, y, 1, 1)
    }
  })
  return cv
}

export interface CarSprites {
  /** [freando ? 1 : 0][direção] */
  frames: HTMLCanvasElement[][]
  shadow: HTMLCanvasElement[]
}

const spriteCache = new Map<string, CarSprites>()

/** as 32 direções do carro numa cor (com e sem luz de freio) e a sombra */
export function carSprites(body: string): CarSprites {
  const hit = spriteCache.get(body)
  if (hit) return hit
  const rot = Array.from({ length: CAR_DIRS }, (_, i) => rotateRows(CAR_ROWS, (i / CAR_DIRS) * Math.PI * 2))
  const shadowPal = Object.fromEntries('kbBsgwrh'.split('').map((k) => [k, 'rgba(20,14,12,0.38)']))
  const out: CarSprites = {
    frames: [rot.map((r) => rowsCanvas(r, carPalette(body, false))), rot.map((r) => rowsCanvas(r, carPalette(body, true)))],
    shadow: rot.map((r) => rowsCanvas(r, shadowPal))
  }
  spriteCache.set(body, out)
  return out
}

// ---------------------------------------------------------------------------------------
// Pista
// ---------------------------------------------------------------------------------------

export interface TrackTheme {
  /** chão fora da pista (atrás do muro) */
  floor: [string, string]
  /** fora da pista (freia) */
  verge: [string, string]
  road: [string, string]
  /** borda da pista */
  edge: string
  /** zebra da curva */
  curb: [string, string]
  /** detalhes soltos no chão */
  props: 'sala' | 'quintal'
  /** cor do mapa pequeno */
  mini: string
}

export const THEMES: Record<TrackId, TrackTheme> = {
  sala: {
    floor: ['#6B4A35', '#5C3F2D'],
    verge: ['#8E3B2F', '#7E3328'],
    road: ['#4A4240', '#433B39'],
    edge: '#B7A99A',
    curb: ['#F3EBDD', '#C24B3A'],
    props: 'sala',
    mini: '#B7A99A'
  },
  quintal: {
    floor: ['#3F5E2E', '#375328'],
    verge: ['#6E8F45', '#62813D'],
    road: ['#9A6B45', '#8C603E'],
    edge: '#C9A27A',
    curb: ['#F3EBDD', '#3F7CB0'],
    props: 'quintal',
    mini: '#C9A27A'
  }
}

/** ruído estável por ladrilho/pixel (mesmo desenho sempre) */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** seta do turbo (para a direita), 16x16 */
const CHEVRON: readonly string[] = [
  '................',
  '................',
  '..y.....y.......',
  '..yy....yy......',
  '...yy....yy.....',
  '....yy....yy....',
  '.....yy....yy...',
  '......yy....yy..',
  '......yy....yy..',
  '.....yy....yy...',
  '....yy....yy....',
  '...yy....yy.....',
  '..yy....yy......',
  '..y.....y.......',
  '................',
  '................'
]

const isRoad = (c: Tile) => c === '.' || c === '=' || c === '>'

/** direção da corrida mais perto do ponto (para as setas do turbo) */
function nearestDir(t: Track, x: number, y: number): { dx: number; dy: number } {
  let best = t.wps[0]!
  let bd = Infinity
  for (const w of t.wps) {
    const d = (w.x - x) ** 2 + (w.y - y) ** 2
    if (d < bd) {
      bd = d
      best = w
    }
  }
  return best
}

const rgbCache = new Map<string, [number, number, number]>()
function rgb(hex: string): [number, number, number] {
  let c = rgbCache.get(hex)
  if (!c) {
    const n = parseInt(hex.slice(1), 16)
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    rgbCache.set(hex, c)
  }
  return c
}

/** ladrilho de 16 px todo de muro, com folga de um ladrilho em volta (lugar de enfeite) */
function deepWall(t: Track, x: number, y: number): boolean {
  for (let b = -TILE; b < 2 * TILE; b += 4) for (let a = -TILE; a < 2 * TILE; a += 4) if (tileAt(t, x + a, y + b) !== '#') return false
  return true
}

function drawProps(ctx: CanvasRenderingContext2D, t: Track, theme: TrackTheme): void {
  for (let y = TILE; y < t.ph - TILE; y += TILE) {
    for (let x = TILE; x < t.pw - TILE; x += TILE) {
      const r = hash2(x * 7 + 3, y * 11 + 5)
      if (r > 0.1 || !deepWall(t, x, y)) continue
      if (theme.props === 'sala') {
        if (r < 0.035) {
          // bloquinho de montar
          const col = ['#C24B3A', '#FFC94A', '#3F7CB0', '#6E8F45'][Math.floor(r * 1000) % 4]!
          ctx.fillStyle = shade(col, -0.35)
          ctx.fillRect(x + 3, y + 5, 10, 7)
          ctx.fillStyle = col
          ctx.fillRect(x + 3, y + 4, 10, 6)
          ctx.fillStyle = shade(col, 0.25)
          ctx.fillRect(x + 5, y + 3, 2, 2)
          ctx.fillRect(x + 9, y + 3, 2, 2)
        } else if (r < 0.05) {
          // carta de baralho caída
          ctx.fillStyle = '#F3EBDD'
          ctx.fillRect(x + 4, y + 2, 8, 11)
          ctx.fillStyle = '#C24B3A'
          ctx.fillRect(x + 7, y + 6, 2, 3)
        } else if (r < 0.07) {
          // pipoca
          ctx.fillStyle = '#F3EBDD'
          ctx.fillRect(x + 6, y + 7, 3, 2)
          ctx.fillStyle = '#FFE7A3'
          ctx.fillRect(x + 7, y + 6, 2, 1)
        }
      } else if (r < 0.06) {
        // moita
        ctx.fillStyle = '#2C4521'
        ctx.fillRect(x + 2, y + 5, 12, 9)
        ctx.fillStyle = '#4F7436'
        ctx.fillRect(x + 3, y + 3, 10, 8)
        ctx.fillStyle = '#6E8F45'
        ctx.fillRect(x + 5, y + 4, 3, 2)
      } else if (r < 0.085) {
        // florzinha
        ctx.fillStyle = '#FFC94A'
        ctx.fillRect(x + 7, y + 7, 2, 2)
        ctx.fillStyle = '#F3EBDD'
        ctx.fillRect(x + 6, y + 7, 1, 2)
        ctx.fillRect(x + 9, y + 7, 1, 2)
      } else {
        // pedra
        ctx.fillStyle = '#7C736B'
        ctx.fillRect(x + 4, y + 8, 7, 4)
        ctx.fillStyle = '#9A9087'
        ctx.fillRect(x + 5, y + 7, 4, 2)
      }
    }
  }
}

/** cor de um pixel da pista (chão, borda, zebra, quadriculado) */
function pixelColor(t: Track, theme: TrackTheme, x: number, y: number): string {
  const c = tileAt(t, x, y)
  const n = hash2(x, y)
  if (c === '#') {
    if (theme.props === 'sala') {
      // tábuas de 8 px de altura, emendas desencontradas
      const row = Math.floor(y / 8)
      if (y % 8 === 0 || (x + row * 37) % 56 === 0) return theme.floor[1]
      return n < 0.06 ? theme.floor[1] : theme.floor[0]
    }
    return n < 0.14 ? theme.floor[1] : theme.floor[0]
  }
  if (c === ',') {
    if (tileAt(t, x + 3, y) === '#' || tileAt(t, x - 3, y) === '#' || tileAt(t, x, y + 3) === '#' || tileAt(t, x, y - 3) === '#') {
      return theme.curb[((x + y) >> 2) & 1]!
    }
    return n < 0.12 ? theme.verge[1] : theme.verge[0]
  }
  if (!isRoad(tileAt(t, x + 2, y)) || !isRoad(tileAt(t, x - 2, y)) || !isRoad(tileAt(t, x, y + 2)) || !isRoad(tileAt(t, x, y - 2))) return theme.edge
  if (c === '=') return ((x >> 2) + (y >> 2)) & 1 ? '#221C19' : '#F3EBDD'
  if (c === '>') return '#5A3E16'
  return n < 0.1 ? theme.road[1] : theme.road[0]
}

/** A pista inteira num canvas, 1 px da pista = 1 px do canvas. */
export function trackCanvas(t: Track): HTMLCanvasElement {
  const theme = THEMES[t.id]
  const cv = document.createElement('canvas')
  cv.width = t.pw
  cv.height = t.ph
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(t.pw, t.ph)
  const d = img.data
  for (let y = 0; y < t.ph; y++) {
    for (let x = 0; x < t.pw; x++) {
      const [r, g, b] = rgb(pixelColor(t, theme, x, y))
      const k = (y * t.pw + x) * 4
      d[k] = r
      d[k + 1] = g
      d[k + 2] = b
      d[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  // setas do turbo: quatro de 16 px, viradas para o lado da corrida
  const sc = t.def.scale * TILE
  for (const [bx, by] of t.def.boosts) {
    const cx = bx * sc
    const cy = by * sc
    const dir = nearestDir(t, cx, cy)
    const ang = Math.round(Math.atan2(dir.dy, dir.dx) / (Math.PI / 2)) * (Math.PI / 2)
    const rows = rotateRows(CHEVRON, ang, TILE)
    ctx.fillStyle = '#FFC94A'
    for (const ox of [-TILE, 0]) {
      for (const oy of [-TILE, 0]) {
        const x0 = Math.round(cx + ox)
        const y0 = Math.round(cy + oy)
        rows.forEach((line, b) => {
          for (let a = 0; a < line.length; a++) if (line[a] === 'y' && tileAt(t, x0 + a, y0 + b) === '>') ctx.fillRect(x0 + a, y0 + b, 1, 1)
        })
      }
    }
  }
  drawProps(ctx, t, theme)
  return cv
}

/** mapa pequeno: só a pista, 1 px por ladrilho de 16 px */
export function miniCanvas(t: Track): HTMLCanvasElement {
  const w = Math.round(t.pw / TILE)
  const h = Math.round(t.ph / TILE)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const c = tileAt(t, i * TILE + 8, j * TILE + 8)
      if (!isRoad(c)) continue
      ctx.fillStyle = c === '=' ? '#F3EBDD' : THEMES[t.id].mini
      ctx.fillRect(i, j, 1, 1)
    }
  return cv
}
