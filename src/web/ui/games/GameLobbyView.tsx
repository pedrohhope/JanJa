import type { GameLobby } from '../../../shared/games/protocol'
import { Avatar } from '../Avatar'
import { CATALOG, summarize } from './catalog'
import { useChannelSurf, useReducedMotion } from './motion'
import { THUMBS } from './thumbs'
import { TvFrame } from './TvFrame'
import type { GamesApi } from '../GamesPanel'

interface Props {
  lobby: GameLobby
  hasView: boolean
  api: GamesApi
  onClose: () => void
  onShowTable: () => void
}

const Chair = () => (
  <svg className="games-chair" viewBox="0 0 16 16" width="22" height="22" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="3" y="1" width="2" height="9" fill="currentColor" />
    <rect x="3" y="8" width="10" height="2" fill="currentColor" />
    <rect x="3" y="10" width="2" height="5" fill="currentColor" />
    <rect x="11" y="10" width="2" height="5" fill="currentColor" />
  </svg>
)

/** O lobby da partida aberta: a TV do jogo, as vagas como cadeiras e as ações de sempre. */
export function GameLobbyView({ lobby, hasView, api, onClose, onShowTable }: Props) {
  const entry = CATALOG[lobby.gameId]
  const reduced = useReducedMotion()
  const frames = THUMBS[entry.id]
  // em andamento, a TV passa os quadros como canal; parada, fica no primeiro
  const { index } = useChannelSurf(frames.length, lobby.started, 2200, reduced, entry.id)
  const mine = lobby.seats.find((s) => s.you)
  // golfe, Magnata, tiro, briga e Stop falam em "entrar na partida"; os jogos de mesa, em "sentar"
  const joins = lobby.gameId === 'golf' || lobby.gameId === 'tycoon' || lobby.gameId === 'shooter' || lobby.gameId === 'brawl' || lobby.gameId === 'stop'
  const isChess = lobby.gameId === 'chess' || lobby.gameId === 'checkers'
  const label = summarize(lobby.gameId, lobby.options)
  const where = joins || isChess ? 'a partida' : 'a mesa'
  const realtime = lobby.gameId === 'shooter' || lobby.gameId === 'brawl'

  const tv = (
    <TvFrame id={entry.id} src={frames[index]} alt={`Print do ${entry.name}`} icon={entry.icon} channel={entry.channel} size="mini" on={lobby.started} liveBadge={lobby.started} />
  )

  return (
    <>
      <div className="games-body">
        {lobby.started ? (
          <div className="games-lobby-top">
            {tv}
            <div className="games-lobby-text">
              <p className="games-lobby-lead">
                {lobby.openedBy} abriu {where}. Partida em andamento: {label}.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="games-lobby-top">
              {tv}
              <div className="games-lobby-text">
                <p className="games-lobby-lead">
                  {lobby.openedBy} abriu {where}: {label}.
                </p>
                {lobby.seats.length < lobby.minPlayers && (
                  <p className="small muted">
                    Precisa de pelo menos {lobby.minPlayers} {lobby.minPlayers === 1 ? 'pessoa' : 'pessoas'} {joins ? 'na partida' : 'sentadas'} para começar.
                  </p>
                )}
              </div>
            </div>
            <ul className="games-seats">
              {Array.from({ length: lobby.maxPlayers }, (_, i) => {
                const s = lobby.seats.find((x) => x.seat === i)
                // truco em dupla/trio: a cadeira escolhe o time (pares x ímpares)
                const team = lobby.gameId === 'truco' && lobby.maxPlayers > 2 ? ` · time ${(i % 2) + 1}` : ''
                return (
                  <li key={i} className={s ? 'taken' : 'free'}>
                    {s ? (
                      <>
                        <span className="games-sit">
                          <Avatar name={s.name} size={32} />
                        </span>
                        <span className="seat-name">
                          {s.name}
                          {s.you ? ' (você)' : ''}
                          {team && <small className="detail">{team}</small>}
                        </span>
                        {!s.present && <small className="detail">fora da sala</small>}
                      </>
                    ) : (
                      <button className="seat-free" onClick={() => api.sit(i)}>
                        <span className="seat-empty" aria-hidden="true">
                          <Chair />
                        </span>
                        {joins ? `Vaga ${i + 1} livre` : `Cadeira ${i + 1} livre${team}`}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
      {lobby.started ? (
        <div className="modal-actions games-foot">
          {lobby.canManage && (
            <button className="danger" onClick={api.close}>
              {joins || isChess ? 'Encerrar partida' : 'Encerrar mesa'}
            </button>
          )}
          {realtime && !mine && (
            <button className="primary" onClick={() => api.sit()}>
              Entrar na partida
            </button>
          )}
          {hasView && (
            <button
              className={realtime && !mine ? '' : 'primary'}
              onClick={() => {
                onShowTable()
                onClose()
              }}
            >
              {lobby.gameId === 'golf' ? 'Ver o campo' : lobby.gameId === 'poker' ? 'Ver a mesa' : realtime ? 'Ver a partida' : 'Ver o tabuleiro'}
            </button>
          )}
        </div>
      ) : (
        <div className="modal-actions games-foot">
          {lobby.canManage && (
            <button className="danger" onClick={api.close}>
              Encerrar
            </button>
          )}
          {mine ? <button onClick={api.stand}>{joins ? 'Sair da partida' : 'Levantar'}</button> : <button onClick={() => api.sit()}>{realtime ? 'Entrar na partida' : joins ? 'Entrar' : 'Sentar'}</button>}
          {lobby.canManage && (
            <button className="primary" disabled={lobby.seats.length < lobby.minPlayers} onClick={api.start}>
              Começar
            </button>
          )}
        </div>
      )}
    </>
  )
}
