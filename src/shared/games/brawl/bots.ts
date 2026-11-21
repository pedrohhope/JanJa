/**
 * Robôs da Briga na Sala (fácil, médio, difícil). Determinísticos: o único acaso é o rng do estado.
 * Toda a memória fica em `Fighter.ai` (números, serializável). O robô só "pensa" a cada `think`
 * ticks (fácil pensa devagar, difícil quase todo tick); nos ticks entre decisões repete a direção
 * e solta os botões (assim cada aperto vira uma borda de subida limpa).
 */
import { ARENAS } from './arenas'
import { CHARACTERS } from './characters'
import { moveFor } from './moves'
import { rngNext } from './rng'
import { BTN_DODGE, BTN_HEAVY, BTN_JUMP, BTN_LIGHT, BTN_PICK, EMPTY_BRAWL_INPUT, type ArenaDef, type BotLevel, type BrawlInput, type BrawlSimState, type Fighter, type Platform } from './types'

interface Level {
  /** ticks entre decisões */
  think: number
  /** chance de esquivar quando há golpe vindo (por decisão) */
  dodge: number
  /** dano do alvo a partir do qual usa o golpe forte */
  heavyDmg: number
  /** chance de atacar quando está ao alcance */
  attack: number
  /** chance de errar de propósito (ação aleatória) */
  mistake: number
}

export const BOT_LEVELS: Record<BotLevel, Level> = {
  facil: { think: 14, dodge: 0, heavyDmg: 140, attack: 0.4, mistake: 0.2 },
  medio: { think: 8, dodge: 0.3, heavyDmg: 90, attack: 0.65, mistake: 0.06 },
  dificil: { think: 3, dodge: 0.7, heavyDmg: 55, attack: 0.9, mistake: 0.01 }
}

const mainStage = (arena: ArenaDef): Platform => arena.platforms.filter((p) => !p.thin).reduce((a, b) => (b.w > a.w ? b : a))

/** há chão em x (com os pés em y ou mais abaixo, até 400 px)? */
function supportAt(arena: ArenaDef, x: number, y: number): boolean {
  for (const p of arena.platforms) if (x >= p.x - 2 && x <= p.x + p.w + 2 && p.y >= y - 3 && p.y <= y + 400) return true
  return false
}

function reachOf(f: Fighter): number {
  const b = moveFor(f.char, f.held, 'leve', 'lado').frames[0]?.[0]
  return b ? b.x + b.w : 20
}

