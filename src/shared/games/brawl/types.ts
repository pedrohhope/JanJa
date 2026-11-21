/**
 * CONTRATO da Briga na Sala (escrito pelo planejador; os agentes implementam, não mudam sem combinar).
 * Plano completo: doc `plano-briga-na-sala` do projeto.
 *
 * Luta de plataforma 2D no estilo Brawlhalla, 2 a 8 pessoas (+ até 4 robôs), dentro da sala.
 * Mesmo desenho de rede do Tiro na Sala:
 *  1. COORDENADOR (Durable Object, `GameDefinition` normal, `engine.ts`): escolha de personagem,
 *     quem é o host da simulação (`epoch`), placar parcial e resultado. Não roda a luta.
 *  2. SIMULAÇÃO (`sim.ts`, navegador do host, Web Worker): 60 Hz, autoritativa. Entradas sobem por
 *     DataChannel "game" (ou repasse `game-relay`); snapshots descem a 30 Hz.
 *
 * Unidades: posição em pixels da arena (480×270, y cresce para BAIXO), velocidade em px por TICK
 * (não por segundo: a física de luta é por quadro), tempo em ticks. `x,y` do lutador = meio da base
 * (os pés). Determinismo: dentro de `src/shared/games/brawl` só `+ - * /`, `Math.floor/round/abs/min/max/sign`;
 * nada de `Math.random`, `Date.now`, `Math.sin/cos/hypot/atan2`. Ângulos de empurrão são vetores.
 * Aleatoriedade: mulberry32 guardado em `BrawlSimState.rng`.
 */
import type { PlayerRef } from '../types'

// =====================================================================================
// Tempo, rede e mundo
// =====================================================================================

export const TICK_HZ = 60
export const TICK_MS = 1000 / 60
/** snapshot a cada 2 ticks (30 Hz) */
export const SNAPSHOT_EVERY = 2
/** outros lutadores desenhados este tanto no passado */
export const INTERP_DELAY_MS = 60
/** entradas antigas repetidas em cada pacote (sem retransmissão no canal) */
export const INPUT_REDUNDANCY = 3
/** sem P2P, o cliente agrupa este tanto de ticks por pacote no repasse */
export const RELAY_BATCH = 3
/** compensação de atraso dos golpes (o host confere o acerto contra o passado do alvo) */
export const MAX_LAG_COMP_MS = 100
/** o host guarda o histórico de posições para a compensação */
export const LAG_HISTORY_TICKS = 8

/** resolução interna, pixel inteiro, sem câmera móvel */
export const ARENA_W = 480
export const ARENA_H = 270

/** slots: humanos 0..7, robôs 8..11 */
export const MAX_HUMANS = 8
export const MAX_BOTS = 4
export const BOT_SLOT_BASE = 8

/** contagem 3, 2, 1, já! antes de liberar o controle */
export const COUNTDOWN_TICKS = 3 * TICK_HZ
export const RESPAWN_TICKS = 90 // 1,5 s fora antes de voltar
export const RESPAWN_INVULN_TICKS = 2 * TICK_HZ
export const MAX_DAMAGE = 300

// Movimento comum (cada personagem multiplica pelos próprios números em CharacterSpec)
export const GRAVITY = 0.32
export const MAX_JUMPS = 3 // 1 no chão + 2 no ar
export const DODGE_TICKS = 15 // 0,25 s invulnerável
export const DODGE_COOLDOWN_TICKS = 60 // no chão
export const DODGE_SPEED = 4.2 // esquiva com direção
export const WALL_CLING_MAX_TICKS = 90
export const WALL_SLIDE_SPEED = 0.8
/** "pisa em cima" de plataforma fina só se vinha de cima nesta janela */
export const THIN_SNAP = 6

// Dano que vira voo
/** empurrão = (base + dano_do_alvo * growth / 100) * mul_do_peso; hitstun = empurrão * HITSTUN_PER_KB */
export const HITSTUN_PER_KB = 3.2
/** atrito do voo por tick enquanto em hitstun (o empurrão decai) */
export const KB_DECAY = 0.94
/** hit-stop: ticks congelados por acerto = clamp(HITSTOP_MIN + dano * HITSTOP_PER_DMG, .., HITSTOP_MAX) */
export const HITSTOP_MIN = 3
export const HITSTOP_MAX = 10
export const HITSTOP_PER_DMG = 0.35
/** carregar o forte: até CHARGE_MAX_TICKS segurando; empurrão e dano × (1 + CHARGE_BONUS * fração) */
export const CHARGE_MAX_TICKS = 60
export const CHARGE_BONUS = 0.4

