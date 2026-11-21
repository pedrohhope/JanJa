import { useCallback, useEffect, useRef, useState } from 'react'
import { GAME_IDS, type GameId, type GameLobby } from '../../shared/games/protocol'
import { buildOptions, CATALOG, CATALOG_LIST, defaultValues, gameTitle, type OptionValue, type OptionValues, type ShelfFilter } from './games/catalog'
import { GameDetail } from './games/GameDetail'
import { GameLobbyView } from './games/GameLobbyView'
import { GameShelf } from './games/GameShelf'
import type { FlipSource } from './games/motion'
import { Icon } from './icons'

export interface GamesApi {
  open: (gameId: GameId, options: unknown) => void
  sit: (seat?: number) => void
  stand: () => void
  start: () => void
  close: () => void
}

interface Props {
  lobby: GameLobby | null
  /** já existe uma partida em andamento (a mesa pode estar escondida) */
  hasView: boolean
  api: GamesApi
  onClose: () => void
  onShowTable: () => void
}

export { gameTitle }

const initialValues = (): Record<GameId, OptionValues> => Object.fromEntries(GAME_IDS.map((id) => [id, defaultValues(id)])) as Record<GameId, OptionValues>

/**
 * Painel dos jogos: a vitrine (escolher), os detalhes (opções) e, depois de aberta a partida, o lobby.
 * Só orquestra; cada tela mora em `./games`.
 */
export function GamesPanel({ lobby, hasView, api, onClose, onShowTable }: Props) {
  const [view, setView] = useState<'shelf' | 'detail'>('shelf')
  const [pick, setPick] = useState<GameId>('poker')
  const [filter, setFilter] = useState<ShelfFilter>('todos')
  const [values, setValues] = useState<Record<GameId, OptionValues>>(initialValues)
  const flipRef = useRef<FlipSource | null>(null)

  const back = useCallback(() => {
    const tv = document.querySelector<HTMLElement>('.games-detail-tv .games-tv')
    flipRef.current = tv ? { id: pick, rect: tv.getBoundingClientRect() } : null
    setView('shelf')
  }, [pick])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!lobby && view === 'detail') back()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, lobby, view, back])

  const openDetail = (id: GameId, tv: HTMLElement) => {
    flipRef.current = { id, rect: tv.getBoundingClientRect() }
    setPick(id)
    setView('detail')
  }
  const zap = (dir: 1 | -1) => {
    const at = CATALOG_LIST.findIndex((e) => e.id === pick)
    setPick(CATALOG_LIST[(at + dir + CATALOG_LIST.length) % CATALOG_LIST.length]!.id)
  }
  const change = (id: GameId, key: string, value: OptionValue) => setValues((all) => ({ ...all, [id]: { ...all[id], [key]: value } }))

  return (
    <div className="modal-backdrop games-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal games-panel" role="dialog" aria-modal="true" aria-labelledby="games-title">
        <div className="games-head">
          <h2 id="games-title">{lobby ? gameTitle(lobby.gameId) : 'Jogos'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar" data-tip="Fechar" data-tip-pos="left">
            <Icon name="x" size={20} />
          </button>
        </div>

        {lobby ? (
          <GameLobbyView lobby={lobby} hasView={hasView} api={api} onClose={onClose} onShowTable={onShowTable} />
        ) : view === 'shelf' ? (
          <div className="games-body">
            <GameShelf filter={filter} onFilter={setFilter} onOpen={openDetail} flipRef={flipRef} />
          </div>
        ) : (
          <GameDetail
            entry={CATALOG[pick]}
            values={values[pick]}
            onChange={change}
            onBack={back}
            onZap={zap}
            onOpen={() => api.open(pick, buildOptions(pick, values[pick]))}
            flipRef={flipRef}
          />
        )}
      </div>
    </div>
  )
}
