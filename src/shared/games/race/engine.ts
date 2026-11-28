/**
 * Coordenador da Corrida na Sala (roda no Durable Object). NÃO simula a corrida: guarda quem é o host
 * da simulação (`epoch`), a pista sorteada, o placar parcial e o resultado. Funções puras (tempo só
 * via GameCtx). Mesmo desenho do coordenador do Tiro na Sala.
 */
import type { GameCtx, GameDefinition, GameError, PlayerRef, Step } from '../types'
import { isTrackId } from './tracks'
import {
  BOT_SLOT_BASE,
  COORD_GRACE_S,
  COUNTDOWN_TICKS,
  DEFAULT_RACE_OPTIONS,
  FINISH_GRACE_TICKS,
  LAP_CAP_TICKS,
  MAX_BOTS,
  MAX_HUMANS,
  RACE_LAPS,
  TICK_HZ,
  TRACK_IDS,
  type BotLevel,
  type RaceAction,
  type RaceCoordEvent,
  type RaceCoordPhase,
  type RaceLaps,
  type RaceOptions,
  type RacePlayerView,
  type RaceScoreLine,
  type RaceView,
  type TrackId
} from './types'

export interface CoordState {
  options: RaceOptions
  /** humanos (slots 0..7) e depois robôs (slots 8..) */
  players: RacePlayerView[]
  trackId: TrackId
  hostId: string
  epoch: number
  createdAt: number
  phase: RaceCoordPhase
  scores: RaceScoreLine[]
  ranking: RaceScoreLine[] | null
}

type S = Step<CoordState, RaceCoordEvent>

const err = (error: GameError['error'], message: string): GameError => ({ error, message })
const clone = <T>(x: T): T => structuredClone(x)
const isInt = (x: unknown, max = 100_000_000): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max
const LEVELS: readonly unknown[] = ['facil', 'medio', 'dificil']

// ---------- opções e ações ----------
export function parseOptions(raw: unknown): RaceOptions | GameError {
  if (raw === undefined || raw === null) return { ...DEFAULT_RACE_OPTIONS }
  if (typeof raw !== 'object' || Array.isArray(raw)) return err('acao-invalida', 'Opções inválidas.')
  const o = raw as Record<string, unknown>
  const d = DEFAULT_RACE_OPTIONS
  const trackId = o.trackId ?? d.trackId
  const laps = o.laps ?? d.laps
  const bots = o.bots ?? d.bots
  const botLevel = o.botLevel ?? d.botLevel
  if (trackId !== 'sorteio' && !isTrackId(trackId)) return err('acao-invalida', 'Pista desconhecida.')
  if (!(RACE_LAPS as readonly unknown[]).includes(laps)) return err('acao-invalida', 'Número de voltas inválido.')
  if (typeof bots !== 'number' || !Number.isInteger(bots) || bots < 0 || bots > MAX_BOTS) return err('acao-invalida', 'Quantidade de robôs inválida.')
  if (!LEVELS.includes(botLevel)) return err('acao-invalida', 'Nível dos robôs inválido.')
  return { trackId: trackId as TrackId | 'sorteio', laps: laps as RaceLaps, bots, botLevel: botLevel as BotLevel }
}

function parseLines(raw: unknown): RaceScoreLine[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_HUMANS + MAX_BOTS) return null
  const out: RaceScoreLine[] = []
  for (const l of raw) {
    if (typeof l !== 'object' || l === null) return null
    const x = l as Record<string, unknown>
    if (typeof x.id !== 'string' || x.id.length === 0 || x.id.length > 64) return null
    if (!isInt(x.place, MAX_HUMANS + MAX_BOTS) || !isInt(x.laps, 99) || !isInt(x.timeMs) || !isInt(x.bestLapMs)) return null
    out.push({ id: x.id, place: x.place, laps: x.laps, timeMs: x.timeMs, bestLapMs: x.bestLapMs })
  }
  return out
}

export function parseAction(raw: unknown): RaceAction | GameError {
  if (typeof raw !== 'object' || raw === null) return err('acao-invalida', 'Ação inválida.')
  const a = raw as Record<string, unknown>
  if (!isInt(a.epoch, 1_000_000)) return err('acao-invalida', 'Ação inválida.')
  if (a.type === 'score') {
    const scores = parseLines(a.scores)
    return scores ? { type: 'score', epoch: a.epoch, scores } : err('acao-invalida', 'Placar inválido.')
  }
  if (a.type === 'result') {
    const ranking = parseLines(a.ranking)
    return ranking ? { type: 'result', epoch: a.epoch, ranking } : err('acao-invalida', 'Resultado inválido.')
  }
  return err('acao-invalida', 'Ação desconhecida.')
}

// ---------- utilidades ----------
const zero = (id: string): RaceScoreLine => ({ id, place: 0, laps: 0, timeMs: 0, bestLapMs: 0 })

/** Confere ids existentes e sem repetição; devolve as linhas na ordem dos jogadores (faltou = zero). */
function mergeLines(s: CoordState, lines: RaceScoreLine[]): RaceScoreLine[] | null {
  const byId = new Map<string, RaceScoreLine>()
  for (const l of lines) {
    if (byId.has(l.id) || !s.players.some((p) => p.id === l.id)) return null
    byId.set(l.id, l)
  }
  return s.players.map((p) => byId.get(p.id) ?? zero(p.id))
}

/** Sem resultado do host: quem chegou (pela colocação), depois mais voltas, depois o slot. */
export function sortLines(s: CoordState, lines: RaceScoreLine[]): RaceScoreLine[] {
  const slot = (id: string): number => s.players.find((p) => p.id === id)?.slot ?? 99
  const place = (l: RaceScoreLine) => (l.place === 0 ? 999 : l.place)
  return [...lines].sort((a, b) => place(a) - place(b) || b.laps - a.laps || slot(a.id) - slot(b.id))
}

