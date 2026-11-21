import { describe, expect, it } from 'vitest'
import { brawlGame } from '../../src/shared/games/brawl'
import { addPlayer, apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type CoordState } from '../../src/shared/games/brawl/engine'
import {
  COORD_GRACE_S,
  COUNTDOWN_TICKS,
  DEFAULT_BRAWL_OPTIONS,
  PICK_MS,
  STOCK_MODE_MAX_MIN,
  TICK_HZ,
  type BrawlAction,
  type BrawlCoordEvent,
  type BrawlOptions,
  type BrawlScoreLine
} from '../../src/shared/games/brawl/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 5_000_000
const ctx = (now = T0, seed = 7): GameCtx => ({ now, rng: seededRng(seed) })
const humans = [
  { playerId: 'a', name: 'Ana' },
  { playerId: 'b', name: 'Bia' },
  { playerId: 'c', name: 'Caio' }
]
const opts = (o: Partial<BrawlOptions> = {}): BrawlOptions => ({ ...DEFAULT_BRAWL_OPTIONS, ...o })
const line = (id: string, char: BrawlScoreLine['char'] = 'jan', kos = 0, falls = 0, stocks = 3, outTick = 0, damage = 0): BrawlScoreLine => ({ id, char, team: 0, kos, falls, damage, stocks, outTick })

function ok<S, E>(r: { state: S; events: E[] } | { error: string; message: string }): { state: S; events: E[] } {
  if (isGameError(r)) throw new Error(r.message)
  return r as { state: S; events: E[] }
}

const lobby = (n = 3, o: Partial<BrawlOptions> = {}): CoordState => setup(humans.slice(0, n), opts(o), ctx()).state

/** todos prontos: começa a luta */
function fight(n = 3, o: Partial<BrawlOptions> = {}, now = T0 + 1000): CoordState {
  let s = lobby(n, o)
  for (const h of humans.slice(0, n)) s = ok<CoordState, BrawlCoordEvent>(apply(s, h.playerId, { type: 'ready', ready: true }, ctx(now))).state
  expect(s.phase).toBe('jogando')
  return s
}

describe('registro do jogo', () => {
  it('definição', () => {
    expect(brawlGame).toMatchObject({ id: 'brawl', name: 'Briga na Sala', minPlayers: 1, maxPlayers: 8 })
    expect(typeof brawlGame.addPlayer).toBe('function')
    expect(typeof brawlGame.nextDeadline).toBe('function')
  })
})

describe('opções', () => {
  it('padrões e validação', () => {
    expect(parseOptions(undefined)).toEqual(DEFAULT_BRAWL_OPTIONS)
    expect(parseOptions({})).toEqual(DEFAULT_BRAWL_OPTIONS)
    const full = { mode: 'tempo', stocks: 5, minutes: 5, teamSize: 2, friendlyFire: true, arenaId: 'sorteio', bots: 4, botLevel: 'dificil' }
    expect(parseOptions(full)).toEqual(full)
    expect(parseOptions({ arenaId: 'telhado', bots: 2 })).toEqual({ ...DEFAULT_BRAWL_OPTIONS, arenaId: 'telhado', bots: 2 })
    for (const bad of [{ mode: 'x' }, { stocks: 0 }, { stocks: 6 }, { stocks: 2.5 }, { minutes: 4 }, { teamSize: 1 }, { teamSize: 5 }, { friendlyFire: 'sim' }, { arenaId: 'lua' }, { bots: 5 }, { bots: -1 }, { bots: '2' }, { botLevel: 'mestre' }, 'x', [1]]) {
      expect(isGameError(parseOptions(bad)), JSON.stringify(bad)).toBe(true)
    }
  })
})

