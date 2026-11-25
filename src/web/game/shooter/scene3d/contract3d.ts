/**
 * CONTRATO do Tiro na Sala em primeira pessoa (3D, Three.js). Escrito pelo planejador; os agentes
 * implementam e não mudam sem combinar.
 *
 * A simulação, a rede e os robôs NÃO mudam: o mundo continua 2D (px, tile = 16 px). O 3D é só outra
 * cena que implementa o mesmo `ShooterSceneProps` (../contract.ts), escolhida por um botão 2D/3D.
 *
 * Eixos: mundo (x, y) em px  ->  Three (X = x / 16, Z = y / 16), Y para cima. 1 unidade = 1 tile (~0,5 m).
 * Visto de cima (+Y), X para a direita e Z para baixo: igual ao mapa 2D, sem espelhar.
 * Mira `yaw` (radianos): olhar para (cos yaw, sin yaw) no mundo; yaw 0 = leste (+x), yaw π/2 = sul (+y).
 *
 * Quem faz o quê (pasta scene3d/):
 *  - MUNDO (agente A): props3d.ts, world.ts (puros), textures.ts (canvas, sem three).
 *  - ENTRADA (agente B): fpsInput.ts (funções puras + FpsController, sem three).
 *  - CENA (agente C): engine.ts (único arquivo com `three` além de nada), billboard.ts e fpsArt.ts
 *    (puros), overlay.ts (canvas 2D), Shooter3DScene.tsx, index.ts.
 *  - SALA (agente D): preferência, loader, botão 2D/3D no HUD, laboratório, CSS e CLAUDE.md.
 */
import type { MapDef, MapId } from '../../../../shared/games/shooter/types'
import type { InputState } from '../contract'

// =====================================================================================
// Unidades e alturas (Three, em tiles)
// =====================================================================================

export const PX_PER_UNIT = 16
export const toUnit = (px: number): number => px / PX_PER_UNIT

/** altura dos olhos (câmera) */
export const EYE_H = 3.0
/** altura em que os projéteis voam (peito). Regra: móvel que `blocksShot` é MAIS alto que isto; o que não bloqueia é MAIS baixo. */
export const SHOT_H = 2.1
/** altura do boneco desenhado (a arte de 16 px inteira ocupa BODY_H x BODY_H) */
export const BODY_H = 3.4
/** paredes: na casa vão até o teto; no quintal é um muro (céu aberto) */
export const WALL_H: Record<MapId, number> = { casa: 5.2, quintal: 3.6 }
export const HAS_CEILING: Record<MapId, boolean> = { casa: true, quintal: false }

/** resolução virtual: a imagem é desenhada com esta altura e ampliada sem suavizar (cara de pixel) */
export const VIRTUAL_H = 270
/** campo de visão vertical (graus) */
export const FOV_DEG = 70

// =====================================================================================
// MUNDO (agente A) — props3d.ts
// =====================================================================================

export type PropShape =
  /** caixa cheia do tamanho do bloco (com `inset` px de folga em cada lado) */
  | 'box'
  /** tronco fino + copa de voxels (árvore) */
  | 'tree'
  /** dois postes nas pontas do bloco e uma linha (varal; não é sólido) */
  | 'line'
  /** sem volume: só o piso (pisos, água) */
  | 'flat'
  /** parede do mapa (altura WALL_H do mapa) */
  | 'wall'

export interface Prop3D {
  shape: PropShape
  /** altura em unidades (ignorado em 'flat'; em 'wall' usa WALL_H) */
  height: number
  /** folga em px de cada lado do bloco (0 = encosta no vizinho) */
  inset: number
  /** tela/brasa/chama acesa: cor emissiva desenhada numa face (TV, fogão, churrasqueira) */
  glow?: { color: string; face: 'top' | 'side' }
}

/** Uma entrada para TODA chave `art` da LEGEND (tests conferem). Pisos são 'flat'. */
export type PropTable = Record<string, Prop3D>

// =====================================================================================
// MUNDO (agente A) — world.ts (puro: sem three, sem DOM)
// =====================================================================================

/** Triângulos soltos (sem índice). pos/nrm: 3 por vértice; uv: 2; col: 3 (sombreado assado, 0..1). */
export interface MeshData {
  pos: Float32Array
  nrm: Float32Array
  uv: Float32Array
  col: Float32Array
}

/**
 * Camadas do mundo, uma por material (o motor cria um Mesh por camada):
 *  - 'floor': o chão inteiro; uv em 0..1 sobre o mapa todo -> textura `floorCanvas(map)`
 *  - 'water': tiles de água um pouco abaixo do chão; uv em tiles (repete) -> textura de água animada
 *  - 'ceiling': só se HAS_CEILING; uv em tiles (repete)
 *  - 'top': tampa de cima dos móveis (e do muro do quintal); uv em 0..1 sobre o mapa -> `topCanvas(map)`
 *  - `side:<art>`: laterais de cada tipo (inclui `side:parede`); u em tiles (repete na horizontal),
 *    v de 0 (chão) a 1 (topo) -> `sideCanvas(art, mapId)`
 *  - 'glow': faces emissivas (tela da TV, boca do fogão, brasa); col = cor da luz; sem textura
 *  - 'trunk' e 'leaves': árvore (sem textura, só col)
 *  - 'line': postes e fio do varal (sem textura, só col)
 * Faces escondidas (entre dois sólidos iguais encostados, base no chão) não são geradas.
 */
