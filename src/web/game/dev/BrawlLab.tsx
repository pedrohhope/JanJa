import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { CHARACTERS } from '../../../shared/games/brawl/characters'
import { MOVES } from '../../../shared/games/brawl/moves'
import { brawlSim } from '../../../shared/games/brawl/sim'
import {
  ARENA_IDS,
  CHARACTER_IDS,
  DEFAULT_BRAWL_OPTIONS,
  type ArenaId,
  type BotLevel,
  type BrawlMinutes,
  type BrawlSimEvent,
  type BrawlView,
  type CharacterId,
  type Held,
  type TeamSize
} from '../../../shared/games/brawl/types'
import { toneOf } from '../../ui/Avatar'
import { BrawlHud } from '../../ui/BrawlHud'
import type { BrawlFrame } from '../brawl/contract'
import { brawlColors, brawlNames, moveTiming, winnerSlots } from '../brawl/hudLogic'
import { createLocalSession, type BrawlLocalSession } from '../brawl/net/local'
import type { DebugBox } from '../brawl/scene/contract'
import { BrawlScene } from '../brawl/scene/BrawlScene'

const SIZES: Record<string, [number, number]> = { livre: [0, 0], '1440x810': [1440, 810], '960x540': [960, 540], '390x844 celular': [390, 844] }

interface BrigaLab {
  frame: () => BrawlFrame | null
  sim: () => ReturnType<BrawlLocalSession['sim']>
  /** nocauteia o lutador (empurra para fora da arena) */
  ko: (slot: number) => void
  /** põe a arma na mão do lutador */
  give: (slot: number, weapon: Held) => void
  /** soma dano */
  damage: (slot: number, n: number) => void
  /** liga ou desliga as caixas de golpe e corpo e o fps (a tecla ` faz o mesmo) */
  debug: (on?: boolean) => void
  restart: () => void
}

/**
 * Laboratório da Briga na Sala (só em dev): a simulação de verdade rodando aqui, sem rede.
 * `?arena=telhado&bots=3&char=janja&nivel=dificil&modo=tempo&vidas=3&min=3&times=2&size=1440x810&debug=1`,
 * `window.__briga` (frame, sim, ko, give, damage, debug) e a tecla ` liga as caixas de golpe e o fps.
 */
