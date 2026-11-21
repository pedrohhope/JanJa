import { describe, expect, it } from 'vitest'
import { HostLoop } from '../../src/web/game/realtime/hostLoop'
import { createRealtimeSession, type ManagedRealtimeSession, type SessionEnv } from '../../src/web/game/realtime/session'
import type { CoordAction } from '../../src/web/game/realtime/types'
import type { GameLink } from '../../src/web/game/realtime/transport'
import type { PeerManager } from '../../src/web/rtc/PeerManager'
import { toyBinding, toyCodec, toySim, TOY_TICK_MS, type ToyControls, type ToyEvent, type ToyFrame, type ToyTypes, type ToyView } from './toy'

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** relógio virtual de 1 ms com temporizadores e entregas atrasadas */
class VNet {
  T = 0
  private timers: { next: number; ms: number; fn: () => void; dead: boolean }[] = []
  private queue: { at: number; n: number; fn: () => void }[] = []
  private n = 0
  rnd = lcg(77)
  every(ms: number, fn: () => void) {
    const t = { next: this.T + ms, ms, fn, dead: false }
    this.timers.push(t)
    return () => (t.dead = true)
  }
  after(delay: number, fn: () => void) {
    this.queue.push({ at: this.T + Math.max(0, delay), n: this.n++, fn })
  }
  run(ms: number) {
    for (let i = 0; i < ms; i++) {
      this.T += 1
      for (;;) {
        const due = this.queue.filter((q) => q.at <= this.T).sort((a, b) => a.at - b.at || a.n - b.n)
        if (!due.length) break
        this.queue = this.queue.filter((q) => q.at > this.T)
        for (const q of due) q.fn()
      }
      for (const t of this.timers) {
        while (!t.dead && t.next <= this.T) {
          t.next += t.ms
          t.fn()
        }
      }
      this.timers = this.timers.filter((t) => !t.dead)
    }
  }
}

const peerOf = (id: string) => `peer-${id}`

class FakeManager implements GameLink {
  open = new Set<string>()
  private gameCbs = new Set<(peer: string, d: ArrayBuffer) => void>()
  private stateCbs = new Set<(peer: string, open: boolean) => void>()
  constructor(
    readonly id: string,
    private readonly world: World
  ) {}
  sendGame(peer: string, d: ArrayBuffer) {
    if (!this.open.has(peer)) return false
    this.world.p2p(this.id, peer.replace('peer-', ''), d)
    return true
  }
  gameOpen = (p: string) => this.open.has(p)
  openGamePeers = () => [...this.open]
  onGame(cb: (peer: string, d: ArrayBuffer) => void) {
    this.gameCbs.add(cb)
    return () => this.gameCbs.delete(cb)
  }
  onGameState(cb: (peer: string, open: boolean) => void) {
    this.stateCbs.add(cb)
    return () => this.stateCbs.delete(cb)
  }
  receive(peer: string, d: ArrayBuffer) {
    for (const cb of this.gameCbs) cb(peer, d)
  }
  setOpen(peer: string, open: boolean) {
    if (open) this.open.add(peer)
    else this.open.delete(peer)
    for (const cb of this.stateCbs) cb(peer, open)
  }
}

