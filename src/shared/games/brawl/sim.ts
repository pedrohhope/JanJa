/**
 * Simulação da Briga na Sala (60 Hz, autoritativa no host). Determinística: só + - * / sqrt e
 * Math.floor/round/abs/min/max/sign; o único acaso é o mulberry32 em `state.rng`.
 *
 * Ordem de um tick (`step`):
 *  1. fases (contagem -> jogando, fim do tempo), renascimentos, queda de armas;
 *  2. cada lutador: entrada, ações (esquiva, pulo, golpe, pegar/arremessar), andamento do golpe e
 *     movimento + colisão (tudo em `updateFighter`, a MESMA função da predição `predictSelf`);
 *  3. acertos corpo a corpo (hitbox x hurtbox, com compensação de atraso), projéteis, armas, poças;
 *  4. nocautes, fim da partida, histórico de posições, `tick++`.
 *
 * Convenções do tick: `moveTick` = ticks do golpe já corridos; o acerto do tick usa `moveTick - 1`
 * (o índice do tick que acabou de rodar). Hit-stop congela o lutador inteiro (nem os botões
 * pressionados nesse intervalo se perdem: a borda de subida só é consumida quando ele descongela).
 */
import { CHARACTERS, TUNING } from './characters'
import { ARENAS } from './arenas'
import { botInput } from './bots'
import { MOVES, THROWN, moveFor } from './moves'
import { rngInt } from './rng'
import {
  BTN_DODGE,
  BTN_HEAVY,
  BTN_JUMP,
  BTN_LIGHT,
  BTN_MASK,
  BTN_PICK,
  CHARGE_BONUS,
  CHARGE_MAX_TICKS,
  COUNTDOWN_TICKS,
  DODGE_COOLDOWN_TICKS,
  DODGE_SPEED,
  DODGE_TICKS,
  EMPTY_BRAWL_INPUT,
  GRAVITY,
  HITSTOP_MAX,
  HITSTOP_MIN,
  HITSTOP_PER_DMG,
  HITSTUN_PER_KB,
  KB_DECAY,
  LAG_HISTORY_TICKS,
  MAX_DAMAGE,
  MAX_JUMPS,
  RESPAWN_INVULN_TICKS,
  RESPAWN_TICKS,
  THIN_SNAP,
  TICK_HZ,
  WALL_CLING_MAX_TICKS,
  WALL_SLIDE_SPEED,
  WEAPON_IDS,
  type ArenaDef,
  type BrawlInput,
  type BrawlScoreLine,
  type BrawlSimApi,
  type BrawlSimEvent,
  type BrawlSimOptions,
  type BrawlSimPhase,
  type BrawlSimPlayerRef,
  type BrawlSimState,
  type Fighter,
  type FighterAction,
  type Hitbox,
  type MoveData,
  type ProjectileSpec,
  type WeaponId
} from './types'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const ceil = (v: number): number => -Math.floor(-v)
const dz = (v: number): number => (v > -TUNING.deadzone && v < TUNING.deadzone ? 0 : v)
const NO_HIT_ID = -1

/** efeitos colaterais (eventos, projéteis, poças, armas): só o `step` os tem; a predição passa null */
interface Fx {
  events: BrawlSimEvent[]
}

// =====================================================================================
// Criação
// =====================================================================================

function newFighter(ref: BrawlSimPlayerRef, arena: ArenaDef, stocks: number): Fighter {
  const sp = arena.spawns[ref.slot % arena.spawns.length]
  const hist: number[] = []
  for (let i = 0; i < LAG_HISTORY_TICKS; i++) hist.push(sp.x, sp.y)
  return {
    slot: ref.slot,
    id: ref.id,
    bot: ref.bot,
    away: false,
    char: ref.char,
    team: ref.team,
    x: sp.x,
    y: sp.y,
    vx: 0,
    vy: 0,
    facing: sp.x < (arena.dropX[0] + arena.dropX[1]) / 2 ? 1 : -1,
    grounded: true,
    onThin: -1,
    fastFall: false,
    action: 'parado',
    actionTick: 0,
    jumpsLeft: MAX_JUMPS,
    recoveryUsed: false,
    airDodgeUsed: false,
    dodgeReadyTick: 0,
    move: null,
    moveTick: 0,
    charge: 0,
    hitSlots: [],
    hitstunUntil: 0,
    freezeUntil: 0,
    invulnUntil: 0,
    damage: 0,
    stocks,
    held: 'mao',
    wallSide: 0,
    wallTicks: 0,
    lastHitBy: NO_HIT_ID,
    lastHitTick: 0,
    respawnTick: 0,
    outTick: 0,
    kos: 0,
    falls: 0,
    dealt: 0,
    prevButtons: 0,
    lastSeq: 0,
    hist
  }
}

function create(players: BrawlSimPlayerRef[], opts: BrawlSimOptions, seed: number): BrawlSimState {
  const arena = ARENAS[opts.arenaId]
  const tempo = opts.mode === 'tempo'
  const state: BrawlSimState = {
    arenaId: opts.arenaId,
    mode: opts.mode,
    teamSize: opts.teamSize,
    friendlyFire: opts.friendlyFire,
    botLevel: opts.botLevel,
    tick: 0,
    phase: 'contagem',
    goTick: COUNTDOWN_TICKS,
    endTick: tempo ? COUNTDOWN_TICKS + opts.minutes * 60 * TICK_HZ : 0,
    rng: seed >>> 0,
    nextId: 1,
    nextDropTick: 0,
    fighters: [],
    items: [],
    projectiles: [],
    puddles: []
  }
  for (const ref of [...players].sort((a, b) => a.slot - b.slot)) state.fighters.push(newFighter(ref, arena, tempo ? 0 : opts.stocks))
  state.nextDropTick = state.goTick + nextDropDelay(state)
  return state
}