/** cor do número de dano (a cena desenha; o sim só guarda o número) */
export const DAMAGE_STAGES: readonly { from: number; color: 'branco' | 'amarelo' | 'laranja' | 'vermelho' | 'vinho' }[] = [
  { from: 0, color: 'branco' },
  { from: 40, color: 'amarelo' },
  { from: 90, color: 'laranja' },
  { from: 150, color: 'vermelho' },
  { from: 220, color: 'vinho' }
]

// =====================================================================================
// Entrada (uma por tick)
// =====================================================================================

export const BTN_JUMP = 1
export const BTN_LIGHT = 2
export const BTN_HEAVY = 4
export const BTN_DODGE = 8
export const BTN_PICK = 16 // pegar / arremessar arma
export const BTN_MASK = 31

export interface BrawlInput {
  /** sequência crescente por jogador (1, 2, 3...) */
  seq: number
  /** eixo, cada um em -1..1; para baixo é my > 0. Zona morta de 0,35 aplicada no SIM (não no cliente). */
  mx: number
  my: number
  /** BTN_* seguradas neste tick (o sim detecta borda de subida com prevButtons) */
  buttons: number
  /** preenchido SÓ pelo host (nunca vem do cliente): atraso de quem bateu, em ticks (0..6) */
  lagTicks?: number
}

export const EMPTY_BRAWL_INPUT: BrawlInput = { seq: 0, mx: 0, my: 0, buttons: 0 }

// =====================================================================================
// Personagens (4)
// =====================================================================================

export type CharacterId = 'jan' | 'xicara' | 'teve' | 'janja'
export const CHARACTER_IDS: readonly CharacterId[] = ['jan', 'xicara', 'teve', 'janja']

export type WeaponId = 'vassoura' | 'frigideira' | 'luvas'
export const WEAPON_IDS: readonly WeaponId[] = ['vassoura', 'frigideira', 'luvas']
/** o que está na mão: uma arma ou nada */
export type Held = WeaponId | 'mao'

export interface CharacterSpec {
  id: CharacterId
  name: string
  /** frase de uma linha na tela de escolha */
  tagline: string
  /** 'leve' | 'medio' | 'pesado' só para a tela; o que vale é kbMul */
  weightClass: 'leve' | 'medio' | 'pesado'
  /** multiplica o empurrão recebido (Tevê 0,85, Xícara 1,15) */
  kbMul: number
  /** velocidade de corrida no chão (px/tick) */
  runSpeed: number
  /** controle no ar: aceleração e máxima horizontal */
  airAccel: number
  airMax: number
  /** velocidade do pulo do chão e do pulo no ar (px/tick, para cima) */
  jumpVel: number
  airJumpVel: number
  /** multiplica GRAVITY */
  gravityMul: number
  /** queda normal e queda rápida (máximas) */
  fallMax: number
  fastFallMax: number
  /** caixa de corpo (hurtbox), centrada em x, apoiada nos pés */
  hurtW: number
  hurtH: number
  /** armas preferidas (só a tela mostra; o robô prefere pegar estas) */
  likes: readonly WeaponId[]
}

/**
 * Os números ficam em `characters.ts` (agente da simulação), mas o elenco e o "jeito" são estes:
 *
 * - jan: o mascote (gorro amarelo, moletom coral). Médio em tudo. Assinaturas com cartas de baralho
 *   (ele é o carteador do poker): neutra "Leque de cartas" (cartas giram em volta), lateral
 *   "Ombrada" (investida), baixa "Embaralhar" (cartas sobem do chão dos dois lados).
 * - xicara: a xícara de café. Leve e rápida, gosta de luvas e vassoura. Neutra "Vapor" (jato para
 *   cima), lateral "Derramou" (escorrega deixando rastro de café que faz deslizar), baixa "Pião".
 * - teve: a TV de tubo com antena. Pesada e lenta, gosta de frigideira. Neutra "Estática"
 *   (chiado em volta), lateral "Raio catódico" (a tela acende e empurra), baixa "Desabou" (cai de
 *   costas, onda de choque no chão).
 * - janja: a JanJa, mascote do app e parceira do Jan (personagem ORIGINAL, não é pessoa real).
 *   Fone de ouvido amarelo com microfone e LED verde, coque alto, casaco creme (papel), calça café.
 *   Média-leve, ágil, gosta de vassoura e luvas. Tema: o próprio app (tela, sinal, mic).
 *   Neutra "Tela compartilhada" (uma moldura de janela pixel se abre em volta dela e empurra para
 *   fora), lateral "Sinal" (lança 3 arcos de Wi-Fi: projétil que atravessa, empurrão baixo e
 *   crescente no último arco), baixa "Mic aberto" (grito em anel de ondas sonoras no chão, sobe
 *   quem está perto).
 */
