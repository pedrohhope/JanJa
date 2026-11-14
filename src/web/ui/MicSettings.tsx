import { useEffect, useRef, useState } from 'react'
import { useAudioLevel } from '../audio'
import { Icon } from './icons'

interface Props {
  /** sem microfone disponível: não mostra nada */
  disabled: boolean
  /** mic cru (antes do corta-ruído), para o medidor ao vivo */
  rawStream?: MediaStream
  /** supressão de ruído ligada? */
  noiseSuppression: boolean
  /** limiar do corta-ruído (0..1; 0 = desligado) */
  gate: number
  onNoiseSuppression: (on: boolean) => void
  onGate: (value: number) => void
}

/**
 * Ajustes do microfone num popover ao lado do botão do mic (abre para cima, fecha ao clicar fora ou com Esc):
 * um interruptor de supressão de ruído e uma barra de sensibilidade (corta-ruído) com medidor ao vivo, no
 * esquema do Discord. O medidor mostra o nível cru, para a pessoa ver onde colocar o corte.
 */
export function MicSettings({ disabled, rawStream, noiseSuppression, gate, onNoiseSuppression, onGate }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const level = useAudioLevel(rawStream, open)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (disabled) return null

  const pct = Math.round(gate * 100)
  const over = gate > 0 && level >= gate
  return (
    <div ref={root} className={`mic-set ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="icon-btn mic-gear"
        aria-label="Ajustes do microfone"
        aria-expanded={open}
        data-tip={open ? undefined : 'Ajustes do microfone'}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="sliders" size={18} />
      </button>
      {open && (
        <div className="mic-panel" role="dialog" aria-label="Ajustes do microfone">
          <div className="mic-head">Microfone</div>

          <div className="mic-row">
            <div className="mic-row-text">
              <strong>Reduzir ruído de fundo</strong>
              <small>Tira chiado, ventilador e teclado da sua voz</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={noiseSuppression}
              aria-label="Reduzir ruído de fundo"
              className={`switch ${noiseSuppression ? 'on' : ''}`}
              onClick={() => onNoiseSuppression(!noiseSuppression)}
            >
              <span className="knob" />
            </button>
          </div>

          <div className="mic-sens">
            <div className="mic-sens-head">
              <strong>Sensibilidade</strong>
              <small>{pct === 0 ? 'Desligada' : 'Corta abaixo da marca'}</small>
            </div>
            <div className={`mic-meter ${over ? 'over' : ''}`}>
              <div className="mic-meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
              {gate > 0 && <div className="mic-meter-mark" style={{ left: `${pct}%` }} />}
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              aria-label="Sensibilidade do microfone"
              onChange={(e) => onGate(Number(e.target.value) / 100)}
            />
            {!rawStream && <small className="mic-hint">Ligue o microfone para ver o seu nível.</small>}
          </div>
        </div>
      )}
    </div>
  )
}
