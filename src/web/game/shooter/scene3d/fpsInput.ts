/**
 * Entrada do Tiro na Sala em primeira pessoa: mouse com pointer lock, teclado, controle e toque viram
 * um InputState por quadro, com o movimento relativo à visão (yaw). Sem three; as funções puras ficam
 * no topo (testadas sem DOM) e a classe FpsController liga tudo ao navegador.
 *
 * Mapa: mouse gira (X), W/S frente/trás, A/D de lado, setas esquerda/direita giram, clique esquerdo atira,
 * direito ou Q = granada, Espaço = dash. Tab, M, F, G e Esc NÃO são capturados (seguem para a sala).
 */
import { BTN_DASH, BTN_FIRE, BTN_GRENADE } from '../../../../shared/games/shooter/types'
import type { InputState } from '../contract'
import { AIM_DEADZONE, GAME_KEYS, STICK_RADIUS, applyDeadzone, clampUnit, isTypingTarget, padToInput, touchMove, type PadSnapshot } from '../scene/input'
import { KEY_TURN_SPEED, MOUSE_SENS, PAD_TURN_SPEED, TOUCH_SENS, type FpsControllerApi, type FpsHost, type FpsPoll, type FpsTouchUi } from './contract3d'

/** curva do analógico de giro: >1 deixa a mira fina perto do centro */
export const PAD_LOOK_CURVE = 1.6
/** o Chrome às vezes manda saltos enormes de movementX com pointer lock: acima disto o evento é ignorado */
export const MOUSE_SPIKE = 300
/** acima disto (|move|) conta como andando */
export const MOVING_EPS = 0.1

const TWO_PI = Math.PI * 2
const round3 = (n: number): number => Math.round(n * 1000) / 1000 || 0

// ---------------------------------------------------------------- funções puras

/** leva o ângulo para -π..π */
export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) return 0
  return a - TWO_PI * Math.round(a / TWO_PI)
}

/** mira (cos yaw, sin yaw): yaw 0 = leste (+x), π/2 = sul (+y) */
export function yawToAim(yaw: number): { x: number; y: number } {
  return { x: Math.cos(yaw), y: Math.sin(yaw) }
}

export function aimToYaw(ax: number, ay: number): number {
  return Math.atan2(ay, ax)
}

const down = (keys: ReadonlySet<string>, ...codes: string[]) => codes.some((c) => keys.has(c))

/** f = frente(+)/trás(-), s = direita(+)/esquerda(-). As setas esquerda/direita giram, não andam. */
export function localMoveFromKeys(keys: ReadonlySet<string>): { f: number; s: number } {
  const f = (down(keys, 'KeyW', 'ArrowUp') ? 1 : 0) - (down(keys, 'KeyS', 'ArrowDown') ? 1 : 0)
  const s = (down(keys, 'KeyD') ? 1 : 0) - (down(keys, 'KeyA') ? 1 : 0)
  const c = clampUnit(f, s)
  return { f: c.x, s: c.y }
}

/** frente/lado locais -> vetor no mundo (frente = (cos, sin), direita = (-sin, cos)); comprimento até 1 */
export function rotateMove(f: number, s: number, yaw: number): { x: number; y: number } {
  const c = Math.cos(yaw)
  const sn = Math.sin(yaw)
  return clampUnit(f * c - s * sn, f * sn + s * c)
}

/** giro (rad) do analógico direito X durante dtMs: zona morta, curva exponencial, até PAD_TURN_SPEED */
export function padLookDelta(axisX: number, dtMs: number): number {
  const v = applyDeadzone(axisX, 0, AIM_DEADZONE).x
  const curved = Math.sign(v) * Math.abs(v) ** PAD_LOOK_CURVE
  return curved * PAD_TURN_SPEED * (dtMs / 1000)
}

/** giro (rad) das setas esquerda/direita durante dtMs */
export function keyTurnDelta(keys: ReadonlySet<string>, dtMs: number): number {
  const dir = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)
  return dir * KEY_TURN_SPEED * (dtMs / 1000)
}

/** giro (rad) de um evento de mouse; picos absurdos viram 0 */
export function mouseDelta(movementX: number): number {
  if (!Number.isFinite(movementX) || Math.abs(movementX) > MOUSE_SPIKE) return 0
  return movementX * MOUSE_SENS
}

// ---------------------------------------------------------------- controlador

/** ambiente injetável (testes); por padrão, o do navegador */
export interface FpsEnv {
  win: Window
  doc: Document
}

