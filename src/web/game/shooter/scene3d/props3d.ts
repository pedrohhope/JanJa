/**
 * Props do Tiro na Sala em 3D (puro: sem DOM, sem three). A tabela diz a forma e a altura de cada chave `art` da
 * LEGEND; as funções `*Rows` desenham, por código, a pixel art das laterais, do teto, da água e da tampa do muro
 * (16 px de largura, letras da SPAL), com as mesmas cores da arte de cima dos tiles.
 */
import type { MapId } from '../../../../shared/games/shooter/types'
import type { Rows } from '../scene/palette'
import { noise } from '../scene/tiles'
import { WALL_H, type Prop3D, type PropTable } from './contract3d'

const flat: Prop3D = { shape: 'flat', height: 0, inset: 0 }
const box = (height: number, inset = 0, glow?: Prop3D['glow']): Prop3D => (glow ? { shape: 'box', height, inset, glow } : { shape: 'box', height, inset })

/**
 * Regra (testada): móvel que bloqueia tiro é mais alto que SHOT_H (2.1); sólido que não bloqueia é mais baixo.
 */
export const PROP_3D: PropTable = {
  'piso-madeira': flat,
  'piso-ceramica': flat,
  tapete: flat,
  grama: flat,
  terra: flat,
  agua: flat,
  parede: { shape: 'wall', height: 0, inset: 0 },
  sofa: box(2.6),
  tv: box(3.6, 0, { color: '#7FB7E6', face: 'side' }),
  balcao: box(2.6),
  'mesa-centro': box(1.0),
  cama: box(1.1),
  'guarda-roupa': box(4.4),
  geladeira: box(4.0),
  fogao: box(2.6, 0, { color: '#FF7A6B', face: 'top' }),
  vaso: box(1.5, 3),
  mureta: box(1.4),
  varal: { shape: 'line', height: 3.2, inset: 0 },
  churrasqueira: box(3.0, 0, { color: '#FFC94A', face: 'top' }),
  arvore: { shape: 'tree', height: 7, inset: 0 },
  cerca: box(1.4, 2)
}

/** altura real do prop no mapa (parede usa a do mapa) */
export function propHeight(art: string, mapId: MapId): number {
  const p = PROP_3D[art]
  if (!p) return 0
  return p.shape === 'wall' ? WALL_H[mapId] : p.height
}

// ------------------------------------------------------------------ laterais (pixel art nova)

/** (x 0..15, yb = pixels acima do chão, H = altura total em px) -> letra */
type SideFn = (x: number, yb: number, H: number) => string

const n = (x: number, y: number, seed: number): number => noise(x, y, seed)

const paredeCasa: SideFn = (x, yb, H) => {
  const yt = H - 1 - yb
  // faixa no alto
  if (yt === 0) return 'k'
  if (yt <= 2) return 'R'
  if (yt === 3) return 'q'
  if (yt === 4) return 'D'
  // rodapé de madeira
  if (yb < 2) return 'k'
  if (yb < 9) return yb === 8 ? 'N' : yb === 2 ? 'n' : n(x, yb, 3) > 0.9 ? 'M' : 'm'
  if (yb === 9) return 'k'
  // papel de parede listrado
  const s = x % 8
  if (s < 2) return n(x, yb, 5) > 0.9 ? 'd' : 'P'
  if (s === 4 && (yb + 6) % 12 === 0) return 'D'
  if (s === 3 && (yb + 6) % 12 === 1) return 'D'
  return n(x, yb, 7) > 0.95 ? 'D' : n(x, yb, 9) < 0.03 ? 'P' : 'd'
}

const paredeQuintal: SideFn = (x, yb, H) => {
  const yt = H - 1 - yb
  if (yt === 0) return 'k'
  if (yt <= 3) return 'I'
  if (yt === 4) return 'D'
  if (yb < 2) return 'k'
  if (yb < 19) {
    // tijolo aparente embaixo
    if (yb === 18) return 'D'
    const row = Math.floor((yb - 2) / 4)
    if ((yb - 2) % 4 === 3) return 'D'
    if ((x + (row % 2) * 4) % 8 === 7) return 'D'
    const r = n(x, yb, 11)
    return r > 0.85 ? 'O' : r < 0.12 ? 'q' : 'R'
  }
  // reboco
  const r = n(x, yb, 13)
  if (r > 0.94) return 'I'
  if (r < 0.06) return 'D'
  return 'i'
}

const sofa: SideFn = (x, yb, H) => {
  if (yb === H - 1) return 'k'
  if (yb < 2) return 'k'
  if (yb < 4) return 'n'
  if (x === 0 || x === 15) return 'V'
  if (yb < 15) return yb === 14 ? 'V' : yb < 6 ? 'V' : 'v'
  if (yb < 22) return yb === 21 ? 'd' : yb === 15 ? 'V' : 'v'
  // encosto com botões
  if (yb > H - 4) return 'V'
  if ((x === 4 || x === 11) && (yb === 30 || yb === 36)) return 'V'
  return n(x, yb, 15) > 0.93 ? 'V' : 'v'
}