export const CHARACTER_TAGLINES: Record<CharacterId, string> = {
  jan: 'Equilibrado. Dá as cartas.',
  xicara: 'Leve e rápida. Cuidado que queima.',
  teve: 'Pesada. Aguenta tudo, sai tarde.',
  janja: 'Ágil. Compartilha tela e golpe.'
}

// =====================================================================================
// Golpes (dados de quadro)
// =====================================================================================

/** direção do golpe, lida no tick em que o botão foi apertado */
export type AttackDir = 'neutro' | 'lado' | 'baixo'
export type AirDir = 'neutro' | 'lado' | 'baixo' | 'cima'

/**
 * Identificadores de golpe:
 *  - leves no chão por arma: `${Held}:${AttackDir}` (ex.: 'vassoura:lado', 'mao:neutro')
 *  - aéreos por arma: `${Held}:ar-${AirDir}` ('ar-cima' = recuperação, 'ar-baixo' = pisão)
 *  - fortes (assinaturas): `${CharacterId}:${Held}:${AttackDir}`. Desarmado ('mao') todo mundo usa
 *    os genéricos carregados `mao:forte-${AttackDir}`.
 * O agente da simulação define a tabela completa em `moves.ts` (MOVES: Record<string, MoveData>).
 * Na primeira versão as assinaturas podem ser IGUAIS para as 3 armas do mesmo personagem
 * (`${char}:*:${dir}` resolvido por `moveFor`), mudando só alcance/números se der tempo.
 */
export type MoveId = string

export interface Hitbox {
  /** relativo aos pés, x para a FRENTE do lutador (o sim espelha pelo facing) */
  x: number
  y: number
  w: number
  h: number
  damage: number
  /** empurrão base e crescimento por dano do alvo */
  baseKb: number
  kbGrowth: number
  /** direção do empurrão, para a frente: (dx, dy) com |v| ≈ 1, dy < 0 = para cima */
  dx: number
  dy: number
}

export interface MoveData {
  id: MoveId
  /** ticks antes de bater, ativos, e de recuperação */
  startup: number
  active: number
  recovery: number
  /** caixas por tick ativo; `frames[i]` vale no i-ésimo tick ativo (repete a última se faltar) */
  frames: Hitbox[][]
  /** forte: pode carregar segurando o botão antes do startup */
  chargeable?: boolean
  /** velocidade que o golpe dá ao lutador no 1º tick (px/tick, x para a frente) */
  selfVx?: number
  selfVy?: number
  /** golpe que solta um projétil no 1º tick ativo (cartas, arcos de Wi-Fi, vapor...) */
  projectile?: ProjectileSpec
  /** golpe que deixa poça (café derramado) */
  puddle?: { w: number; ticks: number }
  /** recuperação: só 1 vez por "pulo" (volta ao tocar o chão, a parede ou ao levar golpe) */
  recovery_move?: boolean
  /** cada lutador só leva 1 acerto por uso do golpe, salvo `multiHit` (ticks entre acertos) */
  multiHit?: number
  /** só visual: nome curto que aparece no laboratório */
  label: string
}

export type ProjectileKind = 'carta' | 'wifi' | 'vapor' | 'raio' | 'onda' | 'arma'

export interface ProjectileSpec {
  kind: ProjectileKind
  /** quantos e a defasagem em ticks entre eles */
  count: number
  gapTicks: number
  /** saída relativa aos pés (x para a frente) */
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  lifeTicks: number
  /** atravessa lutadores (bate em cada um no máximo 1 vez) */
  pierce: boolean
  hit: Omit<Hitbox, 'x' | 'y' | 'w' | 'h'>
  /** (adicionado) acerto do ÚLTIMO projétil da rajada (o último arco de Wi-Fi empurra mais); sem isto todos usam `hit` */
  lastHit?: Omit<Hitbox, 'x' | 'y' | 'w' | 'h'>
}

