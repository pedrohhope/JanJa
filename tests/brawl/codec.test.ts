import { describe, expect, it } from 'vitest'
import {
  MAX_PACKET_BYTES,
  decodeHello,
  decodeInput,
  decodeInputs,
  decodePacket,
  decodePing,
  decodeSnapshot,
  encodeHello,
  encodeInput,
  encodeInputs,
  encodePing,
  encodeSnapshot,
  fromBase64,
  mergeStatics,
  packetType,
  quantizeInput,
  restoreState,
  snapshotFromState,
  toBase64,
  type BrawlTimedEvent
} from '../../src/shared/games/brawl/codec'
import { RELAY_MAX_DATA } from '../../src/shared/games/protocol'
import { brawlSim } from '../../src/shared/games/brawl/sim'
import { BTN_HEAVY, BTN_JUMP, BTN_LIGHT, type BrawlInput, type BrawlSimState } from '../../src/shared/games/brawl/types'
import { bots, humans, lcg, make, randomInputs, resetRandomSeq } from './helpers'

function play(ticks: number, seed = 5, humansN = 4, botsN = 4): { s: BrawlSimState; events: BrawlTimedEvent[] } {
  resetRandomSeq()
  const s = make([...humans(humansN), ...bots(botsN)], { mode: 'tempo', arenaId: 'telhado', teamSize: 0 }, seed)
  const rnd = lcg(seed)
  const events: BrawlTimedEvent[] = []
  for (let i = 0; i < ticks; i++) {
    const t = s.tick
    for (const ev of brawlSim.step(s, randomInputs(s, rnd))) events.push({ tick: t, ev })
  }
  return { s, events }
}

const recent = (events: BrawlTimedEvent[], tick: number, n = 8) => events.filter((e) => e.tick > tick - n)

