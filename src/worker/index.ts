import { DurableObject } from 'cloudflare:workers'
import {
  CreateRoomRequestSchema,
  MAX_MESSAGE_BYTES,
  ROOM_ID_RE,
  type ChatMessage,
  type CreateRoomResponse,
  type IceServer,
  type ServerMessage
} from '../shared/protocol'
import type { GameSnapshot } from './game/host'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from './core'
import type { Budget } from './budgetDO'
import { realtimeApi } from './realtime'

export { Budget } from './budgetDO'

export interface Env {
  ROOMS: DurableObjectNamespace<Room>
  ASSETS: Fetcher
  /** opcionais: TURN da Cloudflare (Realtime). Sem eles, só STUN. */
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  /** tela híbrida: orçamento global e credenciais do Cloudflare Realtime SFU (sem os dois secrets, o SFU fica desligado) */
  BUDGET: DurableObjectNamespace<Budget>
  REALTIME_APP_ID?: string
  REALTIME_APP_SECRET?: string
  SFU_MONTHLY_GB?: string
  SFU_ROOM_DAILY_GB?: string
}

const STUN: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]
/** sala vazia (ou criada e nunca usada) some depois disso */
const EMPTY_ROOM_TTL_MS = 6 * 60 * 60 * 1000
const RATE = { windowMs: 10_000, max: 400 }

function randomId(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function turnServers(env: Env): Promise<IceServer[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: 86_400 })
      }
    )
    if (!res.ok) throw new Error(`TURN ${res.status}`)
    const { iceServers } = (await res.json()) as { iceServers: IceServer[] }
    // a porta 53 é bloqueada pelos navegadores e só gera timeout
    return iceServers.map((s) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u))
    }))
  } catch (err) {
    console.warn('[turn] sem credenciais, seguindo só com STUN', err)
    return STUN
  }
}

