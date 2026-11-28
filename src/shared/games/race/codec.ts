/**
 * Formato binário da Corrida na Sala (DataView, little-endian). Byte 0 = tipo, byte 1 = versão.
 * Mesmos tipos de pacote do tiro e da briga: 1 HELLO, 2 INPUT, 3 PING, 4 PONG, 5 SNAPSHOT.
 * Roda igual no navegador, no Worker e no Node. Toda decodificação devolve `null` para pacote
 * inválido (nunca lança). O retrato leva o estado inteiro (13 carros cabem em ~600 bytes); o
 * "cheio" leva também os ids por slot (`RaceStatics`), para um novo host continuar a corrida.
 */
import { fromBase64, toBase64 } from '../shooter/codec'
import { BOT_SLOT_BASE, BTN_MASK, TRACK_IDS, type BotLevel, type Car, type RaceInput, type RacePhase, type RaceSimEvent, type RaceSimState, type TrackId } from './types'

export { fromBase64, toBase64 }

export const CODEC_VERSION = 1
export const PKT_HELLO = 1
export const PKT_INPUT = 2
export const PKT_PING = 3
export const PKT_PONG = 4
export const PKT_SNAPSHOT = 5

/** maior pacote que cabe em RELAY_MAX_DATA (6000) depois do base64 */
export const MAX_PACKET_BYTES = 4400
export const MAX_INPUTS_PER_PACKET = 8

const PHASES: readonly RacePhase[] = ['contagem', 'correndo', 'fim']
const LEVELS: readonly BotLevel[] = ['facil', 'medio', 'dificil']

export type SnapCar = Omit<Car, 'id'>

export interface RaceTimedEvent {
  tick: number
  ev: RaceSimEvent
}

/** o que não muda: o id de cada slot */
export interface RaceStatics {
  ids: Record<number, string>
}

export interface RaceSnapshot {
  epoch: number
  tick: number
  phase: RacePhase
  trackId: TrackId
  laps: number
  botLevel: BotLevel
  goTick: number
  firstFinish: number
  endTick: number
  cars: SnapCar[]
  events: RaceTimedEvent[]
  /** só no retrato cheio */
  statics: RaceStatics | null
}

export type RacePacket =
  | { t: 'hello'; playerId: string; epoch: number; reply: boolean }
  | { t: 'input'; epoch: number; slot: number; inputs: RaceInput[] }
  | { t: 'ping' | 'pong'; n: number }
  | ({ t: 'snapshot' } & RaceSnapshot)

// ---------------------------------------------------------------------------------------

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0
  const r = Math.round(v)
  return r < lo ? lo : r > hi ? hi : r
}

class Writer {
  buf: Uint8Array
  dv: DataView
  p = 0
  constructor(cap: number) {
    this.buf = new Uint8Array(cap)
    this.dv = new DataView(this.buf.buffer)
  }
  private need(n: number) {
    if (this.p + n <= this.buf.length) return
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.p + n))
    next.set(this.buf)
    this.buf = next
    this.dv = new DataView(next.buffer)
  }
  u8(v: number) {
    this.need(1)
    this.dv.setUint8(this.p++, clampInt(v, 0, 255))
  }
  i8(v: number) {
    this.need(1)
    this.dv.setInt8(this.p++, clampInt(v, -128, 127))
  }
  u16(v: number) {
    this.need(2)
    this.dv.setUint16(this.p, clampInt(v, 0, 65535), true)
    this.p += 2
  }
  i16(v: number) {
    this.need(2)
    this.dv.setInt16(this.p, clampInt(v, -32768, 32767), true)
    this.p += 2
  }
  u32(v: number) {
    this.need(4)
    this.dv.setUint32(this.p, clampInt(v, 0, 0xffffffff), true)
    this.p += 4
  }
  str(s: string) {
    const b = enc.encode(s).subarray(0, 255)
    this.u8(b.length)
    this.need(b.length)
    this.buf.set(b, this.p)
    this.p += b.length
  }
  head(type: number) {
    this.u8(type)
    this.u8(CODEC_VERSION)
  }
  done(): ArrayBuffer {
    return this.buf.slice(0, this.p).buffer as ArrayBuffer
  }
}

