import { useEffect, useRef, useState, type ReactElement } from 'react'
import { botMove } from '../../../shared/games/pife/bot'
import { apply, nextDeadline, setup, tick, view, type PifeState } from '../../../shared/games/pife/engine'
import type { PifeAction, PifeEvent, PifeIntent } from '../../../shared/games/pife/types'
import { isGameError, seededRng, type Rng } from '../../../shared/games/types'
import { PifeHud } from '../../ui/PifeHud'
import type { RawEventBatch } from '../contract'
import { PifeScene } from '../pife/scene/PifeScene'

const NAMES = ['Você', 'Bia', 'Caio', 'Duda', 'Edu', 'Flor', 'Gil', 'Hana']

/**
 * Laboratório do pife (só em dev): o motor rodando aqui, com bots.
 * `?n=4` (2 a 8), `?seed=3` (cartas sempre iguais), `?bot=0` (os bots param) e
 * `window.__pife.hand([...])` (troca a sua mão), `.give(carta)` (põe no topo do monte), `.auto(n)` (você joga como bot), `.state()`.
 */
export function PifeLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const n = Math.min(8, Math.max(2, Number(q.get('n') ?? 4)))
  const seed = q.get('seed')
  const rng: Rng = seed ? seededRng(Number(seed)) : { int: (max) => Math.floor(Math.random() * max) }
  const ctx = () => ({ now: Date.now(), rng })
  const bots = q.get('bot') !== '0'
  const players = NAMES.slice(0, n).map((name, i) => ({ playerId: i === 0 ? 'eu' : `bot${i}`, name }))
  const fresh = () => {
    const s = setup(players, {}, ctx()).state
    // no laboratório, você começa
    s.turn = 0
    return s
  }
  const [state, setState] = useState<PifeState>(fresh)
  const [events, setEvents] = useState<RawEventBatch | null>(null)
  const seq = useRef(0)
  const ref = useRef(state)
  ref.current = state

  const commit = (next: PifeState, evs: PifeEvent[]) => {
    ref.current = next
    setState(next)
    if (evs.length) setEvents({ seq: ++seq.current, events: evs })
  }
  const act = (id: string, a: PifeIntent) => {
    const r = apply(ref.current, id, { ...a, ref: ref.current.ref } as PifeAction, ctx())
    if (isGameError(r)) console.warn(r.message)
    else commit(r.state, r.events)
  }

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = ref.current
      const d = nextDeadline(s)
      if (d !== null && d <= Date.now()) {
        const r = tick(s, ctx())
        commit(r.state, r.events)
      }
    }, 200)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // bots: uma jogada por vez, com pausa para dar para ver
  useEffect(() => {
    if (!bots || state.phase === 'fim' || state.turn === 0) return
    const t = window.setTimeout(() => {
      const id = ref.current.players[ref.current.turn].playerId
      const a = botMove(view(ref.current, id, Date.now()))
      if (a) act(id, a)
    }, 700)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    ;(window as unknown as { __pife: unknown }).__pife = {
      hand: (cards: string[]) => {
        const s = structuredClone(ref.current)
        s.hands[0] = cards
        commit(s, [])
      },
      give: (card: string) => {
        const s = structuredClone(ref.current)
        s.stock.push(card)
        commit(s, [])
      },
      auto: (k = 1) => {
        for (let i = 0; i < k && ref.current.phase !== 'fim'; i++) {
          const id = ref.current.players[ref.current.turn].playerId
          const a = botMove(view(ref.current, id, Date.now()))
          if (a) act(id, a)
        }
      },
      state: () => ref.current
    }
  })

  const v = view(state, 'eu', Date.now())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
        <strong>Laboratório do pife</strong>
        <button onClick={() => commit(fresh(), [{ type: 'start', first: 0 }])}>Recomeçar</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <PifeScene view={v} lastEvents={events} reducedMotion={false} onAct={(a) => act('eu', a)} />
      </div>
      <PifeHud
        view={v}
        canManage
        onPlayAgain={() => commit(fresh(), [])}
        onClose={() => commit(fresh(), [])}
        onBackToScreens={() => undefined}
        musicOn={false}
        musicVolume={0.5}
        onMusicOn={() => undefined}
        onMusicVolume={() => undefined}
      />
    </div>
  )
}
