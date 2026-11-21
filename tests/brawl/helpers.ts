import { ARENAS } from '../../src/shared/games/brawl/arenas'
import { brawlSim } from '../../src/shared/games/brawl/sim'
import { BOT_SLOT_BASE, CHARACTER_IDS, COUNTDOWN_TICKS, type BrawlInput, type BrawlSimEvent, type BrawlSimOptions, type BrawlSimPlayerRef, type BrawlSimState, type CharacterId, type Fighter } from '../../src/shared/games/brawl/types'

export const OPTS: BrawlSimOptions = { arenaId: 'estante', mode: 'vidas', stocks: 3, minutes: 2, teamSize: 0, friendlyFire: false, botLevel: 'dificil' }

export const humans = (n: number, chars: readonly CharacterId[] = CHARACTER_IDS): BrawlSimPlayerRef[] =>
  Array.from({ length: n }, (_, i) => ({ slot: i, id: `player-${i}`, bot: false, char: chars[i % chars.length], team: i }))
export const bots = (n: number, chars: readonly CharacterId[] = CHARACTER_IDS): BrawlSimPlayerRef[] =>
  Array.from({ length: n }, (_, i) => ({ slot: BOT_SLOT_BASE + i, id: `bot-${i + 1}`, bot: true, char: chars[i % chars.length], team: BOT_SLOT_BASE + i }))

export function make(players: BrawlSimPlayerRef[], o: Partial<BrawlSimOptions> = {}, seed = 7): BrawlSimState {
  return brawlSim.create(players, { ...OPTS, ...o }, seed)
}

/** avança até o fim da contagem (o próximo step já é com controle) */
export function skipCountdown(s: BrawlSimState): void {
  while (s.tick < COUNTDOWN_TICKS) brawlSim.step(s, new Map())
}

export const fighter = (s: BrawlSimState, slot: number): Fighter => s.fighters.find((f) => f.slot === slot)!

let seqs = new Map<number, number>()
export function resetSeq(): void {
  seqs = new Map()
}
export const input = (slot: number, p: Partial<Omit<BrawlInput, 'seq'>> = {}): Map<number, BrawlInput> => {
  const seq = (seqs.get(slot) ?? 0) + 1
  seqs.set(slot, seq)
  return new Map([[slot, { seq, mx: 0, my: 0, buttons: 0, ...p }]])
}

export function stepN(s: BrawlSimState, n: number, inputs: () => Map<number, BrawlInput> = () => new Map()): BrawlSimEvent[] {
  const evs: BrawlSimEvent[] = []
  for (let i = 0; i < n; i++) evs.push(...brawlSim.step(s, inputs()))
  return evs
}

/** coloca o lutador no chão de uma plataforma, parado */
export function stand(f: Fighter, x: number, y: number): void {
  f.x = x
  f.y = y
  f.vx = 0
  f.vy = 0
  f.grounded = true
  f.action = 'parado'
}

export const solids = (s: BrawlSimState) => ARENAS[s.arenaId].platforms.filter((p) => !p.thin)

/** LCG para entradas aleatórias dos testes */
export function lcg(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    return a / 4294967296
  }
}

let rseq = new Map<number, number>()
export function randomInputs(s: BrawlSimState, rnd: () => number, noPick = false): Map<number, BrawlInput> {
  const m = new Map<number, BrawlInput>()
  for (const f of s.fighters) {
    if (f.bot) continue
    const seq = (rseq.get(f.slot) ?? 0) + 1
    rseq.set(f.slot, seq)
    const pick = noPick ? 0 : rnd() < 0.05 ? 16 : 0
    // botões em rajadas curtas
    const buttons = (rnd() < 0.08 ? 1 : 0) | (rnd() < 0.08 ? 2 : 0) | (rnd() < 0.04 ? 4 : 0) | (rnd() < 0.02 ? 8 : 0) | pick
    m.set(f.slot, { seq, mx: rnd() < 0.6 ? Math.floor(rnd() * 3) - 1 : 0, my: rnd() < 0.2 ? Math.floor(rnd() * 3) - 1 : 0, buttons })
  }
  return m
}
export const resetRandomSeq = (): void => {
  rseq = new Map()
}
