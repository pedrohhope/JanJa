/** Eventos da simulação da briga viram nome de efeito, volume e pan (puro). Quem toca é o `GameAudioDriver`. */
import { MOVES } from '../../../shared/games/brawl/moves'
import { ARENA_W, type ArenaId, type BrawlSimEvent } from '../../../shared/games/brawl/types'
import type { MusicTrack } from '../contract'

export interface BrawlCue {
  name: string
  volume: number
  pan: number
}

/** `posX(slot)` devolve o x do lutador para o pan (ou undefined) */
export function brawlCue(ev: BrawlSimEvent, me: number | null, posX: (slot: number) => number | undefined): BrawlCue | null {
  const pan = (slot: number | undefined, x?: number): number => {
    const px = x ?? (slot === undefined ? undefined : posX(slot))
    return px === undefined ? 0 : Math.max(-0.8, Math.min(0.8, ((px - ARENA_W / 2) / (ARENA_W / 2)) * 0.8))
  }
  const vol = (slot: number | undefined, base = 1): number => (slot !== undefined && slot === me ? base : base * 0.75)
  switch (ev.type) {
    case 'jump':
      return { name: ev.air ? 'briga-pulo-ar' : 'briga-pulo', volume: vol(ev.slot, 0.8), pan: pan(ev.slot) }
    case 'dodge':
      return { name: 'briga-esquiva', volume: vol(ev.slot, 0.9), pan: pan(ev.slot) }
    case 'attack': {
      const heavy = !!MOVES[ev.move]?.chargeable
      return { name: heavy ? 'briga-golpe-forte' : 'briga-golpe', volume: vol(ev.slot, 0.9), pan: pan(ev.slot) }
    }
    case 'hit':
      return { name: `briga-acerto-${ev.strength}`, volume: Math.min(1, 0.55 + ev.strength * 0.15) * (ev.victim === me || ev.attacker === me ? 1 : 0.8), pan: pan(undefined, ev.x) }
    case 'ko':
      return { name: 'briga-nocaute', volume: 1, pan: pan(undefined, ev.x) }
    case 'pickup':
      return { name: 'pegar-arma', volume: vol(ev.slot, 0.9), pan: pan(ev.slot) }
    case 'throw':
      return { name: 'briga-arremesso', volume: vol(ev.slot, 0.9), pan: pan(ev.slot) }
    case 'wall':
      return { name: 'briga-parede', volume: vol(ev.slot, 0.6), pan: pan(ev.slot) }
    case 'respawn':
      return { name: 'renascer', volume: vol(ev.slot, 0.8), pan: pan(ev.slot) }
    case 'last-stock':
      return { name: 'briga-ultima-vida', volume: ev.slot === me ? 1 : 0.6, pan: 0 }
    case 'go':
      return { name: 'briga-ja', volume: 1, pan: 0 }
    case 'phase':
      return ev.phase === 'fim' ? { name: 'podium', volume: 1, pan: 0 } : null
    default:
      return null
  }
}

/**
 * Música da briga: a escolha toca a calma; a luta, uma faixa por arena (a Estante com o tiroteio, o
 * Telhado com a tensão); última vida de alguém, morte súbita ou último minuto trocam para a do final; o fim, a fanfarra.
 */
export function brawlTrack(o: { phase: 'escolha' | 'jogando' | 'fim'; arena: ArenaId; timeLeftMs: number; timed: boolean; lastStock: boolean; suddenDeath: boolean }): MusicTrack {
  if (o.phase === 'escolha') return 'calma'
  if (o.phase === 'fim') return 'vitoria'
  if (o.suddenDeath || o.lastStock || (o.timed && o.timeLeftMs > 0 && o.timeLeftMs <= 30_000)) return 'final'
  return o.arena === 'telhado' ? 'tensao' : 'tiroteio'
}
