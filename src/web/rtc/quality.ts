export interface QualityPreset {
  id: string
  label: string
  width: number
  height: number
  fps: number
  /** bitrate alvo para 1 espectador, em bps */
  bitrate: number
  hint: 'detail' | 'motion'
  /** frase curta que explica a escolha (só os automáticos usam) */
  sub?: string
}

/**
 * `height` é o teto de altura; a largura segue a proporção da tela compartilhada.
 * Num ultrawide 3440×1440, "até 1080p" vira 2580×1080 (antes: 1920×804 esticado, borrado).
 * `bitrate` vale para uma imagem 16:9 nessa altura e escala com os pixels reais (pixelScale).
 */
export const PRESETS: QualityPreset[] = [
  { id: 'texto', label: 'Texto e código (até 1080p, 15 fps)', width: 1920, height: 1080, fps: 15, bitrate: 4_000_000, hint: 'detail' },
  // grade de resolução × fps (ids antigos mantidos: equilibrado, jogo, jogo60 e nitido ficam salvos nas preferências)
  { id: 'equilibrado', label: '720p 30 fps', width: 1280, height: 720, fps: 30, bitrate: 3_000_000, hint: 'motion' },
  { id: '720p60', label: '720p 60 fps', width: 1280, height: 720, fps: 60, bitrate: 4_500_000, hint: 'motion' },
  { id: 'jogo', label: '1080p 30 fps', width: 1920, height: 1080, fps: 30, bitrate: 8_000_000, hint: 'motion' },
  { id: 'jogo60', label: '1080p 60 fps', width: 1920, height: 1080, fps: 60, bitrate: 12_000_000, hint: 'motion' },
  { id: 'nitido', label: '1440p 30 fps', width: 2560, height: 1440, fps: 30, bitrate: 12_000_000, hint: 'motion' },
  { id: '1440p60', label: '1440p 60 fps', width: 2560, height: 1440, fps: 60, bitrate: 18_000_000, hint: 'motion' }
]

/**
 * Modo automático: a qualidade se ajusta sozinha (veja autoQuality.ts). Estes números só servem para a captura
 * (pede até 60 fps) e para estimativas; o preset de verdade é montado do nível atual.
 * Fluidez é o padrão: mantém 60 fps e deixa a resolução ceder. Nitidez deixa o fps ceder.
 */
export const AUTO_PRESET: QualityPreset = {
  id: 'auto',
  label: 'Automático (fluidez)',
  sub: 'Mantém 60 fps; a resolução é que cede',
  width: 1920,
  height: 1080,
  fps: 60,
  bitrate: 5_000_000,
  hint: 'motion'
}

export const AUTO_SHARP_PRESET: QualityPreset = {
  id: 'auto-nitidez',
  label: 'Automático (nitidez)',
  sub: 'Para texto e código; o fps é que cede',
  width: 1920,
  height: 1080,
  fps: 60,
  bitrate: 5_000_000,
  hint: 'motion'
}

export const isAuto = (p: Pick<QualityPreset, 'id'>): boolean => p.id === AUTO_PRESET.id || p.id === AUTO_SHARP_PRESET.id

/**
 * O que o navegador faz quando falta banda ou CPU: 'detail' mantém a resolução; 60 fps (ou perto) mantém os quadros
 * (a resolução é que cede); movimento com menos fps deixa o navegador equilibrar. Vale para a malha e para o SFU.
 */
export function degradationFor(p: Pick<QualityPreset, 'hint' | 'fps'>): RTCDegradationPreference {
  if (p.hint === 'detail') return 'maintain-resolution'
  return p.fps >= 50 ? 'maintain-framerate' : 'balanced'
}

/** A tela vai na frente da câmera e do resto na fila de envio e na da rede (o navegador pode ignorar). */
export function prioritizeScreen(enc: RTCRtpEncodingParameters): void {
  enc.priority = 'high'
  enc.networkPriority = 'high'
}