class Reader {
  dv: DataView
  p = 0
  constructor(private readonly bytes: Uint8Array) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  u8() {
    return this.dv.getUint8(this.p++)
  }
  i8() {
    return this.dv.getInt8(this.p++)
  }
  u16() {
    const v = this.dv.getUint16(this.p, true)
    this.p += 2
    return v
  }
  i16() {
    const v = this.dv.getInt16(this.p, true)
    this.p += 2
    return v
  }
  u32() {
    const v = this.dv.getUint32(this.p, true)
    this.p += 4
    return v
  }
  str() {
    const n = this.u8()
    if (this.p + n > this.bytes.length) throw new RangeError('str')
    const s = dec.decode(this.bytes.subarray(this.p, this.p + n))
    this.p += n
    return s
  }
  get left() {
    return this.bytes.length - this.p
  }
}

const toBytes = (d: ArrayBuffer | Uint8Array): Uint8Array => (d instanceof Uint8Array ? d : new Uint8Array(d))

// posição em 1/8 px, velocidade em 1/256 px/tick, direção em 1/16384
const qPos = (v: number) => clampInt(v * 8, 0, 65535)
const qVel = (v: number) => clampInt(v * 256, -32768, 32767)
const qDir = (v: number) => clampInt(v * 16384, -16384, 16384)
const qSteer = (v: number) => clampInt(Math.max(-1, Math.min(1, v)) * 127, -127, 127)

/** A entrada como o host vai ler. O cliente prevê com ISTO, então o carro previsto e o do host andam igual. */
export function quantizeInput(i: RaceInput): RaceInput {
  return { seq: i.seq >>> 0, steer: qSteer(Number.isFinite(i.steer) ? i.steer : 0) / 127, buttons: i.buttons & BTN_MASK }
}

// ---------------------------------------------------------------------------------------
// HELLO / INPUT / PING
// ---------------------------------------------------------------------------------------

export function encodeHello(playerId: string, epoch: number, reply = false): ArrayBuffer {
  const w = new Writer(32)
  w.head(PKT_HELLO)
  w.u16(epoch)
  w.u8(reply ? 1 : 0)
  w.str(playerId)
  return w.done()
}

export function encodeInput(epoch: number, slot: number, inputs: readonly RaceInput[]): ArrayBuffer {
  const list = inputs.slice(-MAX_INPUTS_PER_PACKET)
  const w = new Writer(6 + list.length * 6)
  w.head(PKT_INPUT)
  w.u16(epoch)
  w.u8(slot)
  w.u8(list.length)
  for (const i of list) {
    w.u32(i.seq)
    w.i8(qSteer(i.steer))
    w.u8(i.buttons & BTN_MASK)
  }
  return w.done()
}

export function encodePing(n: number, pong = false): ArrayBuffer {
  const w = new Writer(6)
  w.head(pong ? PKT_PONG : PKT_PING)
  w.u32(n)
  return w.done()
}

// ---------------------------------------------------------------------------------------
// SNAPSHOT
// ---------------------------------------------------------------------------------------

export function snapshotFromState(s: RaceSimState, recent: readonly RaceTimedEvent[], opts: { epoch: number; full: boolean }): RaceSnapshot {
  return {
    epoch: opts.epoch,
    tick: s.tick,
    phase: s.phase,
    trackId: s.trackId,
    laps: s.laps,
    botLevel: s.botLevel,
    goTick: s.goTick,
    firstFinish: s.firstFinish,
    endTick: s.endTick,
    cars: s.cars.map(({ id: _id, ...c }) => ({ ...c, ai: { ...c.ai } })),
    events: recent.map((e) => ({ tick: e.tick, ev: { ...e.ev } })),
    statics: opts.full ? { ids: Object.fromEntries(s.cars.map((c) => [c.slot, c.id])) } : null
  }
}

export function mergeStatics(prev: RaceStatics | null, snap: RaceSnapshot): RaceStatics | null {
  return snap.statics ? { ids: { ...(prev?.ids ?? {}), ...snap.statics.ids } } : prev
}

const fallbackId = (c: SnapCar): string => (c.bot ? `bot-${c.slot - BOT_SLOT_BASE + 1}` : `slot-${c.slot}`)

