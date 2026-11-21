/**
 * Sessão do Tiro na Sala: a sessão genérica (`realtime/session.ts`: host ou cliente, troca de host,
 * ping, coordenador) ligada à sim, ao cliente e ao quadro do tiro. O relógio, os temporizadores e
 * o criador do host entram por `SessionEnv` (testável sem navegador).
 */
import { type ShooterView, type SimPlayerRef, type SimState } from '../../../../shared/games/shooter/types'
import type { Snapshot, SnapshotStatics } from '../../../../shared/games/shooter/codec'
import type { FrameEvent, InputState, ShooterFrame, ShooterSession, ShooterSessionDeps } from '../contract'
import { createRealtimeSession, defaultEnv as genericEnv, type RealtimeGameBinding, type SessionEnv as GenericEnv } from '../../realtime/session'
import { ClientCore } from './client'
import { createHostRunner } from './hostRunner'
import { getMap, simApi } from './simBinding'
import { shooterSim, type ShooterTypes } from './realtimeBinding'

export type SessionEnv = GenericEnv<ShooterTypes>

export const defaultEnv: SessionEnv = genericEnv<ShooterTypes>(createHostRunner)

/** Sessão com os métodos internos que o hook/sala usam (a CENA só enxerga ShooterSession). */
export interface ManagedShooterSession extends ShooterSession {
  update(view: ShooterView): void
  setManager(manager: ShooterSessionDeps['manager']): void
  role(): 'host' | 'client' | 'espectador'
  /** só para teste e diagnóstico */
  readonly debug: { client(): ClientCore; hostState(): SimState | null; lastSnapshot(): Snapshot | undefined; statics(): SnapshotStatics | null }
}

const refOf = (p: ShooterView['players'][number]): SimPlayerRef => ({ slot: p.slot, id: p.id, bot: p.bot })

const IDLE_INPUT: InputState = { mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 }

export const shooterBinding: RealtimeGameBinding<ShooterTypes, ShooterView, InputState, ShooterFrame, FrameEvent> = {
  sim: shooterSim,
  createClient: (me) => new ClientCore({ sim: simApi, getMap, me }),
  refOf,
  idleInput: IDLE_INPUT,
  createState(v) {
    const state = simApi.createSim(v.players.map(refOf), v.options, v.seed)
    // partida que já tinha placar e não deixou retrato: mantém os números do coordenador
    for (const line of v.scores) {
      const p = state.players.find((x) => x.id === line.id)
      if (p) {
        p.kills = line.kills
        p.deaths = line.deaths
        p.damage = line.damage
      }
    }
    return state
  }
}

export function createShooterSession(deps: ShooterSessionDeps, env: SessionEnv = defaultEnv): ManagedShooterSession {
  return createRealtimeSession(shooterBinding, deps, env) as unknown as ManagedShooterSession
}