/** Pedido inicial ao navegador: só o fps; a tela vem no tamanho nativo e depois é reduzida por fitConstraints. */
export function captureConstraints(preset: QualityPreset): MediaTrackConstraints {
  return { frameRate: { ideal: preset.fps, max: preset.fps } }
}

/**
 * Reduz para a altura do preset mantendo a proporção da tela original.
 * Pedir só a altura não basta (o Chrome volta para 16:9); por isso a largura é calculada.
 * Telas menores que o teto ficam no tamanho nativo.
 */
export function fitConstraints(preset: QualityPreset, nativeW?: number, nativeH?: number): MediaTrackConstraints {
  const frameRate = { ideal: preset.fps, max: preset.fps }
  if (!nativeW || !nativeH) return { height: { ideal: preset.height, max: preset.height }, frameRate }
  const h = Math.min(preset.height, nativeH)
  const w = Math.round((nativeW * h) / nativeH / 2) * 2 // par: encoders exigem
  return { width: { ideal: w, max: w }, height: { ideal: h, max: h }, frameRate }
}

const nativeCache = new WeakMap<MediaStreamTrack, { width?: number; height?: number }>()

/**
 * Tamanho nativo da tela capturada. A primeira leitura (logo após a captura, ainda sem redução)
 * fica guardada, para trocas de preset depois continuarem calculando a partir do original.
 */
export function nativeSize(track: MediaStreamTrack): { width?: number; height?: number } {
  const cached = nativeCache.get(track)
  if (cached) return cached
  const set = track.getSettings()
  const caps = track.getCapabilities?.()
  // display: settings já é o nativo na 1ª leitura; capabilities cobre navegadores que já reduziram
  const size =
    set.width && set.height
      ? { width: Math.max(set.width, caps?.width?.max ?? 0) || set.width, height: Math.max(set.height, caps?.height?.max ?? 0) || set.height }
      : { width: caps?.width?.max, height: caps?.height?.max }
  // proporção vem do settings (capabilities de câmera pode ter outra); altura máxima vale se mantiver a proporção
  if (set.width && set.height && size.width && size.height && Math.abs(size.width / size.height - set.width / set.height) > 0.01) {
    size.width = set.width
    size.height = set.height
  }
  nativeCache.set(track, size)
  return size
}

/** Aplica o preset numa trilha de tela já capturada. */
export async function applyQuality(track: MediaStreamTrack, preset: QualityPreset, native = nativeSize(track)): Promise<void> {
  track.contentHint = preset.hint
  try {
    await track.applyConstraints(fitConstraints(preset, native.width, native.height))
  } catch {
    /* navegador recusou: segue no tamanho que estiver */
  }
}

/** Quanto a imagem real tem de pixels em relação a um 16:9 na altura do preset (0,5 a 1,8). */
export function pixelScale(preset: QualityPreset, width?: number, height?: number): number {
  if (!width || !height) return 1
  const base = ((preset.height * 16) / 9) * preset.height
  return Math.min(1.8, Math.max(0.5, (width * height) / base))
}

/** preset de reserva quando o id salvo não existe mais (o padrão de verdade é o automático) */
export const DEFAULT_PRESET = PRESETS.find((p) => p.id === 'equilibrado')!

export function presetById(id: string): QualityPreset {
  if (id === AUTO_PRESET.id) return AUTO_PRESET
  if (id === AUTO_SHARP_PRESET.id) return AUTO_SHARP_PRESET
  return PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET
}

/**
 * Em mesh, a tela sai uma vez por espectador: o upload total cresce com a sala.
 * Reduz o bitrate por conexão conforme o número de espectadores.
 */
export function bitrateFor(preset: QualityPreset, viewers: number, scale = 1): number {
  const factor = viewers <= 1 ? 1 : viewers === 2 ? 0.8 : viewers === 3 ? 0.65 : 0.5
  return Math.round(preset.bitrate * factor * scale)
}

export function uploadEstimateMbps(preset: QualityPreset, viewers: number): number {
  return (bitrateFor(preset, viewers) * Math.max(viewers, 1)) / 1_000_000
}
