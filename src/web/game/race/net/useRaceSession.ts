import type { RaceSession, RaceSessionDeps } from '../contract'
import { useRealtimeSession } from '../../realtime/useRealtimeSession'
import type { RaceView } from '../../../../shared/games/race/types'
import { createRaceSession, type ManagedRaceSession } from './session'
import type { RaceTypes } from './realtimeBinding'

/**
 * Cria a sessão da Corrida quando há partida (`deps` não nulo) e a mantém enquanto for a mesma
 * (`view.createdAt`: "jogar de novo" abre outra). Mudança de view/manager só atualiza a sessão.
 */
export function useRaceSession(deps: RaceSessionDeps | null): RaceSession | null {
  return useRealtimeSession<RaceView, RaceTypes, ManagedRaceSession>(deps, (d) => createRaceSession(d), (view) => `${view.createdAt}|${view.you ? 'j' : 'e'}`)
}
