/**
 * Simulação da Corrida na Sala (60 Hz). Roda no navegador do host (Web Worker); `predictSelf` roda
 * no cliente com a MESMA função de movimento (`drive`). Pura: só `+ - * / sqrt` e
 * `Math.floor/abs/min/max`; nada de relógio ou sorteio.
 *
 * Um tick: (contagem) segura os carros até `goTick`; (correndo) cada carro dirige com a entrada do
 * tick (robô e quem já chegou: piloto automático), depois as batidas entre carros, os portões do
 * traçado (volta, chegada) e o fim (todo mundo de verdade chegou, prazo depois do primeiro ou teto).
 */
import { botInput } from './bots'
import { gridSpot, tileAt, TRACKS, type Track } from './tracks'
import {
  ACCEL,
  BOOST_MAX,
  BOOST_PUSH,
  BOOST_TICKS,
  BRAKE,
  BTN_BRAKE,
  BTN_GAS,
  CAR_R,
  CELL,
  COAST,
  COUNTDOWN_TICKS,
  FINISH_GRACE_TICKS,
  GRIP,
  GRIP_BOOST,
  GRIP_OFFROAD,
  LAP_CAP_TICKS,
  MAX_REVERSE,
  MAX_SPEED,
  OFFROAD_DRAG,
  OFFROAD_MAX,
  REVERSE_ACCEL,
  TICK_MS,
  TURN,
  WALL_BOUNCE,
  type Car,
  type RaceInput,
  type RaceScoreLine,
  type RaceSimEvent,
  type RaceSimOptions,
  type RaceSimPlayerRef,
  type RaceSimState
} from './types'

export const trackOf = (s: Pick<RaceSimState, 'trackId'>): Track => TRACKS[s.trackId]

// ---------------------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------------------

function newCar(t: Track, ref: RaceSimPlayerRef, gridIndex: number): Car {
  const g = gridSpot(t, gridIndex)
  return {
    slot: ref.slot,
    id: ref.id,
    bot: ref.bot,
    away: false,
    x: g.x,
    y: g.y,
    vx: 0,
    vy: 0,
    hx: g.hx,
    hy: g.hy,
    lastSeq: 0,
    lap: 0,
    next: 0,
    finishTick: 0,
    lapStart: 0,
    bestLap: 0,
    boostUntil: 0,
    steer: 0,
    buttons: 0,
    ai: { stuck: 0, reverse: 0 }
  }
}

/** Robôs largam na frente (dá o que ultrapassar); gente de verdade atrás, pela ordem do slot. */
export function createRace(players: readonly RaceSimPlayerRef[], opts: RaceSimOptions): RaceSimState {
  const t = TRACKS[opts.trackId]
  const order = [...players].sort((a, b) => Number(b.bot) - Number(a.bot) || a.slot - b.slot)
  return {
    tick: 0,
    phase: 'contagem',
    trackId: opts.trackId,
    laps: Math.max(1, Math.floor(opts.laps)),
    botLevel: opts.botLevel,
    goTick: COUNTDOWN_TICKS,
    firstFinish: 0,
    endTick: 0,
    cars: order.map((p, i) => newCar(t, p, i)).sort((a, b) => a.slot - b.slot)
  }
}

export function cloneState(s: RaceSimState): RaceSimState {
  return { ...s, cars: s.cars.map((c) => ({ ...c, ai: { ...c.ai } })) }
}

/** Quem entra com a corrida rolando larga do grid (lá atrás); se já estava, só volta. */
export function addPlayer(s: RaceSimState, ref: RaceSimPlayerRef): void {
  if (s.phase === 'fim') return
  const old = s.cars.find((c) => c.slot === ref.slot)
  if (old) {
    old.away = false
    return
  }
  s.cars.push(newCar(trackOf(s), ref, s.cars.length))
  s.cars.sort((a, b) => a.slot - b.slot)
}

export function setAway(s: RaceSimState, slot: number, away: boolean): void {
  const c = s.cars.find((x) => x.slot === slot)
  if (!c) return
  c.away = away
  if (away) {
    c.vx = c.vy = 0
    c.steer = c.buttons = 0
  }
}

// ---------------------------------------------------------------------------------------
// Movimento (o mesmo no host e na predição)
// ---------------------------------------------------------------------------------------

