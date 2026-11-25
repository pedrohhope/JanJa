/**
 * Camada 2D por cima do 3D (sem three): arma na mão, clarão do cano, mira, marcador de acerto, borda
 * de dano e minimapa. Desenha na MESMA resolução virtual do Three; o CSS amplia sem suavizar.
 */
import { LEGEND } from '../../../../shared/games/shooter/maps/legend'
import type { MapDef, WeaponId } from '../../../../shared/games/shooter/types'
import type { RenderPlayer, ShooterFrame } from '../contract'
import { SPAL, rowsToCanvas, tintedPalette } from '../scene/palette'
import { BIG_FLASH, CROSSHAIR, HITMARKER, MUZZLE_FLASH } from '../scene/sprites'
import { FPS_H, FPS_MUZZLE, FPS_W, fpsGrenadeRows, fpsWeaponRows } from './fpsArt'

/** minimapa: caixa em px virtuais, no canto de cima à direita */
export const MINI_W = 64
export const MINI_H = 44
const MINI_MARGIN = 4
/** inimigos aparecem no minimapa por este tempo depois de atirar (ms) */
export const ENEMY_SEEN_MS = 2000
const RECOIL_MS = 120
const FLASH_MS = 45
const DIP_MS = 160
const THROW_MS = 420
/** a arma na mão é desenhada em dobro (o desenho de 56x62 fica pequeno em 270 px de altura) */
const VM_SCALE = 2
/** a borda direita do desenho da arma fica nesta fração da largura (as ferramentas do HUD ficam no canto) */
const VM_RIGHT = 0.8
const HURT_DEPTH = 14

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export interface OverlayDraw {
  dtMs: number
  reduced: boolean
  frame: ShooterFrame | null
  map: MapDef | null
  me: RenderPlayer | null
  /** olhar da câmera (rad) */
  yaw: number
  moving: boolean
  /** cor do apelido de quem joga */
  color: string
  /** false: terceira pessoa, morto ou fim (sem arma, sem mira, sem minimapa de você) */
  firstPerson: boolean
  colorOf(id: string): string
}

export class Overlay {
  readonly canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private w = 480
  private h = 270
  private time = 0
  private walkT = 0
  private recoil = 0
  private flash = 0
  private flashBig = false
  private dip = 0
  private lastWeapon: WeaponId | '' = ''
  private throwT = 0
  private hitmarker = 0
  private hurt = 0
  private hurtLevels: HTMLCanvasElement[] = []
  private sprites = new Map<string, HTMLCanvasElement>()
  private flashCv = rowsToCanvas(MUZZLE_FLASH)
  private bigFlashCv = rowsToCanvas(BIG_FLASH)
  private crossCv = rowsToCanvas(CROSSHAIR)
  private hitCv = rowsToCanvas(HITMARKER)
  private seen = new Map<number, number>()
  private mini: { id: string; cv: HTMLCanvasElement } | null = null

