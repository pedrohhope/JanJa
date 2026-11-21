/**
 * Liga a Briga na Sala à plataforma de tempo real (`src/web/game/realtime/`): a simulação de 60 Hz
 * (`shared/games/brawl/sim.ts`) e o codec binário viram um `RealtimeSim`. Único ponto que liga a
 * rede à simulação (no Worker, na thread principal e nos testes).
 *
 * Predição: `Self` é um estado mínimo restaurado do snapshot (`restoreState`) com o meu lutador; a
 * mesma `predictSelf` da sim (a função de movimento do `step`) roda sobre ele. `predictSelf` não
 * avança `state.tick`: aqui o tick certo é posto antes de cada chamada.
 */
import {
  BTN_MASK,
  INPUT_REDUNDANCY,
  INTERP_DELAY_MS,
  MAX_LAG_COMP_MS,
  RELAY_BATCH,
  SNAPSHOT_EVERY,
  TICK_HZ,
  TICK_MS,
  type BrawlInput,
  type BrawlScoreLine,
  type BrawlSimEvent,
  type BrawlSimPlayerRef,
  type BrawlSimState,
  type Fighter
} from '../../../../shared/games/brawl/types'
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
  type BrawlSnapshot,
  type BrawlStatics
} from '../../../../shared/games/brawl/codec'
import { brawlSim } from '../../../../shared/games/brawl/sim'
import type { RealtimeCodec, RealtimeSim, RealtimeTypes } from '../../realtime/types'

/** o meu lutador como o cliente o prevê */
export interface BrawlSelf {
  /** estado restaurado do snapshot; só `fighters` do meu slot é previsto */
  st: BrawlSimState
  slot: number
  /** o lutador previsto (mesmo objeto de `st.fighters`) */
  f: Fighter
}

export interface BrawlTypes extends RealtimeTypes {
  State: BrawlSimState
  Input: BrawlInput
  Snapshot: BrawlSnapshot
  Event: BrawlSimEvent
  Ref: BrawlSimPlayerRef
  Score: BrawlScoreLine
  Statics: BrawlStatics
  Self: BrawlSelf
}

const RELEASED: BrawlInput = { seq: 0, mx: 0, my: 0, buttons: 0 }

/** Entrada vinda da rede: números finitos e limitados, ou null. */
export function sanitizeInput(raw: unknown): BrawlInput | null {
  if (!raw || typeof raw !== 'object') return null
  const i = raw as Partial<BrawlInput>
  if (typeof i.seq !== 'number' || !Number.isFinite(i.seq) || i.seq <= 0 || i.seq > 0xffffffff) return null
  const f = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)
  const buttons = typeof i.buttons === 'number' && Number.isFinite(i.buttons) ? i.buttons & BTN_MASK : 0
  return { seq: Math.floor(i.seq), mx: f(i.mx), my: f(i.my), buttons }
}

const codec: RealtimeCodec<BrawlTypes> = {
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

const OUT = (a: Fighter['action']) => a === 'fora' || a === 'eliminado'

export const brawlRealtime: RealtimeSim<BrawlTypes> = {
  tickHz: TICK_HZ,
  tickMs: TICK_MS,
  snapshotEvery: SNAPSHOT_EVERY,
  fullSnapshotEvery: TICK_HZ / 2,
  interpDelayMs: INTERP_DELAY_MS,
  inputRedundancy: INPUT_REDUNDANCY,
  relayBatch: RELAY_BATCH,
  maxLagCompMs: MAX_LAG_COMP_MS,
  maxQueue: 5,
  staleTicks: 10,
  emptyInput: RELEASED,
  sanitizeInput,

  step: (state, inputs) => brawlSim.step(state, inputs),
  clone: (state) => brawlSim.cloneState(state),
  addPlayer: (state, ref) => brawlSim.addPlayer(state, ref),
  setAway: (state, slot, away) => brawlSim.setAway(state, slot, away),
  roster: (state) => state.fighters,
  tickOf: (state) => state.tick,
  isOver: (state) => state.phase === 'fim',
  scores: (state) => brawlSim.scores(state),
  ranking: (state) => brawlSim.ranking(state),

  snapshot: (state, recent, opts) => snapshotFromState(state, recent, opts),
  restore: (snap, statics) => restoreState(snap, statics),
  mergeStatics: (prev, snap) => mergeStatics(prev, snap),

  selfOf(snap, slot, statics) {
    if (!snap.fighters.some((p) => p.slot === slot)) return null
    const st = restoreState(snap, statics)
    const f = st.fighters.find((o) => o.slot === slot)
    return f ? { st, slot, f } : null
  },
  ackOf: (self) => self.f.lastSeq,
  canPredict: (self, snap) => !self.f.away && !OUT(self.f.action) && snap.phase !== 'fim',
  predictSelf(self, _snap, input, tick) {
    // a sim não avança o tick: a entrada de `tick` roda com `st.tick = tick - 1`, como no host
    self.st.tick = tick - 1
    brawlSim.predictSelf(self.st, self.slot, input)
  },
  selfPos: (self) => self.f,
  selfAlive: (self) => !self.f.away && !OUT(self.f.action),

  codec
}
