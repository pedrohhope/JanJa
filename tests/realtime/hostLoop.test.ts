import { describe, expect, it } from 'vitest'
import { EVENT_WINDOW_TICKS, HostLoop, MAX_QUEUE, STALE_TICKS } from '../../src/web/game/realtime/hostLoop'
import { toySim, toyState, TOY_TICK_MS, type ToyOut, type ToyTypes } from './toy'

function make(ids = ['a', 'b'], endTick = 1_000_000) {
  const outs: ToyOut[] = []
  const state = toyState(ids, endTick)
  const loop = new HostLoop<ToyTypes>(toySim, { state, epoch: 3 }, (m) => outs.push(m), 0)
  const applied: [number, number][] = []
  loop.onApply = (slot, seq) => applied.push([slot, seq])
  const snaps = () => outs.filter((o): o is Extract<ToyOut, { k: 'snap' }> => o.k === 'snap')
  return { loop, state, outs, applied, snaps }
}
const inp = (...seqs: number[]) => seqs.map((seq) => ({ seq, mx: 1 }))

describe('HostLoop a 60 Hz', () => {
  it('não deriva: 60 s em passos de 8 ms dão 3600 ticks', () => {
    const { loop, state } = make()
    for (let t = 8; t <= 60_000; t += 8) loop.advance(t)
    expect(Math.abs(state.tick - 3600)).toBeLessThanOrEqual(1)
  })

  it('não deriva: passos de exatamente 1000/60 ms não perdem tick por arredondamento', () => {
    const { loop, state } = make()
    let t = 0
    for (let i = 1; i <= 6000; i++) {
      t += TOY_TICK_MS
      loop.advance(t)
      expect(state.tick).toBe(i)
    }
  })

  it('passos irregulares (jitter do timer) somam o mesmo número de ticks', () => {
    const { loop, state } = make()
    let t = 0
    let n = 1
    while (t < 30_000) {
      n = (n * 48271) % 2147483647
      t += 3 + (n % 25)
      loop.advance(t)
    }
    expect(Math.abs(state.tick - Math.floor(t / TOY_TICK_MS))).toBeLessThanOrEqual(1)
  })

  it('catch-up: atraso curto roda os ticks devidos; atraso grande pula em vez de correr', () => {
    const { loop, state } = make()
    loop.advance(200)
    expect(state.tick).toBe(12) // 200 / 16,67
    const before = state.tick
    loop.advance(200 + 5000) // travou 5 s: um tick só
    expect(state.tick - before).toBeLessThanOrEqual(1)
  })

  it('fila: guarda só as últimas MAX_QUEUE entradas, na ordem', () => {
    const { loop, applied } = make()
    loop.handle({ k: 'input', slot: 0, inputs: inp(1, 2, 3, 4, 5, 6, 7) })
    loop.advance(TOY_TICK_MS * 10)
    expect(applied.map(([, s]) => s).slice(0, MAX_QUEUE)).toEqual([5, 6, 7])
  })

  it('redundância: entradas repetidas são descartadas, cada seq vale uma vez', () => {
    const { loop, applied } = make()
    loop.handle({ k: 'input', slot: 0, inputs: inp(1, 2, 3) })
    loop.handle({ k: 'input', slot: 0, inputs: inp(2, 3, 4) })
    loop.handle({ k: 'input', slot: 0, inputs: inp(1, 2, 3, 4, 5) })
    loop.advance(TOY_TICK_MS * 10)
    const seqs = applied.map(([, s]) => s)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(seqs[seqs.length - 1]).toBe(5)
  })

  it('entrada inválida ou de slot desconhecido é ignorada', () => {
    const { loop, applied } = make()
    loop.handle({ k: 'input', slot: 9, inputs: inp(1) })
    loop.handle({ k: 'input', slot: 0, inputs: [{ seq: -1, mx: 1 }, { seq: Number.NaN, mx: 1 }, null as never] })
    loop.advance(100)
    expect(applied).toEqual([])
  })

  it('stale: depois de STALE_TICKS sem entrada a sim recebe "solta tudo"', () => {
    const { loop, state } = make()
    loop.handle({ k: 'input', slot: 0, inputs: inp(1) })
    loop.advance(TOY_TICK_MS * 2)
    const p = state.players[0]
    const x1 = p.x
    expect(p.released).toBe(0)
    // perda curta: continua andando com a última entrada
    loop.advance(TOY_TICK_MS * (1 + STALE_TICKS))
    expect(p.x).toBeGreaterThan(x1)
    expect(p.released).toBe(0)
    // sumiu de vez
    loop.advance(TOY_TICK_MS * (2 + STALE_TICKS + 20))
    expect(p.released).toBeGreaterThan(0)
    const x2 = p.x
    loop.advance(TOY_TICK_MS * (2 + STALE_TICKS + 30))
    expect(p.x).toBe(x2) // parou
  })

  it('lag por ping: metade do ping em ticks, limitado por maxLagCompMs', () => {
    const { loop, state } = make()
    loop.handle({ k: 'ping', slot: 0, pingMs: 100 })
    loop.handle({ k: 'input', slot: 0, inputs: inp(1) })
    loop.advance(TOY_TICK_MS)
    expect(state.players[0].lagSum).toBe(3) // 100 / 2 / 16,67
    loop.handle({ k: 'ping', slot: 0, pingMs: 5000 })
    loop.handle({ k: 'input', slot: 0, inputs: inp(2) })
    loop.advance(TOY_TICK_MS * 2)
    expect(state.players[0].lagSum - 3).toBe(Math.ceil(toySim.maxLagCompMs / TOY_TICK_MS)) // 6
  })

  it('snapshot a cada snapshotEvery ticks, o primeiro e o de cada segundo são cheios', () => {
    const { loop, snaps } = make()
    for (let t = 1; t <= 2100; t++) loop.advance(t)
    const list = snaps()
    expect(list.length).toBeGreaterThan(55)
    expect(list.every((s) => s.snap.tick % 2 === 0 && s.snap.epoch === 3)).toBe(true)
    expect(list[0].snap.full).toBe(true)
    const fulls = list.slice(1).filter((s) => s.snap.full)
    expect(fulls.length).toBeGreaterThan(0)
    expect(fulls.every((s) => s.snap.tick % toySim.fullSnapshotEvery === 0)).toBe(true)
    expect(list.filter((s) => !s.snap.full).length).toBeGreaterThan(fulls.length)
    expect(list[0].bytes.byteLength).toBeGreaterThan(0)
  })

  it('janela de eventos: o evento vai repetido em snapshots seguidos e some depois', () => {
    const { loop, snaps } = make()
    for (let t = 1; t <= 700; t++) loop.advance(t)
    const withBeat1 = snaps().filter((s) => s.snap.events.some((e) => e.ev.type === 'beat' && e.ev.n === 1))
    expect(withBeat1.length).toBeGreaterThanOrEqual(2)
    expect(withBeat1.length).toBeLessThanOrEqual(Math.ceil(EVENT_WINDOW_TICKS / toySim.snapshotEvery) + 1)
  })

  it('fim da partida: score e result uma vez só, retrato final reenviado', () => {
    const { loop, outs, snaps } = make(['a', 'b'], 120)
    for (let t = 1; t <= 6000; t++) loop.advance(t)
    expect(outs.filter((o) => o.k === 'result')).toHaveLength(1)
    const res = outs.find((o) => o.k === 'result')!
    expect(res.epoch).toBe(3)
    const lastTick = 120
    expect(snaps().filter((s) => s.snap.tick === lastTick).length).toBeGreaterThan(1)
  })

  it('placar parcial a cada 5 s', () => {
    const { loop, outs } = make()
    for (let t = 1; t <= 16_000; t++) loop.advance(t)
    expect(outs.filter((o) => o.k === 'score').length).toBe(3)
  })

  it('jogador novo entra por add e fica away por away', () => {
    const { loop, state } = make(['a'])
    loop.handle({ k: 'add', ref: { slot: 5, id: 'z', bot: false } })
    loop.handle({ k: 'add', ref: { slot: 5, id: 'z', bot: false } })
    expect(state.players.filter((p) => p.slot === 5)).toHaveLength(1)
    loop.handle({ k: 'away', slot: 5, away: true })
    expect(state.players.find((p) => p.slot === 5)!.away).toBe(true)
    loop.handle({ k: 'stop' })
    const t = state.tick
    loop.advance(5000)
    expect(state.tick).toBe(t)
  })
})
