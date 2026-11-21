/**
 * Quem roda o HostLoop da Briga: o Web Worker `hostWorker.ts` ou, se não der para criar, a thread
 * principal. O `new Worker(new URL(...))` fica AQUI, literal, para o Vite gerar o chunk do worker.
 */
import { createHostRunner as createGenericRunner, createMainRunner as createGenericMain, type HostRunner as GenericRunner } from '../../realtime/hostRunner'
import type { HostInit as GenericInit, HostOut as GenericOut } from '../../realtime/types'
import { brawlRealtime, type BrawlTypes } from './realtimeBinding'

export type HostInit = GenericInit<BrawlTypes>
export type HostOut = GenericOut<BrawlTypes>
export type HostRunner = GenericRunner<BrawlTypes>

/** Mesmo laço na thread principal (fallback e laboratório). */
export function createMainRunner(init: HostInit, out: (m: HostOut) => void, now: () => number = () => performance.now()): HostRunner {
  return createGenericMain(brawlRealtime, init, out, now)
}

export function createHostRunner(init: HostInit, out: (m: HostOut) => void): HostRunner {
  // a CSP não aceita worker de blob:, e o Vite só gera o chunk com este formato literal
  return createGenericRunner(brawlRealtime, () => new Worker(new URL('./hostWorker.ts', import.meta.url), { type: 'module' }), init, out)
}
