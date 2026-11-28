/**
 * Contrato da Corrida na Sala no navegador (lado da sala): o que a rede entrega e o que a sala usa.
 * A cena (`scene/`) e o HUD só enxergam `RaceSession`; o `RaceStage` faz a ponte com a sala.
 */
import type { RaceAction, RaceInput, RaceSimEvent, RaceSimState, RaceView } from '../../../shared/games/race/types'
import type { NetStatus } from '../realtime/types'

export type { NetStatus }

/** Um quadro pronto para desenhar. A rede recalcula a cada pedido. */
export interface RaceFrame {
  /** estado para desenhar: os outros interpolados, você previsto */
  state: RaceSimState
  /** meu slot, null = espectador */
  me: number | null
  net: NetStatus
  /** ida e volta até o host (ms); 0 quando você é o host */
  pingMs: number
}

export type RaceFrameEvent = RaceSimEvent

export interface RaceSession {
  /** quadro mais recente (lido pela cena a cada desenho, sem re-render do React) */
  frame(): RaceFrame | null
  /** a cena manda a cada tick de 60 Hz */
  setInput(input: RaceInput): void
  onEvents(cb: (events: RaceFrameEvent[]) => void): () => void
  dispose(): void
}

export interface RaceSessionDeps {
  view: RaceView
  manager: import('../../rtc/PeerManager').PeerManager | undefined
  relay(to: string, data: string): void
  onRelay(cb: (from: string, data: string) => void): () => void
  act(action: RaceAction): void
}
