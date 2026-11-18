import type { ReactElement } from 'react'
import type { PadFamily } from '../game/inputDevice'
import { useInputDevice } from '../game/useInputDevice'
import { glyphFor, type PadButton } from './glyphLogic'

export { glyphFor, padLabel, type PadButton } from './glyphLogic'

const SYMBOL_PATH: Record<string, ReactElement> = {
  '✕': <path d="M5 5l10 10M15 5L5 15" />,
  '○': <circle cx="10" cy="10" r="5.6" />,
  '□': <rect x="4.6" y="4.6" width="10.8" height="10.8" />,
  '△': <path d="M10 3.8L16.2 15.4H3.8Z" />
}

function Symbol({ label }: { label: string }): ReactElement {
  return (
    <svg viewBox="0 0 20 20" className="glyph-sym" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {SYMBOL_PATH[label]}
    </svg>
  )
}

function StickIcon({ side }: { side: 'L' | 'R' }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="glyph-ico" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
      <circle cx="12" cy="12" r="6.2" fill="currentColor" opacity="0.9" />
      <text x="12" y="15" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="var(--wall)">
        {side}
      </text>
    </svg>
  )
}

function DPadIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="glyph-ico" aria-hidden="true">
      <path fill="currentColor" d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" opacity="0.9" />
      <path fill="var(--wall)" d="M12 4.6l1.9 2.4h-3.8zM12 19.4L10.1 17h3.8zM4.6 12L7 10.1v3.8zM19.4 12L17 13.9v-3.8z" />
    </svg>
  )
}

/**
 * Botão do controle desenhado como no controle. `b` é o nome do layout Xbox; a família vem do
 * controle em uso (ou da prop `family`, para ajuda e testes).
 */
export function Glyph({ b, family }: { b: PadButton; family?: PadFamily }): ReactElement {
  const cur = useInputDevice().family
  const g = glyphFor(b, family ?? cur)
  return (
    <span className={`glyph ${g.shape} tom-${g.tone}`} role="img" aria-label={g.aria}>
      {g.shape === 'stick' ? <StickIcon side={b === 'LS' ? 'L' : 'R'} /> : g.shape === 'dpad' ? <DPadIcon /> : g.label in SYMBOL_PATH ? <Symbol label={g.label} /> : <span aria-hidden="true">{g.label}</span>}
    </span>
  )
}

/** tecla de teclado, no mesmo estilo (`<Key k="Espaço" />`) */
export function Key({ k }: { k: string }): ReactElement {
  return <kbd className="key">{k}</kbd>
}
