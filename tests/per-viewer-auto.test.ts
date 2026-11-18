import { describe, expect, it } from 'vitest'
import { AUTO_START, NITIDEZ_LADDER, type AutoSample } from '../src/web/rtc/autoQuality'
import { CPU_RECOVER_MS, PerViewerAuto, Streak, viewerSendParams } from '../src/web/rtc/perViewerAuto'

const CAP = 5000
const good = (extra: Partial<AutoSample> = {}): AutoSample => ({ availableKbps: 6000, lossPct: 0, limitation: 'none', fps: 60, kbps: 4000, ...extra })
const lossy = (): AutoSample => good({ lossPct: 8 })
const cpu = (): AutoSample => good({ limitation: 'cpu' })

/** roda `n` ticks de 2 s; `pick(id)` devolve a amostra de cada peer */
function run(pv: PerViewerAuto, n: number, t: number, pick: (id: string) => AutoSample) {
  const all = []
  for (let i = 0; i < n; i++) {
    const m = new Map(pv.ids().map((id) => [id, pick(id)]))
    all.push(pv.tick(m, t, () => CAP))
    t += 2000
  }
  return { t, all }
}

describe('qualidade automática por espectador', () => {
  it('um peer ruim não derruba os outros', () => {
    const pv = new PerViewerAuto()
    pv.add('bia')
    pv.add('caio')
    const { all } = run(pv, 4, 0, (id) => (id === 'bia' ? lossy() : good()))
    expect(pv.level('bia')).toBeLessThan(AUTO_START)
    expect(pv.level('caio')).toBe(AUTO_START)
    const ch = all.flatMap((r) => r.changes)
    expect(ch.every((c) => c.id === 'bia' && c.dir === 'down' && c.reason === 'perda')).toBe(true)
    // a captura continua no maior nível
    expect(pv.captureLevel()).toBe(AUTO_START)
    expect(all.every((r) => !r.captureChanged)).toBe(true)
  })

  it('a captura acompanha o maior nível e cai quando o maior sai', () => {
    const pv = new PerViewerAuto()
    pv.add('a')
    pv.add('b')
    run(pv, 4, 0, (id) => (id === 'a' ? lossy() : good())) // a desce
    expect(pv.captureLevel()).toBe(pv.level('b'))
    pv.remove('b')
    expect(pv.captureLevel()).toBe(pv.level('a'))
    const last = pv.level('a')
    pv.remove('a')
    // sem ninguém, guarda o último nível
    expect(pv.captureLevel()).toBe(last)
  })

  it('captureChanged avisa quando o maior nível muda', () => {
    const pv = new PerViewerAuto()
    pv.add('a')
    const { all } = run(pv, 2, 0, () => lossy())
    expect(all[1].captureChanged).toBe(true)
    expect(all[1].captureLevel).toBe(AUTO_START - 1)
  })

  it('peer novo começa em min(captura, AUTO_START)', () => {
    const pv = new PerViewerAuto()
    pv.add('a')
    run(pv, 4, 0, () => lossy())
    run(pv, 4, 10_000, () => lossy())
    expect(pv.captureLevel()).toBe(0)
    pv.add('novo')
    expect(pv.level('novo')).toBe(0)

    const alto = new PerViewerAuto({ maxLevel: 4 })
    alto.add('x')
    // sobe até o teto
    let t = 0
    for (let i = 0; i < 80; i++) {
      alto.tick(new Map([['x', good()]]), t, () => CAP)
      t += 2000
    }
    expect(alto.level('x')).toBe(4)
    alto.add('y')
    expect(alto.level('y')).toBe(AUTO_START)
  })

  it('CPU baixa o teto de todos', () => {
    const pv = new PerViewerAuto({ maxLevel: 3 })
    pv.add('a')
    pv.add('b')
    let t = run(pv, 12, 0, () => good()).t
    expect(pv.level('a')).toBe(3)
    expect(pv.level('b')).toBe(3)
    // CPU só aparece na amostra de 'a', mas vale para todos
    const r = run(pv, 2, t, (id) => (id === 'a' ? cpu() : good()))
    expect(pv.level('a')).toBe(2)
    expect(pv.level('b')).toBe(2)
    expect(pv.ceiling).toBe(2)
    const down = r.all.flatMap((x) => x.changes)
    expect(down.map((c) => c.id).sort()).toEqual(['a', 'b'])
    expect(down.every((c) => c.reason === 'cpu')).toBe(true)
    // b não volta a passar do teto mesmo com banda sobrando
    t = run(pv, 30, r.t, () => good()).t
    expect(pv.level('b')).toBeLessThanOrEqual(2)
  })

  it('CPU limitada recente segura o teto: ele só sobe 120 s depois da última', () => {
    const pv = new PerViewerAuto({ maxLevel: 3 })
    pv.add('a')
    let t = run(pv, 12, 0, () => good()).t
    t = run(pv, 2, t, () => cpu()).t
    expect(pv.ceiling).toBe(2)
    const lastCpu = t
    pv.tick(new Map([['a', cpu()]]), lastCpu + 60_000, () => CAP)
    pv.tick(new Map([['a', good()]]), lastCpu + 60_000 + CPU_RECOVER_MS - 1, () => CAP)
    expect(pv.ceiling).toBeLessThanOrEqual(2)
    pv.tick(new Map([['a', good()]]), lastCpu + 60_000 + CPU_RECOVER_MS, () => CAP)
    expect(pv.ceiling).toBe(3)
  })

  it('o teto sobe +1 por 120 s e para no teto da tela', () => {
    const pv = new PerViewerAuto({ maxLevel: 3 })
    pv.add('a')
    let t = 0
    t = run(pv, 12, t, () => good()).t
    expect(pv.level('a')).toBe(3)
    // dois rebaixamentos por CPU: teto vai para 1
    t = run(pv, 2, t, () => cpu()).t
    t = run(pv, 2, t + 12_000, () => cpu()).t
    expect(pv.ceiling).toBe(1)
    const t0 = t
    pv.tick(new Map([['a', good()]]), t0 + CPU_RECOVER_MS, () => CAP)
    expect(pv.ceiling).toBe(2)
    pv.tick(new Map([['a', good()]]), t0 + CPU_RECOVER_MS + 1000, () => CAP)
    expect(pv.ceiling).toBe(2)
    pv.tick(new Map([['a', good()]]), t0 + 2 * CPU_RECOVER_MS, () => CAP)
    expect(pv.ceiling).toBe(3)
    pv.tick(new Map([['a', good()]]), t0 + 4 * CPU_RECOVER_MS, () => CAP)
    expect(pv.ceiling).toBe(3)
  })

  it('setMaxLevel (tela nativa) também limita todos', () => {
    const pv = new PerViewerAuto({ maxLevel: 4 })
    pv.add('a')
    pv.setMaxLevel(1)
    expect(pv.level('a')).toBe(1)
    expect(pv.ceiling).toBe(1)
  })

  it('clear zera tudo', () => {
    const pv = new PerViewerAuto()
    pv.add('a')
    pv.clear()
    expect(pv.size).toBe(0)
    expect(pv.captureLevel()).toBe(AUTO_START)
  })
})