const nextDropDelay = (st: BrawlSimState): number => TUNING.dropMinTicks + rngInt(st, TUNING.dropSpanTicks)

function addPlayer(state: BrawlSimState, ref: BrawlSimPlayerRef): void {
  const arena = ARENAS[state.arenaId]
  const old = state.fighters.find((f) => f.slot === ref.slot)
  if (old) {
    // mesmo slot voltando: reativa (a vez de renascer é a de setAway)
    old.id = ref.id
    old.bot = ref.bot
    if (old.away) setAway(state, ref.slot, false)
    return
  }
  const vidas = state.mode === 'vidas'
  const f = newFighter(ref, arena, 0)
  if (state.phase === 'contagem') {
    f.stocks = vidas ? state.fighters.reduce((m, o) => Math.max(m, o.stocks), 3) : 0
  } else if (vidas || state.phase === 'morte-subita') {
    // modo vidas: assiste até a próxima partida
    f.action = 'eliminado'
    f.outTick = state.tick
    f.grounded = false
  } else {
    // modo tempo: entra renascendo
    f.action = 'fora'
    f.respawnTick = state.tick + 30
    f.x = arena.respawn.x
    f.y = arena.respawn.y
  }
  state.fighters.push(f)
  state.fighters.sort((a, b) => a.slot - b.slot)
}

function setAway(state: BrawlSimState, slot: number, away: boolean): void {
  const f = state.fighters.find((o) => o.slot === slot)
  if (!f || f.away === away) return
  f.away = away
  f.prevButtons = 0
  f.lastInput = undefined
  if (away) {
    // sai de cena: não luta, não é alvo, não conta para o fim da partida
    f.move = null
    f.charge = 0
    f.hitSlots = []
    return
  }
  if (f.action !== 'eliminado') {
    // volta renascendo
    const arena = ARENAS[state.arenaId]
    f.action = 'fora'
    f.respawnTick = state.tick + 30
    f.x = arena.respawn.x
    f.y = arena.respawn.y
    f.vx = 0
    f.vy = 0
  }
}

function cloneFighter(f: Fighter): Fighter {
  const c: Fighter = { ...f, hitSlots: f.hitSlots.slice(), hist: f.hist.slice() }
  if (f.lastInput) c.lastInput = { ...f.lastInput }
  if (f.ai) c.ai = { ...f.ai }
  return c
}

function cloneState(s: BrawlSimState): BrawlSimState {
  return {
    ...s,
    fighters: s.fighters.map(cloneFighter),
    items: s.items.map((i) => ({ ...i })),
    projectiles: s.projectiles.map((p) => ({ ...p, hit: { ...p.hit }, hitSlots: p.hitSlots.slice() })),
    puddles: s.puddles.map((p) => ({ ...p }))
  }
}

// =====================================================================================
// Placar
// =====================================================================================

function scores(state: BrawlSimState): BrawlScoreLine[] {
  return state.fighters.map(line)
}

function sortedFighters(state: BrawlSimState): Fighter[] {
  const fs = [...state.fighters]
  if (state.mode === 'vidas') {
    // quem sobrou (mais vidas primeiro), depois quem saiu por último
    fs.sort((a, b) => {
      const sa = a.outTick === 0 ? Infinity : a.outTick
      const sb = b.outTick === 0 ? Infinity : b.outTick
      if (sa !== sb) return sb > sa ? 1 : -1
      return b.stocks - a.stocks || b.kos - a.kos || b.dealt - a.dealt || a.slot - b.slot
    })
  } else {
    fs.sort((a, b) => b.kos - b.falls - (a.kos - a.falls) || b.kos - a.kos || b.dealt - a.dealt || a.slot - b.slot)
  }
  return fs
}

function ranking(state: BrawlSimState): BrawlScoreLine[] {
  return sortedFighters(state).map(line)
}

const line = (f: Fighter): BrawlScoreLine => ({ id: f.id, char: f.char, team: f.team, kos: f.kos, falls: f.falls, damage: f.dealt, stocks: f.stocks, outTick: f.outTick })

// =====================================================================================
// Utilidades de estado
// =====================================================================================

const isAlive = (f: Fighter): boolean => !f.away && f.action !== 'eliminado'
const onField = (f: Fighter): boolean => !f.away && f.action !== 'fora' && f.action !== 'eliminado'
const teamKey = (st: BrawlSimState, f: Fighter): number => (st.teamSize > 0 ? f.team : f.slot)
const sameTeam = (st: BrawlSimState, a: Fighter, b: Fighter): boolean => st.teamSize > 0 && a.team === b.team
const canHit = (st: BrawlSimState, a: Fighter, v: Fighter): boolean => {
  if (a === v || !onField(v) || st.tick < v.invulnUntil) return false
  if (v.lastHitTick === st.tick && v.lastHitBy !== NO_HIT_ID) return false // já levou um golpe neste tick
  return st.friendlyFire || !sameTeam(st, a, v)
}

function sanitize(raw: BrawlInput, lastSeq: number): BrawlInput {
  const f = (v: number): number => (Number.isFinite(v) ? clamp(v, -1, 1) : 0)
  const out: BrawlInput = { seq: Number.isFinite(raw.seq) ? Math.max(0, Math.floor(raw.seq)) : lastSeq, mx: f(raw.mx), my: f(raw.my), buttons: (raw.buttons | 0) & BTN_MASK }
  if (raw.lagTicks !== undefined && Number.isFinite(raw.lagTicks)) out.lagTicks = clamp(Math.round(raw.lagTicks), 0, 6)
  return out
}

