/**
 * Áudio do microfone: as constraints da captura e o corta-ruído (noise gate).
 *
 * O corta-ruído roda num pequeno grafo WebAudio (entrada → medição + ganho → saída):
 * abaixo do limiar de sensibilidade o ganho cai a 0, então o JanJa manda silêncio nas
 * pausas (ventilador, teclado, respiração) em vez de ruído de fundo. A trilha que vai
 * para os outros é a da saída processada.
 *
 * A decisão do ganho (`stepGate`) é pura e determinística, para os testes; o grafo
 * WebAudio (`createGatedMic`) só existe no navegador.
 */

/** Constraints do getUserMedia. Eco e ganho automático ficam sempre ligados; só a supressão de ruído é opcional. */
export function micAudioConstraints(noiseSuppression: boolean): MediaTrackConstraints {
  return { echoCancellation: true, noiseSuppression, autoGainControl: true }
}

/** Parâmetros do corta-ruído. */
export interface GateParams {
  /** nível (0..1) a partir do qual o portão abre; `<= 0` desliga o corta-ruído */
  threshold: number
  /** tempo para abrir de todo (ms): rápido, para não cortar o começo da fala */
  attackMs: number
  /** tempo para fechar de todo (ms): devagar, para não picotar o fim das palavras */
  releaseMs: number
  /** histerese: o portão só fecha abaixo de `threshold * hold` */
  hold: number
}

export const GATE_DEFAULTS: Omit<GateParams, 'threshold'> = { attackMs: 15, releaseMs: 220, hold: 0.6 }

/** Multiplicador do RMS → nível 0..1 (igual ao medidor de audio.ts, para a barra bater com a fala). */
export const LEVEL_SCALE = 5

/** ~33 Hz: suave para a voz e barato o bastante para rodar sempre. */
export const GATE_TICK_MS = 30

/** Estado do portão entre dois passos. */
export interface GateStep {
  /** ganho aplicado (0..1) */
  gain: number
  /** o portão está aberto? (histerese) */
  open: boolean
}

/**
 * Avança o ganho do corta-ruído em `dt` ms, dado o nível atual (0..1). Puro e determinístico.
 * O ganho anda em linha reta rumo ao alvo (0 fechado, 1 aberto): `attackMs`/`releaseMs` são o
 * tempo para percorrer todo o caminho. `threshold <= 0` deixa o portão sempre aberto.
 */
export function stepGate(prev: GateStep, level: number, dt: number, p: GateParams): GateStep {
  if (p.threshold <= 0) return { gain: 1, open: true }
  const open = level >= p.threshold ? true : level < p.threshold * p.hold ? false : prev.open
  const target = open ? 1 : 0
  const ms = target > prev.gain ? p.attackMs : p.releaseMs
  const step = ms <= 0 ? 1 : dt / ms
  const gain = target > prev.gain ? Math.min(target, prev.gain + step) : Math.max(target, prev.gain - step)
  return { gain, open }
}

/** O corta-ruído vivo: a trilha processada, o nível ao vivo para o medidor e o ajuste do limiar. */
export interface GatedMic {
  /** stream com a trilha processada (a que vai para os outros) */
  readonly stream: MediaStream
  /** muda o limiar de sensibilidade em tempo real (0..1; 0 = desliga o corta-ruído) */
  setThreshold(threshold: number): void
  /** nível cru atual do mic (0..1), para desenhar o medidor */
  level(): number
  /** desliga o grafo e solta os nós */
  stop(): void
}

/**
 * Monta o grafo WebAudio do corta-ruído sobre o stream cru do mic e devolve a trilha processada.
 * Mede o nível cru (antes do portão), então a pessoa vê na barra o ruído que está cortando.
 */
export function createGatedMic(ctx: AudioContext, raw: MediaStream, threshold: number): GatedMic {
  const source = ctx.createMediaStreamSource(raw)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  const gainNode = ctx.createGain()
  const dest = ctx.createMediaStreamDestination()
  source.connect(analyser)
  source.connect(gainNode)
  gainNode.connect(dest)

  const buffer = new Float32Array(analyser.fftSize)
  let thr = threshold
  let step: GateStep = { gain: threshold > 0 ? 0 : 1, open: threshold <= 0 }
  let level = 0
  let last = performance.now()
  gainNode.gain.value = step.gain

  const timer = window.setInterval(() => {
    const now = performance.now()
    const dt = now - last
    last = now
    // sem gesto do usuário o contexto fica suspenso: nesse caso não corta nada
    if (ctx.state === 'running') {
      analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (const v of buffer) sum += v * v
      level = Math.min(1, Math.sqrt(sum / buffer.length) * LEVEL_SCALE)
    }
    step = stepGate(step, level, dt, { threshold: thr, ...GATE_DEFAULTS })
    gainNode.gain.value = step.gain
  }, GATE_TICK_MS)

  return {
    stream: dest.stream,
    setThreshold: (t) => {
      thr = t
    },
    level: () => level,
    stop: () => {
      window.clearInterval(timer)
      source.disconnect()
      analyser.disconnect()
      gainNode.disconnect()
    }
  }
}