  constructor() {
    this.resize(this.w, this.h)
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, Math.round(w))
    this.h = Math.max(1, Math.round(h))
    this.canvas.width = this.w
    this.canvas.height = this.h
    this.ctx = this.canvas.getContext('2d')!
    this.ctx.imageSmoothingEnabled = false
    this.hurtLevels = this.buildHurt()
  }

  // ------------------------------------------------------------ eventos vindos do motor
  onShot(weapon: WeaponId): void {
    this.recoil = 1
    this.flash = 2
    this.flashBig = weapon === 'escopeta' || weapon === 'rolha'
  }
  onThrow(): void {
    this.throwT = 1
  }
  onHit(): void {
    this.hitmarker = 1
  }
  onHurt(): void {
    this.hurt = 1
  }
  /** um inimigo atirou (para o minimapa) */
  onEnemyShot(slot: number): void {
    this.seen.set(slot, this.time)
  }
  reset(): void {
    this.seen.clear()
    this.recoil = this.flash = this.hitmarker = this.hurt = this.throwT = 0
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.w, this.h)
  }

  // ------------------------------------------------------------ desenho
  draw(d: OverlayDraw): void {
    const { ctx, w, h } = this
    const dt = Math.min(100, d.dtMs)
    this.time += dt
    ctx.clearRect(0, 0, w, h)
    this.recoil = Math.max(0, this.recoil - dt / RECOIL_MS)
    this.hitmarker = Math.max(0, this.hitmarker - dt / 170)
    this.hurt = Math.max(0, this.hurt - dt / (d.reduced ? 220 : 420))
    this.dip = Math.max(0, this.dip - dt / DIP_MS)
    this.throwT = Math.max(0, this.throwT - dt / THROW_MS)
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / FLASH_MS)
    if (d.moving && !d.reduced) this.walkT += dt / 1000
    const alive = !!d.me && d.me.alive
    const playing = d.frame != null && d.frame.phase !== 'fim'

    if (d.firstPerson && alive) this.drawWeapon(d)
    this.drawHurt(d, alive)
    if (d.firstPerson && alive && playing) {
      ctx.drawImage(this.crossCv, Math.round(w / 2) - 5, Math.round(h / 2) - 5)
      if (this.hitmarker > 0) {
        ctx.globalAlpha = d.reduced ? 0.7 : 1
        ctx.drawImage(this.hitCv, Math.round(w / 2) - 4, Math.round(h / 2) - 4)
        ctx.globalAlpha = 1
      }
    }
    if (d.frame && d.map) this.drawMinimap(d)
  }

  private weaponSprite(w: WeaponId | 'granada', color: string): HTMLCanvasElement {
    const key = `${w}|${color}`
    let c = this.sprites.get(key)
    if (!c) {
      this.sprites.set(key, (c = rowsToCanvas(w === 'granada' ? fpsGrenadeRows() : fpsWeaponRows(w), tintedPalette(color))))
    }
    return c
  }

  private drawWeapon(d: OverlayDraw): void {
    const { ctx, w, h } = this
    const me = d.me!
    if (this.lastWeapon !== me.weapon) {
      if (this.lastWeapon !== '') this.dip = 1
      this.lastWeapon = me.weapon
    }
    const red = d.reduced
    // balanço ao andar (curva em 8) e respiração
    const sway = red ? 0 : d.moving ? 1 : 0.25
    const bx = Math.round(Math.sin(this.walkT * 7) * 3 * sway + (red ? 0 : Math.sin(this.time / 900) * 0.6))
    const by = Math.round(Math.abs(Math.cos(this.walkT * 7)) * 3 * (d.moving ? sway : 0) + (red ? 0 : Math.sin(this.time / 700) * 0.6))
    // coice: para baixo e para trás (para a direita), volta em ~120 ms
    const k = this.recoil * this.recoil
    const kick = red ? 3 : 7
    const rx = Math.round(k * kick * 0.6)
    const ry = Math.round(k * kick)
    // troca de arma e arremesso: a arma desce
    const dipY = Math.round(this.dip * 26 + Math.sin(Math.PI * (1 - this.throwT)) * (this.throwT > 0 ? 44 : 0))
    const S = VM_SCALE
    const left = Math.round(w * VM_RIGHT) - FPS_W * S
    const x = left + (bx + rx) * S
    const y = h - FPS_H * S + 8 + (by + ry + dipY) * S
    ctx.drawImage(this.weaponSprite(me.weapon, d.color), x, y, FPS_W * S, FPS_H * S)
    if (this.throwT > 0) {
      const p = 1 - this.throwT
      const gy = h - FPS_H * S + 8 + Math.round((1 - Math.sin(Math.PI * Math.min(1, p * 1.2))) * 50) * S
      ctx.drawImage(this.weaponSprite('granada', d.color), left - 4 * S, gy, FPS_W * S, FPS_H * S)
    }
    // clarão do cano
    if (this.flash > 0 && this.throwT === 0) {
      const m = FPS_MUZZLE[me.weapon]
      const img = this.flashBig ? this.bigFlashCv : this.flashCv
      const s = (this.flashBig ? 3 : 2) * S
      ctx.save()
      ctx.translate(x + m.x * S, y + m.y * S)
      ctx.rotate(-Math.PI / 2 - 0.3)
      ctx.globalAlpha = red ? 0.6 : 1
      ctx.drawImage(img, 0, -Math.floor((img.height * s) / 2), img.width * s, img.height * s)
      ctx.restore()
      ctx.globalAlpha = 1
    }
  }

  /** borda vermelha pontilhada (sem gradiente): mais densa quanto maior a força */
  private drawHurt(d: OverlayDraw, alive: boolean): void {
    const low = alive && d.me!.hp <= 30
    const pulse = low && !d.reduced ? 0.6 + 0.4 * Math.sin(this.time / 260) : 1
    const a = this.hurt > 0 ? this.hurt * (d.reduced ? 0.45 : 1) : low ? 0.3 * pulse : 0
    if (a < 0.04) return
    const level = Math.max(1, Math.min(this.hurtLevels.length, Math.ceil(a * this.hurtLevels.length)))
    this.ctx.drawImage(this.hurtLevels[level - 1]!, 0, 0)
  }

  private buildHurt(): HTMLCanvasElement[] {
    const out: HTMLCanvasElement[] = []
    const levels = 4
    const col = SPAL.R!
    const rgb = [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16)]
    for (let L = 1; L <= levels; L++) {
      const cv = document.createElement('canvas')
      cv.width = this.w
      cv.height = this.h
      const cx = cv.getContext('2d')
      if (cx) {
        const img = cx.createImageData(this.w, this.h)
        for (let y = 0; y < this.h; y++)
          for (let x = 0; x < this.w; x++) {
            const dist = Math.min(x, y, this.w - 1 - x, this.h - 1 - y)
            if (dist >= HURT_DEPTH) continue
            const cover = (1 - dist / HURT_DEPTH) ** 1.4 * (L / levels)
            if (cover * 16 <= BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) continue
            const o = (y * this.w + x) * 4
            img.data[o] = rgb[0]!
            img.data[o + 1] = rgb[1]!
            img.data[o + 2] = rgb[2]!
            img.data[o + 3] = 255
          }
        cx.putImageData(img, 0, 0)
      }
      out.push(cv)
    }
    return out
  }

  // ------------------------------------------------------------ minimapa
  private miniBase(map: MapDef): { cv: HTMLCanvasElement; s: number } {
    if (this.mini?.id !== map.id) {
      const cv = document.createElement('canvas')
      cv.width = map.w
      cv.height = map.h
      const cx = cv.getContext('2d')!
      for (let ty = 0; ty < map.h; ty++)
        for (let tx = 0; tx < map.w; tx++) {
          const t = LEGEND[map.rows[ty]![tx]!]
          let c: string = SPAL.w!
          if (t) {
            if (t.art === 'parede') c = SPAL.D!
            else if (t.solid && t.blocksShot) c = SPAL.E!
            else if (t.solid) c = SPAL.e!
            else if (t.slow) c = SPAL.B!
            else c = SPAL.W!
          }
          cx.fillStyle = c
          cx.fillRect(tx, ty, 1, 1)
        }
      this.mini = { id: map.id, cv }
    }
    const s = Math.max(1, Math.floor(Math.min((MINI_W - 2) / map.w, (MINI_H - 2) / map.h)))
    return { cv: this.mini.cv, s }
  }

  private drawMinimap(d: OverlayDraw): void {
    const { ctx, w } = this
    const map = d.map!
    const frame = d.frame!
    const { cv, s } = this.miniBase(map)
    const bw = map.w * s
    const bh = map.h * s
    const ox = w - MINI_MARGIN - bw - 1
    const oy = MINI_MARGIN + 1
    ctx.globalAlpha = 0.7
    ctx.fillStyle = SPAL.k!
    ctx.fillRect(ox - 1, oy - 1, bw + 2, bh + 2)
    ctx.globalAlpha = 0.9
    ctx.drawImage(cv, ox, oy, bw, bh)
    ctx.globalAlpha = 1
    const toX = (px: number): number => ox + Math.round((px / 16) * s)
    const toY = (py: number): number => oy + Math.round((py / 16) * s)
    // caixas disponíveis
    const blink = d.reduced || Math.floor(this.time / 450) % 2 === 0
    for (const pk of frame.pickups) {
      if (!pk.available) continue
      ctx.fillStyle = pk.kind === 'vida' ? SPAL.g! : blink ? SPAL.y! : SPAL.Y!
      ctx.fillRect(toX(pk.x), toY(pk.y), 1, 1)
    }
    // inimigos que atiraram há pouco
    for (const p of frame.players) {
      if (p.slot === frame.me || !p.alive) continue
      const t = this.seen.get(p.slot)
      if (t === undefined) continue
      const age = this.time - t
      if (age > ENEMY_SEEN_MS) {
        this.seen.delete(p.slot)
        continue
      }
      ctx.globalAlpha = age > ENEMY_SEEN_MS - 500 ? 0.45 : 1
      const x = toX(p.x)
      const y = toY(p.y)
      ctx.fillStyle = SPAL.k!
      ctx.fillRect(x - 1, y - 1, 3, 3)
      ctx.fillStyle = d.colorOf(p.id)
      ctx.fillRect(x - 1, y - 1, 2, 2)
      ctx.globalAlpha = 1
    }
    // você: seta na sua cor apontando para onde olha
    if (d.me && d.me.alive) {
      const cx = ox + (d.me.x / 16) * s
      const cy = oy + (d.me.y / 16) * s
      this.arrow(cx, cy, d.yaw, d.color)
    }
  }

  private arrow(cx: number, cy: number, yaw: number, color: string): void {
    const ctx = this.ctx
    const fx = Math.cos(yaw)
    const fy = Math.sin(yaw)
    const nx = -fy
    const ny = fx
    // triângulo: ponta à frente, base atrás e aberta para os lados
    const A: [number, number] = [fx * 3.4, fy * 3.4]
    const B: [number, number] = [-fx * 2 + nx * 2.4, -fy * 2 + ny * 2.4]
    const C: [number, number] = [-fx * 2 - nx * 2.4, -fy * 2 - ny * 2.4]
    const edge = (p: [number, number], q: [number, number], x: number, y: number): number => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1])
    const inside = (x: number, y: number): boolean => {
      const d1 = edge(A, B, x, y)
      const d2 = edge(B, C, x, y)
      const d3 = edge(C, A, x, y)
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
    }
    const x0 = Math.round(cx)
    const y0 = Math.round(cy)
    const offs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    const cells: [number, number][] = []
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (inside(x0 + dx - cx, y0 + dy - cy)) cells.push([dx, dy])
    ctx.fillStyle = SPAL.k!
    for (const [dx, dy] of cells) for (const [ox, oy] of offs) ctx.fillRect(x0 + dx + ox, y0 + dy + oy, 1, 1)
    ctx.fillStyle = color
    for (const [dx, dy] of cells) ctx.fillRect(x0 + dx, y0 + dy, 1, 1)
  }
}
