/**
 * Implementação real de `SfuApi` sobre a API HTTP do Cloudflare Realtime SFU.
 * Tratamos como falha: HTTP fora de 2xx, `errorCode` no topo da resposta e `errorCode` em qualquer trilha.
 */
import type { Sdp } from '../shared/sfu'
import { SfuApiError, type SfuApi, type TrackObject, type TrackResult, type TracksResult } from './sfuApi'

const BASE = 'https://rtc.live.cloudflare.com/v1'

interface ApiBody {
  errorCode?: string
  errorDescription?: string
  sessionId?: string
  sessionDescription?: Sdp
  requiresImmediateRenegotiation?: boolean
  tracks?: TrackResult[]
}

export function realtimeApi(appId: string, secret: string, fetchFn: typeof fetch = fetch): SfuApi {
  const root = `${BASE}/apps/${encodeURIComponent(appId)}`

  async function call(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<ApiBody> {
    const res = await fetchFn(`${root}${path}`, {
      method,
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    let json: ApiBody = {}
    try {
      json = ((await res.json()) as ApiBody | null) ?? {}
    } catch {
      /* corpo vazio ou que não é JSON */
    }
    if (!res.ok) {
      throw new SfuApiError(res.status, json.errorCode ?? 'http', json.errorDescription ?? `HTTP ${res.status}`)
    }
    if (json.errorCode) throw new SfuApiError(res.status, json.errorCode, json.errorDescription ?? json.errorCode)
    const bad = json.tracks?.find((t) => t.errorCode)
    if (bad) throw new SfuApiError(res.status, bad.errorCode!, bad.errorDescription ?? bad.errorCode!)
    return json
  }

  const result = (json: ApiBody): TracksResult => ({
    sessionDescription: json.sessionDescription,
    requiresImmediateRenegotiation: json.requiresImmediateRenegotiation,
    tracks: json.tracks ?? []
  })
  const session = (id: string) => `/sessions/${encodeURIComponent(id)}`

  return {
    async newSession() {
      const json = await call('POST', '/sessions/new')
      if (!json.sessionId) throw new SfuApiError(200, 'no-session', 'A resposta não trouxe o sessionId.')
      return json.sessionId
    },
    async addTracks(sessionId: string, tracks: TrackObject[], offer?: Sdp) {
      const body = offer ? { sessionDescription: offer, tracks } : { tracks }
      return result(await call('POST', `${session(sessionId)}/tracks/new`, body))
    },
    async renegotiate(sessionId: string, answer: Sdp) {
      await call('PUT', `${session(sessionId)}/renegotiate`, { sessionDescription: answer })
    },
    async updateTracks(sessionId: string, tracks: TrackObject[]) {
      return result(await call('PUT', `${session(sessionId)}/tracks/update`, { tracks }))
    },
    async closeTracks(sessionId: string, mids: string[], offer?: Sdp) {
      const body = {
        tracks: mids.map((mid) => ({ mid })),
        force: !offer,
        ...(offer ? { sessionDescription: offer } : {})
      }
      return result(await call('PUT', `${session(sessionId)}/tracks/close`, body))
    }
  }
}