/** Estado válido a partir do retrato (novo host, predição e desenho). */
export function restoreState(snap: RaceSnapshot, statics: RaceStatics | null = snap.statics): RaceSimState {
  return {
    tick: snap.tick,
    phase: snap.phase,
    trackId: snap.trackId,
    laps: snap.laps,
    botLevel: snap.botLevel,
    goTick: snap.goTick,
    firstFinish: snap.firstFinish,
    endTick: snap.endTick,
    cars: snap.cars.map((c) => ({ ...c, ai: { ...c.ai }, id: statics?.ids[c.slot] ?? snap.statics?.ids[c.slot] ?? fallbackId(c) }))
  }
}

function writeEvent(w: Writer, e: RaceTimedEvent): void {
  w.u32(e.tick)
  const ev = e.ev
  switch (ev.type) {
    case 'go':
      w.u8(0)
      break
    case 'volta':
      w.u8(1)
      w.u8(ev.slot)
      w.u8(ev.lap)
      w.u32(ev.ticks)
      w.u8(ev.best ? 1 : 0)
      break
    case 'chegada':
      w.u8(2)
      w.u8(ev.slot)
      w.u8(ev.place)
      w.u32(ev.ticks)
      break
    case 'batida':
      w.u8(3)
      w.u8(ev.slot)
      w.u8(ev.force)
      break
    case 'toque':
      w.u8(4)
      w.u8(ev.a)
      w.u8(ev.b)
      break
    case 'turbo':
      w.u8(5)
      w.u8(ev.slot)
      break
    case 'fim':
      w.u8(6)
      break
  }
}

function readEvent(r: Reader): RaceTimedEvent {
  const tick = r.u32()
  const k = r.u8()
  let ev: RaceSimEvent
  switch (k) {
    case 0:
      ev = { type: 'go' }
      break
    case 1:
      ev = { type: 'volta', slot: r.u8(), lap: r.u8(), ticks: r.u32(), best: r.u8() === 1 }
      break
    case 2:
      ev = { type: 'chegada', slot: r.u8(), place: r.u8(), ticks: r.u32() }
      break
    case 3:
      ev = { type: 'batida', slot: r.u8(), force: r.u8() }
      break
    case 4:
      ev = { type: 'toque', a: r.u8(), b: r.u8() }
      break
    case 5:
      ev = { type: 'turbo', slot: r.u8() }
      break
    case 6:
      ev = { type: 'fim' }
      break
    default:
      throw new RangeError('evento')
  }
  return { tick, ev }
}

export function encodeSnapshot(s: RaceSnapshot): ArrayBuffer {
  const w = new Writer(64 + s.cars.length * 42 + s.events.length * 12)
  w.head(PKT_SNAPSHOT)
  w.u16(s.epoch)
  w.u32(s.tick)
  w.u8(PHASES.indexOf(s.phase))
  w.u8(TRACK_IDS.indexOf(s.trackId))
  w.u8(s.laps)
  w.u8(LEVELS.indexOf(s.botLevel))
  w.u32(s.goTick)
  w.u32(s.firstFinish)
  w.u32(s.endTick)
  w.u8(s.cars.length)
  for (const c of s.cars) {
    w.u8(c.slot)
    w.u8((c.bot ? 1 : 0) | (c.away ? 2 : 0))
    w.u16(qPos(c.x))
    w.u16(qPos(c.y))
    w.i16(qVel(c.vx))
    w.i16(qVel(c.vy))
    w.i16(qDir(c.hx))
    w.i16(qDir(c.hy))
    w.u32(c.lastSeq)
    w.u8(c.lap)
    w.u8(c.next)
    w.u32(c.finishTick)
    w.u32(c.lapStart)
    w.u32(c.bestLap)
    w.u32(c.boostUntil)
    w.i8(qSteer(c.steer))
    w.u8(c.buttons & BTN_MASK)
    w.u8(c.ai.stuck)
    w.u8(c.ai.reverse)
  }
  const evs = s.events.slice(-60)
  w.u8(evs.length)
  for (const e of evs) writeEvent(w, e)
  if (s.statics) {
    const ids = Object.entries(s.statics.ids)
    w.u8(1)
    w.u8(ids.length)
    for (const [slot, id] of ids) {
      w.u8(Number(slot))
      w.str(id)
    }
  } else w.u8(0)
  return w.done()
}

