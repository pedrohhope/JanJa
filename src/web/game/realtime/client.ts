/**
 * Base do cliente de um jogo de tempo real: buffer de snapshots, relógio do host (offset), eventos
 * sem repetição, entradas pendentes, predição e reconciliação do próprio jogador (com suavização)
 * e ping. Sem DOM, sem rede, relógio injetado (todo método que depende de tempo recebe `now`, ms).
 *
 * O jogo estende esta classe só para: criar a entrada de cada tick (`advanceLocal`), montar o quadro
 * de desenho (`frame`, usando `interpolation`) e reagir a eventos (`onEvent`). O host também usa o
 * cliente (laço local), então tudo aqui roda igual nos dois papéis.
 */
import type { RealtimeSim, RealtimeTypes, SnapshotBase } from './types'

/** correção menor que isto é suavizada; maior é teletransporte (padrão; `sim.smoothMaxPx`) */
export const SMOOTH_MAX_PX = 24
export const SMOOTH_MS = 100
const MAX_SNAPS = 40
const MAX_PENDING = 120

/** o par de snapshots em volta do instante de desenho */
export interface Interpolation<S extends SnapshotBase<unknown>> {
  last: S
  a: S
  b: S
  /** 0..1 entre `a` e `b` */
  u: number
  /** relógio do host agora (ms) */
  hostNow: number
  /** instante desenhado: `hostNow - interpDelayMs` */
  renderT: number
  /** tick (fracionário) do host agora, limitado a 10 ticks à frente do último retrato */
  tickNow: number
}

export interface RealtimeClientOptions<G extends RealtimeTypes> {
  sim: RealtimeSim<G>
  /** meu slot (null = espectador) */
  me: number | null
  interpDelayMs?: number
}

export class RealtimeClient<G extends RealtimeTypes, Out = G['Event']> {
  readonly me: number | null
  protected readonly sim: RealtimeSim<G>
  protected readonly delay: number
  protected snaps: G['Snapshot'][] = []
  protected epoch = -1
  protected statics: G['Statics'] | null = null
  protected offset: number | null = null
  protected lastRecvAt = 0
  protected seq = 0
  protected pending: G['Input'][] = []
  protected sent: G['Input'][] = []
  protected pred: G['Self'] | null = null
  protected predTick = 0
  protected smoothDx = 0
  protected smoothDy = 0
  protected smoothAt = 0
  protected seenEvents = new Set<number>()
  protected firstSnapshot = true
  protected out: Out[] = []
  protected pingValue = 0
  private resetPending = false

  constructor(opts: RealtimeClientOptions<G>) {
    this.me = opts.me
    this.sim = opts.sim
    this.delay = opts.interpDelayMs ?? opts.sim.interpDelayMs
  }

  // ---------- ping ----------

  setPing(ms: number): void {
    this.pingValue = this.pingValue === 0 ? ms : this.pingValue * 0.7 + ms * 0.3
  }

  get pingMs(): number {
    return Math.round(this.pingValue)
  }

  // ---------- snapshots ----------

  /**
   * Novo host: segue desenhando o último retrato até chegar o primeiro do epoch novo (aí esquece
   * snapshots e relógio, porque o tick recomeça de onde o novo host parou). Entradas pendentes e
   * sequência continuam.
   */
  beginEpoch(epoch: number): void {
    if (epoch === this.epoch) return
    this.epoch = epoch
    this.resetPending = true
  }

  get latest(): G['Snapshot'] | undefined {
    return this.snaps[this.snaps.length - 1]
  }

  get latestStatics(): G['Statics'] | null {
    return this.statics
  }

  get lastReceiveAt(): number {
    return this.lastRecvAt
  }

  get hasSnapshot(): boolean {
    return this.snaps.length > 0
  }

  /** Aplica um snapshot. Devolve false se for repetido, antigo ou de outro epoch. */
  onSnapshot(snap: G['Snapshot'], now: number): boolean {
    if (snap.epoch !== this.epoch) {
      if (snap.epoch < this.epoch) return false
      this.beginEpoch(snap.epoch)
    }
    if (this.resetPending) {
      this.resetPending = false
      this.snaps = []
      this.offset = null
      this.firstSnapshot = true
      this.seenEvents.clear()
    }
    const last = this.latest
    if (last && snap.tick <= last.tick) return false
    this.statics = this.sim.mergeStatics ? this.sim.mergeStatics(this.statics, snap) : this.statics
    this.snaps.push(snap)
    if (this.snaps.length > MAX_SNAPS) this.snaps.shift()
    this.lastRecvAt = now

    // o relógio do host: o menor `agora - tick*tickMs` é o mais fiel (menos atraso de rede)
    const sample = now - snap.tick * this.sim.tickMs
    if (this.offset === null || sample < this.offset) this.offset = sample
    else this.offset += (sample - this.offset) * 0.01

    this.processEvents(snap, now)
    this.reconcile(snap, now)
    return true
  }

  private processEvents(snap: G['Snapshot'], now: number): void {
    const ordinal = new Map<number, number>()
    for (const { tick, ev } of snap.events) {
      const i = ordinal.get(tick) ?? 0
      ordinal.set(tick, i + 1)
      const key = tick * 1024 + i
      if (this.seenEvents.has(key)) continue
      this.seenEvents.add(key)
      if (this.firstSnapshot) continue // histórico de antes de eu chegar: não toca de novo
      this.onEvent(ev as G['Event'], now)
    }
    this.firstSnapshot = false
    if (this.seenEvents.size > 600) {
      const floor = (snap.tick - 400) * 1024
      for (const k of this.seenEvents) if (k < floor) this.seenEvents.delete(k)
    }
    this.afterEvents(now)
  }

