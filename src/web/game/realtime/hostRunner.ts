/**
 * Quem roda o HostLoop: um Web Worker de módulo ou, se não der para criar, a thread principal.
 *
 * O Worker TEM de ser criado no arquivo do jogo, com `new Worker(new URL('./hostWorker.ts',
 * import.meta.url), { type: 'module' })` escrito literalmente (o Vite só gera o chunk assim, e a CSP
 * `script-src 'self'` não aceita worker de `blob:`). Por isso aqui entra `spawn`, uma função do jogo.
 */
import { HostLoop } from './hostLoop'
import type { HostIn, HostInit, HostOut, RealtimeSim, RealtimeTypes } from './types'

export interface HostRunner<G extends RealtimeTypes> {
  kind: 'worker' | 'main'
  handle(m: Exclude<HostIn<G>, { k: 'init' }>): void
  dispose(): void
}

/** Cria o Worker do jogo (pode lançar: cai para a thread principal). */
export type SpawnWorker = () => Worker

/** Mesmo laço na thread principal (fallback e laboratório). */
export function createMainRunner<G extends RealtimeTypes>(
  sim: RealtimeSim<G>,
  init: HostInit<G>,
  out: (m: HostOut<G>) => void,
  now: () => number = () => performance.now()
): HostRunner<G> {
  const loop = new HostLoop(sim, init, out, now())
  const timer = setInterval(() => loop.advance(now()), 8)
  return {
    kind: 'main',
    handle: (m) => loop.handle(m),
    dispose() {
      clearInterval(timer)
      loop.handle({ k: 'stop' })
    }
  }
}

export function createHostRunner<G extends RealtimeTypes>(
  sim: RealtimeSim<G>,
  spawn: SpawnWorker,
  init: HostInit<G>,
  out: (m: HostOut<G>) => void
): HostRunner<G> {
  if (typeof Worker === 'undefined') return createMainRunner(sim, init, out)
  let worker: Worker
  try {
    worker = spawn()
  } catch {
    return createMainRunner(sim, init, out)
  }
  let got = false
  let fallback: HostRunner<G> | undefined
  let disposed = false
  const queue: Exclude<HostIn<G>, { k: 'init' }>[] = []
  worker.onmessage = (e: MessageEvent<HostOut<G>>) => {
    got = true
    out(e.data)
  }
  // Worker que não carrega (CSP, módulo quebrado): cai para a thread principal com o mesmo início
  worker.onerror = () => {
    if (got || fallback || disposed) return
    worker.terminate()
    fallback = createMainRunner(sim, init, out)
    for (const m of queue) fallback.handle(m)
    queue.length = 0
  }
  worker.postMessage(init)
  return {
    kind: 'worker',
    handle(m) {
      if (fallback) fallback.handle(m)
      else {
        // só guarda o necessário para o caso de cair no fallback logo no início
        if (!got) {
          queue.push(m)
          if (queue.length > 64) queue.shift()
        }
        worker.postMessage(m)
      }
    },
    dispose() {
      disposed = true
      fallback?.dispose()
      try {
        worker.postMessage({ k: 'stop' } satisfies HostIn<G>)
      } catch {
        /* já morreu */
      }
      worker.terminate()
    }
  }
}
