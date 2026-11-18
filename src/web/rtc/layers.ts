/**
 * Simulcast da tela no modo SFU: três camadas, `a` (melhor) a `c` (mais leve).
 * O vídeo capturado vem no nível do automático (ou do preset); as camadas são reduções dele.
 */
import type { BudgetState, Rid } from '../../shared/sfu'
import { allowedRid } from '../../shared/sfu'

export interface LayerSpec {
  rid: Rid
  /** altura alvo da camada (a redução é calculada da altura capturada) */
  height: number
  maxFramerate: number
  /** bitrate para um 16:9 nessa altura; escala com os pixels reais como no quality.ts */
  maxBitrate: number
}

/** camada `a` segue o nível de quem compartilha; `b` e `c` são fixas */
export const LAYER_B: LayerSpec = { rid: 'b', height: 720, maxFramerate: 30, maxBitrate: 2_500_000 }
export const LAYER_C: LayerSpec = { rid: 'c', height: 360, maxFramerate: 30, maxBitrate: 600_000 }

/**
 * Encodings para `addTransceiver(track, { sendEncodings })`, em ordem a, b, c.
 * `top` é o nível atual de quem compartilha (altura, fps e bitrate da camada `a`).
 * Camadas que ficariam maiores ou iguais à de cima saem da lista (tela pequena: só `a`, ou `a` e `c`).
 */
export function sendEncodings(
  capturedHeight: number,
  top: { height: number; fps: number; bitrate: number }
): RTCRtpEncodingParameters[] {
  const h = Math.max(1, capturedHeight)
  const aHeight = Math.min(h, top.height)
  const out: RTCRtpEncodingParameters[] = [
    { rid: 'a', scaleResolutionDownBy: round2(h / aHeight), maxFramerate: top.fps, maxBitrate: top.bitrate, active: true, priority: 'high', networkPriority: 'high' }
  ]
  let above = aHeight
  for (const l of [LAYER_B, LAYER_C]) {
    if (l.height >= above * 0.9) continue
    out.push({ rid: l.rid, scaleResolutionDownBy: round2(h / l.height), maxFramerate: l.maxFramerate, maxBitrate: l.maxBitrate, active: true, priority: 'high', networkPriority: 'high' })
    above = l.height
  }
  return out
}

/**
 * Camada que quem assiste pede, pela área (em pixels CSS × devicePixelRatio) do vídeo na tela.
 * Miniatura recebe `c`, palco recebe `b`, maximizado/tela cheia recebe `a`.
 * `available` = rids que quem compartilha publica (sendEncodings pode ter tirado alguma).
 */
export function ridForSize(widthPx: number, heightPx: number, budget: BudgetState, available: readonly Rid[] = ['a', 'b', 'c']): Rid {
  const h = Math.min(heightPx, (widthPx * 9) / 16)
  const wanted: Rid = h >= 800 ? 'a' : h >= 300 ? 'b' : 'c'
  const allowed = allowedRid(wanted, budget)
  if (available.includes(allowed)) return allowed
  // camada não publicada: a mais próxima por baixo, senão a mais próxima por cima
  const order: Rid[] = ['a', 'b', 'c']
  const idx = order.indexOf(allowed)
  const below = order.slice(idx + 1).find((r) => available.includes(r))
  const above = order.slice(0, idx).reverse().find((r) => available.includes(r) && allowedRid(r, budget) === r)
  return below ?? above ?? available[0] ?? 'a'
}

const round2 = (v: number): number => Math.round(v * 100) / 100