/** Uma instância por sala. Usa a Hibernation API: sala parada não gasta duração. */
export class Room extends DurableObject<Env> {
  private config?: RoomConfig
  private game?: GameSnapshot
  /** id da sala (para o orçamento do SFU); vem na init ou no header x-room-id */
  private roomId?: string
  /** histórico do chat por canal (chave "chat:<canal>" no storage) */
  private chat: Record<string, ChatMessage[]> = {}
  /** quando a sala vazia expira (o alarme real é o mínimo entre isto e o prazo do jogo) */
  private ttlAt = 0
  private alarmAt?: number
  private readonly core: RoomCore
  private readonly rate = new WeakMap<WebSocket, { start: number; count: number }>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.config = await ctx.storage.get<RoomConfig>('config')
      this.game = await ctx.storage.get<GameSnapshot>('game')
      this.roomId = await ctx.storage.get<string>('roomId')
      const chats = await ctx.storage.list<ChatMessage[]>({ prefix: 'chat:' })
      for (const [key, messages] of chats) this.chat[key.slice('chat:'.length)] = messages
      this.ttlAt = (await ctx.storage.get<number>('ttlAt')) ?? Date.now() + EMPTY_ROOM_TTL_MS
    })
    const sfu = env.REALTIME_APP_ID && env.REALTIME_APP_SECRET ? realtimeApi(env.REALTIME_APP_ID, env.REALTIME_APP_SECRET) : undefined
    const budget = () => env.BUDGET.getByName('global')
    this.core = new RoomCore({
      sfu,
      budget: sfu ? { report: (roomId, bytes) => budget().report(roomId, bytes), peek: (roomId) => budget().peek(roomId) } : undefined,
      roomId: () => this.roomId,
      conns: () => ctx.getWebSockets().map((ws) => this.conn(ws)),
      config: () => this.config,
      saveConfig: (config) => {
        this.config = config
        // sem await: como no jogo, a gravação sai antes das mensagens (output gate)
        void ctx.storage.put('config', config)
      },
      loadChat: () => this.chat,
      saveChat: (channelId, messages) => {
        if (messages) void ctx.storage.put(`chat:${channelId}`, messages)
        else void ctx.storage.delete(`chat:${channelId}`)
      },
      hash: sha256,
      newId: () => randomId(9),
      iceServers: () => turnServers(env),
      loadGame: () => this.game,
      saveGame: (snap) => {
        this.game = snap ?? undefined
        // sem await: a gravação é coalescida e as mensagens só saem depois dela (output gate)
        if (snap) void ctx.storage.put('game', snap)
        else void ctx.storage.delete('game')
      }
    })
  }

  private conn(ws: WebSocket): Conn {
    return {
      send: (msg: ServerMessage) => {
        try {
          ws.send(JSON.stringify(msg))
        } catch {
          /* já fechou */
        }
      },
      close: (code, reason) => {
        try {
          ws.close(code, reason)
        } catch {
          /* já fechou */
        }
      },
      data: () => (ws.deserializeAttachment() as ConnData | null) ?? {},
      setData: (data: ConnData) => {
        try {
          ws.serializeAttachment(data)
        } catch {
          /* socket fechado: o estado morre com ele */
        }
      }
    }
  }

  async init(config: RoomConfig, roomId?: string): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    if (roomId) await this.rememberRoomId(roomId)
    await this.touchTtl()
  }

  private async rememberRoomId(roomId: string): Promise<void> {
    if (this.roomId === roomId) return
    this.roomId = roomId
    await this.ctx.storage.put('roomId', roomId)
  }

  /** Sala (re)começa a contar para expirar. */
  private async touchTtl(): Promise<void> {
    this.ttlAt = Date.now() + EMPTY_ROOM_TTL_MS
    await this.ctx.storage.put('ttlAt', this.ttlAt)
    await this.reschedule()
  }

  /** Alarme ÚNICO: o que vier primeiro entre o prazo do jogo e o fim do TTL. */
  private async reschedule(): Promise<void> {
    const deadline = this.core.game.nextDeadline()
    const at = deadline === null ? this.ttlAt : Math.min(deadline, this.ttlAt)
    if (at === this.alarmAt) return
    this.alarmAt = at
    await this.ctx.storage.setAlarm(at)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Esperava WebSocket', { status: 426 })
    // salas criadas antes do SFU não guardaram o id: o Worker manda no header
    const id = request.headers.get('x-room-id')
    if (id && ROOM_ID_RE.test(id)) await this.rememberRoomId(id)
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({})
    if (!this.config) {
      server.send(JSON.stringify({ type: 'error', code: 'room-not-found', message: 'Essa sala não existe ou já expirou.' }))
      server.close(4000, 'room-not-found')
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = this.conn(ws)
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) {
      return conn.send({ type: 'error', code: 'bad-message', message: 'Mensagem inválida.' })
    }
    const now = Date.now()
    const r = this.rate.get(ws) ?? { start: now, count: 0 }
    if (now - r.start > RATE.windowMs) Object.assign(r, { start: now, count: 0 })
    r.count += 1
    this.rate.set(ws, r)
    if (r.count > RATE.max) {
      conn.send({ type: 'error', code: 'rate-limited', message: 'Mensagens demais.' })
      return conn.close(4000, 'rate-limited')
    }
    await this.core.onMessage(conn, message)
    await this.reschedule()
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const left = this.core.onClose(this.conn(ws))
    if (left === 0) await this.touchTtl()
    else await this.reschedule()
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  async alarm(): Promise<void> {
    this.alarmAt = undefined
    const now = Date.now()
    if (this.config) this.core.game.onTick(now)
    if (now >= this.ttlAt) {
      const active = this.ctx.getWebSockets().some((ws) => !!(ws.deserializeAttachment() as ConnData | null)?.peerId)
      if (active) {
        await this.touchTtl()
        return
      }
      this.config = undefined
      this.game = undefined
      this.roomId = undefined
      this.chat = {}
      this.core.game.reset()
      this.core.resetChat()
      await this.ctx.storage.deleteAll()
      return
    }
    await this.reschedule()
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const parsed = CreateRoomRequestSchema.safeParse(body)
      if (!parsed.success) return json({ error: 'Pedido inválido.' }, 400)
      const roomId = randomId(16)
      const hostKey = randomId(24)
      await env.ROOMS.getByName(roomId).init(
        {
          hostKeyHash: await sha256(hostKey),
          requireApproval: parsed.data.requireApproval,
          name: parsed.data.name
        },
        roomId
      )
      return json({ roomId, hostKey } satisfies CreateRoomResponse, 201)
    }

    const ws = /^\/ws\/([^/]+)$/.exec(url.pathname)
    if (ws) {
      if (!ROOM_ID_RE.test(ws[1])) return new Response('Sala inválida', { status: 404 })
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Esperava WebSocket', { status: 426 })
      const headers = new Headers(request.headers)
      headers.set('x-room-id', ws[1])
      return env.ROOMS.getByName(ws[1]).fetch(new Request(request, { headers }))
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Não encontrado.' }, 404)
    return env.ASSETS.fetch(request)
  }
} satisfies ExportedHandler<Env>
