import { describe, expect, it } from 'vitest'
import { BOT_SLOT_BASE, BTN_BRAKE, BTN_GAS, DEFAULT_RACE_OPTIONS, type RaceAction, type RacePlayerView, type RaceView } from '../../src/shared/games/race/types'
import { HostLoop } from '../../src/web/game/realtime/hostLoop'
import { createRaceSession, type ManagedRaceSession, type SessionEnv } from '../../src/web/game/race/net/session'
import { raceRealtime, type RaceTypes } from '../../src/web/game/race/net/realtimeBinding'
import type { GameLink } from '../../src/web/game/realtime/transport'
import type { PeerManager } from '../../src/web/rtc/PeerManager'

// Rede simulada em memória, com relógio virtual (mesmo molde de tests/brawl/net.test.ts)

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface LinkCfg {
  delay: number
  jitter: number
  loss: number
}

class VNet {
  T = 0
  private timers: { next: number; ms: number; fn: () => void; dead: boolean }[] = []
  private queue: { at: number; n: number; fn: () => void }[] = []
  private n = 0
  rnd = lcg(2024)
  every(ms: number, fn: () => void): () => void {
    const t = { next: this.T + ms, ms, fn, dead: false }
    this.timers.push(t)
    return () => (t.dead = true)
  }
  after(delay: number, fn: () => void) {
    this.queue.push({ at: this.T + Math.max(0, delay), n: this.n++, fn })
  }
  /** avança 1 ms */
  tick() {
    this.T += 1
    for (;;) {
      const due = this.queue.filter((q) => q.at <= this.T).sort((a, b) => a.at - b.at || a.n - b.n)
      if (!due.length) break
      this.queue = this.queue.filter((q) => q.at > this.T)
      for (const q of due) q.fn()
    }
    for (const t of this.timers) {
      if (t.dead) continue
      while (t.next <= this.T && !t.dead) {
        t.next += t.ms
        t.fn()
      }
    }
    this.timers = this.timers.filter((t) => !t.dead)
  }
  run(ms: number) {
    for (let i = 0; i < ms; i++) this.tick()
  }
}

class FakeManager implements GameLink {
  readonly open = new Set<string>()
  private readonly gameCbs = new Set<(peer: string, data: ArrayBuffer) => void>()
  private readonly stateCbs = new Set<(peer: string, open: boolean) => void>()
  constructor(
    readonly player: string,
    private readonly world: World
  ) {}
  sendGame(peer: string, data: ArrayBuffer): boolean {
    if (!this.open.has(peer)) return false
    this.world.p2p(this.player, peer, data)
    return true
  }
  gameOpen = (peer: string) => this.open.has(peer)
  openGamePeers = () => [...this.open]
  onGame(cb: (peer: string, data: ArrayBuffer) => void) {
    this.gameCbs.add(cb)
    return () => this.gameCbs.delete(cb)
  }
  onGameState(cb: (peer: string, open: boolean) => void) {
    this.stateCbs.add(cb)
    return () => this.stateCbs.delete(cb)
  }
  receive(fromPeer: string, data: ArrayBuffer) {
    for (const cb of this.gameCbs) cb(fromPeer, data)
  }
  setOpen(peer: string, open: boolean) {
    if (open) this.open.add(peer)
    else this.open.delete(peer)
    for (const cb of this.stateCbs) cb(peer, open)
  }
}

const peerOf = (player: string) => `peer-${player}`

class World {
  net = new VNet()
  managers = new Map<string, FakeManager>()
  relayListeners = new Map<string, Set<(from: string, data: string) => void>>()
  /** pares com canal P2P aberto -> config */
  links = new Map<string, LinkCfg>()
  dead = new Set<string>()
  relayCfg: LinkCfg = { delay: 40, jitter: 10, loss: 0 }
  relayCount = 0
  p2pCount = 0
  acts: { player: string; action: RaceAction }[] = []