function onPuddleAt(st: BrawlSimState, f: Fighter): boolean {
  for (const p of st.puddles) if (Math.abs(f.y - p.y) < 2 && Math.abs(f.x - p.x) <= p.w / 2) return true
  return false
}

function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step)
  if (v > target) return Math.max(target, v - step)
  return v
}

// =====================================================================================
// Movimento e colisão (compartilhado com a predição)
// =====================================================================================

interface Contact {
  wall: -1 | 0 | 1
  landVy: number
}

function moveBody(f: Fighter, arena: ArenaDef, ignoreThin: boolean): Contact {
  const spec = CHARACTERS[f.char]
  const hw = spec.hurtW / 2
  const h = spec.hurtH
  f.grounded = false
  f.onThin = -1
  let wall: -1 | 0 | 1 = 0
  let landVy = 0
  f.vx = clamp(f.vx, -TUNING.maxSpeed, TUNING.maxSpeed)
  f.vy = clamp(f.vy, -TUNING.maxSpeed, TUNING.maxSpeed)
  const n = clamp(ceil(Math.max(Math.abs(f.vx), Math.abs(f.vy)) / 4), 1, 8)
  const sx = f.vx / n
  let sy = f.vy / n
  const plats = arena.platforms
  for (let i = 0; i < n; i++) {
    // horizontal: só plataformas sólidas
    if (sx !== 0) {
      f.x += sx
      for (const p of plats) {
        if (p.thin) continue
        if (f.y > p.y && f.y - h < p.y + p.h && f.x + hw > p.x && f.x - hw < p.x + p.w) {
          if (sx > 0) {
            f.x = p.x - hw
            wall = 1
          } else {
            f.x = p.x + p.w + hw
            wall = -1
          }
          f.vx = 0
        }
      }
    }
    // vertical
    if (sy !== 0 || i === 0) {
      const prevY = f.y
      f.y += sy
      for (let k = 0; k < plats.length; k++) {
        const p = plats[k]
        if (!(f.x + hw > p.x && f.x - hw < p.x + p.w)) continue
        if (p.thin) {
          if (sy >= 0 && !ignoreThin && prevY <= p.y + THIN_SNAP && f.y >= p.y) {
            f.y = p.y
            if (f.vy > 0) landVy = f.vy
            f.vy = 0
            sy = 0
            f.grounded = true
            f.onThin = k
          }
        } else if (f.y > p.y && f.y - h < p.y + p.h) {
          if (sy >= 0) {
            f.y = p.y
            if (f.vy > 0) landVy = f.vy
            f.vy = 0
            sy = 0
            f.grounded = true
          } else {
            f.y = p.y + p.h + h
            f.vy = 0
            sy = 0
          }
        }
      }
    }
  }
  // quem terminou o tick em cima de algo continua "no chão" mesmo sem velocidade vertical
  return { wall, landVy }
}

function airControl(f: Fighter, mx: number): void {
  const spec = CHARACTERS[f.char]
  if (mx === 0) {
    f.vx *= TUNING.airDrag
    return
  }
  const s = mx > 0 ? 1 : -1
  if (f.vx * s < spec.airMax) f.vx = s > 0 ? Math.min(spec.airMax, f.vx + spec.airAccel) : Math.max(-spec.airMax, f.vx - spec.airAccel)
  else f.vx *= TUNING.airDrag
}

function endMove(f: Fighter): void {
  f.move = null
  f.moveTick = 0
  f.charge = 0
  f.hitSlots = []
}

function spawnProjectile(st: BrawlSimState, f: Fighter, spec: ProjectileSpec, k: number, weapon?: WeaponId): void {
  const hit = k === spec.count - 1 && spec.lastHit ? spec.lastHit : spec.hit
  st.projectiles.push({
    id: st.nextId++,
    owner: f.slot,
    kind: spec.kind,
    x: f.x + spec.x * f.facing,
    y: f.y + spec.y,
    vx: spec.vx * f.facing,
    vy: spec.vy,
    w: spec.w,
    h: spec.h,
    facing: f.facing,
    hit: { ...hit },
    pierce: spec.pierce,
    hitSlots: [],
    dieTick: st.tick + spec.lifeTicks,
    ...(weapon ? { weapon } : {})
  })
}

function addPuddle(st: BrawlSimState, f: Fighter, w: number, ticks: number): void {
  for (const p of st.puddles) {
    if (p.owner === f.slot && Math.abs(p.x - f.x) < w / 2 && Math.abs(p.y - f.y) < 2) {
      p.dieTick = Math.max(p.dieTick, st.tick + ticks)
      return
    }
  }
  st.puddles.push({ id: st.nextId++, owner: f.slot, x: f.x, y: f.y, w, dieTick: st.tick + ticks })
  while (st.puddles.length > TUNING.maxPuddles) st.puddles.shift()
}

/** Pega a arma mais próxima no chão (se desarmado) ou arremessa a que está na mão. */
function pickOrThrow(st: BrawlSimState, f: Fighter, fx: Fx): void {
  const spec = CHARACTERS[f.char]
  if (f.held !== 'mao') {
    const weapon = f.held
    f.held = 'mao'
    spawnProjectile(st, f, THROWN[weapon], 0, weapon)
    fx.events.push({ type: 'throw', slot: f.slot, weapon })
    return
  }
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < st.items.length; i++) {
    const it = st.items[i]
    if (it.state !== 'chao') continue
    const dx = Math.abs(it.x - f.x)
    if (dx > TUNING.pickupReach + spec.hurtW / 2 || it.y < f.y - spec.hurtH - 4 || it.y > f.y + 6) continue
    if (dx < bestD) {
      bestD = dx
      best = i
    }
  }
  if (best < 0) return
  const it = st.items[best]
  st.items.splice(best, 1)
  f.held = it.weapon
  fx.events.push({ type: 'pickup', slot: f.slot, weapon: it.weapon })
}

