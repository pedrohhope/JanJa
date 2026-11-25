import { describe, expect, it } from 'vitest'
import { KEY_TURN_SPEED, MOUSE_SENS, PAD_TURN_SPEED } from '../../src/web/game/shooter/scene3d/contract3d'
import { aimToYaw, keyTurnDelta, localMoveFromKeys, mouseDelta, padLookDelta, rotateMove, wrapAngle, yawToAim } from '../../src/web/game/shooter/scene3d/fpsInput'

const keys = (...k: string[]) => new Set(k)

describe('wrapAngle', () => {
  it('mantém em -π..π', () => {
    expect(wrapAngle(0.5)).toBeCloseTo(0.5)
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5)
    expect(wrapAngle(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5)
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI) // ±π
    for (const a of [-50, -7, 7, 50, 1e3]) expect(Math.abs(wrapAngle(a))).toBeLessThanOrEqual(Math.PI + 1e-9)
  })
})

describe('yaw <-> mira', () => {
  it('yaw 0 = leste, π/2 = sul', () => {
    expect(yawToAim(0).x).toBeCloseTo(1)
    expect(yawToAim(0).y).toBeCloseTo(0)
    expect(yawToAim(Math.PI / 2).y).toBeCloseTo(1)
  })
  it('ida e volta', () => {
    for (const y of [-3, -1.2, 0, 0.7, 2.5]) {
      const a = yawToAim(y)
      expect(aimToYaw(a.x, a.y)).toBeCloseTo(y)
    }
  })
})

describe('rotateMove', () => {
  it('yaw 0: frente = +x, direita = +y', () => {
    const f = rotateMove(1, 0, 0)
    expect(f.x).toBeCloseTo(1)
    expect(f.y).toBeCloseTo(0)
    const r = rotateMove(0, 1, 0)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(1)
  })
  it('yaw π/2: frente = +y, direita = -x', () => {
    const f = rotateMove(1, 0, Math.PI / 2)
    expect(f.x).toBeCloseTo(0)
    expect(f.y).toBeCloseTo(1)
    const r = rotateMove(0, 1, Math.PI / 2)
    expect(r.x).toBeCloseTo(-1)
    expect(r.y).toBeCloseTo(0)
  })
  it('diagonal limitada a 1', () => {
    const d = rotateMove(1, 1, 0.3)
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1)
  })
})

describe('localMoveFromKeys', () => {
  it('WASD e setas cima/baixo', () => {
    expect(localMoveFromKeys(keys('KeyW'))).toEqual({ f: 1, s: 0 })
    expect(localMoveFromKeys(keys('ArrowUp'))).toEqual({ f: 1, s: 0 })
    expect(localMoveFromKeys(keys('KeyS'))).toEqual({ f: -1, s: 0 })
    expect(localMoveFromKeys(keys('ArrowDown'))).toEqual({ f: -1, s: 0 })
    expect(localMoveFromKeys(keys('KeyA'))).toEqual({ f: 0, s: -1 })
    expect(localMoveFromKeys(keys('KeyD'))).toEqual({ f: 0, s: 1 })
  })
  it('setas laterais não andam', () => {
    expect(localMoveFromKeys(keys('ArrowLeft', 'ArrowRight'))).toEqual({ f: 0, s: 0 })
  })
  it('diagonal e opostos', () => {
    const d = localMoveFromKeys(keys('KeyW', 'KeyD'))
    expect(Math.hypot(d.f, d.s)).toBeCloseTo(1)
    expect(localMoveFromKeys(keys('KeyW', 'KeyS'))).toEqual({ f: 0, s: 0 })
  })
})

describe('padLookDelta', () => {
  it('zona morta = 0', () => {
    expect(padLookDelta(0, 16)).toBe(0)
    expect(padLookDelta(0.2, 16)).toBe(0)
    expect(padLookDelta(-0.25, 16)).toBe(0)
  })
  it('máximo = PAD_TURN_SPEED * dt, com sinal', () => {
    expect(padLookDelta(1, 1000)).toBeCloseTo(PAD_TURN_SPEED)
    expect(padLookDelta(-1, 500)).toBeCloseTo(-PAD_TURN_SPEED / 2)
  })
  it('curva: meio curso gira bem menos que metade', () => {
    expect(padLookDelta(0.64, 1000)).toBeLessThan(PAD_TURN_SPEED * 0.4)
    expect(padLookDelta(0.64, 1000)).toBeGreaterThan(0)
  })
})

describe('keyTurnDelta', () => {
  it('setas giram', () => {
    expect(keyTurnDelta(keys('ArrowRight'), 1000)).toBeCloseTo(KEY_TURN_SPEED)
    expect(keyTurnDelta(keys('ArrowLeft'), 500)).toBeCloseTo(-KEY_TURN_SPEED / 2)
    expect(keyTurnDelta(keys('ArrowLeft', 'ArrowRight'), 1000)).toBe(0)
    expect(keyTurnDelta(keys('KeyA', 'KeyD'), 1000)).toBe(0)
  })
})

describe('mouseDelta', () => {
  it('escala e filtra picos', () => {
    expect(mouseDelta(100)).toBeCloseTo(100 * MOUSE_SENS)
    expect(mouseDelta(-50)).toBeCloseTo(-50 * MOUSE_SENS)
    expect(mouseDelta(300)).toBeCloseTo(300 * MOUSE_SENS)
    expect(mouseDelta(301)).toBe(0)
    expect(mouseDelta(-5000)).toBe(0)
    expect(mouseDelta(NaN)).toBe(0)
  })
})
