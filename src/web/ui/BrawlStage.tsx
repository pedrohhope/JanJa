import { Suspense, useEffect, useMemo, useRef, type ReactElement } from 'react'
import type { BrawlAction, BrawlSimEvent, BrawlView } from '../../shared/games/brawl/types'
import type { BrawlSceneSource } from '../game/brawl/scene/contract'
import type { MusicTrack } from '../game/contract'
import type { BrawlSessionDeps } from '../game/brawl/contract'
import { brawlColors, brawlNames, moveTiming, winnerSlots } from '../game/brawl/hudLogic'
import { useBrawlSession } from '../game/brawl/net/useBrawlSession'
import { brawlCue, brawlTrack } from '../game/brawl/sfx'
import { loadBrawlScene } from '../game/loaders'
import type { SfxBus } from '../game/shooter/sfxBus'
import { toneOf } from './Avatar'
import { BrawlHud } from './BrawlHud'
import { TvOff } from './Brand'
import { lazyChunk } from '../version'

const BrawlSceneLazy = lazyChunk(loadBrawlScene)

export interface BrawlStageProps {
  view: BrawlView
  manager: BrawlSessionDeps['manager']
  relay: BrawlSessionDeps['relay']
  onRelay: BrawlSessionDeps['onRelay']
  act: (action: BrawlAction) => void
  visible: boolean
  pip: boolean
  canManage: boolean
  reducedMotion: boolean
  sfxBus: SfxBus
  onTrack: (track: MusicTrack | null) => void
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  onSpotlight: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

/**
 * A Briga na Sala dentro da sala. Na escolha só o HUD aparece; ao começar a luta cria a sessão (que
 * roda a simulação quando você é o host, por isso ela segue viva mesmo escondida), carrega a cena Pixi
 * só nessa hora, toca os sons e avisa a música.
 */
export function BrawlStage(p: BrawlStageProps): ReactElement | null {
  const { view } = p
  const fighting = view.phase !== 'escolha'
  const deps = useMemo<BrawlSessionDeps | null>(
    () => (fighting ? { view, manager: p.manager, relay: p.relay, onRelay: p.onRelay, act: p.act } : null),
    [fighting, view, p.manager, p.relay, p.onRelay, p.act]
  )
  const session = useBrawlSession(deps)
  const colors = useMemo(() => brawlColors(view.players, view.options.teamSize, toneOf), [view.players, view.options.teamSize])
  const names = useMemo(() => brawlNames(view.players), [view.players])
  const youSlot = view.you?.slot ?? -1
  const winners = useMemo(() => (view.phase === 'fim' ? winnerSlots(view.ranking, view.players, view.options.teamSize) : []), [view.phase, view.ranking, view.players, view.options.teamSize])

  // a cena puxa o quadro da sessão; as opções de desenho vêm da sala
  const latest = useRef({ colors, names, youSlot, winners, reducedMotion: p.reducedMotion })
  latest.current = { colors, names, youSlot, winners, reducedMotion: p.reducedMotion }
  const source = useMemo<BrawlSceneSource | null>(() => {
    if (!session) return null
    return {
      frame() {
        const f = session.frame()
        if (!f) return null
        const o = latest.current
        return { state: f.state, opts: { youSlot: f.me ?? o.youSlot, names: o.names, colors: o.colors, reducedMotion: o.reducedMotion, moveTiming, winners: o.winners } }
      },
      drainEvents: () => sceneEvents.splice(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])
  const sceneEvents = useMemo<BrawlSimEvent[]>(() => [], [session])

  // eventos: vão à cena e viram som
  const bus = p.sfxBus
  useEffect(() => {
    if (!session) return
    let lastCount = -1
    const off = session.onEvents((evs) => {
      const f = session.frame()
      const me = f?.me ?? null
      const posX = (slot: number) => f?.state.fighters.find((x) => x.slot === slot)?.x
      for (const e of evs) {
        sceneEvents.push(e)
        const cue = brawlCue(e, me, posX)
        if (cue) bus.emit(cue.name, { volume: cue.volume, pan: cue.pan })
      }
      if (sceneEvents.length > 300) sceneEvents.splice(0, sceneEvents.length - 300)
    })
    // contagem: um bipe por segundo (3, 2, 1)
    const id = window.setInterval(() => {
      const f = session.frame()
      if (!f || f.state.phase !== 'contagem') {
        lastCount = -1
        return
      }
      const n = Math.ceil((f.state.goTick - f.state.tick) / 60)
      if (n !== lastCount && n > 0) {
        lastCount = n
        bus.emit('contagem', { volume: 0.8 })
      }
    }, 60)
    return () => {
      off()
      window.clearInterval(id)
    }
  }, [session, bus, sceneEvents])

  // música: por arena; última vida, morte súbita e último pedaço do tempo trocam para a do final
  const onTrack = useRef(p.onTrack)
  onTrack.current = p.onTrack
  useEffect(() => {
    let last: MusicTrack | null = null
    const read = () => {
      const f = session?.frame() ?? null
      const timed = view.options.mode === 'tempo'
      const lastStock = !timed && view.options.stocks > 1 && !!f && f.state.fighters.some((x) => !x.away && x.stocks === 1 && x.action !== 'eliminado')
      const next = brawlTrack({
        phase: view.phase,
        arena: view.arenaId,
        timeLeftMs: f?.timeLeftMs ?? 0,
        timed,
        lastStock,
        suddenDeath: f?.state.phase === 'morte-subita'
      })
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
  }, [session, view.phase, view.arenaId, view.options.mode, view.options.stocks])

  // G: alterna a tela em destaque; Esc devolve o palco ao jogo (C, M e F são da sala)
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
    <div className={`scene-host shooter-host briga-host ${p.pip ? 'pip' : ''}`} data-briga-stage>
      {fighting &&
        (session && source ? (
          <Suspense
            fallback={
              <div className="scene-loading">
                <TvOff noise />
              </div>
            }
          >
            <BrawlSceneLazy source={source} onInput={(i) => session.setInput(i)} inputEnabled={!p.pip && view.phase !== 'fim'} />
          </Suspense>
        ) : (
          <div className="scene-loading">
            <TvOff noise />
          </div>
        ))}
      <BrawlHud
        session={session}
        view={view}
        you={you}
        colors={colors}
        canManage={p.canManage}
        act={p.act}
        onPlayAgain={p.onPlayAgain}
        onClose={p.onClose}
        onBackToScreens={p.onBackToScreens}
        musicOn={p.musicOn}
        musicVolume={p.musicVolume}
        onMusicOn={p.onMusicOn}
        onMusicVolume={p.onMusicVolume}
        hidden={p.pip}
      />
    </div>
  )
}
