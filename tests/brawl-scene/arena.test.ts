import { describe, expect, it } from 'vitest'
import { ARENA_IDS } from '../../src/shared/games/brawl/types'
import { buildArena, composeArena } from '../../src/web/game/brawl/scene/arenaArt'
import { CALM_ENV } from '../../src/web/game/brawl/scene/arenaCommon'
import { ARENA_PLATFORMS } from '../../src/web/game/brawl/scene/geometry'

/** os números do comentário do contrato (src/shared/games/brawl/types.ts) */
const CONTRATO = {
  estante: [
    [96, 188, 288, 46, false],
    [124, 140, 84, null, true],
    [272, 140, 84, null, true],
    [204, 96, 72, null, true]
  ],
  telhado: [
    [64, 196, 352, 50, false],
    [196, 128, 88, null, true],
    [92, 150, 52, null, true],
    [352, 168, 28, 28, false]
  ]
} as const

describe('arenas', () => {
  for (const id of ARENA_IDS) {
    const art = buildArena(id)
    it(`${id}: a geometria é a do contrato`, () => {
      const plats = ARENA_PLATFORMS[id]
      expect(plats).toHaveLength(CONTRATO[id].length)
      CONTRATO[id].forEach(([x, y, w, h, thin], i) => {
        expect(plats[i]).toMatchObject({ x, y, w, thin })
        if (h !== null) expect(plats[i]!.h).toBe(h)
      })
    })

    it(`${id}: as plataformas desenhadas batem com a geometria`, () => {
      const m = art.platformMask
      const at = (x: number, y: number) => m[y * 480 + x] === 1
      const covers = (x: number, y: number) => ARENA_PLATFORMS[id].some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h)
      for (const p of ARENA_PLATFORMS[id]) {
        for (let x = p.x; x < p.x + p.w; x++) {
          expect(at(x, p.y), `${p.art} topo ${x}`).toBe(true)
          const covered = ARENA_PLATFORMS[id].some((q) => x >= q.x && x < q.x + q.w && p.y - 1 >= q.y && p.y - 1 < q.y + q.h)
          expect(at(x, p.y - 1), `${p.art} acima ${x}`).toBe(covered)
          expect(at(x, p.y + p.h - 1), `${p.art} base ${x}`).toBe(true)
        }
        expect(at(p.x - 1, p.y), `${p.art} esquerda`).toBe(covers(p.x - 1, p.y))
        expect(at(p.x + p.w, p.y), `${p.art} direita`).toBe(covers(p.x + p.w, p.y))
      }
      // a máscara é exatamente a união dos retângulos
      for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) if (at(x, y) !== covers(x, y)) throw new Error(`máscara diverge em ${x},${y}`)
    })

    it(`${id}: o topo desenhado da plataforma é opaco e o céu/fundo existe`, () => {
      for (const p of ARENA_PLATFORMS[id]) for (const x of [p.x, p.x + (p.w >> 1), p.x + p.w - 1]) expect(art.back.alpha(x, p.y)).toBe(255)
      expect(art.far.w).toBe(480)
      expect(art.back.h).toBe(270)
    })

    it(`${id}: compõe em vários instantes, anima e é determinística`, () => {
      const a = composeArena(art, 3000)
      const b = composeArena(art, 3000)
      expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true)
      const c = composeArena(art, 9300)
      expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false)
      // totalmente opaco no fim
      for (let i = 3; i < a.data.length; i += 4 * 97) expect(a.data[i]).toBe(255)
    })

    it(`${id}: "reduzir movimento" deixa o fundo parado`, () => {
      const env = { ...CALM_ENV, reduced: true }
      const a = composeArena(art, 1000, env)
      const b = composeArena(art, 20000, env)
      expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true)
      // e o nocaute não muda nada
      const k = composeArena(art, 1000, { ...env, koAge: 100, koSide: 'cima' })
      expect(Buffer.from(a.data).equals(Buffer.from(k.data))).toBe(true)
    })

    it(`${id}: o nocaute faz a arena reagir`, () => {
      const calm = composeArena(art, 5000, CALM_ENV)
      const ko = composeArena(art, 5000, { reduced: false, koAge: 200, koSide: 'direita' })
      expect(Buffer.from(calm.data).equals(Buffer.from(ko.data))).toBe(false)
    })
  }
})
