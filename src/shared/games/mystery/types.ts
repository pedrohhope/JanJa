/** um palpite ou acusação: quem, onde e com o quê (ids das cartas) */
export interface Triple {
  quem: string
  onde: string
  como: string
}

export type MysteryOptions = Record<string, never>

/** prazos: rolar os dados, andar, palpitar (ou acusar), mostrar carta e terminar a vez; quem saiu da sala joga rápido */
export const ROLL_MS = 30_000
export const MOVE_MS = 30_000
export const SUGGEST_MS = 60_000
export const SHOW_MS = 30_000
export const AFTER_MS = 30_000
export const AWAY_MS = 3_000

export type MysteryAction =
  | { type: 'roll' }
  /** andar até um cômodo (id) ou uma casa do corredor ("x,y"), dentro do que os dados deixam */
  | { type: 'move'; to: string }
  /** só no cômodo em que acabou de entrar: `onde` tem que ser ele */
  | ({ type: 'suggest' } & Triple)
  | ({ type: 'accuse' } & Triple)
  | { type: 'show'; card: string }
  /** ficar parado (depois de rolar), passar sem palpitar ou terminar depois do palpite */
  | { type: 'end' }

/** rolar: começo da vez; andar: dados na mesa; palpite: entrou num cômodo */
export type MysteryPhase = 'rolar' | 'andar' | 'palpite' | 'mostrar' | 'depois' | 'fim'

export interface MysteryPlayerView {
  playerId: string
  name: string
  index: number
  cards: number
  /** errou a acusação: não joga mais, mas continua mostrando cartas */
  out: boolean
  away: boolean
  /** onde está o peão: id do cômodo ou "x,y" no corredor */
  pos: string
}

export interface SuggestionView extends Triple {
  by: number
  /** quem mostrou (null = ninguém tinha; undefined = ainda procurando) */
  shownBy: number | null
  /** a carta mostrada: só aparece para quem palpitou e para quem mostrou */
  card?: string
}

export interface MysteryView {
  you: { playerId: string; index: number } | null
  players: MysteryPlayerView[]
  /** as suas cartas (só as suas) */
  myCards: string[]
  phase: MysteryPhase
  turn: number | null
  /** os dados da vez (null antes de rolar) */
  dice: [number, number] | null
  /** quantas vezes rolaram na partida (chave da animação) */
  rolls: number
  /** para onde quem joga pode andar (só na fase andar) */
  reach: string[]
  /** palpite em andamento */
  current: SuggestionView | null
  /** quem tem que mostrar agora */
  refuter: number | null
  /** se é você que tem que mostrar: quais das suas cartas servem */
  myChoices: string[]
  history: SuggestionView[]
  accusations: Array<Triple & { by: number; correct: boolean }>
  /** a solução: para quem errou a acusação (em segredo) e para todos no fim */
  solution: Triple | null
  winner: number | null
  until: number | null
  serverNow: number
  log: string[]
}

export type MysteryEvent =
  | { type: 'start'; first: number }
  | { type: 'roll'; by: number; dice: [number, number] }
  | { type: 'move'; by: number; to: string }
  | ({ type: 'suggest'; by: number } & Triple)
  | { type: 'shown'; by: number; to: number }
  | { type: 'none'; by: number }
  | ({ type: 'accuse'; by: number; correct: boolean } & Triple)
  | { type: 'end'; winner: number | null; solution: Triple }
