/**
 * Bot do Mistério (laboratório e testes): anota o que vê (as suas cartas e as que mostram para ele),
 * anda até um cômodo que ainda não descartou, palpita entre o que falta descobrir e acusa quando
 * sobra uma de cada.
 */
import type { Rng } from '../types'
import { distances, isRoom } from './board'
import { PLACES, SUSPECTS, TOOLS } from './cards'
import type { MysteryAction, MysteryView } from './types'

/** o melhor lugar para andar: um cômodo desejado ao alcance ou a casa mais perto de um */
function bestMove(reach: string[], wanted: string[], rng: Rng): string {
  const rooms = reach.filter((p) => wanted.includes(p))
  if (rooms.length) return rooms[rng.int(rooms.length)]
  const maps = wanted.map((w) => distances(w))
  let best = reach[0]
  let bestD = Infinity
  for (const p of reach) {
    if (isRoom(p)) continue
    const d = Math.min(...maps.map((m) => m.get(p) ?? Infinity))
    if (d < bestD) [best, bestD] = [p, d]
  }
  return best
}

export function botAction(v: MysteryView, rng: Rng): MysteryAction | null {
  const me = v.you?.index
  if (me === undefined) return null
  if (v.phase === 'mostrar') return v.refuter === me ? { type: 'show', card: v.myChoices[rng.int(v.myChoices.length)] } : null
  if (v.turn !== me || v.phase === 'fim') return null
  const seen = new Set([...v.myCards, ...v.history.filter((h) => h.by === me && h.card).map((h) => h.card as string)])
  const left = (cards: readonly { id: string }[]) => cards.map((c) => c.id).filter((c) => !seen.has(c))
  const [q, o, c] = [left(SUSPECTS), left(PLACES), left(TOOLS)]
  const known = q.length === 1 && o.length === 1 && c.length === 1
  if (known && v.phase !== 'andar') return { type: 'accuse', quem: q[0], onde: o[0], como: c[0] }
  const pos = v.players[me].pos
  switch (v.phase) {
    case 'rolar':
      return { type: 'roll' }
    case 'andar': {
      if (!v.reach.length) return { type: 'end' }
      // ainda falta o lugar: vai a um não descartado; senão qualquer cômodo serve para perguntar
      const want = o.length > 1 ? o : PLACES.map((p) => p.id)
      const wanted = want.filter((p) => p !== pos)
      return { type: 'move', to: bestMove(v.reach, wanted.length ? wanted : want, rng) }
    }
    case 'palpite':
      return { type: 'suggest', quem: q[rng.int(q.length)], onde: pos, como: c[rng.int(c.length)] }
    default:
      return { type: 'end' }
  }
}
