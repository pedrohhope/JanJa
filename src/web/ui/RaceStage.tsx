import { Suspense, useEffect, useMemo, useRef, type ReactElement } from 'react'
import type { RaceAction, RaceView } from '../../shared/games/race/types'
import type { MusicTrack } from '../game/contract'
import { loadRaceScene } from '../game/loaders'
import type { RaceSessionDeps } from '../game/race/contract'
import { raceColors, raceCue, raceNames, raceTrack } from '../game/race/hudLogic'
import { useRaceSession } from '../game/race/net/useRaceSession'
import type { RaceRenderOpts, RaceSceneSource } from '../game/race/scene'
import type { SfxBus } from '../game/shooter/sfxBus'
import { lazyChunk } from '../version'
import { toneOf } from './Avatar'
import { TvOff } from './Brand'
import { RaceHud } from './RaceHud'

const RaceSceneLazy = lazyChunk(loadRaceScene)

export interface RaceStageProps {
  view: RaceView
  manager: RaceSessionDeps['manager']
  relay: RaceSessionDeps['relay']
  onRelay: RaceSessionDeps['onRelay']
  act: (action: RaceAction) => void
  /** a cena e o HUD aparecem (false: "voltar às telas", a simulação segue viva) */
  visible: boolean
  /** uma tela em destaque ocupa o palco: o jogo vira miniatura, sem entrada */
  pip: boolean
  canManage: boolean
  reducedMotion: boolean
  sfxBus: SfxBus
  onTrack: (track: MusicTrack | null) => void
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  /** G: alterna a tela em destaque */
  onSpotlight: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

/**
 * A Corrida na Sala dentro da sala: cria a sessão (que roda a simulação quando você é o host, por isso
 * ela continua viva mesmo escondida), carrega a cena só quando precisa, toca os sons e avisa a música.
 */
export function RaceStage(p: RaceStageProps): ReactElement | null {
  const { view } = p
  const deps = useMemo<RaceSessionDeps>(() => ({ view, manager: p.manager, relay: p.relay, onRelay: p.onRelay, act: p.act }), [view, p.manager, p.relay, p.onRelay, p.act])
  const session = useRaceSession(deps)
  const colors = useMemo(() => raceColors(view.players, toneOf), [view.players])
  const names = useMemo(() => raceNames(view.players), [view.players])

  // a cena lê as opções de desenho a cada quadro
  const opts = useMemo<RaceRenderOpts>(() => ({ names, colors, reducedMotion: p.reducedMotion }), [names, colors, p.reducedMotion])
  const source = useMemo<RaceSceneSource | null>(() => (session ? { frame: () => session.frame(), onEvents: (cb) => session.onEvents(cb) } : null), [session])

  // sons dos eventos e bipe da contagem
  const bus = p.sfxBus
  useEffect(() => {
    if (!session) return
    let lastCount = -1
    const off = session.onEvents((evs) => {
      const f = session.frame()
      for (const e of evs) {
        const cue = raceCue(e, f?.me ?? null, f?.state.laps ?? 0)
        if (cue) bus.emit(cue.name, { volume: cue.volume })
      }
    })
    const id = window.setInterval(() => {
      const f = session.frame()
      if (!f || f.state.phase !== 'contagem') {
        lastCount = -1
        return
      }
      const n = Math.ceil((f.state.goTick - f.state.tick) / 60)
      if (n !== lastCount && n > 0 && n <= 3) {
        lastCount = n
        bus.emit('contagem', { volume: 0.8 })
      }
    }, 60)
    return () => {
      off()
      window.clearInterval(id)
    }
  }, [session, bus])

  // música: tensão na largada, ação na corrida, final na última volta, vitória no fim
  const onTrack = useRef(p.onTrack)
  onTrack.current = p.onTrack
  useEffect(() => {
    let last: MusicTrack | null = null
    const read = () => {
      const f = session?.frame() ?? null
      const leader = f ? Math.max(0, ...f.state.cars.map((c) => c.lap)) : 0
      const next = raceTrack(view.phase === 'fim' ? 'fim' : (f?.state.phase ?? 'contagem'), leader, view.options.laps)
      if (next !== last) {
        last = next
        onTrack.current(next)
      }
    }
    read()
    const id = window.setInterval(read, 400)
    return () => {
      window.clearInterval(id)
      onTrack.current(null)
    }
  }, [session, view.phase, view.options.laps])

  // G: alterna a tela em destaque; Esc devolve o palco ao jogo
  const spotlight = useRef(p.onSpotlight)
  spotlight.current = p.onSpotlight
  const pipRef = useRef(p.pip)
  pipRef.current = p.pip
  useEffect(() => {
    if (!p.visible) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'g') {
        e.preventDefault()
        spotlight.current()
      } else if (e.key === 'Escape' && pipRef.current && !document.fullscreenElement) {
        spotlight.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.visible])

  if (!p.visible) return null
  const you = view.you?.playerId ?? null
  return (
    <div className={`scene-host shooter-host corrida-host ${p.pip ? 'pip' : ''}`} data-corrida-stage>
      {session && source ? (
        <Suspense
          fallback={
            <div className="scene-loading">
              <TvOff noise />
            </div>
          }
        >
          <RaceSceneLazy source={source} opts={opts} onInput={(i) => session.setInput(i)} inputEnabled={!p.pip && view.phase !== 'fim' && !!view.you} />
        </Suspense>
      ) : (
        <div className="scene-loading">
          <TvOff noise />
        </div>
      )}
      {session && (
        <RaceHud
          session={session}
          view={view}
          you={you}
          colors={colors}
          names={names}
          canManage={p.canManage}
          onPlayAgain={p.onPlayAgain}
          onClose={p.onClose}
          onBackToScreens={p.onBackToScreens}
          musicOn={p.musicOn}
          musicVolume={p.musicVolume}
          onMusicOn={p.onMusicOn}
          onMusicVolume={p.onMusicVolume}
          hidden={p.pip}
        />
      )}
    </div>
  )
}
