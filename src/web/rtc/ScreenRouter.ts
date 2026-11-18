/**
 * Orquestra a tela híbrida nos dois papéis, a cada ~2 s:
 * - quem compartilha: decide (route.ts) se a tela vai pela malha P2P ou pelo SFU e troca montando antes de desmontar;
 * - quem assiste: assina as telas que estão no SFU e só troca o que é mostrado depois do primeiro quadro.
 * Depende de interfaces (link, manager, relógio) para ser testado sem navegador.
 */
import type { PeerState } from '../../shared/protocol'
import type { Rid, RoutePref, ScreenRoute, SfuInfo } from '../../shared/sfu'
import type { AutoSample } from './autoQuality'
import type { DiagKind } from './diag'
import { ridForSize, sendEncodings } from './layers'
import { decideRoute, type RouteInputs, type RouteReason } from './route'

export const ROUTER_TICK_MS = 2_000
/** depois de publicar (ou de voltar para a malha) espera isto antes de desmontar o outro caminho */
export const HANDOVER_MS = 6_000
/** quem assiste espera isto pela malha antes de largar a assinatura do SFU */
export const LEAVE_MS = 6_000
export const LAYER_DEBOUNCE_MS = 1_500
/** depois de uma assinatura que falhou, tenta de novo depois disto */
export const RETRY_MS = 10_000

export interface Clock {
  now(): number
  /** espera `ms` (nos testes, avança com o relógio falso) */
  wait(ms: number): Promise<void>
  /** agenda uma vez; devolve o cancelamento */
  timeout(cb: () => void, ms: number): () => void
  interval(cb: () => void, ms: number): () => void
}

export const realClock: Clock = {
  now: () => performance.now(),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  timeout: (cb, ms) => {
    const t = setTimeout(cb, ms)
    return () => clearTimeout(t)
  },
  interval: (cb, ms) => {
    const t = setInterval(cb, ms)
    return () => clearInterval(t)
  }
}

/** O que o roteador usa da conexão com o SFU (SfuLink implementa). */
export interface RouterLink {
  publish(stream: MediaStream, encodings: RTCRtpEncodingParameters[]): Promise<Rid[]>
  setEncodings(encodings: RTCRtpEncodingParameters[]): Promise<void>
  unpublish(): Promise<void>
  subscribe(from: string, streamId: string, rid: Rid): Promise<MediaStream>
  firstFrame(from: string): Promise<void>
  setLayer(from: string, rid: Rid): Promise<void>
  unsubscribe(from: string): Promise<void>
  sendSample(): Promise<AutoSample | undefined>
  reset(): void
  onFailure(cb: (err: Error) => void): () => void
}

/** O que o roteador usa do PeerManager. */
export interface RouterManager {
  /** o stream da tela que eu compartilho (undefined = não compartilho) */
  readonly screen: MediaStream | undefined
  screenViewers(): number
  screenLimitedMs(): number
  captureLevel(): number | undefined
  setScreenMesh(enabled: boolean): void
  tickSfu(sample: AutoSample | undefined): boolean
  sfuTopParams(): { capturedHeight: number; top: { height: number; fps: number; bitrate: number } } | undefined
  sfuKey(): string
  /** as pessoas do meu canal; `screen` é a tela que chega pela malha */
  views(): Array<{ id: string; name: string; state: PeerState; screen?: MediaStream }>
  log: { push(e: { kind: DiagKind; text: string; who?: string }): void }
}

export interface ScreenRouterDeps {
  link: RouterLink
  manager: RouterManager
  clock?: Clock
  getSfu: () => SfuInfo
  getPref: () => RoutePref
  /** publica o meu estado na sala (screenRoute) */
  publishState: (patch: Partial<PeerState>) => void
  /** mudou a rota da minha tela ou o que a UI mostra do SFU */
  onChange?: () => void
}

const REASON_KIND: Record<RouteReason, DiagKind> = {
  muitos: 'info',
  limitado: 'banda',
  poucos: 'info',
  orcamento: 'info',
  preferencia: 'info',
  falha: 'down',
  indisponivel: 'info'
}