describe('setup e escolha', () => {
  it('humanos nos slots 0..n-1, robôs no 8, começa na escolha com prazo', () => {
    const r = setup(humans, opts({ bots: 2 }), ctx())
    const s = r.state
    expect(s.players.map((p) => [p.id, p.slot, p.bot, p.name, p.ready])).toEqual([
      ['a', 0, false, 'Ana', false],
      ['b', 1, false, 'Bia', false],
      ['c', 2, false, 'Caio', false],
      ['bot-1', 8, true, 'Robô 1', true],
      ['bot-2', 9, true, 'Robô 2', true]
    ])
    expect(s.players.every((p) => p.present && !p.spectating)).toBe(true)
    expect(s.phase).toBe('escolha')
    expect(s.hostId).toBe('a')
    expect(s.epoch).toBe(1)
    expect(s.pickEndsAt).toBe(T0 + PICK_MS)
    expect(nextDeadline(s)).toBe(T0 + PICK_MS)
    expect(r.events).toEqual([{ type: 'host', hostId: 'a', epoch: 1 }])
    expect(isOver(s)).toBe(false)
    expect(s.scores).toHaveLength(5)
  })

  it('view é igual para todos; you só para quem joga', () => {
    const s = lobby(2, { bots: 1 })
    const va = view(s, 'a', T0)
    const vb = view(s, 'b', T0)
    expect(va.you).toEqual({ playerId: 'a', slot: 0 })
    expect(vb.you).toEqual({ playerId: 'b', slot: 1 })
    expect(view(s, null, T0).you).toBeNull()
    expect(view(s, 'bot-1', T0).you).toBeNull()
    expect({ ...va, you: null }).toEqual({ ...vb, you: null })
    expect(va.phase).toBe('escolha')
    expect(va.ranking).toBeNull()
    expect(va.pickEndsAt).toBe(T0 + PICK_MS)
  })

  it('pick troca de personagem; ready de todos começa a luta', () => {
    let s = lobby(2)
    const p = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', { type: 'pick', char: 'teve' }, ctx(T0 + 10)))
    expect(p.state.players[0].char).toBe('teve')
    expect(p.events).toEqual([{ type: 'pick', id: 'a', char: 'teve' }])
    s = p.state
    // não muta o estado anterior
    expect(lobby(2).players[0].char).not.toBe('teve')
    const r1 = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', { type: 'ready', ready: true }, ctx(T0 + 20)))
    expect(r1.state.phase).toBe('escolha')
    expect(r1.state.players[0].ready).toBe(true)
    // desmarcar volta
    expect(ok<CoordState, BrawlCoordEvent>(apply(r1.state, 'a', { type: 'ready', ready: false }, ctx())).state.players[0].ready).toBe(false)
    const r2 = ok<CoordState, BrawlCoordEvent>(apply(r1.state, 'b', { type: 'ready', ready: true }, ctx(T0 + 30)))
    expect(r2.state.phase).toBe('jogando')
    expect(r2.state.startedAt).toBe(T0 + 30)
    expect(r2.events.map((e) => e.type)).toEqual(['start'])
    const start = r2.events[0] as Extract<BrawlCoordEvent, { type: 'start' }>
    expect(start.arenaId).toBe(r2.state.arenaId)
    expect(start.seed).toBe(r2.state.seed)
    expect(r2.state.players[0].char).toBe('teve')
    expect(r2.state.scores.find((l) => l.id === 'a')!.char).toBe('teve')
    // depois de começar, não troca mais
    const late = apply(r2.state, 'a', { type: 'pick', char: 'jan' }, ctx())
    expect(isGameError(late)).toBe(true)
  })

  it('o prazo da escolha começa a luta com o que estava marcado', () => {
    let s = lobby(3)
    s = ok<CoordState, BrawlCoordEvent>(apply(s, 'b', { type: 'pick', char: 'janja' }, ctx())).state
    expect(tick(s, ctx(T0 + PICK_MS - 1)).state.phase).toBe('escolha')
    const r = tick(s, ctx(T0 + PICK_MS))
    expect(r.state.phase).toBe('jogando')
    expect(r.state.players[1].char).toBe('janja')
    expect(r.state.startedAt).toBe(T0 + PICK_MS)
    expect(nextDeadline(r.state)).toBeGreaterThan(T0 + PICK_MS)
  })

  it('quem sai da escolha não segura a turma; robôs contam como prontos', () => {
    let s = lobby(2, { bots: 2 })
    s = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', { type: 'ready', ready: true }, ctx())).state
    expect(s.phase).toBe('escolha')
    const r = ok<CoordState, BrawlCoordEvent>(setPresence(s, 'b', false, ctx(T0 + 5)))
    expect(r.state.phase).toBe('jogando')
  })

  it('arena sorteio é resolvida ao começar, com o rng do contexto', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed < 30; seed++) {
      let s = setup(humans.slice(0, 1), opts({ arenaId: 'sorteio' }), ctx(T0, seed)).state
      expect(view(s, 'a', 0).options.arenaId).toBe('sorteio')
      s = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', { type: 'ready', ready: true }, ctx(T0 + 1, seed))).state
      expect(['estante', 'telhado']).toContain(s.arenaId)
      seen.add(s.arenaId)
      // mesmo rng, mesma arena e semente
      const s2 = ok<CoordState, BrawlCoordEvent>(apply(setup(humans.slice(0, 1), opts({ arenaId: 'sorteio' }), ctx(T0, seed)).state, 'a', { type: 'ready', ready: true }, ctx(T0 + 1, seed))).state
      expect([s2.arenaId, s2.seed]).toEqual([s.arenaId, s.seed])
      expect(Number.isInteger(s.seed) && s.seed >= 0 && s.seed < 2 ** 31).toBe(true)
    }
    expect(seen.size).toBe(2)
    expect(fight(2, { arenaId: 'telhado' }).arenaId).toBe('telhado')
  })

  it('times: sem times a cor é o slot; com times reparte em roda', () => {
    const s = setup(humans, opts({ teamSize: 0 }), ctx()).state
    expect(s.players.map((p) => p.team)).toEqual([0, 1, 2])
    const t = fight(3, { teamSize: 2, bots: 1 })
    const four = t.players.map((p) => p.team)
    expect(four).toEqual([0, 1, 0, 1])
    expect(t.scores.map((l) => l.team)).toEqual(four)
  })
})