const tv: SideFn = (x, yb, H) => {
  if (yb < 2) return 'k'
  if (yb < 22) {
    if (yb === 21) return 'n'
    if (x === 0) return 'n'
    if (x === 7 && yb > 8 && yb < 14) return 'y'
    return n(x, yb, 17) > 0.9 ? 'M' : 'm'
  }
  if (yb === 22) return 'N'
  if (yb === 23) return 'k'
  if (yb < 51) {
    // tela de tubo (o brilho emissivo vai por cima)
    if (yb === 50) return 'k'
    const glare = x < 5 && yb > 42 && (x + yb) % 2 === 0
    return glare ? 'c' : (x + yb) % 11 === 0 ? 'V' : 'v'
  }
  if (yb === 51) return 'k'
  return yb === H - 1 ? 'n' : 'N'
}

const balcao: SideFn = (x, yb, H) => {
  const yt = H - 1 - yb
  if (yt === 0) return 'D'
  if (yt <= 2) return 'I'
  if (yt === 3) return 'd'
  if (yb < 3) return 'k'
  if (yb === 3) return 'w'
  if (x === 0) return 'k'
  // portas de armário com puxador
  if (yb < 28 && (x === 8)) return 'P'
  if ((x === 6 || x === 10) && yb > 22 && yb < 28) return 'i'
  return yb % 6 === 0 ? 'P' : n(x, yb, 19) > 0.95 ? 'd' : 'p'
}

const mesaCentro: SideFn = (x, yb, H) => {
  if (yb === H - 1) return 'N'
  if (yb === H - 2) return 'M'
  if (yb < 1) return 'k'
  if (yb > H - 5) return 'n'
  // pernas nas pontas
  return x < 2 || x > 13 ? 'n' : n(x, yb, 21) > 0.9 ? 'k' : 'w'
}

const cama: SideFn = (x, yb, H) => {
  if (yb < 2) return 'k'
  if (yb < 5) return yb === 4 ? 'N' : 'n'
  if (yb === H - 1) return 'P'
  if (yb > H - 4) return 'p'
  const stripe = Math.floor((x + yb) / 4) % 4 === 0
  return stripe ? 'V' : n(x, yb, 23) > 0.94 ? 'V' : 'v'
}

const guardaRoupa: SideFn = (x, yb, H) => {
  const yt = H - 1 - yb
  if (yt === 0) return 'N'
  if (yt < 3) return yt === 2 ? 'n' : 'M'
  if (yb < 2) return 'k'
  if (yb < 5) return 'n'
  if (x === 0 || x === 15) return 'n'
  // almofadas das portas
  const panel = (yb > 8 && yb < 36) || (yb > 40 && yb < H - 8)
  if (panel && (x === 2 || x === 13 || yb === 9 || yb === 35 || yb === 41 || yb === H - 9)) return 'n'
  if ((x === 6 || x === 9) && yb > 30 && yb < 34) return 'y'
  return n(x, yb, 25) > 0.95 ? 'M' : 'm'
}

const geladeira: SideFn = (x, yb, H) => {
  if (yb === H - 1) return 'd'
  if (yb < 2) return 'k'
  if (yb < 4) return 'D'
  if (x === 0) return 'd'
  if (x === 15) return 'D'
  if (yb === 40) return 'd'
  if (x >= 11 && x <= 12 && ((yb > 43 && yb < 58) || (yb > 18 && yb < 36))) return 'D'
  return yb > H - 4 ? 'p' : n(x, yb, 27) > 0.96 ? 'P' : 'p'
}

const fogao: SideFn = (x, yb, H) => {
  if (yb === H - 1) return 'i'
  if (yb < 2) return 'k'
  if (yb < 4) return 'D'
  if (yb >= 28 && yb < 40) {
    // painel com botões
    if (yb === 28) return 'd'
    return x % 5 === 2 && yb > 31 && yb < 36 ? 'k' : 'D'
  }
  if (yb >= 5 && yb < 26) {
    // porta do forno com visor
    if (x < 2 || x > 13) return 'D'
    if (yb === 24) return 'I'
    if (x > 2 && x < 13 && yb > 8 && yb < 21) return (x + yb) % 7 === 0 ? 'R' : 'k'
    return 'd'
  }
  return 'D'
}

const churrasqueira: SideFn = (x, yb, H) => {
  if (yb === H - 1) return 'I'
  if (yb < 2) return 'k'
  const yt = H - 1 - yb
  if (yt < 4) return yt === 3 ? 'D' : 'I'
  // abertura da brasa
  if (yb > 12 && yb < 28 && x > 2 && x < 13) {
    const r = n(x, yb, 29)
    return yb < 17 ? (r > 0.6 ? 'y' : r > 0.3 ? 'o' : 'O') : 'k'
  }
  // tijolos
  const row = Math.floor(yb / 4)
  if (yb % 4 === 3) return 'D'
  if ((x + (row % 2) * 4) % 8 === 7) return 'D'
  return n(x, yb, 31) > 0.85 ? 'I' : 'i'
}

