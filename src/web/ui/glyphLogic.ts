/**
 * Dicas de botão do controle. A chave é o nome semântico do layout Xbox (mapeamento "standard"
 * do navegador, índices 0..17); `glyphFor` traduz para a família do controle em uso.
 */
import type { PadFamily } from '../game/inputDevice'

export type PadButton = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'View' | 'Menu' | 'LS' | 'RS' | 'DPad'

export type GlyphTone = 'verde' | 'vermelho' | 'azul' | 'amarelo' | 'rosa' | 'neutro' | 'escuro'
export type GlyphShape = 'face' | 'pill' | 'stick' | 'dpad'

export interface GlyphSpec {
  /** texto do botão (ou o símbolo ✕ ○ □ △ no PlayStation, desenhado em SVG) */
  label: string
  /** nome falado, para leitor de tela */
  aria: string
  tone: GlyphTone
  shape: GlyphShape
}

/** índice do botão no mapeamento "standard" */
export const STANDARD_INDEX: Record<PadButton, number> = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Menu: 9, LS: 10, RS: 11, DPad: 12 }

const XBOX_TONE: Record<'A' | 'B' | 'X' | 'Y', GlyphTone> = { A: 'verde', B: 'vermelho', X: 'azul', Y: 'amarelo' }
const PS_FACE: Record<'A' | 'B' | 'X' | 'Y', { label: string; aria: string; tone: GlyphTone }> = {
  A: { label: '✕', aria: 'botão xis', tone: 'azul' },
  B: { label: '○', aria: 'botão bolinha', tone: 'vermelho' },
  X: { label: '□', aria: 'botão quadrado', tone: 'rosa' },
  Y: { label: '△', aria: 'botão triângulo', tone: 'verde' }
}
// Nintendo: o botão de baixo é o B, o da direita é o A, o da esquerda é o Y e o de cima é o X
const NINTENDO_FACE: Record<'A' | 'B' | 'X' | 'Y', string> = { A: 'B', B: 'A', X: 'Y', Y: 'X' }

type Names = { label: string; aria: string }
const SHARED: Record<'LS' | 'RS' | 'DPad', Names> = {
  LS: { label: 'L', aria: 'analógico esquerdo' },
  RS: { label: 'R', aria: 'analógico direito' },
  DPad: { label: '', aria: 'direcional' }
}
const SHOULDER: Record<PadFamily, Record<'LB' | 'RB' | 'LT' | 'RT' | 'View' | 'Menu', Names>> = {
  xbox: {
    LB: { label: 'LB', aria: 'botão LB' },
    RB: { label: 'RB', aria: 'botão RB' },
    LT: { label: 'LT', aria: 'gatilho esquerdo' },
    RT: { label: 'RT', aria: 'gatilho direito' },
    View: { label: 'View', aria: 'botão View' },
    Menu: { label: 'Menu', aria: 'botão Menu' }
  },
  generico: {
    LB: { label: 'LB', aria: 'botão LB' },
    RB: { label: 'RB', aria: 'botão RB' },
    LT: { label: 'LT', aria: 'gatilho esquerdo' },
    RT: { label: 'RT', aria: 'gatilho direito' },
    View: { label: 'View', aria: 'botão View' },
    Menu: { label: 'Menu', aria: 'botão Menu' }
  },
  playstation: {
    LB: { label: 'L1', aria: 'botão L1' },
    RB: { label: 'R1', aria: 'botão R1' },
    LT: { label: 'L2', aria: 'gatilho esquerdo' },
    RT: { label: 'R2', aria: 'gatilho direito' },
    View: { label: 'Share', aria: 'botão Share' },
    Menu: { label: 'Options', aria: 'botão Options' }
  },
  nintendo: {
    LB: { label: 'L', aria: 'botão L' },
    RB: { label: 'R', aria: 'botão R' },
    LT: { label: 'ZL', aria: 'gatilho esquerdo' },
    RT: { label: 'ZR', aria: 'gatilho direito' },
    View: { label: '−', aria: 'botão menos' },
    Menu: { label: '+', aria: 'botão mais' }
  }
}

export function glyphFor(b: PadButton, family: PadFamily): GlyphSpec {
  if (b === 'A' || b === 'B' || b === 'X' || b === 'Y') {
    if (family === 'playstation') return { ...PS_FACE[b], shape: 'face' }
    if (family === 'nintendo') {
      const l = NINTENDO_FACE[b]
      return { label: l, aria: `botão ${l}`, tone: 'neutro', shape: 'face' }
    }
    return { label: b, aria: `botão ${b}`, tone: XBOX_TONE[b], shape: 'face' }
  }
  if (b === 'LS' || b === 'RS') return { ...SHARED[b], tone: 'escuro', shape: 'stick' }
  if (b === 'DPad') return { ...SHARED.DPad, tone: 'escuro', shape: 'dpad' }
  return { ...SHOULDER[family][b], tone: 'escuro', shape: 'pill' }
}

/** nome curto para texto puro (tooltip data-tip): "View", "Share", "A", "✕"... */
export const padLabel = (b: PadButton, family: PadFamily): string => glyphFor(b, family).label
