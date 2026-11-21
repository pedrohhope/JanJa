/**
 * Transporte do Tiro na Sala: o transporte genérico (`realtime/transport.ts`) com o codec do tiro.
 * Mesmo fio de antes: canal P2P "game" quando aberto e com HELLO feito, senão repasse `game-relay`.
 */
import { Transport as BaseTransport, type TransportDeps as BaseDeps } from '../../realtime/transport'
import { shooterSim } from './realtimeBinding'

export { HELLO_RETRY_MS, type GameLink, type Route } from '../../realtime/transport'
export type TransportDeps = Omit<BaseDeps, 'codec'>

export class Transport extends BaseTransport {
  constructor(deps: TransportDeps) {
    super({ ...deps, codec: shooterSim.codec })
  }
}
