/**
 * Cartas do pife em pixel art: as do poker (src/web/game/art/cards.ts) mais o coringa, desenhado aqui.
 * Sem DOM: o teste importa daqui. Quem vira imagem é `images.ts`.
 */
import { CARD_H, CARD_W, cardBack, cardFace, cardShell, type Suit } from '../../art/cards'
import { Grid } from '../../art/grid'
import type { Sprite } from '../../art/palette'
import { isJoker, parts } from '../../../../shared/games/pife/cards'

export { CARD_H, CARD_W }

/** estrela 11x11: '#' preenchido */
const STAR = ['.....#.....', '....###....', '....###....', '...#####...', '###########', '.#########.', '..#######..', '..#######..', '.####.####.', '.###...###.', '##.......##']
const STAR_SMALL = ['..#..', '.###.', '#####', '.###.', '.#.#.']

/** estrela com contorno, luz em cima à esquerda e sombra embaixo (como os naipes grandes) */
function bigStar(): Sprite {
  const g = new Grid(13, 13)
  const m = (x: number, y: number) => STAR[y]?.[x] === '#'
  for (let y = -1; y <= 11; y++)
    for (let x = -1; x <= 11; x++) {
      if (m(x, y)) continue
      let near = false
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m(x + dx, y + dy)) near = true
      if (near) g.set(x + 1, y + 1, 'k')
    }
  for (let y = 0; y < 11; y++)
    for (let x = 0; x < 11; x++) {
      if (!m(x, y)) continue
      const lit = (!m(x - 1, y) || !m(x, y - 1)) && x + y <= 9
      const shade = (!m(x + 1, y) || !m(x, y + 1)) && x + y >= 11
      g.set(x + 1, y + 1, lit ? 'p' : shade ? 'Y' : 'y')
    }
  return g.toSprite()
}

/** Coringa: estrela dourada no meio, estrelinhas coral nos cantos e um arco de "confete". */
export function jokerFace(): Sprite {
  const g = cardShell()
  const small = STAR_SMALL.map((l) => l.replace(/#/g, 'o'))
  g.blit(3, 3, small)
  g.blit(CARD_W - 3 - 5, CARD_H - 3 - 5, small)
  g.blit((CARD_W - 13) >> 1, (CARD_H - 13) >> 1, bigStar())
  // arco de confete em volta da estrela
  const cx = CARD_W / 2 - 0.5
  const cy = CARD_H / 2 - 0.5
  const colors = ['o', 'c', 'g', 'y']
  for (let k = 0; k < 14; k++) {
    const a = (Math.PI * 2 * k) / 14
    g.set(Math.round(cx + Math.cos(a) * 11), Math.round(cy + Math.sin(a) * 13), colors[k % colors.length])
  }
  return g.toSprite()
}

/** sprite da carta (as cópias dos dois baralhos são iguais) */
export function cardSprite(card: string): Sprite {
  if (isJoker(card)) return jokerFace()
  const p = parts(card)!
  return cardFace(p.rank, p.suit as Suit)
}

export const backSprite = (): Sprite => cardBack()

/** chave do desenho (as duas cópias da mesma carta usam a mesma imagem) */
export const artKey = (card: string): string => (isJoker(card) ? 'JK' : card.slice(0, card.indexOf('.')))
