import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '../src/shared/protocol'
import type { BudgetState, Sdp } from '../src/shared/sfu'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import { SfuApiError, type BudgetApi, type SfuApi, type TrackObject, type TracksResult } from '../src/worker/sfuApi'

const sha = async (t: string) => createHash('sha256').update(t).digest('hex')
const HOST_KEY = 'chave-do-host'
const offer: Sdp = { type: 'offer', sdp: 'v=0 offer' }
const answer: Sdp = { type: 'answer', sdp: 'v=0 answer' }

class FakeConn implements Conn {
  inbox: ServerMessage[] = []
  private d: ConnData = {}
  constructor(private readonly room: FakeRoom) {}
  send(msg: ServerMessage) {
    this.inbox.push(msg)
  }
  close() {}
  data() {
    return this.d
  }
  setData(d: ConnData) {
    this.d = d
  }
  view(): Conn {
    return { send: (m) => this.send(m), close: () => {}, data: () => this.data(), setData: (d) => this.setData(d) }
  }
  last<T extends ServerMessage['type']>(type: T) {
    return [...this.inbox].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined
  }
  all<T extends ServerMessage['type']>(type: T) {
    return this.inbox.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[]
  }
  async say(msg: unknown) {
    await this.room.core.onMessage(this, JSON.stringify(msg))
  }
}

type Call = { fn: string; args: unknown[] }

class FakeSfu implements SfuApi {
  calls: Call[] = []
  fail?: Error
  private n = 0
  private mids = 0
  private log<T>(fn: string, ...args: unknown[]): T | undefined {
    this.calls.push({ fn, args })
    if (this.fail) throw this.fail
    return undefined
  }
  of(fn: string) {
    return this.calls.filter((c) => c.fn === fn)
  }
  async newSession() {
    this.log('newSession')
    return `sess${++this.n}`
  }
  async addTracks(sessionId: string, tracks: TrackObject[], offerSdp?: Sdp): Promise<TracksResult> {
    this.log('addTracks', sessionId, tracks, offerSdp)
    if (offerSdp) return { sessionDescription: answer, tracks }
    return { sessionDescription: offer, tracks: tracks.map((t) => ({ ...t, mid: String(++this.mids) })) }
  }
  async renegotiate(sessionId: string, a: Sdp) {
    this.log('renegotiate', sessionId, a)
  }
  async updateTracks(sessionId: string, tracks: TrackObject[]): Promise<TracksResult> {
    this.log('updateTracks', sessionId, tracks)
    return { tracks }
  }
  async closeTracks(sessionId: string, mids: string[], o?: Sdp): Promise<TracksResult> {
    this.log('closeTracks', sessionId, mids, o)
    return { sessionDescription: o ? answer : undefined, tracks: [] }
  }
}

class FakeBudget implements BudgetApi {
  state: BudgetState = 'ok'
  peeks = 0
  reports: [string, number][] = []
  /** estado que o próximo report devolve */
  next?: BudgetState
  async report(roomId: string, bytes: number) {
    this.reports.push([roomId, bytes])
    if (this.next) this.state = this.next
    return this.state
  }
  async peek() {
    this.peeks++
    return this.state
  }
}

class FakeRoom {
  conns: FakeConn[] = []
  core: RoomCore
  clock = 1_000_000
  private n = 0
  config: RoomConfig
  constructor(
    hashKey: string,
    public sfu: FakeSfu | undefined,
    public budget: FakeBudget | undefined
  ) {
    this.config = {
      hostKeyHash: hashKey,
      requireApproval: false,
      channels: [
        { id: 'geral', name: 'Geral' },
        { id: 'poker', name: 'Poker' }
      ]
    }
    this.core = new RoomCore({
      conns: () => this.conns.map((c) => c.view()),
      config: () => this.config,
      hash: sha,
      newId: () => `id${++this.n}`,
      iceServers: async () => [],
      now: () => this.clock,
      sfu,
      budget,
      roomId: () => 'sala1'
    })
  }
  open() {
    const c = new FakeConn(this)
    this.conns.push(c)
    return c
  }
}

async function setup(opts: { sfu?: boolean; budget?: boolean } = {}) {
  const sfu = opts.sfu === false ? undefined : new FakeSfu()
  const budget = opts.budget === false ? undefined : new FakeBudget()
  const r = new FakeRoom(await sha(HOST_KEY), sfu, budget)
  const host = r.open()
  await host.say({ type: 'join', name: 'Pedro', hostKey: HOST_KEY })
  const guest = r.open()
  await guest.say({ type: 'join', name: 'Bia' })
  return { r, sfu, budget, host, guest, hostId: host.data().peerId!, guestId: guest.data().peerId! }
}

