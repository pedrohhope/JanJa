/**
 * Entrada da Briga na Sala: teclado, controle (Gamepad API) e toque viram um `BrawlInput` por tick.
 * As funções puras ficam no topo (testadas sem DOM); `BrawlInputController` liga ao navegador.
 *
 * Teclado: A/D ou setas andam; W, seta para cima e Espaço pulam (W e a seta também apontam para cima, para o golpe
 * "ar-cima"); S ou seta para baixo = queda rápida e golpe para baixo; J leve, K forte, L esquiva, H pegar/arremessar.
 * Não captura C, M, F nem Tab (seguem para a sala). Controle: A pula, X leve, Y ou B forte, RT ou RB esquiva,
 * LT ou LB pegar. Sem vibração, de propósito.
 */
import { BTN_DODGE, BTN_HEAVY, BTN_JUMP, BTN_LIGHT, BTN_PICK, type BrawlInput } from '../../../../shared/games/brawl/types'

export const KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['KeyW', 'ArrowUp', 'Space'],
  light: ['KeyJ'],
  heavy: ['KeyK'],
  dodge: ['KeyL'],
  pick: ['KeyH']
} as const

/** teclas que a cena consome (as outras seguem para a sala) */
export const GAME_KEYS: ReadonlySet<string> = new Set(Object.values(KEYS).flat())

const any = (keys: ReadonlySet<string>, list: readonly string[]) => list.some((k) => keys.has(k))

export interface Axes {
  mx: number
  my: number
}

export function axesFromKeys(keys: ReadonlySet<string>): Axes {
  return {
    mx: (any(keys, KEYS.right) ? 1 : 0) - (any(keys, KEYS.left) ? 1 : 0),
    my: (any(keys, KEYS.down) ? 1 : 0) - (any(keys, KEYS.up) ? 1 : 0)
  }
}

export function buttonsFromKeys(keys: ReadonlySet<string>): number {
  let b = 0
  if (any(keys, KEYS.jump)) b |= BTN_JUMP
  if (any(keys, KEYS.light)) b |= BTN_LIGHT
  if (any(keys, KEYS.heavy)) b |= BTN_HEAVY
  if (any(keys, KEYS.dodge)) b |= BTN_DODGE
  if (any(keys, KEYS.pick)) b |= BTN_PICK
  return b
}

/** foco num campo de texto (o chat da sala): a cena larga o teclado */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null
  if (!el || !el.tagName) return false
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true
  if (el.isContentEditable) return true
  return !!el.closest?.('[role="listbox"],[contenteditable="true"]')
}

// ---------------------------------------------------------------- controle

export interface PadSnapshot {
  axes: readonly number[]
  buttons: readonly { pressed: boolean; value: number }[]
}

const TRIGGER = 0.35
const btn = (p: PadSnapshot, i: number): number => {
  const b = p.buttons[i]
  return b ? Math.max(b.value, b.pressed ? 1 : 0) : 0
}

/** Mapa "standard". O eixo vai cru: a zona morta de 0,35 é aplicada na simulação. */
export function padToInput(p: PadSnapshot): { axes: Axes; buttons: number; active: boolean } {
  let mx = p.axes[0] ?? 0
  let my = p.axes[1] ?? 0
  const dx = (btn(p, 15) > 0.5 ? 1 : 0) - (btn(p, 14) > 0.5 ? 1 : 0)
  const dy = (btn(p, 13) > 0.5 ? 1 : 0) - (btn(p, 12) > 0.5 ? 1 : 0)
  if (dx || dy) {
    mx = dx
    my = dy
  }
  let buttons = 0
  if (btn(p, 0) > 0.5) buttons |= BTN_JUMP
  if (btn(p, 2) > 0.5) buttons |= BTN_LIGHT
  if (btn(p, 3) > 0.5 || btn(p, 1) > 0.5) buttons |= BTN_HEAVY
  if (btn(p, 7) > TRIGGER || btn(p, 5) > 0.5) buttons |= BTN_DODGE
  if (btn(p, 6) > TRIGGER || btn(p, 4) > 0.5) buttons |= BTN_PICK
  return { axes: { mx: clamp1(mx), my: clamp1(my) }, buttons, active: !!buttons || Math.abs(mx) > 0.35 || Math.abs(my) > 0.35 }
}

// ---------------------------------------------------------------- toque

/** raio do joystick virtual (px CSS) */
export const STICK_RADIUS = 52

/** deslocamento do dedo (px) vira eixo -1..1 */
export function stickAxes(dx: number, dy: number, radius = STICK_RADIUS): Axes {
  const l = Math.hypot(dx, dy)
  if (l < 1e-6) return { mx: 0, my: 0 }
  const k = Math.min(1, l / radius) / l
  return { mx: round3(dx * k), my: round3(dy * k) }
}