export function BrawlLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const pick = <T extends string>(v: string | null, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
  const arenaId = pick<ArenaId>(q.get('arena'), ARENA_IDS, 'estante')
  const char = pick<CharacterId>(q.get('char'), CHARACTER_IDS, 'jan')
  const botLevel = pick<BotLevel>(q.get('nivel'), ['facil', 'medio', 'dificil'], 'medio')
  const mode = q.get('modo') === 'tempo' ? 'tempo' : 'vidas'
  const bots = Math.max(0, Math.min(4, Number(q.get('bots') ?? 3)))
  const teamSize = ([0, 2, 3, 4].includes(Number(q.get('times'))) ? Number(q.get('times')) : 0) as TeamSize
  const minutes = ([2, 3, 5].includes(Number(q.get('min'))) ? Number(q.get('min')) : 3) as BrawlMinutes
  const stocks = Math.max(1, Math.min(5, Number(q.get('vidas') ?? 3)))
  const [run, setRun] = useState(0)
  const [size, setSize] = useState(q.get('size') ?? 'livre')
  const [debug, setDebug] = useState(q.get('debug') === '1')
  const [fps, setFps] = useState(0)
  const debugRef = useRef(debug)
  debugRef.current = debug

  const base = useMemo<BrawlLocalSession>(
    () => createLocalSession({ arenaId, bots, char, botLevel, mode, stocks, minutes, teamSize, friendlyFire: false, seed: q.has('seed') ? Number(q.get('seed')) : undefined }),
    [run] // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => () => base.dispose(), [base])

  const colors = useMemo(() => brawlColors(base.roster, teamSize, toneOf), [base, teamSize])
  const names = useMemo(() => brawlNames(base.roster), [base])
  const [view, setView] = useState<BrawlView>(() => viewOf(base, 'jogando'))
  useEffect(() => {
    setView(viewOf(base, 'jogando'))
    const id = window.setInterval(() => {
      const over = base.sim().phase === 'fim'
      setView((v) => (over || v.phase === 'fim' ? viewOf(base, over ? 'fim' : 'jogando') : v))
    }, 250)
    return () => window.clearInterval(id)
  }, [base])

  // fonte da cena: o quadro da sessão local mais as caixas de depuração
  const sceneEvents = useMemo<BrawlSimEvent[]>(() => [], [base])
  useEffect(() => base.onEvents((evs) => sceneEvents.push(...evs)), [base, sceneEvents])
  const winners = view.phase === 'fim' ? winnerSlots(view.ranking, view.players, teamSize) : []
  const source = useMemo(
    () => ({
      frame() {
        const f = base.frame()
        if (!f) return null
        return { state: f.state, opts: { youSlot: 0, names, colors, reducedMotion: false, moveTiming, winners, debugBoxes: debugRef.current ? boxesOf(f) : undefined } }
      },
      drainEvents: () => sceneEvents.splice(0)
    }),
    [base, names, colors, winners.join(','), sceneEvents] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // tecla ` liga as caixas e o fps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') setDebug((d) => !d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    let raf = 0
    let n = 0
    let t0 = performance.now()
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      n++
      if (t - t0 >= 500) {
        setFps(Math.round((n * 1000) / (t - t0)) + Math.random() * 1e-6)
        n = 0
        t0 = t
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const fighter = (slot: number) => base.sim().fighters.find((f) => f.slot === slot)
    const lab: BrigaLab = {
      frame: () => base.frame(),
      sim: () => base.sim(),
      ko: (slot) => {
        const f = fighter(slot)
        if (f) {
          f.x = 700
          f.y = 400
          f.hitstunUntil = base.sim().tick + 30
        }
      },
      give: (slot, weapon) => {
        const f = fighter(slot)
        if (f) f.held = weapon
      },
      damage: (slot, n) => {
        const f = fighter(slot)
        if (f) f.damage = Math.max(0, Math.min(300, f.damage + n))
      },
      debug: (on) => setDebug((d) => on ?? !d),
      restart: () => setRun((r) => r + 1)
    }
    ;(window as unknown as { __briga: BrigaLab }).__briga = lab
  }, [base])

  const [w, h] = SIZES[size] ?? [0, 0]
  const sty = w ? { width: w, height: h } : { width: '100vw', height: '100vh' }
  return (
    <div style={{ background: '#0b0807', minHeight: '100vh' }}>
      <div style={{ position: 'relative', overflow: 'hidden', background: '#221C19', ...sty }} data-lab-stage className="briga-host">
        <BrawlScene source={source} onInput={(i) => base.setInput(i)} inputEnabled={view.phase !== 'fim'} />
        <BrawlHud session={base} view={view} you="voce" colors={colors} canManage act={() => undefined} onPlayAgain={() => setRun((r) => r + 1)} onClose={() => undefined} />
        {debug && (
          <div style={{ position: 'absolute', left: 8, top: 44, zIndex: 9, font: '12px monospace', color: '#6FD49B', background: 'rgba(0,0,0,.6)', padding: '2px 6px' }} data-lab-fps>
            {Math.round(fps)} fps · tick {base.sim().tick} · ` esconde
          </div>
        )}
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

function viewOf(base: BrawlLocalSession, phase: 'jogando' | 'fim'): BrawlView {
  const st = base.sim()
  const ranking = phase === 'fim' ? brawlSim.ranking(st) : null
  return {
    you: { playerId: 'voce', slot: 0 },
    options: { ...DEFAULT_BRAWL_OPTIONS, mode: st.mode, teamSize: st.teamSize, arenaId: st.arenaId, bots: base.roster.filter((p) => p.bot).length },
    arenaId: st.arenaId,
    phase,
    pickEndsAt: 0,
    players: base.roster,
    hostId: 'voce',
    epoch: 1,
    seed: 1,
    startedAt: 1,
    scores: brawlSim.scores(st),
    ranking
  }
}

/** corpo (hurtbox) e golpes ativos de cada lutador, em px da arena */
function boxesOf(f: BrawlFrame): DebugBox[] {
  const out: DebugBox[] = []
  for (const fi of f.state.fighters) {
    if (fi.away || fi.action === 'fora' || fi.action === 'eliminado') continue
    const spec = CHARACTERS[fi.char]
    out.push({ x: fi.x - spec.hurtW / 2, y: fi.y - spec.hurtH, w: spec.hurtW, h: spec.hurtH, kind: 'hurt' })
    const m = fi.move ? MOVES[fi.move] : undefined
    if (m && fi.moveTick > m.startup && fi.moveTick <= m.startup + m.active) {
      const hb = m.frames[Math.min(m.frames.length - 1, fi.moveTick - m.startup - 1)] ?? []
      for (const b of hb) out.push({ x: fi.facing > 0 ? fi.x + b.x : fi.x - b.x - b.w, y: fi.y + b.y, w: b.w, h: b.h, kind: 'hit' })
    }
  }
  return out
}

