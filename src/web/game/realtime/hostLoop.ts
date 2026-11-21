/**
 * Laço da simulação do host, sem DOM e sem Worker (o relógio entra por `advance(now)`).
 * Roda dentro do Web Worker de cada jogo (veja `hostWorkerEntry.ts`) ou, se o Worker não existir,
 * na thread principal. Genérico: o jogo entra por `RealtimeSim`.
 *
 * Fila por jogador, descarte das entradas repetidas da redundância, "solta tudo" quando a rede
 * some (stale), lag por ping, janela de eventos nos snapshots, snapshot cheio periódico, placar
 * parcial e resultado final, catch-up limitado.
 */
import type { HostIn, HostOut, RealtimeSim, RealtimeTypes, TimedEvent } from './types'

/** fila máxima de entradas por jogador (padrão; o jogo pode mudar em `sim.maxQueue`) */
export const MAX_QUEUE = 3
/** se o laço atrasar mais que isto, pula em vez de correr */
export const MAX_CATCHUP_MS = 250
/** sem entrada por tantos ticks: o jogador "solta tudo" (padrão; `sim.staleTicks`) */
export const STALE_TICKS = 8
/** eventos dos últimos N ticks vão repetidos em cada snapshot (cobre perda) */
export const EVENT_WINDOW_TICKS = 6
/** de quanto em quanto tempo o placar parcial vai ao coordenador (s) */
export const SCORE_EVERY_S = 5
/** folga do acumulador em ms: 16,6666 - 16,6667 não pode perder um tick */
const EPS = 1e-6

export class HostLoop<G extends RealtimeTypes> {
  readonly state: G['State']
  readonly epoch: number
  private last: number
  private acc = 0
  private stopped = false
  private readonly seen = new Map<number, number>()
  private readonly queue = new Map<number, G['Input'][]>()
  private readonly stale = new Map<number, number>()
  private readonly ping = new Map<number, number>()
  private recent: TimedEvent<G['Event']>[] = []
  private resultSent = false
  private firstSnap = true
  private overTicks = 0
  private readonly maxLagTicks: number
  private readonly maxQueue: number
  private readonly staleTicks: number
  private readonly maxTicksPerAdvance: number
  private readonly scoreEveryTicks: number
  /** quantas entradas foram aplicadas (diagnóstico/testes) */
  applied = 0
  /** gancho de teste: chamado a cada entrada nova aplicada */
  onApply?: (slot: number, seq: number) => void

  constructor(
    protected readonly sim: RealtimeSim<G>,
    init: { state: G['State']; epoch: number },
    private readonly out: (m: HostOut<G>) => void,
    now: number
  ) {
    this.state = init.state
    this.epoch = init.epoch
    this.last = now
    this.maxLagTicks = Math.ceil(sim.maxLagCompMs / sim.tickMs)
    this.maxQueue = sim.maxQueue ?? MAX_QUEUE
    this.staleTicks = sim.staleTicks ?? STALE_TICKS
    this.maxTicksPerAdvance = Math.max(12, Math.ceil(MAX_CATCHUP_MS / sim.tickMs) + 1)
    this.scoreEveryTicks = Math.round(SCORE_EVERY_S * sim.tickHz)
    for (const p of sim.roster(this.state)) this.seen.set(p.slot, p.lastSeq)
    this.resultSent = sim.isOver(this.state)
  }

  handle(m: HostIn<G>): void {
    if (this.stopped) return
    switch (m.k) {
      case 'input':
        this.accept(m.slot, m.inputs)
        break
      case 'ping':
        if (Number.isFinite(m.pingMs)) this.ping.set(m.slot, Math.max(0, Math.min(2000, m.pingMs)))
        break
      case 'add': {
        const slot = (m.ref as { slot: number }).slot
        if (!this.sim.roster(this.state).some((p) => p.slot === slot)) {
          this.sim.addPlayer(this.state, m.ref)
          this.seen.set(slot, 0)
        }
        break
      }
      case 'away':
        this.sim.setAway(this.state, m.slot, m.away)
        break
      case 'stop':
        this.stopped = true
        break
      case 'init':
        break
    }
  }

