import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from 'react'
import { clampSpin, type Spin } from '../../../../shared/games/pool/physics'
import type { PoolSceneProps } from '../../contract'
import { AIM_EVERY_MS, decodeAim, encodeAim, spinLabel, type PoolAim } from '../aim'
import { CANVAS_H, CANVAS_W, PoolEngine } from './engine'

const CENTER: Spin = { x: 0, y: 0 }

/** Casca React da mesa: cria o motor, ajusta o tamanho (escala inteira quando dá), o efeito e a mira ao vivo. */
export function PoolScene(props: PoolSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<PoolEngine | null>(null)
  const [size, setSize] = useState({ w: CANVAS_W * 2, h: CANVAS_H * 2 })
  const [placeSeq, setPlaceSeq] = useState(0)
  const [spin, setSpin] = useState<Spin>(CENTER)
  const [remoteSpin, setRemoteSpin] = useState<Spin | null>(null)
  const v = props.view
  const viewRef = useRef(v)
  viewRef.current = v
  const myTurn = !!v.you && v.turn === v.you.index && v.winner === null

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const fit = () => {
      const s = Math.min((el.clientWidth - 24) / CANVAS_W, (el.clientHeight - 64) / CANVAS_H)
      // escala inteira fica mais nítida; abaixo de 2x, usa a fracionária
      const k = s >= 2 ? Math.floor(s) : Math.max(0.5, s)
      setSize({ w: Math.round(CANVAS_W * k), h: Math.round(CANVAS_H * k) })
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const eng = new PoolEngine(c)
    engineRef.current = eng
    return () => {
      eng.dispose()
      engineRef.current = null
    }
  }, [])

  // cada tacada começa com o efeito no meio
  useEffect(() => {
    setSpin(CENTER)
    setRemoteSpin(null)
  }, [v.ref, v.turn])

  // mira ao vivo: manda a sua (no máximo a cada AIM_EVERY_MS, sempre a última) ...
  const relay = props.relay
  const out = useRef<{ last: number; timer: number; pending: PoolAim | null }>({ last: 0, timer: 0, pending: null })
  const onAim = useCallback(
    (a: PoolAim) => {
      if (!relay) return
      const o = out.current
      o.pending = a
      const flush = () => {
        o.timer = 0
        if (!o.pending) return
        o.last = performance.now()
        relay('**', encodeAim(o.pending))
        o.pending = null
      }
      const wait = AIM_EVERY_MS - (performance.now() - o.last)
      if (wait <= 0) flush()
      else if (!o.timer) o.timer = window.setTimeout(flush, wait)
    },
    [relay]
  )
  useEffect(() => () => window.clearTimeout(out.current.timer), [])

  // ... e mostra a de quem está jogando
  const onRelay = props.onRelay
  useEffect(() => {
    if (!onRelay) return
    return onRelay((from, data) => {
      const a = decodeAim(data)
      const cur = viewRef.current
      if (!a || cur.turn === null || cur.players[cur.turn]?.playerId !== from || a.ref !== cur.ref) return
      engineRef.current?.setRemoteAim(a)
      setRemoteSpin((s) => (s && s.x === a.spin.x && s.y === a.spin.y ? s : a.spin))
    })
  }, [onRelay])

  useEffect(() => {
    engineRef.current?.setProps({ view: props.view, reducedMotion: props.reducedMotion, onShoot: props.onShoot, onSfx: props.onSfx, placeSeq, spin, onSpin: setSpin, onAim })
  })

  const shown = myTurn ? spin : (remoteSpin ?? CENTER)

  return (
    <div className="pl-scene" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="pl-canvas"
        style={{ width: size.w, height: size.h }}
        tabIndex={0}
        aria-label={
          myTurn
            ? 'Mesa de sinuca. Mire com o mouse ou com as setas; clique e puxe para trás para dar força e solte para tacar. W, A, S e D mudam o efeito.'
            : 'Mesa de sinuca.'
        }
      />
      <div className="pl-tips">
        <SpinPad spin={shown} disabled={!myTurn} onChange={setSpin} />
        {myTurn && v.ballInHand && (
          <button onClick={() => setPlaceSeq((n) => n + 1)} data-tip="Clique na mesa onde a branca vai ficar">
            Mover a branca
          </button>
        )}
        {myTurn && v.onEight && <span className="pl-eight">Clique numa caçapa para escolher onde a 8 vai cair.</span>}
      </div>
    </div>
  )
}

const PAD = 44

/** Onde o taco bate na branca: arraste o ponto. Em cima = seguida, embaixo = puxada, dos lados = efeito lateral. */
function SpinPad({ spin, disabled, onChange }: { spin: Spin; disabled: boolean; onChange: (s: Spin) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const at = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * 2 - 1
    const y = ((e.clientY - r.top) / r.height) * 2 - 1
    const s = clampSpin({ x: x / 0.8, y: -y / 0.8 })
    // ímã no meio e nos eixos: fica fácil voltar para o centro
    const snap = (n: number) => (Math.abs(n) < 0.12 ? 0 : Math.round(n * 20) / 20)
    onChange({ x: snap(s.x), y: snap(s.y) })
  }
  const onKey = (e: RKeyboardEvent) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]
    if (e.key === 'Home' || e.key === '0') {
      e.preventDefault()
      onChange(CENTER)
    } else if (d) {
      e.preventDefault()
      const s = clampSpin({ x: spin.x + d[0] * 0.25, y: spin.y + d[1] * 0.25 })
      onChange({ x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100 })
    }
  }
  const label = spinLabel(spin)
  const dx = (spin.x * 0.8 * PAD) / 2
  const dy = (-spin.y * 0.8 * PAD) / 2
  return (
    <div className={`pl-spin ${disabled ? 'off' : ''}`}>
      <div
        ref={ref}
        className="pl-spin-ball"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Efeito na branca"
        aria-valuetext={label}
        aria-disabled={disabled}
        data-tip={disabled ? undefined : 'Onde o taco bate: em cima segue, embaixo volta. Dois cliques voltam ao meio.'}
        onPointerDown={(e) => {
          if (disabled) return
          e.currentTarget.setPointerCapture(e.pointerId)
          at(e)
        }}
        onPointerMove={(e) => {
          if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) at(e)
        }}
        onDoubleClick={() => !disabled && onChange(CENTER)}
        onKeyDown={disabled ? undefined : onKey}
      >
        <span className="pl-spin-cross" aria-hidden="true" />
        <span className="pl-spin-dot" aria-hidden="true" style={{ transform: `translate(${dx}px, ${dy}px)` }} />
      </div>
      <span className="pl-spin-text">
        <small>Efeito</small>
        {label}
      </span>
    </div>
  )
}
