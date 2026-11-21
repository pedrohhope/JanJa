/**
 * Jogo de brinquedo a 60 Hz para testar a plataforma de tempo real sem depender de tiro nem de briga:
 * cada jogador anda numa linha (x += mx * 2 por tick). Codec em JSON só para os testes.
 */
import { RealtimeClient } from '../../src/web/game/realtime/client'
import type { HostOut, Packet, RealtimeCodec, RealtimeSim, RealtimeTypes, RealtimeView, TimedEvent } from '../../src/web/game/realtime/types'
import type { RealtimeGameBinding, SessionClient } from '../../src/web/game/realtime/session'
import type { NetStatus } from '../../src/web/game/realtime/types'

export interface ToyInput {
  seq: number
  mx: number
  lagTicks?: number
}
export interface ToyPlayer {
  slot: number
  id: string
  bot: boolean
  away: boolean
  x: number
  vx: number
  lastSeq: number
  /** soma dos lagTicks recebidos (teste de lag por ping) */
  lagSum: number
  /** quantas vezes a entrada veio "solta tudo" */
  released: number
}
export interface ToyState {
  tick: number
  endTick: number
  players: ToyPlayer[]
}
export type ToyEvent = { type: 'beat'; n: number } | { type: 'jump'; slot: number }
export interface ToySnapshot {
  epoch: number
  tick: number
  endTick: number
  players: Omit<ToyPlayer, 'id'>[]
  ids: string[]
  events: TimedEvent<ToyEvent>[]
  full: boolean
}
export interface ToyScore {
  id: string
  x: number
}
export interface ToyTypes extends RealtimeTypes {
  State: ToyState
  Input: ToyInput
  Snapshot: ToySnapshot
  Event: ToyEvent
  Ref: { slot: number; id: string; bot: boolean }
  Score: ToyScore
  Statics: string[]
  Self: ToyPlayer
}

export const TOY_HZ = 60
export const TOY_TICK_MS = 1000 / TOY_HZ
const SPEED = 2

const enc = new TextEncoder()
const dec = new TextDecoder()
const bytes = (o: unknown): ArrayBuffer => enc.encode(JSON.stringify(o)).buffer as ArrayBuffer
const parse = (d: ArrayBuffer): Packet<ToyTypes> | null => {
  try {
    const o = JSON.parse(dec.decode(d)) as Packet<ToyTypes>
    return o && typeof o === 'object' && typeof o.t === 'string' ? o : null
  } catch {
    return null
  }
}

export const toyCodec: RealtimeCodec<ToyTypes> = {
  maxPacketBytes: 4400,
  isHello: (d) => parse(d)?.t === 'hello',
  decodeHello: (d) => {
    const p = parse(d)
    return p?.t === 'hello' ? p : null
  },
  encodeHello: (playerId, epoch, reply = false) => bytes({ t: 'hello', playerId, epoch, reply }),
  toBase64: (d) => Buffer.from(d instanceof Uint8Array ? d : new Uint8Array(d)).toString('base64'),
  fromBase64: (t) => {
    const b = Buffer.from(t, 'base64')
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  },
  decode: parse,
  encodePing: (n, pong = false) => bytes({ t: pong ? 'pong' : 'ping', n }),
  encodeInputs: (epoch, slot, inputs) => bytes({ t: 'input', epoch, slot, inputs: inputs.slice(-8) }),
  encodeSnapshot: (s) => bytes({ t: 'snapshot', ...s })
}

const clamp = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)

