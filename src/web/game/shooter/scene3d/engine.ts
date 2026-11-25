/**
 * Cena 3D em primeira pessoa do Tiro na Sala (Three.js). É o ÚNICO arquivo de scene3d que importa `three`.
 *
 * Lê `session.frame()` a cada quadro (sem re-render do React), manda o `InputState` do FpsController e
 * trata os mesmos eventos do 2D. Desenha em resolução baixa (VIRTUAL_H de altura) e o CSS amplia sem
 * suavizar. O overlay 2D (arma, mira, minimapa) fica num segundo canvas por cima.
 */
import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  WebGLRenderer,
  type Material,
  type Texture
} from 'three'
import { getMap } from '../../../../shared/games/shooter/maps'
import { MAX_HP, WEAPONS, type MapDef, type MapId, type WeaponId } from '../../../../shared/games/shooter/types'
import type { FrameEvent, RenderPlayer, ShooterFrame, ShooterSceneProps } from '../contract'
import { SPAL, hexNum, rowsToCanvas, tintedPalette } from '../scene/palette'
import { GHOST, pickupRows, ringPoints } from '../scene/sprites'
import { BILLBOARD_W, bodyFrame3d, facing3d } from './billboard'
import { EYE_H, FOV_DEG, HAS_CEILING, MAX_WORLD_LIGHTS, SHOT_H, BODY_H, VIRTUAL_H, type LayerKey, type MeshData } from './contract3d'
import { FpsController, aimToYaw, wrapAngle } from './fpsInput'
import { Overlay } from './overlay'
import { ceilingCanvas, floorCanvas, sideCanvas, skyCanvas, topCanvas, waterCanvas } from './textures'
import { buildWorld } from './world'

// ------------------------------------------------------------ constantes
const FALLBACK_COLORS = ['#D98E5F', '#C9A227', '#8FAE6B', '#5FA39A', '#C27C8E', '#B4846C', '#7E9CB5', '#D4A373']
/** a pessoa ouve até aqui (px do mundo), como no 2D */
const HEAR = 260
const STEP_DIST = 9
const U = 1 / 16
/** ver o relatório: a arte é BODY_H x BODY_H, mas o círculo de acerto da simulação é bem mais fino; este fator afina o desenho */
export const BODY_W_K = 0.6
const BODY_PLANE_W = (BILLBOARD_W / 16) * BODY_H * BODY_W_K
const NAME_DIST = 25
const MAX_SMALL = 400
const MAX_BIG = 100
const MAX_BOLTS = 200
const MAX_GRENADES = 16
const MAX_SHADOWS = 24
const FLOATERS = 24
const GHOSTS = 10
const BALLS = 4
const FX_LIGHTS = 4
/** escala das luzes (o Three novo usa unidades físicas) */
const WORLD_LIGHT_K = 16
const FX_LIGHT_K = 1
const ENV: Record<MapId, { bg: string; fogNear: number; fogFar: number; ambient: number; hemi: number; sky: string; ground: string }> = {
  casa: { bg: '#120E0C', fogNear: 10, fogFar: 46, ambient: 1.25, hemi: 0.5, sky: '#FFE2B8', ground: '#3B2A22' },
  quintal: { bg: '#141b26', fogNear: 14, fogFar: 78, ambient: 0.95, hemi: 0.55, sky: '#8FA6CF', ground: '#26331F' }
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t

function hashColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]!
}

