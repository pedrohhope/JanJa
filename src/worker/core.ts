import {
  CHAT_HISTORY,
  ClientMessageSchema,
  DEFAULT_CHANNELS,
  DEFAULT_ROOM_NAME,
  type ChatMessage,
  INITIAL_STATE,
  MAX_CHANNELS,
  MAX_PEERS,
  channelHasRoom,
  type Channel,
  type ClientMessage,
  type ErrorCode,
  type IceServer,
  type PeerInfo,
  type PeerState,
  type RoomSettings,
  type ServerMessage
} from '../shared/protocol'
import { cryptoRng, type Rng } from '../shared/games/types'
import type { GameRegistry } from '../shared/games/registry'
import { allowedRid, type BudgetState, type Sdp, type SfuErrorCode } from '../shared/sfu'
import { GameHost, isGameMessage, type GameSnapshot } from './game/host'
import type { BudgetApi, SfuApi, TrackObject } from './sfuApi'

/**
 * Regras da sala, sem nada da Cloudflare: o Durable Object só adapta WebSockets para `Conn`.
 * Assim dá para testar tudo no Node com conexões falsas.
 */

export interface ConnData {
  peerId?: string
  name?: string
  isHost?: boolean
  /** identidade estável da pessoa nesta sala (recupera a cadeira do jogo) */
  clientId?: string
  state?: PeerState
  /** canal onde a pessoa está (a voz só liga quem está no mesmo canal) */
  channelId?: string
  /** horários das últimas mensagens de chat (contra flood) */
  chatTimes?: number[]
  /** pedido de entrada aguardando o host */
  pending?: { requestId: string; name: string; clientId?: string; channelId?: string }
  /** tela pelo SFU: sessão da pessoa e trilhas publicadas/assinadas (mantenha pequeno: vive no attachment) */
  sfu?: SfuData
}

/**
 * O attachment do WebSocket tem limite de 2 KB (o excesso é descartado sem aviso), então as assinaturas
 * guardam só o mínimo: o resto (sessão e nome da trilha) vem de quem publicou, na hora de usar.
 */
export interface SfuData {
  sessionId?: string
  pushed?: { streamId: string; tracks: { mid: string; kind: 'audio' | 'video'; trackName: string }[] }
  pulled?: { mid: string; kind: 'audio' | 'video'; from: string }[]
}

export interface Conn {
  send(msg: ServerMessage): void
  close(code: number, reason: string): void
  data(): ConnData
  setData(data: ConnData): void
}

export interface RoomConfig {
  hostKeyHash: string
  requireApproval: boolean
  /** nome da sala; ausente = DEFAULT_ROOM_NAME (salas antigas) */
  name?: string
  /** canais criados pelo host, cada um com seu limite; ausente = só "Geral" */
  channels?: Channel[]
}

export interface RoomDeps {
  conns(): Conn[]
  config(): RoomConfig | undefined
  /** grava a configuração quando o host muda os canais */
  saveConfig?(config: RoomConfig): void
  /** chat: histórico gravado por canal (sem isso o chat vive só em memória) */
  loadChat?(): Record<string, ChatMessage[]> | undefined
  saveChat?(channelId: string, messages: ChatMessage[] | null): void
  hash(text: string): Promise<string>
  newId(): string
  iceServers(): Promise<IceServer[]>
  /** teto de pessoas na sala (padrão MAX_PEERS; os testes usam menor) */
  maxPeers?: number
  /** jogos: tudo opcional (sem eles o jogo vive só em memória) */
  now?(): number
  rng?(): Rng
  loadGame?(): GameSnapshot | undefined
  saveGame?(snapshot: GameSnapshot | null): void
  registry?: GameRegistry
  /** tela híbrida: API do SFU (ausente = `disabled`), orçamento e id da sala (para o orçamento) */
  sfu?: SfuApi
  budget?: BudgetApi
  roomId?(): string | undefined
}

const joined = (c: Conn): boolean => !!c.data().peerId

const BUDGET_REFRESH_MS = 60_000
/** o attachment do WebSocket aceita até 2048 bytes serializados */
const ATTACHMENT_SOFT_MAX = 1800

/** erro esperado de uma mensagem sfu-*: vira `sfu-reply` com `error` */
class SfuFail extends Error {
  constructor(
    readonly code: SfuErrorCode,
    message: string
  ) {
    super(message)
  }
}