export function reasonText(reason: RouteReason, viewers: number): string {
  switch (reason) {
    case 'muitos':
      return `Tela passou pelo servidor da Cloudflare: ${viewers} pessoas assistindo`
    case 'limitado':
      return 'Tela passou pelo servidor da Cloudflare: envio no limite'
    case 'poucos':
      return `Tela voltou para conexão direta: ${viewers === 1 ? 'só 1 pessoa assistindo' : 'ninguém assistindo'}`
    case 'orcamento':
      return 'Servidor desligado: cota do mês quase no fim'
    case 'preferencia':
      return 'Rota da tela trocada por você'
    case 'falha':
      return 'O servidor da Cloudflare falhou; a tela voltou para a conexão direta'
    case 'indisponivel':
      return 'Servidor da Cloudflare indisponível; a tela voltou para a conexão direta'
  }
}

interface ViewSub {
  from: string
  name: string
  streamId: string
  /** já recebeu o primeiro quadro: o stream do SFU está no lugar do da malha */
  live: boolean
  /** camada em uso (ou pedida na assinatura) */
  rid: Rid
  failed: boolean
  retryAt: number
  /** quando a rota dela deixou de ser 'sfu' (esperando a malha chegar) */
  leavingSince?: number
  leaveTimer?: () => void
  layerTimer?: () => void
}

/** parou o que estava fazendo porque a tela mudou ou o roteador foi desligado (não é falha do SFU) */
class Aborted extends Error {}

const hasVideo = (s?: MediaStream): boolean => !!s && s.getVideoTracks().length > 0

export class ScreenRouter {
  private readonly clock: Clock
  private readonly link: RouterLink
  private readonly m: RouterManager
  private disposed = false

  // quem compartilha
  private route: ScreenRoute = 'mesh'
  /** o que está publicado no meu estado */
  private announced: ScreenRoute = 'mesh'
  private routeSince = 0
  private fewSince?: number
  private failedAt?: number
  private ctxStreamId?: string
  private published = false
  private busy = false
  private pendingFailure?: Error
  private lastKey = ''
  private ticking = false
  private stopTimer?: () => void
  private readonly offFailure: () => void

  // quem assiste
  private readonly subs = new Map<string, ViewSub>()
  private readonly shown = new Map<string, MediaStream>()
  private readonly sizes = new Map<string, { w: number; h: number }>()
  private holdUntil = 0

  constructor(private readonly deps: ScreenRouterDeps) {
    this.clock = deps.clock ?? realClock
    this.link = deps.link
    this.m = deps.manager
    this.routeSince = this.clock.now()
    this.offFailure = this.link.onFailure((err) => this.onLinkFailure(err))
  }

  // ---------------- leitura ----------------

  /** rota da minha tela agora (a que já está valendo, depois da espera) */
  get currentRoute(): ScreenRoute {
    return this.route
  }

  /** tela do SFU que a UI deve mostrar no lugar da malha, por pessoa */
  overrides(): ReadonlyMap<string, MediaStream> {
    return this.shown
  }

  start(): void {
    this.stopTimer?.()
    this.stopTimer = this.clock.interval(() => void this.tick(), ROUTER_TICK_MS)
  }

  dispose(): void {
    this.disposed = true
    this.stopTimer?.()
    this.offFailure()
    for (const sub of this.subs.values()) {
      sub.leaveTimer?.()
      sub.layerTimer?.()
    }
    this.subs.clear()
    this.shown.clear()
  }

  // ---------------- entradas de fora ----------------

  async tick(): Promise<void> {
    if (this.disposed) return
    // quem assiste não espera a troca de rota de quem compartilha (que pode levar uns segundos)
    this.syncViewers()
    if (this.ticking) return
    this.ticking = true
    try {
      await this.publisherTick()
    } catch (err) {
      console.warn('[sfu] roteador', err)
    } finally {
      this.ticking = false
    }
  }

