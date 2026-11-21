// O primeiro import do Pixi precisa ser este (o CSP do site proíbe eval).
import 'pixi.js/unsafe-eval'
import '@fontsource-variable/pixelify-sans/wght.css'
import { Application, Assets, CanvasSource, Container, Graphics, Sprite, Texture, TextureSource } from 'pixi.js'
import {
  ARENA_H,
  ARENA_W,
  COUNTDOWN_TICKS,
  TICK_HZ,
  type BrawlSimEvent,
  type BrawlSimState,
  type Fighter,
  type Held,
  type WeaponId
} from '../../../../shared/games/brawl/types'
import { pickAnim, parseMove, defaultTiming, type Pick } from './animate'
import { buildSet, type AnimName } from './anims'
import { buildArena, elemBuf, type AnimElem, type ArenaArt, type Env } from './arenaArt'
import type { BrawlRenderOpts, BrawlSceneSource } from './contract'
import { BrawlFx } from './fx'
import { AX, FH, FW, type Rows } from './grid'
import { ARENA_PLATFORMS } from './geometry'
import { ITEM_PIVOT, PROJECTILE_ART, puddleRows, weaponRows } from './items'
import { BPAL, FALLBACK_COLORS, hexNum, legibleTint } from './palette'
import { labelTexture } from './pxText'
import type { Buf } from './raster'

const SPIN_Y = 14 // centro de giro acima dos pés
const NAME_Y = 40

const rowsCanvas = (rows: Rows, pal: Record<string, string>): HTMLCanvasElement => {
  const cv = document.createElement('canvas')
  cv.width = rows[0]!.length
  cv.height = rows.length
  const ctx = cv.getContext('2d')!
  rows.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      const c = pal[ch]
      if (ch === '.' || !c) return
      ctx.fillStyle = c
      ctx.fillRect(x, y, 1, 1)
    })
  )
  return cv
}
const canvasTexture = (cv: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: cv, scaleMode: 'nearest' }) })

const BODY_PAL: Record<string, string> = (() => {
  const p = { ...BPAL }
  delete p.t
  delete p.T
  return p
})()
const OUTLINE_PAL: Record<string, string> = { t: '#FFFFFF' }
const FLASH_PAL: Record<string, string> = Object.fromEntries(Object.keys(BPAL).map((k) => [k, '#FFFFFF']))

function bufTexture(b: Buf): Texture {
  const cv = document.createElement('canvas')
  cv.width = b.w
  cv.height = b.h
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(b.w, b.h)
  img.data.set(b.data)
  ctx.putImageData(img, 0, 0)
  return canvasTexture(cv)
}

interface FighterNode {
  root: Container
  flip: Container
  spin: Container
  body: Sprite
  line: Sprite
  flash: Sprite
  label: Sprite
  arrow: Sprite
  labelKey: string
  lastActionTick: number
  slashDone: number
}

interface Elem {
  el: AnimElem
  spr: Sprite
  key: number
  tex: Map<number, Texture>
}

/** Cena da Briga na Sala em Pixi: resolução interna 480x270, pixel inteiro, câmera fixa. */
export class BrawlEngine {
  private app: Application | null = null
  private dead = false
  private ready = false
  private source: BrawlSceneSource | null = null
  private scale = 1
  private hostW = 480
  private hostH = 270

  private world = new Container()
  private farSpr = new Sprite()
  private farLayer = new Container()
  private backSpr = new Sprite()
  private backLayer = new Container()
  private puddleLayer = new Container()
  private itemLayer = new Container()
  private fighterLayer = new Container()
  private projLayer = new Container()
  private fxCv = document.createElement('canvas')
  private fxCtx = this.fxCv.getContext('2d')!
  private fxSpr = new Sprite()
  private frontSpr = new Sprite()
  private frontLayer = new Container()
  private textLayer = new Container()
  private debugGfx = new Graphics()

  private art: ArenaArt | null = null
  private artTex: Texture[] = []
  private elems: Elem[] = []
  private env: Env = { reduced: false, koAge: Infinity, koSide: null }

