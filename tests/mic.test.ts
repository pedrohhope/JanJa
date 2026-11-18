import { describe, expect, it } from 'vitest'
import { GATE_DEFAULTS, micAudioConstraints, stepGate, type GateParams } from '../src/web/mic'

describe('micAudioConstraints', () => {
  it('liga e desliga só a supressão de ruído; eco e ganho ficam ligados', () => {
    expect(micAudioConstraints(true)).toMatchObject({ noiseSuppression: true, echoCancellation: true, autoGainControl: true })
    expect(micAudioConstraints(false)).toMatchObject({ noiseSuppression: false, echoCancellation: true, autoGainControl: true })
  })
})

describe('stepGate', () => {
  const p = (threshold: number): GateParams => ({ threshold, ...GATE_DEFAULTS })

  it('sem limiar, fica sempre aberto (ganho 1)', () => {
    expect(stepGate({ gain: 0, open: false }, 0, 1000, p(0))).toEqual({ gain: 1, open: true })
    expect(stepGate({ gain: 1, open: true }, 0, 1000, p(0))).toEqual({ gain: 1, open: true })
  })

  it('abre quando o nível passa do limiar e chega a 1 ao fim do attack', () => {
    const r = stepGate({ gain: 0, open: false }, 0.5, GATE_DEFAULTS.attackMs, p(0.2))
    expect(r.open).toBe(true)
    expect(r.gain).toBeCloseTo(1, 5)
  })

  it('fecha quando o nível cai sob a histerese e chega a 0 ao fim do release', () => {
    const r = stepGate({ gain: 1, open: true }, 0, GATE_DEFAULTS.releaseMs, p(0.4))
    expect(r.open).toBe(false)
    expect(r.gain).toBeCloseTo(0, 5)
  })

  it('mantém o estado na zona de histerese (entre threshold*hold e threshold)', () => {
    const thr = 0.4 // abre em 0.4, fecha abaixo de 0.24
    const mid = 0.3
    expect(stepGate({ gain: 1, open: true }, mid, 30, p(thr)).open).toBe(true)
    expect(stepGate({ gain: 0, open: false }, mid, 30, p(thr)).open).toBe(false)
  })

  it('sobe gradualmente: meio attack = meio caminho', () => {
    const r = stepGate({ gain: 0, open: false }, 1, GATE_DEFAULTS.attackMs / 2, p(0.2))
    expect(r.gain).toBeCloseTo(0.5, 5)
  })

  it('nunca passa de 0..1', () => {
    expect(stepGate({ gain: 0.95, open: true }, 1, 1000, p(0.2)).gain).toBe(1)
    expect(stepGate({ gain: 0.05, open: false }, 0, 1000, p(0.2)).gain).toBe(0)
  })
})