describe('pacotes simples', () => {
  it('hello, ping e pong', () => {
    const h = decodeHello(encodeHello('player-abc', 7, true))
    expect(h).toEqual({ t: 'hello', playerId: 'player-abc', epoch: 7, reply: true })
    expect(decodePing(encodePing(123456, false))).toEqual({ t: 'ping', n: 123456 })
    expect(decodePing(encodePing(9, true))).toEqual({ t: 'pong', n: 9 })
    expect(packetType(encodePing(1))).toBe(3)
    expect(decodeHello(encodePing(1))).toBeNull()
  })

  it('entradas com redundância ida e volta (quantizadas)', () => {
    const inputs: BrawlInput[] = [
      { seq: 10, mx: 1, my: 0, buttons: BTN_JUMP },
      { seq: 11, mx: -1, my: 1, buttons: BTN_LIGHT | BTN_HEAVY },
      { seq: 12, mx: 0.5, my: -0.7, buttons: 0 },
      { seq: 4_000_000_000, mx: 0, my: 0, buttons: 31 }
    ]
    const p = decodeInput(encodeInput(3, 5, inputs))!
    expect(p.epoch).toBe(3)
    expect(p.slot).toBe(5)
    expect(p.inputs).toEqual(inputs.map(quantizeInput))
    expect(p.inputs[2].mx).toBeCloseTo(0.5, 2)
    expect(decodeInputs(encodeInputs(0, 0, inputs))!.inputs).toHaveLength(4)
    // só as últimas 8
    const many = Array.from({ length: 12 }, (_, i) => ({ seq: i + 1, mx: 0, my: 0, buttons: 0 }))
    expect(decodeInput(encodeInput(0, 0, many))!.inputs.map((i) => i.seq)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
    // lagTicks nunca vai pela rede
    expect(JSON.stringify(decodeInput(encodeInput(1, 1, [{ seq: 1, mx: 0, my: 0, buttons: 0, lagTicks: 5 }]))!.inputs[0])).not.toContain('lag')
  })

  it('base64 ida e volta', () => {
    const bytes = new Uint8Array(Array.from({ length: 200 }, (_, i) => (i * 7) & 255))
    const text = toBase64(bytes)
    expect(new Uint8Array(fromBase64(text)!)).toEqual(bytes)
    expect(fromBase64('abc')).toBeNull()
    expect(fromBase64('@@@@')).toBeNull()
  })
})

describe('snapshot', () => {
  it('ida e volta: o decode recria o que foi mandado (posições em 1/16 px)', () => {
    const { s, events } = play(1500)
    const snap = snapshotFromState(s, recent(events, s.tick), { epoch: 4, full: true })
    const back = decodeSnapshot(encodeSnapshot(snap))!
    expect(back).not.toBeNull()
    expect(back.epoch).toBe(4)
    expect(back.tick).toBe(s.tick)
    expect(back.phase).toBe(s.phase)
    expect(back.arenaId).toBe('telhado')
    expect(back.mode).toBe('tempo')
    expect(back.rng).toBe(s.rng)
    expect(back.fighters).toHaveLength(8)
    for (let i = 0; i < 8; i++) {
      const a = snap.fighters[i]
      const b = back.fighters[i]
      expect(b.slot).toBe(a.slot)
      expect(b.char).toBe(a.char)
      expect(b.action).toBe(a.action)
      expect(b.move).toBe(a.move)
      expect(b.moveTick).toBe(a.moveTick)
      expect(b.damage).toBe(a.damage)
      expect(b.stocks).toBe(a.stocks)
      expect(b.held).toBe(a.held)
      expect(b.facing).toBe(a.facing)
      expect(b.grounded).toBe(a.grounded)
      expect(b.jumpsLeft).toBe(a.jumpsLeft)
      expect(b.wallSide).toBe(a.wallSide)
      expect(b.lastSeq).toBe(a.lastSeq)
      expect(b.x).toBeCloseTo(a.x, 1)
      expect(b.y).toBeCloseTo(a.y, 1)
      expect(b.vx).toBeCloseTo(a.vx, 2)
      expect(b.vy).toBeCloseTo(a.vy, 2)
      // prazos: tick absoluto (ou zero se já passou)
      expect(b.invulnUntil).toBe(a.invulnUntil > s.tick ? a.invulnUntil : 0)
    }
    expect(back.statics!.fighters.map((f) => f.id)).toEqual(s.fighters.map((f) => f.id))
    expect(back.events.length).toBe(recent(events, s.tick).length)
    // reenviar o que foi decodificado gera os mesmos bytes (formato estável)
    expect(new Uint8Array(encodeSnapshot(back as never))).toEqual(new Uint8Array(encodeSnapshot(snap)))
  })

  it('itens, projéteis, poças e todos os tipos de evento sobrevivem', () => {
    const s = make([...humans(2, ['janja', 'xicara'])], { mode: 'tempo' })
    for (let i = 0; i < 200; i++) brawlSim.step(s, new Map())
    s.items.push({ id: 77, weapon: 'luvas', x: 123.5, y: 188, vx: 0, vy: 0, state: 'chao', owner: -1, dieTick: s.tick + 500 })
    s.items.push({ id: 78, weapon: 'frigideira', x: 300, y: 20, vx: 0, vy: 1.5, state: 'caindo', owner: 3, dieTick: 0 })
    s.projectiles.push({ id: 80, owner: 0, kind: 'wifi', x: 200.25, y: 160, vx: 3.6, vy: 0, w: 16, h: 20, facing: 1, hit: { damage: 6, baseKb: 3.5, kbGrowth: 8, dx: 0.85, dy: -0.5 }, pierce: true, hitSlots: [1], dieTick: s.tick + 40 })
    s.projectiles.push({ id: 81, owner: 1, kind: 'arma', weapon: 'vassoura', x: 300, y: 150, vx: -6.5, vy: -1, w: 14, h: 14, facing: -1, hit: { damage: 8, baseKb: 3.2, kbGrowth: 6, dx: 0.85, dy: -0.53 }, pierce: false, hitSlots: [], dieTick: s.tick + 30 })
    s.puddles.push({ id: 90, owner: 1, x: 250, y: 188, w: 36, dieTick: s.tick + 300 })
    const evs: BrawlTimedEvent[] = [
      { tick: s.tick, ev: { type: 'jump', slot: 0, air: true } },
      { tick: s.tick, ev: { type: 'land', slot: 1, hard: true } },
      { tick: s.tick - 1, ev: { type: 'dodge', slot: 1 } },
      { tick: s.tick - 1, ev: { type: 'attack', slot: 0, move: 'janja:vassoura:lado', charge: 30 } },
      { tick: s.tick - 2, ev: { type: 'hit', attacker: 0, victim: 1, move: 'proj:wifi', damage: 6, kb: 7.5, strength: 2, x: 210.5, y: 170 } },
      { tick: s.tick - 2, ev: { type: 'ko', victim: 1, killer: -1, side: 'cima', x: 240, y: -90 } },
      { tick: s.tick - 3, ev: { type: 'respawn', slot: 1 } },
      { tick: s.tick - 3, ev: { type: 'eliminated', slot: 1 } },
      { tick: s.tick - 3, ev: { type: 'last-stock', slot: 0 } },
      { tick: s.tick - 4, ev: { type: 'drop', item: 77, weapon: 'luvas', x: 123 } },
      { tick: s.tick - 4, ev: { type: 'pickup', slot: 0, weapon: 'luvas' } },
      { tick: s.tick - 4, ev: { type: 'throw', slot: 0, weapon: 'frigideira' } },
      { tick: s.tick - 5, ev: { type: 'wall', slot: 1 } },
      { tick: s.tick - 5, ev: { type: 'phase', phase: 'morte-subita' } },
      { tick: s.tick - 5, ev: { type: 'go' } }
    ]
    const back = decodeSnapshot(encodeSnapshot(snapshotFromState(s, evs, { epoch: 1 })))!
    expect(back.statics).toBeNull()
    expect(back.items).toHaveLength(s.items.length)
    const it = back.items.find((i) => i.id === 77)!
    expect(it).toMatchObject({ weapon: 'luvas', state: 'chao', owner: -1 })
    expect(it.x).toBeCloseTo(123.5, 1)
    expect(back.items.find((i) => i.id === 78)).toMatchObject({ weapon: 'frigideira', state: 'caindo', owner: 3 })
    const wifi = back.projectiles.find((p) => p.id === 80)!
    expect(wifi).toMatchObject({ kind: 'wifi', owner: 0, facing: 1, pierce: true, hitSlots: [1], w: 16, h: 20 })
    expect(wifi.hit.damage).toBe(6)
    expect(wifi.hit.baseKb).toBeCloseTo(3.5, 1)
    expect(back.projectiles.find((p) => p.id === 81)).toMatchObject({ kind: 'arma', weapon: 'vassoura', facing: -1, pierce: false })
    expect(back.puddles).toEqual(s.puddles.map((p) => ({ ...p, dieTick: p.dieTick })))
    expect(back.events).toHaveLength(evs.length)
    for (let i = 0; i < evs.length; i++) {
      expect(back.events[i].tick).toBe(evs[i].tick)
      expect(back.events[i].ev.type).toBe(evs[i].ev.type)
    }
    expect(back.events[3].ev).toEqual(evs[3].ev)
    expect(back.events[5].ev).toEqual(evs[5].ev)
    expect(back.events[9].ev).toEqual(evs[9].ev)
    const hit = back.events[4].ev as { kb: number; move: string; x: number }
    expect(hit.kb).toBeCloseTo(7.5, 1)
    expect(hit.move).toBe('proj:wifi')
    expect(hit.x).toBeCloseTo(210.5, 1)
  })

  it('cabe em menos de 600 bytes com 8 lutadores (snapshot comum, sem o cheio)', () => {
    const sizes: number[] = []
    resetRandomSeq()
    const s = make([...humans(4), ...bots(4)], { mode: 'tempo' }, 3)
    const rnd = lcg(3)
    const events: BrawlTimedEvent[] = []
    for (let i = 0; i < 3000; i++) {
      const t = s.tick
      for (const ev of brawlSim.step(s, randomInputs(s, rnd))) events.push({ tick: t, ev })
      if (i > 200 && i % 2 === 0) {
        const buf = encodeSnapshot(snapshotFromState(s, recent(events, s.tick, 4), { epoch: 1 }))
        sizes.push(buf.byteLength)
        expect(buf.byteLength).toBeLessThan(MAX_PACKET_BYTES)
      }
    }
    sizes.sort((a, b) => a - b)
    const p95 = sizes[Math.floor(sizes.length * 0.95)]
    expect(p95).toBeLessThan(600)
    expect(sizes[Math.floor(sizes.length / 2)]).toBeLessThan(450)
    // o cheio cabe no relé
    const full = encodeSnapshot(snapshotFromState(s, recent(events, s.tick, 4), { epoch: 1, full: true }))
    expect(Math.ceil((full.byteLength * 4) / 3)).toBeLessThan(RELAY_MAX_DATA)
  })

  it('lixo, truncado, versão errada e sobra viram null (nunca lança)', () => {
    const { s, events } = play(400, 8, 2, 2)
    const good = new Uint8Array(encodeSnapshot(snapshotFromState(s, recent(events, s.tick), { epoch: 2, full: true })))
    expect(decodeSnapshot(good)).not.toBeNull()
    expect(decodeSnapshot(new Uint8Array(0))).toBeNull()
    expect(decodeSnapshot(new Uint8Array([5]))).toBeNull()
    expect(decodePacket(new Uint8Array([99, 1, 0, 0]))).toBeNull()
    const wrongVersion = good.slice()
    wrongVersion[1] = 99
    expect(decodeSnapshot(wrongVersion)).toBeNull()
    expect(decodeSnapshot(good.slice(0, good.length - 1))).toBeNull()
    expect(decodeSnapshot(good.slice(0, 20))).toBeNull()
    const extra = new Uint8Array(good.length + 1)
    extra.set(good)
    expect(decodeSnapshot(extra)).toBeNull()
    expect(decodeInput(new Uint8Array([2, 1, 0, 0, 3, 5]))).toBeNull()
    expect(decodeHello(new Uint8Array([1, 1, 0, 0, 0, 0]))).toBeNull()
    const rnd = lcg(123)
    for (let i = 0; i < 400; i++) {
      const junk = new Uint8Array(Math.floor(rnd() * 600))
      for (let k = 0; k < junk.length; k++) junk[k] = Math.floor(rnd() * 256)
      if (junk.length > 1 && i % 2) {
        junk[0] = 1 + (i % 5)
        junk[1] = 1
      }
      expect(() => decodePacket(junk)).not.toThrow()
    }
    // snapshot bom com um byte estragado: nunca lança (pode virar null ou outro valor válido)
    for (let i = 0; i < good.length; i += 3) {
      const bad = good.slice()
      bad[i] = (bad[i] + 97) & 255
      expect(() => decodeSnapshot(bad)).not.toThrow()
    }
  })

  it('restoreState: o novo host continua do último snapshot completo', () => {
    const { s, events } = play(1800, 12, 3, 2)
    const snap = decodeSnapshot(encodeSnapshot(snapshotFromState(s, recent(events, s.tick), { epoch: 2, full: true })))!
    let statics = mergeStatics(null, snap)
    expect(statics).not.toBeNull()
    const r = restoreState(snap, statics)
    expect(r.tick).toBe(s.tick)
    expect(r.rng).toBe(s.rng)
    expect(r.nextDropTick).toBe(s.nextDropTick)
    expect(r.arenaId).toBe(s.arenaId)
    expect(r.fighters.map((f) => [f.slot, f.id, f.bot, f.char, f.stocks, f.kos, f.falls, f.dealt])).toEqual(s.fighters.map((f) => [f.slot, f.id, f.bot, f.char, f.stocks, f.kos, f.falls, f.dealt]))
    expect(r.fighters.map((f) => f.team)).toEqual(s.fighters.map((f) => f.team))
    // sem a tabela, usa ids de reserva
    const bare = restoreState({ ...snap, statics: null }, null)
    expect(bare.fighters[0].id).toBe('jogador-0')
    expect(bare.fighters.find((f) => f.bot)!.id).toMatch(/^bot-\d/)
    // e a luta continua: placar sem perder nada, sem lançar
    const before = brawlSim.scores(r).map((l) => l.kos + l.falls)
    resetRandomSeq()
    const rnd = lcg(99)
    for (let i = 0; i < 600; i++) brawlSim.step(r, randomInputs(r, rnd))
    const after = brawlSim.scores(r).map((l) => l.kos + l.falls)
    after.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(before[i]))
    for (const f of r.fighters) expect(Number.isFinite(f.x + f.y)).toBe(true)
    statics = null
  })
})
