import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMessage } from '../src/shared/protocol'
import {
  RequestTracker,
  SerialQueue,
  SfuError,
  SfuLink,
  UsageMeter,
  hasDecodedVideo,
  inboundBytes,
  tracksByMid,
  type SfuReply
} from '../src/web/rtc/SfuLink'
import type { StatRow } from '../src/web/rtc/stats'

// ---------------- peças puras ----------------

describe('SerialQueue', () => {
  it('roda uma de cada vez, na ordem, e um erro não trava a fila', async () => {
    const q = new SerialQueue()
    const log: string[] = []
    const slow = (name: string, ms: number, fail = false) =>
      q.run(async () => {
        log.push(`${name}:início`)
        await new Promise((r) => setTimeout(r, ms))
        log.push(`${name}:fim`)
        if (fail) throw new Error(name)
        return name
      })
    const a = slow('a', 20)
    const b = slow('b', 1, true)
    const c = slow('c', 1)
    await expect(a).resolves.toBe('a')
    await expect(b).rejects.toThrow('b')
    await expect(c).resolves.toBe('c')
    expect(log).toEqual(['a:início', 'a:fim', 'b:início', 'b:fim', 'c:início', 'c:fim'])
  })
})

describe('RequestTracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const reply = (requestId: string, extra: Partial<SfuReply> = {}): SfuReply => ({ type: 'sfu-reply', requestId, ...extra })

  it('casa a resposta pelo requestId', async () => {
    const sent: ClientMessage[] = []
    const t = new RequestTracker((m) => sent.push(m))
    const p1 = t.request((requestId) => ({ type: 'sfu-answer', requestId, sdp: { type: 'answer', sdp: 'x' } }))
    const p2 = t.request((requestId) => ({ type: 'sfu-answer', requestId, sdp: { type: 'answer', sdp: 'y' } }))
    const [id1, id2] = sent.map((m) => (m as { requestId: string }).requestId)
    expect(id1).not.toBe(id2)
    t.handleReply(reply(id2, { sdp: { type: 'answer', sdp: 'segunda' } }))
    t.handleReply(reply(id1))
    expect((await p2).sdp?.sdp).toBe('segunda')
    expect((await p1).sdp).toBeUndefined()
    expect(t.size).toBe(0)
  })

  it('resposta com erro rejeita com o código do servidor', async () => {
    const sent: ClientMessage[] = []
    const t = new RequestTracker((m) => sent.push(m))
    const p = t.request((requestId) => ({ type: 'sfu-layer', requestId, mid: '1', rid: 'a' }))
    t.handleReply(reply((sent[0] as { requestId: string }).requestId, { error: { code: 'budget', message: 'Acabou a cota.' } }))
    await expect(p).rejects.toMatchObject({ code: 'budget', message: 'Acabou a cota.', fatal: false })
  })

  it('estoura o prazo com erro fatal e ignora a resposta tardia', async () => {
    const sent: ClientMessage[] = []
    const t = new RequestTracker((m) => sent.push(m), 15_000)
    const p = t.request((requestId) => ({ type: 'sfu-pull', requestId, from: 'bia', streamId: 's', rid: 'b' }))
    const caught = p.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(15_000)
    const err = (await caught) as SfuError
    expect(err).toBeInstanceOf(SfuError)
    expect(err.code).toBe('timeout')
    expect(err.fatal).toBe(true)
    expect(() => t.handleReply(reply((sent[0] as { requestId: string }).requestId))).not.toThrow()
    expect(t.size).toBe(0)
  })

  it('rejectAll derruba os pedidos abertos', async () => {
    const t = new RequestTracker(() => undefined)
    const p = t.request((requestId) => ({ type: 'sfu-layer', requestId, mid: '1', rid: 'a' }))
    t.rejectAll(new SfuError('closed', 'fechou'))
    await expect(p).rejects.toMatchObject({ code: 'closed' })
  })
})

