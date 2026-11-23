/**
 * Pife: baralho, jogos e batida (puro).
 *
 * Dois baralhos de 52 com os 4 coringas (108 cartas). Carta = valor + naipe + "." + cópia:
 * "Ah.1" (ás de copas do primeiro baralho), "10s.2", "Qd.1"; coringa "JK.1" a "JK.4".
 * Valores: A 2..10 J Q K; naipes: c paus, d ouros, h copas, s espadas.
 *
 * Jogos (de 3 cartas ou mais):
 * - trinca: o mesmo valor, de qualquer naipe (pode repetir), sem coringa;
 * - sequência: o mesmo naipe em ordem, sem repetir valor. O ás vale antes do 2 ou depois do K (não dá a
 *   volta). O coringa entra no lugar de qualquer carta da sequência, mas ela precisa de uma carta de verdade.
 *
 * Bater: com a carta comprada (10 na mão), todas as cartas formam jogos, ou todas menos a que você descarta.
 */
export type Card = string
export type Suit = 'c' | 'd' | 'h' | 's'

export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's']
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
export type Rank = (typeof RANKS)[number]

export const HAND = 9

/** os dois baralhos com os coringas, em ordem */
export function fullDeck(): Card[] {
  const out: Card[] = []
  for (const copy of [1, 2]) for (const s of SUITS) for (const r of RANKS) out.push(`${r}${s}.${copy}`)
  for (let j = 1; j <= 4; j++) out.push(`JK.${j}`)
  return out
}

const DECK_SET = new Set(fullDeck())
export const isCard = (x: unknown): x is Card => typeof x === 'string' && DECK_SET.has(x)

export const isJoker = (c: Card): boolean => c.startsWith('JK')
/** valor e naipe (coringa: null) */
export function parts(c: Card): { rank: Rank; suit: Suit } | null {
  if (isJoker(c)) return null
  const face = c.slice(0, c.indexOf('.'))
  return { rank: face.slice(0, -1) as Rank, suit: face.slice(-1) as Suit }
}
/** 1 (ás) a 13 (rei) */
export const valueOf = (r: Rank): number => RANKS.indexOf(r) + 1

const SUIT_NAME: Record<Suit, string> = { c: 'paus', d: 'ouros', h: 'copas', s: 'espadas' }
const RANK_NAME: Partial<Record<Rank, string>> = { A: 'Ás', J: 'Valete', Q: 'Dama', K: 'Rei' }

/** "7 de copas", "Dama de espadas", "Coringa" */
export function cardName(c: Card): string {
  const p = parts(c)
  if (!p) return 'Coringa'
  return `${RANK_NAME[p.rank] ?? p.rank} de ${SUIT_NAME[p.suit]}`
}

export type MeldKind = 'trinca' | 'sequencia'

/** Que jogo estas cartas formam (null = nenhum). */
export function meldKind(cards: readonly Card[]): MeldKind | null {
  if (cards.length < 3) return null
  const nat = cards.filter((c) => !isJoker(c)).map((c) => parts(c)!)
  const jokers = cards.length - nat.length
  if (!nat.length) return null
  // trinca: tudo do mesmo valor, sem coringa
  if (!jokers && nat.every((p) => p.rank === nat[0].rank)) return 'trinca'
  // sequência: mesmo naipe, sem valor repetido, coringas tapam os buracos
  if (!nat.every((p) => p.suit === nat[0].suit)) return null
  const n = cards.length
  if (n > 13) return null
  for (const aceHigh of [false, true]) {
    const vals = nat.map((p) => (p.rank === 'A' && aceHigh ? 14 : valueOf(p.rank))).sort((a, b) => a - b)
    if (vals.some((v, i) => i > 0 && v === vals[i - 1])) continue
    const lo = vals[0]
    const hi = vals[vals.length - 1]
    if (hi - lo + 1 > n) continue
    // cabe n cartas seguidas contendo [lo, hi] dentro de 1..13 (ás embaixo) ou 2..14 (ás em cima)
    const min = aceHigh ? 2 : 1
    const max = aceHigh ? 14 : 13
    const start = Math.max(min, hi - n + 1)
    if (start <= lo && start + n - 1 <= max) return 'sequencia'
  }
  return null
}

