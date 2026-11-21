/**
 * Sessão da Briga na Sala: a sessão genérica (`realtime/session.ts`: host ou cliente, troca de host,
 * ping, coordenador) ligada à sim, ao cliente e ao quadro da briga. O relógio, os temporizadores e
 * o criador do host entram por `SessionEnv` (testável sem navegador).
 */
import type { BrawlInput, BrawlPlayerView, BrawlSimPlayerRef, BrawlSimState, BrawlView } from '../../../../shared/games/brawl/types'
import { brawlSim } from '../../../../shared/games/brawl/sim'
import type { BrawlSnapshot, BrawlStatics } from '../../../../shared/games/brawl/codec'
import type { BrawlFrame, BrawlFrameEvent, BrawlSession, BrawlSessionDeps } from '../contract'
import { createRealtimeSession, defaultEnv as genericEnv, type RealtimeGameBinding, type SessionEnv as GenericEnv } from '../../realtime/session'
import { BrawlClient } from './client'
import { createHostRunner } from './hostRunner'
import { brawlRealtime, type BrawlTypes } from './realtimeBinding'

export type SessionEnv = GenericEnv<BrawlTypes>

export const defaultEnv: SessionEnv = genericEnv<BrawlTypes>(createHostRunner)

/** Sessão com os métodos internos que o hook/sala usam (a CENA só enxerga BrawlSession). */
export interface ManagedBrawlSession extends BrawlSession {
  update(view: BrawlView): void
  setManager(manager: BrawlSessionDeps['manager']): void
  role(): 'host' | 'client' | 'espectador'
  /** só para teste e diagnóstico */
  readonly debug: { client(): BrawlClient; hostState(): BrawlSimState | null; lastSnapshot(): BrawlSnapshot | undefined; statics(): BrawlStatics | null }
}

export const refOf = (p: BrawlPlayerView): BrawlSimPlayerRef => ({ slot: p.slot, id: p.id, bot: p.bot, char: p.char, team: p.team })

const IDLE_INPUT: BrawlInput = { seq: 0, mx: 0, my: 0, buttons: 0 }

export const brawlBinding: RealtimeGameBinding<BrawlTypes, BrawlView, BrawlInput, BrawlFrame, BrawlFrameEvent> = {
  sim: brawlRealtime,
  createClient: (me) => new BrawlClient({ me }),
  refOf,
  idleInput: IDLE_INPUT,
  createState(v) {
    const o = v.options
    return brawlSim.create(
      v.players.filter((p) => p.present || p.bot).map(refOf),
      { arenaId: v.arenaId, mode: o.mode, stocks: o.stocks, minutes: o.minutes, teamSize: o.teamSize, friendlyFire: o.friendlyFire, botLevel: o.botLevel },
      v.seed
    )
  }
}

export function createBrawlSession(deps: BrawlSessionDeps, env: SessionEnv = defaultEnv): ManagedBrawlSession {
  return createRealtimeSession(brawlBinding, deps, env) as unknown as ManagedBrawlSession
}
