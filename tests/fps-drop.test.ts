import { describe, expect, it } from 'vitest'
import {
  FPS_EVENT_GAP_MS,
  FpsDropTracker,
  classifyFpsDrop,
  dropText,
  encoderKind,
  isSoftwareEncoder,
  targetFromLabel,
  type RecvFpsInput,
  type SendFpsInput
} from '../src/web/rtc/fpsDrop'

const send = (o: Partial<SendFpsInput> = {}): SendFpsInput => ({
  side: 'send',
  target: 60,
  sentFps: 34,
  capturedFps: 59,
  kbps: 5000,
  limitation: 'none',
  hardware: true,
  ...o
})
const recv = (o: Partial<RecvFpsInput> = {}): RecvFpsInput => ({ side: 'recv', target: 60, recvFps: 34, kbps: 5000, droppedFps: 0, ...o })

describe('classifyFpsDrop (quem envia)', () => {
  it('captura já baixa vence tudo', () => {
    expect(classifyFpsDrop(send({ capturedFps: 33, limitation: 'cpu' }))).toBe('captura')
    expect(classifyFpsDrop(send({ capturedFps: 33, hardware: false }))).toBe('captura')
  })
  it('limitação de cpu com captura boa: cpu', () => {
    expect(classifyFpsDrop(send({ limitation: 'cpu' }))).toBe('cpu')
  })
  it('encoder por software com captura boa: cpu, mesmo sem o navegador culpar a cpu', () => {
    expect(classifyFpsDrop(send({ hardware: false, encoder: 'libvpx' }))).toBe('cpu')
    expect(classifyFpsDrop(send({ hardware: undefined, encoder: 'OpenH264' }))).toBe('cpu')
  })
  it('limitação de banda: banda (antes de olhar o encoder)', () => {
    expect(classifyFpsDrop(send({ limitation: 'bandwidth' }))).toBe('banda')
    expect(classifyFpsDrop(send({ limitation: 'bandwidth', hardware: false }))).toBe('banda')
  })
  it('sem pista (hardware, captura boa, sem limitação): não adivinha', () => {
    expect(classifyFpsDrop(send())).toBeUndefined()
    expect(classifyFpsDrop(send({ limitation: 'other' }))).toBeUndefined()
  })
  it('sem leitura de captura (Firefox) segue pelas outras pistas', () => {
    expect(classifyFpsDrop(send({ capturedFps: undefined, limitation: 'cpu' }))).toBe('cpu')
  })
})

describe('classifyFpsDrop (quem assiste)', () => {
  it('descartando quadros: quem-assiste; sem descarte, não é com quem assiste', () => {
    expect(classifyFpsDrop(recv({ droppedFps: 12 }))).toBe('quem-assiste')
    expect(classifyFpsDrop(recv({ droppedFps: 0 }))).toBeUndefined()
    expect(classifyFpsDrop(recv({ droppedFps: 2 }))).toBeUndefined() // 2 de 60 é pouco
    expect(classifyFpsDrop(recv({ droppedFps: undefined }))).toBeUndefined()
  })
})

describe('encoder', () => {
  it('software, hardware ou desconhecido', () => {
    expect(isSoftwareEncoder('x', false)).toBe(true)
    expect(isSoftwareEncoder('x', true)).toBe(false)
    expect(isSoftwareEncoder('libvpx', undefined)).toBe(true)
    expect(isSoftwareEncoder('ExternalEncoder', undefined)).toBeUndefined()
    expect(isSoftwareEncoder(undefined, undefined)).toBeUndefined()
    expect(encoderKind('NVENC', true)).toBe('hardware')
    expect(encoderKind('libvpx', false)).toBe('software')
    expect(encoderKind(undefined, undefined)).toBeUndefined()
  })
})

describe('targetFromLabel', () => {
  it('pega o fps do fim do rótulo do nível', () => {
    expect(targetFromLabel('1080p 60')).toBe(60)
    expect(targetFromLabel('720p 30')).toBe(30)
    expect(targetFromLabel(undefined)).toBeUndefined()
    expect(targetFromLabel('automático')).toBeUndefined()
  })
})

describe('textos do diário', () => {
  it('uma frase por causa, com o fps e o alvo', () => {
    expect(dropText('captura', 34, 60)).toBe(
      'Fps caiu para 34 (alvo 60): a captura do Windows está entregando poucos quadros. Jogo em tela cheia exclusiva não captura bem: use janela sem borda.'
    )
    expect(dropText('cpu', 34.4, 60, true)).toBe('Fps caiu para 34 (alvo 60): encoder por software (sem aceleração de hardware): ative a aceleração de hardware do navegador.')
    expect(dropText('cpu', 34, 60)).toContain('o PC está no limite para codificar')
    expect(dropText('banda', 34, 60)).toBe('Fps caiu para 34 (alvo 60): a rede apertou; a resolução vai cair para manter o fps.')
    expect(dropText('quem-assiste', 34, 60)).toBe('Fps caiu para 34 (alvo 60): o PC de quem assiste está descartando quadros.')
  })
})

