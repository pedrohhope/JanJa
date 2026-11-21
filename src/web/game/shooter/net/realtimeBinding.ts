/**
 * Liga o Tiro na Sala à plataforma de tempo real (`src/web/game/realtime/`): a simulação de 40 Hz
 * (`shared/games/shooter/sim.ts`) e o codec binário viram um `RealtimeSim`. Único ponto que liga a
 * rede à simulação (no Worker, na thread principal e nos testes). Não muda nada no fio.
 */
import {
  INPUT_REDUNDANCY,
  INTERP_DELAY_MS,
  MAX_LAG_COMP_MS,
  SNAPSHOT_EVERY,
  TICK_HZ,
  TICK_MS,
  type Input,
  type ScoreLine,
  type SimEvent,
  type SimPlayer,
  type SimPlayerRef,
  type SimState
} from '../../../../shared/games/shooter/types'
import {
  decodePacket,
  encodeHello,
  encodeInput,
  encodePing,
  encodeSnapshot,
  fromBase64,
  MAX_PACKET_BYTES,
  mergeStatics,
  packetType,
  PKT_HELLO,
  restoreState,
  snapshotFromState,
  toBase64,
  type Snapshot,
  type SnapshotStatics
} from '../../../../shared/games/shooter/codec'
import { getMap } from '../../../../shared/games/shooter/maps'
import { sim } from '../../../../shared/games/shooter/sim'
import type { RealtimeCodec, RealtimeSim, RealtimeTypes } from '../../realtime/types'

export interface ShooterTypes extends RealtimeTypes {
  State: SimState
  Input: Input
  Snapshot: Snapshot
  Event: SimEvent
  Ref: SimPlayerRef
  Score: ScoreLine
  Statics: SnapshotStatics
  Self: SimPlayer
}

/** Entrada "solta tudo" (o jogador sumiu): sem mira, sem botões. */
const RELEASED: Input = { seq: 0, mx: 0, my: 0, ax: 0, ay: 0, buttons: 0 }

/** Entrada vinda da rede: números finitos e limitados, ou null. */
export function sanitizeInput(raw: unknown): Input | null {
  if (!raw || typeof raw !== 'object') return null
  const i = raw as Partial<Input>
  if (typeof i.seq !== 'number' || !Number.isFinite(i.seq) || i.seq <= 0 || i.seq > 0xffffffff) return null
  const f = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)
  const buttons = typeof i.buttons === 'number' && Number.isFinite(i.buttons) ? i.buttons & 7 : 0
  return { seq: Math.floor(i.seq), mx: f(i.mx), my: f(i.my), ax: f(i.ax), ay: f(i.ay), buttons }
}

const codec: RealtimeCodec<ShooterTypes> = {
  maxPacketBytes: MAX_PACKET_BYTES,
  isHello: (data) => packetType(data) === PKT_HELLO,
  decodeHello(data) {
    const h = decodePacket(data)
    return h?.t === 'hello' ? h : null
  },
  encodeHello,
  toBase64,
  fromBase64,
  decode: (data) => decodePacket(data),
  encodePing,
  encodeInputs: encodeInput,
  encodeSnapshot
}

export const shooterSim: RealtimeSim<ShooterTypes> = {
  tickHz: TICK_HZ,
  tickMs: TICK_MS,
  snapshotEvery: SNAPSHOT_EVERY,
  fullSnapshotEvery: TICK_HZ,
  interpDelayMs: INTERP_DELAY_MS,
  inputRedundancy: INPUT_REDUNDANCY,
  relayBatch: 1,
  maxLagCompMs: MAX_LAG_COMP_MS,
  emptyInput: RELEASED,
  sanitizeInput,

  step: (state, inputs) => sim.step(state, inputs),
  clone: (state) => sim.cloneState(state),
  addPlayer: (state, ref) => sim.addPlayer(state, ref),
  setAway: (state, slot, away) => sim.setAway(state, slot, away),
  roster: (state) => state.players,
  tickOf: (state) => state.tick,
  isOver: (state) => state.phase === 'fim',
  scores: (state) => sim.scores(state),
  ranking: (state) => sim.ranking(state),

  snapshot: (state, recent, opts) => snapshotFromState(state, recent, opts),
  restore: (snap, statics) => restoreState(snap, statics),
  mergeStatics: (prev, snap) => mergeStatics(prev, snap),

  selfOf(snap, slot, statics) {
    const sp = snap.players.find((p) => p.slot === slot)
    if (!sp) return null
    return { ...sp, id: statics?.ids[slot] ?? (sp.bot ? `bot-${slot}` : `jogador-${slot}`) }
  },
  ackOf: (self) => self.lastSeq,
  canPredict: (self, snap) => self.alive && !self.away && snap.phase !== 'fim',
  predictSelf: (self, snap, input, tick) => sim.movePlayer(getMap(snap.mapId), self, input, tick),
  selfPos: (self) => self,
  selfAlive: (self) => self.alive,

  codec
}
