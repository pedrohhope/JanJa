/**
 * Geometria do tabuleiro da Velha ao quadrado, em unidades do SVG. Sem React: o teste importa daqui.
 * Tabuleiro pequeno = 3 casinhas de CELL; entre os pequenos há um vão de GAP; borda de PAD.
 */
export const CELL = 10
export const GAP = 4
export const PAD = 3
export const SMALL = CELL * 3
export const BOARD = 2 * PAD + 3 * SMALL + 2 * GAP

/** canto de cima à esquerda do tabuleiro pequeno `b` */
export const boardX = (b: number): number => PAD + (b % 3) * (SMALL + GAP)
export const boardY = (b: number): number => PAD + Math.floor(b / 3) * (SMALL + GAP)
export const cellX = (b: number, c: number): number => boardX(b) + (c % 3) * CELL
export const cellY = (b: number, c: number): number => boardY(b) + Math.floor(c / 3) * CELL

/** coluna (ou linha) do tabuleiro pequeno e da casa num eixo; o vão entre tabuleiros conta para o mais perto */
function axis(v: number): { big: number; small: number } | null {
  if (v < 0 || v > BOARD) return null
  // cada tabuleiro "possui" metade do vão de cada lado, para um clique na beirada não se perder
  const big = Math.min(2, Math.max(0, Math.floor((v - PAD + GAP / 2) / (SMALL + GAP))))
  const inner = v - (PAD + big * (SMALL + GAP))
  const small = Math.min(2, Math.max(0, Math.floor(inner / CELL)))
  return { big, small }
}

/** Casa sob o ponto (x, y) do SVG (null fora do tabuleiro). */
export function cellAt(x: number, y: number): { board: number; cell: number } | null {
  const ax = axis(x)
  const ay = axis(y)
  if (!ax || !ay) return null
  return { board: ay.big * 3 + ax.big, cell: ay.small * 3 + ax.small }
}
