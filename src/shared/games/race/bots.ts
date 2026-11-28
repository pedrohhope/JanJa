/**
 * Piloto dos robôs (e da volta de honra de quem já chegou). Mira um ponto do traçado lá na frente,
 * alivia antes das curvas fechadas e, se encalhar no muro, dá ré um pouco. Puro e determinístico:
 * só `+ - * / sqrt`; o estado (encalhado, ré) fica em `car.ai` e só o host chama isto.
 */
import type { Track } from './tracks'
import { BTN_BRAKE, BTN_GAS, type BotLevel, type Car, type RaceSimState } from './types'

/** velocidade máxima e "mão" na curva por nível */
const LEVEL: Record<BotLevel, { max: number; corner: number }> = {
  facil: { max: 0.8, corner: 0.85 },
  medio: { max: 0.9, corner: 0.95 },
  dificil: { max: 0.98, corner: 1.05 }
}

export interface BotDrive {
  steer: number
  buttons: number
  /** limite de velocidade (fração da máxima) */
  maxMul: number
}

export function botInput(s: RaceSimState, t: Track, car: Car): BotDrive {
  const lv = LEVEL[s.botLevel]
  const n = t.wps.length
  const speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy)

  // ré para desencalhar
  if (car.ai.reverse > 0) {
    car.ai.reverse--
    const w = t.wps[car.next]!
    const cross = car.hx * (w.y - car.y) - car.hy * (w.x - car.x)
    return { steer: cross > 0 ? -1 : 1, buttons: BTN_BRAKE, maxMul: 1 }
  }

  // alvo: alguns pontos à frente, com um desvio lateral por slot (não andam em fila indiana)
  const ahead = speed > 2.6 ? 3 : speed > 1.4 ? 2 : 1
  const w = t.wps[(car.next + ahead) % n]!
  const lane = ((car.slot % 3) - 1) * 9
  const tx = w.x - w.dy * lane - car.x
  const ty = w.y + w.dx * lane - car.y
  const tl = Math.sqrt(tx * tx + ty * ty) || 1
  const dx = tx / tl
  const dy = ty / tl
  const cross = car.hx * dy - car.hy * dx
  const dot = car.hx * dx + car.hy * dy
  let steer = cross * 3
  if (dot < 0) steer = cross >= 0 ? 1 : -1
  steer = steer < -1 ? -1 : steer > 1 ? 1 : steer

  // curva lá na frente: quanto a direção muda em ~5 pontos
  const a = t.wps[car.next]!
  const b = t.wps[(car.next + 5) % n]!
  const bend = a.dx * b.dx + a.dy * b.dy
  const want = (bend > 0.92 ? 99 : bend > 0.6 ? 2.8 : bend > 0.1 ? 2.2 : 1.7) * lv.corner
  let buttons = BTN_GAS
  if (speed > want + 0.25) buttons = speed > want + 0.9 ? BTN_BRAKE : 0
  if (dot < 0.3 && speed > 1.6) buttons = 0

  // encalhado: acelerando e parado
  if (buttons & BTN_GAS && speed < 0.25) {
    car.ai.stuck++
    if (car.ai.stuck > 40) {
      car.ai.stuck = 0
      car.ai.reverse = 35
    }
  } else car.ai.stuck = 0

  return { steer, buttons, maxMul: lv.max }
}
