/**
 * Coordenador da Briga na Sala (roda no Durable Object). NÃO simula a luta: guarda a escolha de
 * personagem, quem é o host da simulação (`epoch`), o placar parcial e o resultado. Funções puras
 * (tempo só via GameCtx). Mesmo desenho do coordenador do Tiro na Sala, com a fase 'escolha' antes.
 *
 * Fases: 'escolha' (pick/ready; termina quando todos presentes marcam pronto ou em PICK_MS),
 * 'jogando' (o host manda `score` e `result` no epoch certo; prazo de segurança do servidor) e
 * 'fim' (ranking; `rematch` de quem abriu volta para a escolha).
 */
import type { GameCtx, GameDefinition, GameError, PlayerRef, Step } from '../types'
import {
  ARENA_IDS,
  BOT_SLOT_BASE,
  BRAWL_MINUTES,
  CHARACTER_IDS,
  COORD_GRACE_S,
  COUNTDOWN_TICKS,
  DEFAULT_BRAWL_OPTIONS,
  MAX_BOTS,
  MAX_HUMANS,
  PICK_MS,
  STOCK_MODE_MAX_MIN,
  TICK_HZ,
  type ArenaId,
  type BotLevel,
  type BrawlAction,
  type BrawlCoordEvent,
  type BrawlMinutes,
  type BrawlOptions,
  type BrawlPhase,
  type BrawlPlayerView,
  type BrawlScoreLine,
  type BrawlView,
  type CharacterId,
  type TeamSize
} from './types'

export interface CoordState {
  options: BrawlOptions
  /** humanos (slots 0..7) e depois robôs (slots 8..) */
  players: BrawlPlayerView[]
  /** quem abriu a partida (só ele pede revanche) */
  creatorId: string
  hostId: string
  epoch: number
  seed: number
  arenaId: ArenaId
  phase: BrawlPhase
  /** ms epoch em que a escolha acaba */
  pickEndsAt: number
  /** ms epoch em que a luta começou (0 antes) */
  startedAt: number
  scores: BrawlScoreLine[]
  ranking: BrawlScoreLine[] | null
}

type S = Step<CoordState, BrawlCoordEvent>

const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)
const isInt = (x: unknown, max = 1_000_000): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max
const isChar = (x: unknown): x is CharacterId => (CHARACTER_IDS as readonly unknown[]).includes(x)

// ---------- opções e ações ----------
const TEAM_SIZES: readonly unknown[] = [0, 2, 3, 4]
const LEVELS: readonly unknown[] = ['facil', 'medio', 'dificil']

export function parseOptions(raw: unknown): BrawlOptions | GameError {
  if (raw === undefined || raw === null) return { ...DEFAULT_BRAWL_OPTIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const o = raw as Record<string, unknown>
  const d = DEFAULT_BRAWL_OPTIONS
  const mode = o.mode ?? d.mode
  const stocks = o.stocks ?? d.stocks
  const minutes = o.minutes ?? d.minutes
  const teamSize = o.teamSize ?? d.teamSize
  const friendlyFire = o.friendlyFire ?? d.friendlyFire
  const arenaId = o.arenaId ?? d.arenaId
  const bots = o.bots ?? d.bots
  const botLevel = o.botLevel ?? d.botLevel
  if (mode !== 'vidas' && mode !== 'tempo') return err('acao-invalida', 'Modo inválido.')
  if (typeof stocks !== 'number' || !Number.isInteger(stocks) || stocks < 1 || stocks > 5) return err('acao-invalida', 'Quantidade de vidas inválida.')
  if (!(BRAWL_MINUTES as readonly unknown[]).includes(minutes)) return err('acao-invalida', 'Duração inválida.')
  if (!TEAM_SIZES.includes(teamSize)) return err('acao-invalida', 'Tamanho do time inválido.')
  if (typeof friendlyFire !== 'boolean') return err('acao-invalida', 'Fogo amigo inválido.')
  if (arenaId !== 'sorteio' && !(ARENA_IDS as readonly unknown[]).includes(arenaId)) return err('acao-invalida', 'Arena desconhecida.')
  if (typeof bots !== 'number' || !Number.isInteger(bots) || bots < 0 || bots > MAX_BOTS) return err('acao-invalida', 'Quantidade de robôs inválida.')
  if (!LEVELS.includes(botLevel)) return err('acao-invalida', 'Nível dos robôs inválido.')
  return {
    mode,
    stocks,
    minutes: minutes as BrawlMinutes,
    teamSize: teamSize as TeamSize,
    friendlyFire,
    arenaId: arenaId as ArenaId | 'sorteio',
    bots,
    botLevel: botLevel as BotLevel
  }
}

function parseLines(raw: unknown): BrawlScoreLine[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_HUMANS + MAX_BOTS) return null
  const out: BrawlScoreLine[] = []
  for (const l of raw) {
    if (typeof l !== 'object' || l === null) return null
    const x = l as Record<string, unknown>
    if (typeof x.id !== 'string' || x.id.length === 0 || x.id.length > 64) return null
    if (!isChar(x.char)) return null
    if (!isInt(x.team, 64) || !isInt(x.kos) || !isInt(x.falls) || !isInt(x.damage) || !isInt(x.stocks, 99) || !isInt(x.outTick, 100_000_000)) return null
    out.push({ id: x.id, char: x.char, team: x.team, kos: x.kos, falls: x.falls, damage: x.damage, stocks: x.stocks, outTick: x.outTick })
  }
  return out
}

