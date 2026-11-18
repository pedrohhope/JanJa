import { describe, expect, it } from 'vitest'
import {
  AUTO_LADDER,
  AUTO_START,
  AutoQuality,
  FLUIDEZ_LADDER,
  NITIDEZ_LADDER,
  autoLevelPreset,
  ladderFor,
  ladderOfPreset,
  type AutoSample
} from '../src/web/rtc/autoQuality'

const CAP = 5000
const good = (extra: Partial<AutoSample> = {}): AutoSample => ({ availableKbps: 6000, lossPct: 0, limitation: 'none', fps: 60, kbps: 4000, ...extra })
const lossy = (): AutoSample => good({ lossPct: 8 })

/** roda `n` ticks de 2 s a partir de `t`; devolve o último instante e as decisões */
function run(q: AutoQuality, n: number, t: number, s: AutoSample[], cap = CAP) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(q.tick(s, t, cap))
    t += 2000
  }
  return { t, out }
}

describe('qualidade automática', () => {
  it('escada e nível inicial (fluidez é o padrão: começa em 720p 60, não em 1080p 30)', () => {
    expect(AUTO_LADDER).toBe(FLUIDEZ_LADDER)
    expect(AUTO_LADDER).toHaveLength(5)
    expect(AUTO_LADDER[AUTO_START].id).toBe('720p60')
    expect(new AutoQuality().level).toBe(AUTO_START)
  })

  it('as duas escadas têm o mesmo tamanho e os mesmos extremos (índices compatíveis)', () => {
    expect(FLUIDEZ_LADDER.map((l) => l.id)).toEqual(['480p30', '720p30', '720p60', '1080p60', '1440p60'])
    expect(NITIDEZ_LADDER.map((l) => l.id)).toEqual(['480p30', '720p30', '1080p30', '1080p60', '1440p60'])
    expect(FLUIDEZ_LADDER.map((l) => l.bitrate)).toEqual([1_200_000, 2_500_000, 4_000_000, 9_000_000, 14_000_000])
    expect(NITIDEZ_LADDER.map((l) => l.bitrate)).toEqual([1_200_000, 2_500_000, 5_000_000, 9_000_000, 14_000_000])
    // nível 1 (limite do roteador) é 720p 30 nas duas
    expect(FLUIDEZ_LADDER[1]).toEqual(NITIDEZ_LADDER[1])
    expect(ladderFor()).toBe(FLUIDEZ_LADDER)
    expect(ladderFor('nitidez')).toBe(NITIDEZ_LADDER)
    expect(ladderOfPreset({ id: 'auto-nitidez' })).toBe(NITIDEZ_LADDER)
    expect(ladderOfPreset({ id: 'auto' })).toBe(FLUIDEZ_LADDER)
    expect(autoLevelPreset(3).id).toBe('auto')
    expect(autoLevelPreset(2, NITIDEZ_LADDER)).toMatchObject({ id: 'auto-nitidez', fps: 30, height: 1080 })
  })

  it('fluidez: de 1080p 60 desce para 720p 60 (nunca direto para 30 fps) e a rampa só passa para 30 fps na base', () => {
    const q = new AutoQuality({ start: 3 })
    const r = run(q, 6, 0, [good({ limitation: 'cpu' })])
    expect(r.out.find((d) => d.changed)).toMatchObject({ dir: 'down', level: 2 })
    expect(FLUIDEZ_LADDER[2].fps).toBe(60)
    // todo degrau a partir do 720p 60 mantém 60 fps
    expect(FLUIDEZ_LADDER.slice(2).every((l) => l.fps === 60)).toBe(true)
  })

  it('fps baixo no 1080p 60 (fluidez) cai para 720p 60, que ainda é 60 fps', () => {
    const q = new AutoQuality({ start: 3 })
    const { out } = run(q, 12, 0, [good({ fps: 30, limitation: 'other' })])
    const first = out.find((d) => d.changed)
    expect(first).toMatchObject({ dir: 'down', reason: 'fps', level: 2 })
    expect(q.levels[first!.level].fps).toBe(60)
  })

  it('nitidez continua igual: de 1080p 60 desce para 1080p 30', () => {
    const q = new AutoQuality({ start: 3, ladder: NITIDEZ_LADDER })
    const r = run(q, 6, 0, [good({ limitation: 'cpu' })])
    expect(r.out.find((d) => d.changed)).toMatchObject({ dir: 'down', level: 2 })
    expect(q.levels[2].id).toBe('1080p30')
    expect(new AutoQuality({ ladder: NITIDEZ_LADDER }).levels[AUTO_START].id).toBe('1080p30')
  })

  it('a regra de fps usa o fps do nível da escada em uso', () => {
    // o limite é 60% do fps do nível: 40 fps está ok no 720p 60 (36), 30 fps é baixo ali, mas ok no 1080p 30 da nitidez (18)
    const fluid = new AutoQuality({ start: 2 })
    expect(run(fluid, 12, 0, [good({ fps: 40, limitation: 'other' })]).out.some((d) => d.changed)).toBe(false)
    const fluid2 = new AutoQuality({ start: 2 })
    expect(run(fluid2, 12, 0, [good({ fps: 30, limitation: 'other' })]).out.some((d) => d.reason === 'fps')).toBe(true)
    const sharp = new AutoQuality({ start: 2, ladder: NITIDEZ_LADDER })
    expect(run(sharp, 12, 0, [good({ fps: 30, limitation: 'other' })]).out.some((d) => d.reason === 'fps')).toBe(false)
  })

  it('sobe gradualmente com banda sobrando (5 ticks bons por degrau) e para no máximo', () => {
    const q = new AutoQuality({ start: 0, maxLevel: 3 })
    let t = 0
    const seen: number[] = []
    for (let i = 0; i < 40; i++) {
      const d = q.tick([good()], t, CAP)
      if (d.changed) {
        expect(d.dir).toBe('up')
        expect(d.reason).toBe('folga')
        seen.push(d.level)
      }
      t += 2000
    }
    expect(seen).toEqual([1, 2, 3])
    expect(q.level).toBe(3)
  })

  it('o 5o tick bom sobe, o 4o não', () => {
    const q = new AutoQuality({ start: 1 })
    const { out } = run(q, 5, 0, [good()])
    expect(out.slice(0, 4).every((d) => !d.changed)).toBe(true)
    expect(out[4]).toMatchObject({ changed: true, dir: 'up', level: 2 })
  })

  it('desce com perda depois de 2 ticks ruins', () => {
    const q = new AutoQuality({ start: 2 })
    const { out } = run(q, 2, 0, [lossy()])
    expect(out[0].changed).toBe(false)
    expect(out[1]).toMatchObject({ changed: true, dir: 'down', reason: 'perda', level: 1 })
  })

  it('cpu desce mesmo com banda sobrando, e o motivo cpu vence perda', () => {
    const q = new AutoQuality({ start: 3 })
    const { out } = run(q, 2, 0, [good({ limitation: 'cpu', lossPct: 9 })])
    expect(out[1]).toMatchObject({ changed: true, dir: 'down', reason: 'cpu', level: 2 })
  })

  it('banda limitada com estimativa abaixo de 75% do teto desce; acima disso não', () => {
    const a = new AutoQuality({ start: 2 })
    // nos primeiros 10 s a estimativa ainda está subindo: não desce
    const early = run(a, 5, 0, [good({ limitation: 'bandwidth', availableKbps: 3000 })])
    expect(early.out.some((d) => d.changed)).toBe(false)
    // passada a carência, 2 leituras ruins descem
    expect(run(a, 2, early.t, [good({ limitation: 'bandwidth', availableKbps: 3000 })]).out[1]).toMatchObject({ dir: 'down', reason: 'banda' })
    const b = new AutoQuality({ start: 2 })
    expect(run(b, 6, 0, [good({ limitation: 'bandwidth', availableKbps: 4500 })]).out.some((d) => d.changed)).toBe(false)
  })

  it('fps baixo (culpa do processador) só conta depois de 10 s no nível', () => {
    const q = new AutoQuality({ start: 2 })
    const slow = [good({ fps: 10, limitation: 'other' })]
    for (const t of [0, 2000, 4000, 6000, 8000]) expect(q.tick(slow, t, CAP).changed).toBe(false)
    expect(q.tick(slow, 10_000, CAP).changed).toBe(false) // 1o tick ruim
    expect(q.tick(slow, 12_000, CAP)).toMatchObject({ changed: true, dir: 'down', reason: 'fps' })
  })

  it('perda e cpu descem mesmo dentro da carência', () => {
    expect(run(new AutoQuality({ start: 2 }), 2, 0, [lossy()]).out[1]).toMatchObject({ dir: 'down', reason: 'perda' })
    expect(run(new AutoQuality({ start: 2 }), 2, 0, [good({ limitation: 'cpu' })]).out[1]).toMatchObject({ dir: 'down', reason: 'cpu' })
  })

  it('subida não volta só porque a estimativa ainda não alcançou o teto novo', () => {
    const q = new AutoQuality({ start: 2 })
    const up = run(q, 5, 0, [good()])
    expect(up.out[4]).toMatchObject({ dir: 'up', level: 3 })
    // teto novo maior, estimativa atrasada por alguns segundos
    const lag = run(q, 4, up.t, [good({ limitation: 'bandwidth', availableKbps: 5000 })], 9000)
    expect(lag.out.some((d) => d.dir === 'down')).toBe(false)
  })

  it('tela parada (poucos quadros, sem limitação) não derruba a qualidade', () => {
    const q = new AutoQuality({ start: 2 })
    for (let t = 0; t <= 30_000; t += 2000) expect(q.tick([good({ fps: 2, kbps: 300 })], t, CAP).dir).not.toBe('down')
  })

  it('histerese: 1 tick ruim não desce, e ele zera a contagem de bons', () => {
    const q = new AutoQuality({ start: 2 })
    run(q, 1, 0, [good()])
    expect(q.tick([lossy()], 2000, CAP).changed).toBe(false)
    expect(q.tick([good()], 4000, CAP).changed).toBe(false)
    expect(q.tick([lossy()], 6000, CAP).changed).toBe(false)
    expect(q.level).toBe(2)
  })

  it('usa a pior conexão e ignora amostras vazias', () => {
    const q = new AutoQuality({ start: 2 })
    expect(q.tick([], 0, CAP)).toEqual({ level: 2, changed: false })
    const mix = [good(), lossy()]
    q.tick(mix, 2000, CAP)
    expect(q.tick(mix, 4000, CAP)).toMatchObject({ changed: true, dir: 'down' })
  })

  it('nunca desce abaixo de 0', () => {
    const q = new AutoQuality({ start: 0 })
    const { out } = run(q, 6, 0, [lossy()])
    expect(out.every((d) => !d.changed && d.level === 0)).toBe(true)
  })

  it('depois de descer, só sobe depois do backoff de 20 s', () => {
    const q = new AutoQuality({ start: 2 })
    let { t } = run(q, 2, 0, [lossy()]) // desce em t=2000, bloqueia até 22000
    expect(q.level).toBe(1)
    const ups: number[] = []
    for (let i = 0; i < 20; i++) {
      if (q.tick([good()], t, CAP).changed) ups.push(t)
      t += 2000
    }
    expect(ups[0]).toBeGreaterThanOrEqual(22000)
    expect(ups[0]).toBeLessThan(30000)
  })

  it('ping-pong dobra o backoff (20, 40, 80, 160) e zera depois de 120 s estável', () => {
    const q = new AutoQuality({ start: 2 })
    let t = 0
    run(q, 2, t, [lossy()]) // desce em t=2000 (sem subida antes: bloqueio de 20 s)
    let downAt = 2000
    t = 4000
    const waits: number[] = []
    for (let round = 0; round < 5; round++) {
      // espera a primeira subida possível
      for (;;) {
        const d = q.tick([good()], t, CAP)
        if (d.dir === 'up') break
        t += 2000
        expect(t - downAt).toBeLessThan(400_000)
      }
      waits.push(t - downAt)
      // cai logo depois da subida (dentro de 30 s)
      t += 2000
      q.tick([lossy()], t, CAP)
      t += 2000
      expect(q.tick([lossy()], t, CAP).dir).toBe('down')
      downAt = t
      t += 2000
    }
    expect(waits.map((w) => w >= 20_000)).toEqual([true, true, true, true, true])
    expect(waits[0]).toBeLessThan(30_000)
    expect(waits[1]).toBeGreaterThanOrEqual(40_000)
    expect(waits[1]).toBeLessThan(50_000)
    expect(waits[2]).toBeGreaterThanOrEqual(80_000)
    expect(waits[2]).toBeLessThan(90_000)
    expect(waits[3]).toBeGreaterThanOrEqual(160_000)
    expect(waits[3]).toBeLessThan(170_000)
    // esperar 160 s no mesmo nível passa dos 120 s estáveis: o backoff zera e a próxima queda dobra só de 20 para 40
    expect(waits[4]).toBeGreaterThanOrEqual(40_000)
    expect(waits[4]).toBeLessThan(50_000)
  })

  it('120 s estável zera o backoff para 20 s', () => {
    const q = new AutoQuality({ start: 3 })
    // ping-pong: sobe e cai de novo em menos de 30 s para dobrar o backoff
    let t = 0
    run(q, 2, t, [lossy()]) // 3 -> 2, bloqueio 20 s
    t = 4000
    while (q.tick([good()], t, CAP).dir !== 'up') t += 2000 // 2 -> 3
    t += 2000
    q.tick([lossy()], t, CAP)
    t += 2000
    expect(q.tick([lossy()], t, CAP).dir).toBe('down') // backoff 40 s
    const downAt = t
    // 130 s estável no nível de baixo, com um tick neutro (sem bons nem ruins) para marcar a estabilidade
    q.tick([good({ availableKbps: 1000 })], downAt + 130_000, CAP)
    // agora uma descida isolada deve bloquear só 20 s
    let u = downAt + 132_000
    while (q.tick([good()], u, CAP).dir !== 'up') u += 2000
    // essa subida foi há mais de 30 s da próxima queda: não dobra
    u += 40_000
    q.tick([lossy()], u, CAP)
    u += 2000
    expect(q.tick([lossy()], u, CAP).dir).toBe('down')
    const blockedFrom = u
    let free = -1
    let v = u + 2000
    for (let i = 0; i < 100 && free < 0; i++) {
      if (q.tick([good()], v, CAP).dir === 'up') free = v
      else v += 2000
    }
    expect(free - blockedFrom).toBeLessThan(30_000)
  })

  it('respeita maxLevel e baixa o nível se o teto cair', () => {
    const q = new AutoQuality({ start: 2, maxLevel: 3 })
    run(q, 60, 0, [good()])
    expect(q.level).toBe(3)
    q.setMaxLevel(1)
    expect(q.level).toBe(1)
    run(q, 60, 200_000, [good()])
    expect(q.level).toBe(1)
    expect(new AutoQuality({ start: 4, maxLevel: 3 }).level).toBe(3)
  })

  it('reset volta ao nível pedido', () => {
    const q = new AutoQuality({ start: 4 })
    q.reset()
    expect(q.level).toBe(AUTO_START)
    q.reset(0)
    expect(q.level).toBe(0)
  })

  it('sem estimativa de banda só sobe se o enlace carregou o teto inteiro', () => {
    const q = new AutoQuality({ start: 1 })
    const noEst = (kbps: number): AutoSample => ({ limitation: 'none', lossPct: 0, fps: 30, kbps })
    expect(run(q, 6, 0, [noEst(1000)]).out.some((d) => d.changed)).toBe(false)
    expect(run(q, 6, 20_000, [noEst(4800)]).out.some((d) => d.dir === 'up')).toBe(true)
  })
})
