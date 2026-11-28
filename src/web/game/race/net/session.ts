/**
 * Sessão da Corrida na Sala: a sessão genérica (`realtime/session.ts`: host ou cliente, troca de host,
 * ping, coordenador) ligada à sim, ao cliente e ao quadro da corrida. O relógio, os temporizadores e
 * o criador do host entram por `SessionEnv` (testável sem navegador).
 */
import type { RaceInput, RacePlayerView, RaceSimPlayerRef, RaceSimState, RaceView } from '../../../../shared/games/race/types'
import { raceSim } from '../../../../shared/games/race/sim'
import type { RaceSnapshot, RaceStatics } from '../../../../shared/games/race/codec'
import type { RaceFrame, RaceFrameEvent, RaceSession, RaceSessionDeps } from '../contract'
import { createRealtimeSession, defaultEnv as genericEnv, type RealtimeGameBinding, type SessionEnv as GenericEnv } from '../../realtime/session'
import { RaceClient } from './client'
import { createHostRunner } from './hostRunner'
import { raceRealtime, type RaceTypes } from './realtimeBinding'

export type SessionEnv = GenericEnv<RaceTypes>

export const defaultEnv: SessionEnv = genericEnv<RaceTypes>(createHostRunner)

/** Sessão com os métodos internos que o hook/sala usam (a CENA só enxerga RaceSession). */
export interface ManagedRaceSession extends RaceSession {
  update(view: RaceView): void
  setManager(manager: RaceSessionDeps['manager']): void
  role(): 'host' | 'client' | 'espectador'
  /** só para teste e diagnóstico */
  readonly debug: { client(): RaceClient; hostState(): RaceSimState | null; lastSnapshot(): RaceSnapshot | undefined; statics(): RaceStatics | null }
}

export const refOf = (p: RacePlayerView): RaceSimPlayerRef => ({ slot: p.slot, id: p.id, bot: p.bot })

const IDLE_INPUT: RaceInput = { seq: 0, steer: 0, buttons: 0 }

export const raceBinding: RealtimeGameBinding<RaceTypes, RaceView, RaceInput, RaceFrame, RaceFrameEvent> = {
  sim: raceRealtime,
  createClient: (me) => new RaceClient({ me }),
  refOf,
  idleInput: IDLE_INPUT,
  createState(v) {
    return raceSim.create(v.players.filter((p) => p.present || p.bot).map(refOf), { trackId: v.trackId, laps: v.options.laps, botLevel: v.options.botLevel })
  }
}

export function createRaceSession(deps: RaceSessionDeps, env: SessionEnv = defaultEnv): ManagedRaceSession {
  return createRealtimeSession(raceBinding, deps, env) as unknown as ManagedRaceSession
}
