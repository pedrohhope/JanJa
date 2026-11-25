import { describe, expect, it } from 'vitest'
import type { WeaponId } from '../../src/shared/games/shooter/types'
import { SPAL_KEYS } from '../../src/web/game/shooter/scene/palette'
import { FACINGS, WALK_FRAMES } from '../../src/web/game/shooter/scene/sprites'
import { BILLBOARD_H, BILLBOARD_W, bodyFrame3d, facing3d } from '../../src/web/game/shooter/scene3d/billboard'
import { FPS_H, FPS_MUZZLE, FPS_W, fpsGrenadeRows, fpsWeaponRows } from '../../src/web/game/shooter/scene3d/fpsArt'

const WEAPONS: WeaponId[] = ['pistola', 'escopeta', 'sub', 'rifle', 'rolha']

describe('facing3d (y para baixo)', () => {
  // quem olha está em (0, 10) e vê o alvo em (0, 0): a câmera olha para o norte, o leste fica à direita
  it('mira para você: de frente', () => expect(facing3d(0, 10, 0, 0, 0, 1)).toBe('baixo'))
  it('mira para longe: de costas', () => expect(facing3d(0, 10, 0, 0, 0, -1)).toBe('cima'))
  it('mira para o leste, visto do sul: perfil para a direita da tela', () => expect(facing3d(0, 10, 0, 0, 1, 0)).toBe('dir'))
  it('mira para o oeste, visto do sul: perfil para a esquerda da tela', () => expect(facing3d(0, 10, 0, 0, -1, 0)).toBe('esq'))
  it('visto do norte, o leste fica à esquerda da tela', () => {
    expect(facing3d(0, -10, 0, 0, 1, 0)).toBe('esq')
    expect(facing3d(0, -10, 0, 0, -1, 0)).toBe('dir')
    expect(facing3d(0, -10, 0, 0, 0, -1)).toBe('baixo')
  })
  it('visto do oeste olhando para o leste: sul fica à direita', () => {
    expect(facing3d(-10, 0, 0, 0, 0, 1)).toBe('dir')
    expect(facing3d(-10, 0, 0, 0, 0, -1)).toBe('esq')
    expect(facing3d(-10, 0, 0, 0, -1, 0)).toBe('baixo')
    expect(facing3d(-10, 0, 0, 0, 1, 0)).toBe('cima')
  })
  it('no mesmo ponto não quebra', () => expect(facing3d(3, 3, 3, 3, 1, 0)).toBe('baixo'))
})

describe('bodyFrame3d', () => {
  it('toda combinação tem o tamanho e as letras da paleta', () => {
    for (const f of FACINGS)
      for (const w of WEAPONS)
        for (const fr of WALK_FRAMES) {
          const rows = bodyFrame3d(f, w, fr)
          expect(rows).toHaveLength(BILLBOARD_H)
          for (const l of rows) {
            expect(l).toHaveLength(BILLBOARD_W)
            for (const ch of l) expect(SPAL_KEYS.has(ch), `${f} ${w} ${fr}: "${ch}"`).toBe(true)
          }
          expect(rows.join('')).toMatch(/[tT]/)
        }
  })
  it('esquerda é o espelho da direita', () => {
    const d = bodyFrame3d('dir', 'rifle', 0)
    const e = bodyFrame3d('esq', 'rifle', 0)
    expect(e).toEqual(d.map((l) => [...l].reverse().join('')))
  })
  it('de perfil a arma passa do corpo', () => {
    const rows = bodyFrame3d('dir', 'rifle', 0)
    expect(rows.some((l) => l.slice(24).replace(/\./g, '').length > 0)).toBe(true)
  })
})

describe('arma em primeira pessoa', () => {
  const all = [...WEAPONS.map((w) => fpsWeaponRows(w)), fpsGrenadeRows()]
  it('são retangulares, com letras da paleta e tinta na manga', () => {
    for (const rows of all) {
      expect(rows).toHaveLength(FPS_H)
      for (const l of rows) {
        expect(l).toHaveLength(FPS_W)
        for (const ch of l) expect(SPAL_KEYS.has(ch), `"${ch}"`).toBe(true)
      }
      const j = rows.join('')
      expect(j).toMatch(/t/)
      expect(j).toMatch(/s/)
    }
  })
  it('largura entre 40 e 64', () => {
    expect(FPS_W).toBeGreaterThanOrEqual(40)
    expect(FPS_W).toBeLessThanOrEqual(64)
  })
  it('a ponta do cano está dentro do sprite e sobre um pixel desenhado', () => {
    for (const w of WEAPONS) {
      const m = FPS_MUZZLE[w]
      expect(m.x).toBeGreaterThanOrEqual(0)
      expect(m.x).toBeLessThan(FPS_W)
      expect(m.y).toBeGreaterThanOrEqual(0)
      expect(m.y).toBeLessThan(FPS_H)
      const rows = fpsWeaponRows(w)
      const near = [0, 1, 2, 3].some((dy) => rows[m.y + dy]?.[m.x] !== '.')
      expect(near, w).toBe(true)
    }
  })
  it('cada arma é diferente', () => {
    expect(new Set(WEAPONS.map((w) => fpsWeaponRows(w).join('\n'))).size).toBe(WEAPONS.length)
  })
})
