/**
 * Cena da sinuca em canvas 2D, em pixel art (4 px por unidade da mesa, ampliado sem suavizar).
 * Anima a tacada rodando a mesma física do servidor a partir do "antes" e, no fim, encaixa nas
 * posições que o servidor mandou.
 *
 * Tacada: mire com o mouse (ou toque para mirar), clique e puxe para trás para dar força, solte
 * para tacar. No teclado: setas miram, W A S D mudam o efeito, segure o Espaço para dar força.
 * Quem espera vê a mira de quem joga ao vivo (`setRemoteAim`).
 */
import { aimGuide, canPlace, clampSpin, cloneBalls, HZ, MAX_STEPS, newLog, POCKETS, step, strike, TABLE_H, TABLE_W, type PBall, type ShotLog, type Spin } from '../../../../shared/games/pool/physics'
import { HEAD_X } from '../../../../shared/games/pool/rules'
import type { PoolView } from '../../../../shared/games/pool/types'
import type { PoolShot, SfxName } from '../../contract'
import type { PoolAim } from '../aim'
import { initialOrientation, PIXELS, pixelColor, roll, type Mat3 } from './ball3d'
import { BALL_PX, PX, TABLE_COLORS as T } from './sprites'

export const RAIL = 14
export const CANVAS_W = TABLE_W * PX + 2 * RAIL
export const CANVAS_H = TABLE_H * PX + 2 * RAIL
/** teclado: força vai de 0 a 1 e volta em 2 * CHARGE_MS */
const CHARGE_MS = 1100
/** puxar o taco esta distância (unidades da mesa) = força máxima */
const PULL_FULL = 26
/** arrasto menor que isto é um toque: só mira */
const TAP = 1.2
/** o taco avança até a bola antes de tudo andar */
const STRIKE_MS = 110
/** a bola some na caçapa neste tempo */
const FALL_MS = 260

export interface PoolEngineProps {
  view: PoolView
  reducedMotion: boolean
  onShoot: (s: PoolShot) => void
  onSfx?: (name: SfxName) => void
  /** muda quando a pessoa quer mover a branca de novo (bola na mão) */
  placeSeq: number
  spin: Spin
  onSpin: (s: Spin) => void
  /** a mira mudou (a casca manda para a sala) */
  onAim?: (a: PoolAim) => void
}

const cx = (x: number): number => RAIL + x * PX
const cy = (y: number): number => RAIL + y * PX

interface Anim {
  balls: PBall[]
  log: ShotLog
  acc: number
  last: number
  pocketed: number
  /** o taco ainda está indo até a bola (ms de início) */
  strikeAt: number
  struck: boolean
  cue: { x: number; y: number; dx: number; dy: number; power: number; spin?: Spin }
}

interface Fall {
  id: number
  x: number
  y: number
  px: number
  py: number
  t0: number
}