function startMove(f: Fighter, pressed: number, mx: number, my: number): void {
  let m: MoveData
  if (f.grounded) {
    const dir = my > 0 ? 'baixo' : mx !== 0 ? 'lado' : 'neutro'
    m = moveFor(f.char, f.held, (pressed & BTN_LIGHT) !== 0 ? 'leve' : 'forte', dir)
    if (mx !== 0) f.facing = mx > 0 ? 1 : -1
  } else {
    const dir = my < 0 ? 'cima' : my > 0 ? 'baixo' : mx !== 0 ? 'lado' : 'neutro'
    m = moveFor(f.char, f.held, 'ar', dir)
    if (m.recovery_move && f.recoveryUsed) m = moveFor(f.char, f.held, 'ar', 'neutro')
    if (dir === 'lado') f.facing = mx > 0 ? 1 : -1
  }
  if (m.recovery_move) f.recoveryUsed = true
  f.move = m.id
  f.moveTick = 0
  f.charge = 0
  f.hitSlots = []
  f.wallSide = 0
}

/** Andamento do golpe no tick: carregar, sair, projéteis, poças. */
function advanceMove(st: BrawlSimState, f: Fighter, inp: BrawlInput, fx: Fx | null): void {
  const m = f.move ? MOVES[f.move] : undefined
  if (!m) {
    endMove(f)
    return
  }
  if (f.moveTick === 0) {
    if (m.chargeable && (inp.buttons & BTN_HEAVY) !== 0 && f.charge < CHARGE_MAX_TICKS) {
      f.charge++
      return
    }
    if (fx) fx.events.push({ type: 'attack', slot: f.slot, move: m.id, charge: f.charge })
    if (m.selfVx !== undefined) f.vx = m.selfVx * f.facing
    if (m.selfVy !== undefined && m.selfVy < 0) {
      f.vy = m.selfVy
      f.fastFall = false
    }
  }
  const t = f.moveTick
  if (fx) {
    const p = m.projectile
    if (p) for (let k = 0; k < p.count; k++) if (t === m.startup + k * p.gapTicks) spawnProjectile(st, f, p, k)
    if (m.puddle && f.grounded && t >= m.startup && t < m.startup + m.active && (t - m.startup) % TUNING.puddleEvery === 0) addPuddle(st, f, m.puddle.w, m.puddle.ticks)
  }
  if (m.selfVy !== undefined && m.selfVy > 0 && t < m.startup + m.active) f.vy = Math.max(f.vy, m.selfVy)
  f.moveTick = t + 1
  if (f.moveTick >= m.startup + m.active + m.recovery) endMove(f)
}

/**
 * Um tick de um lutador: ações, golpe, movimento, colisão. É a função que `predictSelf` reutiliza
 * (com `fx` = null: sem eventos, projéteis, poças nem armas). Não toca no rng.
 */
