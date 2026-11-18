/// <reference types="vite/client" />
/**
 * Qual dispositivo a pessoa está usando agora: teclado/mouse, controle (gamepad) ou toque.
 * Sem React e sem DOM no topo do módulo (testável em node). Os jogos usam o hook `useInputDevice`
 * para trocar as dicas de botão. Sem vibração de propósito (decisão do dono).
 */

export type InputDevice = 'teclado' | 'controle' | 'toque'
export type PadFamily = 'xbox' | 'playstation' | 'nintendo' | 'generico'

export interface InputInfo {
  device: InputDevice
  family: PadFamily
}

/** analógico passa disso = a pessoa está mexendo no controle */
export const PAD_AXIS_ACTIVE = 0.35
/** o mouse só vale como "teclado" depois de andar mais que isso (px) */
export const MOUSE_MOVE_PX = 4
/** depois de um toque, o navegador ainda manda mouse falso por um tempo */
export const TOUCH_GHOST_MS = 800

/** família do controle pelo `Gamepad.id` (nome e vendor). Genérico usa o visual do Xbox. */
export function padFamilyOf(id: string): PadFamily {
  const s = id.toLowerCase()
  const vendor = /vendor:\s*([0-9a-f]{4})/.exec(s)?.[1] ?? /^([0-9a-f]{4})-[0-9a-f]{4}-/.exec(s)?.[1] ?? ''
  if (vendor === '054c' || /dualsense|dualshock|wireless controller|playstation|ps[345]/.test(s)) {
    // "Xbox Wireless Controller" também termina em "wireless controller": xbox ganha antes
    if (!/xbox|xinput/.test(s) && vendor !== '045e') return 'playstation'
  }
  if (vendor === '045e' || /xbox|xinput/.test(s)) return 'xbox'
  if (vendor === '057e' || /pro controller|joy-?con|nintendo|switch/.test(s)) return 'nintendo'
  return 'generico'
}

export interface PadLike {
  axes: readonly number[]
  buttons: readonly { pressed: boolean; value: number }[]
}

/** o controle está sendo usado agora (botão apertado ou analógico fora do centro); parado não conta */
export function padActive(p: PadLike): boolean {
  for (const b of p.buttons) if (b && (b.pressed || b.value > PAD_AXIS_ACTIVE)) return true
  for (const a of p.axes) if (Math.abs(a) > PAD_AXIS_ACTIVE) return true
  return false
}

export type InputEvent =
  | { kind: 'tecla' }
  | { kind: 'mouse'; dx: number; dy: number; down?: boolean }
  | { kind: 'toque' }
  | { kind: 'controle' }

/** troca de dispositivo: puro, só devolve o novo valor (ou o atual, se nada mudou) */
export function nextDevice(current: InputDevice, ev: InputEvent): InputDevice {
  switch (ev.kind) {
    case 'tecla':
      return 'teclado'
    case 'mouse':
      return ev.down || Math.hypot(ev.dx, ev.dy) > MOUSE_MOVE_PX ? 'teclado' : current
    case 'toque':
      return 'toque'
    case 'controle':
      return 'controle'
  }
}

/** `?pad=xbox|playstation` (só em dev) força o controle, para screenshots */
export function forcedPad(search: string, dev: boolean): PadFamily | null {
  if (!dev) return null
  const v = new URLSearchParams(search).get('pad')
  return v === 'xbox' || v === 'playstation' || v === 'nintendo' ? v : null
}

export type InputListener = (info: InputInfo) => void

/**
 * Observa os dispositivos de entrada. Só chama `cb` quando muda (dispositivo ou família).
 * Devolve a função que desliga tudo.
 */
export function watchInputDevice(cb: InputListener): () => void {
  if (typeof window === 'undefined') {
    cb({ device: 'teclado', family: 'xbox' })
    return () => undefined
  }
  const forced = forcedPad(location.search, !!import.meta.env.DEV)
  let family: PadFamily = forced ?? 'xbox'
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches
  let device: InputDevice = forced ? 'controle' : coarse ? 'toque' : 'teclado'
  let lastTouch = 0
  let last: { x: number; y: number } | null = null
  const emit = (): void => cb({ device, family })
  emit()
  if (forced) return () => undefined

  const set = (d: InputDevice, f: PadFamily = family): void => {
    if (d === device && f === family) return
    device = d
    family = f
    emit()
  }
  const onKey = (): void => set(nextDevice(device, { kind: 'tecla' }))
  const onMouseMove = (e: MouseEvent): void => {
    if (performance.now() - lastTouch < TOUCH_GHOST_MS) return
    const prev = last
    last = { x: e.clientX, y: e.clientY }
    if (!prev) return
    set(nextDevice(device, { kind: 'mouse', dx: e.clientX - prev.x, dy: e.clientY - prev.y }))
  }
  const onMouseDown = (): void => {
    if (performance.now() - lastTouch < TOUCH_GHOST_MS) return
    set(nextDevice(device, { kind: 'mouse', dx: 0, dy: 0, down: true }))
  }
  const onTouch = (): void => {
    lastTouch = performance.now()
    set(nextDevice(device, { kind: 'toque' }))
  }
  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') onTouch()
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('touchstart', onTouch, { passive: true })
  window.addEventListener('pointerdown', onPointerDown)

  // laço leve do controle; parado com a aba escondida
  let raf = 0
  const loop = (): void => {
    raf = requestAnimationFrame(loop)
    const pads = navigator.getGamepads?.() ?? []
    for (const g of pads) {
      if (!g || !g.connected) continue
      if (padActive(g)) {
        set(nextDevice(device, { kind: 'controle' }), padFamilyOf(g.id))
        break
      }
    }
  }
  const start = (): void => {
    if (!raf && !document.hidden) raf = requestAnimationFrame(loop)
  }
  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }
  const onVis = (): void => (document.hidden ? stop() : start())
  document.addEventListener('visibilitychange', onVis)
  start()

  return () => {
    stop()
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('touchstart', onTouch)
    window.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('visibilitychange', onVis)
  }
}
