import { describeDuelEnd, type DuelAction, type DuelEndReason, type DuelEvent, type DuelMinutes, type DuelResult, type DuelView, type Side } from '../duel'
import type { Mark, Small } from './rules'

export interface VelhaOptions {
  minutes: DuelMinutes
}

export const DEFAULT_VELHA_OPTIONS: VelhaOptions = { minutes: 10 }

/** X é o lado `w` do duelo (começa); O é o `b` */
export const markOf = (s: Side): Mark => (s === 'w' ? 'x' : 'o')
export const sideOfMark = (m: Mark): Side => (m === 'x' ? 'w' : 'b')

export type VelhaAction =
  /** casa `cell` (0..8) do tabuleiro pequeno `board` (0..8) */
  | { type: 'move'; board: number; cell: number }
  | DuelAction

/** linha = três tabuleiros em linha; velha = ninguém consegue mais fazer linha */
export type VelhaEndReason = DuelEndReason | 'linha' | 'velha'

export type VelhaResult = DuelResult<VelhaEndReason>

export interface VelhaMoveRec {
  board: number
  cell: number
  mark: Mark
  /** fechou o tabuleiro pequeno com este resultado */
  closed: Small
  text: string
}

export interface VelhaView extends DuelView<VelhaEndReason> {
  you: { playerId: string; color: Side } | null
  /** board[b][c] */
  board: (Mark | null)[][]
  small: Small[]
  /** tabuleiro onde quem joga tem que jogar (null = qualquer aberto) */
  forced: number | null
  turn: Side
  /** casas que valem na sua vez, como [tabuleiro, casa]. Vazio quando não é sua vez. */
  legal: [number, number][]
  lastMove: VelhaMoveRec | null
  moves: VelhaMoveRec[]
  /** a linha vencedora no tabuleiro grande */
  winLine: [number, number, number] | null
}

export type VelhaEvent =
  | { type: 'start'; white: string; black: string }
  | { type: 'move'; color: Side; board: number; cell: number; closed: Small }
  | DuelEvent<VelhaEndReason>

export function describeResult(r: VelhaResult, x: string, o: string): string {
  const common = describeDuelEnd(r, x, o)
  if (common) return common
  if (r.reason === 'linha') return `${r.winner === 'w' ? x : o} fez três tabuleiros em linha e venceu.`
  return 'Ninguém consegue mais fazer três em linha. Deu velha: empate.'
}

export type { Side }
