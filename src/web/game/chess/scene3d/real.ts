/**
 * Visual realista do xadrez 3D (liberado pelo código secreto: cima, cima, baixo, baixo, esquerda, direita).
 * Peças torneadas em buxo e ébano com verniz, tabuleiro de marfim e nogueira com veio, moldura com as
 * letras gravadas, sombra macia e reflexo de uma sala (RoomEnvironment). Tudo gerado por código:
 * a geometria vem de `lathe.ts` e o veio de `wood.ts`.
 *
 * Usa o mesmo motor do 8 bits (`engine.ts`): câmera, clique, marcas e animação são os mesmos.
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  RingGeometry,
  Shape,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { colorOf, typeOf, type PieceType } from '../../../../shared/games/chess/rules'
import { Chess3DEngine, type Look } from './engine'
import { KNIGHT_BEVEL, KNIGHT_DEPTH, KNIGHT_HEAD_Y, KNIGHT_OUTLINE, merge, piecePart, type Part } from './lathe'
import { paintGrain, type GrainOpts } from './wood'

const BG = '#16110E'
const FILES = 'abcdefgh'
/** casas: marfim (bordo) e nogueira */
const MAPLE = { dark: '#B48A5A', light: '#E6CFA6' }
const WALNUT = { dark: '#3E2415', light: '#7A4C2E' }
const FRAME = { dark: '#2A170D', light: '#5A341E' }
const TABLE = { dark: '#140D09', light: '#2C1C13' }
/** lado da moldura (casas) */
const FRAME_SIZE = 9.4

/** canvas pintado com veio → textura */
function woodTexture(w: number, h: number, paint: (img: ImageData) => void): CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(w, h)
  paint(img)
  ctx.putImageData(img, 0, 0)
  const tex = new CanvasTexture(cv)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** as 64 casas, com o veio alternando de direção como nos tabuleiros de marchetaria */
function boardTexture(): CanvasTexture {
  const S = 128
  return woodTexture(S * 8, S * 8, (img) => {
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) {
        const light = (f + r) % 2 === 1
        const c = light ? MAPLE : WALNUT
        const o: GrainOpts = { seed: f * 8 + r + 1, alongY: (f + r) % 2 === 0, rings: light ? 4 : 6, wobble: 18 }
        // canvas: linha 0 = fileira 8 (lado das pretas, -z)
        paintGrain(img.data, S * 8, f * S, (7 - r) * S, S, S, c.dark, c.light, o)
      }
  })
}

