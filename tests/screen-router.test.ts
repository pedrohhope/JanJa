import { describe, expect, it } from 'vitest'
import type { PeerState } from '../src/shared/protocol'
import type { BudgetState, Rid, RoutePref } from '../src/shared/sfu'
import type { AutoSample } from '../src/web/rtc/autoQuality'
import type { DiagKind } from '../src/web/rtc/diag'
import { sendEncodings } from '../src/web/rtc/layers'
import { FAILURE_COOLDOWN_MS } from '../src/web/rtc/route'
import {
  HANDOVER_MS,
  LAYER_DEBOUNCE_MS,
  LEAVE_MS,
  RETRY_MS,
  ScreenRouter,
  reasonText,
  type Clock,
  type RouterLink,
  type RouterManager
} from '../src/web/rtc/ScreenRouter'

// ---------------- relógio falso ----------------

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

class FakeClock implements Clock {
  t = 1_000
  private seq = 0
  private items: Array<{ id: number; at: number; fn: () => void; every?: number }> = []

  now(): number {
    return this.t
  }
  wait(ms: number): Promise<void> {
    return new Promise((r) => void this.timeout(r, ms))
  }
  timeout(cb: () => void, ms: number): () => void {
    const id = ++this.seq
    this.items.push({ id, at: this.t + ms, fn: cb })
    return () => {
      this.items = this.items.filter((i) => i.id !== id)
    }
  }
  interval(cb: () => void, ms: number): () => void {
    const id = ++this.seq
    this.items.push({ id, at: this.t + ms, fn: cb, every: ms })
    return () => {
      this.items = this.items.filter((i) => i.id !== id)
    }
  }
  async advance(ms: number): Promise<void> {
    const end = this.t + ms
    for (;;) {
      const due = this.items.filter((i) => i.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.t = due.at
      if (due.every) due.at += due.every
      else this.items = this.items.filter((i) => i.id !== due.id)
      due.fn()
      await flush()
    }
    this.t = end
    await flush()
  }
}

// ---------------- link e PeerManager falsos ----------------

const stream = (id: string, video = true): MediaStream =>
  ({ id, getVideoTracks: () => (video ? [{ id: `${id}-v` }] : []), getAudioTracks: () => [] }) as unknown as MediaStream

class FakeLink implements RouterLink {
  failOnPublish?: Error
  /** firstFrame só resolve quando o teste mandar */
  holdFrames = false
  private frames = new Map<string, { resolve: () => void; reject: (e: Error) => void }>()
  private failure?: (e: Error) => void
  sample?: AutoSample
  readonly sfuStreams = new Map<string, MediaStream>()
  constructor(private readonly events: string[]) {}

  async publish(_s: MediaStream, encodings: RTCRtpEncodingParameters[]): Promise<Rid[]> {
    this.events.push('publish')
    if (this.failOnPublish) throw this.failOnPublish
    return encodings.map((e) => e.rid as Rid)
  }
  async setEncodings(encodings: RTCRtpEncodingParameters[]): Promise<void> {
    this.events.push(`setEncodings:${encodings.map((e) => e.rid).join('')}`)
  }
  async unpublish(): Promise<void> {
    this.events.push('unpublish')
  }
  async subscribe(from: string, streamId: string, rid: Rid): Promise<MediaStream> {
    this.events.push(`subscribe:${from}:${rid}`)
    const s = stream(`sfu-${streamId}`)
    this.sfuStreams.set(from, s)
    return s
  }
  firstFrame(from: string): Promise<void> {
    this.events.push(`firstFrame:${from}`)
    if (!this.holdFrames) return Promise.resolve()
    return new Promise((resolve, reject) => this.frames.set(from, { resolve, reject }))
  }
  frame(from: string): void {
    this.frames.get(from)?.resolve()
  }
  frameFails(from: string): void {
    this.frames.get(from)?.reject(new Error('sem quadro'))
  }
  async setLayer(from: string, rid: Rid): Promise<void> {
    this.events.push(`setLayer:${from}:${rid}`)
  }
  async unsubscribe(from: string): Promise<void> {
    this.events.push(`unsubscribe:${from}`)
  }
  async sendSample(): Promise<AutoSample | undefined> {
    this.events.push('sendSample')
    return this.sample
  }
  reset(): void {
    this.events.push('reset')
  }
  onFailure(cb: (e: Error) => void): () => void {
    this.failure = cb
    return () => (this.failure = undefined)
  }
  fail(err = new Error('caiu')): void {
    this.failure?.(err)
  }
}

interface FakeView {
  id: string
  name: string
  state: PeerState
  screen?: MediaStream
}

class FakeManager implements RouterManager {
  screen: MediaStream | undefined
  viewers = 0
  limited = 0
  level: number | undefined = 1
  key = '1080|1080|30|5000000'
  top = { capturedHeight: 1080, top: { height: 1080, fps: 30, bitrate: 5_000_000 } }
  peers: FakeView[] = []
  readonly logs: Array<{ kind: DiagKind; text: string }> = []
  readonly log = { push: (e: { kind: DiagKind; text: string }) => void this.logs.push(e) }
  sfuTicks: Array<AutoSample | undefined> = []
  constructor(private readonly events: string[]) {}