export function parseAction(raw: unknown): BrawlAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Ação inválida.')
  const a = raw as Record<string, unknown>
  switch (a.type) {
    case 'pick':
      return isChar(a.char) ? { type: 'pick', char: a.char } : err('acao-invalida', 'Personagem desconhecido.')
    case 'ready':
      return typeof a.ready === 'boolean' ? { type: 'ready', ready: a.ready } : err('acao-invalida', 'Ação inválida.')
    case 'rematch':
      return { type: 'rematch' }
    case 'score': {
      if (!isInt(a.epoch)) return err('acao-invalida', 'Ação inválida.')
      const scores = parseLines(a.scores)
      return scores ? { type: 'score', epoch: a.epoch, scores } : err('acao-invalida', 'Placar inválido.')
    }
    case 'result': {
      if (!isInt(a.epoch)) return err('acao-invalida', 'Ação inválida.')
      const ranking = parseLines(a.ranking)
      return ranking ? { type: 'result', epoch: a.epoch, ranking } : err('acao-invalida', 'Resultado inválido.')
    }
    default:
      return err('acao-invalida', 'Ação desconhecida.')
  }
}

// ---------- utilidades ----------
const zero = (s: CoordState, p: BrawlPlayerView): BrawlScoreLine => ({
  id: p.id,
  char: p.char,
  team: p.team,
  kos: 0,
  falls: 0,
  damage: 0,
  stocks: s.options.mode === 'vidas' ? s.options.stocks : 0,
  outTick: 0
})

/** Times: sem times, a cor é o slot; com times, reparte em roda (jogador i vai para o time i % n, no máximo 4 times). */
function assignTeams(s: CoordState): void {
  const n = s.players.length
  if (s.options.teamSize === 0) {
    for (const p of s.players) p.team = p.slot % 8
    return
  }
  const teams = Math.min(4, Math.max(2, -Math.floor(-n / s.options.teamSize)))
  s.players.forEach((p, i) => (p.team = i % teams))
}

/** Confere ids existentes e sem repetição; devolve as linhas na ordem dos jogadores (faltou = zero). */
function mergeLines(s: CoordState, lines: BrawlScoreLine[]): BrawlScoreLine[] | null {
  const byId = new Map<string, BrawlScoreLine>()
  for (const l of lines) {
    if (byId.has(l.id) || !s.players.some((p) => p.id === l.id)) return null
    byId.set(l.id, l)
  }
  return s.players.map((p) => byId.get(p.id) ?? zero(s, p))
}

