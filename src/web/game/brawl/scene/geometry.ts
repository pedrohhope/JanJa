/**
 * Geometria oficial das arenas, copiada do comentário do contrato (`src/shared/games/brawl/types.ts`).
 * A arte desenha EXATAMENTE isto; a simulação colide com o `arenas.ts` dela (o teste confere os dois).
 */
import type { ArenaId, Platform } from '../../../../shared/games/brawl/types'

export const ARENA_PLATFORMS: Record<ArenaId, readonly Platform[]> = {
  estante: [
    { x: 96, y: 188, w: 288, h: 46, thin: false, art: 'estante-base' },
    { x: 124, y: 140, w: 84, h: 6, thin: true, art: 'prateleira' },
    { x: 272, y: 140, w: 84, h: 6, thin: true, art: 'prateleira' },
    { x: 204, y: 96, w: 72, h: 6, thin: true, art: 'prateleira' }
  ],
  telhado: [
    { x: 64, y: 196, w: 352, h: 50, thin: false, art: 'telhado' },
    { x: 196, y: 128, w: 88, h: 6, thin: true, art: 'caixa-dagua' },
    { x: 92, y: 150, w: 52, h: 6, thin: true, art: 'antena' },
    { x: 352, y: 168, w: 28, h: 28, thin: false, art: 'chamine' }
  ]
}

/** onde cada lutador nasce na largada (pés), em cima das plataformas */
export const ARENA_SPAWN_HINT: Record<ArenaId, { x: number; y: number }[]> = {
  estante: [
    { x: 140, y: 188 },
    { x: 340, y: 188 },
    { x: 160, y: 140 },
    { x: 320, y: 140 }
  ],
  telhado: [
    { x: 110, y: 196 },
    { x: 330, y: 196 },
    { x: 130, y: 150 },
    { x: 240, y: 128 }
  ]
}
