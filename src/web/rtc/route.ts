/**
 * Decide por onde vai a tela de quem compartilha: P2P (mesh) ou SFU da Cloudflare.
 * Tudo puro: o tempo entra por parâmetro, como no autoQuality.ts.
 */
import type { BudgetState, RoutePref, ScreenRoute } from '../../shared/sfu'

/** com tantos espectadores (ou mais) a tela vai pelo servidor */
export const SFU_MIN_VIEWERS = 3
/** com 2 espectadores, vai pelo servidor se o envio ficar limitado por tanto tempo seguido... */
export const LIMITED_MS = 10_000
/** ...e o nível automático já estiver nesse ou abaixo (1 = 720p30 na escada do automático) */
export const LIMITED_MAX_LEVEL = 1
/** volta para o P2P depois de tanto tempo com 1 espectador (ou nenhum) */
export const BACK_TO_MESH_MS = 60_000
/** fica pelo menos isso numa rota antes de trocar (fora orçamento, preferência e falha) */
export const MIN_DWELL_MS = 120_000
/** depois de uma falha no SFU, não tenta de novo por tanto tempo */
export const FAILURE_COOLDOWN_MS = 5 * 60_000

export interface RouteInputs {
  current: ScreenRoute
  pref: RoutePref
  /** espectadores da tela no canal (todos menos quem compartilha) */
  viewers: number
  /** há quanto tempo, seguido, algum sender da tela está limitado por banda ou CPU (0 = não está) */
  limitedMs: number
  /** nível atual da escada automática (sem automático: undefined) */
  level?: number
  /** há quanto tempo está na rota atual */
  sinceSwitchMs: number
  /** há quanto tempo o número de espectadores está em 1 ou menos (0 = tem mais que 1) */
  fewViewersMs: number
  budget: BudgetState
  /** SFU configurado no deploy (welcome.sfu.enabled) */
  sfuEnabled: boolean
  /** há quanto tempo foi a última falha no SFU (undefined = nunca falhou) */
  sinceFailureMs?: number
}

export type RouteReason =
  | 'muitos' // muita gente assistindo
  | 'limitado' // envio no limite com 2 assistindo
  | 'poucos' // sobrou 1 pessoa assistindo
  | 'orcamento' // cota do mês (ou da sala) acabou
  | 'preferencia' // escolha manual
  | 'falha' // o servidor falhou
  | 'indisponivel' // SFU não configurado

export interface RouteDecision {
  route: ScreenRoute
  /** presente só quando a decisão muda a rota atual */
  reason?: RouteReason
}

export function sfuUsable(i: Pick<RouteInputs, 'budget' | 'sfuEnabled' | 'sinceFailureMs'>): RouteReason | undefined {
  if (!i.sfuEnabled) return 'indisponivel'
  if (i.budget === 'esgotado') return 'orcamento'
  if (i.sinceFailureMs !== undefined && i.sinceFailureMs < FAILURE_COOLDOWN_MS) return 'falha'
  return undefined
}

export function decideRoute(i: RouteInputs): RouteDecision {
  const stay: RouteDecision = { route: i.current }
  const to = (route: ScreenRoute, reason: RouteReason): RouteDecision => (route === i.current ? stay : { route, reason })

  const blocked = sfuUsable(i)
  if (blocked) return to('mesh', blocked)

  if (i.pref === 'mesh') return to('mesh', 'preferencia')
  if (i.pref === 'sfu') return to('sfu', 'preferencia')

  const dwelled = i.sinceSwitchMs >= MIN_DWELL_MS
  if (i.current === 'mesh') {
    // ir para o servidor por causa de muita gente não espera o tempo mínimo: é o caso que mais pesa
    if (i.viewers >= SFU_MIN_VIEWERS) return to('sfu', 'muitos')
    if (
      dwelled &&
      i.viewers === 2 &&
      i.limitedMs >= LIMITED_MS &&
      i.level !== undefined &&
      i.level <= LIMITED_MAX_LEVEL
    ) {
      return to('sfu', 'limitado')
    }
    return stay
  }

  // no servidor
  if (dwelled && i.viewers <= 1 && i.fewViewersMs >= BACK_TO_MESH_MS) return to('mesh', 'poucos')
  return stay
}
