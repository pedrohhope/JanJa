import type { BrawlSimEvent, BrawlSimState } from '../../../../shared/games/brawl/types'
import type { MoveTimingFn } from './animate'

/** caixa para o modo debug (hurtbox/hitbox já prontas, em px da arena) */
export interface DebugBox {
  x: number
  y: number
  w: number
  h: number
  kind: 'hurt' | 'hit' | 'plataforma' | string
}

export interface BrawlRenderOpts {
  /** o seu slot (ganha o triângulo "você") */
  youSlot: number
  /** nome curto por slot */
  names: Record<number, string>
  /** cor do contorno por slot (#rrggbb): time ou jogador */
  colors: Record<number, string>
  reducedMotion: boolean
  debugBoxes?: DebugBox[]
  /** tabela real dos golpes (startup/active/recovery); sem ela vale o padrão da cena */
  moveTiming?: MoveTimingFn
  /** slots que vencem (pose de vitória no fim) */
  winners?: readonly number[]
}

/** de onde a cena puxa o quadro a cada vez que o Pixi desenha */
export interface BrawlSceneSource {
  /** estado já interpolado pelo cliente; null = nada ainda */
  frame(): { state: BrawlSimState; opts: BrawlRenderOpts } | null
  /** eventos novos desde a última chamada */
  drainEvents(): BrawlSimEvent[]
}
