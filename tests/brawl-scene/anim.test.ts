import { describe, expect, it } from 'vitest'
import type { FighterAction } from '../../src/shared/games/brawl/types'
import { CHARACTER_IDS, WEAPON_IDS } from '../../src/shared/games/brawl/types'
import { attackAnim, attackFrame, defaultTiming, parseMove, pickAnim } from '../../src/web/game/brawl/scene/animate'
import { ANIM_FRAMES } from '../../src/web/game/brawl/scene/anims'
import { sampleFighter } from '../../src/web/game/brawl/scene/sample'

describe('golpes e animações', () => {
  it('lê os formatos de MoveId do contrato', () => {
    expect(parseMove('vassoura:lado')).toMatchObject({ heavy: false, air: false, dir: 'lado', held: 'vassoura' })
    expect(parseMove('vassoura:ar-cima')).toMatchObject({ heavy: false, air: true, dir: 'cima' })
    expect(parseMove('jan:vassoura:neutro')).toMatchObject({ heavy: true, char: 'jan', held: 'vassoura', dir: 'neutro' })
    expect(parseMove('mao:forte-baixo')).toMatchObject({ heavy: true, dir: 'baixo', char: null })
    expect(parseMove('nada')).toBeNull()
  })

  it('todo golpe possível cai numa animação que existe, com quadro válido em todo tick', () => {
    const helds = ['mao', ...WEAPON_IDS]
    const ids: string[] = []
    for (const h of helds) {
      for (const d of ['neutro', 'lado', 'baixo']) ids.push(`${h}:${d}`, `${h}:forte-${d}`, `${h}:ar-${d}`)
      ids.push(`${h}:ar-cima`)
      for (const c of CHARACTER_IDS) for (const d of ['neutro', 'lado', 'baixo']) ids.push(`${c}:${h}:${d}`)
    }
    for (const id of ids) {
      const m = parseMove(id)!
      expect(m, id).not.toBeNull()
      const t = defaultTiming(m)
      const anim = attackAnim(m, false)
      expect(ANIM_FRAMES[anim], id).toBeGreaterThan(0)
      for (let tk = 0; tk < t.startup + t.active + t.recovery; tk++) {
        const fr = attackFrame(anim, tk, t)
        expect(fr).toBeGreaterThanOrEqual(0)
        expect(fr).toBeLessThan(ANIM_FRAMES[anim])
      }
      // startup -> ativo -> recuperação, nessa ordem
      expect(attackFrame(anim, 0, t)).toBeLessThanOrEqual(attackFrame(anim, t.startup, t))
      expect(attackFrame(anim, t.startup, t)).toBeLessThan(attackFrame(anim, t.startup + t.active, t))
    }
  })

  it('pickAnim cobre todas as ações e sempre devolve quadro válido', () => {
    const acts: FighterAction[] = ['parado', 'correndo', 'no-ar', 'parede', 'esquiva', 'golpe', 'atordoado', 'fora', 'eliminado']
    for (const a of acts)
      for (const tick of [0, 7, 50, 400, 999]) {
        const f = sampleFighter(0, 'jan', { action: a, move: a === 'golpe' ? 'mao:forte-lado' : null, moveTick: 9, vx: 7, vy: 2, actionTick: 0, wallSide: 1 })
        const p = pickAnim(f, tick, undefined, tick === 7)
        expect(ANIM_FRAMES[p.anim]).toBeGreaterThan(p.frame)
        expect(p.frame).toBeGreaterThanOrEqual(0)
      }
  })

  it('carregando o forte usa a animação de carga e o tique aparece depois de um tempo parado', () => {
    const f = sampleFighter(0, 'teve', { action: 'golpe', move: 'mao:forte-neutro', moveTick: 0, charge: 30 })
    expect(pickAnim(f, 100).anim).toBe('charge')
    expect(pickAnim(f, 100).charge).toBeGreaterThan(0)
    const idle = sampleFighter(0, 'teve', { action: 'parado', actionTick: 0 })
    expect(pickAnim(idle, 10).anim).toBe('idle')
    expect(pickAnim(idle, 400).anim).toBe('tique')
  })
})