/**
 * Divide todas as `cards` em jogos (null = não dá). Busca com volta atrás: a mão tem no máximo 10 cartas.
 * Prefere jogos de 3 primeiro e cartas na ordem dada, então o resultado é estável.
 */
export function splitIntoMelds(cards: readonly Card[]): Card[][] | null {
  if (!cards.length) return []
  if (cards.length < 3) return null
  const [first, ...rest] = cards
  // o jogo que contém a primeira carta: tenta todos os subconjuntos do resto de tamanho 2..(n-1)
  const n = rest.length
  for (let size = 2; size <= n; size++) {
    // depois deste jogo tem que sobrar 0 ou pelo menos 3 cartas
    const left = n - size
    if (left > 0 && left < 3) continue
    const combo: number[] = []
    const found = pick(0, size, combo)
    if (found) return found
  }
  return null

  function pick(from: number, size: number, combo: number[]): Card[][] | null {
    if (combo.length === size) {
      const meld = [first, ...combo.map((i) => rest[i])]
      if (!meldKind(meld)) return null
      const others = rest.filter((_, i) => !combo.includes(i))
      const tail = splitIntoMelds(others)
      return tail ? [meld, ...tail] : null
    }
    for (let i = from; i <= n - (size - combo.length); i++) {
      combo.push(i)
      const r = pick(i + 1, size, combo)
      combo.pop()
      if (r) return r
    }
    return null
  }
}

/**
 * Jeito de bater com esta mão (10 cartas, depois de comprar): os jogos e a carta descartada
 * (null = bateu com todas). Com `discard`, só tenta descartando ela. null = não dá para bater.
 */
export function findWin(hand: readonly Card[], discard?: Card): { melds: Card[][]; discard: Card | null } | null {
  if (discard === undefined) {
    const all = splitIntoMelds(hand)
    if (all) return { melds: all, discard: null }
  }
  const tries = discard !== undefined ? [discard] : hand
  for (const d of tries) {
    const i = hand.indexOf(d)
    if (i < 0) continue
    const melds = splitIntoMelds(hand.filter((_, k) => k !== i))
    if (melds) return { melds, discard: d }
  }
  return null
}

/**
 * Melhor arrumação parcial (para organizar a mão e para o bot): jogos prontos que somam o máximo
 * de cartas, e o que sobra. Guloso nos jogos maiores, com volta atrás limitada (mão pequena).
 */
export function bestMelds(hand: readonly Card[]): { melds: Card[][]; loose: Card[] } {
  const cards = [...hand]
  const n = cards.length
  const bits = (mask: number) => {
    let k = 0
    for (let m = mask; m; m &= m - 1) k++
    return k
  }
  // todos os jogos possíveis (subconjuntos de 3 cartas ou mais), como máscaras de bits, por menor carta
  const byLowest: number[][] = Array.from({ length: n }, () => [])
  for (let mask = 1; mask < 1 << n; mask++) {
    if (bits(mask) < 3) continue
    if (meldKind(cards.filter((_, i) => mask & (1 << i)))) byLowest[31 - Math.clz32(mask & -mask)].push(mask)
  }
  let best = { used: 0, chosen: [] as number[] }
  // decide carta por carta: a menor ainda livre fica solta ou abre um jogo que a contém
  const go = (i: number, used: number, chosen: number[]) => {
    while (i < n && used & (1 << i)) i++
    const total = bits(used)
    if (total > best.used) best = { used: total, chosen: [...chosen] }
    if (i >= n || total + (n - i) <= best.used) return
    for (const m of byLowest[i]) if (!(m & used)) go(i + 1, used | m, [...chosen, m])
    go(i + 1, used, chosen)
  }
  go(0, 0, [])
  const melds = best.chosen.map((m) => cards.filter((_, i) => m & (1 << i)))
  const usedCards = new Set(melds.flat())
  return { melds, loose: cards.filter((c) => !usedCards.has(c)) }
}

/** ordem para mostrar: valor dentro do naipe, coringas no fim */
export function sortCards(cards: readonly Card[]): Card[] {
  const key = (c: Card) => {
    const p = parts(c)
    return p ? SUITS.indexOf(p.suit) * 100 + valueOf(p.rank) : 1000
  }
  return [...cards].sort((a, b) => key(a) - key(b) || a.localeCompare(b))
}
