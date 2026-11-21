/** Geometria oficial das arenas (a cena desenha EXATAMENTE isto; o sim colide com isto). Veja o comentário em types.ts. */
import type { ArenaDef, ArenaId } from './types'

export const ARENAS: Record<ArenaId, ArenaDef> = {
  estante: {
    id: 'estante',
    name: 'A Estante',
    platforms: [
      { x: 96, y: 188, w: 288, h: 46, thin: false, art: 'estante-base' },
      { x: 124, y: 140, w: 84, h: 6, thin: true, art: 'prateleira' },
      { x: 272, y: 140, w: 84, h: 6, thin: true, art: 'prateleira' },
      { x: 204, y: 96, w: 72, h: 6, thin: true, art: 'prateleira' }
    ],
    // 12 pontos: pares alternam esquerda/direita para os primeiros ficarem longe um do outro
    spawns: [
      { x: 120, y: 188 },
      { x: 360, y: 188 },
      { x: 166, y: 140 },
      { x: 314, y: 140 },
      { x: 240, y: 96 },
      { x: 200, y: 188 },
      { x: 280, y: 188 },
      { x: 160, y: 188 },
      { x: 320, y: 188 },
      { x: 240, y: 188 },
      { x: 140, y: 140 },
      { x: 340, y: 140 }
    ],
    respawn: { x: 240, y: 40 },
    blast: { left: -70, right: 550, top: -90, bottom: 330 },
    dropX: [116, 364]
  },
  telhado: {
    id: 'telhado',
    name: 'O Telhado',
    platforms: [
      { x: 64, y: 196, w: 352, h: 50, thin: false, art: 'telhado' },
      { x: 196, y: 128, w: 88, h: 6, thin: true, art: 'caixa-dagua' },
      { x: 92, y: 150, w: 52, h: 6, thin: true, art: 'antena' },
      { x: 352, y: 168, w: 28, h: 28, thin: false, art: 'chamine' }
    ],
    spawns: [
      { x: 100, y: 196 },
      { x: 390, y: 196 },
      { x: 240, y: 128 },
      { x: 118, y: 150 },
      { x: 366, y: 168 },
      { x: 170, y: 196 },
      { x: 320, y: 196 },
      { x: 240, y: 196 },
      { x: 205, y: 196 },
      { x: 290, y: 196 },
      { x: 76, y: 196 },
      { x: 405, y: 196 }
    ],
    respawn: { x: 240, y: 40 },
    blast: { left: -80, right: 560, top: -90, bottom: 330 },
    dropX: [84, 396]
  }
}