function updateFighter(st: BrawlSimState, f: Fighter, inp: BrawlInput, fx: Fx | null): void {
  const tick = st.tick
  if (f.away || f.action === 'fora' || f.action === 'eliminado') return
  if (tick < f.freezeUntil) return // hit-stop
  const spec = CHARACTERS[f.char]
  const arena = ARENAS[st.arenaId]
  const mx = dz(inp.mx)
  const my = dz(inp.my)
  const pressed = inp.buttons & ~f.prevButtons
  f.prevButtons = inp.buttons

  const stunned = tick < f.hitstunUntil
  let dodging = f.action === 'esquiva' && tick - f.actionTick < DODGE_TICKS
  if (f.action === 'esquiva' && !dodging) {
    f.vx *= TUNING.dodgeExit
    if (!f.grounded) f.vy *= 0.5
  }
  const wasGrounded = f.grounded
  let jumped = false

  // ---- ações novas (só quem está livre)
  if (!stunned && !dodging && f.move === null) {
    if ((pressed & BTN_DODGE) !== 0 && tick >= f.dodgeReadyTick && (f.grounded || !f.airDodgeUsed)) {
      f.action = 'esquiva'
      f.actionTick = tick
      f.invulnUntil = Math.max(f.invulnUntil, tick + DODGE_TICKS)
      f.dodgeReadyTick = tick + DODGE_COOLDOWN_TICKS
      if (!f.grounded) f.airDodgeUsed = true
      f.wallSide = 0
      f.fastFall = false
      const k = mx !== 0 && my !== 0 ? 0.75 : 1
      f.vx = mx === 0 ? 0 : Math.sign(mx) * DODGE_SPEED * k
      f.vy = f.grounded || my === 0 ? 0 : Math.sign(my) * DODGE_SPEED * k
      if (mx !== 0) f.facing = mx > 0 ? 1 : -1
      dodging = true
      fx?.events.push({ type: 'dodge', slot: f.slot })
    } else {
      if ((pressed & BTN_JUMP) !== 0) {
        if (f.wallSide !== 0 && f.jumpsLeft > 0) {
          const away = -f.wallSide
          f.vx = away * spec.airMax * TUNING.wallJumpPush
          f.vy = -spec.airJumpVel
          f.jumpsLeft--
          f.facing = away as 1 | -1
          f.wallSide = 0
          f.fastFall = false
          jumped = true
          fx?.events.push({ type: 'jump', slot: f.slot, air: true })
        } else if (f.grounded) {
          f.vy = -spec.jumpVel
          f.jumpsLeft = MAX_JUMPS - 1
          f.grounded = false
          jumped = true
          fx?.events.push({ type: 'jump', slot: f.slot, air: false })
        } else if (f.jumpsLeft > 0) {
          f.vy = -spec.airJumpVel
          f.jumpsLeft--
          f.fastFall = false
          jumped = true
          fx?.events.push({ type: 'jump', slot: f.slot, air: true })
        }
      }
      if ((pressed & (BTN_LIGHT | BTN_HEAVY)) !== 0) startMove(f, pressed, mx, my)
      else if (fx && (pressed & BTN_PICK) !== 0) pickOrThrow(st, f, fx)
    }
  }

  // ---- golpe em andamento
  if (f.move !== null) advanceMove(st, f, inp, fx)
  const m = f.move ? MOVES[f.move] : null

  // ---- velocidade horizontal
  const puddle = f.grounded && onPuddleAt(st, f)
  const acc = TUNING.groundAccel * (puddle ? TUNING.puddleGrip : 1)
  const fric = TUNING.groundFriction * (puddle ? TUNING.puddleGrip : 1)
  const clinging = f.wallSide !== 0 && m === null && !stunned && !dodging
  if (stunned) {
    f.vx *= KB_DECAY
    f.vy *= KB_DECAY
  } else if (dodging) {
    // velocidade constante
  } else if (clinging) {
    f.vx = f.wallSide * TUNING.wallPress
  } else if (m) {
    const lunge = m.selfVx !== undefined && f.moveTick >= 1 && f.moveTick <= m.startup + m.active
    if (lunge) f.vx = (m.selfVx as number) * f.facing
    else if (f.grounded) f.vx = approach(f.vx, 0, fric)
    else airControl(f, mx)
  } else if (f.grounded) {
    if (mx !== 0) {
      f.facing = mx > 0 ? 1 : -1
      f.vx = approach(f.vx, Math.sign(mx) * spec.runSpeed, acc)
    } else f.vx = approach(f.vx, 0, fric)
  } else {
    if (mx !== 0) f.facing = mx > 0 ? 1 : -1
    airControl(f, mx)
  }

  // ---- gravidade
  if (!(dodging && !f.grounded)) f.vy += GRAVITY * spec.gravityMul
  const diving = m !== null && m.selfVy !== undefined && m.selfVy > 0
  if (!stunned && !dodging && !f.grounded && my > 0 && f.vy >= 0 && !clinging) f.fastFall = true
  if (!stunned && !dodging && !diving) {
    if (f.fastFall && !f.grounded) f.vy = Math.max(f.vy, spec.fastFallMax)
    const cap = f.fastFall ? spec.fastFallMax : spec.fallMax
    if (f.vy > cap) f.vy = cap
  }
  if (clinging && f.vy > WALL_SLIDE_SPEED) f.vy = WALL_SLIDE_SPEED

  // ---- colisão
  const ignoreThin = my > 0 && !stunned && !dodging && f.move === null
  const vxBefore = f.vx
  const col = moveBody(f, arena, ignoreThin)
  if (stunned) {
    // voando: quica na parede e no chão (senão dá para prender alguém num canto para sempre)
    if (col.wall !== 0 && Math.abs(vxBefore) > 1.5) f.vx = -vxBefore * TUNING.bounce
    if (col.landVy > 4) {
      f.vy = -col.landVy * TUNING.bounce
      f.grounded = false
    }
  }

  if (f.grounded) {
    if (!wasGrounded && col.landVy > 0) fx?.events.push({ type: 'land', slot: f.slot, hard: col.landVy > TUNING.hardLanding })
    f.jumpsLeft = MAX_JUMPS
    f.recoveryUsed = false
    f.airDodgeUsed = false
    f.fastFall = false
    f.wallTicks = 0
    f.wallSide = 0
  } else {
    if (wasGrounded && !jumped) f.jumpsLeft = Math.min(f.jumpsLeft, MAX_JUMPS - 1)
    const canCling = !stunned && !dodging && f.move === null
    if (canCling && col.wall !== 0 && mx !== 0 && Math.sign(mx) === col.wall && f.wallTicks < WALL_CLING_MAX_TICKS) {
      if (f.wallSide === 0) {
        if (f.wallTicks === 0) f.jumpsLeft = Math.min(MAX_JUMPS - 1, f.jumpsLeft + 1)
        f.recoveryUsed = false
        f.airDodgeUsed = false
        f.fastFall = false
        fx?.events.push({ type: 'wall', slot: f.slot })
      }
      f.wallSide = col.wall
      f.wallTicks++
      f.facing = col.wall
      if (f.vy > WALL_SLIDE_SPEED) f.vy = WALL_SLIDE_SPEED
    } else f.wallSide = 0
  }

  // ---- rótulo da ação
  let next: FighterAction
  if (stunned) next = 'atordoado'
  else if (dodging) next = 'esquiva'
  else if (f.move !== null) next = 'golpe'
  else if (f.wallSide !== 0) next = 'parede'
  else if (f.grounded) next = mx !== 0 || Math.abs(f.vx) > 0.4 ? 'correndo' : 'parado'
  else next = 'no-ar'
  if (next !== f.action) {
    f.action = next
    f.actionTick = tick
  }
}

// =====================================================================================
// Acertos
// =====================================================================================