  manager(player: string): FakeManager {
    let m = this.managers.get(player)
    if (!m) this.managers.set(player, (m = new FakeManager(player, this)))
    return m
  }
  private key(a: string, b: string) {
    return [a, b].sort().join('|')
  }
  connect(a: string, b: string, cfg: LinkCfg) {
    this.links.set(this.key(a, b), cfg)
    this.manager(a).setOpen(peerOf(b), true)
    this.manager(b).setOpen(peerOf(a), true)
  }
  p2p(from: string, toPeer: string, data: ArrayBuffer) {
    const to = toPeer.replace('peer-', '')
    const cfg = this.links.get(this.key(from, to))
    if (!cfg || this.dead.has(from) || this.dead.has(to)) return
    this.p2pCount++
    if (this.net.rnd() < cfg.loss) return
    const copy = data.slice(0)
    this.net.after(cfg.delay + this.net.rnd() * cfg.jitter, () => {
      if (!this.dead.has(to)) this.manager(to).receive(peerOf(from), copy)
    })
  }
  relay(from: string, to: string, data: string, seated: string[]) {
    if (this.dead.has(from)) return
    this.relayCount++
    const targets = to === '*' ? seated.filter((p) => p !== from) : [to]
    for (const t of targets) {
      this.net.after(this.relayCfg.delay + this.net.rnd() * this.relayCfg.jitter, () => {
        if (this.dead.has(t)) return
        for (const cb of this.relayListeners.get(t) ?? []) cb(from, data)
      })
    }
  }
}
interface Player {
  id: string
  slot: number
  session: ManagedRaceSession
  host?: HostLoop<RaceTypes>
}

function setup(world: World, ids: string[], bots = 0) {
  const players: RacePlayerView[] = [
    ...ids.map((id, i) => ({ id, name: id, slot: i, bot: false, present: true })),
    ...Array.from({ length: bots }, (_, i) => ({ id: `bot-${i + 1}`, name: `Robô ${i + 1}`, slot: BOT_SLOT_BASE + i, bot: true, present: true }))
  ]
  const baseView = (id: string): RaceView => ({
    you: { playerId: id, slot: ids.indexOf(id) },
    options: { ...DEFAULT_RACE_OPTIONS, bots, laps: 7 },
    trackId: 'sala',
    phase: 'jogando',
    players,
    hostId: ids[0]!,
    epoch: 1,
    createdAt: 1,
    scores: [],
    ranking: null
  })
  const apply = new Map<string, number[]>()
  const out: Record<string, Player> = {}
  const seated = () => ids.filter((p) => !world.dead.has(p))
  for (const id of ids) {
    const player: Player = { id, slot: ids.indexOf(id), session: undefined as unknown as ManagedRaceSession }
    const env: SessionEnv = {
      now: () => world.net.T,
      every: (ms, fn) => world.net.every(ms, fn),
      createRunner(init, o) {
        const loop = new HostLoop<RaceTypes>(raceRealtime, init, o, world.net.T)
        loop.onApply = (slot, seq) => {
          const k = `${init.epoch}:${slot}`
          const list = apply.get(k) ?? []
          list.push(seq)
          apply.set(k, list)
        }
        player.host = loop
        const stop = world.net.every(8, () => loop.advance(world.net.T))
        return {
          kind: 'main',
          handle: (m) => loop.handle(m),
          dispose: () => {
            stop()
            loop.handle({ k: 'stop' })
          }
        }
      }
    }
    player.session = createRaceSession(
      {
        view: baseView(id),
        manager: world.manager(id) as unknown as PeerManager,
        relay: (to, data) => world.relay(id, to, data, seated()),
        onRelay: (cb) => {
          const set = world.relayListeners.get(id) ?? new Set()
          world.relayListeners.set(id, set)
          set.add(cb)
          return () => set.delete(cb)
        },
        act: (action) => world.acts.push({ player: id, action })
      },
      env
    )
    out[id] = player
  }
  return { players: out, baseView, apply, playerList: players }
}

/** piloto aleatório: acelera quase sempre e troca o volante a cada ~300 ms */
function driver(world: World, p: Player, seed: number) {
  const rnd = lcg(seed)
  let steer = 0
  let buttons = BTN_GAS
  let until = 0
  let active = true
  world.net.every(16, () => {
    if (!active) {
      p.session.setInput({ seq: 0, steer: 0, buttons: 0 })
      return
    }
    if (world.net.T >= until) {
      until = world.net.T + 150 + rnd() * 300
      steer = rnd() < 0.4 ? 0 : rnd() * 2 - 1
      buttons = rnd() < 0.85 ? BTN_GAS : BTN_BRAKE
    }
    p.session.setInput({ seq: 0, steer, buttons })
  })
  return { stop: () => (active = false) }
}

