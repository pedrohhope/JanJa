import { describe, expect, it } from 'vitest'
import { decodePacket, decodeSnapshot, encodeHello, encodeInput, encodePing, encodeSnapshot, fromBase64, MAX_PACKET_BYTES, quantizeInput, restoreState, snapshotFromState, toBase64, type RaceTimedEvent } from '../../src/shared/games/race/codec'
import { createRace, step } from '../../src/shared/games/race/sim'
import { BOT_SLOT_BASE, BTN_GAS, MAX_BOTS, MAX_HUMANS } from '../../src/shared/games/race/types'

function busyRace() {
  const refs = [
    ...Array.from({ length: MAX_HUMANS }, (_, i) => ({ slot: i, id: `pessoa-com-id-comprido-${i}`, bot: false })),
    ...Array.from({ length: MAX_BOTS }, (_, i) => ({ slot: BOT_SLOT_BASE + i, id: `bot-${i + 1}`, bot: true }))
  ]
  const s = createRace(refs, { trackId: 'quintal', laps: 5, botLevel: 'dificil' })
  for (let i = 0; i < 900; i++) step(s, new Map(refs.filter((r) => !r.bot).map((r) => [r.slot, { seq: i + 1, steer: (r.slot % 3) - 1, buttons: BTN_GAS }])))
  return s
}

describe('codec da corrida', () => {
  it('retrato cheio vai e volta (com eventos e ids) e cabe no repasse', () => {
    const s = busyRace()
    const events: RaceTimedEvent[] = [
      { tick: 10, ev: { type: 'go' } },
      { tick: 11, ev: { type: 'volta', slot: 3, lap: 2, ticks: 700, best: true } },
      { tick: 12, ev: { type: 'chegada', slot: 9, place: 1, ticks: 9000 } },
      { tick: 13, ev: { type: 'batida', slot: 1, force: 3 } },
      { tick: 14, ev: { type: 'toque', a: 1, b: 2 } },
      { tick: 15, ev: { type: 'turbo', slot: 8 } },
      { tick: 16, ev: { type: 'fim' } }
    ]
    const snap = snapshotFromState(s, events, { epoch: 3, full: true })
    const bytes = encodeSnapshot(snap)
    expect(bytes.byteLength).toBeLessThan(MAX_PACKET_BYTES)
    const back = decodeSnapshot(bytes)!
    expect(back.events).toEqual(events)
    expect(back.statics).toEqual(snap.statics)
    expect(back.tick).toBe(s.tick)
    expect(back.cars).toHaveLength(13)
    const st = restoreState(back)
    for (const c of s.cars) {
      const r = st.cars.find((x) => x.slot === c.slot)!
      expect(r.id).toBe(c.id)
      expect(Math.abs(r.x - c.x)).toBeLessThanOrEqual(1 / 16)
      expect(Math.abs(r.vx - c.vx)).toBeLessThanOrEqual(1 / 256)
      expect(Math.hypot(r.hx, r.hy)).toBeCloseTo(1, 9)
      expect(r.lap).toBe(c.lap)
      expect(r.next).toBe(c.next)
      expect(r.lastSeq).toBe(c.lastSeq)
    }
    // o comum não leva ids
    const thin = decodeSnapshot(encodeSnapshot(snapshotFromState(s, [], { epoch: 3, full: false })))!
    expect(thin.statics).toBeNull()
  })

  it('entradas, hello e ping', () => {
    const inputs = [
      { seq: 7, steer: -1, buttons: 3 },
      { seq: 8, steer: 0.333, buttons: 1 }
    ]
    const p = decodePacket(encodeInput(2, 5, inputs))
    expect(p).toEqual({ t: 'input', epoch: 2, slot: 5, inputs: inputs.map(quantizeInput) })
    expect(decodePacket(encodeHello('fulano', 4, true))).toEqual({ t: 'hello', playerId: 'fulano', epoch: 4, reply: true })
    expect(decodePacket(encodePing(99, true))).toEqual({ t: 'pong', n: 99 })
    expect(quantizeInput({ seq: 1, steer: 5, buttons: 255 })).toEqual({ seq: 1, steer: 1, buttons: 3 })
  })

  it('pacote estranho vira null sem lançar', () => {
    const good = new Uint8Array(encodeSnapshot(snapshotFromState(busyRace(), [], { epoch: 1, full: true })))
    for (let n = 0; n < good.length; n += 7) expect(() => decodePacket(good.slice(0, n))).not.toThrow()
    expect(decodePacket(good.slice(0, good.length - 1))).toBeNull()
    expect(decodePacket(new Uint8Array([5, 9, 0, 0]))).toBeNull()
    expect(decodePacket(new Uint8Array([2, 1, 0, 0, 0, 0]))).toBeNull()
    expect(fromBase64('###')).toBeNull()
    expect(new Uint8Array(fromBase64(toBase64(good))!)).toEqual(good)
  })
})