const vaso: SideFn = (x, yb) => {
  if (yb < 1) return 'k'
  if (yb < 12) {
    // vaso de barro, mais fundo à direita
    const sh = x > 11 ? 'R' : x < 3 ? 'o' : 'O'
    return yb === 11 ? 'R' : sh
  }
  if (yb < 14) return x === 0 || x === 15 ? 'k' : 'o'
  // folhagem
  const r = n(x, yb, 33)
  return r > 0.75 ? 'g' : r < 0.25 ? 'F' : 'G'
}

const mureta: SideFn = (x, yb, H) => {
  const yt = H - 1 - yb
  if (yt === 0) return 'k'
  if (yt < 3) return 'I'
  if (yt === 3) return 'D'
  if (yb < 1) return 'k'
  const row = Math.floor(yb / 4)
  if (yb % 4 === 3) return 'D'
  return (x + row * 5) % 10 === 0 ? 'D' : n(x, yb, 35) > 0.9 ? 'I' : 'i'
}

const cerca: SideFn = (x, yb, H) => {
  const slat = x % 4
  if (yb === H - 1) return slat === 3 ? 'n' : 'k'
  if (slat === 3) return 'n'
  if (yb === 5 || yb === 14) return 'n'
  if (yb < 1) return 'k'
  return slat === 0 ? 'N' : n(x, yb, 37) > 0.93 ? 'N' : 'M'
}

const varal: SideFn = (x, yb) => (x >= 7 && x <= 8 ? (yb < 2 ? 'k' : 'D') : 'D')

const arvore: SideFn = (x, yb) => {
  // casca do tronco
  const r = n(x, yb >> 1, 39)
  return x === 0 || x === 15 ? 'n' : r > 0.7 ? 'M' : r < 0.25 ? 'n' : 'm'
}

const SIDE: Record<string, SideFn> = {
  sofa,
  tv,
  balcao,
  'mesa-centro': mesaCentro,
  cama,
  'guarda-roupa': guardaRoupa,
  geladeira,
  fogao,
  vaso,
  mureta,
  varal,
  churrasqueira,
  arvore,
  cerca
}

/**
 * Pixel art da lateral de `art`: 16 px de largura e round(16 * altura) de altura (linha 0 = topo). Parede: WALL_H do
 * mapa (casa = papel de parede com rodapé e faixa no alto; quintal = muro de reboco sobre tijolo). Pisos ('flat') não
 * têm lateral: devolve uma linha só (nunca usada).
 */
export function sideRows(art: string, mapId: MapId): Rows {
  const prop = PROP_3D[art]
  if (!prop || prop.shape === 'flat') return ['k'.repeat(16)]
  const fn = prop.shape === 'wall' ? (mapId === 'casa' ? paredeCasa : paredeQuintal) : (SIDE[art] ?? sofa)
  const H = Math.max(1, Math.round(16 * propHeight(art, mapId)))
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let line = ''
    for (let x = 0; x < 16; x++) line += fn(x, H - 1 - y, H)
    rows.push(line)
  }
  return rows
}

/** teto escuro de forro (16x16, repete) */
export function ceilingRows(): Rows {
  const rows: string[] = []
  for (let y = 0; y < 16; y++) {
    let line = ''
    for (let x = 0; x < 16; x++) {
      if (y % 8 === 7) line += 'k'
      else if (x === 0) line += 'w'
      else line += n(x, y, 41) > 0.9 ? 'r' : y % 8 === 0 ? 'e' : 'W'
    }
    rows.push(line)
  }
  return rows
}

/** água da piscina (16x16, repete; o motor anima o deslocamento) */
export function waterRows(): Rows {
  const rows: string[] = []
  for (let y = 0; y < 16; y++) {
    let line = ''
    for (let x = 0; x < 16; x++) {
      const wave = (x + ((y >> 1) % 2) * 2 + (y >> 2) * 3) % 8
      if (wave === 0 && n(x >> 1, y, 43) > 0.35) line += 'a'
      else if (wave === 3 || wave === 4) line += n(x, y >> 1, 45) > 0.5 ? 'c' : 'C'
      else line += n(x, y, 47) < 0.05 ? 'B' : 'C'
    }
    rows.push(line)
  }
  return rows
}

/** tampa de concreto do muro do quintal vista de cima (16x16) */
export function capRows(): Rows {
  const rows: string[] = []
  for (let y = 0; y < 16; y++) {
    let line = ''
    for (let x = 0; x < 16; x++) {
      const edge = Math.min(x, y, 15 - x, 15 - y)
      if (edge === 0) line += 'D'
      else {
        const r = n(x, y, 49)
        line += r > 0.93 ? 'I' : r < 0.07 ? 'd' : edge === 1 ? 'I' : 'i'
      }
    }
    rows.push(line)
  }
  return rows
}
