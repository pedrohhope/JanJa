/**
 * Motor da Velha ao quadrado: duas pessoas, uma de cada vez, com relógio opcional.
 * Funções puras (tempo e sorteio só via GameCtx). Relógio, empate, desistência e quem sai da sala
 * ficam em ../duel.ts (iguais ao xadrez e às damas). Tudo é público: os dois veem o tabuleiro inteiro.
 */
import { afterMove, applyDuelAction, duelDeadline, duelView, finish, markPresence, newDuel, otherSide, overdue, parseMinutes, sideOf, spendClock, type Duel } from '../duel'
import type { GameCtx, GameError, PlayerRef, Step } from '../types'
import { bigLinePossible, initial, isLegal, legalMoves, LINES, moveText, play, winnerOf, type Pos } from './rules'
import { DEFAULT_VELHA_OPTIONS, markOf, sideOfMark, type VelhaAction, type VelhaEndReason, type VelhaEvent, type VelhaMoveRec, type VelhaOptions, type VelhaView } from './types'

export interface VelhaState extends Duel<VelhaEndReason> {
  options: VelhaOptions
  pos: Pos
  moves: VelhaMoveRec[]
}

type S = Step<VelhaState, VelhaEvent>

const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)
const turnSide = (s: VelhaState) => sideOfMark(s.pos.turn)
const idx = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 8

export const parseOptions = (raw: unknown): VelhaOptions | GameError => parseMinutes(raw, DEFAULT_VELHA_OPTIONS.minutes)

export function parseAction(raw: unknown): VelhaAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Lance inválido.')
  const a = raw as Record<string, unknown>
  if (a.type === 'resign' || a.type === 'draw' || a.type === 'decline') return { type: a.type }
  if (a.type !== 'move') return err('acao-invalida', 'Ação desconhecida.')
  if (!idx(a.board) || !idx(a.cell)) return err('acao-invalida', 'Lance inválido.')
  return { type: 'move', board: a.board, cell: a.cell }
}

function expire(s: VelhaState, now: number, events: VelhaEvent[]): boolean {
  const turn = turnSide(s)
  const due = overdue(s, turn, now)
  if (!due) return false
  if (due.kind === 'tempo') {
    spendClock(s, turn, due.at)
    finish(s, { winner: otherSide(turn), reason: 'tempo' }, events)
  } else {
    spendClock(s, turn, now)
    finish(s, { winner: due.both ? null : otherSide(due.gone), reason: 'abandono' }, events)
  }
  return true
}

function checkEnd(s: VelhaState, events: VelhaEvent[]): void {
  const w = winnerOf(s.pos.small)
  if (w) return finish(s, { winner: sideOfMark(w), reason: 'linha' }, events)
  if (!legalMoves(s.pos).length || (!bigLinePossible(s.pos.small, 'x') && !bigLinePossible(s.pos.small, 'o'))) {
    finish(s, { winner: null, reason: 'velha' }, events)
  }
}

export function setup(players: PlayerRef[], options: VelhaOptions, ctx: GameCtx, pos?: Pos): S {
  const s: VelhaState = { ...newDuel<VelhaEndReason>(players, options.minutes, ctx), options, pos: pos ?? initial(), moves: [] }
  return { state: s, events: [{ type: 'start', white: s.players.w.playerId, black: s.players.b.playerId }] }
}

export function apply(state: VelhaState, playerId: string, action: VelhaAction, ctx: GameCtx): S | GameError {
  if (state.result) return err('partida-encerrada', 'A partida acabou.')
  const me = sideOf(state, playerId)
  if (!me) return err('nao-e-sua-vez', 'Você não está jogando.')
  const s = clone(state)
  const events: VelhaEvent[] = []
  if (expire(s, ctx.now, events)) return { state: s, events }
  if (action.type !== 'move') {
    const e = applyDuelAction(s, me, action, events)
    return e ?? { state: s, events }
  }
  if (turnSide(s) !== me) return err('nao-e-sua-vez', 'Espere a sua vez.')
  if (!isLegal(s.pos, action)) {
    if (s.pos.forced !== null && action.board !== s.pos.forced) return err('acao-invalida', 'Você tem que jogar no tabuleiro destacado.')
    return err('acao-invalida', 'Essa casa não vale.')
  }
  spendClock(s, me, ctx.now)
  const mark = markOf(me)
  const { pos, closed } = play(s.pos, action)
  s.pos = pos
  s.moves.push({ board: action.board, cell: action.cell, mark, closed, text: moveText(action) })
  afterMove(s, me)
  events.push({ type: 'move', color: me, board: action.board, cell: action.cell, closed })
  checkEnd(s, events)
  return { state: s, events }
}

export function tick(state: VelhaState, ctx: GameCtx): S {
  if (!overdue(state, turnSide(state), ctx.now)) return { state, events: [] }
  const s = clone(state)
  const events: VelhaEvent[] = []
  expire(s, ctx.now, events)
  return { state: s, events }
}

export const nextDeadline = (s: VelhaState): number | null => duelDeadline(s, turnSide(s))

export function setPresence(state: VelhaState, playerId: string, present: boolean, ctx: GameCtx): S {
  const s = clone(state)
  return markPresence(s, playerId, present, ctx.now) ? { state: s, events: [] } : { state, events: [] }
}

export function view(s: VelhaState, playerId: string | null, now: number): VelhaView {
  const color = playerId ? sideOf(s, playerId) : null
  const turn = turnSide(s)
  const mine = !s.result && color === turn ? legalMoves(s.pos) : []
  const w = winnerOf(s.pos.small)
  const line = w ? LINES.find((l) => l.every((b) => s.pos.small[b] === w)) : undefined
  const last = s.moves[s.moves.length - 1]
  return {
    ...duelView(s, turn, s.options.minutes, now),
    you: color && playerId ? { playerId, color } : null,
    board: s.pos.board.map((r) => r.slice()),
    small: s.pos.small.slice(),
    forced: s.result ? null : s.pos.forced,
    turn,
    legal: mine.map((m) => [m.board, m.cell]),
    lastMove: last ? { ...last } : null,
    moves: s.moves.map((m) => ({ ...m })),
    winLine: line ? [line[0], line[1], line[2]] : null
  }
}

export const isOver = (s: VelhaState): boolean => s.result !== null
