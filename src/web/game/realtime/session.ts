/**
 * Sessão de um jogo de tempo real: decide se esta pessoa é o host (roda a simulação) ou cliente
 * (manda entradas, prevê e interpola), troca de papel quando hostId/epoch mudam, mede o ping e
 * repassa score/result ao coordenador. O relógio, os temporizadores e o criador do host entram por
 * `SessionEnv` (testável sem navegador). Genérico: o jogo entra por `RealtimeGameBinding`.
 */
import type { HostInit, HostOut, NetStatus, RealtimePlayerView, RealtimeSessionDeps, RealtimeSim, RealtimeTypes, RealtimeView } from './types'
import type { HostRunner } from './hostRunner'
import { Transport, type GameLink } from './transport'

export interface SessionEnv<G extends RealtimeTypes> {
  now(): number
  /** repete `fn` a cada `ms`; devolve o cancelamento */
  every(ms: number, fn: () => void): () => void
  createRunner(init: HostInit<G>, out: (m: HostOut<G>) => void): HostRunner<G>
}

/** O que a sessão usa do cliente do jogo (`RealtimeClient` + `localTick`, `frame` e `setRoster`). */
export interface SessionClient<G extends RealtimeTypes, IS, F, P extends RealtimePlayerView, Out> {
  readonly me: number | null
  readonly pingMs: number
  readonly latest: G['Snapshot'] | undefined
  readonly latestStatics: G['Statics'] | null
  readonly hasSnapshot: boolean
  readonly lastReceiveAt: number
  /** meu jogador previsto e quantas entradas ainda esperam confirmação (diagnóstico e testes) */
  readonly predicted: G['Self'] | null
  readonly pendingCount: number
  setRoster(players: readonly P[]): void
  setPing(ms: number): void
  beginEpoch(epoch: number): void
  onSnapshot(snap: G['Snapshot'], now: number): boolean
  drainEvents(): Out[]
  /** cria a entrada deste tick a partir dos controles; devolve as últimas para mandar (ou null) */
  localTick(now: number, input: IS): G['Input'][] | null
  /** quadro para desenhar; `net` e `pingMs` quem preenche é a sessão */
  frame(now: number, players?: readonly P[]): F | null
}

/** Tudo que muda de um jogo para o outro na sessão. */
export interface RealtimeGameBinding<G extends RealtimeTypes, V extends RealtimeView, IS, F extends { net: NetStatus; pingMs: number }, Out> {
  sim: RealtimeSim<G>
  createClient(me: number | null): SessionClient<G, IS, F, V['players'][number], Out>
  /** o que `sim.addPlayer` recebe para cada pessoa/robô da sala */
  refOf(p: V['players'][number]): G['Ref']
  /** estado novo do primeiro host (opções, semente, placar que o coordenador já tinha) */
  createState(view: V): G['State']
  /** controles "parados" até a cena mandar o primeiro */
  idleInput: IS
}

export type Role = 'host' | 'client' | 'espectador'

/** Sessão com os métodos internos que o hook/sala usam (a CENA só enxerga o que o jogo expõe). */
export interface ManagedRealtimeSession<G extends RealtimeTypes, V extends RealtimeView, IS, F, Out> {
  frame(): F | null
  setInput(input: IS): void
  onEvents(cb: (events: Out[]) => void): () => void
  dispose(): void
  update(view: V): void
  setManager(manager: RealtimeSessionDeps<V, G>['manager']): void
  role(): Role
  /** só para teste e diagnóstico */
  readonly debug: {
    client(): SessionClient<G, IS, F, V['players'][number], Out>
    hostState(): G['State'] | null
    lastSnapshot(): G['Snapshot'] | undefined
    statics(): G['Statics'] | null
  }
}

export const defaultEnv = <G extends RealtimeTypes>(createRunner: SessionEnv<G>['createRunner']): SessionEnv<G> => ({
  now: () => performance.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
  createRunner
})

const PUMP_MS = 8
const FRAME_CACHE_MS = 3
const STALE_CONNECTING_MS = 2000
const STALE_OFFLINE_MS = 6000
const PING_EVERY_MS = 1000
/** se o relógio da sessão atrasar mais que isto, recomeça em vez de correr */
const MAX_PUMP_CATCHUP_MS = 250
const MAX_TICKS_PER_PUMP = 6

export function createRealtimeSession<G extends RealtimeTypes, V extends RealtimeView, IS, F extends { net: NetStatus; pingMs: number }, Out>(
  binding: RealtimeGameBinding<G, V, IS, F, Out>,
  deps: RealtimeSessionDeps<V, G>,
  env: SessionEnv<G>
): ManagedRealtimeSession<G, V, IS, F, Out> {
  return new SessionCore(binding, deps, env)
}