// =====================================================================================
// Arenas (geometria fixa; arte em src/web/game/brawl/scene, números em arenas.ts)
// =====================================================================================

export type ArenaId = 'estante' | 'telhado'
export const ARENA_IDS: readonly ArenaId[] = ['estante', 'telhado']

export interface Platform {
  /** canto de cima à esquerda e tamanho, em px da arena */
  x: number
  y: number
  w: number
  h: number
  /** fina: atravessa por baixo e com "para baixo"; sólida: tem lados (parede para agarrar) */
  thin: boolean
  /** chave de arte (a cena escolhe o desenho): 'estante-base', 'prateleira', 'telhado', 'caixa-dagua', 'antena'... */
  art: string
}

export interface ArenaDef {
  id: ArenaId
  name: string
  platforms: readonly Platform[]
  /** pés de quem nasce na largada (até 12, na ordem dos slots) */
  spawns: readonly { x: number; y: number }[]
  /** de onde quem renasce cai (pés) */
  respawn: { x: number; y: number }
  /** zona de nocaute: saiu deste retângulo, perdeu a vida (o topo só vale em hitstun, como no Brawlhalla) */
  blast: { left: number; right: number; top: number; bottom: number }
  /** onde as armas podem cair (faixa em x, na altura do topo) */
  dropX: [number, number]
}

/**
 * Geometria oficial (a cena desenha EXATAMENTE isto; o sim colide com isto):
 *
 * estante — "A Estante", sala à noite. Base de madeira sólida x 96..384 (w 288), topo y 188, h 46.
 *   Prateleiras finas: (124, 140, w 84), (272, 140, w 84). Prateleira fina alta no meio (204, 96, w 72).
 *   spawns no topo da base e das prateleiras; respawn (240, 40); blast left -70, right 550, top -90, bottom 330.
 * telhado — "O Telhado", noite de lua. Telhado sólido x 64..416 (w 352), topo y 196, h 50.
 *   Caixa d'água fina (196, 128, w 88); antena fina (92, 150, w 52); chaminé sólida pequena (352, 168, w 28, h 28).
 *   respawn (240, 40); blast left -80, right 560, top -90, bottom 330.
 */

// =====================================================================================
// Opções e coordenador (Durable Object)
// =====================================================================================

export type BrawlMode = 'vidas' | 'tempo'
export type BrawlMinutes = 2 | 3 | 5
export type BotLevel = 'facil' | 'medio' | 'dificil'
/** 0 = todos contra todos; 2/3/4 = tamanho do time (duplas 2x2, 3x3, 4x4) */
export type TeamSize = 0 | 2 | 3 | 4

export interface BrawlOptions {
  mode: BrawlMode
  /** modo vidas: 1..5 */
  stocks: number
  /** modo tempo */
  minutes: BrawlMinutes
  teamSize: TeamSize
  friendlyFire: boolean
  arenaId: ArenaId | 'sorteio'
  bots: number
  botLevel: BotLevel
}

export const DEFAULT_BRAWL_OPTIONS: BrawlOptions = {
  mode: 'vidas',
  stocks: 3,
  minutes: 3,
  teamSize: 0,
  friendlyFire: false,
  arenaId: 'estante',
  bots: 0,
  botLevel: 'medio'
}
export const BRAWL_MINUTES: readonly BrawlMinutes[] = [2, 3, 5]

/** escolha de personagem: dura até todos marcarem "pronto" ou PICK_MS acabar (quem não escolheu fica com o que estava marcado) */
export const PICK_MS = 20_000
/** prazo de segurança: sem 'result' do host, o servidor encerra com o último placar */
export const COORD_GRACE_S = 30
/** modo vidas não tem relógio; o prazo de segurança é este */
export const STOCK_MODE_MAX_MIN = 12

export interface BrawlScoreLine {
  /** playerId (humano) ou `bot-1`..`bot-4` */
  id: string
  char: CharacterId
  team: number
  kos: number
  falls: number
  damage: number
  /** vidas que sobraram (modo vidas) */
  stocks: number
  /** modo vidas: tick em que saiu (0 = ainda de pé); desempata o ranking */
  outTick: number
}

export interface BrawlPlayerView {
  id: string
  name: string
  slot: number
  bot: boolean
  present: boolean
  char: CharacterId
  /** cor do time (0..3); sem times = slot % 8 vira a cor do contorno */
  team: number
  ready: boolean
  /** entrou com a luta em andamento e está assistindo até a próxima (modo vidas) */
  spectating: boolean
}