/** o círculo do carro em (x, y) encosta em algum muro? */
export function hitsWall(t: Track, x: number, y: number, r = CAR_R): boolean {
  const i0 = Math.floor((x - r) / CELL)
  const i1 = Math.floor((x + r) / CELL)
  const j0 = Math.floor((y - r) / CELL)
  const j1 = Math.floor((y + r) / CELL)
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const wall = i < 0 || j < 0 || i >= t.w || j >= t.h || t.grid[j * t.w + i] === '#'
      if (!wall) continue
      const qx = Math.max(i * CELL, Math.min(x, (i + 1) * CELL))
      const qy = Math.max(j * CELL, Math.min(y, (j + 1) * CELL))
      const dx = x - qx
      const dy = y - qy
      if (dx * dx + dy * dy < r * r) return true
    }
  }
  return false
}

export interface DriveResult {
  /** força da batida no muro (px/tick), 0 = não bateu */
  wall: number
  /** pegou um turbo agora */
  boost: boolean
}

/**
 * UM tick de direção do carro na pista `t`, no tick `tick`. `maxMul` limita a velocidade máxima
 * (robôs mais fáceis, volta de honra). Muta o carro.
 */
export function drive(t: Track, car: Car, steer: number, buttons: number, tick: number, maxMul = 1): DriveResult {
  const surf = tileAt(t, car.x, car.y)
  const off = surf === ','
  let boost = false
  if (surf === '>') {
    boost = car.boostUntil <= tick
    car.boostUntil = tick + BOOST_TICKS
  }
  const boosting = car.boostUntil > tick
  const s = steer < -1 ? -1 : steer > 1 ? 1 : steer
  const gas = (buttons & BTN_GAS) !== 0
  const brake = (buttons & BTN_BRAKE) !== 0

  // velocidade na direção do carro e de lado
  let vf = car.vx * car.hx + car.vy * car.hy
  let vl = car.vx * -car.hy + car.vy * car.hx
  const max = (boosting ? BOOST_MAX : off ? OFFROAD_MAX : MAX_SPEED) * maxMul
  if (gas && !brake) {
    if (vf < max) vf = Math.min(max, vf + (vf < 0 ? ACCEL * 2.5 : ACCEL))
  } else if (brake && !gas) {
    if (vf > 0.05) vf = Math.max(0, vf - BRAKE)
    else vf = Math.max(-MAX_REVERSE, vf - REVERSE_ACCEL)
  } else {
    vf *= gas ? 0.97 : COAST
  }
  if (boosting) vf = Math.min(BOOST_MAX * maxMul, vf + BOOST_PUSH)
  if (vf > max) vf = off ? Math.max(max, vf * OFFROAD_DRAG) : Math.max(max, vf * 0.985)
  if (vf < -MAX_REVERSE) vf = -MAX_REVERSE

  // volante: gira mais devagar parado e um pouco menos no talo; de ré, inverte
  const sp = vf < 0 ? -vf : vf
  const k = sp < 1.4 ? sp / 1.4 : 1 - (0.2 * (sp - 1.4)) / (BOOST_MAX - 1.4)
  const ang = s * TURN * k * (vf < 0 ? -1 : 1)
  if (ang !== 0) {
    const nx = car.hx - ang * car.hy
    const ny = car.hy + ang * car.hx
    const l = Math.sqrt(nx * nx + ny * ny)
    car.hx = nx / l
    car.hy = ny / l
  }
  vl *= boosting ? GRIP_BOOST : off ? GRIP_OFFROAD : GRIP
  car.vx = car.hx * vf - car.hy * vl
  car.vy = car.hy * vf + car.hx * vl

  // anda um eixo de cada vez; no muro volta um pouco
  let wall = 0
  const nx = car.x + car.vx
  if (hitsWall(t, nx, car.y)) {
    wall = Math.max(wall, car.vx < 0 ? -car.vx : car.vx)
    car.vx = -car.vx * WALL_BOUNCE
    car.vy *= 0.9
  } else car.x = nx
  const ny = car.y + car.vy
  if (hitsWall(t, car.x, ny)) {
    wall = Math.max(wall, car.vy < 0 ? -car.vy : car.vy)
    car.vy = -car.vy * WALL_BOUNCE
    car.vx *= 0.9
  } else car.y = ny
  car.steer = s
  car.buttons = buttons
  return { wall, boost }
}