/** Quando o host some sem `result`: vidas (quem sobrou, depois quem saiu por último) ou tempo (abates - quedas). */
function sortLines(s: CoordState, lines: BrawlScoreLine[]): BrawlScoreLine[] {
  const slot = (id: string): number => s.players.find((p) => p.id === id)?.slot ?? 99
  if (s.options.mode === 'vidas') {
    const out = (l: BrawlScoreLine): number => (l.outTick === 0 ? Infinity : l.outTick)
    return [...lines].sort((a, b) => (out(a) === out(b) ? b.stocks - a.stocks || b.kos - a.kos || b.damage - a.damage || slot(a.id) - slot(b.id) : out(b) > out(a) ? 1 : -1))
  }
  return [...lines].sort((a, b) => b.kos - b.falls - (a.kos - a.falls) || b.kos - a.kos || b.damage - a.damage || slot(a.id) - slot(b.id))
}

function finish(s: CoordState, ranking: BrawlScoreLine[], events: BrawlCoordEvent[]): void {
  s.phase = 'fim'
  s.ranking = ranking
  s.scores = s.players.map((p) => ranking.find((l) => l.id === p.id) ?? zero(s, p))
  events.push({ type: 'fim', ranking: ranking.map((l) => ({ ...l })) })
}

/** Se o host está ausente e há outro humano presente, passa o comando (menor slot). */
function maybeNewHost(s: CoordState, events: BrawlCoordEvent[]): void {
  if (s.phase === 'fim') return
  const host = s.players.find((p) => p.id === s.hostId)
  if (host && host.present) return
  const next = s.players.filter((p) => !p.bot && p.present).sort((a, b) => a.slot - b.slot)[0]
  if (!next || next.id === s.hostId) return
  s.hostId = next.id
  s.epoch++
  events.push({ type: 'host', hostId: s.hostId, epoch: s.epoch })
}

/** prazo de segurança da luta: duração + contagem + (morte súbita) + folga */
const fightDeadline = (s: CoordState): number => {
  const minutes = s.options.mode === 'tempo' ? s.options.minutes + 1 : STOCK_MODE_MAX_MIN
  return s.startedAt + (minutes * 60 + COUNTDOWN_TICKS / TICK_HZ + COORD_GRACE_S) * 1000
}

const allReady = (s: CoordState): boolean => s.players.every((p) => p.bot || !p.present || p.ready)

function startFight(s: CoordState, ctx: GameCtx, events: BrawlCoordEvent[]): void {
  s.arenaId = s.options.arenaId === 'sorteio' ? ARENA_IDS[ctx.rng.int(ARENA_IDS.length)] : s.options.arenaId
  s.seed = ctx.rng.int(2 ** 31)
  s.phase = 'jogando'
  s.startedAt = ctx.now
  for (const p of s.players) p.spectating = false
  assignTeams(s)
  s.scores = s.players.map((p) => zero(s, p))
  maybeNewHost(s, events)
  events.push({ type: 'start', arenaId: s.arenaId, seed: s.seed })
}

// ---------- contrato ----------
export function setup(players: PlayerRef[], options: BrawlOptions, ctx: GameCtx): S {
  const humans: BrawlPlayerView[] = players.slice(0, MAX_HUMANS).map((p, i) => ({
    id: p.playerId,
    name: p.name,
    slot: i,
    bot: false,
    present: true,
    char: CHARACTER_IDS[i % CHARACTER_IDS.length],
    team: i % 8,
    ready: false,
    spectating: false
  }))
  const bots: BrawlPlayerView[] = []
  for (let i = 0; i < options.bots; i++) {
    bots.push({
      id: `bot-${i + 1}`,
      name: `Robô ${i + 1}`,
      slot: BOT_SLOT_BASE + i,
      bot: true,
      present: true,
      char: CHARACTER_IDS[ctx.rng.int(CHARACTER_IDS.length)],
      team: (BOT_SLOT_BASE + i) % 8,
      ready: true,
      spectating: false
    })
  }
  const all = [...humans, ...bots]
  const s: CoordState = {
    options: { ...options },
    players: all,
    creatorId: humans[0]?.id ?? '',
    hostId: humans[0]?.id ?? '',
    epoch: 1,
    seed: 0,
    arenaId: options.arenaId === 'sorteio' ? ARENA_IDS[0] : options.arenaId,
    phase: 'escolha',
    pickEndsAt: ctx.now + PICK_MS,
    startedAt: 0,
    scores: [],
    ranking: null
  }
  assignTeams(s)
  s.scores = all.map((p) => zero(s, p))
  return { state: s, events: [{ type: 'host', hostId: s.hostId, epoch: s.epoch }] }
}

