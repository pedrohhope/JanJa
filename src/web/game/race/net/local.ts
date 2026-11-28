/**
 * Sessão local (sem rede) para o laboratório /dev/corrida e os prints da vitrine: você no slot 0 e
 * robôs, tudo na mesma página. Usa o mesmo HostLoop e o mesmo RaceClient das partidas de verdade.
 */
import { BOT_SLOT_BASE, MAX_BOTS, TICK_MS, type BotLevel, type RaceInput, type RacePlayerView, type RaceSimState, type TrackId } from '../../../../shared/games/race/types'
import { raceSim } from '../../../../shared/games/race/sim'
import { HostLoop } from '../../realtime/hostLoop'
import type { RaceFrame, RaceFrameEvent, RaceSession } from '../contract'
import { RaceClient } from './client'
import { defaultEnv, refOf, type SessionEnv } from './session'
import { raceRealtime, type RaceTypes } from './realtimeBinding'

export interface RaceLocalOptions {
  trackId: TrackId
  bots: number
  laps?: number
  botLevel?: BotLevel
  /** sem você: só robôs (prints da vitrine) */
  watch?: boolean
}

export interface RaceLocalSession extends RaceSession {
  /** o estado do host (o laboratório mexe nele) */
  sim(): RaceSimState
  roster: RacePlayerView[]
}

export function createLocalSession(opts: RaceLocalOptions, env: Pick<SessionEnv, 'now' | 'every'> = defaultEnv): RaceLocalSession {
  const bots = Math.max(0, Math.min(MAX_BOTS, Math.floor(opts.bots)))
  const roster: RacePlayerView[] = []
  if (!opts.watch) roster.push({ id: 'voce', name: 'Você', slot: 0, bot: false, present: true })
  for (let i = 0; i < bots; i++) roster.push({ id: `bot-${i + 1}`, name: `Robô ${i + 1}`, slot: BOT_SLOT_BASE + i, bot: true, present: true })
  const state = raceSim.create(roster.map(refOf), { trackId: opts.trackId, laps: opts.laps ?? 3, botLevel: opts.botLevel ?? 'medio' })

  const me = opts.watch ? null : 0
  const client = new RaceClient({ me })
  client.beginEpoch(1)
  const listeners = new Set<(events: RaceFrameEvent[]) => void>()
  const flush = () => {
    const ev = client.drainEvents()
    if (ev.length) for (const cb of listeners) cb(ev)
  }
  const loop = new HostLoop<RaceTypes>(
    raceRealtime,
    { state, epoch: 1 },
    (m) => {
      if (m.k === 'snap' && client.onSnapshot(m.snap, env.now())) flush()
    },
    env.now()
  )

  let input: RaceInput = { seq: 0, steer: 0, buttons: 0 }
  let nextTickAt = 0
  const stop = env.every(8, () => {
    const now = env.now()
    if (nextTickAt === 0 || now - nextTickAt > 250) nextTickAt = now
    let n = 0
    while (nextTickAt <= now && n++ < 6) {
      nextTickAt += TICK_MS
      const inputs = client.localTick(now, input)
      if (inputs && me !== null) loop.handle({ k: 'input', slot: me, inputs: inputs.slice(-1) })
    }
    loop.advance(now)
    flush()
  })

  let cache: { at: number; frame: RaceFrame } | null = null
  return {
    roster,
    frame() {
      const now = env.now()
      if (cache && now - cache.at < 3) return cache.frame
      const f = client.frame(now)
      if (!f) return null
      f.net = 'host'
      f.pingMs = 0
      cache = { at: now, frame: f }
      return f
    },
    setInput(i) {
      input = i
    },
    onEvents(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    dispose() {
      stop()
      loop.handle({ k: 'stop' })
      listeners.clear()
    },
    sim: () => loop.state
  }
}
