import { describe, expect, it } from 'vitest'
import { MARK_PX, MARK_SPRITES, markRuns } from '../../src/web/game/velha/scene/pixel'

describe('pixel art da velha', () => {
  it('X e O são 7x7 e só usam as letras da legenda', () => {
    for (const s of Object.values(MARK_SPRITES)) {
      expect(s).toHaveLength(MARK_PX)
      for (const row of s) expect(row).toMatch(/^[cs.]{7}$/)
    }
  })

  it('os retângulos cobrem exatamente os pixels pintados', () => {
    for (const m of ['x', 'o'] as const) {
      const painted = MARK_SPRITES[m].join('').replace(/\./g, '').length
      expect(markRuns(m).reduce((a, r) => a + r.w, 0)).toBe(painted)
    }
  })
})
