/**
 * A conexão única deste cliente com o SFU da Cloudflare (tela híbrida).
 * Uma RTCPeerConnection serve para publicar a minha tela e para assistir a das outras pessoas.
 * Tudo passa pela sala (`sfu-*` no WebSocket): o servidor guarda as credenciais e fala com a API do Realtime.
 * As operações de SDP entram numa fila (uma de cada vez); o resto (fila, pedido/resposta, contagem de uso,
 * montagem do stream por mid) é código puro e fica exportado para os testes.
 */
import type { ClientMessage, ServerMessage } from '../../shared/protocol'
import type { Rid, Sdp, SfuErrorCode } from '../../shared/sfu'
import type { AutoSample } from './autoQuality'
import { prioritizeScreen } from './quality'
import { readStats, type Counters, type StatRow } from './stats'

export const SFU_ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' }

const REQUEST_TIMEOUT_MS = 15_000
const USAGE_EVERY_MS = 30_000
const FRAME_POLL_MS = 250
const FIRST_FRAME_TIMEOUT_MS = 8_000

export type SfuLinkErrorCode = SfuErrorCode | 'timeout' | 'sdp' | 'connection' | 'closed'

/** Erro de uma operação com o SFU. `fatal` = a conexão ficou num estado que não dá para aproveitar. */
export class SfuError extends Error {
  constructor(
    readonly code: SfuLinkErrorCode,
    message: string,
    readonly fatal = false
  ) {
    super(message)
    this.name = 'SfuError'
  }
}

// ---------------- peças puras ----------------

