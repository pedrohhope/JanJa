import { describe, expect, it } from 'vitest'
import type { PieceType } from '../../src/shared/games/chess/rules'
import { pieceVoxels, voxelMesh } from '../../src/web/game/chess/scene3d/voxels'

const TYPES: PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k']

describe('peças em voxel', () => {
  it('cada peça fica de pé no chão, dentro da casa, e as mais importantes são mais altas', () => {
    const top = (t: PieceType) => Math.max(...pieceVoxels(t).map((v) => v.y))
    for (const t of TYPES) {
      const vs = pieceVoxels(t)
      expect(vs.length).toBeGreaterThan(50)
      expect(Math.min(...vs.map((v) => v.y))).toBe(1)
      for (const v of vs) {
        expect(v.x).toBeGreaterThanOrEqual(0)
        expect(v.x).toBeLessThan(16)
        expect(v.z).toBeGreaterThanOrEqual(0)
        expect(v.z).toBeLessThan(16)
      }
      // o pé é friso (a linha de contorno de baixo)
      expect(vs.filter((v) => v.y === 1).every((v) => v.trim)).toBe(true)
    }
    expect(top('k')).toBeGreaterThan(top('p'))
    expect(top('q')).toBeGreaterThan(top('p'))
  })

  it('peças redondas são simétricas; o cavalo não (tem focinho)', () => {
    const sym = (t: PieceType) => {
      const set = new Set(pieceVoxels(t).map((v) => `${v.x},${v.y},${v.z}`))
      return pieceVoxels(t).every((v) => set.has(`${v.z},${v.y},${v.x}`))
    }
    for (const t of ['p', 'b', 'r', 'q', 'k'] as const) expect(sym(t)).toBe(true)
    expect(sym('n')).toBe(false)
  })

  it('a malha só tem as faces de fora', () => {
    const vs = pieceVoxels('r')
    const m = voxelMesh(vs, 1 / 16)
    const faces = m.index.length / 6
    expect(faces).toBeLessThan(vs.length * 6)
    expect(faces).toBeGreaterThan(0)
    expect(m.pos.length).toBe(faces * 4 * 3)
    expect(m.trim.length).toBe(faces * 4)
    // centrada em x e z
    const xs = m.pos.filter((_, i) => i % 3 === 0)
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 5)
  })
})