export type BrawlPhase = 'escolha' | 'jogando' | 'fim'

export interface BrawlView {
  you: { playerId: string; slot: number } | null
  options: BrawlOptions
  /** arena resolvida (sorteio feito no servidor ao iniciar) */
  arenaId: ArenaId
  phase: BrawlPhase
  /** ms epoch em que a escolha acaba (phase 'escolha') */
  pickEndsAt: number
  players: BrawlPlayerView[]
  hostId: string
  epoch: number
  seed: number
  /** ms epoch em que a luta começou (fim da escolha) */
  startedAt: number
  scores: BrawlScoreLine[]
  ranking: BrawlScoreLine[] | null
}

export type BrawlAction =
  /** fase de escolha: trocar personagem / marcar pronto (qualquer jogador) */
  | { type: 'pick'; char: CharacterId }
  | { type: 'ready'; ready: boolean }
  /** só o host atual, no epoch atual */
  | { type: 'score'; epoch: number; scores: BrawlScoreLine[] }
  | { type: 'result'; epoch: number; ranking: BrawlScoreLine[] }
  /** só quem abriu: jogar de novo com as mesmas opções (volta para a escolha) */
  | { type: 'rematch' }

export type BrawlCoordEvent =
  | { type: 'host'; hostId: string; epoch: number }
  | { type: 'joined'; id: string; name: string; slot: number }
  | { type: 'pick'; id: string; char: CharacterId }
  | { type: 'start'; arenaId: ArenaId; seed: number }
  | { type: 'fim'; ranking: BrawlScoreLine[] }

// =====================================================================================
// Simulação (host); o cliente usa predictSelf para o próprio boneco
// =====================================================================================

export type FighterAction =
  | 'parado'
  | 'correndo'
  | 'no-ar'
  | 'parede' // agarrado na lateral
  | 'esquiva'
  | 'golpe'
  | 'atordoado' // hitstun (voando)
  | 'fora' // nocauteado, esperando renascer
  | 'eliminado' // sem vidas

export interface Fighter {
  slot: number
  id: string
  bot: boolean
  away: boolean
  char: CharacterId
  team: number
  x: number
  y: number
  vx: number
  vy: number
  /** 1 = olhando para a direita, -1 = esquerda */
  facing: 1 | -1
  grounded: boolean
  /** plataforma fina em que está, para atravessar com "para baixo" (-1 = nenhuma / sólida) */
  onThin: number
  fastFall: boolean
  action: FighterAction
  /** tick em que a ação atual começou (a cena anima por `tick - actionTick`) */
  actionTick: number
  jumpsLeft: number
  recoveryUsed: boolean
  airDodgeUsed: boolean
  dodgeReadyTick: number
  /** golpe em curso */
  move: MoveId | null
  /** tick do golpe (0 = primeiro de startup); carregando: fica em 0 e conta `charge` */
  moveTick: number
  charge: number
  /** slots já acertados por este uso do golpe (+ tick do último, para multiHit): pares planos [slot, tick, slot, tick...] */
  hitSlots: number[]
  hitstunUntil: number
  /** congelado até este tick (hit-stop) */
  freezeUntil: number
  invulnUntil: number
  damage: number
  stocks: number
  /** arma na mão: fica até arremessar ou perder a vida */
  held: Held
  wallSide: -1 | 0 | 1
  wallTicks: number
  /** quem bateu por último (para dar o nocaute) e quando */
  lastHitBy: number
  lastHitTick: number
  respawnTick: number
  outTick: number
  kos: number
  falls: number
  dealt: number
  prevButtons: number
  lastSeq: number
  lastInput?: BrawlInput
  /** memória do robô (serializável; só bots.ts mexe) */
  ai?: Record<string, number>
  /** (adicionado) histórico de posições para a compensação de atraso: LAG_HISTORY_TICKS pares x,y em anel (índice = (tick % N) * 2) */
  hist: number[]
}

export interface WeaponItem {
  id: number
  weapon: WeaponId
  x: number
  y: number
  vx: number
  vy: number
  /** 'caindo' do céu, 'chao' para pegar, 'voando' arremessada (bate) */
  state: 'caindo' | 'chao' | 'voando'
  owner: number
  /** some sozinha se ninguém pegar (no chão) */
  dieTick: number
}