  /** Evento novo (nunca visto). O jogo pode descartar ou transformar; o padrão entrega como veio. */
  protected onEvent(ev: G['Event'], _now: number): void {
    this.out.push(ev as unknown as Out)
  }

  /** Depois de processar os eventos de um snapshot (limpeza de coisas previstas, por exemplo). */
  protected afterEvents(_now: number): void {}

  /** eventos novos desde a última chamada */
  drainEvents(): Out[] {
    if (!this.out.length) return this.out
    const o = this.out
    this.out = []
    return o
  }

  // ---------- reconciliação ----------

  /** Meu jogador a partir do retrato. O jogo pode sobrescrever (para pôr o id da sala, por exemplo). */
  protected selfFrom(snap: G['Snapshot']): G['Self'] | null {
    return this.me === null ? null : this.sim.selfOf(snap, this.me, this.statics)
  }

  private reconcile(snap: G['Snapshot'], now: number): void {
    if (this.me === null) return
    const np = this.selfFrom(snap)
    if (!np) {
      this.pred = null
      return
    }
    const sim = this.sim
    const ack = sim.ackOf(np)
    this.pending = this.pending.filter((i) => i.seq > ack)
    const prev = this.pred
    const prevPos = prev ? this.renderPos(sim.selfPos(prev), now) : null
    let tick = snap.tick
    if (sim.canPredict(np, snap)) {
      for (const i of this.pending) sim.predictSelf(np, snap, i, ++tick)
    }
    this.pred = np
    this.predTick = tick
    if (prevPos && prev && sim.selfAlive(prev) && sim.selfAlive(np)) {
      const pos = sim.selfPos(np)
      const dx = prevPos.x - pos.x
      const dy = prevPos.y - pos.y
      if (Math.hypot(dx, dy) < (sim.smoothMaxPx ?? SMOOTH_MAX_PX)) {
        this.smoothDx = dx
        this.smoothDy = dy
        this.smoothAt = now
        return
      }
    }
    this.smoothDx = this.smoothDy = 0
  }

  private smoothFactor(now: number): number {
    return Math.max(0, 1 - (now - this.smoothAt) / (this.sim.smoothMs ?? SMOOTH_MS))
  }

  /** posição para desenhar: a prevista mais a correção que ainda está sumindo */
  protected renderPos(p: { x: number; y: number }, now: number): { x: number; y: number } {
    const f = this.smoothFactor(now)
    return f > 0 ? { x: p.x + this.smoothDx * f, y: p.y + this.smoothDy * f } : { x: p.x, y: p.y }
  }

  // ---------- entrada local ----------

  /**
   * Um tick local: cria a entrada nova (`make` recebe a seq), prevê o movimento e chama `after`
   * (tiro previsto, som local...). Devolve as últimas `inputRedundancy + 1` entradas (a mais antiga
   * primeiro) para mandar ao host, ou null se não joga.
   */
  protected advanceLocal(now: number, make: (seq: number) => G['Input'], after?: (self: G['Self'], input: G['Input'], now: number) => void): G['Input'][] | null {
    if (this.me === null) return null
    const snap = this.latest
    const input = make(++this.seq)
    this.pending.push(input)
    if (this.pending.length > MAX_PENDING) this.pending.shift()
    this.sent.push(input)
    if (this.sent.length > this.sim.inputRedundancy + 1) this.sent.shift()

    const p = this.pred
    if (snap && p && this.sim.canPredict(p, snap)) {
      this.sim.predictSelf(p, snap, input, ++this.predTick)
      after?.(p, input, now)
    }
    return this.sent.slice()
  }

  // ---------- quadro ----------

  /** o relógio do host agora (0 antes do primeiro snapshot) */
  protected hostNow(now: number): number {
    return this.offset === null ? 0 : now - this.offset
  }

  /** O par de snapshots em volta do instante de desenho. null antes do primeiro snapshot. */
  protected interpolation(now: number): Interpolation<G['Snapshot']> | null {
    const last = this.latest
    if (!last || this.offset === null) return null
    const tickMs = this.sim.tickMs
    const hostNow = this.hostNow(now)
    const renderT = hostNow - this.delay
    const tickNow = Math.min(last.tick + 10, Math.max(last.tick, hostNow / tickMs))
    let a = this.snaps[0]
    let b = this.snaps[0]
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick * tickMs <= renderT) {
        a = this.snaps[i]
        b = this.snaps[Math.min(i + 1, this.snaps.length - 1)]
        break
      }
    }
    if (renderT >= last.tick * tickMs) a = b = last
    const span = (b.tick - a.tick) * tickMs
    const u = span > 0 ? Math.min(1, Math.max(0, (renderT - a.tick * tickMs) / span)) : 0
    return { last, a, b, u, hostNow, renderT, tickNow }
  }

  /** meu jogador previsto (sem suavização), para testes */
  get predicted(): G['Self'] | null {
    return this.pred
  }

  get pendingCount(): number {
    return this.pending.length
  }
}
