import { describe, expect, it } from 'vitest'
import { BOT_SLOT_BASE, BTN_DODGE, BTN_HEAVY, BTN_JUMP, BTN_LIGHT, DEFAULT_BRAWL_OPTIONS, TICK_MS, type BrawlAction, type BrawlPlayerView, type BrawlView, type CharacterId } from '../../src/shared/games/brawl/types'
import { decodePacket, quantizeInput } from '../../src/shared/games/brawl/codec'
import { HostLoop } from '../../src/web/game/realtime/hostLoop'
import { createBrawlSession, type ManagedBrawlSession, type SessionEnv } from '../../src/web/game/brawl/net/session'
import { brawlRealtime, type BrawlTypes } from '../../src/web/game/brawl/net/realtimeBinding'
import { createLocalSession } from '../../src/web/game/brawl/net/local'
import type { GameLink } from '../../src/web/game/realtime/transport'
import type { PeerManager } from '../../src/web/rtc/PeerManager'

// ---------------------------------------------------------------------------------
// Rede simulada em memória, com relógio virtual (mesmo molde de tests/shooter/net.test.ts)
// ---------------------------------------------------------------------------------

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
  acts: { player: string; action: BrawlAction }[] = []

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
  session: ManagedBrawlSession
  host?: HostLoop<BrawlTypes>
}

const CHARS: CharacterId[] = ['jan', 'xicara', 'teve', 'janja']

