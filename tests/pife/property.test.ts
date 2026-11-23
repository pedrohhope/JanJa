import { describe, expect, it } from 'vitest'
import { botMove } from '../../src/shared/games/pife/bot'
import { meldKind } from '../../src/shared/games/pife/cards'
import { apply, setup, view, type PifeState } from '../../src/shared/games/pife/engine'
import type { PifeAction } from '../../src/shared/games/pife/types'
import { isGameError, seededRng } from '../../src/shared/games/types'

/** Partidas inteiras com bots, de 2 a 8 pessoas: as cartas nunca somem nem duplicam e quem bate tem jogos de verdade. */
describe('pife: partidas com bots', () => {
  it('2 a 8 pessoas, várias sementes', () => {
    let wins = 0
    for (let n = 2; n <= 8; n++)
      for (let seed = 1; seed <= 6; seed++) {
        const rng = seededRng(seed * 10 + n)
        const players = Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }))
        let s: PifeState = setup(players, {}, { now: 0, rng }).state
        let turns = 0
        while (s.phase !== 'fim' && turns < 3000) {
          const id = s.players[s.turn].playerId
          const a = botMove(view(s, id, 0))
          expect(a).not.toBeNull()
          const r = apply(s, id, { ...a!, ref: s.ref } as PifeAction, { now: 0, rng })
          if (isGameError(r)) throw new Error(`${r.message} ${JSON.stringify(a)}`)
          s = r.state
          turns++
          const all = [...s.stock, ...s.discard, ...s.hands.flat()]
          expect(all).toHaveLength(108)
          expect(new Set(all).size).toBe(108)
        }
        if (s.phase === 'fim') {
          wins++
          const w = s.winner!
          for (const m of w.melds) expect(meldKind(m)).not.toBeNull()
          expect(w.melds.flat().sort()).toEqual([...s.hands[w.p]].sort())
        }
      }
    // os bots batem quase sempre
    expect(wins).toBeGreaterThan(30)
  })
})