/** Executa uma função assíncrona de cada vez, na ordem em que chegaram. Um erro não trava a fila. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn)
    this.tail = result.catch(() => undefined)
    return result
  }
}

export type SfuReply = Extract<ServerMessage, { type: 'sfu-reply' }>

/** Pedido e resposta por `requestId`, com prazo. */
export class RequestTracker {
  private readonly pending = new Map<string, { resolve: (r: SfuReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private n = 0

  constructor(
    private readonly send: (msg: ClientMessage) => void,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS
  ) {}

  /** `make` monta a mensagem com o id gerado; devolve a resposta (ou rejeita com SfuError). */
  request(make: (requestId: string) => ClientMessage): Promise<SfuReply> {
    const id = `r${++this.n}`
    return new Promise<SfuReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new SfuError('timeout', 'O servidor de vídeo demorou demais para responder.', true))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send(make(id))
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** Resposta do servidor; ids desconhecidos (já expirados) são ignorados. */
  handleReply(msg: SfuReply): void {
    const p = this.pending.get(msg.requestId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(msg.requestId)
    if (msg.error) p.reject(new SfuError(msg.error.code, msg.error.message))
    else p.resolve(msg)
  }

  rejectAll(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  get size(): number {
    return this.pending.size
  }
}

/**
 * Bytes recebidos desde a última leitura, somando os `inbound-rtp` da conexão.
 * Cada fluxo tem o seu contador: o que some (assinatura fechada) não zera o total, e o que aparece conta inteiro.
 */
export class UsageMeter {
  private last = new Map<string, number>()

  take(rows: Array<{ id: string; bytes: number }>): number {
    let delta = 0
    const next = new Map<string, number>()
    for (const r of rows) {
      const before = this.last.get(r.id) ?? 0
      delta += r.bytes >= before ? r.bytes - before : r.bytes
      next.set(r.id, r.bytes)
    }
    this.last = next
    return Math.round(delta)
  }

  reset(): void {
    this.last.clear()
  }
}

/** Linhas de `inbound-rtp` com os bytes recebidos (áudio e vídeo). */
export function inboundBytes(rows: StatRow[]): Array<{ id: string; bytes: number }> {
  const out: Array<{ id: string; bytes: number }> = []
  for (const r of rows) {
    if (r.type !== 'inbound-rtp') continue
    const bytes = r.bytesReceived
    if (typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0) out.push({ id: r.id, bytes })
  }
  return out
}

/** O vídeo já decodificou algum quadro? */
export function hasDecodedVideo(rows: StatRow[]): boolean {
  return rows.some((r) => r.type === 'inbound-rtp' && r.kind !== 'audio' && typeof r.framesDecoded === 'number' && r.framesDecoded > 0)
}

interface MidTransceiver {
  mid: string | null
  receiver: { track: MediaStreamTrack }
}

/** Acha, entre os transceivers da conexão, o de cada trilha que o servidor devolveu (pelo mid). */
export function tracksByMid<T extends MidTransceiver>(
  transceivers: readonly T[],
  wanted: ReadonlyArray<{ mid: string; kind: 'audio' | 'video' }>
): Array<{ mid: string; kind: 'audio' | 'video'; transceiver: T; track: MediaStreamTrack }> {
  return wanted.map((w) => {
    const t = transceivers.find((x) => x.mid === w.mid)
    if (!t) throw new SfuError('sdp', `A trilha ${w.mid} não apareceu na conexão com o servidor.`, true)
    return { mid: w.mid, kind: w.kind, transceiver: t, track: t.receiver.track }
  })
}

// ---------------- a conexão ----------------

interface Published {
  streamId: string
  video: RTCRtpTransceiver
  audio?: RTCRtpTransceiver
  mids: string[]
  rids: Rid[]
}

interface Subscription {
  from: string
  streamId: string
  transceivers: RTCRtpTransceiver[]
  mids: string[]
  videoTransceiver?: RTCRtpTransceiver
  videoMid?: string
  stream: MediaStream
  rid: Rid
}

export interface SfuLinkOptions {
  send: (msg: ClientMessage) => void
  /** para os testes */
  createPc?: () => RTCPeerConnection
  makeStream?: (tracks: MediaStreamTrack[]) => MediaStream
  requestTimeoutMs?: number
  usageEveryMs?: number
}

export class SfuLink {
  private pc?: RTCPeerConnection
  private readonly queue = new SerialQueue()
  private readonly tracker: RequestTracker
  private readonly meter = new UsageMeter()
  private published?: Published
  private readonly subs = new Map<string, Subscription>()
  private readonly failureListeners = new Set<(err: SfuError) => void>()
  private usageTimer?: ReturnType<typeof setInterval>
  private usageBusy = false
  private sendCounters?: Counters
  private disposed = false
  private readonly onPageHide = (): void => void this.flushUsage()

  constructor(private readonly opts: SfuLinkOptions) {
    this.tracker = new RequestTracker(opts.send, opts.requestTimeoutMs)
    if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('pagehide', this.onPageHide)
  }

  // ---------- leitura ----------

  get isPublished(): boolean {
    return !!this.published
  }

  /** camadas que estão sendo enviadas agora */
  publishedRids(): Rid[] {
    return this.published?.rids.slice() ?? []
  }

  hasSubscription(from: string): boolean {
    return this.subs.has(from)
  }

  /** O servidor respondeu a um pedido (`sfu-reply`). */
  handleReply(msg: SfuReply): void {
    this.tracker.handleReply(msg)
  }

  /** A conexão ficou inutilizável (já foi reiniciada: o próximo uso cria uma nova). */
  onFailure(cb: (err: SfuError) => void): () => void {
    this.failureListeners.add(cb)
    return () => this.failureListeners.delete(cb)
  }

  // ---------- publicar (a minha tela) ----------

  /** Publica vídeo (com simulcast) e áudio da tela. Devolve as camadas publicadas. */
  publish(stream: MediaStream, encodings: RTCRtpEncodingParameters[], degradation?: RTCDegradationPreference): Promise<Rid[]> {
    return this.run(true, async (pc) => {
      if (this.published) await this.closePublished(pc)
      const video = stream.getVideoTracks()[0]
      if (!video) throw new SfuError('bad-state', 'A tela não tem vídeo para publicar.')
      const audio = stream.getAudioTracks()[0]
      const tv = pc.addTransceiver(video, { direction: 'sendonly', streams: [stream], sendEncodings: encodings })
      const ta = audio ? pc.addTransceiver(audio, { direction: 'sendonly', streams: [stream] }) : undefined
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const tracks: Array<{ mid: string; kind: 'video' | 'audio' }> = []
      if (tv.mid) tracks.push({ mid: tv.mid, kind: 'video' })
      if (ta?.mid) tracks.push({ mid: ta.mid, kind: 'audio' })
      if (tracks.length === 0) throw new SfuError('sdp', 'A oferta saiu sem trilhas.', true)
      const reply = await this.tracker.request((requestId) => ({
        type: 'sfu-push',
        requestId,
        streamId: stream.id,
        sdp: { type: 'offer', sdp: pc.localDescription?.sdp ?? offer.sdp ?? '' },
        tracks
      }))
      if (!reply.sdp) throw new SfuError('api', 'O servidor não devolveu a resposta da publicação.', true)
      await pc.setRemoteDescription(reply.sdp)
      const rids = encodings.flatMap((e) => (e.rid ? [e.rid as Rid] : []))
      this.published = { streamId: stream.id, video: tv, audio: ta, mids: tracks.map((t) => t.mid), rids }
      if (degradation) await this.applyDegradation(tv.sender, degradation)
      return rids
    })
  }

  /** Quando falta banda ou CPU: mantém o fps (60 fps), a resolução ou equilibra. O navegador pode recusar. */
  private async applyDegradation(sender: RTCRtpSender, degradation: RTCDegradationPreference): Promise<void> {
    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) return
      params.degradationPreference = degradation
      await sender.setParameters(params)
    } catch (err) {
      console.warn('[sfu] degradationPreference', err)
    }
  }

  /** Muda só a camada `a` (a melhor): o automático usa isto. */
  async setTopLayer(p: { maxBitrate: number; maxFramerate: number; scaleResolutionDownBy: number; degradation?: RTCDegradationPreference }): Promise<void> {
    const sender = this.published?.video.sender
    if (!sender) return
    const params = sender.getParameters()
    const enc = params.encodings?.find((e) => e.rid === 'a') ?? params.encodings?.[0]
    if (!enc) return // ainda negociando
    enc.maxBitrate = p.maxBitrate
    enc.maxFramerate = p.maxFramerate
    enc.scaleResolutionDownBy = p.scaleResolutionDownBy
    prioritizeScreen(enc)
    if (p.degradation) params.degradationPreference = p.degradation
    await sender.setParameters(params)
  }

  /**
   * Reaplica todas as camadas (quando a captura muda de tamanho as reduções de `b` e `c` mudam junto).
   * Camada que não está na lista fica desativada.
   */
  async setEncodings(wanted: RTCRtpEncodingParameters[], degradation?: RTCDegradationPreference): Promise<void> {
    const pub = this.published
    const sender = pub?.video.sender
    if (!pub || !sender) return
    const params = sender.getParameters()
    const encs = params.encodings
    if (!encs || encs.length === 0) return
    for (const enc of encs) {
      const w = wanted.find((x) => x.rid === enc.rid) ?? (encs.length === 1 ? wanted[0] : undefined)
      if (!w) {
        enc.active = false
        continue
      }
      enc.active = true
      enc.maxBitrate = w.maxBitrate
      enc.maxFramerate = w.maxFramerate
      enc.scaleResolutionDownBy = w.scaleResolutionDownBy
      prioritizeScreen(enc)
    }
    if (degradation) params.degradationPreference = degradation
    await sender.setParameters(params)
    pub.rids = wanted.flatMap((e) => (e.rid ? [e.rid as Rid] : []))
  }

  /** Para de publicar: para os transceivers, manda a oferta sem eles e fecha as trilhas no servidor. */
  unpublish(): Promise<void> {
    return this.run(false, async (pc) => {
      if (this.published) await this.closePublished(pc)
    })
  }

  // ---------- assistir ----------

  /** Assina a tela de `from`; devolve o stream com as trilhas que chegam do SFU. Uma assinatura por pessoa. */
  subscribe(from: string, streamId: string, rid: Rid): Promise<MediaStream> {
    return this.run(false, async (pc) => {
      const have = this.subs.get(from)
      if (have && have.streamId === streamId) return have.stream
      if (have) await this.closeSub(pc, have)
      const reply = await this.tracker.request((requestId) => ({ type: 'sfu-pull', requestId, from, streamId, rid }))
      if (!reply.sdp || !reply.tracks || reply.tracks.length === 0) throw new SfuError('api', 'O servidor não devolveu a tela.', true)
      await pc.setRemoteDescription(reply.sdp)
      await this.answer(pc)
      const got = tracksByMid(pc.getTransceivers(), reply.tracks)
      const video = got.find((g) => g.kind === 'video')
      const stream = (this.opts.makeStream ?? ((t) => new MediaStream(t)))(got.map((g) => g.track))
      this.subs.set(from, {
        from,
        streamId,
        transceivers: got.map((g) => g.transceiver),
        mids: got.map((g) => g.mid),
        videoTransceiver: video?.transceiver,
        videoMid: video?.mid,
        stream,
        rid
      })
      return stream
    })
  }

  /** Resolve quando o vídeo dessa assinatura decodificou o primeiro quadro (sem DOM). */
  async firstFrame(from: string, timeoutMs = FIRST_FRAME_TIMEOUT_MS): Promise<void> {
    const tries = Math.max(1, Math.ceil(timeoutMs / FRAME_POLL_MS))
    for (let i = 0; i < tries; i++) {
      const sub = this.subs.get(from)
      const receiver = sub?.videoTransceiver?.receiver
      if (!sub || !receiver) throw new SfuError('closed', 'A assinatura foi fechada antes do primeiro quadro.')
      try {
        const report = await receiver.getStats()
        const rows: StatRow[] = []
        report.forEach((s) => rows.push(s as StatRow))
        if (hasDecodedVideo(rows)) return
      } catch {
        /* conexão mexendo: tenta de novo */
      }
      await new Promise((r) => setTimeout(r, FRAME_POLL_MS))
    }
    throw new SfuError('timeout', 'O primeiro quadro da tela não chegou.')
  }

  /** Troca a camada pedida de uma assinatura. */
  setLayer(from: string, rid: Rid): Promise<void> {
    return this.run(false, async (pc) => {
      const sub = this.subs.get(from)
      if (!sub?.videoMid) return
      const reply = await this.tracker.request((requestId) => ({ type: 'sfu-layer', requestId, mid: sub.videoMid!, rid }))
      sub.rid = rid
      if (reply.sdp) {
        await pc.setRemoteDescription(reply.sdp)
        await this.answer(pc)
      }
    })
  }

  unsubscribe(from: string): Promise<void> {
    return this.run(false, async (pc) => {
      const sub = this.subs.get(from)
      if (!sub) return
      await this.flushUsage() // os bytes desta assinatura somem do relatório quando ela fecha
      await this.closeSub(pc, sub)
    })
  }

  // ---------- estatísticas ----------

  /** Leitura de envio da camada `a` para o automático (undefined: nada publicado ou sem dados ainda). */
  async sendSample(): Promise<AutoSample | undefined> {
    const pc = this.pc
    if (!pc || !this.published) return undefined
    const report = await pc.getStats()
    const rows: StatRow[] = []
    report.forEach((s) => rows.push(s as StatRow))
    const anyRid = rows.some((r) => r.type === 'outbound-rtp' && r.kind === 'video' && typeof r.rid === 'string')
    const res = readStats(rows, this.sendCounters, Date.now(), { outTrack: (r) => !anyRid || r.rid === 'a' })
    this.sendCounters = res.counters
    const o = res.outbound
    if (!o) return undefined
    return {
      availableKbps: o.availableKbps,
      lossPct: o.lossPct,
      limitation: o.limitation,
      fps: o.fps,
      kbps: o.kbps,
      capturedFps: o.capturedFps,
      encoder: o.encoder,
      hardware: o.hardware
    }
  }

  /** Soma o que chegou do SFU desde a última vez e avisa a sala (só se > 0). */
  async flushUsage(): Promise<void> {
    const pc = this.pc
    if (!pc || this.usageBusy) return
    this.usageBusy = true
    try {
      const report = await pc.getStats()
      const rows: StatRow[] = []
      report.forEach((s) => rows.push(s as StatRow))
      const bytes = this.meter.take(inboundBytes(rows))
      if (bytes > 0) this.opts.send({ type: 'sfu-usage', bytes })
    } catch {
      /* conexão fechando */
    } finally {
      this.usageBusy = false
    }
  }

  // ---------- ciclo de vida ----------

  /** Fecha a conexão e esquece tudo; o próximo uso cria outra. */
  reset(): void {
    this.tracker.rejectAll(new SfuError('closed', 'A conexão com o servidor de vídeo foi encerrada.'))
    if (this.usageTimer) clearInterval(this.usageTimer)
    this.usageTimer = undefined
    const pc = this.pc
    this.pc = undefined
    this.published = undefined
    this.subs.clear()
    this.sendCounters = undefined
    this.meter.reset()
    if (pc) {
      pc.onconnectionstatechange = null
      try {
        pc.close()
      } catch {
        /* já fechada */
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    void this.flushUsage()
    this.disposed = true
    if (typeof globalThis.removeEventListener === 'function') globalThis.removeEventListener('pagehide', this.onPageHide)
    this.failureListeners.clear()
    this.reset()
  }

  // ---------- internos ----------

  private ensurePc(): RTCPeerConnection {
    if (this.disposed) throw new SfuError('closed', 'A conexão com o servidor de vídeo foi encerrada.')
    if (this.pc) return this.pc
    const pc = this.opts.createPc?.() ?? new RTCPeerConnection(SFU_ICE)
    pc.onconnectionstatechange = () => {
      if (pc === this.pc && pc.connectionState === 'failed') this.fail(new SfuError('connection', 'A conexão com o servidor de vídeo caiu.', true))
    }
    this.pc = pc
    this.usageTimer = setInterval(() => void this.flushUsage(), this.opts.usageEveryMs ?? USAGE_EVERY_MS)
    return pc
  }

  /** Falha séria: reinicia a conexão e avisa quem escuta. */
  private fail(err: SfuError): void {
    if (this.disposed) return
    this.reset()
    for (const cb of [...this.failureListeners]) cb(err)
  }

  /** Uma operação de SDP na fila. `fatal`: qualquer erro deixa a conexão suja (publicar). */
  private run<T>(fatal: boolean, fn: (pc: RTCPeerConnection) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      const pc = this.ensurePc()
      try {
        return await fn(pc)
      } catch (err) {
        const e = err instanceof SfuError ? err : new SfuError('sdp', err instanceof Error ? err.message : String(err), true)
        if (pc !== this.pc) throw new SfuError('closed', 'A conexão com o servidor de vídeo foi encerrada.')
        if (e.fatal || fatal) {
          this.fail(e)
        } else if (pc.signalingState === 'have-local-offer' || pc.signalingState === 'have-remote-offer') {
          // o servidor recusou no meio da troca: volta ao estado estável para a próxima operação
          try {
            await pc.setLocalDescription({ type: 'rollback' })
          } catch {
            this.fail(e)
          }
        }
        throw e
      }
    })
  }

  private async answer(pc: RTCPeerConnection): Promise<void> {
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    const sdp: Sdp = { type: 'answer', sdp: pc.localDescription?.sdp ?? answer.sdp ?? '' }
    await this.tracker.request((requestId) => ({ type: 'sfu-answer', requestId, sdp }))
  }

  /** Para os transceivers, manda a oferta já sem eles e fecha as trilhas no servidor. */
  private async closeMids(pc: RTCPeerConnection, transceivers: RTCRtpTransceiver[], mids: string[]): Promise<void> {
    for (const t of transceivers) {
      try {
        t.stop()
      } catch {
        /* já parado */
      }
    }
    if (mids.length === 0) return
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const reply = await this.tracker.request((requestId) => ({
      type: 'sfu-close',
      requestId,
      mids,
      sdp: { type: 'offer', sdp: pc.localDescription?.sdp ?? offer.sdp ?? '' }
    }))
    if (reply.sdp) await pc.setRemoteDescription(reply.sdp)
    else await pc.setLocalDescription({ type: 'rollback' })
  }

  private async closePublished(pc: RTCPeerConnection): Promise<void> {
    const pub = this.published
    if (!pub) return
    this.published = undefined
    this.sendCounters = undefined
    await this.closeMids(pc, [pub.video, ...(pub.audio ? [pub.audio] : [])], pub.mids)
  }

  private async closeSub(pc: RTCPeerConnection, sub: Subscription): Promise<void> {
    this.subs.delete(sub.from)
    await this.closeMids(pc, sub.transceivers, sub.mids)
  }
}
