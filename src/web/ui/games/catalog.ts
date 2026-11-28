/**
 * Catálogo declarativo dos jogos do painel: o que aparece na vitrine, nos detalhes e no lobby, e o
 * ESQUEMA das opções de cada jogo (que controle usar, rótulos, valores e padrão).
 *
 * Os valores de opção são EXATAMENTE os que cada `parseOptions` do servidor aceita. O painel manda
 * `buildOptions(id, valores)` em `api.open(gameId, options)`: o formato não muda. Tudo aqui é puro
 * (sem DOM), então dá para testar em node.
 */
import { ARENAS } from '../../../shared/games/brawl/arenas'
import { BRAWL_MINUTES, DEFAULT_BRAWL_OPTIONS, MAX_BOTS as BRAWL_MAX_BOTS } from '../../../shared/games/brawl/types'
import { DEFAULT_CHECKERS_OPTIONS } from '../../../shared/games/checkers/types'
import { DEFAULT_CHESS_OPTIONS } from '../../../shared/games/chess/types'
import { MAPS } from '../../../shared/games/golf/maps'
import { DEFAULT_GOLF_OPTIONS } from '../../../shared/games/golf/types'
import { DEFAULT_NAVAL_OPTIONS } from '../../../shared/games/naval/types'
import { DEFAULT_OPTIONS as DEFAULT_POKER_OPTIONS } from '../../../shared/games/poker/types'
import { GAME_IDS, type GameId } from '../../../shared/games/protocol'
import { CATEGORIES, categoryName, DEFAULT_CATEGORIES } from '../../../shared/games/stop/categories'
import { STOP_ROUNDS, STOP_SECONDS } from '../../../shared/games/stop/types'
import { DEFAULT_SHOOTER_OPTIONS, KILL_LIMITS, MATCH_MINUTES, MAX_BOTS as SHOOTER_MAX_BOTS } from '../../../shared/games/shooter/types'
import { DEFAULT_TRUCO_OPTIONS } from '../../../shared/games/truco/types'
import { DEFAULT_TYCOON_OPTIONS } from '../../../shared/games/tycoon/types'
import { DEFAULT_VELHA_OPTIONS } from '../../../shared/games/velha/types'
import { TRACK_DEFS } from '../../../shared/games/race/tracks'
import { DEFAULT_RACE_OPTIONS, MAX_BOTS as RACE_MAX_BOTS, RACE_LAPS } from '../../../shared/games/race/types'

/** ícones usados aqui (subconjunto de IconName; fica local porque o tsconfig dos testes não compila TSX) */
export type IconName = 'cards' | 'flag' | 'pawn' | 'checker' | 'dice' | 'sword' | 'target' | 'fist' | 'car' | 'anchor' | 'search' | 'eight' | 'pencil' | 'velha' | 'users' | 'clock' | 'crown' | 'focus' | 'grid' | 'chart' | 'mouse' | 'sliders' | 'plus' | 'chat' | 'check' | 'stop' | 'warn'

export type GameCategory = 'cartas' | 'tabuleiro' | 'acao'
/** filtros da vitrine; `rapidos` pega os jogos marcados com `quick` */
export type ShelfFilter = 'todos' | GameCategory | 'rapidos'

export const FILTERS: readonly { id: ShelfFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'cartas', label: 'Cartas' },
  { id: 'tabuleiro', label: 'Tabuleiro' },
  { id: 'acao', label: 'Ação' },
  { id: 'rapidos', label: 'Rápidos' }
]

export type OptionValue = string | number | boolean | string[]
export type OptionValues = Record<string, OptionValue>

export interface Choice {
  value: string | number | boolean
  /** texto curto da pílula ou do cartão */
  label: string
  /** explicação, mostrada embaixo quando a escolha está marcada */
  sub?: string
  icon?: IconName
  /** mini-ilustração (arenas): plataformas em coordenadas da arena */
  art?: readonly { x: number; y: number; w: number; h: number; thin: boolean }[]
}

interface ControlBase {
  key: string
  label: string
  icon: IconName
  /** some quando devolve false (o valor continua valendo, como no painel antigo) */
  when?: (v: OptionValues) => boolean
}

export type ControlSpec =
  | (ControlBase & { kind: 'segment'; choices: readonly Choice[] })
  | (ControlBase & { kind: 'cards'; choices: readonly Choice[] })
  | (ControlBase & { kind: 'stepper'; min: number; max: number; format: (n: number) => string; sub?: (n: number) => string | undefined })
  | (ControlBase & { kind: 'switch'; on: string; off: string; onSub?: string; offSub?: string })
  | (ControlBase & { kind: 'chips'; items: readonly { value: string; label: string }[]; min: number; hint: string })

