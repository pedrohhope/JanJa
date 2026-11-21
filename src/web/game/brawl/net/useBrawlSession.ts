import type { BrawlSession, BrawlSessionDeps } from '../contract'
import { useRealtimeSession } from '../../realtime/useRealtimeSession'
import type { BrawlView } from '../../../../shared/games/brawl/types'
import { createBrawlSession, type ManagedBrawlSession } from './session'
import type { BrawlTypes } from './realtimeBinding'

/**
 * Cria a sessão da Briga quando há luta (`deps` não nulo) e a mantém enquanto for a mesma partida
 * (`view.startedAt`: a revanche começa outra). Mudança de view/manager só atualiza a sessão.
 */
export function useBrawlSession(deps: BrawlSessionDeps | null): BrawlSession | null {
  return useRealtimeSession<BrawlView, BrawlTypes, ManagedBrawlSession>(deps, (d) => createBrawlSession(d), (view) => `${view.startedAt}|${view.you ? 'j' : 'e'}`)
}
