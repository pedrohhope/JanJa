/**
 * Tabuleiro do Mistério: a planta do Casarão da Vila (nossa, não a de Detetive/Clue).
 * Puro: o motor, a tela e o bot usam as mesmas contas.
 *
 * Legenda do mapa:
 *   '.'  corredor (anda uma casa por passo)
 *   '#'  parede
 *   letra maiúscula: dentro de um cômodo (ROOM_OF); minúscula: porta desse cômodo.
 * Entrar num cômodo gasta um passo (da casa do corredor colada na porta para dentro) e acaba o
 * movimento. Sair de um cômodo gasta um passo (para a casa do corredor colada numa das portas).
 * Todo mundo começa no Saguão, no meio; ele não é lugar de palpite.
 *
 * Posição (`Pos`): o id do cômodo ('cozinha', 'saguao') ou a casa do corredor "x,y".
 */
export type Pos = string

export const START = 'saguao'

export const MAP: readonly string[] = [
  'SSSSS..BBBBBBB..VVVVV',
  'SSSSs..BBBBBBB..vVVVV',
  'SSSSS..BBBBBBB..VVVVV',
  'SSsSS..BBBbBBB..VVvVV',
  '.....................',
  '#####...........#####',
  'CCCCC...HHhHH...AAAAA',
  'CCCCc...hHHHh...aAAAA',
  'CCCCC...HHhHH...AAAAA',
  '#####...........#####',
  '.....................',
  'PPpPP..JjJJJjJ..GGGGG',
  'PPPPP..JJJJJJJ..gGGGG',
  'PPPPP..JJJJJJJ..GGGGG',
  'PPPPP..JJJJJJJ..GGGGG'
]

export const ROOM_OF: Readonly<Record<string, string>> = {
  S: 'sotao',
  B: 'biblioteca',
  V: 'varanda',
  C: 'cozinha',
  H: 'saguao',
  A: 'adega',
  P: 'porao',
  J: 'jardim',
  G: 'garagem'
}

export const W = MAP[0].length
export const H = MAP.length

export const cellKey = (x: number, y: number): Pos => `${x},${y}`
export function parseCell(p: Pos): { x: number; y: number } | null {
  const m = /^(\d+),(\d+)$/.exec(p)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
}

const at = (x: number, y: number): string => (x < 0 || y < 0 || x >= W || y >= H ? '#' : MAP[y][x])
export const isCorridor = (x: number, y: number): boolean => at(x, y) === '.'
/** o cômodo daquela casa do mapa (dentro ou porta) */
export function roomAt(x: number, y: number): string | null {
  return ROOM_OF[at(x, y).toUpperCase()] ?? null
}
export const isRoom = (p: Pos): boolean => Object.values(ROOM_OF).includes(p)
export function isValidPos(p: Pos): boolean {
  if (isRoom(p)) return true
  const c = parseCell(p)
  return !!c && isCorridor(c.x, c.y)
}

export interface Rect {
  room: string
  x: number
  y: number
  w: number
  h: number
}

/** retângulo de cada cômodo (para desenhar) */
export const RECTS: readonly Rect[] = (() => {
  const out: Record<string, Rect> = {}
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const r = roomAt(x, y)
      if (!r) continue
      const o = (out[r] ??= { room: r, x, y, w: 1, h: 1 })
      o.w = Math.max(o.w, x - o.x + 1)
      o.h = Math.max(o.h, y - o.y + 1)
    }
  return Object.values(out)
})()

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
] as const

export interface Door {
  room: string
  /** a porta (dentro do cômodo) */
  x: number
  y: number
  /** a casa do corredor colada nela */
  cx: number
  cy: number
}

export const DOORS: readonly Door[] = (() => {
  const out: Door[] = []
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = at(x, y)
      if (ch === ch.toUpperCase() || !ROOM_OF[ch.toUpperCase()]) continue
      for (const [dx, dy] of DIRS) if (isCorridor(x + dx, y + dy)) out.push({ room: ROOM_OF[ch.toUpperCase()], x, y, cx: x + dx, cy: y + dy })
    }
  return out
})()

/** vizinhos de uma posição, cada um a um passo */
function neighbors(p: Pos): Pos[] {
  if (isRoom(p)) return DOORS.filter((d) => d.room === p).map((d) => cellKey(d.cx, d.cy))
  const c = parseCell(p)
  if (!c) return []
  const out: Pos[] = []
  for (const [dx, dy] of DIRS) if (isCorridor(c.x + dx, c.y + dy)) out.push(cellKey(c.x + dx, c.y + dy))
  for (const d of DOORS) if (d.cx === c.x && d.cy === c.y && !out.includes(d.room)) out.push(d.room)
  return out
}

/** distância em passos de `from` para todo lugar (cômodo não é caminho: entrou, parou) */
export function distances(from: Pos): Map<Pos, number> {
  const dist = new Map<Pos, number>([[from, 0]])
  const queue: Pos[] = [from]
  for (let k = 0; k < queue.length; k++) {
    const p = queue[k]
    if (p !== from && isRoom(p)) continue
    for (const q of neighbors(p)) {
      if (dist.has(q)) continue
      dist.set(q, (dist.get(p) as number) + 1)
      queue.push(q)
    }
  }
  return dist
}

/**
 * Para onde dá para ir com `steps` passos (até `steps`, não exatamente). Não fica parado no mesmo
 * lugar, e por isso também não volta para o cômodo de onde saiu nesta vez.
 */
export function reachable(from: Pos, steps: number): Pos[] {
  const out: Pos[] = []
  for (const [p, d] of distances(from)) if (d > 0 && d <= steps && p !== from) out.push(p)
  return out
}

/** cômodos do mapa (os 8 lugares e o Saguão). Peões dividem casa: ninguém bloqueia o caminho. */
export const ROOMS_ON_BOARD: readonly string[] = RECTS.map((r) => r.room)
