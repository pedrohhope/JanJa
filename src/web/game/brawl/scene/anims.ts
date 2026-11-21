/**
 * Todas as animações dos 4 personagens, geradas por composição (corpo base + braços/arma por pose).
 * `buildSet(char, held)` devolve os quadros em letras já com contorno (`t`).
 */
import type { CharacterId, Held } from '../../../../shared/games/brawl/types'
import { G, outline, type Rows } from './grid'
import { paintOverlay } from './overlays'
import { basePose, type Face, type Legs, type Pose } from './pose'
import { RIGS, composeBody } from './rigs'

export type AnimName =
  | 'idle'
  | 'tique'
  | 'run'
  | 'air'
  | 'fall'
  | 'wall'
  | 'dodge'
  | 'hurt'
  | 'charge'
  | 'win'
  | 'leve-neutro'
  | 'leve-lado'
  | 'leve-baixo'
  | 'ar-neutro'
  | 'ar-lado'
  | 'ar-baixo'
  | 'ar-cima'
  | 'forte-neutro'
  | 'forte-lado'
  | 'forte-baixo'

/** quantos quadros cada animação tem */
export const ANIM_FRAMES: Record<AnimName, number> = {
  idle: 4,
  tique: 4,
  run: 6,
  air: 3,
  fall: 2,
  wall: 2,
  dodge: 2,
  hurt: 2,
  charge: 2,
  win: 4,
  'leve-neutro': 3,
  'leve-lado': 3,
  'leve-baixo': 3,
  'ar-neutro': 3,
  'ar-lado': 3,
  'ar-baixo': 3,
  'ar-cima': 3,
  'forte-neutro': 4,
  'forte-lado': 4,
  'forte-baixo': 4
}
export const ANIM_NAMES = Object.keys(ANIM_FRAMES) as AnimName[]
export const HELD_LIST: readonly Held[] = ['mao', 'vassoura', 'frigideira', 'luvas']

const L = (f: [number, number], b: [number, number]): Legs => ({ f, b })

/** posição de repouso da arma/mão: o que cada coisa faz com a mão da frente quando não está batendo */
function carry(held: Held, p: Pose): Pose {
  if (held === 'vassoura') return { ...p, fh: [1, 3], bh: [-1, 4], ang: 288 }
  if (held === 'frigideira') return { ...p, fh: [2, 3], bh: [0, 4], ang: 345 }
  if (held === 'luvas') return { ...p, fh: [3, 0], bh: [2, 1] }
  return p
}

type Gen = (char: CharacterId, held: Held, i: number) => Pose

const P = basePose

// ------------------------------------------------------------------ movimento
const idle: Gen = (_char, held, i) => {
  const dy = i === 2 || i === 3 ? 1 : 0
  const face: Face = 'normal'
  const arms: Partial<Pose> = dy ? { fh: [0, 5], bh: [0, 5] } : { fh: [0, 5], bh: [0, 5] }
  return carry(held, P({ dy, face, pomp: i === 2 ? 1 : i === 3 ? 0 : i === 0 ? 0 : -1, t: i, ov: undefined, ...arms }))
}

const tique: Gen = (char, held, i) => {
  const h = held !== 'mao'
  switch (char) {
    case 'jan':
      // dá um tapinha e embaralha as cartas na mão
      return carry(held, P({ face: i % 2 ? 'smug' : 'normal', fh: h ? [1, 3] : [3, 0], bh: [0, 5], t: i, ov: h ? undefined : 'cards-wind', ovT: i / 4, dy: i % 2 ? 1 : 0 }))
    case 'janja':
      // ajeita o fone: a mão sobe até a orelha e o LED pisca
      return carry(held, P({ face: i === 2 ? 'blink' : 'smug', fh: h ? [1, 3] : [-3, -7 + (i % 2)], bh: [0, 5], t: i, dy: 0 }))
    case 'xicara':
      // treme de frio e solta uma baforada de vapor
      return carry(held, P({ face: i === 1 ? 'scared' : 'smug', lean: 0, dy: i % 2, pomp: i % 2 ? 2 : -2, t: i + 1, ov: i === 2 ? 'steam-jet' : undefined, legs: L([1, 0], [-1, 0]) }))
    case 'teve':
      // dá um tapa na lateral para o chiado passar
      return carry(held, P({ face: i === 1 || i === 2 ? 'hurt' : 'normal', fh: h ? [1, 3] : i === 1 ? [-3, -3] : i === 2 ? [-6, -2] : [0, 5], bh: [0, 5], t: i, ov: i === 1 || i === 2 ? 'chiado' : undefined, pomp: i % 2 ? 2 : -2 }))
  }
}