function mix(a: string, b: string, t: number): string {
  const x = hexNum(a)
  const y = hexNum(b)
  const c = (s: number): number => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t)
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`
}

function shortName(n: string): string {
  return n.length > 12 ? `${n.slice(0, 11)}…` : n
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pixelTexture(cv: HTMLCanvasElement, repeat: 'none' | 'both' | 'x' = 'none'): CanvasTexture {
  const t = new CanvasTexture(cv)
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  t.generateMipmaps = false
  t.colorSpace = SRGBColorSpace
  if (repeat === 'both') t.wrapS = t.wrapT = RepeatWrapping
  else if (repeat === 'x') t.wrapS = RepeatWrapping
  return t
}

function toGeometry(m: MeshData): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(m.pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(m.nrm, 3))
  g.setAttribute('uv', new Float32BufferAttribute(m.uv, 2))
  g.setAttribute('color', new Float32BufferAttribute(m.col, 3))
  g.computeBoundingSphere()
  return g
}

function disposeTree(o: Object3D): void {
  o.traverse((x) => {
    const m = x as Mesh
    m.geometry?.dispose()
    const mat = m.material as Material | Material[] | undefined
    const list = Array.isArray(mat) ? mat : mat ? [mat] : []
    for (const y of list) {
      const maps = y as MeshLambertMaterial
      maps.map?.dispose()
      y.dispose()
    }
  })
}

// ------------------------------------------------------------ texto em sprite
interface TextTex {
  tex: CanvasTexture
  w: number
  h: number
}
const textCache = new Map<string, TextTex>()
const TEXT_FONT = '600 11px "Pixelify Sans Variable", "Pixelify Sans", monospace'

function textTexture(text: string, color: string, bg: boolean): TextTex {
  const key = `${bg ? 1 : 0}|${color}|${text}`
  const hit = textCache.get(key)
  if (hit) return hit
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')!
  ctx.font = TEXT_FONT
  const w = Math.ceil(ctx.measureText(text).width) + (bg ? 10 : 6)
  const h = bg ? 15 : 14
  cv.width = w
  cv.height = h
  ctx.font = TEXT_FONT
  ctx.textBaseline = 'middle'
  if (bg) {
    ctx.fillStyle = 'rgba(15,11,9,0.78)'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = color
    ctx.fillRect(0, h - 2, w, 2)
    ctx.fillStyle = SPAL.p!
    ctx.fillText(text, 5, 6)
  } else {
    ctx.fillStyle = SPAL.k!
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) ctx.fillText(text, 3 + dx, 7 + dy)
    ctx.fillStyle = color
    ctx.fillText(text, 3, 7)
  }
  const out = { tex: pixelTexture(cv), w, h }
  if (textCache.size > 120) {
    const first = textCache.keys().next().value
    if (first !== undefined) {
      textCache.get(first)?.tex.dispose()
      textCache.delete(first)
    }
  }
  textCache.set(key, out)
  return out
}

const TEXT_U = 0.05

function makeTextSprite(depthTest: boolean): Sprite {
  const mat = new SpriteMaterial({ transparent: true, depthTest, depthWrite: false })
  const sp = new Sprite(mat)
  sp.renderOrder = depthTest ? 5 : 8
  sp.visible = false
  return sp
}

function setTextSprite(sp: Sprite, t: TextTex): void {
  const mat = sp.material
  if (mat.map !== t.tex) {
    mat.map = t.tex
    mat.needsUpdate = true
  }
  sp.scale.set(t.w * TEXT_U, t.h * TEXT_U, 1)
  sp.userData.baseW = t.w * TEXT_U
  sp.userData.baseH = t.h * TEXT_U
}

// ------------------------------------------------------------ partículas
interface Part {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  life: number
  grav: number
  r: number
  g: number
  b: number
}

class PartSystem {
  readonly points: Points
  readonly list: Part[] = []
  private pos: Float32Array
  private col: Float32Array
  private geo = new BufferGeometry()
  private tmp = new Color()
  constructor(
    private max: number,
    size: number
  ) {
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    const pa = new Float32BufferAttribute(this.pos, 3)
    const ca = new Float32BufferAttribute(this.col, 3)
    pa.setUsage(DynamicDrawUsage)
    ca.setUsage(DynamicDrawUsage)
    this.geo.setAttribute('position', pa)
    this.geo.setAttribute('color', ca)
    this.geo.setDrawRange(0, 0)
    this.points = new Points(this.geo, new PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, fog: false }))
    this.points.frustumCulled = false
    this.points.renderOrder = 6
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: string, grav = 0): void {
    if (this.list.length >= this.max) this.list.shift()
    this.tmp.set(color)
    this.list.push({ x, y, z, vx, vy, vz, age: 0, life, grav, r: this.tmp.r, g: this.tmp.g, b: this.tmp.b })
  }

  clear(): void {
    this.list.length = 0
    this.geo.setDrawRange(0, 0)
  }

  step(dt: number): void {
    const l = this.list
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i]!
      p.age += dt
      if (p.age >= p.life) {
        l[i] = l[l.length - 1]!
        l.pop()
        continue
      }
      p.vy -= p.grav * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < 0.05 && p.grav > 0) {
        p.y = 0.05
        p.vy *= -0.3
        p.vx *= 0.6
        p.vz *= 0.6
      }
    }
    for (let i = 0; i < l.length; i++) {
      const p = l[i]!
      this.pos[i * 3] = p.x
      this.pos[i * 3 + 1] = p.y
      this.pos[i * 3 + 2] = p.z
      this.col[i * 3] = p.r
      this.col[i * 3 + 1] = p.g
      this.col[i * 3 + 2] = p.b
    }
    this.geo.setDrawRange(0, l.length)
    ;(this.geo.getAttribute('position') as Float32BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute('color') as Float32BufferAttribute).needsUpdate = true
  }

  dispose(): void {
    this.geo.dispose()
    ;(this.points.material as Material).dispose()
  }
}

// ------------------------------------------------------------ nós de cena
interface PNode {
  mesh: Mesh
  mat: MeshLambertMaterial
  label: Sprite
  labelKey: string
  lastX: number
  lastY: number
  walk: number
  stepAcc: number
  flash: number
  alive: boolean
  texKey: string
}

interface PickNode {
  mesh: Mesh
  mat: MeshBasicMaterial
  ring: Mesh
  ringCv: HTMLCanvasElement
  ringTex: CanvasTexture
  ringKey: number
  kind: string
}

interface Floater {
  sp: Sprite
  x: number
  y: number
  z: number
  age: number
  life: number
  on: boolean
}

interface GhostFx {
  sp: Sprite
  x: number
  y: number
  z: number
  age: number
  on: boolean
}

interface BallFx {
  mesh: Mesh
  age: number
  life: number
  radius: number
  on: boolean
}

interface FxLight {
  light: PointLight
  age: number
  life: number
  peak: number
  on: boolean
}

export interface Shooter3DDebug {
  fps: number
  calls: number
  triangles: number
  yaw: number
}

/** Cena do tiro em primeira pessoa. Tudo é criado uma vez; por quadro só se mexe em posições e matrizes. */
export class Shooter3DEngine {
  onLockChange: ((locked: boolean) => void) | null = null
  onTouchUi: ((t: { move: { active: boolean; cx: number; cy: number; x: number; y: number } }) => void) | null = null

  private failed = false
  private dead = false
  private raf = 0
  private renderer!: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(FOV_DEG, 16 / 9, 0.1, 170)
  private fps!: FpsController
  private overlay = new Overlay()
  private hostW = 480
  private hostH = 270
  private props: ShooterSceneProps | null = null
  private session: ShooterSceneProps['session'] | null = null
  private unsub: (() => void) | null = null
  private events: FrameEvent[] = []
  private frame: ShooterFrame | null = null

  // luzes
  private ambient = new AmbientLight('#ffffff', 1)
  private hemi = new HemisphereLight('#ffffff', '#222222', 0.5)
  private worldLights: PointLight[] = []
  private camLight = new PointLight('#FFD9A0', 2.5, 9, 2)
  private fxLights: FxLight[] = []

  // mundo
  private worldGroup = new Group()
  private worldTex: Texture[] = []
  private mapId: MapId | '' = ''
  private map: MapDef | null = null
  private waterTex: Texture | null = null
  private ceilingMesh: Mesh | null = null
  private skyGroup = new Group()
  private skyMat = new MeshBasicMaterial({ side: BackSide, fog: false, depthWrite: false })

  // entidades
  private bodyGeo = new PlaneGeometry(1, 1).translate(0, 0.5, 0)
  private nodes = new Map<number, PNode>()
  private bodyTex = new Map<string, CanvasTexture>()
  private whitePal: Record<string, string> = Object.fromEntries(Object.keys(SPAL).map((k) => [k, '#FFFFFF']))
  private shadows!: InstancedMesh
  private bolts!: InstancedMesh
  private grenades!: InstancedMesh
  private pickNodes = new Map<number, PickNode>()
  private pickTex = new Map<string, CanvasTexture>()
  private projSeen = new Map<number, number>()
  private small = new PartSystem(MAX_SMALL, 2)
  private big = new PartSystem(MAX_BIG, 5)
  private floaters: Floater[] = []
  private ghosts: GhostFx[] = []
  private balls: BallFx[] = []
  private ghostTex = new Map<string, CanvasTexture>()
  private dummy = new Object3D()
  private tmpColor = new Color()
  private rnd = rng(11)
  private nodeColor = new Map<string, string>()

  // câmera e estado
  private camYaw = 0
  private camPitch = 0
  private camReady = false
  private meWasAlive = false
  private lastMe = { x: 0, y: 0 }
  private deathT = 0
  private deathKiller = -1
  private fimT = -1
  private fimFrom = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }
  private specPos = { x: 0, z: 0, y: 4 }
  private walkPhase = 0
  private shake = 0
  private hitStop = 0
  private time = 0
  private frameNo = 0
  private lastCount = -1
  private lastPhase = ''
  private lastT = 0
  private fpsAvg = 60
  private moving = false
  private readyMarked = false

  constructor(private host: HTMLElement) {
    this.hostW = Math.max(1, host.clientWidth || 480)
    this.hostH = Math.max(1, host.clientHeight || 270)
    try {
      this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    } catch {
      this.failed = true
      const msg = document.createElement('p')
      msg.className = 'tiro3d-fail'
      msg.textContent = 'Seu navegador não abriu o 3D. Use a visão 2D.'
      host.appendChild(msg)
      return
    }
    const r = this.renderer
    r.setPixelRatio(1)
    r.setClearColor('#120E0C')
    const cv = r.domElement
    cv.setAttribute('aria-hidden', 'true')
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;image-rendering:pixelated;cursor:none'
    const ov = this.overlay.canvas
    ov.className = 'tiro3d-overlay'
    ov.setAttribute('aria-hidden', 'true')
    ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;image-rendering:pixelated;pointer-events:none'
    host.insertBefore(ov, host.firstChild)
    host.insertBefore(cv, host.firstChild)

    this.buildScene()
    this.sizeRenderer()
    this.fps = new FpsController({
      el: host,
      enabled: () => this.props?.inputEnabled !== false && !!this.frame && this.frame.phase !== 'fim' && this.frame.me !== null,
      onLockChange: (l) => this.onLockChange?.(l),
      onTouch: (t) => this.onTouchUi?.(t)
    })
    void document.fonts?.load('600 11px "Pixelify Sans Variable"').catch(() => undefined)
    ;(host as HTMLElement & { __engine?: Shooter3DEngine }).__engine = this
    if (import.meta.env.DEV) {
      ;(window as unknown as { __tiro3d?: unknown }).__tiro3d = {
        yaw: (v?: number) => {
          if (v !== undefined) this.fps.setYaw(v)
          return this.fps.yaw
        },
        debug: () => this.debug()
      }
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  // ------------------------------------------------------------ API pública
  setProps(p: ShooterSceneProps): void {
    this.props = p
    if (this.failed) return
    if (this.session !== p.session) {
      this.unsub?.()
      this.session = p.session
      this.unsub = p.session.onEvents((evs) => {
        for (const e of evs) this.events.push(e)
        if (this.events.length > 300) this.events.splice(0, this.events.length - 300)
      })
    }
  }

  resize(w: number, h: number): void {
    this.hostW = Math.max(1, w)
    this.hostH = Math.max(1, h)
    if (!this.failed) this.sizeRenderer()
  }

  setTouchButton(bit: number, down: boolean): void {
    this.fps?.setTouchButton(bit, down)
  }

  requestLock(): void {
    this.fps?.requestLock()
  }

  debug(): Shooter3DDebug {
    const i = this.renderer?.info
    return { fps: Math.round(this.fpsAvg), calls: i?.render.calls ?? 0, triangles: i?.render.triangles ?? 0, yaw: this.fps?.yaw ?? 0 }
  }

  destroy(): void {
    this.dead = true
    cancelAnimationFrame(this.raf)
    this.unsub?.()
    this.unsub = null
    if (this.failed) {
      this.host.querySelector('.tiro3d-fail')?.remove()
      return
    }
    this.fps.dispose()
    disposeTree(this.worldGroup)
    for (const t of this.worldTex) t.dispose()
    for (const t of this.bodyTex.values()) t.dispose()
    for (const t of this.pickTex.values()) t.dispose()
    for (const t of this.ghostTex.values()) t.dispose()
    for (const n of this.nodes.values()) {
      n.mat.dispose()
      n.label.material.dispose()
    }
    for (const p of this.pickNodes.values()) {
      p.mat.dispose()
      p.ringTex.dispose()
      ;(p.ring.material as Material).dispose()
    }
    this.small.dispose()
    this.big.dispose()
    for (const o of [this.shadows, this.bolts, this.grenades]) {
      o.geometry.dispose()
      ;(o.material as Material).dispose()
      o.dispose()
    }
    for (const f of this.floaters) f.sp.material.dispose()
    for (const g of this.ghosts) g.sp.material.dispose()
    for (const b of this.balls) {
      b.mesh.geometry.dispose()
      ;(b.mesh.material as Material).dispose()
    }
    for (const t of textCache.values()) t.tex.dispose()
    textCache.clear()
    this.bodyGeo.dispose()
    this.skyMat.map?.dispose()
    this.skyMat.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
    this.overlay.canvas.remove()
    this.host.removeAttribute('data-scene-ready')
    if (import.meta.env.DEV) delete (window as unknown as { __tiro3d?: unknown }).__tiro3d
  }

  // ------------------------------------------------------------ montagem (uma vez)
  private buildScene(): void {
    const s = this.scene
    s.add(this.camera)
    this.camera.rotation.order = 'YXZ'
    s.add(this.ambient, this.hemi, this.worldGroup, this.skyGroup)
    // luzes: número FIXO (mudar recompila todos os shaders)
    for (let i = 0; i < MAX_WORLD_LIGHTS; i++) {
      const l = new PointLight('#FFC94A', 0, 10, 2)
      this.worldLights.push(l)
      s.add(l)
    }
    this.camera.add(this.camLight)
    for (let i = 0; i < FX_LIGHTS; i++) {
      const l = new PointLight('#FFC94A', 0, 12, 2)
      s.add(l)
      this.fxLights.push({ light: l, age: 0, life: 1, peak: 0, on: false })
    }

    // céu e estrelas (só no quintal)
    const sky = new Mesh(new CylinderGeometry(92, 92, 72, 28, 1, true), this.skyMat)
    sky.position.y = 33
    sky.renderOrder = -10
    sky.frustumCulled = false
    const starGeo = new BufferGeometry()
    const r = rng(5)
    const sp: number[] = []
    for (let i = 0; i < 150; i++) {
      const a = r() * Math.PI * 2
      const y = 6 + r() * 56
      sp.push(Math.cos(a) * 88, y, Math.sin(a) * 88)
    }
    starGeo.setAttribute('position', new Float32BufferAttribute(sp, 3))
    const stars = new Points(starGeo, new PointsMaterial({ color: SPAL.p!, size: 2, sizeAttenuation: false, fog: false, depthWrite: false }))
    stars.renderOrder = -9
    stars.frustumCulled = false
    this.skyGroup.add(sky, stars)

    // sombras redondas (uma chamada para todas)
    const sh = new CircleGeometry(0.5, 10)
    sh.rotateX(-Math.PI / 2)
    this.shadows = new InstancedMesh(sh, new MeshBasicMaterial({ color: SPAL.k!, transparent: true, opacity: 0.42, depthWrite: false }), MAX_SHADOWS)
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage)
    this.shadows.frustumCulled = false
    this.shadows.renderOrder = 1
    this.shadows.count = 0

    // projéteis em linha (bala, bago, rifle, rolha) com cor por instância
    this.bolts = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ fog: false }), MAX_BOLTS)
    this.bolts.instanceMatrix.setUsage(DynamicDrawUsage)
    this.bolts.setColorAt(0, new Color('#ffffff'))
    this.bolts.frustumCulled = false
    this.bolts.count = 0
    this.grenades = new InstancedMesh(new SphereGeometry(0.28, 8, 6), new MeshBasicMaterial({ color: SPAL.G! }), MAX_GRENADES)
    this.grenades.instanceMatrix.setUsage(DynamicDrawUsage)
    this.grenades.frustumCulled = false
    this.grenades.count = 0
    s.add(this.shadows, this.bolts, this.grenades, this.small.points, this.big.points)

    // pools: números, fantasmas, bolas de explosão
    for (let i = 0; i < FLOATERS; i++) {
      const sp2 = makeTextSprite(false)
      s.add(sp2)
      this.floaters.push({ sp: sp2, x: 0, y: 0, z: 0, age: 0, life: 0.7, on: false })
    }
    for (let i = 0; i < GHOSTS; i++) {
      const g = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false }))
      g.visible = false
      g.renderOrder = 4
      s.add(g)
      this.ghosts.push({ sp: g, x: 0, y: 0, z: 0, age: 0, on: false })
    }
    for (let i = 0; i < BALLS; i++) {
      const m = new Mesh(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ color: '#FF9A5B', transparent: true, opacity: 0.8, depthWrite: false, fog: false }))
      m.visible = false
      m.renderOrder = 3
      s.add(m)
      this.balls.push({ mesh: m, age: 0, life: 0.4, radius: 2, on: false })
    }
    this.applyEnv('casa')
  }

  private applyEnv(id: MapId): void {
    const e = ENV[id]
    this.scene.background = new Color(e.bg)
    this.scene.fog = new Fog(e.bg, e.fogNear, e.fogFar)
    this.ambient.color.set(e.sky)
    this.ambient.intensity = e.ambient
    this.hemi.color.set(e.sky)
    this.hemi.groundColor.set(e.ground)
    this.hemi.intensity = e.hemi
    this.renderer.setClearColor(e.bg)
  }

  private sizeRenderer(): void {
    const ih = VIRTUAL_H
    const iw = clamp(Math.round(ih * (this.hostW / this.hostH)), 160, 1000)
    this.renderer.setSize(iw, ih, false)
    this.camera.aspect = iw / ih
    this.camera.updateProjectionMatrix()
    this.overlay.resize(iw, ih)
  }

  // ------------------------------------------------------------ mundo
  private loadWorld(id: MapId): void {
    this.mapId = id
    const map = getMap(id)
    this.map = map
    for (const ch of [...this.worldGroup.children]) {
      this.worldGroup.remove(ch)
      disposeTree(ch)
    }
    for (const t of this.worldTex) t.dispose()
    this.worldTex = []
    this.waterTex = null
    this.ceilingMesh = null
    const w = buildWorld(map)
    const tex = (cv: HTMLCanvasElement, rep: 'none' | 'both' | 'x'): CanvasTexture => {
      const t = pixelTexture(cv, rep)
      this.worldTex.push(t)
      return t
    }
    for (const [k, data] of Object.entries(w.layers) as [LayerKey, MeshData][]) {
      if (!data || data.pos.length === 0) continue
      let mat: Material
      if (k === 'floor') mat = new MeshLambertMaterial({ map: tex(floorCanvas(map), 'none'), vertexColors: true, side: DoubleSide })
      else if (k === 'water') {
        const t = tex(waterCanvas(), 'both')
        this.waterTex = t
        mat = new MeshLambertMaterial({ map: t, vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.88, emissive: '#10324A' })
      } else if (k === 'ceiling') mat = new MeshLambertMaterial({ map: tex(ceilingCanvas(), 'both'), vertexColors: true, side: DoubleSide })
      else if (k === 'top') mat = new MeshLambertMaterial({ map: tex(topCanvas(map), 'none'), vertexColors: true, side: DoubleSide, alphaTest: 0.5 })
      else if (k.startsWith('side:')) mat = new MeshLambertMaterial({ map: tex(sideCanvas(k.slice(5), id), 'x'), vertexColors: true, side: DoubleSide })
      else if (k === 'glow') mat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })
      else mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
      const mesh = new Mesh(toGeometry(data), mat)
      if (k === 'ceiling') this.ceilingMesh = mesh
      this.worldGroup.add(mesh)
    }
    // luzes do mundo: as mesmas MAX_WORLD_LIGHTS de sempre, só trocam de lugar e de força
    this.worldLights.forEach((l, i) => {
      const wl = w.lights[i]
      if (!wl) {
        l.intensity = 0
        return
      }
      l.color.set(wl.color)
      l.position.set(wl.x, wl.y, wl.z)
      l.intensity = wl.power * WORLD_LIGHT_K
      l.distance = wl.range
    })
    this.applyEnv(id)
    // céu
    const quintal = !HAS_CEILING[id]
    this.skyGroup.visible = quintal
    if (quintal) {
      this.skyMat.map?.dispose()
      this.skyMat.map = pixelTexture(skyCanvas())
      this.skyMat.needsUpdate = true
    }
    // entidades da partida anterior
    for (const n of this.nodes.values()) this.dropNode(n)
    this.nodes.clear()
    for (const p of this.pickNodes.values()) this.dropPick(p)
    this.pickNodes.clear()
    this.projSeen.clear()
    this.small.clear()
    this.big.clear()
    for (const f of this.floaters) {
      f.on = false
      f.sp.visible = false
    }
    for (const g of this.ghosts) {
      g.on = false
      g.sp.visible = false
    }
    for (const b of this.balls) {
      b.on = false
      b.mesh.visible = false
    }
    for (const l of this.fxLights) {
      l.on = false
      l.light.intensity = 0
    }
    this.overlay.reset()
    this.camReady = false
    this.meWasAlive = false
    this.fimT = -1
  }

  private dropNode(n: PNode): void {
    this.scene.remove(n.mesh, n.label)
    n.mat.dispose()
    n.label.material.dispose()
  }

  private dropPick(p: PickNode): void {
    this.scene.remove(p.mesh, p.ring)
    p.mat.dispose()
    p.ringTex.dispose()
    ;(p.ring.material as Material).dispose()
  }

  // ------------------------------------------------------------ laço
  private loop = (now: number): void => {
    if (this.dead) return
    this.raf = requestAnimationFrame(this.loop)
    const dtMs = this.lastT ? clamp(now - this.lastT, 0, 50) : 16
    this.lastT = now
    if (dtMs > 0) this.fpsAvg = lerp(this.fpsAvg, 1000 / Math.max(dtMs, 1), 0.05)
    try {
      this.update(dtMs)
    } catch (err) {
      if (import.meta.env.DEV) console.error('[tiro3d]', err)
    }
  }

  private colorOf(id: string): string {
    const c = this.props?.colors[id]
    if (c) return c
    let v = this.nodeColor.get(id)
    if (!v) this.nodeColor.set(id, (v = hashColor(id)))
    return v
  }

  private update(dtMs: number): void {
    const props = this.props
    const session = this.session
    if (!props || !session) return
    const frame = session.frame()
    this.frame = frame
    if (!frame) {
      this.overlay.clear()
      return
    }
    this.frameNo++
    const reduced = props.reducedMotion
    if (frame.mapId !== this.mapId) this.loadWorld(frame.mapId)
    const map = this.map!

    const meSlot = frame.me
    const me = meSlot !== null ? (frame.players.find((p) => p.slot === meSlot) ?? null) : null
    if (me && me.alive) this.lastMe = { x: me.x, y: me.y }

    // entrada
    const poll = this.fps.poll(dtMs)
    session.setInput(poll.input)
    this.moving = poll.moving
    if (me && me.alive && !this.meWasAlive) this.fps.setYaw(aimToYaw(me.ax, me.ay))
    if (me && !me.alive && this.meWasAlive) {
      this.deathT = 0
    }
    this.meWasAlive = !!me && me.alive
    const yaw = this.fps.yaw

    // eventos (viram partículas e sons) antes de mexer na câmera
    this.handleEvents(frame, reduced)
    const frozen = this.hitStop > 0
    this.hitStop = Math.max(0, this.hitStop - dtMs)
    const dt = frozen ? 0 : dtMs / 1000
    this.time += dt

    this.shake *= Math.pow(0.5, dtMs / 70)
    if (this.shake < 0.15) this.shake = 0

    const firstPerson = this.placeCamera(frame, me, yaw, dtMs / 1000, frozen, reduced)

    this.countdown(frame)
    this.syncPlayers(frame, me, reduced, dt)
    this.syncProjectiles(frame, me, dt)
    this.syncPickups(frame)
    this.syncFx(dt)
    if (this.ceilingMesh) this.ceilingMesh.visible = frame.phase !== 'fim'
    if (this.waterTex) {
      this.waterTex.offset.set(this.time * 0.03, this.time * 0.02)
    }
    const env = ENV[frame.mapId]
    const fog = this.scene.fog as Fog
    fog.far = frame.phase === 'fim' ? 400 : env.fogFar
    // o céu acompanha a câmera
    this.skyGroup.position.set(this.camera.position.x, 0, this.camera.position.z)

    this.overlay.draw({
      dtMs,
      reduced,
      frame,
      map,
      me,
      yaw: this.camYaw,
      moving: this.moving && !!me && me.alive,
      color: me ? this.colorOf(me.id) : '#FFFFFF',
      firstPerson,
      colorOf: (id) => this.colorOf(id)
    })
    void map
    this.renderer.render(this.scene, this.camera)
    if (!this.readyMarked) {
      this.readyMarked = true
      this.host.setAttribute('data-scene-ready', '1')
    }
  }

  // ------------------------------------------------------------ câmera
  /** devolve true quando é a visão dos seus olhos (com arma na mão) */
  private placeCamera(frame: ShooterFrame, me: RenderPlayer | null, yaw: number, dt: number, frozen: boolean, reduced: boolean): boolean {
    const cam = this.camera
    const map = this.map!
    let x = cam.position.x
    let y = cam.position.y
    let z = cam.position.z
    let pitch = 0
    let roll = 0
    let first = false
    let cyaw = this.camYaw
    const snap = !this.camReady
    const kf = (rate: number): number => (snap ? 1 : 1 - Math.exp(-dt * rate))

    if (frame.phase === 'fim') {
      if (this.fimT < 0) {
        this.fimT = 0
        this.fimFrom = { x, y, z, yaw: this.camYaw, pitch: this.camPitch }
      }
      if (!frozen) this.fimT += dt
      const k = clamp(this.fimT / 2.8, 0, 1)
      const e = 1 - (1 - k) * (1 - k)
      const cx = map.w / 2
      const cz = map.h / 2
      const R = Math.max(map.w, map.h) * 0.3
      const hMax = Math.max(map.w, map.h) * 0.42
      const ang = this.fimT * 0.14 + 0.6
      const ox = cx + Math.cos(ang) * R
      const oz = cz + Math.sin(ang) * R
      const oy = hMax
      const oyaw = Math.atan2(cz - oz, cx - ox)
      const opitch = -Math.atan2(oy - 1, R)
      x = lerp(this.fimFrom.x, ox, e)
      y = lerp(this.fimFrom.y, oy, e)
      z = lerp(this.fimFrom.z, oz, e)
      cyaw = lerpAngle(this.fimFrom.yaw, oyaw, e)
      pitch = lerp(this.fimFrom.pitch, opitch, e)
    } else {
      this.fimT = -1
      if (me && me.alive) {
        first = true
        const mx = me.x * U
        const mz = me.y * U
        const moved = Math.hypot(mx - x, mz - z)
        if (!snap && moved < 2 && moved > 0.001) this.walkPhase += moved * 3.2
        const bob = reduced || !this.moving ? 0 : Math.sin(this.walkPhase) * 0.07
        x = mx
        z = mz
        y = EYE_H + bob
        cyaw = yaw
      } else if (me) {
        // morto: a câmera cai devagar e olha para quem matou
        if (!frozen) this.deathT += dt
        const k = clamp(this.deathT / 1.1, 0, 1)
        const e = k * k * (3 - 2 * k)
        x = this.lastMe.x * U
        z = this.lastMe.y * U
        y = lerp(EYE_H, 1.0, e)
        const killer = this.deathKiller >= 0 && this.deathKiller !== me.slot ? frame.players.find((p) => p.slot === this.deathKiller) : undefined
        if (killer) cyaw = lerpAngle(this.camYaw, Math.atan2(killer.y - this.lastMe.y, killer.x - this.lastMe.x), kf(4))
        roll = 0.28 * e
        pitch = -0.12 * e
      } else {
        // espectador: terceira pessoa atrás do líder, olhando na mira dele
        const lead = frame.scores.length ? frame.players.find((p) => p.id === frame.scores[0]!.id && p.alive) : undefined
        const t = lead ?? frame.players.find((p) => p.alive)
        if (t) {
          const ty = aimToYaw(t.ax, t.ay)
          const tx = t.x * U - Math.cos(ty) * 4.4
          const tz = t.y * U - Math.sin(ty) * 4.4
          const k = kf(8)
          this.specPos.x = lerp(this.specPos.x || tx, tx, k)
          this.specPos.z = lerp(this.specPos.z || tz, tz, k)
          x = this.specPos.x
          z = this.specPos.z
          y = 4.6
          cyaw = lerpAngle(this.camYaw, ty, kf(6))
          pitch = -0.2
        } else {
          x = map.w / 2
          z = map.h / 2
          y = 12
          pitch = -0.9
          cyaw = this.camYaw + dt * 0.3
        }
      }
    }
    this.camYaw = cyaw = wrapAngle(cyaw)
    this.camPitch = pitch
    this.camReady = true
    // tremida: poucos décimos de grau
    let jy = 0
    let jr = 0
    let jp = 0
    if (!reduced && this.shake > 0) {
      const r = this.rnd
      jy = (r() - 0.5) * this.shake * 0.0035
      jr = (r() - 0.5) * this.shake * 0.0045
      jp = (r() - 0.5) * this.shake * 0.002
    }
    cam.position.set(x, y, z)
    cam.rotation.set(pitch + jp, -cyaw - Math.PI / 2 + jy, roll + jr)
    return first
  }

  // ------------------------------------------------------------ sons
  private sfx(name: string, x: number, y: number, base = 1): void {
    const cb = this.props?.onSfx
    if (!cb) return
    const lx = this.camera.position.x * 16
    const ly = this.camera.position.z * 16
    const dx = x - lx
    const dy = y - ly
    const d = Math.hypot(dx, dy)
    const vol = base * clamp(1 - d / HEAR, 0, 1)
    if (vol < 0.04) return
    const rx = -Math.sin(this.camYaw)
    const ry = Math.cos(this.camYaw)
    const dir = d > 0.001 ? (dx * rx + dy * ry) / d : 0
    cb(name, { volume: Math.round(vol * 100) / 100, pan: Math.round(clamp(dir * clamp(d / 50, 0, 1), -1, 1) * 100) / 100 })
  }

  private sfxMine(name: string, vol = 1): void {
    this.props?.onSfx?.(name, { volume: vol, pan: 0 })
  }

  private addShake(mag: number, x: number, y: number, force = false): void {
    const d = Math.hypot(x - this.camera.position.x * 16, y - this.camera.position.z * 16)
    const k = force ? 1 : clamp(1 - d / 200, 0, 1)
    this.shake = Math.max(this.shake, mag * k)
  }

  // ------------------------------------------------------------ partículas e luzes
  private burst(x: number, y: number, z: number, color: string, n: number, speed: number, up = 1.5, life = 0.35, grav = 9): void {
    const r = this.rnd
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2
      const s = speed * (0.4 + r() * 0.8)
      this.small.add(x, y, z, Math.cos(a) * s, up + r() * up, Math.sin(a) * s, life * (0.6 + r() * 0.6), color, grav)
    }
  }

  private flashLight(x: number, y: number, z: number, color: string, peak: number, life: number, dist: number): void {
    let pick = this.fxLights.find((l) => !l.on)
    if (!pick) pick = this.fxLights.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b))
    pick.on = true
    pick.age = 0
    pick.life = life
    pick.peak = peak * FX_LIGHT_K
    pick.light.color.set(color)
    pick.light.position.set(x, y, z)
    pick.light.distance = dist
  }

  private spawnFloater(text: string, x: number, y: number, z: number, color: string): void {
    const f = this.floaters.find((q) => !q.on) ?? this.floaters.reduce((a, b) => (a.age > b.age ? a : b))
    f.on = true
    f.age = 0
    f.life = 0.7
    f.x = x
    f.y = y
    f.z = z
    setTextSprite(f.sp, textTexture(text, color, false))
    f.sp.visible = true
  }

  private ghostTexture(color: string): CanvasTexture {
    let t = this.ghostTex.get(color)
    if (!t) {
      const rows = GHOST.map((l) => l.replace(/p/g, 't'))
      this.ghostTex.set(color, (t = pixelTexture(rowsToCanvas(rows, { ...tintedPalette(color), t: mix(color, '#F3EBDD', 0.55) }))))
    }
    return t
  }

  private spawnGhost(x: number, z: number, color: string): void {
    const g = this.ghosts.find((q) => !q.on) ?? this.ghosts[0]!
    g.on = true
    g.age = 0
    g.x = x
    g.z = z
    g.y = 1.2
    g.sp.material.map = this.ghostTexture(color)
    g.sp.material.needsUpdate = true
    g.sp.scale.set(1.5, 1.5, 1)
    g.sp.visible = true
  }

  private explosion(x: number, z: number, radius: number, reduced: boolean): void {
    const b = this.balls.find((q) => !q.on) ?? this.balls[0]!
    b.on = true
    b.age = 0
    b.life = 0.38
    b.radius = radius * U
    b.mesh.position.set(x, 1.4, z)
    b.mesh.visible = true
    this.burst(x, 1.4, z, SPAL.y!, 14, 6, 3, 0.5, 8)
    this.burst(x, 1.2, z, SPAL.o!, 10, 4, 2.5, 0.45, 8)
    for (let i = 0; i < 8; i++) this.big.add(x + (this.rnd() - 0.5), 1 + this.rnd(), z + (this.rnd() - 0.5), (this.rnd() - 0.5) * 1.5, 1.2, (this.rnd() - 0.5) * 1.5, 0.8, SPAL.D!)
    this.flashLight(x, 2, z, '#FF9A5B', reduced ? 30 : 60, 0.38, radius * U * 3 + 5)
  }

  private syncFx(dt: number): void {
    this.small.step(dt)
    this.big.step(dt)
    for (const f of this.floaters) {
      if (!f.on) continue
      f.age += dt
      if (f.age >= f.life) {
        f.on = false
        f.sp.visible = false
        continue
      }
      f.sp.position.set(f.x, f.y + f.age * 1.8, f.z)
      f.sp.material.opacity = f.age > f.life * 0.6 ? Math.max(0, 1 - (f.age - f.life * 0.6) / (f.life * 0.4)) : 1
    }
    for (const g of this.ghosts) {
      if (!g.on) continue
      g.age += dt
      if (g.age >= 1.3) {
        g.on = false
        g.sp.visible = false
        continue
      }
      g.sp.position.set(g.x, g.y + g.age * 1.6, g.z)
      g.sp.material.opacity = Math.max(0, 1 - g.age / 1.3)
    }
    for (const b of this.balls) {
      if (!b.on) continue
      b.age += dt
      const k = b.age / b.life
      if (k >= 1) {
        b.on = false
        b.mesh.visible = false
        continue
      }
      b.mesh.scale.setScalar(Math.max(0.1, b.radius * (0.25 + 0.75 * Math.sqrt(k))))
      ;(b.mesh.material as MeshBasicMaterial).opacity = 0.85 * (1 - k)
    }
    for (const l of this.fxLights) {
      if (!l.on) continue
      l.age += dt
      const k = l.age / l.life
      if (k >= 1) {
        l.on = false
        l.light.intensity = 0
        continue
      }
      l.light.intensity = l.peak * (1 - k) * (1 - k)
    }
  }

  // ------------------------------------------------------------ eventos
  private playerBy(frame: ShooterFrame, slot: number): RenderPlayer | undefined {
    return frame.players.find((p) => p.slot === slot)
  }

  private handleEvents(frame: ShooterFrame, reduced: boolean): void {
    const evs = this.events
    this.events = []
    const meSlot = frame.me
    const ov = this.overlay
    for (const e of evs) {
      switch (e.type) {
        case 'shot': {
          const w = WEAPONS[e.weapon]
          const mine = e.slot === meSlot
          let mx: number
          let mz: number
          let my = SHOT_H
          if (mine) {
            const c = this.camera.position
            const rx = -Math.sin(this.camYaw)
            const rz = Math.cos(this.camYaw)
            mx = c.x + Math.cos(this.camYaw) * 1.0 + rx * 0.45
            mz = c.z + Math.sin(this.camYaw) * 1.0 + rz * 0.45
            my = EYE_H - 0.55
            ov.onShot(e.weapon)
          } else {
            mx = (e.x + e.ax * 7) * U
            mz = (e.y + e.ay * 7) * U
            ov.onEnemyShot(e.slot)
          }
          this.big.add(mx, my, mz, e.ax * 0.3, 0.5, e.ay * 0.3, 0.45, SPAL.D!)
          this.small.add(mx, my, mz, e.ax * 2, 0.2, e.ay * 2, 0.07, SPAL.u!)
          this.flashLight(mx, my + 0.3, mz, '#FFC94A', reduced ? 12 : 24, 0.09, e.weapon === 'escopeta' || e.weapon === 'rifle' ? 13 : 10)
          if (e.weapon !== 'rifle') {
            const side = this.rnd() < 0.5 ? 1 : -1
            this.small.add(mx, my, mz, -e.ay * side * 1.6, 2.2, e.ax * side * 1.6, 0.7, SPAL.Y!, 12)
          }
          this.addShake(w.shake * (mine ? 1 : 0.5), e.x, e.y, mine)
          this.sfx(`tiro-${e.weapon}`, e.x, e.y, mine ? 1 : 0.8)
          break
        }
        case 'grenade':
          if (e.slot === meSlot) ov.onThrow()
          this.sfx('granada', e.x, e.y, 0.7)
          break
        case 'hit': {
          const v = this.playerBy(frame, e.victim)
          const node = this.nodes.get(e.victim)
          if (node) node.flash = 2
          const color = v ? this.colorOf(v.id) : SPAL.o!
          const a = this.playerBy(frame, e.attacker)
          const dx = a && v ? v.x - a.x : 0
          const dz = a && v ? v.y - a.y : 0
          const l = Math.hypot(dx, dz) || 1
          const n = 4 + Math.min(6, Math.round(e.damage / 10))
          for (let i = 0; i < n; i++) {
            this.small.add(e.x * U, SHOT_H, e.y * U, (dx / l) * 2 + (this.rnd() - 0.5) * 3, 1 + this.rnd() * 2.5, (dz / l) * 2 + (this.rnd() - 0.5) * 3, 0.4 + this.rnd() * 0.2, color, 10)
          }
          this.spawnFloater(`${Math.round(e.damage)}`, e.x * U, SHOT_H + 1.1, e.y * U, e.attacker === meSlot ? SPAL.y! : SPAL.p!)
          if (e.attacker === meSlot) {
            ov.onHit()
            this.sfxMine('hitmarker', 0.8)
          }
          if (e.victim === meSlot) {
            ov.onHurt()
            this.addShake(Math.min(4, 1 + e.damage / 25), e.x, e.y, true)
            this.sfxMine('dano', 0.9)
          } else if (e.attacker !== meSlot) this.sfx('dano', e.x, e.y, 0.4)
          break
        }
        case 'kill': {
          const v = this.playerBy(frame, e.victim)
          if (e.victim === meSlot) this.deathKiller = e.killer
          if (v) {
            const color = this.colorOf(v.id)
            this.spawnGhost(v.x * U, v.y * U, color)
            this.burst(v.x * U, 1.8, v.y * U, color, 12, 3.5, 2.5, 0.55, 9)
            const involved = e.victim === meSlot || e.killer === meSlot
            if (!reduced && involved) this.hitStop = 60
            if (e.killer === meSlot) this.sfxMine('abate', 1)
            else this.sfx('abate', v.x, v.y, 0.6)
          }
          break
        }
        case 'spawn': {
          const p = this.playerBy(frame, e.slot)
          const c = p ? this.colorOf(p.id) : SPAL.y!
          this.burst(e.x * U, 0.3, e.y * U, c, 8, 2.5, 3, 0.6, 5)
          for (let i = 0; i < 6; i++) this.big.add(e.x * U + (this.rnd() - 0.5), 0.3, e.y * U + (this.rnd() - 0.5), 0, 0.8, 0, 0.7, SPAL.P!)
          this.flashLight(e.x * U, 2, e.y * U, '#FFC94A', 28, 0.4, 8)
          if (e.slot === meSlot) this.sfxMine('renascer', 0.9)
          else this.sfx('renascer', e.x, e.y, 0.4)
          break
        }
        case 'pickup': {
          const pk = frame.pickups.find((x) => x.id === e.pickupId)
          const x = pk?.x ?? this.lastMe.x
          const y = pk?.y ?? this.lastMe.y
          const c = e.kind === 'vida' ? SPAL.g! : SPAL.y!
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2
            this.small.add(x * U, 1.5, y * U, Math.cos(a) * 2.2, 1.5, Math.sin(a) * 2.2, 0.4, c, 4)
          }
          const name = e.kind === 'vida' ? 'pegar-vida' : 'pegar-arma'
          if (e.slot === meSlot) this.sfxMine(name, 0.9)
          else this.sfx(name, x, y, 0.5)
          break
        }
        case 'explode':
          this.explosion(e.x * U, e.y * U, e.radius, reduced)
          this.addShake(5, e.x, e.y)
          this.sfx('explosao', e.x, e.y, 1)
          break
        case 'wall':
          for (let i = 0; i < 5; i++) {
            const a = this.rnd() * Math.PI * 2
            this.small.add(e.x * U, SHOT_H, e.y * U, Math.cos(a) * 2.5, 0.5 + this.rnd() * 2, Math.sin(a) * 2.5, 0.2 + this.rnd() * 0.15, this.rnd() < 0.5 ? SPAL.y! : SPAL.u!, 9)
          }
          break
        case 'dash': {
          const p = this.playerBy(frame, e.slot)
          if (p) this.sfx('dash', p.x, p.y, e.slot === meSlot ? 0.9 : 0.6)
          break
        }
        case 'phase':
          break
      }
    }
  }

  private countdown(frame: ShooterFrame): void {
    if (frame.phase === 'aquecendo') {
      const secs = Math.ceil(frame.timeLeftMs / 1000)
      if (secs !== this.lastCount && secs <= 5 && secs > 0) this.sfxMine('contagem', 0.6)
      this.lastCount = secs
    } else {
      if (this.lastPhase === 'aquecendo' && frame.phase === 'jogando') this.sfxMine('renascer', 0.7)
      this.lastCount = -1
    }
    this.lastPhase = frame.phase
  }

  // ------------------------------------------------------------ bonecos
  private bodyTexture(color: string, rows: string[], key: string, white: boolean): CanvasTexture {
    const k = `${color}|${key}|${white ? 1 : 0}`
    let t = this.bodyTex.get(k)
    if (!t) this.bodyTex.set(k, (t = pixelTexture(rowsToCanvas(rows, white ? this.whitePal : tintedPalette(color)))))
    return t
  }

  private makeNode(p: RenderPlayer): PNode {
    const mat = new MeshLambertMaterial({ transparent: true, alphaTest: 0.5, side: DoubleSide, emissive: '#666666' })
    const mesh = new Mesh(this.bodyGeo, mat)
    mesh.scale.set(BODY_PLANE_W, BODY_H, 1)
    mesh.visible = false
    const label = makeTextSprite(true)
    this.scene.add(mesh, label)
    return { mesh, mat, label, labelKey: '', lastX: p.x, lastY: p.y, walk: 0, stepAcc: 0, flash: 0, alive: p.alive, texKey: '' }
  }

  private syncPlayers(frame: ShooterFrame, me: RenderPlayer | null, reduced: boolean, dt: number): void {
    const seen = new Set<number>()
    const cx = this.camera.position.x
    const cz = this.camera.position.z
    let ns = 0
    const hideMe = !!me && me.alive && frame.phase !== 'fim'
    for (const p of frame.players) {
      seen.add(p.slot)
      let n = this.nodes.get(p.slot)
      if (!n) this.nodes.set(p.slot, (n = this.makeNode(p)))
      const isMe = p.slot === frame.me
      const show = p.alive && !(isMe && hideMe)
      n.mesh.visible = show
      n.label.visible = false
      const moved = Math.hypot(p.x - n.lastX, p.y - n.lastY)
      if (!p.alive || !n.alive) {
        n.lastX = p.x
        n.lastY = p.y
        n.walk = 0
        n.alive = p.alive
        if (!p.alive) continue
      }
      n.lastX = p.x
      n.lastY = p.y
      const moving = moved > 0.15 && moved < 40
      if (moving) {
        n.walk += moved
        n.stepAcc += moved
        if (n.stepAcc >= STEP_DIST) {
          n.stepAcc = 0
          if (!p.dashing) {
            if (isMe) this.sfxMine('passo', 0.35)
            else this.sfx('passo', p.x, p.y, 0.3)
          }
        }
      } else n.stepAcc = 0
      if (!show) continue
      const color = this.colorOf(p.id)
      const f = facing3d(cx * 16, cz * 16, p.x, p.y, p.ax, p.ay)
      const cycle = [1, 0, 2, 0][Math.floor(n.walk / 5) % 4]!
      const frameIdx = moving ? cycle : 0
      const white = n.flash > 0
      if (n.flash > 0) n.flash--
      const key = `${f}|${p.weapon}|${frameIdx}`
      const tex = this.bodyTexture(color, bodyFrame3d(f, p.weapon, frameIdx), key, white)
      const texKey = `${color}|${key}|${white ? 1 : 0}`
      if (n.texKey !== texKey) {
        n.texKey = texKey
        n.mat.map = tex
        n.mat.emissiveMap = tex
      }
      n.mat.emissive.setHex(white ? 0xffffff : 0x666666)
      n.mat.color.setHex(white ? 0xffffff : 0xffffff)
      n.mat.opacity = p.invulnerable && Math.floor(this.time * 18) % 2 === 0 ? 0.45 : 1
      n.mesh.position.set(p.x * U, 0, p.y * U)
      n.mesh.rotation.y = Math.atan2(cx - p.x * U, cz - p.y * U)
      // sombra redonda
      if (ns < MAX_SHADOWS) {
        this.dummy.position.set(p.x * U, 0.03, p.y * U)
        this.dummy.rotation.set(0, 0, 0)
        this.dummy.scale.setScalar(1.5)
        this.dummy.updateMatrix()
        this.shadows.setMatrixAt(ns++, this.dummy.matrix)
      }
      // rastro do dash
      if (p.dashing && (!reduced || this.frameNo % 3 === 0)) {
        for (let i = 0; i < 2; i++) this.small.add(p.x * U + (this.rnd() - 0.5) * 0.8, 0.8 + this.rnd() * 2, p.y * U + (this.rnd() - 0.5) * 0.8, 0, 0.2, 0, 0.3, color)
      }
      // nome (só perto; a parede esconde porque o sprite testa a profundidade)
      const dist = Math.hypot(p.x * U - cx, p.y * U - cz)
      if (dist < NAME_DIST && !isMe) {
        const lk = `${shortName(p.name)}|${color}`
        if (n.labelKey !== lk) {
          n.labelKey = lk
          setTextSprite(n.label, textTexture(shortName(p.name), color, true))
        }
        n.label.position.set(p.x * U, BODY_H + 0.45 + (p.hp < MAX_HP ? 0.1 : 0), p.y * U)
        // de perto o nome encolhe junto (fica mais ou menos do mesmo tamanho na tela)
        const k = clamp(dist / 9, 0.22, 1)
        n.label.scale.set((n.label.userData.baseW as number) * k, (n.label.userData.baseH as number) * k, 1)
        n.label.visible = true
      }
    }
    this.shadowCount = ns
    for (const [slot, n] of this.nodes) {
      if (seen.has(slot)) continue
      this.dropNode(n)
      this.nodes.delete(slot)
    }
    void dt
  }
  private shadowCount = 0

  // ------------------------------------------------------------ projéteis
  private syncProjectiles(frame: ShooterFrame, me: RenderPlayer | null, dt: number): void {
    const cyaw = this.camYaw
    const rx = -Math.sin(cyaw)
    const rz = Math.cos(cyaw)
    const meSlot = frame.me
    let nb = 0
    let ng = 0
    let ns = this.shadowCount
    const seen = new Set<number>()
    const d = this.dummy
    for (const pr of frame.projectiles) {
      seen.add(pr.id)
      let age = this.projSeen.get(pr.id)
      if (age === undefined) {
        // tiro confirmado que aparece longe de você não precisa convergir
        const far = me ? Math.hypot(pr.x - me.x, pr.y - me.y) > 48 : true
        age = pr.owner === meSlot && (pr.predicted || !far) ? 0 : 1
      } else age += dt
      this.projSeen.set(pr.id, age)
      let x = pr.x * U
      let z = pr.y * U
      let y = SHOT_H
      if (pr.owner === meSlot && age < 0.12) {
        // sai do cano (direita e abaixo) e converge para o caminho real em ~0,12 s
        const k = 1 - age / 0.12
        x += rx * 0.55 * k
        z += rz * 0.55 * k
        y -= 0.5 * k
      }
      const sp = Math.hypot(pr.vx, pr.vy)
      if (pr.kind === 'granada') {
        if (ng >= MAX_GRENADES) continue
        y = 0.45 + Math.abs(Math.sin(this.time * 10 + pr.id)) * clamp(sp / 80, 0, 1.6)
        d.position.set(x, y, z)
        d.rotation.set(this.time * 4, 0, 0)
        d.scale.setScalar(1)
        d.updateMatrix()
        this.grenades.setMatrixAt(ng++, d.matrix)
        if (ns < MAX_SHADOWS) {
          d.position.set(x, 0.03, z)
          d.rotation.set(0, 0, 0)
          d.scale.setScalar(0.7)
          d.updateMatrix()
          this.shadows.setMatrixAt(ns++, d.matrix)
        }
        continue
      }
      if (nb >= MAX_BOLTS) continue
      const dirx = sp > 0.001 ? pr.vx / sp : 1
      const dirz = sp > 0.001 ? pr.vy / sp : 0
      let len = 0.2
      let thick = 0.16
      let color = '#FFE9A6'
      if (pr.kind === 'bago') {
        thick = 0.12
        len = 0.16
        color = '#FFC94A'
      } else if (pr.kind === 'rifle') {
        len = 3.2
        thick = 0.09
        color = '#F3EBDD'
      } else if (pr.kind === 'rolha') {
        len = 0.8
        thick = 0.34
        color = SPAL.o!
      }
      d.position.set(x - dirx * len * 0.5, y, z - dirz * len * 0.5)
      d.rotation.set(0, Math.atan2(dirx, dirz), 0)
      d.scale.set(thick, thick, len)
      d.updateMatrix()
      this.bolts.setMatrixAt(nb, d.matrix)
      this.bolts.setColorAt(nb, this.tmpColor.set(color))
      nb++
      // rastros
      if (pr.kind === 'rolha') {
        if (this.frameNo % 2 === 0) this.big.add(x - dirx * 0.6, y, z - dirz * 0.6, 0, 0.1, 0, 0.45, SPAL.D!)
        this.small.add(x - dirx * 0.5, y, z - dirz * 0.5, 0, 0, 0, 0.12, SPAL.y!)
      } else if (pr.kind === 'rifle') this.small.add(x - dirx * len, y, z - dirz * len, 0, 0, 0, 0.1, SPAL.p!)
    }
    for (const id of this.projSeen.keys()) if (!seen.has(id)) this.projSeen.delete(id)
    this.bolts.count = nb
    this.bolts.instanceMatrix.needsUpdate = true
    if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true
    this.grenades.count = ng
    this.grenades.instanceMatrix.needsUpdate = true
    this.shadows.count = ns
    this.shadows.instanceMatrix.needsUpdate = true
  }

  // ------------------------------------------------------------ caixas
  private pickTexture(kind: string): CanvasTexture {
    let t = this.pickTex.get(kind)
    if (!t) this.pickTex.set(kind, (t = pixelTexture(rowsToCanvas(pickupRows(kind as WeaponId | 'vida')))))
    return t
  }

  private makePick(kind: string): PickNode {
    const mat = new MeshBasicMaterial({ map: this.pickTexture(kind), transparent: true, alphaTest: 0.3, side: DoubleSide })
    const mesh = new Mesh(new PlaneGeometry(1.4, 1.4), mat)
    mesh.renderOrder = 2
    const cv = document.createElement('canvas')
    cv.width = cv.height = 48
    const ringTex = pixelTexture(cv)
    const ring = new Mesh(new PlaneGeometry(3, 3).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, fog: false }))
    ring.visible = false
    ring.renderOrder = 1
    this.scene.add(mesh, ring)
    return { mesh, mat, ring, ringCv: cv, ringTex, ringKey: -1, kind }
  }

  private syncPickups(frame: ShooterFrame): void {
    const seen = new Set<number>()
    for (const pk of frame.pickups) {
      seen.add(pk.id)
      let n = this.pickNodes.get(pk.id)
      if (n && n.kind !== pk.kind) {
        this.dropPick(n)
        n = undefined
      }
      if (!n) this.pickNodes.set(pk.id, (n = this.makePick(pk.kind)))
      const bob = pk.available ? Math.sin(this.time * 2.6 + pk.id) * 0.12 : 0
      n.mesh.position.set(pk.x * U, 1.5 + bob, pk.y * U)
      n.mesh.rotation.y = this.time * 1.6 + pk.id
      n.mat.opacity = pk.available ? 1 : 0.3
      n.ring.visible = !pk.available
      if (!pk.available) {
        n.ring.position.set(pk.x * U, 0.04, pk.y * U)
        const q = Math.round(clamp(pk.ready, 0, 1) * 60)
        if (q !== n.ringKey) {
          n.ringKey = q
          const ctx = n.ringCv.getContext('2d')!
          ctx.clearRect(0, 0, 48, 48)
          ctx.fillStyle = SPAL.D!
          for (const [dx, dy] of ringPoints(20, 1)) ctx.fillRect(24 + dx, 24 + dy, 1, 1)
          ctx.fillStyle = SPAL.y!
          for (const [dx, dy] of ringPoints(20, pk.ready)) ctx.fillRect(24 + dx, 24 + dy, 1, 1)
          n.ringTex.needsUpdate = true
        }
      } else n.ringKey = -1
    }
    for (const [id, n] of this.pickNodes) {
      if (seen.has(id)) continue
      this.dropPick(n)
      this.pickNodes.delete(id)
    }
  }
}

