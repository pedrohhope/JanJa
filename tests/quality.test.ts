import { describe, expect, it } from 'vitest'
import {
  AUTO_PRESET,
  AUTO_SHARP_PRESET,
  bitrateFor,
  captureConstraints,
  degradationFor,
  fitConstraints,
  isAuto,
  pixelScale,
  presetById,
  prioritizeScreen
} from '../src/web/rtc/quality'

describe('qualidade: captura mantém a proporção da tela', () => {
  it('pede a tela no tamanho nativo (só o fps)', () => {
    const c = captureConstraints(presetById('jogo'))
    expect(c.width).toBeUndefined()
    expect(c.height).toBeUndefined()
    expect(c.frameRate).toEqual({ ideal: 30, max: 30 })
  })
  it('ultrawide 3440×1440 vira 2580×1080, não 1920×1080', () => {
    const c = fitConstraints(presetById('jogo'), 3440, 1440)
    expect(c.width).toEqual({ ideal: 2580, max: 2580 })
    expect(c.height).toEqual({ ideal: 1080, max: 1080 })
  })
  it('16:10 e telas menores que o teto mantêm proporção e não aumentam', () => {
    expect(fitConstraints(presetById('jogo'), 1920, 1200).width).toEqual({ ideal: 1728, max: 1728 })
    const small = fitConstraints(presetById('nitido'), 1920, 1080)
    expect(small.width).toEqual({ ideal: 1920, max: 1920 })
    expect(small.height).toEqual({ ideal: 1080, max: 1080 })
  })
  it('ultrawide 2580×1080 ganha ~34% de bitrate; 16:9 fica igual', () => {
    const jogo = presetById('jogo')
    expect(pixelScale(jogo, 1920, 1080)).toBeCloseTo(1)
    expect(pixelScale(jogo, 2580, 1080)).toBeCloseTo(1.34, 2)
    expect(bitrateFor(jogo, 1, pixelScale(jogo, 2580, 1080))).toBeGreaterThan(10_000_000)
  })
  it('limita a escala entre 0,5 e 1,8 e ignora tamanho desconhecido', () => {
    const jogo = presetById('jogo')
    expect(pixelScale(jogo, 7680, 2160)).toBe(1.8)
    expect(pixelScale(jogo, 640, 360)).toBe(0.5)
    expect(pixelScale(jogo)).toBe(1)
  })
})

describe('qualidade: grade de resolução × fps', () => {
  it('tem 720p, 1080p e 1440p, cada um em 30 e 60 fps, além do texto', async () => {
    const { PRESETS } = await import('../src/web/rtc/quality')
    const grid = PRESETS.filter((p) => p.id !== 'texto').map((p) => `${p.height}p${p.fps}`)
    expect(grid).toEqual(['720p30', '720p60', '1080p30', '1080p60', '1440p30', '1440p60'])
  })
  it('ids antigos continuam valendo e 60 fps custa mais que 30', () => {
    expect(presetById('jogo60').fps).toBe(60)
    expect(presetById('nitido').height).toBe(1440)
    expect(presetById('720p60').bitrate).toBeGreaterThan(presetById('equilibrado').bitrate)
    expect(presetById('1440p60').bitrate).toBeGreaterThan(presetById('nitido').bitrate)
    expect(presetById('nao-existe').id).toBe('equilibrado')
  })
})

describe('degradationFor', () => {
  it('detalhe mantém a resolução; 50 fps ou mais mantém o fps; o resto equilibra', () => {
    expect(degradationFor({ hint: 'detail', fps: 15 })).toBe('maintain-resolution')
    expect(degradationFor({ hint: 'detail', fps: 60 })).toBe('maintain-resolution')
    expect(degradationFor({ hint: 'motion', fps: 60 })).toBe('maintain-framerate')
    expect(degradationFor({ hint: 'motion', fps: 50 })).toBe('maintain-framerate')
    expect(degradationFor({ hint: 'motion', fps: 30 })).toBe('balanced')
    expect(degradationFor({ hint: 'motion', fps: 49 })).toBe('balanced')
  })
  it('vale para os presets de verdade', () => {
    expect(degradationFor(presetById('jogo60'))).toBe('maintain-framerate')
    expect(degradationFor(presetById('720p60'))).toBe('maintain-framerate')
    expect(degradationFor(presetById('jogo'))).toBe('balanced')
    expect(degradationFor(presetById('texto'))).toBe('maintain-resolution')
  })
})

describe('presets automáticos', () => {
  it('fluidez (padrão) e nitidez, com ids, rótulos e frases', () => {
    expect(AUTO_PRESET).toMatchObject({ id: 'auto', label: 'Automático (fluidez)', sub: 'Mantém 60 fps; a resolução é que cede' })
    expect(AUTO_SHARP_PRESET).toMatchObject({ id: 'auto-nitidez', label: 'Automático (nitidez)', sub: 'Para texto e código; o fps é que cede' })
  })
  it('isAuto vale para os dois e para nenhum preset fixo', () => {
    expect(isAuto(AUTO_PRESET)).toBe(true)
    expect(isAuto(AUTO_SHARP_PRESET)).toBe(true)
    expect(isAuto(presetById('jogo60'))).toBe(false)
  })
  it('presetById reconhece os dois (a preferência antiga "auto" é a fluidez)', () => {
    expect(presetById('auto')).toBe(AUTO_PRESET)
    expect(presetById('auto-nitidez')).toBe(AUTO_SHARP_PRESET)
  })
})

describe('prioritizeScreen', () => {
  it('prioridade alta no envio e na rede', () => {
    const enc: RTCRtpEncodingParameters = {}
    prioritizeScreen(enc)
    expect(enc).toMatchObject({ priority: 'high', networkPriority: 'high' })
  })
})