  private nodes = new Map<number, FighterNode>()
  private itemSpr = new Map<number, Sprite>()
  private projSpr = new Map<number, Sprite>()
  private puddleSpr = new Map<number, Sprite>()
  private texCache = new Map<string, Texture>()
  private fx = new BrawlFx()

  private opts: BrawlRenderOpts | null = null
  private state: BrawlSimState | null = null
  private time = 0
  private lastKoAt = -1e9
  private shakeMs = 0
  private flashUntil = new Map<number, number>()
  private shakeUntil = new Map<number, number>()
  private koTimes = new Map<number, number[]>()
  private banner: { sprite: Sprite; until: number; key: string } | null = null
  private countSpr: Sprite | null = null
  private countKey = ''

  constructor(private host: HTMLElement) {}

  // -------------------------------------------------------------- ciclo de vida
  async init(): Promise<void> {
    TextureSource.defaultOptions.scaleMode = 'nearest'
    const app = new Application()
    let preference: 'webgl' | 'canvas' = 'webgl'
    try {
      if (localStorage.getItem('janja.debug.renderer') === 'canvas') preference = 'canvas'
    } catch {
      /* sem storage */
    }
    await app.init({ width: ARENA_W, height: ARENA_H, antialias: false, roundPixels: true, resolution: 1, autoDensity: false, background: '#221C19', preference })
    if (this.dead) return app.destroy(true, { children: true })
    this.app = app
    const cv = app.canvas
    cv.style.position = 'absolute'
    cv.style.imageRendering = 'pixelated'
    cv.style.display = 'block'
    cv.setAttribute('aria-label', 'Briga na Sala: a luta')
    this.host.appendChild(cv)
    // o CSP do site não permite worker de blob
    Assets.setPreferences({ preferWorkers: false })
    await document.fonts.load('500 11px "Pixelify Sans Variable"').catch(() => undefined)
    if (this.dead) return

    this.fxCv.width = ARENA_W
    this.fxCv.height = ARENA_H
    this.fxCtx.imageSmoothingEnabled = false
    this.fxSpr.texture = canvasTexture(this.fxCv)
    this.fighterLayer.sortableChildren = true
    this.world.addChild(this.farSpr, this.farLayer, this.backSpr, this.backLayer, this.puddleLayer, this.itemLayer, this.fighterLayer, this.projLayer, this.fxSpr, this.frontSpr, this.frontLayer, this.textLayer, this.debugGfx)
    app.stage.addChild(this.world)
    this.ready = true
    this.fit()
    app.ticker.add((t) => this.update(Math.min(50, t.deltaMS)))
    ;(this.host as HTMLElement & { __brawl?: BrawlEngine }).__brawl = this
    this.host.setAttribute('data-scene-ready', '1')
  }

  destroy(): void {
    this.dead = true
    if (this.app) {
      try {
        this.app.destroy(true, { children: true })
      } catch {
        /* já destruído */
      }
    }
  }

  setSource(s: BrawlSceneSource | null): void {
    this.source = s
  }

  resize(w: number, h: number): void {
    this.hostW = Math.max(1, w)
    this.hostH = Math.max(1, h)
    if (this.ready) this.fit()
  }

  /** ampliação inteira; em palco menor que 480x270 cai para uma fração (a arena nunca é cortada) */
  private fit(): void {
    const app = this.app
    if (!app) return
    const fit = Math.min(this.hostW / ARENA_W, this.hostH / ARENA_H)
    this.scale = fit >= 1 ? Math.floor(fit) : fit
    const cw = Math.round(ARENA_W * this.scale)
    const ch = Math.round(ARENA_H * this.scale)
    const cv = app.canvas
    cv.style.width = `${cw}px`
    cv.style.height = `${ch}px`
    cv.style.left = `${Math.floor((this.hostW - cw) / 2)}px`
    cv.style.top = `${Math.floor((this.hostH - ch) / 2)}px`
  }

  debug(): { scale: number; particles: number; fighters: number } {
    return { scale: this.scale, particles: this.fx.list.length, fighters: this.nodes.size }
  }

  // -------------------------------------------------------------- texturas
  private tex(key: string, make: () => HTMLCanvasElement): Texture {
    let t = this.texCache.get(key)
    if (!t) this.texCache.set(key, (t = canvasTexture(make())))
    return t
  }

