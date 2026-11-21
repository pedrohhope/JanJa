/**
 * Cliente do Tiro: a base genérica (`realtime/client.ts`: buffer de snapshots, relógio do host,
 * eventos sem repetição, predição e reconciliação com suavização) mais o que é do tiro: mira,
 * tiro previsto, projéteis extrapolados e a montagem do `ShooterFrame`. Sem DOM, sem rede, relógio
 * injetado (todo método que depende de tempo recebe `now` em ms). O host também usa isto (laço local).
 */
import {
  BTN_FIRE,
  PICKUP_RESPAWN_TICKS,
  PLAYER_RADIUS,
  TICK_MS,
  WEAPONS,
  type Input,
  type MapDef,
  type MapId,
  type ScoreLine,
  type ShooterPlayerView,
  type SimApi,
  type SimPickup,
  type SimPlayer
} from '../../../../shared/games/shooter/types'
import { quantizeInput, type SnapPlayer, type Snapshot } from '../../../../shared/games/shooter/codec'
import { RealtimeClient } from '../../realtime/client'
import type { FrameEvent, InputState, RenderPickup, RenderPlayer, RenderProjectile, ShooterFrame } from '../contract'
import { shooterSim, type ShooterTypes } from './realtimeBinding'

export { SMOOTH_MAX_PX, SMOOTH_MS } from '../../realtime/client'
/** tiro previsto some depois disto se o real não chegar */
export const PREDICTED_SHOT_TTL_MS = 300
/** distância que conta como teletransporte entre dois snapshots (respawn) */
const TELEPORT_PX = 64

interface PredictedShot {
  t0: number
  list: RenderProjectile[]
}

export interface ClientOptions {
  /** a sim do tiro com o `movePlayer` (o padrão é a de verdade; testes podem trocar) */
  sim?: Pick<SimApi, 'movePlayer'>
  getMap(id: MapId): MapDef
  /** meu slot (null = espectador) */
  me: number | null
  interpDelayMs?: number
}

export class ClientCore extends RealtimeClient<ShooterTypes, FrameEvent> {
  private readonly getMap: (id: MapId) => MapDef
  private roster = new Map<number, ShooterPlayerView>()
  private localNextFire = 0
  private aimX = 1
  private aimY = 0
  private shots: PredictedShot[] = []
  private nextTempId = -1
  private mapCache: MapDef | null = null

  constructor(opts: ClientOptions) {
    super({
      sim: opts.sim ? { ...shooterSim, predictSelf: (self, snap, input, tick) => opts.sim!.movePlayer(opts.getMap(snap.mapId), self, input, tick) } : shooterSim,
      me: opts.me,
      interpDelayMs: opts.interpDelayMs
    })
    this.getMap = opts.getMap
  }

  setRoster(players: readonly ShooterPlayerView[]): void {
    this.roster = new Map(players.map((p) => [p.slot, p]))
  }

  // ---------- ganchos da base ----------

  /** meu tiro já foi tocado na hora (previsão); o real só tira o projétil previsto */
  protected override onEvent(ev: ShooterTypes['Event'], _now: number): void {
    if (ev.type === 'shot' && this.me !== null && ev.slot === this.me) {
      this.shots.shift()
      return
    }
    this.out.push(ev)
  }

  protected override afterEvents(now: number): void {
    this.shots = this.shots.filter((s) => now - s.t0 < PREDICTED_SHOT_TTL_MS)
  }

  protected override selfFrom(snap: Snapshot): SimPlayer | null {
    const np = super.selfFrom(snap)
    if (np) np.id = this.roster.get(np.slot)?.id ?? np.id
    return np
  }

  private idOf(slot: number, bot: boolean): string {
    return this.roster.get(slot)?.id ?? this.statics?.ids[slot] ?? (bot ? `bot-${slot}` : `jogador-${slot}`)
  }

  private map(id: MapId): MapDef {
    if (!this.mapCache || this.mapCache.id !== id) this.mapCache = this.getMap(id)
    return this.mapCache
  }

