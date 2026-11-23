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

describe('casa sob o ponteiro', () => {
  it('acha o tabuleiro e a casa, inclusive na beirada e no vão', async () => {
    const { cellAt, cellX, cellY, CELL, BOARD } = await import('../../src/web/game/velha/scene/geometry')
    for (let b = 0; b < 9; b++)
      for (let c = 0; c < 9; c++) {
        expect(cellAt(cellX(b, c) + CELL / 2, cellY(b, c) + CELL / 2)).toEqual({ board: b, cell: c })
        // quinas da casa
        expect(cellAt(cellX(b, c) + 0.1, cellY(b, c) + 0.1)).toEqual({ board: b, cell: c })
        expect(cellAt(cellX(b, c) + CELL - 0.1, cellY(b, c) + CELL - 0.1)).toEqual({ board: b, cell: c })
      }
    // no vão entre o tabuleiro 0 e o 1, perto do 0: última coluna do 0
    expect(cellAt(cellX(0, 2) + CELL + 1, cellY(0, 2) + 5)).toEqual({ board: 0, cell: 2 })
    expect(cellAt(-1, 5)).toBeNull()
    expect(cellAt(5, BOARD + 1)).toBeNull()
  })
})
