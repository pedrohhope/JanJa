/**
 * Quem roda o HostLoop do Tiro: o Web Worker `hostWorker.ts` ou, se não der para criar, a thread
 * principal. O `new Worker(new URL(...))` fica AQUI, literal, para o Vite gerar o chunk do worker.
 */
import { createHostRunner as createGenericRunner, createMainRunner as createGenericMain, type HostRunner as GenericRunner } from '../../realtime/hostRunner'
import type { HostInit as GenericInit } from '../../realtime/types'
import type { HostOut } from './hostCore'
import { shooterSim, type ShooterTypes } from './realtimeBinding'

export type HostInit = GenericInit<ShooterTypes>
export type HostRunner = GenericRunner<ShooterTypes>

/** Mesmo laço na thread principal (fallback e laboratório). */
export function createMainRunner(init: HostInit, out: (m: HostOut) => void, now: () => number = () => performance.now()): HostRunner {
  return createGenericMain(shooterSim, init, out, now)
}

export function createHostRunner(init: HostInit, out: (m: HostOut) => void): HostRunner {
  // a CSP não aceita worker de blob:, e o Vite só gera o chunk com este formato literal
  return createGenericRunner(shooterSim, () => new Worker(new URL('./hostWorker.ts', import.meta.url), { type: 'module' }), init, out)
}