const RUN: { f: [number, number]; b: [number, number]; dy: number; lean: number }[] = [
  { f: [3, 0], b: [-4, 1], dy: 1, lean: 1 },
  { f: [1, 0], b: [-2, 3], dy: 0, lean: 1 },
  { f: [-1, 1], b: [1, 2], dy: 0, lean: 1 },
  { f: [-4, 1], b: [3, 0], dy: 1, lean: 1 },
  { f: [-2, 3], b: [1, 0], dy: 0, lean: 1 },
  { f: [1, 2], b: [-1, 1], dy: 0, lean: 1 }
]
const run: Gen = (_char, held, i) => {
  const r = RUN[i]!
  const sw = Math.round(r.f[0] * 0.8)
  return carry(held, P({ dy: r.dy, lean: r.lean + 1, legs: L(r.f, r.b), fh: [-sw, 4], bh: [sw, 4], face: 'normal', pomp: -2, t: i }))
}

const air: Gen = (_char, held, i) => {
  const set: Partial<Pose>[] = [
    { legs: L([2, 2], [-2, 1]), fh: [3, -2], bh: [-3, -1], pomp: 2, dy: 0 }, // subindo
    { legs: L([2, 3], [-1, 3]), fh: [4, 0], bh: [-4, 0], pomp: 0, dy: 0 }, // topo
    { legs: L([1, 1], [-2, 0]), fh: [2, -3], bh: [-2, -3], pomp: -2, dy: 0 } // descendo
  ]
  return carry(held, P({ ...set[i]!, face: 'normal', t: i }))
}

const fall: Gen = (_char, held, i) =>
  carry(held, P({ legs: L([1, i], [0, i ? 0 : 1]), fh: [2, -6], bh: [-2, -6], lean: 0, dy: 0, pomp: 3, face: 'scared', t: i }))

const wall: Gen = (_char, held, i) =>
  carry(held, P({ lean: 1, dy: 0, legs: L([2, 3 - i], [1, 1 + i]), fh: [3, -6 + i], bh: [2, -3 - i], face: 'effort', t: i, pomp: 1 }))

const dodge: Gen = (_char, held, i) =>
  carry(held, P({ dy: i ? 4 : 3, lean: i ? 3 : 2, legs: L([4, 0], [-3, 0]), fh: [2, 4], bh: [0, 4], face: 'blink', t: i, pomp: -2 }))

const hurt: Gen = (char, _held, i) =>
  i === 0
    ? P({ lean: -3, dy: 1, legs: L([-2, 1], [2, 1]), fh: [-3, -3], bh: [3, -2], face: 'hurt', pomp: -3, t: 0, ov: char === 'teve' ? 'chiado' : undefined })
    : P({ lean: -1, dy: 0, legs: L([4, 3], [-3, 2]), fh: [3, -5], bh: [-3, -6], face: 'hurt', pomp: 3, t: 1, ov: char === 'teve' ? 'chiado' : undefined })

const charge: Gen = (_char, held, i) =>
  carry(held, P({ dy: 2 + i, lean: -2, legs: L([3, 0], [-4, 0]), fh: [-1, i ? 0 : 1], bh: [0, 2], ang: held === 'mao' ? 300 : 255, face: 'effort', glow: 0.5 + i * 0.5, t: i, pomp: -1 - i }))

const win: Gen = (char, held, i) => {
  const up = i === 0 || i === 2
  const base: Partial<Pose> = { dy: up ? 0 : 1, legs: up ? L([2, 3], [-2, 2]) : L([2, 0], [-2, 0]), face: 'win', t: i, ov: 'sparkle', pomp: up ? 3 : -1 }
  switch (char) {
    case 'jan':
      return carry(held, P({ ...base, fh: [1, -8], bh: held === 'mao' ? [-2, 3] : [-1, 4], ov: 'sparkle' }))
    case 'janja':
      return carry(held, P({ ...base, fh: [3, -7], bh: [-3, -7] }))
    case 'xicara':
      return carry(held, P({ ...base, fh: [3, -6], bh: [-4, -6], ov: 'steam-jet' }))
    case 'teve':
      return carry(held, P({ ...base, fh: [2, -7], bh: [-2, -7], ov: i % 2 ? 'sparkle' : 'chiado' }))
  }
}

