/**
 * Arma na mão em primeira pessoa: pixel art feita em código, vista de trás e um pouco de lado, para o
 * canto de baixo à direita da tela (resolução virtual de 270 de altura). A manga leva a tinta do
 * jogador (`t`/`T`), a mão é `s`/`S`. Puro: sem three e sem DOM.
 *
 * Todos os quadros têm FPS_W x FPS_H e a âncora é o canto de baixo à direita.
 */
import { Grid } from '../../art/grid'
import type { WeaponId } from '../../../../shared/games/shooter/types'
import type { Rows } from '../scene/palette'

export const FPS_W = 56
export const FPS_H = 62

type Shader = (u: number, t: number, i: number, w: number) => string

interface End {
  x: number
  y: number
  w: number
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** tronco cônico que sobe de `from` (embaixo) até `to` (em cima); `shade` escolhe a letra de cada pixel */
function tube(g: Grid, from: End, to: End, shade: Shader): void {
  const rows = Math.max(1, from.y - to.y)
  for (let y = from.y; y >= to.y; y--) {
    const t = (from.y - y) / rows
    const w = Math.max(1, Math.round(lerp(from.w, to.w, t)))
    const cx = lerp(from.x, to.x, t)
    const left = Math.round(cx - w / 2)
    for (let i = 0; i < w; i++) g.set(left + i, y, shade(w === 1 ? 0.5 : i / (w - 1), t, i, w))
  }
}

/** contorno preto em volta de tudo que não é transparente */
function outline(g: Grid): void {
  const mark: [number, number][] = []
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (g.get(x, y) !== '.') continue
      if (g.get(x - 1, y) !== '.' || g.get(x + 1, y) !== '.' || g.get(x, y - 1) !== '.' || g.get(x, y + 1) !== '.') mark.push([x, y])
    }
  for (const [x, y] of mark) g.set(x, y, 'k')
}

const metal: Shader = (u, t) => (t > 0.97 ? 'D' : u < 0.28 ? 'd' : u < 0.7 ? 'I' : 'D')
const wood: Shader = (u) => (u < 0.3 ? 'N' : u < 0.75 ? 'M' : 'm')
const coral: Shader = (u) => (u < 0.3 ? 'o' : u < 0.75 ? 'O' : 'R')
const sleeveShade: Shader = (u, t) => (t > 0.9 ? 'T' : u < 0.7 ? 't' : 'T')

/** manga que sobe do canto de baixo à direita até o punho em (cx, topY) */
function sleeve(g: Grid, cx: number, topY: number): void {
  tube(g, { x: cx + 9, y: FPS_H - 1, w: 24 }, { x: cx + 1, y: topY, w: 14 }, sleeveShade)
  // punho da manga (faixa mais escura)
  for (let x = cx - 6; x <= cx + 8; x++) if (g.get(x, topY + 1) === 't' || g.get(x, topY + 1) === 'T') g.set(x, topY + 1, 'T')
}

/** mão fechada em volta do cabo, com o polegar à esquerda */
function fist(g: Grid, cx: number, y: number): void {
  g.rect(cx - 6, y, 12, 9, 's')
  g.rect(cx + 4, y, 2, 9, 'S')
  g.rect(cx - 6, y + 8, 12, 1, 'S')
  g.rect(cx - 5, y + 2, 6, 1, 'S')
  g.rect(cx - 5, y + 5, 6, 1, 'S')
  g.rect(cx - 8, y + 1, 2, 5, 's')
  g.set(cx - 8, y + 5, 'S')
  for (const [x, yy] of [[cx - 6, y], [cx + 5, y]] as const) g.set(x, yy, '.')
}

function finish(g: Grid): Rows {
  outline(g)
  return g.toSprite()
}

interface Built {
  rows: Rows
  muzzle: { x: number; y: number }
}

function pistola(): Built {
  const g = new Grid(FPS_W, FPS_H)
  // armação e ferrolho, subindo para a esquerda
  tube(g, { x: 40, y: 50, w: 11 }, { x: 31, y: 20, w: 7 }, metal)
  tube(g, { x: 40, y: 50, w: 11 }, { x: 38, y: 40, w: 11 }, (u) => (u < 0.3 ? 'I' : 'D'))
  g.rect(30, 17, 3, 2, 'd') // massa de mira
  g.set(31, 16, 'D')
  for (let y = 26; y < 46; y += 4) g.set(35 + Math.round((46 - y) / 10), y, 'k') // serrilha do ferrolho
  sleeve(g, 41, 46)
  fist(g, 40, 42)
  return { rows: finish(g), muzzle: { x: 31, y: 15 } }
}

function escopeta(): Built {
  const g = new Grid(FPS_W, FPS_H)
  // coronha de madeira por baixo da mão
  tube(g, { x: 44, y: 61, w: 12 }, { x: 40, y: 44, w: 10 }, wood)
  // tubo do carregador (à esquerda) e cano
  tube(g, { x: 36, y: 44, w: 3 }, { x: 22, y: 12, w: 3 }, (u) => (u < 0.5 ? 'D' : 'i'))
  tube(g, { x: 41, y: 48, w: 9 }, { x: 24, y: 3, w: 6 }, metal)
  // telha da arma (madeira, o "pump")
  tube(g, { x: 35, y: 34, w: 12 }, { x: 31, y: 24, w: 11 }, wood)
  g.rect(28, 29, 8, 1, 'n')
  g.rect(24, 4, 6, 1, 'k') // boca do cano
  sleeve(g, 43, 47)
  fist(g, 42, 43)
  return { rows: finish(g), muzzle: { x: 26, y: 2 } }
}

