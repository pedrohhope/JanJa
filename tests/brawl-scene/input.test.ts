import { describe, expect, it } from 'vitest'
import { BTN_DODGE, BTN_HEAVY, BTN_JUMP, BTN_LIGHT, BTN_MASK, BTN_PICK } from '../../src/shared/games/brawl/types'
import { GAME_KEYS, axesFromKeys, buttonsFromKeys, composeInput, isTypingTarget, padToInput, stickAxes, type PadSnapshot } from '../../src/web/game/brawl/scene/input'

const keys = (...k: string[]) => new Set(k)
const pad = (axes: number[] = [0, 0, 0, 0], pressed: Record<number, number> = {}): PadSnapshot => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: (pressed[i] ?? 0) > 0.5, value: pressed[i] ?? 0 }))
})

describe('teclado', () => {
  it('gera os bits certos', () => {
    expect(buttonsFromKeys(keys('Space'))).toBe(BTN_JUMP)
    expect(buttonsFromKeys(keys('KeyW'))).toBe(BTN_JUMP)
    expect(buttonsFromKeys(keys('KeyJ'))).toBe(BTN_LIGHT)
    expect(buttonsFromKeys(keys('KeyK'))).toBe(BTN_HEAVY)
    expect(buttonsFromKeys(keys('KeyL'))).toBe(BTN_DODGE)
    expect(buttonsFromKeys(keys('KeyH'))).toBe(BTN_PICK)
    expect(buttonsFromKeys(keys('KeyJ', 'KeyK', 'KeyL', 'KeyH', 'Space'))).toBe(BTN_MASK)
    expect(buttonsFromKeys(keys('KeyS'))).toBe(0)
  })
  it('eixos: A/D e setas; W sobe, S desce (queda rápida)', () => {
    expect(axesFromKeys(keys('KeyD'))).toEqual({ mx: 1, my: 0 })
    expect(axesFromKeys(keys('ArrowLeft'))).toEqual({ mx: -1, my: 0 })
    expect(axesFromKeys(keys('KeyA', 'KeyD'))).toEqual({ mx: 0, my: 0 })
    expect(axesFromKeys(keys('KeyS'))).toEqual({ mx: 0, my: 1 })
    expect(axesFromKeys(keys('ArrowUp'))).toEqual({ mx: 0, my: -1 })
  })
  it('não captura C, M, F nem Tab', () => {
    for (const k of ['KeyC', 'KeyM', 'KeyF', 'Tab']) expect(GAME_KEYS.has(k)).toBe(false)
  })
  it('campo de texto solta o teclado', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
  })
})

describe('controle', () => {
  it('A pula, X leve, Y e B fortes, gatilhos esquiva e pegar', () => {
    expect(padToInput(pad([0, 0, 0, 0], { 0: 1 })).buttons).toBe(BTN_JUMP)
    expect(padToInput(pad([0, 0, 0, 0], { 2: 1 })).buttons).toBe(BTN_LIGHT)
    expect(padToInput(pad([0, 0, 0, 0], { 3: 1 })).buttons).toBe(BTN_HEAVY)
    expect(padToInput(pad([0, 0, 0, 0], { 1: 1 })).buttons).toBe(BTN_HEAVY)
    expect(padToInput(pad([0, 0, 0, 0], { 7: 0.9 })).buttons).toBe(BTN_DODGE)
    expect(padToInput(pad([0, 0, 0, 0], { 6: 0.9 })).buttons).toBe(BTN_PICK)
    expect(padToInput(pad([0, 0, 0, 0], { 7: 0.1 })).buttons).toBe(0)
  })
  it('o eixo vai cru (a zona morta é do sim) e o direcional digital anda', () => {
    expect(padToInput(pad([0.2, -0.9])).axes).toEqual({ mx: 0.2, my: -0.9 })
    expect(padToInput(pad([0, 0, 0, 0], { 15: 1 })).axes).toEqual({ mx: 1, my: 0 })
  })
})

describe('toque e composição', () => {
  it('joystick vira eixo limitado a 1', () => {
    expect(stickAxes(0, 0)).toEqual({ mx: 0, my: 0 })
    const a = stickAxes(300, 0)
    expect(a.mx).toBe(1)
    expect(Math.hypot(stickAxes(300, 300).mx, stickAxes(300, 300).my)).toBeCloseTo(1, 2)
  })
  it('junta as fontes e numera o tick', () => {
    const i = composeInput({ keys: keys('KeyD', 'KeyJ'), pad: { axes: { mx: 0, my: 0 }, buttons: BTN_JUMP }, touch: null }, 7)
    expect(i).toEqual({ seq: 7, mx: 1, my: 0, buttons: BTN_LIGHT | BTN_JUMP })
    const t = composeInput({ keys: keys(), pad: null, touch: { axes: { mx: -0.5, my: 0 }, buttons: BTN_DODGE } }, 8)
    expect(t).toEqual({ seq: 8, mx: -0.5, my: 0, buttons: BTN_DODGE })
  })
})