describe('UsageMeter', () => {
  it('soma só o que chegou desde a última leitura', () => {
    const m = new UsageMeter()
    expect(m.take([{ id: 'v', bytes: 1000 }])).toBe(1000)
    expect(m.take([{ id: 'v', bytes: 1800 }])).toBe(800)
    expect(m.take([{ id: 'v', bytes: 1800 }])).toBe(0)
  })

  it('fluxo novo conta inteiro e fluxo que some não zera os outros', () => {
    const m = new UsageMeter()
    m.take([
      { id: 'a', bytes: 500 },
      { id: 'b', bytes: 300 }
    ])
    // b fechou, c abriu
    expect(
      m.take([
        { id: 'a', bytes: 700 },
        { id: 'c', bytes: 100 }
      ])
    ).toBe(200 + 100)
  })

  it('contador que reiniciou conta o valor novo inteiro', () => {
    const m = new UsageMeter()
    m.take([{ id: 'a', bytes: 5000 }])
    expect(m.take([{ id: 'a', bytes: 40 }])).toBe(40)
  })
})

describe('leitura de estatísticas', () => {
  const rows: StatRow[] = [
    { id: 'i1', type: 'inbound-rtp', kind: 'video', bytesReceived: 1200, framesDecoded: 0 },
    { id: 'i2', type: 'inbound-rtp', kind: 'audio', bytesReceived: 300, framesDecoded: 99 },
    { id: 'o1', type: 'outbound-rtp', kind: 'video', bytesSent: 9 }
  ]

  it('inboundBytes pega os inbound-rtp de áudio e vídeo', () => {
    expect(inboundBytes(rows)).toEqual([
      { id: 'i1', bytes: 1200 },
      { id: 'i2', bytes: 300 }
    ])
  })

  it('hasDecodedVideo só vale para vídeo com quadros decodificados', () => {
    expect(hasDecodedVideo(rows)).toBe(false)
    expect(hasDecodedVideo([...rows, { id: 'i3', type: 'inbound-rtp', kind: 'video', framesDecoded: 3 }])).toBe(true)
  })
})

describe('tracksByMid', () => {
  const t = (mid: string | null, id: string) => ({ mid, receiver: { track: { id } as MediaStreamTrack } })

  it('acha o transceiver de cada trilha pelo mid', () => {
    const list = [t('0', 'x'), t('3', 'v'), t('4', 'a')]
    const got = tracksByMid(list, [
      { mid: '3', kind: 'video' },
      { mid: '4', kind: 'audio' }
    ])
    expect(got.map((g) => [g.mid, g.kind, g.track.id])).toEqual([
      ['3', 'video', 'v'],
      ['4', 'audio', 'a']
    ])
  })

  it('mid que não está na conexão é erro fatal', () => {
    expect(() => tracksByMid([t('0', 'x')], [{ mid: '9', kind: 'video' }])).toThrow(SfuError)
  })
})

// ---------------- SfuLink com RTCPeerConnection falso ----------------

interface FakeStats {
  rows: StatRow[]
}

class FakeTransceiver {
  mid: string | null = null
  stopped = false
  direction = 'sendrecv'
  readonly receiver: { track: MediaStreamTrack; getStats: () => Promise<Map<string, StatRow>> }
  readonly sender: { track?: MediaStreamTrack; params: RTCRtpSendParameters; getParameters: () => RTCRtpSendParameters; setParameters: (p: RTCRtpSendParameters) => Promise<void> }
  constructor(
    readonly kind: 'audio' | 'video',
    track: MediaStreamTrack | undefined,
    encodings: RTCRtpEncodingParameters[],
    private readonly stats: FakeStats
  ) {
    this.receiver = {
      track: { id: `rx-${kind}`, kind } as MediaStreamTrack,
      getStats: async () => new Map(this.stats.rows.map((r) => [r.id, r]))
    }
    const params = { encodings: encodings.map((e) => ({ ...e })), transactionId: 't', codecs: [], headerExtensions: [], rtcp: {} } as RTCRtpSendParameters
    this.sender = {
      track,
      params,
      getParameters: () => this.sender.params,
      setParameters: async (p) => {
        this.sender.params = p
      }
    }
  }
  stop(): void {
    this.stopped = true
  }
}

class FakePc {
  signalingState: RTCSignalingState = 'stable'
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: { type: string; sdp: string } | null = null
  onconnectionstatechange: (() => void) | null = null
  closed = false
  readonly transceivers: FakeTransceiver[] = []
  readonly log: string[] = []
  readonly stats: FakeStats = { rows: [] }
  private mids = 0