function applyHit(
  st: BrawlSimState,
  fx: Fx,
  attacker: Fighter | null,
  attackerSlot: number,
  v: Fighter,
  hit: Omit<Hitbox, 'x' | 'y' | 'w' | 'h'>,
  facing: 1 | -1,
  charge: number,
  moveId: string,
  px: number,
  py: number
): number {
  const tick = st.tick
  const mul = 1 + CHARGE_BONUS * (charge / CHARGE_MAX_TICKS)
  const dmg = Math.max(1, Math.round(hit.damage * mul))
  v.damage = Math.min(MAX_DAMAGE, v.damage + dmg)
  const kb = (hit.baseKb + (v.damage * hit.kbGrowth) / 100) * mul * CHARACTERS[v.char].kbMul
  const hs = Math.round(clamp(HITSTOP_MIN + dmg * HITSTOP_PER_DMG, HITSTOP_MIN, HITSTOP_MAX))
  v.vx = hit.dx * facing * kb
  v.vy = hit.dy * kb
  v.hitstunUntil = tick + hs + Math.floor(kb * HITSTUN_PER_KB)
  v.freezeUntil = tick + hs
  v.move = null
  v.moveTick = 0
  v.charge = 0
  v.hitSlots = []
  v.action = 'atordoado'
  v.actionTick = tick
  v.grounded = false
  v.wallSide = 0
  v.fastFall = false
  v.recoveryUsed = false
  v.lastHitBy = attackerSlot
  v.lastHitTick = tick
  if (attacker) {
    attacker.dealt += dmg
    attacker.freezeUntil = Math.max(attacker.freezeUntil, tick + hs)
  } else {
    const o = st.fighters.find((f) => f.slot === attackerSlot)
    if (o) o.dealt += dmg
  }
  const strength = kb < 5 ? 0 : kb < 9 ? 1 : kb < 14 ? 2 : 3
  fx.events.push({ type: 'hit', attacker: attackerSlot, victim: v.slot, move: moveId, damage: dmg, kb, strength, x: px, y: py })
  return dmg
}

function histPos(st: BrawlSimState, v: Fighter, lag: number): [number, number] {
  if (lag <= 0 || st.tick - lag < 0) return [v.x, v.y]
  const n = LAG_HISTORY_TICKS
  const i = (((st.tick - lag) % n) + n) % n
  return [v.hist[i * 2] ?? v.x, v.hist[i * 2 + 1] ?? v.y]
}

function meleeHits(st: BrawlSimState, fx: Fx): void {
  const tick = st.tick
  // 1ª passada: quem está com golpe ativo (guardado antes de qualquer acerto, para trocas valerem)
  const actives: { f: Fighter; m: MoveData; boxes: Hitbox[]; facing: 1 | -1; charge: number; lag: number }[] = []
  for (const f of st.fighters) {
    if (f.move === null || !onField(f) || tick < f.freezeUntil || f.moveTick === 0) continue
    const m = MOVES[f.move]
    if (!m) continue
    const t = f.moveTick - 1
    if (t < m.startup || t >= m.startup + m.active) continue
    const boxes = m.frames[Math.min(t - m.startup, m.frames.length - 1)] ?? []
    actives.push({ f, m, boxes, facing: f.facing, charge: f.charge, lag: Math.min(f.lastInput?.lagTicks ?? 0, LAG_HISTORY_TICKS - 1) })
  }
  for (const { f, m, boxes, facing, charge, lag } of actives) {
    for (const b of boxes) {
      const x0 = facing === 1 ? f.x + b.x : f.x - b.x - b.w
      const x1 = x0 + b.w
      const y0 = f.y + b.y
      const y1 = y0 + b.h
      for (const v of st.fighters) {
        if (!canHit(st, f, v)) continue
        // já acertou neste uso do golpe?
        let seen = -1
        for (let i = 0; i < f.hitSlots.length; i += 2) if (f.hitSlots[i] === v.slot) seen = i
        if (seen >= 0 && (m.multiHit === undefined || tick - f.hitSlots[seen + 1] < m.multiHit)) continue
        const sp = CHARACTERS[v.char]
        const [vx, vy] = histPos(st, v, lag)
        if (x1 <= vx - sp.hurtW / 2 || x0 >= vx + sp.hurtW / 2 || y1 <= vy - sp.hurtH || y0 >= vy) continue
        if (seen >= 0) f.hitSlots[seen + 1] = tick
        else f.hitSlots.push(v.slot, tick)
        applyHit(st, fx, f, f.slot, v, b, facing, charge, m.id, clamp((x0 + x1) / 2, v.x - sp.hurtW / 2, v.x + sp.hurtW / 2), (y0 + y1) / 2)
      }
    }
  }
}

