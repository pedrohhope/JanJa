/**
 * Motor do pife (rodada avulsa, 2 a 8 pessoas). Funções puras: sorteio e tempo só via GameCtx.
 * Na sua vez: compre do monte ou pegue a de cima do lixo, depois descarte uma ou bata.
 * Cada um vê só a própria mão; no fim todo mundo vê tudo.
 */
import type { GameCtx, GameError, PlayerRef, Step } from '../types'
import { shuffle } from '../types'
import { bestMelds, cardName, findWin, fullDeck, HAND, isCard, type Card } from './cards'
import { AWAY_MS, DECIDE_MS, type DrawFrom, type PifeAction, type PifeEvent, type PifeOptions, type PifePhase, type PifeView, type PifeWin } from './types'

export interface PifeState {
  players: Array<{ playerId: string; name: string; away: boolean }>
  hands: Card[][]
  stock: Card[]
  /** lixo: a de cima é a última */
  discard: Card[]
  turn: number
  phase: PifePhase
  /** o que a pessoa da vez comprou nesta vez */
  drawn: { card: Card; from: DrawFrom } | null
  took: { p: number; from: DrawFrom } | null
  winner: PifeWin | null
  ref: number
  until: number | null
  log: string[]
}

type S = Step<PifeState, PifeEvent>
const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)

function say(s: PifeState, text: string): void {
  s.log.push(text)
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40)
}

function arm(s: PifeState, now: number): void {
  s.until = s.phase === 'fim' ? null : now + (s.players[s.turn].away ? AWAY_MS : DECIDE_MS)
}

// ---------- contrato ----------
export const parseOptions = (): PifeOptions => ({})

export function parseAction(raw: unknown): PifeAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Jogada inválida.')
  const a = raw as Record<string, unknown>
  const ref = a.ref
  if (typeof ref !== 'number' || !Number.isInteger(ref) || ref < 0) return err('acao-invalida', 'Jogada inválida.')
  if (a.type === 'draw') return a.from === 'monte' || a.from === 'lixo' ? { type: 'draw', from: a.from, ref } : err('acao-invalida', 'Compre do monte ou do lixo.')
  if (a.type === 'discard') return isCard(a.card) ? { type: 'discard', card: a.card, ref } : err('acao-invalida', 'Carta inválida.')
  if (a.type === 'bater') {
    if (a.discard === undefined) return { type: 'bater', ref }
    return isCard(a.discard) ? { type: 'bater', discard: a.discard, ref } : err('acao-invalida', 'Carta inválida.')
  }
  return err('acao-invalida', 'Jogada desconhecida.')
}

export function setup(players: PlayerRef[], _o: PifeOptions, ctx: GameCtx): S {
  const deck = shuffle(fullDeck(), ctx.rng)
  const hands = players.map(() => deck.splice(0, HAND))
  const first = ctx.rng.int(players.length)
  const s: PifeState = {
    players: players.map((p) => ({ playerId: p.playerId, name: p.name, away: false })),
    hands,
    discard: [deck.pop() as Card],
    stock: deck,
    turn: first,
    phase: 'comprar',
    drawn: null,
    took: null,
    winner: null,
    ref: 0,
    until: null,
    log: [`${players[first].name} começa.`]
  }
  arm(s, ctx.now)
  return { state: s, events: [{ type: 'start', first }] }
}

/** Faz a jogada de `p` (já conferida a vez). Também usada pelo prazo estourado. */
function act(s: PifeState, p: number, a: PifeAction, ctx: GameCtx, events: PifeEvent[]): GameError | null {
  const hand = s.hands[p]
  const name = s.players[p].name
  switch (a.type) {
    case 'draw': {
      if (s.phase !== 'comprar') return err('acao-invalida', 'Você já comprou. Agora descarte uma carta ou bata.')
      let card: Card
      if (a.from === 'lixo') {
        if (!s.discard.length) return err('acao-invalida', 'O lixo está vazio.')
        card = s.discard.pop() as Card
      } else {
        if (!s.stock.length) {
          // acabou o monte: o lixo (menos a de cima) vira monte de novo
          const top = s.discard.pop()
          s.stock = shuffle(s.discard, ctx.rng)
          s.discard = top ? [top] : []
          events.push({ type: 'reshuffle', count: s.stock.length })
          say(s, 'O monte acabou: o lixo foi embaralhado e virou monte.')
        }
        if (!s.stock.length) return err('acao-invalida', 'Não tem mais carta no monte.')
        card = s.stock.pop() as Card
      }
      hand.push(card)
      s.drawn = { card, from: a.from }
      s.took = { p, from: a.from }
      s.phase = 'descartar'
      events.push({ type: 'draw', p, from: a.from, card: a.from === 'lixo' ? card : null })
      if (a.from === 'lixo') say(s, `${name} pegou ${cardName(card)} do lixo.`)
      return null
    }
    case 'discard': {
      if (s.phase !== 'descartar') return err('acao-invalida', 'Primeiro compre do monte ou do lixo.')
      const i = hand.indexOf(a.card)
      if (i < 0) return err('acao-invalida', 'Essa carta não está na sua mão.')
      if (s.drawn?.from === 'lixo' && s.drawn.card === a.card) return err('acao-invalida', 'Não dá para devolver ao lixo a carta que você pegou dele.')
      hand.splice(i, 1)
      s.discard.push(a.card)
      events.push({ type: 'discard', p, card: a.card })
      s.drawn = null
      s.turn = (p + 1) % s.players.length
      s.phase = 'comprar'
      s.took = null
      return null
    }
    case 'bater': {
      if (s.phase !== 'descartar') return err('acao-invalida', 'Para bater, primeiro compre uma carta.')
      if (a.discard !== undefined && !hand.includes(a.discard)) return err('acao-invalida', 'Essa carta não está na sua mão.')
      const fromLixo = s.drawn?.from === 'lixo' ? s.drawn.card : null
      if (a.discard !== undefined && a.discard === fromLixo) return err('acao-invalida', 'Não dá para devolver ao lixo a carta que você pegou dele.')
      // sem carta escolhida, o jogo acha uma (nunca a que veio do lixo)
      const win = a.discard !== undefined ? findWin(hand, a.discard) : pickWin(hand, fromLixo)
      if (!win) return err('acao-invalida', 'Ainda não dá para bater: as cartas não fecham em jogos.')
      if (win.discard) {
        hand.splice(hand.indexOf(win.discard), 1)
        s.discard.push(win.discard)
        events.push({ type: 'discard', p, card: win.discard })
      }
      s.winner = { p, melds: win.melds, discard: win.discard }
      s.phase = 'fim'
      s.until = null
      s.drawn = null
      events.push({ type: 'end', winner: p, melds: win.melds })
      say(s, `${name} bateu!`)
      return null
    }
  }
}

