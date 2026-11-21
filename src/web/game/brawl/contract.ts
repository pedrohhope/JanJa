/**
 * Contrato da Briga na Sala no navegador (lado da sala): o que a rede entrega e o que a sala usa.
 * A cena (`scene/`) só enxerga `BrawlSceneSource`; o `BrawlStage` faz a ponte a partir de um `BrawlSession`.
 */
import type { BrawlAction, BrawlInput, BrawlSimEvent, BrawlSimState, BrawlView } from '../../../shared/games/brawl/types'
import type { NetStatus } from '../realtime/types'

export type { NetStatus }

/** Um quadro pronto para desenhar. A rede recalcula a cada requestAnimationFrame. */
export interface BrawlFrame {
  /** estado para a cena desenhar: os outros interpolados, você previsto */
  state: BrawlSimState
  /** meu slot, null = espectador */
  me: number | null
  /** modo tempo: ms até acabar (0 em vidas, na contagem e depois do fim) */
  timeLeftMs: number
  net: NetStatus
  /** ida e volta até o host (ms); 0 quando você é o host */
  pingMs: number
}

export type BrawlFrameEvent = BrawlSimEvent

export interface BrawlSession {
  /** quadro mais recente (lido pela cena no ticker do Pixi, sem re-render do React) */
  frame(): BrawlFrame | null
  /** a cena manda a cada tick de 60 Hz; a sessão amostra no ritmo do tick */
  setInput(input: BrawlInput): void
  onEvents(cb: (events: BrawlFrameEvent[]) => void): () => void
  dispose(): void
}

export interface BrawlSessionDeps {
  view: BrawlView
  manager: import('../../rtc/PeerManager').PeerManager | undefined
  relay(to: string, data: string): void
  onRelay(cb: (from: string, data: string) => void): () => void
  act(action: BrawlAction): void
}