// ------------------------------------------------------------------ golpes
interface K {
  dy?: number
  lean?: number
  legs?: Legs
  fh: [number, number]
  bh?: [number, number]
  ang: number
  reach?: number
  face?: Face
}
const GROUND = L([2, 0], [-3, 0])
const STRIDE = L([3, 0], [-4, 0])
const AIRL = L([2, 3], [-1, 2])
const mk = (k: K, over: Partial<Pose> = {}): Pose =>
  P({ dy: k.dy ?? 0, lean: k.lean ?? 0, legs: k.legs ?? GROUND, fh: k.fh, bh: k.bh ?? [0, 4], ang: k.ang, reach: k.reach ?? 0, face: k.face ?? 'normal', pomp: -1, ...over })

type Stages = K[]

const LEVE: Record<string, Stages> = {
  'leve-neutro': [
    { lean: -1, dy: 1, fh: [-1, 3], ang: 0 },
    { lean: 2, legs: STRIDE, fh: [7, 1], ang: 0, reach: 2, face: 'effort' },
    { lean: 1, fh: [3, 2], ang: 340 }
  ],
  'leve-lado': [
    { lean: -2, fh: [-2, -6], bh: [-1, 2], ang: 235, legs: L([1, 0], [-3, 0]) },
    { lean: 2, legs: STRIDE, fh: [6, 2], ang: 20, reach: 1, face: 'effort' },
    { lean: 1, fh: [4, 5], ang: 70 }
  ],
  'leve-baixo': [
    { dy: 1, lean: -1, fh: [0, -1], ang: 300 },
    { dy: 3, lean: 2, legs: L([4, 0], [-3, 0]), fh: [6, 7], ang: 0, reach: 1, face: 'effort' },
    { dy: 2, lean: 1, fh: [4, 6], ang: 20 }
  ],
  'ar-neutro': [
    { legs: AIRL, lean: -1, fh: [-1, 2], ang: 0 },
    { legs: AIRL, lean: 1, fh: [7, 1], ang: 0, reach: 2, face: 'effort' },
    { legs: AIRL, fh: [3, 2], ang: 340 }
  ],
  'ar-lado': [
    { legs: AIRL, lean: -2, fh: [-2, -6], ang: 235 },
    { legs: L([3, 2], [-3, 2]), lean: 2, fh: [6, 2], ang: 20, reach: 1, face: 'effort' },
    { legs: AIRL, lean: 1, fh: [4, 5], ang: 70 }
  ],
  'ar-baixo': [
    { legs: L([1, 3], [-1, 3]), fh: [0, -3], ang: 270 },
    { legs: L([1, 0], [-1, 0]), fh: [2, 6], ang: 90, reach: 1, face: 'effort', lean: 1 },
    { legs: L([1, 1], [-1, 1]), fh: [2, 5], ang: 90 }
  ],
  'ar-cima': [
    { legs: L([2, 2], [-2, 2]), dy: 1, fh: [0, 0], ang: 300 },
    { legs: L([0, 0], [0, 1]), fh: [1, -9], bh: [-1, -8], ang: 270, reach: 1, face: 'effort', lean: 0 },
    { legs: L([1, 1], [-1, 1]), fh: [1, -7], bh: [-1, -6], ang: 275 }
  ]
}

const FORTE: Record<string, Stages> = {
  'forte-neutro': [
    { dy: 2, lean: -2, legs: STRIDE, fh: [-2, 1], ang: 250, face: 'effort' },
    { dy: 1, lean: -1, fh: [1, -8], bh: [-1, -8], ang: 270, face: 'effort' },
    { lean: 3, legs: STRIDE, fh: [6, 3], bh: [4, 3], ang: 40, reach: 2, face: 'effort' },
    { lean: 1, fh: [3, 4], ang: 20 }
  ],
  'forte-lado': [
    { dy: 1, lean: -3, legs: STRIDE, fh: [-3, -1], ang: 190, face: 'effort' },
    { dy: 1, lean: -3, legs: STRIDE, fh: [-4, -4], ang: 215, face: 'effort' },
    { lean: 3, legs: L([4, 0], [-4, 0]), fh: [8, 0], ang: 0, reach: 3, face: 'effort' },
    { lean: 2, fh: [5, 2], ang: 20 }
  ],
  'forte-baixo': [
    { dy: 2, lean: -2, legs: STRIDE, fh: [0, 1], ang: 270 },
    { dy: 3, lean: -2, legs: L([4, 0], [-3, 0]), fh: [-1, -3], ang: 250, face: 'effort' },
    { dy: 3, lean: 3, legs: L([5, 0], [-3, 0]), fh: [7, 8], ang: 0, reach: 2, face: 'effort' },
    { dy: 2, lean: 2, fh: [4, 6], ang: 20 }
  ]
}

