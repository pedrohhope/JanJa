import { describe, expect, it } from 'vitest'
import { apply, setup, view, type VelhaState } from '../../src/shared/games/velha/engine'
import { bigLinePossible, winnerOf } from '../../src/shared/games/velha/rules'
import { isGameError, seededRng } from '../../src/shared/games/types'

/** Partidas inteiras com lances aleatórios: sempre terminam e as regras nunca quebram. */
describe('velha ao quadrado: partidas aleatórias', () => {
  it('300 partidas terminam com linha ou velha, sem lance ilegal aceito', () => {
    const reasons = new Set<string>()
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRng(seed)
      let s: VelhaState = setup(
        [
          { playerId: 'a', name: 'A' },
          { playerId: 'b', name: 'B' }
        ],
        { minutes: 0 },
        { now: 0, rng }
      ).state
      let n = 0
      while (!s.result) {
        const who = s.pos.turn === 'x' ? s.players.w.playerId : s.players.b.playerId
        const v = view(s, who, 0)
        expect(v.legal.length).toBeGreaterThan(0)
        // o tabuleiro obrigatório manda mesmo
        if (v.forced !== null) expect(v.legal.every(([b]) => b === v.forced)).toBe(true)
        // um lance ilegal de vez em quando é recusado
        if (rng.int(5) === 0) {
          const bad = s.pos.board.flatMap((r, b) => r.map((c, i) => [b, i, c] as const)).find(([b, , c]) => c !== null || (v.forced !== null && b !== v.forced))
          if (bad) expect(isGameError(apply(s, who, { type: 'move', board: bad[0], cell: bad[1] }, { now: 0, rng }))).toBe(true)
        }
        const [board, cell] = v.legal[rng.int(v.legal.length)]
        const r = apply(s, who, { type: 'move', board, cell }, { now: 0, rng })
        if (isGameError(r)) throw new Error(r.message)
        s = r.state
        n++
        expect(n).toBeLessThanOrEqual(81)
        // tabuleiro pequeno fechado bate com as casas
        s.pos.small.forEach((sm, b) => {
          const w = winnerOf(s.pos.board[b])
          if (w) expect(sm).toBe(w)
          else if (s.pos.board[b].every((c) => c !== null)) expect(sm).toBe('empate')
          else expect(sm).toBeNull()
        })
      }
      reasons.add(s.result.reason)
      if (s.result.reason === 'linha') expect(winnerOf(s.pos.small)).toBe(s.result.winner === 'w' ? 'x' : 'o')
      else expect(bigLinePossible(s.pos.small, 'x') || bigLinePossible(s.pos.small, 'o')).toBe(false)
    }
    expect(reasons).toEqual(new Set(['linha', 'velha']))
  })
})
