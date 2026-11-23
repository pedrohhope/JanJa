/**
 * Física da sinuca. Determinística como a do golfe: passo fixo (`DT`) e só + - * / sqrt dentro do
 * laço, então o servidor (Worker) e o navegador chegam ao mesmo lugar. A tacada chega como vetor
 * de direção (nada de seno/cosseno). O servidor simula a tacada inteira de uma vez; o navegador
 * roda a mesma simulação passo a passo para animar e, no fim, encaixa no resultado do servidor.
 *
 * Mesa: área de jogo de 100 x 50 (x para a direita, y para baixo), origem no canto de cima à esquerda.
 */

export const TABLE_W = 100
export const TABLE_H = 50
export const R = 1.12
/** passos por segundo */
export const HZ = 480
export const DT = 1 / HZ
export const MAX_SPEED = 300
export const MIN_SPEED = 8
/** nenhuma tacada dura mais que isso (passos) */
export const MAX_STEPS = HZ * 25

/** atrito do pano: um tanto fixo e um tanto que cresce com a velocidade (bola rápida perde força logo) */
const FRICTION = 3.5
const DRAG = 0.12
const REST = 0.5
const BALL_E = 0.96
const RAIL_E = 0.78
/** atrito de deslizar: a bola que desliza (sem rolar) freia bem mais que a que rola */
const SLIDE = 80
/** abaixo disto (diferença entre deslizar e rolar) a bola já rola */
const SLIP_EPS = 0.4
/** giro de cima/baixo no máximo do efeito, em relação à velocidade da tacada */
export const TIP = 1.2
/** efeito lateral: quanto entorta na tabela e quanto se perde por segundo */
const SIDE_KICK = 0.35
const SIDE_DECAY = 0.25

export interface Pocket {
  x: number
  y: number
  /** a bola cai se o centro chegar a esta distância */
  r: number
}

/** raio das caçapas: do canto e do meio (o centro da bola encostada na tabela fica a 1,92 da do meio) */
const CORNER_R = 2.4
const SIDE_R = 2.2

export const POCKETS: readonly Pocket[] = [
  { x: 0, y: 0, r: CORNER_R },
  { x: TABLE_W / 2, y: -0.8, r: SIDE_R },
  { x: TABLE_W, y: 0, r: CORNER_R },
  { x: 0, y: TABLE_H, r: CORNER_R },
  { x: TABLE_W / 2, y: TABLE_H + 0.8, r: SIDE_R },
  { x: TABLE_W, y: TABLE_H, r: CORNER_R }
]

/** 0 = branca, 1..7 lisas, 8 a preta, 9..15 listradas */
export interface PBall {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  /** caiu na caçapa */
  in: boolean
  /**
   * Só durante a tacada: velocidade que a bola teria se rolasse sem deslizar (o giro de cima/baixo).
   * Igual a (vx, vy) = rolando; diferente = deslizando, e o atrito aproxima uma da outra.
   * Ausente = rolando com a própria velocidade (bola parada).
   */
  rx?: number
  ry?: number
  /** efeito lateral (-1 esquerda a 1 direita): entorta a bola na tabela */
  sd?: number
}

/** efeito na branca: `x` lateral (-1 esquerda, 1 direita), `y` alto/baixo (1 seguida, -1 puxada); comprimento até 1 */
export interface Spin {
  x: number
  y: number
}

/** Limita o efeito ao círculo de raio 1. */
export function clampSpin(sp: Spin | undefined): Spin {
  if (!sp) return { x: 0, y: 0 }
  const l = Math.sqrt(sp.x * sp.x + sp.y * sp.y)
  return l > 1 ? { x: sp.x / l, y: sp.y / l } : { x: sp.x, y: sp.y }
}

export interface ShotLog {
  /** primeira bola em que a branca encostou */
  firstHit: number | null
  pocketed: Array<{ id: number; pocket: number }>
  /** alguma bola bateu na tabela depois do primeiro toque */
  railAfterHit: boolean
  steps: number
}

export const newLog = (): ShotLog => ({ firstHit: null, pocketed: [], railAfterHit: false, steps: 0 })
export const cloneBalls = (balls: readonly PBall[]): PBall[] => balls.map((b) => ({ ...b }))