  screenViewers(): number {
    return this.viewers
  }
  screenLimitedMs(): number {
    return this.limited
  }
  captureLevel(): number | undefined {
    return this.level
  }
  setScreenMesh(enabled: boolean): void {
    this.events.push(`mesh:${enabled}`)
  }
  tickSfu(sample: AutoSample | undefined): boolean {
    this.sfuTicks.push(sample)
    return false
  }
  sfuTopParams() {
    return this.top
  }
  sfuKey(): string {
    return this.key
  }
  views(): FakeView[] {
    return this.peers
  }
}

function make(pref: RoutePref = 'auto') {
  const clock = new FakeClock()
  const events: string[] = []
  const link = new FakeLink(events)
  const manager = new FakeManager(events)
  const sfu = { enabled: true, budget: 'ok' as BudgetState }
  const prefs = { value: pref }
  let changes = 0
  const router = new ScreenRouter({
    link,
    manager,
    clock,
    getSfu: () => sfu,
    getPref: () => prefs.value,
    publishState: (p) => events.push(`state:${p.screenRoute}`),
    onChange: () => void changes++
  })
  return { clock, events, link, manager, sfu, prefs, router, changes: () => changes }
}

const sharing = (m: FakeManager, id = 'tela-eu'): MediaStream => (m.screen = stream(id))

// ---------------- quem compartilha ----------------

describe('ScreenRouter: mesh para sfu', () => {
  it('monta antes de desmontar: publica, avisa, espera 6 s e só então tira da malha', async () => {
    const { clock, events, manager, router } = make()
    sharing(manager)
    manager.viewers = 3
    const p = router.tick()
    await flush()
    expect(events).toEqual(['publish', 'state:sfu'])
    expect(router.currentRoute).toBe('mesh')
    await clock.advance(HANDOVER_MS - 1)
    expect(events).toEqual(['publish', 'state:sfu'])
    await clock.advance(1)
    await p
    expect(events).toEqual(['publish', 'state:sfu', 'mesh:false'])
    expect(router.currentRoute).toBe('sfu')
    expect(manager.logs).toEqual([{ kind: 'info', text: 'Tela passou pelo servidor da Cloudflare: 3 pessoas assistindo' }])
  })

  it('publica com as camadas calculadas da captura e do nível', async () => {
    const { clock, events, manager, router } = make()
    sharing(manager)
    manager.viewers = 4
    manager.top = { capturedHeight: 1080, top: { height: 1080, fps: 30, bitrate: 5_000_000 } }
    const encs = sendEncodings(1080, manager.top.top)
    expect(encs.map((e) => e.rid)).toEqual(['a', 'b', 'c'])
    const p = router.tick()
    await flush()
    await clock.advance(HANDOVER_MS)
    await p
    expect(events[0]).toBe('publish')
  })

  it('2 pessoas assistindo sem limite ficam na malha', async () => {
    const { events, manager, router } = make()
    sharing(manager)
    manager.viewers = 2
    await router.tick()
    expect(events).toEqual([])
    expect(router.currentRoute).toBe('mesh')
  })

  it('preferência "sempre pelo servidor" troca mesmo com 1 pessoa, e o texto é o da preferência', async () => {
    const { clock, manager, router, prefs } = make('sfu')
    sharing(manager)
    manager.viewers = 1
    prefs.value = 'sfu'
    const p = router.tick()
    await flush()
    await clock.advance(HANDOVER_MS)
    await p
    expect(router.currentRoute).toBe('sfu')
    expect(manager.logs[0].text).toBe('Rota da tela trocada por você')
  })

  it('servidor não configurado: nunca troca', async () => {
    const { events, manager, router, sfu } = make('sfu')
    sfu.enabled = false
    sharing(manager)
    manager.viewers = 5
    await router.tick()
    expect(events).toEqual([])
  })

  it('cota esgotada: nunca troca', async () => {
    const { events, manager, router, sfu } = make()
    sfu.budget = 'esgotado'
    sharing(manager)
    manager.viewers = 5
    await router.tick()
    expect(events).toEqual([])
  })
})

describe('ScreenRouter: sfu para mesh', () => {
  async function inSfu() {
    const t = make()
    sharing(t.manager)
    t.manager.viewers = 3
    const p = t.router.tick()
    await flush()
    await t.clock.advance(HANDOVER_MS)
    await p
    t.events.length = 0
    t.manager.logs.length = 0
    return t
  }

  it('religa a malha, avisa, espera 6 s e só então solta o servidor', async () => {
    const { clock, events, manager, router, prefs } = await inSfu()
    prefs.value = 'mesh'
    const p = router.tick()
    await flush()
    // no servidor o tick também lê o envio para o automático
    expect(events.filter((e) => e !== 'sendSample')).toEqual(['mesh:true', 'state:mesh'])
    expect(router.currentRoute).toBe('mesh')
    await clock.advance(HANDOVER_MS - 1)
    expect(events).not.toContain('unpublish')
    await clock.advance(1)
    await p
    expect(events.filter((e) => e !== 'sendSample')).toEqual(['mesh:true', 'state:mesh', 'unpublish'])
    expect(manager.logs.map((l) => l.text)).toEqual(['Rota da tela trocada por você'])
  })

  it('volta para a malha depois de 1 minuto com 1 pessoa (e pelo menos 2 minutos no servidor)', async () => {
    const { clock, events, manager, router } = await inSfu()
    manager.viewers = 1
    await router.tick() // começa a contar
    await clock.advance(61_000)
    const p = router.tick()
    await flush()
    expect(events).not.toContain('mesh:true') // ainda não passaram os 2 minutos mínimos no servidor
    await clock.advance(120_000)
    const q = router.tick()
    await flush()
    await clock.advance(HANDOVER_MS)
    await Promise.all([p, q])
    expect(events).toContain('mesh:true')
    expect(manager.logs.at(-1)?.text).toBe('Tela voltou para conexão direta: só 1 pessoa assistindo')
  })

  it('no servidor o automático é alimentado pela leitura de envio e as camadas seguem o nível', async () => {
    const { events, manager, router, link } = await inSfu()
    link.sample = { limitation: 'none', fps: 30, kbps: 4000, availableKbps: 9000, lossPct: 0 }
    await router.tick()
    expect(manager.sfuTicks.at(-1)).toBe(link.sample)
    // mesma chave: não reaplica
    expect(events.some((e) => e.startsWith('setEncodings'))).toBe(false)
    manager.key = '720|720|30|2500000'
    manager.top = { capturedHeight: 720, top: { height: 720, fps: 30, bitrate: 2_500_000 } }
    await router.tick()
    // 720p capturado: a camada b (720) sai, ficam a e c
    expect(events.filter((e) => e.startsWith('setEncodings'))).toEqual(['setEncodings:ac'])
  })

  it('parou de compartilhar: solta o servidor', async () => {
    const { events, manager, router } = await inSfu()
    manager.screen = undefined
    await router.tick()
    expect(events).toContain('unpublish')
    expect(router.currentRoute).toBe('mesh')
  })

  it('começou outra tela sem passar por "parou": solta a antiga e recomeça na malha', async () => {
    const { events, manager, router } = await inSfu()
    manager.screen = stream('tela-nova')
    manager.viewers = 1
    await router.tick()
    expect(events).toContain('unpublish')
    expect(router.currentRoute).toBe('mesh')
  })
})

describe('ScreenRouter: falha do SFU', () => {
  it('erro ao publicar: continua na malha, guarda a falha e respeita o cooldown', async () => {
    const { clock, events, link, manager, router } = make()
    sharing(manager)
    manager.viewers = 3
    link.failOnPublish = new Error('cota')
    await router.tick()
    expect(events).toEqual(['publish', 'mesh:true', 'reset'])
    expect(manager.logs.at(-1)).toEqual({ kind: 'down', text: 'O servidor da Cloudflare falhou; a tela voltou para a conexão direta' })
    expect(router.currentRoute).toBe('mesh')

    // dentro do cooldown não tenta de novo
    events.length = 0
    await clock.advance(FAILURE_COOLDOWN_MS - 1000)
    await router.tick()
    expect(events).toEqual([])

    // passado o cooldown, tenta
    link.failOnPublish = undefined
    await clock.advance(1001)
    const p = router.tick()
    await flush()
    await clock.advance(HANDOVER_MS)
    await p
    expect(events).toEqual(['publish', 'state:sfu', 'mesh:false'])
  })

  it('erro depois de avisar "sfu" (durante a espera) volta para a malha e avisa a sala', async () => {
    const { clock, events, link, manager, router } = make()
    sharing(manager)
    manager.viewers = 3
    const p = router.tick()
    await flush()
    expect(events).toEqual(['publish', 'state:sfu'])
    link.fail()
    await clock.advance(HANDOVER_MS)
    await p
    expect(events).toEqual(['publish', 'state:sfu', 'mesh:true', 'state:mesh', 'reset'])
    expect(events).not.toContain('mesh:false')
    expect(router.currentRoute).toBe('mesh')
  })

  it('queda da conexão com a tela já no servidor: volta para a malha na hora', async () => {
    const { clock, events, link, manager, router } = make()
    sharing(manager)
    manager.viewers = 3
    const p = router.tick()
    await flush()
    await clock.advance(HANDOVER_MS)
    await p
    events.length = 0
    link.fail()
    expect(events).toEqual(['mesh:true', 'state:mesh', 'reset'])
    expect(router.currentRoute).toBe('mesh')
    expect(manager.logs.at(-1)?.text).toContain('falhou')
  })
})

// ---------------- quem assiste ----------------

const bia = (state: Partial<PeerState> = {}, screen?: MediaStream): FakeView => ({
  id: 'bia',
  name: 'Bia',
  state: { sharing: true, micMuted: true, screenRoute: 'sfu', screenStreamId: 's-bia', ...state },
  screen
})

describe('ScreenRouter: quem assiste', () => {
  it('assina com a camada b antes de saber o tamanho e só troca o stream depois do primeiro quadro', async () => {
    const { events, link, manager, router } = make()
    link.holdFrames = true
    const mesh = stream('mesh-bia')
    manager.peers = [bia({}, mesh)]
    await router.tick()
    await flush()
    expect(events).toEqual(['subscribe:bia:b', 'firstFrame:bia'])
    expect(router.overrides().size).toBe(0)
    link.frame('bia')
    await flush()
    expect(router.overrides().get('bia')).toBe(link.sfuStreams.get('bia'))
    expect(manager.logs.at(-1)).toEqual({ kind: 'info', who: 'Bia', text: 'Recebendo a tela de Bia pelo servidor da Cloudflare' })
  })

  it('usa o tamanho já conhecido para escolher a camada da assinatura', async () => {
    const { events, manager, router } = make()
    router.reportSize('bia', 1920, 1080)
    manager.peers = [bia()]
    await router.tick()
    await flush()
    expect(events[0]).toBe('subscribe:bia:a')
  })

  it('rota dela volta para a malha: mostra a malha assim que ela tiver vídeo e larga a assinatura', async () => {
    const { clock, events, link, manager, router } = make()
    manager.peers = [bia({}, stream('mesh-vazia', false))]
    await router.tick()
    await flush()
    expect(router.overrides().has('bia')).toBe(true)
    events.length = 0

    // a rota volta para a malha, mas ela ainda não chegou
    manager.peers = [bia({ screenRoute: 'mesh' }, stream('mesh-vazia', false))]
    router.update()
    await flush()
    expect(router.overrides().has('bia')).toBe(true)
    expect(events).toEqual([])

    // a malha chegou com vídeo
    manager.peers = [bia({ screenRoute: 'mesh' }, stream('mesh-bia'))]
    router.update()
    await flush()
    expect(router.overrides().has('bia')).toBe(false)
    expect(events).toEqual(['unsubscribe:bia'])
    expect(link.sfuStreams.has('bia')).toBe(true)
    await clock.advance(LEAVE_MS * 2)
    expect(events).toEqual(['unsubscribe:bia'])
  })

  it('se a malha não chegar em 6 s, larga a assinatura mesmo assim', async () => {
    const { clock, events, manager, router } = make()
    manager.peers = [bia({}, stream('mesh-vazia', false))]
    await router.tick()
    await flush()
    events.length = 0
    manager.peers = [bia({ screenRoute: 'mesh' }, stream('mesh-vazia', false))]
    router.update()
    await clock.advance(LEAVE_MS - 1)
    expect(events).toEqual([])
    await clock.advance(1)
    expect(events).toEqual(['unsubscribe:bia'])
    expect(router.overrides().has('bia')).toBe(false)
  })

  it('parou de compartilhar, saiu do canal ou da sala: larga na hora', async () => {
    const { events, manager, router } = make()
    manager.peers = [bia()]
    await router.tick()
    await flush()
    events.length = 0
    manager.peers = [bia({ sharing: false, screenRoute: undefined, screenStreamId: undefined })]
    router.update()
    expect(events).toEqual(['unsubscribe:bia'])
    expect(router.overrides().size).toBe(0)

    manager.peers = [bia()]
    router.update()
    await flush()
    events.length = 0
    manager.peers = [] // saiu
    router.update()
    expect(events).toEqual(['unsubscribe:bia'])
  })

  it('tela nova da mesma pessoa (outro streamId): troca a assinatura', async () => {
    const { events, manager, router } = make()
    manager.peers = [bia()]
    await router.tick()
    await flush()
    events.length = 0
    manager.peers = [bia({ screenStreamId: 's-bia-2' })]
    router.update()
    await flush()
    expect(events).toEqual(['unsubscribe:bia', 'subscribe:bia:b', 'firstFrame:bia'])
  })

  it('primeiro quadro que não chega: não mostra, larga e tenta de novo depois do intervalo', async () => {
    const { clock, events, link, manager, router } = make()
    link.holdFrames = true
    manager.peers = [bia({}, stream('mesh-bia'))]
    await router.tick()
    await flush()
    link.frameFails('bia')
    await flush()
    expect(router.overrides().size).toBe(0)
    expect(events).toContain('unsubscribe:bia')
    events.length = 0
    await clock.advance(RETRY_MS - 1)
    await router.tick()
    await flush()
    expect(events).toEqual([])
    await clock.advance(1)
    await router.tick()
    await flush()
    expect(events).toEqual(['subscribe:bia:b', 'firstFrame:bia'])
  })

  it('queda da conexão com o SFU: volta a mostrar a malha e reassina depois do intervalo', async () => {
    const { clock, events, link, manager, router } = make()
    manager.peers = [bia({}, stream('mesh-bia'))]
    await router.tick()
    await flush()
    expect(router.overrides().size).toBe(1)
    events.length = 0
    link.fail()
    expect(router.overrides().size).toBe(0)
    await router.tick()
    await flush()
    expect(events).toEqual([])
    await clock.advance(RETRY_MS)
    await router.tick()
    await flush()
    expect(events[0]).toBe('subscribe:bia:b')
  })

  it('cota esgotada: tratam como saída do servidor (mostra a malha)', async () => {
    const { events, manager, router, sfu } = make()
    manager.peers = [bia({}, stream('mesh-bia'))]
    await router.tick()
    await flush()
    events.length = 0
    sfu.budget = 'esgotado'
    router.update()
    await flush()
    expect(events).toEqual(['unsubscribe:bia'])
  })
})

describe('ScreenRouter: camada pelo tamanho do vídeo', () => {
  async function watching() {
    const t = make()
    t.manager.peers = [bia({}, stream('mesh-bia'))]
    await t.router.tick()
    await flush()
    t.events.length = 0
    return t
  }

  it('só pede a troca depois de 1,5 s e só se a camada mudou', async () => {
    const { clock, events, router } = await watching()
    router.reportSize('bia', 1920, 1080)
    await clock.advance(LAYER_DEBOUNCE_MS - 1)
    expect(events).toEqual([])
    await clock.advance(1)
    expect(events).toEqual(['setLayer:bia:a'])
    events.length = 0

    // vários tamanhos seguidos: vale o último, uma troca só
    router.reportSize('bia', 900, 500)
    await clock.advance(500)
    router.reportSize('bia', 320, 180)
    await clock.advance(1000)
    expect(events).toEqual([])
    await clock.advance(500)
    expect(events).toEqual(['setLayer:bia:c'])
    events.length = 0

    // outro tamanho que dá a mesma camada: nada
    router.reportSize('bia', 340, 190)
    await clock.advance(LAYER_DEBOUNCE_MS * 2)
    expect(events).toEqual([])
  })

  it('ignora tamanho zero (tile escondido)', async () => {
    const { clock, events, router } = await watching()
    router.reportSize('bia', 0, 0)
    await clock.advance(LAYER_DEBOUNCE_MS * 2)
    expect(events).toEqual([])
  })

  it('cota em economia: a camada a vira b', async () => {
    const { clock, events, router, sfu } = await watching()
    router.reportSize('bia', 1920, 1080)
    await clock.advance(LAYER_DEBOUNCE_MS)
    expect(events).toEqual(['setLayer:bia:a'])
    events.length = 0
    sfu.budget = 'economia'
    router.onBudget()
    await clock.advance(LAYER_DEBOUNCE_MS)
    expect(events).toContain('setLayer:bia:b')
  })

  it('tamanho que chega enquanto assina é aplicado quando o primeiro quadro chega', async () => {
    const t = make()
    t.link.holdFrames = true
    t.manager.peers = [bia({}, stream('mesh-bia'))]
    await t.router.tick()
    await flush()
    t.router.reportSize('bia', 1920, 1080)
    await t.clock.advance(LAYER_DEBOUNCE_MS * 2)
    expect(t.events.some((e) => e.startsWith('setLayer'))).toBe(false)
    t.link.frame('bia')
    await flush()
    expect(t.events).toContain('setLayer:bia:a')
  })
})

describe('textos do diário', () => {
  it('seguem o combinado', () => {
    expect(reasonText('muitos', 3)).toBe('Tela passou pelo servidor da Cloudflare: 3 pessoas assistindo')
    expect(reasonText('limitado', 2)).toBe('Tela passou pelo servidor da Cloudflare: envio no limite')
    expect(reasonText('poucos', 1)).toBe('Tela voltou para conexão direta: só 1 pessoa assistindo')
    expect(reasonText('poucos', 0)).toBe('Tela voltou para conexão direta: ninguém assistindo')
    expect(reasonText('orcamento', 1)).toBe('Servidor desligado: cota do mês quase no fim')
    expect(reasonText('preferencia', 1)).toBe('Rota da tela trocada por você')
    expect(reasonText('falha', 0)).toBe('O servidor da Cloudflare falhou; a tela voltou para a conexão direta')
  })
})
