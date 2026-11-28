import { describe, expect, it } from 'vitest'
import { DEFAULT_BRAWL_OPTIONS } from '../src/shared/games/brawl/types'
import { DEFAULT_CHECKERS_OPTIONS } from '../src/shared/games/checkers/types'
import { DEFAULT_CHESS_OPTIONS } from '../src/shared/games/chess/types'
import { DEFAULT_GOLF_OPTIONS } from '../src/shared/games/golf/types'
import { DEFAULT_NAVAL_OPTIONS } from '../src/shared/games/naval/types'
import { DEFAULT_OPTIONS as DEFAULT_POKER } from '../src/shared/games/poker/types'
import { GAME_IDS, type GameId } from '../src/shared/games/protocol'
import { GAMES } from '../src/shared/games/registry'
import { DEFAULT_CATEGORIES } from '../src/shared/games/stop/categories'
import { DEFAULT_SHOOTER_OPTIONS } from '../src/shared/games/shooter/types'
import { isGameError } from '../src/shared/games/types'
import { DEFAULT_TRUCO_OPTIONS } from '../src/shared/games/truco/types'
import { DEFAULT_TYCOON_OPTIONS } from '../src/shared/games/tycoon/types'
import { buildOptions, CATALOG, CATALOG_LIST, defaultValues, FILTERS, matchesFilter, summarize, type OptionValues } from '../src/web/ui/games/catalog'
import { THUMBS } from '../src/web/ui/games/thumbs'
import { DEFAULT_VELHA_OPTIONS } from '../src/shared/games/velha/types'
import { DEFAULT_RACE_OPTIONS } from '../src/shared/games/race/types'

const DEFAULTS: Record<GameId, unknown> = {
  poker: DEFAULT_POKER,
  golf: DEFAULT_GOLF_OPTIONS,
  chess: DEFAULT_CHESS_OPTIONS,
  checkers: DEFAULT_CHECKERS_OPTIONS,
  tycoon: DEFAULT_TYCOON_OPTIONS,
  truco: DEFAULT_TRUCO_OPTIONS,
  shooter: DEFAULT_SHOOTER_OPTIONS,
  brawl: DEFAULT_BRAWL_OPTIONS,
  naval: DEFAULT_NAVAL_OPTIONS,
  mystery: {},
  pool: {},
  stop: { categories: DEFAULT_CATEGORIES, rounds: 5, seconds: 120 },
  velha: DEFAULT_VELHA_OPTIONS,
  pife: {},
  race: DEFAULT_RACE_OPTIONS
}

const accepts = (id: GameId, options: unknown): boolean => !isGameError(GAMES[id]!.parseOptions(options))

/** cada controle, uma escolha por vez, a partir do padrão */
function variations(id: GameId): OptionValues[] {
  const base = defaultValues(id)
  const out: OptionValues[] = [base]
  for (const c of CATALOG[id].controls) {
    if (c.kind === 'segment' || c.kind === 'cards') for (const ch of c.choices) out.push({ ...base, [c.key]: ch.value })
    else if (c.kind === 'stepper') for (let n = c.min; n <= c.max; n++) out.push({ ...base, [c.key]: n })
    else if (c.kind === 'switch') out.push({ ...base, [c.key]: true }, { ...base, [c.key]: false })
    else out.push({ ...base, [c.key]: c.items.map((i) => i.value) }, { ...base, [c.key]: c.items.slice(0, c.min).map((i) => i.value) })
  }
  return out
}