describe('ações do host', () => {
  it('parseAction valida formato', () => {
    expect(parseAction({ type: 'pick', char: 'xicara' })).toEqual({ type: 'pick', char: 'xicara' })
    expect(parseAction({ type: 'ready', ready: true })).toEqual({ type: 'ready', ready: true })
    expect(parseAction({ type: 'rematch' })).toEqual({ type: 'rematch' })
    const good = parseAction({ type: 'score', epoch: 1, scores: [line('a', 'jan', 1, 2)] })
    expect(good).toEqual({ type: 'score', epoch: 1, scores: [line('a', 'jan', 1, 2)] })
    for (const bad of [null, 3, {}, { type: 'pick', char: 'dragao' }, { type: 'ready', ready: 'sim' }, { type: 'score' }, { type: 'score', epoch: 1 }, { type: 'x', epoch: 1 }, { type: 'score', epoch: -1, scores: [] }, { type: 'score', epoch: 1, scores: [{ ...line('a'), kos: 1.5 }] }, { type: 'result', epoch: 1, ranking: [{ ...line('a'), char: 'x' }] }, { type: 'result', epoch: 1, ranking: Array.from({ length: 13 }, (_, i) => line(`x${i}`)) }]) {
      expect(isGameError(parseAction(bad)), JSON.stringify(bad)).toBe(true)
    }
  })

  it('score e result só do host, no epoch certo e só durante a luta', () => {
    const lob = lobby()
    const act: BrawlAction = { type: 'score', epoch: 1, scores: [line('a', 'jan', 2)] }
    expect(isGameError(apply(lob, 'a', act, ctx()))).toBe(true) // ainda na escolha
    const s = fight()
    expect(isGameError(apply(s, 'b', act, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'a', { ...act, epoch: 2 } as BrawlAction, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'zzz', act, ctx()))).toBe(true)
    const good = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', act, ctx()))
    expect(good.state.scores.find((l) => l.id === 'a')?.kos).toBe(2)
    expect(good.state.scores).toHaveLength(3)
    expect(s.scores.find((l) => l.id === 'a')?.kos).toBe(0)
    expect(isGameError(apply(s, 'a', { type: 'score', epoch: 1, scores: [line('fantasma')] }, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'a', { type: 'score', epoch: 1, scores: [line('a'), line('a')] }, ctx()))).toBe(true)
  })

  it('result encerra, guarda o ranking e avisa', () => {
    const s = fight(3, { bots: 1 })
    const ranking = [line('b', 'jan', 10, 3), line('a', 'jan', 4, 5), line('bot-1', 'teve', 3, 6)]
    const r = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', { type: 'result', epoch: 1, ranking }, ctx(T0 + 99_000)))
    expect(r.state.phase).toBe('fim')
    expect(r.state.ranking!.map((l) => l.id)).toEqual(['b', 'a', 'bot-1', 'c'])
    expect(r.events).toEqual([{ type: 'fim', ranking: r.state.ranking }])
    expect(isOver(r.state)).toBe(true)
    expect(view(r.state, 'a', 0).ranking).toHaveLength(4)
    expect(nextDeadline(r.state)).toBeNull()
    const again = apply(r.state, 'a', { type: 'score', epoch: 1, scores: [] }, ctx())
    expect(isGameError(again) && again.error).toBe('partida-encerrada')
  })
})