  addTransceiver(trackOrKind: MediaStreamTrack | string, init: RTCRtransceiverInitLike = {}): FakeTransceiver {
    const track = typeof trackOrKind === 'string' ? undefined : trackOrKind
    const kind = (typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind) as 'audio' | 'video'
    const t = new FakeTransceiver(kind, track, init.sendEncodings ?? [], this.stats)
    t.direction = init.direction ?? 'sendrecv'
    this.transceivers.push(t)
    this.log.push(`addTransceiver:${kind}:${t.direction}`)
    return t
  }
  getTransceivers(): FakeTransceiver[] {
    return this.transceivers.filter((t) => !(t.stopped && t.mid === null))
  }
  async createOffer() {
    this.log.push('createOffer')
    return { type: 'offer' as const, sdp: `offer[${this.transceivers.filter((t) => !t.stopped).length}]` }
  }
  async createAnswer() {
    this.log.push('createAnswer')
    return { type: 'answer' as const, sdp: 'answer-local' }
  }
  async setLocalDescription(d: { type: string; sdp?: string }) {
    this.log.push(`setLocal:${d.type}`)
    if (d.type === 'rollback') {
      this.signalingState = 'stable'
      return
    }
    for (const t of this.transceivers) if (t.mid === null && !t.stopped) t.mid = String(this.mids++)
    this.localDescription = { type: d.type, sdp: d.sdp ?? '' }
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.log.push(`setRemote:${d.type}`)
    if (d.type === 'answer') {
      this.signalingState = 'stable'
      return
    }
    // "offer:mids=7:video,8:audio": o servidor cria os transceivers de quem assiste
    const m = /mids=([^ ]+)/.exec(d.sdp)
    for (const part of m?.[1].split(',') ?? []) {
      const [mid, kind] = part.split(':')
      const t = new FakeTransceiver(kind as 'audio' | 'video', undefined, [], this.stats)
      t.mid = mid
      this.transceivers.push(t)
    }
    this.signalingState = 'have-remote-offer'
  }
  async getStats() {
    return new Map(this.stats.rows.map((r) => [r.id, r]))
  }
  close() {
    this.closed = true
    this.log.push('close')
  }
}

interface RTCRtransceiverInitLike {
  direction?: 'sendonly' | 'recvonly' | 'sendrecv'
  sendEncodings?: RTCRtpEncodingParameters[]
  streams?: unknown[]
}

const track = (kind: 'audio' | 'video', id: string) => ({ kind, id }) as unknown as MediaStreamTrack
const screen = (withAudio = true): MediaStream => {
  const v = track('video', 'v1')
  const a = track('audio', 'a1')
  return { id: 'tela-1', getVideoTracks: () => [v], getAudioTracks: () => (withAudio ? [a] : []) } as unknown as MediaStream
}

const ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: 'a', scaleResolutionDownBy: 1, maxBitrate: 5_000_000, maxFramerate: 30, active: true },
  { rid: 'b', scaleResolutionDownBy: 1.5, maxBitrate: 2_500_000, maxFramerate: 30, active: true },
  { rid: 'c', scaleResolutionDownBy: 3, maxBitrate: 600_000, maxFramerate: 30, active: true }
]

/** servidor falso: responde cada mensagem como o worker responderia */
function setup(opts: { reply?: (msg: ClientMessage, link: SfuLink) => Partial<SfuReply> | 'mudo' | undefined } = {}) {
  const pcs: FakePc[] = []
  const sent: ClientMessage[] = []
  let link: SfuLink
  const defaultReply = (msg: ClientMessage): Partial<SfuReply> | undefined => {
    switch (msg.type) {
      case 'sfu-push':
        return { sdp: { type: 'answer', sdp: 'answer-sfu' } }
      case 'sfu-pull':
        return { sdp: { type: 'offer', sdp: 'offer mids=7:video,8:audio' }, tracks: [{ mid: '7', kind: 'video' }, { mid: '8', kind: 'audio' }] }
      case 'sfu-close':
        return { sdp: { type: 'answer', sdp: 'answer-sfu' } }
      default:
        return {}
    }
  }
  link = new SfuLink({
    send: (msg) => {
      sent.push(msg)
      if (!('requestId' in msg)) return
      const requestId = msg.requestId
      const body = opts.reply ? opts.reply(msg, link) : defaultReply(msg)
      if (body === 'mudo') return
      queueMicrotask(() => link.handleReply({ type: 'sfu-reply', requestId, ...(body ?? defaultReply(msg)) }))
    },
    createPc: () => {
      const pc = new FakePc()
      pcs.push(pc)
      return pc as unknown as RTCPeerConnection
    },
    makeStream: (tracks) => ({ id: 'sfu-stream', tracks }) as unknown as MediaStream,
    requestTimeoutMs: 1000,
    usageEveryMs: 30_000
  })
  return { link, pcs, sent }
}

