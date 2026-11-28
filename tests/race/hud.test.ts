import { describe, expect, it } from 'vitest'
import { createRace, step } from '../../src/shared/games/race/sim'
import { BOT_SLOT_BASE, BTN_BRAKE, BTN_GAS } from '../../src/shared/games/race/types'
import { countdownOf, formatTime, lineText, raceColors, raceCue, raceTrack, standingRows, wrongWay } from '../../src/web/game/race/hudLogic'
import { composeInput, padToInput, rampSteer } from '../../src/web/game/race/scene/input'
import { CAR_ROWS, CAR_BOX, dirIndex, rotateRows } from '../../src/web/game/race/scene/art'

describe('HUD da corrida', () => {
  it('tempo em segundos com décimo, e minutos quando passa de 60', () => {
    expect(formatTime(0)).toBe('0,0')
    expect(formatTime(12_345)).toBe('12,3')
    expect(formatTime(62_400)).toBe('1:02,4')
    expect(lineText({ id: 'a', place: 0, laps: 1, timeMs: 0, bestLapMs: 0 })).toBe('1 volta')
    expect(lineText({ id: 'a', place: 2, laps: 3, timeMs: 61_000, bestLapMs: 0 })).toBe('1:01,0')
  })

  it('contagem, classificação e contramão', () => {
    const s = createRace([{ slot: 0, id: 'eu', bot: false }, { slot: BOT_SLOT_BASE, id: 'bot-1', bot: true }], { trackId: 'sala', laps: 3, botLevel: 'medio' })
    expect(countdownOf(s)).toBe(3)
    for (let i = 0; i < 260; i++) step(s, new Map([[0, { seq: i + 1, steer: 0, buttons: BTN_GAS }]]))
    expect(countdownOf(s)).toBe(0)
    const rows = standingRows(s)
    expect(rows.map((r) => r.place)).toEqual([1, 2])
    expect(rows.every((r) => r.lap === 1)).toBe(true)
    expect(wrongWay(s, 0)).toBe(false)
    const me = s.cars.find((c) => c.slot === 0)!
    me.vx = -2
    me.vy = 0
    expect(wrongWay(s, 0)).toBe(true)
  })

  it('cores: gente pela cor do apelido, robôs com a sua', () => {
    const c = raceColors(
      [
        { id: 'a', name: 'Ana', slot: 0, bot: false, present: true },
        { id: 'b', name: 'Robô 1', slot: BOT_SLOT_BASE, bot: true, present: true }
      ],
      () => '#123456'
    )
    expect(c[0]).toBe('#123456')
    expect(c[BOT_SLOT_BASE]).toMatch(/^#[0-9A-F]{6}$/i)
    expect(c[BOT_SLOT_BASE]).not.toBe('#123456')
  })

  it('música e sons', () => {
    expect(raceTrack('contagem', 0, 3)).toBe('tensao')
    expect(raceTrack('correndo', 2, 3)).toBe('tiroteio')
    expect(raceTrack('correndo', 3, 3)).toBe('final')
    expect(raceTrack('fim', 3, 3)).toBe('vitoria')
    expect(raceCue({ type: 'volta', slot: 0, lap: 3, ticks: 600, best: false }, 0, 3)?.name).toBe('corrida-ultima')
    expect(raceCue({ type: 'volta', slot: 1, lap: 2, ticks: 600, best: false }, 0, 3)).toBeNull()
    expect(raceCue({ type: 'batida', slot: 1, force: 3 }, 0, 3)?.volume).toBeLessThan(0.3)
  })
})

describe('entrada da corrida', () => {
  it('o volante do teclado vira em alguns ticks e volta sozinho', () => {
    let s = 0
    const seen: number[] = []
    for (let i = 0; i < 6; i++) seen.push((s = rampSteer(s, 1)))
    expect(seen[0]).toBeGreaterThan(0)
    expect(seen[0]).toBeLessThan(0.5)
    expect(seen.at(-1)).toBe(1)
    for (let i = 0; i < 4; i++) s = rampSteer(s, 0)
    expect(s).toBe(0)
    expect(rampSteer(0.6, -1)).toBeLessThan(0)
  })

  it('controle: zona morta, gatilhos e direcional', () => {
    const pad = (axes: number[], pressed: number[] = []) => ({ axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) })
    expect(padToInput(pad([0.1, 0])).steer).toBe(0)
    expect(padToInput(pad([1, 0])).steer).toBe(1)
    expect(padToInput(pad([0, 0], [7])).buttons).toBe(BTN_GAS)
    expect(padToInput(pad([0, 0], [6])).buttons).toBe(BTN_BRAKE)
    expect(padToInput(pad([0, 0], [14])).steer).toBe(-1)
  })

  it('toque ganha do teclado no volante; botões somam', () => {
    const i = composeInput({ keys: new Set(['KeyW']), keySteer: 1, pad: null, touch: new Set(['esquerda', 'frear']) }, 9)
    expect(i).toEqual({ seq: 9, steer: -1, buttons: BTN_GAS | BTN_BRAKE })
  })
})

describe('arte do carrinho', () => {
  it('gira sem perder a forma e acha a direção certa', () => {
    const right = rotateRows(CAR_ROWS, 0)
    expect(right).toHaveLength(CAR_BOX)
    const count = (rows: string[]) => rows.join('').replace(/\./g, '').length
    const base = count(right)
    expect(base).toBe(CAR_ROWS.join('').replace(/\./g, '').length)
    expect(Math.abs(count(rotateRows(CAR_ROWS, Math.PI / 2)) - base)).toBeLessThanOrEqual(4)
    expect(dirIndex(1, 0)).toBe(0)
    expect(dirIndex(0, 1)).toBe(8)
    expect(dirIndex(-1, 0)).toBe(16)
  })
})
