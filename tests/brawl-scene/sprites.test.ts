import { describe, expect, it } from 'vitest'
import { CHARACTER_IDS } from '../../src/shared/games/brawl/types'
import { ANIM_FRAMES, ANIM_NAMES, HELD_LIST, buildSet } from '../../src/web/game/brawl/scene/anims'
import { FH, FW } from '../../src/web/game/brawl/scene/grid'
import { PROJECTILE_ART, puddleRows, weaponRows } from '../../src/web/game/brawl/scene/items'
import { BPAL, BPAL_KEYS } from '../../src/web/game/brawl/scene/palette'

describe('sprites dos 4 personagens', () => {
  for (const c of CHARACTER_IDS)
    for (const h of HELD_LIST)
      it(`${c} com ${h}: letras na paleta, 32x32 e todas as animações`, () => {
        const set = buildSet(c, h)
        for (const a of ANIM_NAMES) {
          expect(set[a], `${c}/${a}`).toHaveLength(ANIM_FRAMES[a])
          for (const [i, rows] of set[a].entries()) {
            expect(rows, `${c}/${a}/${i} altura`).toHaveLength(FH)
            let solid = 0
            for (const line of rows) {
              expect(line.length, `${c}/${a}/${i} largura`).toBe(FW)
              for (const ch of line) {
                expect(BPAL_KEYS.has(ch), `${c}/${a}/${i}: "${ch}"`).toBe(true)
                if (ch !== '.') solid++
              }
            }
            expect(solid, `${c}/${a}/${i} vazio`).toBeGreaterThan(60)
            // contorno na tinta do jogador
            expect(rows.join('')).toContain('t')
          }
        }
      })

  it('cada golpe tem pelo menos 3 quadros e o forte tem 4', () => {
    for (const a of ANIM_NAMES) {
      if (a.startsWith('leve-') || a.startsWith('ar-')) expect(ANIM_FRAMES[a]).toBeGreaterThanOrEqual(3)
      if (a.startsWith('forte-')) expect(ANIM_FRAMES[a]).toBe(4)
    }
    expect(ANIM_FRAMES.idle).toBe(4)
    expect(ANIM_FRAMES.run).toBe(6)
    expect(ANIM_FRAMES.air).toBe(3)
    expect(ANIM_FRAMES.hurt).toBe(2)
  })

  it('armas, projéteis e poça usam só letras da paleta', () => {
    const all = [...(['vassoura', 'frigideira'] as const).map((w) => weaponRows(w)), ...Object.values(PROJECTILE_ART).flat(), puddleRows(30)]
    for (const rows of all) for (const l of rows) for (const ch of l) expect(ch === '.' || ch in BPAL, ch).toBe(true)
  })
})