type SfuMessage = Extract<ClientMessage, { type: `sfu-${string}` }>
const isSfuMessage = (m: ClientMessage): m is SfuMessage => m.type.startsWith('sfu-')

const CHAT_WINDOW_MS = 10_000
const CHAT_MAX_IN_WINDOW = 8

/**
 * No Durable Object cada `conns()` cria objetos novos para os mesmos sockets,
 * então "é a mesma conexão" é comparado pelo peerId, nunca por identidade.
 */
const same = (a: Conn, b: Conn | undefined): boolean => {
  if (!b) return false
  if (a === b) return true
  const id = a.data().peerId
  return !!id && id === b.data().peerId
}

function info(c: Conn, fallbackChannel: string): PeerInfo {
  const d = c.data()
  return {
    peerId: d.peerId!,
    name: d.name!,
    state: d.state ?? INITIAL_STATE,
    isHost: !!d.isHost,
    channelId: d.channelId ?? fallbackChannel
  }
}

export class RoomCore {
  readonly game: GameHost

  constructor(private readonly deps: RoomDeps) {
    this.game = new GameHost({
      conns: () => this.peers(),
      now: () => (deps.now ?? Date.now)(),
      rng: () => (deps.rng ?? cryptoRng)(),
      newId: () => deps.newId(),
      load: () => deps.loadGame?.(),
      save: (s) => deps.saveGame?.(s),
      registry: deps.registry
    })
  }

  /** nome e canais atuais (sala antiga: nome padrão e só "Geral") */
  settings(): RoomSettings {
    const config = this.deps.config()
    return {
      name: config?.name ?? DEFAULT_ROOM_NAME,
      channels: config?.channels?.length ? config.channels : DEFAULT_CHANNELS
    }
  }

  /** teto de segurança da sala; quem limita de verdade é cada canal */
  private isFull(): boolean {
    return this.peers().length >= (this.deps.maxPeers ?? MAX_PEERS)
  }

  private fullMessage(): string {
    return 'A sala está cheia. Espere alguém sair ou peça um link de outra sala.'
  }

  /** quantas pessoas estão no canal agora */
  private countIn(channelId: string): number {
    return this.peers().filter((c) => this.info(c).channelId === channelId).length
  }

  private hasRoom(ch: Channel): boolean {
    return channelHasRoom(ch, this.countIn(ch.id))
  }

  private peers(): Conn[] {
    return this.deps.conns().filter(joined)
  }

  private info(c: Conn): PeerInfo {
    return info(c, this.settings().channels[0].id)
  }

  private updateConfig(patch: Partial<RoomConfig>): void {
    const config = this.deps.config()
    if (!config) return
    this.deps.saveConfig?.({ ...config, ...patch })
    this.broadcast({ type: 'room-settings', settings: this.settings() })
  }

  private moveTo(c: Conn, channelId: string): void {
    const d = c.data()
    if (!d.peerId || d.channelId === channelId) return
    c.setData({ ...d, channelId })
    this.broadcast({ type: 'peer-moved', peerId: d.peerId, channelId })
    this.sendHistory(c, channelId)
  }

  // ---------- chat ----------
  private chat?: Map<string, ChatMessage[]>

  private chatOf(channelId: string): ChatMessage[] {
    this.chat ??= new Map(Object.entries(this.deps.loadChat?.() ?? {}))
    return this.chat.get(channelId) ?? []
  }

  private setChat(channelId: string, messages: ChatMessage[] | null): void {
    this.chatOf(channelId) // garante o mapa carregado
    if (messages) this.chat!.set(channelId, messages)
    else this.chat!.delete(channelId)
    this.deps.saveChat?.(channelId, messages)
  }

  /** sala expirou: esquece o chat em memória (o storage já foi apagado) */
  resetChat(): void {
    this.chat = undefined
  }

  private sendHistory(c: Conn, channelId: string): void {
    c.send({ type: 'chat-history', channelId, messages: this.chatOf(channelId) })
  }

