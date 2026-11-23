/**
 * Bot do pife (laboratório e testes): pega do lixo se a carta entra num jogo, bate quando dá e
 * descarta a carta solta que menos ajuda (coringa nunca).
 */
import { bestMelds, isJoker, parts, valueOf, type Card } from './cards'
import type { PifeIntent, PifeView } from './types'

/** quantas cartas ficam em jogos */
const inMelds = (hand: readonly Card[]) => hand.length - bestMelds(hand).loose.length

/** o quanto uma carta solta "conversa" com as outras (par do mesmo valor, vizinha do mesmo naipe) */
function promise(c: Card, hand: readonly Card[]): number {
  if (isJoker(c)) return 100
  const p = parts(c)!
  let score = 0
  for (const o of hand) {
    if (o === c || isJoker(o)) continue
    const q = parts(o)!
    if (q.rank === p.rank) score += 2
    else if (q.suit === p.suit && Math.abs(valueOf(q.rank) - valueOf(p.rank)) <= 2) score += 2 - Math.abs(valueOf(q.rank) - valueOf(p.rank)) / 2
  }
  return score
}

export function botMove(v: PifeView): PifeIntent | null {
  if (!v.you || v.turn !== v.you.index) return null
  if (v.phase === 'comprar') {
    if (v.top && !isJoker(v.top) && inMelds([...v.hand, v.top]) > inMelds(v.hand)) return { type: 'draw', from: 'lixo' }
    if (v.top && isJoker(v.top)) return { type: 'draw', from: 'lixo' }
    return { type: 'draw', from: 'monte' }
  }
  if (v.phase !== 'descartar') return null
  if (v.canWin) return { type: 'bater' }
  const { loose } = bestMelds(v.hand)
  // a carta que veio do lixo não pode voltar para ele
  const keep = v.took?.from === 'lixo' ? v.drawn : null
  const pool = (loose.length ? loose : v.hand).filter((c) => c !== keep)
  const worst = [...pool].sort((a, b) => promise(a, v.hand) - promise(b, v.hand))[0]
  return { type: 'discard', card: worst }
}