describe('presença e troca de host', () => {
  it('host cai: menor slot presente assume, epoch sobe; ação do epoch velho é recusada', () => {
    const s = fight()
    const r = ok<CoordState, BrawlCoordEvent>(setPresence(s, 'a', false, ctx()))
    expect(r.state.hostId).toBe('b')
    expect(r.state.epoch).toBe(2)
    expect(r.events).toEqual([{ type: 'host', hostId: 'b', epoch: 2 }])
    expect(isGameError(apply(r.state, 'a', { type: 'score', epoch: 1, scores: [] }, ctx()))).toBe(true)
    expect(isGameError(apply(r.state, 'b', { type: 'score', epoch: 1, scores: [] }, ctx()))).toBe(true)
    expect(isGameError(apply(r.state, 'b', { type: 'score', epoch: 2, scores: [line('b', 'jan', 1)] }, ctx()))).toBe(false)
  })

  it('host antigo volta e não toma o lugar de volta; robôs nunca viram host', () => {
    let s = fight(3, { bots: 2 })
    s = ok<CoordState, BrawlCoordEvent>(setPresence(s, 'a', false, ctx())).state
    const back = ok<CoordState, BrawlCoordEvent>(setPresence(s, 'a', true, ctx()))
    expect(back.state.hostId).toBe('b')
    expect(back.events).toEqual([])
    s = ok<CoordState, BrawlCoordEvent>(setPresence(back.state, 'b', false, ctx())).state
    s = ok<CoordState, BrawlCoordEvent>(setPresence(s, 'a', false, ctx())).state
    expect(s.hostId).toBe('c')
    expect(setPresence(s, 'bot-1', false, ctx()).events).toEqual([])
    const same = setPresence(s, 'a', false, ctx())
    expect(same.state).toBe(s)
  })
})

describe('entrar no meio', () => {
  it('na escolha entra normal', () => {
    const s = lobby(2)
    const r = ok<CoordState, BrawlCoordEvent>(addPlayer(s, { playerId: 'z', name: 'Zeca' }, ctx()))
    expect(r.events).toEqual([{ type: 'joined', id: 'z', name: 'Zeca', slot: 2 }])
    expect(r.state.players.find((p) => p.id === 'z')).toMatchObject({ spectating: false, ready: false })
  })

  it('modo tempo entra lutando; modo vidas fica assistindo até a próxima', () => {
    const t = ok<CoordState, BrawlCoordEvent>(addPlayer(fight(2, { mode: 'tempo' }), { playerId: 'z', name: 'Zeca' }, ctx()))
    expect(t.state.players.find((p) => p.id === 'z')!.spectating).toBe(false)
    const v = ok<CoordState, BrawlCoordEvent>(addPlayer(fight(2, { mode: 'vidas', bots: 1 }), { playerId: 'z', name: 'Zeca' }, ctx()))
    const z = v.state.players.find((p) => p.id === 'z')!
    expect(z.spectating).toBe(true)
    expect(z.slot).toBe(2)
    expect(v.state.players.map((p) => p.id)).toEqual(['a', 'b', 'z', 'bot-1'])
    expect(v.state.scores.find((l) => l.id === 'z')!.stocks).toBe(0)
    expect(view(v.state, 'z', 0).you).toEqual({ playerId: 'z', slot: 2 })
    // quem assiste pode pedir o placar de volta na revanche
    const over = ok<CoordState, BrawlCoordEvent>(apply(v.state, 'a', { type: 'result', epoch: 1, ranking: [line('a')] }, ctx()))
    const rm = ok<CoordState, BrawlCoordEvent>(apply(over.state, 'a', { type: 'rematch' }, ctx(T0 + 200_000)))
    expect(rm.state.players.every((p) => !p.spectating)).toBe(true)
  })

  it('cheio recusa; quem já estava só volta; depois do fim não entra ninguém', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ playerId: `h${i}`, name: `H${i}` }))
    const s = setup(eight, opts({ bots: 2 }), ctx()).state
    const full = addPlayer(s, { playerId: 'x', name: 'X' }, ctx())
    expect(isGameError(full) && full.message).toBe('A partida está cheia.')
    let t = fight(2)
    t = ok<CoordState, BrawlCoordEvent>(setPresence(t, 'b', false, ctx())).state
    const back = ok<CoordState, BrawlCoordEvent>(addPlayer(t, { playerId: 'b', name: 'Bia' }, ctx()))
    expect(back.state.players).toHaveLength(2)
    expect(back.state.players[1].present).toBe(true)
    const over = ok<CoordState, BrawlCoordEvent>(apply(t, 'a', { type: 'result', epoch: 1, ranking: [line('a')] }, ctx()))
    const late = addPlayer(over.state, { playerId: 'z', name: 'Z' }, ctx())
    expect(isGameError(late) && late.error).toBe('partida-encerrada')
  })

  it('se o host está fora, quem entra vira host', () => {
    let s = fight(1)
    s = ok<CoordState, BrawlCoordEvent>(setPresence(s, 'a', false, ctx())).state
    const r = ok<CoordState, BrawlCoordEvent>(addPlayer(s, { playerId: 'z', name: 'Zeca' }, ctx()))
    expect(r.state.hostId).toBe('z')
    expect(r.state.epoch).toBe(2)
    expect(r.events.map((e) => e.type)).toEqual(['joined', 'host'])
  })
})

