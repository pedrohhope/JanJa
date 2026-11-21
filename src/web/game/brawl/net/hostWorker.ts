/**
 * Web Worker de módulo que roda a simulação do host da Briga na Sala (não pode ser blob: a CSP é script-src 'self').
 * O corpo é genérico (`realtime/hostWorkerEntry.ts`); aqui só entra a sim da briga.
 */
import { installHostWorker } from '../../realtime/hostWorkerEntry'
import { brawlRealtime } from './realtimeBinding'

installHostWorker(brawlRealtime)
