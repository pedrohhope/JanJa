/**
 * Diagnóstico da queda de fps: de onde os quadros se perdem (captura, PC de quem envia, rede ou PC de quem assiste).
 * Tudo puro: o tempo entra por parâmetro, como no autoQuality.ts.
 */
import type { DiagKind } from './diag'
import type { Limitation } from './stats'

export type DropCause = 'captura' | 'cpu' | 'banda' | 'quem-assiste'

/** abaixo desta fração do alvo o fps conta como queda */
export const FPS_LOW_RATIO = 0.75
/** a queda precisa durar mais que isto para ser avisada */
export const FPS_LOW_MS = 3_000
/** no máximo um aviso por pessoa neste intervalo */
export const FPS_EVENT_GAP_MS = 20_000
/** do lado de quem assiste: descartar pelo menos esta fração do alvo por segundo conta como "o PC dele está descartando" */
export const DROPPED_RATIO = 0.1
/** abaixo disto o envio é praticamente uma tela parada: poucos quadros é normal e não conta como queda */
export const IDLE_KBPS = 100

export interface SendFpsInput {
  side: 'send'
  /** fps que o nível pede (maxFramerate) */
  target: number
  /** fps enviado (outbound-rtp.framesPerSecond) */
  sentFps?: number
  /** fps entregue pela captura (media-source) */
  capturedFps?: number
  /** taxa de envio atual, em kbps */
  kbps?: number
  limitation: Limitation
  encoder?: string
  /** powerEfficientEncoder */
  hardware?: boolean
}

export interface RecvFpsInput {
  side: 'recv'
  target: number
  /** fps recebido/decodificado (inbound-rtp.framesPerSecond) */
  recvFps?: number
  /** taxa de recebimento atual, em kbps */
  kbps?: number
  /** quadros descartados por segundo no intervalo */
  droppedFps?: number
}

export type FpsInput = SendFpsInput | RecvFpsInput

export interface FpsDropEvent {
  cause: DropCause
  /** tipo do evento no diário */
  kind: DiagKind
  fps: number
  target: number
  text: string
}

const SOFTWARE_ENCODER = /libvpx|libaom|openh264|software|ffmpeg|^vp8$/i

/** Encoder sem aceleração de hardware? undefined quando o navegador não diz. */
export function isSoftwareEncoder(encoder: string | undefined, hardware: boolean | undefined): boolean | undefined {
  if (hardware !== undefined) return !hardware
  if (!encoder) return undefined
  return SOFTWARE_ENCODER.test(encoder) ? true : undefined
}

/** "hardware", "software" ou undefined, para o painel. */
export function encoderKind(encoder: string | undefined, hardware: boolean | undefined): 'hardware' | 'software' | undefined {
  const sw = isSoftwareEncoder(encoder, hardware)
  return sw === undefined ? undefined : sw ? 'software' : 'hardware'
}

/** Quadros por segundo do nível, tirado de um rótulo como "1080p 60"; undefined se não der. */
export function targetFromLabel(label: string | undefined): number | undefined {
  const m = label?.match(/(\d+)\s*$/)
  const n = m ? Number(m[1]) : NaN
  return n >= 5 && n <= 240 ? n : undefined
}

/** Causa da queda numa leitura (sem olhar o tempo). undefined = não dá para dizer. */
export function classifyFpsDrop(i: FpsInput): DropCause | undefined {
  if (i.side === 'recv') return i.droppedFps !== undefined && i.droppedFps >= DROPPED_RATIO * i.target ? 'quem-assiste' : undefined
  if (i.capturedFps !== undefined && i.capturedFps < FPS_LOW_RATIO * i.target) return 'captura'
  if (i.limitation === 'cpu') return 'cpu'
  if (i.limitation === 'bandwidth') return 'banda'
  if (isSoftwareEncoder(i.encoder, i.hardware)) return 'cpu'
  return undefined
}

const KIND: Record<DropCause, DiagKind> = { captura: 'down', cpu: 'cpu', banda: 'banda', 'quem-assiste': 'travada' }

/** Frase do diário. */
export function dropText(cause: DropCause, fps: number, target: number, software = false): string {
  const head = `Fps caiu para ${Math.round(fps)} (alvo ${target})`
  switch (cause) {
    case 'captura':
      return `${head}: a captura do Windows está entregando poucos quadros. Jogo em tela cheia exclusiva não captura bem: use janela sem borda.`
    case 'cpu':
      return software
        ? `${head}: encoder por software (sem aceleração de hardware): ative a aceleração de hardware do navegador.`
        : `${head}: o PC está no limite para codificar o vídeo. Feche programas pesados ou baixe a qualidade do jogo.`
    case 'banda':
      return `${head}: a rede apertou; a resolução vai cair para manter o fps.`
    case 'quem-assiste':
      return `${head}: o PC de quem assiste está descartando quadros.`
  }
}

/**
 * Acompanha UMA pessoa (um espectador ou quem envia): a queda só vale depois de FPS_LOW_MS seguidos
 * abaixo de FPS_LOW_RATIO do alvo, e há no máximo um aviso a cada FPS_EVENT_GAP_MS.
 */
export class FpsDropTracker {
  private since?: number
  private lastAt?: number
  /** já avisou neste episódio (volta a falso quando o fps se recupera) */
  private reported = false

  /** Uma leitura. Devolve o aviso, se for hora de avisar. */
  update(input: FpsInput | undefined, now: number): FpsDropEvent | undefined {
    const fps = input?.side === 'send' ? input.sentFps : input?.recvFps
    const idle = input?.kbps !== undefined && input.kbps < IDLE_KBPS
    if (!input || idle || fps === undefined || input.target <= 0 || fps >= FPS_LOW_RATIO * input.target) {
      this.since = undefined
      this.reported = false
      return undefined
    }
    this.since ??= now
    if (this.reported || now - this.since <= FPS_LOW_MS) return undefined
    if (this.lastAt !== undefined && now - this.lastAt < FPS_EVENT_GAP_MS) return undefined
    const cause = classifyFpsDrop(input)
    if (!cause) return undefined
    this.reported = true
    this.lastAt = now
    const software = input.side === 'send' && isSoftwareEncoder(input.encoder, input.hardware) === true
    return { cause, kind: KIND[cause], fps, target: input.target, text: dropText(cause, fps, input.target, software) }
  }

  reset(): void {
    this.since = undefined
    this.lastAt = undefined
    this.reported = false
  }
}
