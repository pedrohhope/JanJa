/**
 * Cliente da Corrida: a base genérica (`realtime/client.ts`: buffer de retratos, relógio do host,
 * eventos sem repetição, predição e reconciliação com suavização) mais o que é da corrida: entrada
 * quantizada como o codec e a montagem do `RaceFrame` (você previsto, os outros interpolados).
 * Sem DOM, sem rede, relógio injetado. O host também usa isto.
 */
import { TICK_MS, type RaceInput, type RacePlayerView } from '../../../../shared/games/race/types'
import { quantizeInput, restoreState, type RaceSnapshot } from '../../../../shared/games/race/codec'
import { RealtimeClient } from '../../realtime/client'
import type { RaceFrame, RaceFrameEvent } from '../contract'
import { raceRealtime, type RaceTypes } from './realtimeBinding'

/** salto maior que isto entre dois retratos não é interpolado */
const TELEPORT_PX = 64

export class RaceClient extends RealtimeClient<RaceTypes, RaceFrameEvent> {
  constructor(opts: { me: number | null; interpDelayMs?: number }) {
    super({ sim: raceRealtime, me: opts.me, interpDelayMs: opts.interpDelayMs })
  }

  /** a sessão passa a lista da sala; o desenho só precisa do que vem no retrato */
  setRoster(_players: readonly RacePlayerView[]): void {}

  /** Um tick local: entrada nova (quantizada como o host vai ler) e o movimento previsto. */
  localTick(now: number, st: RaceInput): RaceInput[] | null {
    if (this.me === null) return null
    return this.advanceLocal(now, (seq) => quantizeInput({ seq, steer: st.steer, buttons: st.buttons }))
  }

  /** Quadro para desenhar. `net` e `pingMs` o dono da sessão preenche. */
  frame(now: number, _roster?: readonly RacePlayerView[]): RaceFrame | null {
    const w = this.interpolation(now)
    if (!w) return null
    const { last, a, b, u, renderT } = w
    const near = u < 0.5 ? a : b
    const state = restoreState(near, this.statics)
    state.tick = Math.max(a.tick, Math.min(last.tick, Math.round(renderT / TICK_MS)))
    state.phase = last.phase
    state.goTick = last.goTick
    state.firstFinish = last.firstFinish
    state.endTick = last.endTick

    for (const c of state.cars) {
      if (this.me !== null && c.slot === this.me) continue
      const pa = a.cars.find((p) => p.slot === c.slot)
      const pb = b.cars.find((p) => p.slot === c.slot)
      if (!pa || !pb || pa === pb) continue
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      if (dx * dx + dy * dy > TELEPORT_PX * TELEPORT_PX) continue
      c.x = pa.x + dx * u
      c.y = pa.y + dy * u
      const hx = pa.hx + (pb.hx - pa.hx) * u
      const hy = pa.hy + (pb.hy - pa.hy) * u
      const l = Math.hypot(hx, hy)
      if (l > 1e-6) {
        c.hx = hx / l
        c.hy = hy / l
      }
    }

    // o meu carro vem da predição (no tempo do host agora), com a correção suavizada
    if (this.me !== null && this.pred) {
      const target = state.cars.find((c) => c.slot === this.me)
      const p = this.pred.c
      if (target && !p.away && p.finishTick === 0 && last.phase !== 'fim') {
        const r = this.renderPos(p, now)
        // volta, chegada e portões vêm do host (o último retrato); posição e direção, da predição
        const real = last.cars.find((c) => c.slot === this.me)
        Object.assign(target, { x: r.x, y: r.y, hx: p.hx, hy: p.hy, vx: p.vx, vy: p.vy, steer: p.steer, buttons: p.buttons })
        if (real) Object.assign(target, { lap: real.lap, next: real.next, finishTick: real.finishTick, lapStart: real.lapStart, bestLap: real.bestLap, boostUntil: Math.max(real.boostUntil, p.boostUntil) })
      }
    }
    return { state, me: this.me, net: 'conectando', pingMs: this.pingMs }
  }

  /** os últimos retratos (testes) */
  snapshots(): readonly RaceSnapshot[] {
    return this.snaps
  }
}