/** O carro anda neste tick? (contagem segura; quem chegou ou saiu não é previsto) */
const moves = (s: RaceSimState, tick: number): boolean => s.phase !== 'fim' && tick >= s.goTick

/** Predição do cliente: UM tick do meu carro, sem os outros. NÃO avança `s.tick` (o binding ajusta). */
export function predictSelf(s: RaceSimState, slot: number, input: RaceInput): void {
  const car = s.cars.find((c) => c.slot === slot)
  const tick = s.tick + 1
  if (!car || car.away || car.finishTick > 0 || !moves(s, tick)) return
  drive(trackOf(s), car, input.steer, input.buttons, tick)
  car.lastSeq = input.seq
}

// ---------------------------------------------------------------------------------------
// Traçado, voltas e posições
// ---------------------------------------------------------------------------------------

/** quanto o carro já andou na corrida (voltas * pontos + fração), para as posições */
export function progress(s: RaceSimState, car: Car): number {
  const t = trackOf(s)
  const n = t.wps.length
  if (car.lap === 0) {
    const w = t.wps[0]!
    return ((car.x - w.x) * w.dx + (car.y - w.y) * w.dy) / 10000
  }
  const prev = (car.next - 1 + n) % n
  const a = t.wps[prev]!
  const b = t.wps[car.next]!
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  let f = l2 > 0 ? ((car.x - a.x) * dx + (car.y - a.y) * dy) / l2 : 0
  f = f < 0 ? 0 : f > 1 ? 1 : f
  return car.lap * n + prev + f
}

/** Ordem da corrida: quem chegou (pela chegada), depois quem andou mais, depois o slot. */
export function standings(s: RaceSimState): Car[] {
  const prog = new Map(s.cars.map((c) => [c.slot, progress(s, c)]))
  return [...s.cars].sort((a, b) => {
    const fa = a.finishTick > 0
    const fb = b.finishTick > 0
    if (fa !== fb) return fa ? -1 : 1
    if (fa && fb && a.finishTick !== b.finishTick) return a.finishTick - b.finishTick
    if (!fa) {
      const d = prog.get(b.slot)! - prog.get(a.slot)!
      if (d !== 0) return d
    }
    return a.slot - b.slot
  })
}

function gates(s: RaceSimState, t: Track, car: Car, tick: number, events: RaceSimEvent[]): void {
  const n = t.wps.length
  for (let guard = 0; guard < 3; guard++) {
    const w = t.wps[car.next]!
    const ox = car.x - w.x
    const oy = car.y - w.y
    const along = ox * w.dx + oy * w.dy
    if (along < 0 || along > 64) return
    const perp = ox * -w.dy + oy * w.dx
    if (perp < -t.gate || perp > t.gate) return
    if (car.next === 0) {
      if (car.lap === 0) {
        car.lap = 1
        car.lapStart = tick
      } else {
        const lapTicks = tick - car.lapStart
        const best = car.bestLap === 0 || lapTicks < car.bestLap
        if (best) car.bestLap = lapTicks
        if (car.lap >= s.laps) {
          car.finishTick = tick
          car.lap = s.laps + 1
          if (s.firstFinish === 0) s.firstFinish = tick
          const place = s.cars.filter((c) => c.finishTick > 0).length
          events.push({ type: 'chegada', slot: car.slot, place, ticks: tick - s.goTick })
        } else {
          car.lap++
          car.lapStart = tick
          events.push({ type: 'volta', slot: car.slot, lap: car.lap, ticks: lapTicks, best })
        }
      }
    }
    car.next = (car.next + 1) % n
  }
}

function bumps(t: Track, cars: Car[], events: RaceSimEvent[]): void {
  const d0 = CAR_R * 2
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i]!
    if (a.away) continue
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j]!
      if (b.away) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d2 = dx * dx + dy * dy
      if (d2 >= d0 * d0 || d2 < 1e-6) continue
      const d = Math.sqrt(d2)
      const nx = dx / d
      const ny = dy / d
      const push = (d0 - d) / 2
      if (!hitsWall(t, a.x - nx * push, a.y - ny * push)) {
        a.x -= nx * push
        a.y -= ny * push
      }
      if (!hitsWall(t, b.x + nx * push, b.y + ny * push)) {
        b.x += nx * push
        b.y += ny * push
      }
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      if (rv < 0) {
        const imp = -0.75 * rv
        a.vx -= imp * nx
        a.vy -= imp * ny
        b.vx += imp * nx
        b.vy += imp * ny
        if (rv < -1) events.push({ type: 'toque', a: a.slot, b: b.slot })
      }
    }
  }
}

