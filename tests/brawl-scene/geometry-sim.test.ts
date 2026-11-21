import { describe, expect, it } from 'vitest'
import { ARENAS } from '../../src/shared/games/brawl/arenas'
import { ARENA_IDS } from '../../src/shared/games/brawl/types'
import { ARENA_PLATFORMS } from '../../src/web/game/brawl/scene/geometry'

/** a cena desenha uma cópia da geometria: tem de ser igual à que o sim usa para colidir */
describe('geometria da cena x simulação', () => {
  for (const id of ARENA_IDS) {
    it(`${id}: plataformas iguais às de ARENAS`, () => {
      const cena = ARENA_PLATFORMS[id].map(({ x, y, w, h, thin }) => ({ x, y, w, h, thin }))
      const sim = ARENAS[id].platforms.map(({ x, y, w, h, thin }) => ({ x, y, w, h, thin }))
      expect(cena).toEqual(sim)
    })
  }
})