function finish(s: CoordState, ranking: RaceScoreLine[], events: RaceCoordEvent[]): void {
  s.phase = 'fim'
  s.ranking = ranking
  s.scores = s.players.map((p) => ranking.find((l) => l.id === p.id) ?? zero(p.id))
  events.push({ type: 'fim', ranking: ranking.map((l) => ({ ...l })) })
}

/** Se o host está ausente e há outro humano presente, passa o comando (menor slot). */
function maybeNewHost(s: CoordState, events: RaceCoordEvent[]): void {
  if (s.phase === 'fim') return
  const host = s.players.find((p) => p.id === s.hostId)
  if (host && host.present) return
  const next = s.players.filter((p) => !p.bot && p.present).sort((a, b) => a.slot - b.slot)[0]
  if (!next || next.id === s.hostId) return
  s.hostId = next.id
  s.epoch++
  events.push({ type: 'host', hostId: s.hostId, epoch: s.epoch })
}

/** prazo de segurança: contagem + teto das voltas + folga depois da chegada + folga */
export const deadline = (s: CoordState): number =>
  s.createdAt + ((COUNTDOWN_TICKS + s.options.laps * LAP_CAP_TICKS + FINISH_GRACE_TICKS) / TICK_HZ + COORD_GRACE_S) * 1000

// ---------- contrato ----------
export function setup(players: PlayerRef[], options: RaceOptions, ctx: GameCtx): S {
  const humans: RacePlayerView[] = players.slice(0, MAX_HUMANS).map((p, i) => ({ id: p.playerId, name: p.name, slot: i, bot: false, present: true }))
  const bots: RacePlayerView[] = []
  for (let i = 0; i < options.bots; i++) bots.push({ id: `bot-${i + 1}`, name: `Robô ${i + 1}`, slot: BOT_SLOT_BASE + i, bot: true, present: true })
  const all = [...humans, ...bots]
  const trackId = options.trackId === 'sorteio' ? TRACK_IDS[ctx.rng.int(TRACK_IDS.length)]! : options.trackId
  const s: CoordState = {
    options: { ...options },
    players: all,
    trackId,
    hostId: humans[0]?.id ?? '',
    epoch: 1,
    createdAt: ctx.now,
    phase: 'jogando',
    scores: all.map((p) => zero(p.id)),
    ranking: null
  }
  return { state: s, events: [{ type: 'host', hostId: s.hostId, epoch: s.epoch }] }
}

export function apply(state: CoordState, playerId: string, action: RaceAction, _ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A corrida acabou.')
  if (playerId !== state.hostId) return err('acao-invalida', 'Só quem roda a corrida manda o placar.')
  if (action.epoch !== state.epoch) return err('acao-invalida', 'Essa ação é de um comando antigo.')
  const s = clone(state)
  const events: RaceCoordEvent[] = []
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

export function tick(state: CoordState, ctx: GameCtx): S {
  if (state.phase === 'fim' || ctx.now < deadline(state)) return { state, events: [] }
  const s = clone(state)
  const events: RaceCoordEvent[] = []
  finish(s, sortLines(s, s.scores), events)
  return { state: s, events }
}

export function nextDeadline(s: CoordState): number | null {
  return s.phase === 'fim' ? null : deadline(s)
}

export function setPresence(state: CoordState, playerId: string, present: boolean, _ctx: GameCtx): S {
  const p = state.players.find((x) => x.id === playerId && !x.bot)
  if (!p || p.present === present) return { state, events: [] }
  const s = clone(state)
  s.players.find((x) => x.id === playerId)!.present = present
  const events: RaceCoordEvent[] = []
  maybeNewHost(s, events)
  return { state: s, events }
}

export function addPlayer(state: CoordState, player: PlayerRef, _ctx: GameCtx): S | GameError {
  if (state.phase === 'fim') return err('partida-encerrada', 'A corrida acabou.')
  const s = clone(state)
  const events: RaceCoordEvent[] = []
  const old = s.players.find((p) => p.id === player.playerId && !p.bot)
  if (old) {
    old.present = true
    old.name = player.name
    maybeNewHost(s, events)
    return { state: s, events }
  }
  const used = new Set(s.players.filter((p) => !p.bot).map((p) => p.slot))
  let slot = 0
  while (slot < MAX_HUMANS && used.has(slot)) slot++
  if (slot >= MAX_HUMANS) return err('acao-invalida', 'A corrida está cheia.')
  s.players.push({ id: player.playerId, name: player.name, slot, bot: false, present: true })
  s.players.sort((a, b) => a.slot - b.slot)
  s.scores.push(zero(player.playerId))
  events.push({ type: 'joined', id: player.playerId, name: player.name, slot })
  maybeNewHost(s, events)
  return { state: s, events }
}

export function view(s: CoordState, playerId: string | null, _now: number): RaceView {
  const me = playerId ? s.players.find((p) => p.id === playerId && !p.bot) : undefined
  return {
    you: me ? { playerId: me.id, slot: me.slot } : null,
    options: { ...s.options },
    trackId: s.trackId,
    phase: s.phase,
    players: s.players.map((p) => ({ ...p })),
    hostId: s.hostId,
    epoch: s.epoch,
    createdAt: s.createdAt,
    scores: s.scores.map((l) => ({ ...l })),
    ranking: s.ranking ? s.ranking.map((l) => ({ ...l })) : null
  }
}

export const isOver = (s: CoordState): boolean => s.phase === 'fim'

export const raceGame: GameDefinition<CoordState, RaceOptions, RaceAction, RaceView, RaceCoordEvent> = {
  id: 'race',
  name: 'Corrida na Sala',
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
