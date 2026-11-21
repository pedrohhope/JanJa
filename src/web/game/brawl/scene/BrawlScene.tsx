import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import type { BrawlInput } from '../../../../shared/games/brawl/types'
import type { BrawlSceneSource } from './contract'
import type { BrawlEngine } from './engine'
import { BrawlInputController, STICK_RADIUS, TOUCH_BUTTONS } from './input'

export interface BrawlSceneProps {
  /** de onde a cena puxa estado, opções e eventos (a cada desenho) */
  source: BrawlSceneSource
  /** chamado uma vez por tick de 60 Hz com a entrada do jogador (o cliente manda ao host e prevê) */
  onInput?: (input: BrawlInput) => void
  /** desliga a captura do teclado (partida acabou, chat aberto...) */
  inputEnabled?: boolean
}

/** Cena Pixi da Briga na Sala. O módulo do Pixi só carrega aqui, por import dinâmico. */
export function BrawlScene(props: BrawlSceneProps): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<BrawlEngine | null>(null)
  const latest = useRef(props)
  latest.current = props
  const stickBase = useRef<HTMLDivElement>(null)
  const stickKnob = useRef<HTMLDivElement>(null)
  const ctl = useRef<BrawlInputController | null>(null)
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
    let dead = false
    let ro: ResizeObserver | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    const c = new BrawlInputController({ enabled: () => latest.current.inputEnabled !== false })
    ctl.current = c
    c.onStick = (s) => {
      const base = stickBase.current
      const knob = stickKnob.current
      if (!base || !knob) return
      base.hidden = !s.active
      if (!s.active) return
      const l = Math.hypot(s.dx, s.dy)
      const k = l > STICK_RADIUS ? STICK_RADIUS / l : 1
      base.style.left = `${s.cx}px`
      base.style.top = `${s.cy}px`
      knob.style.transform = `translate(${s.dx * k}px, ${s.dy * k}px)`
    }
    void import('./engine').then(async ({ BrawlEngine }) => {
      if (dead) return
      const eng = new BrawlEngine(el)
      engine.current = eng
      eng.setSource(latest.current.source)
      const fit = () => {
        const r = el.getBoundingClientRect()
        eng.resize(Math.floor(r.width), Math.floor(r.height))
      }
      ro = new ResizeObserver(fit)
      ro.observe(el)
      fit()
      await eng.init()
      if (dead) return
      fit()
      // uma entrada por tick de 60 Hz, mesmo com o desenho mais lento
      timer = setInterval(() => latest.current.onInput?.(c.poll()), 1000 / 60)
    })
    return () => {
      dead = true
      if (timer) clearInterval(timer)
      ro?.disconnect()
      c.dispose()
      engine.current?.destroy()
      engine.current = null
      el.removeAttribute('data-scene-ready')
    }
  }, [])

  useEffect(() => {
    engine.current?.setSource(props.source)
  })

  const rect = () => host.current?.getBoundingClientRect()
  const onDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch') return
    if ((e.target as HTMLElement).closest('[data-briga-btn]')) return
    const r = rect()
    if (!r) return
    setTouch(true)
    // metade esquerda da tela vira o joystick
    if (e.clientX - r.left > r.width / 2) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    ctl.current?.stickDown(e.pointerId, e.clientX - r.left, e.clientY - r.top)
  }
  const onMove = (e: ReactPointerEvent) => {
    const r = rect()
    if (r) ctl.current?.stickMove(e.pointerId, e.clientX - r.left, e.clientY - r.top)
  }
  const onUp = (e: ReactPointerEvent) => ctl.current?.stickUp(e.pointerId)

  const hold = (bit: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      ctl.current?.setTouchButton(bit, true)
    },
    onPointerUp: () => ctl.current?.setTouchButton(bit, false),
    onPointerCancel: () => ctl.current?.setTouchButton(bit, false),
    onLostPointerCapture: () => ctl.current?.setTouchButton(bit, false)
  })

  const btnStyle = (i: number): React.CSSProperties => ({
    position: 'absolute',
    right: 14 + (i % 3) * 66,
    bottom: 18 + Math.floor(i / 3) * 70,
    width: 58,
    height: 58,
    borderRadius: '50%',
    padding: 0,
    fontSize: 12,
    pointerEvents: 'auto',
    touchAction: 'none',
    border: '2px solid rgba(243,235,221,0.45)',
    background: 'rgba(46,38,34,0.82)',
    color: '#F3EBDD'
  })

  return (
    <div
      ref={host}
      className="briga-scene"
      tabIndex={-1}
      aria-label="Cena da Briga na Sala"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#221C19', touchAction: 'none', userSelect: 'none', outline: 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }} aria-hidden="true">
        <div ref={stickBase} hidden style={{ position: 'absolute', width: 2 * STICK_RADIUS, height: 2 * STICK_RADIUS, margin: `${-STICK_RADIUS}px 0 0 ${-STICK_RADIUS}px`, borderRadius: '50%', border: '2px solid rgba(243,235,221,0.4)', background: 'rgba(34,28,25,0.4)' }}>
          <div ref={stickKnob} style={{ position: 'absolute', left: STICK_RADIUS - 18, top: STICK_RADIUS - 18, width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,201,74,0.6)' }} />
        </div>
        {touch &&
          TOUCH_BUTTONS.map((b, i) => (
            <button key={b.id} type="button" data-briga-btn tabIndex={-1} style={btnStyle(i)} {...hold(b.bit)}>
              {b.label}
            </button>
          ))}
      </div>
    </div>
  )
}