/** assinatura de cada golpe forte: efeito pintado por cima por estágio */
const SIGNATURE: Record<CharacterId, Record<string, (string | undefined)[]>> = {
  jan: {
    'forte-neutro': ['cards-wind', 'cards-wind', 'cards-orbit', 'cards-orbit'],
    'forte-lado': [undefined, undefined, 'shoulder', 'shoulder'],
    'forte-baixo': ['shuffle', 'shuffle', 'shuffle', 'shuffle']
  },
  xicara: {
    'forte-neutro': [undefined, 'steam-jet', 'steam-jet', 'steam-jet'],
    'forte-lado': [undefined, undefined, 'spill', 'spill'],
    'forte-baixo': ['spin', 'spin', 'spin', 'spin']
  },
  teve: {
    'forte-neutro': ['static', 'static', 'static', 'static'],
    'forte-lado': [undefined, 'chiado', 'bolt', 'bolt'],
    'forte-baixo': [undefined, undefined, 'collapse', 'collapse']
  },
  janja: {
    'forte-neutro': ['window', 'window', 'window', 'window'],
    'forte-lado': [undefined, 'wifi', 'wifi', 'wifi'],
    'forte-baixo': ['mic', 'mic', 'mic', 'mic']
  }
}

/** poses específicas do corpo nas assinaturas (a Tevê cai de costas, a Xícara gira) */
function signatureTweak(char: CharacterId, name: string, stage: number, p: Pose): Pose {
  if (char === 'teve' && name === 'forte-lado' && stage >= 2) return { ...p, ov: p.ov, face: 'effort' }
  if (char === 'teve' && name === 'forte-baixo' && stage >= 2) return { ...p, dy: 6, lean: -4, face: 'effort', legs: L([4, 0], [-4, 0]) }
  if (char === 'xicara' && name === 'forte-baixo') return { ...p, dy: 1 + (stage % 2), lean: stage % 2 ? 2 : -2, face: 'effort', legs: L([stage % 2 ? 3 : -3, 0], [stage % 2 ? -3 : 3, 0]) }
  if (char === 'xicara' && name === 'forte-lado' && stage >= 2) return { ...p, lean: 4, dy: 2, face: 'effort' }
  if (char === 'janja' && name === 'forte-baixo' && stage >= 1) return { ...p, face: 'win', dy: 2 }
  return p
}

function attackFrames(name: string, char: CharacterId, held: Held): Pose[] {
  const stages = LEVE[name] ?? FORTE[name]!
  const sig = SIGNATURE[char][name]
  return stages.map((k, i) => {
    let p = mk(k, { t: i, ovT: stages.length > 1 ? i / (stages.length - 1) : 0 })
    // desarmado, a mão fecha em soco: sem arma o ângulo não importa
    if (held === 'luvas') p = { ...p, bh: p.bh }
    if (sig && FORTE[name]) {
      p.ov = sig[i]
      p = signatureTweak(char, name, i, p)
    }
    return p
  })
}

const GENS: Partial<Record<AnimName, Gen>> = { idle, tique, run, air, fall, wall, dodge, hurt, charge, win }

function poseFor(char: CharacterId, held: Held, anim: AnimName, i: number): Pose {
  const g = GENS[anim]
  if (g) return g(char, held, i)
  return attackFrames(anim, char, held)[i]!
}

function render(char: CharacterId, held: Held, p: Pose): Rows {
  const rig = RIGS[char]
  const g = composeBody(rig, p, held)
  const rows = outline(g.rows())
  const g2 = new G2(rows)
  paintOverlay(g2.g, char, p)
  return g2.merge()
}

/** pequena ponte: pinta o efeito numa grade nova e funde por cima do quadro já com contorno */
class G2 {
  g = new G()
  constructor(private base: Rows) {}
  merge(): Rows {
    const top = this.g.rows()
    return this.base.map((line, y) => [...line].map((c, x) => (top[y]![x] !== '.' ? top[y]![x]! : c)).join(''))
  }
}

export type AnimSet = Record<AnimName, Rows[]>
const cache = new Map<string, AnimSet>()

/** todas as animações de um personagem com a arma na mão (cache) */
export function buildSet(char: CharacterId, held: Held): AnimSet {
  const key = `${char}|${held}`
  const hit = cache.get(key)
  if (hit) return hit
  const out = {} as AnimSet
  for (const a of ANIM_NAMES) out[a] = Array.from({ length: ANIM_FRAMES[a] }, (_, i) => render(char, held, poseFor(char, held, a, i)))
  cache.set(key, out)
  return out
}

/** brilho de carga de cada quadro da animação `charge` (0..1) */
export function chargeGlow(i: number): number {
  return 0.5 + (i % 2) * 0.5
}