  // ---------- entrada local ----------

  /**
   * Um tick local: cria a entrada nova, prevê o movimento e o tiro. Devolve as últimas
   * INPUT_REDUNDANCY+1 entradas (a mais antiga primeiro) para mandar ao host, ou null se não joga.
   */
  localTick(now: number, st: InputState): Input[] | null {
    if (this.me === null) return null
    const mag = Math.hypot(st.ax, st.ay)
    const aimOk = mag > 1e-4
    return this.advanceLocal(
      now,
      (seq) => {
        const input = quantizeInput({
          seq,
          mx: st.mx,
          my: st.my,
          ax: aimOk ? st.ax / mag : this.aimX,
          ay: aimOk ? st.ay / mag : this.aimY,
          buttons: st.buttons
        })
        if (aimOk) {
          this.aimX = st.ax / mag
          this.aimY = st.ay / mag
        }
        return input
      },
      (p, input, at) => {
        if (input.buttons & BTN_FIRE) this.predictShot(p, input, at)
      }
    )
  }

  private predictShot(p: SimPlayer, input: Input, now: number): void {
    const spec = WEAPONS[p.weapon]
    if (p.ammo <= 0 || this.predTick < Math.max(p.nextFireTick, this.localNextFire)) return
    this.localNextFire = this.predTick + spec.cooldownTicks
    if (Number.isFinite(p.ammo)) p.ammo -= 1
    const ax = input.ax
    const ay = input.ay
    const ox = p.x + ax * (PLAYER_RADIUS + 3)
    const oy = p.y + ay * (PLAYER_RADIUS + 3)
    const list: RenderProjectile[] = []
    const n = spec.pellets
    for (let k = 0; k < n; k++) {
      const a = n > 1 ? (k / (n - 1) - 0.5) * spec.spread : 0
      const c = Math.cos(a)
      const s = Math.sin(a)
      list.push({
        id: this.nextTempId--,
        owner: p.slot,
        kind: spec.projectile,
        x: ox,
        y: oy,
        vx: (ax * c - ay * s) * spec.speed,
        vy: (ax * s + ay * c) * spec.speed,
        predicted: true
      })
    }
    this.shots.push({ t0: now, list })
    if (this.shots.length > 12) this.shots.shift()
    this.out.push({ type: 'shot', slot: p.slot, weapon: p.weapon, x: ox, y: oy, ax, ay, local: true })
  }

  // ---------- quadro ----------