describe('catálogo de jogos', () => {
  it('todo jogo do GAME_IDS tem entrada e print', () => {
    for (const id of GAME_IDS) {
      expect(CATALOG[id]?.id).toBe(id)
      expect(THUMBS[id].length).toBeGreaterThan(0)
      expect(CATALOG[id].how).toHaveLength(3)
    }
    expect(CATALOG_LIST.map((e) => e.id)).toEqual([...GAME_IDS])
  })

  it('o padrão de cada esquema é o DEFAULT_*_OPTIONS do jogo', () => {
    for (const id of GAME_IDS) expect(buildOptions(id, defaultValues(id))).toEqual(DEFAULTS[id])
  })

  it('montar opções sempre gera um objeto que o parseOptions do servidor aceita', () => {
    for (const id of GAME_IDS) {
      for (const v of variations(id)) {
        const built = buildOptions(id, v)
        expect(accepts(id, built), `${id} ${JSON.stringify(built)}`).toBe(true)
      }
    }
  })

  it('valor estranho volta para o padrão (ou para o limite, nos números) em vez de ir para o servidor', () => {
    expect(buildOptions('brawl', { ...defaultValues('brawl'), stocks: 99, bots: -3, mode: 'x', arenaId: 'lua' })).toEqual({ ...DEFAULT_BRAWL_OPTIONS, stocks: 5 })
    expect(buildOptions('stop', { categories: ['nome'], rounds: 4, seconds: 7 })).toEqual(DEFAULTS.stop)
    expect(buildOptions('poker', {})).toEqual(DEFAULT_POKER)
    expect(buildOptions('pool', { qualquer: 1 })).toEqual({})
  })

  it('combinações de opções do Briga e do Stop passam no parseOptions', () => {
    const combos: OptionValues[] = [
      { ...defaultValues('brawl'), mode: 'tempo', minutes: 5, teamSize: 2, friendlyFire: true, arenaId: 'telhado', bots: 4, botLevel: 'dificil' },
      { ...defaultValues('brawl'), arenaId: 'sorteio', stocks: 1, teamSize: 4 }
    ]
    for (const c of combos) expect(accepts('brawl', buildOptions('brawl', c))).toBe(true)
    expect(accepts('stop', buildOptions('stop', { categories: ['nome', 'cep', 'animal'], rounds: 10, seconds: 0 }))).toBe(true)
  })

  it('o resumo nunca fica vazio, nem com opções estranhas', () => {
    for (const id of GAME_IDS) {
      for (const v of variations(id)) expect(summarize(id, v).length).toBeGreaterThan(0)
      for (const junk of [undefined, null, 5, [], {}, { x: 1 }]) expect(summarize(id, junk).length).toBeGreaterThan(0)
    }
  })

  it('resumos conhecidos', () => {
    expect(summarize('brawl', DEFAULT_BRAWL_OPTIONS)).toBe('A Estante, 3 vidas, todos contra todos, sem robôs')
    expect(summarize('poker', DEFAULT_POKER)).toBe("Hold'em, 30 minutos, recompra")
    expect(summarize('truco', { players: 6 })).toBe('3x3, até 30 pontos, com flor')
    expect(summarize('chess', { minutes: 0 })).toBe('sem relógio')
    expect(summarize('race', DEFAULT_RACE_OPTIONS)).toBe('A Sala, 5 voltas, 3 robôs')
  })

  it('os filtros pegam todos os jogos em Todos e cada jogo em alguma categoria', () => {
    expect(CATALOG_LIST.every((e) => matchesFilter(e, 'todos'))).toBe(true)
    for (const e of CATALOG_LIST) expect(FILTERS.some((f) => f.id !== 'todos' && matchesFilter(e, f.id))).toBe(true)
    expect(FILTERS.map((f) => f.label)).toEqual(['Todos', 'Cartas', 'Tabuleiro', 'Ação', 'Rápidos'])
  })

  it('textos sem seta nem CAIXA ALTA', () => {
    for (const e of CATALOG_LIST) {
      const texts = [e.name, e.line, e.description, ...e.how.map((h) => h.text)]
      for (const t of texts) {
        expect(t).not.toContain('→')
        expect(t).not.toMatch(/\b[A-ZÁÉÍÓÚÇ]{5,}\b/)
      }
    }
  })
})
