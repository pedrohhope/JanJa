/**
 * Cena da Corrida na Sala em canvas 2D (sem biblioteca): a pista pré-desenhada num canvas, marcas de
 * pneu, poeira e fumaça, os carrinhos girados em 32 direções, nomes e o mapa pequeno. A câmera segue
 * o seu carro com zoom inteiro (pixel nítido); quem só assiste vê a pista inteira.
 */
import { BTN_BRAKE, type Car, type RaceSimEvent, type RaceSimState, type TrackId } from '../../../../shared/games/race/types'
import { TRACKS, tileAt, type Track } from '../../../../shared/games/race/tracks'
import type { RaceFrame } from '../contract'
import { CAR_BOX, carSprites, dirIndex, miniCanvas, shade, THEMES, trackCanvas } from './art'

export interface RaceRenderOpts {
  /** nome curto por slot */
  names: Record<number, string>
  /** cor por slot (#rrggbb) */
  colors: Record<number, string>
  reducedMotion: boolean
}

export interface RaceSceneSource {
  frame(): RaceFrame | null
  onEvents(cb: (events: RaceSimEvent[]) => void): () => void
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
}

const FALLBACK = '#B7A99A'
const LABEL_FONT = "'Pixelify Sans Variable', 'Pixelify Sans', monospace"

export class RaceEngine {
  private cv = document.createElement('canvas')
  private ctx = this.cv.getContext('2d')!
  private raf = 0
  private dead = false
  private trackId: TrackId | null = null
  private track: Track | null = null
  private trackCv: HTMLCanvasElement | null = null
  private miniCv: HTMLCanvasElement | null = null
  private skid: HTMLCanvasElement | null = null
  private skidCtx: CanvasRenderingContext2D | null = null
  private cam = { x: 0, y: 0, ready: false }
  private parts: Particle[] = []
  private last: RaceFrame | null = null
  private lastAt = 0
  private offEvents: (() => void) | null = null
  private dpr = 1

  constructor(
    private host: HTMLElement,
    private source: RaceSceneSource,
    private opts: () => RaceRenderOpts
  ) {
    this.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated'
    host.appendChild(this.cv)
    this.offEvents = source.onEvents((evs) => this.onEvents(evs))
    const loop = (t: number) => {
      if (this.dead) return
      this.raf = requestAnimationFrame(loop)
      this.draw(t)
    }
    this.raf = requestAnimationFrame(loop)
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.cv.width = Math.max(1, Math.floor(w * this.dpr))
    this.cv.height = Math.max(1, Math.floor(h * this.dpr))
  }

  destroy(): void {
    this.dead = true
    cancelAnimationFrame(this.raf)
    this.offEvents?.()
    this.cv.remove()
  }

  // ---------- efeitos ----------

