import type { ShooterSession, ShooterSessionDeps } from '../contract'
import { useRealtimeSession } from '../../realtime/useRealtimeSession'
import { createShooterSession } from './session'

/**
 * Cria a sessão do Tiro na Sala quando há partida (`deps` não nulo) e a mantém enquanto for a mesma
 * partida (`view.createdAt`). Mudança de view/manager só atualiza a sessão; ela não é recriada.
 */
export function useShooterSession(deps: ShooterSessionDeps | null): ShooterSession | null {
  return useRealtimeSession(deps, createShooterSession, (view) => `${view.createdAt}|${view.you ? 'j' : 'e'}`)
}