class SessionCore<G extends RealtimeTypes, V extends RealtimeView, IS, F extends { net: NetStatus; pingMs: number }, Out> implements ManagedRealtimeSession<G, V, IS, F, Out> {
  private view: V
  private manager: RealtimeSessionDeps<V, G>['manager']
  private readonly selfId: string
  private readonly transport: Transport
  private readonly sim: RealtimeSim<G>
  private client: SessionClient<G, IS, F, V['players'][number], Out>
  private runner?: HostRunner<G>
  private runnerGen = 0
  private roleKey = ''
  private current: Role = 'espectador'
  private switching = false
  private hostReady = false
  private known = new Set<number>()
  private away = new Map<number, boolean>()
  private input: IS
  private nextTickAt = 0
  private nextPingAt = 0
  private hostState: G['State'] | null = null
  private pingSent = 0
  private relayTicks = 0
  private cache: { at: number; frame: F } | null = null
  private readonly listeners = new Set<(events: Out[]) => void>()
  private readonly stops: (() => void)[] = []
  private disposed = false

  constructor(
    private readonly binding: RealtimeGameBinding<G, V, IS, F, Out>,
    private readonly deps: RealtimeSessionDeps<V, G>,
    private readonly env: SessionEnv<G>
  ) {
    this.sim = binding.sim
    this.view = deps.view
    this.manager = deps.manager
    this.input = binding.idleInput
    this.selfId = deps.view.you?.playerId ?? `espectador-${Math.random().toString(36).slice(2, 10)}`
    this.client = binding.createClient(deps.view.you?.slot ?? null)
    this.transport = new Transport({
      codec: this.sim.codec,
      selfId: this.selfId,
      epoch: () => this.view.epoch,
      link: () => this.manager as unknown as GameLink | undefined,
      relay: (to, data) => this.deps.relay(to, data),
      onRelay: (cb) => this.deps.onRelay(cb),
      others: () => this.view.players.filter((p) => !p.bot && p.present && p.id !== this.selfId).map((p) => p.id)
    })
    this.stops.push(this.transport.onPacket((from, data) => this.onPacket(from, data)))
    this.stops.push(env.every(PUMP_MS, () => this.pump()))
    this.client.setRoster(this.view.players)
    this.setupRole()
    this.transport.announce()
  }

  // ---------- sessão do jogo ----------

  frame(): F | null {
    const now = this.env.now()
    if (this.cache && now - this.cache.at < FRAME_CACHE_MS) return this.cache.frame
    const f = this.client.frame(now, this.view.players)
    if (!f) return null
    f.net = this.netStatus(now)
    f.pingMs = this.current === 'host' ? 0 : this.client.pingMs
    this.cache = { at: now, frame: f }
    return f
  }

  setInput(input: IS): void {
    this.input = input
  }

  onEvents(cb: (events: Out[]) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopRunner()
    for (const s of this.stops.splice(0)) s()
    this.transport.dispose()
    this.listeners.clear()
  }

  // ---------- métodos internos ----------

  role(): Role {
    return this.current
  }

  readonly debug = {
    client: () => this.client,
    hostState: () => this.hostState,
    lastSnapshot: () => this.client.latest,
    statics: () => this.client.latestStatics
  }

  update(view: V): void {
    if (this.disposed) return
    const epochChanged = view.epoch !== this.view.epoch
    this.view = view
    this.client.setRoster(view.players)
    if (view.you?.slot !== this.client.me) {
      // mudou de espectador para jogador (sentou no meio da partida): cliente novo
      this.client = this.binding.createClient(view.you?.slot ?? null)
      this.client.setRoster(view.players)
      this.client.beginEpoch(view.epoch)
      this.roleKey = ''
    }
    this.setupRole()
    if (epochChanged) this.transport.announce()
    this.syncRoster()
  }

  setManager(manager: RealtimeSessionDeps<V, G>['manager']): void {
    this.manager = manager
    this.transport.attach()
    this.transport.announce()
  }

  // ---------- papel ----------

  private setupRole(): void {
    const v = this.view
    const key = `${v.hostId}|${v.epoch}|${v.you?.playerId ?? ''}`
    if (key === this.roleKey) return
    const first = this.roleKey === ''
    this.roleKey = key
    const last = this.client.latest
    const statics = this.client.latestStatics
    this.stopRunner()
    this.client.beginEpoch(v.epoch)
    this.hostReady = false
    this.switching = !first && v.epoch > 1
    this.nextTickAt = 0
    this.relayTicks = 0
    this.cache = null

    if (!v.you) {
      this.current = 'espectador'
      return
    }
    if (v.you.playerId !== v.hostId) {
      this.current = 'client'
      return
    }
    this.current = 'host'
    // troca de host: continua do último retrato que este cliente viu; senão, partida nova
    const state = last ? this.sim.restore(last, statics) : this.binding.createState(v)
    this.hostState = state
    this.known = new Set(this.sim.roster(state).map((p) => p.slot))
    this.away.clear()
    for (const p of v.players) {
      if (!this.known.has(p.slot)) {
        this.sim.addPlayer(state, this.binding.refOf(p))
        this.known.add(p.slot)
      }
      if (!p.bot) {
        this.sim.setAway(state, p.slot, !p.present)
        this.away.set(p.slot, !p.present)
      }
    }
    const gen = ++this.runnerGen
    this.runner = this.env.createRunner({ k: 'init', state, epoch: v.epoch }, (m) => {
      if (gen === this.runnerGen) this.onHostOut(m)
    })
  }

