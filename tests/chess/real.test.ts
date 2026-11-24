import { describe, expect, it } from 'vitest'
import { box, lathe, Path, PIECE_HEIGHT, piecePart, profile, sectorBlock, signedVolume, sphere } from '../../src/web/game/chess/scene3d/lathe'
import { grain, noise } from '../../src/web/game/chess/scene3d/wood'
import { CHEAT_GAP_MS, CHEAT_KEYS, CHEAT_START, cheatDone, cheatStep, type CheatState } from '../../src/web/game/chess/cheat'
import type { PieceType } from '../../src/shared/games/chess/rules'

const TYPES: PieceType[] = ['p', 'r', 'n', 'b', 'q', 'k']

const yRange = (pos: number[]) => {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 1; i < pos.length; i += 3) {
    lo = Math.min(lo, pos[i])
    hi = Math.max(hi, pos[i])
  }
  return { lo, hi }
}

describe('peças torneadas', () => {
  it('cilindro torneado tem o volume certo e as faces para fora', () => {
    const cyl = lathe(new Path().to(0, 0).to(1, 0).to(1, 2).to(0, 2).pts, 256)
    expect(signedVolume(cyl)).toBeCloseTo(Math.PI * 2, 2)
    expect(signedVolume(sphere(1, 1, 64))).toBeCloseTo((4 / 3) * Math.PI, 1)
    expect(signedVolume(box(3, 1, 0, 1, 2, 3))).toBeCloseTo(6, 6)
    // pedaço de anel: área do setor x altura
    expect(signedVolume(sectorBlock(1, 2, 0, 1, 0, Math.PI / 2, 64))).toBeCloseTo((Math.PI / 4) * 3, 2)
  })

  it('toda peça fica de pé no chão, fechada e com a altura certa', () => {
    for (const t of TYPES) {
      const part = piecePart(t)
      const { lo, hi } = yRange(part.pos)
      expect(lo, t).toBeCloseTo(0, 6)
      if (t !== 'n') expect(hi, t).toBeCloseTo(PIECE_HEIGHT[t], 1)
      expect(signedVolume(part), t).toBeGreaterThan(0)
      expect(part.pos.length / 3).toBe(part.shade.length)
      expect(part.uv.length / 2).toBe(part.shade.length)
      // normais unitárias
      for (let i = 0; i < part.normal.length; i += 3) expect(Math.hypot(part.normal[i], part.normal[i + 1], part.normal[i + 2])).toBeCloseTo(1, 4)
    }
  })

  it('perfis começam e terminam no eixo', () => {
    for (const t of TYPES) {
      const p = profile(t)
      expect(p[0]).toMatchObject({ r: 0, y: 0 })
      expect(p[p.length - 1].r).toBeCloseTo(0, 6)
      expect(p.every((x) => x.r >= 0)).toBe(true)
    }
  })

  it('rei maior que dama, que é maior que bispo, torre e peão', () => {
    const h = (t: PieceType) => yRange(piecePart(t).pos).hi
    expect(h('k')).toBeGreaterThan(h('q'))
    expect(h('q')).toBeGreaterThan(h('b'))
    expect(h('b')).toBeGreaterThan(h('r'))
    expect(h('r')).toBeGreaterThan(h('p'))
  })
})

describe('veio da madeira', () => {
  it('é determinístico e fica entre 0 e 1', () => {
    expect(noise(3.3, 7.1, 2)).toBe(noise(3.3, 7.1, 2))
    for (let i = 0; i < 500; i++) {
      const v = grain(i * 3.7, i * 1.3, { seed: 4 })
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(grain(10, 20, { seed: 1 })).not.toBe(grain(10, 20, { seed: 2 }))
  })
})

describe('código secreto', () => {
  const type = (keys: readonly string[], start: CheatState = CHEAT_START, t0 = 1000, dt = 100) => keys.reduce((s, k, i) => cheatStep(s, k, t0 + i * dt), start)

  it('cima, cima, baixo, baixo, esquerda, direita libera', () => {
    expect(cheatDone(type(CHEAT_KEYS))).toBe(true)
    expect(cheatDone(type(CHEAT_KEYS.slice(0, 5)))).toBe(false)
  })

  it('aceita cima a mais no começo e recomeça depois de errar', () => {
    expect(cheatDone(type(['ArrowUp', 'ArrowUp', 'ArrowUp', ...CHEAT_KEYS.slice(2)]))).toBe(true)
    expect(cheatDone(type(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowUp', ...CHEAT_KEYS]))).toBe(true)
    expect(cheatDone(type(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowLeft', 'ArrowRight']))).toBe(false)
    expect(cheatDone(type(['a', ...CHEAT_KEYS.slice(0, 3), 'x', ...CHEAT_KEYS.slice(3)]))).toBe(false)
  })

  it('pausa longa no meio zera', () => {
    const half = type(CHEAT_KEYS.slice(0, 3))
    const late = type(CHEAT_KEYS.slice(3), half, 1200 + CHEAT_GAP_MS + 1)
    expect(cheatDone(late)).toBe(false)
  })
})