  /** a lista de pessoas ou o estado delas mudou */
  update(): void {
    if (!this.disposed) this.syncViewers()
  }

  /** o orçamento mudou (sfu-budget) */
  onBudget(): void {
    if (this.disposed) return
    for (const sub of this.subs.values()) this.scheduleLayer(sub)
    this.syncViewers()
    void this.tick()
  }

  /** tamanho do vídeo dessa pessoa na tela, em pixels reais (CSS × devicePixelRatio) */
  reportSize(peerId: string, w: number, h: number): void {
    if (w <= 0 || h <= 0) return
    const before = this.sizes.get(peerId)
    if (before && before.w === w && before.h === h) return
    this.sizes.set(peerId, { w, h })
    const sub = this.subs.get(peerId)
    if (sub) this.scheduleLayer(sub)
  }

  // ---------------- quem compartilha ----------------

  private announce(route: ScreenRoute): void {
    this.announced = route
    this.deps.publishState({ screenRoute: route })
    this.deps.onChange?.()
  }

  private note(kind: DiagKind, text: string): void {
    this.m.log.push({ kind, text })
  }

  private async publisherTick(): Promise<void> {
    if (this.busy) return
    const stream = this.m.screen
    const now = this.clock.now()

    // parou de compartilhar, ou começou outra tela: solta o SFU
    if (this.ctxStreamId !== undefined && this.ctxStreamId !== stream?.id) await this.endShare()
    if (!stream) return
    if (this.ctxStreamId === undefined) {
      this.ctxStreamId = stream.id
      this.routeSince = now
    }

    const viewers = this.m.screenViewers()
    if (viewers <= 1) this.fewSince ??= now
    else this.fewSince = undefined

    if (this.route === 'sfu') await this.feedAuto()

    const sfu = this.deps.getSfu()
    const inputs: RouteInputs = {
      current: this.route,
      pref: this.deps.getPref(),
      viewers,
      limitedMs: this.m.screenLimitedMs(),
      level: this.m.captureLevel(),
      sinceSwitchMs: now - this.routeSince,
      fewViewersMs: this.fewSince === undefined ? 0 : now - this.fewSince,
      budget: sfu.budget,
      sfuEnabled: sfu.enabled,
      sinceFailureMs: this.failedAt === undefined ? undefined : now - this.failedAt
    }
    const d = decideRoute(inputs)
    if (!d.reason || d.route === this.route) return
    if (d.route === 'sfu') await this.toSfu(d.reason, viewers)
    else await this.toMesh(d.reason, viewers)
  }

  /** No SFU: a leitura de envio alimenta o automático e as camadas seguem o nível. */
  private async feedAuto(): Promise<void> {
    let sample: AutoSample | undefined
    try {
      sample = await this.link.sendSample()
    } catch {
      sample = undefined
    }
    this.m.tickSfu(sample)
    const key = this.m.sfuKey()
    if (!key || key === this.lastKey) return
    const p = this.m.sfuTopParams()
    if (!p) return
    this.lastKey = key
    try {
      await this.link.setEncodings(sendEncodings(p.capturedHeight, p.top))
    } catch (err) {
      console.warn('[sfu] camadas', err)
    }
  }

  private assertAlive(streamId: string): void {
    if (this.disposed || this.m.screen?.id !== streamId) throw new Aborted()
    if (this.pendingFailure) throw this.pendingFailure
  }

  /** mesh para sfu: publica, avisa, espera os espectadores assinarem e só então tira da malha */
  private async toSfu(reason: RouteReason, viewers: number): Promise<void> {
    const stream = this.m.screen
    const params = this.m.sfuTopParams()
    if (!stream || !params) return
    const streamId = stream.id
    this.busy = true
    this.pendingFailure = undefined
    try {
      await this.link.publish(stream, sendEncodings(params.capturedHeight, params.top))
      this.published = true
      this.lastKey = this.m.sfuKey()
      this.assertAlive(streamId)
      this.announce('sfu')
      this.note(REASON_KIND[reason], reasonText(reason, viewers))
      await this.clock.wait(HANDOVER_MS)
      this.assertAlive(streamId)
      this.m.setScreenMesh(false)
      this.route = 'sfu'
      this.routeSince = this.clock.now()
      this.deps.onChange?.()
    } catch (err) {
      if (err instanceof Aborted) return // a próxima rodada limpa (endShare)
      this.fallback(err)
    } finally {
      this.busy = false
    }
  }

