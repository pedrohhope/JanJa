import { describe, expect, it } from 'vitest'
import { ABANDON_MS } from '../../src/shared/games/duel'
import { apply, nextDeadline, parseAction, setPresence, setup, tick, view, type VelhaState } from '../../src/shared/games/velha/engine'
import { initial, type Pos } from '../../src/shared/games/velha/rules'
import { describeResult, type VelhaAction } from '../../src/shared/games/velha/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(4) })
const PLAYERS = [
  { playerId: 'a', name: 'Ana' },
  { playerId: 'b', name: 'Bia' }
]
const start = (minutes: 0 | 5 = 0, pos?: Pos) => setup(PLAYERS, { minutes }, ctx(), pos).state
const xId = (s: VelhaState) => s.players.w.playerId
const oId = (s: VelhaState) => s.players.b.playerId
function act(s: VelhaState, who: string, a: VelhaAction, now = T0) {
  const r = apply(s, who, a, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r
}
const move = (board: number, cell: number): VelhaAction => ({ type: 'move', board, cell })

describe('motor da velha ao quadrado', () => {
  it('X começa; a vez e o tabuleiro obrigatório vão na visão', () => {
    const s = start()
    expect(isGameError(apply(s, oId(s), move(0, 0), ctx()))).toBe(true)
    const r = act(s, xId(s), move(4, 7))
    const v = view(r.state, oId(s), T0)
    expect(v.turn).toBe('b')
    expect(v.forced).toBe(7)
    expect(v.legal).toHaveLength(9)
    expect(v.legal.every(([b]) => b === 7)).toBe(true)
    expect(view(r.state, xId(s), T0).legal).toHaveLength(0)
    expect(v.lastMove).toMatchObject({ board: 4, cell: 7, mark: 'x', text: '5·8' })
    expect(r.events).toContainEqual({ type: 'move', color: 'w', board: 4, cell: 7, closed: null })
  })

  it('fora do tabuleiro destacado é recusado com explicação', () => {
    const s0 = start()
    const s = act(s0, xId(s0), move(4, 7)).state
    const r = apply(s, oId(s), move(0, 0), ctx())
    expect(isGameError(r) && r.message).toBe('Você tem que jogar no tabuleiro destacado.')
  })

  it('três tabuleiros em linha vence', () => {
    const p = initial()
    p.small = ['x', 'x', null, null, null, null, null, null, null]
    p.board[2] = ['x', 'x', null, null, null, null, null, null, null]
    p.forced = 2
    const s = start(0, p)
    const r = act(s, xId(s), move(2, 2))
    expect(r.state.result).toEqual({ winner: 'w', reason: 'linha' })
    const v = view(r.state, null, T0)
    expect(v.winLine).toEqual([0, 1, 2])
    expect(v.forced).toBeNull()
    expect(describeResult(r.state.result!, 'Ana', 'Bia')).toBe('Ana fez três tabuleiros em linha e venceu.')
  })

  it('deu velha: ninguém consegue mais fazer linha no grande', () => {
    const p = initial()
    p.small = ['x', 'o', 'x', 'x', 'o', 'o', 'o', 'x', null]
    p.board[8] = ['x', 'o', 'x', 'x', 'o', 'o', 'o', 'x', null]
    p.forced = 8
    const s = start(0, p)
    const r = act(s, xId(s), move(8, 8))
    expect(r.state.result).toEqual({ winner: null, reason: 'velha' })
  })

  it('empate antecipado: com casas sobrando, mas sem linha possível para ninguém', () => {
    const p = initial()
    // o 8 vai fechar para O; todas as linhas do grande ficam com X e O
    p.small = ['x', 'o', 'x', 'x', 'o', 'o', 'o', 'x', null]
    p.board[8] = ['o', 'o', null, null, null, null, null, null, null]
    p.turn = 'o'
    p.forced = 8
    const s = start(0, p)
    const r = act(s, oId(s), move(8, 2))
    expect(r.state.result).toEqual({ winner: null, reason: 'velha' })
  })

  it('relógio: estourou, perde', () => {
    const s = start(5)
    expect(nextDeadline(s)).toBe(T0 + 5 * 60_000)
    const t = tick(s, ctx(T0 + 5 * 60_000)).state
    expect(t.result).toEqual({ winner: 'b', reason: 'tempo' })
  })

  it('desistir e sair da sala', () => {
    const s = start()
    expect(act(s, oId(s), { type: 'resign' }).state.result).toEqual({ winner: 'w', reason: 'desistiu' })
    const away = setPresence(s, oId(s), false, ctx()).state
    expect(tick(away, ctx(T0 + ABANDON_MS)).state.result).toEqual({ winner: 'w', reason: 'abandono' })
  })

  it('ação inválida é recusada', () => {
    expect(isGameError(parseAction({ type: 'move', board: 9, cell: 0 }))).toBe(true)
    expect(isGameError(parseAction({ type: 'move', board: 1.5, cell: 0 }))).toBe(true)
    expect(parseAction({ type: 'move', board: 3, cell: 8 })).toEqual({ type: 'move', board: 3, cell: 8 })
    expect(parseAction({ type: 'draw' })).toEqual({ type: 'draw' })
  })
})