export const toySim: RealtimeSim<ToyTypes> = {
  tickHz: TOY_HZ,
  tickMs: TOY_TICK_MS,
  snapshotEvery: 2,
  fullSnapshotEvery: TOY_HZ,
  interpDelayMs: 60,
  inputRedundancy: 3,
  relayBatch: 3,
  maxLagCompMs: 100,
  emptyInput: { seq: 0, mx: 0 },
  sanitizeInput(raw) {
    const i = raw as Partial<ToyInput> | null
    if (!i || typeof i !== 'object' || typeof i.seq !== 'number' || !Number.isFinite(i.seq) || i.seq <= 0) return null
    return { seq: Math.floor(i.seq), mx: clamp(i.mx) }
  },
  step(s, inputs) {
    const events: ToyEvent[] = []
    if (s.tick >= s.endTick) return events
    for (const p of s.players) {
      if (p.away) continue
      const i = inputs.get(p.slot)
      if (i) {
        p.vx = i.mx * SPEED
        p.lastSeq = Math.max(p.lastSeq, i.seq)
        p.lagSum += i.lagTicks ?? 0
        if (i.lagTicks === undefined) p.released++
      }
      p.x += p.vx
    }
    s.tick++
    if (s.tick % 30 === 0) events.push({ type: 'beat', n: s.tick / 30 })
    return events
  },
  clone: (s) => structuredClone(s),
  addPlayer(s, ref) {
    s.players.push({ slot: ref.slot, id: ref.id, bot: ref.bot, away: false, x: 0, vx: 0, lastSeq: 0, lagSum: 0, released: 0 })
  },
  setAway(s, slot, away) {
    const p = s.players.find((x) => x.slot === slot)
    if (p) p.away = away
  },
  roster: (s) => s.players,
  tickOf: (s) => s.tick,
  isOver: (s) => s.tick >= s.endTick,
  scores: (s) => s.players.map((p) => ({ id: p.id, x: p.x })),
  ranking: (s) => s.players.map((p) => ({ id: p.id, x: p.x })).sort((a, b) => b.x - a.x),
  snapshot(s, recent, o) {
    const ids: string[] = []
    for (const p of s.players) ids[p.slot] = p.id
    return {
      epoch: o.epoch,
      tick: s.tick,
      endTick: s.endTick,
      players: s.players.map(({ id: _id, ...rest }) => ({ ...rest })),
      ids: o.full ? ids : [],
      events: recent.map((e) => ({ ...e })),
      full: o.full
    }
  },
  restore(snap, statics) {
    const ids = statics ?? snap.ids
    return { tick: snap.tick, endTick: snap.endTick, players: snap.players.map((p) => ({ ...p, id: ids[p.slot] ?? `j-${p.slot}` })) }
  },
  mergeStatics: (prev, snap) => (snap.full ? snap.ids : prev),
  selfOf(snap, slot, statics) {
    const p = snap.players.find((x) => x.slot === slot)
    return p ? { ...p, id: statics?.[slot] ?? `j-${slot}` } : null
  },
  ackOf: (p) => p.lastSeq,
  canPredict: (p) => !p.away,
  predictSelf(p, _snap, input) {
    p.vx = input.mx * SPEED
    p.x += p.vx
  },
  selfPos: (p) => ({ x: p.x, y: 0 }),
  selfAlive: () => true,
  codec: toyCodec
}

export interface ToyFrame {
  net: NetStatus
  pingMs: number
  /** posição desenhada de cada slot */
  xs: Record<number, number>
  tick: number
}
export interface ToyControls {
  mx: number
}

/** Cliente de brinquedo: só o que o jogo precisa por cima da base. */
export class ToyClient extends RealtimeClient<ToyTypes, ToyEvent> implements SessionClient<ToyTypes, ToyControls, ToyFrame, ToyView['players'][number], ToyEvent> {
  setRoster(): void {}
  localTick(now: number, st: ToyControls): ToyInput[] | null {
    return this.advanceLocal(now, (seq) => ({ seq, mx: st.mx }))
  }
  frame(now: number): ToyFrame | null {
    const w = this.interpolation(now)
    if (!w) return null
    const xs: Record<number, number> = {}
    for (const sp of w.last.players) {
      if (sp.slot === this.me && this.pred) {
        xs[sp.slot] = this.renderPos({ x: this.pred.x, y: 0 }, now).x
        continue
      }
      const pa = w.a.players.find((p) => p.slot === sp.slot)
      const pb = w.b.players.find((p) => p.slot === sp.slot)
      xs[sp.slot] = pa && pb ? pa.x + (pb.x - pa.x) * w.u : sp.x
    }
    return { net: 'conectando', pingMs: 0, xs, tick: w.last.tick }
  }
}

export interface ToyView extends RealtimeView {
  endTick: number
  players: { id: string; name: string; slot: number; bot: boolean; present: boolean }[]
}

export const toyBinding: RealtimeGameBinding<ToyTypes, ToyView, ToyControls, ToyFrame, ToyEvent> = {
  sim: toySim,
  createClient: (me) => new ToyClient({ sim: toySim, me }),
  refOf: (p) => ({ slot: p.slot, id: p.id, bot: p.bot }),
  idleInput: { mx: 0 },
  createState: (v) => {
    const s: ToyState = { tick: 0, endTick: v.endTick, players: [] }
    for (const p of v.players) toySim.addPlayer(s, { slot: p.slot, id: p.id, bot: p.bot })
    return s
  }
}

export type ToyOut = HostOut<ToyTypes>
export function toyState(ids: string[], endTick = 1_000_000): ToyState {
  const s: ToyState = { tick: 0, endTick, players: [] }
  ids.forEach((id, slot) => toySim.addPlayer(s, { slot, id, bot: false }))
  return s
}