export type LayerKey = 'floor' | 'water' | 'ceiling' | 'top' | 'glow' | 'trunk' | 'leaves' | 'line' | `side:${string}`

export interface WorldLight {
  /** posição em unidades Three */
  x: number
  y: number
  z: number
  color: string
  /** 0..1, como TILE_LIGHT */
  power: number
  /** alcance em unidades */
  range: number
}

export interface World3D {
  mapId: MapId
  /** tamanho do mapa em unidades */
  w: number
  h: number
  layers: Partial<Record<LayerKey, MeshData>>
  /** luzes fixas (abajures, TV, fogão, brasa). No máximo MAX_WORLD_LIGHTS, as mais fortes. */
  lights: WorldLight[]
  /** onde fica cada luminária para o motor desenhar um abajur/lâmpada (opcional) */
}

export const MAX_WORLD_LIGHTS = 8

/** assinatura que world.ts exporta como `buildWorld` */
export type BuildWorld = (map: MapDef) => World3D

// =====================================================================================
// MUNDO (agente A) — textures.ts (canvas 2D, sem three)
// =====================================================================================

/** assinaturas exportadas por textures.ts (todas com cache por mapa/chave) */
export interface TextureApi {
  /** chão do mapa inteiro, (w*16) x (h*16) px: o piso de cada tile, sem móveis (móvel usa o seu `floor`) */
  floorCanvas(map: MapDef): HTMLCanvasElement
  /** tampas dos móveis vistas de cima, mesmo tamanho do floorCanvas, transparente onde não há móvel */
  topCanvas(map: MapDef): HTMLCanvasElement
  /** lateral de um tipo de móvel/parede: 16 px de largura, round(16 * altura) de altura */
  sideCanvas(art: string, mapId: MapId): HTMLCanvasElement
  /** teto da casa, 16x16, repete */
  ceilingCanvas(): HTMLCanvasElement
  /** água, 16x16, repete (o motor anima o offset) */
  waterCanvas(): HTMLCanvasElement
  /** céu do quintal: faixa vertical (ex.: 4 x 128) do horizonte (baixo) ao alto, com estrelas à parte */
  skyCanvas(): HTMLCanvasElement
}

// =====================================================================================
// ENTRADA (agente B) — fpsInput.ts
// =====================================================================================

/** sensibilidade do mouse (rad por px de movementX) */
export const MOUSE_SENS = 0.0024
/** giro máximo do analógico direito (rad/s) */
export const PAD_TURN_SPEED = 3.4
/** giro das setas esquerda/direita (rad/s) */
export const KEY_TURN_SPEED = 2.6
/** giro do toque (rad por px arrastado) */
export const TOUCH_SENS = 0.008

export interface FpsHost {
  /** elemento que recebe clique, toque e o pointer lock (o palco da cena) */
  el: HTMLElement
  /** false: miniatura, partida acabou ou sem jogador. Solta tudo e sai do pointer lock. */
  enabled(): boolean
  /** travou/soltou o mouse (para mostrar "Clique para jogar") */
  onLockChange?(locked: boolean): void
  /** joystick virtual de andar mudou (para desenhar); px CSS relativos ao el */
  onTouch?(t: FpsTouchUi): void
}

export interface FpsTouchUi {
  move: { active: boolean; cx: number; cy: number; x: number; y: number }
}

export interface FpsPoll {
  /** pronto para session.setInput: mx,my no MUNDO (já girados pelo yaw), ax,ay = (cos yaw, sin yaw) */
  input: InputState
  /** yaw atual (rad, em -π..π) */
  yaw: number
  /** andando (para o balanço da arma) */
  moving: boolean
}

/**
 * fpsInput.ts exporta (além das funções puras testadas):
 *   export class FpsController {
 *     constructor(host: FpsHost)
 *     poll(dtMs: number): FpsPoll        // uma vez por quadro
 *     setYaw(yaw: number): void          // ex.: primeiro quadro, renascer
 *     get yaw(): number
 *     get locked(): boolean
 *     setTouchButton(bit: number, down: boolean): void   // BTN_FIRE | BTN_DASH | BTN_GRENADE
 *     requestLock(): void                // pede o pointer lock (o motor chama no clique do aviso)
 *     dispose(): void
 *   }
 * Funções puras exportadas: yawToAim, aimToYaw, wrapAngle, localMoveFromKeys, rotateMove, padLookDelta.
 */
export interface FpsControllerApi {
  poll(dtMs: number): FpsPoll
  setYaw(yaw: number): void
  readonly yaw: number
  readonly locked: boolean
  setTouchButton(bit: number, down: boolean): void
  requestLock(): void
  dispose(): void
}
