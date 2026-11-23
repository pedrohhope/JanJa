/**
 * Velha ao quadrado (regras puras): um jogo da velha 3x3 em que cada casa é um jogo da velha.
 * Tabuleiros e casas numerados de 0 a 8, linha por linha (0 = canto de cima à esquerda, 4 = meio).
 * A casa em que você joga manda o outro para o tabuleiro de mesmo número; se ele já acabou, o outro
 * joga em qualquer tabuleiro aberto. Três tabuleiros em linha no grande vence.
 */
export type Mark = 'x' | 'o'
/** resultado de um tabuleiro pequeno: de quem é, 'empate' (cheio sem linha) ou null (aberto) */
export type Small = Mark | 'empate' | null

export interface Pos {
  /** board[b][c]: casa c do tabuleiro pequeno b */
  board: (Mark | null)[][]
  small: Small[]
  /** tabuleiro onde quem joga é obrigado a jogar (null = qualquer aberto) */
  forced: number | null
  turn: Mark
}

export interface Move {
  board: number
  cell: number
}

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
]

export const otherMark = (m: Mark): Mark => (m === 'x' ? 'o' : 'x')

/** dono de três em linha nestas 9 casas (null = ninguém) */
export function winnerOf(cells: readonly (Mark | 'empate' | null)[]): Mark | null {
  for (const [a, b, c] of LINES) {
    const v = cells[a]
    if ((v === 'x' || v === 'o') && v === cells[b] && v === cells[c]) return v
  }
  return null
}

export function initial(): Pos {
  return { board: Array.from({ length: 9 }, () => Array<Mark | null>(9).fill(null)), small: Array<Small>(9).fill(null), forced: null, turn: 'x' }
}

/** lances que valem agora */
export function legalMoves(p: Pos): Move[] {
  if (winnerOf(p.small)) return []
  const boards = p.forced !== null ? [p.forced] : [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((b) => p.small[b] === null)
  const out: Move[] = []
  for (const b of boards) for (let c = 0; c < 9; c++) if (p.board[b][c] === null) out.push({ board: b, cell: c })
  return out
}

export const isLegal = (p: Pos, m: Move): boolean => legalMoves(p).some((x) => x.board === m.board && x.cell === m.cell)

/** Joga (lance já validado) e devolve a posição nova, com o tabuleiro pequeno que fechou (se fechou). */
export function play(p: Pos, m: Move): { pos: Pos; closed: Small } {
  const board = p.board.map((row) => row.slice())
  const small = p.small.slice()
  board[m.board][m.cell] = p.turn
  let closed: Small = null
  const w = winnerOf(board[m.board])
  if (w) closed = w
  else if (board[m.board].every((v) => v !== null)) closed = 'empate'
  small[m.board] = closed
  const forced = small[m.cell] === null ? m.cell : null
  return { pos: { board, small, forced, turn: otherMark(p.turn) }, closed }
}

/** `side` ainda consegue fazer três em linha no grande? (linha sem tabuleiro do outro nem empatado) */
export const bigLinePossible = (small: readonly Small[], side: Mark): boolean => LINES.some((l) => l.every((b) => small[b] === null || small[b] === side))

/** quantos tabuleiros pequenos cada um ganhou */
export const boardsWon = (small: readonly Small[]): { x: number; o: number } => ({
  x: small.filter((s) => s === 'x').length,
  o: small.filter((s) => s === 'o').length
})

const SPOT = ['canto de cima à esquerda', 'meio de cima', 'canto de cima à direita', 'meio da esquerda', 'meio', 'meio da direita', 'canto de baixo à esquerda', 'meio de baixo', 'canto de baixo à direita']

/** "canto de cima à esquerda", "meio"... */
export const spotName = (i: number): string => SPOT[i]

/** "tabuleiro do meio", "tabuleiro do canto de cima à esquerda" */
export const boardName = (b: number): string => `tabuleiro ${b === 4 ? 'do meio' : `do ${SPOT[b]}`}`

/** texto curto do lance para a lista: "5·1" (tabuleiro e casa contados de 1 a 9) */
export const moveText = (m: Move): string => `${m.board + 1}·${m.cell + 1}`
