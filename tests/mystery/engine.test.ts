import { describe, expect, it } from 'vitest'
import { ALL_CARDS, tripleText } from '../../src/shared/games/mystery/cards'
import { apply, nextDeadline, setPresence, setup, tick, view, type MysteryState } from '../../src/shared/games/mystery/engine'
import { distances, reachable, START } from '../../src/shared/games/mystery/board'
import { AWAY_MS, ROLL_MS, SHOW_MS, SUGGEST_MS, type MysteryAction, type Triple } from '../../src/shared/games/mystery/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(4) })
const players = (n: number) => ['Ana', 'Bia', 'Caio', 'Duda'].slice(0, n).map((name, i) => ({ playerId: `p${i}`, name }))
const SOL: Triple = { quem: 'bene', onde: 'porao', como: 'lanterna' }

/** mesa combinada: Ana começa, mãos e solução fixas */
function table(hands: string[][]): MysteryState {
  const s = setup(players(hands.length), {}, ctx()).state
  s.hands = hands
  s.solution = { ...SOL }
  s.turn = 0
  return s
}
function act(s: MysteryState, p: number, a: MysteryAction, now = T0): MysteryState {
  const r = apply(s, `p${p}`, a, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r.state
}
/** palpite direto: põe a pessoa dentro do cômodo do palpite, como se tivesse acabado de entrar */
function suggest(state: MysteryState, p: number, t: Triple): MysteryState {
  const s = structuredClone(state)
  s.phase = 'palpite'
  s.players[p].pos = t.onde
  return act(s, p, { type: 'suggest', ...t })
}

describe('Mistério', () => {
  it('uma de cada no envelope e o resto distribuído, sem repetir', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = setup(
        Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` })),
        {},
        ctx()
      ).state
      const dealt = s.hands.flat()
      expect(dealt).toHaveLength(ALL_CARDS.length - 3)
      expect(new Set([...dealt, s.solution.quem, s.solution.onde, s.solution.como]).size).toBe(ALL_CARDS.length)
      const sizes = s.hands.map((h) => h.length)
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    }
  })

  it('texto do palpite com as preposições certas', () => {
    expect(tripleText({ quem: 'bene', onde: 'porao', como: 'lanterna' })).toBe('Tio Bené, no Porão, com a Lanterna')
    expect(tripleText({ quem: 'odete', onde: 'cozinha', como: 'pe-de-cabra' })).toBe('Dona Odete, na Cozinha, com o Pé de cabra')
  })

  it('quem mostra é o próximo da roda que tem alguma; com uma só, o jogo mostra sozinho', () => {
    let s = table([['odete'], ['valdir'], ['cozinha'], ['lia']])
    s = suggest(s, 0, { quem: 'lia', onde: 'cozinha', como: 'escada' })
    // Bia não tem nenhuma; Caio tem a Cozinha (uma só): mostra sozinho, antes da Duda
    expect(s.phase).toBe('depois')
    expect(s.history[0]).toMatchObject({ shownBy: 2, card: 'cozinha' })
  })

  it('a carta mostrada só aparece para quem palpitou e para quem mostrou', () => {
    let s = table([['odete'], ['cozinha'], ['valdir']])
    s = suggest(s, 0, { quem: 'lia', onde: 'cozinha', como: 'escada' })
    expect(view(s, 'p0', T0).history[0].card).toBe('cozinha')
    expect(view(s, 'p1', T0).history[0].card).toBe('cozinha')
    expect(view(s, 'p2', T0).history[0].card).toBeUndefined()
    expect(view(s, 'p2', T0).history[0].shownBy).toBe(1)
    expect(view(s, null, T0).history[0].card).toBeUndefined()
    // o peão na Cozinha é público; as cartas não
    expect(JSON.stringify(view(s, 'p2', T0).players.map(({ pos: _pos, ...p }) => p))).not.toContain('cozinha')
    expect(view(s, 'p2', T0).solution).toBeNull()
  })

  it('com mais de uma, quem mostra escolhe (e só entre as que servem)', () => {
    let s = table([['odete'], ['lia', 'cozinha', 'tesoura']])
    s = suggest(s, 0, { quem: 'lia', onde: 'cozinha', como: 'escada' })
    expect(s.phase).toBe('mostrar')
    expect(view(s, 'p1', T0).myChoices).toEqual(['lia', 'cozinha'])
    expect(view(s, 'p0', T0).myChoices).toEqual([])
    expect(isGameError(apply(s, 'p1', { type: 'show', card: 'tesoura' }, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'p0', { type: 'show', card: 'odete' }, ctx()))).toBe(true)
    s = act(s, 1, { type: 'show', card: 'lia' })
    expect(view(s, 'p0', T0).history[0].card).toBe('lia')
    // depois do palpite: acusa ou termina a vez
    s = act(s, 0, { type: 'end' })
    expect(s.turn).toBe(1)
  })

  it('ninguém tem: fica registrado e quem palpitou segue', () => {
    let s = table([['odete'], ['valdir']])
    s = suggest(s, 0, SOL)
    expect(s.history[0].shownBy).toBeNull()
    expect(s.phase).toBe('depois')
  })

  it('acusação certa vence; errada sai, vê a solução e continua mostrando cartas', () => {
    let s = table([['odete'], ['valdir'], ['lia']])
    s = act(s, 0, { type: 'accuse', quem: 'rafa', onde: 'porao', como: 'lanterna' })
    expect(s.players[0].out).toBe(true)
    expect(view(s, 'p0', T0).solution).toEqual(SOL)
    expect(view(s, 'p1', T0).solution).toBeNull()
    expect(s.turn).toBe(1)
    // quem saiu ainda mostra carta
    s = suggest(s, 1, { quem: 'lia', onde: 'jardim', como: 'escada' })
    s = act(s, 1, { type: 'end' })
    expect(s.turn).toBe(2) // Ana saiu: não joga mais
    s = act(s, 2, { type: 'accuse', ...SOL })
    expect(s.phase).toBe('fim')
    expect(s.winner).toBe(2)
    expect(view(s, 'p1', T0).solution).toEqual(SOL)
  })

  it('sobrou um no jogo: ele vence', () => {
    let s = table([['odete'], ['valdir']])
    s = act(s, 0, { type: 'accuse', quem: 'rafa', onde: 'porao', como: 'lanterna' })
    expect(s.phase).toBe('fim')
    expect(s.winner).toBe(1)
  })

  it('não dá para palpitar duas vezes nem jogar fora da vez', () => {
    let s = table([['odete'], ['valdir']])
    expect(isGameError(apply(s, 'p1', { type: 'suggest', ...SOL }, ctx()))).toBe(true)
    s = suggest(s, 0, SOL)
    expect(isGameError(apply(s, 'p0', { type: 'suggest', ...SOL }, ctx()))).toBe(true)
  })

  it('prazos: passa a vez sozinho e mostra a primeira carta que servir', () => {
    let s = table([['odete'], ['lia', 'cozinha']])
    expect(nextDeadline(s)).toBe(T0 + ROLL_MS)
    s = tick(s, ctx(T0 + ROLL_MS)).state
    expect(s.turn).toBe(1)
    expect(s.phase).toBe('rolar')
    s.phase = 'palpite'
    s.until = T0 + SUGGEST_MS
    s = tick(s, ctx(T0 + SUGGEST_MS)).state
    expect(s.turn).toBe(0)
    s = table([['odete'], ['lia', 'cozinha']])
    s = suggest(s, 0, { quem: 'lia', onde: 'cozinha', como: 'escada' })
    s = tick(s, ctx(T0 + SHOW_MS)).state
    expect(s.history[0]).toMatchObject({ shownBy: 1, card: 'lia' })
  })

  it('todo mundo começa no Saguão; rola, anda e só palpita no cômodo em que entrou', () => {
    let s = table([['odete'], ['valdir']])
    expect(s.players.every((p) => p.pos === START)).toBe(true)
    expect(isGameError(apply(s, 'p0', { type: 'suggest', ...SOL }, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'p0', { type: 'move', to: 'biblioteca' }, ctx()))).toBe(true)
    s = act(s, 0, { type: 'roll' })
    expect(s.phase).toBe('andar')
    expect(isGameError(apply(s, 'p0', { type: 'roll' }, ctx()))).toBe(true)
    // dados combinados: 2 + 1 = 3 passos, a Biblioteca fica a 3 do Saguão
    s.dice = [2, 1]
    const v = view(s, 'p1', T0)
    expect(v.reach).toContain('biblioteca')
    expect(v.reach).not.toContain('porao')
    expect(v.reach).not.toContain(START)
    expect(isGameError(apply(s, 'p0', { type: 'move', to: 'porao' }, ctx()))).toBe(true)
    s = act(s, 0, { type: 'move', to: 'biblioteca' })
    expect(s.phase).toBe('palpite')
    expect(view(s, 'p1', T0).players[0].pos).toBe('biblioteca')
    // o lugar do palpite é o cômodo em que está
    expect(isGameError(apply(s, 'p0', { type: 'suggest', ...SOL }, ctx()))).toBe(true)
    s = act(s, 0, { type: 'suggest', quem: 'valdir', onde: 'biblioteca', como: 'escada' })
    expect(s.history[0]).toMatchObject({ shownBy: 1, card: 'valdir' })
    s = act(s, 0, { type: 'end' })
    expect(s.turn).toBe(1)
    expect(s.dice).toBeNull()
  })

  it('parar no corredor ou no Saguão passa a vez; acusar vale antes de rolar', () => {
    let s = table([['odete'], ['valdir']])
    s = act(s, 0, { type: 'roll' })
    const cell = view(s, 'p0', T0).reach.find((p) => p.includes(','))!
    s = act(s, 0, { type: 'move', to: cell })
    expect(s.turn).toBe(1)
    expect(s.players[0].pos).toBe(cell)
    s = act(s, 1, { type: 'accuse', ...SOL })
    expect(s.winner).toBe(1)
  })

  it('não volta para o cômodo de onde saiu na mesma vez', () => {
    expect(reachable('cozinha', 12)).not.toContain('cozinha')
    expect(reachable('cozinha', 12)).toContain('porao')
    expect(distances(START).get('biblioteca')).toBe(3)
  })

  it('quem sai da sala na vez dele joga rápido', () => {
    const s = table([['odete'], ['valdir']])
    expect(setPresence(s, 'p0', false, ctx(T0 + 5)).state.until).toBe(T0 + 5 + AWAY_MS)
  })
})
