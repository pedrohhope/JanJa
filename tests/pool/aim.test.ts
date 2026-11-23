import { describe, expect, it } from 'vitest'
import { decodeAim, encodeAim, spinLabel, type PoolAim } from '../../src/web/game/pool/aim'
import { initialOrientation, PIXELS, pixelColor, roll } from '../../src/web/game/pool/scene/ball3d'

const AIM: PoolAim = { ref: 3, mode: 'aim', x: 0.6, y: -0.8, power: 0.42, cue: { x: 20.5, y: 12 }, spin: { x: 0.25, y: -0.5 }, pocket: 4 }

describe('mira ao vivo da sinuca', () => {
  it('vai e volta igual', () => {
    expect(decodeAim(encodeAim(AIM))).toEqual(AIM)
    const place: PoolAim = { ...AIM, mode: 'place', cue: null, pocket: null, power: 0 }
    expect(decodeAim(encodeAim(place))).toEqual(place)
  })

  it('recusa mensagem estranha', () => {
    expect(decodeAim('xyz')).toBeNull()
    expect(decodeAim('pool:{')).toBeNull()
    expect(decodeAim('pool:[1,0,0,0,2,0,[0,0],-1]')).toBeNull() // força acima de 1
    expect(decodeAim('pool:[1,0,0,0,0.5,0,[0,0],9]')).toBeNull() // caçapa que não existe
    expect(decodeAim('pool:[1,0,0,0,0.5,[1],[0,0],-1]')).toBeNull()
    expect(decodeAim(`pool:[1,0,0,0,0.5,0,[0,0],-1]${' '.repeat(400)}`)).toBeNull()
  })

  it('efeito em palavras', () => {
    expect(spinLabel({ x: 0, y: 0 })).toBe('no meio')
    expect(spinLabel({ x: 0, y: -1 })).toBe('puxada')
    expect(spinLabel({ x: 0.5, y: 0.5 })).toBe('seguida à direita')
    expect(spinLabel({ x: -0.5, y: 0 })).toBe('à esquerda')
  })
})

describe('bola em 3D de pixel', () => {
  it('rolar uma volta inteira volta à mesma cara; meia volta muda', () => {
    const m = initialOrientation(11)
    const paint = (o: typeof m) => PIXELS.map((p) => pixelColor(11, o, p)).join()
    let full = m
    // 2 * PI * R em passos pequenos
    for (let i = 0; i < 100; i++) full = roll(full, (2 * Math.PI * 1.12) / 100, 0)
    expect(paint(full)).toBe(paint(m))
    expect(paint(roll(m, Math.PI * 1.12, 0))).not.toBe(paint(m))
  })

  it('a branca é branca com a pinta, a 8 é preta', () => {
    const colors = (id: number) => new Set(PIXELS.filter((p) => !p.edge && !p.gloss).map((p) => pixelColor(id, initialOrientation(id), p)))
    expect(colors(0).size).toBeGreaterThan(1)
    expect([...colors(8)].some((c) => c.startsWith('rgb(3') || c.startsWith('rgb(2'))).toBe(true)
  })
})