export interface HowStep {
  icon: IconName
  text: string
}

export interface GameEntry {
  id: GameId
  name: string
  /** título do painel/lobby (ex.: "Mesa de Poker") */
  title: string
  icon: IconName
  line: string
  description: string
  how: readonly [HowStep, HowStep, HowStep]
  category: GameCategory
  quick: boolean
  people: string
  time: string
  bots: boolean
  /** "canal 03" da TV */
  channel: number
  openLabel: string
  controls: readonly ControlSpec[]
  defaults: () => OptionValues
  /** texto curto das opções ("A Estante, 3 vidas, ..."), sempre preenchido */
  summary: (v: OptionValues) => string
}

const plural = (n: number, um: string, varios: string): string => (n === 1 ? `1 ${um}` : `${n} ${varios}`)
const botsText = (n: number): string => (n === 0 ? 'sem robôs' : plural(n, 'robô', 'robôs'))
const botsLabel = (n: number): string => (n === 0 ? 'Sem robôs' : plural(n, 'robô', 'robôs'))
const asNum = (x: unknown, d: number): number => (typeof x === 'number' ? x : d)

const minutes = (list: readonly number[], defaultValue: number, subs: Record<number, string> = {}, zero?: { label: string; sub: string }): Choice[] =>
  list.map((m) => (m === 0 && zero ? { value: 0, label: zero.label, sub: zero.sub, icon: 'clock' as const } : { value: m, label: `${m} min`, sub: subs[m] ?? (m === defaultValue ? 'Padrão' : undefined), icon: 'clock' as const }))

const CLOCK_CHOICES: Choice[] = [
  { value: 5, label: '5 min', sub: 'Para cada um, rápido', icon: 'clock' },
  { value: 10, label: '10 min', sub: 'Padrão', icon: 'clock' },
  { value: 15, label: '15 min', sub: 'Para cada um, com folga', icon: 'clock' },
  { value: 0, label: 'Sem relógio', sub: 'Pensem com calma', icon: 'clock' }
]
const clockSummary = (v: OptionValues): string => {
  const m = asNum(v.minutes, 10)
  return m === 0 ? 'sem relógio' : `${m} minutos para cada um`
}

const ARENA_CHOICES: Choice[] = [
  { value: 'estante', label: ARENAS.estante.name, sub: 'Sala à noite, com prateleiras', icon: 'flag', art: ARENAS.estante.platforms },
  { value: 'telhado', label: ARENAS.telhado.name, sub: "Noite de lua, antena e caixa d'água", icon: 'flag', art: ARENAS.telhado.platforms },
  { value: 'sorteio', label: 'Sorteio', sub: 'O jogo escolhe na hora', icon: 'dice' }
]

const GOLF_MAP_CHOICES: Choice[] = MAPS.map((m) => ({ value: m.id, label: m.name, sub: `${m.holes.length} buracos`, icon: 'flag' as const }))

const STOP_DEFAULT = { rounds: 5, seconds: 120 }