function stepProjectiles(st: BrawlSimState, fx: Fx, arena: ArenaDef): void {
  const tick = st.tick
  const keep: typeof st.projectiles = []
  for (const pr of st.projectiles) {
    pr.x += pr.vx
    pr.y += pr.vy
    if (pr.kind === 'arma') pr.vy += 0.2
    let dead = tick >= pr.dieTick
    const out = pr.x < arena.blast.left || pr.x > arena.blast.right || pr.y > arena.blast.bottom
    if (!dead && !out) {
      for (const p of arena.platforms) {
        if (!p.thin && pr.x > p.x && pr.x < p.x + p.w && pr.y > p.y && pr.y < p.y + p.h) dead = true
      }
    }
    if (!dead && !out) {
      const owner = st.fighters.find((f) => f.slot === pr.owner)
      for (const v of st.fighters) {
        if (v.slot === pr.owner || !onField(v) || tick < v.invulnUntil) continue
        if (!st.friendlyFire && owner && sameTeam(st, owner, v)) continue
        if (pr.hitSlots.indexOf(v.slot) >= 0) continue
        const sp = CHARACTERS[v.char]
        if (pr.x + pr.w / 2 <= v.x - sp.hurtW / 2 || pr.x - pr.w / 2 >= v.x + sp.hurtW / 2 || pr.y + pr.h / 2 <= v.y - sp.hurtH || pr.y - pr.h / 2 >= v.y) continue
        pr.hitSlots.push(v.slot)
        applyHit(st, fx, null, pr.owner, v, pr.hit, pr.facing, 0, `proj:${pr.kind}`, pr.x, pr.y)
        if (!pr.pierce) {
          dead = true
          break
        }
      }
    }
    if (dead || out) {
      // arma arremessada vira arma no chão de novo
      if (pr.kind === 'arma' && pr.weapon && !out) st.items.push({ id: st.nextId++, weapon: pr.weapon, x: pr.x, y: pr.y, vx: 0, vy: 0, state: 'caindo', owner: pr.owner, dieTick: 0 })
      continue
    }
    keep.push(pr)
  }
  st.projectiles = keep
}

function stepItems(st: BrawlSimState, arena: ArenaDef): void {
  const tick = st.tick
  const keep: typeof st.items = []
  for (const it of st.items) {
    if (it.state === 'caindo') {
      const py = it.y
      it.vy = Math.min(it.vy + TUNING.itemGravity, TUNING.itemFallMax)
      it.y += it.vy
      it.x += it.vx
      for (const p of arena.platforms) {
        if (it.x >= p.x && it.x <= p.x + p.w && py <= p.y && it.y >= p.y) {
          it.y = p.y
          it.vy = 0
          it.vx = 0
          it.state = 'chao'
          it.dieTick = tick + TUNING.itemLifeTicks
          break
        }
      }
      if (it.y > arena.blast.bottom) continue
    } else if (tick >= it.dieTick) continue
    keep.push(it)
  }
  st.items = keep
}

// =====================================================================================
// Nocaute, renascer e fim
// =====================================================================================

function koCheck(st: BrawlSimState, fx: Fx, arena: ArenaDef): void {
  const tick = st.tick
  const b = arena.blast
  for (const f of st.fighters) {
    if (!onField(f)) continue
    let side: 'esquerda' | 'direita' | 'cima' | 'baixo' | null = null
    if (f.x < b.left) side = 'esquerda'
    else if (f.x > b.right) side = 'direita'
    else if (f.y > b.bottom) side = 'baixo'
    else if (f.y < b.top && tick < f.hitstunUntil) side = 'cima'
    if (side === null) continue
    let killer = -1
    if (f.lastHitBy >= 0 && f.lastHitBy !== f.slot && tick - f.lastHitTick <= TUNING.killerWindowTicks) {
      const k = st.fighters.find((o) => o.slot === f.lastHitBy)
      if (k) {
        k.kos++
        killer = k.slot
      }
    }
    fx.events.push({ type: 'ko', victim: f.slot, killer, side, x: clamp(f.x, b.left, b.right), y: clamp(f.y, b.top, b.bottom) })
    f.falls++
    f.damage = 0
    f.held = 'mao'
    f.move = null
    f.moveTick = 0
    f.charge = 0
    f.hitSlots = []
    f.vx = 0
    f.vy = 0
    f.hitstunUntil = 0
    f.freezeUntil = 0
    f.wallSide = 0
    f.lastHitBy = NO_HIT_ID
    f.x = arena.respawn.x
    f.y = arena.respawn.y
    f.grounded = false
    f.action = 'fora'
    f.actionTick = tick
    f.respawnTick = tick + RESPAWN_TICKS
    if (st.mode === 'vidas' || st.phase === 'morte-subita') {
      f.stocks = Math.max(0, f.stocks - 1)
      if (f.stocks === 0) {
        f.action = 'eliminado'
        f.outTick = tick
        fx.events.push({ type: 'eliminated', slot: f.slot })
      } else if (f.stocks === 1) fx.events.push({ type: 'last-stock', slot: f.slot })
    }
  }
}

function respawn(st: BrawlSimState, f: Fighter, fx: Fx, arena: ArenaDef): void {
  f.action = 'no-ar'
  f.actionTick = st.tick
  f.x = arena.respawn.x
  f.y = arena.respawn.y
  f.vx = 0
  f.vy = 0
  f.grounded = false
  f.jumpsLeft = MAX_JUMPS - 1
  f.recoveryUsed = false
  f.airDodgeUsed = false
  f.fastFall = false
  f.wallTicks = 0
  f.invulnUntil = st.tick + RESPAWN_INVULN_TICKS
  f.facing = f.x < (arena.dropX[0] + arena.dropX[1]) / 2 ? 1 : -1
  f.prevButtons = 0
  fx.events.push({ type: 'respawn', slot: f.slot })
}

const net = (f: Fighter): number => f.kos - f.falls

function endOfTime(st: BrawlSimState, fx: Fx): void {
  const top = sortedFighters(st)[0]
  if (!top) {
    finish(st, fx)
    return
  }
  const tied = st.fighters.filter((f) => isAlive(f) && net(f) === net(top))
  const sameSide = st.teamSize > 0 && tied.every((f) => f.team === top.team)
  if (tied.length < 2 || sameSide) {
    finish(st, fx)
    return
  }
  // empate: morte súbita, só os empatados lutam, uma vida
  st.phase = 'morte-subita'
  fx.events.push({ type: 'phase', phase: 'morte-subita' })
  for (const f of st.fighters) {
    if (!isAlive(f)) continue
    if (tied.indexOf(f) >= 0) {
      f.stocks = 1
      f.damage = 0
    } else {
      f.stocks = 0
      f.action = 'eliminado'
      f.outTick = st.tick
      f.move = null
      fx.events.push({ type: 'eliminated', slot: f.slot })
    }
  }
}