class World {
  net = new VNet()
  managers = new Map<string, FakeManager>()
  relayListeners = new Map<string, Set<(from: string, d: string) => void>>()
  links = new Map<string, { delay: number; loss: number }>()
  dead = new Set<string>()
  acts: { id: string; action: CoordAction<ToyTypes> }[] = []
  /** pacotes de entrada que cada jogador mandou pelo repasse / por P2P */
  relayInputs = new Map<string, number>()
  p2pInputs = new Map<string, number>()
  manager(id: string) {
    let m = this.managers.get(id)
    if (!m) this.managers.set(id, (m = new FakeManager(id, this)))
    return m
  }
  key = (a: string, b: string) => [a, b].sort().join('|')
  connect(a: string, b: string, delay: number, loss = 0) {
    this.links.set(this.key(a, b), { delay, loss })
    this.manager(a).setOpen(peerOf(b), true)
    this.manager(b).setOpen(peerOf(a), true)
  }
  p2p(from: string, to: string, d: ArrayBuffer) {
    const cfg = this.links.get(this.key(from, to))
    if (!cfg || this.dead.has(from) || this.dead.has(to)) return
    if (toyCodec.decode(d)?.t === 'input') this.p2pInputs.set(from, (this.p2pInputs.get(from) ?? 0) + 1)
    if (this.net.rnd() < cfg.loss) return
    const copy = d.slice(0)
    this.net.after(cfg.delay, () => !this.dead.has(to) && this.manager(to).receive(peerOf(from), copy))
  }
  relay(from: string, to: string, text: string, all: string[]) {
    if (this.dead.has(from)) return
    const d = toyCodec.fromBase64(text)
    if (d && toyCodec.decode(d)?.t === 'input') this.relayInputs.set(from, (this.relayInputs.get(from) ?? 0) + 1)
    for (const t of to === '*' ? all.filter((p) => p !== from) : [to]) {
      this.net.after(40, () => {
        if (!this.dead.has(t)) for (const cb of this.relayListeners.get(t) ?? []) cb(from, text)
      })
    }
  }
}

const ids = ['host', 'bbbb', 'cccc']

