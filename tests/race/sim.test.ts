import { describe, expect, it } from 'vitest'
import { cloneState, createRace, drive, predictSelf, progress, ranking, scores, setAway, addPlayer, standings, step } from '../../src/shared/games/race/sim'
import { gridSpot, TRACKS } from '../../src/shared/games/race/tracks'
import { BOT_SLOT_BASE, BTN_BRAKE, BTN_GAS, COUNTDOWN_TICKS, MAX_SPEED, OFFROAD_MAX, TICK_MS, type Car, type RaceInput, type RaceSimEvent, type RaceSimState } from '../../src/shared/games/race/types'

const human = (slot: number) => ({ slot, id: `p${slot}`, bot: false })
const bot = (i: number) => ({ slot: BOT_SLOT_BASE + i, id: `bot-${i + 1}`, bot: true })

function run(s: RaceSimState, ticks: number, input: (s: RaceSimState, seq: number) => Map<number, RaceInput> = () => new Map()): RaceSimEvent[] {
  const evs: RaceSimEvent[] = []
  for (let i = 0; i < ticks && s.phase !== 'fim'; i++) evs.push(...step(s, input(s, s.tick + 1)))
  return evs
}

const gas = (slot: number, steer = 0) => (_s: RaceSimState, seq: number) => new Map([[slot, { seq, steer, buttons: BTN_GAS }]])

