import { describe, expect, it } from 'vitest'
import { DECK, power, RANKING, RANKING_NAMES } from '../../src/shared/games/truco/cards'

describe('ordem das cartas no painel de regras', () => {
  it('14 grupos, do mais forte ao mais fraco, com o baralho inteiro', () => {
    expect(RANKING).toHaveLength(14)
    expect(RANKING.length).toBe(RANKING_NAMES.length)
    expect(RANKING.flat().sort()).toEqual([...DECK].sort())
    for (let k = 1; k < RANKING.length; k++) expect(power(RANKING[k - 1][0])).toBeGreaterThan(power(RANKING[k][0]))
    for (const tier of RANKING) expect(new Set(tier.map(power)).size).toBe(1)
  })

  it('manilhas e grupos com os nomes certos', () => {
    expect(RANKING.slice(0, 4)).toEqual([['1e'], ['1b'], ['7e'], ['7o']])
    expect([...RANKING[RANKING_NAMES.indexOf('Ases falsos')]].sort()).toEqual(['1c', '1o'])
    expect([...RANKING[RANKING_NAMES.indexOf('Setes falsos')]].sort()).toEqual(['7b', '7c'])
    expect(RANKING[RANKING_NAMES.indexOf('Reis')].every((c) => c.startsWith('12'))).toBe(true)
    expect(RANKING[RANKING_NAMES.indexOf('Os 4')].every((c) => c.startsWith('4'))).toBe(true)
  })
})