/** todo mundo de verdade (presente) já chegou, ou todos os carros chegaram */
function allDone(s: RaceSimState): boolean {
  const racing = s.cars.filter((c) => !c.away)
  if (racing.length > 0 && racing.every((c) => c.finishTick > 0)) return true
  const humans = racing.filter((c) => !c.bot)
  return humans.length > 0 && humans.every((c) => c.finishTick > 0)
}

// ---------------------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------------------

/** UM tick. MUTA o estado. `inputs` = entrada deste tick por slot (faltou = repete a última). */
export function step(s: RaceSimState, inputs: ReadonlyMap<number, RaceInput>): RaceSimEvent[] {
  const events: RaceSimEvent[] = []
  if (s.phase === 'fim') return events
  const tick = s.tick + 1
  const t = trackOf(s)
  if (s.phase === 'contagem' && tick >= s.goTick) {
    s.phase = 'correndo'
    events.push({ type: 'go' })
  }
  if (s.phase === 'correndo') {
    for (const car of s.cars) {
      const input = inputs.get(car.slot)
      if (input && !car.bot) car.lastSeq = Math.max(car.lastSeq, input.seq)
      if (car.away) continue
      let steer = car.steer
      let buttons = car.buttons
      let mul = 1
      if (car.bot || car.finishTick > 0) {
        const b = botInput(s, t, car)
        steer = b.steer
        buttons = b.buttons
        mul = car.finishTick > 0 ? 0.6 : b.maxMul
      } else if (input) {
        steer = input.steer
        buttons = input.buttons
      }
      const r = drive(t, car, steer, buttons, tick, mul)
      if (r.boost) events.push({ type: 'turbo', slot: car.slot })
      if (r.wall > 1.2) events.push({ type: 'batida', slot: car.slot, force: r.wall > 3 ? 3 : r.wall > 2 ? 2 : 1 })
    }
    bumps(t, s.cars, events)
    for (const car of s.cars) if (!car.away && car.finishTick === 0) gates(s, t, car, tick, events)

    const capped = tick >= s.goTick + s.laps * LAP_CAP_TICKS
    const grace = s.firstFinish > 0 && tick >= s.firstFinish + FINISH_GRACE_TICKS
    if (allDone(s) || grace || capped) {
      s.phase = 'fim'
      s.endTick = tick
      events.push({ type: 'fim' })
    }
  } else {
    // na contagem a entrada só confirma a seq
    for (const car of s.cars) {
      const input = inputs.get(car.slot)
      if (input && !car.bot) car.lastSeq = Math.max(car.lastSeq, input.seq)
    }
  }
  s.tick = tick
  return events
}

// ---------------------------------------------------------------------------------------
// Placar
// ---------------------------------------------------------------------------------------

const ms = (ticks: number): number => Math.round(ticks * TICK_MS)

function lineOf(s: RaceSimState, car: Car, finished: readonly Car[]): RaceScoreLine {
  const place = car.finishTick > 0 ? finished.indexOf(car) + 1 : 0
  return {
    id: car.id,
    place,
    laps: car.finishTick > 0 ? s.laps : Math.max(0, car.lap - 1),
    timeMs: car.finishTick > 0 ? ms(car.finishTick - s.goTick) : 0,
    bestLapMs: ms(car.bestLap)
  }
}

const finishedOf = (s: RaceSimState): Car[] => s.cars.filter((c) => c.finishTick > 0).sort((a, b) => a.finishTick - b.finishTick || a.slot - b.slot)

export function scores(s: RaceSimState): RaceScoreLine[] {
  const fin = finishedOf(s)
  return s.cars.map((c) => lineOf(s, c, fin))
}

export function ranking(s: RaceSimState): RaceScoreLine[] {
  const fin = finishedOf(s)
  return standings(s).map((c) => lineOf(s, c, fin))
}

export const raceSim = { create: createRace, step, cloneState, addPlayer, setAway, predictSelf, scores, ranking, standings, progress }