  /** sfu para mesh: religa a malha, avisa, espera a malha chegar e só então solta o SFU */
  private async toMesh(reason: RouteReason, viewers: number): Promise<void> {
    this.busy = true
    this.pendingFailure = undefined
    try {
      this.m.setScreenMesh(true)
      this.announce('mesh')
      this.route = 'mesh'
      this.routeSince = this.clock.now()
      this.note(REASON_KIND[reason], reasonText(reason, viewers))
      this.deps.onChange?.()
      await this.clock.wait(HANDOVER_MS)
      if (this.published) {
        this.published = false
        await this.link.unpublish()
      }
    } catch (err) {
      console.warn('[sfu] ao soltar o servidor', err)
      this.failedAt = this.clock.now()
      this.published = false
      this.link.reset()
      this.dropViewers()
    } finally {
      this.busy = false
    }
  }

  /** Erro do SFU: volta para a malha na hora e guarda o horário (o decideRoute respeita o cooldown). */
  private fallback(err: unknown): void {
    console.warn('[sfu] falhou, voltando para a malha', err)
    this.failedAt = this.clock.now()
    this.m.setScreenMesh(true)
    if (this.announced !== 'mesh' && this.m.screen) this.announce('mesh')
    this.route = 'mesh'
    this.routeSince = this.clock.now()
    this.published = false
    this.link.reset()
    this.dropViewers()
    this.note(REASON_KIND.falha, reasonText('falha', 0))
    this.deps.onChange?.()
  }

  /** parou de compartilhar (ou trocou de tela): solta o SFU */
  private async endShare(): Promise<void> {
    this.busy = true
    try {
      this.ctxStreamId = undefined
      this.route = 'mesh'
      this.announced = 'mesh'
      this.fewSince = undefined
      this.lastKey = ''
      this.routeSince = this.clock.now()
      if (this.published) {
        this.published = false
        try {
          await this.link.unpublish()
        } catch (err) {
          console.warn('[sfu] ao parar a tela', err)
          this.link.reset()
          this.dropViewers()
        }
      }
      this.deps.onChange?.()
    } finally {
      this.busy = false
    }
  }

  private onLinkFailure(err: Error): void {
    if (this.disposed) return
    this.dropViewers()
    if (this.busy) {
      this.pendingFailure = err
      return
    }
    if (this.route === 'sfu' && this.m.screen) this.fallback(err)
  }

  // ---------------- quem assiste ----------------

  private ridFor(peerId: string): Rid {
    const s = this.sizes.get(peerId)
    if (!s) return 'b'
    return ridForSize(s.w, s.h, this.deps.getSfu().budget)
  }

