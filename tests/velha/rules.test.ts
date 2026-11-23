import { describe, expect, it } from 'vitest'
import { bigLinePossible, boardName, initial, isLegal, legalMoves, play, winnerOf, type Move, type Pos } from '../../src/shared/games/velha/rules'

const run = (moves: Move[], from: Pos = initial()): Pos =>
  moves.reduce((p, m) => {
    if (!isLegal(p, m)) throw new Error(`lance inválido ${m.board},${m.cell}`)
    return play(p, m).pos
  }, from)
const mv = (board: number, cell: number): Move => ({ board, cell })

describe('regras da velha ao quadrado', () => {
  it('começa com X e jogada livre nas 81 casas', () => {
    const p = initial()
    expect(p.turn).toBe('x')
    expect(legalMoves(p)).toHaveLength(81)
  })

  it('a casa jogada manda o outro para o tabuleiro de mesmo número', () => {
    const p = run([mv(4, 2)])
    expect(p.turn).toBe('o')
    expect(p.forced).toBe(2)
    expect(legalMoves(p).every((m) => m.board === 2)).toBe(true)
    expect(legalMoves(p)).toHaveLength(9)
    expect(isLegal(p, mv(4, 0))).toBe(false)
  })

  it('não dá para jogar em casa ocupada', () => {
    const p = run([mv(0, 0), mv(0, 4)])
    // X foi mandado para o tabuleiro 4
    expect(isLegal(p, mv(4, 4))).toBe(true)
    const q = run([mv(4, 4)], p)
    // O é mandado para o 4 de novo, e a casa do meio está ocupada
    expect(isLegal(q, mv(4, 4))).toBe(false)
  })

  it('tabuleiro cheio sem linha fecha empatado', () => {
    const p = initial()
    p.board[3] = ['x', 'o', 'x', 'x', 'o', 'o', 'o', 'x', null]
    p.forced = 3
    const r = play(p, mv(3, 8))
    expect(r.closed).toBe('empate')
    expect(r.pos.small[3]).toBe('empate')
    // mandou para o 8, aberto
    expect(r.pos.forced).toBe(8)
  })

  it('tabuleiro ganho: quem é mandado para ele joga em qualquer um aberto', () => {
    let p = initial()
    p = { ...p, board: p.board.map((r, b) => (b === 4 ? ['x', 'x', null, null, null, null, null, null, null] : r)) }
    const r = play(p, mv(4, 2))
    expect(r.closed).toBe('x')
    expect(r.pos.small[4]).toBe('x')
    // mandou para o 2 (aberto)
    expect(r.pos.forced).toBe(2)
    // agora O manda para o 4 (já ganho): X joga livre, menos no 4
    const s = play(r.pos, mv(2, 4)).pos
    expect(s.forced).toBeNull()
    expect(legalMoves(s).some((m) => m.board === 4)).toBe(false)
    expect(new Set(legalMoves(s).map((m) => m.board)).size).toBe(8)
  })

  it('três tabuleiros em linha no grande vence e acaba os lances', () => {
    const p = { ...initial(), small: ['x', 'x', null, null, null, null, null, null, null] as Pos['small'] }
    const q: Pos = { ...p, board: p.board.map((r, b) => (b === 2 ? (['x', 'x', null, null, null, null, null, null, null] as Pos['board'][number]) : r)), forced: 2 }
    const { pos } = play(q, mv(2, 2))
    expect(winnerOf(pos.small)).toBe('x')
    expect(legalMoves(pos)).toHaveLength(0)
  })

  it('tabuleiro empatado bloqueia as linhas do grande para os dois', () => {
    const small: Pos['small'] = ['x', 'o', 'x', 'x', 'o', 'o', 'o', 'x', 'empate']
    expect(bigLinePossible(small, 'x')).toBe(false)
    expect(bigLinePossible(small, 'o')).toBe(false)
    expect(bigLinePossible(['x', null, 'empate', null, null, null, null, null, null], 'o')).toBe(true)
  })

  it('nomes dos tabuleiros', () => {
    expect(boardName(4)).toBe('tabuleiro do meio')
    expect(boardName(2)).toBe('tabuleiro do canto de cima à direita')
  })
})
