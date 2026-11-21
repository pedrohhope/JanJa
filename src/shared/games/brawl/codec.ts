/**
 * Formato binário da Briga na Sala (DataView, little-endian). Byte 0 = tipo, byte 1 = versão.
 * Roda igual no navegador, no Worker e no Node (sem Buffer, sem atob/btoa). Mesmo desenho do codec do tiro.
 *
 * Pacotes: HELLO (quem sou eu), INPUT (últimas entradas, redundantes), PING/PONG e SNAPSHOT.
 * Toda decodificação devolve `null` para pacote inválido (nunca lança).
 *
 * SNAPSHOT: o host manda o estado inteiro (sem delta) a 30 Hz. A cada ~1 s vai o snapshot "cheio",
 * que leva também o que muda pouco (ids, time, placar, recarga da esquiva...): o receptor guarda isso
 * em `BrawlStatics` e usa para restaurar a luta numa troca de host. Meta: < 600 bytes com 8 lutadores.
 */
import { moveById, moveIndex } from './moves'
import {
  ARENA_IDS,
  BOT_SLOT_BASE,
  BTN_MASK,
  CHARACTER_IDS,
  LAG_HISTORY_TICKS,
  WEAPON_IDS,
  type ArenaId,
  type BotLevel,
  type BrawlInput,
  type BrawlMode,
  type BrawlSimEvent,
  type BrawlSimPhase,
  type BrawlSimState,
  type CharacterId,
  type Fighter,
  type FighterAction,
  type Held,
  type MoveId,
  type Projectile,
  type ProjectileKind,
  type Puddle,
  type TeamSize,
  type WeaponItem
} from './types'

export const CODEC_VERSION = 1

export const PKT_HELLO = 1
export const PKT_INPUT = 2
export const PKT_PING = 3
export const PKT_PONG = 4
export const PKT_SNAPSHOT = 5

/** maior pacote binário que cabe em RELAY_MAX_DATA (6000) depois do base64 */
export const MAX_PACKET_BYTES = 4400
/** um INPUT leva no máximo isto de entradas */
export const MAX_INPUTS_PER_PACKET = 8

const PHASE_LIST: readonly BrawlSimPhase[] = ['contagem', 'jogando', 'morte-subita', 'fim']
const ACTION_LIST: readonly FighterAction[] = ['parado', 'correndo', 'no-ar', 'parede', 'esquiva', 'golpe', 'atordoado', 'fora', 'eliminado']
const HELD_LIST: readonly Held[] = ['mao', ...WEAPON_IDS]
const KIND_LIST: readonly ProjectileKind[] = ['carta', 'wifi', 'vapor', 'raio', 'onda', 'arma']
const MODE_LIST: readonly BrawlMode[] = ['vidas', 'tempo']
const TEAM_LIST: readonly TeamSize[] = [0, 2, 3, 4]
const LEVEL_LIST: readonly BotLevel[] = ['facil', 'medio', 'dificil']
const SIDE_LIST = ['esquerda', 'direita', 'cima', 'baixo'] as const
const ITEM_STATE_LIST = ['caindo', 'chao', 'voando'] as const
/** golpes de projétil nos eventos de acerto: 200 + índice do tipo */
const PROJ_MOVE_BASE = 200

// ---------------------------------------------------------------------------------------
// Tipos dos pacotes
// ---------------------------------------------------------------------------------------

export interface HelloPacket {
  t: 'hello'
  playerId: string
  epoch: number
  /** true = resposta a um HELLO (quem recebe uma resposta não responde de novo) */
  reply: boolean
}

export interface InputPacket {
  t: 'input'
  epoch: number
  slot: number
  /** da mais antiga para a mais nova */
  inputs: BrawlInput[]
}

export interface PingPacket {
  t: 'ping' | 'pong'
  /** valor opaco (u32) devolvido como veio */
  n: number
}

/** Lutador em todo snapshot (o necessário para desenhar e para o cliente reconciliar). */
export interface BrawlSnapFighter {
  slot: number
  bot: boolean
  away: boolean
  char: CharacterId
  facing: 1 | -1
  grounded: boolean
  fastFall: boolean
  recoveryUsed: boolean
  airDodgeUsed: boolean
  action: FighterAction
  actionTick: number
  x: number
  y: number
  vx: number
  vy: number
  move: MoveId | null
  moveTick: number
  charge: number
  damage: number
  stocks: number
  held: Held
  invulnUntil: number
  freezeUntil: number
  hitstunUntil: number
  jumpsLeft: number
  wallSide: -1 | 0 | 1
  /** último `seq` aplicado: o cliente descarta as entradas até aqui e refaz o resto (ack) */
  lastSeq: number
}

