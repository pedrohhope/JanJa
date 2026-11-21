/**
 * Plataforma de tempo real dos jogos da sala (Tiro na Sala, Briga na Sala...).
 *
 * O que é genérico mora aqui em `src/web/game/realtime/`: transporte (canal P2P "game" + repasse
 * `game-relay`), laço do host (fila de entradas, stale, lag por ping, janela de eventos, catch-up),
 * Worker do host, cliente (predição, reconciliação, buffer de interpolação, relógio) e sessão
 * (host/epoch, troca de host, coordenador). Cada jogo entrega UM objeto `RealtimeSim` (a simulação
 * mais o codec binário) e um cliente fino que monta o quadro de desenho. Veja o README.md desta pasta.
 *
 * Sem DOM: tudo recebe o relógio (`now` em ms) por parâmetro, para rodar no Worker e no Node.
 */

/** Os tipos de um jogo, agrupados para não repetir oito parâmetros genéricos. */
export interface RealtimeTypes {
  /** estado completo da simulação (só o host tem; é mutado por `step`) */
  State: unknown
  /** entrada de UM tick de UM jogador; `lagTicks` só o host preenche */
  Input: { seq: number; lagTicks?: number }
  /** retrato do estado que vai pela rede (inclui os eventos recentes) */
  Snapshot: SnapshotBase<unknown>
  /** evento de efeito/som gerado por `step` */
  Event: unknown
  /** o que `addPlayer` precisa saber de quem entra */
  Ref: unknown
  /** linha do placar que vai ao coordenador */
  Score: unknown
  /** parte do retrato que não muda e só vai no snapshot cheio (null se o jogo não tem) */
  Statics: unknown
  /** o próprio jogador como o cliente o prevê (extraído do snapshot) */
  Self: unknown
}

export interface TimedEvent<E> {
  /** tick em que aconteceu */
  tick: number
  ev: E
}

/** O mínimo que a plataforma lê de um snapshot. */
export interface SnapshotBase<E> {
  epoch: number
  tick: number
  /** eventos dos últimos ticks (redundância contra perda); o cliente descarta os repetidos */
  events: TimedEvent<E>[]
}

export interface SnapshotOptions {
  epoch: number
  /** snapshot cheio: leva também o que não muda (tabela de ids etc.) */
  full: boolean
}

/** quem existe na simulação (o laço do host só precisa disto) */
export interface RosterEntry {
  slot: number
  bot: boolean
  /** última `seq` aplicada (o snapshot devolve; o cliente reconcilia com ela) */
  lastSeq: number
}

// ---------------------------------------------------------------------------------------
// Pacotes (o jogo escolhe o formato binário; a plataforma só enxerga isto)
// ---------------------------------------------------------------------------------------

export interface HelloPacket {
  t: 'hello'
  playerId: string
  epoch: number
  /** true = resposta a um HELLO (quem recebe uma resposta não responde de novo) */
  reply: boolean
}

export type Packet<G extends RealtimeTypes> =
  | HelloPacket
  | { t: 'input'; epoch: number; slot: number; /** da mais antiga para a mais nova */ inputs: G['Input'][] }
  | { t: 'ping' | 'pong'; /** valor opaco (u32) devolvido como veio */ n: number }
  | ({ t: 'snapshot' } & G['Snapshot'])

/** O que o transporte precisa do formato binário. */
export interface TransportCodec {
  /** maior pacote que cabe em RELAY_MAX_DATA depois do base64 */
  readonly maxPacketBytes: number
  isHello(data: ArrayBuffer): boolean
  decodeHello(data: ArrayBuffer): HelloPacket | null
  encodeHello(playerId: string, epoch: number, reply?: boolean): ArrayBuffer
  toBase64(data: ArrayBuffer | Uint8Array): string
  /** null se o texto não for base64 válido */
  fromBase64(text: string): ArrayBuffer | null
}

/** Formato binário do jogo. Toda decodificação devolve null para pacote inválido (nunca lança). */
export interface RealtimeCodec<G extends RealtimeTypes> extends TransportCodec {
  decode(data: ArrayBuffer): Packet<G> | null
  encodePing(n: number, pong?: boolean): ArrayBuffer
  /** `inputs` = as últimas (a mais antiga primeiro); o codec limita ao que cabe no pacote */
  encodeInputs(epoch: number, slot: number, inputs: readonly G['Input'][]): ArrayBuffer
  encodeSnapshot(snap: G['Snapshot']): ArrayBuffer
}

// ---------------------------------------------------------------------------------------
// A simulação do jogo
// ---------------------------------------------------------------------------------------

/**
 * Tudo que a plataforma pede a um jogo. A simulação roda no host (Worker) e `predictSelf` roda no
 * cliente: precisa ser a MESMA função que o `step` usa para mover o jogador.
 */
export interface RealtimeSim<G extends RealtimeTypes> {
  // ---- relógio e rede (constantes do jogo)
  /** tiro 40, briga 60 */
  readonly tickHz: number
  /** `1000 / tickHz`, em ponto flutuante (briga: 16,67). O acumulador do host não deriva. */
  readonly tickMs: number
  /** ticks entre snapshots */
  readonly snapshotEvery: number
  /** ticks entre snapshots cheios (tiro: `tickHz`, 1 s) */
  readonly fullSnapshotEvery: number
  /** outros jogadores são desenhados este tanto no passado (ms) */
  readonly interpDelayMs: number
  /** entradas antigas repetidas em cada pacote (o canal perde pacotes) */
  readonly inputRedundancy: number
  /** ticks agrupados por pacote quando a rota para o host é o repasse (tiro: 1; briga: 3). Precisa ser <= inputRedundancy + 1 */
  readonly relayBatch: number
  /** teto da compensação de atraso por ping (ms) */
  readonly maxLagCompMs: number
  /** fila máxima de entradas por jogador no host (padrão 3) */
  readonly maxQueue?: number
  /** sem entrada por tantos ticks o jogador "solta tudo" (padrão 8) */
  readonly staleTicks?: number
  /** correção de predição menor que isto (px) é suavizada; maior é teletransporte (padrão 24) */
  readonly smoothMaxPx?: number
  readonly smoothMs?: number