const types = (sent: ClientMessage[]) => sent.map((m) => m.type)

describe('SfuLink: publicar', () => {
  let link: SfuLink
  afterEach(() => link?.dispose())

  it('oferta com vídeo e áudio sendonly, sfu-push com os mids e answer aplicada', async () => {
    const s = setup()
    link = s.link
    const rids = await link.publish(screen(), ENCODINGS)
    expect(rids).toEqual(['a', 'b', 'c'])
    const pc = s.pcs[0]
    expect(pc.log.slice(0, 2)).toEqual(['addTransceiver:video:sendonly', 'addTransceiver:audio:sendonly'])
    expect(pc.log).toContain('setRemote:answer')
    const push = s.sent[0]
    expect(push).toMatchObject({
      type: 'sfu-push',
      streamId: 'tela-1',
      sdp: { type: 'offer' },
      tracks: [{ mid: '0', kind: 'video' }, { mid: '1', kind: 'audio' }]
    })
    expect(pc.transceivers[0].sender.params.encodings.map((e) => e.rid)).toEqual(['a', 'b', 'c'])
    expect(link.publishedRids()).toEqual(['a', 'b', 'c'])
  })

  it('sem áudio da tela, publica só o vídeo', async () => {
    const s = setup()
    link = s.link
    await link.publish(screen(false), ENCODINGS)
    expect((s.sent[0] as Extract<ClientMessage, { type: 'sfu-push' }>).tracks).toEqual([{ mid: '0', kind: 'video' }])
  })

  it('unpublish para os transceivers e manda sfu-close com os mids e a oferta sem eles', async () => {
    const s = setup()
    link = s.link
    await link.publish(screen(), ENCODINGS)
    await link.unpublish()
    const pc = s.pcs[0]
    expect(pc.transceivers.every((t) => t.stopped)).toBe(true)
    const close = s.sent.at(-1) as Extract<ClientMessage, { type: 'sfu-close' }>
    expect(close.type).toBe('sfu-close')
    expect(close.mids).toEqual(['0', '1'])
    expect(close.sdp?.type).toBe('offer')
    expect(pc.log.at(-1)).toBe('setRemote:answer')
    expect(link.isPublished).toBe(false)
  })

  it('setTopLayer mexe só na camada a; setEncodings reaplica tudo e desativa o que sobrou', async () => {
    const s = setup()
    link = s.link
    await link.publish(screen(), ENCODINGS)
    const sender = s.pcs[0].transceivers[0].sender
    await link.setTopLayer({ maxBitrate: 9_000_000, maxFramerate: 60, scaleResolutionDownBy: 2 })
    const [a, b] = sender.params.encodings
    expect(a).toMatchObject({ rid: 'a', maxBitrate: 9_000_000, maxFramerate: 60, scaleResolutionDownBy: 2 })
    expect(b).toMatchObject({ rid: 'b', maxBitrate: 2_500_000 })

    await link.setEncodings([{ rid: 'a', scaleResolutionDownBy: 1, maxBitrate: 1_200_000, maxFramerate: 30 }, { rid: 'c', scaleResolutionDownBy: 1.5, maxBitrate: 600_000, maxFramerate: 30 }])
    const byRid = Object.fromEntries(sender.params.encodings.map((e) => [e.rid, e]))
    expect(byRid.a).toMatchObject({ active: true, maxBitrate: 1_200_000 })
    expect(byRid.b.active).toBe(false)
    expect(byRid.c).toMatchObject({ active: true, scaleResolutionDownBy: 1.5 })
    expect(link.publishedRids()).toEqual(['a', 'c'])
  })

  it('degradationPreference e prioridade de rede vão para o sender (publicar, camada a e todas as camadas)', async () => {
    const s = setup()
    link = s.link
    await link.publish(screen(), ENCODINGS, 'maintain-framerate')
    const sender = s.pcs[0].transceivers[0].sender
    expect(sender.params.degradationPreference).toBe('maintain-framerate')
    await link.setTopLayer({ maxBitrate: 4_000_000, maxFramerate: 60, scaleResolutionDownBy: 1.5, degradation: 'balanced' })
    expect(sender.params.degradationPreference).toBe('balanced')
    expect(sender.params.encodings[0]).toMatchObject({ priority: 'high', networkPriority: 'high' })
    await link.setEncodings([{ rid: 'a', scaleResolutionDownBy: 1, maxBitrate: 9_000_000, maxFramerate: 60 }], 'maintain-framerate')
    expect(sender.params.degradationPreference).toBe('maintain-framerate')
    expect(sender.params.encodings.find((e) => e.rid === 'a')).toMatchObject({ priority: 'high', networkPriority: 'high' })
  })
})