function readSnapshot(r: Reader): RaceSnapshot {
  const epoch = r.u16()
  const tick = r.u32()
  const phase = PHASES[r.u8()]
  const trackId = TRACK_IDS[r.u8()]
  const laps = r.u8()
  const botLevel = LEVELS[r.u8()]
  if (!phase || !trackId || !botLevel || laps < 1) throw new RangeError('cabeçalho')
  const goTick = r.u32()
  const firstFinish = r.u32()
  const endTick = r.u32()
  const n = r.u8()
  if (n > 16) throw new RangeError('carros')
  const cars: SnapCar[] = []
  for (let i = 0; i < n; i++) {
    const slot = r.u8()
    const flags = r.u8()
    const x = r.u16() / 8
    const y = r.u16() / 8
    const vx = r.i16() / 256
    const vy = r.i16() / 256
    let hx = r.i16() / 16384
    let hy = r.i16() / 16384
    const l = Math.sqrt(hx * hx + hy * hy)
    if (l > 1e-6) {
      hx /= l
      hy /= l
    } else hx = 1
    cars.push({
      slot,
      bot: (flags & 1) !== 0,
      away: (flags & 2) !== 0,
      x,
      y,
      vx,
      vy,
      hx,
      hy,
      lastSeq: r.u32(),
      lap: r.u8(),
      next: r.u8(),
      finishTick: r.u32(),
      lapStart: r.u32(),
      bestLap: r.u32(),
      boostUntil: r.u32(),
      steer: r.i8() / 127,
      buttons: r.u8() & BTN_MASK,
      ai: { stuck: r.u8(), reverse: r.u8() }
    })
  }
  const ne = r.u8()
  const events: RaceTimedEvent[] = []
  for (let i = 0; i < ne; i++) events.push(readEvent(r))
  let statics: RaceStatics | null = null
  if (r.u8() === 1) {
    const k = r.u8()
    const ids: Record<number, string> = {}
    for (let i = 0; i < k; i++) {
      const slot = r.u8()
      ids[slot] = r.str()
    }
    statics = { ids }
  }
  if (r.left !== 0) throw new RangeError('sobra')
  return { epoch, tick, phase, trackId, laps, botLevel, goTick, firstFinish, endTick, cars, events, statics }
}

export function packetType(data: ArrayBuffer | Uint8Array): number | null {
  const b = toBytes(data)
  return b.length >= 2 && b[1] === CODEC_VERSION && b[0]! >= PKT_HELLO && b[0]! <= PKT_SNAPSHOT ? b[0]! : null
}

export function decodePacket(data: ArrayBuffer | Uint8Array): RacePacket | null {
  try {
    const bytes = toBytes(data)
    if (bytes.length < 2 || bytes.length > MAX_PACKET_BYTES * 2 || bytes[1] !== CODEC_VERSION) return null
    const r = new Reader(bytes)
    const type = r.u8()
    r.u8()
    switch (type) {
      case PKT_HELLO: {
        const epoch = r.u16()
        const reply = r.u8() === 1
        const playerId = r.str()
        if (r.left !== 0 || !playerId) return null
        return { t: 'hello', playerId, epoch, reply }
      }
      case PKT_INPUT: {
        const epoch = r.u16()
        const slot = r.u8()
        const n = r.u8()
        if (slot > 15 || n === 0 || n > MAX_INPUTS_PER_PACKET || r.left !== n * 6) return null
        const inputs: RaceInput[] = []
        for (let i = 0; i < n; i++) inputs.push({ seq: r.u32(), steer: r.i8() / 127, buttons: r.u8() & BTN_MASK })
        return { t: 'input', epoch, slot, inputs }
      }
      case PKT_PING:
      case PKT_PONG: {
        const n = r.u32()
        if (r.left !== 0) return null
        return { t: type === PKT_PING ? 'ping' : 'pong', n }
      }
      case PKT_SNAPSHOT:
        return { t: 'snapshot', ...readSnapshot(r) }
      default:
        return null
    }
  } catch {
    return null
  }
}

export function decodeSnapshot(d: ArrayBuffer | Uint8Array): RaceSnapshot | null {
  const p = decodePacket(d)
  if (p?.t !== 'snapshot') return null
  const { t: _t, ...snap } = p
  void _t
  return snap
}