const push = (extra: object = {}) => ({
  type: 'sfu-push',
  requestId: 'r1',
  streamId: 'tela1',
  sdp: offer,
  tracks: [
    { mid: '0', kind: 'video' },
    { mid: '1', kind: 'audio' }
  ],
  ...extra
})

/** o host publica a tela (estado + push) */
async function hostSharing(s: Awaited<ReturnType<typeof setup>>) {
  await s.host.say({ type: 'state', state: { sharing: true, micMuted: false, screenStreamId: 'tela1', screenRoute: 'sfu' } })
  await s.host.say(push())
}

const pull = (from: string, extra: object = {}) => ({ type: 'sfu-pull', requestId: 'p1', from, streamId: 'tela1', rid: 'a', ...extra })

describe('sfu-push', () => {
  it('cria a sessão, publica as trilhas e responde com o answer', async () => {
    const s = await setup()
    await s.host.say(push())
    const reply = s.host.last('sfu-reply')!
    expect(reply).toEqual({ type: 'sfu-reply', requestId: 'r1', sdp: answer })
    expect(s.sfu!.of('newSession')).toHaveLength(1)
    const [sessionId, tracks, sent] = s.sfu!.of('addTracks')[0].args as [string, TrackObject[], Sdp]
    expect(sessionId).toBe('sess1')
    expect(sent).toEqual(offer)
    expect(tracks.map((t) => [t.location, t.mid, t.kind])).toEqual([
      ['local', '0', 'video'],
      ['local', '1', 'audio']
    ])
    expect(new Set(tracks.map((t) => t.trackName)).size).toBe(2)
    const d = s.host.data().sfu!
    expect(d.sessionId).toBe('sess1')
    expect(d.pushed!.streamId).toBe('tela1')
    expect(d.pushed!.tracks.map((t) => t.mid)).toEqual(['0', '1'])
  })

  it('reaproveita a sessão e substitui a publicação anterior', async () => {
    const s = await setup()
    await s.host.say(push())
    await s.host.say(push({ requestId: 'r2', streamId: 'tela2', tracks: [{ mid: '3', kind: 'video' }] }))
    expect(s.sfu!.of('newSession')).toHaveLength(1)
    expect(s.host.data().sfu!.pushed).toMatchObject({ streamId: 'tela2', tracks: [{ mid: '3' }] })
  })

  it('esgotado bloqueia o push', async () => {
    const s = await setup()
    s.budget!.state = 'esgotado'
    s.r.clock += 120_000
    await s.host.say(push())
    expect(s.host.last('sfu-reply')!.error!.code).toBe('budget')
    expect(s.sfu!.calls).toHaveLength(0)
  })
})

describe('sfu-pull', () => {
  it('permite assistir a tela publicada no mesmo canal', async () => {
    const s = await setup()
    await hostSharing(s)
    await s.guest.say(pull(s.hostId))
    const reply = s.guest.last('sfu-reply')!
    expect(reply.error).toBeUndefined()
    expect(reply.sdp).toEqual(offer)
    expect(reply.tracks).toEqual([
      { mid: '1', kind: 'video' },
      { mid: '2', kind: 'audio' }
    ])
    const [sessionId, tracks, sent] = s.sfu!.of('addTracks')[1].args as [string, TrackObject[], Sdp | undefined]
    expect(sessionId).toBe('sess2')
    expect(sent).toBeUndefined()
    expect(tracks.every((t) => t.location === 'remote' && t.sessionId === 'sess1')).toBe(true)
    expect(tracks[0].simulcast).toEqual({ preferredRid: 'a', priorityOrdering: 'asciibetical', ridNotAvailable: 'asciibetical' })
    expect(tracks[1].simulcast).toBeUndefined()
    expect(s.guest.data().sfu!.pulled).toHaveLength(2)
  })

  it('em economia a camada a vira b', async () => {
    const s = await setup()
    s.budget!.state = 'economia'
    s.r.clock += 120_000 // passa o cache de 60 s
    await hostSharing(s)
    await s.guest.say(pull(s.hostId))
    const tracks = s.sfu!.of('addTracks')[1].args[1] as TrackObject[]
    expect(tracks[0].simulcast!.preferredRid).toBe('b')
    await s.guest.say(pull(s.hostId, { requestId: 'p2', rid: 'c' }))
    expect((s.sfu!.of('addTracks')[2].args[1] as TrackObject[])[0].simulcast!.preferredRid).toBe('c')
  })

  it('nega em outro canal', async () => {
    const s = await setup()
    await hostSharing(s)
    await s.guest.say({ type: 'channel-join', channelId: 'poker' })
    await s.guest.say(pull(s.hostId))
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('not-allowed')
  })

  it('nega quando a rota é mesh', async () => {
    const s = await setup()
    await s.host.say(push())
    await s.host.say({ type: 'state', state: { sharing: true, micMuted: false, screenStreamId: 'tela1', screenRoute: 'mesh' } })
    await s.guest.say(pull(s.hostId))
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('not-allowed')
  })

  it('nega com streamId errado, sem push ou peer inexistente', async () => {
    const s = await setup()
    await s.host.say({ type: 'state', state: { sharing: true, micMuted: false, screenStreamId: 'tela1', screenRoute: 'sfu' } })
    await s.guest.say(pull(s.hostId)) // ainda sem push
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('not-allowed')
    await s.host.say(push())
    await s.guest.say(pull(s.hostId, { streamId: 'outra' }))
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('not-allowed')
    await s.guest.say(pull('ninguem'))
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('not-allowed')
    await s.guest.say(pull(s.guestId))
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('not-allowed')
    expect(s.guest.data().sfu).toBeUndefined()
  })

  it('esgotado bloqueia o pull', async () => {
    const s = await setup()
    await hostSharing(s)
    s.budget!.state = 'esgotado'
    s.r.clock += 120_000
    await s.guest.say(pull(s.hostId))
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('budget')
  })
})

