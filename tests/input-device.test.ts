import { describe, expect, it } from 'vitest'
import { nextDevice, padActive, padFamilyOf, forcedPad } from '../src/web/game/inputDevice'
import { glyphFor, padLabel, STANDARD_INDEX, type PadButton } from '../src/web/ui/glyphLogic'
import { padViewHeld } from '../src/web/game/shooter/scene/input'

describe('padFamilyOf', () => {
  it('ids reais', () => {
    expect(padFamilyOf('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox')
    expect(padFamilyOf('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation')
    expect(padFamilyOf('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo')
    expect(padFamilyOf('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation')
    expect(padFamilyOf('Microsoft X-Box 360 pad (xinput)')).toBe('xbox')
    expect(padFamilyOf('045e-02ea-Microsoft X-Box One S pad')).toBe('xbox')
    expect(padFamilyOf('Joy-Con (L)')).toBe('nintendo')
  })
  it('genérico quando não reconhece', () => {
    expect(padFamilyOf('USB Gamepad (Vendor: 0079 Product: 0011)')).toBe('generico')
    expect(padFamilyOf('')).toBe('generico')
  })
})

describe('troca de dispositivo', () => {
  it('tecla, mouse de verdade, toque e controle', () => {
    expect(nextDevice('controle', { kind: 'tecla' })).toBe('teclado')
    expect(nextDevice('controle', { kind: 'mouse', dx: 2, dy: 2 })).toBe('controle')
    expect(nextDevice('controle', { kind: 'mouse', dx: 5, dy: 0 })).toBe('teclado')
    expect(nextDevice('controle', { kind: 'mouse', dx: 0, dy: 0, down: true })).toBe('teclado')
    expect(nextDevice('teclado', { kind: 'toque' })).toBe('toque')
    expect(nextDevice('toque', { kind: 'controle' })).toBe('controle')
  })
  it('controle parado não conta', () => {
    const idle = { axes: [0.1, -0.2, 0, 0.3], buttons: [{ pressed: false, value: 0 }] }
    expect(padActive(idle)).toBe(false)
    expect(padActive({ ...idle, axes: [0, 0, 0.5, 0] })).toBe(true)
    expect(padActive({ axes: [], buttons: [{ pressed: true, value: 1 }] })).toBe(true)
    expect(padActive({ axes: [], buttons: [{ pressed: false, value: 0.6 }] })).toBe(true)
  })
  it('?pad só vale em dev', () => {
    expect(forcedPad('?pad=xbox', true)).toBe('xbox')
    expect(forcedPad('?pad=playstation', true)).toBe('playstation')
    expect(forcedPad('?pad=xbox', false)).toBeNull()
    expect(forcedPad('?pad=outro', true)).toBeNull()
  })
})

describe('glyphFor', () => {
  it('xbox e genérico: A verde, B vermelho, X azul, Y amarelo', () => {
    for (const f of ['xbox', 'generico'] as const) {
      expect(glyphFor('A', f)).toMatchObject({ label: 'A', tone: 'verde', aria: 'botão A' })
      expect(glyphFor('B', f).tone).toBe('vermelho')
      expect(glyphFor('X', f).tone).toBe('azul')
      expect(glyphFor('Y', f).tone).toBe('amarelo')
      expect(glyphFor('RT', f)).toMatchObject({ label: 'RT', aria: 'gatilho direito' })
    }
  })
  it('playstation', () => {
    expect(glyphFor('A', 'playstation')).toMatchObject({ label: '✕', tone: 'azul' })
    expect(glyphFor('B', 'playstation')).toMatchObject({ label: '○', tone: 'vermelho' })
    expect(glyphFor('X', 'playstation')).toMatchObject({ label: '□', tone: 'rosa' })
    expect(glyphFor('Y', 'playstation')).toMatchObject({ label: '△', tone: 'verde' })
    expect(padLabel('LT', 'playstation')).toBe('L2')
    expect(padLabel('View', 'playstation')).toBe('Share')
    expect(padLabel('Menu', 'playstation')).toBe('Options')
  })
  it('nintendo troca a posição: o de baixo é o B', () => {
    expect(glyphFor('A', 'nintendo').label).toBe('B')
    expect(glyphFor('B', 'nintendo').label).toBe('A')
    expect(glyphFor('X', 'nintendo').label).toBe('Y')
    expect(glyphFor('Y', 'nintendo').label).toBe('X')
    expect(padLabel('RT', 'nintendo')).toBe('ZR')
  })
  it('tudo tem nome falado, sem caixa alta solta nem seta', () => {
    const all: PadButton[] = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'DPad']
    for (const f of ['xbox', 'playstation', 'nintendo', 'generico'] as const)
      for (const b of all) {
        const g = glyphFor(b, f)
        expect(g.aria.length).toBeGreaterThan(3)
        expect(g.aria).not.toMatch(/→|←/)
      }
    expect(STANDARD_INDEX.View).toBe(8)
  })
})

describe('View segura o placar', () => {
  const pad = (view: number) => ({ axes: [], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 8 && view > 0.5, value: i === 8 ? view : 0 })) })
  it('lê o índice 8', () => {
    expect(padViewHeld([pad(1)])).toBe(true)
    expect(padViewHeld([null, pad(0)])).toBe(false)
    expect(padViewHeld([])).toBe(false)
  })
})
