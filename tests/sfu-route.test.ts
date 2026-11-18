import { describe, expect, it } from 'vitest'
import {
  BACK_TO_MESH_MS,
  FAILURE_COOLDOWN_MS,
  LIMITED_MS,
  MIN_DWELL_MS,
  decideRoute,
  type RouteInputs
} from '../src/web/rtc/route'
import { ridForSize, sendEncodings } from '../src/web/rtc/layers'
import { allowedRid, worstBudget } from '../src/shared/sfu'

const base: RouteInputs = {
  current: 'mesh',
  pref: 'auto',
  viewers: 1,
  limitedMs: 0,
  level: 2,
  sinceSwitchMs: MIN_DWELL_MS,
  fewViewersMs: 0,
  budget: 'ok',
  sfuEnabled: true
}

describe('decideRoute', () => {
  it('fica no P2P com poucos espectadores', () => {
    expect(decideRoute({ ...base, viewers: 2 })).toEqual({ route: 'mesh' })
  })

  it('vai para o servidor com 3 espectadores, mesmo logo depois de trocar', () => {
    expect(decideRoute({ ...base, viewers: 3, sinceSwitchMs: 0 })).toEqual({ route: 'sfu', reason: 'muitos' })
  })

  it('com 2 espectadores só vai se o envio ficar limitado num nível baixo', () => {
    expect(decideRoute({ ...base, viewers: 2, limitedMs: LIMITED_MS, level: 2 }).route).toBe('mesh')
    expect(decideRoute({ ...base, viewers: 2, limitedMs: LIMITED_MS - 1, level: 1 }).route).toBe('mesh')
    expect(decideRoute({ ...base, viewers: 2, limitedMs: LIMITED_MS, level: 1 })).toEqual({ route: 'sfu', reason: 'limitado' })
    expect(decideRoute({ ...base, viewers: 2, limitedMs: LIMITED_MS, level: 1, sinceSwitchMs: 1000 }).route).toBe('mesh')
  })

  it('volta para o P2P só depois de um tempo com 1 espectador e do tempo mínimo na rota', () => {
    const sfu = { ...base, current: 'sfu' as const }
    expect(decideRoute({ ...sfu, viewers: 1, fewViewersMs: BACK_TO_MESH_MS - 1 })).toEqual({ route: 'sfu' })
    expect(decideRoute({ ...sfu, viewers: 1, fewViewersMs: BACK_TO_MESH_MS, sinceSwitchMs: 1000 })).toEqual({ route: 'sfu' })
    expect(decideRoute({ ...sfu, viewers: 1, fewViewersMs: BACK_TO_MESH_MS })).toEqual({ route: 'mesh', reason: 'poucos' })
    expect(decideRoute({ ...sfu, viewers: 2, fewViewersMs: 0 })).toEqual({ route: 'sfu' })
  })

  it('orçamento esgotado, falha recente ou SFU desligado forçam o P2P na hora', () => {
    const sfu = { ...base, current: 'sfu' as const, viewers: 5, sinceSwitchMs: 0 }
    expect(decideRoute({ ...sfu, budget: 'esgotado' })).toEqual({ route: 'mesh', reason: 'orcamento' })
    expect(decideRoute({ ...sfu, sinceFailureMs: 1000 })).toEqual({ route: 'mesh', reason: 'falha' })
    expect(decideRoute({ ...sfu, sfuEnabled: false })).toEqual({ route: 'mesh', reason: 'indisponivel' })
    expect(decideRoute({ ...base, viewers: 5, sinceFailureMs: FAILURE_COOLDOWN_MS }).route).toBe('sfu')
  })

  it('a preferência manual vence os gatilhos, mas não o orçamento', () => {
    expect(decideRoute({ ...base, viewers: 6, pref: 'mesh' }).route).toBe('mesh')
    expect(decideRoute({ ...base, viewers: 1, pref: 'sfu', sinceSwitchMs: 0 })).toEqual({ route: 'sfu', reason: 'preferencia' })
    expect(decideRoute({ ...base, pref: 'sfu', budget: 'esgotado' }).route).toBe('mesh')
    expect(decideRoute({ ...base, current: 'sfu', pref: 'mesh', sinceSwitchMs: 0 })).toEqual({ route: 'mesh', reason: 'preferencia' })
  })

  it('economia não tira do servidor', () => {
    expect(decideRoute({ ...base, viewers: 4, budget: 'economia' }).route).toBe('sfu')
  })
})

describe('camadas', () => {
  it('três camadas numa tela 1080p a 1080p60', () => {
    const enc = sendEncodings(1080, { height: 1080, fps: 60, bitrate: 7_000_000 })
    expect(enc.map((e) => e.rid)).toEqual(['a', 'b', 'c'])
    expect(enc.map((e) => e.scaleResolutionDownBy)).toEqual([1, 1.5, 3])
    expect(enc[0].maxFramerate).toBe(60)
  })

  it('tira camadas que ficariam do tamanho da de cima', () => {
    expect(sendEncodings(720, { height: 1080, fps: 30, bitrate: 3_000_000 }).map((e) => e.rid)).toEqual(['a', 'c'])
    expect(sendEncodings(360, { height: 720, fps: 30, bitrate: 1_000_000 }).map((e) => e.rid)).toEqual(['a'])
  })

  it('a camada `a` segue o nível, não a captura', () => {
    const enc = sendEncodings(1440, { height: 720, fps: 30, bitrate: 2_500_000 })
    expect(enc[0].scaleResolutionDownBy).toBe(2)
    expect(enc.map((e) => e.rid)).toEqual(['a', 'c'])
  })

  it('pede a camada pela área do vídeo', () => {
    expect(ridForSize(320, 180, 'ok')).toBe('c')
    expect(ridForSize(1280, 720, 'ok')).toBe('b')
    expect(ridForSize(1920, 1080, 'ok')).toBe('a')
    // vídeo alto e estreito: conta a altura que cabe num 16:9
    expect(ridForSize(400, 1200, 'ok')).toBe('c')
  })

  it('economia nunca pede `a` e camadas ausentes caem para a mais próxima', () => {
    expect(ridForSize(1920, 1080, 'economia')).toBe('b')
    expect(ridForSize(1280, 720, 'ok', ['a', 'c'])).toBe('c')
    expect(ridForSize(1920, 1080, 'economia', ['a', 'c'])).toBe('c')
    expect(ridForSize(320, 180, 'ok', ['a'])).toBe('a')
  })

  it('helpers do orçamento', () => {
    expect(worstBudget('ok', 'economia')).toBe('economia')
    expect(worstBudget('esgotado', 'economia')).toBe('esgotado')
    expect(allowedRid('a', 'economia')).toBe('b')
    expect(allowedRid('c', 'economia')).toBe('c')
  })
})