/** O que muda pouco por lutador: só no snapshot cheio. */
export interface BrawlStaticFighter {
  slot: number
  id: string
  team: number
  kos: number
  falls: number
  dealt: number
  outTick: number
  respawnTick: number
  dodgeReadyTick: number
  wallTicks: number
  lastHitBy: number
  lastHitTick: number
  onThin: number
  /** pares planos [slot, tick, ...] como em `Fighter.hitSlots` */
  hitSlots: number[]
}

export interface BrawlStatics {
  fighters: BrawlStaticFighter[]
}

export interface BrawlTimedEvent {
  /** tick em que aconteceu */
  tick: number
  ev: BrawlSimEvent
}

export interface BrawlSnapshot {
  epoch: number
  tick: number
  phase: BrawlSimPhase
  goTick: number
  endTick: number
  arenaId: ArenaId
  mode: BrawlMode
  teamSize: TeamSize
  friendlyFire: boolean
  botLevel: BotLevel
  rng: number
  nextId: number
  nextDropTick: number
  fighters: BrawlSnapFighter[]
  items: WeaponItem[]
  projectiles: Projectile[]
  puddles: Puddle[]
  events: BrawlTimedEvent[]
  /** presente só no snapshot cheio */
  statics: BrawlStatics | null
}

export type Packet = HelloPacket | InputPacket | PingPacket | ({ t: 'snapshot' } & BrawlSnapshot)

// ---------------------------------------------------------------------------------------
// Leitura e escrita
// ---------------------------------------------------------------------------------------

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

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
    this.dv.setUint32(this.p, Number.isFinite(v) ? Math.min(0xffffffff, Math.max(0, Math.round(v))) : 0, true)
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
    const v = this.dv.getUint8(this.p)
    this.p += 1
    return v
  }
  i8() {
    const v = this.dv.getInt8(this.p)
    this.p += 1
    return v
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

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0
  const r = Math.round(v)
  return r < lo ? lo : r > hi ? hi : r
}

const toBytes = (data: ArrayBuffer | Uint8Array): Uint8Array => (data instanceof Uint8Array ? data : new Uint8Array(data))

/** posição em 1/16 px com folga negativa (os lutadores passam um pouco da borda), u16 */
const qp = (v: number) => clampInt((v + 512) * 16, 0, 65535)
const dp = (v: number) => v / 16 - 512
/** velocidade em 1/256 px por tick, i16 */
const qv = (v: number) => clampInt(v * 256, -32768, 32767)
const dv = (v: number) => v / 256
const qUnit = (v: number) => clampInt(v * 127, -127, 127)
const dUnit = (v: number) => v / 127

const idx = <T>(list: readonly T[], v: T): number => Math.max(0, list.indexOf(v))
function pick<T>(list: readonly T[], i: number): T {
  if (i < 0 || i >= list.length) throw new RangeError('índice')
  return list[i]
}

// ---------------------------------------------------------------------------------------
// Entrada quantizada
// ---------------------------------------------------------------------------------------

/**
 * A entrada do jeito que o host vai enxergar (int8 em mx/my; `lagTicks` nunca vai pela rede).
 * O cliente aplica ISTO na predição, assim o boneco previsto e o do host andam igual.
 */
export function quantizeInput(i: BrawlInput): BrawlInput {
  const f = (v: number) => (Number.isFinite(v) ? dUnit(qUnit(Math.max(-1, Math.min(1, v)))) : 0)
  return { seq: i.seq >>> 0, mx: f(i.mx), my: f(i.my), buttons: i.buttons & BTN_MASK }
}

// ---------------------------------------------------------------------------------------
// HELLO / INPUT / PING / PONG
// ---------------------------------------------------------------------------------------

export function encodeHello(playerId: string, epoch: number, reply = false): ArrayBuffer {
  const w = new Writer(32)
  w.head(PKT_HELLO)
  w.u16(epoch)
  w.u8(reply ? 1 : 0)
  w.str(playerId)
  return w.done()
}