/** velocidade da branca para a força `power` (0 a 1) */
export const shotSpeed = (power: number): number => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * (power < 0 ? 0 : power > 1 ? 1 : power)

/** Põe a branca em movimento: `dx, dy` é a direção (qualquer tamanho), `power` de 0 a 1, `spin` o efeito. */
export function strike(balls: PBall[], dx: number, dy: number, power: number, spin?: Spin): void {
  const cue = balls.find((b) => b.id === 0)
  const len = Math.sqrt(dx * dx + dy * dy)
  if (!cue || len === 0) return
  const speed = shotSpeed(power)
  const sp = clampSpin(spin)
  cue.vx = (dx / len) * speed
  cue.vy = (dy / len) * speed
  // taco no centro: a bola sai deslizando sem giro; em cima ela já gira para a frente, embaixo para trás
  cue.rx = cue.vx * sp.y * TIP
  cue.ry = cue.vy * sp.y * TIP
  cue.sd = sp.x
}

const nearPocket = (b: PBall, extra: number): number => POCKETS.findIndex((p) => (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y) < (p.r + extra) * (p.r + extra))

/** Um passo. Devolve true se alguma bola ainda se move. */
export function step(balls: PBall[], log: ShotLog): boolean {
  log.steps++
  let moving = false
  for (const b of balls) {
    if (b.in) continue
    if (b.rx === undefined || b.ry === undefined) {
      b.rx = b.vx
      b.ry = b.vy
    }
    let sd = b.sd ?? 0
    // deslizando: o atrito leva a velocidade e o giro para o mesmo valor (bola maciça: 5/7 e 2/7)
    const sx = b.rx - b.vx
    const sy = b.ry - b.vy
    const sl = Math.sqrt(sx * sx + sy * sy)
    let sliding = false
    if (sl > SLIP_EPS) {
      sliding = true
      let a = SLIDE * DT
      if (a * 3.5 > sl) a = sl / 3.5
      const ux = sx / sl
      const uy = sy / sl
      b.vx += ux * a
      b.vy += uy * a
      b.rx -= ux * a * 2.5
      b.ry -= uy * a * 2.5
    }
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
    if (!sliding) {
      if (sp === 0) {
        b.rx = 0
        b.ry = 0
        b.sd = 0
        continue
      }
      // rolando: desacelera sempre na mesma direção
      const ns = sp - (FRICTION + DRAG * sp) * DT
      if (ns <= REST) {
        b.vx = 0
        b.vy = 0
        b.rx = 0
        b.ry = 0
        b.sd = 0
        continue
      }
      b.vx = (b.vx / sp) * ns
      b.vy = (b.vy / sp) * ns
      b.rx = b.vx
      b.ry = b.vy
    }
    if (sd !== 0) {
      const d = SIDE_DECAY * DT
      sd = sd > d ? sd - d : sd < -d ? sd + d : 0
    }
    b.x += b.vx * DT
    b.y += b.vy * DT
    moving = true
    // caçapa
    const pk = nearPocket(b, 0)
    if (pk >= 0) {
      b.in = true
      b.vx = 0
      b.vy = 0
      b.rx = 0
      b.ry = 0
      b.sd = 0
      log.pocketed.push({ id: b.id, pocket: pk })
      continue
    }
    // tabelas (na boca da caçapa a bola passa direto); o efeito lateral entorta a volta
    if (nearPocket(b, R * 1.4) < 0) {
      let rail = false
      if (b.x < R) {
        const vn = -b.vx
        b.x = R + (R - b.x)
        b.vx = -b.vx * RAIL_E
        b.rx = -b.rx * RAIL_E
        b.vy -= sd * SIDE_KICK * vn
        b.ry -= sd * SIDE_KICK * vn
        rail = true
      } else if (b.x > TABLE_W - R) {
        const vn = b.vx
        b.x = TABLE_W - R - (b.x - (TABLE_W - R))
        b.vx = -b.vx * RAIL_E
        b.rx = -b.rx * RAIL_E
        b.vy += sd * SIDE_KICK * vn
        b.ry += sd * SIDE_KICK * vn
        rail = true
      }
      if (b.y < R) {
        const vn = -b.vy
        b.y = R + (R - b.y)
        b.vy = -b.vy * RAIL_E
        b.ry = -b.ry * RAIL_E
        b.vx += sd * SIDE_KICK * vn
        b.rx += sd * SIDE_KICK * vn
        rail = true
      } else if (b.y > TABLE_H - R) {
        const vn = b.vy
        b.y = TABLE_H - R - (b.y - (TABLE_H - R))
        b.vy = -b.vy * RAIL_E
        b.ry = -b.ry * RAIL_E
        b.vx -= sd * SIDE_KICK * vn
        b.rx -= sd * SIDE_KICK * vn
        rail = true
      }
      if (rail) {
        sd *= 0.5
        if (log.firstHit !== null) log.railAfterHit = true
      }
    } else if (b.x < -R || b.y < -R || b.x > TABLE_W + R || b.y > TABLE_H + R) {
      // escapou pela boca sem cair: conta como caçapa mais perto
      let best = 0
      let bd = Infinity
      POCKETS.forEach((p, i) => {
        const d = (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      b.in = true
      b.vx = 0
      b.vy = 0
      b.rx = 0
      b.ry = 0
      sd = 0
      log.pocketed.push({ id: b.id, pocket: best })
    }
    b.sd = sd
  }
  // choques entre bolas (massas iguais)
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]
    if (a.in) continue
    for (let j = i + 1; j < balls.length; j++) {
      const c = balls[j]
      if (c.in) continue
      const dx = c.x - a.x
      const dy = c.y - a.y
      const d2 = dx * dx + dy * dy
      if (d2 >= 4 * R * R || d2 === 0) continue
      const d = Math.sqrt(d2)
      const nx = dx / d
      const ny = dy / d
      // separa
      const push = (2 * R - d) / 2
      a.x -= nx * push
      a.y -= ny * push
      c.x += nx * push
      c.y += ny * push
      const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny
      if (rel <= 0) continue
      const k = rel * (1 + BALL_E) * 0.5
      a.vx -= k * nx
      a.vy -= k * ny
      c.vx += k * nx
      c.vy += k * ny
      moving = true
      if (log.firstHit === null) {
        if (a.id === 0) log.firstHit = c.id
        else if (c.id === 0) log.firstHit = a.id
      }
    }
  }
  return moving
}

/** Tira velocidade e giro (bolas paradas, prontas para guardar no estado). */
export function settle(balls: PBall[]): PBall[] {
  for (const b of balls) {
    b.vx = 0
    b.vy = 0
    delete b.rx
    delete b.ry
    delete b.sd
  }
  return balls
}

/** Simula a tacada até tudo parar. Não muda `balls`. */
export function simulate(balls: readonly PBall[], dx: number, dy: number, power: number, spin?: Spin): { balls: PBall[]; log: ShotLog } {
  const w = cloneBalls(balls)
  const log = newLog()
  strike(w, dx, dy, power, spin)
  while (log.steps < MAX_STEPS && step(w, log));
  return { balls: settle(w), log }
}

/** A bola `id` cabe em (x, y)? (dentro da mesa, longe das caçapas e sem encostar nas outras) */
export function isFree(balls: readonly PBall[], x: number, y: number, id: number, maxX = TABLE_W - R): boolean {
  if (!(x >= R && x <= maxX && y >= R && y <= TABLE_H - R)) return false
  if (POCKETS.some((p) => (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) < (p.r + R) * (p.r + R))) return false
  return balls.every((b) => b.id === id || b.in || (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) >= 4 * R * R)
}

/** A branca pode ficar aqui? (bola na mão; `maxX` limita à linha de saída na quebra) */
export const canPlace = (balls: readonly PBall[], x: number, y: number, maxX = TABLE_W - R): boolean => isFree(balls, x, y, 0, maxX)

export interface AimGuide {
  /** bola que a branca acerta primeiro (null = tabela) */
  hit: number | null
  /** onde a branca encosta (bola fantasma) ou bate na tabela */
  ghost: { x: number; y: number }
  /** para onde a bola atingida vai (unitário) */
  object: { x: number; y: number } | null
  /** para onde a branca segue depois do choque, já com o efeito (unitário; null = para) */
  cue: { x: number; y: number } | null
  /** bateu primeiro na tabela: até onde a branca vai depois da volta (outra bola ou tabela) */
  bounce: { x: number; y: number; hit: number | null } | null
}

/** primeira coisa no caminho a partir de (x, y) na direção unitária (ux, uy) */
function cast(balls: readonly PBall[], x: number, y: number, ux: number, uy: number): { t: number; hit: PBall | null } {
  let best = Infinity
  let hit: PBall | null = null
  const rr = 4 * R * R
  for (const b of balls) {
    if (b.id === 0 || b.in) continue
    const ox = b.x - x
    const oy = b.y - y
    const t = ox * ux + oy * uy
    if (t <= 0) continue
    const perp2 = ox * ox + oy * oy - t * t
    if (perp2 > rr) continue
    const tHit = t - Math.sqrt(rr - perp2)
    if (tHit > 0 && tHit < best) {
      best = tHit
      hit = b
    }
  }
  const tx = ux > 0 ? (TABLE_W - R - x) / ux : ux < 0 ? (R - x) / ux : Infinity
  const ty = uy > 0 ? (TABLE_H - R - y) / uy : uy < 0 ? (R - y) / uy : Infinity
  const tRail = Math.max(0, Math.min(tx, ty))
  return hit && best <= tRail ? { t: best, hit } : { t: tRail, hit: null }
}

/**
 * Linha de mira: primeira bola na direção (dx, dy) a partir da branca. Com `spin` e `power`, a
 * direção da branca depois do choque leva em conta o efeito (estimativa: o quanto ela ainda
 * desliza quando chega na bola). Se bater primeiro na tabela, mostra a volta.
 */
export function aimGuide(balls: readonly PBall[], dx: number, dy: number, spin?: Spin, power = 0.5): AimGuide | null {
  const cue = balls.find((b) => b.id === 0 && !b.in)
  const len = Math.sqrt(dx * dx + dy * dy)
  if (!cue || len === 0) return null
  const ux = dx / len
  const uy = dy / len
  const first = cast(balls, cue.x, cue.y, ux, uy)
  const gx = cue.x + ux * first.t
  const gy = cue.y + uy * first.t
  if (!first.hit) {
    // volta da tabela (sem efeito): inverte o lado em que bateu
    const hitX = gx <= R + 1e-6 || gx >= TABLE_W - R - 1e-6
    const hitY = gy <= R + 1e-6 || gy >= TABLE_H - R - 1e-6
    const bx = hitX ? -ux : ux
    const by = hitY ? -uy : uy
    const nearPk = POCKETS.some((p) => (gx - p.x) * (gx - p.x) + (gy - p.y) * (gy - p.y) < (p.r + R * 1.4) * (p.r + R * 1.4))
    const next = nearPk ? null : cast(balls, gx, gy, bx, by)
    return {
      hit: null,
      ghost: { x: gx, y: gy },
      object: null,
      cue: null,
      bounce: next ? { x: gx + bx * next.t, y: gy + by * next.t, hit: next.hit ? next.hit.id : null } : null
    }
  }
  const hit = first.hit
  const nx0 = hit.x - gx
  const ny0 = hit.y - gy
  const nl = Math.sqrt(nx0 * nx0 + ny0 * ny0)
  const nx = nx0 / nl
  const ny = ny0 / nl
  const dot = ux * nx + uy * ny
  // branca depois do choque: o que sobra na tangente mais o giro de cima/baixo que ela ainda tem
  const sp = clampSpin(spin)
  const v0 = shotSpeed(power)
  const s0 = (sp.y * TIP - 1) * v0
  const t = first.t / v0
  const left = Math.max(0, Math.abs(s0) - 3.5 * SLIDE * t)
  const s1 = s0 < 0 ? -left : left
  const vAt = v0 + (s0 - s1) / 3.5
  const rAt = vAt + s1
  const tx = (ux - dot * nx) * vAt
  const ty = (uy - dot * ny) * vAt
  const fx = (5 * tx + 2 * rAt * ux) / 7
  const fy = (5 * ty + 2 * rAt * uy) / 7
  const fl = Math.sqrt(fx * fx + fy * fy)
  return {
    hit: hit.id,
    ghost: { x: gx, y: gy },
    object: { x: nx, y: ny },
    cue: fl > 0.02 * v0 ? { x: fx / fl, y: fy / fl } : null,
    bounce: null
  }
}