  // ---- entrada
  /** entrada "solta tudo" (seq 0); o laço copia com a seq certa quando o jogador some */
  readonly emptyInput: G['Input']
  /** entrada vinda da rede: números finitos e limitados, ou null */
  sanitizeInput(raw: unknown): G['Input'] | null

  // ---- estado (host)
  /** UM tick; MUTA o estado. `inputs` = entrada deste tick por slot (falta = a sim decide) */
  step(state: G['State'], inputs: ReadonlyMap<number, G['Input']>): G['Event'][]
  clone(state: G['State']): G['State']
  addPlayer(state: G['State'], ref: G['Ref']): void
  setAway(state: G['State'], slot: number, away: boolean): void
  roster(state: G['State']): readonly RosterEntry[]
  tickOf(state: G['State']): number
  /** a partida acabou: o tick para e o laço reenvia o retrato final */
  isOver(state: G['State']): boolean
  scores(state: G['State']): G['Score'][]
  /** ordenado do 1º ao último */
  ranking(state: G['State']): G['Score'][]

  // ---- snapshot e troca de host
  snapshot(state: G['State'], recentEvents: readonly TimedEvent<G['Event']>[], opts: SnapshotOptions): G['Snapshot']
  /** estado válido para continuar a partida de um retrato (novo host) */
  restore(snapshot: G['Snapshot'], statics: G['Statics'] | null): G['State']
  /** guarda a parte estática mais recente (o cheio sobrescreve). Sem isto o jogo não tem statics. */
  mergeStatics?(prev: G['Statics'] | null, snap: G['Snapshot']): G['Statics'] | null

  // ---- cliente (predição e reconciliação do próprio jogador)
  /** meu jogador no snapshot (null = não está nele) */
  selfOf(snap: G['Snapshot'], slot: number, statics: G['Statics'] | null): G['Self'] | null
  /** última seq que o host aplicou para mim, naquele retrato */
  ackOf(self: G['Self']): number
  /** vale a pena prever agora (vivo, presente, partida rolando) */
  canPredict(self: G['Self'], snap: G['Snapshot']): boolean
  /** UM tick do meu movimento, sem host: a mesma função do `step` */
  predictSelf(self: G['Self'], snap: G['Snapshot'], input: G['Input'], tick: number): void
  /** posição para suavizar a correção */
  selfPos(self: G['Self']): { x: number; y: number }
  selfAlive(self: G['Self']): boolean

  readonly codec: RealtimeCodec<G>
}

// ---------------------------------------------------------------------------------------
// Mensagens do host (Worker ou thread principal)
// ---------------------------------------------------------------------------------------

export type HostIn<G extends RealtimeTypes> =
  | { k: 'init'; state: G['State']; epoch: number }
  /** entradas de um jogador (a mais antiga primeiro); repetidas são descartadas */
  | { k: 'input'; slot: number; inputs: G['Input'][] }
  /** ida e volta medida para aquele jogador (ms) */
  | { k: 'ping'; slot: number; pingMs: number }
  | { k: 'add'; ref: G['Ref'] }
  | { k: 'away'; slot: number; away: boolean }
  | { k: 'stop' }

export type HostOut<G extends RealtimeTypes> =
  | { k: 'snap'; snap: G['Snapshot']; bytes: ArrayBuffer }
  | { k: 'score'; epoch: number; scores: G['Score'][] }
  | { k: 'result'; epoch: number; ranking: G['Score'][] }

export type HostInit<G extends RealtimeTypes> = Extract<HostIn<G>, { k: 'init' }>

/** O que vai ao coordenador (`game-action`). Igual no fio para todos os jogos. */
export type CoordAction<G extends RealtimeTypes> =
  | { type: 'score'; epoch: number; scores: G['Score'][] }
  | { type: 'result'; epoch: number; ranking: G['Score'][] }

// ---------------------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------------------

export type NetStatus = 'conectando' | 'p2p' | 'relay' | 'trocando-host' | 'host' | 'offline'

export interface RealtimePlayerView {
  id: string
  name: string
  slot: number
  bot: boolean
  present: boolean
}

/** O que a sessão lê da `view` do coordenador (a view do jogo tem mais campos). */
export interface RealtimeView<P extends RealtimePlayerView = RealtimePlayerView> {
  you: { playerId: string; slot: number } | null
  /** a sessão só amostra e manda entrada em 'jogando' */
  phase: string
  players: P[]
  /** playerId de quem roda a simulação agora */
  hostId: string
  /** cresce a cada troca de host; pacotes e ações de um epoch antigo são ignorados */
  epoch: number
}

export interface RealtimeSessionDeps<V extends RealtimeView, G extends RealtimeTypes> {
  view: V
  /** PeerManager atual (canal "game"); pode faltar logo ao entrar */
  manager: import('../../rtc/PeerManager').PeerManager | undefined
  /** repasse pelo servidor. `to` = playerId ou '*' */
  relay(to: string, data: string): void
  onRelay(cb: (from: string, data: string) => void): () => void
  /** ação no coordenador (score/result) */
  act(action: CoordAction<G>): void
}
