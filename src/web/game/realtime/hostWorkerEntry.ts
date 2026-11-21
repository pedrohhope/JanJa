/**
 * Corpo do Web Worker do host. Cada jogo tem o PRÓPRIO arquivo de worker (porque a simulação dele
 * entra no chunk) que só faz `installHostWorker(simDoJogo)`. Fala por postMessage com hostRunner.ts:
 * recebe HostIn, devolve HostOut (o snapshot vai como transferível).
 */
import { HostLoop } from './hostLoop'
import type { HostIn, HostOut, RealtimeSim, RealtimeTypes } from './types'

export function installHostWorker<G extends RealtimeTypes>(sim: RealtimeSim<G>): void {
  const ctx = self as unknown as {
    postMessage(m: HostOut<G>, transfer?: Transferable[]): void
    onmessage: ((e: MessageEvent<HostIn<G>>) => void) | null
    close(): void
  }

  let loop: HostLoop<G> | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  ctx.onmessage = (e) => {
    const m = e.data
    if (m.k === 'init') {
      if (timer !== undefined) clearInterval(timer)
      const l = new HostLoop(sim, m, (o) => ctx.postMessage(o, o.k === 'snap' ? [o.bytes] : []), performance.now())
      loop = l
      timer = setInterval(() => l.advance(performance.now()), 8)
    } else if (m.k === 'stop') {
      loop?.handle(m)
      if (timer !== undefined) clearInterval(timer)
      ctx.close()
    } else loop?.handle(m)
  }
}
