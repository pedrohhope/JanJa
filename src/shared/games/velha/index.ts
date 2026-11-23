import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type VelhaState } from './engine'
import type { VelhaAction, VelhaEvent, VelhaOptions, VelhaView } from './types'

export const velhaGame: GameDefinition<VelhaState, VelhaOptions, VelhaAction, VelhaView, VelhaEvent> = {
  id: 'velha',
  name: 'Velha ao quadrado',
  minPlayers: 2,
  maxPlayers: 2,
  parseOptions,
  setup: (players, options, ctx) => setup(players, options, ctx),
  parseAction,
  apply,
  tick,
  nextDeadline,
  setPresence,
  view,
  isOver
}

export type { VelhaState } from './engine'