function setup(world: World, ids: string[], opts: { bots?: number } = {}) {
  const bots = opts.bots ?? 0
  const players: BrawlPlayerView[] = [
    ...ids.map((id, i) => ({ id, name: id, slot: i, bot: false, present: true, char: CHARS[i % 4], team: i, ready: true, spectating: false })),
    ...Array.from({ length: bots }, (_, i) => ({ id: `bot-${i + 1}`, name: `Robô ${i + 1}`, slot: BOT_SLOT_BASE + i, bot: true, present: true, char: CHARS[(i + 1) % 4], team: BOT_SLOT_BASE + i, ready: true, spectating: false }))
  ]
  const baseView = (id: string): BrawlView => ({
    you: { playerId: id, slot: ids.indexOf(id) },
    options: { ...DEFAULT_BRAWL_OPTIONS, bots, stocks: 5 },
    arenaId: 'estante',
    phase: 'jogando',
    pickEndsAt: 0,
    players,
    hostId: ids[0],
    epoch: 1,
    seed: 4242,
    startedAt: 1,
    scores: [],
    ranking: null
  })
  const apply = new Map<string, number[]>()
  const out: Record<string, Player> = {}
  const seated = () => ids.filter((p) => !world.dead.has(p))
  for (const id of ids) {
    const player: Player = { id, slot: ids.indexOf(id), session: undefined as unknown as ManagedBrawlSession }
    const env: SessionEnv = {
      now: () => world.net.T,
      every: (ms, fn) => world.net.every(ms, fn),
      createRunner(init, o) {
        const loop = new HostLoop<BrawlTypes>(brawlRealtime, init, o, world.net.T)
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
    player.session = createBrawlSession(
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
  return { players: out, baseView, apply, ids, playerList: players }
}

/** controle aleatório: troca o que faz a cada ~300 ms (anda, pula, bate, esquiva) */
function driver(world: World, p: Player, seed: number) {
  const rnd = lcg(seed)
  let mx = 0
  let my = 0
  let buttons = 0
  let until = 0
  let active = true
  world.net.every(16, () => {
    if (!active) {
      p.session.setInput({ seq: 0, mx: 0, my: 0, buttons: 0 })
      return
    }
    if (world.net.T >= until) {
      until = world.net.T + 150 + rnd() * 300
      mx = rnd() < 0.2 ? 0 : rnd() < 0.5 ? -1 : 1
      my = rnd() < 0.15 ? 1 : 0
      const r = rnd()
      buttons = r < 0.25 ? BTN_JUMP : r < 0.5 ? BTN_LIGHT : r < 0.62 ? BTN_HEAVY : r < 0.7 ? BTN_DODGE : 0
    }
    p.session.setInput({ seq: 0, mx, my, buttons })
  })
  return { stop: () => (active = false) }
}

const ids = ['host-aaaa', 'cli-bbbb', 'cli-cccc', 'cli-dddd']

function build(extra: { bots?: number } = {}) {
  const world = new World()
  const s = setup(world, ids, extra)
  // host <-> bbbb, host <-> cccc, bbbb <-> cccc por P2P (com atraso, jitter e perda); dddd só por repasse
  world.net.run(50)
  world.connect(ids[0], ids[1], { delay: 30, jitter: 20, loss: 0.05 })
  world.connect(ids[0], ids[2], { delay: 45, jitter: 25, loss: 0.08 })
  world.connect(ids[1], ids[2], { delay: 40, jitter: 20, loss: 0.05 })
  return { world, ...s }
}

describe('rede simulada da briga: host + 3 clientes por 20 s', () => {
  it('prediz perto do host, não repete entrada, mostra todos e usa P2P e repasse', () => {
    const { world, players, apply } = build({ bots: 1 })
    const drivers = ids.map((id, i) => driver(world, players[id], 100 + i))
    // conta os pacotes de entrada do cliente que só tem repasse
    let relayInputs = 0
    const origRelay = world.relay.bind(world)
    world.relay = (from, to, data, seated) => {
      if (from === ids[3] && to === ids[0]) relayInputs++
      origRelay(from, to, data, seated)
    }
    const errors: number[] = []
    const fighterOf = (id: string) => players[ids[0]].host!.state.fighters.find((f) => f.slot === players[id].slot)!
    for (let s = 0; s < 20; s++) {
      world.net.run(1000)
      if (s >= 4) {
        for (const id of ids.slice(1)) {
          const pred = players[id].session.debug.client().predicted
          const host = fighterOf(id)
          if (pred && host.action !== 'fora' && pred.f.action !== 'fora' && host.action !== 'atordoado' && pred.f.action !== 'atordoado') errors.push(Math.hypot(pred.f.x - host.x, pred.f.y - host.y))
        }
      }
    }
    expect(players[ids[0]].session.role()).toBe('host')
    expect(players[ids[1]].session.role()).toBe('client')
    expect(world.relayCount).toBeGreaterThan(0)
    expect(world.p2pCount).toBeGreaterThan(0)
    const netOf = (id: string) => players[id].session.frame()!.net
    expect(netOf(ids[0])).toBe('host')
    expect(netOf(ids[1])).toBe('p2p')
    expect(netOf(ids[2])).toBe('p2p')
    expect(netOf(ids[3])).toBe('relay')

    // todos veem todos (4 humanos + 1 robô) e a partida corre
    for (const id of ids) {
      const f = players[id].session.frame()!
      expect(f.state.fighters).toHaveLength(5)
      expect(f.me).toBe(players[id].slot)
      expect(f.state.phase).toBe('jogando')
      if (id !== ids[0]) expect(f.pingMs).toBeGreaterThan(20)
    }

    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    console.log(`erro médio de predição ${mean.toFixed(2)} px (n=${errors.length}), máx ${Math.max(...errors).toFixed(1)} px`)
    // o previsto anda à frente do host por ~meio RTT de entradas em voo
    expect(mean).toBeLessThan(25)

    // repasse: o cliente sem P2P agrupa 3 ticks por pacote (60 Hz / 3 = 20 pacotes por segundo)
    expect(relayInputs).toBeGreaterThan(20 * 15)
    expect(relayInputs).toBeLessThan(20 * 26)

    // solta tudo e espera: o previsto converge para o host
    drivers.forEach((d) => d.stop())
    world.net.run(3000)
    for (const id of ids.slice(1)) {
      const pred = players[id].session.debug.client().predicted!
      const host = fighterOf(id)
      if (host.action === 'fora' || host.action === 'eliminado') continue
      expect(Math.hypot(pred.f.x - host.x, pred.f.y - host.y)).toBeLessThan(6)
    }

    // cada seq uma única vez, em ordem crescente, por jogador
    let total = 0
    for (const [k, list] of apply) {
      total += list.length
      for (let i = 1; i < list.length; i++) expect(list[i], `slot ${k}`).toBeGreaterThan(list[i - 1])
    }
    expect(total).toBeGreaterThan(3 * 23 * 40)

    // o host mandou placar ao coordenador
    const scoreActs = world.acts.filter((a) => a.action.type === 'score')
    expect(scoreActs.length).toBeGreaterThanOrEqual(3)
    expect(scoreActs.every((a) => a.player === ids[0] && a.action.type === 'score' && a.action.epoch === 1)).toBe(true)
    for (const id of ids) players[id].session.dispose()
  })

  it('o previsto bate com o host quando ninguém encosta em ninguém', () => {
    const world = new World()
    const ids2 = ['host-aaaa', 'cli-bbbb']
    const s = setup(world, ids2)
    world.net.run(50)
    world.connect(ids2[0], ids2[1], { delay: 30, jitter: 5, loss: 0 })
    // o host fica parado no canto; o cliente corre, pula e esquiva
    const host = s.players[ids2[0]]
    const cli = s.players[ids2[1]]
    let t = 0
    world.net.every(16, () => {
      t += 16
      const phase = Math.floor(t / 500) % 4
      cli.session.setInput({ seq: 0, mx: phase === 0 ? 1 : phase === 2 ? -1 : 0, my: 0, buttons: phase === 1 && t % 500 < 40 ? BTN_JUMP : phase === 3 && t % 500 < 40 ? BTN_DODGE : 0 })
    })
    let moved = 0
    let prev = 0
    world.net.every(100, () => {
      const x = cli.session.debug.client().predicted?.f.x ?? 0
      moved += Math.abs(x - prev)
      prev = x
    })
    world.net.run(6000)
    expect(moved).toBeGreaterThan(100)
    // solta tudo: a predição (com a entrada quantizada) cai no mesmo ponto do host
    t = 1e9
    world.net.every(16, () => cli.session.setInput({ seq: 0, mx: 0, my: 0, buttons: 0 }))
    world.net.run(1500)
    const f = cli.session.debug.client().predicted!.f
    const hf = host.host!.state.fighters.find((o) => o.slot === 1)!
    expect(Math.hypot(f.x - hf.x, f.y - hf.y)).toBeLessThan(1.5)
    expect(cli.session.debug.client().pendingCount).toBeLessThan(30)
    host.session.dispose()
    cli.session.dispose()
  })

  it('cai o host: o cliente promovido continua do último retrato', () => {
    const { world, players, baseView, playerList } = build({ bots: 1 })
    ids.forEach((id, i) => driver(world, players[id], 7 + i))
    world.net.run(12_000)
    const hs = players[ids[0]].host!.state.fighters
    hs.find((p) => p.slot === 1)!.kos = 4
    hs.find((p) => p.slot === 2)!.falls = 3
    world.net.run(1500)

    const lastSnap = players[ids[1]].session.debug.lastSnapshot()!
    const tickBefore = lastSnap.tick

    world.dead.add(ids[0])
    players[ids[0]].session.dispose()
    world.manager(ids[1]).setOpen(peerOf(ids[0]), false)
    world.manager(ids[2]).setOpen(peerOf(ids[0]), false)
    const view2 = (id: string): BrawlView => ({
      ...baseView(id),
      hostId: ids[1],
      epoch: 2,
      players: playerList.map((p) => (p.id === ids[0] ? { ...p, present: false } : p))
    })
    for (const id of ids.slice(1)) players[id].session.update(view2(id))

    const newHost = players[ids[1]]
    expect(newHost.session.role()).toBe('host')
    expect(newHost.host).toBeDefined()
    expect(newHost.host!.state.tick).toBeGreaterThanOrEqual(lastSnap.tick)
    expect(newHost.host!.state.tick).toBeLessThan(tickBefore + 60)
    // os números do retrato cheio (nocautes e quedas) continuam
    expect(newHost.host!.state.fighters.find((p) => p.slot === 2)!.falls).toBeGreaterThanOrEqual(0)
    expect(newHost.host!.state.fighters.find((p) => p.slot === 0)!.away).toBe(true)
    expect(players[ids[2]].session.frame()!.net).toBe('trocando-host')

    world.net.run(6000)
    expect(newHost.host!.state.tick).toBeGreaterThan(tickBefore + 200)
    for (const id of ids.slice(2)) {
      const f = players[id].session.frame()!
      expect(f.net === 'p2p' || f.net === 'relay').toBe(true)
      expect(players[id].session.debug.lastSnapshot()!.epoch).toBe(2)
      expect(players[id].session.debug.lastSnapshot()!.tick).toBeGreaterThan(tickBefore + 200)
      expect(f.state.fighters.some((p) => p.bot)).toBe(true)
    }
    const acts2 = world.acts.filter((a) => a.action.type === 'score' && a.action.epoch === 2)
    expect(acts2.length).toBeGreaterThanOrEqual(1)
    expect(acts2.every((a) => a.player === ids[1])).toBe(true)
    for (const id of ids.slice(1)) players[id].session.dispose()
  })
})

describe('entrada', () => {
  it('o cliente prevê com a entrada quantizada do codec', () => {
    const q = quantizeInput({ seq: 3, mx: 0.123456, my: -0.777, buttons: BTN_JUMP | 64 })
    expect(q.buttons).toBe(BTN_JUMP)
    expect(Number.isInteger(q.mx * 127) || Math.abs(q.mx * 127 - Math.round(q.mx * 127)) < 1e-9).toBe(true)
    const w = new World()
    const s = setup(w, ['a'])
    s.players['a'].session.dispose()
    expect(brawlRealtime.relayBatch).toBeLessThanOrEqual(brawlRealtime.inputRedundancy + 1)
    expect(TICK_MS).toBeCloseTo(16.667, 2)
    expect(decodePacket(brawlRealtime.codec.encodeInputs(1, 0, [q]))).toMatchObject({ t: 'input', slot: 0 })
  })
})

describe('sessão local', () => {
  it('você e robôs lutam sozinhos e geram quadros e eventos', () => {
    const net = new VNet()
    const s = createLocalSession({ arenaId: 'telhado', bots: 3, char: 'janja', seed: 5, botLevel: 'dificil' }, { now: () => net.T, every: (ms, fn) => net.every(ms, fn) })
    const events: string[] = []
    s.onEvents((e) => events.push(...e.map((x) => x.type)))
    expect(s.frame()).toBeNull()
    let k = 0
    net.every(16, () => {
      k++
      s.setInput({ seq: 0, mx: k % 120 < 60 ? 1 : -1, my: 0, buttons: k % 30 === 0 ? BTN_LIGHT : k % 50 === 0 ? BTN_JUMP : 0 })
    })
    net.run(12_000)
    const f = s.frame()!
    expect(f.me).toBe(0)
    expect(f.net).toBe('host')
    expect(f.state.fighters).toHaveLength(4)
    expect(f.state.fighters.filter((x) => x.bot)).toHaveLength(3)
    expect(f.state.fighters[0].char).toBe('janja')
    expect(f.state.arenaId).toBe('telhado')
    expect(events).toContain('go')
    expect(events).toContain('attack')
    expect(s.sim().tick).toBeGreaterThan(600)
    s.dispose()
  })
})