describe('sfu-answer, sfu-layer e sfu-close', () => {
  it('answer renegocia na sessão do cliente; sem sessão é bad-state', async () => {
    const s = await setup()
    await s.guest.say({ type: 'sfu-answer', requestId: 'a0', sdp: answer })
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('bad-state')
    await hostSharing(s)
    await s.guest.say(pull(s.hostId))
    await s.guest.say({ type: 'sfu-answer', requestId: 'a1', sdp: answer })
    expect(s.guest.last('sfu-reply')).toEqual({ type: 'sfu-reply', requestId: 'a1' })
    expect(s.sfu!.of('renegotiate')[0].args).toEqual(['sess2', answer])
  })

  it('layer troca a camada só de vídeo assinado', async () => {
    const s = await setup()
    await hostSharing(s)
    await s.guest.say(pull(s.hostId))
    await s.guest.say({ type: 'sfu-layer', requestId: 'l1', mid: '1', rid: 'c' })
    expect(s.guest.last('sfu-reply')).toEqual({ type: 'sfu-reply', requestId: 'l1' })
    const [sessionId, tracks] = s.sfu!.of('updateTracks')[0].args as [string, TrackObject[]]
    expect(sessionId).toBe('sess2')
    expect(tracks[0]).toMatchObject({ location: 'remote', mid: '1', sessionId: 'sess1', simulcast: { preferredRid: 'c' } })
    // áudio e mid desconhecido
    await s.guest.say({ type: 'sfu-layer', requestId: 'l2', mid: '2', rid: 'c' })
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('bad-state')
    await s.guest.say({ type: 'sfu-layer', requestId: 'l3', mid: '99', rid: 'c' })
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('bad-state')
  })

  it('layer respeita a economia', async () => {
    const s = await setup()
    await hostSharing(s)
    await s.guest.say(pull(s.hostId, { rid: 'c' }))
    s.budget!.state = 'economia'
    s.r.clock += 120_000
    await s.guest.say({ type: 'sfu-layer', requestId: 'l1', mid: '1', rid: 'a' })
    expect((s.sfu!.of('updateTracks')[0].args[1] as TrackObject[])[0].simulcast!.preferredRid).toBe('b')
  })

  it('close fecha as trilhas, tira dos registros e devolve o sdp', async () => {
    const s = await setup()
    await hostSharing(s)
    await s.host.say({ type: 'sfu-close', requestId: 'c1', mids: ['0'], sdp: offer })
    expect(s.host.last('sfu-reply')).toEqual({ type: 'sfu-reply', requestId: 'c1', sdp: answer })
    expect(s.sfu!.of('closeTracks')[0].args).toEqual(['sess1', ['0'], offer])
    expect(s.host.data().sfu!.pushed!.tracks.map((t) => t.mid)).toEqual(['1'])
    await s.host.say({ type: 'sfu-close', requestId: 'c2', mids: ['1'] })
    expect(s.host.last('sfu-reply')).toEqual({ type: 'sfu-reply', requestId: 'c2' })
    expect(s.host.data().sfu!.pushed).toBeUndefined()
    expect(s.host.data().sfu!.sessionId).toBe('sess1')

    await s.guest.say(pull(s.hostId)) // publicação já fechada
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('not-allowed')
  })

  it('close de quem assiste limpa pulled', async () => {
    const s = await setup()
    await hostSharing(s)
    await s.guest.say(pull(s.hostId))
    await s.guest.say({ type: 'sfu-close', requestId: 'c1', mids: ['1', '2'] })
    expect(s.guest.data().sfu!.pulled).toBeUndefined()
  })
})

