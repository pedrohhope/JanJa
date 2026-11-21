/** Gerador de estados de exemplo (lutadores em todas as ações, golpes, armas, projéteis, poça) para teste e preview. */
import type { ArenaId, BrawlSimState, CharacterId, Fighter, FighterAction, Held } from '../../../../shared/games/brawl/types'

export function sampleFighter(slot: number, char: CharacterId, over: Partial<Fighter> = {}): Fighter {
  return {
    slot,
    id: `p${slot}`,
    bot: false,
    away: false,
    char,
    team: slot,
    x: 240,
    y: 188,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    onThin: -1,
    fastFall: false,
    action: 'parado',
    actionTick: 0,
    jumpsLeft: 3,
    recoveryUsed: false,
    airDodgeUsed: false,
    dodgeReadyTick: 0,
    move: null,
    moveTick: 0,
    charge: 0,
    hitSlots: [],
    hitstunUntil: 0,
    freezeUntil: 0,
    invulnUntil: 0,
    damage: 0,
    stocks: 3,
    held: 'mao',
    wallSide: 0,
    wallTicks: 0,
    lastHitBy: -1,
    lastHitTick: 0,
    respawnTick: 0,
    outTick: 0,
    kos: 0,
    falls: 0,
    dealt: 0,
    prevButtons: 0,
    lastSeq: 0,
    ...over
  }
}

export function sampleState(arenaId: ArenaId, tick = 600, fighters: Fighter[] = []): BrawlSimState {
  return {
    arenaId,
    mode: 'vidas',
    teamSize: 0,
    friendlyFire: false,
    botLevel: 'medio',
    tick,
    phase: 'jogando',
    goTick: 180,
    endTick: 0,
    rng: 1,
    nextId: 10,
    nextDropTick: 900,
    fighters,
    items: [],
    projectiles: [],
    puddles: [],
    ...{}
  }
}

/** 4 lutadores posicionados nas plataformas da arena, com armas, um projétil, uma poça e uma arma no chão */
export function showcaseState(arenaId: ArenaId, tick = 600): BrawlSimState {
  const a = arenaId === 'estante'
  const act = (action: FighterAction, extra: Partial<Fighter>): Partial<Fighter> => ({ action, actionTick: tick - 20, ...extra })
  const f: Fighter[] = [
    sampleFighter(0, 'jan', { x: a ? 150 : 110, y: a ? 188 : 196, held: 'vassoura', ...act('golpe', { move: 'vassoura:lado', moveTick: 7 }) }),
    sampleFighter(1, 'xicara', { x: a ? 330 : 330, y: a ? 188 : 196, facing: -1, held: 'luvas', ...act('parado', {}) }),
    sampleFighter(2, 'teve', { x: a ? 166 : 118, y: a ? 140 : 150, held: 'frigideira', ...act('parado', {}) }),
    sampleFighter(3, 'janja', { x: a ? 312 : 240, y: a ? 140 : 128, facing: -1, held: 'mao', ...act('golpe', { move: 'janja:mao:neutro', moveTick: 16 }) })
  ]
  const s = sampleState(arenaId, tick, f)
  s.items = [{ id: 1, weapon: 'frigideira', x: 240, y: a ? 188 : 196, vx: 0, vy: 0, state: 'chao', owner: -1, dieTick: tick + 500 }]
  s.projectiles = [{ id: 2, owner: 0, kind: 'carta', x: 200, y: a ? 168 : 176, vx: 3, vy: 0, w: 6, h: 8, facing: 1, hit: { damage: 4, baseKb: 3, kbGrowth: 2, dx: 1, dy: -0.3 }, pierce: false, hitSlots: [], dieTick: tick + 60 }]
  s.puddles = [{ id: 3, owner: 1, x: 270, y: a ? 188 : 196, w: 40, dieTick: tick + 200 }]
  return s
}

/** todas as ações em fila (para teste) */
export function everyAction(arenaId: ArenaId, tick = 600): BrawlSimState {
  const acts: FighterAction[] = ['parado', 'correndo', 'no-ar', 'parede', 'esquiva', 'golpe', 'atordoado', 'fora', 'eliminado']
  const chars: CharacterId[] = ['jan', 'xicara', 'teve', 'janja']
  const helds: Held[] = ['mao', 'vassoura', 'frigideira', 'luvas']
  const f = acts.map((a, i) =>
    sampleFighter(i, chars[i % 4]!, {
      x: 120 + i * 30,
      y: 188,
      held: helds[i % 4]!,
      action: a,
      actionTick: tick - 10,
      move: a === 'golpe' ? 'vassoura:ar-cima' : null,
      moveTick: 4,
      vx: 6,
      vy: -3,
      damage: 120
    })
  )
  return sampleState(arenaId, tick, f)
}