describe('FpsDropTracker', () => {
  it('só avisa depois de mais de 3 s seguidos abaixo de 75% do alvo', () => {
    const t = new FpsDropTracker()
    const i = send({ limitation: 'cpu' })
    expect(t.update(i, 0)).toBeUndefined()
    expect(t.update(i, 2000)).toBeUndefined()
    expect(t.update(i, 3000)).toBeUndefined() // exatamente 3 s ainda não é "mais de 3 s"
    const ev = t.update(i, 4000)
    expect(ev).toMatchObject({ cause: 'cpu', kind: 'cpu', fps: 34, target: 60 })
    expect(ev?.text).toContain('Fps caiu para 34 (alvo 60)')
  })

  it('exatamente 75% do alvo não é queda', () => {
    const t = new FpsDropTracker()
    for (let now = 0; now <= 10_000; now += 1000) expect(t.update(send({ sentFps: 45, limitation: 'cpu' }), now)).toBeUndefined()
  })

  it('recuperou no meio: a contagem recomeça', () => {
    const t = new FpsDropTracker()
    const low = send({ limitation: 'cpu' })
    t.update(low, 0)
    t.update(low, 2500)
    t.update(send({ sentFps: 60 }), 3000)
    expect(t.update(low, 3500)).toBeUndefined()
    expect(t.update(low, 6000)).toBeUndefined()
    expect(t.update(low, 7000)).toBeDefined()
  })

  it('um aviso por episódio: a queda que continua não repete', () => {
    const t = new FpsDropTracker()
    const low = send({ limitation: 'bandwidth' })
    let n = 0
    for (let now = 0; now <= 120_000; now += 2000) if (t.update(low, now)) n++
    expect(n).toBe(1)
  })

  it('episódio novo só 20 s depois do último aviso', () => {
    const t = new FpsDropTracker()
    const low = send({ limitation: 'cpu' })
    const ok = send({ sentFps: 60 })
    expect(t.update(low, 0)).toBeUndefined()
    expect(t.update(low, 4000)).toBeDefined() // aviso em 4 s
    t.update(ok, 5000)
    // nova queda que passa de 3 s mas ainda dentro dos 20 s
    t.update(low, 6000)
    expect(t.update(low, 10_000)).toBeUndefined()
    expect(t.update(low, 4000 + FPS_EVENT_GAP_MS - 1)).toBeUndefined()
    expect(t.update(low, 4000 + FPS_EVENT_GAP_MS)).toBeDefined()
  })

  it('tela parada (quase sem taxa) não é queda', () => {
    const t = new FpsDropTracker()
    const idle = send({ capturedFps: 2, sentFps: 2, kbps: 20 })
    for (let now = 0; now <= 20_000; now += 1000) expect(t.update(idle, now)).toBeUndefined()
  })

  it('sem causa conhecida não avisa, mas a causa que aparece depois vale no mesmo episódio', () => {
    const t = new FpsDropTracker()
    for (let now = 0; now <= 10_000; now += 1000) expect(t.update(send(), now)).toBeUndefined()
    expect(t.update(send({ limitation: 'cpu' }), 11_000)).toMatchObject({ cause: 'cpu' })
  })

  it('sem leitura reinicia a contagem', () => {
    const t = new FpsDropTracker()
    t.update(send({ limitation: 'cpu' }), 0)
    t.update(undefined, 2000)
    expect(t.update(send({ limitation: 'cpu' }), 4000)).toBeUndefined()
    expect(t.update(send({ limitation: 'cpu' }), 8000)).toBeDefined()
  })

  it('lado de quem assiste: avisa quando o PC dele descarta quadros', () => {
    const t = new FpsDropTracker()
    t.update(recv({ droppedFps: 15 }), 0)
    expect(t.update(recv({ droppedFps: 15 }), 3500)).toMatchObject({ cause: 'quem-assiste', kind: 'travada' })
    expect(new FpsDropTracker().update(recv({ droppedFps: 0 }), 0)).toBeUndefined()
  })

  it('reset esquece tudo', () => {
    const t = new FpsDropTracker()
    const low = send({ limitation: 'cpu' })
    t.update(low, 0)
    expect(t.update(low, 4000)).toBeDefined()
    t.reset()
    t.update(low, 5000)
    expect(t.update(low, 9000)).toBeDefined() // sem esperar os 20 s
  })
})