describe('parâmetros do sender por espectador', () => {
  it('scaleResolutionDownBy = altura capturada / altura do nível (mínimo 1)', () => {
    const cap = { width: 1920, height: 1080 }
    expect(viewerSendParams(3, 1, cap).scaleResolutionDownBy).toBe(1) // 1080p (fluidez: nível 3)
    expect(viewerSendParams(2, 1, cap).scaleResolutionDownBy).toBe(1.5) // 720p 60 (fluidez: nível 2)
    expect(viewerSendParams(2, 1, cap, NITIDEZ_LADDER).scaleResolutionDownBy).toBe(1) // 1080p 30 (nitidez: nível 2)
    expect(viewerSendParams(1, 1, cap).scaleResolutionDownBy).toBe(1.5) // 720p
    expect(viewerSendParams(0, 1, cap).scaleResolutionDownBy).toBe(2.25) // 480p
    expect(viewerSendParams(4, 1, cap).scaleResolutionDownBy).toBe(1) // nível acima da captura
    expect(viewerSendParams(1, 1).scaleResolutionDownBy).toBe(1) // tamanho desconhecido
  })

  it('bitrate e fps vêm do nível e do número de espectadores', () => {
    const cap = { width: 1920, height: 1080 }
    const p = viewerSendParams(1, 3, cap)
    expect(p.maxFramerate).toBe(30)
    expect(p.maxBitrate).toBe(Math.round(2_500_000 * 0.65))
    expect(viewerSendParams(3, 1, cap).maxFramerate).toBe(60)
    expect(viewerSendParams(3, 1, cap).maxBitrate).toBe(9_000_000)
    // nitidez: o nível 2 é 1080p 30 a 5 Mbps
    expect(viewerSendParams(2, 1, cap, NITIDEZ_LADDER)).toMatchObject({ maxFramerate: 30, maxBitrate: 5_000_000 })
    expect(viewerSendParams(2, 1, cap)).toMatchObject({ maxFramerate: 60, maxBitrate: 4_000_000 })
    // nível menor gasta menos
    expect(viewerSendParams(0, 2, cap).maxBitrate).toBeLessThan(viewerSendParams(2, 2, cap).maxBitrate)
  })
})

describe('degradationPreference do sender', () => {
  it('60 fps mantém o fps, 30 fps equilibra', () => {
    const cap = { width: 1920, height: 1080 }
    expect(viewerSendParams(3, 1, cap).degradationPreference).toBe('maintain-framerate')
    expect(viewerSendParams(2, 1, cap).degradationPreference).toBe('maintain-framerate')
    expect(viewerSendParams(1, 1, cap).degradationPreference).toBe('balanced')
    expect(viewerSendParams(2, 1, cap, NITIDEZ_LADDER).degradationPreference).toBe('balanced')
    expect(viewerSendParams(3, 1, cap, NITIDEZ_LADDER).degradationPreference).toBe('maintain-framerate')
  })
})

describe('escada por espectador', () => {
  it('a escada vai para cada AutoQuality e o padrão é a fluidez', () => {
    expect(new PerViewerAuto().ladder[AUTO_START].id).toBe('720p60')
    const pv = new PerViewerAuto({ ladder: NITIDEZ_LADDER })
    expect(pv.ladder[AUTO_START].id).toBe('1080p30')
    pv.add('a')
    // fps baixo sem folga: na nitidez o 1080p 30 só desce para 720p 30
    let t = 0
    for (let i = 0; i < 12; i++, t += 2000) pv.tick(new Map([['a', good({ limitation: 'cpu' })]]), t, () => CAP)
    expect(pv.level('a')).toBeLessThan(AUTO_START)
  })
})

describe('Streak', () => {
  it('conta há quanto tempo seguido e zera ao parar', () => {
    const s = new Streak()
    expect(s.ms(1000)).toBe(0)
    s.update(true, 1000)
    s.update(true, 3000)
    expect(s.ms(5000)).toBe(4000)
    s.update(false, 6000)
    expect(s.ms(7000)).toBe(0)
    s.update(true, 8000)
    expect(s.ms(9000)).toBe(1000)
  })
})
