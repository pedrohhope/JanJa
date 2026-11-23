import { describe, expect, it } from 'vitest'
import { bestMelds, findWin, fullDeck, meldKind, splitIntoMelds } from '../../src/shared/games/pife/cards'

/** cartas do primeiro baralho por texto: "7h 7s Kd JK" (JK = coringa) */
let jk = 0
const c = (t: string): string[] =>
  t.split(/\s+/).map((x) => (x === 'JK' ? `JK.${(jk++ % 4) + 1}` : `${x}.1`))

describe('baralho do pife', () => {
  it('dois baralhos com 4 coringas: 108 cartas, todas diferentes', () => {
    const d = fullDeck()
    expect(d).toHaveLength(108)
    expect(new Set(d).size).toBe(108)
  })
})

describe('jogos', () => {
  it('trinca: mesmo valor de qualquer naipe, até repetido; sem coringa', () => {
    expect(meldKind(c('7h 7s 7c'))).toBe('trinca')
    expect(meldKind(['7h.1', '7h.2', '7s.1'])).toBe('trinca')
    expect(meldKind(c('7h 7s 7c 7d'))).toBe('trinca')
    expect(meldKind(c('7h 7s JK'))).toBeNull()
    expect(meldKind(c('7h 7s'))).toBeNull()
  })

  it('sequência: mesmo naipe em ordem; ás antes do 2 ou depois do K, sem dar a volta', () => {
    expect(meldKind(c('4h 5h 6h'))).toBe('sequencia')
    expect(meldKind(c('6h 4h 5h 7h'))).toBe('sequencia')
    expect(meldKind(c('Ah 2h 3h'))).toBe('sequencia')
    expect(meldKind(c('Qh Kh Ah'))).toBe('sequencia')
    expect(meldKind(c('Kh Ah 2h'))).toBeNull()
    expect(meldKind(c('4h 5h 6s'))).toBeNull()
    expect(meldKind(c('4h 5h 7h'))).toBeNull()
    expect(meldKind(['4h.1', '4h.2', '5h.1'])).toBeNull()
  })

  it('coringa só em sequência: tapa buraco ou ponta', () => {
    expect(meldKind(c('4h JK 6h'))).toBe('sequencia')
    expect(meldKind(c('4h 5h JK'))).toBe('sequencia')
    expect(meldKind(c('Kh JK JK'))).toBe('sequencia')
    expect(meldKind(c('Qh Kh JK'))).toBe('sequencia') // Q K A
    expect(meldKind(c('4h JK 7h'))).toBeNull() // falta um
    expect(meldKind(c('4h JK JK 7h'))).toBe('sequencia')
    expect(meldKind(c('JK JK JK'))).toBeNull() // precisa de carta de verdade
  })
})

describe('bater', () => {
  it('divide a mão em jogos', () => {
    expect(splitIntoMelds(c('7h 7s 7c 4d 5d 6d 9c 9h 9s'))).toHaveLength(3)
    expect(splitIntoMelds(c('7h 7s 7c 4d 5d 6d 9c 9h 2s'))).toBeNull()
  })

  it('acha a carta para descartar, ou bate com todas', () => {
    const w = findWin(c('7h 7s 7c 4d 5d 6d 9c 9h 9s Kd'))!
    expect(w.discard).toBe('Kd.1')
    expect(w.melds.flat()).toHaveLength(9)
    const all = findWin(c('7h 7s 7c 4d 5d 6d 7d 9c 9h 9s'))!
    expect(all.discard).toBeNull()
    expect(findWin(c('7h 7s 7c 4d 5d 6d 9c 9h 2s Kd'))).toBeNull()
    // descartando uma carta que quebra o jogo: não dá
    expect(findWin(c('7h 7s 7c 4d 5d 6d 9c 9h 9s Kd'), '7h.1')).toBeNull()
  })

  it('melhor arrumação: o máximo de cartas em jogos', () => {
    const r = bestMelds(c('7h 7s 7c 8h 9h 2d 2s Kc JK'))
    expect(r.melds.flat().length).toBeGreaterThanOrEqual(6)
    expect(r.loose.length + r.melds.flat().length).toBe(9)
  })
})
