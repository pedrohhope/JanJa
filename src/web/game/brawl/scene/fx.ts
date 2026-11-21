/**
 * Partículas da Briga na Sala em um canvas 2D 480x270 (pixel inteiro, sem Pixi): fagulhas, confete do nocaute,
 * poeira, anéis, rastro de voo e arcos de golpe. Só visual: usa seu próprio sorteador, nunca o do jogo.
 */
export type Kind = 'spark' | 'confetti' | 'dust' | 'ring' | 'ghost' | 'slash' | 'star' | 'glow'

export interface Particle {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: string
  /** extras: ring = raio final, slash = ângulo, ghost = faces */
  a: number
  b: number
}

export function visualRng(seed = 1): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const MAX_PARTICLES = 600

export class BrawlFx {
  list: Particle[] = []
  rnd = visualRng(11)
  /** "reduzir movimento": metade das partículas e nada de arco/rastro */
  reduced = false

  add(p: Partial<Particle> & Pick<Particle, 'kind' | 'life' | 'color' | 'size'>): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift()
    this.list.push({ x: 0, y: 0, vx: 0, vy: 0, age: 0, a: 0, b: 0, ...p })
  }
  clear(): void {
    this.list.length = 0
  }

  /** fagulha do acerto: o tamanho vem da força 0..3 */
  hitSpark(x: number, y: number, strength: number, dirx: number, diry: number): void {
    const n = Math.round((3 + strength * 3) * (this.reduced ? 0.5 : 1))
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(diry, dirx) + (this.rnd() - 0.5) * 2.4
      const sp = 40 + this.rnd() * (60 + strength * 40)
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.18 + this.rnd() * 0.16, color: this.rnd() < 0.5 ? '#FFE9A6' : '#FFFFFF', size: strength >= 2 && this.rnd() < 0.4 ? 2 : 1 })
    }
    this.add({ kind: 'star', x, y, life: 0.09 + strength * 0.03, color: '#FFFFFF', size: 3 + strength * 2 })
    if (strength >= 2) this.add({ kind: 'ring', x, y, life: 0.22, color: '#F3EBDD', size: 1, a: 10 + strength * 6 })
  }

  /** nocaute: confete pixel na borda, na cor de quem caiu */
  confetti(x: number, y: number, color: string, nx: number, ny: number): void {
    const n = this.reduced ? 18 : 46
    const pal = [color, '#FFFFFF', '#FFC94A', color, '#F3EBDD']
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + (this.rnd() - 0.5) * 1.9
      const sp = 50 + this.rnd() * 190
      this.add({ kind: 'confetti', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7 + this.rnd() * 0.7, color: pal[i % pal.length]!, size: this.rnd() < 0.35 ? 2 : 1, a: this.rnd() * 6 })
    }
    this.add({ kind: 'ring', x, y, life: 0.4, color, size: 1, a: 34 })
    this.add({ kind: 'ring', x, y, life: 0.5, color: '#FFFFFF', size: 1, a: 20 })
  }

  dust(x: number, y: number, n: number, dir = 0): void {
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1
      this.add({ kind: 'dust', x: x + side * (1 + this.rnd() * 3), y: y - 1, vx: side * (12 + this.rnd() * 22) + dir * 10, vy: -(4 + this.rnd() * 14), life: 0.25 + this.rnd() * 0.2, color: '#B7A99A', size: this.rnd() < 0.3 ? 2 : 1 })
    }
  }

  ring(x: number, y: number, r: number, color: string, life = 0.28): void {
    this.add({ kind: 'ring', x, y, life, color, size: 1, a: r })
  }

  /** arco do golpe: `a` é o ângulo central (rad), `size` o raio */
  slash(x: number, y: number, ang: number, size: number, color: string): void {
    if (this.reduced) return
    this.add({ kind: 'slash', x, y, life: 0.12, color, size, a: ang })
  }

  /** imagem residual de quem voa forte */
  ghost(x: number, y: number, color: string): void {
    if (this.reduced) return
    this.add({ kind: 'ghost', x, y, life: 0.22, color, size: 1 })
  }

  glow(x: number, y: number, color: string, life = 0.5): void {
    this.add({ kind: 'glow', x, y, life, color, size: 1 })
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.age += dt
      if (p.kind === 'spark' || p.kind === 'confetti' || p.kind === 'dust') {
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.kind === 'confetti') p.vy += 260 * dt
        else if (p.kind === 'dust') p.vy += 20 * dt
        else p.vy += 90 * dt
        p.vx *= p.kind === 'dust' ? 0.9 : 0.985
      }
    }
    this.list = this.list.filter((p) => p.age < p.life)
  }

  draw(ctx: CanvasRenderingContext2D, ox = 0, oy = 0): void {
    for (const p of this.list) {
      const k = p.age / p.life
      const x = Math.round(p.x + ox)
      const y = Math.round(p.y + oy)
      ctx.fillStyle = p.color
      switch (p.kind) {
        case 'spark':
        case 'dust':
          ctx.globalAlpha = p.kind === 'dust' ? 1 - k : 1
          ctx.fillRect(x, y, p.size, p.size)
          break
        case 'confetti': {
          // pisca entre 1 e 2 px de altura, como confete girando
          const h = Math.floor(p.age * 14 + p.a) % 3 === 0 ? p.size + 1 : p.size
          ctx.globalAlpha = k > 0.75 ? (Math.floor(p.age * 40) % 2 ? 1 : 0.3) : 1
          ctx.fillRect(x, y, p.size + 1, h)
          break
        }
        case 'star': {
          const r = Math.round(p.size * (1 - k * 0.5))
          ctx.globalAlpha = 1
          ctx.fillRect(x - r, y, r * 2 + 1, 1)
          ctx.fillRect(x, y - r, 1, r * 2 + 1)
          ctx.fillRect(x - 1, y - 1, 3, 3)
          break
        }
        case 'ring': {
          const r = Math.max(1, Math.round(p.a * Math.sqrt(k)))
          ctx.globalAlpha = 1 - k
          const steps = Math.max(10, Math.round(r * 2.4))
          for (let i = 0; i < steps; i++) {
            const a = (i / steps) * Math.PI * 2
            ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.9), 1, 1)
          }
          break
        }
        case 'slash': {
          ctx.globalAlpha = 1 - k
          const r = p.size
          for (let i = -6; i <= 6; i++) {
            const a = p.a + i * 0.16
            const rr = r - Math.abs(i) * 0.25 + k * 2
            ctx.fillRect(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr), 1 + (Math.abs(i) < 3 ? 1 : 0), 1)
          }
          break
        }
        case 'ghost':
          ctx.globalAlpha = (1 - k) * 0.5
          ctx.fillRect(x - 6, y - 22, 12, 22)
          break
        case 'glow': {
          ctx.globalAlpha = (1 - k) * 0.8
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2
            ctx.fillRect(Math.round(x + Math.cos(a) * (4 + k * 8)), Math.round(y + Math.sin(a) * (4 + k * 8)), 1, 1)
          }
          break
        }
      }
    }
    ctx.globalAlpha = 1
  }
}
