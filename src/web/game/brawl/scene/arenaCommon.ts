/** Tipos e pincéis comuns das artes de arena (código puro: sem DOM e sem Pixi). */
import type { ArenaId } from '../../../../shared/games/brawl/types'
import { ARENA_H, ARENA_W } from '../../../../shared/games/brawl/types'
import { Buf, bayer, hash01, mix } from './raster'

export { ARENA_H, ARENA_W }

/** o que a arena precisa saber do jogo para reagir */
export interface Env {
  /** "reduzir movimento": o fundo fica parado, sem tremida e sem pisca */
  reduced: boolean
  /** ms desde o último nocaute (Infinity = nenhum) */
  koAge: number
  /** de que lado saiu o último nocaute */
  koSide: 'esquerda' | 'direita' | 'cima' | 'baixo' | null
}
export const CALM_ENV: Env = { reduced: false, koAge: Infinity, koSide: null }

export type Layer = 'far' | 'back' | 'front'

/** pedaço animado: um buffer pequeno repintado só quando a chave muda, posto num ponto (que pode andar) */
export interface AnimElem {
  id: string
  layer: Layer
  w: number
  h: number
  /** estado visual (inteiro): muda poucas vezes por segundo */
  key(t: number, env: Env): number
  paint(b: Buf, t: number, env: Env, key: number): void
  /** onde fica agora; null = escondido */
  pos(t: number, env: Env): { x: number; y: number } | null
}

export interface ArenaArt {
  id: ArenaId
  /** fundo distante (céu, cidade): opaco só onde a janela/céu aparece */
  far: Buf
  /** o cenário com as plataformas; tem buracos onde se vê o fundo distante */
  back: Buf
  /** frente leve, por cima dos lutadores */
  front: Buf
  anims: AnimElem[]
  /** 1 onde a arte desenhou plataforma sólida/fina (para o teste conferir com a geometria) */
  platformMask: Uint8Array
  /** cor de fundo das tarjas */
  wall: number
}

/** tempo congelado quando "reduzir movimento" */
export const tOf = (t: number, env: Env): number => (env.reduced ? 0 : t)

/** faixas de cor com pontilhado entre elas (céu à noite sem gradiente liso) */
export function bandedSky(b: Buf, x: number, y: number, w: number, h: number, top: number, bot: number, bands: number): void {
  const bh = h / bands
  for (let j = 0; j < h; j++) {
    const f = j / bh
    const i = Math.floor(f)
    const frac = f - i
    const c0 = mix(top, bot, i / bands)
    const c1 = mix(top, bot, Math.min(1, (i + 1) / bands))
    for (let k = 0; k < w; k++) b.set(x + k, y + j, frac > bayer(x + k, y + j) * 0.999 ? c1 : c0)
  }
}

/** nuvem de elipses com borda pontilhada, em um Buf transparente */
export function cloudBuf(w: number, h: number, seed: number, base: number, shade: number, hi: number): Buf {
  const b = new Buf(w, h)
  const n = 4 + Math.floor(hash01(seed) * 3)
  for (let i = 0; i < n; i++) {
    const cx = (w * (i + 0.7)) / (n + 0.4)
    const rx = w * (0.16 + hash01(seed, i) * 0.1)
    const ry = h * (0.3 + hash01(seed, i, 1) * 0.2)
    const cy = h * 0.62 - ry * 0.35 * hash01(seed, i, 2)
    b.ellipse(cx, cy, rx, ry, base)
  }
  b.rect(0, Math.floor(h * 0.72), w, Math.ceil(h * 0.3), base)
  // base achatada: apara embaixo
  for (let x = 0; x < w; x++) for (let y = h - 1; y >= h - 1 - ((x * 7 + seed) % 2); y--) b.set(x, y, 0, 0)
  // sombra por baixo e luz por cima (pontilhado)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (b.alpha(x, y) === 0) continue
      if (y > h * 0.66 && y / h > 0.66 + bayer(x, y) * 0.3) b.set(x, y, shade)
      else if (y < h * 0.4 && 0.4 - y / h > bayer(x, y) * 0.4 && b.alpha(x, y - 1) === 0) b.set(x, y, hi)
    }
  return b
}

/** livros em pé numa prateleira: do x0 ao x1, topo da prateleira em `y` */
export function bookRow(b: Buf, x0: number, x1: number, y: number, seed: number, maxH = 16): void {
  const cols = [0xff7a6b, 0xffc94a, 0x6fd49b, 0x7fb7e6, 0xd9594b, 0xf3ebdd, 0xb7a99a, 0x5b7c99, 0xa8392f, 0x4d7f4a]
  let x = x0
  let i = 0
  while (x < x1 - 2) {
    const w = 3 + Math.floor(hash01(seed, i) * 3)
    const h = Math.max(8, maxH - Math.floor(hash01(seed, i, 1) * 7))
    if (x + w > x1) break
    const c = cols[Math.floor(hash01(seed, i, 2) * cols.length)]!
    const lean = hash01(seed, i, 3) > 0.9 && x + w + 4 < x1
    if (lean) {
      for (let k = 0; k < h; k++) b.rect(x + Math.floor(k / 4), y - 1 - k, w, 1, c)
      x += w + 4
    } else {
      b.rect(x, y - h, w, h, c)
      b.vline(x, y - h, h, mix(c, 0xffffff, 0.25))
      b.vline(x + w - 1, y - h, h, mix(c, 0x000000, 0.35))
      b.hline(x, y - h + 3, w, mix(c, 0x000000, 0.3))
      if (hash01(seed, i, 4) > 0.5) b.hline(x, y - 4, w, mix(c, 0xffe9a6, 0.5))
      x += w
    }
    i++
  }
}

/** marca a plataforma na máscara */
export function markPlatform(mask: Uint8Array, x: number, y: number, w: number, h: number): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) mask[(y + j) * ARENA_W + x + i] = 1
}
