/**
 * Contrato com a API do Cloudflare Realtime SFU (https://rtc.live.cloudflare.com/v1/apps/{appId}/...).
 * O RoomCore só conhece esta interface; o Worker liga a implementação real (`realtimeApi`) e os testes usam um falso.
 * Campos seguem o OpenAPI realtime-api-2024-05-21.
 */
import type { Sdp } from '../shared/sfu'

export interface SimulcastOpts {
  preferredRid: string
  priorityOrdering?: 'none' | 'asciibetical'
  ridNotAvailable?: 'none' | 'asciibetical'
}

export interface TrackObject {
  location: 'local' | 'remote'
  mid?: string
  /** em `remote`: a sessão de quem publicou */
  sessionId?: string
  trackName: string
  kind?: 'audio' | 'video'
  simulcast?: SimulcastOpts
}

export interface TrackResult extends TrackObject {
  errorCode?: string
  errorDescription?: string
}

export interface TracksResult {
  sessionDescription?: Sdp
  requiresImmediateRenegotiation?: boolean
  tracks: TrackResult[]
}

/** falha da API: HTTP fora de 2xx ou `errorCode` no topo da resposta */
export class SfuApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export interface SfuApi {
  /** POST sessions/new (sem corpo) → sessionId */
  newSession(): Promise<string>
  /** POST sessions/{id}/tracks/new. Todas as trilhas `local` (push, com offer) ou todas `remote` (pull, sem SDP). */
  addTracks(sessionId: string, tracks: TrackObject[], offer?: Sdp): Promise<TracksResult>
  /** PUT sessions/{id}/renegotiate com o answer do cliente */
  renegotiate(sessionId: string, answer: Sdp): Promise<void>
  /** PUT sessions/{id}/tracks/update (troca de camada) */
  updateTracks(sessionId: string, tracks: TrackObject[]): Promise<TracksResult>
  /** PUT sessions/{id}/tracks/close, `force: false` quando vem offer, `true` quando não vem */
  closeTracks(sessionId: string, mids: string[], offer?: Sdp): Promise<TracksResult>
}

/** Orçamento global (DO singleton "Budget"). */
export interface BudgetApi {
  /** soma bytes da sala ao mês e ao dia da sala; devolve o estado (o pior entre mês e sala) */
  report(roomId: string, bytes: number): Promise<import('../shared/sfu').BudgetState>
  /** estado sem somar nada */
  peek(roomId: string): Promise<import('../shared/sfu').BudgetState>
}