export function apply(state: CoordState, playerId: string, action: BrawlAction, ctx: GameCtx): S | GameError {
  const me = state.players.find((p) => p.id === playerId && !p.bot)
  switch (action.type) {
    case 'pick':
    case 'ready': {
      if (state.phase !== 'escolha') return err('acao-invalida', 'A escolha de personagem já acabou.')
      if (!me) return err('acao-invalida', 'Você não está nesta partida.')
      const s = clone(state)
      const events: BrawlCoordEvent[] = []
      const p = s.players.find((x) => x.id === playerId)!
      if (action.type === 'pick') {
        p.char = action.char
        events.push({ type: 'pick', id: p.id, char: p.char })
      } else p.ready = action.ready
      if (allReady(s)) startFight(s, ctx, events)
      return { state: s, events }
    }
    case 'rematch': {
      if (state.phase !== 'fim') return err('acao-invalida', 'A partida ainda não acabou.')
      if (playerId !== state.creatorId) return err('acao-invalida', 'Só quem abriu a partida pede revanche.')
      const s = clone(state)
      const events: BrawlCoordEvent[] = []
      // quem saiu da sala não volta; os slots dos outros continuam
      s.players = s.players.filter((p) => p.bot || p.present)
      for (const p of s.players) {
        p.ready = p.bot
        p.spectating = false
      }
      s.phase = 'escolha'
      s.pickEndsAt = ctx.now + PICK_MS
      s.startedAt = 0
      s.ranking = null
      s.seed = 0
      s.epoch++
      assignTeams(s)
      s.scores = s.players.map((p) => zero(s, p))
      const host = s.players.find((p) => p.id === s.hostId && p.present)
      if (!host) s.hostId = s.players.find((p) => !p.bot)?.id ?? s.hostId
      events.push({ type: 'host', hostId: s.hostId, epoch: s.epoch })
      return { state: s, events }
    }
    case 'score':
    case 'result': {
      if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
      if (state.phase !== 'jogando') return err('acao-invalida', 'A luta ainda não começou.')
      if (playerId !== state.hostId) return err('acao-invalida', 'Só quem roda a partida manda o placar.')
      if (action.epoch !== state.epoch) return err('acao-invalida', 'Essa ação é de um comando antigo.')
      const s = clone(state)
      const events: BrawlCoordEvent[] = []
      if (action.type === 'score') {
        const merged = mergeLines(s, action.scores)
        if (!merged) return err('acao-invalida', 'Placar com jogador desconhecido.')
        s.scores = merged
        return { state: s, events }
      }
      const merged = mergeLines(s, action.ranking)
      if (!merged) return err('acao-invalida', 'Resultado com jogador desconhecido.')
      // mantém a ordem enviada e coloca no fim quem faltou
      const given = action.ranking
      const rest = merged.filter((l) => !given.some((g) => g.id === l.id))
      finish(s, [...given, ...rest], events)
      return { state: s, events }
    }
  }
}

export function tick(state: CoordState, ctx: GameCtx): S {
  if (state.phase === 'escolha') {
    if (ctx.now < state.pickEndsAt) return { state, events: [] }
    const s = clone(state)
    const events: BrawlCoordEvent[] = []
    startFight(s, ctx, events)
    return { state: s, events }
  }
  if (state.phase === 'fim' || ctx.now < fightDeadline(state)) return { state, events: [] }
  const s = clone(state)
  const events: BrawlCoordEvent[] = []
  finish(s, sortLines(s, s.scores), events)
  return { state: s, events }
}

export function nextDeadline(s: CoordState): number | null {
  if (s.phase === 'escolha') return s.pickEndsAt
  return s.phase === 'fim' ? null : fightDeadline(s)
}

