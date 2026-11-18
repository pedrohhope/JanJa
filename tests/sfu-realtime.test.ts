import { describe, expect, it } from 'vitest'
import { realtimeApi } from '../src/worker/realtime'
import { SfuApiError } from '../src/worker/sfuApi'

interface Seen {
  url: string
  method?: string
  headers: Record<string, string>
  body?: unknown
}

function fake(status: number, body: unknown) {
  const seen: Seen[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined
    })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { seen, api: realtimeApi('app1', 'segredo', fetchFn) }
}

const BASE = 'https://rtc.live.cloudflare.com/v1/apps/app1'
const sdp = { type: 'offer', sdp: 'v=0' } as const

describe('realtimeApi', () => {
  it('newSession: POST sem corpo, com autorização', async () => {
    const { api, seen } = fake(201, { sessionId: 's1' })
    expect(await api.newSession()).toBe('s1')
    expect(seen[0]).toMatchObject({ url: `${BASE}/sessions/new`, method: 'POST', body: undefined })
    expect(seen[0].headers).toEqual({ authorization: 'Bearer segredo', 'content-type': 'application/json' })
  })

  it('addTracks com offer (push) manda sessionDescription', async () => {
    const answer = { type: 'answer', sdp: 'a' }
    const { api, seen } = fake(200, { sessionDescription: answer, tracks: [{ location: 'local', mid: '0', trackName: 't' }] })
    const tracks = [{ location: 'local' as const, mid: '0', trackName: 't', kind: 'video' as const }]
    const res = await api.addTracks('s1', tracks, sdp)
    expect(seen[0]).toMatchObject({ url: `${BASE}/sessions/s1/tracks/new`, method: 'POST', body: { sessionDescription: sdp, tracks } })
    expect(res.sessionDescription).toEqual(answer)
    expect(res.tracks[0].mid).toBe('0')
  })

  it('addTracks sem offer (pull) não manda sdp', async () => {
    const { api, seen } = fake(200, { requiresImmediateRenegotiation: true, sessionDescription: sdp, tracks: [] })
    const tracks = [{ location: 'remote' as const, sessionId: 'x', trackName: 't' }]
    const res = await api.addTracks('s2', tracks)
    expect(seen[0].body).toEqual({ tracks })
    expect(res.requiresImmediateRenegotiation).toBe(true)
  })

  it('renegotiate: PUT com o answer', async () => {
    const { api, seen } = fake(200, {})
    await api.renegotiate('s1', { type: 'answer', sdp: 'a' })
    expect(seen[0]).toMatchObject({
      url: `${BASE}/sessions/s1/renegotiate`,
      method: 'PUT',
      body: { sessionDescription: { type: 'answer', sdp: 'a' } }
    })
  })

  it('updateTracks: PUT em tracks/update', async () => {
    const { api, seen } = fake(200, { tracks: [] })
    const tracks = [{ location: 'remote' as const, mid: '1', trackName: 't', simulcast: { preferredRid: 'b' } }]
    await api.updateTracks('s1', tracks)
    expect(seen[0]).toMatchObject({ url: `${BASE}/sessions/s1/tracks/update`, method: 'PUT', body: { tracks } })
  })

  it('closeTracks: force false com offer, true sem', async () => {
    const { api, seen } = fake(200, { sessionDescription: { type: 'answer', sdp: 'a' }, tracks: [{ mid: '0' }] })
    const res = await api.closeTracks('s1', ['0', '1'], sdp)
    expect(seen[0]).toMatchObject({
      url: `${BASE}/sessions/s1/tracks/close`,
      method: 'PUT',
      body: { tracks: [{ mid: '0' }, { mid: '1' }], force: false, sessionDescription: sdp }
    })
    expect(res.sessionDescription?.type).toBe('answer')
    await api.closeTracks('s1', ['0'])
    expect(seen[1].body).toEqual({ tracks: [{ mid: '0' }], force: true })
  })

  it('HTTP fora de 2xx lança SfuApiError', async () => {
    const { api } = fake(429, { errorCode: 'rate', errorDescription: 'devagar' })
    await expect(api.newSession()).rejects.toMatchObject({ status: 429, code: 'rate', message: 'devagar' })
    const { api: api2 } = fake(502, 'html ruim')
    const err = await api2.renegotiate('s', sdp).catch((e) => e)
    expect(err).toBeInstanceOf(SfuApiError)
    expect(err).toMatchObject({ status: 502, code: 'http' })
  })

  it('errorCode no topo e por trilha são falhas', async () => {
    const top = fake(200, { errorCode: 'bad', errorDescription: 'ruim', tracks: [] })
    await expect(top.api.addTracks('s', [], sdp)).rejects.toMatchObject({ code: 'bad', message: 'ruim' })
    const perTrack = fake(200, { tracks: [{ trackName: 'a' }, { trackName: 'b', errorCode: 'track_not_found', errorDescription: 'sumiu' }] })
    await expect(perTrack.api.updateTracks('s', [])).rejects.toMatchObject({ code: 'track_not_found', message: 'sumiu' })
    const noId = fake(201, {})
    await expect(noId.api.newSession()).rejects.toBeInstanceOf(SfuApiError)
  })
})
