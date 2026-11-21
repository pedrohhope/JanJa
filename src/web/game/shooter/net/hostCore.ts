/**
 * Laço da simulação do host do Tiro: o laço genérico (`realtime/hostLoop.ts`) com a sim do tiro.
 * Roda dentro do Web Worker (hostWorker.ts) ou, se o Worker não existir, na thread principal.
 */
import { HostLoop as BaseHostLoop } from '../../realtime/hostLoop'
import type { HostIn as GenericHostIn, HostOut as GenericHostOut } from '../../realtime/types'
import { shooterSim, type ShooterTypes } from './realtimeBinding'

export { EVENT_WINDOW_TICKS, MAX_CATCHUP_MS, MAX_QUEUE, STALE_TICKS } from '../../realtime/hostLoop'
export { sanitizeInput } from './realtimeBinding'

export type HostIn = GenericHostIn<ShooterTypes>
export type HostOut = GenericHostOut<ShooterTypes>

export class HostLoop extends BaseHostLoop<ShooterTypes> {
  constructor(init: { state: ShooterTypes['State']; epoch: number }, out: (m: HostOut) => void, now: number) {
    super(shooterSim, init, out, now)
  }
}