  private stopRunner(): void {
    this.runnerGen++
    this.runner?.dispose()
    this.runner = undefined
  }

  /** jogador novo vira addPlayer; quem caiu/voltou vira setAway */
  private syncRoster(): void {
    if (this.current !== 'host' || !this.runner) return
    for (const p of this.view.players) {
      if (!this.known.has(p.slot)) {
        this.known.add(p.slot)
        this.runner.handle({ k: 'add', ref: this.binding.refOf(p) })
      }
      if (!p.bot && this.away.get(p.slot) !== !p.present) {
        this.away.set(p.slot, !p.present)
        this.runner.handle({ k: 'away', slot: p.slot, away: !p.present })
      }
    }
  }

  private onHostOut(m: HostOut<G>): void {
    switch (m.k) {
      case 'snap': {
        this.hostReady = true
        this.switching = false
        if (this.client.onSnapshot(m.snap, this.env.now())) this.flushEvents()
        this.transport.send('*', m.bytes)
        break
      }
      case 'score':
        this.deps.act({ type: 'score', epoch: m.epoch, scores: m.scores })
        break
      case 'result':
        this.deps.act({ type: 'result', epoch: m.epoch, ranking: m.ranking })
        break
    }
  }

  private flushEvents(): void {
    const ev = this.client.drainEvents()
    if (ev.length) for (const cb of this.listeners) cb(ev)
  }

  // ---------- laço ----------

  private pump(): void {
    if (this.disposed) return
    const now = this.env.now()
    this.transport.tick(now)
    if (this.current === 'espectador') return
    const codec = this.sim.codec

    if (now >= this.nextPingAt) {
      this.nextPingAt = now + PING_EVERY_MS
      this.pingSent = Math.floor(now)
      this.transport.send(this.current === 'host' ? '*' : this.view.hostId, codec.encodePing(this.pingSent >>> 0))
    }

    if (this.view.phase !== 'jogando') return
    const tickMs = this.sim.tickMs
    if (this.nextTickAt === 0 || now - this.nextTickAt > MAX_PUMP_CATCHUP_MS) this.nextTickAt = now
    let n = 0
    while (this.nextTickAt <= now && n++ < MAX_TICKS_PER_PUMP) {
      this.nextTickAt += tickMs
      const inputs = this.client.localTick(now, this.input)
      if (!inputs) break
      const you = this.view.you
      if (!you) break
      if (this.current === 'host') this.runner?.handle({ k: 'input', slot: you.slot, inputs: inputs.slice(-1) })
      else {
        // pelo repasse (HTTP/WebSocket do servidor) agrupa `relayBatch` ticks por pacote; o resto vai na redundância
        const batch = this.sim.relayBatch
        if (batch > 1 && this.transport.routeTo(this.view.hostId) === 'relay' && ++this.relayTicks % batch !== 0) continue
        this.transport.send(this.view.hostId, codec.encodeInputs(this.view.epoch, you.slot, inputs))
      }
    }
    this.flushEvents()
  }

  private slotOf(playerId: string): number | undefined {
    return this.view.players.find((p) => p.id === playerId && !p.bot)?.slot
  }

  private onPacket(from: string, data: ArrayBuffer): void {
    const pkt = this.sim.codec.decode(data)
    if (!pkt) return
    const now = this.env.now()
    switch (pkt.t) {
      case 'snapshot':
        if (this.current === 'host' || from !== this.view.hostId || pkt.epoch !== this.view.epoch) return
        if (this.client.onSnapshot(pkt as G['Snapshot'], now)) {
          this.switching = false
          this.flushEvents()
        }
        return
      case 'input': {
        if (this.current !== 'host' || pkt.epoch !== this.view.epoch) return
        const slot = this.slotOf(from)
        if (slot === undefined || slot !== pkt.slot) return
        this.runner?.handle({ k: 'input', slot, inputs: pkt.inputs })
        return
      }
      case 'ping':
        this.transport.send(from, this.sim.codec.encodePing(pkt.n, true))
        return
      case 'pong': {
        const rtt = Math.floor(now) - pkt.n
        if (rtt < 0 || rtt > 10_000) return
        if (this.current === 'host') {
          const slot = this.slotOf(from)
          if (slot !== undefined) this.runner?.handle({ k: 'ping', slot, pingMs: rtt })
        } else if (from === this.view.hostId) this.client.setPing(rtt)
        return
      }
      case 'hello':
        return
    }
  }

  private netStatus(now: number): NetStatus {
    if (this.current === 'host') return this.hostReady && !this.switching ? 'host' : this.switching ? 'trocando-host' : 'conectando'
    if (this.switching) return 'trocando-host'
    if (!this.client.hasSnapshot) return 'conectando'
    const age = now - this.client.lastReceiveAt
    if (age > STALE_OFFLINE_MS) return 'offline'
    if (age > STALE_CONNECTING_MS) return 'conectando'
    return this.transport.routeTo(this.view.hostId)
  }
}
