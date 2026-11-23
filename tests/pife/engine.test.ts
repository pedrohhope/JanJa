import { describe, expect, it } from 'vitest'
import { apply, setPresence, setup, tick, view, type PifeState } from '../../src/shared/games/pife/engine'
import { AWAY_MS, DECIDE_MS, type PifeAction, type PifeIntent } from '../../src/shared/games/pife/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(7) })
const PLAYERS = ['Ana', 'Bia', 'Caio'].map((name, i) => ({ playerId: `p${i}`, name }))
const start = () => setup(PLAYERS, {}, ctx()).state
const who = (s: PifeState) => s.players[s.turn].playerId
function act(s: PifeState, a: PifeIntent, now = T0) {
  const r = apply(s, who(s), { ...a, ref: s.ref } as PifeAction, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r
}

describe('motor do pife', () => {
  it('dá 9 cartas para cada um, uma no lixo e o resto no monte', () => {
    const s = start()
    expect(s.hands.every((h) => h.length === 9)).toBe(true)
    expect(s.discard).toHaveLength(1)
    expect(s.stock).toHaveLength(108 - 27 - 1)
  })

  it('cada um vê só a própria mão', () => {
    const s = start()
    const v = view(s, 'p0', T0)
    expect(v.hand).toEqual(s.hands[0])
    expect(v.hands).toBeNull()
    expect(v.players.map((p) => p.cards)).toEqual([9, 9, 9])
    expect(view(s, null, T0).hand).toEqual([])
  })

  it('vez: compra (monte ou lixo), depois descarta; a vez passa', () => {
    const s = start()
    const t = s.turn
    expect(isGameError(apply(s, who(s), { type: 'discard', card: s.hands[t][0], ref: s.ref }, ctx()))).toBe(true)
    const top = s.discard[0]
    const a = act(s, { type: 'draw', from: 'lixo' }).state
    expect(a.hands[t]).toContain(top)
    expect(a.discard).toHaveLength(0)
    // não devolve ao lixo a carta que pegou dele
    const back = apply(a, who(a), { type: 'discard', card: top, ref: a.ref }, ctx())
    expect(isGameError(back) && back.message).toMatch(/devolver/)
    const other = a.hands[t].find((c) => c !== top)!
    const b = act(a, { type: 'discard', card: other }).state
    expect(b.discard).toEqual([other])
    expect(b.turn).toBe((t + 1) % 3)
    expect(b.hands[t]).toHaveLength(9)
  })

  it('fora da vez e jogada velha são recusadas', () => {
    const s = start()
    const notMe = s.players[(s.turn + 1) % 3].playerId
    expect(isGameError(apply(s, notMe, { type: 'draw', from: 'monte', ref: 0 }, ctx()))).toBe(true)
    expect(isGameError(apply(s, who(s), { type: 'draw', from: 'monte', ref: 5 }, ctx()))).toBe(true)
  })

  it('bater com jogos acaba a rodada e mostra as mãos', () => {
    const s = start()
    const t = s.turn
    s.hands[t] = ['7h.1', '7s.1', '7c.1', '4d.1', '5d.1', '6d.1', '9c.1', '9h.1', '9s.1']
    s.stock.push('Kd.2')
    const a = act(s, { type: 'draw', from: 'monte' }).state
    expect(view(a, who(a), T0).canWin).toBe(true)
    const r = act(a, { type: 'bater' })
    expect(r.state.phase).toBe('fim')
    expect(r.state.winner).toMatchObject({ p: t, discard: 'Kd.2' })
    expect(view(r.state, 'p0', T0).hands).toHaveLength(3)
    expect(r.events.some((e) => e.type === 'end')).toBe(true)
  })

  it('bater sem jogos é recusado', () => {
    const s = start()
    s.hands[s.turn] = ['2h.1', '5s.1', '7c.1', '9d.1', 'Jd.1', 'Kd.1', '3c.1', '8h.1', 'Qs.1']
    s.stock.push('4c.2')
    const a = act(s, { type: 'draw', from: 'monte' }).state
    expect(view(a, who(a), T0).canWin).toBe(false)
    expect(isGameError(apply(a, who(a), { type: 'bater', ref: a.ref }, ctx()))).toBe(true)
  })

  it('monte vazio: o lixo vira monte (menos a de cima)', () => {
    const s = start()
    s.discard = [...s.stock.splice(0, s.stock.length - 0)]
    const top = s.discard[s.discard.length - 1]
    const r = act(s, { type: 'draw', from: 'monte' })
    expect(r.events.some((e) => e.type === 'reshuffle')).toBe(true)
    expect(r.state.discard).toEqual([top])
  })

  it('prazo: compra do monte e descarta sozinho; quem sai da sala joga rápido', () => {
    const s = start()
    const t = s.turn
    const a = tick(s, ctx(T0 + DECIDE_MS)).state
    expect(a.phase).toBe('descartar')
    const b = tick(a, ctx(T0 + 2 * DECIDE_MS)).state
    expect(b.turn).toBe((t + 1) % 3)
    expect(b.hands[t]).toHaveLength(9)
    expect(setPresence(b, who(b), false, ctx(T0 + 2 * DECIDE_MS + 10)).state.until).toBe(T0 + 2 * DECIDE_MS + 10 + AWAY_MS)
  })
})
