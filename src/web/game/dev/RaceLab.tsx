import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { botInput } from '../../../shared/games/race/bots'
import { raceSim } from '../../../shared/games/race/sim'
import { gridSpot, TRACKS } from '../../../shared/games/race/tracks'
import { DEFAULT_RACE_OPTIONS, RACE_LAPS, TRACK_IDS, type BotLevel, type RaceLaps, type RaceView, type TrackId } from '../../../shared/games/race/types'
import { toneOf } from '../../ui/Avatar'
import { RaceHud } from '../../ui/RaceHud'
import { raceColors, raceNames } from '../race/hudLogic'
import { createLocalSession, type RaceLocalSession } from '../race/net/local'
import { RaceScene } from '../race/scene/RaceScene'

const SIZES: Record<string, [number, number]> = { livre: [0, 0], '1440x810': [1440, 810], '960x540': [960, 540], '390x844 celular': [390, 844] }

interface CorridaLab {
  frame: RaceLocalSession['frame']
  sim: RaceLocalSession['sim']
  /** põe o carro do slot no ponto `i` do traçado (o 0 é a linha de chegada) */
  teleport: (i: number, slot?: number) => void
  /** faltando só a última volta: põe o carro antes da chegada na volta final */
  lastLap: (slot?: number) => void
  /** o seu carro dirige sozinho (prints da vitrine) */
  auto: (on?: boolean) => void
  restart: () => void
}

/**
 * Laboratório da Corrida na Sala (só em dev): a simulação de verdade rodando aqui, sem rede.
 * `?pista=quintal&bots=3&voltas=3&nivel=dificil&ver=1&size=1440x810` (`ver=1` = só robôs, você assiste)
 * e `window.__corrida` (frame, sim, teleport, lastLap, restart).
 */
export function RaceLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const trackId: TrackId = (TRACK_IDS as readonly string[]).includes(q.get('pista') ?? '') ? (q.get('pista') as TrackId) : 'sala'
  const bots = Math.max(0, Math.min(5, Number(q.get('bots') ?? 3)))
  const laps: RaceLaps = (RACE_LAPS as readonly number[]).includes(Number(q.get('voltas'))) ? (Number(q.get('voltas')) as RaceLaps) : 3
  const botLevel: BotLevel = (['facil', 'medio', 'dificil'] as const).find((l) => l === q.get('nivel')) ?? 'medio'
  const watch = q.get('ver') === '1'
  const reduced = q.get('reduced') === '1'
  const [run, setRun] = useState(0)
  const [size, setSize] = useState(q.get('size') ?? 'livre')
  const auto = useRef(q.get('auto') === '1')

  const base = useMemo<RaceLocalSession>(
    () => createLocalSession({ trackId, bots: watch ? Math.max(1, bots) : bots, laps, botLevel, watch }),
    [run] // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => () => base.dispose(), [base])

  const colors = useMemo(() => raceColors(base.roster, toneOf), [base])
  const names = useMemo(() => raceNames(base.roster), [base])
  const opts = useMemo(() => ({ names, colors, reducedMotion: reduced }), [names, colors, reduced])
  const [view, setView] = useState<RaceView>(() => viewOf(base, 'jogando', trackId, laps, watch))
  useEffect(() => {
    setView(viewOf(base, 'jogando', trackId, laps, watch))
    const id = window.setInterval(() => {
      const over = base.sim().phase === 'fim'
      setView((v) => (over && v.phase !== 'fim' ? viewOf(base, 'fim', trackId, laps, watch) : v))
    }, 250)
    return () => window.clearInterval(id)
  }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  // piloto automático: o mesmo dos robôs, numa cópia do carro (não mexe no estado do host)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!auto.current || watch) return
      const st = base.sim()
      const c = st.cars.find((x) => x.slot === 0)
      if (!c) return
      const b = botInput(st, TRACKS[st.trackId], { ...c, ai: { ...c.ai } })
      base.setInput({ seq: 0, steer: b.steer, buttons: b.buttons })
    }, 1000 / 60)
    return () => window.clearInterval(id)
  }, [base, watch])

  useEffect(() => {
    const car = (slot: number) => base.sim().cars.find((c) => c.slot === slot)
    const t = TRACKS[trackId]
    const lab: CorridaLab = {
      frame: () => base.frame(),
      sim: () => base.sim(),
      teleport: (i, slot = 0) => {
        const c = car(slot)
        const w = t.wps[((i % t.wps.length) + t.wps.length) % t.wps.length]
        if (!c || !w) return
        Object.assign(c, { x: w.x, y: w.y, hx: w.dx, hy: w.dy, vx: 0, vy: 0, next: (i + 1) % t.wps.length })
      },
      lastLap: (slot = 0) => {
        const c = car(slot)
        if (!c) return
        const g = gridSpot(t, 0)
        Object.assign(c, { x: g.x, y: g.y, hx: g.hx, hy: g.hy, vx: 0, vy: 0, lap: base.sim().laps, next: 0 })
      },
      auto: (on) => {
        auto.current = on ?? !auto.current
      },
      restart: () => setRun((r) => r + 1)
    }
    ;(window as unknown as { __corrida: CorridaLab }).__corrida = lab
  }, [base, trackId])

  const [w, h] = SIZES[size] ?? [0, 0]
  const sty = w ? { width: w, height: h } : { width: '100vw', height: '100vh' }
  return (
    <div style={{ background: '#0b0807', minHeight: '100vh' }}>
      <div style={{ position: 'relative', overflow: 'hidden', background: '#221C19', ...sty }} data-lab-stage className="scene-host shooter-host corrida-host">
        <RaceScene source={base} opts={opts} onInput={(i) => {
            if (!auto.current) base.setInput(i)
          }} inputEnabled={view.phase !== 'fim' && !watch} />
        <RaceHud session={base} view={view} you={watch ? null : 'voce'} colors={colors} names={names} canManage onPlayAgain={() => setRun((r) => r + 1)} onClose={() => undefined} />
      </div>
      {q.get('ui') === '1' && (
        <div style={{ font: '12px system-ui', color: '#ddd', padding: 6, display: 'flex', gap: 8 }}>
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            {Object.keys(SIZES).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button onClick={() => setRun((r) => r + 1)}>Recomeçar</button>
        </div>
      )}
    </div>
  )
}

function viewOf(base: RaceLocalSession, phase: 'jogando' | 'fim', trackId: TrackId, laps: RaceLaps, watch: boolean): RaceView {
  const st = base.sim()
  return {
    you: watch ? null : { playerId: 'voce', slot: 0 },
    options: { ...DEFAULT_RACE_OPTIONS, trackId, laps, bots: base.roster.filter((p) => p.bot).length },
    trackId,
    phase,
    players: base.roster,
    hostId: 'voce',
    epoch: 1,
    createdAt: 1,
    scores: raceSim.scores(st),
    ranking: phase === 'fim' ? raceSim.ranking(st) : null
  }
}