  private puff(x: number, y: number, n: number, color: string, speed: number, life: number, size = 1): void {
    if (this.opts().reducedMotion) n = Math.ceil(n / 3)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const v = speed * (0.4 + Math.random() * 0.6)
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size })
    }
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400)
  }

  private onEvents(evs: RaceSimEvent[]): void {
    const st = this.last?.state
    if (!st) return
    const car = (slot: number) => st.cars.find((c) => c.slot === slot)
    for (const e of evs) {
      if (e.type === 'batida') {
        const c = car(e.slot)
        if (c) this.puff(c.x + c.hx * 6, c.y + c.hy * 6, 5 + e.force * 3, '#D9CFC3', 0.5 + e.force * 0.25, 30)
      } else if (e.type === 'toque') {
        const a = car(e.a)
        const b = car(e.b)
        if (a && b) this.puff((a.x + b.x) / 2, (a.y + b.y) / 2, 6, '#FFE7A3', 0.9, 14)
      } else if (e.type === 'turbo') {
        const c = car(e.slot)
        if (c) this.puff(c.x - c.hx * 6, c.y - c.hy * 6, 8, '#FFC94A', 0.8, 18)
      } else if (e.type === 'chegada') {
        const c = car(e.slot)
        if (c) for (const col of ['#FFC94A', '#F3EBDD', '#C24B3A', '#3F7CB0']) this.puff(c.x, c.y, 6, col, 1.4, 50)
      }
    }
  }

  // ---------- desenho ----------

  private ensureTrack(id: TrackId): void {
    if (this.trackId === id) return
    this.trackId = id
    this.track = TRACKS[id]
    this.trackCv = trackCanvas(this.track)
    this.miniCv = miniCanvas(this.track)
    this.skid = document.createElement('canvas')
    this.skid.width = this.track.pw
    this.skid.height = this.track.ph
    this.skidCtx = this.skid.getContext('2d')!
    this.cam.ready = false
  }

  private stampSkids(st: RaceSimState, dt: number): void {
    const sk = this.skidCtx
    const t = this.track
    if (!sk || !t || dt <= 0) return
    for (const c of st.cars) {
      if (c.away) continue
      const sp = Math.hypot(c.vx, c.vy)
      const fwd = c.vx * c.hx + c.vy * c.hy
      const slip = Math.abs(c.vx * -c.hy + c.vy * c.hx)
      const braking = (c.buttons & BTN_BRAKE) !== 0 && fwd > 1.4
      const surf = tileAt(t, c.x, c.y)
      if (surf === ',' && sp > 1) {
        if (Math.random() < 0.35 * dt * 60) this.puff(c.x - c.hx * 6, c.y - c.hy * 6, 1, THEMES[t.id].verge[1], 0.3, 22, 2)
      }
      if (slip < 0.55 && !braking) continue
      sk.fillStyle = surf === ',' ? 'rgba(30,20,14,0.10)' : 'rgba(20,14,12,0.20)'
      for (const side of [-3, 3]) {
        const x = Math.round(c.x - c.hx * 4 - c.hy * side)
        const y = Math.round(c.y - c.hy * 4 + c.hx * side)
        sk.fillRect(x, y, 1, 1)
      }
    }
  }

  private draw(t: number): void {
    const ctx = this.ctx
    const W = this.cv.width
    const H = this.cv.height
    const f = this.source.frame()
    const dt = this.lastAt ? Math.min(0.1, (t - this.lastAt) / 1000) : 0
    this.lastAt = t
    if (!f) {
      ctx.fillStyle = '#221C19'
      ctx.fillRect(0, 0, W, H)
      return
    }
    this.last = f
    const st = f.state
    this.ensureTrack(st.trackId)
    const tr = this.track!
    const opts = this.opts()
    const me = f.me !== null ? st.cars.find((c) => c.slot === f.me && !c.away) : undefined
    const follow = !!me && st.phase !== 'fim'

    // câmera
    let z: number
    if (follow) {
      z = Math.max(2, Math.min(6, Math.floor(Math.min(W / 400, H / 250))))
      const lead = opts.reducedMotion ? 0 : 16
      const tx = me!.x + me!.vx * lead
      const ty = me!.y + me!.vy * lead
      if (!this.cam.ready) {
        this.cam.x = tx
        this.cam.y = ty
        this.cam.ready = true
      } else {
        const k = 1 - Math.pow(0.002, dt)
        this.cam.x += (tx - this.cam.x) * k
        this.cam.y += (ty - this.cam.y) * k
      }
    } else {
      z = Math.min(W / tr.pw, H / tr.ph) * 0.97
      this.cam.x = tr.pw / 2
      this.cam.y = tr.ph / 2
      this.cam.ready = false
    }
    const vw = W / z
    const vh = H / z
    let cx = this.cam.x
    let cy = this.cam.y
    if (follow) {
      cx = vw >= tr.pw ? tr.pw / 2 : Math.max(vw / 2, Math.min(tr.pw - vw / 2, cx))
      cy = vh >= tr.ph ? tr.ph / 2 : Math.max(vh / 2, Math.min(tr.ph - vh / 2, cy))
    }
    const ox = Math.round(W / 2 - cx * z)
    const oy = Math.round(H / 2 - cy * z)
    const sx = (x: number) => ox + x * z
    const sy = (y: number) => oy + y * z

    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = THEMES[tr.id].floor[1]
    ctx.fillRect(0, 0, W, H)
    ctx.drawImage(this.trackCv!, ox, oy, tr.pw * z, tr.ph * z)
    this.stampSkids(st, dt)
    ctx.drawImage(this.skid!, ox, oy, tr.pw * z, tr.ph * z)

    // poeira e fumaça (embaixo dos carros)
    const alive: Particle[] = []
    for (const p of this.parts) {
      p.life -= dt * 60
      if (p.life <= 0) continue
      p.x += p.vx * dt * 60
      p.y += p.vy * dt * 60
      p.vx *= 0.92
      p.vy *= 0.92
      alive.push(p)
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max))
      ctx.fillStyle = p.color
      const s = Math.max(1, Math.round(p.size * z))
      ctx.fillRect(Math.round(sx(p.x) - s / 2), Math.round(sy(p.y) - s / 2), s, s)
    }
    ctx.globalAlpha = 1
    this.parts = alive

    // carros (de cima para baixo, para o de baixo ficar na frente)
    const cars = [...st.cars].sort((a, b) => a.y - b.y)
    const half = (CAR_BOX / 2) * z
    for (const c of cars) {
      const col = opts.colors[c.slot] ?? FALLBACK
      const spr = carSprites(col)
      const d = dirIndex(c.hx, c.hy)
      const fwd = c.vx * c.hx + c.vy * c.hy
      const braking = (c.buttons & BTN_BRAKE) !== 0 && fwd > -0.1 ? 1 : 0
      const x = Math.round(sx(c.x) - half)
      const y = Math.round(sy(c.y) - half)
      ctx.globalAlpha = c.away ? 0.35 : 1
      ctx.drawImage(spr.shadow[d]!, x + z, y + 2 * z, CAR_BOX * z, CAR_BOX * z)
      if (c.boostUntil > st.tick && !c.away) {
        // chama do turbo atrás do carro
        const fl = opts.reducedMotion ? 0.5 : Math.random()
        for (let k = 0; k < 3; k++) {
          const bx = c.x - c.hx * (8 + k * 2 + fl * 2)
          const by = c.y - c.hy * (8 + k * 2 + fl * 2)
          ctx.fillStyle = k === 0 ? '#FFE7A3' : k === 1 ? '#FFC94A' : '#C24B3A'
          ctx.fillRect(Math.round(sx(bx) - z), Math.round(sy(by) - z), 2 * z, 2 * z)
        }
      }
      ctx.drawImage(spr.frames[braking]![d]!, x, y, CAR_BOX * z, CAR_BOX * z)
      ctx.globalAlpha = 1
    }

    // nomes (na resolução da tela, para o texto ficar nítido)
    const fs = Math.round(11 * this.dpr)
    ctx.font = `600 ${fs}px ${LABEL_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2, Math.round(3 * this.dpr))
    for (const c of cars) {
      if (c.away) continue
      const mine = me && c.slot === me.slot
      const name = mine ? 'Você' : opts.names[c.slot] ?? ''
      if (!name) continue
      const lx = Math.round(sx(c.x))
      const ly = Math.round(sy(c.y) - 9 * z)
      ctx.strokeStyle = '#221C19'
      ctx.strokeText(name, lx, ly)
      ctx.fillStyle = mine ? '#FFC94A' : shade(opts.colors[c.slot] ?? FALLBACK, 0.45)
      ctx.fillText(name, lx, ly)
      if (mine) {
        const a = Math.round(3 * this.dpr)
        ctx.beginPath()
        ctx.moveTo(lx - a, ly + 1)
        ctx.lineTo(lx + a, ly + 1)
        ctx.lineTo(lx, ly + a + 2)
        ctx.closePath()
        ctx.fill()
      }
    }

    if (follow) this.drawMini(st, me!, opts)
    this.host.setAttribute('data-scene-ready', '1')
  }

  private drawMini(st: RaceSimState, me: Car, opts: RaceRenderOpts): void {
    const ctx = this.ctx
    const tr = this.track!
    const tw = this.miniCv!.width
    const th = this.miniCv!.height
    const k = Math.max(2, Math.floor(Math.min(this.cv.width * 0.2, 180 * this.dpr) / tw))
    const w = tw * k
    const h = th * k
    const pad = Math.round(8 * this.dpr)
    const x0 = this.cv.width - w - pad
    const y0 = pad
    ctx.globalAlpha = 0.82
    ctx.fillStyle = '#221C19'
    ctx.fillRect(x0 - 4, y0 - 4, w + 8, h + 8)
    ctx.globalAlpha = 1
    ctx.drawImage(this.miniCv!, x0, y0, w, h)
    const s = Math.max(3, Math.round(k * 1.6))
    const order = [...st.cars].sort((a, b) => Number(a.slot === me.slot) - Number(b.slot === me.slot))
    for (const c of order) {
      if (c.away) continue
      const px = Math.round(x0 + (c.x / tr.pw) * w - s / 2)
      const py = Math.round(y0 + (c.y / tr.ph) * h - s / 2)
      if (c.slot === me.slot) {
        ctx.fillStyle = '#F3EBDD'
        ctx.fillRect(px - 1, py - 1, s + 2, s + 2)
      }
      ctx.fillStyle = opts.colors[c.slot] ?? FALLBACK
      ctx.fillRect(px, py, s, s)
    }
  }
}
