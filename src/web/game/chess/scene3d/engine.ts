/**
 * Tabuleiro do xadrez em 3D (Three.js), com as peças em voxel feitas da mesma pixel art do 2D.
 * Só este diretório e o do golfe importam `three` (carrega sob demanda, quando a pessoa escolhe 3D).
 *
 * Desenha em resolução baixa e amplia sem suavizar (cara de 8 bits). Só redesenha quando algo muda.
 * Clique escolhe a casa (a regra de seleção fica no ChessScene); arrastar gira a câmera; roda aproxima.
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D
} from 'three'
import { colorOf, typeOf, type PieceType } from '../../../../shared/games/chess/rules'
import { pieceVoxels, voxelMesh } from './voxels'

/** altura virtual da imagem (pixels "gordos") */
const VIRTUAL_H = 280
const BG = '#221C19'
const LIGHT = '#C9B79C'
const DARK = '#8C6E58'
const WOOD = '#6E4A36'
const WOOD_DARK = '#4E3426'
const LAMP = '#FFC94A'
const CORAL = '#FF7A6B'
const FILES = 'abcdefgh'
const MOVE_MS = 260

/** cores das peças: corpo e friso */
const PIECE_COLORS = {
  w: { body: '#F3EBDD', trim: '#B7A99A' },
  b: { body: '#5E4B40', trim: '#241B16' }
}

export interface Chess3DProps {
  board: string[]
  /** de pretas: a câmera começa do outro lado */
  flip: boolean
  sel: string | null
  targets: string[]
  last: { from: string; to: string } | null
  check: string | null
  /** casa do cursor do teclado (null = sem foco de teclado) */
  cursor: string | null
  myTurn: boolean
  reducedMotion: boolean
  /** muda a cada lance (para animar o último) */
  moveKey: number
  /** casas que podem ser escolhidas agora (peças suas com lance e os destinos) */
  clickable: (sq: string) => boolean
  onSquare: (sq: string) => void
}

const fileOf = (s: string) => s.charCodeAt(0) - 97
const rankOf = (s: string) => Number(s[1]) - 1
const sqName = (f: number, r: number) => FILES[f] + String(r + 1)
/** centro da casa no mundo: brancas do lado +z */
const posOf = (s: string) => new Vector3(fileOf(s) - 3.5, 0, 3.5 - rankOf(s))

function disposeTree(o: Object3D): void {
  o.traverse((x) => {
    const m = x as Mesh
    m.geometry?.dispose()
    const mat = m.material as Material | Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((y) => y.dispose())
    else if (mat) {
      ;(mat as MeshBasicMaterial).map?.dispose()
      mat.dispose()
    }
  })
}

/** textura de texto em pixel (letras e números da borda) */
function textTexture(text: string, color: string): CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 16
  cv.height = 16
  const ctx = cv.getContext('2d')!
  ctx.font = '600 13px "Pixelify Sans Variable", "Pixelify Sans", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, 8, 9)
  const tex = new CanvasTexture(cv)
  tex.magFilter = NearestFilter
  tex.minFilter = NearestFilter
  return tex
}

/** quadradinho vazado (cursor do teclado) */
function outlineTexture(color: string): CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 16
  cv.height = 16
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 16, 1)
  ctx.fillRect(0, 15, 16, 1)
  ctx.fillRect(0, 0, 1, 16)
  ctx.fillRect(15, 0, 1, 16)
  const tex = new CanvasTexture(cv)
  tex.magFilter = NearestFilter
  tex.minFilter = NearestFilter
  return tex
}

export class Chess3DEngine {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(38, 1, 0.1, 100)
  private piecesGroup = new Group()
  private marks = new Group()
  private geoms = new Map<string, BufferGeometry>()
  private pieceMat = new MeshLambertMaterial({ vertexColors: true })
  private pieces = new Map<string, Mesh>()
  private props: Chess3DProps | null = null
  private lastKey = -1
  private anim: { mesh: Mesh; from: Vector3; to: Vector3; t0: number } | null = null
  private raf = 0
  private dirty = true
  private w = 1
  private h = 1
  /** câmera em órbita: yaw em volta do tabuleiro, pitch de cima, distância */
  private yaw = 0
  private pitch = 0.92
  private dist = 15.5
  private baseYaw = 0
  private flipped: boolean | null = null
  private press: { x: number; y: number; yaw: number; pitch: number; moved: boolean; id: number } | null = null
  private ray = new Raycaster()
  private ground = new Plane(new Vector3(0, 1, 0), 0)
  // marcas reaproveitadas
  private hl: Record<'from' | 'to' | 'check' | 'sel' | 'cursor', Mesh>
  private dotGeo = new BoxGeometry(0.14, 0.06, 0.14)
  private ringGeo = new BoxGeometry(0.16, 0.06, 0.16)
  private markMat = new MeshBasicMaterial({ color: LAMP })
  private ringMat = new MeshBasicMaterial({ color: CORAL })