/** batida que não descarta a carta `keep` (veio do lixo) */
function pickWin(hand: Card[], keep: Card | null): ReturnType<typeof findWin> {
  const all = findWin(hand, undefined)
  if (all && all.discard === null) return all
  for (const d of hand) {
    if (d === keep) continue
    const w = findWin(hand, d)
    if (w) return w
  }
  return null
}

export function apply(state: PifeState, playerId: string, a: PifeAction, ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A rodada acabou.')
  const p = state.players.findIndex((x) => x.playerId === playerId)
  if (p < 0) return err('nao-e-sua-vez', 'Você não está jogando.')
  if (state.turn !== p) return err('nao-e-sua-vez', 'Espere a sua vez.')
  if (a.ref !== state.ref) return err('acao-invalida', 'A mesa mudou. Tente de novo.')
  const s = clone(state)
  const events: PifeEvent[] = []
  const e = act(s, p, a, ctx, events)
  if (e) return e
  s.ref++
  arm(s, ctx.now)
  return { state: s, events }
}

/** Prazo estourado: compra do monte; na hora de descartar, joga fora a carta que menos ajuda. */
export function autoAction(s: PifeState): PifeAction {
  if (s.phase === 'comprar') return { type: 'draw', from: 'monte', ref: s.ref }
  const hand = s.hands[s.turn]
  const keep = s.drawn?.from === 'lixo' ? s.drawn.card : null
  const loose = bestMelds(hand).loose.filter((c) => c !== keep)
  const card = s.drawn && s.drawn.from === 'monte' && loose.includes(s.drawn.card) ? s.drawn.card : (loose[loose.length - 1] ?? hand.find((c) => c !== keep) ?? hand[0])
  return { type: 'discard', card, ref: s.ref }
}

export function tick(state: PifeState, ctx: GameCtx): S {
  if (state.phase === 'fim' || state.until === null || ctx.now < state.until) return { state, events: [] }
  const s = clone(state)
  const events: PifeEvent[] = []
  const p = s.turn
  if (s.phase === 'comprar') say(s, `${s.players[p].name} demorou: o jogo comprou por ele.`)
  if (!act(s, p, autoAction(s), ctx, events)) s.ref++
  arm(s, ctx.now)
  return { state: s, events }
}

export const nextDeadline = (s: PifeState): number | null => (s.phase === 'fim' ? null : s.until)

export function setPresence(state: PifeState, playerId: string, present: boolean, ctx: GameCtx): S {
  const p = state.players.findIndex((x) => x.playerId === playerId)
  if (p < 0 || state.players[p].away === !present || state.phase === 'fim') return { state, events: [] }
  const s = clone(state)
  s.players[p].away = !present
  if (!present && s.turn === p && s.until !== null) s.until = Math.min(s.until, ctx.now + AWAY_MS)
  return { state: s, events: [] }
}

export function view(s: PifeState, playerId: string | null, now: number): PifeView {
  const i = playerId ? s.players.findIndex((x) => x.playerId === playerId) : -1
  const me = i >= 0 ? i : null
  const myTurn = me !== null && s.turn === me && s.phase === 'descartar'
  return {
    you: me !== null ? { playerId: playerId as string, index: me } : null,
    players: s.players.map((p, k) => ({ playerId: p.playerId, name: p.name, index: k, cards: s.hands[k].length, away: p.away })),
    hand: me !== null ? [...s.hands[me]] : [],
    turn: s.phase === 'fim' ? null : s.turn,
    phase: s.phase,
    drawn: myTurn && s.drawn ? s.drawn.card : null,
    canWin: myTurn && pickWin(s.hands[me as number], s.drawn?.from === 'lixo' ? s.drawn.card : null) !== null,
    top: s.discard[s.discard.length - 1] ?? null,
    discards: s.discard.length,
    stock: s.stock.length,
    took: s.took ? { ...s.took } : null,
    winner: s.winner ? clone(s.winner) : null,
    hands: s.phase === 'fim' ? s.hands.map((h) => [...h]) : null,
    ref: s.ref,
    until: s.until,
    serverNow: now,
    log: s.log.slice(-8)
  }
}

export const isOver = (s: PifeState): boolean => s.phase === 'fim'