  /** Quadro para desenhar. `net` e `pingMs` o dono da sessão preenche. */
  frame(now: number, roster?: readonly ShooterPlayerView[]): ShooterFrame | null {
    const w = this.interpolation(now)
    if (!w) return null
    if (roster) this.setRoster(roster)
    const { last, a, b, u, hostNow, renderT, tickNow } = w

    const players: RenderPlayer[] = []
    for (const sp of last.players) {
      if (sp.away) continue
      const isMe = this.me !== null && sp.slot === this.me
      let x = sp.x
      let y = sp.y
      let ax = sp.ax
      let ay = sp.ay
      if (isMe && this.pred) {
        const r = this.renderPos(this.pred, now)
        x = r.x
        y = r.y
        ax = this.aimX
        ay = this.aimY
        if (!this.pred.alive) {
          x = sp.x
          y = sp.y
        }
      } else {
        const pa = a.players.find((p) => p.slot === sp.slot)
        const pb = b.players.find((p) => p.slot === sp.slot)
        const q = pickPair(pa, pb, u)
        if (q) {
          x = q.x
          y = q.y
          ax = q.ax
          ay = q.ay
        }
      }
      const info = this.roster.get(sp.slot)
      players.push({
        slot: sp.slot,
        id: info?.id ?? this.idOf(sp.slot, sp.bot),
        name: info?.name ?? (sp.bot ? `Robô ${sp.slot - 7}` : 'Jogador'),
        bot: sp.bot,
        x,
        y,
        ax,
        ay,
        hp: sp.hp,
        alive: sp.alive,
        weapon: sp.weapon,
        ammo: sp.ammo,
        grenades: sp.grenades,
        dashing: sp.dashUntil > tickNow,
        invulnerable: sp.invulnUntil > tickNow,
        me: isMe,
        kills: sp.kills,
        deaths: sp.deaths
      })
    }

    const projectiles: RenderProjectile[] = []
    for (const pr of last.projectiles) {
      const mine = this.me !== null && pr.owner === this.me
      const t = ((mine ? hostNow : renderT) - last.tick * TICK_MS) / 1000
      const k = Math.max(-0.2, Math.min(0.35, t))
      projectiles.push({ id: pr.id, owner: pr.owner, kind: pr.kind, x: pr.x + pr.vx * k, y: pr.y + pr.vy * k, vx: pr.vx, vy: pr.vy, predicted: false })
    }
    for (const s of this.shots) {
      const age = now - s.t0
      if (age >= PREDICTED_SHOT_TTL_MS) continue
      for (const p of s.list) projectiles.push({ ...p, x: p.x + (p.vx * age) / 1000, y: p.y + (p.vy * age) / 1000 })
    }

    const map = this.map(last.mapId)
    const pickups: RenderPickup[] = last.pickups.map((pk) => pickupView(pk, map, tickNow))

    const timeLeftMs =
      last.phase === 'aquecendo'
        ? Math.max(0, (last.warmupEndTick - tickNow) * TICK_MS)
        : last.phase === 'jogando'
          ? Math.max(0, (last.endTick - tickNow) * TICK_MS)
          : 0

    return {
      mapId: last.mapId,
      phase: last.phase,
      timeLeftMs,
      killLimit: last.killLimit,
      me: this.me,
      players,
      projectiles,
      pickups,
      scores: this.scoresOf(last.players),
      net: 'conectando',
      pingMs: this.pingMs
    }
  }

  scoresOf(players: readonly SnapPlayer[]): ScoreLine[] {
    return players
      .map((p) => ({ id: this.roster.get(p.slot)?.id ?? this.idOf(p.slot, p.bot), kills: p.kills, deaths: p.deaths, damage: p.damage }))
      .sort((x, y) => y.kills - x.kills || x.deaths - y.deaths || y.damage - x.damage)
  }

  /** posição prevista do meu boneco (sem suavização), para testes */
  get predicted(): SimPlayer | null {
    return this.pred
  }

  get pendingCount(): number {
    return this.pending.length
  }
}

function pickPair(pa: SnapPlayer | undefined, pb: SnapPlayer | undefined, u: number) {
  if (pa && pb) {
    // morreu/nasceu ou teletransportou entre os dois: não interpola
    if (pa.alive !== pb.alive || Math.hypot(pb.x - pa.x, pb.y - pa.y) > TELEPORT_PX) return u < 0.5 ? pa : pb
    let ax = pa.ax + (pb.ax - pa.ax) * u
    let ay = pa.ay + (pb.ay - pa.ay) * u
    const l = Math.hypot(ax, ay)
    if (l > 1e-4) {
      ax /= l
      ay /= l
    } else {
      ax = pb.ax
      ay = pb.ay
    }
    return { x: pa.x + (pb.x - pa.x) * u, y: pa.y + (pb.y - pa.y) * u, ax, ay }
  }
  return pb ?? pa
}

function pickupView(pk: SimPickup, map: MapDef, tickNow: number): RenderPickup {
  const def = map.pickups[pk.id]
  const kind = def?.kind ?? pk.kind
  const available = pk.backTick <= tickNow
  const total = PICKUP_RESPAWN_TICKS[kind] || 1
  return {
    id: pk.id,
    kind,
    x: def?.x ?? pk.x,
    y: def?.y ?? pk.y,
    available,
    ready: available ? 1 : Math.max(0, Math.min(1, 1 - (pk.backTick - tickNow) / total))
  }
}
