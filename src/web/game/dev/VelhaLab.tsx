import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { DuelMinutes } from '../../../shared/games/duel'
import { isGameError, seededRng } from '../../../shared/games/types'
import { apply, nextDeadline, setup, tick, view, type VelhaState } from '../../../shared/games/velha/engine'
import type { VelhaAction } from '../../../shared/games/velha/types'
import { toneOf } from '../../ui/Avatar'
import { VelhaHud } from '../../ui/VelhaHud'
import { VelhaScene } from '../velha/scene/VelhaScene'

const PLAYERS = [
  { playerId: 'eu', name: 'Você' },
  { playerId: 'bot', name: 'Bia' }
]
const colors = Object.fromEntries(PLAYERS.map((p) => [p.playerId, toneOf(p.name)]))
const ctx = () => ({ now: Date.now(), rng: seededRng(Number(new URLSearchParams(location.search).get('seed') ?? 0)) })

/**
 * Laboratório da Velha ao quadrado (só em dev): o motor de verdade rodando aqui mesmo, sem servidor.
 * `?min=5&bot=0&seed=1` (bot=0: você joga dos dois lados) e `window.__velha.move(tabuleiro, casa)`,
 * `.random(n)` (n lances aleatórios) e `.state()`.
 */
export function VelhaLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const bot = q.get('bot') !== '0'
  const minutes = Number(q.get('min') ?? 0) as DuelMinutes
  const fresh = () => setup(PLAYERS, { minutes }, ctx()).state
  const [state, setState] = useState<VelhaState>(fresh)
  const ref = useRef(state)
  ref.current = state

  const turnId = (s: VelhaState) => (s.pos.turn === 'x' ? s.players.w.playerId : s.players.b.playerId)
  const actor = (s: VelhaState) => (bot ? 'eu' : turnId(s))
  const act = (playerId: string, a: VelhaAction) => {
    const r = apply(ref.current, playerId, a, ctx())
    if (isGameError(r)) console.warn(r.message)
    else {
      ref.current = r.state
      setState(r.state)
    }
  }
  const randomMove = (who: string) => {
    const legal = view(ref.current, who, Date.now()).legal
    const m = legal[Math.floor(Math.random() * legal.length)]
    if (m) act(who, { type: 'move', board: m[0], cell: m[1] })
  }

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = ref.current
      const d = nextDeadline(s)
      if (d !== null && d <= Date.now()) setState(tick(s, ctx()).state)
    }, 100)
    return () => window.clearInterval(t)
  }, [])

  // bot: lance aleatório entre os legais
  useEffect(() => {
    if (!bot || state.result || turnId(state) !== 'bot') return
    const t = window.setTimeout(() => randomMove('bot'), 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot, state])

  useEffect(() => {
    ;(window as unknown as { __velha: unknown }).__velha = {
      move: (board: number, cell: number) => act(turnId(ref.current), { type: 'move', board, cell }),
      random: (n = 1) => {
        for (let i = 0; i < n && !ref.current.result; i++) randomMove(turnId(ref.current))
      },
      state: () => ref.current
    }
  })

  const me = actor(state)
  const v = view(state, me, Date.now())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Laboratório da Velha ao quadrado</strong>
        <button onClick={() => setState(fresh())}>Recomeçar</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <VelhaScene view={v} colors={colors} reducedMotion={false} onMove={(board, cell) => act(me, { type: 'move', board, cell })} />
      </div>
      <VelhaHud
        view={v}
        canManage
        onAct={(a) => act(me, a)}
        onPlayAgain={() => setState(fresh())}
        onClose={() => setState(fresh())}
        onBackToScreens={() => undefined}
        musicOn={false}
        musicVolume={0.5}
        onMusicOn={() => undefined}
        onMusicVolume={() => undefined}
      />
    </div>
  )
}
