import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type PifeState } from './engine'
import { MAX_PLAYERS, MIN_PLAYERS, type PifeAction, type PifeEvent, type PifeOptions, type PifeView } from './types'

export const pifeGame: GameDefinition<PifeState, PifeOptions, PifeAction, PifeView, PifeEvent> = {
  id: 'pife',
  name: 'Pife',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  parseOptions,
  setup,
  parseAction,
  apply,
  tick,
  nextDeadline,
  setPresence,
  view,
  isOver
}

export type { PifeState } from './engine'
