/**
 * Sessão local (sem rede) para o laboratório /dev/briga: você no slot 0 e robôs, tudo na mesma
 * página. Usa o mesmo HostLoop e o mesmo BrawlClient das partidas de verdade.
 */
import {
  BOT_SLOT_BASE,
  CHARACTER_IDS,
  MAX_BOTS,
  TICK_MS,
  type ArenaId,
  type BotLevel,
  type BrawlInput,
  type BrawlMinutes,
  type BrawlMode,
  type BrawlPlayerView,
  type BrawlSimState,
  type CharacterId,
  type TeamSize
} from '../../../../shared/games/brawl/types'
import { brawlSim } from '../../../../shared/games/brawl/sim'
import { HostLoop } from '../../realtime/hostLoop'
import type { BrawlFrame, BrawlFrameEvent, BrawlSession } from '../contract'
import { BrawlClient } from './client'
import { refOf, defaultEnv, type SessionEnv } from './session'
import { brawlRealtime, type BrawlTypes } from './realtimeBinding'

export interface BrawlLocalOptions {
  arenaId: ArenaId
  bots: number
  /** o seu personagem */
  char?: CharacterId
  botLevel?: BotLevel
  mode?: BrawlMode
  stocks?: number
  minutes?: BrawlMinutes
  teamSize?: TeamSize
  friendlyFire?: boolean
  seed?: number
}

export interface BrawlLocalSession extends BrawlSession {
  /** o estado do host (o laboratório mexe nele) */
  sim(): BrawlSimState
  roster: BrawlPlayerView[]
}

export function createLocalSession(opts: BrawlLocalOptions, env: Pick<SessionEnv, 'now' | 'every'> = defaultEnv): BrawlLocalSession {
  const bots = Math.max(0, Math.min(MAX_BOTS, Math.floor(opts.bots)))
  const mine = opts.char ?? 'jan'
  const others = CHARACTER_IDS.filter((c) => c !== mine)
  const teamSize = opts.teamSize ?? 0
  const roster: BrawlPlayerView[] = []
  const add = (id: string, name: string, slot: number, bot: boolean, char: CharacterId) =>
    roster.push({ id, name, slot, bot, present: true, char, team: slot % 8, ready: true, spectating: false })
  add('voce', 'Você', 0, false, mine)
  for (let i = 0; i < bots; i++) add(`bot-${i + 1}`, `Robô ${i + 1}`, BOT_SLOT_BASE + i, true, others[i % others.length])
  if (teamSize > 0) {
    const teams = Math.min(4, Math.max(2, -Math.floor(-roster.length / teamSize)))
    roster.forEach((p, i) => (p.team = i % teams))
  }
  const seed = opts.seed ?? Math.floor(Math.random() * 0xffffffff) >>> 0
  const state = brawlSim.create(
    roster.map(refOf),
    {
      arenaId: opts.arenaId,
      mode: opts.mode ?? 'vidas',
      stocks: opts.stocks ?? 3,
      minutes: opts.minutes ?? 3,
      teamSize,
      friendlyFire: opts.friendlyFire ?? false,
      botLevel: opts.botLevel ?? 'medio'
    },
    seed
  )

  const client = new BrawlClient({ me: 0 })
  client.setRoster(roster)
  client.beginEpoch(1)
  const listeners = new Set<(events: BrawlFrameEvent[]) => void>()
  const flush = () => {
    const ev = client.drainEvents()
    if (ev.length) for (const cb of listeners) cb(ev)
  }
  const loop = new HostLoop<BrawlTypes>(
    brawlRealtime,
    { state, epoch: 1 },
    (m) => {
      if (m.k === 'snap' && client.onSnapshot(m.snap, env.now())) flush()
    },
    env.now()
  )

  let input: BrawlInput = { seq: 0, mx: 0, my: 0, buttons: 0 }
  let nextTickAt = 0
  const stop = env.every(8, () => {
    const now = env.now()
    if (nextTickAt === 0 || now - nextTickAt > 250) nextTickAt = now
    let n = 0
    while (nextTickAt <= now && n++ < 6) {
      nextTickAt += TICK_MS
      const inputs = client.localTick(now, input)
      if (inputs) loop.handle({ k: 'input', slot: 0, inputs: inputs.slice(-1) })
    }
    loop.advance(now)
    flush()
  })

  let cache: { at: number; frame: BrawlFrame } | null = null
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