describe('prazo de segurança', () => {
  it('modo tempo: duração + contagem + morte súbita + folga; encerra com o último placar', () => {
    let s = fight(3, { mode: 'tempo', minutes: 5 }, T0 + 2000)
    const due = T0 + 2000 + ((5 + 1) * 60 + COUNTDOWN_TICKS / TICK_HZ + COORD_GRACE_S) * 1000
    expect(nextDeadline(s)).toBe(due)
    s = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', { type: 'score', epoch: 1, scores: [line('a', 'jan', 3, 1, 0), line('b', 'jan', 5, 2, 0), line('c', 'jan', 5, 1, 0)] }, ctx())).state
    const early = tick(s, ctx(due - 1))
    expect(early.state.phase).toBe('jogando')
    expect(early.events).toEqual([])
    const r = tick(s, ctx(due))
    expect(r.state.phase).toBe('fim')
    expect(r.state.ranking!.map((l) => l.id)).toEqual(['c', 'b', 'a']) // abates - quedas
    expect(r.events).toEqual([{ type: 'fim', ranking: r.state.ranking }])
    expect(nextDeadline(r.state)).toBeNull()
    expect(tick(r.state, ctx(due + 1)).events).toEqual([])
  })

  it('modo vidas: prazo fixo e ranking por quem sobrou', () => {
    let s = fight(3, { mode: 'vidas' }, T0 + 2000)
    const due = T0 + 2000 + (STOCK_MODE_MAX_MIN * 60 + COUNTDOWN_TICKS / TICK_HZ + COORD_GRACE_S) * 1000
    expect(nextDeadline(s)).toBe(due)
    s = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', { type: 'score', epoch: 1, scores: [line('a', 'jan', 0, 3, 0, 5000), line('b', 'jan', 2, 1, 2, 0), line('c', 'jan', 1, 3, 0, 9000)] }, ctx())).state
    const r = tick(s, ctx(due))
    expect(r.state.ranking!.map((l) => l.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('revanche', () => {
  it('só quem abriu pede, volta para a escolha com as mesmas opções e novo epoch', () => {
    let s = fight(3, { arenaId: 'sorteio' })
    const early = apply(s, 'a', { type: 'rematch' }, ctx())
    expect(isGameError(early)).toBe(true)
    s = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', { type: 'result', epoch: 1, ranking: [line('b'), line('a'), line('c')] }, ctx())).state
    expect(isGameError(apply(s, 'b', { type: 'rematch' }, ctx(T0 + 5)))).toBe(true)
    s = ok<CoordState, BrawlCoordEvent>(setPresence(s, 'c', false, ctx())).state
    const r = ok<CoordState, BrawlCoordEvent>(apply(s, 'a', { type: 'rematch' }, ctx(T0 + 500_000)))
    const n = r.state
    expect(n.phase).toBe('escolha')
    expect(n.pickEndsAt).toBe(T0 + 500_000 + PICK_MS)
    expect(n.ranking).toBeNull()
    expect(n.epoch).toBe(2)
    expect(n.options).toEqual(s.options)
    expect(n.players.map((p) => p.id)).toEqual(['a', 'b']) // quem saiu da sala não volta
    expect(n.players.every((p) => !p.ready)).toBe(true)
    expect(n.scores.every((l) => l.kos === 0)).toBe(true)
    expect(r.events).toEqual([{ type: 'host', hostId: 'a', epoch: 2 }])
    expect(nextDeadline(n)).toBe(n.pickEndsAt)
    expect(view(n, 'a', 0).phase).toBe('escolha')
    // e dá para jogar de novo
    let m = ok<CoordState, BrawlCoordEvent>(apply(n, 'a', { type: 'ready', ready: true }, ctx(T0 + 500_100))).state
    m = ok<CoordState, BrawlCoordEvent>(apply(m, 'b', { type: 'ready', ready: true }, ctx(T0 + 500_200))).state
    expect(m.phase).toBe('jogando')
    expect(isGameError(apply(m, 'a', { type: 'score', epoch: 1, scores: [] }, ctx()))).toBe(true)
    expect(isGameError(apply(m, 'a', { type: 'score', epoch: 2, scores: [] }, ctx()))).toBe(false)
  })
})
