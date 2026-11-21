/**
 * Cliente da Briga: a base genérica (`realtime/client.ts`: buffer de snapshots, relógio do host,
 * eventos sem repetição, predição e reconciliação com suavização) mais o que é da briga: entrada
 * quantizada como o codec, `prevButtons` do lutador previsto e a montagem do `BrawlFrame`
 * (você previsto, os outros interpolados). Sem DOM, sem rede, relógio injetado. O host também usa isto.
 */
import { LAG_HISTORY_TICKS, TICK_MS, type BrawlInput, type BrawlPlayerView, type BrawlSimState, type Fighter } from '../../../../shared/games/brawl/types'
import { quantizeInput, restoreState, type BrawlSnapshot } from '../../../../shared/games/brawl/codec'
import { RealtimeClient } from '../../realtime/client'
import type { BrawlFrame, BrawlFrameEvent } from '../contract'
import { brawlRealtime, type BrawlSelf, type BrawlTypes } from './realtimeBinding'

export { SMOOTH_MAX_PX, SMOOTH_MS } from '../../realtime/client'
/** salto maior que isto entre dois snapshots (renascer, nocaute) não é interpolado */
const TELEPORT_PX = 64
/** guarda os botões das últimas entradas para recompor `prevButtons` depois do ack */
const KEEP_BUTTONS = 240

export interface BrawlClientOptions {
  /** meu slot (null = espectador) */
  me: number | null
  interpDelayMs?: number
}

const isOut = (f: { action: Fighter['action'] }) => f.action === 'fora' || f.action === 'eliminado'

export class BrawlClient extends RealtimeClient<BrawlTypes, BrawlFrameEvent> {
  private buttonsBySeq = new Map<number, number>()
  private lastButtons = 0

  constructor(opts: BrawlClientOptions) {
    super({ sim: brawlRealtime, me: opts.me, interpDelayMs: opts.interpDelayMs })
  }

  /** a sessão passa a lista da sala a cada quadro; o desenho só precisa do que vem no snapshot */
  setRoster(_players: readonly BrawlPlayerView[]): void {}

  // ---------- ganchos da base ----------

  /** Reconcilia: o lutador previsto herda o que o snapshot não leva (borda de botões, recarga da esquiva). */
  protected override selfFrom(snap: BrawlSnapshot): BrawlSelf | null {
    const np = super.selfFrom(snap)
    if (!np) return null
    const f = np.f
    const prev = this.pred?.f
    // `prevButtons` não vai pela rede: é o botão da última entrada que o host aplicou (o ack)
    f.prevButtons = this.buttonsBySeq.get(f.lastSeq) ?? (f.lastSeq === 0 ? 0 : this.lastButtons)
    // o snapshot comum não leva a recarga da esquiva: mantém a que eu já previa
    if (prev && snap.statics === null) f.dodgeReadyTick = Math.max(f.dodgeReadyTick, prev.dodgeReadyTick)
    return np
  }

  // ---------- entrada local ----------

  /**
   * Um tick local: cria a entrada nova (quantizada como o host vai ler), prevê o movimento e o
   * andamento do golpe. Devolve as últimas INPUT_REDUNDANCY+1 entradas (a mais antiga primeiro)
   * para mandar ao host, ou null se não joga.
   */
  localTick(now: number, st: BrawlInput): BrawlInput[] | null {
    if (this.me === null) return null
    return this.advanceLocal(now, (seq) => {
      const input = quantizeInput({ seq, mx: st.mx, my: st.my, buttons: st.buttons })
      this.buttonsBySeq.set(seq, input.buttons)
      this.lastButtons = input.buttons
      if (this.buttonsBySeq.size > KEEP_BUTTONS) this.buttonsBySeq.delete(seq - KEEP_BUTTONS)
      return input
    })
  }

  // ---------- quadro ----------

  /** Quadro para desenhar. `net` e `pingMs` o dono da sessão preenche. */
  frame(now: number, _roster?: readonly BrawlPlayerView[]): BrawlFrame | null {
    const w = this.interpolation(now)
    if (!w) return null
    const { last, a, b, u, renderT, tickNow } = w

    // o que não se interpola (ação, golpe, armas...) vem do retrato mais perto do instante desenhado
    const near = u < 0.5 ? a : b
    const state = restoreState(near, this.statics)
    const drawTick = Math.max(a.tick, Math.min(last.tick, Math.round(renderT / TICK_MS)))
    state.tick = drawTick
    const dt = drawTick - near.tick
    state.phase = last.phase
    state.goTick = last.goTick
    state.endTick = last.endTick

    for (const f of state.fighters) {
      if (this.me !== null && f.slot === this.me) continue
      const pa = a.fighters.find((p) => p.slot === f.slot)
      const pb = b.fighters.find((p) => p.slot === f.slot)
      if (pa && pb && pa !== pb && !pa.away && !pb.away && (pa.action === 'fora') === (pb.action === 'fora') && Math.hypot(pb.x - pa.x, pb.y - pa.y) < TELEPORT_PX) {
        f.x = pa.x + (pb.x - pa.x) * u
        f.y = pa.y + (pb.y - pa.y) * u
      }
    }
    for (const pr of state.projectiles) {
      pr.x += pr.vx * dt
      pr.y += pr.vy * dt
    }
    for (const it of state.items) {
      if (it.state === 'chao') continue
      it.x += it.vx * dt
      it.y += it.vy * dt
    }

    this.overlaySelf(state, now)

    const timeLeftMs = last.phase === 'jogando' && last.endTick > 0 ? Math.max(0, (last.endTick - tickNow) * TICK_MS) : 0
    return { state, me: this.me, timeLeftMs, net: 'conectando', pingMs: this.pingMs }
  }

  /** Meu lutador vem da predição (no tempo do host agora), com a correção suavizada. */
  private overlaySelf(state: BrawlSimState, now: number): void {
    if (this.me === null || !this.pred) return
    const target = state.fighters.find((f) => f.slot === this.me)
    const p = this.pred.f
    if (!target || isOut(p) || isOut(target) || p.away) return
    const keep = { id: target.id, team: target.team, kos: target.kos, falls: target.falls, dealt: target.dealt, outTick: target.outTick, ai: target.ai }
    const r = this.renderPos(p, now)
    Object.assign(target, p, keep, { x: r.x, y: r.y })
    // meu relógio está adiantado em relação ao desenhado (predição + metade da ida e volta): o que a cena mede por `tick - X` é deslocado
    const shift = state.tick - this.predTick
    target.actionTick += shift
    target.invulnUntil += shift
    target.freezeUntil += shift
    target.hitstunUntil += shift
    target.dodgeReadyTick += shift
    target.hist = new Array<number>(LAG_HISTORY_TICKS * 2).fill(0)
  }

  /** os últimos retratos para teste */
  snapshots(): readonly BrawlSnapshot[] {
    return this.snaps
  }
}