describe('falhas e regras gerais', () => {
  it('erro da API vira sfu-reply com api', async () => {
    const s = await setup()
    s.sfu!.fail = new SfuApiError(500, 'x', 'quebrou')
    const warn = console.warn
    console.warn = () => {}
    try {
      await s.host.say(push())
      s.sfu!.fail = new Error('rede')
      await s.host.say(push({ requestId: 'r2' }))
    } finally {
      console.warn = warn
    }
    const replies = s.host.all('sfu-reply')
    expect(replies.map((m) => [m.requestId, m.error?.code])).toEqual([
      ['r1', 'api'],
      ['r2', 'api']
    ])
    expect(s.host.data().sfu?.pushed).toBeUndefined()
  })

  it('sem sfu responde disabled e o welcome avisa', async () => {
    const s = await setup({ sfu: false, budget: false })
    expect(s.host.last('welcome')!.sfu).toEqual({ enabled: false, budget: 'ok' })
    await s.guest.say(push())
    expect(s.guest.last('sfu-reply')!.error!.code).toBe('disabled')
    expect(s.guest.all('error')).toEqual([])
  })

  it('quem não é host não cai em not-host', async () => {
    const s = await setup()
    await s.guest.say(push())
    expect(s.guest.last('sfu-reply')!.error).toBeUndefined()
    expect(s.guest.all('error')).toEqual([])
  })

  it('exige entrar na sala antes', async () => {
    const s = await setup()
    const out = s.r.open()
    await out.say(push())
    expect(out.last('error')!.code).toBe('not-joined')
  })

  it('welcome traz sfu com o orçamento, consultado no máximo a cada 60 s', async () => {
    const s = await setup()
    expect(s.guest.last('welcome')!.sfu).toEqual({ enabled: true, budget: 'ok' })
    expect(s.budget!.peeks).toBe(1)
    s.budget!.state = 'economia'
    const c = s.r.open()
    await c.say({ type: 'join', name: 'C' })
    expect(c.last('welcome')!.sfu!.budget).toBe('ok')
    expect(s.budget!.peeks).toBe(1)
    s.r.clock += 61_000
    const d = s.r.open()
    await d.say({ type: 'join', name: 'D' })
    expect(d.last('welcome')!.sfu).toEqual({ enabled: true, budget: 'economia' })
    expect(s.budget!.peeks).toBe(2)
  })
})

describe('sfu-usage', () => {
  it('soma o uso e faz broadcast só quando o estado muda', async () => {
    const s = await setup()
    await s.guest.say({ type: 'sfu-usage', bytes: 1000 })
    expect(s.budget!.reports).toEqual([['sala1', 1000]])
    expect(s.host.all('sfu-budget')).toEqual([])
    expect(s.guest.all('sfu-reply')).toEqual([])

    s.budget!.next = 'economia'
    await s.guest.say({ type: 'sfu-usage', bytes: 5 })
    expect(s.host.all('sfu-budget')).toEqual([{ type: 'sfu-budget', state: 'economia' }])
    expect(s.guest.all('sfu-budget')).toHaveLength(1)

    await s.host.say({ type: 'sfu-usage', bytes: 5 })
    expect(s.guest.all('sfu-budget')).toHaveLength(1)

    s.budget!.next = 'esgotado'
    await s.host.say({ type: 'sfu-usage', bytes: 5 })
    expect(s.guest.all('sfu-budget').map((m) => m.state)).toEqual(['economia', 'esgotado'])
  })

  it('o esgotado informado pelo uso já bloqueia o push sem nova consulta', async () => {
    const s = await setup()
    s.budget!.next = 'esgotado'
    await s.guest.say({ type: 'sfu-usage', bytes: 5 })
    await s.host.say(push())
    expect(s.host.last('sfu-reply')!.error!.code).toBe('budget')
  })

  it('sem orçamento ou sem sfu ignora em silêncio', async () => {
    const s = await setup({ budget: false })
    await s.guest.say({ type: 'sfu-usage', bytes: 5 })
    expect(s.guest.inbox.filter((m) => m.type === 'sfu-reply' || m.type === 'error')).toEqual([])
  })
})