/** Pacote de entradas com redundância: mande as últimas `INPUT_REDUNDANCY + 1` (ou mais) de uma vez. */
export function encodeInput(epoch: number, slot: number, inputs: readonly BrawlInput[]): ArrayBuffer {
  const list = inputs.slice(-MAX_INPUTS_PER_PACKET)
  const w = new Writer(6 + list.length * 7)
  w.head(PKT_INPUT)
  w.u16(epoch)
  w.u8(slot)
  w.u8(list.length)
  for (const i of list) {
    w.u32(i.seq)
    w.i8(qUnit(i.mx))
    w.i8(qUnit(i.my))
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
// SNAPSHOT: montar a partir do estado e restaurar
// ---------------------------------------------------------------------------------------

export interface SnapshotOptions {
  epoch: number
  /** snapshot cheio: leva também `statics` (ids, time, placar...) */
  full?: boolean
}

/** Retrato do estado para a rede. `recentEvents` = eventos dos últimos ticks (redundância contra perda). */
export function snapshotFromState(state: BrawlSimState, recentEvents: readonly BrawlTimedEvent[], opts: SnapshotOptions): BrawlSnapshot {
  const fighters: BrawlSnapFighter[] = state.fighters.map((f) => ({
    slot: f.slot,
    bot: f.bot,
    away: f.away,
    char: f.char,
    facing: f.facing,
    grounded: f.grounded,
    fastFall: f.fastFall,
    recoveryUsed: f.recoveryUsed,
    airDodgeUsed: f.airDodgeUsed,
    action: f.action,
    actionTick: f.actionTick,
    x: f.x,
    y: f.y,
    vx: f.vx,
    vy: f.vy,
    move: f.move,
    moveTick: f.moveTick,
    charge: f.charge,
    damage: f.damage,
    stocks: f.stocks,
    held: f.held,
    invulnUntil: f.invulnUntil,
    freezeUntil: f.freezeUntil,
    hitstunUntil: f.hitstunUntil,
    jumpsLeft: f.jumpsLeft,
    wallSide: f.wallSide,
    lastSeq: f.lastSeq
  }))
  const statics: BrawlStatics | null = opts.full
    ? {
        fighters: state.fighters.map((f) => ({
          slot: f.slot,
          id: f.id,
          team: f.team,
          kos: f.kos,
          falls: f.falls,
          dealt: f.dealt,
          outTick: f.outTick,
          respawnTick: f.respawnTick,
          dodgeReadyTick: f.dodgeReadyTick,
          wallTicks: f.wallTicks,
          lastHitBy: f.lastHitBy,
          lastHitTick: f.lastHitTick,
          onThin: f.onThin,
          hitSlots: f.hitSlots.slice()
        }))
      }
    : null
  return {
    epoch: opts.epoch,
    tick: state.tick,
    phase: state.phase,
    goTick: state.goTick,
    endTick: state.endTick,
    arenaId: state.arenaId,
    mode: state.mode,
    teamSize: state.teamSize,
    friendlyFire: state.friendlyFire,
    botLevel: state.botLevel,
    rng: state.rng,
    nextId: state.nextId,
    nextDropTick: state.nextDropTick,
    fighters,
    items: state.items.map((i) => ({ ...i })),
    projectiles: state.projectiles.map((p) => ({ ...p, hit: { ...p.hit }, hitSlots: p.hitSlots.slice() })),
    puddles: state.puddles.map((p) => ({ ...p })),
    events: recentEvents.map((e) => ({ tick: e.tick, ev: e.ev })),
    statics
  }
}

/** Junta a tabela estática mais recente com a de um snapshot novo (o cheio sobrescreve). */
export function mergeStatics(prev: BrawlStatics | null, snap: BrawlSnapshot): BrawlStatics | null {
  return snap.statics ?? prev
}

/**
 * BrawlSimState válido para continuar a luta (troca de host). `statics` = a tabela mais recente
 * (se o snapshot for cheio ele mesmo serve). Sem id de algum slot usa `jogador-<slot>`.
 */
export function restoreState(snap: BrawlSnapshot, statics: BrawlStatics | null = snap.statics): BrawlSimState {
  const fighters: Fighter[] = snap.fighters.map((p) => {
    const s = statics?.fighters.find((o) => o.slot === p.slot)
    const hist: number[] = []
    for (let i = 0; i < LAG_HISTORY_TICKS; i++) hist.push(p.x, p.y)
    return {
      slot: p.slot,
      id: s?.id || (p.bot ? `bot-${p.slot - BOT_SLOT_BASE + 1}` : `jogador-${p.slot}`),
      bot: p.bot,
      away: p.away,
      char: p.char,
      team: s?.team ?? p.slot,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      facing: p.facing,
      grounded: p.grounded,
      onThin: s?.onThin ?? -1,
      fastFall: p.fastFall,
      action: p.action,
      actionTick: p.actionTick,
      jumpsLeft: p.jumpsLeft,
      recoveryUsed: p.recoveryUsed,
      airDodgeUsed: p.airDodgeUsed,
      dodgeReadyTick: s?.dodgeReadyTick ?? 0,
      move: p.move,
      moveTick: p.moveTick,
      charge: p.charge,
      hitSlots: s ? s.hitSlots.slice() : [],
      hitstunUntil: p.hitstunUntil,
      freezeUntil: p.freezeUntil,
      invulnUntil: p.invulnUntil,
      damage: p.damage,
      stocks: p.stocks,
      held: p.held,
      wallSide: p.wallSide,
      wallTicks: s?.wallTicks ?? 0,
      lastHitBy: s?.lastHitBy ?? -1,
      lastHitTick: s?.lastHitTick ?? 0,
      respawnTick: s?.respawnTick ?? 0,
      outTick: s?.outTick ?? 0,
      kos: s?.kos ?? 0,
      falls: s?.falls ?? 0,
      dealt: s?.dealt ?? 0,
      prevButtons: 0,
      lastSeq: p.lastSeq,
      hist
    }
  })
  return {
    arenaId: snap.arenaId,
    mode: snap.mode,
    teamSize: snap.teamSize,
    friendlyFire: snap.friendlyFire,
    botLevel: snap.botLevel,
    tick: snap.tick,
    phase: snap.phase,
    goTick: snap.goTick,
    endTick: snap.endTick,
    rng: snap.rng >>> 0,
    nextId: snap.nextId,
    nextDropTick: snap.nextDropTick,
    fighters,
    items: snap.items.map((i) => ({ ...i })),
    projectiles: snap.projectiles.map((p) => ({ ...p, hit: { ...p.hit }, hitSlots: p.hitSlots.slice() })),
    puddles: snap.puddles.map((p) => ({ ...p }))
  }
}

/** ticks futuros -> u8/u16 (0 = sem prazo) */
const ahead8 = (v: number, tick: number) => clampInt(v - tick, 0, 255)
const ahead16 = (v: number, tick: number) => clampInt(v - tick, 0, 65535)
const behind8 = (v: number, tick: number) => clampInt(tick - v, 0, 255)
const fromAhead = (d: number, tick: number) => (d === 0 ? 0 : tick + d)

function moveCode(id: MoveId): number {
  if (id.startsWith('proj:')) return PROJ_MOVE_BASE + Math.max(0, KIND_LIST.indexOf(id.slice(5) as ProjectileKind))
  return moveIndex(id)
}
function moveFromCode(c: number): MoveId {
  if (c >= PROJ_MOVE_BASE) return `proj:${pick(KIND_LIST, c - PROJ_MOVE_BASE)}`
  const m = moveById(c)
  if (m === null) throw new RangeError('golpe')
  return m
}

function writeEvent(w: Writer, tick: number, e: TimedEventLike): void {
  const ev = e.ev
  w.u8(behind8(e.tick, tick))
  switch (ev.type) {
    case 'jump':
      w.u8(0)
      w.u8(ev.slot)
      w.u8(ev.air ? 1 : 0)
      break
    case 'land':
      w.u8(1)
      w.u8(ev.slot)
      w.u8(ev.hard ? 1 : 0)
      break
    case 'dodge':
      w.u8(2)
      w.u8(ev.slot)
      break
    case 'attack':
      w.u8(3)
      w.u8(ev.slot)
      w.u8(moveCode(ev.move))
      w.u8(ev.charge)
      break
    case 'hit':
      w.u8(4)
      w.u8(ev.attacker)
      w.u8(ev.victim)
      w.u8(moveCode(ev.move))
      w.u8(ev.damage)
      w.u8(clampInt(ev.kb * 8, 0, 255))
      w.u8(ev.strength)
      w.u16(qp(ev.x))
      w.u16(qp(ev.y))
      break
    case 'ko':
      w.u8(5)
      w.u8(ev.victim)
      w.u8(ev.killer < 0 ? 255 : ev.killer)
      w.u8(idx(SIDE_LIST, ev.side))
      w.u16(qp(ev.x))
      w.u16(qp(ev.y))
      break
    case 'respawn':
      w.u8(6)
      w.u8(ev.slot)
      break
    case 'eliminated':
      w.u8(7)
      w.u8(ev.slot)
      break
    case 'last-stock':
      w.u8(8)
      w.u8(ev.slot)
      break
    case 'drop':
      w.u8(9)
      w.u32(ev.item)
      w.u8(idx(WEAPON_IDS, ev.weapon))
      w.u16(qp(ev.x))
      break
    case 'pickup':
      w.u8(10)
      w.u8(ev.slot)
      w.u8(idx(WEAPON_IDS, ev.weapon))
      break
    case 'throw':
      w.u8(11)
      w.u8(ev.slot)
      w.u8(idx(WEAPON_IDS, ev.weapon))
      break
    case 'wall':
      w.u8(12)
      w.u8(ev.slot)
      break
    case 'phase':
      w.u8(13)
      w.u8(idx(PHASE_LIST, ev.phase))
      break
    case 'go':
      w.u8(14)
      break
  }
}
type TimedEventLike = BrawlTimedEvent

function readEvent(r: Reader, tick: number): BrawlTimedEvent {
  const t = tick - r.u8()
  const type = r.u8()
  let ev: BrawlSimEvent
  switch (type) {
    case 0:
      ev = { type: 'jump', slot: r.u8(), air: r.u8() === 1 }
      break
    case 1:
      ev = { type: 'land', slot: r.u8(), hard: r.u8() === 1 }
      break
    case 2:
      ev = { type: 'dodge', slot: r.u8() }
      break
    case 3:
      ev = { type: 'attack', slot: r.u8(), move: moveFromCode(r.u8()), charge: r.u8() }
      break
    case 4: {
      const attacker = r.u8()
      const victim = r.u8()
      const move = moveFromCode(r.u8())
      const damage = r.u8()
      const kb = r.u8() / 8
      const strength = r.u8()
      if (strength > 3) throw new RangeError('força')
      ev = { type: 'hit', attacker, victim, move, damage, kb, strength: strength as 0 | 1 | 2 | 3, x: dp(r.u16()), y: dp(r.u16()) }
      break
    }
    case 5: {
      const victim = r.u8()
      const k = r.u8()
      ev = { type: 'ko', victim, killer: k === 255 ? -1 : k, side: pick(SIDE_LIST, r.u8()), x: dp(r.u16()), y: dp(r.u16()) }
      break
    }
    case 6:
      ev = { type: 'respawn', slot: r.u8() }
      break
    case 7:
      ev = { type: 'eliminated', slot: r.u8() }
      break
    case 8:
      ev = { type: 'last-stock', slot: r.u8() }
      break
    case 9:
      ev = { type: 'drop', item: r.u32(), weapon: pick(WEAPON_IDS, r.u8()), x: dp(r.u16()) }
      break
    case 10:
      ev = { type: 'pickup', slot: r.u8(), weapon: pick(WEAPON_IDS, r.u8()) }
      break
    case 11:
      ev = { type: 'throw', slot: r.u8(), weapon: pick(WEAPON_IDS, r.u8()) }
      break
    case 12:
      ev = { type: 'wall', slot: r.u8() }
      break
    case 13:
      ev = { type: 'phase', phase: pick(PHASE_LIST, r.u8()) }
      break
    case 14:
      ev = { type: 'go' }
      break
    default:
      throw new RangeError('evento')
  }
  return { tick: t, ev }
}

export function encodeSnapshot(s: BrawlSnapshot): ArrayBuffer {
  const w = new Writer(1024)
  const tick = s.tick
  w.head(PKT_SNAPSHOT)
  w.u16(s.epoch)
  w.u32(tick)
  w.u8(idx(PHASE_LIST, s.phase))
  // configuração fixa da luta em 1 byte
  w.u8(idx(ARENA_IDS, s.arenaId) | (idx(MODE_LIST, s.mode) << 1) | (idx(TEAM_LIST, s.teamSize) << 2) | ((s.friendlyFire ? 1 : 0) << 4) | (idx(LEVEL_LIST, s.botLevel) << 5))
  w.u16(s.goTick)
  w.u16(s.endTick)
  w.u32(s.rng)
  w.u32(s.nextId)
  w.u16(ahead16(s.nextDropTick, tick))
  const events = s.events.slice(-255)
  w.u8(s.fighters.length)
  w.u8(Math.min(255, s.items.length))
  w.u8(Math.min(255, s.projectiles.length))
  w.u8(Math.min(255, s.puddles.length))
  w.u8(events.length)
  w.u8(s.statics ? 1 : 0)

  for (const p of s.fighters) {
    w.u8(p.slot)
    w.u8((p.bot ? 1 : 0) | (p.away ? 2 : 0) | (p.facing === 1 ? 4 : 0) | (p.grounded ? 8 : 0) | (p.fastFall ? 16 : 0) | (p.recoveryUsed ? 32 : 0) | (p.airDodgeUsed ? 64 : 0))
    w.u8(idx(ACTION_LIST, p.action))
    w.u8(idx(CHARACTER_IDS, p.char) | (idx(HELD_LIST, p.held) << 2) | (clampInt(p.jumpsLeft, 0, 3) << 4) | ((p.wallSide + 1) << 6))
    w.u16(qp(p.x))
    w.u16(qp(p.y))
    w.i16(qv(p.vx))
    w.i16(qv(p.vy))
    w.u8(behind8(p.actionTick, tick))
    w.u8(moveIndex(p.move))
    w.u8(p.moveTick)
    w.u8(p.charge)
    w.u16(p.damage)
    w.u8(p.stocks)
    w.u8(ahead8(p.invulnUntil, tick))
    w.u8(ahead8(p.freezeUntil, tick))
    w.u8(ahead8(p.hitstunUntil, tick))
    w.u32(p.lastSeq)
  }

  if (s.statics) {
    for (const p of s.fighters) {
      const st = s.statics.fighters.find((o) => o.slot === p.slot)
      w.str(st?.id ?? '')
      w.u8(st?.team ?? 0)
      w.u8(st?.kos ?? 0)
      w.u8(st?.falls ?? 0)
      w.u16(st?.dealt ?? 0)
      w.u32(st?.outTick ?? 0)
      w.u16(st ? ahead16(st.respawnTick, tick) : 0)
      w.u8(st ? ahead8(st.dodgeReadyTick, tick) : 0)
      w.u8(st?.wallTicks ?? 0)
      w.u8(!st || st.lastHitBy < 0 ? 255 : st.lastHitBy)
      w.u8(st ? behind8(st.lastHitTick, tick) : 0)
      w.i8(st?.onThin ?? -1)
      const hs = st ? st.hitSlots.slice(0, 32) : []
      w.u8(hs.length / 2)
      for (let i = 0; i < hs.length; i += 2) {
        w.u8(hs[i])
        w.u8(behind8(hs[i + 1], tick))
      }
    }
  }

  for (const it of s.items.slice(0, 255)) {
    w.u32(it.id)
    w.u8(idx(WEAPON_IDS, it.weapon) | (idx(ITEM_STATE_LIST, it.state) << 2))
    w.u8(it.owner < 0 ? 255 : it.owner)
    w.u16(qp(it.x))
    w.u16(qp(it.y))
    w.i16(qv(it.vx))
    w.i16(qv(it.vy))
    w.u16(ahead16(it.dieTick, tick))
  }

  for (const p of s.projectiles.slice(0, 255)) {
    w.u32(p.id)
    w.u8(p.owner)
    w.u8(idx(KIND_LIST, p.kind) | (p.facing === 1 ? 8 : 0) | (p.pierce ? 16 : 0) | (idx(WEAPON_IDS, p.weapon ?? 'vassoura') << 5) | (p.weapon ? 128 : 0))
    w.u16(qp(p.x))
    w.u16(qp(p.y))
    w.i16(qv(p.vx))
    w.i16(qv(p.vy))
    w.u8(p.w)
    w.u8(p.h)
    w.u16(ahead16(p.dieTick, tick))
    w.u8(p.hit.damage)
    w.u8(clampInt(p.hit.baseKb * 16, 0, 255))
    w.u8(clampInt(p.hit.kbGrowth * 8, 0, 255))
    w.i8(qUnit(p.hit.dx))
    w.i8(qUnit(p.hit.dy))
    const hs = p.hitSlots.slice(0, 12)
    w.u8(hs.length)
    for (const h of hs) w.u8(h)
  }

  for (const p of s.puddles.slice(0, 255)) {
    w.u32(p.id)
    w.u8(p.owner)
    w.u16(qp(p.x))
    w.u16(qp(p.y))
    w.u8(p.w)
    w.u16(ahead16(p.dieTick, tick))
  }

  for (const e of events) writeEvent(w, tick, e)
  return w.done()
}

function readSnapshot(r: Reader): BrawlSnapshot {
  const epoch = r.u16()
  const tick = r.u32()
  const phase = pick(PHASE_LIST, r.u8())
  const cfg = r.u8()
  const arenaId = pick(ARENA_IDS, cfg & 1)
  const mode = pick(MODE_LIST, (cfg >> 1) & 1)
  const teamSize = pick(TEAM_LIST, (cfg >> 2) & 3)
  const friendlyFire = ((cfg >> 4) & 1) === 1
  const botLevel = pick(LEVEL_LIST, cfg >> 5)
  const goTick = r.u16()
  const endTick = r.u16()
  const rng = r.u32()
  const nextId = r.u32()
  const nextDropTick = tick + r.u16()
  const nF = r.u8()
  const nI = r.u8()
  const nP = r.u8()
  const nU = r.u8()
  const nE = r.u8()
  const full = r.u8() === 1
  if (nF > 16) throw new RangeError('lutadores')

  const fighters: BrawlSnapFighter[] = []
  for (let i = 0; i < nF; i++) {
    const slot = r.u8()
    if (slot > 15) throw new RangeError('slot')
    const fl = r.u8()
    const action = pick(ACTION_LIST, r.u8())
    const meta = r.u8()
    const x = dp(r.u16())
    const y = dp(r.u16())
    const vx = dv(r.i16())
    const vy = dv(r.i16())
    const actionTick = tick - r.u8()
    const mi = r.u8()
    const move = mi === 0 ? null : moveFromCode(mi)
    fighters.push({
      slot,
      bot: (fl & 1) !== 0,
      away: (fl & 2) !== 0,
      char: pick(CHARACTER_IDS, meta & 3),
      facing: (fl & 4) !== 0 ? 1 : -1,
      grounded: (fl & 8) !== 0,
      fastFall: (fl & 16) !== 0,
      recoveryUsed: (fl & 32) !== 0,
      airDodgeUsed: (fl & 64) !== 0,
      action,
      actionTick,
      x,
      y,
      vx,
      vy,
      move,
      moveTick: r.u8(),
      charge: r.u8(),
      damage: r.u16(),
      stocks: r.u8(),
      held: pick(HELD_LIST, (meta >> 2) & 3),
      invulnUntil: fromAhead(r.u8(), tick),
      freezeUntil: fromAhead(r.u8(), tick),
      hitstunUntil: fromAhead(r.u8(), tick),
      jumpsLeft: (meta >> 4) & 3,
      wallSide: (((meta >> 6) & 3) - 1) as -1 | 0 | 1,
      lastSeq: r.u32()
    })
  }
  for (const f of fighters) if (f.wallSide > 1) throw new RangeError('parede')

  let statics: BrawlStatics | null = null
  if (full) {
    statics = { fighters: [] }
    for (const f of fighters) {
      const id = r.str()
      const team = r.u8()
      const kos = r.u8()
      const falls = r.u8()
      const dealt = r.u16()
      const outTick = r.u32()
      const respawnTick = tick + r.u16()
      const dodgeReadyTick = fromAhead(r.u8(), tick)
      const wallTicks = r.u8()
      const lh = r.u8()
      const lastHitTick = tick - r.u8()
      const onThin = r.i8()
      const n = r.u8()
      if (n > 16) throw new RangeError('hitSlots')
      const hitSlots: number[] = []
      for (let i = 0; i < n; i++) hitSlots.push(r.u8(), tick - r.u8())
      statics.fighters.push({ slot: f.slot, id, team, kos, falls, dealt, outTick, respawnTick, dodgeReadyTick, wallTicks, lastHitBy: lh === 255 ? -1 : lh, lastHitTick, onThin, hitSlots })
    }
  }

  const items: WeaponItem[] = []
  for (let i = 0; i < nI; i++) {
    const id = r.u32()
    const b = r.u8()
    const ow = r.u8()
    items.push({
      id,
      weapon: pick(WEAPON_IDS, b & 3),
      state: pick(ITEM_STATE_LIST, (b >> 2) & 3),
      owner: ow === 255 ? -1 : ow,
      x: dp(r.u16()),
      y: dp(r.u16()),
      vx: dv(r.i16()),
      vy: dv(r.i16()),
      dieTick: fromAhead(r.u16(), tick)
    })
  }

  const projectiles: Projectile[] = []
  for (let i = 0; i < nP; i++) {
    const id = r.u32()
    const owner = r.u8()
    const b = r.u8()
    const x = dp(r.u16())
    const y = dp(r.u16())
    const vx = dv(r.i16())
    const vy = dv(r.i16())
    const w = r.u8()
    const h = r.u8()
    const dieTick = fromAhead(r.u16(), tick)
    const damage = r.u8()
    const baseKb = r.u8() / 16
    const kbGrowth = r.u8() / 8
    const dx = dUnit(r.i8())
    const dy = dUnit(r.i8())
    const nh = r.u8()
    if (nh > 12) throw new RangeError('hitSlots')
    const hitSlots: number[] = []
    for (let k = 0; k < nh; k++) hitSlots.push(r.u8())
    const p: Projectile = {
      id,
      owner,
      kind: pick(KIND_LIST, b & 7),
      x,
      y,
      vx,
      vy,
      w,
      h,
      facing: (b & 8) !== 0 ? 1 : -1,
      hit: { damage, baseKb, kbGrowth, dx, dy },
      pierce: (b & 16) !== 0,
      hitSlots,
      dieTick
    }
    if ((b & 128) !== 0) p.weapon = pick(WEAPON_IDS, (b >> 5) & 3)
    projectiles.push(p)
  }

  const puddles: Puddle[] = []
  for (let i = 0; i < nU; i++) puddles.push({ id: r.u32(), owner: r.u8(), x: dp(r.u16()), y: dp(r.u16()), w: r.u8(), dieTick: fromAhead(r.u16(), tick) })

  const events: BrawlTimedEvent[] = []
  for (let i = 0; i < nE; i++) events.push(readEvent(r, tick))

  if (r.left !== 0) throw new RangeError('sobra')
  return { epoch, tick, phase, goTick, endTick, arenaId, mode, teamSize, friendlyFire, botLevel, rng, nextId, nextDropTick, fighters, items, projectiles, puddles, events, statics }
}

// ---------------------------------------------------------------------------------------
// Decodificação geral
// ---------------------------------------------------------------------------------------

/** Tipo do pacote sem decodificar tudo (ou null). */
export function packetType(data: ArrayBuffer | Uint8Array): number | null {
  const b = toBytes(data)
  return b.length >= 2 && b[1] === CODEC_VERSION && b[0] >= PKT_HELLO && b[0] <= PKT_SNAPSHOT ? b[0] : null
}

/** Decodifica qualquer pacote. Inválido, curto, de outra versão ou com sobra: null. */
export function decodePacket(data: ArrayBuffer | Uint8Array): Packet | null {
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
        if (slot > 15 || n === 0 || n > MAX_INPUTS_PER_PACKET || r.left !== n * 7) return null
        const inputs: BrawlInput[] = []
        for (let i = 0; i < n; i++) {
          const seq = r.u32()
          const mx = dUnit(r.i8())
          const my = dUnit(r.i8())
          inputs.push({ seq, mx, my, buttons: r.u8() & BTN_MASK })
        }
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

export const decodeHello = (d: ArrayBuffer | Uint8Array): HelloPacket | null => {
  const p = decodePacket(d)
  return p?.t === 'hello' ? p : null
}
export const decodeInput = (d: ArrayBuffer | Uint8Array): InputPacket | null => {
  const p = decodePacket(d)
  return p?.t === 'input' ? p : null
}
export const decodePing = (d: ArrayBuffer | Uint8Array): PingPacket | null => {
  const p = decodePacket(d)
  return p?.t === 'ping' || p?.t === 'pong' ? p : null
}
export const decodeSnapshot = (d: ArrayBuffer | Uint8Array): BrawlSnapshot | null => {
  const p = decodePacket(d)
  if (p?.t !== 'snapshot') return null
  const { t: _t, ...snap } = p
  void _t
  return snap
}

/** nomes pedidos pelo contrato do agente (iguais a encodeInput/decodeInput) */
export const encodeInputs = encodeInput
export const decodeInputs = decodeInput

// ---------------------------------------------------------------------------------------
// base64 (sem Buffer, sem atob/btoa)
// ---------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_REV = (() => {
  const t = new Int8Array(128).fill(-1)
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i
  return t
})()

export function toBase64(data: ArrayBuffer | Uint8Array): string {
  const b = toBytes(data)
  const parts: string[] = []
  let chunk = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    chunk += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=')
    if (chunk.length >= 4096) {
      parts.push(chunk)
      chunk = ''
    }
  }
  parts.push(chunk)
  return parts.join('')
}

/** base64 → bytes, ou null se o texto não for base64 válido. */
export function fromBase64(text: string): ArrayBuffer | null {
  if (text.length % 4 !== 0) return null
  let pad = 0
  if (text.endsWith('==')) pad = 2
  else if (text.endsWith('=')) pad = 1
  const out = new Uint8Array((text.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    let n = 0
    for (let j = 0; j < 4; j++) {
      const c = text.charCodeAt(i + j)
      let v: number
      if (c === 61 && i + j >= text.length - pad) v = 0
      else {
        v = c < 128 ? B64_REV[c] : -1
        if (v < 0) return null
      }
      n = (n << 6) | v
    }
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out.buffer as ArrayBuffer
}