function setup(world: World, endTick = 1_000_000) {
  const playerList = ids.map((id, slot) => ({ id, name: id, slot, bot: false, present: true }))
  const baseView = (id: string): ToyView => ({
    you: { playerId: id, slot: ids.indexOf(id) },
    phase: 'jogando',
    players: playerList,
    hostId: ids[0],
    epoch: 1,
    endTick
  })
  const sessions: Record<string, ManagedRealtimeSession<ToyTypes, ToyView, ToyControls, ToyFrame, ToyEvent>> = {}
  const loops: Record<string, HostLoop<ToyTypes>> = {}
  const applied = new Map<string, number[]>()
  const events: Record<string, ToyEvent[]> = {}
  for (const id of ids) {
    const env: SessionEnv<ToyTypes> = {
      now: () => world.net.T,
      every: (ms, fn) => world.net.every(ms, fn),
      createRunner(init, out) {
        const loop = new HostLoop(toySim, init, out, world.net.T)
        loop.onApply = (slot, seq) => {
          const k = `${init.epoch}:${slot}`
          applied.set(k, [...(applied.get(k) ?? []), seq])
        }
        loops[id] = loop
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
    const s = createRealtimeSession(
      toyBinding,
      {
        view: baseView(id),
        manager: world.manager(id) as unknown as PeerManager,
        relay: (to, d) => world.relay(id, to, d, ids.filter((p) => !world.dead.has(p))),
        onRelay: (cb) => {
          const set = world.relayListeners.get(id) ?? new Set()
          world.relayListeners.set(id, set)
          set.add(cb)
          return () => set.delete(cb)
        },
        act: (action) => world.acts.push({ id, action })
      },
      env
    )
    events[id] = []
    s.onEvents((e) => events[id].push(...e))
    sessions[id] = s
  }
  return { sessions, loops, applied, events, baseView, playerList }
}

function holdRight(world: World, s: ManagedRealtimeSession<ToyTypes, ToyView, ToyControls, ToyFrame, ToyEvent>) {
  world.net.every(16, () => s.setInput({ mx: 1 }))
}

describe('sessão genérica com sim de brinquedo a 60 Hz', () => {
  it('host + 2 clientes por P2P: prediz perto do host, mostra todos e não repete entrada', () => {
    const world = new World()
    const { sessions, loops, applied } = setup(world)
    world.net.run(20)
    world.connect('host', 'bbbb', 30)
    world.connect('host', 'cccc', 45)
    world.connect('bbbb', 'cccc', 40)
    for (const id of ids) holdRight(world, sessions[id])
    world.net.run(6000)

    expect(sessions.host.role()).toBe('host')
    expect(sessions.bbbb.role()).toBe('client')
    expect(sessions.host.frame()!.net).toBe('host')
    expect(sessions.bbbb.frame()!.net).toBe('p2p')
    const host = loops.host.state
    expect(Math.abs(host.tick - 6000 / TOY_TICK_MS)).toBeLessThan(8)
    for (const id of ids.slice(1)) {
      const slot = ids.indexOf(id)
      const pred = sessions[id].debug.client().predicted!
      const real = host.players.find((p) => p.slot === slot)!
      // a predição anda à frente do host por no máximo ida e volta em ticks
      expect(pred.x).toBeGreaterThanOrEqual(real.x)
      expect(pred.x - real.x).toBeLessThan(2 * 20)
      const f = sessions[id].frame()!
      expect(Object.keys(f.xs)).toHaveLength(3)
      expect(f.pingMs).toBeGreaterThan(40)
      // outros são desenhados um pouco no passado do host
      const other = host.players.find((p) => p.slot === 0)!
      expect(other.x - f.xs[0]).toBeGreaterThan(0)
      expect(other.x - f.xs[0]).toBeLessThan(2 * 25)
    }
    for (const [, list] of applied) expect(new Set(list).size).toBe(list.length)
  })

  it('reconcilia: um empurrão do host corrige a predição e as entradas confirmadas saem da fila', () => {
    const world = new World()
    const { sessions, loops } = setup(world)
    world.connect('host', 'bbbb', 30)
    world.connect('host', 'cccc', 30)
    holdRight(world, sessions.bbbb)
    world.net.run(3000)
    const client = sessions.bbbb.debug.client()
    expect(client.pendingCount).toBeLessThan(15)
    // o host teletransporta o jogador 1 (colisão, empurrão...): a predição precisa seguir o host
    loops.host.state.players[1].x += 500
    world.net.run(600)
    const real = loops.host.state.players[1]
    const pred = client.predicted!
    expect(Math.abs(pred.x - real.x)).toBeLessThan(50)
    expect(client.latest!.players.find((p) => p.slot === 1)!.lastSeq).toBeGreaterThan(100)
  })

  it('eventos chegam uma vez só em cada cliente, mesmo repetidos nos snapshots', () => {
    const world = new World()
    const { sessions, events } = setup(world)
    world.connect('host', 'bbbb', 25, 0.1)
    world.connect('host', 'cccc', 25)
    world.net.run(6200)
    const beats = (id: string) => events[id].filter((e) => e.type === 'beat').map((e) => (e as { n: number }).n)
    for (const id of ['bbbb', 'cccc']) {
      const list = beats(id)
      expect(new Set(list).size).toBe(list.length)
      expect(list.length).toBeGreaterThan(8)
    }
    expect(sessions.host.role()).toBe('host')
  })

  it('só pelo repasse agrupa relayBatch ticks por pacote (e nenhuma entrada se perde)', () => {
    const world = new World()
    const { sessions, applied } = setup(world)
    holdRight(world, sessions.bbbb)
    world.net.run(5000)
    const sent = world.relayInputs.get('bbbb') ?? 0
    // 60 ticks/s / 3 = 20 pacotes/s
    expect(sent).toBeGreaterThan(80)
    expect(sent).toBeLessThan(120)
    expect(world.p2pInputs.get('bbbb') ?? 0).toBe(0)
    const seqs = applied.get('1:1')!
    expect(seqs.length).toBeGreaterThan(250)
    // sem perda no repasse: sem buraco na sequência
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1)
    expect(sessions.bbbb.frame()!.net).toBe('relay')
  })

  it('por P2P manda um pacote por tick (relayBatch só vale no repasse)', () => {
    const world = new World()
    const { sessions } = setup(world)
    world.connect('host', 'bbbb', 20)
    world.net.run(50)
    holdRight(world, sessions.bbbb)
    world.net.run(3000)
    expect(world.p2pInputs.get('bbbb') ?? 0).toBeGreaterThan(160)
  })

  it('cai o host: o cliente promovido continua do último retrato', () => {
    const world = new World()
    const { sessions, loops, baseView, playerList, applied } = setup(world)
    world.connect('host', 'bbbb', 30)
    world.connect('host', 'cccc', 30)
    world.connect('bbbb', 'cccc', 30)
    for (const id of ids) holdRight(world, sessions[id])
    world.net.run(8000)
    const snapBefore = sessions.bbbb.debug.lastSnapshot()!
    const xBefore = snapBefore.players.find((p) => p.slot === 2)!.x
    expect(snapBefore.epoch).toBe(1)

    world.dead.add('host')
    sessions.host.dispose()
    world.manager('bbbb').setOpen(peerOf('host'), false)
    world.manager('cccc').setOpen(peerOf('host'), false)
    const view2 = (id: string): ToyView => ({
      ...baseView(id),
      hostId: 'bbbb',
      epoch: 2,
      players: playerList.map((p) => (p.id === 'host' ? { ...p, present: false } : p))
    })
    sessions.bbbb.update(view2('bbbb'))
    sessions.cccc.update(view2('cccc'))
    expect(sessions.bbbb.role()).toBe('host')
    // logo depois da troca: estado do último retrato (nada de recomeçar do zero)
    const restored = sessions.bbbb.debug.hostState()!
    expect(restored.tick).toBe(snapBefore.tick)
    expect(restored.players.find((p) => p.slot === 2)!.x).toBe(xBefore)
    expect(restored.players.find((p) => p.slot === 0)!.away).toBe(true)
    expect(restored.players.map((p) => p.id)).toEqual(ids)
    expect(sessions.bbbb.frame()?.net).toBe('trocando-host')

    world.net.run(4000)
    for (const id of ['bbbb', 'cccc']) {
      const snap = sessions[id].debug.lastSnapshot()!
      expect(snap.epoch).toBe(2)
      expect(snap.tick).toBeGreaterThan(snapBefore.tick + 150)
      expect(snap.players.find((p) => p.slot === 2)!.x).toBeGreaterThan(xBefore)
    }
    expect(sessions.bbbb.frame()!.net).toBe('host')
    expect(sessions.cccc.frame()!.net).toBe('p2p')
    // entradas do epoch novo valem uma vez; o novo host não herdou a fila do antigo
    for (const [k, list] of applied) if (k.startsWith('2:')) expect(new Set(list).size).toBe(list.length)
    expect(loops.bbbb.epoch).toBe(2)
  })

  it('o host manda score a cada 5 s e result no fim, sempre com o epoch da sessão', () => {
    const world = new World()
    const { sessions } = setup(world, Math.round(12_000 / TOY_TICK_MS))
    world.connect('host', 'bbbb', 20)
    world.net.run(14_000)
    const acts = world.acts.filter((a) => a.id === 'host')
    expect(acts.filter((a) => a.action.type === 'score').length).toBeGreaterThanOrEqual(2)
    expect(acts.filter((a) => a.action.type === 'result')).toHaveLength(1)
    expect(acts.every((a) => a.action.epoch === 1)).toBe(true)
    expect(world.acts.filter((a) => a.id !== 'host')).toHaveLength(0)
    expect(sessions.bbbb.debug.lastSnapshot()!.tick).toBe(Math.round(12_000 / TOY_TICK_MS))
  })

  it('snapshot de outro epoch ou de quem não é o host é ignorado', () => {
    const world = new World()
    const { sessions } = setup(world)
    world.connect('host', 'bbbb', 20)
    world.connect('cccc', 'bbbb', 20)
    world.net.run(1000)
    const before = sessions.bbbb.debug.lastSnapshot()!.tick
    const fake = { ...sessions.bbbb.debug.lastSnapshot()!, tick: before + 500 }
    const fromOther = toyCodec.encodeSnapshot(fake)
    world.manager('bbbb').receive(peerOf('cccc'), fromOther) // cccc não é o host
    world.manager('bbbb').receive(peerOf('host'), toyCodec.encodeSnapshot({ ...fake, epoch: 9 }))
    expect(sessions.bbbb.debug.lastSnapshot()!.tick).toBeLessThan(before + 500)
  })
})