const ids = ['host-aaaa', 'cli-bbbb', 'cli-cccc']

function build(bots = 0) {
  const world = new World()
  const s = setup(world, ids, bots)
  world.net.run(50)
  // host <-> bbbb por P2P (atraso, jitter e perda); cccc só por repasse
  world.connect(ids[0]!, ids[1]!, { delay: 35, jitter: 20, loss: 0.05 })
  return { world, ...s }
}

describe('rede simulada da corrida', () => {
  it('prediz perto do host, não repete entrada e usa P2P e repasse', () => {
    const { world, players, apply } = build(2)
    const drivers = ids.map((id, i) => driver(world, players[id]!, 300 + i))
    const errors: number[] = []
    const carOf = (id: string) => players[ids[0]!]!.host!.state.cars.find((c) => c.slot === players[id]!.slot)!
    for (let s = 0; s < 16; s++) {
      world.net.run(1000)
      if (s >= 5) {
        for (const id of ids.slice(1)) {
          const pred = players[id]!.session.debug.client().predicted
          const host = carOf(id)
          if (pred) errors.push(Math.hypot(pred.c.x - host.x, pred.c.y - host.y))
        }
      }
    }
    expect(players[ids[0]!]!.session.role()).toBe('host')
    expect(players[ids[1]!]!.session.frame()!.net).toBe('p2p')
    expect(players[ids[2]!]!.session.frame()!.net).toBe('relay')
    expect(world.relayCount).toBeGreaterThan(0)
    expect(world.p2pCount).toBeGreaterThan(0)
    for (const id of ids) {
      const f = players[id]!.session.frame()!
      expect(f.state.cars).toHaveLength(5)
      expect(f.me).toBe(players[id]!.slot)
      expect(f.state.phase).toBe('correndo')
    }
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    // o previsto anda à frente do host por ~meio RTT de entradas em voo (3 px por tick no talo)
    expect(mean).toBeLessThan(30)

    // solta tudo e espera: o previsto converge para o host
    drivers.forEach((d) => d.stop())
    world.net.run(4000)
    for (const id of ids.slice(1)) {
      const pred = players[id]!.session.debug.client().predicted!
      const host = carOf(id)
      expect(Math.hypot(pred.c.x - host.x, pred.c.y - host.y)).toBeLessThan(4)
    }
    for (const [k, list] of apply) for (let i = 1; i < list.length; i++) expect(list[i], k).toBeGreaterThan(list[i - 1]!)
    const scoreActs = world.acts.filter((a) => a.action.type === 'score')
    expect(scoreActs.length).toBeGreaterThanOrEqual(2)
    expect(scoreActs.every((a) => a.player === ids[0])).toBe(true)
    for (const id of ids) players[id]!.session.dispose()
  })

  it('cai o host: o cliente promovido continua a corrida do último retrato', () => {
    const { world, players, baseView, playerList } = build(1)
    ids.forEach((id, i) => driver(world, players[id]!, 11 + i))
    world.net.run(9000)
    const before = players[ids[1]!]!.session.debug.lastSnapshot()!
    const lapsBefore = before.cars.map((c) => c.lap)

    world.dead.add(ids[0]!)
    players[ids[0]!]!.session.dispose()
    world.manager(ids[1]!).setOpen(peerOf(ids[0]!), false)
    const view2 = (id: string): RaceView => ({ ...baseView(id), hostId: ids[1]!, epoch: 2, players: playerList.map((p) => (p.id === ids[0] ? { ...p, present: false } : p)) })
    for (const id of ids.slice(1)) players[id]!.session.update(view2(id))
    world.net.run(4000)

    const nh = players[ids[1]!]!
    expect(nh.session.role()).toBe('host')
    const st = nh.host!.state
    expect(st.tick).toBeGreaterThan(before.tick + 60)
    expect(st.cars.map((c) => c.lap).every((l, i) => l >= lapsBefore[i]!)).toBe(true)
    expect(st.cars.find((c) => c.slot === 0)!.away).toBe(true)
    expect(st.cars.map((c) => c.id)).toEqual(['host-aaaa', 'cli-bbbb', 'cli-cccc', 'bot-1'])
    // o outro cliente segue recebendo
    expect(players[ids[2]!]!.session.frame()!.state.tick).toBeGreaterThan(before.tick)
    for (const id of ids.slice(1)) players[id]!.session.dispose()
  })
})
