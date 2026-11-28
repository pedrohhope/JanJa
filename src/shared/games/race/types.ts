/**
 * Corrida na Sala: carrinhos de brinquedo vistos de cima, de 1 a 8 pessoas mais robôs.
 *
 * Mesmo desenho de rede do Tiro e da Briga:
 *  1. COORDENADOR (Durable Object, `engine.ts`): quem é o host da simulação (`epoch`), placar parcial
 *     e resultado. Não roda a corrida.
 *  2. SIMULAÇÃO (`sim.ts`, navegador do host, Web Worker): 60 Hz, autoritativa. Entradas sobem pelo
 *     canal "game" (ou pelo repasse `game-relay`); retratos descem a 30 Hz.
 *
 * Unidades: posição em pixels da pista (y cresce para BAIXO), velocidade em px por TICK, tempo em
 * ticks. A direção do carro é um vetor unitário (hx, hy), girado só com `+ - * / sqrt`: nada de
 * `Math.sin/cos/atan2/hypot/random` nem `Date.now` dentro de `src/shared/games/race`.
 */

// =====================================================================================
// Tempo e rede
// =====================================================================================

export const TICK_HZ = 60
export const TICK_MS = 1000 / 60
/** retrato a cada 2 ticks (30 Hz) */
export const SNAPSHOT_EVERY = 2
/** os outros carros são desenhados este tanto no passado */
export const INTERP_DELAY_MS = 70
/** entradas antigas repetidas em cada pacote (o canal perde pacotes) */
export const INPUT_REDUNDANCY = 3
/** sem P2P, o cliente agrupa este tanto de ticks por pacote no repasse */
export const RELAY_BATCH = 3

/** slots: humanos 0..7, robôs 8..12 */
export const MAX_HUMANS = 8
export const MAX_BOTS = 5
export const BOT_SLOT_BASE = 8

/** 3, 2, 1, já! */
export const COUNTDOWN_TICKS = 3 * TICK_HZ
/** depois que o primeiro cruza a chegada, os outros têm este tempo */
export const FINISH_GRACE_TICKS = 25 * TICK_HZ
/** teto por volta: passou disso, a corrida acaba e vale quem andou mais */
export const LAP_CAP_TICKS = 100 * TICK_HZ
/** folga do prazo de segurança do coordenador (s) */
export const COORD_GRACE_S = 20

// =====================================================================================
// Pista
// =====================================================================================

/** unidade do traçado das pistas (px): os pontos de `tracks.ts` são em ladrilhos de 16 px */
export const TILE = 16
/** lado da célula da grade de colisão e do desenho (px): curva redonda, sem escadinha */
export const CELL = 4

/**
 * Células da grade: '#' muro (móvel, cerca), ',' fora da pista (tapete, grama: freia), '.' pista,
 * '=' linha de chegada (é pista), '>' turbo (é pista).
 */
export type Tile = '#' | ',' | '.' | '=' | '>'

export type TrackId = 'sala' | 'quintal'
export const TRACK_IDS: readonly TrackId[] = ['sala', 'quintal']

// =====================================================================================
// Carro
// =====================================================================================

/** raio do carro para muro e batida (px) */
export const CAR_R = 6
/** aceleração e velocidades (px por tick) */
export const ACCEL = 0.075
export const BRAKE = 0.16
export const REVERSE_ACCEL = 0.05
export const MAX_SPEED = 3.3
export const MAX_REVERSE = 1.3
export const OFFROAD_MAX = 1.6
export const BOOST_MAX = 4.7
export const BOOST_TICKS = 50
export const BOOST_PUSH = 0.22
/** solto: o carro perde isto de velocidade por tick */
export const COAST = 0.985
export const OFFROAD_DRAG = 0.94
/** giro máximo por tick (radianos aproximados) */
export const TURN = 0.06
/** aderência: quanto da derrapagem sobra por tick (menor = gruda) */
export const GRIP = 0.8
export const GRIP_OFFROAD = 0.86
export const GRIP_BOOST = 0.9
/** quanto da velocidade volta do muro */
export const WALL_BOUNCE = 0.35

// =====================================================================================
// Entrada (uma por tick)
// =====================================================================================

export const BTN_GAS = 1
export const BTN_BRAKE = 2
export const BTN_MASK = 3

export interface RaceInput {
  /** sequência crescente por jogador (1, 2, 3...) */
  seq: number
  /** volante, -1 (esquerda) a 1 (direita) */
  steer: number
  /** BTN_* seguradas neste tick */
  buttons: number
  /** só o host preenche (a corrida não usa) */
  lagTicks?: number
}

