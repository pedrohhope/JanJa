import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { BTN_DASH, BTN_FIRE, BTN_GRENADE } from '../../../../shared/games/shooter/types'
import { loadChunk } from '../../../version'
import type { ShooterSceneProps } from '../contract'
import { STICK_RADIUS } from '../scene/input'
import type { Shooter3DEngine } from './engine'

interface StickState {
  active: boolean
  cx: number
  cy: number
  x: number
  y: number
}

/** Cena do tiro em primeira pessoa. O Three só é carregado aqui, por import dinâmico. */
export function Shooter3DScene(props: ShooterSceneProps): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<Shooter3DEngine | null>(null)
  const latest = useRef(props)
  latest.current = props
  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const [locked, setLocked] = useState(false)
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let dead = false
    let ro: ResizeObserver | null = null
    try {
      if (navigator.maxTouchPoints > 0 && window.matchMedia('(hover: none)').matches) {
        el.classList.add('is-touch')
        setIsTouch(true)
      }
    } catch {
      /* sem matchMedia */
    }
    void loadChunk(() => import('./engine')).then(({ Shooter3DEngine }) => {
      if (dead) return
      const eng = new Shooter3DEngine(el)
      engine.current = eng
      eng.onLockChange = (l) => setLocked(l)
      eng.onTouchUi = (t) => {
        el.classList.add('is-touch')
        setIsTouch(true)
        paintStick(t.move, base.current, knob.current)
      }
      eng.setProps(latest.current)
      const fit = () => {
        const r = el.getBoundingClientRect()
        eng.resize(Math.floor(r.width), Math.floor(r.height))
      }
      ro = new ResizeObserver(fit)
      ro.observe(el)
      fit()
    })
    return () => {
      dead = true
      ro?.disconnect()
      engine.current?.destroy()
      engine.current = null
      el.removeAttribute('data-scene-ready')
    }
  }, [])

  useEffect(() => {
    engine.current?.setProps(props)
  })

  const hold = (bit: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      host.current?.classList.add('is-touch')
      setIsTouch(true)
      engine.current?.setTouchButton(bit, true)
    },
    onPointerUp: () => engine.current?.setTouchButton(bit, false),
    onPointerCancel: () => engine.current?.setTouchButton(bit, false),
    onLostPointerCapture: () => engine.current?.setTouchButton(bit, false)
  })

  const over = props.session.frame()?.phase === 'fim'
  return (
    <div ref={host} className="tiro3d-scene" tabIndex={-1} aria-label="Tiro na Sala em primeira pessoa">
      <button type="button" className="tiro3d-lock" hidden={locked || isTouch || props.inputEnabled === false || over} onClick={() => engine.current?.requestLock()}>
        Clique para jogar
        <small>Esc solta o mouse</small>
      </button>
      <div className="tiro3d-touch" aria-hidden="true">
        <div ref={base} className="tiro3d-stick" hidden>
          <div ref={knob} className="tiro3d-knob" />
        </div>
        <button type="button" className="tiro3d-btn fire" data-tiro-btn tabIndex={-1} {...hold(BTN_FIRE)}>
          Atirar
        </button>
        <button type="button" className="tiro3d-btn dash" data-tiro-btn tabIndex={-1} {...hold(BTN_DASH)}>
          Dash
        </button>
        <button type="button" className="tiro3d-btn bomb" data-tiro-btn tabIndex={-1} {...hold(BTN_GRENADE)}>
          Granada
        </button>
      </div>
    </div>
  )
}

function paintStick(s: StickState, b: HTMLDivElement | null, k: HTMLDivElement | null): void {
  if (!b || !k) return
  b.hidden = !s.active
  if (!s.active) return
  b.style.left = `${s.cx}px`
  b.style.top = `${s.cy}px`
  const l = Math.hypot(s.x, s.y)
  const f = l > STICK_RADIUS ? STICK_RADIUS / l : 1
  k.style.transform = `translate(${s.x * f}px, ${s.y * f}px)`
}
