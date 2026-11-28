import '@fontsource-variable/pixelify-sans/wght.css'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { RaceInput } from '../../../../shared/games/race/types'
import { RaceEngine, type RaceRenderOpts, type RaceSceneSource } from './engine'
import { RaceInputController, TOUCH_BUTTONS, type TouchButtonId } from './input'

export interface RaceSceneProps {
  /** de onde a cena puxa o quadro e os eventos */
  source: RaceSceneSource
  /** nomes e cores por slot (lido a cada desenho) */
  opts: RaceRenderOpts
  /** chamado uma vez por tick de 60 Hz com a entrada (o cliente manda ao host e prevê) */
  onInput?: (input: RaceInput) => void
  /** desliga a captura do teclado (miniatura, corrida acabou...) */
  inputEnabled?: boolean
}

const ARROW: Record<TouchButtonId, string> = { esquerda: '◀', direita: '▶', frear: 'Frear', acelerar: 'Acelerar' }

/** Cena da Corrida na Sala (canvas 2D). Carrega junto com o pedaço da corrida, sem biblioteca de desenho. */
export function RaceScene(props: RaceSceneProps): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const ctl = useRef<RaceInputController | null>(null)
  const [touch, setTouch] = useState(() => {
    try {
      return navigator.maxTouchPoints > 0 && window.matchMedia('(hover: none)').matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    const el = host.current
    if (!el) return
    const c = new RaceInputController({ enabled: () => latest.current.inputEnabled !== false })
    ctl.current = c
    const eng = new RaceEngine(el, latest.current.source, () => latest.current.opts)
    const fit = () => {
      const r = el.getBoundingClientRect()
      eng.resize(Math.floor(r.width), Math.floor(r.height))
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    const timer = setInterval(() => latest.current.onInput?.(c.poll()), 1000 / 60)
    return () => {
      clearInterval(timer)
      ro.disconnect()
      c.dispose()
      eng.destroy()
      el.removeAttribute('data-scene-ready')
    }
  }, [])

  const hold = (id: TouchButtonId) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      ctl.current?.setTouch(id, true)
    },
    onPointerUp: () => ctl.current?.setTouch(id, false),
    onPointerCancel: () => ctl.current?.setTouch(id, false),
    onLostPointerCapture: () => ctl.current?.setTouch(id, false)
  })

  return (
    <div
      ref={host}
      className="corrida-scene"
      tabIndex={-1}
      aria-label="Cena da Corrida na Sala"
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') setTouch(true)
      }}
    >
      {touch && props.inputEnabled !== false && (
        <div className="corrida-touch" aria-hidden="true">
          {(['left', 'right'] as const).map((side) => (
            <div key={side} className={`corrida-pad ${side}`}>
              {TOUCH_BUTTONS.filter((b) => b.side === side).map((b) => (
                <button key={b.id} type="button" tabIndex={-1} className={`corrida-btn ${b.id}`} {...hold(b.id)}>
                  {ARROW[b.id]}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