  private syncViewers(): void {
    const sfu = this.deps.getSfu()
    const usable = sfu.enabled && sfu.budget !== 'esgotado'
    const now = this.clock.now()
    const peers = this.m.views()
    const byId = new Map(peers.map((p) => [p.id, p]))
    let changed = false

    for (const p of peers) {
      const streamId = p.state.screenStreamId
      const want = usable && p.state.sharing && p.state.screenRoute === 'sfu' && !!streamId
      if (!want || !streamId) continue
      let sub = this.subs.get(p.id)
      if (sub && sub.streamId !== streamId) {
        this.finish(sub)
        sub = undefined
        changed = true
      }
      if (sub) {
        // voltou para o servidor enquanto esperava a malha
        if (sub.leavingSince !== undefined) {
          sub.leavingSince = undefined
          sub.leaveTimer?.()
          sub.leaveTimer = undefined
        }
        if (sub.failed && now >= sub.retryAt && now >= this.holdUntil) {
          sub.failed = false
          sub.rid = this.ridFor(p.id)
          void this.runSub(sub)
        }
        continue
      }
      if (now < this.holdUntil) continue
      sub = { from: p.id, name: p.name, streamId, live: false, rid: this.ridFor(p.id), failed: false, retryAt: 0 }
      this.subs.set(p.id, sub)
      void this.runSub(sub)
    }

    for (const sub of [...this.subs.values()]) {
      const p = byId.get(sub.from)
      const streamId = p?.state.screenStreamId
      const stillSfu = !!p && usable && p.state.sharing && p.state.screenRoute === 'sfu' && streamId === sub.streamId
      if (stillSfu) continue
      if (!p || !p.state.sharing) {
        this.finish(sub)
        changed = true
        continue
      }
      // a rota dela voltou para a malha: mostra a malha quando tiver vídeo; senão larga depois de LEAVE_MS
      sub.leavingSince ??= now
      if (hasVideo(p.screen) || now - sub.leavingSince >= LEAVE_MS) {
        this.finish(sub)
        changed = true
      } else if (!sub.leaveTimer) {
        sub.leaveTimer = this.clock.timeout(() => {
          sub.leaveTimer = undefined
          this.syncViewers()
        }, LEAVE_MS - (now - sub.leavingSince))
      }
    }
    if (changed) this.deps.onChange?.()
  }

  private isCurrent(sub: ViewSub): boolean {
    return !this.disposed && this.subs.get(sub.from) === sub
  }

  private async runSub(sub: ViewSub): Promise<void> {
    try {
      const stream = await this.link.subscribe(sub.from, sub.streamId, sub.rid)
      if (!this.isCurrent(sub)) return
      await this.link.firstFrame(sub.from)
      if (!this.isCurrent(sub)) return
      sub.live = true
      this.shown.set(sub.from, stream)
      this.m.log.push({ kind: 'info', who: sub.name, text: `Recebendo a tela de ${sub.name} pelo servidor da Cloudflare` })
      this.deps.onChange?.()
      // o tamanho pode ter mudado enquanto assinava
      this.applyLayer(sub)
    } catch (err) {
      if (!this.isCurrent(sub)) return
      console.warn('[sfu] assinatura', err)
      sub.failed = true
      sub.retryAt = this.clock.now() + RETRY_MS
      this.link.unsubscribe(sub.from).catch(() => undefined)
    }
  }

  /** Larga a assinatura: tira a tela do SFU da UI e fecha no servidor. */
  private finish(sub: ViewSub): void {
    this.subs.delete(sub.from)
    sub.leaveTimer?.()
    sub.layerTimer?.()
    this.shown.delete(sub.from)
    this.link.unsubscribe(sub.from).catch((err) => console.warn('[sfu] ao largar a assinatura', err))
  }

  /** a conexão com o SFU caiu: esquece as assinaturas e tenta de novo daqui a pouco */
  private dropViewers(): void {
    for (const sub of this.subs.values()) {
      sub.leaveTimer?.()
      sub.layerTimer?.()
    }
    const had = this.subs.size > 0 || this.shown.size > 0
    this.subs.clear()
    this.shown.clear()
    this.holdUntil = this.clock.now() + RETRY_MS
    if (had) this.deps.onChange?.()
  }

  private scheduleLayer(sub: ViewSub): void {
    sub.layerTimer?.()
    sub.layerTimer = this.clock.timeout(() => {
      sub.layerTimer = undefined
      this.applyLayer(sub)
    }, LAYER_DEBOUNCE_MS)
  }

  private applyLayer(sub: ViewSub): void {
    if (!this.isCurrent(sub) || !sub.live) return
    const want = this.ridFor(sub.from)
    if (want === sub.rid) return
    this.link
      .setLayer(sub.from, want)
      .then(() => {
        if (this.isCurrent(sub)) sub.rid = want
      })
      .catch((err) => console.warn('[sfu] camada', err))
  }
}
