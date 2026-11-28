/**
 * Lógica pura do HUD da Corrida (sem React, testável): posições, voltas, tempos, contramão, cores,
 * música e os efeitos de cada evento.
 */
import { BOT_SLOT_BASE, TICK_HZ, TICK_MS, type RacePlayerView, type RaceScoreLine, type RaceSimEvent, type RaceSimState } from '../../../shared/games/race/types'
import { standings, trackOf } from '../../../shared/games/race/sim'
import type { MusicTrack } from '../contract'

/** cor dos robôs (gente de verdade usa a cor do apelido) */
export const BOT_TONES = ['#7E9CB5', '#C27C8E', '#8FAE6B', '#D4A373', '#9B8BC2']

export function raceColors(players: readonly RacePlayerView[], toneOf: (name: string) => string): Record<number, string> {
  const out: Record<number, string> = {}
  for (const p of players) out[p.slot] = p.bot ? BOT_TONES[(p.slot - BOT_SLOT_BASE) % BOT_TONES.length]! : toneOf(p.name)
  return out
}

export function raceNames(players: readonly RacePlayerView[]): Record<number, string> {
  return Object.fromEntries(players.map((p) => [p.slot, p.name]))
}

/** "1:02,4" ou "12,4" (segundos com um décimo) */
export function formatTime(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 100))
  const tenths = t % 10
  const s = Math.floor(t / 10) % 60
  const m = Math.floor(t / 600)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')},${tenths}` : `${s},${tenths}`
}

export interface StandingRow {
  slot: number
  place: number
  /** volta em que está (1..laps) ou laps se chegou */
  lap: number
  finished: boolean
}

export function standingRows(s: RaceSimState): StandingRow[] {
  return standings(s).map((c, i) => ({ slot: c.slot, place: i + 1, lap: Math.max(1, Math.min(s.laps, c.lap)), finished: c.finishTick > 0 }))
}

/** segundos que faltam para a largada (3, 2, 1) ou 0 */
export function countdownOf(s: Pick<RaceSimState, 'phase' | 'goTick' | 'tick'>): number {
  return s.phase === 'contagem' ? Math.max(1, Math.ceil((s.goTick - s.tick) / TICK_HZ)) : 0
}

/** ms desde a largada */
export const raceClockMs = (s: Pick<RaceSimState, 'phase' | 'goTick' | 'tick' | 'endTick'>): number =>
  s.phase === 'contagem' ? 0 : Math.max(0, ((s.phase === 'fim' && s.endTick ? s.endTick : s.tick) - s.goTick) * TICK_MS)

/** o carro anda contra o traçado */
export function wrongWay(s: RaceSimState, slot: number): boolean {
  const c = s.cars.find((x) => x.slot === slot)
  if (!c || c.away || c.finishTick > 0 || c.lap === 0 || s.phase !== 'correndo') return false
  const w = trackOf(s).wps[c.next]!
  const sp = Math.hypot(c.vx, c.vy)
  return sp > 0.6 && (c.vx * w.dx + c.vy * w.dy) / sp < -0.55
}

/** música: tensão na contagem, ação na corrida, final na última volta de quem lidera, vitória no fim */
export function raceTrack(phase: RaceSimState['phase'] | 'fim', leaderLap: number, laps: number): MusicTrack {
  if (phase === 'fim') return 'vitoria'
  if (phase === 'contagem') return 'tensao'
  return leaderLap >= laps && laps > 1 ? 'final' : 'tiroteio'
}

export function podiumOf<T>(ranking: readonly T[]): { top: T[]; rest: T[] } {
  return { top: ranking.slice(0, 3), rest: ranking.slice(3) }
}

/** texto do resultado de uma linha ("1:02,4" ou "3 voltas") */
export function lineText(l: RaceScoreLine): string {
  if (l.place > 0) return formatTime(l.timeMs)
  return l.laps === 1 ? '1 volta' : `${l.laps} voltas`
}

export interface RaceCue {
  name: string
  volume?: number
}

/** efeito de um evento da corrida (os dos outros carros mais baixos) */
export function raceCue(e: RaceSimEvent, me: number | null, laps: number): RaceCue | null {
  const mine = (slot: number) => me !== null && slot === me
  switch (e.type) {
    case 'go':
      return { name: 'corrida-ja' }
    case 'turbo':
      return mine(e.slot) ? { name: 'corrida-turbo' } : { name: 'corrida-turbo', volume: 0.25 }
    case 'batida':
      return { name: 'corrida-batida', volume: mine(e.slot) ? 0.5 + e.force * 0.15 : 0.18 }
    case 'toque':
      return { name: 'corrida-toque', volume: mine(e.a) || mine(e.b) ? 0.8 : 0.2 }
    case 'volta':
      if (!mine(e.slot)) return null
      return { name: e.lap === laps ? 'corrida-ultima' : 'corrida-volta' }
    case 'chegada':
      return mine(e.slot) ? { name: 'corrida-chegada' } : { name: 'corrida-volta', volume: 0.3 }
    case 'fim':
      return null
  }
}