export const EMPTY_RACE_INPUT: RaceInput = { seq: 0, steer: 0, buttons: 0 }

// =====================================================================================
// Simulação
// =====================================================================================

export type RacePhase = 'contagem' | 'correndo' | 'fim'
export type BotLevel = 'facil' | 'medio' | 'dificil'

export interface CarAi {
  /** ticks seguidos acelerando sem sair do lugar */
  stuck: number
  /** ticks que ainda vai de ré para desencalhar */
  reverse: number
}

export interface Car {
  slot: number
  id: string
  bot: boolean
  away: boolean
  x: number
  y: number
  vx: number
  vy: number
  /** direção (vetor unitário) */
  hx: number
  hy: number
  /** última seq aplicada (0 para robôs) */
  lastSeq: number
  /** voltas começadas: 0 antes de cruzar a largada, `laps + 1` ao terminar */
  lap: number
  /** índice do próximo ponto do traçado a passar */
  next: number
  /** tick em que cruzou a chegada (0 = ainda correndo) */
  finishTick: number
  /** tick em que a volta atual começou */
  lapStart: number
  /** melhor volta em ticks (0 = nenhuma ainda) */
  bestLap: number
  /** turbo até este tick */
  boostUntil: number
  /** última entrada aplicada (repetida se a próxima atrasar; a cena usa para a luz de freio) */
  steer: number
  buttons: number
  /** robô: estado do piloto */
  ai: CarAi
}

export interface RaceSimOptions {
  trackId: TrackId
  laps: number
  botLevel: BotLevel
}

export interface RaceSimState {
  tick: number
  phase: RacePhase
  trackId: TrackId
  laps: number
  botLevel: BotLevel
  /** tick da largada (fim da contagem) */
  goTick: number
  /** primeiro a cruzar a chegada (0 = ninguém ainda) */
  firstFinish: number
  /** tick em que acabou (0 = não acabou) */
  endTick: number
  cars: Car[]
}

export interface RaceSimPlayerRef {
  slot: number
  id: string
  bot: boolean
}

export type RaceSimEvent =
  | { type: 'go' }
  /** começou a volta `lap` (2, 3...); `ticks` = tempo da volta que acabou */
  | { type: 'volta'; slot: number; lap: number; ticks: number; best: boolean }
  /** cruzou a chegada em `place` (1 = primeiro) */
  | { type: 'chegada'; slot: number; place: number; ticks: number }
  /** bateu no muro; força 1..3 */
  | { type: 'batida'; slot: number; force: number }
  /** dois carros se tocaram */
  | { type: 'toque'; a: number; b: number }
  | { type: 'turbo'; slot: number }
  | { type: 'fim' }

// =====================================================================================
// Placar e coordenador
// =====================================================================================

export interface RaceScoreLine {
  id: string
  /** colocação na chegada (0 = não chegou) */
  place: number
  /** voltas completas */
  laps: number
  /** tempo total em ms (0 = não chegou) */
  timeMs: number
  /** melhor volta em ms (0 = nenhuma) */
  bestLapMs: number
}

export const RACE_LAPS = [3, 5, 7] as const
export type RaceLaps = (typeof RACE_LAPS)[number]

export interface RaceOptions {
  trackId: TrackId | 'sorteio'
  laps: RaceLaps
  bots: number
  botLevel: BotLevel
}

export const DEFAULT_RACE_OPTIONS: RaceOptions = { trackId: 'sala', laps: 5, bots: 3, botLevel: 'medio' }

export type RaceCoordPhase = 'jogando' | 'fim'

export interface RacePlayerView {
  id: string
  name: string
  slot: number
  bot: boolean
  present: boolean
}

export interface RaceView {
  you: { playerId: string; slot: number } | null
  options: RaceOptions
  /** pista já sorteada */
  trackId: TrackId
  phase: RaceCoordPhase
  players: RacePlayerView[]
  hostId: string
  epoch: number
  createdAt: number
  scores: RaceScoreLine[]
  ranking: RaceScoreLine[] | null
}

export type RaceAction = { type: 'score'; epoch: number; scores: RaceScoreLine[] } | { type: 'result'; epoch: number; ranking: RaceScoreLine[] }

export type RaceCoordEvent =
  | { type: 'host'; hostId: string; epoch: number }
  | { type: 'joined'; id: string; name: string; slot: number }
  | { type: 'fim'; ranking: RaceScoreLine[] }
