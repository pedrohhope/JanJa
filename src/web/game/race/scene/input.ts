/**
 * Entrada da Corrida na Sala: teclado, controle (Gamepad API) e toque viram um `RaceInput` por tick.
 * As funções puras ficam no topo (testadas sem DOM); `RaceInputController` liga ao navegador.
 *
 * Teclado: W ou seta para cima acelera; S, seta para baixo ou Espaço freiam (parado, dá ré);
 * A/D ou setas viram. Não captura C, M, F, G nem Tab (seguem para a sala).
 * Controle: analógico esquerdo ou direcional viram, RT ou A aceleram, LT, B ou X freiam.
 * Toque: setas na esquerda, Acelerar e Frear na direita. Sem vibração, de propósito.
 */
import { BTN_BRAKE, BTN_GAS, type RaceInput } from '../../../../shared/games/race/types'

export const KEYS = {
  gas: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown', 'Space'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight']
} as const

/** teclas que a cena consome (as outras seguem para a sala) */
export const GAME_KEYS: ReadonlySet<string> = new Set(Object.values(KEYS).flat())

const any = (keys: ReadonlySet<string>, list: readonly string[]) => list.some((k) => keys.has(k))

/** volante digital do teclado: alvo -1, 0 ou 1 */
export function steerTarget(keys: ReadonlySet<string>): number {
  return (any(keys, KEYS.right) ? 1 : 0) - (any(keys, KEYS.left) ? 1 : 0)
}

export function buttonsFromKeys(keys: ReadonlySet<string>): number {
  return (any(keys, KEYS.gas) ? BTN_GAS : 0) | (any(keys, KEYS.brake) ? BTN_BRAKE : 0)
}

/** quanto o volante digital anda por tick até o alvo (vira de vez em ~5 ticks e volta mais rápido) */
export const STEER_RAMP = 0.22
export const STEER_RETURN = 0.34

export function rampSteer(cur: number, target: number): number {
  if (target === 0) return Math.abs(cur) <= STEER_RETURN ? 0 : cur - Math.sign(cur) * STEER_RETURN
  if (Math.sign(cur) !== Math.sign(target) && cur !== 0) cur = 0
  const next = cur + Math.sign(target) * STEER_RAMP
  return Math.abs(next) >= 1 ? Math.sign(target) : next
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

const DEAD = 0.18
const btn = (p: PadSnapshot, i: number): number => {
  const b = p.buttons[i]
  return b ? Math.max(b.value, b.pressed ? 1 : 0) : 0
}

/** Mapa "standard": volante analógico com zona morta e curva suave. */
export function padToInput(p: PadSnapshot): { steer: number; buttons: number; active: boolean } {
  const raw = p.axes[0] ?? 0
  let steer = Math.abs(raw) < DEAD ? 0 : (Math.sign(raw) * (Math.abs(raw) - DEAD)) / (1 - DEAD)
  steer = Math.sign(steer) * steer * steer * 0.4 + steer * 0.6
  const dx = (btn(p, 15) > 0.5 ? 1 : 0) - (btn(p, 14) > 0.5 ? 1 : 0)
  if (dx) steer = dx
  let buttons = 0
  if (btn(p, 7) > 0.3 || btn(p, 0) > 0.5) buttons |= BTN_GAS
  if (btn(p, 6) > 0.3 || btn(p, 1) > 0.5 || btn(p, 2) > 0.5) buttons |= BTN_BRAKE
  steer = Math.max(-1, Math.min(1, steer))
  return { steer, buttons, active: !!buttons || steer !== 0 }
}

// ---------------------------------------------------------------- toque

export const TOUCH_BUTTONS = [
  { id: 'esquerda', label: 'Esquerda', side: 'left' as const },
  { id: 'direita', label: 'Direita', side: 'left' as const },
  { id: 'frear', label: 'Frear', side: 'right' as const },
  { id: 'acelerar', label: 'Acelerar', side: 'right' as const }
] as const
export type TouchButtonId = (typeof TOUCH_BUTTONS)[number]['id']

// ---------------------------------------------------------------- composição

export interface InputSources {
  keys: ReadonlySet<string>
  keySteer: number
  pad: { steer: number; buttons: number } | null
  touch: ReadonlySet<TouchButtonId>
}

/** junta as fontes: botões em OU, volante da fonte que estiver mexendo (toque > controle > teclado) */
export function composeInput(s: InputSources, seq: number): RaceInput {
  const tSteer = (s.touch.has('direita') ? 1 : 0) - (s.touch.has('esquerda') ? 1 : 0)
  const steer = tSteer !== 0 ? tSteer : s.pad && s.pad.steer !== 0 ? s.pad.steer : s.keySteer
  let buttons = buttonsFromKeys(s.keys) | (s.pad?.buttons ?? 0)
  if (s.touch.has('acelerar')) buttons |= BTN_GAS
  if (s.touch.has('frear')) buttons |= BTN_BRAKE
  return { seq, steer: Math.round(steer * 1000) / 1000, buttons }
}

export interface InputHost {
  /** desligado (miniatura, corrida acabou, aba sem foco): solta tudo */
  enabled(): boolean
}

/** Liga teclado, controle e toque ao navegador. `poll()` uma vez por tick devolve o `RaceInput`. */
export class RaceInputController {
  private keys = new Set<string>()
  private touch = new Set<TouchButtonId>()
  private keySteer = 0
  private seq = 0
  private disposers: (() => void)[] = []

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

  setTouch(id: TouchButtonId, down: boolean): void {
    if (down) this.touch.add(id)
    else this.touch.delete(id)
  }

  private release(): void {
    this.keys.clear()
    this.touch.clear()
    this.keySteer = 0
  }

  poll(): RaceInput {
    if (!this.host.enabled()) {
      if (this.keys.size || this.touch.size) this.release()
      return { seq: ++this.seq, steer: 0, buttons: 0 }
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
    this.keySteer = rampSteer(this.keySteer, steerTarget(this.keys))
    return composeInput({ keys: this.keys, keySteer: this.keySteer, pad, touch: this.touch }, ++this.seq)
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.disposers = []
    this.keys.clear()
  }
}
