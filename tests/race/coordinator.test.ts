import { describe, expect, it } from 'vitest'
import { addPlayer, apply, deadline, nextDeadline, parseAction, parseOptions, raceGame, setPresence, setup, tick, view } from '../../src/shared/games/race/engine'
import { DEFAULT_RACE_OPTIONS, type RaceScoreLine } from '../../src/shared/games/race/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const ctx = (now = 1_000_000, seed = 1): GameCtx => ({ now, rng: seededRng(seed) })
const players = [
  { playerId: 'ana', name: 'Ana' },
  { playerId: 'bia', name: 'Bia' }
]
const line = (id: string, place: number, laps = 3): RaceScoreLine => ({ id, place, laps, timeMs: place * 1000, bestLapMs: 900 })

describe('coordenador da corrida', () => {
  it('opções: padrão, válidas e recusadas', () => {
    expect(parseOptions(undefined)).toEqual(DEFAULT_RACE_OPTIONS)
    expect(parseOptions({ trackId: 'quintal', laps: 7, bots: 5, botLevel: 'dificil' })).toEqual({ trackId: 'quintal', laps: 7, bots: 5, botLevel: 'dificil' })
    expect(parseOptions({ trackId: 'sorteio' })).toMatchObject({ trackId: 'sorteio' })
    for (const bad of [{ trackId: 'lua' }, { laps: 4 }, { bots: 6 }, { bots: -1 }, { botLevel: 'x' }, []]) expect(isGameError(parseOptions(bad))).toBe(true)
  })

  it('setup: robôs depois das pessoas, pista sorteada e o primeiro é o host', () => {
    const { state, events } = setup(players, { ...DEFAULT_RACE_OPTIONS, trackId: 'sorteio', bots: 2 }, ctx())
    expect(state.players.map((p) => p.slot)).toEqual([0, 1, 8, 9])
    expect(['sala', 'quintal']).toContain(state.trackId)
    expect(state.hostId).toBe('ana')
    expect(events).toEqual([{ type: 'host', hostId: 'ana', epoch: 1 }])
    expect(view(state, 'bia', 0).you).toEqual({ playerId: 'bia', slot: 1 })
    expect(view(state, null, 0).you).toBeNull()
  })

  it('só o host no epoch certo manda placar e resultado', () => {
    const s0 = setup(players, { ...DEFAULT_RACE_OPTIONS, bots: 1 }, ctx()).state
    const score = parseAction({ type: 'score', epoch: 1, scores: [line('ana', 0, 1)] })
    expect(isGameError(score)).toBe(false)
    expect(isGameError(apply(s0, 'bia', score as never, ctx()))).toBe(true)
    expect(isGameError(apply(s0, 'ana', { type: 'score', epoch: 2, scores: [] }, ctx()))).toBe(true)
    expect(isGameError(apply(s0, 'ana', { type: 'score', epoch: 1, scores: [line('zé', 1)] }, ctx()))).toBe(true)
    const r = apply(s0, 'ana', { type: 'result', epoch: 1, ranking: [line('bot-1', 1), line('bia', 2)] }, ctx())
    if (isGameError(r)) throw new Error(r.message)
    expect(r.state.phase).toBe('fim')
    expect(r.state.ranking!.map((l) => l.id)).toEqual(['bot-1', 'bia', 'ana'])
    expect(raceGame.isOver(r.state)).toBe(true)
    expect(isGameError(parseAction({ type: 'score', epoch: 1, scores: [{ id: 'a', place: -1, laps: 0, timeMs: 0, bestLapMs: 0 }] }))).toBe(true)
  })

  it('o host sai: passa para o próximo e sobe o epoch', () => {
    const s0 = setup(players, DEFAULT_RACE_OPTIONS, ctx()).state
    const r = setPresence(s0, 'ana', false, ctx())
    expect(r.state.hostId).toBe('bia')
    expect(r.state.epoch).toBe(2)
  })

  it('prazo de segurança: sem resultado, fecha pelo placar parcial', () => {
    const s0 = setup(players, { ...DEFAULT_RACE_OPTIONS, laps: 3, bots: 0 }, ctx()).state
    const r1 = apply(s0, 'ana', { type: 'score', epoch: 1, scores: [line('ana', 0, 2), line('bia', 1)] }, ctx())
    if (isGameError(r1)) throw new Error(r1.message)
    expect(nextDeadline(r1.state)).toBe(deadline(r1.state))
    expect(tick(r1.state, ctx(deadline(r1.state) - 1)).state.phase).toBe('jogando')
    const end = tick(r1.state, ctx(deadline(r1.state)))
    expect(end.state.phase).toBe('fim')
    expect(end.state.ranking!.map((l) => l.id)).toEqual(['bia', 'ana'])
  })

  it('entra no meio da corrida e volta quem caiu', () => {
    const s0 = setup(players, { ...DEFAULT_RACE_OPTIONS, bots: 0 }, ctx()).state
    const r = addPlayer(s0, { playerId: 'caio', name: 'Caio' }, ctx())
    if (isGameError(r)) throw new Error(r.message)
    expect(r.state.players.find((p) => p.id === 'caio')!.slot).toBe(2)
    expect(r.events).toContainEqual({ type: 'joined', id: 'caio', name: 'Caio', slot: 2 })
    const again = addPlayer(r.state, { playerId: 'caio', name: 'Caio' }, ctx())
    if (isGameError(again)) throw new Error(again.message)
    expect(again.state.players).toHaveLength(3)
  })
})