  private frameTex(char: Fighter['char'], held: Held, anim: AnimName, frame: number, part: 'body' | 'line' | 'flash'): Texture {
    return this.tex(`${char}|${held}|${anim}|${frame}|${part}`, () => rowsCanvas(buildSet(char, held)[anim][frame]!, part === 'body' ? BODY_PAL : part === 'line' ? OUTLINE_PAL : FLASH_PAL))
  }

  private weaponTex(w: WeaponId): Texture {
    return this.tex(`item|${w}`, () => rowsCanvas(weaponRows(w), BPAL))
  }
  private projTex(kind: string, frame: number): Texture {
    const arts = (PROJECTILE_ART as Record<string, Rows[]>)[kind]
    return this.tex(`proj|${kind}|${frame}`, () => rowsCanvas(arts![frame % arts!.length]!, BPAL))
  }
  private puddleTex(w: number): Texture {
    return this.tex(`puddle|${w}`, () => rowsCanvas(puddleRows(w), BPAL))
  }

  // -------------------------------------------------------------- arena
  private loadArena(id: BrawlSimState['arenaId']): void {
    for (const e of this.elems) e.spr.destroy()
    this.elems = []
    for (const t of this.artTex) t.destroy(true)
    this.artTex = []
    const art = buildArena(id)
    this.art = art
    const mk = (b: Buf) => {
      const t = bufTexture(b)
      this.artTex.push(t)
      return t
    }
    this.farSpr.texture = mk(art.far)
    this.backSpr.texture = mk(art.back)
    this.frontSpr.texture = mk(art.front)
    const bg = '#' + art.wall.toString(16).padStart(6, '0')
    if (this.app) this.app.renderer.background.color = bg
    this.host.style.background = bg
    for (const el of art.anims) {
      const spr = new Sprite()
      const container = el.layer === 'far' ? this.farLayer : el.layer === 'back' ? this.backLayer : this.frontLayer
      container.addChild(spr)
      this.elems.push({ el, spr, key: -99999, tex: new Map() })
    }
    for (const n of this.nodes.values()) n.root.destroy({ children: true })
    this.nodes.clear()
    this.fx.clear()
  }

  private updateArena(): void {
    for (const e of this.elems) {
      const p = e.el.pos(this.time, this.env)
      if (!p) {
        e.spr.visible = false
        continue
      }
      e.spr.visible = true
      e.spr.position.set(Math.round(p.x), Math.round(p.y))
      const key = e.el.key(this.time, this.env)
      if (key !== e.key) {
        e.key = key
        let t = e.tex.get(key)
        if (!t) {
          if (e.tex.size > 48) {
            for (const old of e.tex.values()) old.destroy(true)
            e.tex.clear()
          }
          t = bufTexture(elemBuf(e.el, this.time, this.env, key))
          e.tex.set(key, t)
        }
        e.spr.texture = t
      }
    }
  }

  // -------------------------------------------------------------- eventos
  private colorOf(slot: number): string {
    const c = this.opts?.colors[slot]
    return legibleTint(c ?? FALLBACK_COLORS[slot % FALLBACK_COLORS.length]!)
  }

  private fighterAt(slot: number): Fighter | undefined {
    return this.state?.fighters.find((f) => f.slot === slot)
  }