  private sendChat(conn: Conn, text: string): void {
    const me = conn.data()
    const now = (this.deps.now ?? Date.now)()
    // no máximo 8 mensagens a cada 10 s por pessoa
    const recent = (me.chatTimes ?? []).filter((t) => now - t < CHAT_WINDOW_MS)
    if (recent.length >= CHAT_MAX_IN_WINDOW) {
      return this.fail(conn, 'chat-flood', 'Muitas mensagens seguidas. Espere uns segundos.')
    }
    conn.setData({ ...me, chatTimes: [...recent, now] })
    const channelId = this.info(conn).channelId
    const message: ChatMessage = { id: this.deps.newId(), from: me.peerId!, name: me.name!, text, at: now }
    this.setChat(channelId, [...this.chatOf(channelId), message].slice(-CHAT_HISTORY))
    for (const c of this.peers()) if (this.info(c).channelId === channelId) c.send({ type: 'chat', channelId, message })
  }

  // ---------- tela híbrida (SFU) ----------
  /** último estado de orçamento conhecido desta sala (memória: volta a ser consultado depois de hibernar) */
  private budgetKnown: BudgetState = 'ok'
  private budgetAt = 0

  private nowMs(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** estado conhecido; consulta o orçamento no máximo a cada 60 s */
  private async budgetState(): Promise<BudgetState> {
    const { budget } = this.deps
    if (!budget) return 'ok'
    const now = this.nowMs()
    if (this.budgetAt && now - this.budgetAt < BUDGET_REFRESH_MS) return this.budgetKnown
    this.budgetAt = now
    try {
      this.budgetKnown = await budget.peek(this.deps.roomId?.() ?? 'sala')
    } catch (err) {
      console.warn('[sfu] orçamento indisponível', err)
    }
    return this.budgetKnown
  }

  private patchSfu(conn: Conn, fn: (s: SfuData) => SfuData): void {
    // relê depois de qualquer await: outra mensagem pode ter mexido no attachment
    const d = conn.data()
    const next = { ...d, sfu: fn(d.sfu ?? {}) }
    // margem para o limite de 2 KB do attachment: as assinaturas mais antigas saem primeiro
    while (next.sfu.pulled?.length && JSON.stringify(next).length > ATTACHMENT_SOFT_MAX) {
      next.sfu = { ...next.sfu, pulled: next.sfu.pulled.slice(1) }
    }
    conn.setData(next)
  }

  private async sessionOf(conn: Conn, sfu: SfuApi): Promise<string> {
    const have = conn.data().sfu?.sessionId
    if (have) return have
    const sessionId = await sfu.newSession()
    const again = conn.data().sfu?.sessionId
    if (again) return again
    this.patchSfu(conn, (s) => ({ ...s, sessionId }))
    return sessionId
  }

  private async sfuMessage(conn: Conn, msg: SfuMessage): Promise<void> {
    if (msg.type === 'sfu-usage') return this.sfuUsage(conn, msg.bytes)
    const reply = (body: { sdp?: Sdp; tracks?: { mid: string; kind: 'audio' | 'video' }[] }) =>
      conn.send({ type: 'sfu-reply', requestId: msg.requestId, ...body })
    try {
      const sfu = this.deps.sfu
      if (!sfu) throw new SfuFail('disabled', 'A tela pelo servidor não está ligada neste site.')
      reply(await this.sfuHandle(conn, sfu, msg))
    } catch (err) {
      if (err instanceof SfuFail) {
        return conn.send({ type: 'sfu-reply', requestId: msg.requestId, error: { code: err.code, message: err.message } })
      }
      console.warn('[sfu] falha na API', msg.type, err)
      conn.send({
        type: 'sfu-reply',
        requestId: msg.requestId,
        error: { code: 'api', message: 'O servidor de vídeo não respondeu direito. Tente de novo.' }
      })
    }
  }

  private async sfuHandle(
    conn: Conn,
    sfu: SfuApi,
    msg: Exclude<SfuMessage, { type: 'sfu-usage' }>
  ): Promise<{ sdp?: Sdp; tracks?: { mid: string; kind: 'audio' | 'video' }[] }> {
    const me = conn.data()

    if (msg.type === 'sfu-push') {
      if ((await this.budgetState()) === 'esgotado') throw new SfuFail('budget', 'O limite de uso da tela pelo servidor acabou. Use a tela direta.')
      const sessionId = await this.sessionOf(conn, sfu)
      const tracks = msg.tracks.map((t) => ({
        mid: t.mid,
        kind: t.kind,
        trackName: `${t.kind[0]}${this.deps.newId()}`
      }))
      const objects: TrackObject[] = tracks.map((t) => ({ location: 'local', mid: t.mid, kind: t.kind, trackName: t.trackName }))
      const res = await sfu.addTracks(sessionId, objects, msg.sdp)
      if (!res.sessionDescription) throw new Error('sem answer na resposta do push')
      this.patchSfu(conn, (s) => ({ ...s, pushed: { streamId: msg.streamId, tracks } }))
      return { sdp: res.sessionDescription }
    }

    if (msg.type === 'sfu-pull') {
      const from = this.peers().find((c) => c.data().peerId === msg.from)
      const fd = from?.data()
      const pushed = fd?.sfu?.pushed
      if (
        !from ||
        !fd ||
        msg.from === me.peerId ||
        this.info(from).channelId !== this.info(conn).channelId ||
        fd.state?.screenRoute !== 'sfu' ||
        fd.state.screenStreamId !== msg.streamId ||
        !fd.sfu?.sessionId ||
        pushed?.streamId !== msg.streamId
      ) {
        throw new SfuFail('not-allowed', 'Essa tela não está disponível para você.')
      }
      const budget = await this.budgetState()
      if (budget === 'esgotado') throw new SfuFail('budget', 'O limite de uso da tela pelo servidor acabou. Use a tela direta.')
      const publisherSession = fd.sfu.sessionId
      const sessionId = await this.sessionOf(conn, sfu)
      const objects: TrackObject[] = pushed.tracks.map((t) => ({
        location: 'remote',
        sessionId: publisherSession,
        trackName: t.trackName,
        ...(t.kind === 'video'
          ? { simulcast: { preferredRid: allowedRid(msg.rid, budget), priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' } }
          : {})
      }))
      const res = await sfu.addTracks(sessionId, objects)
      if (!res.sessionDescription) throw new Error('sem offer na resposta do pull')
      const got = pushed.tracks.map((t) => {
        const mid = res.tracks.find((r) => r.trackName === t.trackName)?.mid
        if (!mid) throw new Error(`trilha ${t.trackName} sem mid`)
        return { mid, kind: t.kind, from: msg.from }
      })
      this.patchSfu(conn, (s) => ({ ...s, pulled: [...(s.pulled ?? []), ...got] }))
      return { sdp: res.sessionDescription, tracks: got.map((g) => ({ mid: g.mid, kind: g.kind })) }
    }

    const sessionId = me.sfu?.sessionId
    if (!sessionId) throw new SfuFail('bad-state', 'Você ainda não tem conexão com o servidor de vídeo.')

    if (msg.type === 'sfu-answer') {
      await sfu.renegotiate(sessionId, msg.sdp)
      return {}
    }

    if (msg.type === 'sfu-layer') {
      const sub = me.sfu?.pulled?.find((p) => p.mid === msg.mid)
      if (!sub || sub.kind !== 'video') throw new SfuFail('bad-state', 'Essa trilha não é um vídeo que você está assistindo.')
      const pub = this.peers().find((c) => c.data().peerId === sub.from)?.data().sfu
      const track = pub?.pushed?.tracks.find((t) => t.kind === 'video')
      if (!pub?.sessionId || !track) throw new SfuFail('bad-state', 'Essa tela não está mais no servidor.')
      const budget = await this.budgetState()
      const res = await sfu.updateTracks(sessionId, [
        {
          location: 'remote',
          mid: sub.mid,
          sessionId: pub.sessionId,
          trackName: track.trackName,
          simulcast: { preferredRid: allowedRid(msg.rid, budget), priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' }
        }
      ])
      return res.sessionDescription ? { sdp: res.sessionDescription } : {}
    }

    // sfu-close
    const res = await sfu.closeTracks(sessionId, msg.mids, msg.sdp)
    const gone = new Set(msg.mids)
    this.patchSfu(conn, (s) => {
      const tracks = s.pushed?.tracks.filter((t) => !gone.has(t.mid)) ?? []
      const pulled = s.pulled?.filter((p) => !gone.has(p.mid)) ?? []
      return {
        sessionId: s.sessionId,
        ...(s.pushed && tracks.length ? { pushed: { streamId: s.pushed.streamId, tracks } } : {}),
        ...(pulled.length ? { pulled } : {})
      }
    })
    return res.sessionDescription ? { sdp: res.sessionDescription } : {}
  }

  private async sfuUsage(conn: Conn, bytes: number): Promise<void> {
    const { budget } = this.deps
    if (!budget || !conn.data().peerId) return
    try {
      const state = await budget.report(this.deps.roomId?.() ?? 'sala', bytes)
      this.budgetAt = this.nowMs()
      if (state === this.budgetKnown) return
      this.budgetKnown = state
      this.broadcast({ type: 'sfu-budget', state })
    } catch (err) {
      console.warn('[sfu] não consegui registrar o uso', err)
    }
  }

  private fail(conn: Conn, code: ErrorCode, message: string, close = false): void {
    conn.send({ type: 'error', code, message })
    if (close) conn.close(4000, code)
  }

  private broadcast(msg: ServerMessage, except?: Conn): void {
    for (const c of this.peers()) if (!same(c, except)) c.send(msg)
  }

  async onMessage(conn: Conn, raw: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return this.fail(conn, 'bad-message', 'JSON inválido.')
    }
    const result = ClientMessageSchema.safeParse(parsed)
    if (!result.success) return this.fail(conn, 'bad-message', 'Mensagem fora do protocolo.')
    const msg = result.data

    if (msg.type === 'ping') return conn.send({ type: 'pong' })
    if (msg.type === 'join') return this.join(conn, msg)

    const me = conn.data()
    if (!me.peerId) return this.fail(conn, 'not-joined', 'Entre na sala antes.')

    if (isSfuMessage(msg)) return this.sfuMessage(conn, msg)

    if (isGameMessage(msg)) return this.game.handle(conn, msg)

    if (msg.type === 'signal') {
      const target = this.peers().find((c) => c.data().peerId === msg.to)
      if (!target) return this.fail(conn, 'unknown-peer', 'Participante não encontrado.')
      return target.send({ type: 'signal', from: me.peerId, payload: msg.payload })
    }

    if (msg.type === 'state') {
      conn.setData({ ...me, state: msg.state })
      return this.broadcast({ type: 'state', from: me.peerId, state: msg.state }, conn)
    }

    if (msg.type === 'join-response') {
      if (!me.isHost) return
      const guest = this.deps.conns().find((c) => c.data().pending?.requestId === msg.requestId)
      if (!guest) return
      const { name, clientId, channelId } = guest.data().pending!
      guest.setData({ ...guest.data(), pending: undefined })
      if (!msg.approved) return this.fail(guest, 'denied', 'O host recusou a entrada.', true)
      return this.admit(guest, name, false, clientId, channelId)
    }

    if (msg.type === 'channel-join') {
      const target = this.settings().channels.find((ch) => ch.id === msg.channelId)
      if (!target) return this.fail(conn, 'unknown-channel', 'Esse canal não existe mais.')
      if (this.info(conn).channelId === target.id) return
      if (!this.hasRoom(target)) {
        return this.fail(conn, 'channel-full', `O canal ${target.name} está cheio (máx. ${target.limit}). Espere alguém sair.`)
      }
      return this.moveTo(conn, target.id)
    }

    if (msg.type === 'chat-send') return this.sendChat(conn, msg.text)

    // daqui para baixo, só quem criou a sala
    if (!me.isHost) return this.fail(conn, 'not-host', 'Só quem criou a sala pode mudar isso.')
    const { channels } = this.settings()

    if (msg.type === 'channel-create') {
      if (channels.length >= MAX_CHANNELS) {
        return this.fail(conn, 'channel-limit', `A sala já tem o máximo de ${MAX_CHANNELS} canais.`)
      }
      return this.updateConfig({ channels: [...channels, { id: this.deps.newId(), name: msg.name, limit: msg.limit }] })
    }

    if (msg.type === 'channel-edit') {
      if (!channels.some((ch) => ch.id === msg.channelId)) {
        return this.fail(conn, 'unknown-channel', 'Esse canal não existe mais.')
      }
      // baixar o limite não tira ninguém: só barra quem chegar depois
      return this.updateConfig({
        channels: channels.map((ch) => (ch.id === msg.channelId ? { ...ch, name: msg.name, limit: msg.limit } : ch))
      })
    }

    if (msg.type === 'channel-delete') {
      if (!channels.some((ch) => ch.id === msg.channelId)) {
        return this.fail(conn, 'unknown-channel', 'Esse canal não existe mais.')
      }
      if (channels.length <= 1) return this.fail(conn, 'channel-limit', 'A sala precisa de pelo menos um canal.')
      const rest = channels.filter((ch) => ch.id !== msg.channelId)
      // quem estava no canal apagado vai para o primeiro que sobrou
      for (const c of this.peers()) if (this.info(c).channelId === msg.channelId) this.moveTo(c, rest[0].id)
      this.setChat(msg.channelId, null)
      return this.updateConfig({ channels: rest })
    }

    if (msg.type === 'room-rename') return this.updateConfig({ name: msg.name })
  }

  private async join(conn: Conn, msg: Extract<ClientMessage, { type: 'join' }>): Promise<void> {
    const d = conn.data()
    if (d.peerId || d.pending) return
    const config = this.deps.config()
    if (!config) return this.fail(conn, 'room-not-found', 'Essa sala não existe ou já expirou.', true)

    const isHost = !!msg.hostKey && (await this.deps.hash(msg.hostKey)) === config.hostKeyHash
    // quem criou a sala sempre entra na própria sala, mesmo cheia
    if (!isHost && this.isFull()) return this.fail(conn, 'room-full', this.fullMessage(), true)

    if (config.requireApproval && !isHost) {
      const host = this.peers().find((c) => c.data().isHost)
      if (!host) return this.fail(conn, 'host-absent', 'Quem criou a sala não está nela agora.', true)
      const requestId = this.deps.newId()
      conn.setData({ ...d, pending: { requestId, name: msg.name, clientId: msg.clientId, channelId: msg.channelId } })
      conn.send({ type: 'waiting-approval' })
      host.send({ type: 'join-request', requestId, name: msg.name })
      return
    }

    return this.admit(conn, msg.name, isHost, msg.clientId, msg.channelId)
  }

  private async admit(conn: Conn, name: string, isHost: boolean, clientId?: string, wanted?: string): Promise<void> {
    if (!isHost && this.isFull()) return this.fail(conn, 'room-full', this.fullMessage(), true)
    const existing = this.peers().map((c) => this.info(c))
    const { channels } = this.settings()
    // o canal em que estava (reconexão), senão o primeiro com vaga; o dono entra mesmo com tudo cheio
    const asked = channels.find((ch) => ch.id === wanted)
    const target = (asked && this.hasRoom(asked) ? asked : channels.find((ch) => this.hasRoom(ch))) ?? (isHost ? channels[0] : undefined)
    if (!target) return this.fail(conn, 'room-full', 'Todos os canais da sala estão cheios. Tente de novo daqui a pouco.', true)
    const channelId = target.id
    conn.setData({ peerId: this.deps.newId(), name, isHost, clientId, state: { ...INITIAL_STATE }, channelId })
    const iceServers = await this.deps.iceServers()
    conn.send({
      type: 'welcome',
      peerId: conn.data().peerId!,
      isHost,
      peers: existing,
      iceServers,
      channelId,
      settings: this.settings(),
      sfu: { enabled: !!this.deps.sfu, budget: await this.budgetState() }
    })
    this.sendHistory(conn, channelId)
    this.broadcast({ type: 'peer-joined', peer: this.info(conn) }, conn)
    this.game.onJoin(conn)
  }

  /** Chamado quando a conexão fecha. Retorna quantos participantes ainda estão na sala. */
  onClose(conn: Conn): number {
    const d = conn.data()
    if (d.pending) {
      const host = this.peers().find((c) => c.data().isHost)
      host?.send({ type: 'join-request-cancelled', requestId: d.pending.requestId })
    }
    if (d.peerId) {
      conn.setData({})
      this.broadcast({ type: 'peer-left', peerId: d.peerId }, conn)
      this.game.onClose(d)
      if (d.isHost) {
        // sem host, ninguém aprova: avisa quem estava esperando
        for (const c of this.deps.conns()) {
          if (c.data().pending) this.fail(c, 'host-absent', 'Quem criou a sala saiu.', true)
        }
      }
    }
    return this.peers().length
  }
}