export function botInput(st: BrawlSimState, slot: number): BrawlInput {
  const f = st.fighters.find((o) => o.slot === slot)
  if (!f) return { ...EMPTY_BRAWL_INPUT }
  const seq = f.lastSeq + 1
  const tick = st.tick
  if (!f.ai) f.ai = { next: 0, mx: 0, my: 0, lastJump: -100, atkCd: 0 }
  const ai = f.ai
  if (f.away || f.action === 'fora' || f.action === 'eliminado') return { seq, mx: 0, my: 0, buttons: 0 }
  const arena = ARENAS[st.arenaId]
  const stage = mainStage(arena)
  const left = stage.x
  const right = stage.x + stage.w
  const centerX = (left + right) / 2
  const lv = BOT_LEVELS[st.botLevel]
  const offstage = f.x < left - 2 || f.x > right + 2 || f.y > stage.y + 2
  const stunned = tick < f.hitstunUntil
  if (stunned) return { seq, mx: Math.sign(centerX - f.x), my: 0, buttons: 0 }
  if (tick < ai.next && !offstage) return { seq, mx: ai.mx, my: ai.my, buttons: 0 }
  if (tick < ai.next - Math.max(0, lv.think - 3)) return { seq, mx: ai.mx, my: ai.my, buttons: 0 }
  const spec = CHARACTERS[f.char]
  let mx = 0
  let my = 0
  let buttons = 0
  ai.next = tick + (offstage ? Math.min(3, lv.think) : lv.think)

  if (offstage) {
    // ---- voltar para o palco
    let tx = Math.min(right - 30, Math.max(left + 30, f.x))
    if (f.y > stage.y && f.x > left && f.x < right) tx = f.x < centerX ? left - 24 : right + 24 // embaixo do palco: sai pelo lado
    const dx = tx - f.x
    mx = Math.abs(dx) > 6 ? Math.sign(dx) : 0
    if (f.x < left - 2 || f.x > right + 2) mx = Math.sign(centerX - f.x) // para o lado do palco, para agarrar a parede
    const needUp = f.y > stage.y - 22
    if (needUp && f.jumpsLeft > 0 && (f.vy > 0.3 || f.y > stage.y + 20) && tick - ai.lastJump >= 10 && !f.move) {
      buttons |= BTN_JUMP
      ai.lastJump = tick
    } else if (needUp && f.jumpsLeft === 0 && !f.recoveryUsed && f.move === null && f.vy > -2) {
      buttons |= BTN_LIGHT
      my = -1
    }
    ai.mx = mx
    ai.my = my
    return { seq, mx, my, buttons }
  }

  // ---- no palco
  // alvo: o inimigo mais perto
  let target: Fighter | null = null
  let best = Infinity
  for (const o of st.fighters) {
    if (o === f || !(!o.away && o.action !== 'fora' && o.action !== 'eliminado')) continue
    if (st.teamSize > 0 && o.team === f.team) continue
    const d = Math.abs(o.x - f.x) + Math.abs(o.y - f.y) * 1.5
    if (d < best) {
      best = d
      target = o
    }
  }

  let goalX = centerX
  let wantPick = false
  if (f.held === 'mao') {
    let bi: (typeof st.items)[number] | null = null
    let bd = Infinity
    for (const it of st.items) {
      if (it.state !== 'chao') continue
      const liked = (spec.likes as readonly string[]).indexOf(it.weapon) >= 0
      const dx = Math.abs(it.x - f.x)
      const dy = Math.abs(it.y - f.y)
      if (dy > 60 || dx > (liked ? 300 : 130)) continue
      if (dx < bd) {
        bd = dx
        bi = it
      }
    }
    if (bi) {
      goalX = bi.x
      wantPick = true
      if (Math.abs(bi.x - f.x) < 10) buttons |= BTN_PICK
    }
  }
  if (!wantPick && target) goalX = target.x
  const dx = goalX - f.x
  const adx = Math.abs(dx)
  const reach = reachOf(f)
  if (target && !wantPick) {
    mx = adx > reach * 0.75 ? Math.sign(dx) : 0
    const dy = target.y - f.y
    // alvo mais alto: pula quando está embaixo
    if (dy < -20 && adx < 90 && f.jumpsLeft > 0 && tick - ai.lastJump > 18) {
      buttons |= BTN_JUMP
      ai.lastJump = tick
    }
    // preso numa parede (a chaminé): pula por cima
    if (ai.mx !== 0 && f.grounded && Math.abs(f.vx) < 0.05 && f.jumpsLeft > 0 && tick - ai.lastJump > 18) {
      buttons |= BTN_JUMP
      ai.lastJump = tick
      mx = Math.sign(ai.mx)
    }
    // alvo mais baixo e eu numa plataforma fina: desce
    if (dy > 40 && f.onThin >= 0 && adx < 80) my = 1
    // ataque
    const near = adx <= reach + 4 && Math.abs(dy) <= 42
    if (near && tick >= ai.atkCd && rngNext(st) < lv.attack && f.move === null) {
      const dir = Math.sign(dx) || f.facing
      const safe = f.grounded ? supportAt(arena, f.x + dir * 64, f.y) : true
      if (f.grounded) {
        if (target.damage >= lv.heavyDmg && safe && rngNext(st) < 0.6) buttons |= BTN_HEAVY
        else buttons |= BTN_LIGHT
        mx = safe ? dir : 0
        if (!safe) buttons = buttons & ~BTN_HEAVY
        if (!safe) buttons |= BTN_LIGHT
        if (!safe) mx = 0
      } else {
        buttons |= BTN_LIGHT
        if (dy > 22 && adx < 22) my = 1
        else mx = dir
      }
      ai.atkCd = tick + 10 + Math.floor(rngNext(st) * 12)
    }
    // esquiva um golpe que vem aí
    if (lv.dodge > 0 && target.move !== null && adx < 64 && tick >= f.dodgeReadyTick && Math.abs(dy) < 40 && (f.grounded || !f.airDodgeUsed) && rngNext(st) < lv.dodge) {
      buttons = BTN_DODGE
      mx = 0
      my = 0
    }
    // arremessa a arma quando o alvo está longe e alinhado
    if (f.held !== 'mao' && adx > 110 && adx < 220 && Math.abs(dy) < 30 && rngNext(st) < 0.04) buttons |= BTN_PICK
  } else if (wantPick) {
    mx = adx > 8 ? Math.sign(dx) : 0
  } else {
    mx = adx > 20 ? Math.sign(dx) : 0
  }

  // não cair do palco por vontade própria
  if (f.grounded) {
    if (mx !== 0 && !supportAt(arena, f.x + mx * 26, f.y)) mx = 0
  } else {
    if (f.x + f.vx * 16 < left + 6 && mx <= 0) mx = 1
    else if (f.x + f.vx * 16 > right - 6 && mx >= 0) mx = -1
  }
  // erro de propósito (fácil erra mais)
  if (rngNext(st) < lv.mistake) {
    mx = Math.floor(rngNext(st) * 3) - 1
    buttons &= ~(BTN_HEAVY | BTN_DODGE)
    if (!supportAt(arena, f.x + mx * 26, f.y) && f.grounded) mx = 0
  }
  ai.mx = mx
  ai.my = my
  return { seq, mx, my, buttons }
}