interface TouchPt {
  id: number
  cx: number
  cy: number
  x: number
  y: number
}

export class FpsController implements FpsControllerApi {
  private win: Window
  private doc: Document
  private _yaw = 0
  private keys = new Set<string>()
  private mouseButtons = 0
  private mouseTurn = 0
  private touchButtons = 0
  private moveTouch: TouchPt | null = null
  private lookTouch: { id: number; lastX: number } | null = null
  private touchTurn = 0
  private lastLocked = false
  private wasEnabled = true
  private disposers: (() => void)[] = []

  constructor(
    private host: FpsHost,
    env?: Partial<FpsEnv>
  ) {
    this.win = env?.win ?? window
    this.doc = env?.doc ?? document
    const { win, doc } = this
    const el = host.el
    const add = (t: EventTarget, ev: string, fn: (e: never) => void) => {
      t.addEventListener(ev, fn as unknown as EventListener)
      this.disposers.push(() => t.removeEventListener(ev, fn as unknown as EventListener))
    }

    add(win, 'keydown', (e: KeyboardEvent) => {
      if (!GAME_KEYS.has(e.code)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target) || !this.checkEnabled()) return
      this.keys.add(e.code)
      e.preventDefault()
    })
    add(win, 'keyup', (e: KeyboardEvent) => {
      if (GAME_KEYS.has(e.code)) this.keys.delete(e.code)
    })
    add(win, 'blur', () => this.release())
    add(win, 'pointerup', (e: PointerEvent) => this.pointerEnd(e))
    add(win, 'pointercancel', (e: PointerEvent) => this.pointerEnd(e))
    add(win, 'pointermove', (e: PointerEvent) => this.touchMoveEv(e))
    add(win, 'mousemove', (e: MouseEvent) => {
      if (this.locked && this.checkEnabled()) this.mouseTurn += mouseDelta(e.movementX)
    })
    add(doc, 'pointerlockchange', () => this.syncLock())
    add(doc, 'pointerlockerror', () => this.syncLock())