const ENTRIES: Omit<GameEntry, 'channel'>[] = [
  {
    id: 'poker',
    name: 'Poker',
    title: 'Mesa de Poker',
    icon: 'cards',
    line: 'De 2 a 8 pessoas, uma de cada vez',
    description: 'Poker facilitado: os botões já mostram o valor e o jogo explica quem ganhou. Dá para jogar Hold\'em ou uma versão rápida de 3 cartas.',
    how: [
      { icon: 'cards', text: 'Cada pessoa recebe cartas escondidas e a mesa mostra as outras.' },
      { icon: 'chart', text: 'Aposte, pague, aumente ou saia: o valor já vem no botão.' },
      { icon: 'crown', text: 'No fim, o jogo mostra a melhor mão e explica por quê.' }
    ],
    category: 'cartas',
    quick: false,
    people: '2 a 8 pessoas',
    time: '30 min',
    bots: false,
    openLabel: 'Abrir mesa',
    controls: [
      {
        kind: 'segment',
        key: 'mode',
        label: 'Modo',
        icon: 'cards',
        choices: [
          { value: 'holdem', label: "Hold'em", sub: 'Duas cartas na mão e cinco na mesa' },
          { value: 'tres', label: 'Rápido, 3 cartas', sub: 'Uma rodada só, termina logo' }
        ]
      },
      { kind: 'segment', key: 'minutes', label: 'Duração', icon: 'clock', choices: minutes([15, 30, 45, 0], 30, {}, { label: 'Sem limite', sub: 'Até o dono encerrar' }) },
      {
        kind: 'segment',
        key: 'buy',
        label: 'Fichas',
        icon: 'plus',
        choices: [
          { value: 'recompra', label: 'Recompra', sub: 'Quem zera recebe fichas de novo; vence quem lucra mais' },
          { value: 'torneio', label: 'Torneio', sub: 'Quem zera sai da mesa' }
        ]
      }
    ],
    defaults: () => ({ ...DEFAULT_POKER_OPTIONS }),
    summary: (v) => {
      const m = asNum(v.minutes, 30)
      const time = m === 0 ? 'sem limite de tempo' : `${m} minutos`
      return `${v.mode === 'tres' ? 'Rápido, 3 cartas' : "Hold'em"}, ${time}, ${v.buy === 'torneio' ? 'torneio' : 'recompra'}`
    }
  },
  {
    id: 'golf',
    name: 'Golfe',
    title: 'Golfe',
    icon: 'flag',
    line: 'Mini-golfe em 3D, todo mundo joga junto',
    description: 'Mini-golfe para 1 a 8 pessoas, todo mundo no mesmo buraco ao mesmo tempo. Ganha quem somar menos tacadas.',
    how: [
      { icon: 'mouse', text: 'Arraste para trás para mirar e solte para dar a tacada.' },
      { icon: 'users', text: 'Todo mundo joga ao mesmo tempo, sem esperar a vez.' },
      { icon: 'flag', text: 'Menos tacadas no total ganha. Cada buraco tem um tempo.' }
    ],
    category: 'acao',
    quick: true,
    people: '1 a 8 pessoas',
    time: '15 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [
      { kind: 'cards', key: 'mapId', label: 'Mapa', icon: 'flag', choices: GOLF_MAP_CHOICES },
      {
        kind: 'switch',
        key: 'collisions',
        label: 'Bolas batem',
        icon: 'users',
        on: 'Ligado',
        off: 'Desligado',
        onSub: 'Dá para empurrar a bola dos outros',
        offSub: 'Cada um joga sem atrapalhar'
      },
      {
        kind: 'segment',
        key: 'holeSeconds',
        label: 'Tempo por buraco',
        icon: 'clock',
        choices: [
          { value: 60, label: '1 min' },
          { value: 90, label: '1 min 30', sub: 'Padrão' },
          { value: 120, label: '2 min' }
        ]
      }
    ],
    defaults: () => ({ ...DEFAULT_GOLF_OPTIONS }),
    summary: (v) => {
      const map = MAPS.find((m) => m.id === v.mapId)
      const holes = map ? `${map.name} (${map.holes.length} buracos)` : 'mapa'
      return `${holes}, ${v.collisions === false ? 'bolas passam' : 'bolas batem'}, ${asNum(v.holeSeconds, 90)} s por buraco`
    }
  },
  {
    id: 'chess',
    name: 'Xadrez',
    title: 'Xadrez',
    icon: 'pawn',
    line: 'Duas pessoas, com relógio',
    description: 'Xadrez para duas pessoas, com as cores sorteadas. O jogo mostra os lances que valem e avisa xeque, mate e empate.',
    how: [
      { icon: 'pawn', text: 'Toque na peça e veja as casas para onde ela pode ir.' },
      { icon: 'clock', text: 'Cada um tem o seu relógio: acabou o tempo, perdeu.' },
      { icon: 'crown', text: 'O jogo avisa xeque, mate e empate sozinho.' }
    ],
    category: 'tabuleiro',
    quick: false,
    people: '2 pessoas',
    time: '10 a 30 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [{ kind: 'segment', key: 'minutes', label: 'Relógio de cada um', icon: 'clock', choices: CLOCK_CHOICES }],
    defaults: () => ({ ...DEFAULT_CHESS_OPTIONS }),
    summary: clockSummary
  },
  {
    id: 'checkers',
    name: 'Damas',
    title: 'Damas',
    icon: 'checker',
    line: 'Duas pessoas, regras brasileiras',
    description: 'Damas para duas pessoas, com as regras brasileiras: capturar é obrigatório, vale a jogada que captura mais e a dama anda longe. As cores são sorteadas.',
    how: [
      { icon: 'checker', text: 'Ande na diagonal e capture pulando a peça do outro.' },
      { icon: 'focus', text: 'Capturar é obrigatório, e vale o caminho que captura mais.' },
      { icon: 'crown', text: 'Chegou na última fileira, vira dama e anda longe.' }
    ],
    category: 'tabuleiro',
    quick: true,
    people: '2 pessoas',
    time: '10 a 20 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [{ kind: 'segment', key: 'minutes', label: 'Relógio de cada um', icon: 'clock', choices: CLOCK_CHOICES }],
    defaults: () => ({ ...DEFAULT_CHECKERS_OPTIONS }),
    summary: clockSummary
  },
  {
    id: 'tycoon',
    name: 'Magnata',
    title: 'Magnata',
    icon: 'dice',
    line: 'Compre cidades e quebre os amigos, de 2 a 6',
    description: 'Jogo rápido de comprar cidades para 2 a 6 pessoas. Construa na hora, cobre aluguel e compre a cidade dos outros.',
    how: [
      { icon: 'dice', text: 'Role o dado, ande pelo tabuleiro e compre cidades.' },
      { icon: 'plus', text: 'Construa na hora e cobre aluguel de quem passar.' },
      { icon: 'crown', text: 'Vence quem fechar 3 grupos, um lado inteiro ou as 4 praias.' }
    ],
    category: 'tabuleiro',
    quick: false,
    people: '2 a 6 pessoas',
    time: '25 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [
      {
        kind: 'segment',
        key: 'minutes',
        label: 'Duração',
        icon: 'clock',
        choices: [
          { value: 15, label: '15 min', sub: 'Partida curta', icon: 'clock' },
          { value: 25, label: '25 min', sub: 'Padrão', icon: 'clock' },
          { value: 40, label: '40 min', icon: 'clock' },
          { value: 0, label: 'Sem limite', sub: 'Até alguém vencer', icon: 'clock' }
        ]
      }
    ],
    defaults: () => ({ ...DEFAULT_TYCOON_OPTIONS }),
    summary: (v) => {
      const m = asNum(v.minutes, 25)
      return m ? `até ${m} minutos` : 'sem limite de tempo'
    }
  },
  {
    id: 'truco',
    name: 'Truco',
    title: 'Truco',
    icon: 'sword',
    line: 'Truco gaudério: 1x1, 2x2 ou 3x3',
    description: 'Truco gaudério até 30 pontos, com flor (3) e contra-flor (6). Escolha a cadeira para escolher a dupla: cadeiras ímpares jogam juntas contra as pares.',
    how: [
      { icon: 'cards', text: 'Baralho espanhol: jogue a carta mais forte de cada mão.' },
      { icon: 'chat', text: 'Peça truco, envido ou flor para subir os pontos.' },
      { icon: 'users', text: 'Duplas pela cadeira: ímpares contra pares.' }
    ],
    category: 'cartas',
    quick: false,
    people: '2, 4 ou 6 pessoas',
    time: '20 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [
      {
        kind: 'segment',
        key: 'players',
        label: 'Mesa',
        icon: 'users',
        choices: [
          { value: 2, label: '1x1', sub: 'Mano a mano' },
          { value: 4, label: '2x2', sub: 'Duas duplas (padrão)' },
          { value: 6, label: '3x3', sub: 'Com mão de testa entre 5 e 25 pontos' }
        ]
      }
    ],
    defaults: () => ({ ...DEFAULT_TRUCO_OPTIONS }),
    summary: (v) => {
      const n = asNum(v.players, 4) / 2
      return `${n}x${n}, até 30 pontos, com flor`
    }
  },
  {
    id: 'shooter',
    name: 'Tiro na Sala',
    title: 'Tiro na Sala',
    icon: 'target',
    line: 'Tiroteio pixel na casa, todo mundo contra todo mundo',
    description: 'Tiroteio em pixel art na casa, todo mundo contra todo mundo, de 1 a 8 pessoas mais robôs. Dá para entrar com a partida já rolando.',
    how: [
      { icon: 'mouse', text: 'Mova, mire e atire: ganha quem derrubar mais gente.' },
      { icon: 'users', text: 'Entre a qualquer momento, até com a partida rolando.' },
      { icon: 'target', text: 'Acaba no tempo ou quando alguém chegar no limite de abates.' }
    ],
    category: 'acao',
    quick: true,
    people: '1 a 8 pessoas',
    time: '5 min',
    bots: true,
    openLabel: 'Abrir partida',
    controls: [
      {
        kind: 'cards',
        key: 'mapId',
        label: 'Mapa',
        icon: 'flag',
        choices: [
          { value: 'casa', label: 'A Casa', sub: 'Sala com sofá e TV, cozinha, corredor e quartos', icon: 'flag' },
          { value: 'quintal', label: 'O Quintal', sub: 'Varal, churrasqueira e uma piscina de plástico', icon: 'flag' }
        ]
      },
      { kind: 'segment', key: 'minutes', label: 'Duração', icon: 'clock', choices: minutes(MATCH_MINUTES, 5) },
      {
        kind: 'segment',
        key: 'killLimit',
        label: 'Limite de abates',
        icon: 'target',
        choices: KILL_LIMITS.map((k) => ({ value: k, label: `${k} abates`, sub: k === 20 ? 'Padrão' : 'Acaba antes se alguém chegar lá' }))
      },
      { kind: 'stepper', key: 'bots', label: 'Robôs', icon: 'users', min: 0, max: SHOOTER_MAX_BOTS, format: botsLabel, sub: (n) => (n === 0 ? 'Só gente de verdade' : undefined) }
    ],
    defaults: () => ({ ...DEFAULT_SHOOTER_OPTIONS }),
    summary: (v) => {
      const map = v.mapId === 'quintal' ? 'O Quintal' : 'A Casa'
      return `${map}, ${asNum(v.minutes, 5)} minutos, ${asNum(v.killLimit, 20)} abates, ${botsText(asNum(v.bots, 0))}`
    }
  },
  {
    id: 'brawl',
    name: 'Briga na Sala',
    title: 'Briga na Sala',
    icon: 'fist',
    line: 'Luta de plataforma com o Jan, a JanJa e a turma',
    description: 'Luta de plataforma com o Jan, a Xícara, a Tevê e a JanJa, de 1 a 8 pessoas mais robôs. Empurre os outros para fora da arena: quanto mais dano, mais longe eles voam.',
    how: [
      { icon: 'fist', text: 'Bata, pule e use as armas que aparecem na arena.' },
      { icon: 'focus', text: 'Quanto mais dano, mais longe o golpe joga o outro.' },
      { icon: 'crown', text: 'Jogue o outro para fora: vale por vidas ou por tempo.' }
    ],
    category: 'acao',
    quick: true,
    people: '1 a 8 pessoas',
    time: '3 min',
    bots: true,
    openLabel: 'Abrir partida',
    controls: [
      {
        kind: 'segment',
        key: 'mode',
        label: 'Modo',
        icon: 'users',
        choices: [
          { value: 'vidas', label: 'Vidas', sub: 'Cada um tem algumas vidas; sobrou um, acabou' },
          { value: 'tempo', label: 'Tempo', sub: 'Vale quem nocautear mais até o relógio zerar' }
        ]
      },
      {
        kind: 'stepper',
        key: 'stocks',
        label: 'Vidas',
        icon: 'users',
        min: 1,
        max: 5,
        format: (n) => plural(n, 'vida', 'vidas'),
        when: (v) => v.mode !== 'tempo'
      },
      {
        kind: 'segment',
        key: 'minutes',
        label: 'Duração',
        icon: 'clock',
        choices: minutes(BRAWL_MINUTES, 3),
        when: (v) => v.mode === 'tempo'
      },
      { kind: 'cards', key: 'arenaId', label: 'Arena', icon: 'flag', choices: ARENA_CHOICES },
      {
        kind: 'segment',
        key: 'teamSize',
        label: 'Times',
        icon: 'users',
        choices: [
          { value: 0, label: 'Livre', sub: 'Todos contra todos, cada um por si' },
          { value: 2, label: '2x2', sub: 'Duplas: dois times de dois' },
          { value: 3, label: '3x3', sub: 'Trios: dois times de três' },
          { value: 4, label: '4x4', sub: 'Times: dois times de quatro' }
        ]
      },
      {
        kind: 'switch',
        key: 'friendlyFire',
        label: 'Fogo amigo',
        icon: 'warn',
        on: 'Ligado',
        off: 'Desligado',
        onSub: 'Dá para acertar o seu time',
        offSub: 'Golpe não pega o seu time',
        when: (v) => v.teamSize !== 0
      },
      { kind: 'stepper', key: 'bots', label: 'Robôs', icon: 'users', min: 0, max: BRAWL_MAX_BOTS, format: botsLabel, sub: (n) => (n === 0 ? 'Só gente de verdade' : undefined) },
      {
        kind: 'segment',
        key: 'botLevel',
        label: 'Nível dos robôs',
        icon: 'sliders',
        choices: [
          { value: 'facil', label: 'Fácil', sub: 'Robôs lentos e distraídos' },
          { value: 'medio', label: 'Médio', sub: 'Padrão' },
          { value: 'dificil', label: 'Difícil', sub: 'Robôs rápidos e atentos' }
        ],
        when: (v) => asNum(v.bots, 0) > 0
      }
    ],
    defaults: () => ({ ...DEFAULT_BRAWL_OPTIONS }),
    summary: (v) => {
      const arena = v.arenaId === 'sorteio' ? 'arena sorteada' : v.arenaId === 'telhado' ? ARENAS.telhado.name : ARENAS.estante.name
      const stocks = asNum(v.stocks, 3)
      const rule = v.mode === 'tempo' ? `${asNum(v.minutes, 3)} minutos` : plural(stocks, 'vida', 'vidas')
      const team = asNum(v.teamSize, 0)
      const teams = team === 0 ? 'todos contra todos' : `times ${team}x${team}`
      return `${arena}, ${rule}, ${teams}, ${botsText(asNum(v.bots, 0))}`
    }
  },
  {
    id: 'naval',
    name: 'Batalha naval',
    title: 'Batalha naval',
    icon: 'anchor',
    line: 'Duas pessoas, cada uma com a sua frota',
    description: 'Batalha naval para duas pessoas. Cada uma posiciona a frota escondida e tenta afundar a do outro primeiro.',
    how: [
      { icon: 'anchor', text: 'Posicione os 5 navios sem deixar encostar um no outro.' },
      { icon: 'focus', text: 'Escolha uma casa do mar do outro e atire.' },
      { icon: 'crown', text: 'Quem afundar a frota inteira primeiro vence.' }
    ],
    category: 'tabuleiro',
    quick: true,
    people: '2 pessoas',
    time: '10 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [
      {
        kind: 'segment',
        key: 'mode',
        label: 'Tiros',
        icon: 'focus',
        choices: [
          { value: 'classico', label: 'Clássico', sub: 'Um tiro por vez; acertou, joga de novo' },
          { value: 'salva', label: 'Salva', sub: 'Um tiro por navio de pé, todos de uma vez' }
        ]
      }
    ],
    defaults: () => ({ ...DEFAULT_NAVAL_OPTIONS }),
    summary: (v) => (v.mode === 'salva' ? 'modo salva' : 'modo clássico')
  },
  {
    id: 'mystery',
    name: 'Mistério',
    title: 'Mistério',
    icon: 'search',
    line: 'Descubra quem roubou o quadro, de 2 a 6',
    description: 'Roubaram o quadro do Casarão da Vila durante a festa. Role os dados, ande pelos cômodos e palpite quem foi e com o quê: quem tiver uma das cartas mostra para você em segredo.',
    how: [
      { icon: 'search', text: 'Role os dados, entre num cômodo e palpite um suspeito e um objeto ali.' },
      { icon: 'cards', text: 'Quem tiver uma das cartas mostra só para você.' },
      { icon: 'crown', text: 'Tem certeza? Faça a acusação. Acertou, venceu.' }
    ],
    category: 'tabuleiro',
    quick: false,
    people: '2 a 6 pessoas',
    time: '20 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [],
    defaults: () => ({}),
    summary: () => 'o roubo do quadro no Casarão da Vila'
  },
  {
    id: 'pool',
    name: 'Sinuca',
    title: 'Sinuca',
    icon: 'eight',
    line: 'Bola 8, uma pessoa contra a outra',
    description: 'Sinuca de bola 8 para duas pessoas: lisas contra listradas. Encaçapou do seu grupo, joga de novo; falta dá bola na mão para o outro.',
    how: [
      { icon: 'mouse', text: 'Mire com a linha guia e escolha a força da tacada.' },
      { icon: 'eight', text: 'Encaçapou do seu grupo, joga de novo.' },
      { icon: 'crown', text: 'Limpou o grupo? Escolha a caçapa e mate a 8.' }
    ],
    category: 'tabuleiro',
    quick: true,
    people: '2 pessoas',
    time: '15 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [],
    defaults: () => ({}),
    summary: () => 'bola 8, lisas contra listradas'
  },
  {
    id: 'stop',
    name: 'Stop',
    title: 'Stop',
    icon: 'pencil',
    line: 'Adedonha: uma letra, todo mundo escreve junto',
    description: 'Stop para 2 a 10 pessoas. Sorteia uma letra, todo mundo preenche as categorias e quem terminar grita STOP.',
    how: [
      { icon: 'pencil', text: 'Uma letra é sorteada e todo mundo escreve ao mesmo tempo.' },
      { icon: 'stop', text: 'Preencheu tudo? Grite STOP e a rodada acaba.' },
      { icon: 'chart', text: 'Resposta única vale 10 pontos e repetida vale 5.' }
    ],
    category: 'cartas',
    quick: true,
    people: '2 a 10 pessoas',
    time: '15 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [
      { kind: 'segment', key: 'rounds', label: 'Rodadas', icon: 'grid', choices: STOP_ROUNDS.map((n) => ({ value: n, label: `${n}`, sub: n === STOP_DEFAULT.rounds ? 'Padrão' : undefined })) },
      {
        kind: 'segment',
        key: 'seconds',
        label: 'Tempo de cada rodada',
        icon: 'clock',
        choices: STOP_SECONDS.map((s) => ({
          value: s,
          label: s === 0 ? 'Sem tempo' : s === 90 ? '1 min 30' : `${s / 60} min`,
          sub: s === 0 ? 'Só para no STOP' : s === STOP_DEFAULT.seconds ? 'Padrão' : undefined
        }))
      },
      { kind: 'chips', key: 'categories', label: 'Categorias', icon: 'pencil', items: CATEGORIES.map((c) => ({ value: c.id, label: c.name })), min: 3, hint: 'Pelo menos 3 categorias.' }
    ],
    defaults: () => ({ categories: [...DEFAULT_CATEGORIES], ...STOP_DEFAULT }),
    summary: (v) => {
      const cats = Array.isArray(v.categories) ? v.categories : DEFAULT_CATEGORIES
      const s = asNum(v.seconds, 120)
      return `${asNum(v.rounds, 5)} rodadas, ${s ? `${s} s cada` : 'sem tempo'}: ${cats.map(categoryName).join(', ')}`
    }
  },
  {
    id: 'velha',
    name: 'Velha ao quadrado',
    title: 'Velha ao quadrado',
    icon: 'velha',
    line: 'Jogo da velha feito de jogos da velha',
    description: 'Um jogo da velha grande em que cada casa é um jogo da velha pequeno. A casa em que você joga escolhe onde o outro vai jogar. Quem fica com o X é sorteado.',
    how: [
      { icon: 'velha', text: 'Faça três em linha num tabuleiro pequeno para ganhar ele.' },
      { icon: 'focus', text: 'A casa em que você joga manda o outro para o tabuleiro de mesmo lugar.' },
      { icon: 'crown', text: 'Ganhe três tabuleiros em linha no grande para vencer.' }
    ],
    category: 'tabuleiro',
    quick: true,
    people: '2 pessoas',
    time: '5 a 10 min',
    bots: false,
    openLabel: 'Abrir partida',
    controls: [{ kind: 'segment', key: 'minutes', label: 'Relógio de cada um', icon: 'clock', choices: CLOCK_CHOICES }],
    defaults: () => ({ ...DEFAULT_VELHA_OPTIONS }),
    summary: clockSummary
  },
  {
    id: 'pife',
    name: 'Pife',
    title: 'Pife',
    icon: 'cards',
    line: 'Junte três jogos e bata primeiro',
    description:
      'Pife para 2 a 8 pessoas, com dois baralhos e os coringas. Cada um recebe 9 cartas; na sua vez, compre do monte ou do lixo e descarte uma. Quem fechar a mão em jogos bate e ganha a rodada.',
    how: [
      { icon: 'cards', text: 'Compre do monte ou pegue a carta de cima do lixo, e descarte uma.' },
      { icon: 'grid', text: 'Jogos: trinca do mesmo número (qualquer naipe) ou sequência do mesmo naipe. O coringa só entra em sequência.' },
      { icon: 'crown', text: 'Fechou a mão em jogos? Bata e ganhe a rodada.' }
    ],
    category: 'cartas',
    quick: true,
    people: '2 a 8 pessoas',
    time: '10 min',
    bots: false,
    openLabel: 'Abrir mesa',
    controls: [],
    defaults: () => ({}),
    summary: () => 'Dois baralhos com coringa, 9 cartas cada'
  },
  {
    id: 'race',
    name: 'Corrida na Sala',
    title: 'Corrida na Sala',
    icon: 'car',
    line: 'Carrinhos de brinquedo correndo pela casa',
    description:
      'Corrida de carrinhos vistos de cima, de 1 a 8 pessoas mais robôs, na pista do tapete da sala ou na terra do quintal. Pegue os turbos, não saia da pista e cruze a chegada primeiro.',
    how: [
      { icon: 'car', text: 'Acelere, frene e faça as curvas sem sair da pista.' },
      { icon: 'focus', text: 'As setas amarelas no chão dão turbo; fora da pista o carro fica lento.' },
      { icon: 'flag', text: 'Ganha quem completar as voltas primeiro.' }
    ],
    category: 'acao',
    quick: true,
    people: '1 a 8 pessoas',
    time: '2 min',
    bots: true,
    openLabel: 'Abrir corrida',
    controls: [
      {
        kind: 'cards',
        key: 'trackId',
        label: 'Pista',
        icon: 'flag',
        choices: [
          { value: 'sala', label: TRACK_DEFS.sala.name, sub: TRACK_DEFS.sala.sub, icon: 'flag' },
          { value: 'quintal', label: TRACK_DEFS.quintal.name, sub: TRACK_DEFS.quintal.sub, icon: 'flag' },
          { value: 'sorteio', label: 'Sorteio', sub: 'O jogo escolhe na hora', icon: 'dice' }
        ]
      },
      {
        kind: 'segment',
        key: 'laps',
        label: 'Voltas',
        icon: 'flag',
        choices: RACE_LAPS.map((n) => ({ value: n, label: `${n} voltas`, sub: n === 5 ? 'Padrão' : n === 3 ? 'Corrida rápida' : 'Corrida longa' }))
      },
      { kind: 'stepper', key: 'bots', label: 'Robôs', icon: 'users', min: 0, max: RACE_MAX_BOTS, format: botsLabel, sub: (n) => (n === 0 ? 'Só gente de verdade' : undefined) },
      {
        kind: 'segment',
        key: 'botLevel',
        label: 'Nível dos robôs',
        icon: 'sliders',
        choices: [
          { value: 'facil', label: 'Fácil', sub: 'Robôs devagar nas curvas' },
          { value: 'medio', label: 'Médio', sub: 'Padrão' },
          { value: 'dificil', label: 'Difícil', sub: 'Robôs rápidos e certeiros' }
        ],
        when: (v) => asNum(v.bots, 0) > 0
      }
    ],
    defaults: () => ({ ...DEFAULT_RACE_OPTIONS }),
    summary: (v) => {
      const track = v.trackId === 'sorteio' ? 'pista sorteada' : v.trackId === 'quintal' ? TRACK_DEFS.quintal.name : TRACK_DEFS.sala.name
      return `${track}, ${asNum(v.laps, 5)} voltas, ${botsText(asNum(v.bots, 0))}`
    }
  }
]