/** tampo da moldura: nogueira escura com filete claro e as letras e números gravados */
function frameTexture(): CanvasTexture {
  const N = 1024
  const tex = woodTexture(N, N, (img) => paintGrain(img.data, N, 0, 0, N, N, FRAME.dark, FRAME.light, { seed: 99, rings: 3, wobble: 30 }))
  const ctx = (tex.image as HTMLCanvasElement).getContext('2d')!
  const u = N / FRAME_SIZE
  const c = N / 2
  // filete em volta das casas
  ctx.strokeStyle = 'rgba(226, 196, 140, 0.85)'
  ctx.lineWidth = 3
  ctx.strokeRect(c - 4.08 * u, c - 4.08 * u, 8.16 * u, 8.16 * u)
  ctx.font = `600 ${Math.round(u * 0.36)}px Georgia, "Times New Roman", serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(232, 208, 160, 0.9)'
  const text = (s: string, x: number, y: number, rot: number) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.fillText(s, 0, 0)
    ctx.restore()
  }
  const m = 4.42 * u
  for (let i = 0; i < 8; i++) {
    const a = c + (i - 3.5) * u
    text(FILES[i], a, c + m, 0)
    text(FILES[i], a, c - m, Math.PI)
    text(String(i + 1), c - m, c + (3.5 - i) * u, 0)
    text(String(i + 1), c + m, c + (3.5 - i) * u, Math.PI)
  }
  tex.needsUpdate = true
  return tex
}

/** veio fino das peças (multiplica a cor): corre ao longo da altura */
function pieceGrain(seed: number): CanvasTexture {
  const tex = woodTexture(256, 256, (img) => paintGrain(img.data, 256, 0, 0, 256, 256, '#C9C2BA', '#FFFFFF', { seed, alongY: true, rings: 9, wobble: 10 }))
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(3, 1)
  return tex
}

function partGeometry(p: Part): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(p.pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(p.normal, 3))
  g.setAttribute('uv', new Float32BufferAttribute(p.uv, 2))
  g.setAttribute(
    'color',
    new Float32BufferAttribute(
      p.shade.flatMap((s) => [s, s, s]),
      3
    )
  )
  g.computeBoundingSphere()
  return g
}

/** cabeça do cavalo: o contorno extrudado com a borda boleada, como entalhado */
function knightHead(): Part {
  const sh = new Shape()
  for (const c of KNIGHT_OUTLINE) {
    if (c[0] === 'm') sh.moveTo(c[1], c[2])
    else if (c[0] === 'l') sh.lineTo(c[1], c[2])
    else if (c[0] === 'q') sh.quadraticCurveTo(c[1], c[2], c[3], c[4])
  }
  const g = new ExtrudeGeometry(sh, { depth: KNIGHT_DEPTH, bevelEnabled: true, bevelThickness: KNIGHT_BEVEL, bevelSize: 0.03, bevelSegments: 5, curveSegments: 14 })
  g.translate(0, KNIGHT_HEAD_Y, -KNIGHT_DEPTH / 2)
  const flat = g.index ? g.toNonIndexed() : g
  const pos = Array.from(flat.getAttribute('position').array)
  const out: Part = {
    pos,
    normal: Array.from(flat.getAttribute('normal').array),
    uv: Array.from(flat.getAttribute('uv').array).map((v) => v * 2.5),
    shade: new Array(pos.length / 3).fill(1)
  }
  g.dispose()
  if (flat !== g) flat.dispose()
  return out
}

export function realLook(): Look {
  const geoms = new Map<PieceType, BufferGeometry>()
  const textures: Texture[] = []
  const grainW = pieceGrain(5)
  const grainB = pieceGrain(11)
  textures.push(grainW, grainB)
  // buxo encerado e ébano envernizado
  const mats = {
    w: new MeshPhysicalMaterial({ color: '#EAD9B8', map: grainW, vertexColors: true, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.22, sheen: 0.3, sheenColor: new Color('#FFF3DC') }),
    b: new MeshPhysicalMaterial({ color: '#3A2519', map: grainB, vertexColors: true, roughness: 0.34, clearcoat: 0.9, clearcoatRoughness: 0.12 })
  }
  const dotGeo = new CylinderGeometry(0.14, 0.14, 0.012, 32)
  const dotMat = new MeshBasicMaterial({ color: '#120B07', transparent: true, opacity: 0.42, depthWrite: false })
  const ringGeo = new RingGeometry(0.4, 0.47, 48)
  ringGeo.rotateX(-Math.PI / 2)
  const ringMat = new MeshBasicMaterial({ color: '#FF7A6B', transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })
  let envTex: Texture | null = null

  const geometryFor = (type: PieceType): BufferGeometry => {
    let g = geoms.get(type)
    if (g) return g
    const part = type === 'n' ? merge(piecePart('n', 48), knightHead()) : piecePart(type, 48)
    g = partGeometry(part)
    geoms.set(type, g)
    return g
  }

  return {
    pixelated: false,
    moveMs: 420,
    hop: 0.5,
    camera: { pitch: 0.82, dist: 14.6 },
    build(scene, renderer: WebGLRenderer) {
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = PCFSoftShadowMap
      const pm = new PMREMGenerator(renderer)
      envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture
      pm.dispose()
      scene.environment = envTex
      scene.environmentIntensity = 0.45
      scene.background = new Color(BG)
      scene.fog = new Fog(BG, 22, 42)
      const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())

      // luz: abajur quente de um lado, sombra macia; céu fraco para não ficar preto do outro lado
      scene.add(new HemisphereLight('#FFE7C4', '#1A110C', 0.55))
      const lamp = new DirectionalLight('#FFE1B5', 2.6)
      lamp.position.set(-5, 11, 4.5)
      lamp.castShadow = true
      lamp.shadow.mapSize.set(2048, 2048)
      const sc = lamp.shadow.camera
      sc.left = -7
      sc.right = 7
      sc.top = 7
      sc.bottom = -7
      sc.near = 2
      sc.far = 30
      lamp.shadow.bias = -0.0004
      lamp.shadow.normalBias = 0.015
      lamp.shadow.radius = 3
      scene.add(lamp)
      const rim = new DirectionalLight('#BFD3FF', 0.35)
      rim.position.set(6, 5, -7)
      scene.add(rim)

      const g = new Group()
      // casas: uma placa só com o tampo de marchetaria
      const top = boardTexture()
      const frameTop = frameTexture()
      const sideWood = woodTexture(512, 64, (img) => paintGrain(img.data, 512, 0, 0, 512, 64, FRAME.dark, FRAME.light, { seed: 42, rings: 3 }))
      const tableTex = woodTexture(1024, 1024, (img) => paintGrain(img.data, 1024, 0, 0, 1024, 1024, TABLE.dark, TABLE.light, { seed: 7, rings: 2, wobble: 40 }))
      tableTex.wrapS = tableTex.wrapT = RepeatWrapping
      tableTex.repeat.set(4, 4)
      for (const t of [top, frameTop, sideWood, tableTex]) {
        t.anisotropy = aniso
        textures.push(t)
      }
      const lacquer = { roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 }
      const topMat = new MeshPhysicalMaterial({ map: top, ...lacquer })
      const sideMat = new MeshPhysicalMaterial({ map: sideWood, ...lacquer, roughness: 0.45 })
      const squares = new Mesh(new BoxGeometry(8, 0.1, 8), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat])
      squares.position.y = -0.05
      squares.receiveShadow = true
      // moldura: caixa com o tampo (as letras) um pouco abaixo das casas
      const frame = new Mesh(new BoxGeometry(FRAME_SIZE, 0.32, FRAME_SIZE), sideMat)
      frame.position.y = -0.172
      frame.receiveShadow = true
      frame.castShadow = true
      const lid = new Mesh(new PlaneGeometry(FRAME_SIZE, FRAME_SIZE), new MeshPhysicalMaterial({ map: frameTop, ...lacquer }))
      lid.rotation.x = -Math.PI / 2
      lid.position.y = -0.011
      lid.receiveShadow = true
      // mesa
      const table = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ map: tableTex, roughness: 0.7 }))
      table.rotation.x = -Math.PI / 2
      table.position.y = -0.332
      table.receiveShadow = true
      g.add(squares, frame, lid, table)
      scene.add(g)
    },
    piece(piece, sq) {
      const type = typeOf(piece) as PieceType
      const side = colorOf(piece) === 'w' ? 'w' : 'b'
      const m = new Mesh(geometryFor(type), mats[side])
      m.castShadow = true
      m.receiveShadow = true
      // o cavalo olha para o adversário (o focinho do contorno aponta para +x), meio virado para o
      // centro do tabuleiro: de frente ele seria uma placa, assim aparece o perfil
      if (type === 'n') {
        const toCenter = sq.charCodeAt(0) - 97 < 4 ? 1 : -1
        m.rotation.y = side === 'w' ? Math.PI / 2 - 0.6 * toCenter : -Math.PI / 2 + 0.6 * toCenter
      }
      return m
    },
    target(capture) {
      const m = capture ? new Mesh(ringGeo, ringMat) : new Mesh(dotGeo, dotMat)
      m.position.y = capture ? 0.004 : 0.008
      return m
    },
    dispose() {
      for (const g of geoms.values()) g.dispose()
      geoms.clear()
      for (const t of textures) t.dispose()
      envTex?.dispose()
      for (const x of [mats.w, mats.b, dotGeo, dotMat, ringGeo, ringMat]) x.dispose()
    }
  }
}

/** motor com o visual realista (o Chess3D carrega este arquivo só quando a pessoa escolhe "Real") */
export const createRealEngine = (host: HTMLElement): Chess3DEngine => new Chess3DEngine(host, realLook())