describe('SfuLink: assistir', () => {
  let link: SfuLink
  afterEach(() => link?.dispose())

  it('pull recebe a offer, responde com sfu-answer e monta o stream pelos mids', async () => {
    const s = setup()
    link = s.link
    const stream = (await link.subscribe('bia', 'tela-bia', 'b')) as unknown as { tracks: MediaStreamTrack[] }
    expect(types(s.sent)).toEqual(['sfu-pull', 'sfu-answer'])
    expect(s.sent[0]).toMatchObject({ from: 'bia', streamId: 'tela-bia', rid: 'b' })
    expect(s.sent[1]).toMatchObject({ sdp: { type: 'answer', sdp: 'answer-local' } })
    expect(s.pcs[0].log).toEqual(['setRemote:offer', 'createAnswer', 'setLocal:answer'])
    expect(stream.tracks.map((t) => t.id)).toEqual(['rx-video', 'rx-audio'])
    expect(link.hasSubscription('bia')).toBe(true)
  })

  it('uma assinatura por pessoa: repetir devolve o mesmo stream sem falar com o servidor', async () => {
    const s = setup()
    link = s.link
    const a = await link.subscribe('bia', 'tela-bia', 'b')
    const b = await link.subscribe('bia', 'tela-bia', 'a')
    expect(b).toBe(a)
    expect(types(s.sent)).toEqual(['sfu-pull', 'sfu-answer'])
  })

  it('as operações de SDP entram numa fila: o segundo pull só sai depois do answer do primeiro', async () => {
    let n = 0
    const s = setup({
      reply: (msg) => {
        if (msg.type === 'sfu-pull') {
          const base = 10 + n++ * 2
          return { sdp: { type: 'offer', sdp: `offer mids=${base}:video,${base + 1}:audio` }, tracks: [{ mid: String(base), kind: 'video' }, { mid: String(base + 1), kind: 'audio' }] }
        }
        return undefined
      }
    })
    link = s.link
    const p1 = link.subscribe('bia', 's1', 'b')
    const p2 = link.subscribe('caio', 's2', 'c')
    await Promise.all([p1, p2])
    expect(types(s.sent)).toEqual(['sfu-pull', 'sfu-answer', 'sfu-pull', 'sfu-answer'])
    expect((s.sent[2] as { from: string }).from).toBe('caio')
  })

  it('unsubscribe para os transceivers da assinatura e fecha os mids no servidor', async () => {
    const s = setup()
    link = s.link
    await link.subscribe('bia', 'tela-bia', 'b')
    await link.unsubscribe('bia')
    const close = s.sent.at(-1) as Extract<ClientMessage, { type: 'sfu-close' }>
    expect(close.type).toBe('sfu-close')
    expect(close.mids).toEqual(['7', '8'])
    expect(s.pcs[0].transceivers.filter((t) => t.mid === '7' || t.mid === '8').every((t) => t.stopped)).toBe(true)
    expect(link.hasSubscription('bia')).toBe(false)
    // sem assinatura: não faz nada
    const before = s.sent.length
    await link.unsubscribe('bia')
    expect(s.sent.length).toBe(before)
  })

  it('setLayer manda o mid do vídeo; se vier offer, responde com sfu-answer', async () => {
    const s = setup({
      reply: (msg) => {
        if (msg.type === 'sfu-layer') return { sdp: { type: 'offer', sdp: 'offer mids=' } }
        return undefined
      }
    })
    link = s.link
    await link.subscribe('bia', 'tela-bia', 'b')
    s.sent.length = 0
    await link.setLayer('bia', 'a')
    expect(s.sent[0]).toMatchObject({ type: 'sfu-layer', mid: '7', rid: 'a' })
    expect(types(s.sent)).toEqual(['sfu-layer', 'sfu-answer'])
  })

  it('setLayer sem offer na resposta não responde nada', async () => {
    const s = setup()
    link = s.link
    await link.subscribe('bia', 'tela-bia', 'b')
    s.sent.length = 0
    await link.setLayer('bia', 'c')
    expect(types(s.sent)).toEqual(['sfu-layer'])
  })

  describe('firstFrame', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('resolve quando o vídeo decodifica o primeiro quadro', async () => {
      const s = setup()
      link = s.link
      await link.subscribe('bia', 'tela-bia', 'b')
      const pc = s.pcs[0]
      pc.stats.rows = [{ id: 'in', type: 'inbound-rtp', kind: 'video', framesDecoded: 0 }]
      let done = false
      const p = link.firstFrame('bia').then(() => (done = true))
      await vi.advanceTimersByTimeAsync(750)
      expect(done).toBe(false)
      pc.stats.rows = [{ id: 'in', type: 'inbound-rtp', kind: 'video', framesDecoded: 2 }]
      await vi.advanceTimersByTimeAsync(300)
      await p
      expect(done).toBe(true)
    })

    it('estoura o prazo se nenhum quadro chegar', async () => {
      const s = setup()
      link = s.link
      await link.subscribe('bia', 'tela-bia', 'b')
      const caught = link.firstFrame('bia', 1000).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(1500)
      expect(await caught).toMatchObject({ code: 'timeout' })
    })

    it('falha se a assinatura for fechada antes do primeiro quadro', async () => {
      const s = setup()
      link = s.link
      await link.subscribe('bia', 'tela-bia', 'b')
      const caught = link.firstFrame('bia').catch((e: unknown) => e)
      await link.unsubscribe('bia')
      await vi.advanceTimersByTimeAsync(500)
      expect(await caught).toMatchObject({ code: 'closed' })
    })
  })
})