export function setPresence(state: CoordState, playerId: string, present: boolean, ctx: GameCtx): S {
  const p = state.players.find((x) => x.id === playerId && !x.bot)
  if (!p || p.present === present) return { state, events: [] }
  const s = clone(state)
  s.players.find((x) => x.id === playerId)!.present = present
  const events: BrawlCoordEvent[] = []
  maybeNewHost(s, events)
  // quem saiu da escolha não segura os outros
  if (s.phase === 'escolha' && s.players.some((x) => !x.bot && x.present) && allReady(s)) startFight(s, ctx, events)
  return { state: s, events }
}

export function addPlayer(state: CoordState, player: PlayerRef, _ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A partida acabou.')
  const s = clone(state)
  const events: BrawlCoordEvent[] = []
  const old = s.players.find((p) => p.id === player.playerId && !p.bot)
  if (old) {
    // já estava na partida: só volta
    old.present = true
    old.name = player.name
    maybeNewHost(s, events)
    return { state: s, events }
  }
  const used = new Set(s.players.filter((p) => !p.bot).map((p) => p.slot))
  let slot = 0
  while (slot < MAX_HUMANS && used.has(slot)) slot++
  if (slot >= MAX_HUMANS) return err('acao-invalida', 'A partida está cheia.')
  const lutando = s.phase === 'jogando'
  s.players.push({
    id: player.playerId,
    name: player.name,
    slot,
    bot: false,
    present: true,
    char: CHARACTER_IDS[slot % CHARACTER_IDS.length],
    team: slot % 8,
    ready: lutando,
    // modo vidas: quem chega com a luta rolando só assiste; no modo tempo entra
    spectating: lutando && s.options.mode === 'vidas'
  })
  s.players.sort((a, b) => a.slot - b.slot)
  if (s.options.teamSize === 0) for (const p of s.players) p.team = p.slot % 8
  else {
    // quem entra no meio vai para o time com menos gente
    const counts = new Map<number, number>()
    for (const p of s.players) if (p.id !== player.playerId) counts.set(p.team, (counts.get(p.team) ?? 0) + 1)
    const teams = Math.min(4, Math.max(2, ...[...counts.keys()].map((k) => k + 1)))
    let best = 0
    for (let t = 0; t < teams; t++) if ((counts.get(t) ?? 0) < (counts.get(best) ?? 0)) best = t
    s.players.find((p) => p.id === player.playerId)!.team = best
  }
  const me = s.players.find((p) => p.id === player.playerId)!
  s.scores.push(zero(s, me))
  if (me.spectating) s.scores[s.scores.length - 1].stocks = 0
  events.push({ type: 'joined', id: player.playerId, name: player.name, slot })
  maybeNewHost(s, events)
  return { state: s, events }
}

export function view(s: CoordState, playerId: string | null, _now: number): BrawlView {
  const me = playerId ? s.players.find((p) => p.id === playerId && !p.bot) : undefined
  return {
    you: me ? { playerId: me.id, slot: me.slot } : null,
    options: { ...s.options },
    arenaId: s.arenaId,
    phase: s.phase,
    pickEndsAt: s.pickEndsAt,
    players: s.players.map((p) => ({ ...p })),
    hostId: s.hostId,
    epoch: s.epoch,
    seed: s.seed,
    startedAt: s.startedAt,
    scores: s.scores.map((l) => ({ ...l })),
    ranking: s.ranking ? s.ranking.map((l) => ({ ...l })) : null
  }
}

export const isOver = (s: CoordState): boolean => s.phase === 'fim'

export const brawlGame: GameDefinition<CoordState, BrawlOptions, BrawlAction, BrawlView, BrawlCoordEvent> = {
  id: 'brawl',
  name: 'Briga na Sala',
  minPlayers: 1,
  maxPlayers: MAX_HUMANS,
  concurrent: true,
  parseOptions,
  setup,
  parseAction,
  apply,
  tick,
  nextDeadline,
  setPresence,
  addPlayer,
  view,
  isOver
}