  constructor(host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(1)
    const cv = this.renderer.domElement
    cv.className = 'chess3d-canvas'
    host.appendChild(cv)
    this.scene.background = new Color(BG)
    this.scene.add(new HemisphereLight('#FFE8C0', '#2A211C', 1.5))
    this.scene.add(new AmbientLight(LAMP, 0.25))
    // abajur: luz quente de cima, um pouco de lado (as peças ficam com um lado na sombra)
    const lamp = new DirectionalLight('#FFF1D6', 1.9)
    lamp.position.set(-3, 10, 4)
    this.scene.add(lamp)

    this.buildBoard()
    const plane = (color: string, opacity: number, y: number) => {
      const m = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
      m.rotation.x = -Math.PI / 2
      m.position.y = y
      m.visible = false
      this.scene.add(m)
      return m
    }
    const cursor = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: outlineTexture(LAMP), transparent: true, depthWrite: false }))
    cursor.rotation.x = -Math.PI / 2
    cursor.position.y = 0.012
    cursor.visible = false
    this.scene.add(cursor)
    this.hl = { from: plane(LAMP, 0.3, 0.004), to: plane(LAMP, 0.38, 0.005), check: plane(CORAL, 0.7, 0.006), sel: plane(LAMP, 0.6, 0.007), cursor }
    this.scene.add(this.piecesGroup, this.marks)

    cv.addEventListener('pointerdown', this.onDown)
    cv.addEventListener('pointermove', this.onMove)
    cv.addEventListener('pointerup', this.onUp)
    cv.addEventListener('pointercancel', this.onCancel)
    cv.addEventListener('wheel', this.onWheel, { passive: false })
    cv.addEventListener('contextmenu', (e) => e.preventDefault())
    this.raf = requestAnimationFrame(this.frame)
  }

  private buildBoard(): void {
    const g = new Group()
    // casas: blocos baixos (a borda de cada casa aparece de lado, bem 8 bits)
    const tile = new BoxGeometry(1, 0.14, 1)
    const light = new MeshLambertMaterial({ color: LIGHT })
    const dark = new MeshLambertMaterial({ color: DARK })
    for (let f = 0; f < 8; f++)
      for (let r = 0; r < 8; r++) {
        const m = new Mesh(tile, (f + r) % 2 === 1 ? light : dark)
        m.position.set(f - 3.5, -0.07, 3.5 - r)
        g.add(m)
      }
    // moldura de madeira e a base
    const frame = new Mesh(new BoxGeometry(9.3, 0.3, 9.3), new MeshLambertMaterial({ color: WOOD }))
    frame.position.y = -0.2
    const base = new Mesh(new BoxGeometry(9.7, 0.3, 9.7), new MeshLambertMaterial({ color: WOOD_DARK }))
    base.position.y = -0.45
    g.add(frame, base)
    // letras e números na moldura (dos dois lados, para quem joga de pretas também)
    const label = (text: string, x: number, z: number, rot: number) => {
      const m = new Mesh(new PlaneGeometry(0.42, 0.42), new MeshBasicMaterial({ map: textTexture(text, '#F3EBDD'), transparent: true, depthWrite: false }))
      m.rotation.set(-Math.PI / 2, 0, rot)
      m.position.set(x, -0.045, z)
      g.add(m)
    }
    for (let i = 0; i < 8; i++) {
      label(FILES[i], i - 3.5, 4.33, 0)
      label(FILES[i], i - 3.5, -4.33, Math.PI)
      label(String(i + 1), -4.33, 3.5 - i, 0)
      label(String(i + 1), 4.33, 3.5 - i, Math.PI)
    }
    this.scene.add(g)
  }

  private geometryFor(piece: string): BufferGeometry {
    let geo = this.geoms.get(piece)
    if (geo) return geo
    const type = typeOf(piece) as PieceType
    const side = colorOf(piece) === 'w' ? 'w' : 'b'
    const mesh = voxelMesh(pieceVoxels(type), 1 / 16)
    const body = new Color(PIECE_COLORS[side].body)
    const trim = new Color(PIECE_COLORS[side].trim)
    const col: number[] = []
    for (const t of mesh.trim) {
      const c = t ? trim : body
      col.push(c.r, c.g, c.b)
    }
    geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(mesh.pos, 3))
    geo.setAttribute('normal', new Float32BufferAttribute(mesh.normal, 3))
    geo.setAttribute('color', new Float32BufferAttribute(col, 3))
    geo.setIndex(mesh.index)
    this.geoms.set(piece, geo)
    return geo
  }

  private makePiece(piece: string, sq: string): Mesh {
    const m = new Mesh(this.geometryFor(piece), this.pieceMat)
    m.position.copy(posOf(sq))
    // o cavalo olha para o lado do adversário (o desenho tem o focinho à esquerda)
    if (typeOf(piece) === 'n') m.rotation.y = colorOf(piece) === 'w' ? -Math.PI / 2 : Math.PI / 2
    m.userData = { sq, piece }
    return m
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w)
    this.h = Math.max(1, h)
    const dpr = window.devicePixelRatio || 1
    const px = Math.max(1, Math.round((this.h * dpr) / VIRTUAL_H))
    this.renderer.setSize(Math.max(1, Math.round((this.w * dpr) / px)), Math.max(1, Math.round((this.h * dpr) / px)), false)
    this.camera.aspect = this.w / this.h
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  setProps(p: Chess3DProps): void {
    const prev = this.props
    this.props = p
    if (this.flipped !== p.flip) {
      this.flipped = p.flip
      this.baseYaw = p.flip ? Math.PI : 0
      this.yaw = this.baseYaw
    }
    if (!prev || prev.board !== p.board) this.syncPieces(p)
    // marcas
    const put = (m: Mesh, sq: string | null) => {
      m.visible = !!sq
      if (sq) {
        const v = posOf(sq)
        m.position.x = v.x
        m.position.z = v.z
      }
    }
    put(this.hl.from, p.last?.from ?? null)
    put(this.hl.to, p.last?.to ?? null)
    put(this.hl.check, p.check)
    put(this.hl.sel, p.sel)
    put(this.hl.cursor, p.cursor)
    disposeMarks(this.marks)
    for (const t of p.targets) {
      const v = posOf(t)
      const occupied = p.board[fileOf(t) + rankOf(t) * 8] !== '.'
      if (occupied) {
        // captura: quatro cubinhos coral nos cantos
        for (const [dx, dz] of [
          [-0.38, -0.38],
          [0.38, -0.38],
          [-0.38, 0.38],
          [0.38, 0.38]
        ]) {
          const m = new Mesh(this.ringGeo, this.ringMat)
          m.position.set(v.x + dx, 0.03, v.z + dz)
          this.marks.add(m)
        }
      } else {
        const m = new Mesh(this.dotGeo, this.markMat)
        m.position.set(v.x, 0.03, v.z)
        this.marks.add(m)
      }
    }
    this.dirty = true
  }

  /** põe as peças nas casas; o último lance desliza (com um pulinho) */
  private syncPieces(p: Chess3DProps): void {
    const want = new Map<string, string>()
    p.board.forEach((pc, i) => {
      if (pc !== '.') want.set(sqName(i % 8, Math.floor(i / 8)), pc)
    })
    for (const [sq, mesh] of this.pieces) {
      if (want.get(sq) !== mesh.userData.piece) {
        this.piecesGroup.remove(mesh)
        this.pieces.delete(sq)
      }
    }
    for (const [sq, pc] of want) {
      if (this.pieces.has(sq)) continue
      const m = this.makePiece(pc, sq)
      this.pieces.set(sq, m)
      this.piecesGroup.add(m)
    }
    const animate = p.moveKey !== this.lastKey && this.lastKey >= 0 && p.last && !p.reducedMotion
    this.lastKey = p.moveKey
    if (animate && p.last) {
      const mesh = this.pieces.get(p.last.to)
      if (mesh) {
        const from = posOf(p.last.from)
        const to = posOf(p.last.to)
        mesh.position.copy(from)
        this.anim = { mesh, from, to, t0: performance.now() }
      }
    } else this.anim = null
  }

  // ---------- entrada ----------
  private ndc(e: PointerEvent): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  /** casa sob o ponteiro: a peça na frente vale (a cabeça dela passa da casa), senão o chão */
  private squareAt(e: PointerEvent): string | null {
    this.ray.setFromCamera(this.ndc(e), this.camera)
    const hit = this.ray.intersectObjects([...this.pieces.values()], false)[0]
    if (hit) return (hit.object.userData as { sq: string }).sq
    const p = new Vector3()
    if (!this.ray.ray.intersectPlane(this.ground, p)) return null
    const f = Math.floor(p.x + 4)
    const r = Math.floor(4 - p.z)
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? sqName(f, r) : null
  }

  private onDown = (e: PointerEvent): void => {
    this.renderer.domElement.setPointerCapture(e.pointerId)
    this.press = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, moved: false, id: e.pointerId }
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.press
    if (p && p.id === e.pointerId) {
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      if (!p.moved && Math.hypot(dx, dy) > 6) p.moved = true
      if (p.moved) {
        // girar: até 80 graus para cada lado e entre bem deitado e quase de cima
        this.yaw = Math.max(this.baseYaw - 1.4, Math.min(this.baseYaw + 1.4, p.yaw - dx * 0.008))
        this.pitch = Math.max(0.45, Math.min(1.35, p.pitch + dy * 0.006))
        this.dirty = true
        this.renderer.domElement.style.cursor = 'grabbing'
      }
      return
    }
    const sq = this.squareAt(e)
    this.renderer.domElement.style.cursor = sq && this.props?.clickable(sq) ? 'pointer' : 'grab'
  }

  private onUp = (e: PointerEvent): void => {
    const p = this.press
    this.press = null
    if (!p || p.id !== e.pointerId) return
    this.renderer.domElement.style.cursor = ''
    if (p.moved) return
    const sq = this.squareAt(e)
    if (sq) this.props?.onSquare(sq)
  }

  private onCancel = (): void => {
    this.press = null
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.dist = Math.max(9, Math.min(21, this.dist * (e.deltaY > 0 ? 1.08 : 1 / 1.08)))
    this.dirty = true
  }

  /** volta a câmera para o lugar de sempre */
  resetView(): void {
    this.yaw = this.baseYaw
    this.pitch = 0.92
    this.dist = 15.5
    this.dirty = true
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame)
    const a = this.anim
    if (a) {
      const t = Math.min(1, (now - a.t0) / MOVE_MS)
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      a.mesh.position.lerpVectors(a.from, a.to, e)
      a.mesh.position.y = Math.sin(Math.PI * t) * 0.35
      if (t >= 1) {
        a.mesh.position.copy(a.to)
        this.anim = null
      }
      this.dirty = true
    }
    if (!this.dirty) return
    this.dirty = false
    const cp = Math.cos(this.pitch)
    this.camera.position.set(Math.sin(this.yaw) * cp * this.dist, Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * cp * this.dist)
    // olha um pouco além do meio (o lado de lá fica menor na perspectiva): o tabuleiro fica centrado
    this.camera.lookAt(-Math.sin(this.yaw) * 0.9, -0.3, -Math.cos(this.yaw) * 0.9)
    this.renderer.render(this.scene, this.camera)
  }

  /** onde a casa aparece na tela (px da página); para testes no laboratório */
  screenOf(sq: string): { x: number; y: number } {
    const v = posOf(sq).project(this.camera)
    const r = this.renderer.domElement.getBoundingClientRect()
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    const cv = this.renderer.domElement
    cv.removeEventListener('pointerdown', this.onDown)
    cv.removeEventListener('pointermove', this.onMove)
    cv.removeEventListener('pointerup', this.onUp)
    cv.removeEventListener('pointercancel', this.onCancel)
    cv.removeEventListener('wheel', this.onWheel)
    disposeMarks(this.marks)
    for (const g of this.geoms.values()) g.dispose()
    this.geoms.clear()
    this.piecesGroup.clear()
    disposeTree(this.scene)
    this.dotGeo.dispose()
    this.ringGeo.dispose()
    this.markMat.dispose()
    this.ringMat.dispose()
    this.pieceMat.dispose()
    this.renderer.dispose()
    cv.remove()
  }
}

/** tira as marcas de destino (a geometria e o material são compartilhados: não descarta) */
function disposeMarks(g: Group): void {
  g.clear()
}