  pushEvents(events: BrawlSimEvent[]): void {
    const red = this.opts?.reducedMotion ?? false
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const f = this.fighterAt(e.victim)
          const a = this.fighterAt(e.attacker)
          const dir = a && f ? Math.sign(f.x - a.x) || 1 : 1
          this.fx.hitSpark(e.x, e.y, e.strength, dir, -0.3)
          const ms = 50 + e.strength * 28
          this.shakeUntil.set(e.victim, this.time + ms)
          this.shakeUntil.set(e.attacker, this.time + ms)
          if (!red) this.flashUntil.set(e.victim, this.time + 70 + e.strength * 15)
          break
        }
        case 'ko': {
          const col = this.colorOf(e.victim)
          const nx = e.side === 'esquerda' ? 1 : e.side === 'direita' ? -1 : 0
          const ny = e.side === 'cima' ? 1 : e.side === 'baixo' ? -1 : 0
          const x = Math.max(2, Math.min(ARENA_W - 2, e.x))
          const y = Math.max(2, Math.min(ARENA_H - 2, e.y))
          this.fx.confetti(x, y, col, nx, ny)
          this.lastKoAt = this.time
          this.env.koSide = e.side
          if (!red) this.shakeMs = 260
          // narração: "Duplo!" se o mesmo lutador derruba de novo em até 2,5 s
          const arr = (this.koTimes.get(e.killer) ?? []).filter((t) => this.time - t < 2500)
          arr.push(this.time)
          this.koTimes.set(e.killer, arr)
          if (arr.length >= 3) this.say('Triplo!', '#FF7A6B')
          else if (arr.length === 2) this.say('Duplo!', '#FFC94A')
          else this.say('Fora!', '#F3EBDD')
          break
        }
        case 'land': {
          const f = this.fighterAt(e.slot)
          if (f) this.fx.dust(f.x, f.y, e.hard ? 8 : 4)
          break
        }
        case 'jump': {
          const f = this.fighterAt(e.slot)
          if (f) e.air ? this.fx.ring(f.x, f.y - 4, 9, '#F3EBDD', 0.22) : this.fx.dust(f.x, f.y, 3)
          break
        }
        case 'dodge': {
          const f = this.fighterAt(e.slot)
          if (f) this.fx.ring(f.x, f.y - 12, 14, this.colorOf(e.slot), 0.3)
          break
        }
        case 'drop':
          this.fx.glow(e.x, 20, '#FFE9A6', 0.7)
          break
        case 'pickup': {
          const f = this.fighterAt(e.slot)
          if (f) this.fx.hitSpark(f.x, f.y - 16, 0, 0, -1)
          break
        }
        case 'throw': {
          const f = this.fighterAt(e.slot)
          if (f) this.fx.ring(f.x, f.y - 16, 8, '#F3EBDD', 0.2)
          break
        }
        case 'respawn': {
          const f = this.fighterAt(e.slot)
          if (f) this.fx.ring(f.x, f.y - 12, 18, this.colorOf(e.slot), 0.5)
          break
        }
        case 'last-stock':
          this.say('Última vida!', '#FF7A6B')
          break
        case 'phase':
          if (e.phase === 'morte-subita') this.say('Morte súbita!', '#FF7A6B')
          if (e.phase === 'fim') this.say('Fim!', '#FFC94A')
          break
        case 'go':
          break
        default:
          break
      }
    }
  }

  /** faixa de narração do Jan, 1,6 s */
  say(text: string, color = '#F3EBDD'): void {
    if (!this.ready) return
    const key = `${text}|${color}`
    if (this.banner) this.banner.sprite.destroy()
    const sprite = new Sprite(labelTexture(text, color, 16))
    sprite.anchor.set(0.5, 0)
    sprite.position.set(ARENA_W / 2, 22)
    this.textLayer.addChild(sprite)
    this.banner = { sprite, until: this.time + 1600, key }
  }

  // -------------------------------------------------------------- quadro
  /** desenha o estado (chamado por quem tem o estado já interpolado, ou pelo `source`) */
  render(state: BrawlSimState, opts: BrawlRenderOpts): void {
    if (!this.ready) {
      this.state = state
      this.opts = opts
      return
    }
    if (!this.art || this.art.id !== state.arenaId) this.loadArena(state.arenaId)
    this.state = state
    this.opts = opts
    const red = opts.reducedMotion
    this.fx.reduced = red
    this.env.reduced = red

    // lutadores
    const seen = new Set<number>()
    for (const f of state.fighters) {
      if (f.action === 'fora' || f.action === 'eliminado' || f.away) {
        this.nodes.get(f.slot)?.root.parent && (this.nodes.get(f.slot)!.root.visible = false)
        continue
      }
      seen.add(f.slot)
      this.drawFighter(f, state, opts)
    }
    for (const [slot, n] of this.nodes) if (!seen.has(slot)) n.root.visible = false

    // armas no chão, projéteis e poças
    this.drawItems(state)
    this.drawProjectiles(state)
    this.drawPuddles(state)
    this.drawCountdown(state)
    this.drawDebug(opts)
  }

  private nodeFor(f: Fighter): FighterNode {
    let n = this.nodes.get(f.slot)
    if (n) return n
    const root = new Container()
    const flip = new Container()
    const spin = new Container()
    spin.position.set(0, -SPIN_Y)
    spin.pivot.set(0, 0)
    const body = new Sprite()
    const line = new Sprite()
    const flash = new Sprite()
    for (const s of [line, body, flash]) {
      s.position.set(-AX, -FH + SPIN_Y)
      spin.addChild(s)
    }
    flash.visible = false
    flip.addChild(spin)
    root.addChild(flip)
    const label = new Sprite()
    label.anchor.set(0.5, 1)
    const arrow = new Sprite(this.tex('arrow', () => rowsCanvas(['ooooooo', '.ooooo.', '..ooo..', '...o...'], BPAL)))
    arrow.anchor.set(0.5, 1)
    arrow.visible = false
    this.textLayer.addChild(label, arrow)
    this.fighterLayer.addChild(root)
    n = { root, flip, spin, body, line, flash, label, arrow, labelKey: '', lastActionTick: -1, slashDone: -1 }
    this.nodes.set(f.slot, n)
    return n
  }

  private drawFighter(f: Fighter, state: BrawlSimState, opts: BrawlRenderOpts): void {
    const n = this.nodeFor(f)
    const tick = state.tick
    const red = opts.reducedMotion
    const winner = state.phase === 'fim' && !!opts.winners?.includes(f.slot)
    const pick: Pick = pickAnim(f, tick, opts.moveTiming, winner)
    const set = buildSet(f.char, f.held)
    const frame = Math.min(pick.frame, set[pick.anim].length - 1)
    n.body.texture = this.frameTex(f.char, f.held, pick.anim, frame, 'body')
    n.line.texture = this.frameTex(f.char, f.held, pick.anim, frame, 'line')
    const color = this.colorOf(f.slot)
    n.line.tint = hexNum(color)

    // hit-stop visual: tremor de 1 px nos dois
    let ox = 0
    let oy = 0
    if (!red && (this.shakeUntil.get(f.slot) ?? 0) > this.time) {
      ox = tick % 2 ? 1 : -1
      oy = tick % 4 < 2 ? 0 : -1
    }
    n.root.visible = true
    n.root.position.set(Math.round(f.x) + ox, Math.round(f.y) + oy)
    n.root.zIndex = Math.round(f.y) + (f.slot === opts.youSlot ? 0.5 : 0)
    n.flip.scale.x = pick.wall !== 0 ? (pick.wall > 0 ? 1 : -1) : f.facing
    n.spin.rotation = (pick.quarter * Math.PI) / 2

    // pisca branco no acerto
    const flashing = (this.flashUntil.get(f.slot) ?? 0) > this.time
    n.flash.visible = flashing
    if (flashing) n.flash.texture = this.frameTex(f.char, f.held, pick.anim, frame, 'flash')

    // translúcido na esquiva e piscando com invulnerabilidade
    let alpha = 1
    if (pick.ghost) alpha = red ? 0.6 : tick % 4 < 2 ? 0.45 : 0.65
    else if (tick < f.invulnUntil) alpha = red ? 0.7 : tick % 6 < 3 ? 0.45 : 1
    n.root.alpha = alpha

    // brilho de carga: anel pulsando na cor do jogador
    if (pick.charge > 0 && !red && tick % 3 === 0) this.fx.glow(f.x, f.y - 14, tick % 6 === 0 ? '#FFE9A6' : color, 0.25)

    // rastro de voo forte
    if (f.action === 'atordoado' && f.damage >= 70 && Math.hypot(f.vx, f.vy) > 4.5 && tick % 2 === 0) this.fx.ghost(f.x, f.y, color)
    // poeira correndo
    if (f.action === 'correndo' && f.grounded && tick % 9 === 0) this.fx.dust(f.x - f.facing * 5, f.y, 1, -f.facing)

    // arco do golpe no primeiro tick ativo
    if (f.action === 'golpe' && f.move) {
      const m = parseMove(f.move)
      if (m) {
        const t = opts.moveTiming?.(f.move) ?? defaultTiming(m)
        if (f.moveTick === t.startup && n.slashDone !== f.actionTick + 1000 * f.moveTick) {
          n.slashDone = f.actionTick + 1000 * f.moveTick
          const dirAng = m.dir === 'cima' ? -Math.PI / 2 : m.dir === 'baixo' ? Math.PI / 2 : m.dir === 'lado' ? 0 : -0.3
          const ang = f.facing > 0 ? dirAng : Math.PI - dirAng
          this.fx.slash(f.x + f.facing * 6, f.y - 14, ang, m.heavy ? 22 : 15, m.heavy ? '#FFE9A6' : '#F3EBDD')
        }
      }
    }

    // nome e triângulo "você"
    const name = opts.names[f.slot] ?? ''
    const lk = `${name}|${color}`
    if (n.labelKey !== lk) {
      n.labelKey = lk
      n.label.texture = labelTexture(name, '#F3EBDD', 9)
    }
    const ly = Math.round(f.y) - NAME_Y
    n.label.position.set(Math.round(f.x), ly)
    n.label.visible = name.length > 0
    n.label.alpha = alpha > 0.9 ? 1 : 0.7
    n.arrow.visible = f.slot === opts.youSlot
    n.arrow.tint = hexNum(color)
    n.arrow.position.set(Math.round(f.x), ly - (name ? 12 : 0) + (red ? 0 : Math.round(Math.sin(this.time / 220) * 1.5)))
  }

  private drawItems(state: BrawlSimState): void {
    const live = new Set<number>()
    for (const it of state.items) {
      live.add(it.id)
      let s = this.itemSpr.get(it.id)
      if (!s) {
        s = new Sprite(this.weaponTex(it.weapon))
        s.anchor.set(ITEM_PIVOT.x / 32, ITEM_PIVOT.y / 32)
        this.itemLayer.addChild(s)
        this.itemSpr.set(it.id, s)
      }
      const red = this.opts?.reducedMotion
      const spin = it.state === 'caindo' ? 0.18 : it.state === 'voando' ? 0.5 : 0
      s.rotation = red ? 0 : spin * state.tick * (it.vx < 0 ? -1 : 1)
      const bob = it.state === 'chao' && !red ? Math.round(Math.sin(this.time / 300 + it.id) * 1) : 0
      s.position.set(Math.round(it.x), Math.round(it.y) - (it.state === 'chao' ? 8 : 0) + bob)
      // brilho: caindo e no chão
      if (it.state !== 'voando' && state.tick % 14 === 0 && !red) this.fx.glow(it.x, it.y - (it.state === 'chao' ? 8 : 0), '#FFE9A6', 0.45)
    }
    for (const [id, s] of this.itemSpr)
      if (!live.has(id)) {
        s.destroy()
        this.itemSpr.delete(id)
      }
  }

  private drawProjectiles(state: BrawlSimState): void {
    const live = new Set<number>()
    for (const p of state.projectiles) {
      live.add(p.id)
      let s = this.projSpr.get(p.id)
      if (!s) {
        s = new Sprite()
        s.anchor.set(0.5)
        this.projLayer.addChild(s)
        this.projSpr.set(p.id, s)
      }
      if (p.kind === 'arma' && p.weapon) {
        s.texture = this.weaponTex(p.weapon)
        s.rotation = this.opts?.reducedMotion ? 0 : state.tick * 0.5 * p.facing
        s.scale.x = 1
      } else {
        s.texture = this.projTex(p.kind, Math.floor(state.tick / 5) % 2)
        s.rotation = p.kind === 'carta' && !this.opts?.reducedMotion ? state.tick * 0.35 * p.facing : 0
        s.scale.x = p.facing
      }
      s.position.set(Math.round(p.x + p.w / 2), Math.round(p.y + p.h / 2))
    }
    for (const [id, s] of this.projSpr)
      if (!live.has(id)) {
        s.destroy()
        this.projSpr.delete(id)
      }
  }

  private drawPuddles(state: BrawlSimState): void {
    const live = new Set<number>()
    for (const p of state.puddles) {
      live.add(p.id)
      let s = this.puddleSpr.get(p.id)
      if (!s) {
        s = new Sprite(this.puddleTex(Math.max(6, Math.round(p.w))))
        this.puddleLayer.addChild(s)
        this.puddleSpr.set(p.id, s)
      }
      s.position.set(Math.round(p.x - p.w / 2), Math.round(p.y) - 3)
      // some pisca no fim
      s.alpha = p.dieTick - state.tick < 40 ? (state.tick % 6 < 3 ? 0.4 : 1) : 1
    }
    for (const [id, s] of this.puddleSpr)
      if (!live.has(id)) {
        s.destroy()
        this.puddleSpr.delete(id)
      }
  }

  private drawCountdown(state: BrawlSimState): void {
    let text = ''
    let color = '#F3EBDD'
    if (state.phase === 'contagem') {
      const rem = Math.max(0, state.goTick - state.tick)
      text = String(Math.min(3, Math.ceil(rem / TICK_HZ)))
      if (rem > COUNTDOWN_TICKS) text = '3'
    } else if (state.phase === 'jogando' && state.tick - state.goTick >= 0 && state.tick - state.goTick < 48) {
      text = 'Já!'
      color = '#FFC94A'
    }
    if (!text) {
      if (this.countSpr) this.countSpr.visible = false
      return
    }
    const key = `${text}|${color}`
    if (!this.countSpr) {
      this.countSpr = new Sprite()
      this.countSpr.anchor.set(0.5)
      this.textLayer.addChild(this.countSpr)
    }
    if (key !== this.countKey) {
      this.countKey = key
      this.countSpr.texture = labelTexture(text, color, 30)
    }
    this.countSpr.visible = true
    this.countSpr.position.set(ARENA_W / 2, 100)
    // "pop" no começo de cada número (sem escala fracionária: 1 ou 2)
    const age = state.phase === 'contagem' ? TICK_HZ - ((state.goTick - state.tick) % TICK_HZ) : state.tick - state.goTick
    this.countSpr.scale.set(!this.opts?.reducedMotion && age < 6 ? 2 : 1)
  }

  private drawDebug(opts: BrawlRenderOpts): void {
    const g = this.debugGfx
    g.clear()
    const boxes = opts.debugBoxes
    if (!boxes?.length) return
    for (const b of boxes) {
      const c = b.kind === 'hurt' ? 0x6fd49b : b.kind === 'hit' ? 0xff7a6b : 0xffc94a
      g.rect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w) - 1, Math.round(b.h) - 1).stroke({ width: 1, color: c, alpha: 0.9 })
    }
    for (const p of ARENA_PLATFORMS[this.state!.arenaId]) g.rect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1).stroke({ width: 1, color: 0xffc94a, alpha: 0.5 })
  }

  // -------------------------------------------------------------- relógio da cena
  private update(dtMs: number): void {
    if (this.source) {
      const fr = this.source.frame()
      const evs = this.source.drainEvents()
      if (fr) {
        this.opts = fr.opts
        this.render(fr.state, fr.opts)
      }
      if (evs.length) this.pushEvents(evs)
    }
    const red = this.opts?.reducedMotion ?? false
    this.time += dtMs
    this.env.reduced = red
    this.env.koAge = this.time - this.lastKoAt
    if (!this.ready || !this.art) return
    this.updateArena()
    this.fx.update(dtMs / 1000)

    // tremida de tela só no nocaute e nunca com "reduzir movimento"
    let sx = 0
    let sy = 0
    if (!red && this.shakeMs > 0) {
      this.shakeMs -= dtMs
      const k = Math.max(0, this.shakeMs / 260)
      sx = Math.round((Math.sin(this.time * 0.09) * 3) * k)
      sy = Math.round((Math.cos(this.time * 0.13) * 2) * k)
    }
    this.world.position.set(sx, sy)
    this.fxCtx.clearRect(0, 0, ARENA_W, ARENA_H)
    this.fx.draw(this.fxCtx)
    ;(this.fxSpr.texture.source as CanvasSource).update()

    if (this.banner) {
      const left = this.banner.until - this.time
      if (left <= 0) {
        this.banner.sprite.destroy()
        this.banner = null
      } else this.banner.sprite.alpha = left < 300 ? left / 300 : 1
    }
    void FW
  }
}