function sub(): Built {
  const g = new Grid(FPS_W, FPS_H)
  // carregador pendurado (aparece à esquerda do corpo)
  tube(g, { x: 33, y: 52, w: 6 }, { x: 31, y: 36, w: 6 }, (u) => (u < 0.4 ? 'E' : 'e'))
  // corpo da arma
  tube(g, { x: 41, y: 50, w: 14 }, { x: 33, y: 24, w: 11 }, metal)
  g.rect(36, 22, 4, 2, 'D') // mira traseira
  // cano com a proteção furada
  tube(g, { x: 33, y: 25, w: 6 }, { x: 28, y: 6, w: 5 }, (u, t) => (t > 0.96 ? 'k' : u < 0.35 ? 'd' : 'D'))
  for (let y = 10; y < 24; y += 3) g.set(29 + Math.round((24 - y) / 4), y, 'k')
  g.rect(27, 5, 3, 1, 'k')
  sleeve(g, 43, 46)
  fist(g, 42, 42)
  return { rows: finish(g), muzzle: { x: 28, y: 4 } }
}

function rifle(): Built {
  const g = new Grid(FPS_W, FPS_H)
  // coronha
  tube(g, { x: 44, y: 61, w: 12 }, { x: 40, y: 44, w: 9 }, wood)
  // luneta por cima
  tube(g, { x: 39, y: 42, w: 8 }, { x: 31, y: 25, w: 7 }, (u, t) => (t > 0.94 ? 'v' : u < 0.3 ? 'D' : 'r'))
  g.rect(30, 24, 3, 1, 'V')
  // corpo e cano comprido
  tube(g, { x: 40, y: 48, w: 9 }, { x: 29, y: 28, w: 7 }, metal)
  tube(g, { x: 29, y: 29, w: 4 }, { x: 21, y: 3, w: 3 }, (u, t) => (t > 0.97 ? 'k' : u < 0.4 ? 'd' : 'D'))
  g.rect(20, 2, 3, 1, 'k')
  sleeve(g, 43, 47)
  fist(g, 42, 43)
  return { rows: finish(g), muzzle: { x: 21, y: 1 } }
}

function rolha(): Built {
  const g = new Grid(FPS_W, FPS_H)
  // tubo coral gordo
  tube(g, { x: 40, y: 54, w: 20 }, { x: 25, y: 13, w: 15 }, coral)
  for (const t of [0.3, 0.62]) {
    const y = Math.round(54 - 41 * t)
    for (let x = 0; x < FPS_W; x++) {
      const c = g.get(x, y)
      if (c === 'o' || c === 'O' || c === 'R') g.set(x, y, c === 'R' ? 'q' : 'Y')
    }
  }
  // boca do tubo com a rolha enfiada
  g.rect(18, 9, 15, 5, 'k')
  g.rect(19, 10, 13, 3, 'q')
  g.rect(22, 8, 7, 4, 'N')
  g.rect(22, 8, 7, 1, 'p')
  g.rect(23, 9, 2, 2, 'M')
  sleeve(g, 41, 48)
  fist(g, 40, 44)
  return { rows: finish(g), muzzle: { x: 25, y: 7 } }
}

const BUILD: Record<WeaponId, () => Built> = { pistola, escopeta, sub, rifle, rolha }
const cache = new Map<WeaponId, Built>()

function built(w: WeaponId): Built {
  let b = cache.get(w)
  if (!b) cache.set(w, (b = BUILD[w]()))
  return b
}

/** arma em primeira pessoa, FPS_W x FPS_H, âncora no canto de baixo à direita */
export function fpsWeaponRows(w: WeaponId): Rows {
  return built(w).rows
}

/** ponta do cano no sprite, para o clarão e a fumaça */
export const FPS_MUZZLE: Record<WeaponId, { x: number; y: number }> = {
  pistola: built('pistola').muzzle,
  escopeta: built('escopeta').muzzle,
  sub: built('sub').muzzle,
  rifle: built('rifle').muzzle,
  rolha: built('rolha').muzzle
}

/** a mão com a granada (no arremesso) */
export function fpsGrenadeRows(): Rows {
  const g = new Grid(FPS_W, FPS_H)
  // a granada: bola verde com gomos e o pino
  const cx = 34
  const cy = 28
  for (let y = -9; y <= 9; y++)
    for (let x = -9; x <= 9; x++) {
      const d = Math.hypot(x, y * 1.05)
      if (d > 9) continue
      const lit = x + y < -4 ? 'g' : x + y > 6 ? 'F' : 'G'
      g.set(cx + x, cy + y, lit)
    }
  for (let a = -6; a <= 6; a += 4) for (let y = -8; y <= 8; y++) if (g.get(cx + a, cy + y) !== '.') g.set(cx + a, cy + y, 'F')
  for (let x = -8; x <= 8; x++) if (g.get(cx + x, cy) !== '.') g.set(cx + x, cy, 'F')
  g.rect(cx - 3, cy - 12, 6, 3, 'D')
  g.rect(cx - 2, cy - 13, 4, 1, 'd')
  g.rect(cx + 3, cy - 14, 6, 1, 'y') // alavanca e anel
  g.rect(cx + 8, cy - 15, 1, 4, 'Y')
  sleeve(g, 38, 46)
  fist(g, 36, 38)
  g.rect(cx - 8, 36, 4, 3, 's') // dedos por cima da bola
  return finish(g)
}