function finish(st: BrawlSimState, fx: Fx): void {
  st.phase = 'fim'
  fx.events.push({ type: 'phase', phase: 'fim' })
}

function checkEnd(st: BrawlSimState, fx: Fx): void {
  if (st.phase !== 'jogando' && st.phase !== 'morte-subita') return
  if (st.mode === 'tempo' && st.phase === 'jogando') return
  const alive = new Set<number>()
  const parts = new Set<number>()
  for (const f of st.fighters) {
    if (isAlive(f)) alive.add(teamKey(st, f))
    // quem entrou no meio no modo vidas só assiste: não conta como participante
    const lateJoiner = st.mode === 'vidas' && f.action === 'eliminado' && f.falls === 0 && f.outTick > 0
    if (!lateJoiner) parts.add(teamKey(st, f))
  }
  if (alive.size === 0 || (alive.size === 1 && (parts.size >= 2 || st.phase === 'morte-subita'))) finish(st, fx)
}

function dropWeapon(st: BrawlSimState, arena: ArenaDef, fx: Fx): void {
  const weapon = WEAPON_IDS[rngInt(st, WEAPON_IDS.length)]
  const x = arena.dropX[0] + rngInt(st, arena.dropX[1] - arena.dropX[0] + 1)
  const id = st.nextId++
  st.items.push({ id, weapon, x, y: -10, vx: 0, vy: 0, state: 'caindo', owner: -1, dieTick: 0 })
  fx.events.push({ type: 'drop', item: id, weapon, x })
}

// =====================================================================================
// Passo
// =====================================================================================

function step(st: BrawlSimState, inputs: ReadonlyMap<number, BrawlInput>): BrawlSimEvent[] {
  const events: BrawlSimEvent[] = []
  if (st.phase === 'fim') return events
  const fx: Fx = { events }
  const arena = ARENAS[st.arenaId]
  const tick = st.tick

  if (st.phase === 'contagem' && tick >= st.goTick) {
    st.phase = 'jogando'
    events.push({ type: 'phase', phase: 'jogando' }, { type: 'go' })
  }
  if (st.phase === 'jogando' && st.mode === 'tempo' && tick >= st.endTick) {
    endOfTime(st, fx)
    if ((st.phase as BrawlSimPhase) === 'fim') return events
  }
  const playing = st.phase === 'jogando' || st.phase === 'morte-subita'

  for (const f of st.fighters) if (!f.away && f.action === 'fora' && tick >= f.respawnTick) respawn(st, f, fx, arena)

  if (playing && tick >= st.nextDropTick) {
    if (st.items.length < TUNING.maxItems) dropWeapon(st, arena, fx)
    st.nextDropTick = tick + nextDropDelay(st)
  }

  for (const f of st.fighters) {
    if (f.away) continue
    let raw = inputs.get(f.slot)
    let fresh = raw !== undefined
    if (raw && raw.seq < f.lastSeq) {
      raw = undefined // pacote velho
      fresh = false
    }
    if (!raw) {
      if (f.bot) {
        raw = playing && onField(f) ? botInput(st, f.slot) : { ...EMPTY_BRAWL_INPUT, seq: f.lastSeq + 1 }
        fresh = true
      } else raw = f.lastInput ?? { ...EMPTY_BRAWL_INPUT, seq: f.lastSeq }
    }
    const inp = sanitize(raw, f.lastSeq)
    if (!fresh) delete inp.lagTicks
    f.lastSeq = Math.max(f.lastSeq, inp.seq)
    if (!f.bot) f.lastInput = inp
    const eff = playing ? inp : { ...inp, mx: 0, my: 0, buttons: 0 }
    updateFighter(st, f, eff, fx)
  }

  if (playing) meleeHits(st, fx)
  stepProjectiles(st, fx, arena)
  stepItems(st, arena)
  st.puddles = st.puddles.filter((p) => tick < p.dieTick)
  if (playing) {
    koCheck(st, fx, arena)
    checkEnd(st, fx)
  }

  const n = LAG_HISTORY_TICKS
  const slot = (tick % n) * 2
  for (const f of st.fighters) {
    f.hist[slot] = f.x
    f.hist[slot + 1] = f.y
  }
  st.tick = tick + 1
  return events
}

/**
 * Predição do próprio lutador por um tick (mesma função de movimento e andamento do golpe do `step`).
 * O CHAMADOR avança `state.tick` entre as chamadas (aqui só muda `fighters[slot]`).
 */
function predictSelf(st: BrawlSimState, slot: number, input: BrawlInput): void {
  const f = st.fighters.find((o) => o.slot === slot)
  if (!f) return
  const inp = sanitize(input, f.lastSeq)
  f.lastSeq = Math.max(f.lastSeq, inp.seq)
  const live = st.tick >= st.goTick && st.phase !== 'fim'
  updateFighter(st, f, live ? inp : { ...inp, mx: 0, my: 0, buttons: 0 }, null)
}

export const brawlSim: BrawlSimApi = {
  create,
  step,
  cloneState,
  addPlayer,
  setAway,
  predictSelf,
  botInput,
  scores,
  ranking
}

export { create as createSim, step, cloneState, addPlayer, setAway, predictSelf, botInput, scores, ranking }
