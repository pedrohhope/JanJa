/** Escolhe animação e quadro a partir do estado do lutador (puro: o preview e os testes usam igual). */
import type { CharacterId, Fighter, Held } from '../../../../shared/games/brawl/types'
import { ANIM_FRAMES, type AnimName } from './anims'

export interface MoveTiming {
  startup: number
  active: number
  recovery: number
}
/** a tabela real vem do agente da simulação (`MOVES`); sem ela vale o padrão abaixo */
export type MoveTimingFn = (moveId: string) => MoveTiming | undefined

export type MoveDir = 'neutro' | 'lado' | 'baixo' | 'cima'
export interface ParsedMove {
  heavy: boolean
  air: boolean
  dir: MoveDir
  held: Held
  char: CharacterId | null
}

const HELD: readonly string[] = ['mao', 'vassoura', 'frigideira', 'luvas']
const CHARS: readonly string[] = ['jan', 'xicara', 'teve', 'janja']
const DIRS: readonly string[] = ['neutro', 'lado', 'baixo', 'cima']

/** lê `vassoura:lado`, `vassoura:ar-cima`, `jan:vassoura:neutro`, `mao:forte-baixo` */
export function parseMove(id: string): ParsedMove | null {
  const p = id.split(':')
  if (p.length === 3 && CHARS.includes(p[0]!) && HELD.includes(p[1]!) && DIRS.includes(p[2]!)) return { heavy: true, air: false, dir: p[2] as MoveDir, held: p[1] as Held, char: p[0] as CharacterId }
  if (p.length === 2 && HELD.includes(p[0]!)) {
    const held = p[0] as Held
    const m = p[1]!
    if (m.startsWith('forte-') && DIRS.includes(m.slice(6))) return { heavy: true, air: false, dir: m.slice(6) as MoveDir, held, char: null }
    if (m.startsWith('ar-') && DIRS.includes(m.slice(3))) return { heavy: false, air: true, dir: m.slice(3) as MoveDir, held, char: null }
    if (DIRS.includes(m)) return { heavy: false, air: false, dir: m as MoveDir, held, char: null }
  }
  return null
}

export function defaultTiming(m: ParsedMove): MoveTiming {
  if (m.heavy) return { startup: 14, active: 6, recovery: 22 }
  if (m.air) return { startup: 6, active: 6, recovery: 12 }
  return { startup: 5, active: 4, recovery: 11 }
}

/** nome da animação de golpe */
export function attackAnim(m: ParsedMove, airborne: boolean): AnimName {
  if (m.heavy) return `forte-${m.dir === 'cima' ? 'neutro' : m.dir}` as AnimName
  if (m.air || airborne) return `ar-${m.dir}` as AnimName
  return `leve-${m.dir === 'cima' ? 'neutro' : m.dir}` as AnimName
}

/** quadro do golpe pela fração dos ticks: startup, ativo, recuperação */
export function attackFrame(anim: AnimName, moveTick: number, t: MoveTiming): number {
  const n = ANIM_FRAMES[anim]
  const heavy = n === 4
  if (moveTick < t.startup) {
    if (!heavy) return 0
    return moveTick < t.startup / 2 ? 0 : 1
  }
  if (moveTick < t.startup + t.active) return heavy ? 2 : 1
  return heavy ? 3 : 2
}

export interface Pick {
  anim: AnimName
  frame: number
  /** giros de 90 graus (voo forte), 0..3 */
  quarter: number
  /** a arma/estado pede brilho de carga (0..1) */
  charge: number
  /** a esquiva pisca/translúcida */
  ghost: boolean
  /** parede: lado da parede (para espelhar) */
  wall: -1 | 0 | 1
}

export function pickAnim(f: Fighter, tick: number, timing?: MoveTimingFn, winner = false): Pick {
  const age = Math.max(0, tick - f.actionTick)
  const base: Pick = { anim: 'idle', frame: 0, quarter: 0, charge: 0, ghost: false, wall: 0 }
  switch (f.action) {
    case 'correndo':
      return { ...base, anim: 'run', frame: Math.floor(age / 5) % ANIM_FRAMES.run }
    case 'no-ar':
      if (f.fastFall) return { ...base, anim: 'fall', frame: Math.floor(age / 6) % 2 }
      return { ...base, anim: 'air', frame: f.vy < -1.2 ? 0 : f.vy > 1.2 ? 2 : 1 }
    case 'parede':
      return { ...base, anim: 'wall', frame: Math.floor(age / 12) % 2, wall: f.wallSide }
    case 'esquiva':
      return { ...base, anim: 'dodge', frame: age < 8 ? 0 : 1, ghost: true }
    case 'atordoado': {
      const speed = Math.hypot(f.vx, f.vy)
      return { ...base, anim: 'hurt', frame: age < 6 || speed < 2.5 ? 0 : 1, quarter: speed > 5 && age >= 6 ? Math.floor(age / 5) % 4 : 0 }
    }
    case 'golpe': {
      const m = f.move ? parseMove(f.move) : null
      if (!m) return base
      if (f.charge > 0 && f.moveTick === 0) return { ...base, anim: 'charge', frame: Math.floor(tick / 6) % 2, charge: Math.min(1, f.charge / 60) }
      const anim = attackAnim(m, !f.grounded)
      const t = timing?.(f.move!) ?? defaultTiming(m)
      return { ...base, anim, frame: attackFrame(anim, f.moveTick, t) }
    }
    default: {
      if (winner) return { ...base, anim: 'win', frame: Math.floor(age / 8) % ANIM_FRAMES.win }
      const cyc = age % 480
      if (cyc >= 360) return { ...base, anim: 'tique', frame: Math.floor((cyc - 360) / 30) % ANIM_FRAMES.tique }
      return { ...base, anim: 'idle', frame: Math.floor((age % 48) / 12) }
    }
  }
}
