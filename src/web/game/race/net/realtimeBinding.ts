/**
 * Liga a Corrida na Sala à plataforma de tempo real (`src/web/game/realtime/`): a simulação de 60 Hz
 * (`shared/games/race/sim.ts`) e o codec binário viram um `RealtimeSim`. Único ponto que liga a rede
 * à simulação (no Worker, na thread principal e nos testes).
 *
 * Predição: `Self` é o estado restaurado do retrato com o meu carro; a mesma `predictSelf` da sim
 * (a função `drive` do `step`) roda sobre ele. `predictSelf` não avança `state.tick`: aqui o tick
 * certo é posto antes de cada chamada.
 */
import { BTN_MASK, INPUT_REDUNDANCY, INTERP_DELAY_MS, RELAY_BATCH, SNAPSHOT_EVERY, TICK_HZ, TICK_MS, type Car, type RaceInput, type RaceScoreLine, type RaceSimEvent, type RaceSimPlayerRef, type RaceSimState } from '../../../../shared/games/race/types'
import { decodePacket, encodeHello, encodeInput, encodePing, encodeSnapshot, fromBase64, MAX_PACKET_BYTES, mergeStatics, packetType, PKT_HELLO, restoreState, snapshotFromState, toBase64, type RaceSnapshot, type RaceStatics } from '../../../../shared/games/race/codec'
import { raceSim } from '../../../../shared/games/race/sim'
import type { RealtimeCodec, RealtimeSim, RealtimeTypes } from '../../realtime/types'

/** o meu carro como o cliente o prevê */
export interface RaceSelf {
  st: RaceSimState
  slot: number
  /** o carro previsto (mesmo objeto de `st.cars`) */
  c: Car
}

export interface RaceTypes extends RealtimeTypes {
  State: RaceSimState
  Input: RaceInput
  Snapshot: RaceSnapshot
  Event: RaceSimEvent
  Ref: RaceSimPlayerRef
  Score: RaceScoreLine
  Statics: RaceStatics
  Self: RaceSelf
}

const RELEASED: RaceInput = { seq: 0, steer: 0, buttons: 0 }

/** Entrada vinda da rede: números finitos e limitados, ou null. */
export function sanitizeInput(raw: unknown): RaceInput | null {
  if (!raw || typeof raw !== 'object') return null
  const i = raw as Partial<RaceInput>
  if (typeof i.seq !== 'number' || !Number.isFinite(i.seq) || i.seq <= 0 || i.seq > 0xffffffff) return null
  const steer = typeof i.steer === 'number' && Number.isFinite(i.steer) ? Math.max(-1, Math.min(1, i.steer)) : 0
  const buttons = typeof i.buttons === 'number' && Number.isFinite(i.buttons) ? i.buttons & BTN_MASK : 0
  return { seq: Math.floor(i.seq), steer, buttons }
}

const codec: RealtimeCodec<RaceTypes> = {
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

const live = (c: Car, snap: { phase: string }) => !c.away && c.finishTick === 0 && snap.phase !== 'fim'

export const raceRealtime: RealtimeSim<RaceTypes> = {
  tickHz: TICK_HZ,
  tickMs: TICK_MS,
  snapshotEvery: SNAPSHOT_EVERY,
  fullSnapshotEvery: TICK_HZ / 2,
  interpDelayMs: INTERP_DELAY_MS,
  inputRedundancy: INPUT_REDUNDANCY,
  relayBatch: RELAY_BATCH,
  maxLagCompMs: 0,
  maxQueue: 5,
  staleTicks: 10,
  smoothMaxPx: 40,
  smoothMs: 140,
  emptyInput: RELEASED,
  sanitizeInput,

  step: (state, inputs) => raceSim.step(state, inputs),
  clone: (state) => raceSim.cloneState(state),
  addPlayer: (state, ref) => raceSim.addPlayer(state, ref),
  setAway: (state, slot, away) => raceSim.setAway(state, slot, away),
  roster: (state) => state.cars,
  tickOf: (state) => state.tick,
  isOver: (state) => state.phase === 'fim',
  scores: (state) => raceSim.scores(state),
  ranking: (state) => raceSim.ranking(state),

  snapshot: (state, recent, opts) => snapshotFromState(state, recent, opts),
  restore: (snap, statics) => restoreState(snap, statics),
  mergeStatics: (prev, snap) => mergeStatics(prev, snap),

  selfOf(snap, slot, statics) {
    if (!snap.cars.some((c) => c.slot === slot)) return null
    const st = restoreState(snap, statics)
    const c = st.cars.find((o) => o.slot === slot)
    return c ? { st, slot, c } : null
  },
  ackOf: (self) => self.c.lastSeq,
  canPredict: (self, snap) => live(self.c, snap),
  predictSelf(self, _snap, input, tick) {
    // a sim não avança o tick: a entrada de `tick` roda com `st.tick = tick - 1`, como no host
    self.st.tick = tick - 1
    raceSim.predictSelf(self.st, self.slot, input)
  },
  selfPos: (self) => self.c,
  selfAlive: (self) => !self.c.away,

  codec
}