/** o catálogo na ordem de GAME_IDS (a ordem da vitrine e dos canais) */
export const CATALOG: Record<GameId, GameEntry> = Object.fromEntries(
  GAME_IDS.map((id, i) => {
    const e = ENTRIES.find((x) => x.id === id)
    if (!e) throw new Error(`jogo sem entrada no catálogo: ${id}`)
    return [id, { ...e, channel: i + 1 }]
  })
) as Record<GameId, GameEntry>

export const CATALOG_LIST: readonly GameEntry[] = GAME_IDS.map((id) => CATALOG[id])

export const gameTitle = (id: GameId): string => CATALOG[id].title

export function matchesFilter(e: GameEntry, f: ShelfFilter): boolean {
  return f === 'todos' || (f === 'rapidos' ? e.quick : e.category === f)
}

export const defaultValues = (id: GameId): OptionValues => CATALOG[id].defaults()

const sameValue = (a: unknown, b: unknown): boolean => a === b

/**
 * Monta o objeto de opções que vai em `api.open`. Cada valor fora do que o controle aceita volta
 * para o padrão (como os `onChange` do painel antigo faziam). Só as chaves do esquema saem.
 */
export function buildOptions(id: GameId, values: OptionValues): Record<string, OptionValue> {
  const entry = CATALOG[id]
  const defaults = entry.defaults()
  const out: Record<string, OptionValue> = {}
  for (const c of entry.controls) {
    const raw = values[c.key]
    const fallback = defaults[c.key]
    if (c.kind === 'segment' || c.kind === 'cards') {
      out[c.key] = c.choices.some((ch) => sameValue(ch.value, raw)) ? (raw as OptionValue) : fallback
    } else if (c.kind === 'stepper') {
      out[c.key] = typeof raw === 'number' && Number.isInteger(raw) ? Math.max(c.min, Math.min(c.max, raw)) : fallback
    } else if (c.kind === 'switch') {
      out[c.key] = typeof raw === 'boolean' ? raw : fallback
    } else {
      const picked = Array.isArray(raw) ? raw : []
      const ordered = c.items.map((i) => i.value).filter((v) => picked.includes(v))
      out[c.key] = ordered.length >= c.min ? ordered : fallback
    }
  }
  return out
}

/** Texto das opções, nunca vazio. Aceita opções cruas (por exemplo as do lobby). */
export function summarize(id: GameId, values: unknown): string {
  const v = values && typeof values === 'object' && !Array.isArray(values) ? (values as OptionValues) : {}
  const text = CATALOG[id].summary(buildOptions(id, v))
  return text || CATALOG[id].name
}

/** primeira letra maiúscula, para a linha de resumo */
export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s)