export class PoolEngine {
  private ctx: CanvasRenderingContext2D
  private table: HTMLCanvasElement
  private ballCanvas: HTMLCanvasElement
  private shadow: HTMLCanvasElement
  private props: PoolEngineProps | null = null
  private balls: PBall[] = []
  private orient = new Map<number, Mat3>()
  private lastRef: number | null = null
  private anim: Anim | null = null
  private falls: Fall[] = []
  private mouse: { x: number; y: number } | null = null
  private aim = { x: 1, y: 0 }
  /** teclado: quando começou a carregar */
  private charge: number | null = null
  /** mouse/toque: de onde começou a puxar */
  private drag: { x: number; y: number; id: number; power: number; moved: number } | null = null
  private placing = false
  private placed: { x: number; y: number } | null = null
  private pocket: number | null = null
  private pocketLocked = false
  private waiting = 0
  private placeSeq = 0
  private remote: PoolAim | null = null
  private remoteShown: { x: number; y: number; power: number } | null = null
  private raf = 0
  private dirty = true

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    this.ctx.imageSmoothingEnabled = false
    this.table = this.makeTable()
    this.ballCanvas = document.createElement('canvas')
    this.ballCanvas.width = BALL_PX
    this.ballCanvas.height = BALL_PX
    this.shadow = this.makeShadow()
    for (let id = 0; id <= 15; id++) this.orient.set(id, initialOrientation(id))
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onCancel)
    canvas.addEventListener('pointerleave', this.onLeave)
    canvas.addEventListener('keydown', this.onKey)
    canvas.addEventListener('keyup', this.onKeyUp)
    canvas.addEventListener('contextmenu', this.onContext)
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    const c = this.canvas
    c.removeEventListener('pointermove', this.onMove)
    c.removeEventListener('pointerdown', this.onDown)
    c.removeEventListener('pointerup', this.onUp)
    c.removeEventListener('pointercancel', this.onCancel)
    c.removeEventListener('pointerleave', this.onLeave)
    c.removeEventListener('keydown', this.onKey)
    c.removeEventListener('keyup', this.onKeyUp)
    c.removeEventListener('contextmenu', this.onContext)
  }

  setProps(p: PoolEngineProps): void {
    const prev = this.props
    this.props = p
    const v = p.view
    if (this.lastRef === null) {
      // primeira visão: só mostra
      this.balls = cloneBalls(v.balls)
    } else if (v.ref !== this.lastRef) {
      this.waiting = 0
      this.pocketLocked = false
      this.placed = null
      this.drag = null
      this.charge = null
      this.remote = null
      this.remoteShown = null
      if (v.shot && v.shot.ref === v.ref && !p.reducedMotion) {
        const balls = cloneBalls(v.shot.before)
        const c = balls.find((b) => b.id === 0) as PBall
        // o taco vai da força com que puxou até a bola
        this.anim = {
          balls,
          log: newLog(),
          acc: 0,
          last: performance.now(),
          pocketed: 0,
          strikeAt: performance.now(),
          struck: false,
          cue: { x: c.x, y: c.y, dx: v.shot.dx, dy: v.shot.dy, power: v.shot.power, spin: v.shot.spin }
        }
        this.balls = cloneBalls(v.shot.before)
      } else {
        this.anim = null
        this.balls = cloneBalls(v.balls)
      }
    } else if (!this.anim) this.balls = cloneBalls(v.balls)
    if (this.lastRef !== v.ref || (prev && prev.view.turn !== v.turn)) this.placing = this.myTurn() && v.ballInHand
    this.lastRef = v.ref
    if (p.placeSeq !== this.placeSeq) {
      this.placeSeq = p.placeSeq
      if (this.myTurn() && v.ballInHand) {
        this.placing = true
        this.placed = null
        this.emitAim()
      }
    }
    if (prev && (prev.spin.x !== p.spin.x || prev.spin.y !== p.spin.y)) this.emitAim()
    this.dirty = true
  }

  /** mira de quem está jogando, vinda da sala */
  setRemoteAim(a: PoolAim): void {
    const v = this.props?.view
    if (!v || a.ref !== v.ref || this.myTurn()) return
    this.remote = a
    if (a.mode === 'aim' && !this.remoteShown) this.remoteShown = { x: a.x, y: a.y, power: a.power }
    this.dirty = true
  }

  private myTurn(): boolean {
    const v = this.props?.view
    return !!v && !!v.you && v.turn === v.you.index && v.winner === null
  }

  private canAct(): boolean {
    return this.myTurn() && !this.anim && (this.waiting === 0 || performance.now() - this.waiting > 4000)
  }

  private cue(): PBall | undefined {
    const c = this.balls.find((b) => b.id === 0 && !b.in)
    if (!c) return undefined
    return this.placed ? { ...c, ...this.placed } : c
  }

  private power(now = performance.now()): number {
    if (this.drag) return this.drag.power
    if (this.charge === null) return 0
    const t = ((now - this.charge) / CHARGE_MS) % 2
    return Math.max(0.02, t < 1 ? t : 2 - t)
  }

  private emitAim(): void {
    const p = this.props
    if (!p?.onAim || !this.myTurn() || this.anim) return
    const placing = this.placing && this.mouse
    p.onAim({
      ref: p.view.ref,
      mode: placing ? 'place' : 'aim',
      x: placing ? this.mouse!.x : this.aim.x,
      y: placing ? this.mouse!.y : this.aim.y,
      power: this.power(),
      cue: this.placed,
      spin: p.spin,
      pocket: p.view.onEight ? this.pocket : null
    })
  }

  // ---------- entrada ----------
  private toTable(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * CANVAS_W
    const py = ((e.clientY - r.top) / r.height) * CANVAS_H
    return { x: (px - RAIL) / PX, y: (py - RAIL) / PX }
  }

  private aimAt(m: { x: number; y: number }): void {
    const c = this.cue()
    if (!c) return
    const dx = m.x - c.x
    const dy = m.y - c.y
    const l = Math.hypot(dx, dy)
    if (l > 0.5) this.aim = { x: dx / l, y: dy / l }
  }

  private onMove = (e: PointerEvent): void => {
    this.mouse = this.toTable(e)
    if (this.drag && e.pointerId === this.drag.id) {
      // puxar para trás (contra a mira) dá força
      const ox = this.drag.x - this.mouse.x
      const oy = this.drag.y - this.mouse.y
      this.drag.moved = Math.max(this.drag.moved, Math.hypot(ox, oy))
      const pull = ox * this.aim.x + oy * this.aim.y
      this.drag.power = Math.max(0, Math.min(1, pull / PULL_FULL))
    } else if (!this.placing && this.charge === null && e.pointerType !== 'touch') this.aimAt(this.mouse)
    if (this.canAct()) this.emitAim()
    this.dirty = true
  }

  private onLeave = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.id) return
    this.mouse = null
    this.dirty = true
  }

  private onCancel = (): void => {
    this.drag = null
    this.emitAim()
    this.dirty = true
  }

  private onContext = (e: Event): void => {
    e.preventDefault()
    this.charge = null
    this.drag = null
    this.emitAim()
    this.dirty = true
  }

  private validSpot(x: number, y: number): boolean {
    const v = this.props?.view
    return !!v && canPlace(this.balls, x, y, v.behindLine ? HEAD_X : undefined)
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.canAct()) return
    this.canvas.focus()
    const m = this.toTable(e)
    this.mouse = m
    const v = this.props!.view
    if (this.placing) {
      if (this.validSpot(m.x, m.y)) {
        this.placed = { x: m.x, y: m.y }
        this.placing = false
        this.emitAim()
      }
      this.dirty = true
      return
    }
    // na 8: clicar perto de uma caçapa escolhe a caçapa
    if (v.onEight) {
      const k = POCKETS.findIndex((p) => Math.hypot(p.x - m.x, p.y - m.y) < p.r + 2.5)
      if (k >= 0) {
        this.pocket = k
        this.pocketLocked = true
        this.emitAim()
        this.dirty = true
        return
      }
    }
    this.canvas.setPointerCapture(e.pointerId)
    this.drag = { x: m.x, y: m.y, id: e.pointerId, power: 0, moved: 0 }
    this.dirty = true
  }

  private onUp = (e: PointerEvent): void => {
    const d = this.drag
    if (!d || e.pointerId !== d.id) return
    this.drag = null
    if (d.moved < TAP) {
      // toque sem arrastar: mira para onde tocou
      this.aimAt(this.toTable(e))
    } else if (d.power >= 0.02) this.fire(d.power)
    this.emitAim()
    this.dirty = true
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.canAct()) return
    const k = e.key.toLowerCase()
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const a = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.002 : 0.02)
      const c = Math.cos(a)
      const s = Math.sin(a)
      this.aim = { x: this.aim.x * c - this.aim.y * s, y: this.aim.x * s + this.aim.y * c }
      this.emitAim()
      this.dirty = true
    } else if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
      e.preventDefault()
      const p = this.props!
      const step = 0.25
      const next = clampSpin({ x: p.spin.x + (k === 'd' ? step : k === 'a' ? -step : 0), y: p.spin.y + (k === 'w' ? step : k === 's' ? -step : 0) })
      p.onSpin({ x: Math.round(next.x * 100) / 100, y: Math.round(next.y * 100) / 100 })
    } else if (e.key === ' ' && !e.repeat && !this.placing && !this.drag) {
      e.preventDefault()
      this.charge = performance.now()
    } else if (e.key === 'Escape' && (this.charge !== null || this.drag)) {
      e.stopPropagation()
      this.charge = null
      this.drag = null
      this.emitAim()
      this.dirty = true
    }
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' && this.charge !== null) {
      e.preventDefault()
      const power = this.power()
      this.charge = null
      this.fire(power)
    }
  }

  private fire(power: number): void {
    const p = this.props
    if (!p || !this.canAct()) return
    const v = p.view
    if (v.onEight && this.pocket === null) return
    this.waiting = performance.now()
    const spin = clampSpin(p.spin)
    p.onShoot({
      dx: this.aim.x,
      dy: this.aim.y,
      power,
      ...(spin.x !== 0 || spin.y !== 0 ? { spin } : {}),
      ...(v.ballInHand && this.placed ? { cue: this.placed } : {}),
      ...(v.onEight && this.pocket !== null ? { pocket: this.pocket } : {})
    })
    this.dirty = true
  }

  // ---------- desenho ----------
  /** a mesa parada (madeira, tabelas, pano, caçapas), desenhada uma vez */
  private makeTable(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = CANVAS_W
    c.height = CANVAS_H
    const ctx = c.getContext('2d') as CanvasRenderingContext2D
    const W = TABLE_W * PX
    const H = TABLE_H * PX
    // madeira com veio
    ctx.fillStyle = T.woodDark
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.fillStyle = T.wood
    ctx.fillRect(2, 2, CANVAS_W - 4, CANVAS_H - 4)
    ctx.fillStyle = T.woodLight
    ctx.fillRect(2, 2, CANVAS_W - 4, 1)
    ctx.fillRect(2, 2, 1, CANVAS_H - 4)
    ctx.fillStyle = T.woodGrain
    for (let i = 0; i < 70; i++) {
      const h = (i * 2654435761) >>> 0
      const x = 3 + (h % (CANVAS_W - 20))
      const y = 3 + ((h >>> 12) % (CANVAS_H - 6))
      if (x > RAIL - 6 && x < RAIL + W + 6 && y > RAIL - 6 && y < RAIL + H + 6) continue
      ctx.fillRect(x, y, 3 + (h % 9), 1)
    }
    // tabelas de borracha
    ctx.fillStyle = T.cushion
    ctx.fillRect(RAIL - 5, RAIL - 5, W + 10, H + 10)
    ctx.fillStyle = T.cushionLight
    ctx.fillRect(RAIL - 5, RAIL - 5, W + 10, 1)
    ctx.fillRect(RAIL - 5, RAIL - 5, 1, H + 10)
    // pano com trama
    ctx.fillStyle = T.felt
    ctx.fillRect(RAIL, RAIL, W, H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0
        if (h % 23 === 0) {
          ctx.fillStyle = T.feltDark
          ctx.fillRect(RAIL + x, RAIL + y, 1, 1)
        } else if (h % 61 === 0) {
          ctx.fillStyle = T.feltLight
          ctx.fillRect(RAIL + x, RAIL + y, 1, 1)
        }
      }
    // sombra das tabelas no pano
    ctx.fillStyle = T.feltShade
    ctx.fillRect(RAIL, RAIL, W, 2)
    ctx.fillRect(RAIL, RAIL, 2, H)
    // linha de saída e marca do fundo
    ctx.fillStyle = T.line
    for (let y = 0; y < H; y += 4) ctx.fillRect(cx(HEAD_X), RAIL + y, 1, 2)
    ctx.fillRect(cx(75) - 1, cy(25) - 1, 2, 2)
    ctx.fillRect(cx(HEAD_X) - 1, cy(25) - 1, 3, 2)
    // marcas (diamantes) nas madeiras
    ctx.fillStyle = T.diamond
    for (let k = 1; k < 8; k++) if (k !== 4) for (const y of [4, CANVAS_H - 6]) ctx.fillRect(RAIL + (k * W) / 8 - 1, y, 2, 2)
    for (let k = 1; k < 4; k++) for (const x of [4, CANVAS_W - 6]) ctx.fillRect(x, RAIL + (k * H) / 4 - 1, 2, 2)
    // caçapas: aro de couro, boca escura, fundo
    for (const p of POCKETS) {
      const x = Math.round(cx(p.x))
      const y = Math.round(cy(p.y))
      const r = p.r * PX * 0.95
      disc(ctx, x, y, r + 2, T.leather)
      disc(ctx, x, y, r, T.pocket)
      disc(ctx, x + 1, y + 1, r - 2, T.pocketDeep)
    }
    return c
  }

  private makeShadow(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = BALL_PX
    c.height = BALL_PX
    const g = c.getContext('2d') as CanvasRenderingContext2D
    g.fillStyle = 'rgba(8, 20, 13, 0.42)'
    for (const p of PIXELS) g.fillRect(p.ox, p.oy, 1, 1)
    return c
  }

  private paintBall(target: CanvasRenderingContext2D, id: number, x0: number, y0: number): void {
    const m = this.orient.get(id) as Mat3
    for (const p of PIXELS) {
      target.fillStyle = pixelColor(id, m, p)
      target.fillRect(x0 + p.ox, y0 + p.oy, 1, 1)
    }
  }

  private drawBall(b: { id: number; x: number; y: number }, alpha = 1, shadow = true): void {
    const x0 = Math.round(cx(b.x) - BALL_PX / 2)
    const y0 = Math.round(cy(b.y) - BALL_PX / 2)
    const ctx = this.ctx
    ctx.globalAlpha = alpha
    if (shadow) ctx.drawImage(this.shadow, x0 + 1, y0 + 2)
    if (alpha === 1) this.paintBall(ctx, b.id, x0, y0)
    else {
      const g = this.ballCanvas.getContext('2d') as CanvasRenderingContext2D
      g.clearRect(0, 0, BALL_PX, BALL_PX)
      this.paintBall(g, b.id, 0, 0)
      ctx.drawImage(this.ballCanvas, x0, y0)
    }
    ctx.globalAlpha = 1
  }

  /** bola caindo: encolhe indo para o fundo da caçapa */
  private drawFall(f: Fall, now: number): boolean {
    const t = (now - f.t0) / FALL_MS
    if (t >= 1) return false
    const e = t * t
    const x = f.x + (f.px - f.x) * e
    const y = f.y + (f.py - f.y) * e
    const k = 1 - 0.55 * e
    const g = this.ballCanvas.getContext('2d') as CanvasRenderingContext2D
    g.clearRect(0, 0, BALL_PX, BALL_PX)
    this.paintBall(g, f.id, 0, 0)
    const s = Math.max(2, Math.round(BALL_PX * k))
    this.ctx.globalAlpha = 1 - 0.6 * e
    this.ctx.drawImage(this.ballCanvas, Math.round(cx(x) - s / 2), Math.round(cy(y) - s / 2), s, s)
    this.ctx.globalAlpha = 1
    return true
  }

  /** linha de pixels (Bresenham), com tracejado opcional */
  private line(x0: number, y0: number, x1: number, y1: number, color: string, dash = 0): void {
    const ctx = this.ctx
    ctx.fillStyle = color
    let x = Math.round(x0)
    let y = Math.round(y0)
    const xe = Math.round(x1)
    const ye = Math.round(y1)
    const dx = Math.abs(xe - x)
    const dy = -Math.abs(ye - y)
    const sx = x < xe ? 1 : -1
    const sy = y < ye ? 1 : -1
    let err = dx + dy
    for (let i = 0; i < 2000; i++) {
      if (!dash || Math.floor(i / dash) % 2 === 0) ctx.fillRect(x, y, 1, 1)
      if (x === xe && y === ye) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  /** contorno de bola (bola fantasma) */
  private ring(x: number, y: number, color: string): void {
    const x0 = Math.round(cx(x) - BALL_PX / 2)
    const y0 = Math.round(cy(y) - BALL_PX / 2)
    this.ctx.fillStyle = color
    for (const p of PIXELS) if (p.edge) this.ctx.fillRect(x0 + p.ox, y0 + p.oy, 1, 1)
  }

  private drawPocketMark(k: number, color: string): void {
    const p = POCKETS[k]
    const ctx = this.ctx
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(Math.round(cx(p.x)), Math.round(cy(p.y)), p.r * PX * 0.95 + 3, 0, Math.PI * 2)
    ctx.stroke()
  }

  /** taco atrás da branca, puxado `pull` pixels */
  private drawStick(x: number, y: number, ux: number, uy: number, pull: number, alpha = 1): void {
    const sx = cx(x) - ux * (BALL_PX / 2 + pull)
    const sy = cy(y) - uy * (BALL_PX / 2 + pull)
    const ex = sx - ux * 96
    const ey = sy - uy * 96
    this.ctx.globalAlpha = alpha
    // sombra do taco no pano
    this.line(sx + 2, sy + 3, ex + 2, ey + 3, 'rgba(8, 20, 13, 0.35)')
    for (const o of [-1, 0, 1]) this.line(sx + -uy * o * 0.6, sy + ux * o * 0.6, ex + -uy * o * 1.2, ey + ux * o * 1.2, o === 0 ? '#D9B27C' : '#8A5E44')
    // ponteira azul e anel do cabo
    this.line(sx, sy, sx - ux * 3, sy - uy * 3, '#6FA3C7')
    this.line(sx - ux * 4, sy - uy * 4, sx - ux * 5, sy - uy * 5, '#F3EBDD')
    this.line(sx - ux * 62, sy - uy * 62, ex, ey, '#4E3426')
    this.ctx.globalAlpha = 1
  }

  /** linha de mira a partir da branca em `cue` */
  private drawGuide(balls: PBall[], cue: { x: number; y: number }, ux: number, uy: number, spin: Spin, power: number, faint: boolean): number | null {
    const g = aimGuide(balls, ux, uy, spin, power || 0.4)
    if (!g) return null
    const a = faint ? 0.45 : 0.8
    this.line(cx(cue.x), cy(cue.y), cx(g.ghost.x), cy(g.ghost.y), `rgba(243,235,221,${a})`, 3)
    if (g.hit !== null) {
      this.ring(g.ghost.x, g.ghost.y, `rgba(243,235,221,${a})`)
      const target = balls.find((b) => b.id === g.hit) as PBall
      if (g.object) this.line(cx(target.x), cy(target.y), cx(target.x + g.object.x * 14), cy(target.y + g.object.y * 14), faint ? 'rgba(255,201,74,0.6)' : '#FFC94A', 2)
      if (g.cue) this.line(cx(g.ghost.x), cy(g.ghost.y), cx(g.ghost.x + g.cue.x * 7), cy(g.ghost.y + g.cue.y * 7), `rgba(243,235,221,${a * 0.65})`, 1)
      return g.hit === 8 && g.object ? bestPocket(target, g.object) : null
    }
    if (g.bounce) {
      this.line(cx(g.ghost.x), cy(g.ghost.y), cx(g.bounce.x), cy(g.bounce.y), `rgba(243,235,221,${a * 0.5})`, 2)
      if (g.bounce.hit !== null) this.ring(g.bounce.x, g.bounce.y, `rgba(243,235,221,${a * 0.5})`)
    }
    return null
  }

  private drawAim(now: number): void {
    const v = this.props?.view
    const cue = this.cue()
    if (!v || !cue) return
    const balls = this.placed ? this.balls.map((b) => (b.id === 0 ? { ...b, ...this.placed } : b)) : this.balls
    const power = this.power(now)
    const suggest = this.drawGuide(balls, cue, this.aim.x, this.aim.y, this.props!.spin, power, false)
    // na 8 sem caçapa escolhida: sugere a que está na direção da bola
    if (v.onEight && !this.pocketLocked && suggest !== null && suggest !== this.pocket) {
      this.pocket = suggest
      this.emitAim()
    }
    if (v.onEight && this.pocket !== null) this.drawPocketMark(this.pocket, '#FFC94A')
    this.drawStick(cue.x, cue.y, this.aim.x, this.aim.y, 3 + power * 16)
    if (power > 0) this.drawPower(power)
  }

  /** mira de quem está jogando (vista por quem espera) */
  private drawRemote(): void {
    const v = this.props?.view
    const r = this.remote
    if (!v || !r || this.anim) return
    const base = this.balls.find((b) => b.id === 0 && !b.in)
    if (r.mode === 'place') {
      this.drawBall({ id: 0, x: r.x, y: r.y }, 0.6)
      return
    }
    const s = this.remoteShown
    if (!base || !s) return
    const cue = r.cue ?? base
    const balls = r.cue ? this.balls.map((b) => (b.id === 0 ? { ...b, ...r.cue } : b)) : this.balls
    if (r.cue) this.drawBall({ id: 0, ...r.cue })
    this.drawGuide(balls, cue, s.x, s.y, r.spin, s.power, true)
    if (v.onEight && r.pocket !== null) this.drawPocketMark(r.pocket, 'rgba(255,201,74,0.6)')
    this.drawStick(cue.x, cue.y, s.x, s.y, 3 + s.power * 16, 0.85)
    if (s.power > 0.02) this.drawPower(s.power)
  }

  private drawPower(p: number): void {
    const w = 80
    const ctx = this.ctx
    ctx.fillStyle = '#0F0B09'
    ctx.fillRect(CANVAS_W / 2 - w / 2 - 1, CANVAS_H - 9, w + 2, 6)
    ctx.fillStyle = p > 0.85 ? '#E05A4A' : '#FFC94A'
    ctx.fillRect(CANVAS_W / 2 - w / 2, CANVAS_H - 8, Math.round(w * p), 4)
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop)
    const a = this.anim
    if (a) {
      if (now - a.strikeAt >= STRIKE_MS) {
        if (!a.struck) {
          a.struck = true
          strike(a.balls, a.cue.dx, a.cue.dy, a.cue.power, a.cue.spin)
          a.last = now
        }
        a.acc += Math.min(100, now - a.last) * (HZ / 1000)
        a.last = now
        let moving = true
        const before = new Map(a.balls.map((b) => [b.id, { x: b.x, y: b.y }]))
        while (a.acc >= 1 && moving) {
          a.acc -= 1
          moving = step(a.balls, a.log) && a.log.steps < MAX_STEPS
        }
        for (const b of a.balls) {
          const o = before.get(b.id)
          if (!o || b.in) continue
          this.orient.set(b.id, roll(this.orient.get(b.id) as Mat3, b.x - o.x, b.y - o.y))
        }
        if (a.log.pocketed.length > a.pocketed) {
          for (const pk of a.log.pocketed.slice(a.pocketed)) {
            const b = a.balls.find((x) => x.id === pk.id) as PBall
            const p = POCKETS[pk.pocket]
            this.falls.push({ id: pk.id, x: b.x, y: b.y, px: p.x, py: p.y, t0: now })
          }
          a.pocketed = a.log.pocketed.length
          this.props?.onSfx?.('cup')
        }
        this.balls = a.balls
        if (!moving) {
          // fim da animação: vale o que o servidor mandou
          this.anim = null
          this.balls = cloneBalls(this.props?.view.balls ?? a.balls)
          this.emitAim()
        }
      }
      this.dirty = true
    }
    if (this.charge !== null || this.falls.length) this.dirty = true
    // a mira de quem joga desliza até a posição nova
    const r = this.remote
    const s = this.remoteShown
    if (r && s && r.mode === 'aim') {
      const nx = s.x + (r.x - s.x) * 0.35
      const ny = s.y + (r.y - s.y) * 0.35
      const l = Math.hypot(nx, ny) || 1
      const np = s.power + (r.power - s.power) * 0.35
      if (Math.abs(nx / l - s.x) + Math.abs(ny / l - s.y) + Math.abs(np - s.power) > 1e-4) {
        this.remoteShown = { x: nx / l, y: ny / l, power: np }
        this.dirty = true
      }
    }
    if (!this.dirty) return
    this.dirty = false
    this.draw(now)
  }

  private draw(now: number): void {
    const ctx = this.ctx
    ctx.drawImage(this.table, 0, 0)
    const v = this.props?.view
    const mine = this.canAct() && !!v
    const placingHere = mine && this.placing && this.mouse
    const remotePlacing = !mine && this.remote && !this.anim && (this.remote.mode === 'place' || this.remote.cue)
    this.falls = this.falls.filter((f) => this.drawFall(f, now))
    for (const b of this.balls) {
      if (b.in) continue
      if (b.id === 0 && (placingHere || this.placed || remotePlacing)) continue
      this.drawBall(b)
    }
    const a = this.anim
    if (a && now - a.strikeAt < STRIKE_MS) {
      // o taco avançando até a bola
      const t = (now - a.strikeAt) / STRIKE_MS
      const l = Math.hypot(a.cue.dx, a.cue.dy) || 1
      this.drawStick(a.cue.x, a.cue.y, a.cue.dx / l, a.cue.dy / l, (3 + a.cue.power * 16) * (1 - t * t))
    }
    if (mine) {
      if (placingHere && this.mouse) {
        const ok = this.validSpot(this.mouse.x, this.mouse.y)
        this.drawBall({ id: 0, x: this.mouse.x, y: this.mouse.y }, ok ? 0.9 : 0.35)
        if (!ok) this.line(cx(this.mouse.x) - 3, cy(this.mouse.y) - 3, cx(this.mouse.x) + 3, cy(this.mouse.y) + 3, '#E05A4A')
      } else if (!this.placing) {
        if (this.placed) this.drawBall({ id: 0, ...this.placed })
        this.drawAim(now)
      }
    } else this.drawRemote()
  }
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2)
  ctx.fill()
}

/** caçapa na direção em que a bola vai */
function bestPocket(b: { x: number; y: number }, dir: { x: number; y: number }): number {
  let best = 0
  let bd = -Infinity
  POCKETS.forEach((p, k) => {
    const dx = p.x - b.x
    const dy = p.y - b.y
    const d = (dx * dir.x + dy * dir.y) / (Math.hypot(dx, dy) || 1)
    if (d > bd) {
      bd = d
      best = k
    }
  })
  return best
}