  /** Entradas novas (seq maior que a maior já vista), em ordem; as repetidas da redundância caem fora. */
  private accept(slot: number, inputs: readonly G['Input'][]): void {
    const p = this.sim.roster(this.state).find((x) => x.slot === slot)
    if (!p || p.bot) return
    let q = this.queue.get(slot)
    if (!q) this.queue.set(slot, (q = []))
    let seen = this.seen.get(slot) ?? 0
    const sorted = [...inputs].sort((a, b) => (a?.seq ?? 0) - (b?.seq ?? 0))
    for (const raw of sorted) {
      const i = this.sim.sanitizeInput(raw)
      if (!i || i.seq <= seen) continue
      seen = i.seq
      q.push(i)
    }
    this.seen.set(slot, seen)
    while (q.length > this.maxQueue) q.shift()
  }

  /** Avança o relógio; roda quantos ticks forem devidos (pula se atrasou demais). */
  advance(now: number): void {
    if (this.stopped) return
    const tickMs = this.sim.tickMs
    let dt = now - this.last
    this.last = now
    if (dt < 0) dt = 0
    if (dt > MAX_CATCHUP_MS) {
      this.acc = 0
      dt = tickMs
    }
    this.acc += dt
    let n = 0
    // o acumulador guarda o resto (não zera): 16,67 ms por tick não deriva em minutos de jogo
    while (this.acc >= tickMs - EPS && n < this.maxTicksPerAdvance) {
      this.acc -= tickMs
      this.tick()
      n++
    }
    if (n === this.maxTicksPerAdvance) this.acc = 0
    else if (this.acc < 0) this.acc = 0
  }

  private lag(slot: number): number {
    const ping = this.ping.get(slot) ?? 0
    return Math.min(this.maxLagTicks, Math.round(ping / 2 / this.sim.tickMs))
  }

  private tick(): void {
    const sim = this.sim
    const s = this.state
    const inputs = new Map<number, G['Input']>()
    for (const p of sim.roster(s)) {
      if (p.bot) continue
      const q = this.queue.get(p.slot)
      const next = q?.shift()
      if (next) {
        this.stale.set(p.slot, 0)
        inputs.set(p.slot, { ...next, lagTicks: this.lag(p.slot) })
        this.applied++
        this.onApply?.(p.slot, next.seq)
      } else {
        const n = (this.stale.get(p.slot) ?? 0) + 1
        this.stale.set(p.slot, n)
        // perda curta: a sim repete a última; sumiu de vez: solta tudo
        if (n > this.staleTicks) inputs.set(p.slot, { ...sim.emptyInput, seq: this.seen.get(p.slot) ?? p.lastSeq })
      }
    }
    const t0 = sim.tickOf(s)
    const events = sim.step(s, inputs)
    for (const ev of events) this.recent.push({ tick: t0, ev })
    const tickNow = sim.tickOf(s)
    const min = tickNow - EVENT_WINDOW_TICKS
    if (this.recent.length && this.recent[0].tick <= min) this.recent = this.recent.filter((e) => e.tick > min)

    // depois do fim o tick para: reenvia o retrato final algumas vezes (o canal perde pacotes)
    const over = sim.isOver(s) && tickNow === t0
    if (over) this.overTicks++
    const due = over ? this.overTicks % 20 === 1 && this.overTicks < 200 : tickNow % sim.snapshotEvery === 0
    if (due) {
      const full = this.firstSnap || over || tickNow % sim.fullSnapshotEvery === 0
      this.firstSnap = false
      const snap = sim.snapshot(s, this.recent, { epoch: this.epoch, full })
      this.out({ k: 'snap', snap, bytes: sim.codec.encodeSnapshot(snap) })
    }
    if (!over && tickNow % this.scoreEveryTicks === 0) this.out({ k: 'score', epoch: this.epoch, scores: sim.scores(s) })
    if (sim.isOver(s) && !this.resultSent) {
      this.resultSent = true
      this.out({ k: 'score', epoch: this.epoch, scores: sim.scores(s) })
      this.out({ k: 'result', epoch: this.epoch, ranking: sim.ranking(s) })
    }
  }
}