describe('simulação da corrida', () => {
  it('segura todo mundo na contagem e larga no tick certo', () => {
    const s = createRace([human(0), bot(0)], { trackId: 'sala', laps: 3, botLevel: 'medio' })
    const x0 = s.cars.map((c) => c.x)
    const evs = run(s, COUNTDOWN_TICKS - 1, gas(0))
    expect(s.phase).toBe('contagem')
    expect(s.cars.map((c) => c.x)).toEqual(x0)
    expect(evs).toEqual([])
    const go = run(s, 1, gas(0))
    expect(go[0]).toEqual({ type: 'go' })
    expect(s.phase).toBe('correndo')
  })

  it('robôs largam na frente e gente de verdade atrás', () => {
    const s = createRace([human(0), human(1), bot(0), bot(1)], { trackId: 'sala', laps: 3, botLevel: 'medio' })
    const t = TRACKS.sala
    const at = (i: number) => gridSpot(t, i)
    expect(s.cars.find((c) => c.slot === BOT_SLOT_BASE)!.x).toBeCloseTo(at(0).x)
    expect(s.cars.find((c) => c.slot === 0)!.x).toBeCloseTo(at(2).x)
  })

  it('acelera até a máxima na reta e anda mais devagar fora da pista', () => {
    const t = TRACKS.sala
    const car = createRace([human(0)], { trackId: 'sala', laps: 3, botLevel: 'medio' }).cars[0]!
    let top = 0
    for (let i = 0; i < 90; i++) {
      drive(t, car, 0, BTN_GAS, 1000 + i)
      top = Math.max(top, Math.hypot(car.vx, car.vy))
    }
    expect(top).toBeGreaterThan(MAX_SPEED * 0.95)
    expect(top).toBeLessThanOrEqual(MAX_SPEED + 1e-9)
    // fora da pista (bem do lado da reta)
    const w = t.wps[0]!
    const off: Car = { ...car, x: w.x + 100, y: w.y + t.def.road * 16 + 8, vx: 0, vy: 0, hx: 1, hy: 0, boostUntil: 0 }
    let offTop = 0
    for (let i = 0; i < 90; i++) {
      drive(t, off, 0, BTN_GAS, 2000 + i)
      offTop = Math.max(offTop, Math.hypot(off.vx, off.vy))
    }
    expect(offTop).toBeLessThan(OFFROAD_MAX + 0.01)
  })

  it('freia, dá ré e vira para o lado do volante', () => {
    const t = TRACKS.sala
    const car = createRace([human(0)], { trackId: 'sala', laps: 3, botLevel: 'medio' }).cars[0]!
    for (let i = 0; i < 30; i++) drive(t, car, 0, BTN_GAS, 1000 + i)
    const v0 = car.vx * car.hx + car.vy * car.hy
    drive(t, car, 0, BTN_BRAKE, 1100)
    expect(car.vx * car.hx + car.vy * car.hy).toBeLessThan(v0)
    for (let i = 0; i < 60; i++) drive(t, car, 0, BTN_BRAKE, 1200 + i)
    expect(car.vx * car.hx + car.vy * car.hy).toBeLessThan(0)
    // a largada da sala aponta para a direita (+x): volante para a direita gira para baixo (+y)
    const c2 = createRace([human(0)], { trackId: 'sala', laps: 3, botLevel: 'medio' }).cars[0]!
    for (let i = 0; i < 30; i++) drive(t, c2, 1, BTN_GAS, 1000 + i)
    expect(c2.hy).toBeGreaterThan(0.2)
  })

  it('bate no muro, volta um pouco e nunca entra nele', () => {
    const t = TRACKS.sala
    const car = createRace([human(0)], { trackId: 'sala', laps: 3, botLevel: 'medio' }).cars[0]!
    // aponta para baixo (o muro de fora da reta) e acelera
    car.hx = 0
    car.hy = 1
    let hit = 0
    for (let i = 0; i < 120; i++) hit = Math.max(hit, drive(t, car, 0, BTN_GAS, 1000 + i).wall)
    expect(hit).toBeGreaterThan(0.5)
    expect(Math.hypot(car.vx, car.vy)).toBeLessThan(2)
  })

  it('conta as voltas, avisa a última e termina na chegada', () => {
    const s = createRace([human(0)], { trackId: 'sala', laps: 2, botLevel: 'medio' })
    s.cars[0]!.bot = true // o piloto automático leva o carro
    const evs = run(s, 60 * 120)
    const voltas = evs.filter((e) => e.type === 'volta')
    expect(voltas.map((e) => e.type === 'volta' && e.lap)).toEqual([2])
    const fim = evs.filter((e) => e.type === 'chegada')
    expect(fim).toHaveLength(1)
    expect(s.phase).toBe('fim')
    const sc = scores(s)[0]!
    expect(sc.place).toBe(1)
    expect(sc.laps).toBe(2)
    expect(sc.timeMs).toBeGreaterThan(5000)
    expect(sc.bestLapMs).toBeGreaterThan(5000)
    expect(sc.bestLapMs).toBeLessThan(sc.timeMs)
  })

  it('não conta volta andando para trás pela largada', () => {
    const s = createRace([human(0)], { trackId: 'sala', laps: 3, botLevel: 'medio' })
    run(s, COUNTDOWN_TICKS + 60, gas(0))
    const c = s.cars[0]!
    expect(c.lap).toBe(1)
    // ré até passar de volta pela linha, e de novo para a frente
    run(s, 200, (_s, seq) => new Map([[0, { seq, steer: 0, buttons: BTN_BRAKE }]]))
    run(s, 120, gas(0))
    expect(c.lap).toBe(1)
  })

  it('a corrida acaba quando todos chegam, com a ordem certa', () => {
    const s = createRace([bot(0), bot(1), bot(2)], { trackId: 'quintal', laps: 2, botLevel: 'dificil' })
    run(s, 60 * 200)
    expect(s.phase).toBe('fim')
    const r = ranking(s)
    expect(r.map((l) => l.place)).toEqual([1, 2, 3])
    for (let i = 1; i < r.length; i++) expect(r[i]!.timeMs).toBeGreaterThanOrEqual(r[i - 1]!.timeMs)
    expect(standings(s)[0]!.id).toBe(r[0]!.id)
  })

  it('depois que o primeiro chega, os outros têm um prazo', () => {
    const s = createRace([human(0), bot(0)], { trackId: 'sala', laps: 2, botLevel: 'dificil' })
    run(s, 60 * 200) // o humano fica parado
    expect(s.phase).toBe('fim')
    const r = ranking(s)
    expect(r[0]!.id).toBe('bot-1')
    expect(r[1]).toMatchObject({ id: 'p0', place: 0 })
    expect(s.endTick - s.firstFinish).toBe(25 * 60)
  })

  it('predictSelf anda igual ao step quando o carro está sozinho', () => {
    const s = createRace([human(0)], { trackId: 'quintal', laps: 3, botLevel: 'medio' })
    const p = cloneState(s)
    let seq = 0
    for (let i = 0; i < 600; i++) {
      seq++
      const input = { seq, steer: Math.sin(i / 40) * 0.8, buttons: i % 90 < 70 ? BTN_GAS : BTN_BRAKE }
      step(s, new Map([[0, input]]))
      predictSelf(p, 0, input)
      p.tick++
      expect(p.cars[0]!.x).toBe(s.cars[0]!.x)
      expect(p.cars[0]!.y).toBe(s.cars[0]!.y)
    }
    expect(p.cars[0]!.lastSeq).toBe(seq)
  })

  it('repete a última entrada se a próxima atrasar e para quem sai', () => {
    const s = createRace([human(0)], { trackId: 'sala', laps: 3, botLevel: 'medio' })
    run(s, COUNTDOWN_TICKS + 1, gas(0))
    const x = s.cars[0]!.x
    run(s, 20) // sem entrada: repete o gás
    expect(s.cars[0]!.x).toBeGreaterThan(x + 10)
    setAway(s, 0, true)
    const x2 = s.cars[0]!.x
    run(s, 20, gas(0))
    expect(s.cars[0]!.x).toBe(x2)
  })

  it('quem entra no meio larga do grid e entra na classificação', () => {
    const s = createRace([human(0), bot(0)], { trackId: 'sala', laps: 3, botLevel: 'medio' })
    run(s, COUNTDOWN_TICKS + 300)
    addPlayer(s, human(3))
    expect(s.cars.map((c) => c.slot)).toEqual([0, 3, BOT_SLOT_BASE])
    expect(progress(s, s.cars.find((c) => c.slot === 3)!)).toBeLessThan(0.01)
    expect(scores(s)).toHaveLength(3)
  })

  it('é determinística', () => {
    const go = () => {
      const s = createRace([bot(0), bot(1), bot(2), bot(3)], { trackId: 'sala', laps: 2, botLevel: 'medio' })
      run(s, 60 * 40)
      return JSON.stringify(s)
    }
    expect(go()).toBe(go())
  })

  it('o tempo do placar sai em ms', () => {
    const s = createRace([bot(0)], { trackId: 'sala', laps: 1, botLevel: 'dificil' })
    run(s, 60 * 100)
    const l = scores(s)[0]!
    expect(l.timeMs).toBe(Math.round((s.cars[0]!.finishTick - s.goTick) * TICK_MS))
  })
})
