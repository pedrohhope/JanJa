/**
 * Prints de cada jogo para a vitrine do painel de jogos.
 * GERADO por `npm run thumbs` (scripts/build-thumbs.ts): abre o laboratório de cada jogo no Chrome
 * headless e tira alguns quadros. Não edite à mão; rode o script de novo quando o visual mudar.
 * Os arquivos ficam em public/game/thumbs/ (WebP, 640×360). A vitrine troca os quadros como um
 * "canal" de TV; com "reduzir movimento" fica só o primeiro.
 */
import type { GameId } from '../../../shared/games/protocol'

export const THUMB_W = 640
export const THUMB_H = 360

const frames = (id: GameId, n: number): readonly string[] => Array.from({ length: n }, (_, i) => `/game/thumbs/${id}-${i + 1}.webp`)

export const THUMBS: Record<GameId, readonly string[]> = {
  poker: frames('poker', 3),
  golf: frames('golf', 3),
  chess: frames('chess', 3),
  checkers: frames('checkers', 3),
  tycoon: frames('tycoon', 3),
  truco: frames('truco', 3),
  shooter: frames('shooter', 3),
  brawl: frames('brawl', 3),
  naval: frames('naval', 3),
  mystery: frames('mystery', 3),
  pool: frames('pool', 3),
  stop: frames('stop', 3),
  velha: frames('velha', 3),
  pife: frames('pife', 3),
  race: frames('race', 3)
}