describe('SfuLink: erros e falhas', () => {
  let link: SfuLink
  afterEach(() => link?.dispose())

  it('erro do servidor no pull rejeita sem derrubar a conexão e deixa o SDP estável', async () => {
    let first = true
    const s = setup({
      reply: (msg) => {
        if (msg.type === 'sfu-pull' && first) {
          first = false
          return { error: { code: 'not-allowed', message: 'Essa tela não está disponível para você.' } }
        }
        return undefined
      }
    })
    link = s.link
    const failures: SfuError[] = []
    link.onFailure((e) => failures.push(e))
    await expect(link.subscribe('bia', 's', 'b')).rejects.toMatchObject({ code: 'not-allowed' })
    expect(failures).toEqual([])
    expect(s.pcs[0].closed).toBe(false)
    await expect(link.subscribe('bia', 's', 'b')).resolves.toBeDefined()
  })

  it('erro ao publicar derruba a conexão (avisa onFailure) e a próxima operação usa uma nova', async () => {
    let fail = true
    const s = setup({
      reply: (msg) => {
        if (msg.type === 'sfu-push' && fail) {
          fail = false
          return { error: { code: 'budget', message: 'Acabou a cota.' } }
        }
        return undefined
      }
    })
    link = s.link
    const failures: SfuError[] = []
    link.onFailure((e) => failures.push(e))
    await expect(link.publish(screen(), ENCODINGS)).rejects.toMatchObject({ code: 'budget' })
    expect(failures).toHaveLength(1)
    expect(s.pcs[0].closed).toBe(true)
    expect(link.isPublished).toBe(false)
    await link.publish(screen(), ENCODINGS)
    expect(s.pcs).toHaveLength(2)
  })

  it('connectionState failed dispara onFailure e fecha a conexão', async () => {
    const s = setup()
    link = s.link
    const failures: SfuError[] = []
    link.onFailure((e) => failures.push(e))
    await link.subscribe('bia', 's', 'b')
    const pc = s.pcs[0]
    pc.connectionState = 'failed'
    pc.onconnectionstatechange?.()
    expect(failures.map((f) => f.code)).toEqual(['connection'])
    expect(pc.closed).toBe(true)
    expect(link.hasSubscription('bia')).toBe(false)
  })

  it('pedido sem resposta estoura o prazo e conta como falha', async () => {
    vi.useFakeTimers()
    try {
      const s = setup({ reply: () => 'mudo' })
      link = s.link
      const failures: SfuError[] = []
      link.onFailure((e) => failures.push(e))
      const caught = link.subscribe('bia', 's', 'b').catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await caught).toMatchObject({ code: 'timeout' })
      expect(failures).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('SfuLink: uso e envio', () => {
  let link: SfuLink
  afterEach(() => link?.dispose())

  it('manda o delta de bytes recebidos e só quando for maior que zero', async () => {
    const s = setup()
    link = s.link
    await link.subscribe('bia', 'tela-bia', 'b')
    s.sent.length = 0
    const pc = s.pcs[0]
    await link.flushUsage()
    expect(s.sent).toEqual([])
    pc.stats.rows = [
      { id: 'in-v', type: 'inbound-rtp', kind: 'video', bytesReceived: 4000 },
      { id: 'in-a', type: 'inbound-rtp', kind: 'audio', bytesReceived: 1000 }
    ]
    await link.flushUsage()
    expect(s.sent).toEqual([{ type: 'sfu-usage', bytes: 5000 }])
    await link.flushUsage()
    expect(s.sent).toHaveLength(1)
    pc.stats.rows[0] = { id: 'in-v', type: 'inbound-rtp', kind: 'video', bytesReceived: 6500 }
    await link.flushUsage()
    expect(s.sent.at(-1)).toEqual({ type: 'sfu-usage', bytes: 2500 })
  })

  it('a cada 30 s manda o uso sozinho', async () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      link = s.link
      await link.subscribe('bia', 'tela-bia', 'b')
      s.pcs[0].stats.rows = [{ id: 'in-v', type: 'inbound-rtp', kind: 'video', bytesReceived: 800 }]
      await vi.advanceTimersByTimeAsync(30_000)
      expect(s.sent.at(-1)).toEqual({ type: 'sfu-usage', bytes: 800 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('fechar a assinatura manda antes o que ainda não tinha sido contado', async () => {
    const s = setup()
    link = s.link
    await link.subscribe('bia', 'tela-bia', 'b')
    s.pcs[0].stats.rows = [{ id: 'in-v', type: 'inbound-rtp', kind: 'video', bytesReceived: 1234 }]
    await link.unsubscribe('bia')
    const usage = s.sent.findIndex((m) => m.type === 'sfu-usage')
    const close = s.sent.findIndex((m) => m.type === 'sfu-close')
    expect(usage).toBeGreaterThan(-1)
    expect(usage).toBeLessThan(close)
  })

  it('sendSample lê a camada a: limitação, perda e banda estimada', async () => {
    const s = setup()
    link = s.link
    expect(await link.sendSample()).toBeUndefined()
    await link.publish(screen(false), ENCODINGS)
    s.pcs[0].stats.rows = [
      { id: 'tr', type: 'transport', selectedCandidatePairId: 'cp' },
      { id: 'cp', type: 'candidate-pair', localCandidateId: 'l', remoteCandidateId: 'r', currentRoundTripTime: 0.03, availableOutgoingBitrate: 4_000_000 },
      { id: 'l', type: 'local-candidate', candidateType: 'host' },
      { id: 'r', type: 'remote-candidate', candidateType: 'host' },
      { id: 'o-a', type: 'outbound-rtp', kind: 'video', rid: 'a', bytesSent: 90_000, framesPerSecond: 28, qualityLimitationReason: 'bandwidth' },
      { id: 'o-b', type: 'outbound-rtp', kind: 'video', rid: 'b', bytesSent: 900_000, framesPerSecond: 30, qualityLimitationReason: 'none' },
      { id: 'ri', type: 'remote-inbound-rtp', localId: 'o-a', fractionLost: 0.02 }
    ]
    const sample = await link.sendSample()
    expect(sample).toMatchObject({ limitation: 'bandwidth', availableKbps: 4000, fps: 28, lossPct: 2 })
  })
})
