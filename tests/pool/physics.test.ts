import { describe, expect, it } from 'vitest'
import { aimGuide, canPlace, clampSpin, newLog, R, simulate, step, strike, TABLE_H, TABLE_W, type PBall } from '../../src/shared/games/pool/physics'
import { rack } from '../../src/shared/games/pool/rules'
import { seededRng } from '../../src/shared/games/types'

const ball = (id: number, x: number, y: number): PBall => ({ id, x, y, vx: 0, vy: 0, in: false })

describe('física da sinuca', () => {
  it('tacada reta na direção da caçapa do canto encaçapa a bola', () => {
    const r = simulate([ball(0, 20, 20), ball(1, 10, 10)], -1, -1, 0.5)
    expect(r.log.firstHit).toBe(1)
    expect(r.log.pocketed.map((p) => p.id)).toContain(1)
    expect(r.log.pocketed.find((p) => p.id === 1)?.pocket).toBe(0)
  })

  it('choque de frente: a outra segue reta; com puxada a branca volta, com seguida ela vai atrás', () => {
    const shot = (y: number) => {
      const r = simulate([ball(0, 30, 25), ball(5, 40, 25)], 1, 0, 0.15, { x: 0, y })
      return { cue: r.balls.find((b) => b.id === 0)!, five: r.balls.find((b) => b.id === 5)! }
    }
    const center = shot(0)
    expect(center.five.x).toBeGreaterThan(45)
    expect(Math.abs(center.five.y - 25)).toBeLessThan(0.01)
    // tacada no meio: a branca rola um pouco atrás, bem menos que a outra
    expect(center.cue.x).toBeLessThan(center.five.x - 20)
    expect(shot(-1).cue.x).toBeLessThan(33)
    expect(shot(1).cue.x).toBeGreaterThan(center.cue.x + 5)
    // as bolas guardadas não levam giro
    expect(Object.keys(center.cue).sort()).toEqual(['id', 'in', 'vx', 'vy', 'x', 'y'])
  })

  it('efeito lateral entorta a volta da tabela para o lado do efeito', () => {
    const go = (x: number) => simulate([ball(0, 30, 25)], 0, -1, 0.4, { x, y: 0 }).balls[0].x
    expect(go(0)).toBeCloseTo(30, 5)
    expect(go(1)).toBeGreaterThan(35)
    expect(go(-0.4)).toBeLessThan(25)
  })

  it('efeito acima de 1 é limitado', () => {
    expect(clampSpin({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 })
    expect(clampSpin(undefined)).toEqual({ x: 0, y: 0 })
  })

  it('bate na tabela e volta; não sai da mesa', () => {
    const r = simulate([ball(0, 40, 25)], 0, 1, 0.3)
    const cue = r.balls[0]
    expect(r.log.pocketed).toHaveLength(0)
    expect(cue.y).toBeGreaterThan(R - 1e-9)
    expect(cue.y).toBeLessThan(TABLE_H - R + 1e-9)
  })

  it('determinística: a mesma tacada dá exatamente o mesmo resultado', () => {
    const balls = [ball(0, 25, 25), ...rack(seededRng(3)).filter((b) => b.id !== 0)]
    const a = simulate(balls, 1, 0.013, 1)
    const b = simulate(balls, 1, 0.013, 1)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('quebra forte: bolas espalham, ficam na mesa ou na caçapa e não se sobrepõem', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const balls = rack(seededRng(seed))
      const r = simulate(balls, 1, (seed - 10) * 0.004, 1)
      const on = r.balls.filter((b) => !b.in)
      for (const b of on) {
        expect(b.x).toBeGreaterThan(0)
        expect(b.x).toBeLessThan(TABLE_W)
        expect(b.y).toBeGreaterThan(0)
        expect(b.y).toBeLessThan(TABLE_H)
      }
      for (let i = 0; i < on.length; i++)
        for (let j = i + 1; j < on.length; j++) expect(Math.hypot(on[i].x - on[j].x, on[i].y - on[j].y)).toBeGreaterThan(2 * R - 0.05)
      expect(r.log.firstHit).not.toBeNull()
    }
  })

  it('a linha de mira acerta a bola e a direção bate com a simulação', () => {
    const balls = [ball(0, 20, 25), ball(3, 40, 26)]
    const g = aimGuide(balls, 1, 0)!
    expect(g.hit).toBe(3)
    // roda até o choque e compara a velocidade da bola atingida com a previsão
    const w = balls.map((b) => ({ ...b }))
    const log = newLog()
    strike(w, 1, 0, 0.3)
    while (log.firstHit === null && log.steps < 5000) step(w, log)
    const three = w.find((b) => b.id === 3)!
    const len = Math.hypot(three.vx, three.vy)
    expect(three.vx / len).toBeCloseTo(g.object!.x, 1)
    expect(three.vy / len).toBeCloseTo(g.object!.y, 1)
  })

  it('a mira mostra a branca voltando com puxada, seguindo com seguida, e a volta da tabela', () => {
    const balls = [ball(0, 20, 25), ball(3, 30, 25)]
    expect(aimGuide(balls, 1, 0, { x: 0, y: -1 }, 0.5)!.cue!.x).toBeCloseTo(-1, 5)
    expect(aimGuide(balls, 1, 0, { x: 0, y: 1 }, 0.5)!.cue!.x).toBeCloseTo(1, 5)
    const rail = aimGuide([ball(0, 30, 25), ball(5, 78, 25)], 1, -1)!
    expect(rail.hit).toBeNull()
    expect(rail.ghost.y).toBeCloseTo(R, 5)
    expect(rail.bounce?.hit).toBe(5)
  })

  it('não dá para pôr a branca em cima de outra bola nem fora da mesa', () => {
    const balls = [ball(0, 20, 25), ball(1, 50, 25)]
    expect(canPlace(balls, 50.5, 25)).toBe(false)
    expect(canPlace(balls, 60, 25)).toBe(true)
    expect(canPlace(balls, 0.5, 25)).toBe(false)
    expect(canPlace(balls, 60, 25, 25)).toBe(false) // atrás da linha na quebra
  })
})
