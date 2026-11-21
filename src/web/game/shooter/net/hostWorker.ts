/**
 * Web Worker de módulo que roda a simulação do host do Tiro (não pode ser blob: a CSP é script-src 'self').
 * O corpo é genérico (`realtime/hostWorkerEntry.ts`); aqui só entra a sim do tiro.
 */
import { installHostWorker } from '../../realtime/hostWorkerEntry'
import { shooterSim } from './realtimeBinding'

installHostWorker(shooterSim)