export interface Projectile {
  id: number
  owner: number
  kind: ProjectileKind
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  /** -1/1, para a cena desenhar */
  facing: 1 | -1
  hit: ProjectileSpec['hit']
  pierce: boolean
  hitSlots: number[]
  dieTick: number
  /** quando a arma é arremessada, a cena desenha esta arma */
  weapon?: WeaponId
}
// Nota: nos projéteis `hitSlots` guarda só os slots (sem tick); em `Puddle`, `x` é o CENTRO da poça.

export interface Puddle {
  id: number
  owner: number
  x: number
  y: number
  w: number
  dieTick: number
}

export type BrawlSimPhase = 'contagem' | 'jogando' | 'morte-subita' | 'fim'

export interface BrawlSimState {
  arenaId: ArenaId
  mode: BrawlMode
  teamSize: TeamSize
  friendlyFire: boolean
  botLevel: BotLevel
  tick: number
  phase: BrawlSimPhase
  /** tick em que a contagem termina */
  goTick: number
  /** modo tempo: tick em que acaba (0 em vidas) */
  endTick: number
  rng: number
  nextId: number
  nextDropTick: number
  fighters: Fighter[]
  items: WeaponItem[]
  projectiles: Projectile[]
  puddles: Puddle[]
}

export type BrawlSimEvent =
  | { type: 'jump'; slot: number; air: boolean }
  | { type: 'land'; slot: number; hard: boolean }
  | { type: 'dodge'; slot: number }
  | { type: 'attack'; slot: number; move: MoveId; charge: number }
  /** força 0..3 escolhe o tamanho da fagulha e do som; `kb` em px/tick */
  | { type: 'hit'; attacker: number; victim: number; move: MoveId; damage: number; kb: number; strength: 0 | 1 | 2 | 3; x: number; y: number }
  /** nocaute: `side` diz por qual borda saiu (explosão de confete na borda) */
  | { type: 'ko'; victim: number; killer: number; side: 'esquerda' | 'direita' | 'cima' | 'baixo'; x: number; y: number }
  | { type: 'respawn'; slot: number }
  | { type: 'eliminated'; slot: number }
  | { type: 'last-stock'; slot: number }
  | { type: 'drop'; item: number; weapon: WeaponId; x: number }
  | { type: 'pickup'; slot: number; weapon: WeaponId }
  | { type: 'throw'; slot: number; weapon: WeaponId }
  | { type: 'wall'; slot: number }
  | { type: 'phase'; phase: BrawlSimPhase }
  | { type: 'go' }

export interface BrawlSimPlayerRef {
  slot: number
  id: string
  bot: boolean
  char: CharacterId
  team: number
}

export interface BrawlSimOptions {
  arenaId: ArenaId
  mode: BrawlMode
  stocks: number
  minutes: BrawlMinutes
  teamSize: TeamSize
  friendlyFire: boolean
  botLevel: BotLevel
}

/**
 * API da simulação (agente da simulação implementa em `sim.ts`; os outros só importam).
 * `step` MUTA o estado. Para prever ou testar, clone antes com cloneState.
 */
export interface BrawlSimApi {
  create(players: BrawlSimPlayerRef[], opts: BrawlSimOptions, seed: number): BrawlSimState
  /** um tick. `inputs` por slot (falta = repete a última; robôs via botInput dentro do step) */
  step(state: BrawlSimState, inputs: ReadonlyMap<number, BrawlInput>): BrawlSimEvent[]
  cloneState(state: BrawlSimState): BrawlSimState
  /** entra no meio (modo tempo); no modo vidas quem chega fica fora até a próxima */
  addPlayer(state: BrawlSimState, ref: BrawlSimPlayerRef): void
  setAway(state: BrawlSimState, slot: number, away: boolean): void
  /**
   * Predição do próprio lutador por um tick: movimento, pulos, parede, esquiva e o ANDAMENTO do
   * próprio golpe (startup/ativo/recuperação, sem aplicar acerto nos outros). A mesma função que o
   * step usa para o movimento. Muta só `state.fighters[slot]` e não mexe em `rng`.
   */
  predictSelf(state: BrawlSimState, slot: number, input: BrawlInput): void
  botInput(state: BrawlSimState, slot: number): BrawlInput
  scores(state: BrawlSimState): BrawlScoreLine[]
  /** vidas: quem sobrou, depois quem saiu por último; tempo: (kos - falls) desc, kos desc, dano desc */
  ranking(state: BrawlSimState): BrawlScoreLine[]
}

export type { PlayerRef }
