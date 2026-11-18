/**
 * Qualidade automática por espectador (mesh): cada pessoa que recebe a tela tem o seu próprio
 * `AutoQuality`, então uma conexão ruim só rebaixa quem está nela. Limite de CPU é do PC de quem
 * compartilha: derruba o teto de todos e ele volta a subir aos poucos. Tudo puro: o tempo entra por parâmetro.
 */
import { AUTO_LADDER, AUTO_START, AutoQuality, autoLevelPreset, type AutoReason, type AutoSample } from './autoQuality'
import { bitrateFor, pixelScale } from './quality'

/** sem CPU limitada por tanto tempo, o teto sobe +1 nível */
export const CPU_RECOVER_MS = 120_000

const TOP = AUTO_LADDER.length - 1
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export interface ViewerChange {
  id: string
  level: number
  dir: 'up' | 'down'
  reason: AutoReason
}

export interface ViewersTick {
  /** quem mudou de nível neste tick (inclui quem foi rebaixado pelo teto de CPU) */
  changes: ViewerChange[]
  /** maior nível entre os espectadores: o que a trilha capturada precisa ter */
  captureLevel: number
  captureChanged: boolean
}

export class PerViewerAuto {
  private readonly viewers = new Map<string, AutoQuality>()
  /** teto por tela nativa (3 = 1080p 60; 4 só com tela de 1440 ou mais) */
  private hardMax: number
  /** teto imposto pela CPU; volta a subir sozinho */
  private cpuMax = TOP
  private lastCpuAt = -Infinity
  private lastRaiseAt = -Infinity
  /** nível da captura enquanto não há espectadores */
  private idle: number

  constructor(opts: { maxLevel?: number } = {}) {
    this.hardMax = clamp(opts.maxLevel ?? TOP, 0, TOP)
    this.idle = Math.min(AUTO_START, this.hardMax)
  }

  /** Teto efetivo agora (tela nativa e CPU). */
  get ceiling(): number {
    return Math.min(this.hardMax, this.cpuMax)
  }

  get size(): number {
    return this.viewers.size
  }

  ids(): string[] {
    return [...this.viewers.keys()]
  }

  has(id: string): boolean {
    return this.viewers.has(id)
  }

  level(id: string): number | undefined {
    return this.viewers.get(id)?.level
  }

  /** Maior nível entre os espectadores (sem ninguém: o último nível da captura). */
  captureLevel(): number {
    if (this.viewers.size === 0) return Math.min(this.idle, this.ceiling)
    let max = 0
    for (const q of this.viewers.values()) max = Math.max(max, q.level)
    return max
  }

  /** Espectador novo começa em min(nível da captura, AUTO_START), ou no nível pedido. */
  add(id: string, startAt?: number): void {
    if (this.viewers.has(id)) return
    const start = startAt ?? Math.min(this.captureLevel(), AUTO_START)
    this.viewers.set(id, new AutoQuality({ start, maxLevel: this.ceiling }))
  }

  remove(id: string): void {
    if (!this.viewers.has(id)) return
    if (this.viewers.size === 1) this.idle = this.captureLevel()
    this.viewers.delete(id)
  }

  /** Esquece todo mundo e o castigo de CPU (a tela parou ou recomeçou). */
  clear(): void {
    this.viewers.clear()
    this.cpuMax = TOP
    this.lastCpuAt = -Infinity
    this.lastRaiseAt = -Infinity
    this.idle = Math.min(AUTO_START, this.hardMax)
  }

  /** Teto da tela nativa (1440p só se a tela tiver 1440 de altura ou mais). */
  setMaxLevel(max: number): void {
    this.hardMax = clamp(max, 0, TOP)
    this.applyCeiling([])
  }

  /** Aplica o teto efetivo em todos; quem estava acima desce e entra em `changes` (motivo: cpu). */
  private applyCeiling(changes: ViewerChange[]): void {
    const cap = this.ceiling
    for (const [id, q] of this.viewers) {
      const before = q.level
      q.setMaxLevel(cap)
      if (q.level < before && !changes.some((c) => c.id === id && c.level === q.level))
        changes.push({ id, level: q.level, dir: 'down', reason: 'cpu' })
    }
  }

  /**
   * Uma leitura a cada ~2 s. `samples` tem a amostra de cada espectador (quem não tem fica de fora);
   * `capKbps(id)` é o teto de bitrate daquela conexão.
   */
  tick(samples: ReadonlyMap<string, AutoSample>, now: number, capKbps: (id: string) => number): ViewersTick {
    const before = this.captureLevel()
    const changes: ViewerChange[] = []
    const cpuDrops: number[] = []

    for (const s of samples.values()) if (s.limitation === 'cpu') this.lastCpuAt = now

    for (const [id, q] of this.viewers) {
      const s = samples.get(id)
      const d = q.tick(s ? [s] : [], now, capKbps(id))
      if (!d.changed || !d.dir || !d.reason) continue
      changes.push({ id, level: d.level, dir: d.dir, reason: d.reason })
      if (d.dir === 'down' && d.reason === 'cpu') cpuDrops.push(d.level)
    }

    if (cpuDrops.length > 0) {
      // CPU é do PC de quem compartilha: o teto de todos cai para o maior nível já rebaixado
      this.lastCpuAt = now
      this.cpuMax = Math.min(this.cpuMax, Math.max(...cpuDrops))
      this.applyCeiling(changes)
    } else if (this.cpuMax < this.hardMax && now - Math.max(this.lastCpuAt, this.lastRaiseAt) >= CPU_RECOVER_MS) {
      this.cpuMax++
      this.lastRaiseAt = now
      this.applyCeiling(changes)
    }

    const after = this.captureLevel()
    return { changes, captureLevel: after, captureChanged: after !== before }
  }
}

/** Parâmetros do sender de um espectador, a partir do nível dele e do tamanho da trilha capturada. */
export interface ViewerSendParams {
  maxBitrate: number
  maxFramerate: number
  scaleResolutionDownBy: number
}

export function viewerSendParams(
  level: number,
  viewers: number,
  captured: { width?: number; height?: number } = {}
): ViewerSendParams {
  const preset = autoLevelPreset(level)
  const scale = captured.height ? Math.max(1, captured.height / preset.height) : 1
  // o bitrate acompanha os pixels que de fato saem (já reduzidos), como o pixelScale faz com a captura
  const w = captured.width ? captured.width / scale : undefined
  const h = captured.height ? captured.height / scale : undefined
  return {
    maxBitrate: bitrateFor(preset, viewers, pixelScale(preset, w, h)),
    maxFramerate: preset.fps,
    scaleResolutionDownBy: scale
  }
}

/** Há quanto tempo, sem parar, uma condição vem sendo verdadeira. */
export class Streak {
  private since?: number

  update(active: boolean, now: number): void {
    if (!active) this.since = undefined
    else this.since ??= now
  }

  ms(now: number): number {
    return this.since === undefined ? 0 : Math.max(0, now - this.since)
  }

  reset(): void {
    this.since = undefined
  }
}
