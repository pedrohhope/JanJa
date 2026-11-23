import type { Card } from './cards'

export type PifeOptions = Record<string, never>

export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 8
/** prazo para comprar ou descartar; quem está fora da sala joga rápido */
export const DECIDE_MS = 40_000
export const AWAY_MS = 3_000

export type DrawFrom = 'monte' | 'lixo'

export type PifeAction =
  | { type: 'draw'; from: DrawFrom; ref: number }
  | { type: 'discard'; card: Card; ref: number }
  /** bater: sem `discard`, o jogo acha sozinho a carta que sobra (ou bate com todas) */
  | { type: 'bater'; discard?: Card; ref: number }

/** a ação sem o `ref` (a SALA completa com a vez que a pessoa viu) */
export type PifeIntent = PifeAction extends infer A ? (A extends { ref: number } ? Omit<A, 'ref'> : never) : never

export type PifePhase = 'comprar' | 'descartar' | 'fim'

export interface PifePlayerView {
  playerId: string
  name: string
  index: number
  cards: number
  away: boolean
}

export interface PifeWin {
  p: number
  melds: Card[][]
  /** carta que descartou ao bater (null = bateu com todas) */
  discard: Card | null
}

export interface PifeView {
  you: { playerId: string; index: number } | null
  players: PifePlayerView[]
  /** suas cartas, na ordem do servidor (a tela arruma do jeito que você quiser) */
  hand: Card[]
  turn: number | null
  phase: PifePhase
  /** carta que você comprou nesta vez (para destacar) */
  drawn: Card | null
  /** dá para bater agora (sua vez, depois de comprar) */
  canWin: boolean
  /** carta de cima do lixo e quantas tem */
  top: Card | null
  discards: number
  stock: number
  /** o que a pessoa da vez fez por último: comprou do monte, pegou do lixo */
  took: { p: number; from: DrawFrom } | null
  winner: PifeWin | null
  /** no fim: a mão de todo mundo */
  hands: Card[][] | null
  ref: number
  until: number | null
  serverNow: number
  log: string[]
}

export type PifeEvent =
  | { type: 'start'; first: number }
  | { type: 'draw'; p: number; from: DrawFrom; card: Card | null }
  | { type: 'discard'; p: number; card: Card }
  | { type: 'reshuffle'; count: number }
  | { type: 'end'; winner: number; melds: Card[][] }