export const TOUCH_BUTTONS = [
  { id: 'pular', label: 'Pular', bit: BTN_JUMP },
  { id: 'leve', label: 'Leve', bit: BTN_LIGHT },
  { id: 'forte', label: 'Forte', bit: BTN_HEAVY },
  { id: 'esquiva', label: 'Esquiva', bit: BTN_DODGE },
  { id: 'pegar', label: 'Pegar', bit: BTN_PICK }
] as const

// ---------------------------------------------------------------- composição

const clamp1 = (n: number) => Math.max(-1, Math.min(1, n))
const round3 = (n: number) => Math.round(n * 1000) / 1000

export interface InputSources {
  keys: ReadonlySet<string>
  pad: { axes: Axes; buttons: number } | null
  touch: { axes: Axes; buttons: number } | null
}

/** junta as fontes: botões em OU, eixo da fonte que estiver mexendo (toque > controle > teclado) */
export function composeInput(s: InputSources, seq: number): BrawlInput {
  const k = axesFromKeys(s.keys)
  const ax = s.touch && (s.touch.axes.mx || s.touch.axes.my) ? s.touch.axes : s.pad && (Math.abs(s.pad.axes.mx) > 0.35 || Math.abs(s.pad.axes.my) > 0.35) ? s.pad.axes : k
  return { seq, mx: round3(ax.mx), my: round3(ax.my), buttons: buttonsFromKeys(s.keys) | (s.pad?.buttons ?? 0) | (s.touch?.buttons ?? 0) }
}

export interface InputHost {
  /** desligado (miniatura, partida acabou, aba sem foco): solta tudo */
  enabled(): boolean
}

/** Liga teclado, controle e toque ao navegador. `poll()` uma vez por tick devolve o `BrawlInput`. */
export class BrawlInputController {
  private keys = new Set<string>()
  private touchAxes: Axes = { mx: 0, my: 0 }
  private touchButtons = 0
  private stick: { id: number; cx: number; cy: number } | null = null
  private seq = 0
  private disposers: (() => void)[] = []
  /** o joystick virtual mudou (para desenhar) */
  onStick: ((s: { active: boolean; cx: number; cy: number; dx: number; dy: number }) => void) | null = null

  constructor(private host: InputHost) {
    const on = <K extends keyof WindowEventMap>(ev: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(ev, fn as EventListener)
      this.disposers.push(() => window.removeEventListener(ev, fn as EventListener))
    }
    on('keydown', (e) => {
      if (!GAME_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target) || !host.enabled()) return
      this.keys.add(e.code)
      e.preventDefault()
    })
    on('keyup', (e) => {
      if (GAME_KEYS.has(e.code)) this.keys.delete(e.code)
    })
    on('blur', () => this.release())
  }

  /** botão na tela (usado pelo componente de toque) */
  setTouchButton(bit: number, down: boolean): void {
    this.touchButtons = down ? this.touchButtons | bit : this.touchButtons & ~bit
  }

  stickDown(id: number, x: number, y: number): void {
    if (this.stick) return
    this.stick = { id, cx: x, cy: y }
    this.emitStick(x, y)
  }
  stickMove(id: number, x: number, y: number): void {
    if (!this.stick || this.stick.id !== id) return
    this.touchAxes = stickAxes(x - this.stick.cx, y - this.stick.cy)
    this.emitStick(x, y)
  }
  stickUp(id: number): void {
    if (!this.stick || this.stick.id !== id) return
    this.stick = null
    this.touchAxes = { mx: 0, my: 0 }
    this.onStick?.({ active: false, cx: 0, cy: 0, dx: 0, dy: 0 })
  }
  private emitStick(x: number, y: number): void {
    const s = this.stick
    if (s) this.onStick?.({ active: true, cx: s.cx, cy: s.cy, dx: x - s.cx, dy: y - s.cy })
  }

  private release(): void {
    this.keys.clear()
    this.touchButtons = 0
    this.touchAxes = { mx: 0, my: 0 }
    this.stick = null
    this.onStick?.({ active: false, cx: 0, cy: 0, dx: 0, dy: 0 })
  }

  poll(): BrawlInput {
    if (!this.host.enabled()) {
      if (this.keys.size || this.touchButtons) this.release()
      return { seq: ++this.seq, mx: 0, my: 0, buttons: 0 }
    }
    let pad: ReturnType<typeof padToInput> | null = null
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      for (const g of navigator.getGamepads()) {
        if (!g || !g.connected) continue
        const r = padToInput(g)
        if (r.active) {
          pad = r
          break
        }
      }
    }
    const touch = this.touchButtons || this.touchAxes.mx || this.touchAxes.my ? { axes: this.touchAxes, buttons: this.touchButtons } : null
    return composeInput({ keys: this.keys, pad, touch }, ++this.seq)
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.disposers = []
    this.keys.clear()
  }
}
