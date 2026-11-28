/**
 * Web Worker de módulo que roda a simulação do host da Corrida na Sala (não pode ser blob: a CSP é script-src 'self').
 * O corpo é genérico (`realtime/hostWorkerEntry.ts`); aqui só entra a sim da corrida.
 */
import { installHostWorker } from '../../realtime/hostWorkerEntry'
import { raceRealtime } from './realtimeBinding'

installHostWorker(raceRealtime)
