/**
 * Mira ao vivo da sinuca: quem joga manda pela sala (repasse `game-relay` para '**') onde está
 * mirando, a força, o efeito e onde pôs a branca; quem espera vê o taco se mexendo. Não passa pelo
 * motor: é só desenho, e a tacada de verdade continua sendo a ação `shoot`. Sem DOM (o teste importa).
 */
import type { Spin } from '../../../shared/games/pool/physics'

export const AIM_PREFIX = 'pool:'
/** no máximo uma mensagem a cada tanto (o repasse aceita 60 por segundo) */
export const AIM_EVERY_MS = 70

export interface PoolAim {
  /** tacadas já dadas quando mirou (mira de outra tacada é ignorada) */
  ref: number
  /** 'aim' = mirando (x, y é a direção); 'place' = escolhendo onde pôr a branca (x, y é o lugar) */
  mode: 'aim' | 'place'
  x: number
  y: number
  /** 0 a 1: o quanto o taco está puxado */
  power: number
  /** branca já posta (bola na mão) */
  cue: { x: number; y: number } | null
  spin: Spin
  /** caçapa escolhida para a 8 */
  pocket: number | null
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000

export function encodeAim(a: PoolAim): string {
  return (
    AIM_PREFIX +
    JSON.stringify([a.ref, a.mode === 'place' ? 1 : 0, r3(a.x), r3(a.y), r3(a.power), a.cue ? [r3(a.cue.x), r3(a.cue.y)] : 0, [r3(a.spin.x), r3(a.spin.y)], a.pocket ?? -1])
  )
}

const fin = (x: unknown, lim: number): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim

/** Lê uma mensagem de mira; qualquer coisa estranha vira null. */
export function decodeAim(data: string): PoolAim | null {
  if (!data.startsWith(AIM_PREFIX) || data.length > 300) return null
  let raw: unknown
  try {
    raw = JSON.parse(data.slice(AIM_PREFIX.length))
  } catch {
    return null
  }
  if (!Array.isArray(raw) || raw.length !== 8) return null
  const [ref, mode, x, y, power, cue, spin, pocket] = raw as unknown[]
  if (!fin(ref, 1e9) || !Number.isInteger(ref) || (mode !== 0 && mode !== 1) || !fin(x, 200) || !fin(y, 200) || !fin(power, 1) || power < 0) return null
  if (!Array.isArray(spin) || spin.length !== 2 || !fin(spin[0], 1) || !fin(spin[1], 1)) return null
  if (!fin(pocket, 5) || !Number.isInteger(pocket)) return null
  let c: { x: number; y: number } | null = null
  if (cue !== 0) {
    if (!Array.isArray(cue) || cue.length !== 2 || !fin(cue[0], 200) || !fin(cue[1], 200)) return null
    c = { x: cue[0], y: cue[1] }
  }
  return { ref, mode: mode === 1 ? 'place' : 'aim', x, y, power, cue: c, spin: { x: spin[0], y: spin[1] }, pocket: pocket < 0 ? null : pocket }
}

/** Efeito em palavras ("no meio", "puxada", "seguida à direita"...). */
export function spinLabel(s: Spin): string {
  const v = s.y > 0.2 ? 'seguida' : s.y < -0.2 ? 'puxada' : ''
  const h = s.x > 0.2 ? 'direita' : s.x < -0.2 ? 'esquerda' : ''
  if (!v && !h) return 'no meio'
  if (!v) return `à ${h}`
  return h ? `${v} à ${h}` : v
}