    add(el, 'pointerdown', (e: PointerEvent) => {
      if (!this.checkEnabled()) return
      if ((e.target as HTMLElement | null)?.closest?.('[data-tiro-btn]')) return
      if (isTypingTarget(doc.activeElement)) (doc.activeElement as HTMLElement).blur()
      if (e.pointerType === 'touch') {
        this.touchDown(e)
        return
      }
      if (!this.locked) {
        // este clique só trava o mouse: não atira
        this.requestLock()
        e.preventDefault()
        return
      }
      this.mouseButtons = e.buttons
      if (e.button === 2) e.preventDefault()
    })
    add(el, 'contextmenu', (e: Event) => e.preventDefault())
  }

  get yaw(): number {
    return this._yaw
  }

  get locked(): boolean {
    return this.doc.pointerLockElement === this.host.el
  }

  setYaw(yaw: number): void {
    this._yaw = wrapAngle(yaw)
  }

  setTouchButton(bit: number, down: boolean): void {
    this.touchButtons = down ? this.touchButtons | bit : this.touchButtons & ~bit
  }

  requestLock(): void {
    const el = this.host.el
    const plain = () => {
      try {
        const r = el.requestPointerLock() as unknown
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined)
      } catch {
        /* sem lock: segue sem */
      }
    }
    try {
      const r = (el.requestPointerLock as (o?: unknown) => unknown)({ unadjustedMovement: true })
      if (r && typeof (r as Promise<void>).then === 'function') (r as Promise<void>).then(undefined, plain)
    } catch {
      plain()
    }
  }

  poll(dtMs: number): FpsPoll {
    const dt = Math.max(0, Math.min(dtMs, 100))
    const enabled = this.checkEnabled()
    const a0 = yawToAim(this._yaw)
    if (!enabled) {
      return { input: { mx: 0, my: 0, ax: round3(a0.x), ay: round3(a0.y), buttons: 0 }, yaw: this._yaw, moving: false }
    }
    this.syncLock()

    // controle
    let padMove = { x: 0, y: 0 }
    let padButtons = 0
    let padTurn = 0
    const pads = this.win.navigator?.getGamepads?.() ?? []
    for (const g of pads) {
      if (!g) continue
      const snap: PadSnapshot = { axes: g.axes, buttons: g.buttons }
      const r = padToInput(snap)
      padMove = { x: padMove.x + r.move.x, y: padMove.y + r.move.y }
      padButtons |= r.buttons
      padTurn += padLookDelta(g.axes[2] ?? 0, dt)
    }

    // giro: mouse acumulado + controle + setas + toque
    this._yaw = wrapAngle(this._yaw + this.mouseTurn + padTurn + keyTurnDelta(this.keys, dt) + this.touchTurn)
    this.mouseTurn = 0
    this.touchTurn = 0

    // andar (frente/lado locais)
    const k = localMoveFromKeys(this.keys)
    let f = k.f - padMove.y
    let s = k.s + padMove.x
    if (this.moveTouch) {
      const t = touchMove(this.moveTouch.x - this.moveTouch.cx, this.moveTouch.y - this.moveTouch.cy)
      f -= t.y
      s += t.x
    }
    const l = clampUnit(f, s)
    const m = rotateMove(l.x, l.y, this._yaw)

    let buttons = padButtons | this.touchButtons
    if (this.mouseButtons & 1) buttons |= BTN_FIRE
    if (this.mouseButtons & 2) buttons |= BTN_GRENADE
    if (this.keys.has('Space')) buttons |= BTN_DASH
    if (this.keys.has('KeyQ')) buttons |= BTN_GRENADE

    const aim = yawToAim(this._yaw)
    const input: InputState = { mx: round3(m.x), my: round3(m.y), ax: round3(aim.x), ay: round3(aim.y), buttons }
    return { input, yaw: this._yaw, moving: Math.hypot(m.x, m.y) > MOVING_EPS }
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d()
    this.release()
    this.exitLock()
  }

  // ---------------------------------------------------------------- internos

  /** false: solta tudo (uma vez) e sai do lock */
  private checkEnabled(): boolean {
    const on = this.host.enabled()
    if (!on && this.wasEnabled) {
      this.release()
      this.exitLock()
    }
    this.wasEnabled = on
    return on
  }

  private exitLock(): void {
    if (this.locked) {
      try {
        this.doc.exitPointerLock()
      } catch {
        /* nada */
      }
    }
    this.syncLock()
  }

  private syncLock(): void {
    const now = this.locked
    if (now === this.lastLocked) return
    this.lastLocked = now
    if (!now) this.mouseButtons = 0
    this.host.onLockChange?.(now)
  }

  private release(): void {
    this.keys.clear()
    this.mouseButtons = 0
    this.mouseTurn = 0
    this.touchTurn = 0
    this.touchButtons = 0
    this.moveTouch = null
    this.lookTouch = null
    this.emitTouch()
  }

  private emitTouch(): void {
    const m = this.moveTouch
    const ui: FpsTouchUi = { move: m ? { active: true, cx: m.cx, cy: m.cy, x: m.x, y: m.y } : { active: false, cx: 0, cy: 0, x: 0, y: 0 } }
    this.host.onTouch?.(ui)
  }

  private touchDown(e: PointerEvent): void {
    const r = this.host.el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (x < r.width / 2) {
      if (!this.moveTouch) this.moveTouch = { id: e.pointerId, cx: x, cy: y, x, y }
      else return
    } else {
      if (!this.lookTouch) this.lookTouch = { id: e.pointerId, lastX: e.clientX }
      else return
    }
    try {
      this.host.el.setPointerCapture(e.pointerId)
    } catch {
      /* sem captura */
    }
    e.preventDefault()
    this.emitTouch()
  }

  private touchMoveEv(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return
    if (this.moveTouch?.id === e.pointerId) {
      const r = this.host.el.getBoundingClientRect()
      const m = this.moveTouch
      const dx = e.clientX - r.left - m.cx
      const dy = e.clientY - r.top - m.cy
      // o centro acompanha o dedo que passa do raio, como num joystick flutuante
      const l = Math.hypot(dx, dy)
      if (l > STICK_RADIUS) {
        const k = (l - STICK_RADIUS) / l
        m.cx += dx * k
        m.cy += dy * k
      }
      m.x = e.clientX - r.left
      m.y = e.clientY - r.top
      this.emitTouch()
    } else if (this.lookTouch?.id === e.pointerId) {
      this.touchTurn += (e.clientX - this.lookTouch.lastX) * TOUCH_SENS
      this.lookTouch.lastX = e.clientX
    }
  }

  private pointerEnd(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      if (this.moveTouch?.id === e.pointerId) {
        this.moveTouch = null
        this.emitTouch()
      }
      if (this.lookTouch?.id === e.pointerId) this.lookTouch = null
    } else if (this.locked) {
      this.mouseButtons = e.buttons
    } else {
      this.mouseButtons = 0
    }
  }
}
